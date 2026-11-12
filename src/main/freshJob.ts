/**
 * The weekly check that keeps the catalogue fresh, as a job with everything it touches handed in
 * (main/courseFresh wires it to the app; tests hand it saved pages and fakes). In order:
 *   1. your subjects, from your focus list, aims, roadmaps and What you know;
 *   2. new courses on the sources: MIT OpenCourseWare's course list, the lecture playlists of
 *      university channels on YouTube, QuantEcon's lecture series, and GitHub's search;
 *   3. your imported courses, each asked whether its source changed (a new commit, new pages);
 *   4. the found courses ranked (by Claude when it is there, by the simple score otherwise) and the
 *      best kept as suggestions, "New this week".
 * It never imports anything. It waits while a lesson runs, and every step is logged.
 */
import { sourceOf, type CatalogueCourse } from '@shared/courseCatalogue'
import { RANK_SYSTEM, areaFor, checkDue, keepSuggestions, rankFound, rankingPrompt, readRanking, unsuitable, type CheckLog, type Found, type Suggestion } from '@shared/courseFresh'
import { slugify, tierOfLicence } from '@shared/courseSource'
import { SourceRefused, type Fetcher } from './courseSources/fetcher'
import { parsePlaylist } from './courseSources/youtube'

export interface FreshState {
  lastRun?: number
  /** How the last run ranked: Claude, or the simple score */
  rankedBy?: 'claude' | 'score'
  suggestions: Suggestion[]
  /** Suggestions you dismissed: never suggested again */
  dismissed: string[]
  /** Suggestions you imported: kept in the catalogue */
  adopted: CatalogueCourse[]
  /** Imported courses whose source changed: the version found (cleared when you update) */
  updates: Record<string, string>
  /** The first version seen of a course imported without one (a tarball): what later checks compare with */
  baselines: Record<string, string>
  /** OCW course pages already seen, so only new ones are considered */
  seenOcw?: string[]
  /** How each step of the last run ended, to show after a restart */
  lastSteps?: { id: FreshStep; state: 'done' | 'failed'; detail?: string }[]
}

export const emptyState = (): FreshState => ({ suggestions: [], dismissed: [], adopted: [], updates: {}, baselines: {} })

export type FreshStep = 'subjects' | 'ocw' | 'youtube' | 'quantecon' | 'github' | 'updates' | 'ranking'
export const STEPS: { id: FreshStep; label: string }[] = [
  { id: 'subjects', label: 'Your subjects' },
  { id: 'ocw', label: 'MIT OCW' },
  { id: 'youtube', label: 'Lectures on YouTube' },
  { id: 'quantecon', label: 'QuantEcon' },
  { id: 'github', label: 'GitHub' },
  { id: 'updates', label: 'Your courses' },
  { id: 'ranking', label: 'Ranking' }
]

export interface FreshDeps {
  fetcher: Fetcher
  now: () => number
  /** A lesson is running (the job waits) */
  lessonRunning: () => boolean
  sleep: (ms: number) => Promise<void>
  terms: () => Promise<string[]>
  catalogue: () => CatalogueCourse[]
  /** Imported courses and the version each was read at (a commit or a fingerprint) */
  imported: () => Promise<{ course: CatalogueCourse; current?: string }[]>
  /** A web course's fingerprint now (main/sources) */
  probe: (c: CatalogueCourse) => Promise<string>
  /** Claude's background model; null when Claude isn't there (or the job is private) */
  rank: (prompt: string, system: string) => Promise<string | null>
  read: () => Promise<FreshState>
  write: (s: FreshState) => Promise<void>
  log: (entries: CheckLog[]) => Promise<void>
  onStep?: (step: FreshStep, state: 'running' | 'done' | 'paused' | 'failed', detail?: string) => void
  /** YouTube channels whose lecture playlists are looked through */
  channels?: string[]
  /** How long the job waits for a lesson to end before giving up until next time */
  maxWaitMs?: number
}

