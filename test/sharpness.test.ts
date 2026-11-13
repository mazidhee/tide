import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  benchmarks,
  BENCH_MIN,
  checklistCover,
  draftProblem,
  freshRatings,
  nextInStream,
  parseGrade,
  publicSharp,
  rateAttempt,
  ratingBand,
  stretchDifficulty,
  timedScore,
  verifyProblem,
  type RunOutcome,
  type SharpProblem,
  type Verifier
} from '@shared/sharpness'
import { pickFromBank, SHARP_BANK } from '@shared/sharpBank'
import { afterHint, afterRetry, freshHints, freshMethodStats, methodHintLeaks, methodReport, METHODS, nextHint, noteMethods, pickHintMethod } from '@shared/sharpMethods'
import { cardInCode, cardLeaks, dueCards, newCard, parseFinish, recallPrompt, reviewCard, type Postmortem } from '@shared/sharpPostmortem'
import { act, askData, draftIncident, freshDrill, hypothesise, INCIDENTS, matchSource, publicIncident, resolve, rootCauseRight, scoreDrill } from '@shared/sharpIncidents'
import { attemptEvent } from '@shared/sharpEvents'

// ---------- A real Python sandbox for the checks (the app uses main/runner) ----------

const HARNESS = `import json, sys, os
sys.path.insert(0, sys.argv[1])
ns = {}
src = open(os.path.join(sys.argv[1], "tests.py")).read()
exec("from answer import *\\n" + src, ns)
out = {}
for name, fn in list(ns.items()):
    if name.startswith("test") and callable(fn):
        try:
            fn()
            out[name] = "pass"
        except Exception as e:
            out[name] = "fail"
print(json.dumps(out))
`
const python = spawnSync('python3', ['--version']).status === 0

const pyVerifier: Verifier = {
  async runTests(code, tests) {
    const d = mkdtempSync(join(tmpdir(), 'tide-sharp-'))
    writeFileSync(join(d, 'answer.py'), code)
    writeFileSync(join(d, 'tests.py'), tests)
    writeFileSync(join(d, 'harness.py'), HARNESS)
    const r = spawnSync('python3', [join(d, 'harness.py'), d], { encoding: 'utf8', timeout: 60_000 })
    if (r.status !== 0) return { stdout: r.stderr, exitCode: r.status ?? 1, timedOut: false, passed: [], failed: [] }
    const res = JSON.parse(r.stdout) as Record<string, string>
    return { stdout: '', exitCode: 0, timedOut: false, passed: Object.keys(res).filter((k) => res[k] === 'pass'), failed: Object.keys(res).filter((k) => res[k] !== 'pass') }
  },
  async run(code) {
    const r = spawnSync('python3', ['-c', code], { encoding: 'utf8', timeout: 30_000 })
    return { stdout: r.stdout ?? '', exitCode: r.status ?? 1, timedOut: false }
  }
}

// ---------- A problem Claude might write, and broken versions of it ----------

const WRITTEN = {
  title: 'Longest calm stretch',
  pattern: 'sliding window with a counter',
  methods: ['small-cases', 'invariant'],
  brief: 'Given hourly volatility readings and a limit k, return the length of the longest run of consecutive hours with at most k readings above 2.0. Write `calm(xs, k)`.',
  examples: ['calm([1.0, 2.5, 1.0, 3.0, 1.0], 1) == 3'],
  starter: 'def calm(xs, k):\n    pass\n',
  reference: 'def calm(xs, k):\n    best = lo = bad = 0\n    for hi, x in enumerate(xs):\n        bad += x > 2.0\n        while bad > k:\n            bad -= xs[lo] > 2.0\n            lo += 1\n        best = max(best, hi - lo + 1)\n    return best\n',
  brute: 'def calm(xs, k):\n    best = 0\n    for i in range(len(xs)):\n        for j in range(i, len(xs)):\n            if sum(x > 2.0 for x in xs[i:j+1]) <= k:\n                best = max(best, j - i + 1)\n    return best\n',
  tests: `def test_example():
    assert calm([1.0, 2.5, 1.0, 3.0, 1.0], 1) == 3

def test_empty():
    assert calm([], 2) == 0

def test_all_calm():
    assert calm([1.0, 1.0, 1.0], 0) == 3

def test_zero_allowed():
    assert calm([3.0, 1.0, 1.0, 3.0, 1.0], 0) == 2

def test_all_wild():
    assert calm([3.0, 3.0], 1) == 1

def test_large_calm():
    assert calm([1.0] * 100000, 0) == 100000
`,
  complexity: 'O(n) time, O(1) space',
  solution: 'Two pointers keeping at most k wild hours in the window.',
  hints: ['What must stay true about the window?']
}

