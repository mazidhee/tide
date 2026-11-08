import { describe, expect, it } from 'vitest'
import { parseBlocks } from '../src/shared/session'

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
    expect(b[4]).toMatchObject({ type: 'choice', options: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'] })
  })

  it('reads choices written as lines and hides unfinished tags while streaming', () => {
    const b = parseBlocks('<ask type="choice">Pick one:\nA) red\nB) blue\n</ask>')
    expect(b[0]).toMatchObject({ kind: 'ask', prompt: 'Pick one:', options: ['red', 'blue'] })
    expect(parseBlocks('Thinking about it <ask type="short">What is')).toEqual([{ kind: 'text', text: 'Thinking about it' }])
  })

  it('parses plans, scorecards, rubrics and challenges', () => {
    const b = parseBlocks(`<plan>\n1. Halving\n2. Invariants\n</plan><scorecard>\n- Problem solving: 3/4 — clear\n- **Communication**: 2/4 - quiet\n</scorecard><challenge quote="it is always faster">Always? What about tiny arrays?</challenge>`)
    expect(b[0]).toEqual({ kind: 'plan', steps: ['Halving', 'Invariants'] })
    expect(b[1]).toMatchObject({ kind: 'scores', rows: [{ label: 'Problem solving', score: 3, max: 4, note: 'clear' }, { label: 'Communication', score: 2, max: 4, note: 'quiet' }] })
    expect(b[2]).toMatchObject({ kind: 'challenge', quote: 'it is always faster' })
  })
})
