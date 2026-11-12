import { describe, expect, it } from 'vitest'
import { THREAD_RULES, anchorOf, newThread, readsAsQuestion, restoreThreads, threadContext, threadMessages, threadReplyText, threadTakeaway, threadsNote, type LessonThread } from '../src/shared/lessonThreads'
import { lessonMarkdown, type LessonRecord } from '../src/shared/lessonLog'
import { lessonEvidence, THREAD_WEIGHT } from '../src/shared/knowledge'
import { digestLesson } from '../src/shared/lessonMemory'

const OUTPUT = 'We count in base 10 because we have ten fingers: it is a human habit, not something numbers require.\n\n<plan>\n1. Bases\n2. Binary\n</plan>'
const ASKS = 'To turn 21 into binary, divide by 2.\n\n<ask type="short">Convert 45 to binary, showing each division.</ask><solution>101101</solution>'
const turns = [
  { role: 'user' as const, content: 'Teach me binary' },
  { role: 'assistant' as const, content: OUTPUT },
  { role: 'user' as const, content: 'Go on.' },
  { role: 'assistant' as const, content: ASKS }
]
const lesson = { topic: 'Binary', plan: ['Bases', 'Binary'], turns }

const withQs = (t: LessonThread, ...qa: string[]): LessonThread => ({ ...t, messages: qa.map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content })) })

describe('what a thread sends', () => {
  it('carries the lesson, the exact output, the selected phrase and the waiting question, never the hidden solution', () => {
    const t = withQs(newThread(turns, 3, 'divide by 2', 'Convert 45 to binary, showing each division.'), 'Why divide by 2?')
    const msgs = threadMessages(lesson, t)
    expect(msgs).toHaveLength(1)
    const first = msgs[0].content
    expect(first).toContain('lesson on "Binary"')
    expect(first).toContain("The lesson's plan: 1. Bases 2. Binary")
    expect(first).toContain('Tutor: We count in base 10')
    expect(first).toContain('<<<\nTo turn 21 into binary, divide by 2.')
    expect(first).toContain('They selected this phrase in it: "divide by 2"')
    expect(first).toContain("don't answer it for them): Convert 45 to binary")
    expect(first).not.toContain('101101')
    expect(first.endsWith('Why divide by 2?')).toBe(true)
    expect(THREAD_RULES).toMatch(/Never give away the answer/)
  })

  it('sends the thread so far for a follow-up, with the context fixed on its first question', () => {
    const t = withQs(newThread(turns, 1), 'Why a habit?', 'Nothing in arithmetic picks ten.', 'And base 60?')
    const msgs = threadMessages(lesson, t)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(msgs[0].content).toBe(`${threadContext(lesson, t)}\n\nWhy a habit?`)
    expect(msgs[2].content).toBe('And base 60?')
    // The context doesn't change as the lesson goes on past the output
    const later = { ...lesson, turns: [...turns, { role: 'user' as const, content: 'Answer: 101101' }, { role: 'assistant' as const, content: 'Right.' }] }
    expect(threadMessages(later, t)[0].content).toBe(msgs[0].content)
  })

  it('drops a reply that failed, so the question is asked once', () => {
    const t = { ...newThread(turns, 1), messages: [{ role: 'user' as const, content: 'q1' }, { role: 'assistant' as const, content: '' }, { role: 'user' as const, content: 'q1 again' }] }
    const msgs = threadMessages(lesson, t)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content.endsWith('q1 again')).toBe(true)
  })

  it('shows a reply as plain words even if lesson tags slip in', () => {
    expect(threadReplyText('Ten is a choice. <ask type="short">Which base do clocks use?</ask>')).toBe('Ten is a choice.\n\nWhich base do clocks use?')
    expect(threadReplyText('<grade verdict="correct" score="1">Yes.</grade>')).toBe('Yes.')
  })
})

