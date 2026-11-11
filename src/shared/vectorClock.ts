/**
 * Vector clock problems, checked exactly. A small model marks these by eye and gets them wrong: live,
 * Gemma passed a merge that took the minimum of one entry ([0,1] after receiving [1,0]) and marked
 * the student down instead for incrementing on receipt, which is the textbook rule. Here the
 * problem's events are replayed under each rule in common use (a send and a receipt each count as
 * an event, or only internal actions do), and the student's vectors are compared with what those
 * give: a vector no rule gives is wrong, whatever the mark said.
 *
 * Only problems written as a list of events in plain words ("P1 performs an internal action",
 * "P1 sends a message to P2", "P2 receives the message") are checked; anything else is left to the
 * tutor.
 */

export interface Scenario {
  /** How many processes */
  n: number
  /** Their vectors before the first event (zeros unless the problem sets them) */
  init: number[][]
  events: ({ kind: 'internal'; p: number } | { kind: 'send'; p: number; to: number } | { kind: 'receive'; p: number; from?: number })[]
}

/** P_1, P_{1}, $P_1$, P₁ and "process 1" as P1; LaTeX dropped */
const plain = (s: string) =>
  s
    .replace(/\$+/g, '')
    .replace(/\\(text|mathrm|mathit)\{([^{}]*)\}/g, '$2')
    .replace(/([PV])_\{?(\d+)\}?/g, '$1$2')
    .replace(/[₀-₉]/g, (d) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d)))
    .replace(/\bprocess(?:es)?\s+(\d+)/gi, 'P$1')
    .replace(/\bnode\s+(\d+)/gi, 'P$1')

const vec = (s: string) => s.split(',').map((x) => Number(x.trim()))
const VECTOR = /\[\s*(-?\d+(?:\s*,\s*-?\d+)+)\s*\]/

/** The events a problem lists, in order; null when it isn't a vector clock problem in plain events */
export function parseScenario(problem: string): Scenario | null {
  const t = plain(problem)
  if (!/vector clock|\bV\d\s*=\s*\[|V_?msg|vector/i.test(t)) return null
  const events: Scenario['events'] = []
  const firstEvent = t.search(/\bP\d\s+(performs|does|executes|has|sends|receives|gets)\b/i)
  if (firstEvent < 0) return null
  // Sentences or numbered lines, in order
  for (const m of t.slice(firstEvent).matchAll(/\bP(\d)\s+(?:then\s+)?(performs|does|executes|has|sends|receives|gets)\b([^.\n?;]*)/gi)) {
    const p = Number(m[1])
    const verb = m[2].toLowerCase()
    const rest = m[3]
    if (verb === 'sends') {
      const to = rest.match(/\bto\s+P(\d)/i)
      if (!to) return null
      events.push({ kind: 'send', p, to: Number(to[1]) })
    } else if (verb === 'receives' || verb === 'gets') {
      if (!/message/i.test(rest)) continue
      const from = rest.match(/\bfrom\s+P(\d)/i)
      events.push({ kind: 'receive', p, ...(from ? { from: Number(from[1]) } : {}) })
    } else if (/\b(internal|local)\b/i.test(rest)) events.push({ kind: 'internal', p })
  }
  if (!events.length || !events.some((e) => e.kind === 'receive')) return null
  const procs = new Set<number>()
  for (const e of events) {
    procs.add(e.p)
    if (e.kind === 'send') procs.add(e.to)
    if (e.kind === 'receive' && e.from) procs.add(e.from)
  }
  // "two processes", or the highest one named
  const named = t.match(/\b(two|three|four|five|2|3|4|5)\s+processes\b/i)?.[1]
  const n = Math.max(...procs, named ? { two: 2, three: 3, four: 4, five: 5 }[named.toLowerCase() as 'two'] ?? Number(named) : 0)
  if (n < 2 || n > 6 || Math.min(...procs) < 1) return null
  const init = Array.from({ length: n }, () => Array(n).fill(0) as number[])
  // Starting vectors set before the first event
  for (const m of t.slice(0, firstEvent).matchAll(/\bV(\d)\s*=\s*\[([^\]]+)\]/g)) {
    const i = Number(m[1])
    const v = vec(m[2])
    if (i >= 1 && i <= n && v.length === n && v.every(Number.isFinite)) init[i - 1] = v
  }
  return { n, init, events }
}

