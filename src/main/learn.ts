import type { DrillResult } from '@shared/drills'
import type { InterviewRecord } from '@shared/interviews'
import type { StudyEvent } from '@shared/brief'
import { getSettings } from './settings'
import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { extname } from 'path'
import type {
  Attempt,
  Goal,
  Mastery,
  GraphData,
  LearningStatus,
  NotebookMeta,
  NoteProgress,
  ReviewGrade,
  ReviewStats,
  TutorThread
} from '@shared/types'
import { absPath, allNotes, flattenFiles, getTree, joinRel, readText, resolveLink, writeText } from './vault'
import { getCards } from './study'

const hash = (s: string) => createHash('sha1').update(s).digest('hex')

async function readJson<T>(rel: string, fallback: T): Promise<T> {
  try {
    return existsSync(absPath(rel)) ? JSON.parse(await fs.readFile(absPath(rel), 'utf8')) : fallback
  } catch {
    return fallback
  }
}

const writeJson = (rel: string, data: unknown) => writeText(rel, JSON.stringify(data, null, 1))

// ---------- Links & graph ----------

const WIKILINK = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g
const MDLINK = /\[[^\]]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g

export async function noteLinks(path: string, raw: string): Promise<string[]> {
  const targets = new Set<string>()
  for (const m of raw.matchAll(WIKILINK)) targets.add(m[1].trim())
  for (const m of raw.matchAll(MDLINK)) targets.add(decodeURIComponent(m[1]))
  const resolved = await Promise.all([...targets].map((t) => resolveLink(t, path)))
  return [...new Set(resolved.filter((p): p is string => !!p && p !== path && extname(p) === '.md'))]
}

export async function getGraph(): Promise<GraphData> {
  const notes = await allNotes()
  const edges: GraphData['edges'] = []
  await Promise.all(
    notes.map(async (n) => {
      const raw = await readText(n.path).catch(() => '')
      for (const target of await noteLinks(n.path, raw)) edges.push({ source: n.path, target })
    })
  )
  const known = new Set(notes.map((n) => n.path))
  const valid = edges.filter((e) => known.has(e.target))
  const degree = new Map<string, number>()
  valid.forEach((e) => {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  })
  return {
    nodes: notes.map((n) => ({
      path: n.path,
      title: n.title,
      notebook: n.path.includes('/') ? n.path.split('/')[0] : '',
      degree: degree.get(n.path) ?? 0,
      tags: n.tags
    })),
    edges: valid
  }
}

export async function getBacklinks(path: string): Promise<{ path: string; title: string }[]> {
  const graph = await getGraph()
  const titles = new Map(graph.nodes.map((n) => [n.path, n.title]))
  return [...new Set(graph.edges.filter((e) => e.target === path).map((e) => e.source))].map((p) => ({
    path: p,
    title: titles.get(p) ?? p
  }))
}

// ---------- Notebooks (covers) ----------

const NOTEBOOKS_FILE = joinRel('.tide', 'notebooks.json')

export async function getNotebooks(): Promise<NotebookMeta[]> {
  const tree = await getTree()
  const stored = await readJson<Record<string, Partial<NotebookMeta>>>(NOTEBOOKS_FILE, {})
  const notes = await allNotes()
  const outlines = new Set(Object.values(stored).flatMap((m) => (m?.outline ? [m.outline] : [])))
  return (tree?.children ?? [])
    .filter((n) => n.type === 'folder')
    .map((folder) => {
      const files = flattenFiles(folder)
      const inFolder = notes.filter((n) => n.path.startsWith(folder.path + '/'))
      return {
        path: folder.path,
        name: folder.name,
        noteCount: files.filter((f) => f.kind === 'note').length,
        fileCount: files.length,
        mastered: inFolder.filter((n) => n.status === 'mastered').length,
        learning: inFolder.filter((n) => n.status === 'learning' || n.status === 'reviewing').length,
        lastModified: Math.max(0, ...files.map((f) => f.mtime ?? 0)),
        cover: stored[folder.path]?.cover,
        color: stored[folder.path]?.color,
        description: stored[folder.path]?.description,
        outline: stored[folder.path]?.outline
      }
    })
    .filter((nb) => isNotebook(tree, nb.path, outlines))
}

/**
 * Top-level folders are notebooks, including empty ones (a new topic starts with only its outline).
 * Left out: folders that only hold images (attachments) and folders that only hold other
 * notebooks' outlines (a "Roadmaps" folder).
 */
