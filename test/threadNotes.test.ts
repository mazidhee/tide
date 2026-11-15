import { describe, expect, it } from 'vitest'
import { POINT_SYSTEM, THREAD_NOTE_TOOL, THREAD_RULES, cleanNoteText, cleanPoint, keyPoint, newThread, pointPrompt, replyPoint, replyParts, replyTakeaway, saveFallback, threadNotes, wantsSave, withNote, type LessonThread } from '../src/shared/lessonThreads'
import { EXTRA_TOOLS } from '../src/main/tideMcpTools'
import type { AgentStep } from '../src/shared/types'

const turns = [
  { role: 'user', content: 'Teach me number bases' },
  { role: 'assistant', content: 'We count in tens because of fingers. <ask type="short">What is 101 in binary?</ask>' }
]
const thread = (messages: LessonThread['messages'], saved?: number[]): LessonThread => ({ ...newThread(turns, 1, 'because of fingers'), messages, ...(saved ? { saved } : {}) })

describe('the thread tutor saves to your notes', () => {
  it('is told it can, and how, on Gemma and on Claude', () => {
    expect(THREAD_RULES).toMatch(/<note>/)
    expect(THREAD_RULES).toMatch(/save this to my notes/)
    expect(THREAD_RULES).toMatch(/Never say you can't write to their notes/)
    expect(THREAD_RULES).not.toMatch(/write lesson tags \([^)]*<note>/)
    expect(THREAD_NOTE_TOOL).toMatch(/save_to_notes/)
  })

  it('splits a reply into what it says and what it saved', () => {
    const p = replyParts('Any base works.\n\n<note>Ten won because we have ten fingers.</note>')
    expect(p.text).toBe('Any base works.')
    expect(p.notes).toEqual(['Ten won because we have ten fingers.'])
  })

  it('collects every saved point from finished replies, and replies you saved', () => {
    const t = thread(
      [
        { role: 'user', content: 'Why ten?' },
        { role: 'assistant', content: 'Fingers.\n\n<note>Base ten comes from counting on fingers.</note>' },
        { role: 'user', content: 'And base 60?' },
        { role: 'assistant', content: 'The Babylonians used it: 60 has many divisors.' }
      ],
      [3]
    )
    // The saved reply goes in as its key point, never with the question asked
    expect(threadNotes(t)).toEqual(['Base ten comes from counting on fingers.', '**Because of fingers:** The Babylonians used it: 60 has many divisors.'])
    // The notes model's distilled point, when it came, is what goes in
    expect(threadNotes({ ...t, points: { 3: '**Base 60:** divides evenly by 2, 3, 4, 5 and 6. For example, an hour splits into 4 × 15 min.' } })[1]).toMatch(/^\*\*Base 60:\*\*/)
  })

  it('adds nothing from a reply still being written', () => {
    const t = thread([
      { role: 'user', content: 'Why ten?' },
      { role: 'assistant', content: 'Fingers. <note>Base ten comes from fing' }
    ])
    expect(threadNotes(t, true)).toEqual([])
  })

  it('saves one reply as it is, with its question', () => {
    const t = thread([
      { role: 'user', content: 'Why ten?' },
      { role: 'assistant', content: 'Fingers.\n\n<note>kept</note>' }
    ])
    expect(replyTakeaway(t, 1)).toBe('> **Why ten?**\n>\n> Fingers.')
    expect(replyTakeaway(t, 0)).toBe('')
  })

  it('knows when you ask it to save', () => {
    for (const s of ['save this to my notes', 'Can you add that to my notes?', 'put it in my notes please', 'note this down', 'make a note of that']) expect(wantsSave(s), s).toBe(true)
    for (const s of ['why ten?', 'what notes do musicians use', 'save time how?']) expect(wantsSave(s), s).toBe(false)
  })

  it('saves what was meant when asked and the reply saved nothing', () => {
    const t = thread([
      { role: 'user', content: 'Why ten?' },
      { role: 'assistant', content: 'Because we have ten fingers.' },
      { role: 'user', content: 'save this to my notes' },
      { role: 'assistant', content: 'Done.' }
    ])
    expect(saveFallback(t)).toBe('Because we have ten fingers.')
    // The first question in the thread: the phrase it is about
    expect(saveFallback(thread([{ role: 'user', content: 'save this to my notes' }]))).toBe('because of fingers')
  })

  it('puts a saved point into the reply as a note block', () => {
    expect(withNote('Done.', 'Base ten: fingers.')).toBe('Done.\n\n<note>Base ten: fingers.</note>')
    expect(withNote('', '<note>x</note>')).toBe('<note>x</note>')
    expect(withNote('Done.', '  ')).toBe('Done.')
    expect(cleanNoteText('<note> a </note>')).toBe('a')
  })

  it('gives Claude a save_to_notes tool that shows the point in the thread', async () => {
    const tool = EXTRA_TOOLS.find((t) => t.name === 'save_to_notes')!
    expect(tool).toBeTruthy()
    const steps: Omit<AgentStep, 'id'>[] = []
    const ctx = { signal: new AbortController().signal, sources: [], emitSources: () => {}, step: (s: Omit<AgentStep, 'id'>) => (steps.push(s), 'a'), updateStep: () => {}, web: false, labId: 'lesson:x', chatId: undefined }
    const said = await tool.run({ text: 'Base 60 divides evenly by 2, 3, 4, 5 and 6.' }, ctx as never)
    expect(said).toMatch(/Saved/)
    expect(steps).toEqual([expect.objectContaining({ kind: 'save_note', label: 'Added to your notes', detail: 'Base 60 divides evenly by 2, 3, 4, 5 and 6.' })])
    expect(await tool.run({ text: ' ' }, ctx as never)).toMatch(/Nothing to save/)
    expect(steps).toHaveLength(1)
  })

  it('saves a reply as its key point without a model: a bolded concept and its first sentences', () => {
    const reply =
      'Good question! **Two’s complement** stores a negative number as the bits that add to it to make $2^n$. So in 8 bits, $-1$ is 11111111, because 11111111 + 1 wraps to 0. It also means one adder does both sums. Does that make sense?'
    const point = keyPoint(reply)
    expect(point).toBe('**Two’s complement:** Two’s complement stores a negative number as the bits that add to it to make $2^n$. So in 8 bits, $-1$ is 11111111, because 11111111 + 1 wraps to 0.')
    // The phrase the thread is about names the concept when there is one
    expect(keyPoint('A hex digit is four bits. So 0xFF is one byte.', 'hex digit')).toBe('**Hex digit:** A hex digit is four bits. So 0xFF is one byte.')
    // Numbers with points in them stay whole; a reply that only asks back saves nothing
    expect(keyPoint('Pi is about 3.14 to two places.')).toBe('Pi is about 3.14 to two places.')
    expect(keyPoint('What do you think?')).toBe('')
    // A sentence that only names the concept is left to the label
    expect(keyPoint('Good question! **Count versus largest** is the slip here. With $n$ hex digits there are $16^n$ values, from 0 up to $16^n - 1$. For example, one hex digit goes from 0 to F, which is 15. Does that make sense now?')).toBe(
      '**Count versus largest:** With $n$ hex digits there are $16^n$ values, from 0 up to $16^n - 1$. For example, one hex digit goes from 0 to F, which is 15.'
    )
  })

  it('never puts the question you asked into the saved point', () => {
    const question = 'why is the largest 8 digit hex number FFFFFFFF and not 100000000 i dont get it'
    const t = thread([
      { role: 'user', content: question },
      { role: 'assistant', content: 'Counting starts at 0, so $n$ hex digits reach $16^n - 1$, not $16^n$. For example, one hex digit goes up to F, which is 15.' }
    ], [1])
    const saved = threadNotes(t)
    expect(saved).toHaveLength(1)
    expect(saved[0]).not.toContain(question)
    expect(saved[0]).not.toMatch(/dont get it|largest 8 digit/)
    expect(saved[0]).toBe('**Because of fingers:** Counting starts at 0, so $n$ hex digits reach $16^n - 1$, not $16^n$. For example, one hex digit goes up to F, which is 15.')
    expect(replyPoint(t, 0)).toBe('')
    // Nor does the notes model ever see it
    expect(pointPrompt(t.messages[1].content, { quote: t.quote, topic: 'Binary and hex' })).not.toContain(question)
    expect(POINT_SYSTEM).toMatch(/concept's own name in bold/)
  })

  it('takes the notes model’s point only when it is one', () => {
    expect(cleanPoint('Key point: **Count versus largest:** $n$ digits give $16^n$ values, up to $16^n - 1$. For example, FF is 255.')).toBe('**Count versus largest:** $n$ digits give $16^n$ values, up to $16^n - 1$. For example, FF is 255.')
    expect(cleanPoint('')).toBeNull()
    expect(cleanPoint('<note>x</note>')).toBeNull()
    expect(cleanPoint('x'.repeat(1000))).toBeNull()
  })
})
