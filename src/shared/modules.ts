/**
 * Modules and tracks: courses as small files with prerequisites, instead of a few huge roadmaps.
 *
 * - A module is `Roadmaps/Modules/<id>.md`: front matter (id, title, home track, `requires` and
 *   `helps`, level, interview tags, hours, where its items came from) and a body in the roadmap
 *   format, so `roadmapTopics` and `phasesOf` read it unchanged. Its topic ids start with the
 *   module id, so a module several tracks share has its topics once and one progress.
 * - A track is `Roadmaps/Tracks/<id>.md`: a title and the modules it lists (a suggested order, not
 *   binding). A track is what the sidebar shows as a notebook; modules are never notebooks.
 * - The `requires` edges make a DAG. A module opens once every module it requires has passed its
 *   gate (or the learner says "I'm there"); inside a module, its parts are gated in order as a
 *   roadmap's phases always were (shared/track).
 *
 * Pure: main/modules reads the files and keeps the records.
 */
import { roadmapTopics, type RoadmapTopic } from './curriculum'
import { trackGates, type Phase, type PhaseGate, type TrackGates, type TrackRecord, type CapstoneState, phasesOf, emptyTrack } from './track'
import { roadmapConcepts, type ConceptIn, type ConceptState } from './knowledge'

export const MODULES_DIR = 'Roadmaps/Modules'
export const TRACKS_DIR = 'Roadmaps/Tracks'
export const PROJECTS_DIR = 'Roadmaps/Projects'

export type ModuleLevel = 'core' | 'supporting' | 'later' | 'optional'
export const LEVELS: ModuleLevel[] = ['core', 'supporting', 'later', 'optional']
export const INTERVIEW_TAGS = ['swe', 'core-infra', 'quant', 'data', 'ml'] as const

export interface ModuleDef {
  id: string
  title: string
  /** Its home track's id ("shared" for a module several tracks use) */
  track: string
  requires: string[]
  helps: string[]
  level: ModuleLevel
  interview: string[]
  hours: number
  replaces: string[]
  /** Vault path of its file */
  path: string
  /** The roadmap-format body, front matter removed */
  body: string
  /** "Depth goal: …" */
  depthGoal?: string
  /** "Gate: …" */
  gate?: string
}

export interface TrackDef {
  id: string
  title: string
  modules: string[]
  about?: string
  path: string
}

// ---------- Reading the files ----------

const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2').trim()

/** A comment starts at a # with a space before it, outside quotes */
function stripComment(v: string): string {
  let q: string | null = null
  for (let i = 0; i < v.length; i++) {
    const c = v[i]
    if (q) {
      if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '#' && (i === 0 || /\s/.test(v[i - 1]))) return v.slice(0, i).trimEnd()
  }
  return v
}

function splitList(inner: string): string[] {
  const out: string[] = []
  let q: string | null = null
  let cur = ''
  for (const c of inner) {
    if (q) {
      if (c === q) q = null
      cur += c
    } else if (c === '"' || c === "'") {
      q = c
      cur += c
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map(unquote).filter(Boolean)
}

/** Front matter as plain values: strings, inline lists ([a, "b"]) and block lists (- a) */
export function frontMatter(md: string): { data: Record<string, string | string[]>; body: string } {
  const text = md.replace(/\r\n/g, '\n').replace(/^﻿/, '')
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { data: {}, body: text }
  const data: Record<string, string | string[]> = {}
  let listKey: string | null = null
  for (const raw of m[1].split('\n')) {
    const item = raw.match(/^\s+-\s+(.*)$/) ?? (listKey ? raw.match(/^-\s+(.*)$/) : null)
    if (item && listKey) {
      ;(data[listKey] as string[]).push(unquote(stripComment(item[1])))
      continue
    }
    const kv = raw.match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    const v = stripComment(kv[2]).trim()
    listKey = null
    if (!v) {
      data[kv[1]] = []
      listKey = kv[1]
    } else if (v.startsWith('[') && v.endsWith(']')) data[kv[1]] = splitList(v.slice(1, -1))
    else data[kv[1]] = unquote(v)
  }
  return { data, body: text.slice(m[0].length) }
}

const asList = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? splitList(v) : [])
const asStr = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? ''))
const idOf = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** A line like "Gate: …" (bold or not) and what follows it up to the next heading */
function fieldBlock(body: string, name: string): string | undefined {
  const lines = body.split('\n')
  const at = lines.findIndex((l) => new RegExp(`^\\s*\\**\\s*${name}\\s*:?\\**\\s*:`, 'i').test(l))
  if (at < 0) return undefined
  const first = lines[at].replace(new RegExp(`^\\s*\\**\\s*${name}\\s*:?\\**\\s*:\\s*`, 'i'), '')
  const rest: string[] = []
  for (const l of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(l)) break
    if (name !== 'gate' && !l.trim()) break
    rest.push(l)
  }
  const out = [first, ...rest].join('\n').trim()
  return out || undefined
}

