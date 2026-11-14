/**
 * Maths mode: how a lesson on maths, statistics, probability or quant finance is taught. Decided
 * in code from the lesson's topic, else the roadmap or notebook it sits in (RM_MATH, a "Maths"
 * notebook), so it is the same with Claude, Gemma or no model at all.
 *
 * What it changes (each engine gets its own wording: Claude can take the long version and call
 * Tide's tools; Gemma gets short numbered rules and exact templates it follows reliably):
 * - first principles: why before how, derived rather than stated, tied to what they know
 * - predict, then reveal: a guess or an estimate before anything is shown
 * - small steps alternating thinking and doing; worked example → faded example → solo problem
 * - Socratic questions that make them reason; never "does that make sense?"
 * - concrete → visual → symbolic, with a real quant or finance hook when it is natural
 * - explorables (```sim blocks of kind explore) as part of the teaching, not decoration
 * - poke-holes challenges (```challenge blocks): counterexamples, the wrong step, always/sometimes/never
 * Pure, so the lesson screen, main and the tests agree.
 */
import { subjectMatches } from './subjects'
import { GRAPH_GUIDE } from './graphSpec'
import { animationGuide } from './manim'

export type MathsArea = 'algebra' | 'functions' | 'calculus' | 'linear-algebra' | 'probability' | 'statistics' | 'stochastic' | 'pricing'

export interface MathsMode {
  on: boolean
  /** The rung of the maths ladder the topic sits on, when it can be told */
  area: MathsArea | null
  from: 'topic' | 'notebook' | null
}

const OFF: MathsMode = { on: false, area: null, from: null }

/** The subjects in the subject map that are taught in maths mode */
const MATHS_SUBJECTS = new Set(['mathematics', 'linear algebra', 'probability and statistics', 'insurance and risk', 'information theory'])

