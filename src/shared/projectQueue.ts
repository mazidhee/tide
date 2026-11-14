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
import { parseProject, PROJECTS_DIR, type ProjectDef, type ProjectRow } from './modules'

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
