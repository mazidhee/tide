/**
 * Results rolled up: a mean and a spread for each thing the scorer measures, overall and by
 * subject and situation, and the marking numbers in full. The spread is the standard deviation of
 * the run means across repeats (how much the same model moves from one run to the next), which is
 * what a before-and-after difference has to beat.
 */
import type { Score } from './score'
import { ALL_SITUATIONS, ALL_SUBJECTS, SUBJECTS, type Scenario } from './types'

export interface Row {
  id: string
  subject: Scenario['subject']
  situation: Scenario['situation']
  repeat: number
  score: Score
  judge?: Record<string, number> | null
  /** The request failed: no reply to score, so the row is left out of every number */
  error?: string
  /** How many times the reply stalled and was carried on, and whether it looped and was started over */
  stalls?: number
  looped?: boolean
  /** A saved reply that stalled with nothing after it (an offline re-score can't ask the model to carry on): only its mark is read */
  unfinished?: boolean
}

export interface Stat {
  mean: number
  /** Standard deviation of the per-repeat means; 0 with one repeat */
  spread: number
  n: number
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}
const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

/** A measure over rows: its mean over everything, and how far the per-repeat means sit apart */
export function stat(rows: Row[], pick: (r: Row) => number | null): Stat {
  const all = rows.map(pick).filter((v): v is number => v !== null)
  const repeats = [...new Set(rows.map((r) => r.repeat))]
  const perRepeat = repeats.map((k) => mean(rows.filter((r) => r.repeat === k).map(pick).filter((v): v is number => v !== null))).filter(Number.isFinite)
  return { mean: round(mean(all)) ?? NaN, spread: round(sd(perRepeat)) ?? 0, n: all.length }
}

const MEASURES: Record<string, (r: Row) => number | null> = {
  pass: (r) => (r.score.pass ? 1 : 0),
  overall: (r) => r.score.overall,
  protocol: (r) => r.score.protocol.score,
  marking: (r) => r.score.marking?.score ?? null,
  exactness: (r) => r.score.exactness?.score ?? null,
  pace: (r) => r.score.pace.score,
  visual: (r) => r.score.visual?.score ?? null
}

export interface Summary {
  measures: Record<string, Stat>
  /** Marking in full: the number that matters most, and its two kinds of mistake */
  marking: {
    accuracy: Stat
    /** Of answers that weren't right, how many were marked correct */
    falseCorrect: Stat
    /** Of right answers, how many were marked down */
    rejectedRight: Stat
    /** Planted errors caught: not marked correct, and the error named */
    plantedCaught: Stat
    /** Right answers written unusually, accepted */
    unusualAccepted: Stat
    /** The stated misconception named in the feedback */
    misconceptionNamed: Stat
  }
  bySubject: Record<string, Record<string, Stat>>
  bySituation: Record<string, Record<string, Stat>>
  /** Which checks fail most, as a share of replies */
  failures: { id: string; share: number }[]
  /** How often the app had to step in before the learner saw the reply, as a share of replies: stalls carried on, loops started over, and each repair the scorer applied (Score.repaired) */
  repairs: { id: string; share: number }[]
  /** Rows left out: failed requests (out of everything), and unfinished saved replies (out of all but marking) */
  left: { errors: number; unfinished: number }
  judge?: Record<string, Stat>
}