function isNotebook(tree: Awaited<ReturnType<typeof getTree>>, path: string, outlines: Set<string>) {
  // The Code playground's folder is a workspace, not a notebook
  if (path === 'Code') return false
  const folder = tree?.children?.find((c) => c.path === path)
  const files = flattenFiles(folder ?? null)
  if (!files.length) return true
  if (files.every((f) => f.kind === 'image')) return false
  return !files.every((f) => outlines.has(f.path))
}

export async function updateNotebook(path: string, patch: Partial<Pick<NotebookMeta, 'cover' | 'color' | 'description' | 'outline'>>) {
  await updateJson<Record<string, Partial<NotebookMeta>>>(NOTEBOOKS_FILE, {}, (stored) => ({ ...stored, [path]: { ...stored[path], ...patch } }))
}

/** Copies an image into .tide/covers and makes it the notebook's cover. */
const COVER_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])

export async function setCoverImage(path: string, sourceFile: string): Promise<string> {
  const ext = extname(sourceFile).toLowerCase()
  if (!COVER_TYPES.has(ext)) throw new Error('Covers can be PNG, JPEG, WebP, GIF or AVIF images.')
  const stat = await fs.stat(sourceFile)
  if (stat.size > 25 * 1024 * 1024) throw new Error('That image is over 25 MB. Pick a smaller one.')
  const rel = joinRel('.tide', 'covers', `${hash(path).slice(0, 12)}-${Date.now()}${ext}`)
  await fs.mkdir(absPath(joinRel('.tide', 'covers')), { recursive: true })
  await fs.copyFile(sourceFile, absPath(rel))
  const previous = (await readJson<Record<string, Partial<NotebookMeta>>>(NOTEBOOKS_FILE, {}))[path]?.cover
  await updateNotebook(path, { cover: rel })
  await removeCoverFile(previous)
  return rel
}

/** Deletes a cover Tide copied in, never anything outside .tide/covers */
async function removeCoverFile(rel: string | undefined) {
  if (rel && rel.startsWith('.tide/covers/')) await fs.rm(absPath(rel), { force: true }).catch(() => {})
}

export async function clearCoverImage(path: string) {
  const previous = (await readJson<Record<string, Partial<NotebookMeta>>>(NOTEBOOKS_FILE, {}))[path]?.cover
  await updateJson<Record<string, Partial<NotebookMeta>>>(NOTEBOOKS_FILE, {}, (stored) => {
    const { cover: _drop, ...rest } = stored[path] ?? {}
    return { ...stored, [path]: rest }
  })
  await removeCoverFile(previous)
}

// ---------- Learning status (frontmatter learning_status) ----------

/** Sets `learning_status` in the note's frontmatter with a minimal line edit, keeping the rest as written. */
export async function setNoteStatus(path: string, status: LearningStatus) {
  const raw = await readText(path)
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  let next: string
  if (!fm) next = `---\nlearning_status: ${status}\n---\n\n${raw}`
  else if (/^learning_status:.*$/m.test(fm[1])) {
    next = raw.replace(fm[0], fm[0].replace(/^learning_status:.*$/m, `learning_status: ${status}`))
  } else {
    next = raw.replace(fm[0], fm[0].replace(/\r?\n---$/, `\nlearning_status: ${status}\n---`))
  }
  await writeText(path, next)
}

// ---------- Quiz results ----------

const PROGRESS_FILE = joinRel('.tide', 'progress.json')

export async function recordQuiz(paths: string[], score: number, total: number) {
  const progress = await readJson<Record<string, NoteProgress>>(PROGRESS_FILE, {})
  const now = Date.now()
  for (const p of paths) {
    const entry = progress[p] ?? { quizzes: [] }
    entry.quizzes = [...entry.quizzes, { at: now, score, total }].slice(-30)
    progress[p] = entry
  }
  await writeJson(PROGRESS_FILE, progress)
}

export const getProgress = () => readJson<Record<string, NoteProgress>>(PROGRESS_FILE, {})

// ---------- Review log & stats ----------

const REVIEW_LOG = joinRel('.tide', 'reviews.jsonl')

export async function logReview(cardId: string, path: string, grade: ReviewGrade, interval: number) {
  const line = JSON.stringify({ at: Date.now(), id: cardId, path, grade, interval }) + '\n'
  await fs.mkdir(absPath('.tide'), { recursive: true })
  await fs.appendFile(absPath(REVIEW_LOG), line)
}

