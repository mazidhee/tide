/**
 * What you know, by subject: each notebook's roadmap as a syllabus being filled in. Its topics in
 * the roadmap's own order, grouped by the heading they sit under (a phase), each with where it
 * stands; the topics studied in that notebook that aren't on its roadmap in a short group of their
 * own; and where the learner is in it. Laid out so a roadmap of hundreds of topics, mostly not
 * started, reads in a glance: what has been begun is shown, the long untouched tail is folded.
 */
import type { ConceptState } from './knowledge'

export type TopicKind = 'solid' | 'fading' | 'learning' | 'ready' | 'new'

export const KIND_LABEL: Record<TopicKind, string> = { solid: 'Solid', fading: 'Fading', learning: 'Learning', ready: 'Ready next', new: 'Not started' }

/** Where a topic stands, in the five words the page uses */
export function kindOf(c: ConceptState, ready: ReadonlySet<string>): TopicKind {
  if (c.status === 'solid' || c.status === 'fading' || c.status === 'learning') return c.status
  return ready.has(c.id) ? 'ready' : 'new'
}

export interface Phase {
  /** Unique within its subject */
  key: string
  /** The heading the topics sit under; empty when the roadmap has none */
  name: string
  topics: ConceptState[]
  solid: number
  /** Topics with any evidence */
  begun: number
}

export interface Subject {
  /** The notebook's name; empty for topics in no notebook */
  area: string
  label: string
  phases: Phase[]
  /** Studied in this notebook, not on its roadmap: the latest first */
  also: ConceptState[]
  /** Roadmap topics and those studied besides */
  total: number
  counts: Record<TopicKind, number>
  /** The phase the learner is in (the one with the topic studied last), or where to start; -1 for none */
  here: number
  /** Whether anything in the roadmap has been studied yet ("you are here" rather than "start here") */
  begun: boolean
  /** The last evidence on anything in it (ms) */
  last?: number
}

export const NO_NOTEBOOK = 'Not in a notebook'

const emptyCounts = (): Record<TopicKind, number> => ({ solid: 0, fading: 0, learning: 0, ready: 0, new: 0 })

/**
 * Every subject with its phases. Subjects where something has been studied come first, the most
 * recent first; then the rest in the notebooks' own order; topics in no notebook last.
 */
export function syllabus(concepts: ConceptState[], ready: ReadonlySet<string>, notebooks: string[] = []): Subject[] {
  const by = new Map<string, Subject>()
  const subject = (area: string) => {
    let s = by.get(area)
    if (!s) by.set(area, (s = { area, label: area || NO_NOTEBOOK, phases: [], also: [], total: 0, counts: emptyCounts(), here: -1, begun: false }))
    return s
  }
  const roadmap = concepts.filter((c) => !c.parent && c.origin === 'roadmap').sort((a, b) => a.order - b.order)
  for (const c of roadmap) {
    const s = subject(c.area)
    const name = c.section ?? ''
    let p = s.phases[s.phases.length - 1]
    if (!p || p.name !== name) s.phases.push((p = { key: `${s.phases.length}:${name}`, name, topics: [], solid: 0, begun: 0 }))
    p.topics.push(c)
  }
  for (const c of concepts) if (!c.parent && c.origin !== 'roadmap') subject(c.area).also.push(c)

  for (const s of by.values()) {
    const all = [...s.phases.flatMap((p) => p.topics), ...s.also]
    s.total = all.length
    for (const c of all) {
      s.counts[kindOf(c, ready)]++
      if (c.lastSeen && (!s.last || c.lastSeen > s.last)) s.last = c.lastSeen
    }
    let latest = 0
    s.phases.forEach((p, i) => {
      for (const c of p.topics) {
        if (c.status === 'solid') p.solid++
        if (c.seen > 0) p.begun++
        if (c.lastSeen && c.lastSeen > latest) [latest, s.here] = [c.lastSeen, i]
      }
    })
    s.begun = latest > 0
    if (!s.begun) s.here = s.phases.findIndex((p) => p.topics.some((c) => ready.has(c.id)))
    s.also.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || a.name.localeCompare(b.name))
  }
  const place = (area: string) => {
    const i = notebooks.indexOf(area)
    return i < 0 ? notebooks.length : i
  }
  return [...by.values()].sort((a, b) => Number(!a.area) - Number(!b.area) || (b.last ?? 0) - (a.last ?? 0) || place(a.area) - place(b.area) || a.label.localeCompare(b.label))
}

// ---------- Laying a subject out ----------

export type Row = { kind: 'topic'; c: ConceptState } | { kind: 'more'; key: string; count: number }

export type Block =
  | { kind: 'phase'; phase: Phase; index: number; here: boolean; rows: Row[] }
  /** Phases nothing has happened in, folded into one line */
  | { kind: 'tail'; key: string; from: number; to: number; topics: number }

/** In a phase not opened in full, at most this many topics ready next are shown before the fold */
const READY_SHOWN = 2

/**
 * A subject as the page lays it out. With nothing narrowing it: every phase something has
 * happened in, the one the learner is in, and the one after; untouched runs of phases fold into a
 * single line, and inside a phase the topics not started fold into "+N not started" (a lone one is
 * shown rather than folded). `open` holds the keys of what has been unfolded. With a filter or a
 * search (`match`), only the phases and topics that match, nothing folded.
 */
export function layout(s: Subject, ready: ReadonlySet<string>, open: ReadonlySet<string>, match?: (c: ConceptState) => boolean): Block[] {
  if (match) {
    return s.phases.flatMap((phase, index): Block[] => {
      const rows = phase.topics.filter(match).map((c): Row => ({ kind: 'topic', c }))
      return rows.length ? [{ kind: 'phase', phase, index, here: index === s.here, rows }] : []
    })
  }
  const lastBegun = s.phases.reduce((k, p, i) => (p.begun ? i : k), -1)
  const next = Math.max(lastBegun, s.here) + 1
  const shown = (i: number) => s.phases[i].begun > 0 || i === s.here || i === next
  const out: Block[] = []
  let i = 0
  while (i < s.phases.length) {
    if (!shown(i)) {
      let j = i
      while (j + 1 < s.phases.length && !shown(j + 1)) j++
      const key = `tail:${s.phases[i].key}`
      if (!open.has(key) && j > i) {
        out.push({ kind: 'tail', key, from: i, to: j, topics: s.phases.slice(i, j + 1).reduce((n, p) => n + p.topics.length, 0) })
        i = j + 1
        continue
      }
      // A single untouched phase, or a fold that has been opened: each phase as itself, folded inside
      for (let k = i; k <= j; k++) out.push(phaseBlock(s, k, ready, open))
      i = j + 1
      continue
    }
    out.push(phaseBlock(s, i, ready, open))
    i++
  }
  return out
}

function phaseBlock(s: Subject, index: number, ready: ReadonlySet<string>, open: ReadonlySet<string>): Block {
  const phase = s.phases[index]
  const whole = open.has(phase.key)
  const rows: Row[] = []
  let readyShown = 0
  let run: ConceptState[] = []
  const flush = () => {
    if (run.length === 1) rows.push({ kind: 'topic', c: run[0] })
    else if (run.length) rows.push({ kind: 'more', key: phase.key, count: run.length })
    run = []
  }
  for (const c of phase.topics) {
    const k = kindOf(c, ready)
    const show = whole || (k !== 'new' && k !== 'ready') || (k === 'ready' && readyShown++ < READY_SHOWN)
    if (show) {
      flush()
      rows.push({ kind: 'topic', c })
    } else run.push(c)
  }
  flush()
  return { kind: 'phase', phase, index, here: index === s.here, rows }
}