/** Each process's vector after the events, under one rule for sends and receipts; null if a receipt has no message */
export function replay(s: Scenario, sendCounts: boolean, receiveCounts: boolean): number[][] | null {
  const v = s.init.map((x) => [...x])
  const inbox: { from: number; to: number; clock: number[] }[] = []
  for (const e of s.events) {
    const me = v[e.p - 1]
    if (e.kind === 'internal') me[e.p - 1]++
    else if (e.kind === 'send') {
      if (sendCounts) me[e.p - 1]++
      inbox.push({ from: e.p, to: e.to, clock: [...me] })
    } else {
      const at = inbox.findIndex((m) => m.to === e.p && (!e.from || m.from === e.from))
      if (at < 0) return null
      const [m] = inbox.splice(at, 1)
      for (let j = 0; j < s.n; j++) me[j] = Math.max(me[j], m.clock[j])
      if (receiveCounts) me[e.p - 1]++
    }
  }
  return v
}

/** The vector the student gives last for each process ("V2 = [1,1]", "P2: [1,1]") */
export function theirVectors(answer: string, n: number): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const m of plain(answer).matchAll(/\b[VP](\d)\b[^[\n]{0,40}?(?:=|:|is|becomes|ends (?:up )?(?:at|as))\s*\[([^\]]+)\]/gi)) {
    const i = Number(m[1])
    const v = vec(m[2])
    if (i >= 1 && i <= n && v.length === n && v.every(Number.isFinite)) out.set(i, v)
  }
  return out
}

const show = (v: number[]) => `[${v.join(', ')}]`

export interface ClockCheck {
  result: 'match' | 'mismatch'
  theirs: string
  expected: string
  /** For a wrong one: which process, and what it should be */
  why?: string
}

/**
 * The student's final vectors against a replay of the problem. Each process they give a vector for
 * must end where one of the rules leaves it; null when the problem can't be replayed or they give
 * no vectors to compare.
 */
export function checkVectorClocks(problem: string, answer: string): ClockCheck | null {
  const s = parseScenario(problem)
  if (!s) return null
  const rules = [
    [true, true],
    [false, false],
    [true, false],
    [false, true]
  ].map(([a, b]) => replay(s, a, b))
  if (rules.some((r) => !r)) return null
  const theirs = theirVectors(answer, s.n)
  if (!theirs.size) return null
  const said = [...theirs].map(([i, v]) => `V${i} = ${show(v)}`).join(', ')
  for (const [i, v] of theirs) {
    // A process that receives a message must be given as it is after its last receipt (or later);
    // one that only sends or works alone may be asked about part-way, so any state it passes counts
    const lastReceipt = s.events.reduce((at, e, k) => (e.kind === 'receive' && e.p === i ? k : at), -1)
    const allowed = new Set<string>()
    for (const [send, recv] of [[true, true], [false, false], [true, false], [false, true]] as const) {
      if (lastReceipt < 0) allowed.add(show(s.init[i - 1]))
      for (let k = Math.max(0, lastReceipt); k < s.events.length; k++) {
        const at = replay({ ...s, events: s.events.slice(0, k + 1) }, send, recv)
        if (at) allowed.add(show(at[i - 1]))
      }
    }
    if (!allowed.has(show(v))) {
      const finals = [...new Set(rules.map((r) => show(r![i - 1])))]
      return { result: 'mismatch', theirs: said, expected: `V${i} = ${finals.join(' or ')}`, why: `V${i} = ${show(v)} is not what these events give: P${i} ends at ${finals.join(' or ')}, depending on whether sends and receipts count as events. On receipt the merge takes the element-wise maximum, so no entry can fall below the message's.` }
    }
  }
  return { result: 'match', theirs: said, expected: [...new Set(rules.map((r) => r!.map(show).join(' ')))].join(' or ') }
}
