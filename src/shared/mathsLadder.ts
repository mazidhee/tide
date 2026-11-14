/**
 * The maths-to-quant ladder: arithmetic and algebra → functions → calculus → linear algebra →
 * probability → statistics → stochastic processes → pricing and risk. Each rung is filled from
 * the learner's own maths roadmap (RM_MATH: its chapters map onto the rungs, and a topic's own
 * words move it where they say, so "Derive Black-Scholes" sits on pricing though it is listed
 * under stochastic calculus), and its mastery is read from the knowledge map, whose estimates are
 * FSRS's. Nothing parallel is invented: without a roadmap a rung shows a few starter topics, and
 * lessons on them count once taught.
 *
 * Levels per rung (from the share of its topics that are solid now): not started, started,
 * working, steady, strong, mastered. Reaching strong on every rung up to one earns that rung's
 * title. "Teach me maths from the ground up" starts the next topic on the lowest rung not yet
 * strong. Pure.
 */
import type { ConceptState } from './knowledge'
import { mathsArea, mathsMode, type MathsArea } from './mathsMode'

export interface Rung {
  id: MathsArea
  label: string
  /** What it unlocks on the way to quant work, in a few words */
  why: string
  /** The title for reaching strong on it (and every rung below) */
  title: string
  /** A few topics to start from when the learner's roadmap has none here */
  starters: string[]
}

export const RUNGS: Rung[] = [
  { id: 'algebra', label: 'Arithmetic and algebra', why: 'the language everything else is written in', title: 'Algebraist', starters: ['Fractions, ratios and percentages', 'Exponents and logarithms as inverse operations', 'Solving linear and quadratic equations', 'What a proof is: direct proof and contradiction'] },
  { id: 'functions', label: 'Functions', why: 'how one quantity depends on another', title: 'Function builder', starters: ['What a function is: domain, range and graph', 'Exponential growth and compounding', 'Composition and inverse functions'] },
  { id: 'calculus', label: 'Calculus', why: 'rates of change and accumulation: sensitivities and Greeks', title: 'Analyst', starters: ['The limit definition of the derivative', 'Differentiating x² from first principles', 'The chain rule, derived', 'Riemann sums and the definite integral', 'Taylor series'] },
  { id: 'linear-algebra', label: 'Linear algebra', why: 'portfolios, factor models and every ML model', title: 'Linear algebraist', starters: ['Vectors and linear combinations', 'Matrices as linear maps', 'Determinants as area scaling', 'Eigenvectors and eigenvalues'] },
  { id: 'probability', label: 'Probability', why: 'reasoning about uncertainty and expected value', title: 'Probabilist', starters: ['Conditional probability and Bayes’ theorem', 'Random variables and expected value', 'The binomial and Poisson distributions', 'The normal distribution', 'The central limit theorem'] },
  { id: 'statistics', label: 'Statistics', why: 'learning from data, and how sure to be', title: 'Statistician', starters: ['Estimators, bias and variance', 'Confidence intervals', 'Hypothesis tests and p-values', 'Least squares regression'] },
  { id: 'stochastic', label: 'Stochastic processes', why: 'how prices and risks move over time', title: 'Stochastic modeller', starters: ['Random walks', 'Brownian motion', 'Itô’s lemma', 'Geometric Brownian motion'] },
  { id: 'pricing', label: 'Pricing and risk', why: 'what derivatives are worth and what can go wrong', title: 'Quant', starters: ['Risk-neutral pricing', 'The Black-Scholes formula', 'The Greeks and delta hedging', 'Value at risk'] }
]

export const rungIndex = (id: MathsArea) => RUNGS.findIndex((r) => r.id === id)

/** RM_MATH's chapters onto the rungs (by the chapter heading a topic sits under), most specific first */
const CHAPTERS: [RegExp, MathsArea | 'split' | null][] = [
  [/stochastic/i, 'stochastic'],
  [/statistical inference|econometrics/i, 'statistics'],
  [/probability and statistics/i, 'split'],
  [/probability/i, 'probability'],
  [/numerical linear algebra|linear algebra/i, 'linear-algebra'],
  [/abstract algebra|topology|foundations|number theory|chaos|complexity|dynamical|physics|game theory|decision theory|complex numbers/i, null],
  [/calculus|derivatives|integrals|sequences and series|differential equations|real analysis/i, 'calculus'],
  [/functions|the infinite/i, 'functions'],
  [/numbers|logic|proof|geometry|algebra|trigonometr/i, 'algebra']
]