export function summarise(every: Row[]): Summary {
  // A failed request has no reply; an unfinished one has only its mark
  const answered = every.filter((r) => !r.error)
  const rows = answered.filter((r) => !r.unfinished)
  const readable = (r: Row) => !(r.unfinished && r.score.marking?.got === 'none')
  const all = (of: Row[]) => Object.fromEntries(Object.entries(MEASURES).map(([k, f]) => [k, stat(of, f)]).filter(([, s]) => (s as Stat).n > 0)) as Record<string, Stat>
  const measures = (of: Row[]) => {
    const marking = stat(of.filter(readable), MEASURES.marking)
    return { ...all(of.filter((r) => !r.unfinished)), ...(marking.n ? { marking } : {}) }
  }
  const marked = answered.filter((r) => r.score.marking && readable(r))
  const m = (r: Row) => r.score.marking!
  const failures = new Map<string, number>()
  for (const r of rows) for (const id of r.score.failed) failures.set(id.replace(/^(must|must-not|names):.*/, '$1'), (failures.get(id.replace(/^(must|must-not|names):.*/, '$1')) ?? 0) + 1)
  const repairs = new Map<string, number>()
  const tally = (id: string) => repairs.set(id, (repairs.get(id) ?? 0) + 1)
  for (const r of answered) {
    if (r.stalls) tally('stall')
    if (r.looped) tally('loop')
    for (const id of r.unfinished ? [] : r.score.repaired ?? []) tally(id)
  }
  const judged = rows.filter((r) => r.judge)
  const criteria = [...new Set(judged.flatMap((r) => Object.keys(r.judge!)))]
  return {
    measures: measures(answered),
    marking: {
      accuracy: stat(marked, (r) => m(r).score),
      falseCorrect: stat(marked.filter((r) => m(r).expected !== 'correct'), (r) => (m(r).falseCorrect ? 1 : 0)),
      rejectedRight: stat(marked.filter((r) => m(r).expected === 'correct'), (r) => (m(r).rejectedRight ? 1 : 0)),
      plantedCaught: stat(marked.filter((r) => r.situation === 'mark-planted-error'), (r) => (m(r).got !== 'correct' && m(r).got !== 'none' && m(r).named !== false ? 1 : 0)),
      unusualAccepted: stat(marked.filter((r) => r.situation === 'mark-unusual-correct'), (r) => (m(r).got === 'correct' ? 1 : 0)),
      misconceptionNamed: stat(marked.filter((r) => r.situation === 'after-wrong' && m(r).named !== null), (r) => (m(r).named ? 1 : 0))
    },
    // The core subjects always; the breadth and humanities subjects, and the humanities' situations, where they were run
    bySubject: Object.fromEntries(ALL_SUBJECTS.filter((s) => (SUBJECTS as readonly string[]).includes(s) || answered.some((r) => r.subject === s)).map((s) => [s, measures(answered.filter((r) => r.subject === s))])),
    bySituation: Object.fromEntries(ALL_SITUATIONS.map((s) => [s, measures(answered.filter((r) => r.situation === s))])),
    failures: [...failures].map(([id, n]) => ({ id, share: round(n / Math.max(1, rows.length))! })).sort((a, b) => b.share - a.share),
    repairs: [...repairs].map(([id, n]) => ({ id, share: round(n / Math.max(1, answered.length))! })).sort((a, b) => b.share - a.share),
    left: { errors: every.length - answered.length, unfinished: answered.length - rows.length },
    ...(judged.length ? { judge: Object.fromEntries(criteria.map((c) => [c, stat(judged, (r) => r.judge?.[c] ?? null)])) } : {})
  }
}

const pct = (s: Stat | undefined) => (s && s.n ? `${(s.mean * 100).toFixed(1).padStart(5)}% ±${(s.spread * 100).toFixed(1)}` : '    -')

export function printable(s: Summary): string {
  const line = (label: string, st: Stat | undefined) => `  ${label.padEnd(34)} ${pct(st)}${st?.n ? `   (n=${st.n})` : ''}`
  const table = (by: Record<string, Record<string, Stat>>) =>
    Object.entries(by)
      .filter(([, v]) => v.overall?.n)
      .map(([k, v]) => `  ${k.padEnd(22)} pass ${pct(v.pass)}  protocol ${pct(v.protocol)}  marking ${pct(v.marking)}  exact ${pct(v.exactness)}  pace ${pct(v.pace)}  visual ${pct(v.visual)}`)
      .join('\n')
  return [
    'MARKING (verdict against the truth)',
    line('accuracy', s.marking.accuracy),
    line('not-right marked correct', s.marking.falseCorrect),
    line('right answers marked down', s.marking.rejectedRight),
    line('planted errors caught', s.marking.plantedCaught),
    line('unusual-but-correct accepted', s.marking.unusualAccepted),
    line('stated misconception named', s.marking.misconceptionNamed),
    'ALL MEASURES (mean ± spread across repeats)',
    ...Object.entries(s.measures).map(([k, v]) => line(k, v)),
    'BY SUBJECT',
    table(s.bySubject),
    'BY SITUATION',
    table(s.bySituation),
    'MOST COMMON FAILURES (share of replies)',
    ...s.failures.slice(0, 10).map((f) => `  ${f.id.padEnd(34)} ${(f.share * 100).toFixed(1)}%`),
    ...(s.repairs?.length ? ['PUT RIGHT BY THE APP BEFORE THE LEARNER SAW IT (share of replies)', ...s.repairs.map((f) => `  ${f.id.padEnd(34)} ${(f.share * 100).toFixed(1)}%`)] : []),
    ...(s.left?.errors || s.left?.unfinished ? [`LEFT OUT: ${s.left.errors} failed request${s.left.errors === 1 ? '' : 's'} (of everything); ${s.left.unfinished} saved repl${s.left.unfinished === 1 ? 'y' : 'ies'} that stalled with nothing after (of everything but marking)`] : []),
    ...(s.judge ? ['JUDGE (a stronger model, 1 to 5; reported apart from the scores above)', ...Object.entries(s.judge).map(([k, v]) => `  ${k.padEnd(34)} ${v.mean.toFixed(2)} ±${v.spread.toFixed(2)}   (n=${v.n})`)] : [])
  ].join('\n')
}
