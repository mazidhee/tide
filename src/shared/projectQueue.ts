/**
 * The project queue: a few projects being built at once, the rest waiting their turn.
 *
 * - Building: the projects that get time this week (at most `cap`, 2 unless the learner changes it
 *   to 1–4). Only these are the scheduler's project needs; with nothing being built, the top of Up
 *   next is, so projects still start from day one.
 * - Up next: projects whose first milestone is open (every module it needs started), in the
 *   learner's order; paused ones keep their progress and sit at the end.
 * - Later: projects still waiting on the modules their first milestone needs.
 * - Built: every milestone done.
 *
 * The state is kept in .tide/tracks.json beside the projects' notebook links (main/track). Without
 * any (`building` never written), the projects already set up count as Building, up to the cap.
 *
 * Also here: a suggested project written in the vault's project format, and checked with the same
 * parser that reads Roadmaps/Projects (shared/modules).
 */
import { parseProject, PROJECTS_DIR, type ModuleDef, type ModuleStatus, type ProjectDef, type ProjectRow } from './modules'

export const DEFAULT_CAP = 2
export const MAX_CAP = 4
/** Projects on this track are the "AI" filter */
export const AI_TRACK = 'ai-research'

export interface QueueState {
  /** Being built, in the order they were started. Undefined until the learner first changes it */
  building?: string[]
  /** Up next, in the learner's order (ids not listed follow in catalogue order) */
  order?: string[]
  paused?: string[]
  cap?: number
}

export const capOf = (q: QueueState | undefined) => Math.max(1, Math.min(MAX_CAP, Math.round(Number(q?.cap) || DEFAULT_CAP)))

type Row = Pick<ProjectRow, 'id' | 'notebook' | 'milestones' | 'done' | 'next'>

export const isBuilt = (p: Row) => p.milestones.length > 0 && p.milestones.every((m) => m.status === 'done')
/** Its first milestone can be built (or already is): every module it needs is started */
export const isReady = (p: Row) => !!p.milestones.length && p.milestones[0].status !== 'locked'

export interface Arranged<R extends Row> {
  cap: number
  building: R[]
  upNext: R[]
  later: R[]
  built: R[]
  paused: Set<string>
}

/** Every project in its section, by the queue's state */
export function arrange<R extends Row>(rows: R[], q: QueueState = {}): Arranged<R> {
  const cap = capOf(q)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const paused = new Set((q.paused ?? []).filter((id) => byId.has(id)))
  const built = rows.filter(isBuilt)
  const live = (id: string) => byId.has(id) && !isBuilt(byId.get(id)!)
  const buildingIds = q.building
    ? [...new Set(q.building)].filter(live)
    : rows.filter((r) => r.notebook && !isBuilt(r) && !paused.has(r.id)).map((r) => r.id).slice(0, cap)
  const building = buildingIds.map((id) => byId.get(id)!)
  const inBuilding = new Set(buildingIds)
  const waiting = rows.filter((r) => !inBuilding.has(r.id) && !isBuilt(r))
  const ready = waiting.filter(isReady)
  const rank = new Map((q.order ?? []).map((id, i) => [id, i]))
  // The learner's order first; then the rest in catalogue order; paused ones not yet placed last
  const pos = (r: R) => rank.get(r.id) ?? (paused.has(r.id) ? 2e6 : 1e6) + rows.indexOf(r)
  const upNext = [...ready].sort((a, b) => pos(a) - pos(b))
  const later = waiting.filter((r) => !isReady(r))
  return { cap, building, upNext, later, built, paused }
}

/**
 * The projects the scheduler plans time for: those being built with an open next milestone; with
 * nothing being built yet, the top of Up next
 */
export function scheduledProjects<R extends Row>(rows: R[], q: QueueState = {}): R[] {
  const a = arrange(rows, q)
  if (a.building.length) return a.building.filter((p) => p.next)
  const top = a.upNext.find((p) => p.next && !a.paused.has(p.id))
  return top ? [top] : []
}

/** A not-yet-set-up project's thread ref (once set up, its Projects notebook is) */
export const projectThreadRef = (id: string) => `vault-project:${id}`

/** The scheduler's project needs, one per scheduled project, and the tracks each one counts towards */
export function projectNeeds(rows: ProjectRow[], q: QueueState = {}): { needs: { id: string; kind: 'project'; ref: string; label: string; hours: number; why: string }[]; tracksOf: Record<string, string[]> } {
  const tracksOf: Record<string, string[]> = {}
  const needs = scheduledProjects(rows, q).map((p) => {
    const ref = p.notebook ?? projectThreadRef(p.id)
    tracksOf[`project:${ref.toLowerCase()}`] = p.tracks
    return { id: `pj:${p.id}`, kind: 'project' as const, ref, label: `${p.title}: ${p.next!.title}`, hours: p.next!.hours, why: `Building ${p.next!.title}: its modules are under way` }
  })
  return { needs, tracksOf }
}

