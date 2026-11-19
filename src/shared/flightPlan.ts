/**
 * The flight plan: a guided work project (shared/workProject) laid out as a route. Steps are stops,
 * decisions are diamond checkpoints after the step they come up in, and "Defend it" is the
 * destination. Also kept here: what the learner adds as they go (a one-line finding per step, their
 * runs, the builder version of a metric, their defend-it answers), the progress lanes, and how a
 * question built in Metabase's builder compares with their pipeline's result. Pure.
 */
import { cellOf, compareResultSets, type Comparison, type ResultSet } from './resultCompare'
import { rubricFor, type WorkProject, type WorkProjectPublic, type WorkState } from './workProject'

export type StopState = 'done' | 'now' | 'ahead'

export type Stop =
  | { kind: 'step'; key: string; n: number; label: string; state: StopState }
  | { kind: 'checkpoint'; key: string; id: string; step: number; label: string; state: StopState }
  | { kind: 'destination'; key: 'defend'; label: string; state: StopState }

export interface Route {
  stops: Stop[]
  /** legs[i] joins stops[i] and stops[i + 1]: travelled or not */
  legs: boolean[]
  stepsDone: number
  steps: number
  checkpointsDone: number
  checkpoints: number
}

/** What the learner adds on the way, kept in their project state */
export interface FlightExtras {
  /** Step → their one-line "what I found", in their words */
  findings?: Record<string, string>
  /** Step → their last run on the practice data */
  runs?: Record<string, { at: number; rows: number; ok: boolean; file: string }>
  /** Step → the question they built in Metabase's builder, and how it compared; or native only */
  builder?: Record<string, { card?: number; name?: string; match?: boolean; why?: string; native?: string; at: number }>
  /** Defend-it question index → their locked answer, and what they ticked as covered */
  defended?: Record<string, { answer: string; at: number; ticked?: number[] }>
  /** Reference card number → how their result last compared with the real card's, run on the practice data */
  checks?: Record<string, { match: boolean; why: string; at: number; step: number }>
}

export type FlightState = WorkState & FlightExtras

/** The route: each step, then its checkpoints, then the destination */
export function routeOf(p: Pick<WorkProjectPublic, 'steps' | 'decisions'>, s: FlightState): Route {
  const stops: Stop[] = []
  const stepState = (n: number): StopState => (n < s.step ? 'done' : n === s.step ? 'now' : 'ahead')
  for (const st of p.steps) {
    stops.push({ kind: 'step', key: `s${st.n}`, n: st.n, label: st.title, state: stepState(st.n) })
    for (const d of p.decisions.filter((x) => x.step === st.n)) {
      // A checkpoint is due once its step is behind them: answered is done, due is now
      const state: StopState = s.committed[d.id] ? 'done' : st.n < s.step ? 'now' : 'ahead'
      stops.push({ kind: 'checkpoint', key: d.id, id: d.id, step: st.n, label: d.title, state })
    }
  }
  // Decisions whose step isn't listed go before the destination
  for (const d of p.decisions.filter((x) => !p.steps.some((st) => st.n === x.step))) stops.push({ kind: 'checkpoint', key: d.id, id: d.id, step: d.step, label: d.title, state: s.committed[d.id] ? 'done' : 'ahead' })
  const max = Math.max(0, ...p.steps.map((x) => x.n))
  const defended = Object.keys(s.defended ?? {}).length
  stops.push({ kind: 'destination', key: 'defend', label: 'Defend it', state: s.step > max ? (defended ? 'done' : 'now') : 'ahead' })
  const legs = stops.slice(0, -1).map((a, i) => a.state === 'done' && stops[i + 1].state !== 'ahead')
  return { stops, legs, stepsDone: p.steps.filter((x) => x.n < s.step).length, steps: p.steps.length, checkpointsDone: p.decisions.filter((d) => s.committed[d.id]).length, checkpoints: p.decisions.length }
}

/**
 * The map's sizes in CSS pixels (styles/flightPlan.css): centre-to-centre room a stretch needs per
 * checkpoint and at least between two steps, the widths of a step's and a checkpoint's label, the
 * space kept between two labels, and how far a label may reach past the route's ends.
 */
export const MAP_SIZES = { cpGap: 40, stepGap: 64, label: 118, cpLabel: 150, room: 12, overhang: 64 }

export interface MapLabel {
  /** The label's centre, which leans inwards near the ends */
  x: number
  w: number
  side: 'up' | 'down'
}