describe('Claude-written problems are checked before use', () => {
  it('rejects shapes that cannot be verified', () => {
    expect(draftProblem('algorithms', { ...WRITTEN, tests: 'def test_a():\n    assert calm([], 0) == 0\n' }, 1500, 'x')).toEqual({ error: expect.stringMatching(/at least 5/) })
    expect(draftProblem('algorithms', { ...WRITTEN, brute: '' }, 1500, 'x')).toEqual({ error: expect.stringMatching(/brute/) })
    expect(draftProblem('algorithms', { ...WRITTEN, starter: 'def other(xs, k):\n    pass\n' }, 1500, 'x')).toEqual({ error: expect.stringMatching(/different functions/) })
    expect(draftProblem('quant', { title: 'Dice', pattern: 'p', brief: 'Roll two dice and report the probability that they sum to seven, exactly.', solution: 's', answer: 1 / 6 }, 1300, 'q')).toEqual({ error: expect.stringMatching(/check/) })
    expect(draftProblem('design', { title: 'D', brief: 'Design a thing that does a lot of things at scale for many users.', solution: 's', checklist: [{ point: 'p', cues: ['x'] }] }, 1500, 'd')).toEqual({ error: expect.stringMatching(/checklist/) })
  })

  it.skipIf(!python)('accepts a sound problem: the reference and the brute force pass, the starter fails', async () => {
    const d = draftProblem('algorithms', WRITTEN, 1500, 'w1')
    if ('error' in d) throw new Error(d.error)
    expect(await verifyProblem(d, pyVerifier)).toEqual({ ok: true })
  })

  it.skipIf(!python)('rejects a wrong expected value, which the brute force catches even when the reference agrees', async () => {
    // The reference was written to match a wrong test: only an independent solution sees it
    const wrong = { ...WRITTEN, tests: WRITTEN.tests.replace('== 3\n\ndef test_empty', '== 4\n\ndef test_empty'), reference: WRITTEN.reference.replace('return best', 'return best + (1 if xs == [1.0, 2.5, 1.0, 3.0, 1.0] else 0)') }
    const d = draftProblem('algorithms', wrong, 1500, 'w2')
    if ('error' in d) throw new Error(d.error)
    expect(await verifyProblem(d, pyVerifier)).toEqual({ ok: false, why: expect.stringMatching(/brute-force solution disagrees on test_example/) })
  })

  it.skipIf(!python)('rejects a reference that fails its own tests, and a starter that already passes', async () => {
    const d1 = draftProblem('algorithms', { ...WRITTEN, reference: 'def calm(xs, k):\n    return len(xs)\n' }, 1500, 'w3')
    if ('error' in d1) throw new Error(d1.error)
    expect(await verifyProblem(d1, pyVerifier)).toMatchObject({ ok: false, why: expect.stringMatching(/reference fails/) })
    const d2 = draftProblem('algorithms', { ...WRITTEN, starter: WRITTEN.reference }, 1500, 'w4')
    if ('error' in d2) throw new Error(d2.error)
    expect(await verifyProblem(d2, pyVerifier)).toEqual({ ok: false, why: 'the starter already passes every test' })
  })

  it.skipIf(!python)('a quant problem is used only when its own check prints the stated answer', async () => {
    const q = { title: 'Seven', pattern: 'counting', methods: ['small-cases'], brief: 'Two fair dice are rolled. What is the probability the total is 7? Three decimal places.', solution: '6/36', check: 'from itertools import product\nprint(sum(a+b==7 for a,b in product(range(1,7),repeat=2))/36)', tolerance: 0.001 }
    const good = draftProblem('quant', { ...q, answer: 1 / 6 }, 1200, 'q1')
    const bad = draftProblem('quant', { ...q, answer: 0.2 }, 1200, 'q2')
    if ('error' in good || 'error' in bad) throw new Error('shape')
    expect(await verifyProblem(good, pyVerifier)).toEqual({ ok: true })
    expect(await verifyProblem(bad, pyVerifier)).toMatchObject({ ok: false, why: expect.stringMatching(/not 0.2/) })
  })

  it('never shows the window the reference, tests, answer, solution or pattern', () => {
    for (const p of SHARP_BANK) {
      const pub = JSON.stringify(publicSharp(p))
      expect(pub).not.toContain(p.solution.slice(0, 60))
      if (p.code) expect(pub).not.toContain(p.code.reference.trim().split('\n').slice(-1)[0].trim().length > 12 ? p.code.reference.trim().split('\n').slice(-1)[0].trim() : '§§')
      expect(publicSharp(p).pattern).toBe('')
    }
  })
})

// ---------- The fixed bank: every answer checked in code ----------