export const CHANNELS = ['@mitocw', '@stanfordonline', '@YaleCourses', '@CMUDatabaseGroup', '@QuantEconomics', '@BerkeleyCS', '@YaleUniversity']

// ---------- Finding courses ----------

/** "15-401-finance-theory-i-fall-2008" → { number: "15.401", title: "Finance Theory I", term: "Fall 2008" } */
export function ocwSlugTitle(slug: string): { number: string; title: string; term: string } {
  const m = slug.match(/^((?:res-)?[a-z0-9]+(?:-[a-z0-9]*\d[a-z0-9]*)?)-(.+?)-((?:fall|spring|summer|winter|january-iap|iap)-\d{4})$/i)
  const cap = (s: string) => s.replace(/(^|\s)(\w)/g, (_, a, b: string) => a + b.toUpperCase()).replace(/\b(Ii|Iii|Iv|Vi)\b/g, (x) => x.toUpperCase()).replace(/\b(And|Of|In|For|The|With|To|A)\b/g, (x) => x.toLowerCase()).replace(/^./, (x) => x.toUpperCase())
  if (!m) return { number: '', title: cap(slug.replace(/-/g, ' ')), term: '' }
  const number = m[1].toUpperCase().replace(/^RES-/, 'RES.').replace(/^([A-Z0-9]+)-/, '$1.')
  return { number, title: cap(m[2].replace(/-/g, ' ')), term: cap(m[3].replace(/-/g, ' ').replace('january iap', 'IAP')) }
}

/** OCW's sitemap: every course's page */
export function ocwCourseUrls(sitemap: string): string[] {
  return [...new Set([...sitemap.matchAll(/<loc>\s*(https:\/\/ocw\.mit\.edu\/courses\/[^/<]+\/)(?:sitemap\.xml)?\s*<\/loc>/g)].map((m) => m[1]))]
}

export function ocwFound(url: string): Found {
  const slug = url.replace(/\/+$/, '').split('/').pop()!
  const t = ocwSlugTitle(slug)
  const year = Number(t.term.match(/\d{4}/)?.[0] ?? 0)
  const title = `${t.title}${t.number ? ` (MIT ${t.number})` : ''}`
  return {
    course: {
      id: `ocw-${slugify(slug, 70)}`,
      source: 'ocw',
      url,
      title,
      by: 'MIT OpenCourseWare',
      area: areaFor(t.title),
      licence: 'CC BY-NC-SA 4.0',
      tier: 'personal',
      licenceNote: 'MIT OpenCourseWare: for your own study, never passed on',
      covers: `MIT ${t.number} ${t.title}, ${t.term}`.trim(),
      kind: 'course',
      level: /^\d+-[5-9]\d\d/.test(slug) ? 'advanced' : /^\d+-[3-4]\d\d/.test(slug) ? 'intermediate' : 'beginner',
      topics: [t.title.toLowerCase()]
    },
    ...(year ? { updatedAt: Date.UTC(year, 0, 1) } : {})
  }
}

/** A channel's playlists page: its lecture series (ten videos or more) */
export function channelPlaylists(html: string, channel: string): Found[] {
  const out: Found[] = []
  const data = (() => {
    const m = html.match(/<script[^>]*id="yt-initial-data"[^>]*>([\s\S]*?)<\/script>/) ?? html.match(/var ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/)
    try {
      return m ? JSON.parse(m[1]) : null
    } catch {
      return null
    }
  })()
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk)
    if (!x || typeof x !== 'object') return
    const l = (x as Record<string, any>).lockupViewModel // eslint-disable-line @typescript-eslint/no-explicit-any
    if (l && /PLAYLIST|COURSE/.test(l.contentType ?? '') && /^PL[\w-]{14,}$/.test(l.contentId ?? '')) {
      const title: string = l.metadata?.lockupMetadataViewModel?.title?.content ?? ''
      const n = Number(JSON.stringify(l).match(/"text":\s*"(\d+) (?:videos|lessons)"/)?.[1] ?? 0)
      if (title && n >= 10 && !out.some((f) => f.course.playlist === l.contentId))
        out.push({
          course: {
            id: `yt-${slugify(title, 50)}-${l.contentId.slice(-6).toLowerCase()}`,
            source: 'youtube',
            playlist: l.contentId,
            title,
            by: channel.replace(/^@/, ''),
            area: areaFor(title),
            licence: 'Standard YouTube licence',
            tier: 'personal',
            licenceNote: 'Watched in YouTube’s player; transcripts kept on this Mac for your own study',
            covers: `${n} lectures from ${channel.replace(/^@/, '')} on YouTube`,
            kind: 'course',
            level: 'intermediate',
            topics: [title.toLowerCase()]
          },
          weight: n
        })
    }
    for (const v of Object.values(x as Record<string, unknown>)) walk(v)
  }
  walk(data?.contents)
  return out
}