describe('what the lesson’s tutor hears', () => {
  it('one line per thread understood, once, never the thread itself', () => {
    const a = { ...withQs(newThread(turns, 1, 'a human habit'), 'Why is it a habit?', 'Because fingers.'), understood: true }
    const b = withQs(newThread(turns, 3), 'Why divide?', 'Halving.')
    const note = threadsNote([a, b])!
    expect(note).toMatch(/^\(Tide: /)
    expect(note).toContain('asked about "a human habit" (Why is it a habit?) and understood')
    expect(note).not.toContain('Because fingers')
    expect(note).not.toContain('Why divide')
    expect(threadsNote([{ ...a, told: true }, b])).toBeNull()
  })
})

describe('the answer box', () => {
  it('offers a thread for a question about the explanation', () => {
    for (const q of ['Why is base 10 just a habit?', 'In nature what do you mean, why is base 10 just a habit', 'i dont understand the remainders', 'Can you explain the remainder column again', 'What happens to the remainder when the number is even?'])
      expect(readsAsQuestion(q), q).toBe(true)
  })
  it('leaves answers, guesses and "I don’t know" alone', () => {
    for (const a of ['101101', '101101?', 'is it 101101?', 'I think 45 = 32 + 8 + 4 + 1 so 101101', "I don't know", 'no idea', '45/2 = 22 r1, 22/2 = 11 r0, 11/2 = 5 r1, 5/2 = 2 r1, 2/2 = 1 r0, 1/2 = 0 r1', '```py\nprint(1)\n```', ''])
      expect(readsAsQuestion(a), a).toBe(false)
  })
})

describe('kept with the lesson', () => {
  it('restores threads on their outputs, and drops ones whose output changed', () => {
    const ok = withQs(newThread(turns, 1), 'q', 'a')
    const moved = { ...withQs(newThread(turns, 3), 'q2', 'a2'), anchor: 'something else' }
    const onUser = { ...withQs(newThread(turns, 1), 'q3'), at: 2 }
    const cut = { ...withQs(newThread(turns, 1), 'q4', 'a4', 'q5'), messages: [...withQs(newThread(turns, 1), 'q4', 'a4', 'q5').messages, { role: 'assistant' as const, content: '' }] }
    const back = restoreThreads(JSON.parse(JSON.stringify([ok, moved, onUser, cut, null, { junk: 1 }])), turns)
    expect(back.map((t) => t.id)).toEqual([ok.id, cut.id])
    expect(back[1].messages.at(-1)).toEqual({ role: 'user', content: 'q5' })
    expect(restoreThreads(undefined, turns)).toEqual([])
    expect(anchorOf(OUTPUT)).toMatch(/^We count in base 10/)
  })

  it('shows them in the lesson page under their output, and as light taught evidence when understood', () => {
    const t = { ...withQs(newThread(turns, 1, 'a human habit'), 'Why a habit?', 'Nothing in arithmetic picks **ten**.'), understood: true }
    const open = withQs(newThread(turns, 3), 'Why divide?', 'Halving.')
    const record: LessonRecord = { id: 'l1', mode: 'teach', topic: 'Binary', scope: { kind: 'none' }, turns, started: 1, updated: 2, threads: [t, open] }
    const page = lessonMarkdown(record)
    const at = page.indexOf('We count in base 10')
    const th = page.indexOf('> [!question]- Thread: “a human habit” (1 question, understood)')
    expect(th).toBeGreaterThan(at)
    expect(th).toBeLessThan(page.indexOf('To turn 21'))
    expect(page).toContain('> **You:** Why a habit?')
    expect(page).toContain('> Nothing in arithmetic picks **ten**.')
    // The turns themselves have no thread in them
    expect(record.turns.some((x) => x.content.includes('Why a habit?'))).toBe(false)
    const d = digestLesson(record)!
    const { events } = lessonEvidence(record, d, { id: 'binary', area: '' })
    const fromThreads = events.filter((e) => e.pos.startsWith('thread:'))
    expect(fromThreads).toEqual([expect.objectContaining({ kind: 'taught', weight: THREAD_WEIGHT, pos: `thread:${t.id}` })])
    // No marks from threads
    expect(events.filter((e) => e.kind !== 'taught')).toHaveLength(0)
  })

  it('makes a takeaway for the lesson notes', () => {
    const t = withQs(newThread(turns, 1), 'Why a habit?', 'Any base works.\n\nTen won because of fingers.')
    expect(threadTakeaway(t)).toBe('> **Why a habit?**\n>\n> Any base works.\n>\n> Ten won because of fingers.')
    expect(threadTakeaway(withQs(newThread(turns, 1), 'q'))).toBe('')
  })
})
