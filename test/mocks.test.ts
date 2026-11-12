import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BANK, BANK_TAGS, levelFrom, pickProblem, publicProblem } from '@shared/mockBank'
import { DESIGNS, QUANT_BANK, BEHAVIOURAL, markQuant, parseNumber, quantPaper, starParts } from '@shared/mockQuestions'
import {
  annotateCanvas,
  clockText,
  clockTone,
  examDebrief,
  examTopics,
  interviewerMessage,
  interviewerSystem,
  loopDepth,
  markBehaviouralInCode,
  markCodingInCode,
  markDesignInCode,
  markQuantInCode,
  mergeRoadmap,
  mockLesson,
  mockStudyContext,
  parseMockMarks,
  profileOps,
  qualityInCode,
  recallFrom,
  recordOf,
  referenceCanvas,
  remainingMs,
  rubricFor,
  RUBRICS,
  statedComplexity,
  timeCue,
  trendPoints,
  trendSummary,
  type MockDebrief,
  type MockRecord
} from '@shared/mocks'
import { decide, DEFAULT_BREAKS, active, addBoundary, freshState } from '@shared/breaks'
import { lessonAnswers } from '@shared/teachingQuality'
import type { ExamPaper } from '@shared/types'

// ---------- The problem bank and its hidden tests ----------

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
            out[name] = "fail: " + type(e).__name__