export interface MapLayout {
  /** The route's length: the width given, or more when its stops can't fit without touching */
  width: number
  /** Each stop's centre */
  xs: number[]
  labels: (MapLabel | null)[]
}

/**
 * Where each stop sits on a route `width` long, and where its label goes, so no two markers and no
 * two labels touch. Steps and the destination are evenly spaced; a stretch whose checkpoints need
 * more room than that takes it from the roomier stretches, and the checkpoints share their stretch
 * evenly. Step labels alternate below and above the line (a selected checkpoint's takes whichever
 * side is free). When even that can't fit, the route grows (and the map scrolls) rather than overlap.
 */
export function mapLayout(stops: Stop[], width: number, o: { labels?: boolean; selected?: string } = {}): MapLayout {
  const S = MAP_SIZES
  const n = stops.length
  if (!n) return { width: Math.max(0, width), xs: [], labels: [] }
  const anchors = stops.map((s, i) => (s.kind !== 'checkpoint' || i === 0 || i === n - 1 ? i : -1)).filter((i) => i >= 0)
  const needs = anchors.slice(1).map((a, j) => Math.max(S.stepGap, (a - anchors[j]) * S.cpGap))
  const place = (w: number): MapLayout => {
    // The stretches that need more than an even share get what they need; the rest share what's left
    const sizes: number[] = needs.map(() => 0)
    let open = needs.map((_, j) => j)
    let free = w
    for (;;) {
      const share = free / Math.max(1, open.length)
      const tight = open.filter((j) => needs[j] > share)
      if (!tight.length) {
        for (const j of open) sizes[j] = share
        break
      }
      for (const j of tight) (sizes[j] = needs[j]), (free -= needs[j])
      open = open.filter((j) => !tight.includes(j))
      if (!open.length) break
    }
    const xs: number[] = new Array(n).fill(0)
    let at = 0
    anchors.forEach((a, j) => {
      xs[a] = at
      if (j === anchors.length - 1) return
      const next = anchors[j + 1]
      for (let i = a + 1; i < next; i++) xs[i] = at + (sizes[j] * (i - a)) / (next - a)
      at += sizes[j]
    })
    const total = Math.max(w, at)
    if (n === 1) xs[0] = total / 2
    const labels: (MapLabel | null)[] = new Array(n).fill(null)
    if (o.labels === false) return { width: total, xs, labels }
    const lean = (x: number, lw: number) => Math.min(total + S.overhang - lw / 2, Math.max(lw / 2 - S.overhang, x))
    const clear = (l: MapLabel) => labels.every((m) => !m || m.side !== l.side || Math.abs(m.x - l.x) >= (m.w + l.w) / 2 + S.room)
    // Below, above, below…; a label whose side is taken by its neighbour's takes the other side when that's free
    let last: 'up' | 'down' = 'up'
    stops.forEach((s, i) => {
      if (s.kind === 'checkpoint') return
      const want: MapLabel = { x: lean(xs[i], S.label), w: S.label, side: last === 'up' ? 'down' : 'up' }
      const other: MapLabel = { ...want, side: want.side === 'up' ? 'down' : 'up' }
      labels[i] = clear(want) || !clear(other) ? want : other
      last = labels[i]!.side
    })
    const c = stops.findIndex((s) => s.kind === 'checkpoint' && s.key === o.selected)
    if (c >= 0) {
      const up: MapLabel = { x: lean(xs[c], S.cpLabel), w: S.cpLabel, side: 'up' }
      labels[c] = clear(up) ? up : { ...up, side: 'down' }
    }
    return { width: total, xs, labels }
  }
  // Grow the route until every label has its own room
  let w = Math.max(1, width)
  for (let k = 0; k < 80; k++) {
    const l = place(w)
    const shown = l.labels.filter((x): x is MapLabel => !!x)
    if (shown.every((a, i) => shown.every((b, j) => i === j || a.side !== b.side || Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + MAP_SIZES.room - 0.01))) return l
    w = l.width * 1.08
  }
  return place(w)
}

/** The result chart's bar labels: the gap between bars and an upper bound on a character's width (10.5px text), in CSS pixels */
export const BAR_SIZES = { gap: 6, char: 6.4, room: 8 }