interface GhRepo {
  full_name: string
  default_branch: string
  description: string | null
  stargazers_count: number
  pushed_at: string
  license: { spdx_id: string | null } | null
  topics?: string[]
  owner: { login: string }
  archived?: boolean
  fork?: boolean
}

/** GitHub's search results as found courses (an open licence or none; archived and forks left out) */
export function githubFound(json: string): Found[] {
  let items: GhRepo[] = []
  try {
    items = (JSON.parse(json) as { items?: GhRepo[] }).items ?? []
  } catch {
    return []
  }
  return items
    .filter((r) => !r.archived && !r.fork)
    // Material to learn from, not an app, a library or a template
    .filter((r) => {
      const name = r.full_name.split('/')[1].toLowerCase().replace(/[-_.]+/g, ' ')
      const text = `${name} ${(r.description ?? '').toLowerCase()} ${(r.topics ?? []).join(' ')}`
      return /\b(course|courses|tutorials?|lectures?|book|guide|handbook|curriculum|learn|learning|workshop|notes|roadmap|bootcamp|zoomcamp|syllabus)\b/.test(text) && !/\b(frontend|backend|app|website|clone|bot|sdk|api|plugin|template|starter|dashboard|wallet|exchange|integration|gateway)\b/.test(name)
    })
    .map((r) => {
      const spdx = r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : 'None stated'
      const name = r.full_name.split('/')[1].replace(/[-_]+/g, ' ')
      const text = `${name} ${r.description ?? ''} ${(r.topics ?? []).join(' ')}`
      return {
        course: {
          id: `gh-${slugify(r.full_name.replace('/', '-'), 60)}`,
          source: 'github' as const,
          repo: r.full_name,
          branch: r.default_branch,
          title: name.replace(/^./, (x) => x.toUpperCase()),
          by: r.owner.login,
          area: areaFor(text),
          licence: spdx,
          tier: tierOfLicence(spdx),
          ...(tierOfLicence(spdx) === 'personal' ? { licenceNote: 'No open licence: fetched to this Mac for your own study only, never redistributed' } : {}),
          covers: (r.description ?? name).slice(0, 200),
          kind: 'course' as const,
          level: 'intermediate' as const,
          topics: (r.topics ?? []).map((t) => t.replace(/-/g, ' '))
        },
        updatedAt: Date.parse(r.pushed_at) || undefined,
        weight: r.stargazers_count
      }
    })
}

