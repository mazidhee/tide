/**
 * North Star (shared/northStar says what it is): here the roadmaps and knowledge are gathered,
 * Opus is asked to weave them (Gemma when Claude can't, a simpler map from code when neither
 * answers), the preview is shown, and "Build my North Star" writes new files only. The note in the
 * vault is the plan: every read parses it, so the learner's edits take effect at once. Once a week
 * Opus checks progress and proposes small changes the learner approves or rejects.
 *
 * Also what the rest of Tide asks of it: the current stage as a goal for the scheduler, each
 * track's scope for the gates, shared topics for credit, and the tracks it installed (virtual
 * notebooks: a roadmap in the hidden Roadmaps folder with no folder of its own in the sidebar).
 */
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { roadmapTopics, type RoadmapTopic } from '@shared/curriculum'
import { READY_ROADMAPS } from '@shared/finance/roadmaps'
import { localDate } from '@shared/coach'
import type { ConceptState } from '@shared/knowledge'
import { phasesOf } from '@shared/track'
import {
  applyProposal,
  bare,
  buildFiles,
  catalogueTrack,
  creditShared,
  durationWords,
  estimates,
  heuristicNorthStar,
  heuristicProposals,
  hoursSaved,
  inScope,
  NORTH_STAR_GOAL,
  keyTopicsIn,
  measuredDepth,
  NOTE_PATH,
  northStarTracks,
  paceOf,
  parseNote,
  parseProposals,
  parseSynthesis,
  proposalKey,
  REVIEW_SYSTEM,
  reviewPrompt,
  scopeOf,
  sharedTopics,
  siblingIndex,
  stageGoal,
  stageHours,
  stageProgress,
  SYNTH_SYSTEM,
  synthesisPrompt,
  tidyNorthStar,
  toInstall,
  toNote,
  type BuildFile,
  type CatalogueTrack,
  type Depth,
  type NorthStar,
  type Proposal,
  type SharedGroup,
  type StageProgress
} from '@shared/northStar'
import { absPath, readText, writeText } from './vault'

const STORE = '.tide/northstar.json'
/** The learner's own note on their goal and interests: the primary input, read fresh every time */
export const GOAL_NOTE = 'Coach/My goal and interests.md'

