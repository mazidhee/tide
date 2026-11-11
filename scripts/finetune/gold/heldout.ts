/**
 * The held-out rule: no gold example may reuse a benchmark scenario's topic-and-question pair,
 * its wording or its numbers, or the benchmark stops measuring the tutor and starts measuring
 * its memory. Each example is compared with every scenario in three ways, each with a threshold:
 *
 *   wording   the share of its 4-word runs found in the scenario (the builder's own measure, held
 *             to WORDING instead of the builder's 0.5), text against text and whole against whole
 *   numbers   how many distinctive numbers (bit patterns, hex, decimals, anything that is not a
 *             small or round number) the two have in common
 *   question  the same topic, or a topic close to it together with a question made of the same
 *             content words
 *
 * The thresholds are set from the benchmark itself (see THRESHOLDS): the 70 scenarios are
 * distinct situations written by one hand under one protocol, so how much any two of them share
 * is how much distinct lessons share by chance. A gold example must be at least as far from every
 * scenario as the scenarios are from each other.
 */
import { closeness } from '../../../src/shared/lessonMemory'
import { hideWorking, parseBlocks } from '../../../src/shared/session'
import type { Scenario, Turn } from '../../eval/tutor/types'

export const THRESHOLDS = {
  /**
   * Share of 4-word runs, one text (a turn, a reply) against one text. Between two different
   * benchmark scenarios the largest value is 0.18, from the stock phrases of two short replies
   * (measured by `cli.ts calibrate`, asserted in test/goldSet.test.ts); a copied text scores 1,
   * and one with every third word changed still scores about 0.2. So 0.2 is the lowest
   * threshold that distinct lessons do not reach by chance.
   */
  wording: 0.2,
  /** The same, whole example against whole scenario, where chance phrases dilute: scenarios reach 0.025 between themselves */
  wordingWhole: 0.08,
  /** Distinctive numbers in common. Two different scenarios share at most 1; a reused calculation shares its operands, its steps and its result */
  numbers: 3,
  /** Topic closeness (lessonMemory.closeness) from which a topic counts as the scenario's own */
  sameTopic: 1,
  /** Topic closeness from which the question is compared too */
  nearTopic: 0.5,
  /** Share of the question's content words found in the scenario's question, for a near topic (two scenarios on near topics reach 0.6 once, 0.33 otherwise) */
  question: 0.5
}

export interface Texts {
  topic: string
  /** Every piece of text on its own: each turn, the reply */
  texts: string[]
  /** What is asked: ask prompts and the problem statements before them */
  questions: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export const shingles = (s: string, n = 4): Set<string> => {
  const w = norm(s).split(' ').filter(Boolean)
  const set = new Set<string>()
  for (let i = 0; i + n - 1 < w.length; i++) set.add(w.slice(i, i + n).join(' '))
  return set
}

/** The share of the smaller text's 4-word runs that the other has too; 0 when either is too short to judge (a dozen runs: below that, two stock phrases are a large share) */
export function wordingOverlap(a: Set<string>, b: Set<string>, least = 12): number {
  if (a.size < least || b.size < least) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let same = 0
  for (const s of small) if (large.has(s)) same++
  return same / small.size
}

const COMMON = new Set(['100', '1000', '10000', '100000', '1000000', '1024', '2048', '4096', '8192', '128', '256', '512', '255', '127', '32', '64', '24', '30', '40', '50', '60', '80', '90', '25', '75', '0.5', '0.1', '0.01', '0.9', '0.25', '0.75', '1.0', '2026', '2025', '2024', '200', '300', '400', '500', '365', '99'])

/**
 * The numbers a text would be recognised by: digit strings as written (so a bit pattern or a
 * decimal stays whole), leaving out what any lesson might hold: integers below 21, round numbers,
 * powers of two and common fractions.
 */
export function distinctiveNumbers(s: string): Set<string> {
  const out = new Set<string>()
  for (const m of s.toLowerCase().matchAll(/(?<![\p{L}\d.])(0x[0-9a-f]+|\d+(?:[.,]\d+)*)(?![\d])/gu)) {
    const t = m[1].replace(/,(?=\d{3}\b)/g, '').replace(/[.,]$/, '')
    if (COMMON.has(t)) continue
    if (/^\d+$/.test(t) && Number(t) <= 20) continue
    if (/^\d\.\d$/.test(t)) continue
    out.add(t)
  }
  return out
}

const STOP = new Set(
  'a an the and or but if then else of in on at to for from by with without as is are was were be been being it its this that these those there here what which who whom whose when where why how do does did done can could should would will shall may might must not no yes your you they them their he she we our i me my one two three each every any some all both either neither more most less least than so such very just also only same other another into over under between about after before again once out up down off above below per say give gives given write show shows find which answer question problem explain reason reasoning why steps step value values result number numbers many much'.split(' ')
)

const contentWords = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)))

/** What a tutor turn asks: the ask's prompt with the problem statement it follows */
function questionsOf(tutor: string): string[] {
  const blocks = parseBlocks(tutor)
  const out: string[] = []
  blocks.forEach((b, i) => {
    if (b.kind !== 'ask') return
    const before = blocks[i - 1]
    // The statement of a problem is the paragraph before its ask
    const statement = before && before.kind === 'text' ? before.text.split(/\n{2,}/).slice(-2).join(' ') : ''
    out.push(`${statement} ${b.prompt} ${b.options.join(' ')}`.trim())
  })
  return out
}