/** QuantEcon's lecture series: each <name>.notebooks repository, read with its book's _toc.yml */
export function quanteconFound(json: string): Found[] {
  let repos: GhRepo[] = []
  try {
    repos = JSON.parse(json) as GhRepo[]
  } catch {
    return []
  }
  if (!Array.isArray(repos)) return []
  return repos
    // Python series only (the Julia ones are read another way), and not the download bundles
    .filter((r) => /^QuantEcon\/lecture-[\w-]+\.notebooks$/i.test(r.full_name) && !r.archived && !/julia|wasm/i.test(`${r.full_name} ${r.description ?? ''}`))
    .map((r) => {
      const src = r.full_name.replace(/\.notebooks$/i, '')
      const name = src.split('/')[1].replace(/^lecture-/, '').replace(/^python-?/, '').replace(/[-.]/g, ' ').trim() || 'python'
      const about = (r.description ?? '').replace(/^(companion )?notebooks?( repository)? for (the )?/i, '').replace(/^lecture-[\w-]+$/i, '').trim()
      const pretty = name.length <= 4 ? name.toUpperCase() : name.replace(/\b\w/g, (x) => x.toUpperCase())
      return {
        course: {
          id: `quantecon-${slugify(name, 40)}`,
          source: 'jupyterbook' as const,
          repo: r.full_name,
          branch: r.default_branch,
          jbToc: `https://raw.githubusercontent.com/${src}/${r.default_branch}/lectures/_toc.yml`,
          title: `QuantEcon lectures: ${about && !/^lecture-/i.test(about) ? about : pretty}`,
          by: 'QuantEcon (Thomas J. Sargent and John Stachurski)',
          area: 'econ' as const,
          licence: 'CC-BY-SA-4.0',
          tier: 'open' as const,
          licenceNote: 'CC BY-SA 4.0, as each lecture site states',
          covers: r.description ?? `QuantEcon lectures: ${name}`,
          kind: 'course' as const,
          level: 'intermediate' as const,
          topics: ['quantitative economics', 'computational economics', 'python', name]
        },
        updatedAt: Date.parse(r.pushed_at) || undefined,
        weight: 1000
      }
    })
}

/** The best of each source, up to `per` from any one, best first overall */
export function diverse<T extends { found: Found; score: number }>(ranked: T[], per: number, max: number): T[] {
  const taken = new Map<string, number>()
  const out: T[] = []
  for (const r of ranked) {
    const s = r.found.course.source ?? 'github'
    if ((taken.get(s) ?? 0) >= per) continue
    taken.set(s, (taken.get(s) ?? 0) + 1)
    out.push(r)
    if (out.length >= max) break
  }
  return out
}

// ---------- The job ----------

export interface FreshResult {
  ran: boolean
  why?: string
  suggestions: Suggestion[]
  updates: string[]
  rankedBy?: 'claude' | 'score'
}