/** Words in a topic's own name that put it on a rung whatever chapter it sits in */
const OWN: [RegExp, MathsArea][] = [
  [/\b(black[- ]scholes|option pric\w*|pric(e|ing) (an? |the )?(european|asian|american|exotic|path-dependent)?\s*(call|put|option|derivative|bond)s?|risk[- ]neutral|greeks?|delta and gamma|delta[- ]hedg\w*|value at risk|expected shortfall|yield to maturity|martingale pricing|feynman[- ]kac|market price of risk|vasicek|cox[- ]ingersoll|short[- ]rate)\b/i, 'pricing']
]

const STATS_WORDS = /\b(statistic\w*|estimat\w*|regression|least squares|confidence|hypothesis|p-?values?|sampl\w*|inference|likelihood|bias|t-?tests?|chi|anova|correlation|bootstrap)\b/i

/** Which rung a concept is on; null for a maths topic off the ladder, or not maths at all */
export function rungOf(c: Pick<ConceptState, 'name' | 'area' | 'section'>): MathsArea | null {
  for (const [re, area] of OWN) if (re.test(c.name)) return area
  const section = c.section ?? ''
  // A quant or finance notebook is mostly finance: its chapters ("Derivatives", "The Three Financial
  // Statements") aren't maths chapters, and its name doesn't make "the accounting equation" algebra.
  // Its topics are on the ladder only when their own words are maths
  if (FINANCE_AREA.test(c.area) && !/math/i.test(c.area)) {
    const own = mathsMode(c.name)
    return own.on ? (own.area ?? mathsArea(c.name)) : null
  }
  if (section && isMathsArea(c.area)) {
    for (const [re, to] of CHAPTERS) {
      if (!re.test(section)) continue
      if (to === 'split') return STATS_WORDS.test(c.name) ? 'statistics' : 'probability'
      return to
    }
  }
  // A lesson on a maths topic anywhere, or a roadmap topic outside a chapter Tide knows
  const mode = mathsMode(c.name, c.area || undefined)
  return mode.on ? (mode.area ?? mathsArea(c.name)) : null
}

/** A notebook about finance, quant or money, though its name may say "quant" ("Quant and Finance") */
const FINANCE_AREA = /financ\w*|quant\w*|trading|banking|payments|accounting|econom\w*/i

/** A notebook that holds a maths roadmap */
export const isMathsArea = (area: string) => /(^|[\s/_-])(rm[_ -]?math\w*|maths?|mathematics|statistics|probability|quant\w*)($|[\s/_.-])/i.test(area)

// ---------- Mastery ----------

export const LEVELS = ['Not started', 'Started', 'Working', 'Steady', 'Strong', 'Mastered'] as const
export type LevelName = (typeof LEVELS)[number]
/** The level at which a rung counts as climbed */
export const CLIMBED = 4

export interface RungState {
  rung: Rung
  /** Its topics, roadmap order first, then lessons */
  topics: ConceptState[]
  solid: number
  fading: number
  learning: number
  /** Topics with any evidence */
  begun: number
  /** Mean FSRS estimate over its topics, 0 to 1 */
  score: number
  level: number
  /** The roadmap chapters it was filled from */
  chapters: string[]
  /** Next to study here: what's fading first, then what's half-learnt, then the first not started */
  next: ConceptState | null
  /** True when its topics are the starters (no roadmap topics on it) */
  starters: boolean
}

export function levelOf(topics: number, solid: number, begun: number, fading: number): number {
  if (!topics || !begun) return 0
  const share = solid / topics
  if (share >= 0.9 && fading === 0) return 5
  if (share >= 0.7) return 4
  if (share >= 0.4) return 3
  if (share >= 0.15 || solid >= 3) return 2
  return 1
}

/** A starter topic as a concept, so it can be shown and started like any other */
export const starterConcept = (name: string, rung: MathsArea, i: number): ConceptState => ({
  id: `ladder:${rung}:${i}`,
  name,
  area: '',
  origin: 'lesson',
  order: i,
  prerequisites: [],
  done: false,
  private: false,
  estimate: 0,
  level: 0,
  halfLife: 0,
  status: 'new',
  seen: 0,
  right: 0,
  partly: 0,
  wrong: 0
})

