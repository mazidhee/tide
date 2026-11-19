/**
 * Interview targets (docs/plans/interview-target.md, shared/interviewTarget). This side reads a
 * target's files from the vault, keeps its progress in .tide/interview/<slug>.json, gathers what
 * the target's sources and links say into a cached context, and runs the Claude jobs: marking a
 * drill, an interviewer's follow-up, and writing stories, model answers and cards from the
 * learner's own facts. Every write to the vault adds to a file, after a backup of it in
 * .tide/backups/. Without Claude, drills are marked in code and cards come from the files.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import matter from 'gray-matter'
import {
  CARDS_PER_DAY,
  CRITERIA,
  TARGETS_FOLDER,
  cardsAddedOn,
  cardsFileStart,
  cardsFromFiles,
  cardsHeading,

  emptyProgress,
  lenientFrontMatter,
  markInCode,
  overallReadiness,
  parseAskThem,
  parseFirm,
  parseFrameworks,
  parseMarks,
  parsePresentation,
  parseQuestions,
  parseScenarios,
  parseStories,
  parseTarget,
  progressOf,
  readiness,
  slugOf,
  targetMarkdown,
  withModelAnswer,
  type Attempt,
  type ClarifyRequest,
  type CourseState,
  type GatheredContext,
  type GatheredItem,
  type GenerateResult,
  type GenerateWhat,
  type MarkInput,
  type MarkResult,
  type NewTarget,
  type ProbeRequest,
  type Progress,
  type TargetBundle,
  type TargetCards,
  type TargetFiles,
  type TargetSummary
} from '@shared/interviewTarget'
import { HUMAN_FEEDBACK, HUMAN_WRITING, aiTells, naturalness } from '@shared/humanWriting'
import { cardsToMarkdown } from '@shared/cards'
import { absPath, readText, sanitizeName, writeText } from './vault'
import { withUsage } from './usageLog'

// ---------- Claude, and a stand-in for tests ----------

export interface InterviewModels {
  ready(): Promise<boolean>
  once(prompt: string, system: string, role: 'mark' | 'teach', job: string, signal: AbortSignal): Promise<string>
}

const realModels: InterviewModels = {
  async ready() {
    if (process.env.TIDE_INTERVIEW_NO_CLAUDE) return false
    const { claudeReady } = await import('./claudeEngine')
    return (await claudeReady().catch(() => ({ ready: false }))).ready
  },
  async once(prompt, system, role, job, signal) {
    const { claudeOnce } = await import('./claudeEngine')
    return withUsage({ job }, async () => (await claudeOnce(prompt, system, role, signal, undefined, [], job)).text)
  }
}

let models: InterviewModels = realModels
export const setInterviewModels = (m: InterviewModels | null) => (models = m ?? realModels)

const progress = (slug: string, step: string) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('interview:progress', { slug, step })
}

// ---------- Reading a target ----------

const FILES = { stories: 'stories.md', questions: 'questions.md', scenarios: 'scenarios.md', presentation: 'presentation.md', firm: 'firm.md', ask: 'ask-them.md', frameworks: 'frameworks.md' } as const
const progressPath = (slug: string) => `.tide/interview/${slug}.json`
const contextPath = (slug: string) => `.tide/interview/${slug}.context.json`

/** Each target's folder by slug: every "Interview prep/<name>/" with a target.md */
async function folders(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const names = await fs.readdir(absPath(TARGETS_FOLDER), { withFileTypes: true }).catch(() => [])
  for (const d of names) if (d.isDirectory() && existsSync(absPath(`${TARGETS_FOLDER}/${d.name}/target.md`))) out.set(slugOf(d.name), `${TARGETS_FOLDER}/${d.name}`)
  return out
}

async function folderOf(slug: string): Promise<string> {
  const f = (await folders()).get(slug)
  if (!f) throw new Error('That interview target isn’t in your vault any more.')
  return f
}

const readOr = (rel: string) => readText(rel).catch(() => '')

