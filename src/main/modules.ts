/**
 * Modules and tracks in the vault (shared/modules says what they are), and the switch to them.
 *
 * Reading: `Roadmaps/Modules/*.md` and `Roadmaps/Tracks/*.md`, cached briefly. A notebook whose
 * entry in .tide/notebooks.json names a `track` is that track: its topics are its modules' topics
 * (`notebookTopics`), its gates the modules' gates over the DAG (`moduleState`). A vault without
 * Roadmaps/Modules, or one that hasn't switched, works exactly as before: nothing here is asked.
 *
 * The switch ("Switch to modules", never automatic): the plan from `_moves.json`
 * (shared/moduleMigration), a full backup of .tide and the files it touches in
 * .tide/backups/pre-modules-<ts>/ first, then every id rewritten to its new home. The old roadmap
 * files are never touched. "Switch back" restores the backup, keeping what was learnt since.
 */
import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { createRequire } from 'module'
import { dirname } from 'path'
import type { RoadmapTopic } from '@shared/curriculum'
import { roadmapTopics } from '@shared/curriculum'
import { AI_TRACK, applyQueue, arrange, checkProject, parseSuggestions, projectMarkdown, projectNeeds, projectPath, suggestPrompt, type ProjectsPageView, type QueueAction, type SuggestedProject } from '@shared/projectQueue'
import type { ConceptState } from '@shared/knowledge'
import {
  checkDag,
  dependents,
  moduleById,
  moduleGates,
  moduleParts,
  moduleRecordKey,
  moduleRow,
  moduleTopics,
  orphanModules,
  parseModule,
  parseProject,
  parseTrack,
  projectState,
  PROJECTS_DIR,
  type ProjectDef,
  type ProjectRow,
  topoOrder,
  moduleValue,
  paceFactor,
  trackModules,
  tracksOfModule,
  MODULES_DIR,
  TRACKS_DIR,
  type Catalogue,
  type ModuleDef,
  type ModuleGate,
  type ModuleRecords,
  type TrackDef,
  type TrackModulesView
} from '@shared/modules'
import {
  carryLines,
  fileCovered,
  homesOf,
  idMapper,
  migrateKnowledge,
  planMoves,
  remapNorthStar,
  remapScope,
  rewriteDeep,
  type KFile,
  type MovePlan,
  type SwitchVerification,
  type MovePreview,
  type Moves,
  type OldRoadmap
} from '@shared/moduleMigration'
import { emptyTrack, type CapstoneState, type TracksStore } from '@shared/track'
import { absPath, readText, vaultRoot, writeText } from './vault'

// ---------- Reading ----------

let cache: { at: number; root: string; cat: Catalogue | null } | null = null
export const resetModules = () => {
  cache = null
  stateCache = null
}

async function mdFiles(dir: string): Promise<string[]> {
  const names = await fs.readdir(absPath(dir)).catch(() => [] as string[])
  return names.filter((n) => n.endsWith('.md') && !n.startsWith('_')).sort().map((n) => `${dir}/${n}`)
}

/** The modules and tracks in the vault; null when there is no Roadmaps/Modules (cached for 20 s) */
export async function loadCatalogue(fresh = false): Promise<Catalogue | null> {
  let root = ''
  try {
    root = vaultRoot()
  } catch {
    return null
  }
  if (!fresh && cache && cache.root === root && Date.now() - cache.at < 20_000) return cache.cat
  let cat: Catalogue | null = null
  if (existsSync(absPath(MODULES_DIR))) {
    const modules: ModuleDef[] = []
    for (const p of await mdFiles(MODULES_DIR)) {
      const m = parseModule(p, await readText(p).catch(() => ''))
      if (m) modules.push(m)
    }
    const tracks: TrackDef[] = []
    for (const p of await mdFiles(TRACKS_DIR)) {
      const t = parseTrack(p, await readText(p).catch(() => ''))
      if (t) tracks.push(t)
    }
    // A module no track lists is shown in its home track, so nothing goes missing
    for (const m of orphanModules({ modules, tracks })) {
      const home = tracks.find((t) => t.id === m.track)
      if (home) home.modules.push(m.id)
    }
    const projects: ProjectDef[] = []
    for (const p of await mdFiles(PROJECTS_DIR)) {
      const x = parseProject(p, await readText(p).catch(() => ''))
      if (x) projects.push(x)
    }
    cat = { modules, tracks, projects }
  }
  cache = { at: Date.now(), root, cat }
  return cat
}

/** Where `_moves.json` is: beside the modules, or in Roadmaps */
const MOVES_AT = ['Roadmaps/_moves.json', `${MODULES_DIR}/_moves.json`, 'Roadmaps/Tracks/_moves.json']

export async function loadMoves(): Promise<Moves | null> {
  for (const p of MOVES_AT) {
    const text = await readText(p).catch(() => null)
    if (text === null) continue
    try {
      return JSON.parse(text) as Moves
    } catch {
      return null
    }
  }
  return null
}

type NotebookLike = { name: string; path: string; outline?: string; track?: string }

/** The track a notebook is, when it is one */
export async function trackOf(nb: Pick<NotebookLike, 'track'> | undefined | null): Promise<{ cat: Catalogue; track: TrackDef } | null> {
  if (!nb?.track) return null
  const cat = await loadCatalogue()
  const track = cat?.tracks.find((t) => t.id === nb.track)
  return cat && track ? { cat, track } : null
}

/** A track's modules in plan order: after what they require, the most valuable first */
export function planOrder(cat: Catalogue, track: TrackDef): ModuleDef[] {
  const mods = trackModules(cat, track)
  const fan = dependents(cat.modules)
  // Everything the track's modules require, from any track, comes first in its own track; here only the track's own
  return topoOrder(mods, (m) => moduleValue(m, fan.get(m.id) ?? 0))
}

/**
 * Every topic of a notebook: its roadmap's, or for a track its modules' in plan order (each
 * topic's id the module's, so a shared module's topics are the same in every track).
 */
export async function notebookTopics(nb: NotebookLike): Promise<RoadmapTopic[]> {
  const t = await trackOf(nb)
  if (t) return planOrder(t.cat, t.track).flatMap((m) => moduleTopics(m, nb.name))
  if (!nb.outline) return []
  return roadmapTopics(nb.name, await readText(nb.outline).catch(() => ''))
}

/** A track's topics the scheduler may plan now: not in a locked module, not in a part still waiting for the one before */
export async function openTopics(nb: NotebookLike): Promise<RoadmapTopic[]> {
  const all = await notebookTopics(nb)
  if (!nb.track) return all
  const gates = await moduleState()
  if (!gates) return all
  const { moduleHeld } = await import('@shared/modules')
  const held = moduleHeld(gates)
  return all.filter((t) => !held.has(t.id))
}

/** Whether a notebook's topics come from modules */
export const isTrack = (nb: Pick<NotebookLike, 'track'> | undefined | null) => !!nb?.track

/** Which module a topic is in, by id (any track) */
export async function moduleOfTopic(id: string): Promise<ModuleDef | null> {
  const cat = await loadCatalogue()
  if (!cat) return null
  for (const m of cat.modules) if (id.startsWith(`${m.id.replace(/-/g, ' ')}::`)) return m
  return null
}

/** Ticks topics in their module files (only those lines' boxes change); returns how many changed */
export async function tickModuleTopics(ids: string[], done: boolean): Promise<number> {
  const cat = await loadCatalogue()
  if (!cat || !ids.length) return 0
  const want = new Set(ids)
  let changed = 0
  const box = /^(\s*[-*+]\s+\[)([ xX])(\])/
  for (const m of cat.modules) {
    const hits = moduleTopics(m).filter((t) => want.has(t.id) && t.checked !== done)
    if (!hits.length) continue
    const md = await readText(m.path)
    const fm = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
    const offset = fm ? fm[0].split('\n').length - 1 : 0
    const lines = md.split('\n')
    let n = 0
    for (const t of hits) {
      const at = offset + t.line
      if (!box.test(lines[at] ?? '') || !lines[at].includes(t.title.slice(0, 24))) continue
      lines[at] = lines[at].replace(box, `$1${done ? 'x' : ' '}$3`)
      n++
    }
    if (n) {
      await writeText(m.path, lines.join('\n'))
      changed += n
    }
  }
  if (changed) resetModules()
  return changed
}