/** Areas, most specific first: "geometric Brownian motion" is stochastic before it is anything else */
const AREAS: [MathsArea, RegExp][] = [
  ['pricing', /\b(black[- ]scholes|option pricing|pricing (an? )?(options?|derivatives?|bonds?)|risk[- ]neutral|greeks|delta[- ]hedg\w*|value at risk|\bvar\b(?! of)|expected shortfall|yield to maturity|duration and convexity|binomial (option|tree) (model|pricing)|martingale pricing|feynman[- ]kac|implied volatility|put[- ]call parity)\b/i],
  ['stochastic', /\b(stochastic|random walks?|brownian|wiener|geometric brownian|gbm|it[oô]\W?s? (lemma|integral|calculus)|martingales?|markov chains?|poisson process(es)?|ornstein|sdes?)\b/i],
  ['statistics', /\b(statistic\w*|regression|least squares|residuals?|confidence intervals?|hypothesis test\w*|p-?values?|estimators?|maximum likelihood|mle|sampling distributions?|standard errors?|t-?tests?|chi-?squared?|anova|econometrics?|correlation|bootstrap\w*)\b/i],
  ['probability', /\b(probabilit\w*|random variables?|distributions?|expected values?|expectation|variance|binomial|poisson|normal distribution|gaussian|exponential distribution|lognormal|central limit|law of large numbers|bayes\w*|conditional probability|combinatoric\w*|permutations?|combinations|independence|covariance|moment generating)\b/i],
  ['linear-algebra', /\b(linear algebra|matri(x|ces)|vectors?|eigen\w*|determinants?|linear (maps?|transformations?|systems?|independence)|span|basis|rank|null ?space|svd|singular values?|orthogonal\w*|projections?|dot products?|inner products?)\b/i],
  ['calculus', /\b(calculus|derivatives?|differentiat\w*|(power|product|quotient|sum|constant) rules?|integra(ls?|tion)|riemann|limits?|continuity|chain rule|product rule|quotient rule|taylor|series|sequences|l'h[oô]pital|optimi[sz]ation|maxima|minima|differential equations?|odes?|pdes?|gradient|partial derivatives?|tangent lines?|instantaneous)\b/i],
  ['functions', /\b(functions?|domain and range|inverse functions?|composition|exponentials?|logarithms?|polynomials?|quadratics?|trigonometr\w*|sine|cosine|graphs? of|transformations of graphs|asymptotes?|the infinite|infinity)\b/i],
  ['algebra', /\b(arithmetic|algebra|equations?|inequalit(y|ies)|fractions?|ratios?|percentages?|exponents?|indices|powers|surds|factori[sz]\w*|numbers?|primes?|divisibility|proofs?|induction|logic|sets?)\b/i]
]

/** A notebook or roadmap that is about maths, by its name (RM_MATH, "Maths", "Statistics", "Quant") */
const MATHS_NOTEBOOK = /(^|[\s/_-])(rm[_ -]?math\w*|maths?|mathematics|statistics|probability|quant\w*|calculus|linear algebra|stochastic\w*)(\.md)?($|[\s/_.-])/i

/** Words that mark a topic as something else even inside a maths notebook (a programming exercise) */
const NOT_MATHS = /\b(python|javascript|typescript|rust|golang|java|c\+\+|sql|pandas|numpy|react|docker|git)\b/i

/** The basics of number, from their origins */
const FOUNDATIONS = /\b((invention|history|origins?|idea|concept|story) of (the )?(zero|numbers?|numerals|counting|place value)|zero as a (number|digit|placeholder)|place[- ]value|number systems?|numeral systems?|hindu[- ]arabic|roman numerals|babylonian (numbers|numerals|maths|mathematics)|positional (notation|numbers?|systems?)|tally marks?)\b/i

/** Areas whose words are specific enough to decide on their own */
const STRONG = new Set<MathsArea>(['calculus', 'linear-algebra', 'probability', 'statistics'])

/** Which rung a text is about */
export function mathsArea(text: string): MathsArea | null {
  for (const [area, re] of AREAS) if (re.test(text)) return area
  return null
}

/** Whether a lesson on `topic` (in `notebook`, a folder path or roadmap path) is taught in maths mode */
export function mathsMode(topic: string, notebook?: string): MathsMode {
  const t = topic.trim()
  if (!t) return OFF
  const found = subjectMatches(t)
  const top = found[0]?.entry.name
  // Code about maths ("vectors in Rust", "matrix multiplication in C") is taught as code
  const code = NOT_MATHS.test(t) || found.some((f) => f.entry.kinds[0] === 'build')
  const area = mathsArea(t)
  // Its own words name a maths subject first
  if (top && MATHS_SUBJECTS.has(top) && !code) return { on: true, area, from: 'topic' }
  // Quant finance words the subject map files under finance are maths here; so is a calculus,
  // probability or statistics topic nothing else claims ("The power rule")
  if (!code && (area === 'pricing' || area === 'stochastic' || (!top && area && STRONG.has(area)))) return { on: true, area, from: 'topic' }
  // The foundations of number: where zero and place value came from is maths, taught from its origins
  if (!code && FOUNDATIONS.test(t)) return { on: true, area: area ?? 'algebra', from: 'topic' }
  if (notebook && MATHS_NOTEBOOK.test(notebook) && !code && (!top || MATHS_SUBJECTS.has(top) || area)) return { on: true, area, from: 'notebook' }
  return OFF
}

/** Number representation: arithmetic in other bases, which a computing lesson is full of */
const NUMBER_REPRESENTATION = /\b(binary|hexadecimal|hex|octal|(number|numeric) (bases?|representations?)|bases? (2|8|16|conversion)|base[- ](2|8|10|16|n)|radix|two'?s[- ]complement|ones'?[- ]complement|signed (and unsigned )?(integers?|numbers?)|bit(wise)?[- ]?(shifts?|operations?|arithmetic|masks?)|bits? and bytes?|floating[- ]point|ieee ?754|integer overflow)\b/i

/**
 * A lesson that isn't taught in maths mode but is full of arithmetic: binary, hex, two's
 * complement, bit masks. Its answer box opens with the maths keys (₂, ₁₆, superscripts, a
 * calculator) the first time; the lesson is still taught as the computing topic it is, so maths
 * mode's teaching (derivations, explorables, Manim) stays with maths.
 */
export function mathsAdjacent(topic: string, notebook?: string): boolean {
  return NUMBER_REPRESENTATION.test(topic) && !mathsMode(topic, notebook).on
}

// ---------- Explorables, by area ----------

/** Every explorable scene (renderer/lib/sims/explore draws them) */
export const SCENES = ['secant', 'riemann', 'limit', 'matrix', 'eigen', 'distribution', 'clt', 'lln', 'bayes', 'random-walk', 'brownian', 'gbm', 'regression', 'confidence'] as const
export type Scene = (typeof SCENES)[number]

export const SCENE_LABEL: Record<Scene, string> = {
  secant: 'Secant to tangent',
  riemann: 'Riemann sums',
  limit: 'A limit, from both sides',
  matrix: 'A matrix moves the plane',
  eigen: 'Eigenvectors',
  distribution: 'A distribution',
  clt: 'Central limit theorem',
  lln: 'Law of large numbers',
  bayes: 'Bayes on a population',
  'random-walk': 'Random walk',
  brownian: 'Brownian motion',
  gbm: 'Geometric Brownian motion',
  regression: 'Least squares',
  confidence: 'Confidence intervals'
}

/** A formula in x the explorables can draw, as far as can be told without parsing it: x, numbers, operators and the known functions */
export function formulaLooksOk(f: string): boolean {
  const rest = f.replace(/\*\*/g, '^').replace(/\b(sin|cos|tan|exp|ln|log|log10|log2|sqrt|abs|asin|acos|atan|sinh|cosh|tanh|pi|e|x)\b/g, '')
  return f.length <= 80 && /^[\d\s.+\-*/^()]*$/.test(rest) && f.split('(').length === f.split(')').length
}

/** The explorable scenes that fit each area */
export const AREA_SCENES: Record<MathsArea, string[]> = {
  algebra: ['secant'],
  functions: ['limit', 'secant'],
  calculus: ['secant', 'riemann', 'limit'],
  'linear-algebra': ['matrix', 'eigen'],
  probability: ['distribution', 'clt', 'lln', 'bayes'],
  statistics: ['regression', 'confidence', 'clt', 'distribution'],
  stochastic: ['random-walk', 'brownian', 'gbm'],
  pricing: ['gbm', 'distribution', 'brownian']
}

/** Every scene with what it shows and its settings, for the tutor */
const SCENE_GUIDE: Record<string, string> = {
  secant: 'secant: the derivative as the limit of secants. f, x0, h. They drag the second point or halve h; a table shows the slopes as h halves. Hidden by "predict": the tangent\'s slope.',
  riemann: 'riemann: rectangles to the integral. f, a, b, n (1 to 200), rule left|right|mid|trapezoid. They change n and drag the ends. Hidden by "predict": the exact area and the error.',
  limit: 'limit: both sides of x0 closing in (a hole where f is undefined). f, x0.',
  matrix: 'matrix: a 2×2 matrix moving the plane. matrix [[a,b],[c,d]], vector [x,y]. They drag î and ĵ; the shaded square\'s area is the determinant.',
  eigen: 'eigen: they drag v until Av stays on v\'s line. matrix. Hidden by "predict": the eigenvector lines.',
  distribution: 'distribution: dist normal|binomial|poisson|exponential|lognormal|uniform, params {mu, sigma, n, p, lambda, a, b}, range [lo, hi]. Sliders for the parameters; they drag the interval and read its probability.',
  clt: 'clt: sample means piling up into a histogram. dist (any of the above, exponential by default), params, size (n). Hidden by "predict": the normal curve N(μ, σ²/n).',
  lln: 'lln: the running average of draws settling on the mean. dist, params. Hidden by "predict": the true mean.',
  bayes: 'bayes: 1,000 people as dots. prevalence, sensitivity, falsePositive. Hidden by "predict": P(has it | positive).',
  'random-walk': 'random-walk: walkers stepping ±1 with a ±2σ envelope. p, paths, steps.',
  brownian: 'brownian: Brownian paths with the ±2√t envelope and quadratic variation. paths, steps, T.',
  gbm: 'gbm: stock prices under geometric Brownian motion. s0, mu, sigma, T, paths. Hidden by "predict": the mean S₀e^{μt} and the median S₀e^{(μ−σ²/2)t}.',
  regression: 'regression: they fit a line by eye with two handles, residuals drawn, then reveal least squares. points [[x,y],…] in −6..6, −5..5.',
  confidence: 'confidence: one interval per sample against the true mean. params {mu, sigma}, size, level 0.8|0.9|0.95|0.99. Hidden by "predict": the share that contain it.'
}

/** What a maths lesson is told about explorables: the scenes that fit its area first */
export function exploreGuide(area: MathsArea | null, onlyFitting = false, /** The scenes that don't fit by name only (Claude: place_explorable fills in their settings) */ restByName = false): string {
  const first = area ? AREA_SCENES[area] : []
  // A small model reads only the scenes that fit (all of them when the area is unknown)
  const order = (onlyFitting || restByName) && first.length ? first : [...new Set([...first, ...Object.keys(SCENE_GUIDE)])]
  const rest = restByName && first.length ? Object.keys(SCENE_GUIDE).filter((s) => !first.includes(s)) : []
  return `Explorables: a fenced block whose language is sim, holding one JSON object of kind explore, e.g. {"kind":"explore","scene":"secant","f":"x^2","x0":1,"h":1,"question":"Drag h toward 0. What happens to the secant's slope?","predict":"What number will the slope settle at?"}. "question" sits above it; "predict" asks for a guess and hides the answer until they lock one in. f uses x only (+ - * / ^, sin cos tan exp ln sqrt abs, pi, e). Optional "title", and a "tour" like other simulations (parts: curve, secant, tangent, h, table, rectangles, sum, error, grid, basis, vector, image, eigen, density, mean, interval, histogram, theory, running-mean, truth, posterior, paths, envelope, median, line, residuals, yours, intervals, coverage; do: {"set":{"h":0.1}}, {"reveal":true}). The scenes${first.length ? ' (the ones that fit this topic first)' : ''}:\n${order.map((s) => `  - ${SCENE_GUIDE[s]}`).join('\n')}\nWhat they do in it comes back to you with their next message, as a note from Tide with the values they left it at; their "Tell the tutor" puts the same in their answer.${rest.length ? `\n  Other scenes (place_explorable fills in their settings): ${rest.join(', ')}.` : ''}`
}

// ---------- Poke holes ----------

export const POKE_GUIDE = `Poke-holes challenges: a fenced block whose language is challenge, holding one JSON object. Three types:
  - Counterexample: {"type":"counterexample","claim":"For every real x, x² ≥ x.","vars":{"x":"real"},"lhs":"x^2","rel":">=","rhs":"x"}. The claim is lhs rel rhs for all values of the vars; rel is = != < <= > >= or "prime" or "integer" (lhs is prime, lhs is a whole number; rhs unused). vars are "real", "integer", "natural" or "positive". Tide checks their counterexample itself by evaluating both sides; use expressions in the vars with + - * / ^, sin cos exp ln sqrt abs.
  - The wrong step: {"type":"wrong-step","title":"The derivative of x² from first principles","steps":["(x+h)² − x² = 2xh + h²","Divide by h: 2x + h","Let h → 0: 2x + h → 2x + h","So the derivative is 2x"],"wrong":3,"why":"h vanishes in the limit: 2x + h → 2x"}. One step is wrong (counted from 1); they click it.
  - Always, sometimes or never: {"type":"asn","statement":"If f'(a) = 0, f has a maximum or minimum at a.","answer":"sometimes","why":"x³ at 0 is a counterexample; x² at 0 is an example"}.
  Each block is checked by Tide as they answer; their justification then comes to you as their answer: put an <ask type="explain"> after it asking them to justify, and mark the reasoning, not just the pick.`

// ---------- The rules ----------

/**
 * Where ideas came from: maths taught as the story of problems people had to solve, so it sticks.
 * Shared by both engines (short, and the same words), placed before the formalism rules.
 */
export const ORIGINS_RULES = `Maths is the deepest subject here: teach each idea through where it came from.
- Origin first: for each new idea, the problem that forced it and who met it, then the reasoning, and only then the formalism. Ask the learner to reason their way there; don't narrate history as trivia.
- Foundations especially: e.g. zero. Ask why people needed it; what counting without it looked like (tally marks, Babylonian place value with a gap, the Indian śūnya, Brahmagupta's rules, the route to Europe via al-Khwārizmī and Fibonacci); let them work out why place value needs a zero.
- Keep the arc visible: say where each idea is used later (place value → binary → floating point → ML numerics; limits → derivatives → gradients → Greeks).`

/**
 * The origins rules for a topic: the worked example of zero only where it is the kind of idea being
 * taught (number and arithmetic foundations); elsewhere (eigenvectors, option pricing) it is a
 * hundred words about something else.
 */
export function originsRules(topic: string, area?: MathsArea | null): string {
  if (area === 'algebra' || /\b(zero|numbers?|number systems?|counting|place value|arithmetic|numerals?|foundations?)\b/i.test(topic)) return ORIGINS_RULES
  return ORIGINS_RULES.split('\n').filter((l) => !l.startsWith('- Foundations especially')).join('\n')
}

const CLAUDE_RULES = `MATHS MODE. This lesson is maths, statistics, probability or quant: they master it from the ground up, never by being handed formulas. Your core rules (first principles, Socratic questions, predict then reveal, worked → faded → solo for every new technique, the last one through set_exercise) carry the most weight here. On top of them:
- Why before how: build on the warm-up's concepts and their earlier lessons by name, and ask "why must this be true?" before you show that it is. A formula appears only after they have seen why it has to look that way.
- Small steps, alternating thinking and doing: never two explanations in a row without them doing something (a prediction, a calculation, a drag in an explorable, a "why").
- Concrete → visual → symbolic: numbers or a situation they can picture, then a picture, then the symbols. When it's natural, close on a real quant or finance hook (a price, a risk, a trading decision, an ML model) in a sentence or two.
- Draw the maths: a graph (below) when a shape, region, tangent, distribution or transformation says it faster than words; explorables for what moves. An explorable is teaching, not decoration: place one where moving something is how the idea is understood, with a precise question and usually a "predict", then ask about what they saw. Look in explorable_library first; check one with place_explorable when unsure of its settings. When no scene fits exactly, make a \`\`\`visual explorable for exactly this idea with TideMath (plane, draggable points, sliders, TideMath.predict, TideMath.goal, KaTeX, three.js), reporting with visual.report (a Taylor series adding terms, a Markov chain stepping, this model's loss surface).
- Poke holes at least once a lesson (a counterexample, a derivation with one wrong step, or always/sometimes/never): prove it with set_challenge and paste the \`\`\`challenge block it returns, never as plain text, then have them justify their pick.
- Check every number and step with SymPy before you call it right or wrong; name the exact step that fails.
- When Tide notes that their attention is drifting, switch format at once as it says: start your reply with "Let's try this a different way." and do that thing.`

const GEMMA_RULES = `MATHS MODE. This lesson is maths, statistics, probability or quant. Follow these rules exactly:
1. Why before how. Never state a formula first. Ask why it must be true, then derive it in small steps from things they know.
2. Predict first. Before showing any result, ask: "Predict first: what do you think …?" Then show it and ask them to compare.
3. One idea per message. Every message ends with something for them to do: predict, calculate, drag the explorable, or explain why.
4. New technique: (a) you work one example fully, saying why each step; (b) a near-identical one with the last step left for them; (c) one on their own.
5. Ask questions that make them reason ("Why can't h be 0?", "What if n doubles?"). Never ask "does that make sense?".
6. Numbers first, then a picture, then symbols. One sentence on where it is used in finance or data, when it fits.
7. Draw a graph (a plot tag or a graph block) whenever a picture says it faster. Use an explorable (a sim block of kind explore) when moving something shows the idea, with a "question" and a "predict".
8. Once a lesson, a poke-holes challenge (a challenge block), then an explain ask for their reasons.
9. If a note from Tide says their attention is drifting, start your reply with "Let's try this a different way." and do what it says.`

/** What a maths lesson's first turn adds: the rules for this engine, the explorables and poke-holes formats */
export function mathsRules(engine: 'claude' | 'gemma', topic: string, notebook?: string): string {
  const mode = mathsMode(topic, notebook)
  if (!mode.on) return ''
  const area = mode.area ? ` It sits on the ${AREA_LABEL[mode.area]} rung of their maths ladder.` : ''
  return `${engine === 'claude' ? CLAUDE_RULES : GEMMA_RULES}${area}\n\n${originsRules(topic, mode.area)}\n\n${GRAPH_GUIDE}${engine === 'claude' ? ' Check one with check_graph when unsure.' : ''}\n\n${exploreGuide(mode.area, engine === 'gemma', engine === 'claude')}\n\n${[animationGuide(engine, topic), POKE_GUIDE].filter(Boolean).join('\n\n')}`
}

export const AREA_LABEL: Record<MathsArea, string> = {
  algebra: 'arithmetic and algebra',
  functions: 'functions',
  calculus: 'calculus',
  'linear-algebra': 'linear algebra',
  probability: 'probability',
  statistics: 'statistics',
  stochastic: 'stochastic processes',
  pricing: 'pricing and risk'
}