describe('the fixed bank', () => {
  it('covers every category with unique ids and a spread of difficulty', () => {
    expect(new Set(SHARP_BANK.map((p) => p.id)).size).toBe(SHARP_BANK.length)
    for (const c of ['algorithms', 'design', 'ml', 'quant', 'proofs'] as const) {
      const ps = SHARP_BANK.filter((p) => p.category === c)
      expect(ps.length, c).toBeGreaterThanOrEqual(5)
      expect(Math.max(...ps.map((p) => p.difficulty)) - Math.min(...ps.map((p) => p.difficulty)), c).toBeGreaterThanOrEqual(400)
    }
    expect(SHARP_BANK.map((p) => p.id)).toEqual(expect.arrayContaining(['feature-store', 'chain-indexer', 'ledger-at-scale']))
    expect(INCIDENTS.length).toBeGreaterThanOrEqual(6)
  })

  it.skipIf(!python)('every algorithms reference passes its hidden tests and every starter fails them', async () => {
    for (const p of SHARP_BANK.filter((x) => x.code && x.origin === 'bank' && !x.id.startsWith('mock-'))) {
      const ref = await pyVerifier.runTests(p.code!.reference, p.code!.tests)
      expect(ref.failed, p.id).toEqual([])
      expect(ref.passed!.length, p.id).toBeGreaterThanOrEqual(5)
      const st = await pyVerifier.runTests(p.code!.starter, p.code!.tests)
      expect(st.passed, `${p.id} starter`).toEqual([])
    }
  }, 120_000)

  it('quant answers, computed independently', () => {
    const rnd = (() => {
      let s = 12345
      return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    })()
    const ans = (id: string) => SHARP_BANK.find((p) => p.id === id)!.answer!.value
    // Coupon collector by the formula's pieces
    expect(ans('all-six-faces')).toBeCloseTo([1, 2, 3, 4, 5, 6].reduce((s, k) => s + 6 / k, 0), 6)
    // HH: solve the two-state chain by value iteration
    let es = 0, eh = 0
    for (let i = 0; i < 2000; i++) [es, eh] = [1 + 0.5 * eh + 0.5 * es, 1 + 0.5 * es]
    expect(ans('two-heads-in-a-row')).toBeCloseTo(es, 6)
    // Broken stick, by simulation
    let tri = 0
    for (let i = 0; i < 200_000; i++) {
      const [a, b] = [rnd(), rnd()].sort((x, y) => x - y)
      if (Math.max(a, b - a, 1 - b) < 0.5) tri++
    }
    expect(Math.abs(tri / 200_000 - ans('broken-stick'))).toBeLessThan(0.01)
    // Max of two dice, by enumeration
    let m = 0
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) m += Math.max(a, b) / 36
    expect(ans('max-of-two-dice')).toBeCloseTo(m, 9)
    // Rerolls by backward induction
    const keep = (v: number) => [1, 2, 3, 4, 5, 6].reduce((s, f) => s + Math.max(f, v) / 6, 0)
    expect(ans('one-reroll')).toBeCloseTo(keep(3.5), 9)
    expect(ans('two-rerolls')).toBeCloseTo(keep(keep(3.5)), 9)
    // Ant on a cube: value iteration on distances
    let e = [0, 0, 0, 0]
    for (let i = 0; i < 5000; i++) e = [0, 1 + (2 / 3) * e[2] + (1 / 3) * e[0], 1 + (2 / 3) * e[1] + (1 / 3) * e[3], 1 + e[2]]
    expect(ans('ant-on-a-cube')).toBeCloseTo(e[3], 6)
    // Gambler's ruin, by solving the linear recurrence numerically
    let p = Array.from({ length: 11 }, (_, i) => (i === 10 ? 1 : 0))
    for (let i = 0; i < 20000; i++) p = p.map((v, k) => (k === 0 || k === 10 ? v : 0.5 * p[k - 1] + 0.5 * p[k + 1]))
    expect(ans('gamblers-ruin')).toBeCloseTo(p[3], 6)
    expect(ans('birthday-23')).toBeCloseTo(0.5073, 3)
    // Fixed points and the first ace, by enumeration on smaller decks then the general formula
    expect(ans('fixed-points')).toBe(1)
    let firstAce = 0
    for (let pos = 1; pos <= 49; pos++) {
      // P(first ace at pos) = C(52-pos, 3) / C(52, 4)
      const c = (n: number, k: number) => (k < 0 || k > n ? 0 : Array.from({ length: k }, (_, i) => (n - i) / (i + 1)).reduce((a, b) => a * b, 1))
      firstAce += (pos * c(52 - pos, 3)) / c(52, 4)
    }
    expect(ans('first-ace')).toBeCloseTo(firstAce, 6)
    // Kelly: maximise the growth rate on a grid
    let best = 0, bestF = 0
    for (let f = 0; f < 0.99; f += 0.0005) {
      const g = 0.6 * Math.log(1 + f) + 0.4 * Math.log(1 - f)
      if (g > best) [best, bestF] = [g, f]
    }
    expect(Math.abs(ans('kelly-fraction') - bestF)).toBeLessThan(0.001)
    // No two heads together: count all 1024 strings
    let ok = 0
    for (let s = 0; s < 1024; s++) if (!(s & (s >> 1))) ok++
    expect(ans('no-two-heads')).toBeCloseTo(ok / 1024, 9)
  })

  it('ML numbers and proof claims, checked in code', () => {
    const ans = (id: string) => SHARP_BANK.find((p) => p.id === id)!.answer!.value
    expect(ans('alerts-per-day')).toBe(1_000_000 * 0.002 * 0.8 + 1_000_000 * 0.998 * 0.01)
    const n = (1.959964 + 0.841621) ** 2 * (0.04 * 0.96 + 0.044 * 0.956) / 0.004 ** 2
    expect(Math.abs(ans('ab-sample-size') - n)).toBeLessThan(10)
    for (let k = 1; k <= 1000; k++) expect(Array.from({ length: k }, (_, i) => 2 * i + 1).reduce((a, b) => a + b, 0)).toBe(k * k)
    expect(Array.from({ length: 10 }, (_, i) => 91 + i).reduce((a, b) => a + b, 0)).toBe(955)
    expect(2 ** 10 - 1).toBeGreaterThan(955)
  })

  it('picks near the difficulty, avoids recent ones, prefers the method being trained', () => {
    const p = pickFromBank({ category: 'quant', difficulty: 1650, recent: [], seed: 0 })
    expect(Math.abs(p.difficulty - 1650)).toBeLessThanOrEqual(100)
    const again = pickFromBank({ category: 'quant', difficulty: 1650, recent: [p.id], seed: 0 })
    expect(again.id).not.toBe(p.id)
    expect(pickFromBank({ category: 'quant', difficulty: 1300, recent: [], method: 'backwards', seed: 0 }).methods).toContain('backwards')
  })
})

