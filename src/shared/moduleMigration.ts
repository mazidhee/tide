/**
 * Moving progress from the old roadmaps to the modules, without loss (main/modules does the files).
 *
 * `_moves.json` says where each old item went: `{ "RM_SWE#Stack frames": "c-language" }` (null
 * when it was dropped on purpose). The plan pairs every old topic id with the topic of the same
 * wording in its module; everything else Tide keeps on a topic follows that id: the knowledge map's
 * evidence (which is the FSRS state, replayed), depth targets and links in the learner model,
 * learning events, placement results, lessons' links to their topic, phase checks.
 *
 * Every rewrite here is a function of the plan alone, so running it twice changes nothing more.
 */
import { roadmapTopics, type RoadmapTopic } from './curriculum'
import { phasesOf } from './track'
import { moduleById, moduleArea, moduleParts, moduleTopics, tracksOfModule, type Catalogue, type ModuleDef } from './modules'
import { normaliseWeights, sameTopic, topicTokens, MAX_TRACKS, type NorthStar, type StageTrack } from './northStar'

export interface OldRoadmap {
  /** Vault path, "Roadmaps/RM_SWE.md" */
  file: string
  /** The notebook it was the outline of ("Software Engineering") */
  notebook: string
  md: string
}

export type Moves = Record<string, string | null>

export interface IdPair {
  old: string
  new: string
  module: string
  how: 'moves' | 'text' | 'fuzzy'
  notebook: string
  oldTitle: string
  newTitle: string
  /** Ticked in the old roadmap */
  checked: boolean
  /** The old line's [[link]] target (a lesson note), kept on the new line */
  link?: string
  /** The new topic's file and line, for ticking it and keeping its link */
  file: string
  line: number
}

export interface MovePlan {
  pairs: IdPair[]
  dropped: { id: string; title: string; notebook: string }[]
  unplaced: { id: string; title: string; notebook: string; module?: string }[]
  /** Old phase id → the module part every one of its placed topics went to (when they all went to one) */
  phases: Record<string, { module: string; part: string }>
  /** Per old roadmap file: its topics, how many found a home, how many were dropped */
  files: Record<string, { notebook: string; total: number; placed: number; dropped: number }>
}

const tnorm = (s: string) =>
  s
    .replace(/\*\*/g, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, a, b) => b ?? a)
    .replace(/\s+[—–-]\s+_(.+?)_\s*$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** "Roadmaps/RM_SWE.md", "RM_SWE.md", "rm_swe" → "rm swe" */
export const fileKey = (f: string) => tnorm((f.split('/').pop() ?? f).replace(/\.md$/i, ''))

/** The moves file as a lookup: file key → topic text → module id (or null) */
export function movesIndex(moves: Moves): Map<string, Map<string, string | null>> {
  const out = new Map<string, Map<string, string | null>>()
  for (const [k, v] of Object.entries(moves ?? {})) {
    const at = k.indexOf('#')
    if (at < 0) continue
    const f = fileKey(k.slice(0, at))
    const t = tnorm(k.slice(at + 1))
    if (!f || !t) continue
    if (!out.has(f)) out.set(f, new Map())
    const m = out.get(f)!
    // The same wording twice in one file: the first home wins, a real one over a drop
    if (!m.has(t) || (m.get(t) === null && v)) m.set(t, typeof v === 'string' && v.trim() ? v.trim() : null)
  }
  return out
}

const linkOf = (md: string, t: RoadmapTopic): string | undefined => {
  const lines = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split('\n')
  return lines[t.line]?.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/)?.[1]?.trim()
}

/**
 * Pairs every old topic with its new home. The moves file decides the module; inside it, the topic
 * with the same wording (the same section first, the next unused one when a title repeats), else the
 * one whose words match when exactly one does. An item the moves file doesn't mention goes to the
 * one module that has its exact wording, if one does. Projects and practice lines move too.
 */