export async function runFreshCheck(deps: FreshDeps, opts: { force?: boolean } = {}): Promise<FreshResult> {
  const state = { ...emptyState(), ...(await deps.read()) }
  const now = deps.now()
  if (!opts.force && !checkDue(state.lastRun, now, deps.lessonRunning())) return { ran: false, why: deps.lessonRunning() ? 'A lesson is running' : 'Checked this week', suggestions: state.suggestions, updates: Object.keys(state.updates) }
  const log: CheckLog[] = []
  const note = (e: Omit<CheckLog, 'at'>) => log.push({ at: deps.now(), ...e })
  const ended: NonNullable<FreshState['lastSteps']> = []
  const step = (s: FreshStep, st: 'running' | 'done' | 'paused' | 'failed', d?: string) => {
    if (st === 'done' || st === 'failed') ended.push({ id: s, state: st, ...(d ? { detail: d } : {}) })
    deps.onStep?.(s, st, d)
  }

  /** Waits while a lesson runs: the check stays out of its way */
  const idle = async (s: FreshStep) => {
    const start = deps.now()
    let paused = false
    while (deps.lessonRunning()) {
      if (!paused) {
        paused = true
        step(s, 'paused', 'Waiting for your lesson to end')
        note({ what: s, result: 'paused', detail: 'A lesson is running' })
      }
      if (deps.now() - start > (deps.maxWaitMs ?? 3 * 3_600_000)) throw new Error('A lesson ran too long: the check will try again later')
      await deps.sleep(30_000)
    }
    if (paused) step(s, 'running')
  }
  const fetchText = async (what: string, url: string, headers?: Record<string, string>) => {
    try {
      const p = await deps.fetcher.page(url, headers ? { headers } : undefined)
      return p.text
    } catch (e) {
      note({ what, url, result: e instanceof SourceRefused && e.why !== 'unreachable' ? 'refused' : 'failed', detail: (e as Error).message })
      return null
    }
  }

  try {
    // 1. Your subjects
    step('subjects', 'running')
    const terms = await deps.terms()
    note({ what: 'subjects', result: 'ok', detail: terms.slice(0, 20).join(', ') })
    step('subjects', 'done', `${terms.length} subjects`)

    const found: Found[] = []
    const have = [...deps.catalogue(), ...state.adopted]

    // 2a. MIT OpenCourseWare: courses not seen before (on the first run, every course is new)
    await idle('ocw')
    step('ocw', 'running')
    const sitemap = await fetchText('ocw', 'https://ocw.mit.edu/sitemap.xml')
    if (sitemap) {
      const urls = ocwCourseUrls(sitemap)
      const seen = new Set(state.seenOcw ?? [])
      const fresh = urls.filter((u) => !seen.has(u))
      const ocwFoundList = fresh.map(ocwFound)
      found.push(...ocwFoundList)
      state.seenOcw = urls
      note({ what: 'ocw', url: 'https://ocw.mit.edu/sitemap.xml', result: 'ok', detail: `${urls.length} courses, ${fresh.length} not seen before` })
      step('ocw', 'done', `${fresh.length} new`)
    } else step('ocw', 'failed')

    // 2b. University channels' lecture playlists
    await idle('youtube')
    step('youtube', 'running')
    let lists = 0
    for (const ch of deps.channels ?? CHANNELS) {
      await idle('youtube')
      const html = await fetchText('youtube', `https://www.youtube.com/${ch}/playlists`, { Cookie: 'CONSENT=YES+1' })
      if (!html) continue
      const f = channelPlaylists(html, ch)
      lists += f.length
      found.push(...f)
      note({ what: 'youtube', url: `https://www.youtube.com/${ch}/playlists`, result: 'ok', detail: `${f.length} lecture series` })
    }
    step('youtube', 'done', `${lists} series`)

    // 2c. QuantEcon's lecture series
    await idle('quantecon')
    step('quantecon', 'running')
    const qe = await fetchText('quantecon', 'https://api.github.com/orgs/QuantEcon/repos?per_page=100&sort=pushed', { Accept: 'application/vnd.github+json' })
    if (qe) {
      const f = quanteconFound(qe)
      found.push(...f)
      note({ what: 'quantecon', url: 'https://api.github.com/orgs/QuantEcon/repos', result: 'ok', detail: `${f.length} lecture series` })
    }
    step('quantecon', qe ? 'done' : 'failed', qe ? `${quanteconFound(qe).length} series` : undefined)

    // 2d. GitHub's search, for your first few subjects (it allows ten searches a minute)
    await idle('github')
    step('github', 'running')
    const since = new Date(now - 365 * 86_400_000).toISOString().slice(0, 10)
    let gh = 0
    for (const t of terms.slice(0, 6)) {
      await idle('github')
      const q = encodeURIComponent(`${t} course in:name,description,topics stars:>=100 pushed:>=${since}`)
      const json = await fetchText('github', `https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=15`, { Accept: 'application/vnd.github+json' })
      if (!json) continue
      const f = githubFound(json)
      gh += f.length
      found.push(...f)
      note({ what: 'github', url: `https://api.github.com/search/repositories?q=${q}`, result: 'ok', detail: `${f.length} repositories for “${t}”` })
    }
    step('github', 'done', `${gh} repositories`)

    // 3. Your imported courses: did their source change?
    await idle('updates')
    step('updates', 'running')
    let changed = 0
    for (const { course: c, current } of await deps.imported()) {
      await idle('updates')
      try {
        let latest: string
        if (c.repo && (sourceOf(c) === 'github' || sourceOf(c) === 'jupyterbook')) {
          const json = await deps.fetcher.page(`https://api.github.com/repos/${c.repo}/commits/${encodeURIComponent(c.branch ?? 'HEAD')}`, { headers: { Accept: 'application/vnd.github.sha' } })
          latest = json.text.trim().match(/^[0-9a-f]{40}/)?.[0] ?? (JSON.parse(json.text) as { sha?: string }).sha ?? ''
        } else latest = await deps.probe(c)
        if (!latest) throw new Error('No version')
        const base = current ?? (state.baselines[c.id] ??= latest)
        if (latest !== base) {
          state.updates[c.id] = latest
          changed++
          note({ what: `update:${c.id}`, url: c.url ?? c.repo, result: 'changed', detail: `${c.title} changed at its source` })
        } else {
          delete state.updates[c.id]
          note({ what: `update:${c.id}`, url: c.url ?? c.repo, result: 'unchanged', detail: c.title })
        }
      } catch (e) {
        note({ what: `update:${c.id}`, url: c.url ?? c.repo, result: e instanceof SourceRefused && e.why !== 'unreachable' ? 'refused' : 'failed', detail: (e as Error).message })
      }
    }
    step('updates', 'done', changed ? `${changed} updated` : 'No changes')

    // 4. Ranking: what is suitable, scored; Claude ranks the best of them when it is there
    await idle('ranking')
    step('ranking', 'running')
    const suitable: Found[] = []
    const seenIds = new Set<string>()
    for (const f of found) {
      const why = unsuitable(f, have, state.dismissed)
      if (why || seenIds.has(f.course.id)) continue
      seenIds.add(f.course.id)
      suitable.push(f)
    }
    const scored = rankFound(suitable, terms, now)
    // The simple score picks a shortlist, a few from each kind of source so one (OCW's 2,500 courses) can't fill it; Claude (when there) reads it and chooses
    const shortlist = diverse(scored, 8, 30)
    let ranked: Suggestion[] = []
    let rankedBy: 'claude' | 'score' = 'score'
    const reply = shortlist.length
      ? await deps.rank(rankingPrompt(terms, shortlist.map((s) => s.found)), RANK_SYSTEM).catch((e) => {
          note({ what: 'ranking', result: 'failed', detail: `Claude: ${(e as Error).message}` })
          return null
        })
      : null
    const byClaude = reply ? readRanking(reply, shortlist.map((s) => s.found.course.id)) : []
    if (byClaude.length) {
      rankedBy = 'claude'
      ranked = byClaude.filter((r) => r.score >= 5).map((r) => ({ course: shortlist.find((s) => s.found.course.id === r.id)!.found.course, at: now, score: r.score, why: r.why || 'Chosen for your subjects', by: 'claude' as const }))
    } else ranked = shortlist.slice(0, 12).map((s) => ({ course: s.found.course, at: now, score: s.score, why: s.why, by: 'score' as const }))
    note({ what: 'ranking', result: 'ok', detail: `${found.length} found, ${suitable.length} suitable, ${ranked.length} suggested (${rankedBy === 'claude' ? 'ranked by Claude' : 'simple score'})` })
    step('ranking', 'done', `${ranked.length} suggested`)

    const imported = (await deps.imported()).map((x) => x.course.id)
    // Suggestions kept from earlier weeks must still pass today's rules
    const still = state.suggestions.filter((x) => !unsuitable({ course: x.course }, have.filter((h) => h.id !== x.course.id), state.dismissed))
    state.suggestions = keepSuggestions(still, ranked, { now, dismissed: state.dismissed, imported })
    state.lastRun = now
    state.rankedBy = rankedBy
    state.lastSteps = ended
    await deps.write(state)
    await deps.log(log)
    return { ran: true, suggestions: state.suggestions, updates: Object.keys(state.updates), rankedBy }
  } catch (e) {
    note({ what: 'check', result: 'failed', detail: (e as Error).message })
    await deps.write(state).catch(() => {})
    await deps.log(log).catch(() => {})
    return { ran: false, why: (e as Error).message, suggestions: state.suggestions, updates: Object.keys(state.updates) }
  }
}