// ---------- Gates over the DAG ----------

let stateCache: { at: number; gates: Map<string, ModuleGate> } | null = null

/** Every module's gate, from the knowledge map and the records (cached for half a minute) */
export async function moduleState(o: { concepts?: ConceptState[]; store?: TracksStore; fresh?: boolean } = {}): Promise<Map<string, ModuleGate> | null> {
  const cat = await loadCatalogue()
  if (!cat) return null
  if (!o.fresh && !o.concepts && !o.store && stateCache && Date.now() - stateCache.at < 30_000) return stateCache.gates
  const concepts = o.concepts ?? (await import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[]))
  const store = o.store ?? (await import('./track').then((t) => t.loadTracks()).catch(() => null))
  const records: ModuleRecords = { parts: {}, there: store?.modules?.there ?? {} }
  for (const m of cat.modules) records.parts[moduleRecordKey(m.id)] = store?.tracks[moduleRecordKey(m.id)] ?? emptyTrack()
  const byId = new Map(concepts.map((c) => [c.id, c]))
  // A part's capstone: its own project line (ticked when built); a module without one needs none
  const caps = (m: ModuleDef): Record<string, CapstoneState> => Object.fromEntries(moduleParts(m).map((p) => [p.id, { needed: p.projects.length > 0, done: p.projects.length > 0 && p.projects.every((x) => x.checked) }]))
  const gates = moduleGates(cat.modules, (m) => moduleParts(m), byId, records, caps)
  if (!o.concepts && !o.store) stateCache = { at: Date.now(), gates }
  return gates
}

/** The learner's pace against the modules' stated hours, over the last eight weeks (shared/modules paceFactor) */
export async function measuredPace(): Promise<{ factor: number; measured: boolean; weeks: number }> {
  const cat = await loadCatalogue()
  if (!cat) return { factor: 1, measured: false, weeks: 0 }
  const since = Date.now() - 56 * 86_400_000
  const { getNotebooks, focusLog } = await import('./learn')
  const tracks = (await getNotebooks().catch(() => [])).filter((n) => n.track)
  const log = await focusLog(since).catch(() => [])
  const studied = log.filter((e) => e.path && tracks.some((n) => e.path === n.path || e.path!.startsWith(`${n.path}/`))).reduce((n, e) => n + e.minutes, 0) / 60
  const each = new Map<string, number>()
  for (const m of cat.modules) {
    const ts = moduleTopics(m).filter((t) => !t.project)
    for (const t of ts) each.set(t.id, (m.hours || ts.length * 2.5) / Math.max(1, ts.length))
  }
  const concepts = await import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[])
  const solid = concepts.filter((c) => c.madeSolid && c.madeSolid >= since && each.has(c.id)).map((c) => ({ hoursEach: each.get(c.id)!, at: c.madeSolid! }))
  const first = Math.min(...log.map((e) => e.start), ...solid.map((s) => s.at), Date.now())
  return paceFactor({ studiedHours: studied, solid, days: (Date.now() - first) / 86_400_000 })
}

/** "I'm there" on a module, or taken back */
export async function setThere(id: string, on: boolean, note?: string): Promise<void> {
  const { updateModules } = await import('./track')
  await updateModules((m) => {
    const there = { ...m.there }
    if (on) there[id] = { at: Date.now(), ...(note?.trim() ? { note: note.trim().slice(0, 200) } : {}) }
    else delete there[id]
    return { ...m, there }
  })
  stateCache = null
}

/** A track's page: its modules with progress, gate and requires */
export async function trackView(notebook: string): Promise<TrackModulesView | null> {
  const { getNotebooks } = await import('./learn')
  const nb = (await getNotebooks().catch(() => [])).find((n) => n.name === notebook || n.path === notebook)
  const t = await trackOf(nb)
  if (!t) return null
  const gates = await moduleState()
  if (!gates) return null
  const byId = moduleById(t.cat)
  const fan = dependents(t.cat.modules)
  const rows = planOrder(t.cat, t.track).map((m) => moduleRow(gates.get(m.id)!, { byId, gates, shared: tracksOfModule(t.cat, m.id).filter((x) => x.id !== t.track.id).map((x) => x.title), fanOut: fan.get(m.id) ?? 0 }))
  const pace = await measuredPace().catch(() => ({ factor: 1, measured: false, weeks: 0 }))
  if (pace.measured) for (const r of rows) r.hoursLeft = Math.round(r.hoursLeft * pace.factor)
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0)
  const projects = (await projectsView({ track: t.track.id }).catch(() => [])).map((p) => ({ id: p.id, title: p.title, ...(p.notebook ? { notebook: p.notebook } : {}), ...(p.next ? { next: p.next } : {}), done: p.done, of: p.milestones.length, milestones: p.milestones.map(({ id, title, status, waiting }) => ({ id, title, status, waiting })) }))
  return {
    track: { id: t.track.id, title: t.track.title, ...(t.track.about ? { about: t.track.about } : {}) },
    pace,
    projects,
    modules: rows,
    totals: { modules: rows.length, passed: rows.filter((r) => r.status === 'passed').length, open: rows.filter((r) => r.status === 'open' || r.status === 'active').length, locked: rows.filter((r) => r.status === 'locked').length, hours: sum((r) => r.hours), hoursLeft: sum((r) => r.hoursLeft), solid: sum((r) => r.solid), topics: sum((r) => r.total) },
    issues: checkDag(t.cat).filter((i) => (i.kind === 'missing' ? t.track.modules.includes(i.module) || i.module === t.track.id : i.kind === 'cycle' ? i.modules.some((x) => t.track.modules.includes(x)) : i.kind === 'duplicate-topic' ? i.modules.some((x) => t.track.modules.includes(x)) : false))
  }
}

// ---------- Projects: built from day one ----------

export type { ProjectRow } from '@shared/modules'

/** Each vault project's state: milestones built (from its Projects plan, in order), open, or waiting on modules */
export async function projectsView(o: { track?: string } = {}): Promise<ProjectRow[]> {
  const cat = await loadCatalogue()
  if (!cat?.projects?.length) return []
  const gates = (await moduleState()) ?? new Map()
  const links = (await import('./track').then((t) => t.loadTracks()).catch(() => null))?.modules?.projects ?? {}
  const { readPlan } = await import('./ideaProjects')
  const out: ProjectRow[] = []
  for (const p of cat.projects) {
    if (o.track && !p.tracks.includes(o.track)) continue
    const link = links[p.id]
    const plan = link ? await readPlan(link.notebook).catch(() => null) : null
    // The Projects plan's milestones are the project's, in the same order
    const done = new Set(p.milestones.filter((m, i) => plan?.milestones[i]?.status === 'done' || plan?.milestones.find((x) => x.title === m.title)?.status === 'done').map((m) => m.id))
    const st = projectState(p, gates, done)
    // The AI track may have no Tracks file of its own: it is called AI
    const trackIds = [...new Set(p.tracks)]
    out.push({ id: p.id, title: p.title, tracks: trackIds.map((t) => cat.tracks.find((x) => x.id === t)?.title ?? (t === AI_TRACK ? 'AI' : t)), trackIds, ...(p.about ? { about: p.about } : {}), ...(plan ? { notebook: link!.notebook } : {}), milestones: st.milestones.map((m, i) => ({ ...m, needs: p.milestones[i]?.needs ?? [] })), ...(st.next ? { next: { id: st.next.id, title: st.next.title, hours: st.next.hours || 10 } } : {}), done: done.size, ...(p.level ? { level: p.level } : {}) })
  }
  return out
}

