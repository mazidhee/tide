import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { LessonRecord } from '../src/shared/lessonLog'
import type { ToolContext } from '../src/main/agent'

/**
 * The learning event log and the learner model through the app's own code: a vault on disk with
 * records from before the log, each feature's writer, the read-in, the model, Claude's tools and
 * your corrections; and the feature's own files left as they were.
 */

const DAY = 86_400_000
const root = mkdtempSync(join(tmpdir(), 'tide-model-'))
const vault = join(root, 'vault')
const tide = join(vault, '.tide')
mkdirSync(join(tide, 'lessons'), { recursive: true })
mkdirSync(join(tide, 'reading'), { recursive: true })
mkdirSync(join(vault, 'Quant'), { recursive: true })
writeFileSync(join(vault, 'Quant', 'Notes.md'), '# Notes\n')
writeFileSync(join(vault, 'Quant', 'Roadmap.md'), '# Quant\n\n## Foundations\n- [ ] Probability\n- [ ] Value at risk (needs: Probability)\n- [ ] Logistic regression\n')
writeFileSync(join(tide, 'notebooks.json'), JSON.stringify({ Quant: { outline: 'Quant/Roadmap.md' } }))

const T = Date.now() - 10 * DAY
const ask = (q: string, attrs = '', type = 'problem') => `Here is one.\n\n<ask type="${type}"${attrs}>${q}</ask>`
const grade = (v: 'correct' | 'partial' | 'wrong') => `<grade verdict="${v}" score="${v === 'correct' ? 1 : v === 'partial' ? 0.5 : 0}">Because.</grade>`
const lesson = (id: string, topic: string, at: number, verdicts: ('correct' | 'partial' | 'wrong')[], over: Partial<LessonRecord> = {}): LessonRecord => {
  const turns: LessonRecord['turns'] = [{ role: 'user', content: `Teach me ${topic}.` }, { role: 'assistant', content: ask('Q0') }]
  verdicts.forEach((v, i) => {
    turns.push({ role: 'user', content: `Answer: a${i}` })
    turns.push({ role: 'assistant', content: `${grade(v)}\n\n${ask(`Q${i + 1}`)}` })
  })
  return { id, mode: 'teach', topic, scope: { kind: 'folder', path: 'Quant' }, started: at, updated: at + 600_000, turns, finished: true, ...over }
}

// Records from before the log
writeFileSync(join(tide, 'lessons', 'prob-old.json'), JSON.stringify(lesson('prob-old', 'Probability', T, ['correct', 'correct', 'partial'])))
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
writeFileSync(
  join(tide, 'attempts.jsonl'),
  jsonl([
    // The old lesson's own answer: in its record, not counted again
    { at: T + 60_000, topic: 'Probability', mode: 'teach', verdict: 'correct', score: 1 },
    // An exam answer, kept nowhere else
    { at: T + 2 * DAY, topic: 'Logistic regression', mode: 'quiz', verdict: 'correct', score: 1, confidence: 3 }
  ])
)
writeFileSync(join(tide, 'focus.jsonl'), jsonl([{ start: T, end: T + 25 * 60_000, minutes: 25, label: 'teach: Probability', kind: 'lesson' }]))
writeFileSync(join(tide, 'workout.jsonl'), jsonl([{ id: 'w1', morning: 'm1', at: T + DAY, day: '2026-11-03', round: 'odds', championship: false, items: [{ kind: 'odds', difficulty: 1000, prompt: 'p', given: '1', shown: '1', right: true, score: 1, ms: 4000 }] }]))
writeFileSync(join(tide, 'mental-maths.jsonl'), jsonl([{ id: 'mm1', at: T + DAY, day: '2026-11-03', focus: 'times', answers: [{ level: 'times', prompt: '7x8', answer: '56', given: '56', right: true, ms: 2000, how: '' }] }]))
writeFileSync(join(tide, 'mocks.jsonl'), jsonl([{ id: 'mk1', at: T + 3 * DAY, mode: 'quant', title: 'Quant screen', minutes: 45, used: 40, overall: 0.6, scores: {}, hints: 0, by: 'claude' }]))
writeFileSync(join(tide, 'mistakes.json'), JSON.stringify([{ id: 'x1', at: T + DAY, topic: 'Probability', source: 'quiz', question: 'P(A or B)?', fix: 'Subtract the overlap', status: 'open', streak: 0, due: '2026-11-20' }]))
writeFileSync(join(tide, 'reading', 'room.json'), JSON.stringify({ goal: { weeklyMinutes: 140 }, books: [{ path: 'Library/Books/Risk.epub', title: 'Risk', kind: 'epub', added: '2026-11-01', days: { '2026-11-02': 30, '2026-11-03': 12.5 } }] }))

vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {} } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {}, coach: {} }), updateSettings: () => {} }))

const log = await import('../src/main/learningLog')
const { backfillOnce } = await import('../src/main/learningBackfill')
const model = await import('../src/main/learnerModel')
const { saveLesson } = await import('../src/main/lessons')
const { recordAttempt, logFocus, logDrill, logInterview } = await import('../src/main/learn')
const { noteEvidence, conceptOfTopic } = await import('../src/main/knowledge')

/** Every file under .tide but the log, with its hash */
const snapshot = (dir = tide): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (p.endsWith('learning.db') || p.endsWith('learning.db-journal')) continue
    if (statSync(p).isDirectory()) Object.assign(out, snapshot(p))
    else out[p] = createHash('sha1').update(readFileSync(p)).digest('hex')
  }
  return out
}

const ctx = (): ToolContext => ({ signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => 's', updateStep: () => {}, web: false, labId: 'test', chatId: undefined }) as ToolContext

afterAll(() => log.close())

describe('reading in what was recorded before the log', () => {
  it('reads every kind of record once, and touches none of them', async () => {
    // The knowledge map exists first (it reads its own records in), as in the app
    await conceptOfTopic('Probability')
    const before = snapshot()
    const stats = await backfillOnce()
    expect(stats).not.toBeNull()
    expect(stats!.bySource).toMatchObject({ lessons: 3, attempts: 1, focus: 1, workout: 1, 'mental maths': 1, mocks: 1, mistakes: 1, reading: 2 })
    const counts = log.eventCounts()
    expect(counts).toMatchObject({ answered: 4, studied: 1, workout: 2, mock: 1, misconception_seen: 1, read: 2 })
    // Once: a second run does nothing, a forced one adds nothing new
    expect(await backfillOnce()).toBeNull()
    const n = Object.values(log.eventCounts()).reduce((a, b) => a + b, 0)
    await backfillOnce(true)
    expect(Object.values(log.eventCounts()).reduce((a, b) => a + b, 0)).toBe(n)
    // The features' own files are exactly as they were
    expect(snapshot()).toEqual(before)
  })
})