/** A roadmap item that is a task to do rather than an idea to learn */
const TASK = /^(implement|build|write|code|simulate|use|derive and implement|compute|backtest)\b/i

export interface Ladder {
  rungs: RungState[]
  /** The rung to work on: the lowest not yet strong (the last when all are) */
  here: number
  /** The title earned: the highest rung climbed with every rung below it */
  title: string | null
  /** Rungs climbed */
  climbed: number
}

export function ladder(concepts: ConceptState[]): Ladder {
  const by = new Map<MathsArea, ConceptState[]>(RUNGS.map((r) => [r.id, []]))
  for (const c of concepts) {
    if (c.parent) continue
    const r = rungOf(c)
    if (r) by.get(r)!.push(c)
  }
  const rungs = RUNGS.map((rung): RungState => {
    const own = by.get(rung.id)!
    const starters = own.length === 0
    const topics = starters ? rung.starters.map((s, i) => starterConcept(s, rung.id, i)) : own.sort((a, b) => Number(a.origin !== 'roadmap') - Number(b.origin !== 'roadmap') || a.order - b.order)
    const count = (s: string) => topics.filter((c) => c.status === s).length
    const solid = count('solid')
    const fading = count('fading')
    const learning = count('learning')
    const begun = topics.filter((c) => c.seen > 0).length
    const score = topics.length ? topics.reduce((s, c) => s + (c.estimate || 0), 0) / topics.length : 0
    // An idea before an application task ("Implement …"): the task is for once the idea is held
    const fresh = topics.filter((c) => c.status === 'new' && !c.done)
    const next = topics.find((c) => c.status === 'fading') ?? topics.find((c) => c.status === 'learning') ?? fresh.find((c) => !TASK.test(c.name)) ?? fresh[0] ?? null
    const chapters = [...new Set(own.filter((c) => c.origin === 'roadmap' && c.section).map((c) => c.section!))]
    return { rung, topics, solid, fading, learning, begun, score, level: levelOf(topics.length, solid, begun, fading), chapters, next, starters }
  })
  const firstOpen = rungs.findIndex((r) => r.level < CLIMBED)
  const here = firstOpen < 0 ? rungs.length - 1 : firstOpen
  const climbed = firstOpen < 0 ? rungs.length : firstOpen
  return { rungs, here, title: climbed ? RUNGS[climbed - 1].title : null, climbed }
}

/** What to celebrate since the levels last seen: a rung moving up to working or beyond, a new title */
export function levelUps(before: Record<string, number>, now: Ladder): { title: string; line: string }[] {
  const out: { title: string; line: string }[] = []
  for (const r of now.rungs) {
    const was = before[r.rung.id] ?? 0
    if (r.level > was && r.level >= 2) out.push({ title: `${r.rung.label.toUpperCase()} ${LEVELS[r.level].toUpperCase()}`, line: `${r.rung.label} is ${LEVELS[r.level].toLowerCase()}: ${r.solid} of ${r.topics.length} topics solid.` })
  }
  if (now.title && now.climbed > (before.title ?? 0)) out.push({ title: now.title.toUpperCase(), line: `You've climbed ${now.climbed} rung${now.climbed === 1 ? '' : 's'} of the ladder to quant.` })
  return out
}

/** The levels to remember, to compare against next time */
export const levelsOf = (l: Ladder): Record<string, number> => ({ ...Object.fromEntries(l.rungs.map((r) => [r.rung.id, r.level])), title: l.climbed })

// ---------- "Teach me maths from the ground up" ----------

const GROUND_UP = /\b(teach|learn|study|start|take)\b.{0,40}\b(maths?|mathematics)\b.{0,40}\b(from (the )?(ground up|scratch|zero|the (very )?(beginning|basics|start))|ground[- ]up|properly|step by step)\b|\b(maths?|mathematics) from (the )?(ground up|scratch|zero)\b|\bmaths? (ladder|to quant)\b/i

/** Whether a message asks to be taken through maths from the bottom of the ladder */
export const groundUpIntent = (text: string) => GROUND_UP.test(text.trim())

/** The topic a ground-up lesson starts on: the next one on the lowest rung not yet strong */
export function groundUpNext(l: Ladder): { rung: RungState; topic: ConceptState } | null {
  for (let i = l.here; i < l.rungs.length; i++) {
    const r = l.rungs[i]
    if (r.next) return { rung: r, topic: r.next }
  }
  return null
}