export function planMoves(old: OldRoadmap[], moves: Moves, cat: Catalogue): MovePlan {
  const idx = movesIndex(moves)
  const by = moduleById(cat)
  const topicsOf = new Map<string, RoadmapTopic[]>(cat.modules.map((m) => [m.id, moduleTopics(m)]))
  const anywhere = new Map<string, { module: string; t: RoadmapTopic }[]>()
  for (const [mid, ts] of topicsOf) for (const t of ts) anywhere.set(tnorm(t.title), [...(anywhere.get(tnorm(t.title)) ?? []), { module: mid, t }])
  // A title twice in one old roadmap goes to two topics; the same topic in two roadmaps goes to one (merged)
  let used = new Set<string>()
  const plan: MovePlan = { pairs: [], dropped: [], unplaced: [], phases: {}, files: {} }
  const partOf = new Map<string, string>()
  for (const m of cat.modules) for (const p of moduleParts(m)) for (const t of [...p.topics, ...p.practice, ...p.projects]) partOf.set(t.id, p.id)
  for (const rm of old) {
    const file = fileKey(rm.file)
    const map = idx.get(file)
    used = new Set<string>()
    const topics = roadmapTopics(rm.notebook, rm.md)
    const stat = { notebook: rm.notebook, total: topics.length, placed: 0, dropped: 0 }
    plan.files[rm.file] = stat
    for (const t of topics) {
      const key = tnorm(t.title)
      const dest = map?.get(key)
      if (dest === null) {
        plan.dropped.push({ id: t.id, title: t.title, notebook: rm.notebook })
        stat.dropped++
        continue
      }
      let hit: { module: string; t: RoadmapTopic; how: IdPair['how'] } | null = null
      if (dest && by.has(dest)) {
        const inMod = topicsOf.get(dest) ?? []
        const same = inMod.filter((x) => tnorm(x.title) === key && !used.has(x.id))
        const pick = same.find((x) => tnorm(x.section) === tnorm(t.section)) ?? same[0]
        if (pick) hit = { module: dest, t: pick, how: 'moves' }
        else {
          const tok = topicTokens(t.title)
          const close = inMod.filter((x) => !used.has(x.id) && sameTopic(tok, topicTokens(x.title)))
          if (close.length === 1) hit = { module: dest, t: close[0], how: 'fuzzy' }
        }
      } else if (dest === undefined) {
        const same = (anywhere.get(key) ?? []).filter((x) => !used.has(x.t.id))
        if (same.length && new Set(same.map((x) => x.module)).size === 1) hit = { ...(same.find((x) => tnorm(x.t.section) === tnorm(t.section)) ?? same[0]), how: 'text' }
      }
      if (!hit) {
        plan.unplaced.push({ id: t.id, title: t.title, notebook: rm.notebook, ...(dest ? { module: dest } : {}) })
        continue
      }
      used.add(hit.t.id)
      stat.placed++
      const link = linkOf(rm.md, t)
      plan.pairs.push({ old: t.id, new: hit.t.id, module: hit.module, how: hit.how, notebook: rm.notebook, oldTitle: t.title, newTitle: hit.t.title, checked: t.checked, ...(link ? { link } : {}), file: by.get(hit.module)!.path, line: hit.t.line })
    }
    // A phase whose topics all went to one module part keeps its gate records there
    const newOf = new Map(plan.pairs.filter((p) => p.notebook === rm.notebook).map((p) => [p.old, p.new]))
    for (const ph of phasesOf(rm.notebook, rm.md)) {
      const parts = new Set([...ph.topics, ...ph.practice, ...ph.projects].map((x) => newOf.get(x.id)).filter((x): x is string => !!x).map((x) => partOf.get(x)))
      const placed = [...ph.topics, ...ph.practice, ...ph.projects].filter((x) => newOf.has(x.id))
      if (parts.size === 1 && placed.length) {
        const part = [...parts][0]!
        plan.phases[ph.id] = { module: plan.pairs.find((p) => p.new === newOf.get(placed[0].id))!.module, part }
      }
    }
  }
  return plan
}

