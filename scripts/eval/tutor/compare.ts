/**
 * Two benchmark runs side by side (a base and a candidate: a new prompt, a model, an adapter), and
 * a plain decision on whether the candidate may replace the base.
 *
 *   npx vite-node scripts/eval/tutor/compare.ts -- results/<base>.json results/<candidate>.json
 *
 * The rule (decide below) is deliberately one-sided: a candidate has to be clearly better at
 * something and worse at nothing that matters. "Clearly" means by more than the runs move on
 * their own: twice the spread across repeats, and never less than the floor given here.
 */
import { readFileSync } from 'fs'
import type { Stat, Summary } from './summary'

export interface Run {
  version: string
  label: string
  model: string
  prompts: string
  settings: { temperature: number; seed: number; repeats: number; maxTokens: number }
  errors?: number
  summary: Summary
}

/** What a candidate must do to replace the base. Shares are fractions (0.03 = 3 points) */
export const RULE = {
  /** Something must get better by at least this: pass rate or protocol */
  gain: 0.05,
  /** Marking accuracy may not fall by more than this */
  markingSlack: 0.02,
  /** Exactness may not fall by more than this */
  exactnessSlack: 0.03,
  /** No subject's pass rate may fall by more than this */
  subjectSlack: 0.1,
  /** Fewer runs than this and the spread can't be trusted */
  minRepeats: 3
}

export interface Decision {
  go: boolean
  reasons: string[]
  blockers: string[]
}

const noise = (a?: Stat, b?: Stat) => 2 * Math.sqrt((a?.spread ?? 0) ** 2 + (b?.spread ?? 0) ** 2)
const pts = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} points`

export function decide(base: Run, cand: Run): Decision {
  const blockers: string[] = []
  const reasons: string[] = []
  if (base.version !== cand.version) blockers.push(`different scenario sets (${base.version} and ${cand.version}): not comparable`)
  if (base.prompts !== cand.prompts) blockers.push('the prompts differ between the runs: a model change and a prompt change cannot be told apart')
  if (base.settings.temperature !== cand.settings.temperature || base.settings.maxTokens !== cand.settings.maxTokens) blockers.push('the sampling settings differ between the runs')
  if (Math.min(base.settings.repeats, cand.settings.repeats) < RULE.minRepeats) blockers.push(`fewer than ${RULE.minRepeats} repeats: the spread cannot be estimated`)
  if (base.errors || cand.errors) blockers.push('some requests failed and were scored as empty replies: run again')
  const b = base.summary
  const c = cand.summary

  // Worse at nothing that matters
  const marking = c.marking.accuracy.mean - b.marking.accuracy.mean
  if (marking < -Math.max(RULE.markingSlack, noise(b.marking.accuracy, c.marking.accuracy))) blockers.push(`marking accuracy fell (${pts(marking)})`)
  const falseCorrect = c.marking.falseCorrect.mean - b.marking.falseCorrect.mean
  if (falseCorrect > noise(b.marking.falseCorrect, c.marking.falseCorrect) && falseCorrect > 0) blockers.push(`more not-right answers marked correct (${pts(falseCorrect)})`)
  const exact = (c.measures.exactness?.mean ?? 0) - (b.measures.exactness?.mean ?? 0)
  if (exact < -Math.max(RULE.exactnessSlack, noise(b.measures.exactness, c.measures.exactness))) blockers.push(`exactness fell (${pts(exact)})`)
  for (const [subject, was] of Object.entries(b.bySubject)) {
    const now = c.bySubject[subject]
    if (!was.pass?.n || !now?.pass?.n) continue
    const d = now.pass.mean - was.pass.mean
    if (d < -RULE.subjectSlack) blockers.push(`${subject} fell (${pts(d)} on pass rate)`)
  }

  // Clearly better at something
  for (const k of ['pass', 'protocol', 'marking'] as const) {
    const was = k === 'marking' ? b.marking.accuracy : b.measures[k]
    const now = k === 'marking' ? c.marking.accuracy : c.measures[k]
    if (!was?.n || !now?.n) continue
    const d = now.mean - was.mean
    if (d >= Math.max(RULE.gain, noise(was, now))) reasons.push(`${k === 'pass' ? 'pass rate' : k === 'marking' ? 'marking accuracy' : 'protocol'} rose (${pts(d)}, beyond the ${pts(noise(was, now))} the runs move by themselves)`)
  }
  if (!reasons.length) blockers.push(`nothing improved by ${RULE.gain * 100} points and more than the runs' own spread`)
  return { go: !blockers.length, reasons, blockers }
}

