/**
 * Sharpness training: a steady stream of unseen problems just past your level, in six categories,
 * each with its own rating. A first attempt is timed and gets no hints; it is graded and moves the
 * rating. After a miss the method hints open (shared/sharpMethods), then a short post-mortem turns
 * what unlocked it into a recall card about the method or the pattern (shared/sharpPostmortem).
 * Production incidents are drills of their own (shared/sharpIncidents).
 *
 * Ratings reuse the morning workout's Elo code (shared/workout); a band that narrows with attempts
 * and widens with time away stands in for Glicko's rating deviation. Benchmarks map a rating to a
 * real bar ("solves LeetCode-hard-style in about 35 minutes") as an estimate, never a claim.
 *
 * Pure rules here: main/sharpness keeps the files and talks to Claude.
 */
import { expected, START_RATING, updateRating, type Rating } from './workout'
import { isMethod, type MethodId } from './sharpMethods'
import { splitTestFunctions } from './codeTests'

export type SharpCategory = 'algorithms' | 'design' | 'production' | 'ml' | 'quant' | 'proofs'

export interface CategoryInfo {
  id: SharpCategory
  label: string
  short: string
  blurb: string
  /** Minutes on the clock for one problem */
  minutes: number
  /** How a first attempt is marked */
  marked: string
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'algorithms', label: 'Algorithms', short: 'algorithms', blurb: 'LeetCode-medium to hard style, in Python, against hidden tests', minutes: 35, marked: 'Hidden tests in Tide’s sandbox' },
  { id: 'design', label: 'System design', short: 'design', blurb: 'Novel briefs: feature stores, ledgers at scale, chain indexers', minutes: 40, marked: 'Opus against a rubric; in code without Claude' },
  { id: 'production', label: 'Production incidents', short: 'incidents', blurb: 'On call: logs, metrics, hypotheses, a fix and a post-mortem', minutes: 30, marked: 'Method, speed and the root cause' },
  { id: 'ml', label: 'ML problem-solving', short: 'ML', blurb: 'Debug a model, design an experiment, size a test', minutes: 25, marked: 'Opus against a rubric; numbers checked in code' },
  { id: 'quant', label: 'Quant and probability', short: 'quant', blurb: 'Brainteasers and probability at trading-firm interview level', minutes: 12, marked: 'Exact answers, checked in code' },
  { id: 'proofs', label: 'Maths proofs', short: 'proofs', blurb: 'Short proofs: induction, contradiction, pigeonhole, invariants', minutes: 25, marked: 'Opus checks each step; key steps in code without Claude' }
]

export const categoryInfo = (c: SharpCategory) => CATEGORIES.find((x) => x.id === c)!
export const isCategory = (x: unknown): x is SharpCategory => typeof x === 'string' && CATEGORIES.some((c) => c.id === x)

// ---------- Problems ----------

/** A point a strong answer makes, and words that show it was made (any one, case-insensitive) */
export interface CheckPoint {
  point: string
  cues: string[]
}

export interface SharpProblem {
  id: string
  category: Exclude<SharpCategory, 'production'>
  title: string
  /** On the rating scale: 1000 easy, 1300 medium, 1700 hard, 2000+ very hard */
  difficulty: number
  /** The pattern it belongs to ("monotonic deque", "complement counting") */
  pattern: string
  /** The methods that unlock it, most useful first */
  methods: MethodId[]
  /** The statement, Markdown */
  brief: string
  minutes: number
  origin: 'bank' | 'claude'
  /** Algorithms: Python, hidden pytest functions */
  code?: { starter: string; reference: string; tests: string; examples: string[]; complexity?: string }
  /** A number to check against (quant, some ML) */
  answer?: { value: number; tolerance: number }
  /** Design, ML and proofs: what a strong answer covers */
  checklist?: CheckPoint[]
  /** The worked solution, shown after grading */
  solution: string
  /** Solution hints, given only after the method hints (shared/sharpMethods) */
  hints: string[]
}

/** What the window sees before grading: no reference, tests, answer or solution */
export interface PublicSharpProblem {
  id: string
  category: SharpProblem['category']
  title: string
  difficulty: number
  pattern: string
  brief: string
  minutes: number
  origin: SharpProblem['origin']
  starter?: string
  examples?: string[]
  testNames?: string[]
  /** How to answer: code, a number, or written */
  answerKind: 'code' | 'number' | 'written'
}