export async function getReviewStats(): Promise<ReviewStats> {
  let lines: { at: number; id: string; path: string; grade: ReviewGrade }[] = []
  try {
    lines = (await fs.readFile(absPath(REVIEW_LOG), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    // no reviews yet
  }
  const byDay: Record<string, number> = {}
  for (const l of lines) {
    const day = new Date(l.at).toISOString().slice(0, 10)
    byDay[day] = (byDay[day] ?? 0) + 1
  }
  // Streak of consecutive days with reviews, ending today or yesterday
  let streak = 0
  const day = new Date()
  if (!byDay[day.toISOString().slice(0, 10)]) day.setDate(day.getDate() - 1)
  while (byDay[day.toISOString().slice(0, 10)]) {
    streak++
    day.setDate(day.getDate() - 1)
  }
  const recent = lines.filter((l) => l.at > Date.now() - 30 * 86400000)
  const retention = recent.length ? recent.filter((l) => l.grade !== 'again').length / recent.length : null

  const cards = await getCards({ kind: 'vault' })
  const now = Date.now()
  const decks: ReviewStats['decks'] = {}
  for (const c of cards) {
    const deck = c.path.includes('/') ? c.path.split('/')[0] : 'Unsorted'
    const d = (decks[deck] ??= { total: 0, new: 0, due: 0, learning: 0, mature: 0 })
    d.total++
    if (!c.schedule) d.new++
    else {
      if (c.schedule.due <= now) d.due++
      if (c.schedule.interval >= 21) d.mature++
      else d.learning++
    }
  }
  return { byDay, streak, retention, totalReviews: lines.length, decks }
}

// ---------- Inline tutor threads ----------

const threadsFile = (path: string) => joinRel('.tide', 'threads', `${hash(path)}.json`)

export const getThreads = (path: string) => readJson<TutorThread[]>(threadsFile(path), [])

export const saveThreads = (path: string, threads: TutorThread[]) => writeJson(threadsFile(path), threads)

// ---------- Attempts & mastery ----------

const ATTEMPTS = joinRel('.tide', 'attempts.jsonl')

export async function recordAttempt(a: Omit<Attempt, 'at'>) {
  await fs.mkdir(absPath('.tide'), { recursive: true })
  await fs.appendFile(absPath(ATTEMPTS), JSON.stringify({ ...a, at: Date.now() }) + '\n')
}

async function readJsonl<T>(rel: string): Promise<T[]> {
  try {
    return (await fs.readFile(absPath(rel), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T)
  } catch {
    return []
  }
}

const levelFor = (score: number, evidence: number): Mastery['level'] =>
  evidence === 0 ? 'new' : score < 0.45 ? 'weak' : score < 0.7 ? 'shaky' : score < 0.88 || evidence < 4 ? 'solid' : 'mastered'

/**
 * Mastery per note from three signals: recent answers (newer weigh more), flashcard
 * retention, and the learning status the student set. Confidently wrong answers are
 * counted separately because they point at misconceptions rather than gaps.
 */
export async function getMastery(): Promise<Record<string, Mastery>> {
  const attempts = await readJsonl<Attempt>(ATTEMPTS)
  const reviews = await readJsonl<{ at: number; path: string; grade: string }>(REVIEW_LOG)
  const notes = await allNotes()
  const out: Record<string, Mastery> = {}

  const byPath = new Map<string, { score: number; weight: number; n: number; mis: number; last: number }>()
  const add = (path: string, score: number, weight: number, at: number, mis = 0) => {
    const e = byPath.get(path) ?? { score: 0, weight: 0, n: 0, mis: 0, last: 0 }
    e.score += score * weight
    e.weight += weight
    e.n++
    e.mis += mis
    e.last = Math.max(e.last, at)
    byPath.set(path, e)
  }

  // Newest first, each older item counts 85% of the next
  const recent = [...attempts].filter((a) => a.path).sort((a, b) => b.at - a.at)
  const seen = new Map<string, number>()
  for (const a of recent) {
    const k = seen.get(a.path!) ?? 0
    seen.set(a.path!, k + 1)
    if (k >= 15) continue
    add(a.path!, a.score, Math.pow(0.85, k), a.at, a.verdict === 'wrong' && a.confidence === 3 ? 1 : 0)
  }
  const reviewSeen = new Map<string, number>()
  for (const r of [...reviews].sort((a, b) => b.at - a.at)) {
    const k = reviewSeen.get(r.path) ?? 0
    reviewSeen.set(r.path, k + 1)
    if (k >= 20) continue
    // Cards weigh less than explained answers: recall is not understanding
    add(r.path, r.grade === 'again' ? 0 : r.grade === 'hard' ? 0.6 : 1, 0.4 * Math.pow(0.9, k), r.at)
  }

  for (const n of notes) {
    const e = byPath.get(n.path)
    const statusBoost = n.status === 'mastered' ? 0.9 : n.status === 'reviewing' ? 0.7 : n.status === 'learning' ? 0.4 : null
    if (!e && statusBoost === null) continue
    let score = e ? e.score / e.weight : statusBoost!
    if (e && statusBoost !== null) score = score * 0.8 + statusBoost * 0.2
    out[n.path] = {
      path: n.path,
      score,
      level: levelFor(score, (e?.n ?? 0) + (statusBoost !== null ? 2 : 0)),
      attempts: e?.n ?? 0,
      misconceptions: e?.mis ?? 0,
      lastAt: e?.last
    }
  }
  return out
}

// ---------- Goals ----------

const GOALS = joinRel('.tide', 'goals.json')

export const getGoals = () => readJson<Goal[]>(GOALS, [])

export const saveGoals = (goals: Goal[]) => updateJson<Goal[]>(GOALS, [], () => goals)

// ---------- Explain from memory ----------

const RECALL = joinRel('.tide', 'recall.json')

export interface RecallItem {
  path: string
  title: string
  due: number
  /** Never explained from memory yet */
  first: boolean
}

/**
 * Notes worth explaining from memory: anything being learned, reviewed or learned, or quizzed on.
 * Each has its own FSRS schedule, separate from its flashcards, because understanding fades too.
 */
export async function getRecallQueue(): Promise<RecallItem[]> {
  const store = await readJson<Record<string, { fsrs?: unknown; due?: number }>>(RECALL, {})
  const notes = await allNotes()
  const mastery = await getMastery()
  const now = Date.now()
  const out: RecallItem[] = []
  for (const n of notes) {
    const stored = store[n.path] as { fsrs?: { due: string } } | undefined
    const studied = n.status === 'learning' || n.status === 'reviewing' || n.status === 'mastered' || (mastery[n.path]?.attempts ?? 0) > 0
    if (!stored && !studied) continue
    const due = stored?.fsrs ? new Date(stored.fsrs.due).getTime() : (mastery[n.path]?.lastAt ?? now - 3 * 86_400_000) + 2 * 86_400_000
    out.push({ path: n.path, title: n.title, due, first: !stored })
  }
  return out.sort((a, b) => a.due - b.due).filter((r) => r.due <= now + 12 * 3600_000)
}

export async function reviewRecall(path: string, grade: 'again' | 'hard' | 'good' | 'easy') {
  const { scheduleAfter } = await import('./study')
  const store = await readJson<Record<string, unknown>>(RECALL, {})
  const { stored } = scheduleAfter(store[path] as never, grade)
  store[path] = stored
  await writeJson(RECALL, store)
}

// ---------- Library topics ----------

const LIBRARY = joinRel('.tide', 'library.json')

/** One write at a time per file, so quick successive edits can't overwrite each other */
const queues = new Map<string, Promise<unknown>>()
function updateJson<T>(rel: string, fallback: T, change: (data: T) => T): Promise<T> {
  const run = (queues.get(rel) ?? Promise.resolve()).then(async () => {
    const next = change(await readJson<T>(rel, fallback))
    await writeJson(rel, next)
    return next
  })
  queues.set(rel, run.catch(() => {}))
  return run
}

type LibraryStore = Record<string, { topics?: string[] }>

/** Subjects each library item is filed under, by path */
export async function getLibraryTopics(): Promise<Record<string, string[]>> {
  const store = await readJson<LibraryStore>(LIBRARY, {})
  return Object.fromEntries(Object.entries(store).flatMap(([p, v]) => (v?.topics?.length && existsSync(absPath(p)) ? [[p, v.topics]] : [])))
}

export async function setLibraryTopics(path: string, topics: string[]) {
  const seen = new Set<string>()
  const clean = topics
    .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 40))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 12)
  await updateJson<LibraryStore>(LIBRARY, {}, (s) => {
    const next = { ...s }
    if (clean.length) next[path] = { ...next[path], topics: clean }
    else delete next[path]
    return next
  })
}