// ---------- Courses a waiting project pulls forward ----------

type ModuleLite = Pick<ModuleDef, 'id' | 'title' | 'requires'>
type StatusOf = (id: string) => ModuleStatus | undefined

/** A project's next milestone (the first not built), when it waits on modules not started */
const waitingNext = (p: Pick<ProjectRow, 'milestones'>) => {
  const m = p.milestones.find((x) => x.status !== 'done')
  return m?.status === 'locked' && m.waiting.length ? m : undefined
}

/**
 * The modules nearest a module on its requires chain that can be worked on now (open, or already
 * under way): the module itself when it isn't locked; for a locked one, walking back through what
 * it requires, past what has passed, to the first that isn't locked. In requires order.
 */
export function nearestOpen(id: string, mods: Map<string, Pick<ModuleDef, 'requires'>>, status: StatusOf, seen = new Set<string>()): string[] {
  if (seen.has(id)) return []
  seen.add(id)
  const st = status(id)
  if (st === 'open' || st === 'active') return [id]
  if (st !== 'locked') return []
  return [...new Set((mods.get(id)?.requires ?? []).flatMap((r) => nearestOpen(r, mods, status, seen)))]
}

export interface PulledModule {
  module: string
  /** The not-started module the project's next milestone needs (the same module when it is open itself) */
  need: string
  project: string
  /** "For Agent Runtime: Agentic Systems opens its next milestone" */
  why: string
}

/** At most this many modules pulled forward at a time, so the plan is never flooded */
export const PULL_CAP = 2

/**
 * When a project being built waits on a course, that course moves to the front of the plan. For
 * each project being built (with none, the top of Up next), its next milestone's modules not yet
 * started; a locked one gives way to the nearest open modules on its requires chain. In queue
 * order, then milestone order, at most `cap`.
 */
export function pulledModules(rows: ProjectRow[], q: QueueState, modules: ModuleLite[], status: StatusOf, cap = PULL_CAP): PulledModule[] {
  const a = arrange(rows, q)
  const projects = a.building.length ? a.building : a.upNext.filter((p) => !a.paused.has(p.id)).slice(0, 1)
  const byId = new Map(modules.map((m) => [m.id, m]))
  const title = (id: string) => byId.get(id)?.title ?? id
  const out: PulledModule[] = []
  for (const p of projects)
    for (const need of waitingNext(p)?.waiting ?? [])
      for (const id of nearestOpen(need, byId, status)) {
        if (out.some((x) => x.module === id)) continue
        if (out.length >= cap) return out
        out.push({ module: id, need, project: p.id, why: id === need ? `For ${p.title}: ${title(id)} opens its next milestone` : `For ${p.title}: ${title(id)} leads to ${title(need)}, which its next milestone needs` })
      }
  return out
}

/** The one course to start that opens the most waiting projects (the Projects page's line) */
export interface UnlockHint {
  module: string
  /** Projects it opens (or, when `opens` is false, leads towards) */
  count: number
  /** Starting it alone opens their next milestones */
  opens: boolean
  /** The locked module it leads to, when that is what they wait on */
  via?: string
}

/**
 * Shown when Up next is empty or can't fill Building: the open module, not yet started, that would
 * open the most projects' next milestones (ties by queue order). When none opens one on its own,
 * the open module that leads most of them there: one they need, or the nearest open one on a locked
 * module's requires chain. Null when it doesn't apply.
 */
export function unlockHint(rows: ProjectRow[], q: QueueState, modules: ModuleLite[], status: StatusOf): UnlockHint | null {
  const a = arrange(rows, q)
  const ready = a.upNext.filter((p) => !a.paused.has(p.id)).length
  if (ready > 0 && a.cap - a.building.length <= ready) return null
  const byId = new Map(modules.map((m) => [m.id, m]))
  const waiting = [...a.building, ...a.upNext, ...a.later].map(waitingNext).filter((m) => !!m)
  // Map order is first-seen order, which is queue order: a tie goes to the earlier
  const best = (m: Map<string, number>) => [...m].reduce<[string, number] | null>((b, x) => (!b || x[1] > b[1] ? x : b), null)
  const opens = new Map<string, number>()
  for (const m of waiting) if (m.waiting.length === 1 && status(m.waiting[0]) === 'open') opens.set(m.waiting[0], (opens.get(m.waiting[0]) ?? 0) + 1)
  const direct = best(opens)
  if (direct) return { module: direct[0], count: direct[1], opens: true }
  const leads = new Map<string, number>()
  const vias = new Map<string, Map<string, number>>()
  for (const m of waiting) {
    const counted = new Set<string>()
    for (const need of m.waiting)
      for (const id of nearestOpen(need, byId, status)) {
        if (status(id) !== 'open') continue
        if (!counted.has(id)) leads.set(id, (leads.get(id) ?? 0) + 1)
        counted.add(id)
        if (id !== need) {
          const v = vias.get(id) ?? new Map<string, number>()
          vias.set(id, v.set(need, (v.get(need) ?? 0) + 1))
        }
      }
  }
  const lead = best(leads)
  if (!lead) return null
  const via = vias.get(lead[0]) ? best(vias.get(lead[0])!)?.[0] : undefined
  return { module: lead[0], count: lead[1], opens: false, ...(via ? { via } : {}) }
}