const cell = (s?: Stat) => (s?.n ? `${(s.mean * 100).toFixed(1).padStart(5)}% ±${(s.spread * 100).toFixed(1).padStart(4)}` : '      -     ')

export function table(base: Run, cand: Run): string {
  const rows: [string, Stat | undefined, Stat | undefined][] = [
    ['marking accuracy', base.summary.marking.accuracy, cand.summary.marking.accuracy],
    ['  not-right marked correct', base.summary.marking.falseCorrect, cand.summary.marking.falseCorrect],
    ['  right answers marked down', base.summary.marking.rejectedRight, cand.summary.marking.rejectedRight],
    ['  planted errors caught', base.summary.marking.plantedCaught, cand.summary.marking.plantedCaught],
    ['  unusual-but-correct accepted', base.summary.marking.unusualAccepted, cand.summary.marking.unusualAccepted],
    ['  misconception named', base.summary.marking.misconceptionNamed, cand.summary.marking.misconceptionNamed],
    ...['pass', 'protocol', 'exactness', 'pace', 'visual', 'overall'].map((k) => [k === 'pass' ? 'pass rate (every check met)' : k, base.summary.measures[k], cand.summary.measures[k]] as [string, Stat | undefined, Stat | undefined]),
    ...Object.keys(base.summary.bySubject).map((k) => [`subject: ${k}`, base.summary.bySubject[k].pass, cand.summary.bySubject[k]?.pass] as [string, Stat | undefined, Stat | undefined]),
    ...Object.keys(base.summary.bySituation).map((k) => [`situation: ${k}`, base.summary.bySituation[k].pass, cand.summary.bySituation[k]?.pass] as [string, Stat | undefined, Stat | undefined]),
    ...Object.keys(base.summary.judge ?? {}).filter((k) => cand.summary.judge?.[k]).map((k) => [`judge: ${k} (÷5)`, { ...base.summary.judge![k], mean: base.summary.judge![k].mean / 5, spread: base.summary.judge![k].spread / 5 }, { ...cand.summary.judge![k], mean: cand.summary.judge![k].mean / 5, spread: cand.summary.judge![k].spread / 5 }] as [string, Stat, Stat])
  ]
  const head = `${''.padEnd(34)}${base.label.slice(0, 14).padStart(14)}${cand.label.slice(0, 14).padStart(16)}     change`
  return [head, ...rows.map(([name, a, b]) => `${name.padEnd(34)}${cell(a).padStart(14)}${cell(b).padStart(16)}${a?.n && b?.n ? `   ${pts(b.mean - a.mean).padStart(12)}` : ''}`)].join('\n')
}

function main() {
  const files = process.argv.slice(2).filter((a) => a.endsWith('.json'))
  if (files.length !== 2) {
    console.error('Give two result files: the base, then the candidate.')
    process.exit(2)
  }
  const [base, cand] = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as Run)
  console.log(`Base:      ${base.label} (${base.model})\nCandidate: ${cand.label} (${cand.model})\nScenario set ${base.version}, ${base.settings.repeats} and ${cand.settings.repeats} repeats\n`)
  console.log(table(base, cand))
  const d = decide(base, cand)
  console.log(`\n${d.go ? 'GO' : 'NO-GO'}: ${d.go ? 'the candidate may replace the base.' : 'keep the base.'}`)
  for (const r of d.reasons) console.log(`  + ${r}`)
  for (const b of d.blockers) console.log(`  - ${b}`)
  process.exit(d.go ? 0 : 1)
}

if (process.argv[1]?.endsWith('compare.ts')) main()