async function readFiles(folder: string): Promise<{ files: TargetFiles; has: TargetBundle['has'] }> {
  const raw = await readText(`${folder}/target.md`)
  let data: Record<string, unknown> = {}
  let body = raw
  try {
    const m = matter(raw)
    data = m.data
    body = m.content
  } catch {
    // YAML that doesn't parse (an unquoted ": " in a note, say): read it line by line instead
    const l = lenientFrontMatter(raw)
    data = l.data
    body = l.body
  }
  const text = Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([k, f]) => [k, await readOr(`${folder}/${f}`)] as const))) as Record<keyof typeof FILES, string>
  const files: TargetFiles = {
    meta: parseTarget(data, body, folder, raw),
    stories: parseStories(text.stories),
    questions: parseQuestions(text.questions),
    scenarios: parseScenarios(text.scenarios),
    presentation: text.presentation.trim() ? parsePresentation(text.presentation) : null,
    firm: parseFirm(text.firm),
    ask: parseAskThem(text.ask),
    frameworks: parseFrameworks(text.frameworks)
  }
  const has = Object.fromEntries(Object.entries(text).map(([k, v]) => [k, !!v.trim()])) as TargetBundle['has']
  return { files, has }
}

async function readProgress(slug: string): Promise<Progress> {
  try {
    return progressOf(slug, JSON.parse(await readText(progressPath(slug))))
  } catch {
    return emptyProgress(slug)
  }
}

async function readContext(slug: string): Promise<(GatheredContext & { texts?: string[] }) | null> {
  try {
    return JSON.parse(await readText(contextPath(slug)))
  } catch {
    return null
  }
}

async function cardsOf(folder: string): Promise<TargetCards> {
  const path = `${folder}/cards.md`
  const exists = existsSync(absPath(path))
  const empty: TargetCards = { path, exists, total: 0, due: 0, remembered: 0, dues: [], reviewedToday: [], addedToday: false }
  if (!exists) return empty
  const { getCards } = await import('./study')
  const cards = await getCards({ kind: 'note', path }).catch(() => [])
  const now = Date.now()
  const dues = cards.map((c) => c.schedule?.due ?? null)
  const start = new Date(new Date(now).toDateString()).getTime()
  const reviewedToday: number[] = []
  try {
    for (const line of (await readText('.tide/reviews.jsonl')).split('\n'))
      if (line.includes(path)) {
        const r = JSON.parse(line) as { at: number; path: string }
        if (r.path === path && r.at >= start) reviewedToday.push(r.at)
      }
  } catch {
    // no reviews yet
  }
  return {
    ...empty,
    total: cards.length,
    due: dues.filter((d) => d === null || d <= now).length,
    remembered: dues.filter((d) => d !== null && d > now).length,
    dues,
    reviewedToday,
    addedToday: cardsAddedOn(await readOr(path), now)
  }
}

/** The course the target names (a track of modules), with each module's progress and next topic */
async function courseOf(track: string | undefined): Promise<CourseState | null> {
  if (!track) return null
  try {
    const { loadCatalogue, moduleState, planOrder } = await import('./modules')
    const { moduleTopics } = await import('@shared/modules')
    const cat = await loadCatalogue()
    const t = cat?.tracks.find((x) => x.id === track)
    if (!cat || !t) return { track, title: track, modules: [] }
    const { getNotebooks } = await import('./learn')
    const nb = (await getNotebooks().catch(() => [])).find((n) => n.track === track)
    const gates = await moduleState().catch(() => null)
    return {
      track,
      title: t.title,
      ...(nb ? { notebook: nb.path } : {}),
      modules: planOrder(cat, t).map((m) => {
        const g = gates?.get(m.id)
        const next = moduleTopics(m, nb?.name).find((x) => !x.checked && !x.project)?.title
        return {
          id: m.id,
          title: m.title,
          status: g?.status ?? 'open',
          solid: g?.solid ?? 0,
          total: g?.total ?? moduleTopics(m).length,
          parts: { passed: g ? g.parts.gates.filter((p) => p.passed).length : 0, of: g ? g.parts.gates.length : 0 },
          ...(next ? { next } : {})
        }
      })
    }
  } catch (e) {
    console.warn('[interview] course', (e as Error).message)
    return { track, title: track, modules: [] }
  }
}

export async function listTargets(): Promise<TargetSummary[]> {
  const out: TargetSummary[] = []
  for (const [slug, folder] of await folders()) {
    try {
      const { files } = await readFiles(folder)
      const p = await readProgress(slug)
      out.push({ slug, name: files.meta.name, company: files.meta.company, role: files.meta.role, ...(files.meta.date ? { date: files.meta.date } : {}), ...(files.meta.timezone ? { timezone: files.meta.timezone } : {}), readiness: overallReadiness(readiness(files, p, null)) })
    } catch (e) {
      console.warn('[interview] list', folder, (e as Error).message)
    }
  }
  return out.sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9'))
}