print(json.dumps(out))
`

const python = spawnSync('python3', ['--version']).status === 0

function runTests(code: string, tests: string): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'tide-mock-bank-'))
  writeFileSync(join(dir, 'answer.py'), code)
  writeFileSync(join(dir, 'tests.py'), tests)
  writeFileSync(join(dir, 'harness.py'), HARNESS)
  const r = spawnSync('python3', [join(dir, 'harness.py'), dir], { encoding: 'utf8', timeout: 60_000 })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout)
}

describe('the problem bank', () => {
  it('has unique ids, known tags, every level, and the system-flavoured problems', () => {
    expect(new Set(BANK.map((p) => p.id)).size).toBe(BANK.length)
    for (const p of BANK) {
      expect(p.tags.every((t) => BANK_TAGS.includes(t))).toBe(true)
      expect(p.hints.length).toBeGreaterThanOrEqual(3)
      expect([...p.tests.matchAll(/^def test_/gm)].length).toBeGreaterThanOrEqual(4)
    }
    expect(new Set(BANK.map((p) => p.level))).toEqual(new Set([1, 2, 3]))
    for (const tag of ['arrays', 'hashing', 'graphs', 'dp', 'system', 'payments'] as const) expect(BANK.some((p) => p.tags.includes(tag))).toBe(true)
    expect(BANK.map((p) => p.id)).toEqual(expect.arrayContaining(['lru-cache', 'token-bucket', 'ledger']))
  })

  it.skipIf(!python)('every reference passes all its hidden tests, and every starter fails them', () => {
    for (const p of BANK) {
      const ref = runTests(p.reference, p.tests)
      expect(Object.entries(ref).filter(([, v]) => v !== 'pass'), p.id).toEqual([])
      const starter = runTests(p.starter, p.tests)
      expect(Object.values(starter).every((v) => v !== 'pass'), `${p.id} starter passes a test`).toBe(true)
    }
  }, 120_000)

  it('the window never gets the reference, the tests or the hints', () => {
    const pub = publicProblem(BANK.find((p) => p.id === 'ledger')!)
    expect(pub).not.toHaveProperty('reference')
    expect(pub).not.toHaveProperty('tests')
    expect(pub).not.toHaveProperty('hints')
    expect(pub.hintCount).toBe(3)
    expect(pub.testNames).toContain('retry posts once')
  })

  it('picks at the level and tags asked for, avoiding recent problems', () => {
    const p = pickProblem({ level: 2, tags: ['graphs'], recent: [], seed: 1 })
    expect(p.tags).toContain('graphs')
    expect(p.level).toBe(2)
    const recent = BANK.filter((x) => x.level === 2 && x.tags.includes('graphs')).map((x) => x.id)
    const next = pickProblem({ level: 2, tags: ['graphs'], recent, seed: 1 })
    expect(recent).not.toContain(next.id)
    expect(next.tags).toContain('graphs')
    // Same seed, same problem
    expect(pickProblem({ level: 1, seed: 7 }).id).toBe(pickProblem({ level: 1, seed: 7 }).id)
  })

  it('moves the level with results', () => {
    expect(levelFrom([])).toBe(2)
    expect(levelFrom([0.9, 0.85])).toBe(3)
    expect(levelFrom([0.3, 0.2])).toBe(1)
    expect(levelFrom([0.9, 0.3])).toBe(2)
  })
})

// ---------- The clock and the break planner ----------

describe('the clock', () => {
  const c = { startedAt: 0, minutes: 45 }
  it('counts down and changes tone near the end', () => {
    expect(remainingMs(c, 15 * 60_000)).toBe(30 * 60_000)
    expect(clockText(remainingMs(c, 15 * 60_000))).toBe('30:00')
    expect(clockTone(c, 10 * 60_000)).toBe('calm')
    expect(clockTone(c, 41 * 60_000)).toBe('low')
    expect(clockTone(c, 46 * 60_000)).toBe('over')
    expect(clockText(0)).toBe('0:00')
  })

  it('tells the interviewer once at ten and once at five minutes left', () => {
    expect(timeCue(c, 30 * 60_000, [])).toBeNull()
    expect(timeCue(c, 35.5 * 60_000, [])).toBe(10)
    expect(timeCue(c, 36 * 60_000, [10])).toBeNull()
    expect(timeCue(c, 40.5 * 60_000, [10])).toBe(5)
    // A 15-minute mock gets no ten-minute warning
    expect(timeCue({ startedAt: 0, minutes: 15 }, 6 * 60_000, [])).toBeNull()
  })

  it('pauses the tea-break planner during the timed session, not the brief or debrief', () => {
    expect(mockStudyContext('live', 'LRU cache').noBreaks).toBe(true)
    expect(mockStudyContext('marking', 'LRU cache').noBreaks).toBe(true)
    expect(mockStudyContext('brief', 'LRU cache').noBreaks).toBe(false)
    expect(mockStudyContext('debrief', 'LRU cache').noBreaks).toBe(false)
    // A break that was due is not taken while the mock is live
    const T0 = 0
    let s = freshState(T0)
    for (let m = 0; m <= 46; m++) s = active(s, T0 + m * 60_000)
    s = addBoundary(s, { at: T0 + 45 * 60_000, kind: 'step', label: 'step' })
    expect(decide(s, T0 + 46 * 60_000, DEFAULT_BREAKS, { midQuestion: false }).kind).toBe('take')
    expect(decide(s, T0 + 46 * 60_000, DEFAULT_BREAKS, { midQuestion: false, noBreaks: mockStudyContext('live', 'x').noBreaks }).kind).toBe('none')
  })
})

// ---------- Opus's marks ----------

describe('reading the marker’s reply', () => {
  const rubric = RUBRICS.coding
  it('reads a clean reply', () => {
    const out = parseMockMarks(
      JSON.stringify({
        scores: rubric.map((r, i) => ({ id: r.id, score: i % 2 ? 3 : 4, note: `n${i}`, quote: 'seen = {}' })),
        moments: [{ quote: 'I think a dict works', note: 'Good: named the structure early.' }],
        modelAnswer: 'Use a dict.',
        practise: ['State complexity before coding'],
        summary: 'Solid.',
        verdict: 'Lean hire'
      }),
      rubric
    )!
    expect(out.scores.map((s) => s.score)).toEqual([4, 3, 4, 3, 4, 3])
    expect(out.overall).toBeCloseTo(0.875)
    expect(out.verdict).toBe('lean hire')
    expect(out.moments).toHaveLength(1)
  })

  it('copes with fences, trailing commas, an object of scores, "3/4" and out-of-range numbers', () => {
    const text = '```json\n{"scores": {"problem": {"score": "3/4", "note": "ok"}, "quality": 9, "testing": {"score": -1}, "Complexity": {"score": 2.3}, },\n "moments": [{"quote": "", "note": "dropped"}], "practise": ["a", "b"], "summary": "s",}\n```'
    const out = parseMockMarks(text, rubric)!
    const by = Object.fromEntries(out.scores.map((s) => [s.id, s.score]))
    expect(by.problem).toBe(3)
    expect(by.quality).toBe(4)
    expect(by.testing).toBe(0)
    expect(by.complexity).toBe(2.5)
    expect(by.communication).toBeNull()
    expect(out.moments).toEqual([])
    expect(out.verdict).toBeDefined()
  })

  it('is null for a reply that is not marks', () => {
    expect(parseMockMarks('I cannot mark this.', rubric)).toBeNull()
    expect(parseMockMarks('{"scores": []}', rubric)).toBeNull()
  })

  it('reads design annotations and puts them on the canvas beside their component', () => {
    const d = DESIGNS[0]
    const out = parseMockMarks(JSON.stringify({ scores: RUBRICS.design.map((r) => ({ id: r.id, score: 2 })), annotations: [{ node: 'Payments DB', note: 'Ledger and state in one transaction: good.' }, { node: 'Nowhere', note: 'Missing a queue.' }] }), RUBRICS.design)!
    const canvas = annotateCanvas(referenceCanvas(d), out.annotations!)
    const notes = canvas.nodes.filter((n) => n.kind === 'note')
    expect(notes).toHaveLength(2)
    expect(canvas.edges.some((e) => e.fromNode === notes[0].id)).toBe(true)
  })
})

// ---------- Marked in code ----------

describe('marking without Claude', () => {
  const p = BANK.find((x) => x.id === 'two-sum')!
  it('coding: the tests decide problem solving, communication is left unmarked', () => {
    const d = markCodingInCode({ problem: p, code: p.reference + '\n# O(n) time\n', passed: 5, total: 5, failed: [], runs: 2, hints: 0, said: [] })
    expect(d.by).toBe('code')
    const s = Object.fromEntries(d.scores.map((x) => [x.id, x.score]))
    expect(s.problem).toBe(4)
    expect(s.communication).toBeNull()
    expect(s.complexity).toBe(4)
    expect(s.hints).toBe(4)
    expect(d.modelAnswer).toContain('seen = {}')
    const weak = markCodingInCode({ problem: p, code: p.starter, passed: 0, total: 5, failed: ['first pair'], runs: 0, hints: 2, said: [] })
    const w = Object.fromEntries(weak.scores.map((x) => [x.id, x.score]))
    expect(w.problem).toBe(0)
    expect(w.quality).toBe(0)
    expect(w.hints).toBe(1)
    expect(weak.overall).toBeLessThan(0.2)
    expect(weak.practise.length).toBeGreaterThan(0)
  })

  it('measures loop nesting, stated complexity and quality', () => {
    expect(loopDepth('for i in a:\n    for j in a:\n        pass\n')).toBe(2)
    expect(loopDepth('x = [y for y in a]\nfor i in a:\n    pass\n')).toBe(1)
    expect(statedComplexity(['# this is O(n) time'], 'O(n)')).toBe('right')
    expect(statedComplexity(['I think O(n^2)'], 'O(n)')).toBe('other')
    expect(statedComplexity(['no idea'], 'O(n)')).toBeNull()
    expect(qualityInCode('def f(x):\n    a = 1\n    b = 2\n    d = 3\n    print(a)\n    return a\n', 'def f(x):\n    pass\n').score).toBeLessThan(4)
  })

  it('design: checklist coverage per area and the drawing against the reference', () => {
    const d = DESIGNS.find((x) => x.id === 'payment-processor')!
    const full = markDesignInCode(d, referenceCanvas(d), 'Idempotency keys stored with the result. 2,000 payments per second. Reconcile unknown outcomes after a timeout. Webhooks retried with backoff. Authorise and capture, refunds, PCI scope, 99.99% availability. Double-entry ledger with an outbox.', [])
    const empty = markDesignInCode(d, { nodes: [], edges: [] }, '', [])
    expect(full.overall).toBeGreaterThan(0.85)
    expect(empty.overall).toBe(0)
    expect(full.scores.find((s) => s.id === 'communication')!.score).toBeNull()
    expect(empty.practise.length).toBeGreaterThan(0)
  })

  it('quant: numbers, fractions, percentages, sizing ranges and finance points', () => {
    expect(parseNumber('6/36 = 1/6')).toBeCloseTo(1 / 6)
    expect(parseNumber('about 16.7%')).toBeCloseTo(0.167)
    expect(parseNumber('50M × 1.3 × 365 ≈ 24 billion')).toBeCloseTo(2.4e10)
    expect(parseNumber('£1,200')).toBe(1200)
    const dice = QUANT_BANK.find((q) => q.id === 'dice-sum-7')!
    expect(markQuant(dice, '1/6').verdict).toBe('right')
    expect(markQuant(dice, '0.2').verdict).toBe('wrong')
    const sizing = QUANT_BANK.find((q) => q.id === 'sizing-uk-card-payments')!
    expect(markQuant(sizing, '50M adults × 1.3 payments a day × 365 days ≈ 24 billion').score).toBe(1)
    expect(markQuant(sizing, '1 million').verdict).toBe('wrong')
    const fin = QUANT_BANK.find((q) => q.id === 'finance-settlement')!
    expect(markQuant(fin, 'Authorisation places a hold in real time; clearing exchanges the details in a batch; settlement is when funds move, net of interchange.').verdict).toBe('right')
    const paper = quantPaper(3)
    expect(paper.filter((q) => q.kind === 'mental')).toHaveLength(6)
    const d = markQuantInCode(paper, paper.map((q) => ({ id: q.id, text: q.answer !== undefined ? String(q.answer) : 'hold clearing settle funds', ms: 5000 })))
    expect(d.scores.find((s) => s.id === 'mental')!.score).toBe(4)
    expect(d.scores.find((s) => s.id === 'probability')!.score).toBe(4)
  })

  it('behavioural: STAR parts, I over we, numbers and reflection', () => {
    const story = 'At my last job the team was missing payouts. I needed to find why. I traced the job and I found a timezone bug, then I wrote a fix and a test. As a result failures went from 3% to 0.1%. I learned to check time zones first.'
    expect(starParts(story)).toEqual({ situation: true, task: true, action: true, result: true })
    const qs = BEHAVIOURAL.slice(0, 2)
    const good = markBehaviouralInCode(qs, qs.map((q) => ({ id: q.id, text: story, ms: 1 })))
    const thin = markBehaviouralInCode(qs, qs.map((q) => ({ id: q.id, text: 'We did a project and it went well.', ms: 1 })))
    expect(good.overall).toBeGreaterThan(thin.overall)
    expect(good.scores.find((s) => s.id === 'reflection')!.score).toBe(4)
  })
})

// ---------- What the debrief feeds ----------

const debrief = (scores: Record<string, number | null>, practise: string[] = []): MockDebrief => ({
  scores: Object.entries(scores).map(([id, score]) => ({ id, score, note: '' })),
  overall: 0.5,
  moments: [],
  modelAnswer: '',
  practise,
  summary: '',
  by: 'opus'
})

describe('the debrief feeds the profile, recall, the roadmap and the teaching measures', () => {
  it('profile: a strength, what didn’t land and hints, at most three changes', () => {
    const ops = profileOps({ mode: 'coding', title: 'LRU cache', debrief: debrief({ problem: 4, quality: 3, communication: 1, testing: 1, complexity: 2, hints: 1 }), rubric: RUBRICS.coding, hints: 2, at: new Date(2026, 10, 13).getTime() })
    expect(ops).toHaveLength(3)
    expect(ops[0]).toMatchObject({ do: 'add', section: 'strengths' })
    expect(ops[0].do === 'add' && ops[0].text).toContain('Problem solving')
    expect(ops.filter((o) => o.do === 'add' && o.section === 'missed')).toHaveLength(2)
  })

  it('recall: a coding miss comes back as a question on its pattern; quant misses as themselves', () => {
    const p = BANK.find((x) => x.id === 'coin-change')!
    const r = recallFrom({ mode: 'coding', title: p.title, debrief: debrief({ problem: 1, complexity: 3 }), problem: p })
    expect(r).toEqual([{ prompt: expect.stringContaining('Fewest coins'), topic: 'Dynamic programming' }])
    expect(recallFrom({ mode: 'coding', title: p.title, debrief: debrief({ problem: 4, complexity: 4 }), problem: p })).toEqual([])
    const q = QUANT_BANK.find((x) => x.id === 'ev-die-reroll')!
    expect(recallFrom({ mode: 'quant', title: 'Quant', debrief: debrief({}), quant: [{ q, right: false }] })).toEqual([{ prompt: q.prompt, topic: 'Expected value' }])
  })

  it('roadmap: adds under the mock’s heading, never twice, keeping ticked items', () => {
    const one = mergeRoadmap('', 'Coding interview', ['State complexity before coding', 'Two dp problems'], 'LRU cache, 13 Nov')
    expect(one).toContain('# Mock practice')
    expect(one).toContain('## Coding interview\n\n- [ ] State complexity before coding _(LRU cache, 13 Nov)_')
    const ticked = one.replace('- [ ] Two dp problems', '- [x] Two dp problems')
    const two = mergeRoadmap(ticked, 'Coding interview', ['two dp problems', 'Name variables well'], 'Ledger, 14 Nov')
    expect(two.match(/dp problems/gi)).toHaveLength(1)
    expect(two).toContain('- [x] Two dp problems')
    expect(two.indexOf('Name variables well')).toBeLessThan(two.length)
    const three = mergeRoadmap(two, 'System design', ['Put numbers on load'], 'Ledger service, 14 Nov')
    expect(three).toMatch(/## Coding interview[\s\S]*Name variables well[\s\S]*## System design\n\n- \[ \] Put numbers on load/)
  })

  it('lesson record: graded answers and hints the teaching measures can read', () => {
    const rec = mockLesson({
      id: 'mock-x',
      mode: 'quant',
      title: 'Quant',
      started: 1000,
      transcript: [
        { role: 'interviewer', text: 'Hello', at: 0 },
        { role: 'candidate', text: 'Hi', at: 1 }
      ],
      graded: [
        { question: 'P(sum is 7)?', answer: '1/6', score: 1, note: 'right' },
        { question: 'E[max of two dice]?', answer: '4', score: 0, note: 'wrong', hints: 1 }
      ]
    })
    expect(rec.mode).toBe('interview')
    const answers = lessonAnswers({ ...rec, private: false })
    expect(answers.map((a) => a.verdict)).toEqual(['correct', 'wrong'])
    expect(answers[1].hints).toBeGreaterThanOrEqual(1)
  })

  it('history: records, trend points oldest first, and the change from last time', () => {
    const mk = (at: number, overall: number, mode: MockRecord['mode'] = 'coding'): MockRecord => recordOf({ id: String(at), at, mode, title: 't', minutes: 45, usedMs: 40 * 60_000, debrief: { ...debrief({ problem: overall * 4 }), overall }, hints: 0 })
    const recs = [mk(3, 0.7), mk(1, 0.4), mk(2, 0.5), mk(4, 0.9, 'design')]
    expect(trendPoints(recs, 'coding').map((p) => p.score)).toEqual([0.4, 0.5, 0.7])
    expect(trendSummary(recs, 'coding')).toEqual({ count: 3, last: 0.7, best: 0.7, change: 0.2 })
    expect(trendSummary(recs, 'quant').count).toBe(0)
    expect(recs[0].used).toBe(40)
  })
})

// ---------- The mock exam ----------

describe('the mock exam', () => {
  it('is set on what was studied lately and what is weak, leaving out private and mock topics', () => {
    const now = Date.now()
    const day = 86_400_000
    const topics = examTopics({
      lessons: [
        { topic: 'Python generators', updated: now - day },
        { topic: 'Metabase dashboards', updated: now },
        { topic: 'Acme billing', updated: now, private: true },
        { topic: 'Mock coding: LRU cache', updated: now, mode: 'interview' },
        { topic: 'Very old topic', updated: now - 200 * day }
      ],
      concepts: [{ name: 'Bayes theorem', mastery: 0.1 }, { name: 'Python generators', mastery: 0.5 }],
      now
    })
    expect(topics[0]).toBe('Python generators')
    expect(topics).toContain('Bayes theorem')
    expect(topics.join(' ')).not.toMatch(/Metabase|Acme|LRU|Very old/)
  })

  it('a rubric item per question, and a debrief from the per-part marks', () => {
    const paper: ExamPaper = { title: 'T', instructions: '', topic: 'Bayes', minutes: 30, createdAt: 0, questions: [{ number: 1, text: 'Q1', parts: [{ label: 'a', text: 'a?', marks: 2, scheme: 's1' }, { label: 'b', text: 'b?', marks: 2, scheme: 's2' }] }, { number: 2, text: 'Q2', parts: [{ label: 'a', text: 'c?', marks: 4, scheme: 's3' }] }] }
    expect(rubricFor('exam', paper).map((r) => r.id)).toEqual(['q1', 'q2'])
    const d = examDebrief(paper, { '1:0': { awarded: 2, marks: 2, feedback: 'ok', missed: '' }, '1:1': { awarded: 0, marks: 2, feedback: 'no', missed: 'the base rate' }, '2:0': { awarded: 4, marks: 4, feedback: 'ok', missed: '' } })
    expect(d.overall).toBeCloseTo(0.75)
    expect(d.scores.map((s) => s.score)).toEqual([2, 4])
    expect(d.practise).toEqual(['the base rate'])
    expect(d.modelAnswer).toContain('s2')
  })
})

// ---------- The interviewer's prompts ----------

describe('the interviewer', () => {
  it('knows the hidden material and the hint ladder; each message carries the state of the room', () => {
    const p = BANK.find((x) => x.id === 'lru-cache')!
    const sys = interviewerSystem({ mode: 'coding', minutes: 45, problem: p })
    expect(sys).toContain('OrderedDict')
    expect(sys).toContain('[hint]')
    expect(sys).toContain(p.hints[2])
    const msg = interviewerMessage('Is capacity ever zero?', { elapsedMin: 3.2, leftMin: 41.8, code: 'class LRUCache: ...', tests: { passed: 2, total: 4, failed: ['capacity one'] } })
    expect(msg).toMatch(/^\[3 min in, 42 left\]/)
    expect(msg).toContain('2 of 4 passed')
    expect(msg).toContain('They say: "Is capacity ever zero?"')
    const d = interviewerSystem({ mode: 'design', minutes: 45, design: DESIGNS[2] })
    expect(d).toContain('idempotency')
  })
})

// ---------- main/mocks: the whole flow, with stand-ins for Claude and the sandbox ----------

const dir = mkdtempSync(join(tmpdir(), 'tide-mocks-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false }, ipcMain: { handle: () => {} } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: dir, ai: {}, whyMode: 'off' }) }))
const kept: { prompt: string; topic: string; lesson: string }[][] = []
vi.mock('../src/main/recall', () => ({ keepForRecall: async (items: { prompt: string; topic: string; lesson: string }[]) => void kept.push(items) }))
const evidence: { topic: string; kind: string }[] = []
vi.mock('../src/main/knowledge', () => ({ noteEvidence: async (e: { topic: string; kind: string }) => void evidence.push(e), knowledgeView: async () => ({ concepts: [{ name: 'Bayes theorem', seen: 2, estimate: 0.2, private: false }] }) }))
const lessons: unknown[] = []
vi.mock('../src/main/lessons', () => ({ saveLesson: async (r: unknown) => (lessons.push(r), { id: 'x' }), listLessons: async () => [{ topic: 'Python generators', updated: Date.now(), mode: 'teach', scope: { kind: 'none' } }] }))
vi.mock('../src/main/projects', () => ({ privatePath: async () => false }))
const exams: { topic: string; opts: unknown }[] = []
vi.mock('../src/main/exam', () => ({
  generateExam: async (_s: unknown, topic: string, opts: { minutes: number }) => {
    exams.push({ topic, opts })
    return { title: 'Paper', instructions: '', topic, minutes: opts.minutes, createdAt: 0, questions: [{ number: 1, text: '', parts: [{ label: 'a', text: 'State Bayes theorem.', marks: 2, scheme: 'P(A|B) = …' }] }] }
  }
}))

const M = await import('../src/main/mocks')

function standIns(o: { claude: boolean; mark?: string; pass?: (code: string) => boolean }) {
  const calls = { interview: [] as string[], mark: 0 }
  M.setMockModels({
    ready: async () => (o.claude ? { ready: true } : { ready: false, why: 'not installed' }),
    async *interview(prompt) {
      calls.interview.push(prompt)
      yield 'What is the '
      yield 'complexity?'
    },
    mark: async () => {
      calls.mark++
      if (!o.mark) throw new Error('no')
      return o.mark
    },
    run: async (code, tests) => {
      const names = [...tests.matchAll(/^def\s+(test\w*)/gm)].map((m) => m[1])
      const ok = o.pass?.(code) ?? false
      return { stdout: '', stderr: '', exitCode: ok ? 0 : 1, timedOut: false, durationMs: 1, tests: { passed: ok ? names : names.slice(1), failed: ok ? [] : [{ name: names[0], message: 'E   assert None == [0, 1]' }] } }
    }
  })
  return calls
}

describe('a mock from start to debrief', () => {
  beforeEach(() => {
    kept.length = 0
    evidence.length = 0
    lessons.length = 0
  })

  it('without Claude: a bank problem, hidden tests, bank hints, marked in code, and the debrief fed on', async () => {
    standIns({ claude: false, pass: (c) => c.includes('seen') })
    const m = await M.startMock({ mode: 'coding', minutes: 30, ref: 'two-sum' })
    expect(m.interviewer).toBe(false)
    expect(m.why).toBe('not installed')
    expect(m.problem!.title).toBe('Two sum')
    expect(JSON.stringify(m)).not.toContain('seen[x] = j')
    await expect(M.say(null, m.id, 'hello')).rejects.toThrow(/needs Claude/)
    const h = await M.hint(null, m.id)
    expect(h).toEqual({ text: BANK[0].hints[0], hints: 1 })
    const first = await M.runHiddenTests(m.id, 'def two_sum(n, t):\n    return None\n')
    expect(first.failed[0]).toEqual({ name: 'first pair', why: 'assert None == [0, 1]' })
    const end = await M.endMock(m.id, { code: BANK[0].reference })
    expect(end.debrief.by).toBe('code')
    expect(end.debrief.scores.find((s) => s.id === 'problem')!.score).toBe(4)
    expect(end.debrief.scores.find((s) => s.id === 'communication')!.score).toBeNull()
    expect(end.record.hints).toBe(1)
    expect(end.fed.lesson).toBe(true)
    // History, the full record, the learner profile and the lesson
    const history = await M.mockHistory()
    expect(history.at(-1)).toMatchObject({ id: m.id, mode: 'coding', ref: 'two-sum' })
    expect(existsSync(join(dir, '.tide/mocks', `${m.id}.json`))).toBe(true)
    expect((lessons[0] as { mode: string }).mode).toBe('interview')
    expect(evidence[0]).toMatchObject({ topic: 'Two sum', kind: 'right' })
    await expect(M.endMock(m.id, {})).rejects.toThrow(/ended/)
  })

  it('with Claude: the interviewer streams, hints cost points, Opus marks held to the facts, and it feeds recall, the roadmap and the profile', async () => {
    const opus = JSON.stringify({
      scores: RUBRICS.coding.map((r) => ({ id: r.id, score: r.id === 'complexity' ? 2 : 4, note: 'fine', quote: 'q' })),
      moments: [{ quote: 'I would use a dict', note: 'Named the idea early.' }],
      modelAnswer: 'Use a dict.',
      practise: ['Coin change without hints', 'State complexity first'],
      summary: 'Good.',
      verdict: 'hire'
    })
    const calls = standIns({ claude: true, mark: opus, pass: () => false })
    const m = await M.startMock({ mode: 'coding', minutes: 45, ref: 'coin-change' })
    expect(m.interviewer).toBe(true)
    const deltas: string[] = []
    const owner = { isDestroyed: () => false, send: (_c: string, e: { delta: string }) => deltas.push(e.delta) } as unknown as import('electron').WebContents
    expect(await M.say(owner, m.id, '[start] hello')).toBe('What is the complexity?')
    expect(deltas.join('')).toBe('What is the complexity?')
    await M.say(owner, m.id, 'Can the amount be zero?', { code: 'def coin_change(c, a):\n    pass' })
    expect(calls.interview[1]).toContain('They say: "Can the amount be zero?"')
    expect(calls.interview[1]).toContain('You (interviewer): What is the complexity?')
    await M.hint(owner, m.id, {})
    await M.hint(owner, m.id, {})
    const end = await M.endMock(m.id, { code: 'def coin_change(c, a):\n    return -1\n' })
    expect(calls.mark).toBe(1)
    expect(end.debrief.by).toBe('opus')
    const s = Object.fromEntries(end.debrief.scores.map((x) => [x.id, x.score]))
    // Opus said 4 for both; 4 of 5 tests passed and two hints were taken, so it can't stand
    expect(s.problem).toBe(3.5)
    expect(s.hints).toBe(1)
    expect(end.fed.roadmap).toBe(2)
    expect(readFileSync(join(dir, 'Coach/Mock practice.md'), 'utf8')).toContain('- [ ] Coin change without hints _(Fewest coins')
    expect(kept.flat()[0]).toMatchObject({ topic: 'Dynamic programming', lesson: `mock-${m.id}` })
    expect(end.fed.profile).toBeGreaterThan(0)
    expect(readFileSync(join(dir, 'Coach/About me as a learner.md'), 'utf8')).toMatch(/mock coding interview/i)
  })

  it('Opus failing falls back to marking in code', async () => {
    standIns({ claude: true, pass: () => true })
    const m = await M.startMock({ mode: 'design', minutes: 45, ref: 'url-shortener' })
    const end = await M.endMock(m.id, { canvas: referenceCanvas(DESIGNS.find((d) => d.id === 'url-shortener')!), notes: 'read heavy 100:1, base62 keys, cache, 4,000 redirects per second, unique constraint, same code dedup, async queue for clicks, 302' })
    expect(end.debrief.by).toBe('code')
    expect(end.debrief.overall).toBeGreaterThan(0.8)
  })

  it('quant: answers checked in code, follow-ups from the interviewer except on mental maths', async () => {
    const calls = standIns({ claude: true })
    const m = await M.startMock({ mode: 'quant', minutes: 30 })
    expect(m.quant!.some((q) => 'answer' in q || 'solution' in q)).toBe(false)
    const mental = m.quant!.find((q) => q.kind === 'mental')!
    expect(await M.answerQuant(null, m.id, mental.id, '12')).toEqual({})
    const prob = m.quant!.find((q) => q.kind === 'probability' || q.kind === 'ev')!
    const r = await M.answerQuant(null, m.id, prob.id, '0.5')
    expect(r.followUp).toBe('What is the complexity?')
    expect(calls.interview.at(-1)).toContain("Tide's check of their answer")
    const end = await M.endMock(m.id, { answers: m.quant!.map((q) => ({ id: q.id, text: '0', ms: 3000 })) })
    expect(end.debrief.by).toBe('code')
  })

  it('the mock exam: a mixed paper on what was studied, marked per part, the misses kept for recall', async () => {
    standIns({ claude: true })
    const m = await M.startMock({ mode: 'exam', minutes: 45 })
    expect(exams.at(-1)!.topic).toMatch(/Python generators.*Bayes theorem|Bayes theorem.*Python generators/)
    expect(exams.at(-1)!.opts).toMatchObject({ style: 'mixed', minutes: 45 })
    expect(m.interviewer).toBe(false)
    expect(m.exam!.questions).toHaveLength(1)
    const end = await M.endMock(m.id, { examMarks: { '1:0': { awarded: 1, marks: 2, feedback: 'Half', missed: 'the denominator' } }, answers: [{ id: '1:0', text: 'P(A|B)=P(B|A)', ms: 0 }] })
    expect(end.debrief.by).toBe('examiner')
    expect(end.debrief.overall).toBe(0.5)
    expect(kept.flat()[0].prompt).toBe('State Bayes theorem.')
  })

  it('the marker never scores problem solving above what the tests allow', () => {
    const d = M.holdToFacts(debrief({ problem: 4, hints: 4, quality: 3 }), { share: 0.4, hints: 1 })
    const s = Object.fromEntries(d.scores.map((x) => [x.id, x.score]))
    expect(s.problem).toBe(2)
    expect(s.hints).toBe(2.5)
    expect(s.quality).toBe(3)
  })
})