/**
 * Whether an old roadmap's items went somewhere (placed, or dropped on purpose), nearly all of them:
 * its notebook can leave its outline. An item with no home keeps whatever progress it has on the map.
 */
export const fileCovered = (s: MovePlan['files'][string] | undefined, share = 0.9) => !!s && s.total > 0 && s.placed + s.dropped >= Math.ceil(s.total * share)

// ---------- Rewriting ids ----------

export type IdMap = (s: string) => string

/** The plan as a function on ids: an old topic id → its new one; a plan step's id (old##step) follows its topic */
export function idMapper(plan: Pick<MovePlan, 'pairs'>): IdMap {
  const map = new Map(plan.pairs.filter((p) => p.old !== p.new).map((p) => [p.old, p.new]))
  return (s: string) => {
    const hit = map.get(s)
    if (hit) return hit
    // Evidence a placement check left names its topic in its source
    if (s.startsWith('placement:')) {
      const p = map.get(s.slice(10))
      if (p) return `placement:${p}`
    }
    const at = s.indexOf('##')
    if (at > 0) {
      const head = map.get(s.slice(0, at))
      if (head) return head + s.slice(at)
    }
    return s
  }
}

/** Any JSON value with every string and key that is an old id rewritten; how many changed */
export function rewriteDeep<T>(value: T, map: IdMap): { value: T; changed: number } {
  let changed = 0
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const n = map(v)
      if (n !== v) changed++
      return n
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const nk = map(k)
        if (nk !== k) changed++
        const nv = walk(x)
        // Two old keys onto one new one: the value already there stays, the other is merged in when both are objects
        if (nk in out && out[nk] && typeof out[nk] === 'object' && nv && typeof nv === 'object' && !Array.isArray(nv)) out[nk] = { ...(nv as object), ...(out[nk] as object) }
        else if (!(nk in out)) out[nk] = nv
      }
      return out
    }
    return v
  }
  return { value: walk(value) as T, changed }
}

// ---------- The knowledge map's file ----------

export interface KEvidence {
  source: string
  pos: string
  kind: string
  at: number
  weight: number
  private?: boolean
  supersedes?: string
}

export interface KConcept {
  id: string
  name: string
  area: string
  section?: string | null
  parent?: string | null
  origin: string
  order: number
  prerequisites: string[]
  done?: boolean
  private?: boolean
  evidence?: KEvidence[]
}

export interface KFile {
  version?: number
  model?: string
  concepts: KConcept[]
  filled?: string[]
}

/**
 * The knowledge file with every concept on an old topic moved to its new id, area and section. Two
 * old topics on one new one are merged: evidence kept once per source and position (the earlier
 * time kept), ticked if either was. Plan steps follow their topic. Nothing is dropped.
 */
export function migrateKnowledge(file: KFile, map: IdMap, homes: Map<string, { area: string; section?: string }>): { file: KFile; moved: number; merged: number } {
  const out: KConcept[] = []
  const at = new Map<string, number>()
  let moved = 0
  let merged = 0
  const areaOf = new Map<string, string>()
  for (const c of file.concepts ?? []) {
    const id = map(c.id)
    const parent = c.parent ? map(c.parent) : c.parent
    const home = homes.get(c.parent ? (parent ?? '') : id)
    const next: KConcept = { ...c, id, ...(c.parent !== undefined ? { parent } : {}), prerequisites: [...new Set((c.prerequisites ?? []).map(map))].filter((p) => p !== id), evidence: (c.evidence ?? []).map((e) => (e.source.startsWith('placement:') && map(e.source) !== e.source ? { ...e, source: map(e.source) } : e)) }
    if (id !== c.id || (c.parent && parent !== c.parent)) {
      moved++
      if (home) {
        next.area = home.area
        if (!c.parent && home.section !== undefined) next.section = home.section
      }
    }
    if (!c.parent) areaOf.set(id, next.area)
    const i = at.get(id)
    if (i === undefined) {
      at.set(id, out.length)
      out.push(next)
      continue
    }
    merged++
    const into = out[i]
    const keys = new Map((into.evidence ?? []).map((e, k) => [`${e.source}\u0000${e.pos}`, k]))
    for (const e of next.evidence ?? []) {
      const k = keys.get(`${e.source}\u0000${e.pos}`)
      if (k === undefined) {
        keys.set(`${e.source}\u0000${e.pos}`, (into.evidence ??= []).length)
        into.evidence!.push(e)
      } else if (e.at < into.evidence![k].at) into.evidence![k] = { ...into.evidence![k], at: e.at }
    }
    into.evidence!.sort((a, b) => a.at - b.at)
    into.done = !!(into.done || next.done)
    into.prerequisites = [...new Set([...into.prerequisites, ...next.prerequisites])].filter((p) => p !== into.id)
    if (into.origin !== 'roadmap' && next.origin === 'roadmap') into.origin = 'roadmap'
  }
  // A step's subject is its topic's
  for (const c of out) if (c.parent && areaOf.has(c.parent)) c.area = areaOf.get(c.parent)!
  return { file: { ...file, concepts: out }, moved, merged }
}