// ---------- Ratings, benchmarks and the stream ----------

describe('ratings', () => {
  it('reuses the workout Elo: a solve moves up, a miss down, harder problems move it more', () => {
    const r = { r: 1200, n: 4 }
    expect(rateAttempt(r, 1200, 1, 0).r).toBeGreaterThan(1200)
    expect(rateAttempt(r, 1200, 0, 0).r).toBeLessThan(1200)
    expect(rateAttempt(r, 1600, 1, 0).r - 1200).toBeGreaterThan(rateAttempt(r, 1000, 1, 0).r - 1200)
    expect(rateAttempt(r, 1200, 1, 77).last).toBe(77)
  })

  it('the band narrows with attempts and widens again with time away', () => {
    const now = Date.UTC(2026, 10, 13)
    expect(ratingBand({ r: 1000, n: 0 }, now)).toBe(350)
    expect(ratingBand({ r: 1000, n: 20, last: now }, now)).toBeLessThan(ratingBand({ r: 1000, n: 5, last: now }, now))
    expect(ratingBand({ r: 1000, n: 20, last: now - 120 * 86_400_000 }, now)).toBeGreaterThan(ratingBand({ r: 1000, n: 20, last: now }, now))
  })

  it('aims just past your level and counts time', () => {
    expect(stretchDifficulty(1400)).toBeGreaterThan(1400)
    expect(stretchDifficulty(1400)).toBeLessThan(1460)
    expect(timedScore(1, 20 * 60_000, 35)).toBe(1)
    expect(timedScore(1, 35 * 1.25 * 60_000, 35)).toBe(0.8)
    expect(timedScore(1, 35 * 3 * 60_000, 35)).toBe(0.4)
    expect(timedScore(0.5, 0, 35)).toBe(0.5)
  })

  it('benchmarks are estimates, said only after enough attempts', () => {
    const now = Date.now()
    const early = benchmarks('algorithms', { r: 1800, n: 2, last: now }, now)
    expect(early[0].say).toMatch(/Not enough attempts yet: 2 of 5/)
    expect(early.every((b) => !b.met)).toBe(true)
    const strong = benchmarks('algorithms', { r: 1950, n: 30, last: now }, now)
    const hard = strong.find((b) => /hard/.test(b.label))!
    expect(hard.met).toBe(true)
    expect(hard.say).toMatch(/^Estimate:/)
    expect(hard.low).toBeLessThanOrEqual(hard.chance)
    const weak = benchmarks('algorithms', { r: 1200, n: BENCH_MIN, last: now }, now).find((b) => /hard/.test(b.label))!
    expect(weak.met).toBe(false)
    expect(weak.say).toMatch(/not yet/)
  })

  it('the stream brings due cards back first, then the neediest categories, carrying a method to train', () => {
    const ratings = freshRatings()
    ratings.algorithms = { r: 1500, n: 10, last: Date.now() }
    ratings.design = { r: 1100, n: 10, last: Date.now() }
    const s = nextInStream({ ratings, attempts: [], due: [{ id: 'c1', category: 'quant', pattern: 'symmetry', prompt: 'p' }], train: ['backwards'], now: Date.now(), weak: ['design'] })
    expect(s[0]).toMatchObject({ kind: 'revisit', category: 'quant' })
    expect(s.find((x) => x.kind === 'problem')?.method).toBe('backwards')
    expect(s.find((x) => x.category === 'design')?.why).toBe('Weak in your mocks')
    expect(s.some((x) => x.kind === 'incident')).toBe(true)
    expect(new Set(s.map((x) => x.category)).size).toBe(s.length)
  })
})

// ---------- The method-hint policy ----------

describe('method hints come before solution hints', () => {
  it('no hints on the first attempt or after a solve', () => {
    expect(nextHint(freshHints())).toEqual({ kind: null, why: expect.stringMatching(/First attempt/) })
    expect(nextHint({ ...freshHints(), submitted: true, missed: false })).toMatchObject({ kind: null })
  })

  it('a solution hint only after two method hints and a retry, even when asked for first', () => {
    let s = { ...freshHints(), submitted: true, missed: true }
    expect(nextHint(s, 'solution')).toEqual({ kind: 'method' })
    s = afterHint(s, 'method')
    expect(nextHint(s, 'solution')).toEqual({ kind: 'method' })
    s = afterHint(s, 'method')
    expect(nextHint(s, 'solution')).toEqual({ kind: 'method' })
    s = afterRetry(s)
    expect(nextHint(s, 'solution')).toEqual({ kind: 'solution' })
    expect(nextHint(s, 'method')).toEqual({ kind: 'method' })
  })

  it('points at the problem’s own methods first, then the ones you never reach for', () => {
    expect(pickHintMethod(['invariant', 'draw'], [])).toBe('invariant')
    expect(pickHintMethod(['invariant', 'draw'], ['invariant'])).toBe('draw')
    expect(pickHintMethod(['invariant'], ['invariant'], ['backwards'])).toBe('backwards')
  })

  it('a model-written hint that carries the answer or code is not used', () => {
    expect(methodHintLeaks('Try a smaller case: what if there were only two dice?', { answer: 14.7 })).toBe(false)
    expect(methodHintLeaks('The answer is 14.7, by linearity.', { answer: 14.7 })).toBe(true)
    expect(methodHintLeaks('```python\nq = deque()\n```', {})).toBe(true)
    expect(methodHintLeaks('Use while q and nums[q[-1]] <= x: q.pop() to keep it decreasing', { code: 'def f():\n        while q and nums[q[-1]] <= x:\n            q.pop()' })).toBe(true)
  })

  it('counts what you reach for and what unlocks you, and trains what you never use', () => {
    let s = freshMethodStats()
    for (let i = 0; i < 3; i++) s = noteMethods(s, { needed: ['invariant', 'small-cases'], reached: ['small-cases'] })
    s = noteMethods(s, { unlocked: ['invariant'] })
    const r = methodReport(s)
    expect(r.train).toEqual(['invariant'])
    expect(r.unlocks).toEqual(['invariant'])
    expect(r.methods.find((m) => m.id === 'invariant')!.neverReached).toBe(true)
    expect(r.methods.find((m) => m.id === 'small-cases')!.neverReached).toBe(false)
    expect(METHODS).toHaveLength(10)
  })
})

