import { describe, expect, it } from 'vitest'
import type { LessonRecord } from '../src/shared/lessonLog'
import { SESSION_FORMAT } from '../src/shared/session'
import { SCENARIOS } from '../scripts/eval/tutor/scenarios'
import { examplesFrom, heldOut, isPrivatePath, lessonExcluded, matchesBenchmark, privacyMap, scrub, turnExcluded, unvoiced } from '../scripts/finetune/filters'

// Invented lessons: nothing here comes from a real one
const ASK = (q: string) => `<ask type="short">${q}</ask>`
const lesson = (turns: [string, string][], over: Partial<LessonRecord> = {}): LessonRecord => ({
  id: 'heaps-abc',
  mode: 'teach',
  topic: 'Binary heaps',
  scope: { kind: 'none' },
  turns: [{ role: 'user', content: 'I want to learn Binary heaps deeply. Start by finding out what I already know.' }, ...turns.flatMap(([tutor, learner]) => [{ role: 'assistant' as const, content: tutor }, ...(learner ? [{ role: 'user' as const, content: learner }] : [])])],
  started: Date.UTC(2026, 10, 1),
  updated: Date.UTC(2026, 10, 1),
  finished: true,
  ...over
})
const opts = { names: ['Ada Example'], maxTokens: 20000 }
const GOOD: [string, string][] = [
  [`**Why this matters**\n\nHeaps back every priority queue.\n\n${ASK('Where is the smallest element of a min-heap?')}`, 'Answer: At the root.\n(Confidence: sure)'],
  [`<grade verdict="correct" score="1">"At the root" is right.</grade>\n\n${ASK('What is the index of the left child of node i in the array form, counting from 0?')}`, 'Answer: 2i + 1'],
  [`<grade verdict="correct" score="1">"2i + 1" is right.</grade>\n\n<summary>You know the layout of a heap.</summary>`, '']
]

describe('which lessons may be learned from', () => {
  const map = privacyMap({ Work: { project: { kind: 'study', private: true, docs: ['Library/design.pdf'], brief: 'Work/brief.md' } }, Maths: {} } as never, { 'Library/ledger.pdf': { topics: ['work'] }, 'Library/open.pdf': { topics: ['maths'] } })

  it('knows a private project by its folder, its documents and what is filed under its name', () => {
    expect(isPrivatePath('Work/Payments/Ledger.md', map)).toBe(true)
    expect(isPrivatePath('Library/design.pdf', map)).toBe(true)
    expect(isPrivatePath('Library/ledger.pdf', map)).toBe(true)
    expect(isPrivatePath('Workshop/note.md', map)).toBe(false)
    expect(isPrivatePath('Library/open.pdf', map)).toBe(false)
  })

  it('leaves out private projects, project lessons, anything about Metabase, and everything with a path when privacy is unknown', () => {
    expect(lessonExcluded(lesson(GOOD), map)).toBeNull()
    expect(lessonExcluded(lesson(GOOD, { scope: { kind: 'folder', path: 'Work/Payments' } }), map)).toBe('private-project')
    expect(lessonExcluded(lesson(GOOD, { scope: { kind: 'note', path: 'Maths/Heaps.md' } }), map)).toBeNull()
    expect(lessonExcluded(lesson(GOOD, { scope: { kind: 'note', path: 'Maths/Heaps.md' } }), null)).toBe('privacy-unknown')
    expect(lessonExcluded(lesson(GOOD, { options: { project: { name: 'Ledger', kind: 'study' } } } as never), map)).toBe('project-lesson')
    expect(lessonExcluded(lesson([[GOOD[0][0], 'My question: how does our Metabase dashboard count this?']]), map)).toBe('metabase')
    expect(lessonExcluded(lesson([[GOOD[0][0], 'My question: what is on bi.example.com?']]), map, 'bi.example.com')).toBe('metabase')
    expect(lessonExcluded(lesson(GOOD, { mode: 'interview' }), map)).toBe('mode-not-a-lesson')
  })
})