describe('each feature writes its events', () => {
  const keys = () => log.readEvents().map((e) => e.key)

  it('a lesson, saved and saved again, says what it shows now', async () => {
    const r = lesson('var-1', 'Value at risk', Date.now() - DAY, ['correct', 'wrong'])
    await saveLesson({ id: r.id, mode: r.mode, topic: r.topic, scope: r.scope, turns: r.turns, finished: true })
    expect(keys().filter((k) => k.startsWith('lesson:var-1#'))).toHaveLength(2)
    // One more answer, and the second mark changed on a second look
    const turns = [...r.turns.slice(0, -1), { role: 'assistant' as const, content: `${grade('partial')}\n\n${ask('Q2')}` }, { role: 'user' as const, content: 'Answer: z' }, { role: 'assistant' as const, content: `${grade('correct')}\n\n${ask('Q3')}` }]
    await saveLesson({ id: r.id, mode: r.mode, topic: r.topic, scope: r.scope, turns, finished: true })
    const mine = log.readEvents().filter((e) => e.key.startsWith('lesson:var-1#'))
    expect(mine.map((e) => e.outcome)).toEqual(['correct', 'partial', 'correct'])
  })

  it('answers, focus, drills, interviews, workout rounds and mental maths', async () => {
    await recordAttempt({ topic: 'Probability', mode: 'recall', verdict: 'correct', score: 1 })
    // An answer kept in a lesson record is read from there, not here
    await recordAttempt({ topic: 'Probability', mode: 'teach', verdict: 'correct', score: 1, lesson: 'x' })
    await logFocus(Date.now() - 30 * 60_000, Date.now(), { label: 'teach: Value at risk', kind: 'lesson' })
    await logDrill({ kind: 'zetamac', correct: 30, attempted: 33, seconds: 120, perOp: {} })
    await logInterview({ company: 'Jane Street', round: 'quant', score: 0.7, timed: true, minutes: 30 })
    const { logWorkoutRound } = await import('../src/main/workout')
    await logWorkoutRound({ morning: 'm2', round: 'speed', championship: false, items: [{ kind: 'add', difficulty: 1000, prompt: '2+2', given: '4', shown: '4', right: true, score: 1, ms: 1500 }] } as never)
    const { logMathsSession } = await import('../src/main/mentalMaths')
    const { LEVELS } = await import('../src/shared/mentalMaths')
    await logMathsSession({ focus: LEVELS[0].id, answers: [{ level: LEVELS[0].id, prompt: '3x4', answer: '12', given: '12', right: true, ms: 1000, how: '' }] } as never)
    const evs = log.readEvents({ since: Date.now() - 60 * 60_000 })
    const sources = evs.map((e) => `${e.kind}/${e.source}`)
    expect(sources).toEqual(expect.arrayContaining(['recalled/recall', 'studied/focus-lesson', 'workout/drills', 'mock/interview', 'workout/workout', 'workout/mental-maths']))
    expect(evs.filter((e) => e.kind === 'recalled' && e.source === 'recall')).toHaveLength(1)
  })

  it('evidence through the knowledge map: a project built, a mock item, a warm-up, a Claude mark', async () => {
    const at = Date.now()
    await noteEvidence({ topic: 'Value at risk', kind: 'right', source: 'project:Code/risk', pos: 'm1', at })
    await noteEvidence({ topic: 'Probability', kind: 'partly', source: 'mock:mk2', pos: 'q0', at })
    await noteEvidence({ topic: 'Probability', kind: 'right', source: 'claude:1', pos: '0', at })
    const { noteReviewAnswer } = await import('../src/main/knowledge')
    const p = (await conceptOfTopic('Probability'))!
    await noteReviewAnswer({ concept: p, source: `warmup:${p}`, pos: String(at), kind: 'recalled-right', at })
    await noteReviewAnswer({ concept: p, source: `phasecheck:ph1:${at}`, pos: 'q0', kind: 'recalled-wrong', at })
    await noteReviewAnswer({ concept: p, source: `coursecheck:c1`, pos: 'q0', kind: 'right', at })
    const evs = log.readEvents({ since: at })
    expect(evs.map((e) => `${e.kind}/${e.source}`).sort()).toEqual(['answered/claude', 'answered/course', 'answered/phasecheck', 'built/project', 'mock/mock', 'recalled/warmup'])
    expect(evs.every((e) => e.concepts.length === 1)).toBe(true)
  })

  it('mistakes seen and resolved, a course lesson studied', async () => {
    const { addMistakes, retestMistake, listMistakes } = await import('../src/main/mistakes')
    await addMistakes([{ topic: 'Logistic regression', source: 'quiz', question: 'What does the sigmoid output?', fix: 'A probability between 0 and 1', path: 'Quant' } as never])
    const m = (await listMistakes()).find((x) => x.topic === 'Logistic regression')!
    expect(log.hasEvent(`mistake:${m.id}:seen`)).toBe(true)
    // Right on two different days fixes it; here, retested until it is
    for (let i = 0; i < 4 && (await listMistakes()).find((x) => x.id === m.id)!.status !== 'fixed'; i++) await retestMistake(m.id, true)
    const fixed = (await listMistakes()).find((x) => x.id === m.id)!
    expect(log.hasEvent(`mistake:${m.id}:fixed`)).toBe(fixed.status === 'fixed')
    const { markLesson } = await import('../src/main/courses')
    await markLesson('zoomcamp', '01-intro/README.md', true).catch(() => null)
    expect(log.hasEvent('course:zoomcamp#01-intro/README.md.studied')).toBe(true)
  })

  it('an act from the window: an explorable’s "Tell the tutor"', async () => {
    model.eventFromWindow({ key: 'explorable:1', kind: 'explained', source: 'explorable', topic: 'Probability', note: 'From the explorable: two dice' })
    // Only learning acts come in from the window
    model.eventFromWindow({ key: 'sneaky', kind: 'corrected', source: 'window', data: { depth: 6 } })
    expect(log.hasEvent('explorable:1')).toBe(true)
    expect(log.hasEvent('sneaky')).toBe(false)
  })
})