/**
 * A vault project set up in Projects, so its levels, ready check and mentor are the ones Tide
 * already has: planned from its description (Claude when there, else the template or a blank plan),
 * its milestones the project's own.
 */
export async function startProject(id: string): Promise<{ notebook: string }> {
  const cat = await loadCatalogue()
  const p = cat?.projects?.find((x) => x.id === id)
  if (!p) throw new Error('That project is gone from Roadmaps/Projects.')
  const store = await import('./track').then((t) => t.loadTracks())
  const had = store.modules?.projects?.[id]
  if (had) return { notebook: had.notebook }
  const { draftPlan, createProject } = await import('./ideaProjects')
  const idea = `${p.title}. ${p.about ?? ''} Milestones: ${p.milestones.map((m, i) => `${i + 1}. ${m.title}${m.about ? ` (${m.about})` : ''}`).join('; ')}.`
  const { plan } = await draftPlan({ idea, answers: [], source: 'model' })
  const base = plan.milestones[0]
  const own = base
    ? { ...plan, name: p.title, milestones: p.milestones.slice(0, 12).map((m, i) => ({ ...(plan.milestones[i] ?? base), id: plan.milestones[i]?.id ?? `${base.id}-${i + 1}`, title: m.title, ...(m.about ? { build: m.about } : {}), hours: Math.max(1, Math.min(60, m.hours || plan.milestones[i]?.hours || 8)), status: 'todo' as const })) }
    : plan
  const made = await createProject({ ...own, ...(p.level ? { tier: p.level as 1 | 2 | 3 | 4 } : {}) }).catch(() => createProject(plan))
  const { updateModules } = await import('./track')
  await updateModules((m) => ({ ...m, projects: { ...(m.projects ?? {}), [id]: { notebook: made.notebook, at: Date.now() } } }))
  return { notebook: made.notebook }
}

export const PROJECTS_GOAL = 'projects'
/** An unset-up project's thread ref (once set up, its Projects notebook is) */
export { projectThreadRef as projectRef } from '@shared/projectQueue'

/**
 * Projects from day one, as a goal for the scheduler: only the projects being built
 * (shared/projectQueue) whose next milestone is open, as building work; with nothing being built
 * yet, the top of Up next. Null without projects.
 */
export async function projectsGoal(): Promise<(import('@shared/goals').PlanGoal & { maxGap: number; tracksOf: Record<string, string[]> }) | null> {
  const { getNotebooks } = await import('./learn')
  if (!(await getNotebooks().catch(() => [])).some((n) => n.track)) return null
  const rows = await projectsView().catch(() => [])
  const q = (await import('./track').then((t) => t.loadTracks()).catch(() => null))?.modules?.queue
  const { needs, tracksOf } = projectNeeds(rows, q)
  if (!needs.length) return null
  return { id: PROJECTS_GOAL, title: 'Projects', weight: 'main', needs, createdAt: Date.now(), by: 'tide', maxGap: 4, tracksOf }
}

// ---------- The Projects page: the queue ----------

/** Every project in its section (building, up next, later, built), with the filter's tracks */
export async function projectsPage(): Promise<ProjectsPageView> {
  const cat = await loadCatalogue()
  const rows = await projectsView()
  const q = (await import('./track').then((t) => t.loadTracks()).catch(() => null))?.modules?.queue
  const a = arrange(rows, q)
  const used = new Set(rows.flatMap((r) => r.trackIds ?? []))
  const tracks = (cat?.tracks ?? []).filter((t) => used.has(t.id) && t.id !== AI_TRACK).map((t) => ({ id: t.id, title: t.title }))
  const byId = cat ? moduleById(cat) : new Map<string, ModuleDef>()
  const modules: Record<string, string> = {}
  for (const r of rows) for (const m of r.milestones) for (const n of m.needs ?? []) modules[n] = byId.get(n)?.title ?? n
  return { cap: a.cap, building: a.building, upNext: a.upNext, later: a.later, built: a.built, paused: [...a.paused], tracks, ai: used.has(AI_TRACK), modules }
}

/** Start, pause, move up or change the cap; the page as it then stands */
export async function queueAction(action: QueueAction): Promise<ProjectsPageView> {
  const rows = await projectsView()
  const t = await import('./track')
  await t.updateModules((m) => ({ ...m, queue: applyQueue(rows, m.queue ?? {}, action) }))
  return projectsPage()
}

const SUGGEST_SYSTEM = `You design long build projects for a self-taught engineer who learns by building real systems themselves, from a first small component up to core infrastructure. Each project is one repository grown milestone by milestone. Every milestone names the modules it needs, using only module ids from the catalogue given. Order milestones so the first needs only foundational modules. No company names or brands. Reply with JSON only.`

export type Suggestion = SuggestedProject & { problems: string[]; titles: Record<string, string> }

/**
 * Three projects Claude proposes from the goal note, what they're into lately and the module
 * catalogue, each checked as its file would be. Without Claude it says so (`available: false`):
 * New project works without it.
 */
export async function suggestProjects(lately = ''): Promise<{ available: boolean; suggestions: Suggestion[]; error?: string }> {
  const ip = await import('./ideaProjects')
  const route = await ip.planRoute().catch(() => null)
  if (route?.who !== 'claude') return { available: false, suggestions: [] }
  const cat = await loadCatalogue(true)
  if (!cat) return { available: true, suggestions: [], error: 'There are no modules in Roadmaps/Modules to build on.' }
  const { GOAL_NOTE } = await import('./northStar')
  const goal = await readText(GOAL_NOTE).catch(() => '')
  const prompt = suggestPrompt({ goal, lately, modules: cat.modules.map((m) => ({ id: m.id, title: m.title, track: m.track, requires: m.requires })), tracks: cat.tracks.map((t) => ({ id: t.id, title: t.title })), projects: (cat.projects ?? []).map((p) => ({ id: p.id, title: p.title })) })
  try {
    const { extractJsonObject } = await import('./ai')
    const r = await ip.askClaudeForProjects(prompt, SUGGEST_SYSTEM)
    const list = parseSuggestions(extractJsonObject(r.text)).slice(0, 3)
    if (!list.length) return { available: true, suggestions: [], error: 'Claude’s reply had no projects in it. Try again.' }
    const byId = moduleById(cat)
    return {
      available: true,
      suggestions: list.map((p) => {
        const titles: Record<string, string> = {}
        for (const m of p.milestones) for (const n of m.needs) titles[n] = byId.get(n)?.title ?? n
        return { ...p, problems: checkProject(projectMarkdown(p), { modules: cat.modules, projects: cat.projects ?? [] }).problems, titles }
      })
    }
  } catch (e) {
    return { available: true, suggestions: [], error: `Claude didn’t answer: ${String((e as Error)?.message ?? e).slice(0, 160)}` }
  }
}

/**
 * Adds a suggested project to the vault as Roadmaps/Projects/<id>.md: a new file only, never over
 * one already there, and only when the vault's parser reads it back with every need a real module
 */
export async function addProject(p: SuggestedProject): Promise<{ id: string; path: string }> {
  const cat = await loadCatalogue(true)
  if (!cat) throw new Error('There are no modules in Roadmaps/Modules to build on.')
  const tidy = parseSuggestions({ projects: [p] })[0]
  if (!tidy) throw new Error('That project has no title or milestones.')
  const md = projectMarkdown(tidy)
  const { def, problems } = checkProject(md, { modules: cat.modules, projects: cat.projects ?? [] })
  if (!def || problems.length) throw new Error(problems.join(' ') || 'It doesn’t read as a project.')
  const path = projectPath(def.id)
  if (existsSync(absPath(path))) throw new Error(`${path} is already there; nothing was changed.`)
  await fs.mkdir(dirname(absPath(path)), { recursive: true })
  // 'wx': fails rather than overwrite, should a file appear meanwhile
  await fs.writeFile(absPath(path), md, { encoding: 'utf8', flag: 'wx' })
  resetModules()
  return { id: def.id, path }
}