/** Where each new topic lives on the map: its module's subject and its section */
export function homesOf(cat: Catalogue): Map<string, { area: string; section?: string }> {
  const out = new Map<string, { area: string; section?: string }>()
  for (const m of cat.modules) {
    const area = moduleArea(cat, m.id)
    for (const t of moduleTopics(m, area)) out.set(t.id, { area, ...(t.section ? { section: t.section } : {}) })
  }
  return out
}

// ---------- The module files: ticks and lesson links ----------

const BOX = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/

/**
 * A module file with the old roadmap's ticks and lesson links carried over: a topic ticked there is
 * ticked here, and a line that linked to a lesson note links to it here (shown with the new
 * wording). Only those lines change; a line already ticked or linked is left as it is.
 */
export function carryLines(md: string, pairs: Pick<IdPair, 'line' | 'newTitle' | 'checked' | 'link'>[]): { md: string; changed: number } {
  const fm = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  const offset = fm ? fm[0].split('\n').length - 1 : 0
  const lines = md.split('\n')
  let changed = 0
  for (const p of pairs) {
    const at = offset + p.line
    const m = lines[at]?.match(BOX)
    if (!m || tnorm(m[4]) !== tnorm(p.newTitle)) continue
    let box = m[2]
    let text = m[4]
    if (p.checked && box === ' ') box = 'x'
    if (p.link && !/\[\[/.test(text)) {
      const src = text.match(/\s+[—–-]\s+_(.+?)_\s*$/)
      const main = src ? text.slice(0, src.index) : text
      const cr = main.endsWith('\r') ? '\r' : ''
      text = `[[${p.link}|${main.replace(/\r$/, '').trim()}]]${src ? src[0] : ''}${cr}`
    }
    const next = `${m[1]}${box}${m[3]}${text}`
    if (next !== lines[at]) {
      lines[at] = next
      changed++
    }
  }
  return { md: lines.join('\n'), changed }
}

// ---------- Names: North Star stages and goals' needs ----------

/**
 * An old track's scope as module tracks: the modules its topics went to, grouped by the track that
 * holds each one, each with the share of the old scope's topics it took. The whole old track when the
 * scope is empty. Modules are named by title (a stage's scope can name a whole module).
 */
export function remapScope(oldTrack: string, scope: string[], old: Map<string, RoadmapTopic[]>, plan: MovePlan, cat: Catalogue, inScope: (t: RoadmapTopic, scope: string[]) => boolean): { track: string; share: number; scope: string[] }[] {
  const topics = (old.get(oldTrack) ?? []).filter((t) => !scope.length || inScope(t, scope))
  const newOf = new Map(plan.pairs.map((p) => [p.old, p.module]))
  const by = moduleById(cat)
  const count = new Map<string, number>()
  for (const t of topics) {
    const m = newOf.get(t.id)
    if (m) count.set(m, (count.get(m) ?? 0) + 1)
  }
  const total = [...count.values()].reduce((a, b) => a + b, 0)
  const tracks = new Map<string, { share: number; scope: string[] }>()
  for (const [mid, n] of [...count].sort((a, b) => b[1] - a[1])) {
    const tr = tracksOfModule(cat, mid)[0]
    const m = by.get(mid)
    if (!tr || !m) continue
    const e = tracks.get(tr.title) ?? { share: 0, scope: [] }
    e.share += total ? n / total : 0
    if (!e.scope.includes(m.title)) e.scope.push(m.title)
    tracks.set(tr.title, e)
  }
  return [...tracks].map(([track, v]) => ({ track, ...v }))
}

/** A North Star map moved onto the module tracks: each stage's tracks and scopes, weights kept in proportion */
export function remapNorthStar(ns: NorthStar, old: Map<string, RoadmapTopic[]>, plan: MovePlan, cat: Catalogue, inScope: (t: RoadmapTopic, scope: string[]) => boolean, keep: (track: string) => boolean): { ns: NorthStar; changed: boolean } {
  let changed = false
  const stages = ns.stages.map((s) => {
    const merged = new Map<string, { weight: number; scope: string[] }>()
    for (const st of s.tracks) {
      if (keep(st.track) || !old.has(st.track)) {
        const e = merged.get(st.track) ?? { weight: 0, scope: [] }
        e.weight += st.weight
        for (const x of st.scope) if (!e.scope.includes(x)) e.scope.push(x)
        merged.set(st.track, e)
        continue
      }
      const parts = remapScope(st.track, st.scope, old, plan, cat, inScope)
      if (!parts.length) continue
      changed = true
      for (const p of parts) {
        const e = merged.get(p.track) ?? { weight: 0, scope: [] }
        e.weight += st.weight * p.share
        for (const x of p.scope) if (!e.scope.includes(x)) e.scope.push(x)
        merged.set(p.track, e)
      }
    }
    if (!changed) return s
    const list = [...merged].sort((a, b) => b[1].weight - a[1].weight).slice(0, MAX_TRACKS)
    const w = normaliseWeights(list.map(([, v]) => v.weight))
    const tracks: StageTrack[] = list.map(([track, v], i) => ({ track, weight: w[i], scope: v.scope }))
    const names = new Set(tracks.map((t) => t.track))
    const joins = [...new Set(s.capstone.joins.flatMap((j) => (names.has(j) ? [j] : remapScope(j, [], old, plan, cat, inScope).map((p) => p.track))))].filter((j) => names.has(j))
    return { ...s, tracks, capstone: { ...s.capstone, joins: joins.length ? joins : tracks.slice(0, 3).map((t) => t.track) } }
  })
  return { ns: { ...ns, stages }, changed }
}

/** Which module a topic id belongs to (by its id's prefix) */
export const moduleOfId = (modules: Pick<ModuleDef, 'id'>[]) => {
  const keys = modules.map((m) => ({ id: m.id, key: `${tnorm(m.id)}::` })).sort((a, b) => b.key.length - a.key.length)
  return (id: string) => keys.find((k) => id.startsWith(k.key))?.id
}

// ---------- The preview ----------

export interface MovePreview {
  modules: number
  tracks: { id: string; title: string; modules: number; notebook: string; folder: boolean }[]
  /** Topics with somewhere to go, and those with progress on them */
  topics: { placed: number; dropped: number; unplaced: number; withProgress: number }
  /** Progress moving: evidence on concepts, ticks, lesson links, placement results */
  progress: { concepts: number; evidence: number; ticks: number; links: number; placement: number; events: number; targets: number; lessons: number }
  /** Notebooks that stop using an old roadmap as their outline */
  notebooks: { name: string; from: string; to?: string }[]
  /** Empty folders the switch could remove (asked separately) */
  emptyFolders: string[]
  /** A few examples of where things go */
  sample: { from: string; to: string; module: string }[]
  /** Old topics with progress on them that have no home (their progress stays as it is) */
  orphans: { title: string; notebook: string }[]
  issues: number
}
