/**
 * Keeping the catalogue fresh: the subjects it searches, the simple ranking, what may be suggested,
 * the weekly schedule (never while a lesson runs), and the job itself on saved pages and fakes:
 * it suggests and never imports, ranks with Claude when Claude answers and by the simple score
 * when not, marks imported courses whose source changed, and logs every step.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { CATALOGUE, type CatalogueCourse } from '@shared/courseCatalogue'
import { FOCUS_SUBJECTS, WEEK, areaFor, checkDue, isNew, keepSuggestions, rankFound, readRanking, scoreFound, subjectTerms, unsuitable, type CheckLog, type Found } from '@shared/courseFresh'
import { politeFetcher } from '../src/main/courseSources/fetcher'
import { channelPlaylists, emptyState, githubFound, ocwCourseUrls, ocwFound, ocwSlugTitle, quanteconFound, runFreshCheck, type FreshDeps, type FreshState } from '../src/main/freshJob'

const FIX = join(__dirname, 'fixtures', 'sources')

const course = (o: Partial<CatalogueCourse> & { id: string }): CatalogueCourse => ({ title: o.id, by: 'x', area: 'payments', licence: 'MIT', tier: 'open', covers: '', kind: 'course', level: 'beginner', topics: [], ...o })

describe('your subjects', () => {
  it('starts from the focus subjects, then takes aims apart, then roadmaps and What you know, each once', () => {
    const t = subjectTerms({ aims: ['Get good at payment rails and ISO 20022, then stablecoins'], roadmaps: ['Core Banking', 'payments'], known: ['Value at risk'] })
    expect(t.slice(0, FOCUS_SUBJECTS.length)).toEqual(FOCUS_SUBJECTS)
    expect(t).toContain('iso 20022')
    expect(t).toContain('value at risk')
    expect(t.filter((x) => x === 'payments')).toHaveLength(1)
    expect(t).not.toContain('get good at payment rails')
  })
  it('puts a found course in its area from its words', () => {
    expect(areaFor('USDC stablecoin reserves')).toBe('blockchain')
    expect(areaFor('ISO 20022 payment messages')).toBe('payments')
    expect(areaFor('Option pricing and risk')).toBe('quant')
    expect(areaFor('Game theory')).toBe('econ')
  })
})

describe('the simple ranking (no Claude)', () => {
  const terms = subjectTerms({})
  const now = Date.UTC(2026, 10, 12)
  it('ranks by subject, then source quality, then recency', () => {
    const ocw: Found = { course: course({ id: 'a', source: 'ocw', title: 'Blockchain and Money', covers: 'stablecoins and payments', topics: ['blockchain'] }), updatedAt: now - 30 * 86_400_000 }
    const gh: Found = { course: course({ id: 'b', title: 'Payments course', covers: 'payments', topics: [] }), weight: 120, updatedAt: now - 900 * 86_400_000 }
    const off: Found = { course: course({ id: 'c', title: 'Pottery', covers: 'glazes and kilns' }), weight: 50000 }
    const r = rankFound([gh, off, ocw], terms, now)
    expect(r.map((x) => x.found.course.id)).toEqual(['a', 'b'])
    expect(scoreFound(off, terms, now).score).toBe(0)
    expect(r[0].why).toMatch(/blockchain|stablecoins|payments/)
  })
})

describe('what may be suggested', () => {
  const have = [course({ id: 'in', repo: 'a/b' })]
  it('only free courses, without a login, with a known licence, not already here, not dismissed', () => {
    expect(unsuitable({ course: course({ id: 'x', url: 'https://www.coursera.org/learn/payments' }) }, have, [])).toMatch(/login/)
    expect(unsuitable({ course: course({ id: 'x', url: 'https://x.org', licence: '' }) }, have, [])).toMatch(/licence/)
    expect(unsuitable({ course: course({ id: 'x', repo: 'A/B' }) }, have, [])).toMatch(/already/)
    expect(unsuitable({ course: course({ id: 'gone', url: 'https://x.org' }) }, have, ['gone'])).toBe('dismissed')
    expect(unsuitable({ course: course({ id: 'x', url: 'https://x.org', licence: 'CC BY-NC 4.0', tier: 'open' }) }, have, [])).toMatch(/open/)
    expect(unsuitable({ course: course({ id: 'ok', url: 'https://x.org' }) }, have, [])).toBeNull()
  })
  it('reads Claude’s ranking, only for the courses it was given', () => {
    expect(readRanking('Here: [{"id":"a","score":8,"why":"Teaches ISO 20022"},{"id":"zz","score":9}]', ['a', 'b'])).toEqual([{ id: 'a', score: 8, why: 'Teaches ISO 20022' }])
    expect(readRanking('no json', ['a'])).toEqual([])
  })
})

describe('the schedule', () => {
  const now = Date.UTC(2026, 10, 12)
  it('runs once a week, never while a lesson runs', () => {
    expect(checkDue(undefined, now, false)).toBe(true)
    expect(checkDue(now - 3 * 86_400_000, now, false)).toBe(false)
    expect(checkDue(now - WEEK, now, false)).toBe(true)
    expect(checkDue(now - 2 * WEEK, now, true)).toBe(false)
  })
  it('keeps suggestions four weeks, without what you dismissed or imported; new this week is the last seven days', () => {
    const s = (id: string, at: number) => ({ course: course({ id }), at, score: 6, why: '', by: 'score' as const })
    const kept = keepSuggestions([s('old', now - 5 * WEEK), s('a', now - 2 * WEEK)], [s('a', now), s('b', now), s('c', now)], { now, dismissed: ['b'], imported: ['c'] })
    expect(kept.map((k) => k.course.id)).toEqual(['a'])
    // A course found again keeps the date it was first suggested
    expect(kept[0].at).toBe(now - 2 * WEEK)
    expect(isNew(kept[0], now)).toBe(false)
    expect(isNew(s('x', now - 86_400_000), now)).toBe(true)
  })
})

describe('reading the sources', () => {
  it('reads OCW’s sitemap and names a course from its address', () => {
    const urls = ocwCourseUrls('<sitemapindex><sitemap><loc>https://ocw.mit.edu/sitemap-www.xml</loc></sitemap><sitemap><loc>https://ocw.mit.edu/courses/15-401-finance-theory-i-fall-2008/sitemap.xml</loc></sitemap></sitemapindex>')
    expect(urls).toEqual(['https://ocw.mit.edu/courses/15-401-finance-theory-i-fall-2008/'])
    expect(ocwSlugTitle('15-401-finance-theory-i-fall-2008')).toEqual({ number: '15.401', title: 'Finance Theory I', term: 'Fall 2008' })
    expect(ocwSlugTitle('14-129-blockchain-and-the-design-of-financial-systems-spring-2025').title).toBe('Blockchain and the Design of Financial Systems')
    const f = ocwFound(urls[0])
    expect(f.course).toMatchObject({ source: 'ocw', tier: 'personal', licence: 'CC BY-NC-SA 4.0', area: 'quant' })
  })
  it('reads a channel’s lecture playlists (ten videos or more)', () => {
    const f = channelPlaylists(readFileSync(join(FIX, 'youtube-channel-playlists.html'), 'utf8'), '@mitocw')
    expect(f.length).toBeGreaterThan(5)
    const fin = f.find((x) => x.course.title.includes('18.642'))!
    expect(fin.course).toMatchObject({ source: 'youtube', playlist: 'PLUl4u3cNGP601Q2jo-J_3raNCMMs6Jves', tier: 'personal' })
    expect(f.every((x) => (x.weight ?? 0) >= 10)).toBe(true)
  })
  it('reads GitHub’s search with each licence, and QuantEcon’s lecture series', () => {
    const gh = githubFound(JSON.stringify({ items: [{ full_name: 'pay/iso20022-course', default_branch: 'main', description: 'ISO 20022 payments course', stargazers_count: 400, pushed_at: '2026-10-01T00:00:00Z', license: { spdx_id: 'MIT' }, topics: ['payments'], owner: { login: 'pay' } }, { full_name: 'x/fork', default_branch: 'main', description: '', stargazers_count: 1, pushed_at: '2026-10-01T00:00:00Z', license: null, owner: { login: 'x' }, fork: true }] }))
    expect(gh).toHaveLength(1)
    expect(gh[0].course).toMatchObject({ repo: 'pay/iso20022-course', tier: 'open', area: 'payments' })
    const qe = quanteconFound(JSON.stringify([{ full_name: 'QuantEcon/lecture-dp.notebooks', default_branch: 'main', description: 'Dynamic programming', stargazers_count: 3, pushed_at: '2026-11-01T00:00:00Z', license: null, owner: { login: 'QuantEcon' } }, { full_name: 'QuantEcon/QuantEcon.py', default_branch: 'main', description: '', stargazers_count: 3, pushed_at: '2026-11-01T00:00:00Z', license: null, owner: { login: 'QuantEcon' } }]))
    expect(qe).toHaveLength(1)
    expect(qe[0].course).toMatchObject({ source: 'jupyterbook', tier: 'open', jbToc: 'https://raw.githubusercontent.com/QuantEcon/lecture-dp/main/lectures/_toc.yml' })
  })
})

// ---------- The job ----------

const SITEMAP = '<sitemapindex><sitemap><loc>https://ocw.mit.edu/courses/15-999-stablecoins-and-payment-systems-fall-2026/sitemap.xml</loc></sitemap><sitemap><loc>https://ocw.mit.edu/courses/21-001-pottery-spring-2020/sitemap.xml</loc></sitemap></sitemapindex>'

function harness(o: { rank?: FreshDeps['rank']; busy?: boolean[]; imported?: { course: CatalogueCourse; current?: string }[]; probe?: string; state?: Partial<FreshState> } = {}) {
  let state: FreshState = { ...emptyState(), ...(o.state ?? {}) }
  const logs: CheckLog[] = []
  const sleeps: number[] = []
  const steps: string[] = []
  const busy = [...(o.busy ?? [])]
  let now = Date.UTC(2026, 10, 12)
  const pages: Record<string, string> = {
    'https://ocw.mit.edu/sitemap.xml': SITEMAP,
    'https://www.youtube.com/@mitocw/playlists': readFileSync(join(FIX, 'youtube-channel-playlists.html'), 'utf8'),
    'https://api.github.com/orgs/QuantEcon/repos?per_page=100&sort=pushed': JSON.stringify([{ full_name: 'QuantEcon/lecture-finance.notebooks', default_branch: 'main', description: 'Quantitative finance lectures', stargazers_count: 3, pushed_at: '2026-11-01T00:00:00Z', license: null, owner: { login: 'QuantEcon' } }]),
    'https://api.github.com/repos/someone/old-course/commits/main': 'b'.repeat(40)
  }
  const fetchImpl = async (url: string) => {
    const hit = pages[url] ?? (url.startsWith('https://api.github.com/search/repositories') ? JSON.stringify({ items: [] }) : undefined)
    const r = new Response(hit ?? 'missing', { status: hit === undefined ? 404 : 200, headers: { 'content-type': url.includes('api.github') ? 'application/json' : 'text/html' } })
    Object.defineProperty(r, 'url', { value: url })
    return r
  }
  let imports = 0
  const deps: FreshDeps = {
    fetcher: politeFetcher({ fetchImpl, sleep: async () => {}, gapMs: 0 }),
    now: () => now,
    lessonRunning: () => (busy.length ? busy.shift()! : false),
    sleep: async (ms) => {
      sleeps.push(ms)
      now += ms
    },
    terms: async () => subjectTerms({ aims: ['stablecoins and payment systems'] }),
    catalogue: () => CATALOGUE,
    imported: async () => o.imported ?? [],
    probe: async () => o.probe ?? 'v1',
    rank: o.rank ?? (async () => null),
    read: async () => state,
    write: async (s) => void (state = JSON.parse(JSON.stringify(s))),
    log: async (e) => void logs.push(...e),
    onStep: (s, st) => void steps.push(`${s}:${st}`),
    channels: ['@mitocw']
  }
  return { deps, get state() { return state }, logs, sleeps, steps, imports: () => imports }
}

describe('the weekly check', () => {
  it('without Claude: finds, ranks by the simple score, suggests, and imports nothing', async () => {
    const h = harness()
    const r = await runFreshCheck(h.deps)
    expect(r.ran).toBe(true)
    expect(r.rankedBy).toBe('score')
    const ids = h.state.suggestions.map((s) => s.course.id)
    expect(ids).toContain('ocw-15-999-stablecoins-and-payment-systems-fall-2026')
    expect(ids.some((i) => i.includes('pottery'))).toBe(false)
    expect(h.state.suggestions.every((s) => s.by === 'score' && s.why)).toBe(true)
    // Suggestions only: nothing adopted, nothing written as imported
    expect(h.state.adopted).toEqual([])
    expect(h.logs.some((l) => l.what === 'ranking' && /simple score/.test(l.detail ?? ''))).toBe(true)
    expect(h.logs.some((l) => l.what === 'ocw' && l.result === 'ok')).toBe(true)
    expect(h.state.lastRun).toBeTruthy()
    // It doesn't run again within the week
    expect((await runFreshCheck(h.deps)).ran).toBe(false)
  })
  it('with Claude: Claude’s ranking and reasons are used', async () => {
    let prompt = ''
    const h = harness({
      rank: async (p) => {
        prompt = p
        return '[{"id":"ocw-15-999-stablecoins-and-payment-systems-fall-2026","score":9,"why":"A whole course on stablecoins as payment systems"}]'
      }
    })
    const r = await runFreshCheck(h.deps)
    expect(r.rankedBy).toBe('claude')
    expect(prompt).toContain('stablecoins')
    expect(h.state.suggestions).toHaveLength(1)
    expect(h.state.suggestions[0]).toMatchObject({ by: 'claude', score: 9, why: 'A whole course on stablecoins as payment systems' })
  })
  it('falls back to the simple score when Claude fails', async () => {
    const h = harness({ rank: async () => Promise.reject(new Error('usage limit')) })
    const r = await runFreshCheck(h.deps)
    expect(r.rankedBy).toBe('score')
    expect(h.logs.some((l) => l.what === 'ranking' && l.result === 'failed')).toBe(true)
  })
  it('waits while a lesson runs, then carries on', async () => {
    const h = harness({ busy: [false, true, true, false] })
    const r = await runFreshCheck(h.deps, { force: true })
    expect(r.ran).toBe(true)
    expect(h.sleeps.length).toBeGreaterThanOrEqual(1)
    expect(h.steps.some((s) => s.endsWith(':paused'))).toBe(true)
    expect(h.logs.some((l) => l.result === 'paused')).toBe(true)
  })
  it('doesn’t start while a lesson runs (unless asked)', async () => {
    const h = harness({ busy: [true, true] })
    expect((await runFreshCheck(h.deps)).ran).toBe(false)
  })
  it('marks an imported course whose source changed, and leaves an unchanged one', async () => {
    const gh = course({ id: 'old-course', repo: 'someone/old-course', branch: 'main' })
    const web = course({ id: 'web', source: 'ocw', url: 'https://ocw.mit.edu/courses/x/' })
    const h = harness({ imported: [{ course: gh, current: 'a'.repeat(40) }, { course: web, current: 'v1' }], probe: 'v1' })
    const r = await runFreshCheck(h.deps)
    expect(r.updates).toEqual(['old-course'])
    expect(h.state.updates['old-course']).toBe('b'.repeat(40))
    expect(h.logs.find((l) => l.what === 'update:web')?.result).toBe('unchanged')
  })
  it('never suggests what you dismissed, and lets OCW’s already-seen courses be', async () => {
    const h = harness({ state: { dismissed: ['ocw-15-999-stablecoins-and-payment-systems-fall-2026'] } })
    await runFreshCheck(h.deps)
    expect(h.state.suggestions.some((s) => s.course.id.startsWith('ocw-15-999'))).toBe(false)
    expect(h.state.seenOcw).toHaveLength(2)
    const again = harness({ state: { seenOcw: h.state.seenOcw } })
    await runFreshCheck(again.deps)
    expect(again.logs.find((l) => l.what === 'ocw')?.detail).toMatch(/0 not seen before/)
  })
})