// ---------- The post-mortem becomes a card about the method ----------

const pmAnswers = { stuck: 'I could not see how to avoid rescanning each window.', tried: 'A heap, then a sorted list.', unlock: 'Noticing that smaller values behind a bigger one can never matter again.', pattern: 'When a max or min over every window is asked, keep a monotonic deque.' }

describe('post-mortem to recall card', () => {
  it('a card that leaks the answer or the code is refused', () => {
    expect(cardLeaks({ front: 'What do you expect for the coupon problem?', back: 'It is 14.7.' }, { answer: 14.7 })).toBe('it gives the answer')
    expect(cardLeaks({ front: 'Monotonic deque: when?', back: '```python\nq.pop()\n```' }, {})).toBe('it has code in it')
    expect(cardLeaks({ front: 'Windows: what do you reach for?', back: 'A deque of candidates, decreasing; pop smaller ones from the back.' }, { answer: 14.7, code: 'def f(): pass' })).toBeNull()
    expect(parseFinish(JSON.stringify({ pattern: 'coupon collector', method: 'simplify', front: 'Waiting to see every type: what do you split the wait into?', back: 'The answer is 14.7' }), { answer: 14.7 })).toBeNull()
    expect(parseFinish(JSON.stringify({ pattern: 'coupon collector', method: 'simplify', front: 'Waiting to see every type: what do you split the wait into?', back: 'Stages, one per new type; each is geometric. Simplify into stages.' }), { answer: 14.7 })).toMatchObject({ method: 'simplify', pattern: 'coupon collector' })
  })

  it('without a model, the card is made from the learner’s own words, about the method', () => {
    const c = cardInCode({ pattern: 'monotonic deque', method: 'invariant', answers: pmAnswers, kind: 'problem' })
    expect(c.front).toMatch(/monotonic deque/)
    expect(c.back).toMatch(/Find the invariant/)
    expect(c.back).toMatch(/can never matter again/)
    expect(cardLeaks(c, { code: SHARP_BANK.find((p) => p.id === 'sliding-max-latency')!.code!.reference })).toBeNull()
    const i = cardInCode({ pattern: 'retries without idempotency', method: 'backwards', answers: pmAnswers, kind: 'incident' })
    expect(i.front).toMatch(/On call/)
  })

  it('the card comes back in the stream: solved moves it up a box, a miss resets it', () => {
    const pm = { id: 'pm-1', category: 'algorithms', pattern: 'monotonic deque', card: { front: 'f', back: 'b' } } as Postmortem
    const c = newCard(pm, 0)
    expect(c.due).toBe(2 * 86_400_000)
    expect(dueCards([c], 86_400_000)).toEqual([])
    expect(dueCards([c], 3 * 86_400_000)).toHaveLength(1)
    const up = reviewCard(c, true, 0)
    expect(up.box).toBe(1)
    expect(reviewCard(up, false, 0).box).toBe(0)
    expect(recallPrompt(pm.card, pm.pattern)).toMatch(/^Method card \(monotonic deque\)/)
  })
})

// ---------- Incident drills ----------