/** The projects as they stand with the queue's changes applied, as a state to save */
const snapshotOf = (rows: Row[], q: QueueState): Required<Pick<QueueState, 'building' | 'order' | 'paused'>> & { cap?: number } => {
  const a = arrange(rows, q)
  return { building: a.building.map((r) => r.id), order: a.upNext.map((r) => r.id), paused: [...a.paused], ...(q.cap ? { cap: q.cap } : {}) }
}

/** The Projects page */
export interface ProjectsPageView {
  cap: number
  building: ProjectRow[]
  upNext: ProjectRow[]
  later: ProjectRow[]
  built: ProjectRow[]
  paused: string[]
  /** The tracks that have projects, for the filter (the AI track left out: it is the "AI" chip) */
  tracks: { id: string; title: string }[]
  ai: boolean
  /** Titles of the modules projects need */
  modules: Record<string, string>
  /** The course to start that opens the most waiting projects, with its first lesson (unlockHint) */
  unlock?: UnlockHint & { title: string; viaTitle?: string; notebook?: string; topic?: string }
}

export type QueueAction = { kind: 'start'; id: string } | { kind: 'pause'; id: string } | { kind: 'up'; id: string } | { kind: 'cap'; cap: number }

/** One change the learner makes on the Projects page; throws with a reason it can't be done */
export function applyQueue(rows: Row[], q: QueueState, action: QueueAction): QueueState {
  const s = snapshotOf(rows, q)
  const row = 'id' in action ? rows.find((r) => r.id === action.id) : undefined
  if ('id' in action && !row) throw new Error('That project is gone from Roadmaps/Projects.')
  switch (action.kind) {
    case 'start': {
      if (s.building.includes(action.id)) return s
      if (s.building.length >= capOf(q)) throw new Error(`${capOf(q) === 1 ? 'One is' : `${capOf(q)} are`} being built. Finish or pause one first.`)
      if (!isReady(row!)) throw new Error('Its first milestone still waits on modules.')
      return { ...s, building: [...s.building, action.id], order: s.order.filter((x) => x !== action.id), paused: s.paused.filter((x) => x !== action.id) }
    }
    case 'pause': {
      if (!s.building.includes(action.id)) return s
      return { ...s, building: s.building.filter((x) => x !== action.id), order: [...s.order.filter((x) => x !== action.id), action.id], paused: [...new Set([...s.paused, action.id])] }
    }
    case 'up': {
      const i = s.order.indexOf(action.id)
      if (i <= 0) return s
      const order = [...s.order]
      order.splice(i, 1)
      order.splice(i - 1, 0, action.id)
      return { ...s, order }
    }
    case 'cap':
      return { ...s, cap: Math.max(1, Math.min(MAX_CAP, Math.round(action.cap) || DEFAULT_CAP)) }
  }
}

// ---------- A suggested project, in the vault's format ----------

export interface SuggestedProject {
  id: string
  title: string
  tracks: string[]
  about: string
  milestones: { id: string; title: string; needs: string[]; about?: string; done?: string; hours?: number }[]
}

const slug = (s: string) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
const oneLine = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** A model's reply, tidied into suggestions (ids made safe, at most 12 milestones) */
export function parseSuggestions(raw: unknown): SuggestedProject[] {
  const list = (raw as { projects?: unknown[] })?.projects
  if (!Array.isArray(list)) return []
  return list
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.title === 'string' && Array.isArray(x.milestones))
    .map((x) => ({
      id: slug(String(x.id || x.title)),
      title: oneLine(x.title).slice(0, 80),
      tracks: (Array.isArray(x.tracks) ? x.tracks : []).map((t) => slug(String(t))).filter(Boolean),
      about: oneLine(x.about).slice(0, 600),
      milestones: (x.milestones as unknown[])
        .map((m) => m as Record<string, unknown>)
        .filter((m) => m && typeof m.title === 'string')
        .slice(0, 12)
        .map((m, i) => ({
          id: slug(String(m.id || m.title)) || `m${i + 1}`,
          title: oneLine(m.title).slice(0, 80),
          needs: (Array.isArray(m.needs) ? m.needs : String(m.needs ?? '').split(',')).map((n) => slug(String(n))).filter(Boolean),
          ...(m.about ? { about: oneLine(m.about).slice(0, 400) } : {}),
          ...(m.done ? { done: oneLine(m.done).slice(0, 300) } : {}),
          ...(Number(m.hours) > 0 ? { hours: Math.min(80, Math.round(Number(m.hours))) } : {})
        }))
    }))
    .filter((p) => p.id && p.milestones.length)
}

