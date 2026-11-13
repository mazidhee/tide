import { describe, expect, it, vi } from 'vitest'
import { mathsArea, mathsMode, mathsRules, exploreGuide, AREA_SCENES, SCENES, formulaLooksOk } from '../src/shared/mathsMode'
import { driftCheck, driftNote, switchIn, DRIFT, type DriftInput } from '../src/shared/mathsDrift'
import { answerStart, checkCounterexample, challengeBlock, holdsProgram, parseChallenge, proveChallenge, relHolds, type Counterexample } from '../src/shared/pokeHoles'
import { groundUpIntent, groundUpNext, ladder, levelsOf, levelUps, rungOf, RUNGS, LEVELS } from '../src/shared/mathsLadder'
import { evaluateExpr } from '../src/renderer/src/lib/maths/challenge'
import type { AnswerSignal } from '../src/shared/breakPlanner'
import type { ConceptState } from '../src/shared/knowledge'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ ai: { claude: {} } }) }))

describe('maths mode: detection', () => {
  it('is on for maths, statistics, probability and quant topics, and says which rung', () => {
    expect(mathsMode('Derivatives from first principles')).toMatchObject({ on: true, area: 'calculus', from: 'topic' })
    expect(mathsMode('Eigenvalues and eigenvectors')).toMatchObject({ on: true, area: 'linear-algebra' })
    expect(mathsMode('Bayes’ theorem and conditional probability')).toMatchObject({ on: true, area: 'probability' })
    expect(mathsMode('Confidence intervals for a mean')).toMatchObject({ on: true, area: 'statistics' })
    expect(mathsMode('Geometric Brownian motion')).toMatchObject({ on: true, area: 'stochastic' })
    expect(mathsMode('Deriving the Black-Scholes PDE')).toMatchObject({ on: true, area: 'pricing' })
  })

  it('reads the notebook or roadmap when the topic alone doesn’t say, and stays off elsewhere', () => {
    expect(mathsMode('The power rule').on).toBe(true)
    expect(mathsMode('Prime numbers', 'Roadmaps/RM_MATH.md')).toMatchObject({ on: true, from: 'notebook' })
    expect(mathsMode('Euclid’s Elements and the five postulates', 'Maths')).toMatchObject({ on: true, from: 'notebook' })
    // Not maths, even inside a maths notebook when it names code
    expect(mathsMode('Python list comprehensions', 'Maths').on).toBe(false)
    for (const t of ['Consistent hashing', 'Raft leader election', 'The French Revolution', 'Payment rails and ISO 20022']) expect(mathsMode(t).on, t).toBe(false)
    expect(mathsArea('Random walks and martingales')).toBe('stochastic')
  })

  it('Claude and Gemma each get their own rules, with explorables and poke-holes', () => {
    const claude = mathsRules('claude', 'Derivatives from first principles')
    const gemma = mathsRules('gemma', 'Derivatives from first principles')
    for (const r of [claude, gemma]) {
      expect(r).toMatch(/MATHS MODE/)
      expect(r).toMatch(/Predict first|Predict, then reveal/)
      expect(r).toMatch(/does that make sense/)
      expect(r).toMatch(/"kind":"explore"/)
      expect(r).toMatch(/```challenge|language is challenge/)
      expect(r).toMatch(/Let's try this a different way/)
      expect(r).toMatch(/calculus rung/)
    }
    expect(claude).toMatch(/set_challenge/)
    expect(claude).toMatch(/place_explorable/)
    expect(claude).toMatch(/Worked example → faded example → solo problem/)
    expect(gemma).not.toMatch(/set_challenge|place_explorable/)
    // Gemma reads the scenes that fit, numbered rules, and less
    expect(gemma).toMatch(/^MATHS MODE[^\n]*\n1\. /)
    expect(gemma.length).toBeLessThan(claude.length)
    expect(exploreGuide('calculus', true)).not.toMatch(/- gbm:/)
    expect(exploreGuide('calculus')).toMatch(/- gbm:/)
    expect(mathsRules('claude', 'Consistent hashing')).toBe('')
  })

  it('every scene the guide offers is one the app draws, and every example in it parses', async () => {
    const { parseSim } = await import('../src/renderer/src/lib/sims/spec')
    const guide = exploreGuide(null)
    for (const s of SCENES) expect(guide).toContain(`- ${s}:`)
    for (const area of Object.keys(AREA_SCENES) as (keyof typeof AREA_SCENES)[]) for (const s of AREA_SCENES[area]) expect(SCENES).toContain(s)
    const example = /\{"kind":"explore"[^\n]*?\}(?=[.,\s])/.exec(guide)![0]
    expect(parseSim(example)?.kind).toBe('explore')
    expect(formulaLooksOk('sin(x)/x')).toBe(true)
    expect(formulaLooksOk('x**2 + 3*x')).toBe(true)
    expect(formulaLooksOk('require("fs")')).toBe(false)
  })

  it('a maths lesson is taught on Claude’s stronger model throughout; side threads stay on the teaching one', async () => {
    const { turnRole } = await import('../src/main/claudeEngine')
    const req = { session: true, messages: [{ role: 'user', content: 'Answer: 2x' }, { role: 'assistant', content: 'ok <ask type="short">next</ask>' }, { role: 'user', content: 'Answer: 3' }], instructions: 'x' } as never
    expect(turnRole(req, 'Answer: 3', null, true)).toBe('hard')
    expect(turnRole(req, 'Answer: 3', null, false)).toBe('teach')
    expect(turnRole({ ...(req as object), thread: true } as never, 'why?', null, true)).toBe('teach')
  })
})

describe('drift: switching format before they zone out', () => {
  const MIN = 60_000
  const t0 = 1_000_000_000
  const a = (min: number, o: Partial<AnswerSignal> = {}): AnswerSignal => ({ at: t0 + min * MIN, words: 14, latencyMs: 20_000, ...o })
  const base = (o: Partial<DriftInput> = {}): DriftInput => ({ now: t0 + 20 * MIN, answers: [a(1), a(3), a(5), a(7)], tutorAt: t0 + 19.5 * MIN, switches: 0, turn: 6, canExplore: true, ...o })

  it('carries on while answers look like their own', () => {
    expect(driftCheck(base())).toBeNull()
  })

  it('"I don\'t know" twice in three: an explorable, to see it', () => {
    const d = driftCheck(base({ answers: [a(1), a(3), a(5, { dontKnow: true, words: 3 }), a(7, { dontKnow: true, words: 2 })] }))
    expect(d).toMatchObject({ format: 'explorable' })
    expect(d!.why).toContain('stuck')
    // No explorable fits: a real example instead
    expect(driftCheck(base({ canExplore: false, answers: [a(1), a(5, { skip: true }), a(7, { dontKnow: true })] }))?.format).toBe('real-world')
  })

  it('a long quiet spell since the tutor spoke: a quick puzzle; an absence is left to the break planner', () => {
    expect(driftCheck(base({ tutorAt: t0 + 14 * MIN }))).toMatchObject({ why: ['quiet'], format: 'puzzle' })
    expect(driftCheck(base({ tutorAt: t0 + 20 * MIN - (DRIFT.awayMin + 1) * MIN }))).toBeNull()
  })

  it('shorter and slower answers together: a poke-holes challenge; one alone is not enough', () => {
    const shrinking = [a(1, { words: 20 }), a(3, { words: 18 }), a(5, { words: 16 }), a(9, { words: 5, latencyMs: 90_000 }), a(12, { words: 4, latencyMs: 100_000 }), a(15, { words: 3, latencyMs: 95_000 })]
    expect(driftCheck(base({ answers: shrinking }))).toMatchObject({ format: 'poke-holes' })
    const onlyShorter = shrinking.map((x) => ({ ...x, latencyMs: 20_000 }))
    expect(driftCheck(base({ answers: onlyShorter }))).toBeNull()
  })

  it('never twice in a few minutes or turns, never the same format twice running, at most three a lesson', () => {
    const stuck = [a(1), a(3), a(5, { dontKnow: true }), a(7, { dontKnow: true })]
    expect(driftCheck(base({ answers: stuck, lastSwitch: { at: t0 + 17 * MIN, turn: 5, format: 'puzzle' } }))).toBeNull()
    expect(driftCheck(base({ answers: stuck, lastSwitch: { at: t0 + 2 * MIN, turn: 1, format: 'explorable' } }))?.format).not.toBe('explorable')
    expect(driftCheck(base({ answers: stuck, switches: 3 }))).toBeNull()
  })

  it('the note tells the tutor what to do and how to say it, and the lesson can find it again', () => {
    const note = driftNote({ why: ['stuck'], format: 'explorable' }, ['secant', 'riemann'])
    expect(note).toMatch(/^\(Tide: switch format: explorable\./)
    expect(note).toMatch(/"Let's try this a different way\."/)
    expect(note).toMatch(/secant or riemann/)
    expect(note).toMatch(/don't mention attention/)
    expect(switchIn(`Answer: no idea\n\n${note}`)).toBe('explorable')
    expect(switchIn(`x\n\n${driftNote({ why: ['quiet'], format: 'real-world' })}`)).toBe('real-world')
    expect(switchIn('Answer: 4')).toBeNull()
  })
})

describe('poke holes', () => {
  const claim = parseChallenge('{"type":"counterexample","claim":"For every real x, x² ≥ x.","vars":{"x":"real"},"lhs":"x^2","rel":">=","rhs":"x"}') as Counterexample

  it('reads the three kinds and refuses what isn’t one', () => {
    expect(claim).toMatchObject({ type: 'counterexample', rel: '>=', vars: { x: 'real' } })
    expect(parseChallenge('{"type":"wrong-step","title":"t","steps":["a","b","c"],"wrong":2}')).toMatchObject({ type: 'wrong-step', wrong: 2 })
    expect(parseChallenge('{"type":"asn","statement":"s","answer":"Sometimes"}')).toMatchObject({ answer: 'sometimes' })
    expect(parseChallenge('{"type":"wrong-step","steps":["a","b"],"wrong":5}')).toBeNull()
    expect(parseChallenge('{"type":"counterexample","lhs":"x"}')).toBeNull()
    expect(parseChallenge('{"type":"counter')).toBeNull()
    expect(parseChallenge('{"type":"counterexample","vars":{"n":"natural"},"lhs":"n^2+n+41","rel":"is prime"}')).toMatchObject({ rel: 'prime' })
  })

  it('checks a counterexample by evaluating both sides at their values', () => {
    expect(checkCounterexample(claim, { x: '1/2' }, evaluateExpr)).toMatchObject({ ok: true })
    expect(checkCounterexample(claim, { x: '3' }, evaluateExpr)).toMatchObject({ ok: false, reason: 'holds' })
    expect(checkCounterexample(claim, { x: 'banana' }, evaluateExpr)).toMatchObject({ ok: false, reason: 'unreadable' })
    const euler = parseChallenge('{"type":"counterexample","claim":"n² + n + 41 is prime for every natural n","vars":{"n":"natural"},"lhs":"n^2+n+41","rel":"prime"}') as Counterexample
    expect(checkCounterexample(euler, { n: '39' }, evaluateExpr)).toMatchObject({ ok: false, reason: 'holds' })
    expect(checkCounterexample(euler, { n: '40' }, evaluateExpr)).toMatchObject({ ok: true })
    expect(checkCounterexample(euler, { n: '2.5' }, evaluateExpr)).toMatchObject({ ok: false, reason: 'domain' })
    const sqrt = parseChallenge('{"type":"counterexample","claim":"sqrt(x^2) = x for every real x","vars":{"x":"real"},"lhs":"sqrt(x^2)","rel":"=","rhs":"x"}') as Counterexample
    expect(checkCounterexample(sqrt, { x: '-2' }, evaluateExpr)).toMatchObject({ ok: true })
    expect(checkCounterexample(sqrt, { x: 'sqrt(2)' }, evaluateExpr)).toMatchObject({ ok: false, reason: 'holds' })
    const two = parseChallenge('{"type":"counterexample","claim":"(a+b)^2 = a^2 + b^2","vars":{"a":"real","b":"real"},"lhs":"(a+b)^2","rel":"=","rhs":"a^2+b^2"}') as Counterexample
    expect(checkCounterexample(two, { a: '1', b: '0' }, evaluateExpr)).toMatchObject({ ok: false, reason: 'holds' })
    expect(checkCounterexample(two, { a: '1', b: '1' }, evaluateExpr)).toMatchObject({ ok: true })
    // An undefined side doesn't test anything
    const recip = parseChallenge('{"type":"counterexample","vars":{"x":"real"},"lhs":"1/x","rel":">","rhs":"0"}') as Counterexample
    expect(checkCounterexample(recip, { x: '0' }, evaluateExpr)).toMatchObject({ ok: false, reason: 'undefined' })
    expect(relHolds('=', 0.1 + 0.2, 0.3)).toBe(true)
  })

  it('what goes to the tutor starts their answer and leaves the reasons to them', () => {
    expect(answerStart(claim, { values: { x: '1/2' } }, 'checked')).toMatch(/^Counterexample: x = 1\/2 \(checked\)\. Why it breaks the claim: $/)
    expect(challengeBlock(claim)).toMatch(/^```challenge\n\{"type":"counterexample"/)
  })

  it('Claude’s challenges are proven before they’re set: the witness must break the claim, a check must agree', async () => {
    const runs: string[] = []
    const io = (out: string[]) => ({ run: async (_l: string, code: string) => (runs.push(code), { stdout: `${out.shift() ?? ''}\n`, stderr: '', exitCode: 0 }) })
    expect(await proveChallenge(claim, { witness: { x: '1/2' } }, io(['FAILS']))).toMatchObject({ ok: true, checked: true })
    expect(runs[0]).toContain("Symbol(\"x\")")
    expect(runs[0]).toContain('Ge(L, R)')
    expect(await proveChallenge(claim, { witness: { x: '2' } }, io(['HOLDS']))).toMatchObject({ ok: false })
    expect(await proveChallenge(claim, {}, io([]))).toMatchObject({ ok: false })
    expect(await proveChallenge(claim, { witness: { x: '1/2' }, example: { x: '2' } }, io(['FAILS', 'FAILS']))).toMatchObject({ ok: false })
    const step = parseChallenge('{"type":"wrong-step","title":"t","steps":["a","b","c"],"wrong":3}')!
    expect(await proveChallenge(step, { check: 'print(3)' }, io(['3']))).toMatchObject({ ok: true, checked: true })
    expect(await proveChallenge(step, { check: 'print(2)' }, io(['2']))).toMatchObject({ ok: false })
    expect(await proveChallenge(step, {}, io([]))).toMatchObject({ ok: true, checked: false })
    const noSympy = { run: async () => ({ stdout: '', stderr: "ModuleNotFoundError: No module named 'sympy'", exitCode: 1 }) }
    expect(await proveChallenge(claim, { witness: { x: '1/2' } }, noSympy)).toMatchObject({ ok: false, fatal: true })
    expect(holdsProgram(parseChallenge('{"type":"counterexample","vars":{"n":"natural"},"lhs":"n^2+n+41","rel":"prime"}') as Counterexample, { n: '40' })).toContain('isprime(L)')
  })
})

describe('the maths ladder', () => {
  let order = 0
  const c = (name: string, section: string, o: Partial<ConceptState> = {}): ConceptState => ({ id: `${section}::${name}`, name, area: 'Maths', section, origin: 'roadmap', order: order++, prerequisites: [], done: false, private: false, estimate: 0, level: 0, halfLife: 0, status: 'new', seen: 0, right: 0, partly: 0, wrong: 0, ...o })
  const solid = { status: 'solid' as const, estimate: 0.95, seen: 3, right: 3 }

  it('maps RM_MATH chapters onto the rungs, and a topic’s own words win', () => {
    expect(rungOf(c('The invention of zero', 'Chapter 1: Numbers'))).toBe('algebra')
    expect(rungOf(c('Inverse functions', 'Chapter 6: Functions'))).toBe('functions')
    expect(rungOf(c('The power rule', 'Chapter 8: Calculus I — Derivatives'))).toBe('calculus')
    expect(rungOf(c('Eigenvalues', 'Chapter 12: Linear Algebra'))).toBe('linear-algebra')
    expect(rungOf(c('Bayes’ theorem', 'Chapter 14: Probability and Statistics'))).toBe('probability')
    expect(rungOf(c('Maximum likelihood estimation', 'Chapter 14: Probability and Statistics'))).toBe('statistics')
    expect(rungOf(c('The Itô isometry', 'Chapter 23: Stochastic Calculus'))).toBe('stochastic')
    expect(rungOf(c('Deriving the Black-Scholes PDE: GBM assumption + Itô’s lemma', 'Chapter 23: Stochastic Calculus'))).toBe('pricing')
    expect(rungOf(c('OLS as projection', 'Chapter 24: Statistical Inference & Econometrics'))).toBe('statistics')
    // Off the ladder: maths, but not on the way to quant
    expect(rungOf(c('Groups', 'Chapter 15: Abstract Algebra'))).toBeNull()
    expect(rungOf(c('Open sets', 'Chapter 16: Topology'))).toBeNull()
    // Not maths at all
    expect(rungOf({ name: 'Raft leader election', area: 'Systems', section: 'Consensus' })).toBeNull()
    // A maths lesson outside a roadmap still counts
    expect(rungOf({ name: 'Confidence intervals', area: '', section: undefined })).toBe('statistics')
  })

  it('levels each rung from FSRS-solid topics, finds where you are, and what to learn next', () => {
    const cs = [
      ...Array.from({ length: 10 }, (_, i) => c(`Topic ${i}`, 'Chapter 1: Numbers', solid)),
      c('Domain and range', 'Chapter 6: Functions', solid),
      c('Composition', 'Chapter 6: Functions', { status: 'learning', estimate: 0.4, seen: 1 }),
      c('Inverses', 'Chapter 6: Functions'),
      c('The limit definition', 'Chapter 8: Calculus I — Derivatives')
    ]
    const l = ladder(cs)
    expect(l.rungs.map((r) => r.rung.id)).toEqual(RUNGS.map((r) => r.id))
    expect(l.rungs[0]).toMatchObject({ solid: 10, level: 5 })
    expect(LEVELS[l.rungs[1].level]).toBe('Working')
    expect(l.here).toBe(1)
    expect(l.title).toBe('Algebraist')
    expect(l.rungs[1].next?.name).toBe('Composition')
    expect(l.rungs[2].chapters).toEqual(['Chapter 8: Calculus I — Derivatives'])
    // A rung with nothing on the roadmap shows starters
    expect(l.rungs[3].starters).toBe(true)
    expect(l.rungs[3].topics[0].name).toBe('Vectors and linear combinations')
    expect(groundUpNext(l)?.topic.name).toBe('Composition')
  })

  it('celebrates a rung moving up and a new title once, not on the first look', () => {
    const before = levelsOf(ladder([c('Topic', 'Chapter 1: Numbers')]))
    const after = ladder(Array.from({ length: 4 }, (_, i) => c(`T${i}`, 'Chapter 1: Numbers', solid)))
    const ups = levelUps(before, after)
    expect(ups.map((u) => u.title)).toEqual(['ARITHMETIC AND ALGEBRA MASTERED', 'ALGEBRAIST'])
    expect(levelUps(levelsOf(after), after)).toEqual([])
  })

  it('"teach me maths from the ground up" is a ladder request; ordinary maths questions are not', () => {
    for (const t of ['Teach me maths from the ground up', 'I want to learn mathematics from scratch', 'teach me math properly, step by step', 'maths from zero please']) expect(groundUpIntent(t), t).toBe(true)
    for (const t of ['Teach me derivatives', 'What is the chain rule?', 'Teach me Python from scratch']) expect(groundUpIntent(t), t).toBe(false)
  })
})

describe('maths mode: code about maths', () => {
  it('is taught as code', () => {
    expect(mathsMode('Vectors in Rust').on).toBe(false)
    expect(mathsMode('Matrix multiplication in Python').on).toBe(false)
    expect(mathsMode('Gradient descent momentum').on).toBe(false)
  })
})