const testNameList = (tests: string) => [...tests.matchAll(/^def\s+test_?(\w*)\s*\(/gm)].map((m) => m[1].replace(/_/g, ' ').trim() || 'test')

export function publicSharp(p: SharpProblem): PublicSharpProblem {
  return {
    id: p.id,
    category: p.category,
    title: p.title,
    difficulty: p.difficulty,
    // The pattern is a clue; it is shown after grading
    pattern: '',
    brief: p.brief,
    minutes: p.minutes,
    origin: p.origin,
    ...(p.code ? { starter: p.code.starter, examples: p.code.examples, testNames: testNameList(p.code.tests) } : {}),
    answerKind: p.code ? 'code' : p.answer && !p.checklist?.length ? 'number' : 'written'
  }
}

/** Difficulty in words, against the real bars */
export function difficultyWords(c: SharpCategory, d: number): string {
  const band = d < 1150 ? 0 : d < 1500 ? 1 : d < 1850 ? 2 : 3
  const words: Record<SharpCategory, string[]> = {
    algorithms: ['LeetCode-easy style', 'LeetCode-medium style', 'LeetCode-hard style', 'beyond LeetCode-hard'],
    design: ['a junior design question', 'a mid-level design interview', 'a senior design interview', 'a staff-level design interview'],
    production: ['a routine page', 'a tricky on-call page', 'a senior on-call incident', 'a novel multi-system outage'],
    ml: ['an ML fundamentals question', 'an MLE interview question', 'a senior MLE problem', 'a research-engineer problem'],
    quant: ['a warm-up teaser', 'a first-round quant question', 'a trading-firm final-round question', 'a puzzle-competition problem'],
    proofs: ['a first-year exercise', 'an undergraduate proof', 'a hard undergraduate proof', 'an olympiad-style proof']
  }
  return words[c][band]
}

// ---------- Ratings ----------

export interface SharpRating extends Rating {
  /** Last rated attempt, for the band to widen with time away */
  last?: number
}

export const freshRatings = (): Record<SharpCategory, SharpRating> =>
  Object.fromEntries(CATEGORIES.map((c) => [c.id, { r: START_RATING, n: 0 }])) as Record<SharpCategory, SharpRating>

/**
 * How sure the rating is (± points, about one standard deviation): wide at first, narrowing with
 * each rated attempt, widening again with weeks away (Glicko's idea, in one line).
 */
export function ratingBand(rt: SharpRating, now: number): number {
  const idleDays = rt.last ? Math.max(0, (now - rt.last) / 86_400_000) : 0
  const base = 350 / Math.sqrt(1 + rt.n / 2)
  return Math.round(Math.min(350, Math.max(45, Math.sqrt(base ** 2 + 4 * idleDays))))
}

/** A rated attempt moves the rating (the workout's Elo update) */
export function rateAttempt(rt: SharpRating, difficulty: number, score: number, at: number): SharpRating {
  return { ...updateRating(rt, difficulty, score), last: at }
}

/** "Just past your level": the difficulty you'd solve about 45% of the time on a first attempt */
export const STRETCH = 0.45
export const stretchDifficulty = (rating: number) => Math.round(rating - 400 * Math.log10(STRETCH / (1 - STRETCH)))

// ---------- Scoring an attempt ----------

/**
 * A first attempt's score (0 to 1): what it got right, scaled by time. Inside the clock counts in
 * full; up to half as long again over, it fades to 60%; past that, 40%.
 */
export function timedScore(raw: number, usedMs: number, minutes: number): number {
  const r = Math.max(0, Math.min(1, raw))
  const over = usedMs / (minutes * 60_000)
  const t = over <= 1 ? 1 : over <= 1.5 ? 1 - ((over - 1) / 0.5) * 0.4 : 0.4
  return Math.round(r * t * 100) / 100
}

/** Solved: right in substance, inside the clock (or just over) */
export const solvedBy = (score: number) => score >= 0.7

/** Number answers, as typed: right within the tolerance */
export function checkNumber(answer: { value: number; tolerance: number }, typed: number | null): boolean {
  return typed !== null && Number.isFinite(typed) && Math.abs(typed - answer.value) <= answer.tolerance
}

/** Written answers marked in code: the share of checklist points covered */
export function checklistCover(points: CheckPoint[], text: string): { covered: string[]; missed: string[]; share: number } {
  const low = text.toLowerCase()
  const covered = points.filter((p) => p.cues.some((c) => low.includes(c.toLowerCase()))).map((p) => p.point)
  const missed = points.filter((p) => !covered.includes(p.point)).map((p) => p.point)
  return { covered, missed, share: points.length ? covered.length / points.length : 0 }
}

// ---------- The log ----------

export interface AttemptRecord {
  id: string
  at: number
  category: SharpCategory
  problem: string
  title: string
  pattern: string
  difficulty: number
  origin: 'bank' | 'claude' | 'mock'
  /** The rated first attempt's score */
  score: number
  solved: boolean
  usedMs: number
  minutes: number
  /** The rating before and after */
  before: number
  after: number
  /** Methods ticked as tried */
  reached: MethodId[]
  methodHints: number
  solutionHints: number
  /** Solved on a retry after a method hint */
  unlockedBy?: MethodId
  /** How it was marked */
  by: 'tests' | 'number' | 'opus' | 'gemma' | 'code' | 'drill' | 'mock'
  /** Post-mortem written */
  postmortem?: string
}

export interface SharpPrefs {
  version: 1
  ratings: Record<SharpCategory, SharpRating>
  methods: import('./sharpMethods').MethodStats
}

/** Rating points over time for one category, oldest first: the trend */
export function trend(attempts: AttemptRecord[], c: SharpCategory, last = 20): { at: number; r: number }[] {
  return attempts
    .filter((a) => a.category === c)
    .sort((a, b) => a.at - b.at)
    .slice(-last)
    .map((a) => ({ at: a.at, r: a.after }))
}

/** The change over the last few attempts (up, down or flat), in points */
export function trendChange(attempts: AttemptRecord[], c: SharpCategory, over = 5): number | null {
  const t = attempts.filter((a) => a.category === c).sort((a, b) => a.at - b.at).slice(-over)
  if (!t.length) return null
  return Math.round(t[t.length - 1].after - t[0].before)
}

// ---------- Benchmarks ----------

export interface Bar {
  category: SharpCategory
  /** The bar, stated plainly */
  label: string
  /** The difficulty that stands for it */
  difficulty: number
}

export const BARS: Bar[] = [
  { category: 'algorithms', label: 'LeetCode-medium-style in about 25 minutes', difficulty: 1300 },
  { category: 'algorithms', label: 'LeetCode-hard-style in about 35 minutes', difficulty: 1700 },
  { category: 'design', label: 'system design at a mid-level interview rubric', difficulty: 1300 },
  { category: 'design', label: 'system design at a senior-interview rubric', difficulty: 1650 },
  { category: 'design', label: 'system design at a staff-interview rubric', difficulty: 1950 },
  { category: 'production', label: 'a routine on-call page, root-caused in 30 minutes', difficulty: 1250 },
  { category: 'production', label: 'a senior on-call incident, root-caused in 30 minutes', difficulty: 1650 },
  { category: 'ml', label: 'MLE-interview debugging and experiment design', difficulty: 1300 },
  { category: 'ml', label: 'senior MLE problem-solving', difficulty: 1650 },
  { category: 'quant', label: 'first-round quant brainteasers', difficulty: 1300 },
  { category: 'quant', label: 'quant brainteasers at trading-firm final-round level', difficulty: 1700 },
  { category: 'proofs', label: 'undergraduate proofs, written cleanly', difficulty: 1300 },
  { category: 'proofs', label: 'hard undergraduate and olympiad-style proofs', difficulty: 1750 }
]

/** Rated attempts needed before a benchmark is stated at all */
export const BENCH_MIN = 5

export interface Benchmark {
  label: string
  /** Estimated chance of meeting the bar on a first attempt */
  chance: number
  /** The same with the rating's band: a low and a high */
  low: number
  high: number
  met: boolean
  /** "Estimate: …", or why there is none */
  say: string
}

/**
 * Each bar of a category as an estimate: the chance a first attempt at that level succeeds, from
 * the rating and its band. Said as an estimate; nothing is said until BENCH_MIN attempts.
 */
export function benchmarks(c: SharpCategory, rt: SharpRating, now: number): Benchmark[] {
  const band = ratingBand(rt, now)
  return BARS.filter((b) => b.category === c).map((b) => {
    const chance = expected(rt.r, b.difficulty)
    const low = expected(rt.r - band, b.difficulty)
    const high = expected(rt.r + band, b.difficulty)
    const pc = (x: number) => `${Math.round(x * 100)}%`
    const met = rt.n >= BENCH_MIN && low >= 0.5
    const say =
      rt.n < BENCH_MIN
        ? `Not enough attempts yet: ${rt.n} of ${BENCH_MIN}.`
        : met
          ? `Estimate: at this bar. A first attempt succeeds about ${pc(chance)} of the time (${pc(low)}–${pc(high)}).`
          : chance >= 0.5
            ? `Estimate: probably at this bar, about ${pc(chance)} of first attempts (${pc(low)}–${pc(high)}); more attempts will narrow it.`
            : `Estimate: not yet. About ${pc(chance)} of first attempts at this level would succeed (${pc(low)}–${pc(high)}).`
    return { label: b.label, chance, low, high, met, say }
  })
}

// ---------- The stream ----------

export interface CardDue {
  id: string
  category: SharpCategory
  pattern: string
  prompt: string
}

export interface StreamItem {
  kind: 'problem' | 'revisit' | 'incident'
  category: SharpCategory
  /** The difficulty to aim at */
  difficulty: number
  /** Why this one, in a few words */
  why: string
  /** A method to train, if the item leans on one */
  method?: MethodId
  /** For a revisit: the card that brought it back */
  card?: CardDue
}

/**
 * What comes next: a short list, most useful first. Due post-mortem cards come back as revisits
 * of their pattern; then categories by need, weakest and longest-untouched first, each aimed just
 * past its rating; a method you never reach for rides along with the first new problem.
 */
export function nextInStream(o: { ratings: Record<SharpCategory, SharpRating>; attempts: AttemptRecord[]; due: CardDue[]; train: MethodId[]; now: number; weak?: SharpCategory[]; count?: number }): StreamItem[] {
  const count = o.count ?? 4
  const out: StreamItem[] = []
  for (const card of o.due.slice(0, 1)) out.push({ kind: 'revisit', category: card.category, difficulty: stretchDifficulty(o.ratings[card.category].r), why: `Revisit: ${card.pattern}`, card })
  const lastAt = (c: SharpCategory) => Math.max(0, ...o.attempts.filter((a) => a.category === c).map((a) => a.at))
  const mean = CATEGORIES.reduce((s, c) => s + o.ratings[c.id].r, 0) / CATEGORIES.length
  const need = (c: SharpCategory) => {
    const r = o.ratings[c]
    const days = lastAt(c) ? (o.now - lastAt(c)) / 86_400_000 : 30
    const weak = (mean - r.r) / 100 + (o.weak?.includes(c) ? 2.5 : 0)
    const unseen = r.n === 0 ? 1 : 0
    return weak + Math.min(3, days / 3) + unseen
  }
  const order = CATEGORIES.map((c) => c.id).sort((a, b) => need(b) - need(a))
  for (const c of order) {
    if (out.length >= count) break
    if (out.some((x) => x.category === c)) continue
    const r = o.ratings[c]
    const days = lastAt(c) ? Math.round((o.now - lastAt(c)) / 86_400_000) : null
    const why = o.weak?.includes(c) ? 'Weak in your mocks' : r.n === 0 ? 'Not tried yet' : r.r < mean - 60 ? 'Your weakest' : days !== null && days >= 4 ? `${days} days since the last` : 'Next step up'
    out.push({ kind: c === 'production' ? 'incident' : 'problem', category: c, difficulty: stretchDifficulty(r.r), why })
  }
  const first = out.find((x) => x.kind === 'problem')
  if (first && o.train[0]) first.method = o.train[0]
  return out
}

// ---------- Claude writes a problem; Tide checks it before use ----------

export const WRITER_SYSTEM =
  'You write original interview-grade problems for one learner. Each must be new (not a well-known named problem restated), exact, and solvable in the time given. Reply with one JSON object only, no prose.'

const FIELDS = 'ML and MLE work with deep infrastructure and backend engineering, quantitative finance, blockchain, data engineering, and computational economics'

/** The request for one original problem of a category, aimed at a difficulty, leaning on a method */
export function writerPrompt(o: { category: Exclude<SharpCategory, 'production'>; difficulty: number; avoid: string[]; method?: MethodId; pattern?: string; fix?: string }): string {
  const level = difficultyWords(o.category, o.difficulty)
  const shape: Record<Exclude<SharpCategory, 'production'>, string> = {
    algorithms: `{"title": str, "pattern": str, "methods": [method ids], "brief": "Markdown statement naming the function and its signature", "examples": ["f(...) == ..."], "starter": "def f(...):\\n    pass\\n", "reference": "a correct, efficient Python solution", "brute": "a slow but obviously correct Python solution with the same function name", "tests": "6 to 10 pytest functions def test_<what>(): with plain asserts calling the function by name; at most 2 large tests, named test_large_<what>", "complexity": "O(...) time, O(...) space", "solution": "the worked idea in Markdown", "hints": ["solution hint 1", "solution hint 2"]}`,
    design: `{"title": str, "pattern": str, "methods": [method ids], "brief": "a novel product brief, two to four sentences, with numbers where it matters", "checklist": [{"point": "what a strong answer says", "cues": ["words that show it"]}] (8 to 12 points across requirements, architecture, scale, consistency, idempotency and failure), "solution": "a reference design in Markdown", "hints": [str, str]}`,
    ml: `{"title": str, "pattern": str, "methods": [method ids], "brief": "a concrete situation: a model misbehaving with numbers, or an experiment to design", "checklist": [{"point": str, "cues": [str]}] (5 to 8 points), "answer": optional number, "tolerance": optional number, "check": "optional Python that prints the answer number, using only the standard library", "solution": "Markdown", "hints": [str, str]}`,
    quant: `{"title": str, "pattern": str, "methods": [method ids], "brief": "the brainteaser; ask for an exact number or a decimal to 3 places", "answer": number, "tolerance": number, "check": "Python (standard library only) that computes the answer exactly or by enumeration and prints only the number", "solution": "Markdown", "hints": [str, str]}`,
    proofs: `{"title": str, "pattern": str, "methods": [method ids], "brief": "the statement to prove", "checklist": [{"point": "a key step of a correct proof", "cues": [str]}] (3 to 6 steps), "check": "optional Python that checks the claim for small cases and prints True", "solution": "a full proof in Markdown", "hints": [str, str]}`
  }
  return [
    `Write one original ${o.category === 'ml' ? 'ML problem-solving' : o.category === 'proofs' ? 'maths proof' : o.category === 'quant' ? 'quant brainteaser or probability' : o.category === 'design' ? 'system design' : 'algorithms'} problem at the level of ${level} (rating ${o.difficulty}).`,
    `The learner's fields: ${FIELDS}. Set it in one of them where it fits naturally.`,
    o.method ? `Its key unlock should be the method "${o.method}" (they rarely reach for it).` : '',
    o.pattern ? `It should belong to the pattern "${o.pattern}" without being a problem they have seen.` : '',
    o.avoid.length ? `Not any of these, or a restatement: ${o.avoid.slice(0, 20).join('; ')}.` : '',
    `Method ids: understand, simplify, small-cases, invariant, backwards, generalise, analogy, draw, edges, estimate.`,
    `JSON shape: ${shape[o.category]}`,
    o.fix ? `Your last attempt failed Tide's check: ${o.fix}. Fix that.` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The model's reply as an object, or null */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const t = text.replace(/```(?:json)?/g, '').trim()
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const v = JSON.parse(t.slice(a, b + 1)) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const s = (x: unknown, n = 8000) => (typeof x === 'string' ? x.slice(0, n) : '')
const strs = (x: unknown, n = 12) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string').slice(0, n) : [])

/**
 * A written problem as a SharpProblem, before any running: the shape checked, or the reason it
 * fails. `brute` and `check` come back separately: they are used to verify, never shown.
 */
export function draftProblem(category: Exclude<SharpCategory, 'production'>, raw: Record<string, unknown>, difficulty: number, id: string): { problem: SharpProblem; brute?: string; check?: string } | { error: string } {
  const title = s(raw.title, 120).trim()
  const brief = s(raw.brief, 4000).trim()
  if (!title || brief.length < 40) return { error: 'missing a title or a full brief' }
  const methods = strs(raw.methods).filter(isMethod)
  const checklist = Array.isArray(raw.checklist)
    ? raw.checklist.flatMap((p) => (p && typeof p === 'object' && typeof (p as CheckPoint).point === 'string' ? [{ point: s((p as CheckPoint).point, 300), cues: strs((p as CheckPoint).cues, 8).map((c) => c.toLowerCase()).filter((c) => c.length >= 3) }] : [])).filter((p) => p.cues.length)
    : []
  const base: SharpProblem = {
    id,
    category,
    title,
    difficulty,
    pattern: s(raw.pattern, 80).trim() || title,
    methods: methods.length ? methods : ['understand'],
    brief,
    minutes: categoryInfo(category).minutes,
    origin: 'claude',
    solution: s(raw.solution, 8000).trim(),
    hints: strs(raw.hints, 4)
  }
  if (!base.solution) return { error: 'no worked solution' }
  if (category === 'algorithms') {
    const starter = s(raw.starter, 2000)
    const reference = s(raw.reference, 6000)
    const tests = s(raw.tests, 12000)
    const brute = s(raw.brute, 6000)
    const n = [...tests.matchAll(/^def\s+test\w*\s*\(/gm)].length
    if (!/^def\s+\w+/m.test(starter) || !/^def\s+\w+/m.test(reference)) return { error: 'the starter or the reference is not a Python function' }
    if (n < 5) return { error: `only ${n} tests; at least 5 are needed` }
    if (!brute) return { error: 'no brute-force solution to check the tests against' }
    if (/^\s*(from|import)\s+(answer|solution)\b/m.test(tests)) return { error: 'the tests import the solution; its names are already there' }
    const fnOf = (c: string) => /^def\s+(\w+)/m.exec(c)?.[1]
    if (fnOf(starter) !== fnOf(reference)) return { error: 'the starter and the reference name different functions' }
    return { problem: { ...base, code: { starter, reference, tests, examples: strs(raw.examples, 4), complexity: s(raw.complexity, 120) } }, brute }
  }
  if (category === 'design' || category === 'ml' || category === 'proofs') {
    const min = category === 'design' ? 6 : category === 'ml' ? 4 : 3
    if (checklist.length < min) return { error: `only ${checklist.length} checklist points with cues; at least ${min} are needed` }
  }
  const value = typeof raw.answer === 'number' && Number.isFinite(raw.answer) ? raw.answer : null
  const tolerance = typeof raw.tolerance === 'number' && raw.tolerance >= 0 ? raw.tolerance : value !== null ? Math.max(1e-9, Math.abs(value) * 1e-3) : 0
  const check = s(raw.check, 4000)
  if (category === 'quant') {
    if (value === null) return { error: 'no number for the answer' }
    if (!check) return { error: 'no Python check that computes the answer' }
  }
  return { problem: { ...base, ...(checklist.length ? { checklist } : {}), ...(value !== null ? { answer: { value, tolerance } } : {}) }, ...(check ? { check } : {}) }
}

/** What a run of the sandbox reports */
export interface RunOutcome {
  stdout: string
  exitCode: number
  timedOut: boolean
  passed?: string[]
  failed?: string[]
}

export interface Verifier {
  /** Run Python code against pytest-style tests (main/runner.runCode with tests) */
  runTests(code: string, tests: string): Promise<RunOutcome>
  /** Run Python code alone */
  run(code: string): Promise<RunOutcome>
}

/**
 * A written problem is used only if it checks out in the sandbox:
 * - algorithms: the reference passes every hidden test; the brute force passes every test but the
 *   large ones (so the expected values don't rest on the reference alone); the starter fails at
 *   least one; there are at least five
 * - quant (and ML or proofs with a check): the check runs and prints the stated answer (or True)
 * - design, ML and proofs: the checklist shape, checked in draftProblem
 */
export async function verifyProblem(d: { problem: SharpProblem; brute?: string; check?: string }, v: Verifier): Promise<{ ok: true } | { ok: false; why: string }> {
  const p = d.problem
  if (p.code) {
    const names = [...p.code.tests.matchAll(/^def\s+(test\w*)\s*\(/gm)].map((m) => m[1])
    const ref = await v.runTests(p.code.reference, p.code.tests)
    if (ref.timedOut) return { ok: false, why: 'the reference timed out on the tests' }
    const refFailed = names.filter((n) => !(ref.passed ?? []).includes(n))
    if (refFailed.length) return { ok: false, why: `the reference fails ${refFailed.join(', ')}` }
    if (d.brute) {
      // The brute force is slow by design: it runs the small tests only
      const split = splitTestFunctions(p.code.tests)
      const smallTests = split.tests.filter((t) => !/^test_large/.test(t.name))
      const small = smallTests.map((t) => t.name)
      const bf = await v.runTests(d.brute, [split.preamble, ...smallTests.map((t) => t.code)].filter(Boolean).join('\n\n'))
      const disagree = small.filter((n) => !(bf.passed ?? []).includes(n))
      if (disagree.length) return { ok: false, why: `the brute-force solution disagrees on ${disagree.join(', ')}` }
    }
    const st = await v.runTests(p.code.starter, p.code.tests)
    if (names.length && names.every((n) => (st.passed ?? []).includes(n))) return { ok: false, why: 'the starter already passes every test' }
    return { ok: true }
  }
  if (d.check) {
    const r = await v.run(d.check)
    if (r.exitCode !== 0 || r.timedOut) return { ok: false, why: 'the check did not run' }
    const out = r.stdout.trim().split('\n').pop()?.trim() ?? ''
    if (p.answer) {
      const got = Number(out)
      if (!Number.isFinite(got) || Math.abs(got - p.answer.value) > Math.max(p.answer.tolerance, 1e-9)) return { ok: false, why: `the check prints ${out || 'nothing'}, not ${p.answer.value}` }
    } else if (!/^true$/i.test(out)) return { ok: false, why: `the check prints ${out || 'nothing'}, not True` }
  } else if (p.category === 'quant') return { ok: false, why: 'no check' }
  return { ok: true }
}

// ---------- Grading written answers ----------

export const GRADER_SYSTEM =
  'You grade one answer for a learner training to be sharp at interview-grade problems. Be exact and fair: credit what is there, name what is missing, never inflate. Reply with one JSON object only.'

export function graderPrompt(p: SharpProblem, answer: string, usedMin: number): string {
  return [
    `Category: ${categoryInfo(p.category).label}. Problem (${difficultyWords(p.category, p.difficulty)}): ${p.title}`,
    p.brief,
    p.checklist?.length ? `What a strong answer covers:\n${p.checklist.map((c, i) => `${i + 1}. ${c.point}`).join('\n')}` : '',
    p.answer ? `The exact answer: ${p.answer.value} (tolerance ${p.answer.tolerance}).` : '',
    `Reference solution:\n${p.solution}`,
    `Time used: ${Math.round(usedMin)} of ${p.minutes} minutes.`,
    `The learner's answer:\n"""\n${answer.slice(0, 12000)}\n"""`,
    `Reply: {"score": 0 to 1, "covered": [checklist numbers met], "verdict": "one sentence", "missing": ["the most important thing missing", ...], "strength": "one thing done well"}. A proof with a gap in a key step is at most 0.5.`
  ]
    .filter(Boolean)
    .join('\n\n')
}

export interface Graded {
  score: number
  verdict: string
  missing: string[]
  strength?: string
  covered?: string[]
}

export function parseGrade(text: string, p: SharpProblem): Graded | null {
  const o = parseJsonObject(text)
  if (!o || typeof o.score !== 'number' || !Number.isFinite(o.score)) return null
  const covered = Array.isArray(o.covered) ? o.covered.flatMap((n) => (typeof n === 'number' && p.checklist?.[n - 1] ? [p.checklist[n - 1].point] : [])) : undefined
  return { score: Math.max(0, Math.min(1, o.score)), verdict: s(o.verdict, 400), missing: strs(o.missing, 5), ...(typeof o.strength === 'string' ? { strength: s(o.strength, 300) } : {}), ...(covered ? { covered } : {}) }
}