// ---------- The switch ----------

const STATE = '.tide/modules.json'
const BACKUPS = '.tide/backups'
/** Caches and copies with no topic ids in them: left out of the backup */
const SKIP_DIRS = new Set(['backups', 'backup', 'pdftext', 'epubtext', 'thumbs', 'covers'])
/** Written specially, never by the generic rewrite */
const SPECIAL = new Set(['.tide/knowledge.json', '.tide/notebooks.json', '.tide/tracks.json', '.tide/modules.json', '.tide/learning.db'])

export interface SwitchRecord {
  at: number
  backup: string
  /** Notebook path → the track it became */
  tracks: Record<string, string>
  /** Notebook paths that stopped using an old roadmap */
  outlines: Record<string, string>
  /** Files the switch wrote, with a hash of what it wrote (to tell later edits apart on switch back) */
  wrote: Record<string, string>
  /** Files it created (removed again on switch back if unchanged) */
  created: string[]
  /** Empty folders removed, recreated on switch back */
  removedFolders: string[]
  /** A track's folder made at the switch (a track is a notebook in the sidebar); removed on switch back while still empty */
  createdFolders?: string[]
  counts: Record<string, number>
}

export interface ModulesStateFile {
  version: 1
  switched?: SwitchRecord
  history: { at: number; kind: 'switch' | 'back' | 'folders'; note: string }[]
}

export async function readState(): Promise<ModulesStateFile> {
  try {
    const s = JSON.parse(await readText(STATE)) as Partial<ModulesStateFile>
    return { ...s, version: 1, history: s.history ?? [] }
  } catch {
    return { version: 1, history: [] }
  }
}

const sha = (b: Buffer | string) => createHash('sha1').update(b).digest('hex')
const fileHash = async (rel: string) => sha(await fs.readFile(absPath(rel)).catch(() => Buffer.from('')))

async function storedNotebooks(): Promise<Record<string, Record<string, unknown>>> {
  try {
    return JSON.parse(await readText('.tide/notebooks.json')) as Record<string, Record<string, unknown>>
  } catch {
    return {}
  }
}

/** The old roadmaps: every notebook's outline in Roadmaps/, and North Star's installed tracks */
async function oldRoadmaps(): Promise<OldRoadmap[]> {
  const stored = await storedNotebooks()
  const out: OldRoadmap[] = []
  const seen = new Set<string>()
  const add = async (notebook: string, file: string) => {
    if (seen.has(file) || file.startsWith(`${MODULES_DIR}/`)) return
    const md = await readText(file).catch(() => null)
    if (md === null) return
    seen.add(file)
    out.push({ file, notebook, md })
  }
  for (const [path, meta] of Object.entries(stored)) if (typeof meta?.outline === 'string' && !meta.track) await add(path.split('/').pop() ?? path, meta.outline)
  const installed = await import('./northStar').then((m) => m.installedTracks()).catch(() => ({}) as Record<string, { outline: string }>)
  for (const [name, t] of Object.entries(installed)) await add(name, t.outline)
  return out
}

async function topFolders(): Promise<string[]> {
  const names = await fs.readdir(vaultRoot(), { withFileTypes: true }).catch(() => [])
  return names.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
}

async function isEmptyDir(rel: string): Promise<boolean> {
  const walk = async (p: string): Promise<boolean> => {
    const list = await fs.readdir(absPath(p), { withFileTypes: true }).catch(() => null)
    if (!list) return false
    for (const d of list) {
      if (d.name === '.DS_Store') continue
      if (!d.isDirectory()) return false
      if (!(await walk(`${p}/${d.name}`))) return false
    }
    return true
  }
  return walk(rel)
}

/** Which notebook each track becomes: the one of the same name, else a notebook with no folder (nothing new in the sidebar) */
async function trackNotebooks(cat: Catalogue): Promise<{ id: string; title: string; notebook: string; folder: boolean }[]> {
  const folders = await topFolders()
  const stored = await storedNotebooks()
  return cat.tracks.map((t) => {
    const f = folders.find((x) => x.toLowerCase() === t.title.toLowerCase())
    const already = Object.entries(stored).find(([, m]) => m?.track === t.id)?.[0]
    return { id: t.id, title: t.title, notebook: already ?? f ?? t.title, folder: !!(already ? folders.includes(already) : f) }
  })
}

interface Planned {
  cat: Catalogue
  plan: MovePlan
  old: OldRoadmap[]
  tracks: Awaited<ReturnType<typeof trackNotebooks>>
  /** Notebook path → the old outline it drops */
  outlines: Record<string, string>
  empty: string[]
}

async function planned(): Promise<Planned> {
  const cat = await loadCatalogue(true)
  if (!cat?.modules.length) throw new Error('There are no modules in Roadmaps/Modules yet.')
  if (!cat.tracks.length) throw new Error('There are no tracks in Roadmaps/Tracks yet.')
  const moves = await loadMoves()
  if (!moves) throw new Error('There is no _moves.json saying where the old roadmaps’ items go.')
  const old = await oldRoadmaps()
  const plan = planMoves(old, moves, cat)
  const stored = await storedNotebooks()
  const tracks = await trackNotebooks(cat)
  const outlines: Record<string, string> = {}
  for (const [path, meta] of Object.entries(stored)) if (typeof meta?.outline === 'string' && !meta.track && fileCovered(plan.files[meta.outline])) outlines[path] = meta.outline
  // A track's notebook with an outline of its own that isn't covered keeps it hidden behind the track (kept in the backup)
  for (const t of tracks) if (typeof stored[t.notebook]?.outline === 'string' && !outlines[t.notebook]) outlines[t.notebook] = stored[t.notebook].outline as string
  // Folders left with nothing once their roadmap moves: offered for removal, never removed unasked
  const trackFolders = new Set(tracks.map((t) => t.notebook))
  const empty: string[] = []
  for (const path of Object.keys(outlines)) if (!trackFolders.has(path) && !path.includes('/') && (await isEmptyDir(path))) empty.push(path)
  return { cat, plan, old, tracks, outlines, empty: empty.sort() }
}

/** What the switch would move, counted, before anything is written */
export async function switchPreview(): Promise<MovePreview & { switched: boolean; at?: number; backup?: string }> {
  const state = await readState()
  const p = await planned()
  const map = idMapper(p.plan)
  const k = await readKnowledgeFile()
  const moving = (k?.concepts ?? []).filter((c) => map(c.id) !== c.id || (c.parent && map(c.parent) !== c.parent))
  const withEv = moving.filter((c) => c.evidence?.length)
  const placement = await readText('.tide/placement.json')
    .then((t) => Object.keys((JSON.parse(t) as { topics?: Record<string, unknown> }).topics ?? {}).filter((id) => map(id) !== id).length)
    .catch(() => 0)
  const db = dbCounts(map)
  const lessons = await countLessonLinks(map)
  const progressIds = new Set(withEv.map((c) => c.parent ?? c.id))
  const orphans = p.plan.unplaced.filter((u) => (k?.concepts ?? []).some((c) => (c.id === u.id || c.parent === u.id) && c.evidence?.length)).map((u) => ({ title: u.title, notebook: u.notebook }))
  const sample = p.plan.pairs
    .filter((x) => progressIds.has(x.old) || x.checked || x.link)
    .concat(p.plan.pairs)
    .slice(0, 6)
    .map((x) => ({ from: `${x.notebook} · ${x.oldTitle.replace(/\*\*/g, '')}`, to: x.newTitle.replace(/\*\*/g, ''), module: p.cat.modules.find((m) => m.id === x.module)?.title ?? x.module }))
  const trackOfNb = new Map(p.tracks.map((t) => [t.notebook, t.title]))
  return {
    switched: !!state.switched,
    ...(state.switched ? { at: state.switched.at, backup: state.switched.backup } : {}),
    modules: p.cat.modules.length,
    tracks: p.tracks.map((t) => ({ ...t, modules: p.cat.tracks.find((x) => x.id === t.id)?.modules.length ?? 0 })),
    topics: { placed: p.plan.pairs.length, dropped: p.plan.dropped.length, unplaced: p.plan.unplaced.filter((u) => !u.module).length, folded: p.plan.unplaced.filter((u) => u.module).length, withProgress: progressIds.size },
    progress: { concepts: withEv.filter((c) => !c.parent).length, evidence: withEv.reduce((n, c) => n + (c.evidence?.length ?? 0), 0), ticks: p.plan.pairs.filter((x) => x.checked).length, links: p.plan.pairs.filter((x) => x.link).length, placement, events: db.events, targets: db.targets, lessons },
    notebooks: Object.entries(p.outlines).map(([name, from]) => ({ name, from, ...(trackOfNb.has(name) ? { to: trackOfNb.get(name) } : {}) })),
    emptyFolders: p.empty,
    sample: sample.filter((x, i, a) => a.findIndex((y) => y.from === x.from) === i).slice(0, 4),
    orphans: orphans.slice(0, 20),
    issues: checkDag(p.cat).length
  }
}