export async function getTarget(slug: string): Promise<TargetBundle | null> {
  const folder = (await folders()).get(slug)
  if (!folder) return null
  const { files, has } = await readFiles(folder)
  const [prog, cards, context, course, claude] = await Promise.all([readProgress(slug), cardsOf(folder), readContext(slug), courseOf(files.meta.course), models.ready()])
  return { files, has, progress: prog, cards, context: context ? { at: context.at, items: context.items, errors: context.errors } : null, course, claude }
}

export async function createTarget(t: NewTarget): Promise<{ slug: string; folder: string }> {
  const company = t.company.trim()
  if (!company) throw new Error('Name the company.')
  const name = sanitizeName(`${company}${t.role.trim() ? ` ${t.role.trim()}` : ''}`).slice(0, 80)
  let folder = `${TARGETS_FOLDER}/${name}`
  for (let i = 2; existsSync(absPath(folder)); i++) folder = `${TARGETS_FOLDER}/${name} ${i}`
  await writeText(`${folder}/target.md`, targetMarkdown({ ...t, company, role: t.role.trim(), sources: t.sources.map((s) => s.trim()).filter(Boolean), links: t.links.map((s) => s.trim()).filter(Boolean) }))
  return { slug: slugOf(folder.split('/').pop()!), folder }
}

export async function saveAttempt(slug: string, a: Attempt): Promise<Progress> {
  const p = await readProgress(slug)
  p.attempts.push({ ...a, at: a.at || Date.now() })
  await writeText(progressPath(slug), JSON.stringify(p, null, 1))
  return p
}

// ---------- Gather ----------

const MAX_ITEM = 12_000
const MAX_FILES = 40
const DOC_EXT = new Set(['.pdf', '.docx', '.pptx', '.md', '.txt'])

/** A document's text: PDF (PDFium), Word (mammoth), PowerPoint (its slides' text runs), Markdown and plain text */
export async function documentText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') {
    const { pdfiumText } = await import('./pdftext')
    const r = await pdfiumText(path, 60)
    return r ? r.pages.join('\n\n') : ''
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default
    return (await mammoth.extractRawText({ path })).value
  }
  if (ext === '.pptx') {
    const { openZip } = await import('./zip')
    const zip = openZip(await fs.readFile(path))
    const slides = zip
      .names()
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    return slides
      .map((n, i) => {
        const xml = zip.text(n) ?? ''
        const paras = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('')).filter(Boolean)
        return `Slide ${i + 1}\n${paras.map(unescapeXml).join('\n')}`
      })
      .join('\n\n')
  }
  return fs.readFile(path, 'utf8')
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

async function docsIn(path: string, depth = 0): Promise<string[]> {
  const st = await fs.stat(path).catch(() => null)
  if (!st) return []
  if (st.isFile()) return DOC_EXT.has(extname(path).toLowerCase()) ? [path] : []
  if (!st.isDirectory() || depth > 2) return []
  const out: string[] = []
  for (const d of await fs.readdir(path, { withFileTypes: true }).catch(() => [])) {
    if (d.name.startsWith('.') || d.name === 'node_modules') continue
    out.push(...(await docsIn(join(path, d.name), depth + 1)))
    if (out.length >= MAX_FILES) break
  }
  return out
}

const GH = { 'User-Agent': 'Tide', Accept: 'application/vnd.github+json' }

/** A GitHub link: a repo's description and README, or a profile's recent repos */
async function github(url: string): Promise<{ title: string; text: string } | null> {
  const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)(?:\/([\w.-]+))?/i)
  if (!m) return null
  const get = async (p: string, raw = false) => {
    const r = await fetch(`https://api.github.com${p}`, { headers: raw ? { ...GH, Accept: 'application/vnd.github.raw' } : GH, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) throw new Error(`GitHub said ${r.status} for ${p}`)
    return raw ? r.text() : r.json()
  }
  const repo = async (owner: string, name: string) => {
    const info = (await get(`/repos/${owner}/${name.replace(/\.git$/, '')}`)) as { full_name: string; description?: string; language?: string; topics?: string[]; stargazers_count?: number; pushed_at?: string }
    const readme = await get(`/repos/${owner}/${name.replace(/\.git$/, '')}/readme`, true).catch(() => '')
    return `Repository ${info.full_name}${info.description ? `: ${info.description}` : ''}\nLanguage: ${info.language ?? 'unknown'}${info.topics?.length ? `; topics: ${info.topics.join(', ')}` : ''}; last pushed ${info.pushed_at?.slice(0, 10) ?? '?'}\n\nREADME:\n${String(readme).slice(0, 8000)}`
  }
  if (m[2]) return { title: `${m[1]}/${m[2]}`, text: await repo(m[1], m[2]) }
  const repos = (await get(`/users/${m[1]}/repos?sort=pushed&per_page=8`)) as { name: string; fork: boolean; description?: string }[]
  const own = repos.filter((r) => !r.fork).slice(0, 4)
  const texts = await Promise.all(own.map((r) => repo(m[1], r.name).catch(() => `Repository ${m[1]}/${r.name}: ${r.description ?? ''}`)))
  return { title: `${m[1]} on GitHub`, text: `Recent repositories:\n${repos.map((r) => `- ${r.name}${r.description ? `: ${r.description}` : ''}`).join('\n')}\n\n${texts.join('\n\n---\n\n')}` }
}

