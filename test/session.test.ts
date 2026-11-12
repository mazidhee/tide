import { describe, expect, it } from 'vitest'
import { parseBlocks, splitTests } from '../src/shared/session'

describe('parseBlocks', () => {
  it('parses a graded turn with a card and the next question', () => {
    const msg = `Nice try.
<grade verdict="partial" score="0.5">You got the halving idea but not why the array must be sorted.</grade>
<card>Why must the array be sorted for binary search? :: So discarding half is safe: everything left of the midpoint is smaller.</card>
Question 3 of 8.
<ask type="choice" options="O(n)|O(log n)|O(n log n)|O(1)">What is the time complexity?</ask>`
    const b = parseBlocks(msg)
    expect(b.map((x) => x.kind)).toEqual(['text', 'grade', 'card', 'text', 'ask'])
    expect(b[1]).toMatchObject({ verdict: 'partial', score: 0.5 })
    expect(b[2]).toMatchObject({ front: 'Why must the array be sorted for binary search?' })
    // Shown shuffled (the tutor writes the right one first), every option kept
    expect(b[4]).toMatchObject({ type: 'choice' })
    expect([...(b[4] as { options: string[] }).options].sort()).toEqual(['O(1)', 'O(log n)', 'O(n log n)', 'O(n)'])
  })

  it('reads choices written as lines, and streams questions but not other unfinished tags', () => {
    const b = parseBlocks('<ask type="choice">Pick one:\nA) red\nB) blue\n</ask>')
    expect(b[0]).toMatchObject({ kind: 'ask', prompt: 'Pick one:' })
    expect([...(b[0] as { options: string[] }).options].sort()).toEqual(['blue', 'red'])
    // A question being written shows as it comes; other unfinished tags stay hidden
    expect(parseBlocks('Thinking about it <ask type="short">What is')).toEqual([{ kind: 'text', text: 'Thinking about it' }, { kind: 'ask', type: 'short', prompt: 'What is', options: [], lang: undefined }])
    expect(parseBlocks('Close. <grade verdict="partial" score="0.5">You missed')).toEqual([{ kind: 'text', text: 'Close.' }])
  })

  it('parses plans, scorecards, rubrics and challenges', () => {
    const b = parseBlocks(`<plan>\n1. Halving\n2. Invariants\n</plan><scorecard>\n- Problem solving: 3/4 — clear\n- **Communication**: 2/4 - quiet\n</scorecard><challenge quote="it is always faster">Always? What about tiny arrays?</challenge>`)
    expect(b[0]).toEqual({ kind: 'plan', steps: ['Halving', 'Invariants'] })
    expect(b[1]).toMatchObject({ kind: 'scores', rows: [{ label: 'Problem solving', score: 3, max: 4, note: 'clear' }, { label: 'Communication', score: 2, max: 4, note: 'quiet' }] })
    expect(b[2]).toMatchObject({ kind: 'challenge', quote: 'it is always faster' })
  })
})

describe('hidden tests on a code question', () => {
  it('are taken out of what the student sees and kept with the question', () => {
    const reply = 'Write it.\n<ask type="code" lang="python">Write `add(a, b)`.\n```tests\ndef test_adds():\n    assert add(2, 3) == 5\n```\n</ask>'
    const ask = parseBlocks(reply).find((b) => b.kind === 'ask')!
    expect(ask).toMatchObject({ type: 'code', lang: 'python', prompt: 'Write `add(a, b)`.', tests: 'def test_adds():\n    assert add(2, 3) == 5' })
  })

  it('stay hidden while the question is still being written, and a question without them has none', () => {
    const streaming = parseBlocks('<ask type="code" lang="go">Read two numbers and print their sum.\n```tests\n[{"stdin": "2 3", "exp')
    expect(streaming.find((b) => b.kind === 'ask')).toMatchObject({ prompt: 'Read two numbers and print their sum.' })
    const plain = parseBlocks('<ask type="code" lang="c">Print hello.\n```c\nint main(void) {}\n```\n</ask>').find((b) => b.kind === 'ask')!
    expect(plain).not.toHaveProperty('tests')
    expect((plain as { prompt: string }).prompt).toContain('```c')
  })

  it('splits a body by itself', () => {
    expect(splitTests('Which?\n```tests\n[{"expect": "1"}]\n```')).toEqual({ prompt: 'Which?', tests: '[{"expect": "1"}]' })
  })
})

describe('End', async () => {
  const { END_NOW, shouldSumUp, ownWords, parseBlocks } = await import('../src/shared/session')
  it('sums up a session with answers in it, and only once', () => {
    const turns = [{ role: 'user', content: 'Teach me X' }, { role: 'assistant', content: '<ask>Q?</ask>' }, { role: 'user', content: 'Answer: 42' }]
    expect(shouldSumUp(turns, false)).toBe(true)
    expect(shouldSumUp(turns, true)).toBe(false)
    expect(shouldSumUp(turns.slice(0, 2), false)).toBe(false)
  })
  it('shows the student only their own words, and asks for the closing summary', () => {
    expect(ownWords(END_NOW)).toBe("Let's stop here for today.")
    expect(END_NOW).toMatch(/<summary>/)
    expect(parseBlocks('<summary>You learned X.</summary>').some((b) => b.kind === 'summary')).toBe(true)
  })
})