export function textsOf(x: { setup: { topic: string }; history: Turn[]; reply?: string; good?: string; bad?: { reply: string }[]; before?: unknown }): Texts {
  const tutor = [...x.history.flatMap((t) => ('tutor' in t ? [t.tutor] : [])), ...(x.reply ? [x.reply] : []), ...(x.good ? [x.good] : []), ...(x.bad ?? []).map((b) => b.reply)]
  // Only the learner's own words: Show me, Go on and "I don't know" are the app's, the same in every lesson
  const learner = x.history.flatMap((t) => ('learner' in t ? ('answer' in t.learner ? [t.learner.answer] : 'question' in t.learner ? [t.learner.question] : []) : []))
  // What an opening is told about earlier lessons holds questions too
  const before = x.before ? [JSON.stringify(x.before)] : []
  return { topic: x.setup.topic, texts: [...tutor.map((t) => t.replace(/<\/?[a-z]+\b[^>]*>/gi, ' ')), ...learner, ...before], questions: [...tutor.flatMap(questionsOf), ...before] }
}

export interface Clash {
  scenario: string
  kind: 'wording' | 'numbers' | 'question' | 'topic'
  value: number
  detail: string
}

interface Prepared {
  id: string
  topic: string
  shingles: Set<string>[]
  whole: Set<string>
  numbers: Set<string>
  questions: Set<string>[]
}

const prepare = (id: string, t: Texts): Prepared => ({
  id,
  topic: t.topic,
  shingles: t.texts.map((x) => shingles(x)),
  whole: shingles(t.texts.join(' \n ')),
  numbers: distinctiveNumbers(hideWorking(t.texts.join(' \n ')) + ' ' + t.texts.join(' \n ')),
  questions: t.questions.map(contentWords).filter((q) => q.size >= 4)
})

export interface Measure {
  wording: number
  wordingWhole: number
  numbers: string[]
  topic: number
  question: number
}

function measure(a: Prepared, b: Prepared): Measure {
  let wording = 0
  for (const x of a.shingles) for (const y of b.shingles) wording = Math.max(wording, wordingOverlap(x, y))
  const numbers = [...a.numbers].filter((n) => b.numbers.has(n))
  let question = 0
  for (const x of a.questions)
    for (const y of b.questions) {
      const [small, large] = x.size <= y.size ? [x, y] : [y, x]
      let same = 0
      for (const w of small) if (large.has(w)) same++
      question = Math.max(question, same / small.size)
    }
  return { wording, wordingWhole: wordingOverlap(a.whole, b.whole), numbers, topic: closeness(a.topic, b.topic), question }
}

function clashes(m: Measure, scenario: string, topic: string): Clash[] {
  const out: Clash[] = []
  if (m.topic >= THRESHOLDS.sameTopic) out.push({ scenario, kind: 'topic', value: m.topic, detail: `its topic is the scenario's ("${topic}")` })
  else if (m.topic >= THRESHOLDS.nearTopic && m.question >= THRESHOLDS.question) out.push({ scenario, kind: 'question', value: m.question, detail: `a topic close to "${topic}" with a question sharing ${Math.round(m.question * 100)}% of its content words` })
  if (m.wording >= THRESHOLDS.wording) out.push({ scenario, kind: 'wording', value: m.wording, detail: `${Math.round(m.wording * 100)}% of a text's 4-word runs are the scenario's` })
  if (m.wordingWhole >= THRESHOLDS.wordingWhole) out.push({ scenario, kind: 'wording', value: m.wordingWhole, detail: `${Math.round(m.wordingWhole * 100)}% of the whole example's 4-word runs are the scenario's` })
  if (m.numbers.length >= THRESHOLDS.numbers) out.push({ scenario, kind: 'numbers', value: m.numbers.length, detail: `shares the numbers ${m.numbers.join(', ')}` })
  return out
}

export interface Bench {
  prepared: Prepared[]
}

export const prepareBenchmark = (scenarios: Scenario[]): Bench => ({ prepared: scenarios.map((s) => prepare(s.id, textsOf(s))) })

export interface HeldOut {
  clashes: Clash[]
  /** The nearest any scenario comes, for the report */
  nearest: { wording: number; wordingWhole: number; numbers: number; scenario: string }
}

/** One example against every scenario: what it shares with any of them beyond the thresholds */
export function heldOutCheck(example: Parameters<typeof textsOf>[0], bench: Bench): HeldOut {
  const mine = prepare('example', textsOf(example))
  const out: Clash[] = []
  const nearest = { wording: 0, wordingWhole: 0, numbers: 0, scenario: '' }
  for (const s of bench.prepared) {
    const m = measure(mine, s)
    out.push(...clashes(m, s.id, s.topic))
    if (m.wording > nearest.wording) Object.assign(nearest, { wording: m.wording, scenario: s.id })
    nearest.wordingWhole = Math.max(nearest.wordingWhole, m.wordingWhole)
    nearest.numbers = Math.max(nearest.numbers, m.numbers.length)
  }
  return { clashes: out, nearest }
}

/** How much the benchmark's own scenarios share with each other: the chance level the thresholds stand on */
export function calibrate(scenarios: Scenario[]): { wording: number; wordingWhole: number; numbers: number; pairs: { a: string; b: string; m: Measure }[] } {
  const p = scenarios.map((s) => prepare(s.id, textsOf(s)))
  const pairs: { a: string; b: string; m: Measure }[] = []
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) pairs.push({ a: p[i].id, b: p[j].id, m: measure(p[i], p[j]) })
  return { wording: Math.max(...pairs.map((x) => x.m.wording)), wordingWhole: Math.max(...pairs.map((x) => x.m.wordingWhole)), numbers: Math.max(...pairs.map((x) => x.m.numbers.length)), pairs }
}