/**
 * Keeps Tide's records pointing at a file or folder after it is renamed or moved: notebook
 * settings (and their outline), library topics and goals. Other notebooks' outlines that live
 * inside a moved folder follow too.
 */
export async function onPathMoved(from: string, to: string) {
  const move = (p: string) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  const rekey = <V>(obj: Record<string, V>) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [move(k), v]))
  await updateJson<Record<string, Partial<NotebookMeta>>>(NOTEBOOKS_FILE, {}, (s) =>
    Object.fromEntries(Object.entries(rekey(s)).map(([k, v]) => [k, v?.outline ? { ...v, outline: move(v.outline) } : v]))
  )
  await updateJson<LibraryStore>(LIBRARY, {}, rekey)
  await updateJson<Goal[]>(GOALS, [], (goals) => goals.map((g) => ({ ...g, notebook: move(g.notebook) })))
}

// ---------- Daily brief ----------

const FOCUS_LOG = joinRel('.tide', 'focus.jsonl')

/** Records a timed focus session (whole minutes, at least one), and what it was spent on */
export async function logFocus(start: number, end: number, context?: { label?: string; path?: string; kind?: string }) {
  const minutes = Math.round((end - start) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) return
  const clean = (s?: string) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 200) : undefined)
  await fs.mkdir(absPath(joinRel('.tide')), { recursive: true })
  await fs.appendFile(absPath(FOCUS_LOG), JSON.stringify({ start, end, minutes, label: clean(context?.label), path: clean(context?.path), kind: clean(context?.kind) }) + '\n')
}