/** The goal note's text without its front matter, or '' when there isn't one */
export async function goalNote(): Promise<string> {
  const text = await readText(GOAL_NOTE).catch(() => '')
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
const today = () => localDate()
const DAY = 86_400_000

export interface NorthStarStore {
  version: 1
  /** Where the note is */
  notePath: string
  /** The note as Tide last wrote it: a difference is the learner's edit */
  written: string
  /** Ready roadmaps installed for the map: the track's name → its roadmap file in the vault */
  tracks: Record<string, { outline: string; file: string; at: number }>
  proposals: Proposal[]
  decided: { key: string; at: number; ok: boolean; text: string }[]
  lastReview?: number
  reviewSummary?: string
  reviewBy?: 'claude' | 'gemma' | 'tide'
  /** Each stage's capstone project, by stage number */
  capstones: Record<string, { notebook: string; title: string }>
  /** Key topics you confirmed at a depth (bare topic → depth) */
  confirmed: Record<string, number>
  /** When the current stage began (ms), for the scheduler's time on it */
  stageSince?: number
  /** The goal note as last planned from (a hash): a difference is the learner's edit */
  goalHash?: string
  createdAt: number
}

const EMPTY: NorthStarStore = { version: 1, notePath: NOTE_PATH, written: '', tracks: {}, proposals: [], decided: [], capstones: {}, confirmed: {}, createdAt: 0 }

let queue: Promise<unknown> = Promise.resolve()

export async function loadStore(): Promise<NorthStarStore | null> {
  try {
    const raw = JSON.parse(await readText(STORE)) as Partial<NorthStarStore>
    return { ...EMPTY, ...raw, tracks: raw.tracks ?? {}, proposals: raw.proposals ?? [], decided: raw.decided ?? [], capstones: raw.capstones ?? {}, confirmed: raw.confirmed ?? {} }
  } catch {
    return null
  }
}

/** One change to the store at a time, read fresh */
function update(fn: (s: NorthStarStore) => NorthStarStore): Promise<NorthStarStore> {
  const run = queue.then(async () => {
    const cur = await loadStore()
    if (!cur) throw new Error('There is no North Star yet.')
    const next = fn(cur)
    await writeText(STORE, JSON.stringify(next, null, 1))
    activeCache = null
    return next
  })
  queue = run.catch(() => {})
  return run
}

/** Writes a file that must not exist yet: never over anything (exclusive create) */
async function writeNew(rel: string, text: string): Promise<boolean> {
  const abs = absPath(rel)
  await fs.mkdir(dirname(abs), { recursive: true })
  try {
    await fs.writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
}

const exists = (rel: string) =>
  fs
    .access(absPath(rel))
    .then(() => true)
    .catch(() => false)

// ---------- The tracks installed for the map (virtual notebooks) ----------

/** Installed ready roadmaps, read straight from the store (main/learn lists them as notebooks) */
export async function installedTracks(): Promise<Record<string, { outline: string }>> {
  return (await loadStore())?.tracks ?? {}
}

// ---------- The catalogue ----------

/** Every roadmap the map can use: the learner's own (notebooks with a roadmap) and every ready one */
export async function catalogue(): Promise<CatalogueTrack[]> {
  const { getNotebooks } = await import('./learn')
  const { ROADMAP_TEXT } = await import('./finance/roadmaps')
  const notebooks = await getNotebooks().catch(() => [])
  const store = await loadStore()
  const out: CatalogueTrack[] = []
  const usedFiles = new Set<string>()
  for (const nb of notebooks) {
    if (!nb.outline || nb.project) continue
    const md = await readText(nb.outline).catch(() => null)
    if (!md) continue
    const file = nb.outline.split('/').pop() ?? ''
    const ready = READY_ROADMAPS.find((r) => r.file === file)
    usedFiles.add(file)
    out.push(catalogueTrack(nb.name, md, { source: ready ? 'ready' : 'own', ...(ready ? { id: ready.id, file: ready.file, about: ready.about } : {}), outline: nb.outline }))
  }
  for (const r of READY_ROADMAPS) {
    if (usedFiles.has(r.file)) continue
    const own = store?.tracks[r.title]
    const md = ROADMAP_TEXT[r.file]
    if (!md) continue
    // In the Roadmaps folder already (an earlier start, or installed): that file, as it is now
    const inVault = (await exists(`Roadmaps/${r.file}`)) ? `Roadmaps/${r.file}` : undefined
    const text = inVault ? await readText(inVault).catch(() => md) : md
    out.push(catalogueTrack(r.title, text, { source: 'ready', id: r.id, file: r.file, about: r.about, ...(own?.outline || inVault ? { outline: own?.outline ?? inVault } : {}) }))
  }
  return out
}

/** Each track's topics, from its roadmap in the vault or the copy Tide ships */
async function topicsOf(cat: CatalogueTrack[]): Promise<Map<string, RoadmapTopic[]>> {
  const { ROADMAP_TEXT } = await import('./finance/roadmaps')
  const out = new Map<string, RoadmapTopic[]>()
  for (const t of cat) {
    const md = t.outline ? await readText(t.outline).catch(() => null) : t.file ? ROADMAP_TEXT[t.file] : null
    if (md) out.set(t.name, roadmapTopics(t.name, md))
  }
  return out
}

// ---------- Shared topics ----------

let sharedCache: { at: number; key: string; groups: SharedGroup[]; siblings: Map<string, string[]> } | null = null

/** Topics the map's tracks share (cached for five minutes) */
export async function sharedGroups(tracks?: string[]): Promise<{ groups: SharedGroup[]; siblings: Map<string, string[]> }> {
  const ns = tracks ? null : await activeNorthStar()
  const names = tracks ?? (ns ? northStarTracks(ns) : [])
  const key = [...names].sort().join('|')
  if (sharedCache && sharedCache.key === key && Date.now() - sharedCache.at < 5 * 60_000) return sharedCache
  const cat = (await catalogue()).filter((c) => names.includes(c.name))
  const topics = await topicsOf(cat)
  const groups = sharedTopics([...topics].map(([track, t]) => ({ track, topics: t })))
  sharedCache = { at: Date.now(), key, groups, siblings: siblingIndex(groups) }
  return sharedCache
}

// ---------- The map in force ----------

let activeCache: { at: number; ns: NorthStar | null; edited: boolean; error?: string } | null = null

/** The note read back (the learner's edits included); the last good one if it can't be read */
async function readMap(): Promise<{ ns: NorthStar | null; edited: boolean; error?: string; store: NorthStarStore | null }> {
  const store = await loadStore()
  if (!store) return { ns: null, edited: false, store }
  const text = await readText(store.notePath).catch(() => null)
  if (text === null) return { ns: null, edited: false, error: 'The North Star note is gone; build it again to bring it back.', store }
  const parsed = parseNote(text)
  if (parsed) return { ns: tidyNorthStar(parsed), edited: text.trim() !== store.written.trim(), store }
  const old = parseNote(store.written)
  return { ns: old ? tidyNorthStar(old) : null, edited: true, error: 'Your edits to the note couldn’t be read (no stages found). Tide is using the last version it wrote.', store }
}

/** The map in force, or null (cached for half a minute: the scheduler and gates ask often) */
export async function activeNorthStar(): Promise<NorthStar | null> {
  if (activeCache && Date.now() - activeCache.at < 30_000) return activeCache.ns
  const r = await readMap().catch(() => ({ ns: null, edited: false }))
  activeCache = { at: Date.now(), ns: r.ns, edited: r.edited }
  return r.ns
}

export const resetNorthStar = () => {
  activeCache = null
  sharedCache = null
  draft = null
}

/** A track's scope up to the current stage: null when the map doesn't use it (main/track) */
export async function trackScope(track: string): Promise<{ scope: string[]; stage: number; title: string } | null> {
  const ns = await activeNorthStar()
  if (!ns) return null
  const scope = scopeOf(ns, track, ns.current)
  if (!scope) return null
  return { scope, stage: ns.current, title: ns.stages.find((s) => s.n === ns.current)?.title ?? '' }
}

/**
 * The current stage as a goal for the scheduler (main/goals snapshot). The proactive coach may tilt
 * the stage's track weights a few points within the stage (main/proactiveCoach coachTilt); the map
 * itself is unchanged, and the tilt is in the coach log.
 */
export async function schedulerGoal() {
  const ns = await activeNorthStar()
  if (!ns) return null
  const store = await loadStore()
  const cap = store?.capstones[String(ns.current)]
  const tilt = await import('./proactiveCoach').then((m) => m.coachTilt(ns.current)).catch(() => ({}))
  const { tiltWeights } = await import('@shared/proactiveCoach')
  const tilted = Object.keys(tilt).length ? { ...ns, stages: ns.stages.map((s) => (s.n === ns.current ? { ...s, tracks: tiltWeights(s.tracks, tilt).map((w, i) => ({ ...s.tracks[i], weight: w.weight })) } : s)) } : ns
  return stageGoal(tilted, { createdAt: store?.stageSince ?? store?.createdAt ?? Date.now(), ...(cap ? { capstone: cap } : {}) })
}

// ---------- Depth targets into the learner model ----------

/**
 * Every stage's key topics, as targets in the learner model (main/learnerModel setTargetsFrom): the
 * roadmap topics each key topic names, at its depth (the deepest where two stages name the same).
 * Targets North Star set before and no longer names are cleared. Called when the map is built or
 * changed and when the week is planned or replanned, so What you know's depth-against-target is
 * the map's. Returns how many targets changed.
 */
let lastSync = { key: '', at: 0 }
export async function syncTargets(force = false): Promise<number> {
  const ns = await activeNorthStar()
  // The map's depths and scopes as they stand: unchanged since the last sync (within six hours), nothing to do
  const key = ns ? hash(JSON.stringify(ns.stages.map((s) => [s.n, s.deep, s.tracks.map((t) => [t.track, t.scope])]))) : 'none'
  if (!force && key === lastSync.key && Date.now() - lastSync.at < 6 * 3_600_000) return 0
  lastSync = { key, at: Date.now() }
  const { setTargetsFrom } = await import('./learnerModel')
  const { readTargets } = await import('./learningLog')
  const before = readTargets().filter((t) => t.by === 'northstar')
  const want = new Map<string, number>()
  if (ns) {
    const cat = await catalogue()
    const topics = await topicsOf(cat.filter((c) => northStarTracks(ns).includes(c.name)))
    for (const s of ns.stages) {
      const inStage = s.tracks.flatMap((st) => (topics.get(st.track) ?? []).filter((t) => !t.project && inScope(t, st.scope)))
      for (const k of s.deep) for (const t of keyTopicsIn(k, inStage)) want.set(t.id, Math.max(want.get(t.id) ?? 0, k.depth))
    }
  }
  const list: { node: string; depth: Depth | null; goal?: string }[] = []
  for (const [node, depth] of want) if (before.find((b) => b.node === node)?.depth !== depth) list.push({ node, depth: depth as Depth, goal: NORTH_STAR_GOAL })
  for (const b of before) if (!want.has(b.node)) list.push({ node: b.node, depth: null })
  return list.length ? setTargetsFrom('northstar', list) : 0
}

const syncSoon = () => void syncTargets(true).catch((e) => console.warn(`[northstar] targets: ${(e as Error).message}`))

// ---------- The coach's proposals ----------

/**
 * The proactive coach's weekly review proposes changes to the map through the same flow as the
 * weekly check: checked (parseProposals), never one already decided or pending, waiting for you to
 * approve. It counts as this week's check, so Opus isn't asked twice.
 */
export async function coachProposals(raw: unknown, summary: string, by: 'claude' | 'gemma' | 'tide'): Promise<Proposal[]> {
  const r = await readMap()
  if (!r.ns || !r.store) return []
  const parsed = parseProposals({ proposals: raw, summary }, r.ns, await catalogue())
  const decided = new Set(r.store.decided.map((d) => d.key))
  const pending = new Set(r.store.proposals.map(proposalKey))
  const fresh = parsed.proposals.filter((x) => !decided.has(proposalKey(x)) && !pending.has(proposalKey(x)))
  await update((s) => ({ ...s, proposals: [...s.proposals, ...fresh].slice(-6), lastReview: Date.now(), ...(parsed.summary ? { reviewSummary: parsed.summary } : {}), reviewBy: by }))
  return fresh
}

// ---------- Knowledge ----------

async function concepts(): Promise<ConceptState[]> {
  return import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[])
}

/** What the knowledge map says they know, briefly, for the prompt */
function knownText(all: ConceptState[]): string {
  const roots = all.filter((c) => !c.parent)
  const solid = roots.filter((c) => c.status === 'solid')
  const learning = roots.filter((c) => c.status === 'learning' || c.status === 'fading')
  const byArea = new Map<string, { solid: number; seen: number }>()
  for (const c of roots) {
    const a = byArea.get(c.area || 'other') ?? { solid: 0, seen: 0 }
    if (c.status === 'solid') a.solid++
    if (c.seen > 0) a.seen++
    byArea.set(c.area || 'other', a)
  }
  const lines = [...byArea].filter(([, v]) => v.seen).map(([k, v]) => `- ${k}: ${v.solid} solid, ${v.seen} studied`)
  return [
    `${solid.length} concepts solid, ${learning.length} being learned, of ${roots.length} on their roadmaps.`,
    ...lines,
    solid.length ? `Solid: ${solid.slice(0, 40).map((c) => c.name).join('; ')}` : '',
    learning.length ? `Learning: ${learning.slice(0, 25).map((c) => c.name).join('; ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------- Pace and time on each track ----------

async function minutesByWeek(): Promise<number[]> {
  const { focusLog } = await import('./learn')
  const now = Date.now()
  const log = await focusLog(now - 28 * DAY).catch(() => [])
  const weeks = [0, 0, 0, 0]
  for (const e of log) weeks[Math.min(3, Math.floor((now - e.start) / (7 * DAY)))] += e.minutes
  return weeks
}

/** Minutes on each track over the last fortnight: timed study in its notebook, and planned items ticked off */
async function minutesByTrack(tracks: string[]): Promise<Record<string, number>> {
  const { focusLog, getNotebooks } = await import('./learn')
  const notebooks = await getNotebooks().catch(() => [])
  const out: Record<string, number> = Object.fromEntries(tracks.map((t) => [t, 0]))
  for (const e of await focusLog(Date.now() - 14 * DAY).catch(() => [])) {
    const nb = notebooks.find((n) => e.path && (e.path === n.path || e.path.startsWith(`${n.path}/`) || e.path === n.outline))
    if (nb && nb.name in out) out[nb.name] += e.minutes
  }
  const { getWeek } = await import('./coach')
  const { addDays } = await import('@shared/portfolio')
  for (const back of [0, 7]) {
    const plan = await getWeek(addDays(today(), -back)).catch(() => null)
    for (const d of plan?.days ?? []) if (d.date >= addDays(today(), -14)) for (const it of d.items) if (it.done && it.notebook && it.notebook in out) out[it.notebook] += it.minutes
  }
  return out
}

// ---------- Progress ----------

async function capstoneState(store: NorthStarStore | null, n: number): Promise<StageProgress['capstone']> {
  const cap = store?.capstones[String(n)]
  if (!cap) return 'none'
  const { readPlan } = await import('./ideaProjects')
  const { progressOf } = await import('@shared/ideaProject')
  const plan = await readPlan(cap.notebook).catch(() => null)
  if (!plan) return 'started'
  const p = progressOf(plan)
  return p.total > 0 && p.done === p.total ? 'done' : 'started'
}

/** Topic ids whose phase check was passed, across the map's tracks */
async function checkedTopics(cat: CatalogueTrack[]): Promise<Set<string>> {
  const { loadTracks } = await import('./track')
  const store = await loadTracks().catch(() => null)
  const out = new Set<string>()
  if (!store) return out
  for (const t of cat) {
    const rec = store.tracks[t.name]
    if (!rec || !t.outline) continue
    const md = await readText(t.outline).catch(() => null)
    if (!md) continue
    for (const p of phasesOf(t.name, md)) if (rec.phases[p.id]?.checks?.some((c) => c.passed)) p.topics.forEach((x) => out.add(x.id))
  }
  return out
}

interface Gathered {
  ns: NorthStar
  store: NorthStarStore
  cat: CatalogueTrack[]
  topics: Map<string, RoadmapTopic[]>
  concept: (id: string) => ConceptState | undefined
  checked: Set<string>
  groups: SharedGroup[]
}

async function gather(ns: NorthStar, store: NorthStarStore): Promise<Gathered> {
  const cat = await catalogue()
  const names = northStarTracks(ns)
  const topics = await topicsOf(cat.filter((c) => names.includes(c.name)))
  const all = await concepts()
  const byId = new Map(all.map((c) => [c.id, c]))
  const { groups, siblings } = await sharedGroups(names)
  const ids = [...topics.values()].flat().map((t) => t.id)
  const credited = creditShared(byId, byId, siblings, ids)
  const checked = await checkedTopics(cat.filter((c) => names.includes(c.name)))
  return { ns, store, cat, topics, concept: (id) => credited.get(id), checked, groups }
}

async function progressOfStage(g: Gathered, n: number): Promise<StageProgress> {
  const stage = g.ns.stages.find((s) => s.n === n)!
  return stageProgress(stage, g.topics, g.concept, { capstone: await capstoneState(g.store, n), checkPassed: (id) => g.checked.has(id), confirmed: g.store.confirmed })
}

/** Hours left in each stage from here: the current one from what you know, later ones from scratch (shared topics credited) */
async function hoursLeft(g: Gathered): Promise<Record<number, number>> {
  const out: Record<number, number> = {}
  const cur = g.ns.stages.findIndex((s) => s.n === g.ns.current)
  // A topic learned in an earlier stage needn't be learned again in a later one
  const learned = new Set<string>()
  const sib = siblingIndex(g.groups)
  for (const [i, s] of g.ns.stages.entries()) {
    if (i < cur) continue
    if (i === cur) out[s.n] = (await progressOfStage(g, s.n)).hoursLeft
    else out[s.n] = stageHours(s, g.topics, learned)
    for (const st of s.tracks) for (const t of g.topics.get(st.track) ?? []) if (st.scope.length && t.path.some((p) => st.scope.some((x) => bare(x) === bare(p)))) (sib.get(t.id) ?? []).forEach((x) => learned.add(x))
  }
  return out
}

// ---------- Building it ----------

export interface NorthStarStatus {
  running: boolean
  startedAt?: number
  error?: string
}

let draft: { ns: NorthStar; note: string; files: BuildFile[]; notePath: string; estimate: string; saved: number; shared: number } | null = null
let status: NorthStarStatus = { running: false }

/** The model that weaves the map: Opus when Claude can, else Gemma; Tide's own map when neither answers */
export type Asker = (job: 'northStar' | 'northStarReview', prompt: string, system: string) => Promise<{ text: string; by: 'claude' | 'gemma' }>

const realAsk: Asker = async (job, prompt, system) => {
  const { completeFor, jobRoute } = await import('./ai')
  const route = await jobRoute(job).catch(() => ({ who: 'gemma' as const }))
  // Opus thinking hard over every roadmap can take several minutes
  const text = await completeFor(job, prompt, system, { priority: 'interactive', timeoutMs: job === 'northStar' ? 15 * 60_000 : 6 * 60_000 })
  return { text, by: route.who === 'claude' ? 'claude' : 'gemma' }
}
let ask: Asker = realAsk
export const setNorthStarAsker = (fn: Asker | null) => (ask = fn ?? realAsk)

/** The goal Tide guesses for the form: your goals' titles, else the coach's sense of your direction */
export async function suggestedGoal(): Promise<{ goal: string; hoursPerWeek: number; notePath?: string }> {
  const { getCoach } = await import('./coach')
  const coach = await getCoach().catch(() => null)
  const note = await goalNote()
  if (note) return { goal: note, hoursPerWeek: coach?.hoursPerWeek ?? 10, notePath: GOAL_NOTE }
  const goals = await import('./goals').then((g) => g.loadGoals()).catch(() => null)
  const titles = (goals?.goals ?? []).map((g) => g.title)
  return { goal: titles.length ? titles.join('. ') : (coach?.direction ?? ''), hoursPerWeek: coach?.hoursPerWeek ?? 10 }
}

/** The preview's text and files, from a map */
async function preview(ns: NorthStar): Promise<NonNullable<typeof draft>> {
  const cat = await catalogue()
  const { groups } = await sharedGroups(northStarTracks(ns))
  // Code's own shared topics fill in when the model named few
  if (ns.shared.length < 8) {
    const have = new Set(ns.shared.map((s) => bare(s.topic)))
    for (const g of groups.slice(0, 16 - ns.shared.length)) if (!have.has(bare(g.title))) ns.shared.push({ topic: g.title, tracks: [...new Set(g.members.map((m) => m.track))] })
  }
  const store = (await loadStore()) ?? { ...EMPTY, createdAt: Date.now() }
  const g: Gathered = { ns, store, cat, topics: await topicsOf(cat.filter((c) => northStarTracks(ns).includes(c.name))), concept: () => undefined, checked: new Set(), groups }
  const all = new Map((await concepts()).map((c) => [c.id, c]))
  const credited = creditShared(all, all, siblingIndex(groups), [...g.topics.values()].flat().map((t) => t.id))
  g.concept = (id) => credited.get(id)
  const pace = paceOf(ns.hoursPerWeek, await minutesByWeek())
  const est = estimates(ns, await hoursLeft(g), pace.hours, today())
  const note = toNote(ns, { estimates: Object.fromEntries(Object.entries(est.stages).map(([k, v]) => [k, v.text])), totalEstimate: est.text })
  const existing = new Set<string>()
  for (const p of [NOTE_PATH, ...[2, 3, 4, 5].map((i) => NOTE_PATH.replace(/\.md$/, ` ${i}.md`)), STORE, ...cat.filter((c) => c.file).map((c) => `Roadmaps/${c.file}`)]) if (await exists(p)) existing.add(p)
  const built = buildFiles(ns, cat, existing)
  return { ns, note, files: built.files, notePath: built.note, estimate: est.text, saved: hoursSaved(groups), shared: groups.length }
}

/**
 * Weaves the map (minutes, with Opus thinking hard): the result is a draft to preview; nothing is
 * written to the vault until you build it.
 */
export async function synthesise(input: { goal: string; hoursPerWeek?: number }): Promise<NonNullable<typeof draft>> {
  const note = await goalNote()
  const typed = String(input.goal ?? '').trim().slice(0, 3000)
  // The note is the primary input; what's typed only adds to it
  const goal = typed && !note.includes(typed.slice(0, 200)) ? typed : note ? '' : typed
  if (!goal && !note) throw new Error('Say what you’re aiming for, in your own words.')
  if (status.running) throw new Error('Already thinking it through.')
  status = { running: true, startedAt: Date.now() }
  try {
    const hoursPerWeek = Math.max(1, Math.min(80, Math.round(Number(input.hoursPerWeek) || (await suggestedGoal()).hoursPerWeek)))
    const cat = await catalogue()
    const all = await concepts()
    const { groups } = await sharedGroups(cat.map((c) => c.name))
    const profile = await import('./learnerProfile').then((m) => m.profileDigest()).catch(() => '')
    const pace = paceOf(hoursPerWeek, await minutesByWeek())
    const prompt = synthesisPrompt({ goal, ...(note ? { goalNote: note } : {}), today: today(), hoursPerWeek, ...(pace.measured ? { measuredHours: pace.hours } : {}), catalogue: cat, known: knownText(all), profile, shared: groups.slice(0, 40).map((g) => ({ topic: g.title, tracks: [...new Set(g.members.map((m) => m.track))] })) })
    let ns: NorthStar | null = null
    try {
      const out = await ask('northStar', prompt, SYNTH_SYSTEM)
      const { extractJsonObject } = await import('./ai')
      ns = parseSynthesis(extractJsonObject(out.text), cat, { today: today(), hoursPerWeek, goal: goal || firstPara(note), by: out.by })
    } catch (e) {
      console.warn(`[northstar] synthesis: ${(e as Error).message}`)
    }
    ns ??= heuristicNorthStar(cat, { goal: goal || firstPara(note), today: today(), hoursPerWeek })
    draft = await preview(ns)
    return draft
  } catch (e) {
    status = { running: false, error: (e as Error).message }
    throw e
  } finally {
    if (status.running) status = { running: false }
  }
}

/** The goal note's goal: the paragraph under "The goal", else its first paragraph */
function firstPara(note: string): string {
  const under = note.match(/##\s*(the )?goal\s*\n+([\s\S]*?)(\n##|$)/i)?.[2]
  return (under ?? note.split(/\n\s*\n/).find((p) => p.trim() && !/^#/.test(p.trim())) ?? '').trim().slice(0, 900)
}

export const synthStatus = () => ({ ...status, ...(draft ? { draft: true } : {}) })
export const currentDraft = () => draft
export const discardDraft = () => void (draft = null)

/**
 * The map's ready roadmaps as tracks: each one already in the vault is registered as it is (no copy,
 * no sidebar notebook); the given stage's that aren't there yet are written into the hidden
 * Roadmaps folder, new files only.
 */
async function installFor(ns: NorthStar, n: number): Promise<string[]> {
  const { ROADMAP_TEXT } = await import('./finance/roadmaps')
  const cat = await catalogue()
  const wrote: string[] = []
  const tracks: NorthStarStore['tracks'] = {}
  for (const c of toInstall(ns, n, cat)) {
    const path = `Roadmaps/${c.file}`
    if (await writeNew(path, ROADMAP_TEXT[c.file!] ?? '')) wrote.push(path)
    tracks[c.name] = { outline: path, file: c.file!, at: Date.now() }
  }
  // Already in the Roadmaps folder but no notebook uses it: registered as the track, left as it is
  for (const t of ns.stages.flatMap((s) => s.tracks)) {
    const c = cat.find((x) => x.name === t.track)
    if (c?.source === 'ready' && c.outline && !tracks[c.name]) {
      const { getNotebooks } = await import('./learn')
      const owned = (await getNotebooks().catch(() => [])).some((nb) => nb.outline === c.outline && !nb.virtual)
      if (!owned) tracks[c.name] = { outline: c.outline, file: c.file!, at: Date.now() }
    }
  }
  if (Object.keys(tracks).length) await update((s) => ({ ...s, tracks: { ...tracks, ...s.tracks } }))
  return wrote
}

/** Writes the draft: the note, the first stage's ready roadmaps and Tide's record. Never over an existing file */
export async function build(): Promise<{ notePath: string; wrote: string[]; tracks: string[]; week: boolean }> {
  if (!draft) throw new Error('Nothing to build: think it through first.')
  const d = draft
  const wrote: string[] = []
  if (!(await writeNew(d.notePath, d.note))) throw new Error(`${d.notePath} appeared meanwhile; nothing was written. Try again.`)
  wrote.push(d.notePath)
  const store: NorthStarStore = { ...EMPTY, notePath: d.notePath, written: d.note, createdAt: Date.now(), stageSince: Date.now(), goalHash: hash(await goalNote()), lastReview: Date.now() }
  // An earlier record is kept beside it, never overwritten
  if (!(await writeNew(STORE, JSON.stringify(store, null, 1)))) {
    const prev = await readText(STORE).catch(() => '')
    await writeNew(`.tide/northstar.before-${Date.now()}.json`, prev)
    await writeText(STORE, JSON.stringify(store, null, 1))
  } else wrote.push(STORE)
  activeCache = null
  wrote.push(...(await installFor(d.ns, d.ns.current)))
  draft = null
  resetNorthStar()
  await syncTargets(true).catch((e) => console.warn(`[northstar] targets: ${(e as Error).message}`))
  const tracks = Object.keys((await loadStore())?.tracks ?? {})
  // Start right away: this week planned from the first stage
  const week = await import('./coach')
    .then((c) => c.planWeek())
    .then(() => true)
    .catch((e) => (console.warn(`[northstar] first week: ${(e as Error).message}`), false))
  return { notePath: d.notePath, wrote, tracks, week }
}

// ---------- Changing it ----------

/** Rewrites the note from a changed map, keeping the learner's notes and unknown sections; remembers what was written */
async function writeMap(ns: NorthStar): Promise<void> {
  const store = await loadStore()
  if (!store) throw new Error('There is no North Star yet.')
  const g = await gather(ns, store)
  const pace = paceOf(ns.hoursPerWeek, await minutesByWeek())
  const est = estimates(ns, await hoursLeft(g), pace.hours, today())
  const note = toNote(ns, { estimates: Object.fromEntries(Object.entries(est.stages).map(([k, v]) => [k, v.text])), totalEstimate: est.text })
  await writeText(store.notePath, note)
  await update((s) => ({ ...s, written: note }))
  activeCache = null
}

export async function decide(id: string, ok: boolean): Promise<NorthStarView | null> {
  const r = await readMap()
  if (!r.ns || !r.store) return null
  const p = r.store.proposals.find((x) => x.id === id)
  if (!p) return view()
  if (ok) {
    const next = applyProposal(r.ns, p, today())
    await writeMap(next)
    if (p.kind === 'advance') {
      await installFor(next, p.to)
      await update((s) => ({ ...s, stageSince: Date.now() }))
    }
  } else {
    // The note's Changes keep the rejection too
    await writeMap({ ...r.ns, log: [...r.ns.log, { date: today(), text: `Rejected: ${p.text}` }] })
  }
  await update((s) => ({ ...s, proposals: s.proposals.filter((x) => x.id !== id), decided: [...s.decided, { key: proposalKey(p), at: Date.now(), ok, text: p.text }].slice(-60) }))
  if (ok) {
    syncSoon()
    void import('./goals').then((m) => m.replanNow()).catch(() => {})
  }
  return view()
}

/** You move on to the next stage before its gate passes: recorded in the note */
export async function moveOn(): Promise<NorthStarView | null> {
  const r = await readMap()
  if (!r.ns) return null
  const i = r.ns.stages.findIndex((s) => s.n === r.ns!.current)
  const next = r.ns.stages[i + 1]
  if (!next) return view()
  const ns = { ...r.ns, current: next.n, log: [...r.ns.log, { date: today(), text: `Moved on to stage ${next.n} before stage ${r.ns.current}’s gate passed` }] }
  await writeMap(ns)
  await installFor(ns, next.n)
  await update((s) => ({ ...s, stageSince: Date.now() }))
  syncSoon()
  return view()
}

/** You say a key topic is at a depth (research can only be confirmed, never measured) */
export async function confirmDepth(topic: string, depth: number): Promise<NorthStarView | null> {
  await update((s) => ({ ...s, confirmed: { ...s.confirmed, [bare(topic)]: Math.max(0, Math.min(6, Math.round(depth))) } }))
  return view()
}

/** Starts the current stage's capstone as a project planned from its brief */
export async function startCapstone(): Promise<{ notebook: string } | null> {
  const ns = await activeNorthStar()
  const store = await loadStore()
  if (!ns || !store) return null
  const have = store.capstones[String(ns.current)]
  if (have) return { notebook: have.notebook }
  const s = ns.stages.find((x) => x.n === ns.current)!
  const { draftPlan, createProject } = await import('./ideaProjects')
  const { phaseTier } = await import('@shared/track')
  const idea = `${s.capstone.title}. ${s.capstone.brief} It is the capstone of stage ${s.n} ("${s.title}") of the learner's North Star, joining ${s.capstone.joins.join(', ')}; it should use what that stage taught: ${s.tracks.map((t) => `${t.track} (${t.scope.slice(0, 4).join('; ')})`).join('; ')}.`
  const { plan } = await draftPlan({ idea, answers: [], source: 'model' })
  const made = await createProject({ ...plan, tier: phaseTier(ns.stages.indexOf(s), ns.stages.length) })
  await update((st) => ({ ...st, capstones: { ...st.capstones, [String(s.n)]: { notebook: made.notebook, title: s.capstone.title } } }))
  return { notebook: made.notebook }
}

/** Adds the roadmaps the current stage needs that aren't in the vault yet (new files only) */
export async function installCurrent(): Promise<string[]> {
  const ns = await activeNorthStar()
  if (!ns) return []
  const wrote = await installFor(ns, ns.current)
  sharedCache = null
  return wrote
}

// ---------- The weekly check ----------

let reviewing: Promise<unknown> | null = null

/**
 * Opus checks the map against progress (and your edits) and proposes at most three small changes;
 * code's own check (advance when the gate passes, lift a starved track) when no model answers.
 */
export async function review(force = false): Promise<NorthStarView | null> {
  if (reviewing) return reviewing.then(() => view())
  const run = (async () => {
    const r = await readMap()
    if (!r.ns || !r.store) return
    if (!force && r.store.lastReview && Date.now() - r.store.lastReview < 6.5 * DAY) return
    const g = await gather(r.ns, r.store)
    const p = await progressOfStage(g, r.ns.current)
    const stage = r.ns.stages.find((s) => s.n === r.ns!.current)!
    const minutes = await minutesByTrack(stage.tracks.map((t) => t.track))
    const pace = paceOf(r.ns.hoursPerWeek, await minutesByWeek())
    const rejected = r.store.decided.filter((d) => !d.ok).map((d) => d.text)
    const note = await readText(r.store.notePath).catch(() => r.store!.written)
    const goal = await goalNote()
    const goalEdited = !!r.store.goalHash && hash(goal) !== r.store.goalHash
    let summary = ''
    let proposals: Proposal[] = []
    let by: NorthStarStore['reviewBy'] = 'tide'
    try {
      const out = await ask('northStarReview', reviewPrompt({ note, today: today(), progress: p, minutes, pace: pace.hours, edited: r.edited, rejected, ...(goal ? { goalNote: goal, goalEdited } : {}) }), REVIEW_SYSTEM)
      const { extractJsonObject } = await import('./ai')
      const parsed = parseProposals(extractJsonObject(out.text), r.ns, g.cat)
      summary = parsed.summary
      proposals = parsed.proposals
      by = out.by
    } catch {
      proposals = heuristicProposals(r.ns, p, minutes)
    }
    const decidedKeys = new Set(r.store.decided.map((d) => d.key))
    const pending = new Set(r.store.proposals.map(proposalKey))
    const fresh = proposals.filter((x) => !decidedKeys.has(proposalKey(x)) && !pending.has(proposalKey(x)))
    await update((s) => ({ ...s, proposals: [...s.proposals, ...fresh].slice(-6), lastReview: Date.now(), reviewSummary: summary, reviewBy: by, goalHash: hash(goal) }))
  })()
  reviewing = run.finally(() => (reviewing = null))
  await run
  return view()
}

/** The check, if a week has passed (the hourly catch-up calls this) */
export async function weeklyCheck(): Promise<void> {
  const s = await loadStore()
  if (!s || (s.lastReview && Date.now() - s.lastReview < 6.5 * DAY)) return
  await review(true).catch(() => {})
}

// ---------- The view ----------

export interface NorthStarView {
  ns: NorthStar
  notePath: string
  edited: boolean
  /** Your goal note changed since the map was last planned from it */
  goalEdited?: boolean
  goalPath?: string
  error?: string
  stages: { n: number; title: string; state: 'passed' | 'current' | 'next'; estimate?: string; start?: string; end?: string; hoursLeft?: number }[]
  progress: StageProgress
  estimate: string
  pace: { hours: number; measured: boolean }
  /** The current stage's tracks, with what isn't installed yet */
  missing: string[]
  minutes: Record<string, number>
  shared: { groups: number; saved: number; top: { topic: string; tracks: string[] }[] }
  proposals: Proposal[]
  review?: { at: number; summary?: string; by?: string }
  capstone?: { notebook: string; title: string }
}

export async function view(): Promise<NorthStarView | null> {
  const r = await readMap()
  if (!r.ns || !r.store) return null
  const ns = r.ns
  const g = await gather(ns, r.store)
  const p = await progressOfStage(g, ns.current)
  const pace = paceOf(ns.hoursPerWeek, await minutesByWeek())
  const left = await hoursLeft(g)
  const est = estimates(ns, left, pace.hours, today())
  const cur = ns.stages.findIndex((s) => s.n === ns.current)
  const stage = ns.stages[cur]
  return {
    ns,
    notePath: r.store.notePath,
    edited: r.edited,
    ...(await goalNote().then((g) => (g ? { goalPath: GOAL_NOTE, goalEdited: !!r.store!.goalHash && hash(g) !== r.store!.goalHash } : {}))),
    ...(r.error ? { error: r.error } : {}),
    stages: ns.stages.map((s, i) => ({ n: s.n, title: s.title, state: i < cur ? 'passed' : i === cur ? 'current' : 'next', ...(est.stages[s.n] ? { estimate: durationWords(est.stages[s.n].weeks), start: est.stages[s.n].start, end: est.stages[s.n].end, hoursLeft: Math.round(left[s.n] ?? 0) } : {}) })),
    progress: p,
    estimate: durationWords(est.weeks),
    pace,
    missing: stage.tracks.filter((t) => !g.topics.has(t.track) || !g.cat.find((c) => c.name === t.track)?.outline).map((t) => t.track),
    minutes: await minutesByTrack(stage.tracks.map((t) => t.track)),
    shared: { groups: g.groups.length, saved: hoursSaved(g.groups), top: ns.shared.slice(0, 12) },
    proposals: r.store.proposals,
    ...(r.store.lastReview ? { review: { at: r.store.lastReview, summary: r.store.reviewSummary, by: r.store.reviewBy } } : {}),
    ...(r.store.capstones[String(ns.current)] ? { capstone: r.store.capstones[String(ns.current)] } : {})
  }
}

/** One line for Your week and Learn: where you are on the map */
export async function glance(): Promise<{ stage: number; of: number; title: string; tracks: { track: string; weight: number }[]; solid: number; total: number; step: StageProgress['step']; proposals: number } | null> {
  const ns = await activeNorthStar()
  const store = await loadStore()
  if (!ns || !store) return null
  const s = ns.stages.find((x) => x.n === ns.current)!
  const g = await gather(ns, store)
  const p = await progressOfStage(g, ns.current)
  return { stage: ns.stages.indexOf(s) + 1, of: ns.stages.length, title: s.title, tracks: s.tracks.map((t) => ({ track: t.track, weight: t.weight })), solid: p.solid, total: p.total, step: p.step, proposals: store.proposals.length }
}

// ---------- The scheduler's queues: learned once, and deep topics taken deeper ----------

/**
 * The week's topic queues, adjusted for the map: a topic whose twin in another roadmap is solid,
 * or is already earlier in another queue, is left out (learned once, credited to all); a key topic
 * that is solid but not yet at its depth comes back first, to go deeper, at most two a track.
 */
export async function adjustQueues<T extends { notebook: string; topic: string; topicId?: string; section: string; why?: string; refresh?: boolean }>(byNotebook: Map<string, T[]>): Promise<Map<string, T[]>> {
  const ns = await activeNorthStar()
  if (!ns) return byNotebook
  const { siblings } = await sharedGroups()
  const all = new Map((await concepts()).map((c) => [c.id, c]))
  const planned = new Set<string>()
  const out = new Map<string, T[]>()
  for (const [nb, list] of byNotebook) {
    const kept: T[] = []
    for (const c of list) {
      const sib = c.topicId ? (siblings.get(c.topicId) ?? []) : []
      if (sib.some((s) => all.get(s)?.status === 'solid' || planned.has(s))) continue
      if (c.topicId) planned.add(c.topicId)
      kept.push(c)
    }
    out.set(nb, kept)
  }
  const stage = ns.stages.find((s) => s.n === ns.current)
  if (stage?.deep.length) {
    const cat = await catalogue()
    const topics = await topicsOf(cat.filter((c) => stage.tracks.some((t) => t.track === c.name)))
    for (const st of stage.tracks) {
      const inScope = (topics.get(st.track) ?? []).filter((t) => !t.project && t.path.some((p) => st.scope.some((x) => bare(x) === bare(p))))
      const deeper: T[] = []
      for (const k of stage.deep) {
        for (const t of keyTopicsIn(k, inScope)) {
          const c = all.get(t.id)
          const have = measuredDepth(c)
          if (!have || have >= k.depth || deeper.length >= 2) continue
          deeper.push({ notebook: st.track, topic: t.title.replace(/\*\*/g, ''), topicId: t.id, section: t.section, refresh: true, why: `Deeper: from ${['', 'recall', 'explain', 'apply', 'transfer', 'build', 'research'][have]} to ${['', 'recall', 'explain', 'apply', 'transfer', 'build', 'research'][k.depth as Depth]} (key topic of stage ${stage.n})` } as T)
        }
      }
      if (deeper.length) out.set(st.track, [...deeper, ...(out.get(st.track) ?? []).filter((c) => !deeper.some((d) => d.topicId === c.topicId))])
    }
  }
  return out
}