/**
 * Gather: every source file and link the target names, read into text and cached, so the writing
 * jobs work from the learner's own material without reading it all again.
 */
export async function gather(slug: string): Promise<GatheredContext> {
  const folder = await folderOf(slug)
  const { files } = await readFiles(folder)
  const items: GatheredItem[] = []
  const texts: string[] = []
  const errors: string[] = []
  const paths = (await Promise.all(files.meta.sources.map((s) => docsIn(s.replace(/^~(?=\/)/, process.env.HOME ?? '~'))))).flat().slice(0, MAX_FILES)
  for (const s of files.meta.sources) if (!existsSync(s.replace(/^~(?=\/)/, process.env.HOME ?? '~'))) errors.push(`Not found: ${s}`)
  for (const p of paths) {
    progress(slug, `Reading ${basename(p)}`)
    try {
      const text = (await documentText(p)).replace(/\n{3,}/g, '\n\n').trim()
      if (!text) {
        errors.push(`No text in ${basename(p)}`)
        continue
      }
      items.push({ kind: 'file', title: basename(p), ref: p, chars: text.length })
      texts.push(text.slice(0, MAX_ITEM))
    } catch (e) {
      errors.push(`${basename(p)}: ${(e as Error).message.slice(0, 120)}`)
    }
  }
  for (const url of files.meta.links) {
    progress(slug, `Reading ${url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}`)
    try {
      const gh = await github(url)
      if (gh) {
        items.push({ kind: 'repo', title: gh.title, ref: url, chars: gh.text.length })
        texts.push(gh.text.slice(0, MAX_ITEM))
        continue
      }
      const { readWebpage } = await import('./agent')
      const page = await readWebpage(url)
      if (!page.text.trim()) throw new Error('nothing readable')
      items.push({ kind: 'page', title: page.title || url, ref: url, chars: page.text.length })
      texts.push(page.text.slice(0, MAX_ITEM))
    } catch (e) {
      errors.push(`${url}: ${(e as Error).message.slice(0, 120)}`)
    }
  }
  const ctx = { at: Date.now(), items, errors, texts }
  await writeText(contextPath(slug), JSON.stringify(ctx))
  progress(slug, '')
  return { at: ctx.at, items, errors }
}

/** The gathered sources as one block for a prompt */
async function contextText(slug: string, max = 60_000): Promise<string> {
  const ctx = await readContext(slug)
  if (!ctx?.texts?.length) return ''
  let out = ''
  ctx.items.forEach((it, i) => {
    const block = `=== ${it.kind === 'file' ? 'File' : it.kind === 'repo' ? 'GitHub' : 'Page'}: ${it.title} (${it.ref})\n${ctx.texts![i] ?? ''}\n\n`
    if (out.length + block.length <= max) out += block
  })
  return out
}

// ---------- Writing to the vault, additively ----------