/** One module file read; null when it has no module id and no name to make one from */
export function parseModule(path: string, md: string): ModuleDef | null {
  const { data, body } = frontMatter(md)
  const file = path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  const id = idOf(asStr(data.module) || file)
  if (!id) return null
  const h1 = body.match(/^#\s+(.+?)\s*$/m)?.[1]
  const level = asStr(data.level).toLowerCase() as ModuleLevel
  const hours = Number(asStr(data.hours))
  return {
    id,
    title: asStr(data.title) || h1 || file,
    track: idOf(asStr(data.track)) || 'shared',
    requires: [...new Set(asList(data.requires).map(idOf).filter((x) => x && x !== id))],
    helps: [...new Set(asList(data.helps).map(idOf).filter((x) => x && x !== id))],
    level: LEVELS.includes(level) ? level : 'core',
    interview: [...new Set(asList(data.interview).map((x) => x.toLowerCase()))],
    hours: Number.isFinite(hours) && hours > 0 ? hours : 0,
    replaces: asList(data.replaces),
    path,
    body,
    ...(fieldBlock(body, 'depth goal') ? { depthGoal: fieldBlock(body, 'depth goal') } : {}),
    ...(fieldBlock(body, 'gate') ? { gate: fieldBlock(body, 'gate') } : {})
  }
}

export function parseTrack(path: string, md: string): TrackDef | null {
  const { data, body } = frontMatter(md)
  const file = path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  const id = idOf(asStr(data.track) || file)
  if (!id) return null
  const h1 = body.match(/^#\s+(.+?)\s*$/m)?.[1]
  const about = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  return { id, title: asStr(data.title) || h1 || file, modules: [...new Set(asList(data.modules).map(idOf).filter(Boolean))], ...(about ? { about } : {}), path }
}

/** A list of maps in front matter (milestones: - id: m1 / title: … / needs: [a, b]) */
export function frontMatterMaps(md: string, key: string): Record<string, string | string[]>[] {
  const m = md.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/)
  if (!m) return []
  const lines = m[1].split('\n')
  const at = lines.findIndex((l) => new RegExp(`^${key}\\s*:\\s*$`).test(l))
  if (at < 0) return []
  const out: Record<string, string | string[]>[] = []
  let cur: Record<string, string | string[]> | null = null
  let listKey: string | null = null
  for (const l of lines.slice(at + 1)) {
    if (/^\S/.test(l)) break
    const start = l.match(/^\s*-\s+([\w-]+)\s*:\s*(.*)$/)
    const field = l.match(/^\s+([\w-]+)\s*:\s*(.*)$/)
    const item = l.match(/^\s+-\s+(.*)$/)
    const put = (k: string, raw: string) => {
      const v = stripComment(raw).trim()
      listKey = null
      if (!v) {
        cur![k] = []
        listKey = k
      } else cur![k] = v.startsWith('[') && v.endsWith(']') ? splitList(v.slice(1, -1)) : unquote(v)
    }
    if (start && (!cur || (l.match(/^\s*/)?.[0].length ?? 0) <= 2)) {
      cur = {}
      out.push(cur)
      put(start[1], start[2])
    } else if (item && listKey && cur) (cur[listKey] as string[]).push(unquote(stripComment(item[1])))
    else if (field && cur) put(field[1], field[2])
  }
  return out
}

// ---------- Projects ----------

export interface ProjectMilestone {
  id: string
  title: string
  /** Modules that must be started (or solid) before it can be built */
  needs: string[]
  hours: number
  about?: string
}

export interface ProjectDef {
  id: string
  title: string
  /** The tracks it belongs to (its love interests among them) */
  tracks: string[]
  milestones: ProjectMilestone[]
  about?: string
  level?: number
  path: string
}

/**
 * A project file: front matter with its id, title, tracks and milestones (each with the modules it
 * needs), or milestones as "## 1. Title" headings with a "Needs: a, b" line under each.
 */
export function parseProject(path: string, md: string): ProjectDef | null {
  const { data, body } = frontMatter(md)
  const file = path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  const id = idOf(asStr(data.project) || file)
  if (!id) return null
  const h1 = body.match(/^#\s+(.+?)\s*$/m)?.[1]
  let milestones: ProjectMilestone[] = frontMatterMaps(md, 'milestones').map((x, i) => ({ id: idOf(asStr(x.id)) || `m${i + 1}`, title: asStr(x.title) || `Milestone ${i + 1}`, needs: asList(x.needs).map(idOf).filter(Boolean), hours: Number(asStr(x.hours)) || 0, ...(asStr(x.about || x.build) ? { about: asStr(x.about || x.build) } : {}) }))
  if (!milestones.length) {
    const parts = body.split(/^(?=##\s)/m).filter((p) => /^##\s/.test(p))
    milestones = parts.map((p, i) => {
      const title = p.match(/^##\s+(?:\d+[.)]\s*)?(.+?)\s*$/m)![1]
      const needs = p.match(/^\s*\**\s*needs\s*\**\s*:\s*(.+)$/im)?.[1]
      const hours = Number(p.match(/^\s*\**\s*hours\s*\**\s*:\s*(\d+)/im)?.[1])
      return { id: `m${i + 1}`, title, needs: needs ? needs.replace(/[[\]]/g, '').split(/[,;]/).map(idOf).filter(Boolean) : [], hours: hours || 0 }
    })
  }
  const about = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && !/^\**\s*needs\s*:/i.test(l))
  const level = Number(asStr(data.level))
  return { id, title: asStr(data.title) || h1 || file, tracks: asList(data.tracks).map(idOf).filter(Boolean), milestones, ...(about ? { about } : {}), ...(level >= 1 && level <= 4 ? { level } : {}), path }
}

/** "Project: … (project: ledger#m2)" on a module's project line: the project and milestone it points at */
export function projectRef(title: string): { project: string; milestone?: string } | null {
  const m = title.match(/\(\s*project:\s*([a-z0-9-]+)(?:#([a-z0-9-]+))?\s*\)/i) ?? title.match(/\b([a-z0-9-]+)#([a-z0-9-]+)\s*$/i)
  return m ? { project: m[1].toLowerCase(), ...(m[2] ? { milestone: m[2].toLowerCase() } : {}) } : null
}

export interface ProjectRow {
  id: string
  title: string
  tracks: string[]
  /** Set up in Projects (levels, ready check, mentor): its notebook */
  notebook?: string
  milestones: { id: string; title: string; status: 'done' | 'open' | 'locked'; waiting: string[]; hours: number }[]
  next?: { id: string; title: string; hours: number }
  done: number
  level?: number
}

export type MilestoneStatus = 'done' | 'open' | 'locked'

/**
 * Where each milestone of a project stands: done (built), open (every module it needs started or
 * passed: the next one is planned as building work) or locked; and the next open one.
 */
export function projectState(p: ProjectDef, gates: Map<string, Pick<ModuleGate, 'status'>>, done: ReadonlySet<string> = new Set()): { milestones: { id: string; title: string; status: MilestoneStatus; waiting: string[]; hours: number }[]; next: ProjectMilestone | null } {
  const started = (id: string) => {
    const g = gates.get(id)
    return !g || g.status === 'active' || g.status === 'passed'
  }
  const ms = p.milestones.map((m) => {
    const waiting = m.needs.filter((n) => !started(n))
    return { id: m.id, title: m.title, status: (done.has(m.id) ? 'done' : waiting.length ? 'locked' : 'open') as MilestoneStatus, waiting, hours: m.hours }
  })
  // Milestones are built in order: the next is the first not built, if it's open
  const first = ms.find((m) => m.status !== 'done')
  return { milestones: ms, next: first?.status === 'open' ? p.milestones.find((m) => m.id === first.id)! : null }
}

// ---------- The catalogue: modules and tracks together ----------

export interface Catalogue {
  modules: ModuleDef[]
  tracks: TrackDef[]
  projects?: ProjectDef[]
}

export const moduleById = (c: Catalogue) => new Map(c.modules.map((m) => [m.id, m]))

/**
 * The tracks that list a module: its home track first; for a shared module, the track that lists
 * it earliest (where it is most foundational), then by how many modules the track has
 */
export function tracksOfModule(c: Catalogue, id: string): TrackDef[] {
  const m = c.modules.find((x) => x.id === id)
  const listing = c.tracks.filter((t) => t.modules.includes(id)).sort((a, b) => a.modules.indexOf(id) / Math.max(1, a.modules.length) - b.modules.indexOf(id) / Math.max(1, b.modules.length) || b.modules.length - a.modules.length)
  const home = listing.find((t) => t.id === m?.track)
  return home ? [home, ...listing.filter((t) => t !== home)] : listing
}

/** The subject a module's topics count under on the knowledge map: its home track's title, else the first track listing it */
export function moduleArea(c: Catalogue, id: string): string {
  const m = c.modules.find((x) => x.id === id)
  return tracksOfModule(c, id)[0]?.title ?? c.tracks.find((t) => t.id === m?.track)?.title ?? m?.title ?? id
}

/** A track's modules, in the order it lists them (unknown ids left out) */
export function trackModules(c: Catalogue, track: TrackDef): ModuleDef[] {
  const by = moduleById(c)
  return track.modules.map((id) => by.get(id)).filter((m): m is ModuleDef => !!m)
}

/** Modules no track lists: shown under their home track so nothing is lost */
export function orphanModules(c: Catalogue): ModuleDef[] {
  const listed = new Set(c.tracks.flatMap((t) => t.modules))
  return c.modules.filter((m) => !listed.has(m.id))
}

// ---------- Topics and parts ----------

/**
 * A module's topics. Ids start with the module id (one progress, whichever track shows it); the
 * path starts with the module's title so a scope or heading can name the whole module; `notebook`
 * is the track it's seen from (the scheduler's queues are per track).
 */
export function moduleTopics(m: ModuleDef, notebook?: string): RoadmapTopic[] {
  return roadmapTopics(m.id, m.body).map((t) => ({ ...t, notebook: notebook ?? m.title, path: [m.title, ...t.path], module: m.id, file: m.path }))
}

/** A module's parts, as phases (gated in order inside the module) */
export function moduleParts(m: ModuleDef, notebook?: string): Phase[] {
  const fix = (t: RoadmapTopic): RoadmapTopic => ({ ...t, notebook: notebook ?? m.title, path: [m.title, ...t.path], module: m.id, file: m.path })
  return phasesOf(m.id, m.body).map((p) => ({ ...p, module: m.id, moduleTitle: m.title, topics: p.topics.map(fix), practice: p.practice.map(fix), projects: p.projects.map(fix) }))
}

const tnorm = (s: string) =>
  s
    .replace(/\*\*/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Every module's concepts for the knowledge map, by subject (each module under its home track's
 * title). As a roadmap's, each topic builds on the one before it in its section; and a module's
 * requires are edges too: the first topic of each of its parts builds on the last topic of every
 * module it requires, so the learner model's graph and a lesson's "builds on" see the DAG.
 */
export function moduleConcepts(c: Catalogue): Map<string, ConceptIn[]> {
  const deps = safeRequires(c.modules)
  const lastOf = new Map<string, string>()
  const byModule = new Map<string, ConceptIn[]>()
  for (const m of c.modules) {
    const area = moduleArea(c, m.id)
    const concepts = roadmapConcepts(moduleTopics(m, area))
    byModule.set(m.id, concepts)
    const taught = concepts.filter((x) => !/^\**\s*practice\s*:/i.test(x.name))
    if (taught.length) lastOf.set(m.id, taught[taught.length - 1].id)
  }
  const out = new Map<string, ConceptIn[]>()
  for (const m of c.modules) {
    const concepts = byModule.get(m.id) ?? []
    const needs = (deps.get(m.id) ?? []).map((r) => lastOf.get(r)).filter((x): x is string => !!x)
    if (needs.length) {
      const firsts = new Set(moduleParts(m).map((p) => p.topics[0]?.id).filter(Boolean))
      for (const x of concepts) if (firsts.has(x.id)) x.prerequisites = [...new Set([...x.prerequisites, ...needs])]
    }
    const area = moduleArea(c, m.id)
    out.set(area, [...(out.get(area) ?? []), ...concepts])
  }
  return out
}

// ---------- The DAG ----------

export type DagIssue =
  | { kind: 'missing'; module: string; ref: string; via: 'requires' | 'helps' | 'track' }
  | { kind: 'cycle'; modules: string[] }
  | { kind: 'duplicate-id'; module: string; paths: string[] }
  | { kind: 'duplicate-topic'; topic: string; modules: string[] }

/** What's wrong with the catalogue: ids no file has, cycles in `requires`, an id twice, a topic in two modules */
export function checkDag(c: Catalogue): DagIssue[] {
  const out: DagIssue[] = []
  const paths = new Map<string, string[]>()
  for (const m of c.modules) paths.set(m.id, [...(paths.get(m.id) ?? []), m.path])
  for (const [id, ps] of paths) if (ps.length > 1) out.push({ kind: 'duplicate-id', module: id, paths: ps })
  const ids = new Set(c.modules.map((m) => m.id))
  for (const m of c.modules) {
    for (const r of m.requires) if (!ids.has(r)) out.push({ kind: 'missing', module: m.id, ref: r, via: 'requires' })
    for (const r of m.helps) if (!ids.has(r)) out.push({ kind: 'missing', module: m.id, ref: r, via: 'helps' })
  }
  for (const t of c.tracks) for (const r of t.modules) if (!ids.has(r)) out.push({ kind: 'missing', module: t.id, ref: r, via: 'track' })
  for (const cyc of cyclesOf(c.modules)) out.push({ kind: 'cycle', modules: cyc })
  const seen = new Map<string, Set<string>>()
  for (const m of c.modules)
    for (const t of roadmapTopics(m.id, m.body)) {
      if (t.project || /^\**\s*practice\s*:/i.test(t.title)) continue
      const k = tnorm(t.title)
      if (k) seen.set(k, (seen.get(k) ?? new Set()).add(m.id))
    }
  for (const [topic, ms] of seen) if (ms.size > 1) out.push({ kind: 'duplicate-topic', topic, modules: [...ms] })
  return out
}

/** Each cycle in `requires`, once, as the modules on it in order */
export function cyclesOf(modules: Pick<ModuleDef, 'id' | 'requires'>[]): string[][] {
  const by = new Map(modules.map((m) => [m.id, m]))
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const out: string[][] = []
  const keys = new Set<string>()
  const visit = (id: string) => {
    state.set(id, 1)
    stack.push(id)
    for (const r of by.get(id)?.requires ?? []) {
      if (!by.has(r)) continue
      if (state.get(r) === 1) {
        const cyc = stack.slice(stack.indexOf(r))
        // The same cycle, whichever module it was entered from
        const min = cyc.indexOf([...cyc].sort()[0])
        const norm = [...cyc.slice(min), ...cyc.slice(0, min)]
        if (!keys.has(norm.join('>'))) {
          keys.add(norm.join('>'))
          out.push(norm)
        }
      } else if (!state.get(r)) visit(r)
    }
    stack.pop()
    state.set(id, 2)
  }
  for (const m of modules) if (!state.get(m.id)) visit(m.id)
  return out
}

/** The requires edges that are safe to follow: to modules that exist, never closing a cycle (the first edge back is dropped) */
export function safeRequires(modules: Pick<ModuleDef, 'id' | 'requires'>[]): Map<string, string[]> {
  const by = new Map(modules.map((m) => [m.id, m]))
  const deps = new Map(modules.map((m) => [m.id, m.requires.filter((r) => by.has(r) && r !== m.id)]))
  const state = new Map<string, 1 | 2>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const r of [...(deps.get(id) ?? [])]) {
      if (state.get(r) === 1) deps.set(id, (deps.get(id) ?? []).filter((x) => x !== r))
      else if (!state.get(r)) visit(r)
    }
    state.set(id, 2)
  }
  for (const m of modules) if (!state.get(m.id)) visit(m.id)
  return deps
}

/** How many modules build on each one: everything that requires it, directly or through others */
export function dependents(modules: Pick<ModuleDef, 'id' | 'requires'>[]): Map<string, number> {
  const deps = safeRequires(modules)
  const users = new Map<string, string[]>(modules.map((m) => [m.id, []]))
  for (const [id, rs] of deps) for (const r of rs) users.get(r)?.push(id)
  const out = new Map<string, number>()
  for (const m of modules) {
    const seen = new Set<string>()
    const walk = (id: string) => {
      for (const u of users.get(id) ?? [])
        if (!seen.has(u)) {
          seen.add(u)
          walk(u)
        }
    }
    walk(m.id)
    out.set(m.id, seen.size)
  }
  return out
}

/** Everything a module rests on, directly or through others */
export function ancestors(modules: Pick<ModuleDef, 'id' | 'requires'>[], id: string): Set<string> {
  const deps = safeRequires(modules)
  const out = new Set<string>()
  const walk = (x: string) => {
    for (const r of deps.get(x) ?? [])
      if (!out.has(r)) {
        out.add(r)
        walk(r)
      }
  }
  walk(id)
  return out
}

export const LEVEL_WEIGHT: Record<ModuleLevel, number> = { core: 1, supporting: 0.75, later: 0.35, optional: 0.2 }

/**
 * A module's value for ordering: its level, how much is built on it (fan-out) and whether it serves
 * the interview bars in force (each matching tag counts, times `urgency`).
 */
export function moduleValue(m: Pick<ModuleDef, 'id' | 'level' | 'interview'>, fanOut: number, o: { tags?: string[]; urgency?: number } = {}): number {
  const tags = o.tags ?? []
  const serves = tags.length ? m.interview.filter((t) => tags.includes(t)).length : 0
  return LEVEL_WEIGHT[m.level] * (1 + fanOut / 4) + (serves ? Math.min(2, serves) * 0.5 * (o.urgency ?? 1) : 0)
}

/**
 * A topological order: every module after what it requires. Among the modules that are ready, the
 * most valuable goes first; ties keep the given order. Cycles are broken (shared safeRequires).
 */
export function topoOrder<M extends Pick<ModuleDef, 'id' | 'requires'>>(modules: M[], value: (m: M) => number = () => 0): M[] {
  const deps = safeRequires(modules)
  const left = new Set(modules.map((m) => m.id))
  const out: M[] = []
  const idx = new Map(modules.map((m, i) => [m.id, i]))
  const vals = new Map(modules.map((m) => [m.id, value(m)]))
  while (left.size) {
    const ready = modules.filter((m) => left.has(m.id) && (deps.get(m.id) ?? []).every((d) => !left.has(d)))
    ready.sort((a, b) => (vals.get(b.id) ?? 0) - (vals.get(a.id) ?? 0) || idx.get(a.id)! - idx.get(b.id)!)
    const next = ready[0]
    out.push(next)
    left.delete(next.id)
  }
  return out
}

// ---------- Gates: the prerequisite gate over the DAG ----------

export type ModuleStatus = 'locked' | 'open' | 'active' | 'passed'

/** Records of each module's gates, kept in .tide/tracks.json beside the roadmaps' */
export interface ModuleRecords {
  /** Part gates, per module (the roadmap gate records, keyed module:<id>) */
  parts: Record<string, TrackRecord>
  /** "I'm there": the learner says a module's gate is met */
  there: Record<string, { at: number; note?: string }>
}

export const moduleRecordKey = (id: string) => `module:${id}`

export interface ModuleGate {
  module: ModuleDef
  status: ModuleStatus
  parts: TrackGates
  /** Requires not passed yet (ids) */
  waiting: string[]
  /** Requires naming a module no file has */
  missing: string[]
  there?: { at: number; note?: string }
  /** Topics: solid, shaky, still new, all */
  solid: number
  shaky: number
  fresh: number
  total: number
  /** Every part's gate passed (or the learner said they're there) */
  passed: boolean
  /** The part being worked on (index into its parts), when open */
  current: number | null
}

type GateConcept = Pick<ConceptState, 'status' | 'stability' | 'seen' | 'done' | 'right' | 'partly' | 'wrong'>

/**
 * Every module's gate. Its parts are gated in order (shared/track trackGates). It has passed when
 * every core part has; it's open when every module it requires has passed or was waved through by
 * "I'm there"; locked otherwise, with all its topics held back. Requires naming no module never block.
 */
export function moduleGates(
  modules: ModuleDef[],
  partsOf: (m: ModuleDef) => Phase[],
  concepts: Map<string, GateConcept>,
  records: ModuleRecords,
  capstones: (m: ModuleDef) => Record<string, CapstoneState> = () => ({})
): Map<string, ModuleGate> {
  const ids = new Set(modules.map((m) => m.id))
  const deps = safeRequires(modules)
  const inner = new Map<string, { parts: TrackGates; phases: Phase[] }>()
  for (const m of modules) {
    const phases = partsOf(m)
    inner.set(m.id, { phases, parts: trackGates(phases, concepts, records.parts[moduleRecordKey(m.id)] ?? emptyTrack(), capstones(m)) })
  }
  // Passed: every core part passed (or skipped past); a module whose parts are all optional needs them all; an empty one never passes on its own
  const passedOf = (id: string) => {
    const i = inner.get(id)
    if (records.there[id]) return true
    if (!i || !i.parts.gates.length) return false
    const core = i.parts.gates.filter((g) => !g.optional)
    return core.length ? i.parts.current === null : i.parts.gates.every((g) => g.passed || g.override)
  }
  const out = new Map<string, ModuleGate>()
  for (const m of modules) {
    const { parts } = inner.get(m.id)!
    const all = parts.gates
    const count = (k: 'solid' | 'shaky' | 'fresh') => all.reduce((n, g) => n + g[k].length, 0)
    const solid = count('solid')
    const shaky = count('shaky')
    const fresh = count('fresh')
    const passed = passedOf(m.id)
    const waiting = (deps.get(m.id) ?? []).filter((r) => !passedOf(r))
    const missing = m.requires.filter((r) => !ids.has(r))
    const status: ModuleStatus = passed ? 'passed' : waiting.length ? 'locked' : solid + shaky > 0 || all.some((g) => g.checkPassed || g.lastCheck) ? 'active' : 'open'
    out.set(m.id, { module: m, status, parts, waiting, missing, ...(records.there[m.id] ? { there: records.there[m.id] } : {}), solid, shaky, fresh, total: solid + shaky + fresh, passed, current: status === 'locked' || passed ? null : parts.current })
  }
  return out
}

/** Topic ids the scheduler holds back: all of a locked module, and the later parts of an open one */
export function moduleHeld(gates: Map<string, ModuleGate>): Set<string> {
  const held = new Set<string>()
  for (const g of gates.values()) {
    if (g.status === 'passed') continue
    if (g.status === 'locked') {
      for (const pg of g.parts.gates) for (const t of [...pg.phase.topics, ...pg.phase.practice]) held.add(t.id)
    } else for (const id of g.parts.held) held.add(id)
  }
  return held
}

/**
 * A track's gates in the shape a roadmap's have (shared/track TrackGates), for everything that
 * reads them: every module's parts in the track's order, the held topics, and as current the part
 * of the first open module being worked on.
 */
export function trackGatesOf(order: ModuleDef[], gates: Map<string, ModuleGate>): TrackGates & { modules: ModuleGate[] } {
  const list: PhaseGate[] = []
  const held = new Set<string>()
  let current: number | null = null
  const mods: ModuleGate[] = []
  for (const m of order) {
    const g = gates.get(m.id)
    if (!g) continue
    mods.push(g)
    const base = list.length
    const locked = g.status === 'locked'
    g.parts.gates.forEach((pg, i) => {
      list.push(locked ? { ...pg, open: false } : pg)
      if (current === null && !locked && !g.passed && g.current === i) current = base + i
    })
  }
  for (const id of moduleHeld(new Map(mods.map((g) => [g.module.id, g])))) held.add(id)
  return { gates: list, current, held, modules: mods }
}

/** "Needs Operating Systems, C" — the line shown on a locked module */
export function waitingLine(g: Pick<ModuleGate, 'waiting'>, byId: Map<string, Pick<ModuleDef, 'title'>>): string {
  if (!g.waiting.length) return ''
  return `Needs ${g.waiting.map((id) => byId.get(id)?.title ?? id).join(', ')}`
}

// ---------- Interleaving parallel modules ----------

/**
 * A track's queue with its open modules interleaved, most valuable first: smooth weighted round
 * robin, so two modules that can run side by side alternate within a day and a week rather than
 * one finishing before the other starts. Topics keep their order inside each module.
 */
export function interleaveModules<T extends { topicId?: string }>(queue: T[], moduleOf: (id: string) => string | undefined, weight: (module: string) => number): T[] {
  const groups = new Map<string, T[]>()
  const order: string[] = []
  for (const c of queue) {
    const m = (c.topicId && moduleOf(c.topicId)) || ''
    if (!groups.has(m)) {
      groups.set(m, [])
      order.push(m)
    }
    groups.get(m)!.push(c)
  }
  if (groups.size < 2) return queue
  const w = new Map(order.map((m) => [m, Math.max(0.05, m ? weight(m) : 0.5)]))
  const credit = new Map(order.map((m) => [m, 0]))
  const total = [...w.values()].reduce((a, b) => a + b, 0)
  const out: T[] = []
  while (out.length < queue.length) {
    const live = order.filter((m) => groups.get(m)!.length)
    for (const m of live) credit.set(m, credit.get(m)! + w.get(m)!)
    const pick = live.sort((a, b) => credit.get(b)! - credit.get(a)! || order.indexOf(a) - order.indexOf(b))[0]
    credit.set(pick, credit.get(pick)! - total)
    out.push(groups.get(pick)!.shift()!)
  }
  return out
}

// ---------- Hours ----------

/** Hours left on a module: its stated hours in proportion to the topics not yet solid (2.5 a topic when it states none) */
export function moduleHoursLeft(g: Pick<ModuleGate, 'solid' | 'total' | 'passed'> & { module: Pick<ModuleDef, 'hours'> }): number {
  if (g.passed) return 0
  const total = g.module.hours || g.total * 2.5
  if (!g.total) return Math.round(total)
  return Math.round(total * (1 - g.solid / g.total))
}

// ---------- The views ----------

export interface ModuleRow {
  id: string
  title: string
  level: ModuleLevel
  hours: number
  hoursLeft: number
  interview: string[]
  requires: { id: string; title: string; passed: boolean; missing?: boolean }[]
  /** Tracks other than this one that list it */
  shared: string[]
  status: ModuleStatus
  solid: number
  shaky: number
  total: number
  /** Parts: how many passed, of how many */
  parts: { passed: number; of: number }
  /** The part now (when open) */
  now?: string
  gate?: string
  depthGoal?: string
  there?: boolean
  path: string
  /** Value in the plan (fan-out): how many later modules build on it */
  fanOut: number
}

/**
 * Hours are rough relative sizes. Once a few weeks show how long the learner really takes, every
 * module's hours are scaled to that pace: hours studied on module work against the hours the
 * modules gave the topics made solid meanwhile (at least three weeks and five topics; 0.4× to 3×).
 */
export function paceFactor(o: { studiedHours: number; solid: { hoursEach: number }[]; days: number }): { factor: number; measured: boolean; weeks: number } {
  const weeks = Math.round(o.days / 7)
  const expected = o.solid.reduce((n, s) => n + s.hoursEach, 0)
  if (o.days < 21 || o.solid.length < 5 || expected <= 0 || o.studiedHours <= 0) return { factor: 1, measured: false, weeks }
  const f = Math.max(0.4, Math.min(3, o.studiedHours / expected))
  return { factor: Math.round(f * 100) / 100, measured: true, weeks }
}

export interface TrackModulesView {
  track: { id: string; title: string; about?: string }
  /** The learner's pace against the stated hours (hoursLeft is already scaled by it) */
  pace: { factor: number; measured: boolean; weeks: number }
  projects: { id: string; title: string; notebook?: string; next?: { id: string; title: string; hours: number }; done: number; of: number; milestones: { id: string; title: string; status: 'done' | 'open' | 'locked'; waiting: string[] }[] }[]
  modules: ModuleRow[]
  totals: { modules: number; passed: number; open: number; locked: number; hours: number; hoursLeft: number; solid: number; topics: number }
  issues: DagIssue[]
}

export function moduleRow(g: ModuleGate, o: { byId: Map<string, ModuleDef>; gates: Map<string, ModuleGate>; shared: string[]; fanOut: number }): ModuleRow {
  const m = g.module
  const cur = g.current !== null ? g.parts.gates[g.current]?.phase.title : undefined
  return {
    id: m.id,
    title: m.title,
    level: m.level,
    hours: m.hours,
    hoursLeft: moduleHoursLeft(g),
    interview: m.interview,
    requires: m.requires.map((r) => ({ id: r, title: o.byId.get(r)?.title ?? r, passed: !!o.gates.get(r)?.passed, ...(o.byId.has(r) ? {} : { missing: true }) })),
    shared: o.shared,
    status: g.status,
    solid: g.solid,
    shaky: g.shaky,
    total: g.total,
    parts: { passed: g.parts.gates.filter((x) => x.passed || x.override).length, of: g.parts.gates.length },
    ...(cur ? { now: cur } : {}),
    ...(m.gate ? { gate: m.gate } : {}),
    ...(m.depthGoal ? { depthGoal: m.depthGoal } : {}),
    ...(g.there ? { there: true } : {}),
    path: m.path,
    fanOut: o.fanOut
  }
}

// ---------- Interview tags and the milestone ----------

const ROLE_TAGS: [RegExp, string][] = [
  [/\bswe\b|software eng|graduate role|internship/i, 'swe'],
  [/core infra|infrastructure|bloomberg|\bmeta\b|systems/i, 'core-infra'],
  [/quant/i, 'quant'],
  [/\bdata\b/i, 'data'],
  [/\bml\b|machine learning|\bai\b/i, 'ml']
]

/** The interview tags a milestone's roles name (every tag when it names none) */
export function roleTags(roles: string[]): string[] {
  const out = new Set<string>()
  for (const r of roles) for (const [re, tag] of ROLE_TAGS) if (re.test(r)) out.add(tag)
  return out.size ? [...out] : [...INTERVIEW_TAGS]
}

/** Modules the interview bars in force cover, by their tags */
export const taggedModules = <M extends Pick<ModuleDef, 'interview'>>(modules: M[], tags: string[]) => modules.filter((m) => m.interview.some((t) => tags.includes(t)))

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A regular expression that matches exactly these names (a track's title, module titles) */
export const exactly = (names: string[]) => new RegExp(`^(${names.map((n) => esc(n.trim())).join('|')})$`, 'i')