const INTERVIEW_LOG = joinRel('.tide', 'interviews.jsonl')

/** Saves one mock interview round's result */
export async function logInterview(r: Omit<InterviewRecord, 'id' | 'at'>): Promise<InterviewRecord> {
  const rounds = ['coding', 'design', 'behavioural', 'quant']
  const verdicts = ['hire', 'lean hire', 'lean no', 'no']
  if (!r.company?.trim() || !rounds.includes(r.round) || !(r.score >= 0 && r.score <= 1)) throw new Error('Not a valid interview result.')
  const record: InterviewRecord = {
    id: Math.random().toString(36).slice(2, 10),
    at: Date.now(),
    company: r.company.trim().slice(0, 80),
    round: r.round,
    score: Math.round(r.score * 1000) / 1000,
    ...(r.verdict && verdicts.includes(r.verdict) ? { verdict: r.verdict } : {}),
    timed: !!r.timed,
    minutes: Math.max(0, Math.min(600, Math.round(r.minutes || 0))),
    ...(r.topic ? { topic: String(r.topic).slice(0, 200) } : {})
  }
  await fs.mkdir(absPath(joinRel('.tide')), { recursive: true })
  await fs.appendFile(absPath(INTERVIEW_LOG), JSON.stringify(record) + '\n')
  return record
}

export const listInterviews = () => readJsonl<InterviewRecord>(INTERVIEW_LOG)

const DRILL_LOG = joinRel('.tide', 'drills.jsonl')

/** Saves one mental maths speed drill */
export async function logDrill(r: Omit<DrillResult, 'id' | 'at'>): Promise<DrillResult> {
  if (!(r.kind === 'zetamac' || r.kind === 'eighty') || !(r.correct >= 0) || !(r.attempted >= r.correct)) throw new Error('Not a valid drill result.')
  const record: DrillResult = { id: Math.random().toString(36).slice(2, 10), at: Date.now(), kind: r.kind, correct: Math.round(r.correct), attempted: Math.round(r.attempted), seconds: Math.max(0, Math.round(r.seconds)), perOp: r.perOp ?? {} }
  await fs.mkdir(absPath(joinRel('.tide')), { recursive: true })
  await fs.appendFile(absPath(DRILL_LOG), JSON.stringify(record) + '\n')
  return record
}

export const listDrills = () => readJsonl<DrillResult>(DRILL_LOG)

/** Total minutes timed on one note, book or problem */
export async function focusTime(path: string): Promise<number> {
  const rows = await readJsonl<{ minutes: number; path?: string }>(FOCUS_LOG)
  return rows.filter((r) => r.path === path).reduce((n, r) => n + (r.minutes || 0), 0)
}