async function backup(slug: string, rel: string): Promise<string | undefined> {
  if (!existsSync(absPath(rel))) return undefined
  const dir = `.tide/backups/interview-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await fs.mkdir(absPath(dir), { recursive: true })
  await fs.copyFile(absPath(rel), absPath(`${dir}/${basename(rel)}`))
  return dir
}

const NO_INVENTING = `Use only facts in the material below: the learner's CV, their notes and the target's files. Never invent a figure, date, employer, tool, name or outcome. Where a detail is missing, write PRACTICE VERSION: <what the learner must supply> in its place, or list it under Gaps.`

/** Fill stories.md from the CV: new stories only, after the ones already there */
async function writeStories(slug: string, folder: string, files: TargetFiles): Promise<GenerateResult> {
  const ctx = await contextText(slug)
  if (!ctx) throw new Error('Gather the sources first: stories are written from your CV.')
  const path = `${folder}/stories.md`
  const existing = await readOr(path)
  const ids = files.stories.map((s) => s.id)
  const system = `You build a candidate's story bank for interviews, from their own CV and notes. ${NO_INVENTING}\n\n${HUMAN_WRITING}`
  const prompt = `Target: ${files.meta.company}, ${files.meta.role}.
${files.stories.length ? `Stories already in the bank (don't repeat them): ${files.stories.map((s) => `${s.id}. ${s.title}`).join('; ')}.` : ''}
Write up to 8 new stories, one per distinct experience on the CV (job, project, role, achievement). Use ids that don't clash with: ${ids.join(', ') || 'none'} (S1, S2…).
Output ONLY Markdown in exactly this shape for each story, nothing before or after:

## S<n>. <Short plain title>
- Best for: <interview themes, comma-separated>
- Evidence:
  - <a fact from the CV or notes, as written there>
- Anchors: <5 to 7 short words or numbers that bring the story back, comma-separated>
- Gaps: <details an interviewer will ask that the material doesn't give, separated by semicolons; "none" if none>

Material:
${ctx}`
  progress(slug, 'Writing stories from your CV')
  const out = await models.once(prompt, system, 'teach', 'interviewWrite', AbortSignal.timeout(240_000))
  const fresh = parseStories(out).filter((s) => !ids.includes(s.id) && s.evidence.length)
  if (!fresh.length) throw new Error('Claude didn’t write any stories that could be read. Try again.')
  const blocks = out
    .replace(/\r\n/g, '\n')
    .split(/^(?=## )/m)
    .filter((b) => b.startsWith('## ') && fresh.some((s) => b.startsWith(`## ${s.id}.`)))
    .map((b) => b.trim())
  const b = await backup(slug, path)
  await writeText(path, (existing.trim() ? existing.trimEnd() + '\n\n' : '# Story bank\n\n') + blocks.join('\n\n') + '\n')
  progress(slug, '')
  return { path, added: blocks.length, ...(b ? { backup: b } : {}), by: 'claude' }
}

/** Model answers for questions with none, from their outline, stories and the CV */
async function writeAnswers(slug: string, folder: string, files: TargetFiles): Promise<GenerateResult> {
  const path = `${folder}/questions.md`
  const todo = files.questions.filter((q) => !q.model).slice(0, 8)
  if (!todo.length) return { path, added: 0, by: 'claude', note: 'Every question has a model answer.' }
  const ctx = await contextText(slug, 30_000)
  const storyText = (ids: string[]) =>
    files.stories
      .filter((s) => ids.includes(s.id))
      .map((s) => `${s.id}. ${s.title}\nEvidence: ${s.evidence.join('; ')}\nGaps: ${s.gaps.join('; ') || 'none'}`)
      .join('\n')
  const system = `You write model interview answers in the candidate's own voice, to be said aloud in about two minutes (250 to 330 words; motivation and closing answers shorter). ${NO_INVENTING}\n\n${HUMAN_WRITING}\nReply with JSON only: {"<question id>": "<answer>", ...}.`
  const prompt = `Target: ${files.meta.company}, ${files.meta.role}.

Questions:
${todo.map((q) => `[${q.id}] ${q.text}\nKind: ${q.kind}${q.route.length ? `\nRoute to follow: ${q.route.join(' → ')}` : ''}${q.outline.length ? `\nThe learner's outline: ${q.outline.join('; ')}` : ''}${q.stories.length ? `\nStories:\n${storyText(q.stories)}` : ''}`).join('\n\n')}

${ctx ? `The learner's material:\n${ctx}` : 'No other material was gathered: use only the outlines and stories above.'}`
  progress(slug, `Writing ${todo.length} model answer${todo.length === 1 ? '' : 's'}`)
  const out = await models.once(prompt, system, 'teach', 'interviewWrite', AbortSignal.timeout(300_000))
  let answers: Record<string, string> = {}
  try {
    answers = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
  } catch {
    throw new Error('Claude’s answers couldn’t be read. Try again.')
  }
  let raw = await readOr(path)
  const before = raw
  let added = 0
  const tells: string[] = []
  for (const q of todo) {
    const a = String(answers[q.id] ?? '').trim()
    if (!a) continue
    const next = withModelAnswer(raw, q.id, a)
    if (next !== raw) {
      added++
      raw = next
      tells.push(...aiTells(a).map((t) => t.phrase))
    }
  }
  if (!added) throw new Error('None of the answers matched a question. Try again.')
  const b = await backup(slug, path)
  if ((await readOr(path)) !== before) throw new Error('questions.md changed while the answers were being written. Try again.')
  await writeText(path, raw)
  progress(slug, '')
  return { path, added, ...(b ? { backup: b } : {}), by: 'claude', ...(tells.length ? { note: `Check these phrases: ${[...new Set(tells)].slice(0, 5).join(', ')}` } : {}) }
}

/**
 * Today's cards: from what was taught today (lessons on the target's notes or its course) and the
 * target's facts, ten at most, under today's heading. Without Claude, from the files alone.
 */
async function writeCards(slug: string, folder: string, files: TargetFiles, course: CourseState | null): Promise<GenerateResult> {
  const path = `${folder}/cards.md`
  const now = Date.now()
  const existing = existsSync(absPath(path)) ? await readOr(path) : ''
  if (existing && cardsAddedOn(existing, now)) return { path, added: 0, by: 'code', note: 'Today’s cards are in already.' }
  const { parseFlashcards } = await import('./study')
  const have = new Set(parseFlashcards(path, existing).map((c) => c.front))
  const { listLessons, getLesson } = await import('./lessons')
  const since = now - 36 * 3_600_000
  const lessons = (await listLessons().catch(() => []))
    .filter((l) => l.updated >= since && l.mode === 'teach')
    .filter((l) => {
      const p = l.scope.kind === 'note' || l.scope.kind === 'folder' || l.scope.kind === 'pages' ? l.scope.path : ''
      return p.startsWith(folder) || (!!course?.notebook && p.startsWith(course.notebook))
    })
    .slice(0, 4)
  let cards: { front: string; back: string }[] = []
  let by: 'claude' | 'code' = 'code'
  if (await models.ready()) {
    const taught = (
      await Promise.all(
        lessons.map(async (l) => {
          const r = await getLesson(l.id).catch(() => null)
          return r ? `Lesson: ${r.topic}\n${r.turns.filter((t) => t.role === 'assistant').map((t) => t.content).join('\n').slice(0, 6000)}` : ''
        })
      )
    )
      .filter(Boolean)
      .join('\n\n---\n\n')
    const facts = [
      files.firm.length ? `Firm facts:\n${files.firm.map((f) => `- ${f.text}${f.source ? ` (${f.source}${f.date ? `, ${f.date}` : ''})` : ''}`).join('\n')}` : '',
      files.stories.length ? `Stories:\n${files.stories.map((s) => `- ${s.id}. ${s.title}: anchors ${s.anchors.join(', ')}; evidence ${s.evidence.join('; ')}`).join('\n')}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    const system = `You write flashcards for someone preparing for one interview. Each card tests one thing: a definition taught in a lesson, a firm fact with its figure, or a story's anchors and evidence. Fronts are short questions; backs are the answer in a few words. Only facts from the material. ${HUMAN_FEEDBACK}\nReply with JSON only: [{"front": "...", "back": "..."}].`
    const prompt = `Write up to ${CARDS_PER_DAY} new cards for today, ${taught ? 'most of them on what was taught today' : 'from the facts below'}.
Cards that exist already (don't repeat): ${[...have].slice(0, 80).join(' | ') || 'none'}

${taught ? `Taught today:\n${taught}\n\n` : ''}${facts}`
    try {
      progress(slug, 'Writing today’s cards')
      const out = await models.once(prompt, system, 'teach', 'interviewWrite', AbortSignal.timeout(180_000))
      const arr = JSON.parse(out.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as { front?: unknown; back?: unknown }[]
      cards = arr
        .map((c) => ({ front: String(c.front ?? '').trim(), back: String(c.back ?? '').trim() }))
        .filter((c) => c.front && c.back && !have.has(c.front))
        .slice(0, CARDS_PER_DAY)
      by = 'claude'
    } catch (e) {
      console.warn('[interview] cards', (e as Error).message)
    }
  }
  if (!cards.length) {
    cards = cardsFromFiles(files, have)
    by = 'code'
  }
  progress(slug, '')
  if (!cards.length) return { path, added: 0, by, note: 'Nothing new to make cards from yet.' }
  const b = existing ? await backup(slug, path) : undefined
  const start = existing.trim() ? existing.trimEnd() + '\n\n' : cardsFileStart(files.meta.name) + '\n'
  await writeText(path, `${start}${cardsHeading(now)}\n\n${cardsToMarkdown(cards)}\n`)
  return { path, added: cards.length, ...(b ? { backup: b } : {}), by, ...(lessons.length ? { note: `From ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} today` } : {}) }
}

export async function generate(slug: string, what: GenerateWhat): Promise<GenerateResult> {
  const folder = await folderOf(slug)
  const { files } = await readFiles(folder)
  if (what === 'cards') return writeCards(slug, folder, files, await courseOf(files.meta.course))
  if (!(await models.ready())) throw new Error('Writing stories and model answers needs Claude. Set it up in Settings › AI, or write them yourself in the files.')
  try {
    return what === 'stories' ? await writeStories(slug, folder, files) : await writeAnswers(slug, folder, files)
  } finally {
    progress(slug, '')
  }
}

// ---------- Drills: marking, follow-ups, the interviewer in a scenario ----------

const MARK_SYSTEM = `You mark one interview answer for a candidate's practice, as a fair, demanding interviewer at the firm would. Score each criterion from 0 to 4 (halves allowed) on evidence in the answer. Check facts against the candidate's own material where it is given: a claim that contradicts it is an accuracy problem. ${HUMAN_FEEDBACK}
Reply with JSON only: {"marks": {"<criterion id>": 0-4, ...}, "covered": ["points made"], "missed": ["points a strong answer makes that this one didn't"], "feedback": "two to four sentences to the candidate"}`

const DRILL_BRIEF: Record<MarkInput['drill'], string> = {
  behavioural: 'A behavioural answer. structure: follows the route given (or a clear situation, action, result); specifics: concrete facts and numbers; ownership: what "I" did; result: a clear outcome; length: inside the time window; natural: sounds like a person talking, not a script (no stock phrases).',
  cv: 'Defending a line of their CV. accuracy: matches their real facts; depth: reasons, trade-offs, what was hard, what they would change; clarity: easy to follow; length: inside the window.',
  scenario: 'A case answer against the rubric. risks: names the risks; mitigation: what to do about them; communication: who to tell, when, and escalation.',
  talk: 'A run of the presentation. brief: covers each requirement of the brief; timing: inside the window; natural: talks rather than reads.',
  assessor: 'An answer to an assessor question after the talk. point: makes the point a strong answer makes; clarity; length.',
  ask: 'Questions to ask the interviewer.',
  firm: 'Recall of firm facts.'
}

export async function markAnswer(slug: string, i: MarkInput): Promise<MarkResult> {
  const code = markInCode(i, naturalness)
  if (!i.answer.trim() || !(await models.ready())) return code
  const ctx = i.drill === 'cv' ? await contextText(slug, 20_000) : ''
  const prompt = `${DRILL_BRIEF[i.drill]}
Criteria: ${CRITERIA[i.drill].map((c) => `${c.id} (${c.label})`).join(', ')}
Time: ${Math.round(i.seconds)} seconds ${i.drill === 'talk' ? `(target ${i.minutes ?? 15} minutes)` : ''}

Question: ${i.question}
${i.route?.length ? `Route: ${i.route.join(' → ')}\n` : ''}${i.anchors?.length ? `Anchors of the story it should use: ${i.anchors.join(', ')}\n` : ''}${i.outline?.length ? `The candidate's own outline: ${i.outline.join('; ')}\n` : ''}${i.evidence?.length ? `The candidate's real facts: ${i.evidence.join('; ')}\n` : ''}${i.rubric?.length ? `Rubric:\n${i.rubric.map((r) => `- (${r.group}) ${r.text}`).join('\n')}\n` : ''}${i.point ? `The point a strong answer makes: ${i.point}\n` : ''}${i.checklist?.length ? `The brief:\n${i.checklist.map((c) => `- ${c}`).join('\n')}\n` : ''}${ctx ? `\nTheir material:\n${ctx}\n` : ''}
Phrases code flagged as sounding scripted: ${aiTells(i.answer).map((t) => t.phrase).join(', ') || 'none'}

The answer${i.drill === 'talk' ? ' (transcript)' : ''}:
${i.answer.slice(0, 20_000)}`
  try {
    const out = await models.once(prompt, MARK_SYSTEM, 'mark', 'interviewMark', AbortSignal.timeout(150_000))
    const m = parseMarks(out, i.drill)
    if (!m) return code
    // Time is measured, not judged: the clock's mark stands
    for (const k of ['length', 'timing']) if (k in m.marks && k in code.marks) m.marks[k] = code.marks[k]
    const vals = Object.values(m.marks)
    return { ...m, score: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100, by: 'claude' }
  } catch (e) {
    console.warn('[interview] mark', (e as Error).message)
    return code
  }
}

/** Follow-ups in CV defence, when Claude can't ask one of its own */
const PROBES = ['Why that tool or approach, and not another?', 'What was the hardest part, and how did you get past it?', 'If you did it again, what would you change?', 'How did you know it worked? What did you measure?', 'What did you do yourself, and what did others do?']

export async function probe(slug: string, r: ProbeRequest): Promise<{ probe: string; by: 'claude' | 'code' }> {
  const fallback = { probe: PROBES.find((p) => !r.asked.includes(p)) ?? PROBES[r.asked.length % PROBES.length], by: 'code' as const }
  if (!(await models.ready())) return fallback
  const ctx = await contextText(slug, 15_000)
  try {
    const out = await models.once(
      `The CV line or story: ${r.item}\nYour question: ${r.question}\n${r.asked.length ? `Follow-ups asked already: ${r.asked.join(' | ')}\n` : ''}Their answer: ${r.answer.slice(0, 6000)}\n\n${ctx ? `Their material:\n${ctx}` : ''}`,
      `You are the interviewer, probing one line of a candidate's CV. Ask ONE deeper follow-up on what they just said: why this tool, what they'd change, what was hard, how they measured it, or something that doesn't add up against their material. One sentence, spoken, no preamble. ${HUMAN_FEEDBACK}`,
      'teach',
      'interviewProbe',
      AbortSignal.timeout(60_000)
    )
    const q = out.trim().split('\n').find((l) => l.trim())?.replace(/^["']|["']$/g, '').trim()
    return q ? { probe: q, by: 'claude' } : fallback
  } catch {
    return fallback
  }
}

export async function clarify(slug: string, r: ClarifyRequest): Promise<{ reply: string; by: 'claude' | 'code' }> {
  const folder = await folderOf(slug)
  const { files } = await readFiles(folder)
  const c = files.scenarios.find((x) => x.id === r.scenario)
  const fallback = { reply: 'Make a reasonable assumption, say it out loud, and carry on. Interviewers mark how you reason, not whether you guessed their numbers.', by: 'code' as const }
  if (!c || !(await models.ready())) return fallback
  try {
    const out = await models.once(
      `The case so far:\n${c.parts.slice(0, Math.max(1, r.shown)).map((p, i) => `Part ${i + 1}: ${p}`).join('\n\n')}\n\nLater parts (don't reveal them): ${c.parts.slice(Math.max(1, r.shown)).join(' / ') || 'none'}\n\nThe candidate asks: ${r.question.slice(0, 1000)}`,
      `You are the interviewer running this case. Answer the candidate's clarifying question in role, in one to three short sentences. Give facts the case implies; if the case doesn't say, tell them to assume and state it. Never reveal later parts or the rubric. ${HUMAN_FEEDBACK}`,
      'teach',
      'interviewProbe',
      AbortSignal.timeout(60_000)
    )
    return out.trim() ? { reply: out.trim(), by: 'claude' } : fallback
  } catch {
    return fallback
  }
}

// ---------- Wiring ----------

export function registerInterview() {
  ipcMain.handle('interview:list', () => listTargets())
  ipcMain.handle('interview:get', (_e, slug: string) => getTarget(String(slug)))
  ipcMain.handle('interview:create', (_e, t: NewTarget) => createTarget({ company: String(t?.company ?? ''), role: String(t?.role ?? ''), date: t?.date || undefined, slidesDue: t?.slidesDue || undefined, sources: Array.isArray(t?.sources) ? t.sources.map(String) : [], links: Array.isArray(t?.links) ? t.links.map(String) : [] }))
  ipcMain.handle('interview:attempt', (_e, slug: string, a: Attempt) => saveAttempt(String(slug), a))
  ipcMain.handle('interview:mark', (_e, slug: string, i: MarkInput) => markAnswer(String(slug), i))
  ipcMain.handle('interview:probe', (_e, slug: string, r: ProbeRequest) => probe(String(slug), r))
  ipcMain.handle('interview:clarify', (_e, slug: string, r: ClarifyRequest) => clarify(String(slug), r))
  ipcMain.handle('interview:gather', (_e, slug: string) => gather(String(slug)))
  ipcMain.handle('interview:generate', (_e, slug: string, what: GenerateWhat) => generate(String(slug), what))
}