/** Every how many bars the result chart writes a label, so each one it writes shows in full: the first, then every k-th */
export function barLabelEvery(labels: string[], width: number): number {
  const n = labels.length
  if (n <= 1 || width <= 0) return 1
  const pitch = (width + BAR_SIZES.gap) / n
  const longest = Math.max(...labels.map((l) => l.length)) * BAR_SIZES.char
  // A label held against an edge moves towards its neighbour, so check the real places and widen if need be
  for (let k = Math.max(1, Math.ceil((longest + BAR_SIZES.room) / pitch)); k < n; k++) {
    const spans = labels.flatMap((t, i) => (i % k ? [] : [barLabelSpan(i, n, t, width)]))
    if (spans.every((s, i) => i === 0 || s[0] >= spans[i - 1][1] + BAR_SIZES.room)) return k
  }
  return n
}

/** The left and right ends of bar k's label */
export function barLabelSpan(k: number, n: number, text: string, width: number): [number, number] {
  const p = barLabelPlace(k, n, text, width)
  const w = text.length * BAR_SIZES.char
  return p.anchor === 'start' ? [p.x, p.x + w] : p.anchor === 'end' ? [p.x - w, p.x] : [p.x - w / 2, p.x + w / 2]
}

/** Where bar k's label goes: centred under its bar, or held against the chart's edge so it isn't cut off */
export function barLabelPlace(k: number, n: number, text: string, width: number): { x: number; anchor: 'start' | 'middle' | 'end' } {
  const centre = ((k + 0.5) * (width + BAR_SIZES.gap)) / n - BAR_SIZES.gap / 2
  const half = (text.length * BAR_SIZES.char) / 2
  if (centre - half < 0) return { x: 0, anchor: 'start' }
  if (centre + half > width) return { x: width, anchor: 'end' }
  return { x: centre, anchor: 'middle' }
}

// ---------- What they add on the way ----------

export function setFinding(s: FlightState, step: number, text: string, now = 0): FlightState {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 400)
  const findings = { ...(s.findings ?? {}) }
  if (t) findings[String(step)] = t
  else delete findings[String(step)]
  return { ...s, findings, updatedAt: now }
}

export function noteRun(s: FlightState, step: number, r: { rows: number; ok: boolean; file: string }, now = 0): FlightState {
  return { ...s, runs: { ...(s.runs ?? {}), [String(step)]: { ...r, at: now } }, updatedAt: now }
}

export function noteBuilder(s: FlightState, step: number, b: { card?: number; name?: string; match?: boolean; why?: string; native?: string }, now = 0): FlightState {
  return { ...s, builder: { ...(s.builder ?? {}), [String(step)]: { ...b, at: now } }, updatedAt: now }
}

/** A defend-it answer, locked: it can't be changed after, as with a checkpoint */
export function lockDefence(s: FlightState, k: number, answer: string, now = 0): { state: FlightState; error?: string } {
  const a = answer.trim()
  if (a.length < 8) return { state: s, error: 'Write your answer first, as you would say it in the meeting.' }
  if (s.defended?.[String(k)]) return { state: s }
  return { state: { ...s, defended: { ...(s.defended ?? {}), [String(k)]: { answer: a.slice(0, 4000), at: now } }, updatedAt: now } }
}

export function tickCover(s: FlightState, k: number, ticked: number[], now = 0): FlightState {
  const d = s.defended?.[String(k)]
  if (!d) return s
  return { ...s, defended: { ...(s.defended ?? {}), [String(k)]: { ...d, ticked: [...new Set(ticked)].sort((a, b) => a - b) } }, updatedAt: now }
}

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z$][a-z0-9_$]{3,}/g) ?? []).filter((w) => !STOP.has(w)))
const STOP = new Set(['what', 'that', 'this', 'with', 'from', 'your', 'have', 'does', 'they', 'them', 'than', 'then', 'when', 'which', 'would', 'could', 'should', 'there', 'their', 'into', 'each', 'only', 'every', 'about', 'card', 'cards', 'says', 'show', 'shows'])

/**
 * What a strong answer to one defend-it question covers: the rubric lines closest to the question.
 * Only once their answer is locked, and only when the rubric is open (every checkpoint answered);
 * otherwise why not.
 */
export function coverFor(p: WorkProject, s: FlightState, k: number, max = 4): { cover?: string[]; error?: string } {
  if (!s.defended?.[String(k)]) return { error: 'Lock your answer first.' }
  const r = rubricFor(p, s)
  if (r.error) return { error: 'The checklist of what a strong answer covers opens once every checkpoint has your answer.' }
  const q = words(p.defend[k] ?? '')
  // The card reference ("Card 5, …") is the tutor's answer key, never a checklist line
  const scored = p.rubric.map((line, i) => ({ line, i, score: [...words(line)].filter((w) => q.has(w)).length })).filter((x) => !/^Card (\d+,|reference\b)/i.test(x.line))
  const best = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, max)
  return { cover: (best.length ? best : scored.slice(0, Math.min(max, scored.length))).sort((a, b) => a.i - b.i).map((x) => x.line) }
}