describe('the model, its tools and your corrections', () => {
  it('shows depth from the evidence, with the evidence behind it', async () => {
    model._resetModel()
    const v = await model.modelView(true)
    expect(v.events).toBeGreaterThan(10)
    const prob = [...v.other, ...v.goals.flatMap((g) => g.concepts)].find((n) => n.name === 'Probability')!
    expect(prob.depth).toBeGreaterThanOrEqual(3)
    const d = (await model.nodeDetail(prob.id))!
    expect(d.levels.find((l) => l.level === 3)!.reached).toBe(true)
    expect(d.recent.length).toBeGreaterThan(3)
    expect(d.usedIn.map((n) => n.name)).toContain('Value at risk')
    expect(v.skills.find((s) => s.id === 'skill:estimation')!.events).toBeGreaterThan(0)
  })

  it('takes a correction as an event, and North Star’s targets and goals', async () => {
    const lr = (await conceptOfTopic('Logistic regression'))!
    const d = (await model.correctJudgement(lr, 4, 'I use it at work'))!
    expect(d.node.depth).toBe(4)
    expect(d.corrected).toMatchObject({ depth: 4, note: 'I use it at work' })
    expect(log.readEvents({ kinds: ['corrected'] })).toHaveLength(1)
    model.setTargetsFrom('northstar', [{ node: 'Value at risk', depth: 6, goal: 'star' }])
    model.registerGoals('northstar', [{ id: 'star', title: 'Quant researcher', concepts: ['Value at risk', 'Probability'] }])
    model.setTarget('proof', 3)
    model._resetModel()
    const v = await model.modelView(true)
    const star = v.goals.find((g) => g.name === 'Quant researcher')!
    expect(star.concepts.map((c) => c.name).sort()).toEqual(['Probability', 'Value at risk'])
    expect(star.concepts.find((c) => c.name === 'Value at risk')!.target).toBe(6)
    expect(v.skills.find((s) => s.id === 'skill:proof')!.target).toBe(3)
    const weak = await model.weakestForGoal('Quant researcher')
    expect(weak!.weakest[0].name).toBe('Value at risk')
  })

  it('answers Claude’s questions through its tools, gated to the sessions that need them', async () => {
    const { toolsFor } = await import('../src/main/tideMcp')
    const { packsHeader, toolPacks } = await import('../src/shared/tutorGuide')
    const names = async (packs: string) => (await toolsFor('lesson:x', packs)).map((t) => t.name)
    const lessonTools = await names(packsHeader(toolPacks({ kind: 'lesson' })))
    expect(lessonTools).toContain('learner_standing')
    expect(lessonTools).not.toContain('learner_model')
    const coach = await names(packsHeader(toolPacks({ kind: 'coach' })))
    expect(coach).toContain('learner_model')
    const thread = await names(packsHeader(toolPacks({ kind: 'thread' })))
    expect(thread).not.toContain('learner_model')
    expect(thread).not.toContain('learner_standing')

    const tool = model.MODEL_TOOLS[0]
    const run = (args: Record<string, unknown>) => tool.run(args, ctx())
    expect(await run({ ask: 'standing', topic: 'Probability' })).toMatch(/^Probability \(Quant\): depth \d/)
    expect(await run({ ask: 'used_in', topic: 'Probability' })).toContain('Value at risk')
    expect(await run({ ask: 'weakest', goal: 'Quant researcher' })).toContain('Value at risk')
    expect(await run({ ask: 'weakest', goal: 'Nope' })).toContain('No goal called')
    expect(await run({ ask: 'recent', limit: 3 })).toMatch(/^- \d{4}-\d{2}-\d{2}/)
    expect(await run({ ask: 'fading' })).toBeTruthy()
    expect(await run({ ask: 'transfer_gaps' })).toBeTruthy()
    expect(await run({ ask: 'digest' })).toContain('Quant researcher')
    const compact = await model.STANDING_TOOL.run({ topic: 'Probability' }, ctx())
    expect(compact.length).toBeLessThanOrEqual((await run({ ask: 'standing', topic: 'Probability' })).length)
  })

  it('keeps Claude’s proposed links, drops names not on the map, and asks each concept once', async () => {
    const { model: m } = await model.learnerModel(true)
    let asked = 0
    model.setLinkAsker(async (prompt) => {
      asked++
      expect(prompt).toContain('Probability')
      return JSON.stringify({ used_in: [['Logistic regression', 'Value at risk'], ['Probability', 'Quantum gravity']], skills: { Probability: ['estimation', 'not-a-skill'] } })
    })
    const n = await model.proposeLinks(m, true)
    expect(n).toBe(2)
    expect(log.readLinks().map((l) => `${l.kind}:${l.origin}`).sort()).toEqual(['exercises:claude', 'used_in:claude'])
    expect(await model.proposeLinks(m, true)).toBe(0)
    expect(asked).toBe(1)
    // Without Claude: nothing asked, the heuristics stand
    model.setLinkAsker(async () => null)
    model._resetModel()
    const again = (await model.learnerModel(true)).model
    expect(again.edges.some((e) => e.kind === 'used_in' && e.origin === 'heuristic')).toBe(true)
    model.setLinkAsker(null)
  })
})