async function readKnowledgeFile(): Promise<KFile | null> {
  try {
    return JSON.parse(await readText('.tide/knowledge.json')) as KFile
  } catch {
    return null
  }
}

// ---------- The learning log (SQLite) ----------

interface Db {
  exec(sql: string): void
  prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Record<string, unknown>[]; get(...a: unknown[]): Record<string, unknown> | undefined }
  close(): void
}

function openDb(rel = '.tide/learning.db'): Db | null {
  if (!existsSync(absPath(rel))) return null
  try {
    const { DatabaseSync } = createRequire(__filename)('node:sqlite') as { DatabaseSync: new (path: string) => Db }
    const d = new DatabaseSync(absPath(rel))
    d.exec('PRAGMA busy_timeout = 4000;')
    return d
  } catch {
    return null
  }
}

/** An event key names its concept after its last "@" (ev:<source>#<pos>@<concept>) */
const mapKey = (key: string, map: (s: string) => string) => {
  const at = key.lastIndexOf('@')
  return at > 0 ? key.slice(0, at + 1) + map(key.slice(at + 1)) : key
}

function dbCounts(map: (s: string) => string): { events: number; targets: number } {
  const d = openDb()
  if (!d) return { events: 0, targets: 0 }
  try {
    const events = new Set(d.prepare('SELECT key, node FROM event_nodes').all().filter((r) => map(String(r.node)) !== String(r.node)).map((r) => String(r.key))).size
    const targets = d.prepare('SELECT node FROM targets').all().filter((r) => map(String(r.node)) !== String(r.node)).length
    return { events, targets }
  } catch {
    return { events: 0, targets: 0 }
  } finally {
    d.close()
  }
}