// ---------- Progress ----------

export type LaneState = 'on' | 'half' | 'off' | 'na'

export interface Lane {
  n: number
  title: string
  skill: string
  run: LaneState
  finding: LaneState
  call: LaneState
  builder: LaneState
  /** Their words */
  found?: string
  /** Checkpoint ids and whether their answer is in */
  calls: { id: string; answered: boolean }[]
  builderNote?: string
}

export function lanesOf(p: Pick<WorkProjectPublic, 'steps' | 'decisions'>, s: FlightState): Lane[] {
  return p.steps.map((st) => {
    const run = s.runs?.[String(st.n)]
    const calls = p.decisions.filter((d) => d.step === st.n).map((d) => ({ id: d.id, answered: !!s.committed[d.id] }))
    const b = s.builder?.[String(st.n)]
    const found = s.findings?.[String(st.n)]
    return {
      n: st.n,
      title: st.title,
      skill: st.skill,
      run: run ? (run.ok ? 'on' : 'half') : 'off',
      finding: found ? 'on' : 'off',
      call: !calls.length ? 'na' : calls.every((c) => c.answered) ? 'on' : calls.some((c) => c.answered) ? 'half' : 'off',
      builder: !b ? 'off' : b.native ? 'na' : b.match ? 'on' : 'half',
      ...(found ? { found } : {}),
      calls,
      ...(b ? { builderNote: b.native ? `Native only: ${b.native}` : b.match ? `“${b.name ?? 'Your question'}” matches your pipeline` : `“${b.name ?? 'Your question'}” differs: ${b.why ?? ''}` } : {})
    }
  })
}

// ---------- The builder's question against their pipeline ----------

export interface RowDiff {
  /** The first column's value, as shown */
  key: string
  pipeline: unknown[] | null
  builder: unknown[] | null
  same: boolean
}

export interface BuilderComparison extends Comparison {
  rows: RowDiff[]
  /** Hints for the usual reasons: a time zone shift, a null group */
  hints: string[]
}

const keyText = (v: unknown): string => {
  const c = cellOf(v)
  if (c === null) return '(empty)'
  if ('n' in c) {
    // A date's instant: shown as its UTC date and time, so a one-hour shift is visible
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(c.n).toISOString().replace(/:00\.000Z$|\.000Z$/, 'Z').replace('T00:00Z', '')
    return String(c.n)
  }
  return c.t
}
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)

/** Row by row on the first column (the dimension), then the comparison as a whole */
export function compareBuilder(pipeline: ResultSet, builder: ResultSet, words?: { theirs: string; reference: string }): BuilderComparison {
  const raw = compareResultSets(builder, pipeline)
  // compareResultSets speaks of "yours" and "the reference": said here as the two sides really are
  const base = words ? { ...raw, why: raw.why.replace(/\b[Yy]ours\b/g, words.theirs).replace(/\b[Yy]our (query|result)\b/g, `${words.theirs.replace(/’s$/, '')} $1`).replace(/the reference/g, words.reference) } : raw
  const hints: string[] = []
  const mapOf = (r: ResultSet) => new Map(r.rows.map((row) => [keyText(row[0]), row] as const))
  const a = mapOf(pipeline)
  const b = mapOf(builder)
  const keysAll = [...new Set([...a.keys(), ...b.keys()])]
  const sameRow = (x: unknown[], y: unknown[]) => compareResultSets({ columns: x.map((_, i) => String(i)), rows: [x] }, { columns: y.map((_, i) => String(i)), rows: [y] }).match
  const rows: RowDiff[] = keysAll.map((key) => {
    const x = a.get(key) ?? null
    const y = b.get(key) ?? null
    return { key, pipeline: x, builder: y, same: !!x && !!y && sameRow(x, y) }
  })
  // The same dates a few hours apart: one side cut its months in another time zone
  const da = pipeline.rows.map((r) => r[0]).filter(isDate).map((v) => Date.parse(String(v)))
  const db = builder.rows.map((r) => r[0]).filter(isDate).map((v) => Date.parse(String(v)))
  if (da.length && db.length && !base.match) {
    const shifted = da.some((t) => db.some((u) => t !== u && Math.abs(t - u) <= 14 * 3600_000))
    if (shifted) hints.push('Some dates are the same day a few hours apart: one side cut its days or months in another time zone. Your pipeline’s $dateTrunc used its timezone; the builder used Metabase’s report time zone.')
  }
  if (rows.some((r) => r.key === '(empty)' && (!r.pipeline || !r.builder))) hints.push('One side has a row for empty (null) values and the other doesn’t: the builder keeps documents with no value as their own group; a $match or $group can drop or merge them.')
  if (!base.match && !hints.length && pipeline.rows.length && builder.rows.length && rows.every((r) => !r.pipeline || !r.builder)) hints.push('No row lines up on the first column: check the two results group by the same thing, in the same order of columns.')
  return { ...base, rows, hints }
}