describe('which turns may be learned from', () => {
  it('keeps turns that passed, as the request the app sends and the reply to learn', () => {
    const built = examplesFrom(lesson(GOOD), opts)
    expect(built.turns).toBe(3)
    expect(built.excluded).toEqual({})
    expect(built.examples).toHaveLength(3)
    const m = built.examples[1].messages
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant'])
    expect(m[0].content).toContain(SESSION_FORMAT)
    expect(m[1].content).toMatch(/^How to tutor me here:\nYou are running a TEACH session on: Binary heaps/)
    expect(m[4].content).toBe(GOOD[1][0])
  })

  it('leaves out a mark the second look overturned, a corrected claim and a replaced problem', () => {
    const second = lesson([[GOOD[0][0], 'Answer: At a leaf.'], [`<grade verdict="correct" score="1">Yes.</grade>\n\n${ASK('And the largest?')}\n\n<grade verdict="wrong" score="0">**Second look:** the smallest is at the root.</grade>`, '']])
    expect(turnExcluded(second, 3)).toBe('mark-overturned')
    const claim = lesson([[`A heap of n items has height n.\n\n${ASK('Why?')}\n\n> **Correction:** “height n”: the height is about log2 n.`, '']])
    expect(turnExcluded(claim, 1)).toBe('claim-corrected')
    const flawed = lesson([[`**Problem 1 · warm-up**\n\nSift it.\n\n**That problem had a flaw (it isn’t well posed), so here's another.**\n\n**Problem 1 · warm-up**\n\nInsert 3 into [1, 5, 9].\n\n<solution>[1, 3, 9, 5]</solution>\n\n<ask type="problem">The array after the insert.</ask>`, '']])
    expect(turnExcluded(flawed, 1)).toBe('problem-replaced')
  })

  it('leaves out a turn the learner corrected, or the tutor then took back', () => {
    const pushed = lesson([[`The left child of node i is at 2i.\n\n${ASK('And the right child?')}`, "My question: that's wrong for arrays counted from 0, isn't it 2i + 1?"], [GOOD[1][0], '']])
    expect(turnExcluded(pushed, 1)).toBe('learner-corrected')
    const retracted = lesson([[`The left child of node i is at 2i.\n\n${ASK('And the right child?')}`, 'Answer: 2i + 2, if the left is 2i + 1'], [`You're right, my mistake: counting from 0 the left child is at 2i + 1.\n\n${ASK('So where is the parent of node i?')}`, '']])
    expect(turnExcluded(retracted, 1)).toBe('tutor-retracted')
    expect(turnExcluded(retracted, 3)).toBeNull()
    expect(turnExcluded(lesson(GOOD), 1)).toBeNull()
  })

  it('leaves out broken protocol: a plain-text question, two questions, an unclosed tag, a problem never asked', () => {
    const t = (reply: string) => turnExcluded(lesson([[reply, '']], { finished: false }), 1)
    expect(t('Heaps are trees.\n\nWhat do you know about them?')).toMatch(/^protocol:(ends|plain-question)$/)
    expect(t(`${ASK('One?')}\n\n${ASK('Two?')}`)).toBe('protocol:one-ask')
    expect(t('Heaps.\n\n<ask type="short">Where is the minimum')).toBe('protocol:tags-closed')
    expect(t('**Problem 1 · warm-up**\n\nInsert 3 into the heap [1, 5, 9] and give the array.')).toBe('unasked-problem')
    expect(t('Heaps are trees kept in arrays.')).toMatch(/^protocol:ends|unfinished/)
  })

  it('takes the spoken part out of replies written with Talk on, and drops a reply that was only spoken', () => {
    expect(unvoiced(`<say>Right, heaps.</say>\n\n${ASK('Where is the minimum?')}`)).toBe(ASK('Where is the minimum?'))
    const built = examplesFrom(lesson([[`<say>Right, heaps.</say>\n\n${ASK('Where is the minimum?')}`, 'Answer: the root'], ['<say>Yes.</say>', '']], { finished: false }), opts)
    expect(built.examples).toHaveLength(1)
    expect(JSON.stringify(built.examples)).not.toContain('<say>')
    expect(built.excluded).toEqual({ empty: 1 })
  })

  it('drops examples longer than the training window rather than cutting them', () => {
    const built = examplesFrom(lesson(GOOD), { ...opts, maxTokens: 100 })
    expect(built.examples).toHaveLength(0)
    expect(built.excluded).toEqual({ 'too-long': 3 })
  })
})

describe('personal details', () => {
  it('are removed: emails, home folders, local addresses, phone numbers, keys and given names', () => {
    const s = scrub('Ada Example (ada@example.com, +44 20 7946 0958) keeps notes in /Users/ada/Notes, see http://localhost:3000/x, key sk-abcdefghijklmnop1234.', { names: ['Ada Example'] })
    expect(s.text).toBe('the learner ([email], [phone]) keeps notes in /Users/learner/Notes, see [local address] key [key].')
    expect(s.replaced).toBe(6)
  })
  it('leave ordinary technical text alone', () => {
    const text = 'Add 01100100 and 01000110; see https://en.wikipedia.org/wiki/Heap and port 8080, 2^20 × 4 = 4,194,304.'
    expect(scrub(text, { names: [] })).toEqual({ text, replaced: 0 })
  })
  it('are removed from what examples carry', () => {
    const built = examplesFrom(lesson([[GOOD[0][0], 'Answer: At the root, says Ada Example (ada@example.com).'], [GOOD[1][0], '']]), opts)
    expect(JSON.stringify(built.examples)).not.toMatch(/Ada|example\.com/)
    expect(built.scrubbed).toBeGreaterThan(0)
  })
})

describe('the split and the benchmark', () => {
  it('holds out whole lessons, the same ones every time', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `lesson-${i}`)
    const out = ids.filter((id) => heldOut(id, 15))
    expect(out.length).toBeGreaterThan(30)
    expect(out.length).toBeLessThan(90)
    expect(ids.filter((id) => heldOut(id, 15))).toEqual(out)
    expect(ids.some((id) => heldOut(id, 0))).toBe(false)
  })
  it('refuses anything that matches a benchmark scenario', () => {
    const bench = SCENARIOS.map((s) => s.good)
    expect(matchesBenchmark(SCENARIOS[1].good, bench)).toBe(true)
    expect(matchesBenchmark(GOOD[1][0], bench)).toBe(false)
  })
})