describe('incident drills', () => {
  const s = INCIDENTS.find((x) => x.id === 'latency-3am')!

  it('every scenario is consistent: each source reachable by name, evidence, every kind of action, the cause never stated', () => {
    for (const sc of INCIDENTS) {
      for (const src of sc.sources) expect(matchSource(sc, `show me the ${src.label}`)?.id, `${sc.id}: ${src.label}`).toBe(src.id)
      expect(sc.sources.filter((x) => x.relevant).length, sc.id).toBeGreaterThanOrEqual(2)
      expect(sc.sources.filter((x) => !x.relevant).length, sc.id).toBeGreaterThanOrEqual(2)
      for (const e of ['mitigates', 'fixes', 'harmful'] as const) expect(sc.actions.some((a) => a.effect === e), `${sc.id} ${e}`).toBe(true)
      expect(sc.rootCause.cues.length, sc.id).toBeGreaterThanOrEqual(3)
      expect(rootCauseRight(sc, sc.rootCause.summary), sc.id).toBe(true)
      for (const src of sc.sources) expect(src.data.toLowerCase()).not.toContain(sc.rootCause.summary.toLowerCase().slice(0, 50))
      expect(JSON.stringify(publicIncident(sc))).not.toContain(sc.rootCause.summary.slice(0, 40))
    }
  })

  it('a good drill: data first, a hypothesis, mitigate, fix, the right cause', () => {
    const t0 = 1_000_000
    let st = freshDrill(t0)
    st = askData(s, st, 'show me the checkout-api logs', t0 + 30_000).state
    st = askData(s, st, 'postgres metrics please', t0 + 60_000).state
    st = askData(s, st, 'slow query log / pg_stat_activity', t0 + 90_000).state
    st = askData(s, st, 'what is on the cron schedule?', t0 + 120_000).state
    st = hypothesise(st, 'The new report job is saturating the primary', t0 + 150_000)
    st = act(s, st, 'cancel the report query with pg_cancel', t0 + 180_000).state
    expect(st.mitigatedAt).toBe(180_000)
    st = act(s, st, 'move the job to the read replica', t0 + 240_000).state
    st = resolve(s, st, 'A new cron report job ran a heavy query on the primary and exhausted the connection pool', t0 + 300_000)
    const g = scoreDrill(s, st)
    expect(st.resolved!.right).toBe(true)
    expect(g.method).toBe(1)
    expect(g.correctness).toBe(1)
    expect(g.speed).toBe(1)
    expect(g.overall).toBe(1)
  })

  it('a poor drill: acting first, a harmful action, the wrong cause', () => {
    const t0 = 0
    let st = freshDrill(t0)
    const r = act(s, st, 'restart all the pods', 60_000)
    expect(r.effect).toBe('harmful')
    st = r.state
    st = askData(s, st, 'the moon phase', 120_000).state
    expect(st.entries.at(-1)!.reply).toMatch(/Nothing comes back for that. You can look at:/)
    st = resolve(s, st, 'Payments API is slow', 50 * 60_000)
    const g = scoreDrill(s, st)
    expect(g.correctness).toBe(0)
    expect(g.method).toBeLessThan(0.3)
    expect(g.notes.join(' ')).toMatch(/acted before looking/)
    expect(g.notes.join(' ')).toMatch(/made things worse/)
    expect(g.notes.join(' ')).toMatch(/root cause:/)
  })

  it('a written scenario is used only if it holds together', () => {
    const base = { title: 'T', page: 'PAGE: something is badly wrong right now', system: 'sys', rootCause: { summary: 'the cache was unbounded', cues: ['cache', 'unbounded'] }, sources: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, cues: [`c${i}`], data: 'x'.repeat(60), relevant: i < 2 })), actions: [{ id: 'a', cues: ['roll'], effect: 'mitigates' }, { id: 'b', cues: ['bound'], effect: 'fixes' }, { id: 'c', cues: ['flush'], effect: 'harmful' }] }
    expect(draftIncident(base, 'i', 1500)).toMatchObject({ id: 'i', origin: 'claude' })
    expect(draftIncident({ ...base, sources: base.sources.slice(0, 3) }, 'i', 1500)).toEqual({ error: expect.stringMatching(/at least 5/) })
    expect(draftIncident({ ...base, actions: base.actions.slice(0, 2) }, 'i', 1500)).toEqual({ error: expect.stringMatching(/makes it worse/) })
    expect(draftIncident({ ...base, sources: base.sources.map((x, i) => (i ? x : { ...x, data: 'Root: the cache was unbounded, so memory grew' })) }, 'i', 1500)).toEqual({ error: expect.stringMatching(/states the root cause/) })
    // Seen live: Opus titled a drill "Refunds Stuck Behind a Renamed Pool Setting"
    expect(draftIncident({ ...base, title: 'Pods dying from an unbounded cache' }, 'i', 1500)).toEqual({ error: expect.stringMatching(/gives the cause away/) })
  })
})

// ---------- Marking helpers ----------

describe('marking', () => {
  it('a grader reply is clamped and its covered points named', () => {
    const p = SHARP_BANK.find((x) => x.id === 'feature-store')!
    expect(parseGrade('{"score": 1.4, "covered": [1, 99], "verdict": "ok", "missing": ["ttl"]}', p)).toMatchObject({ score: 1, covered: [p.checklist![0].point], missing: ['ttl'] })
    expect(parseGrade('nope', p)).toBeNull()
    expect(checklistCover(p.checklist!, 'We use point-in-time joins and an online store in Redis with TTLs').covered).toHaveLength(3)
  })
})

// ---------- main/sharpness: the whole flow, with stand-ins for Claude ----------