/** Everything studied in the last two weeks, as events for the daily brief */
export async function studyEvents(): Promise<StudyEvent[]> {
  const since = Date.now() - 15 * 86_400_000
  const notes = await allNotes()
  const titleOf = new Map(notes.map((n) => [n.path, n.title]))
  const stored = await readJson<Record<string, Partial<NotebookMeta>>>(NOTEBOOKS_FILE, {})
  const outlines = new Set(Object.values(stored).flatMap((m) => (m?.outline ? [m.outline] : [])))
  const library = (getSettings().libraryFolder || 'Library') + '/'
  const events: StudyEvent[] = []
  for (const a of await readJsonl<Attempt>(ATTEMPTS)) {
    if (a.at >= since) events.push({ at: a.at, kind: 'answer', title: (a.path && titleOf.get(a.path)) || a.topic, path: a.path, score: a.score })
  }
  for (const r of await readJsonl<{ at: number; path: string }>(REVIEW_LOG)) {
    if (r.at >= since) events.push({ at: r.at, kind: 'review', title: titleOf.get(r.path) ?? r.path.split('/').pop()!.replace(/\.md$/, ''), path: r.path })
  }
  // Notes you wrote in, not outlines you ticked or pages you saved
  for (const n of notes) {
    if (n.mtime >= since && !outlines.has(n.path) && !n.path.startsWith(library) && !n.path.startsWith('.')) events.push({ at: n.mtime, kind: 'note', title: n.title, path: n.path })
  }
  for (const f of await readJsonl<{ start: number; end: number; minutes: number; label?: string; path?: string }>(FOCUS_LOG)) {
    if (f.end >= since && f.minutes > 0) events.push({ at: f.end, kind: 'focus', title: f.label ?? '', path: f.path, minutes: f.minutes })
  }
  const { listChats } = await import('./chats')
  for (const c of await listChats()) if (c.updatedAt >= since) events.push({ at: c.updatedAt, kind: 'chat', title: c.title })
  const { listProblems } = await import('./practice')
  for (const p of await listProblems()) for (const a of p.attempts) if (a.at >= since) events.push({ at: a.at, kind: 'problem', title: p.title, score: a.score })
  return events
}

// ---------- The graph, for the tutor ----------

let graphCache: { at: number; data: GraphData } | null = null

/** The link graph, cached briefly: the tutor may ask about it several times in one answer */
export async function graphCached(): Promise<GraphData> {
  if (graphCache && Date.now() - graphCache.at < 20_000) return graphCache.data
  const data = await getGraph()
  graphCache = { at: Date.now(), data }
  return data
}

export const invalidateGraph = () => (graphCache = null)

/**
 * How one note sits in the student's knowledge: what it links to, what links to it, what's two
 * steps away, and notes sharing its tags, each with how well it's known.
 */
export async function relatedNotes(path: string): Promise<{
  note: { path: string; title: string; level: string }
  linksTo: { path: string; title: string; level: string }[]
  linkedFrom: { path: string; title: string; level: string }[]
  twoSteps: { path: string; title: string; level: string }[]
  sameTags: { path: string; title: string; level: string }[]
} | null> {
  const graph = await graphCached()
  const node = graph.nodes.find((n) => n.path === path)
  if (!node) return null
  const mastery = await getMastery().catch(() => ({}) as Record<string, Mastery>)
  const byPath = new Map(graph.nodes.map((n) => [n.path, n]))
  const view = (p: string) => ({ path: p, title: byPath.get(p)?.title ?? p, level: mastery[p]?.level ?? 'new' })
  const out = new Set(graph.edges.filter((e) => e.source === path).map((e) => e.target))
  const inn = new Set(graph.edges.filter((e) => e.target === path).map((e) => e.source))
  const near = new Set([...out, ...inn, path])
  const two = new Set<string>()
  for (const e of graph.edges) {
    if (out.has(e.source) || inn.has(e.source)) if (!near.has(e.target)) two.add(e.target)
    if (out.has(e.target) || inn.has(e.target)) if (!near.has(e.source)) two.add(e.source)
  }
  const tags = new Set(node.tags.filter((t) => t !== 'flashcards'))
  const sameTags = tags.size ? graph.nodes.filter((n) => !near.has(n.path) && n.tags.some((t) => tags.has(t))).map((n) => n.path) : []
  return {
    note: view(path),
    linksTo: [...out].slice(0, 20).map(view),
    linkedFrom: [...inn].slice(0, 20).map(view),
    twoSteps: [...two].slice(0, 15).map(view),
    sameTags: sameTags.slice(0, 10).map(view)
  }
}