/** The project file, as Roadmaps/Projects/*.md are written */
export function projectMarkdown(p: SuggestedProject): string {
  const ms = p.milestones
    .map((m) => [`  - id: ${m.id}`, `    title: ${m.title.replace(/[:#]/g, ' ').replace(/\s+/g, ' ')}`, `    needs: [${m.needs.join(', ')}]`, ...(m.hours ? [`    hours: ${m.hours}`] : [])].join('\n'))
    .join('\n')
  const parts = p.milestones
    .map((m, i) => [`## ${i + 1}. ${m.title} (\`${p.id}#${m.id}\`)`, '', `Needs: ${m.needs.join(', ')}`, ...(m.about ? ['', m.about] : []), ...(m.done ? ['', `Done when: ${m.done}`] : [])].join('\n'))
    .join('\n\n')
  return `---\nproject: ${p.id}\ntitle: ${p.title.replace(/[:#]/g, ' ').replace(/\s+/g, ' ')}\ntracks: [${p.tracks.join(', ')}]\nmilestones:\n${ms}\n---\n# ${p.title}\n\n${p.about || p.title}\n\n${parts}\n`
}

export const projectPath = (id: string) => `${PROJECTS_DIR}/${id}.md`

/** What Claude suggests from: the goal note, what they're into lately, the module catalogue and the projects there are */
export function suggestPrompt(o: { goal: string; lately: string; modules: { id: string; title: string; track: string; requires: string[] }[]; tracks: { id: string; title: string }[]; projects: { id: string; title: string }[] }): string {
  return `The learner's goal and interests (their own note):
${o.goal.trim().slice(0, 4000) || '(not written yet)'}
${o.lately.trim() ? `\nWhat they are into lately: ${o.lately.trim().slice(0, 600)}\n` : ''}
Tracks (id: title): ${o.tracks.map((t) => `${t.id}: ${t.title}`).join('; ')}

Modules (id | title | track | requires):
${o.modules.map((m) => `${m.id} | ${m.title} | ${m.track} | ${m.requires.join(', ')}`).join('\n')}

Projects they already have (don't repeat them): ${o.projects.map((p) => p.title).join('; ') || 'none'}

Propose 3 projects that serve the goal, each with 5 to 9 milestones. Every "needs" entry must be a module id from the list above, exactly. Return ONLY JSON:
{"projects": [{"id": "short-kebab-id", "title": "Title", "tracks": ["track-id"], "about": "two or three sentences: what gets built and why it matters", "milestones": [{"id": "kebab-id", "title": "Short title", "needs": ["module-id"], "about": "one sentence: what to build", "done": "one sentence: how you know it's done", "hours": 12}]}]}`
}

/**
 * Reads the file back with the vault's parser and checks it: an id not taken, at least one
 * milestone, and every need a real module. The reasons it fails, in plain words (none when sound).
 */
export function checkProject(md: string, o: { modules: { id: string; title?: string }[]; projects: Pick<ProjectDef, 'id'>[] }): { def: ProjectDef | null; problems: string[] } {
  const def = parseProject(projectPath(md.match(/^project:\s*(\S+)/m)?.[1] ?? 'project'), md)
  if (!def) return { def: null, problems: ['It has no project id.'] }
  const problems: string[] = []
  if (o.projects.some((p) => p.id === def.id)) problems.push(`A project called ${def.id} is already in Roadmaps/Projects.`)
  if (!def.milestones.length) problems.push('It has no milestones.')
  const known = new Set(o.modules.map((m) => m.id))
  const bad = [...new Set(def.milestones.flatMap((m) => m.needs).filter((n) => !known.has(n)))]
  if (bad.length) problems.push(`${bad.length === 1 ? 'This is not a module' : 'These are not modules'} in Roadmaps/Modules: ${bad.join(', ')}.`)
  const empty = def.milestones.filter((m) => !m.needs.length).map((m) => m.title)
  if (empty.length) problems.push(`${empty.join(', ')} ${empty.length === 1 ? 'needs' : 'need'} at least one module.`)
  return { def, problems }
}