/** A builder question's definition (MBQL), in a few lines the tutor and the learner can read */
export function mbqlText(q: unknown): string {
  const d = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>
  if (nativeOf(d)) return 'A native query, not the builder.'
  const inner = (d.query ?? (Array.isArray(d.stages) ? d.stages[0] : null) ?? d) as Record<string, unknown>
  const lines: string[] = []
  const show = (label: string, v: unknown) => v !== undefined && v !== null && lines.push(`${label}: ${JSON.stringify(v)}`)
  show('Source', inner['source-table'] ?? inner['source-card'])
  show('Filter', inner.filter ?? inner.filters)
  show('Summarize', inner.aggregation)
  show('Group by', inner.breakout)
  show('Join', inner.joins)
  show('Custom columns', inner.expressions)
  show('Sort', inner['order-by'])
  show('Row limit', inner.limit)
  return lines.length ? lines.join('\n') : JSON.stringify(d).slice(0, 600)
}

// ---------- The real piece of work, as the reference ----------

/**
 * The reference cards a step builds, from its task ("Build cards 1–8", "card 31", "cards 25-30").
 * Numbers refer to the project's card reference (cardIndex).
 */
export function stepCards(task: string): number[] {
  const out: number[] = []
  for (const m of task.matchAll(/\bcards?\s+(\d+)(?:\s*(?:[–—-]|to)\s*(\d+))?/gi)) {
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n - a < 60; n++) if (!out.includes(n)) out.push(n)
  }
  return out
}

/** "Card 5, Staff by month (coll): …" lines (several may share a line, split by ";"): number → name */
export function cardIndex(lines: string[]): Record<number, string> {
  const out: Record<number, string> = {}
  for (const line of lines)
    for (const m of line.matchAll(/\bCard (\d+),\s*([^:;(]+?)\s*(?=[:;(]|$)/g)) out[Number(m[1])] ??= m[2].trim()
  return out
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The real card for a reference name: the same name; else one whose name holds every word of it (or
 * the reverse), fewest extra words first. A card that is exactly another reference's is never taken.
 */
export function matchCard<T extends { name: string }>(name: string, cards: T[], others: string[] = []): T | null {
  const n = norm(name)
  if (!n) return null
  const exact = cards.find((c) => norm(c.name) === n)
  if (exact) return exact
  const taken = new Set(others.map(norm).filter((o) => o !== n))
  const mine = new Set(n.split(' '))
  const scored = cards
    .filter((c) => !taken.has(norm(c.name)))
    .map((c) => {
      const theirs = new Set(norm(c.name).split(' '))
      const inside = [...mine].every((w) => theirs.has(w)) || [...theirs].every((w) => mine.has(w))
      return { c, inside, extra: Math.abs(theirs.size - mine.size) }
    })
    .filter((x) => x.inside)
    .sort((a, b) => a.extra - b.extra)
  return scored[0]?.c ?? null
}

/** A saved question's query, legacy (type: native) or MBQL 5 (stages of lib/type mbql.stage/native): its collection and pipeline text when native */
export function nativeOf(q: unknown): { collection?: string; query: string } | null {
  const d = (q && typeof q === 'object' ? q : {}) as Record<string, any>
  if (d.type === 'native' && d.native) return { collection: d.native.collection, query: String(d.native.query ?? '') }
  const st = Array.isArray(d.stages) ? d.stages[0] : null
  if (st && st['lib/type'] === 'mbql.stage/native') return { collection: st.collection, query: String(st.native ?? '') }
  return null
}

export function noteCheck(s: FlightState, num: number, step: number, r: { match: boolean; why: string }, now = 0): FlightState {
  return { ...s, checks: { ...(s.checks ?? {}), [String(num)]: { ...r, step, at: now } }, updatedAt: now }
}