const dir = mkdtempSync(join(tmpdir(), 'tide-sharpness-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false }, ipcMain: { handle: () => {} } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: dir, ai: {}, whyMode: 'off' }) }))
const kept: { prompt: string; topic: string; lesson: string }[][] = []
vi.mock('../src/main/recall', () => ({ keepForRecall: async (items: { prompt: string; topic: string; lesson: string }[]) => void kept.push(items) }))
vi.mock('../src/main/mocks', () => ({ mockHistory: async () => [{ id: 'm1', at: 1, mode: 'design', title: 'Ledger', minutes: 45, used: 40, overall: 0.4, scores: {}, hints: 0, by: 'code', ref: 'ledger-service' }] }))

const S = await import('../src/main/sharpness')
const L = await import('../src/main/sharpEventLog')

type Ask = (job: string, prompt: string) => string | Error
function standIns(o: { claude: boolean; ask?: Ask; runTests?: Verifier['runTests'] }) {
  const calls: { job: string; prompt: string }[] = []
  S.setSharpModels({
    claude: async () => (o.claude ? { ready: true } : { ready: false, why: 'not installed' }),
    ask: async (job, prompt, _system, opts) => {
      calls.push({ job, prompt })
      const r = o.ask?.(job, prompt)
      if (r === undefined || r instanceof Error) {
        if (!o.claude && !opts.fallback) throw new Error('Claude isn’t available')
        throw r ?? new Error('no answer')
      }
      return { text: r, by: o.claude ? 'claude' : 'gemma' }
    },
    runTests: o.runTests ?? pyVerifier.runTests,
    run: pyVerifier.run
  })
  return calls
}

const events = async () => L.readLearningEvents()

describe('a Sharpness attempt from start to card', () => {
  beforeEach(() => {
    kept.length = 0
  })

  it('without Claude: a bank problem, rated on the first attempt, hints only after the miss, a card in code', async () => {
    standIns({ claude: false })
    const st = await S.startSharp({ category: 'quant' })
    expect(st.written).toBe('bank')
    expect(st.why).toMatch(/fixed bank/)
    expect(st.problem!.answerKind).toBe('number')
    expect(JSON.stringify(st)).not.toMatch(/"answer":\{/)
    // No hints before a real attempt
    expect((await S.hintSharp(st.id)).kind).toBeNull()
    expect(() => S.revealSharp(st.id)).toThrow(/Submit/)
    const r = await S.submitSharp(st.id, { answer: 'about 1000', reached: ['estimate'] })
    expect(r.solved).toBe(false)
    expect(r.after).toBeLessThan(r.before)
    expect(r.reveal).toBeUndefined()
    // Method hint first, even when a solution hint is asked for
    const h1 = await S.hintSharp(st.id, 'solution')
    expect(h1.kind).toBe('method')
    expect(h1.method).toBeTruthy()
    const status = await S.sharpStatus()
    expect(status.categories.find((c) => c.id === 'quant')!.attempts).toBe(1)
    expect(status.weak).toEqual(['design'])
    const pm = await S.pmFinish(st.id, pmAnswers)
    expect(pm.postmortem.by).toBe('self')
    expect(pm.recall).toBe(true)
    expect(kept[0][0].prompt).toMatch(/^Method card/)
    expect(kept[0][0].topic).toMatch(/^Problem-solving:/)
    const after = await S.sharpStatus()
    expect(after.postmortems[0].id).toBe(pm.postmortem.id)
    expect(after.cards).toBe(1)
    const ev = await events()
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(['attempt', 'hint', 'postmortem']))
    expect(ev.find((e) => e.kind === 'attempt')).toMatchObject({ source: 'sharpness', subject: 'Quant and probability', correct: false })
  })

  it.skipIf(!python)('with Claude: an original algorithms problem is written, verified in the sandbox, then used', async () => {
    const calls = standIns({ claude: true, ask: (job) => (job === 'sharpWrite' ? JSON.stringify(WRITTEN) : job === 'sharpCoach' ? 'Try a smaller case: what is the answer when only one reading is wild?' : '') })
    const st = await S.startSharp({ category: 'algorithms', method: 'invariant' })
    expect(st.written).toBe('claude')
    expect(st.problem!.title).toBe('Longest calm stretch')
    expect(st.training?.name).toBe('Find the invariant')
    expect(calls[0].prompt).toMatch(/key unlock should be the method "invariant"/)
    expect(JSON.stringify(st)).not.toContain('bad -= xs[lo]')
    const t = await S.testSharp(st.id, 'def calm(xs, k):\n    return 0\n')
    expect(t.total).toBe(6)
    expect(t.passed).toContain('empty')
    // A wrong first attempt, then a method hint, then a right retry: the method unlocked it
    const r = await S.submitSharp(st.id, { code: 'def calm(xs, k):\n    return 0\n', reached: ['small-cases'] })
    expect(r.solved).toBe(false)
    const h = await S.hintSharp(st.id)
    expect(h.text).toMatch(/smaller case/)
    const rt = await S.retrySharp(st.id, { code: WRITTEN.reference })
    expect(rt.solved).toBe(true)
    expect(rt.unlockedBy).toBeTruthy()
    expect(rt.reveal?.pattern).toBe('sliding window with a counter')
    const s2 = await S.sharpStatus()
    expect(s2.methods.unlocks).toContain(rt.unlockedBy!.id)
  }, 60_000)

  it.skipIf(!python)('with Claude: a written problem that fails its checks twice is never shown; the bank steps in', async () => {
    const bad = { ...WRITTEN, reference: 'def calm(xs, k):\n    return 1\n' }
    const calls = standIns({ claude: true, ask: (job) => (job === 'sharpWrite' ? JSON.stringify(bad) : '') })
    const st = await S.startSharp({ category: 'algorithms' })
    expect(calls.filter((c) => c.job === 'sharpWrite')).toHaveLength(2)
    expect(calls[1].prompt).toMatch(/failed Tide's check: the reference fails/)
    expect(st.written).toBe('bank')
    expect(st.why).toMatch(/failed Tide’s check twice/)
    S.cancelSharp(st.id)
  }, 60_000)

  it('written answers: Opus marks; when it fails, Gemma; when both fail, the checklist in code', async () => {
    standIns({ claude: true, ask: (job) => (job === 'sharpMark' ? '{"score": 0.9, "verdict": "Strong.", "missing": [], "strength": "Point-in-time joins."}' : new Error('x')) })
    const st = await S.startSharp({ category: 'design', ref: 'feature-store' })
    const r = await S.submitSharp(st.id, { answer: 'point-in-time joins, redis online store, flink' })
    expect(r.grade.by).toBe('opus')
    expect(r.solved).toBe(true)
    expect(r.reveal?.solution).toMatch(/Two stores/)
    standIns({ claude: false, ask: () => new Error('down') })
    const st2 = await S.startSharp({ category: 'design', ref: 'feature-store' })
    const r2 = await S.submitSharp(st2.id, { answer: 'point-in-time joins and an online store with a ttl' })
    expect(r2.grade.by).toBe('code')
    expect(r2.grade.verdict).toMatch(/key points covered \(marked in code\)/)
  })

  it('an incident drill: Opus voices the system, the grade is Tide’s, the drill is rated, and it ends in a blameless post-mortem', async () => {
    const calls = standIns({ claude: true, ask: (job) => (job === 'sharpSystem' ? '03:01:12 WARN db: acquire conn waited 2.91s' : job === 'sharpMark' ? '{"match": false}' : job === 'sharpCoach' ? 'Which alert would have shown pool waits in the first five minutes?' : new Error('no')) })
    const st = await S.startSharp({ category: 'production', ref: 'latency-3am' })
    expect(st.kind).toBe('incident')
    expect(JSON.stringify(st)).not.toContain('finance_90d_export')
    const a = await S.drillAsk(st.id, 'show me the checkout-api logs')
    expect(a.by).toBe('opus')
    expect(a.source).toBe('api-logs')
    expect(calls.at(-1)!.prompt).toMatch(/Hidden truth \(never say it\)/)
    await S.drillAsk(st.id, 'postgres metrics')
    await S.drillHypothesis(st.id, 'something is hogging the database')
    const act1 = await S.drillAct(st.id, 'kill the report query')
    expect(act1.effect).toBe('mitigates')
    const done = await S.drillResolve(st.id, 'The new cron report job ran a huge query on the primary, exhausting the connection pool')
    expect(done.right).toBe(true)
    expect(done.score.method).toBeGreaterThan(0.6)
    await expect(S.drillAsk(st.id, 'more')).rejects.toThrow(/over/)
    const t = await S.pmTurn(st.id, 'unlock', 'Pool wait time')
    expect(t.by).toBe('opus')
    const pm = await S.pmFinish(st.id, { stuck: 'a', tried: 'b', unlock: 'pool wait alerts', pattern: 'batch work on the primary' })
    expect(pm.postmortem.kind).toBe('incident')
    expect((await events()).some((e) => e.kind === 'drill-step' && e.detail?.effect === 'mitigates')).toBe(true)
  })

  it('mocks feed the ratings, and read them back to set the coding level', async () => {
    standIns({ claude: false })
    const before = (await S.sharpStatus()).categories.find((c) => c.id === 'algorithms')!
    for (let i = 0; i < 4; i++) await S.noteMockForSharpness({ id: `m${i}`, at: Date.now(), mode: 'coding', title: 'Coin change', minutes: 45, used: 30, overall: 1, scores: {}, hints: 0, by: 'code', ref: 'coin-change' })
    const after = (await S.sharpStatus()).categories.find((c) => c.id === 'algorithms')!
    expect(after.rating).toBeGreaterThan(before.rating)
    expect(after.attempts).toBe(before.attempts + 4)
    expect(await S.mockLevelFromSharpness()).toBeGreaterThanOrEqual(1)
    expect((await S.weakMockModes())[0].rating).toBeLessThanOrEqual((await S.weakMockModes()).at(-1)!.rating)
    expect((await events()).some((e) => e.kind === 'mock')).toBe(true)
  })
})

// ---------- The event log adapter ----------

describe('the learning event log adapter', () => {
  it('writes every event to the fallback file until a real sink is set, then only to the sink', async () => {
    const rec = { id: 'a1', at: 5, category: 'proofs', problem: 'root-two', title: '√2', pattern: 'contradiction', difficulty: 1150, origin: 'bank', score: 1, solved: true, usedMs: 1000, minutes: 12, before: 1000, after: 1010, reached: [], methodHints: 0, solutionHints: 0, by: 'opus' } as const
    const n0 = (await events()).length
    await L.logLearningEvents(attemptEvent(rec))
    expect((await events()).length).toBe(n0 + 1)
    expect(readFileSync(join(dir, '.tide/sharpness/events.jsonl'), 'utf8')).toContain('"item":"root-two"')
    const got: unknown[] = []
    L.setLearningEventSink(async (es) => void got.push(...es))
    await L.logLearningEvents(attemptEvent(rec), attemptEvent(rec))
    expect(got).toHaveLength(2)
    expect((await events()).length).toBe(n0 + 1)
    // A failing sink never breaks the caller
    L.setLearningEventSink(async () => {
      throw new Error('disk full')
    })
    await expect(L.logLearningEvents(attemptEvent(rec))).resolves.toBeUndefined()
    L.setLearningEventSink(null)
  })

  it('every event has the shared shape', async () => {
    for (const e of await events()) {
      expect(e).toMatchObject({ v: 1, source: 'sharpness' })
      expect(typeof e.id).toBe('string')
      expect(typeof e.at).toBe('number')
      expect(e.subject.length).toBeGreaterThan(0)
    }
  })
})
