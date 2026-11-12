import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LessonRecord } from '../src/shared/lessonLog'

// A scratch vault: the real vault module reads and writes there
const dir = mkdtempSync(join(tmpdir(), 'tide-learner-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: dir, ai: {}, whyMode: 'off' }) }))
vi.mock('../src/main/coach', () => ({
  getCoach: async () => ({ goal: '', focus: [], days: [1, 2, 3, 4, 5], hoursPerWeek: 10, direction: 'You’re heading towards software engineering for payments and data systems.', weekdayMinutes: 60 }),
  directionLine: async () => ''
}))
vi.mock('../src/main/learn', () => ({ getNotebooks: async () => [], focusLog: async () => [] }))
vi.mock('../src/main/mistakes', () => ({ listMistakes: async () => [{ id: 'm1', topic: 'Binary numbers', question: 'Group 101101 into nibbles', answer: '1011 01', fix: 'Pad on the left: 0010 1101', status: 'open', at: Date.now(), source: 'lesson' }] }))
vi.mock('../src/main/projects', () => ({ privatePath: async (p: string) => p.startsWith('Acme') }))
// Routing: a lesson in the Acme project (private) or about Metabase stays on the Mac
vi.mock('../src/main/ai', () => ({
  jobRoute: async (_job: string, prompt: string, o: { path?: string }) =>
    /metabase/i.test(prompt) ? { who: 'gemma', reason: 'metabase' } : o.path?.startsWith('Acme') ? { who: 'gemma', reason: 'private' } : { who: 'claude', role: 'background' }
}))

const P = await import('../src/shared/learnerProfile')
const L = await import('../src/main/learnerProfile')
const { stableSystem } = await import('../src/shared/tutorPrompt')

const note = () => readFileSync(join(dir, L.LEARNER_NOTE), 'utf8')

const NOV = (d: number, h = 10) => new Date(2026, 10, d, h).getTime()

function lesson(id: string, o: Partial<LessonRecord> = {}): LessonRecord {
  return {
    id,
    mode: 'teach',
    topic: 'Binary numbers',
    scope: { kind: 'folder', path: 'Software engineering' },
    started: NOV(12, 9),
    updated: NOV(12, 9) + 38 * 60_000,
    finished: true,
    turns: [
      { role: 'user', content: 'I want to learn Binary numbers deeply. Start by finding out what I already know.' },
      { role: 'assistant', content: 'Let us start.\n<ask type="short">Group 101101 into 4-bit nibbles.</ask>' },
      { role: 'user', content: 'Answer: 1011 01\n(Confidence: sure)' },
      { role: 'assistant', content: '<grade verdict="wrong" score="0">You padded on the right. Pad on the left: 0010 1101.</grade>\nTry again.\n<ask type="short">Group 1110101 into nibbles.</ask>' },
      { role: 'user', content: '[hint] (nudge please)' },
      { role: 'assistant', content: 'Count from the right.\n<ask type="short">Group 1110101 into nibbles.</ask>' },
      { role: 'user', content: 'Answer: 0111 0101\n(Confidence: unsure)' },
      { role: 'assistant', content: '<grade verdict="correct" score="1">Right.</grade>\n<ask type="short">What is 0x2D in decimal?</ask>' },
      { role: 'user', content: 'My question: can you just show the working as a table? Let me move on when I have shown it.' },
      { role: 'assistant', content: '| hex | value |\n|---|---|\n| 2 | 32 |\n| D | 13 |\n<ask type="short">What is 0x2D in decimal?</ask>' },
      { role: 'user', content: 'Answer: 45\n(Confidence: sure)' },
      { role: 'assistant', content: '<grade verdict="correct" score="1">Yes, 45.</grade>\n<summary>Done.</summary>' }
    ],
    ...o
  }
}

beforeEach(() => {
  // Each test starts from no profile
  mkdirSync(join(dir, 'Coach'), { recursive: true })
  mkdirSync(join(dir, '.tide/learner'), { recursive: true })
  writeFileSync(join(dir, L.LEARNER_NOTE), '')
  writeFileSync(join(dir, '.tide/learner/state.json'), '{}')
  writeFileSync(join(dir, '.tide/learner/changes.jsonl'), '')
  mkdirSync(join(dir, '.tide/lessons'), { recursive: true })
})

describe('the profile note', () => {
  it('reads back what it writes, and keeps a section and a paragraph the learner wrote', () => {
    const p = P.emptyProfile()
    p.sections.preferences.push({ text: 'Show the working' })
    p.sections.misconceptions.push({ text: 'Pads zeros on the right when grouping bits', seen: ['10 Nov', '11 Nov'], resolved: '12 Nov' })
    const md = P.renderProfile(p) + '\n## My own notes\n\nI study best before work.\n'
    const back = P.parseProfile(md.replace('## What clicks\n', '## What clicks\n\nTables, mostly.\n'))
    expect(back.sections.misconceptions[0]).toEqual({ text: 'Pads zeros on the right when grouping bits', seen: ['10 Nov', '11 Nov'], resolved: '12 Nov' })
    expect(back.notes.clicks).toEqual(['Tables, mostly.'])
    const again = P.renderProfile(back)
    expect(again).toContain('## My own notes\n\nI study best before work.')
    expect(again).toContain('Tables, mostly.')
    expect(again).toContain('- Pads zeros on the right when grouping bits (seen 10 Nov, 11 Nov; resolved 12 Nov)')
    // Empty sections say so in italics, which never read back as items
    expect(P.parseProfile(again).sections.strengths).toEqual([])
  })
})

describe('merging changes', () => {
  const own = { locked: [] as string[], suppressed: [] as string[] }
  it('adds, marks seen again and resolves, with dates, and leaves the rest alone', () => {
    const p = P.emptyProfile()
    p.sections.misconceptions.push({ text: 'Pads zeros on the right when grouping bits', seen: ['10 Nov'] })
    p.sections.clicks.push({ text: 'Worked tables, one row per step' })
    const ops = P.parseOps('{"changes":[{"do":"seen","match":"pads zeros on the right"},{"do":"add","section":"preferences","text":"Let me move on when I have shown it"},{"do":"add","section":"clicks","text":"worked tables with one row per step"}]}')
    const { profile, changes } = P.applyOps(p, ops, { date: '12 Nov', ownership: own })
    expect(profile.sections.misconceptions[0].seen).toEqual(['10 Nov', '12 Nov'])
    expect(profile.sections.preferences.map((i) => i.text)).toEqual(['Let me move on when I have shown it'])
    // Already there in other words
    expect(profile.sections.clicks).toHaveLength(1)
    expect(changes.map((c) => c.kind)).toEqual(['seen', 'added'])
    const r = P.applyOps(profile, [{ do: 'resolve', match: 'grouping bits' }], { date: '13 Nov', ownership: own })
    expect(r.profile.sections.misconceptions[0].resolved).toBe('13 Nov')
  })

  it('keeps each update small', () => {
    const ops = ['Mental arithmetic', 'Reading C pointers', 'SQL joins', 'Spotting edge cases', 'Proof by induction', 'Debugging with prints', 'Hex conversion', 'Big-O estimates', 'Double-entry ledgers'].map((text) => ({ do: 'add' as const, section: 'strengths' as const, text }))
    expect(P.applyOps(P.emptyProfile(), ops, { date: '12 Nov', ownership: own, maxOps: 4 }).changes).toHaveLength(4)
  })

  it('never rewords the learner’s own line, never adds back what they deleted, and removes only in the weekly tidy', () => {
    const p = P.emptyProfile()
    p.sections.preferences.push({ text: 'Keep it short and show the working' })
    p.sections.strengths.push({ text: 'Mental arithmetic' })
    const mine = { locked: [P.norm('Keep it short and show the working')], suppressed: [P.norm('Likes analogies to cooking')] }
    const ops: import('../src/shared/learnerProfile').ProfileOp[] = [
      { do: 'update', section: 'preferences', match: 'keep it short', text: 'Prefers brief answers' },
      { do: 'add', section: 'clicks', text: 'Likes analogies to cooking' },
      { do: 'remove', section: 'strengths', match: 'mental arithmetic' }
    ]
    const r = P.applyOps(p, ops, { date: '12 Nov', ownership: mine })
    expect(r.changes).toEqual([])
    const weekly = P.applyOps(p, ops, { date: '12 Nov', ownership: mine, allowRemove: true })
    expect(weekly.changes.map((c) => c.kind)).toEqual(['removed'])
    expect(weekly.profile.sections.preferences[0].text).toBe('Keep it short and show the working')
  })

  it('tells the learner’s edits and deletions from Tide’s own', () => {
    const p = P.emptyProfile()
    p.sections.clicks.push({ text: 'Worked tables' }, { text: 'The doubling trick' })
    p.sections.misconceptions.push({ text: 'Pads zeros on the right', seen: ['10 Nov'] })
    const written = P.renderProfile(p)
    const edited = written.replace('- Worked tables', '- Worked tables, with the carries shown').replace('- The doubling trick\n', '').replace('(seen 10 Nov)', '(seen 10 Nov, 11 Nov)')
    const e = P.learnerEdits(written, edited)
    expect(e.locked).toEqual([P.norm('Worked tables, with the carries shown')])
    expect(e.suppressed.sort()).toEqual([P.norm('The doubling trick'), P.norm('Worked tables')].sort())
  })
})

describe('the digest', () => {
  it('stays within 300 words however full the profile is, keeping preferences and open misconceptions', () => {
    const p = P.emptyProfile()
    const long = (s: string, i: number) => `${s} ${i}: ${'a fairly long line about how this learner works through problems '.repeat(2)}`
    for (const id of P.SECTION_IDS) for (let i = 0; i < 8; i++) p.sections[id].push({ text: long(id, i) })
    p.sections.preferences.unshift({ text: 'Let me move on when I have shown it' })
    p.sections.misconceptions.push({ text: 'Pads zeros on the right when grouping bits', seen: ['12 Nov'] })
    p.sections.misconceptions.push({ text: 'Thinks 0x10 is ten', seen: ['3 Nov'], resolved: '9 Nov' })
    const d = P.digest(p)
    expect(d.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(300)
    expect(d).toContain('Let me move on when I have shown it')
    expect(d).toContain('Pads zeros on the right when grouping bits')
    // Resolved ones are left out
    expect(d).not.toContain('Thinks 0x10 is ten')
  })

  it('is empty for an empty profile', () => {
    expect(P.digest(P.emptyProfile())).toBe('')
  })
})

describe('measurements', () => {
  it('reads calibration, hints and lesson length from the records', () => {
    const records = [lesson('a'), lesson('b'), lesson('c', { updated: NOV(12, 9) + 52 * 60_000 })]
    const m = P.measure(records)
    expect(m.confidence.sure).toEqual({ right: 3, n: 6 })
    expect(m.confidence.unsure).toEqual({ right: 3, n: 3 })
    expect(m.hinted).toBe(3)
    expect(m.answered).toBe(9)
    expect(m.lessonMinutes).toEqual([38, 38, 52])
    expect(P.confidenceLine(m)).toMatch(/^Sure 3 of 6 right, Unsure 3 of 3 right; often sure when wrong/)
    expect(P.hintsLine(m)).toMatch(/^Hints on 3 of 9 answered questions \(33%\), most in Binary numbers/)
    expect(P.paceLine(m, { fadesAt: 42, goodHours: [9, 10], learnedFrom: 6 })).toBe('Lessons run about 38 min (median of 3); you tend to fade after about 42 min of study; your best hours are 09:00 to 11:00.')
  })

  it('reads lesson sittings and study days from the focus log', () => {
    const t = NOV(10, 9)
    const e = (min: number, len: number, label = 'teach: Binary') => ({ start: t + min * 60_000, minutes: len, label, kind: 'lesson' })
    // 9:00 for 20, back at 9:25 for 15 (one sitting), then another lesson later
    const f = P.focusPace([e(0, 20), e(25, 15), e(200, 30, 'teach: Hex'), { start: NOV(11, 9), minutes: 50, label: 'teach: Hex', kind: 'lesson' }, { start: NOV(12, 9), minutes: 25, label: 'Reading', kind: 'reading' }])
    expect(f.sittings).toEqual([35, 30, 50])
    expect(f.days).toEqual([65, 50, 25])
    expect(P.paceLine(P.measure([]), null, {}, f)).toBe('Lesson sittings run about 35 min (median of 3); a study day holds about 50 min.')
  })

  it('gives the updater the lesson in short: answers with confidence, marks, hints and what the learner said', () => {
    const t = P.lessonText(lesson('a'))
    expect(t).toContain('Answer (sure): 1011 01')
    expect(t).toContain('Marked wrong: You padded on the right')
    expect(t).toContain('(asked for a hint)')
    expect(t).toContain('Learner asked: can you just show the working as a table? Let me move on when I have shown it.')
    expect(t).not.toContain('Start by finding out')
  })
})

describe('after a lesson', () => {
  const reply = JSON.stringify({
    changes: [
      { do: 'seen', match: 'pads zeros on the right', text: 'Pads zeros on the right when grouping bits' },
      { do: 'add', section: 'preferences', text: 'Show the working as a table' },
      { do: 'add', section: 'preferences', text: 'Let me move on when I have shown it' }
    ]
  })

  it('applies the model’s few changes and the measured lines, as a small diff, and logs them', async () => {
    const asked: string[] = []
    await L.updateFromLesson(lesson('a'), { ask: async (prompt) => (asked.push(prompt), { text: reply, by: 'claude' }) })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('Answer (sure): 1011 01')
    const md = note()
    expect(md).toContain('# About me as a learner')
    expect(md).toContain('- Pads zeros on the right when grouping bits (seen ')
    expect(md).toContain('- Show the working as a table')
    expect(md).toContain('- Heading towards: You’re heading towards software engineering for payments and data systems.')
    expect(md).toContain('- Measured: You plan 60 min on weekdays.')
    // A second lesson changes only what it shows: a handful of lines
    const before = md.split('\n')
    await L.updateFromLesson(lesson('b', { topic: 'Hexadecimal' }), { ask: async () => ({ text: '{"changes":[{"do":"add","section":"clicks","text":"Place-value tables for hex"}]}', by: 'claude' }) })
    const after = note().split('\n')
    const changed = after.filter((l) => !before.includes(l))
    expect(changed).toEqual(['- Place-value tables for hex'])
    const log = await L.recentChanges()
    expect(log[0]).toMatchObject({ kind: 'added', from: 'Hexadecimal', by: 'claude' })
  })

  it('keeps the learner’s edits: a reworded line stays, a deleted line stays gone', async () => {
    await L.updateFromLesson(lesson('a'), { ask: async () => ({ text: reply, by: 'claude' }) })
    // The learner edits the note by hand
    writeFileSync(join(dir, L.LEARNER_NOTE), note().replace('- Show the working as a table', '- Show the working, always as a table with each step').replace('- Let me move on when I have shown it\n', ''))
    await L.updateFromLesson(lesson('b'), {
      ask: async () => ({ text: JSON.stringify({ changes: [{ do: 'update', section: 'preferences', match: 'show the working', text: 'Prefers tables' }, { do: 'add', section: 'preferences', text: 'Let me move on when I have shown it' }] }), by: 'claude' })
    })
    const md = note()
    expect(md).toContain('- Show the working, always as a table with each step')
    expect(md).not.toContain('Prefers tables')
    expect(md).not.toContain('Let me move on when I have shown it')
    const view = await L.learnerView()
    expect(view.sections.find((s) => s.id === 'preferences')!.items[0]).toMatchObject({ yours: true })
  })

  it('never sends a private or Metabase lesson’s content to the model', async () => {
    const asked: string[] = []
    const ask = async (p: string) => (asked.push(p), { text: reply, by: 'claude' as const })
    await L.updateFromLesson(lesson('p', { scope: { kind: 'folder', path: 'Acme payments' } }), { ask })
    await L.updateFromLesson(lesson('m', { topic: 'Metabase questions and dashboards' }), { ask })
    expect(asked).toEqual([])
    // Their marks still count in the measured lines
    expect(note()).toMatch(/Measured: /)
  })

  it('lets the learner correct, resolve and delete from the profile view', async () => {
    await L.updateFromLesson(lesson('a'), { ask: async () => ({ text: reply, by: 'claude' }) })
    let v = await L.correctItem('misconceptions', 'Pads zeros on the right when grouping bits', { resolved: true })
    expect(v.sections.find((s) => s.id === 'misconceptions')!.items[0].resolved).toBeTruthy()
    v = await L.correctItem('preferences', 'Show the working as a table', { remove: true })
    expect(v.sections.find((s) => s.id === 'preferences')!.items.map((i) => i.text)).toEqual(['Let me move on when I have shown it'])
    // Asked again, it isn't added back
    await L.updateFromLesson(lesson('b'), { ask: async () => ({ text: reply, by: 'claude' }) })
    expect(note()).not.toContain('Show the working as a table')
  })
})

describe('what the tutor gets', () => {
  it('puts the digest in the tutor’s prompt, Claude’s and Gemma’s alike', async () => {
    await L.updateFromLesson(lesson('a'), { ask: async () => ({ text: '{"changes":[{"do":"add","section":"preferences","text":"Let me move on when I have shown it"}]}', by: 'claude' }) })
    // The real profilePrompt, over the scratch vault, with an aim saved in Your week
    writeFileSync(join(dir, '.tide/coach.json'), JSON.stringify({ goal: '', focus: [], days: [1], hoursPerWeek: 10, aims: [{ id: 'a', text: 'Work in payments infrastructure', weight: 'main', since: 1 }] }))
    const coach = await vi.importActual<typeof import('../src/main/coach')>('../src/main/coach')
    const prompt = await coach.profilePrompt()
    expect(prompt).toContain('Where this learner is heading')
    expect(prompt).toContain('What Tide knows about this learner')
    expect(prompt).toContain('Let me move on when I have shown it')
    expect(prompt).toContain('check an open misconception with a question')
    const system = stableSystem('You are Tide.', { today: new Date(2026, 10, 12), web: true, session: true, profile: prompt })
    expect(system).toContain('Let me move on when I have shown it')
  })

  it('gives the full profile and the past mistakes on a topic to the learner_profile tool', async () => {
    await L.updateFromLesson(lesson('a'), { ask: async () => ({ text: reply, by: 'claude' }) })
    const t = await L.pastOnTopic('Binary numbers')
    expect(t).toContain("The learner's profile (Coach/About me as a learner.md)")
    expect(t).toContain('Past mistakes on it:\n- Group 101101 into nibbles (they answered: 1011 01); fix: Pad on the left')
  })
})