/** Every concept id in the learning log rewritten: events (keys, bodies, nodes), depth targets, links, the links already asked */
export function rewriteDb(d: Db, map: (s: string) => string): number {
  let changed = 0
  d.exec('BEGIN')
  try {
    const rows = d.prepare('SELECT key, body FROM events').all()
    const del = d.prepare('DELETE FROM events WHERE key = ?')
    const delNodes = d.prepare('DELETE FROM event_nodes WHERE key = ?')
    const has = d.prepare('SELECT 1 AS x FROM events WHERE key = ?')
    const put = d.prepare('UPDATE events SET key = ?, body = ? WHERE key = ?')
    const node = d.prepare('INSERT OR IGNORE INTO event_nodes (key, node) VALUES (?, ?)')
    for (const r of rows) {
      const key = String(r.key)
      let body: Record<string, unknown>
      try {
        body = JSON.parse(String(r.body)) as Record<string, unknown>
      } catch {
        continue
      }
      const nb = rewriteDeep(body, map)
      const nk = mapKey(key, map)
      if (!nb.changed && nk === key) continue
      changed++
      const value = { ...nb.value, key: nk } as Record<string, unknown>
      if (nk !== key && has.get(nk)) {
        // The same act already recorded on the new concept: one row is kept
        del.run(key)
        delNodes.run(key)
        continue
      }
      put.run(nk, JSON.stringify(value), key)
      delNodes.run(key)
      for (const c of (value.concepts as string[] | undefined) ?? []) node.run(nk, c)
      for (const s of (value.skills as string[] | undefined) ?? []) node.run(nk, `skill:${s}`)
    }
    for (const r of d.prepare('SELECT node, depth, goal, by, at FROM targets').all()) {
      const n = map(String(r.node))
      if (n === String(r.node)) continue
      changed++
      d.prepare('DELETE FROM targets WHERE node = ?').run(r.node)
      d.prepare('INSERT INTO targets (node, depth, goal, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(node) DO UPDATE SET depth = MAX(depth, excluded.depth)').run(n, r.depth, r.goal, r.by, r.at)
    }
    for (const r of d.prepare('SELECT src, dst, kind, origin, at FROM links').all()) {
      const s = map(String(r.src))
      const t = map(String(r.dst))
      if (s === String(r.src) && t === String(r.dst)) continue
      changed++
      d.prepare('DELETE FROM links WHERE src = ? AND dst = ? AND kind = ?').run(r.src, r.dst, r.kind)
      d.prepare('INSERT OR IGNORE INTO links (src, dst, kind, origin, at) VALUES (?, ?, ?, ?, ?)').run(s, t, r.kind, r.origin, r.at)
    }
    for (const r of d.prepare('SELECT k, v FROM meta').all()) {
      try {
        const v = JSON.parse(String(r.v)) as unknown
        const nv = rewriteDeep(v, map)
        if (nv.changed) {
          changed++
          d.prepare('UPDATE meta SET v = ? WHERE k = ?').run(JSON.stringify(nv.value), r.k)
        }
      } catch {
        // Plain text values hold no ids
      }
    }
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  return changed
}

// ---------- Files ----------

async function walkFiles(rel: string, skip: (rel: string) => boolean): Promise<string[]> {
  const out: string[] = []
  const go = async (p: string) => {
    for (const d of await fs.readdir(absPath(p), { withFileTypes: true }).catch(() => [])) {
      const r = `${p}/${d.name}`
      if (skip(r)) continue
      if (d.isDirectory()) await go(r)
      else out.push(r)
    }
  }
  await go(rel)
  return out
}

const skipped = (r: string) => SKIP_DIRS.has(r.split('/')[1] ?? '') || /\.tmp$/.test(r)

async function lessonFiles(): Promise<string[]> {
  return (await walkFiles('.tide', skipped)).filter((f) => /\.(json|jsonl)$/i.test(f) && !SPECIAL.has(f) && !/knowledge\.v\d+\.json$/.test(f) && !/\.before[-.]/.test(f))
}

async function countLessonLinks(map: (s: string) => string): Promise<number> {
  let n = 0
  for (const f of (await lessonFiles()).filter((x) => x.startsWith('.tide/lessons/'))) {
    const text = await readText(f).catch(() => '')
    try {
      if (rewriteDeep(JSON.parse(text), map).changed) n++
    } catch {
      // Unreadable: nothing to move
    }
  }
  return n
}

/** A JSON or JSON-lines file with its ids rewritten; null when nothing in it changes */
function rewriteText(f: string, text: string, map: (s: string) => string): string | null {
  if (f.endsWith('.jsonl')) {
    let any = false
    const lines = text.split('\n').map((l) => {
      if (!l.trim()) return l
      try {
        const r = rewriteDeep(JSON.parse(l), map)
        if (!r.changed) return l
        any = true
        return JSON.stringify(r.value)
      } catch {
        return l
      }
    })
    return any ? lines.join('\n') : null
  }
  try {
    const r = rewriteDeep(JSON.parse(text), map)
    if (!r.changed) return null
    // Keep the file's own indentation
    const indent = text.match(/^[[{]\n(\s+)/)?.[1]
    return JSON.stringify(r.value, null, indent ? (indent.startsWith('\t') ? '\t' : indent.length) : undefined)
  } catch {
    return null
  }
}

async function copyInto(rel: string, backup: string): Promise<void> {
  const from = absPath(rel)
  if (!existsSync(from)) return
  const to = absPath(`${backup}/${rel}`)
  await fs.mkdir(dirname(to), { recursive: true })
  await fs.cp(from, to, { recursive: true })
}

/** The full backup: .tide (but its caches), the module and track files, the North Star note */
async function makeBackup(at: number, extra: string[]): Promise<string> {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
  let backup = `${BACKUPS}/pre-modules-${stamp}`
  for (let i = 2; existsSync(absPath(backup)); i++) backup = `${BACKUPS}/pre-modules-${stamp}-${i}`
  await fs.mkdir(absPath(backup), { recursive: true })
  for (const d of await fs.readdir(absPath('.tide'), { withFileTypes: true })) {
    if (SKIP_DIRS.has(d.name) || /\.tmp$/.test(d.name)) continue
    await copyInto(`.tide/${d.name}`, backup)
  }
  for (const p of [MODULES_DIR, TRACKS_DIR, ...extra]) await copyInto(p, backup)
  return backup
}

/** One switch or switch back at a time */
let running: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = running.then(fn)
  running = run.catch(() => {})
  return run
}

async function quiet(): Promise<void> {
  // Whatever the knowledge map holds in memory is on disk first, and nothing holds the log open
  await import('./knowledge').then((k) => k.resetKnowledge()).catch(() => {})
  await import('./learningLog').then((l) => l.close()).catch(() => {})
}

async function afterwards(): Promise<void> {
  resetModules()
  await import('./knowledge').then((k) => k.resetKnowledge()).catch(() => {})
  await import('./track').then((t) => t.resetTracks()).catch(() => {})
  await import('./northStar').then((n) => n.resetNorthStar()).catch(() => {})
  await import('./goals').then((g) => g.resetGoals()).catch(() => {})
  await import('./milestone').then((m) => m.resetMilestone()).catch(() => {})
  await import('./learnerModel').then((m) => m.resetLearnerModel()).catch(() => {})
}

export interface SwitchResult {
  ok: boolean
  already?: boolean
  backup: string
  counts: Record<string, number>
}

/**
 * Switch to modules: back up, then move every id, tick and link to its new home, and make the
 * tracks the notebooks. Running it again once switched does nothing. Old roadmap files stay.
 */
export function switchToModules(o: { now?: number } = {}): Promise<SwitchResult> {
  return serial(async () => {
    const state = await readState()
    if (state.switched) return { ok: true, already: true, backup: state.switched.backup, counts: state.switched.counts }
    const p = await planned()
    const at = o.now ?? Date.now()
    const map = idMapper(p.plan)
    const note = await import('./northStar').then((m) => m.loadStore()).catch(() => null)
    await quiet()
    const backup = await makeBackup(at, note?.notePath ? [note.notePath] : [])
    const wrote: Record<string, string> = {}
    const created: string[] = []
    const counts: Record<string, number> = {}
    const write = async (rel: string, text: string) => {
      if (!existsSync(absPath(rel))) created.push(rel)
      await writeText(rel, text)
      wrote[rel] = sha(text)
    }

    // The knowledge map: concepts to their new ids, areas and sections, evidence merged
    const k = await readKnowledgeFile()
    if (k) {
      const r = migrateKnowledge(k, map, homesOf(p.cat))
      counts.concepts = r.moved
      counts.merged = r.merged
      if (r.moved) await write('.tide/knowledge.json', JSON.stringify(r.file, null, 2))
    }
    // Every other record that names a topic by id: lessons, placement, week plans, prep, the review log…
    let files = 0
    for (const f of await lessonFiles()) {
      const text = await readText(f).catch(() => null)
      if (text === null) continue
      const next = rewriteText(f, text, map)
      if (next === null) continue
      await write(f, next)
      files++
    }
    counts.files = files
    // The learning log
    const d = openDb()
    if (d) {
      try {
        counts.log = rewriteDb(d, map)
      } finally {
        d.close()
      }
      if (counts.log) wrote['.tide/learning.db'] = await fileHash('.tide/learning.db')
    }
    // Phase checks and skips: onto the module part their topics went to
    const tracksText = await readText('.tide/tracks.json').catch(() => null)
    if (tracksText) {
      const store = JSON.parse(tracksText) as TracksStore
      let moved = 0
      for (const [, rec] of Object.entries(store.tracks ?? {})) {
        for (const [phase, pr] of Object.entries(rec.phases ?? {})) {
          const to = p.plan.phases[phase]
          if (!to) continue
          const key = moduleRecordKey(to.module)
          const dest = (store.tracks[key] ??= emptyTrack())
          if (dest.phases[to.part]) continue
          dest.phases[to.part] = pr
          moved++
        }
      }
      counts.checks = moved
      if (moved) await write('.tide/tracks.json', JSON.stringify(store, null, 1))
    }
    // The module files: the old ticks and lesson links
    let lines = 0
    for (const m of p.cat.modules) {
      const pairs = p.plan.pairs.filter((x) => x.module === m.id && (x.checked || x.link))
      if (!pairs.length) continue
      const md = await readText(m.path)
      const r = carryLines(md, pairs)
      if (r.changed) {
        await write(m.path, r.md)
        lines += r.changed
      }
    }
    counts.lines = lines
    // North Star: each stage's tracks and scopes onto the module tracks; goals' needs the same way
    const oldTopics = new Map(p.old.map((r) => [r.notebook, roadmapTopics(r.notebook, r.md)]))
    const { inScope, toNote, parseNote, tidyNorthStar } = await import('@shared/northStar')
    const trackTitles = new Set(p.tracks.map((t) => t.title))
    const covered = new Set(Object.keys(p.outlines).map((x) => x.split('/').pop() ?? x))
    const keep = (name: string) => trackTitles.has(name) && !covered.has(name)
    if (note?.notePath) {
      const text = await readText(note.notePath).catch(() => null)
      const parsed = text ? parseNote(text) : null
      if (parsed && text) {
        const r = remapNorthStar(parsed, oldTopics, p.plan, p.cat, inScope, keep)
        if (r.changed) {
          const next = toNote(tidyNorthStar({ ...r.ns, log: [...r.ns.log, { date: new Date(at).toISOString().slice(0, 10), text: 'Moved onto modules: each stage now names the modules it takes' }] }))
          await write(note.notePath, next)
          const storeText = await readText('.tide/northstar.json')
          const st = JSON.parse(storeText) as { written: string; tracks?: Record<string, { outline: string }> }
          // Tide wrote this version, so it doesn't read as your edit; installed tracks whose roadmap moved are retired
          const outlinesMoved = new Set(Object.values(p.outlines))
          const tracks = Object.fromEntries(Object.entries(st.tracks ?? {}).filter(([, t]) => !outlinesMoved.has(t.outline) && !fileCovered(p.plan.files[t.outline])))
          await write('.tide/northstar.json', JSON.stringify({ ...st, written: st.written.trim() === text.trim() ? next : st.written, tracks }, null, 1))
          counts.stages = r.ns.stages.length
        }
      }
    }
    const goalsText = await readText('.tide/goals.json').catch(() => null)
    if (goalsText) {
      try {
        const g = JSON.parse(goalsText) as { goals?: { needs?: { id: string; kind: string; ref: string; label: string; hours: number; sections?: string[]; dropped?: boolean }[] }[] }
        let n = 0
        for (const goal of g.goals ?? []) {
          const out: NonNullable<typeof goal.needs> = []
          for (const need of goal.needs ?? []) {
            if (need.kind !== 'roadmap' || keep(need.ref) || !oldTopics.has(need.ref)) {
              out.push(need)
              continue
            }
            const parts = remapScope(need.ref, need.sections ?? [], oldTopics, p.plan, p.cat, inScope)
            if (!parts.length) {
              out.push(need)
              continue
            }
            n++
            parts.forEach((x, i) => {
              const had = out.find((o2) => o2.kind === 'roadmap' && o2.ref === x.track && !o2.dropped)
              if (had) had.sections = [...new Set([...(had.sections ?? []), ...x.scope])]
              else out.push({ ...need, id: i ? `${need.id}-${i}` : need.id, ref: x.track, hours: Math.max(1, Math.round(need.hours * x.share)), sections: x.scope })
            })
          }
          goal.needs = out
        }
        counts.goals = n
        if (n) await write('.tide/goals.json', JSON.stringify(g, null, 1))
      } catch {
        // A goals file that can't be read is left alone
      }
    }
    // The notebooks: tracks take over; notebooks whose roadmap moved stop using it
    const stored = await storedNotebooks()
    for (const path of Object.keys(p.outlines)) {
      const { outline: _o, ...rest } = stored[path] ?? {}
      stored[path] = rest
    }
    for (const t of p.tracks) stored[t.notebook] = { ...(stored[t.notebook] ?? {}), track: t.id }
    await write('.tide/notebooks.json', JSON.stringify(stored, null, 1))
    // A track is a notebook in the sidebar: one with no folder of its name gets one (and loses it again on switch back)
    const createdFolders: string[] = []
    for (const t of p.tracks)
      if (!t.folder && !t.notebook.includes('/') && !existsSync(absPath(t.notebook))) {
        await fs.mkdir(absPath(t.notebook), { recursive: true })
        createdFolders.push(t.notebook)
      }
    counts.notebooks = p.tracks.length
    const rec: SwitchRecord = { at, backup, tracks: Object.fromEntries(p.tracks.map((t) => [t.notebook, t.id])), outlines: p.outlines, wrote, created, removedFolders: [], createdFolders, counts }
    await writeText(STATE, JSON.stringify({ ...state, switched: rec, history: [...state.history, { at, kind: 'switch', note: `${p.plan.pairs.length} topics, ${counts.concepts ?? 0} concepts moved; backup ${backup}` }] } satisfies ModulesStateFile, null, 1))
    await afterwards()
    return { ok: true, backup, counts }
  })
}

// ---------- The switch, verified: what the button and scripts/modules run ----------

export type { SwitchVerification } from '@shared/moduleMigration'

/** Copies a module source folder (Modules, Tracks, Projects, _moves.json) into Roadmaps: new files only, nothing overwritten */
export async function installModules(sourceDir: string): Promise<number> {
  const { join: pj } = await import('path')
  let n = 0
  for (const [from, to] of [
    ['Modules', MODULES_DIR],
    ['Tracks', TRACKS_DIR],
    ['Projects', PROJECTS_DIR]
  ] as const) {
    const names = await fs.readdir(pj(sourceDir, from)).catch(() => [] as string[])
    for (const name of names.filter((x) => x.endsWith('.md') || x.endsWith('.json'))) {
      const dest = `${to}/${name}`
      if (existsSync(absPath(dest))) continue
      await fs.mkdir(absPath(to), { recursive: true })
      await fs.copyFile(pj(sourceDir, from, name), absPath(dest))
      n++
    }
  }
  if (existsSync(pj(sourceDir, '_moves.json')) && !(await loadMoves())) {
    await fs.copyFile(pj(sourceDir, '_moves.json'), absPath('Roadmaps/_moves.json'))
    n++
  }
  resetModules()
  return n
}

const stateKey = (c: ConceptState) => `stability ${c.stability?.toFixed(4) ?? '-'} · difficulty ${c.difficulty?.toFixed(4) ?? '-'} · ${c.status} · seen ${c.seen} right ${c.right} partly ${c.partly} wrong ${c.wrong}`

/**
 * Switch to modules and check it: the knowledge map's FSRS state for every concept with evidence,
 * before and after (the same on its new id, or merged with a twin), every piece of evidence still
 * there, what the log and records re-pointed, what had no home. With `sourceDir`, the modules are
 * first copied in (new files only).
 */
export async function verifiedSwitch(o: { sourceDir?: string; now?: number } = {}): Promise<SwitchVerification> {
  const installed = o.sourceDir ? await installModules(o.sourceDir) : 0
  const k = await import('./knowledge')
  const before = await k.allConcepts()
  const file0 = await readKnowledgeFile()
  const ev0 = (file0?.concepts ?? []).flatMap((c) => (c.evidence ?? []).map((e) => `${e.source} ${e.pos}`))
  const p = await planned().catch(() => null)
  const r = await switchToModules({ ...(o.now ? { now: o.now } : {}) })
  const after = await k.allConcepts()
  const file1 = await readKnowledgeFile()
  const ev1 = new Set((file1?.concepts ?? []).flatMap((c) => (c.evidence ?? []).map((e) => `${e.source} ${e.pos}`)))
  const map = p ? idMapper(p.plan) : (x: string) => x
  const into = new Map<string, number>()
  for (const c of before) if (c.seen) into.set(map(c.id), (into.get(map(c.id)) ?? 0) + 1)
  const now = new Map(after.map((c) => [c.id, c]))
  const fsrs: SwitchVerification['fsrs'] = { checked: 0, same: 0, merged: 0, changed: [] }
  for (const c of before) {
    if (!c.seen) continue
    fsrs.checked++
    const n = now.get(map(c.id))
    if ((into.get(map(c.id)) ?? 0) > 1) {
      fsrs.merged++
      continue
    }
    if (n && stateKey(n) === stateKey(c)) fsrs.same++
    else fsrs.changed.push({ id: c.id, name: c.name, before: stateKey(c), after: n ? stateKey(n) : 'missing' })
  }
  const placed = (key: string) => {
    const [src, pos] = key.split(' ')
    return `${map(src)} ${pos}`
  }
  const lost = ev0.filter((e) => !ev1.has(placed(e))).length
  const withProgress = p ? p.plan.unplaced.filter((u) => (file0?.concepts ?? []).some((c) => (c.id === u.id || c.parent === u.id) && c.evidence?.length)).map((u) => ({ title: u.title, notebook: u.notebook })) : []
  return {
    ok: r.ok && lost === 0 && fsrs.changed.length === 0,
    ...(r.already ? { already: true } : {}),
    backup: r.backup,
    installed,
    concepts: { before: before.length, after: after.length, withEvidenceBefore: before.filter((c) => c.seen).length, withEvidenceAfter: after.filter((c) => c.seen).length },
    fsrs,
    evidence: { before: ev0.length, after: ev1.size, lost },
    events: { log: r.counts.log ?? 0, files: r.counts.files ?? 0, checks: r.counts.checks ?? 0, ticks: r.counts.lines ?? 0 },
    unmapped: { topics: p?.plan.unplaced.filter((u) => !u.module).length ?? 0, folded: p?.plan.unplaced.filter((u) => u.module).length ?? 0, dropped: p?.plan.dropped.length ?? 0, withProgress },
    counts: r.counts
  }
}

/** Removes the empty folders you confirmed (only ones the switch listed, and only while still empty) */
export function removeEmptyFolders(paths: string[]): Promise<string[]> {
  return serial(async () => {
    const state = await readState()
    if (!state.switched) throw new Error('Switch to modules first.')
    const allowed = new Set(Object.keys(state.switched.outlines))
    const done: string[] = []
    const stored = await storedNotebooks()
    for (const p of paths) {
      if (!allowed.has(p) || p.includes('/') || p.startsWith('.') || state.switched.tracks[p]) continue
      if (!(await isEmptyDir(p))) continue
      await fs.rm(absPath(p), { recursive: true })
      delete stored[p]
      done.push(p)
    }
    if (done.length) await writeText('.tide/notebooks.json', JSON.stringify(stored, null, 1))
    const rec = { ...state.switched, removedFolders: [...new Set([...state.switched.removedFolders, ...done])], wrote: { ...state.switched.wrote, ...(done.length ? { '.tide/notebooks.json': await fileHash('.tide/notebooks.json') } : {}) } }
    await writeText(STATE, JSON.stringify({ ...state, switched: rec, history: [...state.history, { at: Date.now(), kind: 'folders', note: `Removed ${done.join(', ')}` }] }, null, 1))
    return done
  })
}

/**
 * Switch back: the backup restored. A file nothing has changed since the switch is put back as it
 * was; one that changed since (you kept learning) has its ids moved back instead, so nothing learnt
 * in between is lost; the knowledge map and the log get the evidence and events added since,
 * moved back onto the old topics. Removed folders come back. The modules stay in the vault.
 */
export function switchBack(): Promise<{ ok: boolean; restored: number; kept: number }> {
  return serial(async () => {
    const state = await readState()
    const rec = state.switched
    if (!rec) throw new Error('Tide isn’t using modules.')
    if (!existsSync(absPath(rec.backup))) throw new Error(`The backup ${rec.backup} is gone; nothing was changed.`)
    await quiet()
    // The reverse of the switch: each new id back to the (first) old one it came from
    const cat = await loadCatalogue(true)
    const moves = (await loadMoves()) ?? {}
    const oldFromBackup: OldRoadmap[] = []
    const bnb = JSON.parse(await readText(`${rec.backup}/.tide/notebooks.json`).catch(() => '{}')) as Record<string, { outline?: string }>
    for (const [path, m] of Object.entries(bnb)) {
      if (!m?.outline) continue
      const md = await readText(m.outline).catch(() => null)
      if (md !== null) oldFromBackup.push({ file: m.outline, notebook: path.split('/').pop() ?? path, md })
    }
    const plan = cat ? planMoves(oldFromBackup, moves, cat) : { pairs: [] }
    const back = new Map<string, string>()
    for (const x of plan.pairs) if (!back.has(x.new)) back.set(x.new, x.old)
    const rmap = idMapper({ pairs: [...back].map(([n, o]) => ({ old: n, new: o })) as never })
    let restored = 0
    let kept = 0
    for (const [rel, hash] of Object.entries(rec.wrote)) {
      const inBackup = `${rec.backup}/${rel}`
      const changedSince = (await fileHash(rel)) !== hash
      if (rel === '.tide/knowledge.json' && changedSince) {
        // Restored, plus the evidence recorded since, moved back
        const before = JSON.parse(await readText(inBackup)) as KFile
        const now = JSON.parse(await readText(rel)) as KFile
        const seen = new Set(before.concepts.flatMap((c) => (c.evidence ?? []).map((e) => `${e.source}\u0000${e.pos}`)))
        const byId = new Map(before.concepts.map((c) => [c.id, c]))
        for (const c of now.concepts) {
          const fresh = (c.evidence ?? []).map((e) => ({ ...e, source: rmap(e.source) })).filter((e) => !seen.has(`${e.source}\u0000${e.pos}`))
          if (!fresh.length) continue
          const id = rmap(c.id)
          const into = byId.get(id)
          if (into) into.evidence = [...(into.evidence ?? []), ...fresh].sort((a, b) => a.at - b.at)
          else {
            const add = { ...c, id, ...(c.parent ? { parent: rmap(c.parent) } : {}), evidence: fresh }
            before.concepts.push(add)
            byId.set(id, add)
          }
          kept += fresh.length
        }
        await writeText(rel, JSON.stringify(before, null, 2))
        restored++
        continue
      }
      if (rel === '.tide/learning.db' && changedSince) {
        // Restored, plus the events written since, moved back
        const cur = openDb(rel)
        const rows = cur ? cur.prepare('SELECT key, at, kind, source, topic, outcome, lesson, course, project, body FROM events').all() : []
        cur?.close()
        await fs.copyFile(absPath(inBackup), absPath(rel))
        const d = openDb(rel)
        if (d) {
          try {
            const has = d.prepare('SELECT 1 AS x FROM events WHERE key = ?')
            const ins = d.prepare('INSERT OR IGNORE INTO events (key, at, kind, source, topic, outcome, lesson, course, project, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            const node = d.prepare('INSERT OR IGNORE INTO event_nodes (key, node) VALUES (?, ?)')
            for (const r of rows) {
              const key = mapKey(String(r.key), rmap)
              if (has.get(key) || has.get(String(r.key))) continue
              const body = rewriteDeep(JSON.parse(String(r.body)) as Record<string, unknown>, rmap).value
              ins.run(key, r.at, r.kind, r.source, r.topic, r.outcome, r.lesson, r.course, r.project, JSON.stringify({ ...body, key }))
              for (const c of (body.concepts as string[] | undefined) ?? []) node.run(key, c)
              kept++
            }
          } finally {
            d.close()
          }
        }
        restored++
        continue
      }
      if (rel === '.tide/notebooks.json') {
        // Only the switch's own changes are undone: the tracks off, the old outlines back
        const cur = await storedNotebooks()
        for (const nb of Object.keys(rec.tracks)) if (cur[nb]) delete cur[nb].track
        for (const [nb, outline] of Object.entries(rec.outlines)) cur[nb] = { ...(cur[nb] ?? {}), outline }
        for (const [nb, m] of Object.entries(bnb)) if (!cur[nb] && m) cur[nb] = m as Record<string, unknown>
        for (const nb of Object.keys(cur)) if (!Object.keys(cur[nb]).length && !bnb[nb]) delete cur[nb]
        await writeText(rel, JSON.stringify(cur, null, 1))
        restored++
        continue
      }
      if (!existsSync(absPath(inBackup))) {
        // Made by the switch: gone again, unless it was changed since
        if (!changedSince) await fs.rm(absPath(rel), { force: true })
        continue
      }
      if (!changedSince || rel.startsWith(`${MODULES_DIR}/`)) {
        if (!changedSince) {
          await fs.mkdir(dirname(absPath(rel)), { recursive: true })
          await fs.copyFile(absPath(inBackup), absPath(rel))
          restored++
        }
        continue
      }
      // Changed since: its ids moved back, what was added since kept
      const text = await readText(rel).catch(() => null)
      const next = text === null ? null : rewriteText(rel, text, rmap)
      if (next !== null) await writeText(rel, next)
      restored++
    }
    for (const f of rec.removedFolders) await fs.mkdir(absPath(f), { recursive: true })
    for (const f of rec.createdFolders ?? []) if (await isEmptyDir(f)) await fs.rm(absPath(f), { recursive: true }).catch(() => {})
    const { switched: _s, ...rest } = state
    await writeText(STATE, JSON.stringify({ ...rest, history: [...state.history, { at: Date.now(), kind: 'back', note: `Restored from ${rec.backup}` }] } satisfies ModulesStateFile, null, 1))
    await afterwards()
    return { ok: true, restored, kept }
  })
}

/** For the Learn page and the switch flow: whether modules are there, whether Tide uses them */
export async function modulesStatus(): Promise<{ available: boolean; modules: number; tracks: number; moves: boolean; switched: boolean; at?: number; backup?: string; replaced: string[]; issues: number }> {
  const cat = await loadCatalogue()
  const state = await readState()
  return {
    available: !!cat?.modules.length && !!cat.tracks.length,
    modules: cat?.modules.length ?? 0,
    tracks: cat?.tracks.length ?? 0,
    moves: !!(await loadMoves()),
    switched: !!state.switched,
    ...(state.switched ? { at: state.switched.at, backup: state.switched.backup } : {}),
    // The old roadmaps the modules replaced: kept on disk for Switch back, not offered in Learn
    replaced: state.switched ? [...new Set(Object.values(state.switched.outlines))] : [],
    issues: cat ? checkDag(cat).length : 0
  }
}

