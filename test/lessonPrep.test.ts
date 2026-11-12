import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

// A scratch vault; everything a prep touches beyond it is stubbed here
const dir = mkdtempSync(join(tmpdir(), 'tide-prep-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false }, powerMonitor: { getSystemIdleTime: () => 0 } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: dir, ai: { webSearch: { provider: 'off' } }, whyMode: 'off', prep: {} }) }))
const PLAN = { weekStart: '2026-11-12', createdAt: 1, summary: '', priorities: [], days: [{ date: '2026-11-13', items: [{ kind: 'learn', title: 'Two’s complement', topic: 'Two’s complement', notebook: 'Software engineering', minutes: 40, why: 'It builds on binary, which you have now.' }] }] }
vi.mock('../src/main/coach', () => ({
  getCoach: async () => ({ goal: '', focus: ['Software engineering'], days: [1, 2, 3, 4, 5], hoursPerWeek: 10 }),
  getWeek: async (date: string) => (date === '2026-11-13' ? PLAN : null),
  profilePrompt: async () => 'What Tide knows about this learner:\n- Preferences they stated (follow them): Let me move on when I have shown it.',
  weekReview: async () => ({ minutes: 225, days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${String(6 + i).padStart(2, '0')}`, minutes: [30, 0, 45, 60, 0, 50, 40][i] })) })
}))
vi.mock('../src/main/lessons', () => ({ earlierLessons: async () => 'Earlier: Binary numbers, 5 of 7 right.' }))
vi.mock('../src/main/recall', () => ({ recallItems: () => [{ id: 'r1', prompt: 'What does the top bit mean in two’s complement?', topic: 'Two’s complement', due: 0 }] }))
vi.mock('../src/main/warmup', () => ({ warmupFor: async () => ({ topic: 'Two’s complement', cards: [{ concept: 'c1', conceptName: 'Binary numbers', from: 'From Binary numbers', question: 'What is 1011 in decimal?', item: null, estimate: 0.55 }], concepts: [{ name: 'Binary numbers', estimate: 0.55, status: 'fading' }] }) }))
vi.mock('../src/main/books', () => ({ pagesToRead: async () => [] }))
vi.mock('../src/main/sources', () => ({ packFor: async () => ({ topic: 'Two’s complement', at: Date.now(), sources: [{ n: 1, title: 'Two’s complement (Cornell CS 3410 notes)', url: 'https://example.edu/twos', text: 'Negate by inverting and adding one.' }] }), buildPack: async () => null }))
vi.mock('../src/main/readings', () => ({ readingsFor: async () => [] }))
vi.mock('../src/main/projects', () => ({ privatePath: async (p: string) => p.startsWith('Acme') }))
vi.mock('../src/main/learn', () => ({ getNotebooks: async () => [{ name: 'Software engineering', path: 'Software engineering' }, { name: 'Acme', path: 'Acme', project: { private: true } }] }))
vi.mock('../src/main/teacher', () => ({ privateText: async (t: string) => (/metabase/i.test(t) ? 'metabase' : /acme/i.test(t) ? 'private' : null) }))
vi.mock('../src/main/ai', () => ({ lessonPassage: async () => null, jobRoute: async () => ({ who: 'claude', role: 'hard' }) }))
const banked: { id: string; topic: string }[] = []
vi.mock('../src/main/bank', () => ({ readBank: async () => [], addToBank: async (topic: string, ps: { id: string }[]) => void banked.push(...ps.map((p) => ({ id: p.id, topic }))) }))
vi.mock('../src/main/knowledge', () => ({
  allConcepts: async () => [
    { name: 'Binary numbers', status: 'solid', lastRight: new Date(2026, 10, 11).getTime(), estimate: 0.95 },
    { name: 'Bitwise AND', status: 'fading', estimate: 0.52 }
  ]
}))
vi.mock('../src/main/mentalMaths', () => ({
  mathsState: async () => ({
    sessions: [
      { id: 's0', at: new Date(2026, 10, 2).getTime(), day: '2026-11-02', focus: 'times-11', answers: Array.from({ length: 10 }, (_, i) => ({ level: 'times-11', prompt: '', answer: '', given: '', right: i < 7, ms: 6000, how: '' })) },
      { id: 's1', at: new Date(2026, 10, 10).getTime(), day: '2026-11-10', focus: 'times-11', answers: Array.from({ length: 10 }, (_, i) => ({ level: 'times-11', prompt: '', answer: '', given: '', right: i < 9, ms: 4000, how: '' })) }
    ]
  })
}))

const S = await import('../src/shared/lessonPrep')
const M = await import('../src/main/lessonPrep')
const { parseBlocks } = await import('../src/shared/session')

const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m).getTime()
const base = (o: Partial<import('../src/shared/lessonPrep').PrepInput> = {}): import('../src/shared/lessonPrep').PrepInput => ({
  now: at(23),
  settings: S.DEFAULT_PREP,
  idleSeconds: 0,
  busy: false,
  claude: { ready: true },
  usedTonight: 0,
  ready: false,
  target: true,
  ...o
})

describe('when prep runs', () => {
  it('runs overnight, or in the day once you have been away a while, never mid-lesson', () => {
    expect(S.shouldPrep(base())).toEqual({ run: true, claude: true, why: 'Overnight' })
    expect(S.shouldPrep(base({ now: at(3) })).run).toBe(true)
    expect(S.shouldPrep(base({ now: at(15) }))).toEqual({ run: false, why: 'Waiting for the night, or for you to be away' })
    expect(S.shouldPrep(base({ now: at(15), idleSeconds: 25 * 60 }))).toEqual({ run: true, claude: true, why: 'While you were away' })
    expect(S.shouldPrep(base({ now: at(15), idleSeconds: 25 * 60, settings: { ...S.DEFAULT_PREP, whenIdle: false } })).run).toBe(false)
    expect(S.shouldPrep(base({ busy: true })).run).toBe(false)
    expect(S.shouldPrep(base({ settings: { ...S.DEFAULT_PREP, on: false } })).run).toBe(false)
  })

  it('does nothing when a lesson is ready, nothing is planned, or it tried a little while ago', () => {
    expect(S.shouldPrep(base({ ready: true }))).toEqual({ run: false, why: 'Your next lesson is ready' })
    expect(S.shouldPrep(base({ target: false })).run).toBe(false)
    expect(S.shouldPrep(base({ lastTry: at(22, 40) })).run).toBe(false)
    expect(S.shouldPrep(base({ lastTry: at(21) })).run).toBe(true)
  })

  it('leaves Claude out at or near the plan’s limit and once the night’s allowance is spent', () => {
    expect(S.shouldPrep(base({ claude: { ready: true, limitedUntil: at(23, 30) } }))).toEqual({ run: true, claude: false, why: 'Claude is at your plan’s limit' })
    expect(S.shouldPrep(base({ claude: { ready: true, utilization: 0.85 } }))).toMatchObject({ claude: false, why: 'Claude is near your plan’s limit' })
    expect(S.shouldPrep(base({ claude: { ready: true, status: 'allowed_warning' } }))).toMatchObject({ claude: false })
    expect(S.shouldPrep(base({ usedTonight: 6 }))).toMatchObject({ claude: false, why: 'Tonight’s Claude allowance for prep is used' })
    expect(S.shouldPrep(base({ usedTonight: 5 }))).toMatchObject({ claude: true })
    expect(S.shouldPrep(base({ claude: { ready: false } }))).toMatchObject({ run: true, claude: false })
    expect(S.shouldPrep(base({ settings: { ...S.DEFAULT_PREP, maxCalls: 0 } }))).toMatchObject({ claude: false })
  })

  it('counts the hours after midnight towards the night before', () => {
    expect(S.nightOf(new Date(2026, 10, 13, 2).getTime(), S.DEFAULT_PREP)).toBe('2026-11-12')
    expect(S.nightOf(new Date(2026, 10, 12, 23).getTime(), S.DEFAULT_PREP)).toBe('2026-11-12')
    expect(S.inWindow(23, 22, 7) && S.inWindow(6, 22, 7) && !S.inWindow(7, 22, 7) && S.inWindow(13, 12, 14)).toBe(true)
  })

  it('cleans settings', () => {
    expect(S.prepSettings({ from: 30 as number, idleMinutes: 1, maxCalls: 99 })).toMatchObject({ from: 22, idleMinutes: 5, maxCalls: 40, on: true })
  })
})

const PLAN_REPLY = JSON.stringify({
  why: 'You have binary down; negative numbers in binary are next, and every integer in C uses them.',
  goal: 'By the end you can negate an 8-bit number and read its value',
  steps: [
    { title: 'Why sign bits fail', about: 'Two zeros and broken addition', done_when: 'you show 5 + (-5) going wrong', minutes: 6 },
    { title: 'Invert and add one', about: 'The negation rule', done_when: 'you negate 23 in 8 bits unaided', minutes: 10 },
    { title: 'Reading a negative byte', about: 'The top bit is worth -128', done_when: 'you read 11101001 as -23', minutes: 8 }
  ],
  visual: { brief: 'An 8-bit wheel from 0 to 255 with the top half relabelled -128 to -1' }
})
const EXERCISES = JSON.stringify({ exercises: [1, 2, 3, 4].map((i) => ({ kind: 'code', level: ['easy', 'medium', 'hard', 'medium'][i - 1], problem: `Problem ${i}`, question: `Write neg${i}(x)`, mistake: 'x' })) })
const OPENING = '<plan>\nGoal: By the end you can negate an 8-bit number and read its value\nWhy sign bits fail | Two zeros and broken addition | Done when you show 5 + (-5) going wrong | 6 min\n</plan>\n<progress step="1"/>\nTake 5 = 00000101.\n```visual\n<title>The 8-bit wheel</title><svg></svg><script>visual.steps([], () => {})</script>\n```\nLook at where 127 meets -128.\n<ask type="short">What is -5 if you only flip the top bit of 00000101?</ask>'

describe('preparing a lesson', () => {
  it('finds the next lesson in the week plan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 12, 23))
    const t = await M.nextTarget()
    expect(t).toMatchObject({ topic: 'Two’s complement', notebook: 'Software engineering', forDate: '2026-11-13', agenda: { date: '2026-11-13', index: 0 }, why: 'It builds on binary, which you have now.' })
    vi.useRealTimers()
  })

  it('gets everything ready with Claude: due, reading, a plan, checked exercises, a visual and the opening', async () => {
    const asked: string[] = []
    const ask: import('../src/main/lessonPrep').PrepAsk = async (job, prompt) => {
      asked.push(job)
      if (job === 'lessonPrep') return PLAN_REPLY
      if (prompt.includes('practice exercises')) return EXERCISES
      expect(prompt).toContain('<plan>\nGoal: By the end you can negate')
      return OPENING
    }
    // Exercise 3's proof fails: it is left out
    const verify = async (args: Record<string, unknown>) => (args.problem === 'Problem 3' ? null : { id: `x${String(args.problem).slice(-1)}`, kind: 'code' as const, level: (args.level === 'easy' ? 1 : args.level === 'hard' ? 3 : 2) as 1 | 2 | 3, question: String(args.question) })
    const target = { topic: 'Two’s complement', notebook: 'Software engineering', forDate: '2026-11-13', agenda: { date: '2026-11-13', index: 0 } }
    const p = await M.prepareLesson(target, { claude: true }, { ask, verify })
    expect(asked).toEqual(['lessonPrep', 'prepExercises', 'prepExercises'])
    expect(p.by).toBe('claude')
    expect(p.why).toMatch(/^You have binary down/)
    expect(p.plan!.steps.map((s) => s.doneWhen)).toEqual(['Done when you show 5 + (-5) going wrong', 'Done when you negate 23 in 8 bits unaided', 'Done when you read 11101001 as -23'])
    expect(p.exercises.map((x) => x.id)).toEqual(['x1', 'x2', 'x4'])
    expect(p.due).toEqual({ recall: 1, fading: ['Binary numbers'], onTopic: ['What does the top bit mean in two’s complement?'] })
    expect(p.warmup?.cards).toHaveLength(1)
    expect(p.reading).toMatchObject({ title: 'Two’s complement (Cornell CS 3410 notes)' })
    expect(p.visual).toEqual({ title: 'The 8-bit wheel' })
    // The opening tells the tutor about the exercises it can set by id
    expect(p.opening!.message).toContain('<exercise id="…"/>')
    expect(p.opening!.message).toContain('- x1: easy code, "Write neg1(x)"')
    expect(S.preparedParts(p)).toEqual(['A 3-step plan, about 24 min', '1 warm-up question', '1 recall question due', '3 checked exercises', 'A custom visual', 'Reading: Two’s complement (Cornell CS 3410 notes)'])
    expect((await M.readyPrep())?.id).toBe(p.id)
  })

  it('starts instantly from what was prepared, with no model call, and keeps a prep you didn’t start', async () => {
    const p = (await M.readyPrep())!
    const first = await M.takeOpening(p.id)
    expect(first?.reply).toBe(OPENING)
    const blocks = parseBlocks(first!.reply)
    const plan = blocks.find((b) => b.kind === 'plan')
    expect(plan && plan.kind === 'plan' && plan.detail[0]).toMatchObject({ title: 'Why sign bits fail', doneWhen: 'Done when you show 5 + (-5) going wrong', minutes: 6 })
    expect(blocks.some((b) => b.kind === 'ask')).toBe(true)
    // Used: it no longer shows as ready
    expect(await M.readyPrep()).toBeNull()
  })

  it('never uses Claude for a private topic, and without Claude prepares what needs no model', async () => {
    const asked: string[] = []
    const ask = async (job: string) => (asked.push(job), PLAN_REPLY)
    const p = await M.prepareLesson({ topic: 'Acme ledger design', notebook: 'Acme', forDate: '2026-11-13' }, { claude: true }, { ask })
    expect(asked).toEqual([])
    expect(p).toMatchObject({ by: 'local', note: 'Private: prepared on this Mac only', exercises: [] })
    expect(p.opening).toBeUndefined()
    expect(p.warmup?.cards).toHaveLength(1)
    const q = await M.prepareLesson({ topic: 'Two’s complement', notebook: 'Software engineering', forDate: '2026-11-13' }, { claude: false, note: 'Claude is near your plan’s limit' }, { ask })
    expect(asked).toEqual([])
    expect(q).toMatchObject({ by: 'local', note: 'Claude is near your plan’s limit' })
    expect(S.prepNote(q)).toContain('Recall questions due on this topic')
    await M.discardPrep(p.id)
    await M.discardPrep(q.id)
  })
})

describe('the weekly review', () => {
  it('writes the week from the records, with Claude’s two paragraphs, and keeps the focus for the coach', async () => {
    mkdirSync(join(dir, 'Coach'), { recursive: true })
    writeFileSync(join(dir, 'Coach/About me as a learner.md'), '# About me as a learner\n\n## Misconceptions\n\n- Pads zeros on the right when grouping bits (seen 10 Nov; resolved 11 Nov)\n- Thinks the top bit is just a sign (seen 12 Nov)\n')
    mkdirSync(join(dir, '.tide/lessons'), { recursive: true })
    writeFileSync(join(dir, '.tide/lessons/b.json'), JSON.stringify({ id: 'b', mode: 'teach', topic: 'Binary numbers', scope: { kind: 'vault' }, started: new Date(2026, 10, 10).getTime(), updated: new Date(2026, 10, 10, 1).getTime(), finished: true, turns: [{ role: 'user', content: 'start' }, { role: 'assistant', content: '<ask type="short">1011?</ask>' }, { role: 'user', content: 'Answer: 11' }, { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade><summary>x</summary>' }] }))
    const ask = async (job: string, prompt: string) => {
      expect(job).toBe('weeklyReview')
      expect(prompt).toContain('Mental maths: 1 sessions, 90% right, 4.0 s a question.')
      return JSON.stringify({ learned: 'You learned to convert between binary and decimal and to group bits into nibbles.', focus: 'Refresh bitwise AND, then start two’s complement.', focus_topics: ['Bitwise AND', 'Two’s complement'] })
    }
    const r = await M.writeWeeklyReview('2026-11-12', { claude: true, ask })
    expect(r).toEqual({ path: 'Coach/Reviews/Week to 2026-11-12 (Tide).md', by: 'claude' })
    const md = readFileSync(join(dir, r.path), 'utf8')
    for (const h of ['## What you learned', '## What’s fading', '## Misconceptions', '## Time studied', '## Mental maths', '## Next week’s focus']) expect(md).toContain(h)
    expect(md).toContain('You learned to convert between binary and decimal')
    expect(md).toContain('Now solid: Binary numbers.')
    expect(md).toContain('| Binary numbers | 1 of 1 | yes |')
    expect(md).toContain('- Bitwise AND: 52% likely to recall today')
    expect(md).toContain('- Resolved: Pads zeros on the right when grouping bits')
    expect(md).toContain('- Still open: Thinks the top bit is just a sign')
    expect(md).toContain('3 h 45 in all.')
    expect(md).toContain('1 session: 90% right (better than the week before), 4.0 s a question (better than the week before).')
    expect(md).toContain('- Two’s complement')
    // The weekly coach reads the focus when it plans
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 13))
    expect(await M.latestFocus()).toMatchObject({ focus: 'Refresh bitwise AND, then start two’s complement.', focusTopics: ['Bitwise AND', 'Two’s complement'] })
    vi.useRealTimers()
  })

  it('still writes it without Claude, saying the focus plainly from the numbers', async () => {
    const r = await M.writeWeeklyReview('2026-11-12', { claude: false })
    expect(r.by).toBe('local')
    const md = readFileSync(join(dir, r.path), 'utf8')
    expect(md).toContain('Next week: refresh Bitwise AND before it slips further, then check the misconception still open')
  })
})
