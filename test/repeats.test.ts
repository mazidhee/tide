import { describe, expect, it } from 'vitest'
import { posedProblem, repeatsEarlier } from '../src/shared/session'

const P3 = `<grade verdict="correct" score="1">You correctly identified the imbalance.</grade>

**Problem 3 · harder**

You have a set of 5 apples and 5 stones in a one-to-one correspondence. You move 2 apples to a different basket and remove 2 of the corresponding stones. Now, you want to represent the number of apples in the second basket. If you add 2 more stones to your original set of 5, does this new set of 7 stones represent the total number of apples in both baskets?

<ask type="explain">Explain why or why not.</ask>`

const P4_SAME = P3.replace('You correctly identified the imbalance.', 'You correctly identified that adding extra stones results in more tokens.').replace('Problem 3', 'Problem 4')

const P4_NEW = `<grade verdict="correct" score="1">Right: the surplus breaks the correspondence.</grade>

**Problem 4 · harder**

A shepherd keeps one notch on a stick for every goat in the morning. In the evening three goats are sold and two kids are born. He carves two notches and scratches out three. Does the stick still match the herd, and what would go wrong if he only carved the new notches?

<ask type="explain">Explain using one-to-one correspondence.</ask>`

describe('repeated problems', () => {
  it('reads the problem a reply poses, without the feedback or its label', () => {
    const p = posedProblem(P3)
    expect(p).toContain('you have a set of 5 apples')
    expect(p).toContain('explain why or why not')
    expect(p).not.toContain('problem 3')
    expect(p).not.toContain('imbalance')
  })

  it('catches the same problem asked again, even with new feedback and a new number', () => {
    expect(repeatsEarlier(P4_SAME, ['Intro', P3])).toBe(true)
  })

  it('lets a genuinely new problem through, and short questions too', () => {
    expect(repeatsEarlier(P4_NEW, [P3])).toBe(false)
    expect(repeatsEarlier('<ask type="short">Why?</ask>', ['<ask type="short">Why?</ask>'])).toBe(false)
    expect(repeatsEarlier('<grade verdict="correct" score="1">Good.</grade> Well done, that is the end.', [P3])).toBe(false)
  })
})

describe('notes nudge', () => {
  it('counts tutor replies since the last one that added a note', async () => {
    const { repliesWithoutNote } = await import('../src/shared/session')
    expect(repliesWithoutNote(['Intro <note>1:1 correspondence</note>', 'Problem 1', 'Problem 2'])).toBe(2)
    expect(repliesWithoutNote(['Problem 1', 'Feedback <note>A surplus breaks it</note>'])).toBe(0)
    expect(repliesWithoutNote([])).toBe(0)
  })
})
