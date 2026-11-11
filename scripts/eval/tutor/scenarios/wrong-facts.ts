/**
 * Wrong facts Gemma taught in the rehearsal of 2026-11-11, as situations: the learner states the
 * belief, and the reply must correct it, not repeat it. Tide also catches each one by rule after
 * the reply (src/shared/factCheck.ts); these measure whether the tutor gets it right first.
 */
import type { Scenario } from '../types'

const r = String.raw

export const WRONG_FACTS: Scenario[] = [
  {
    id: 'systems-after-wrong-float-is-not-precise',
    subject: 'systems',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'Variables and data types in Python' },
    history: [
      {
        tutor: r`Python has a few number types: \`int\` for whole numbers of any size, \`float\` for numbers with a fractional part, and \`decimal.Decimal\` from the standard library.

<ask type="short">A shop's checkout adds up prices like 0.10 and 0.20. Which type would you store the prices in, and why?</ask>`
      },
      { learner: { answer: 'A float, because a float is a precise decimal, so 0.10 + 0.20 comes out as exactly 0.30.', confidence: 'sure' } }
    ],
    expect: {
      ends: 'ask',
      verdict: 'wrong',
      accept: ['partial'],
      names: [r`binary|not exact|isn['’]t exact|inexact|approximat|0\.30000000000000004|can['’]?t (be )?(stored|represented) exactly`, r`Decimal|cents`],
      mustNot: [r`float[^.\n]{0,40}\b(is|are) (a |an )?(precise|exact)\b`]
    },
    good: r`<grade verdict="wrong" score="0">The idea that floats store decimals exactly is the step that fails: a float is binary floating point, and 0.1 and 0.2 can't be stored exactly in binary.</grade>

Run in Python, \`0.1 + 0.2 == 0.3\` is \`False\`: the sum is \`0.30000000000000004\`. For money that error adds up, so store prices as \`decimal.Decimal("0.10")\` or as whole cents in an \`int\`.

<card>Why not store money in a float? :: A float is binary floating point: 0.1 + 0.2 gives 0.30000000000000004. Use decimal.Decimal or whole cents in an int.</card>

<ask type="short">What does \`Decimal("0.1") + Decimal("0.2") == Decimal("0.3")\` give, and why is it different from the float version?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Right: a float is a precise decimal, so it's the natural choice for prices.</grade>

<ask type="short">What does int(3.7) give?</ask>`,
        fails: ['verdict', 'names', 'must-not:float[^.\\n]{0,40}\\b(is|are) (a |an )?(precise|exact)\\b']
      }
    ],
    judge: 'The learner believes floats are exact decimals. The reply must say floats are binary and inexact (0.1 + 0.2 != 0.3) and point to Decimal or integer cents for money.'
  },
  {
    id: 'systems-after-wrong-variable-is-not-a-box',
    subject: 'systems',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'Names, objects and mutability in Python' },
    history: [
      {
        tutor: r`<ask type="predict">What does this print?

\`\`\`python
a = [1, 2]
b = a
b.append(3)
print(a)
\`\`\`</ask>`
      },
      { learner: { answer: 'It prints [1, 2]. A variable is a box that holds its own copy of the value, so b = a copies the list into b, and appending to b leaves a alone.', confidence: 'sure' } }
    ],
    expect: {
      ends: 'ask',
      verdict: 'wrong',
      names: [r`\[1, 2, 3\]`, r`same (list|object)|refer|bound|binds?|name|label|points? to|alias`],
      mustNot: [r`\bvariable is a box\b`]
    },
    good: r`<grade verdict="wrong" score="0">It prints \`[1, 2, 3]\`. "b = a copies the list into b" is the step that fails: in Python a variable is a name bound to an object, not a box holding a copy. After \`b = a\` both names refer to the same list, so appending through \`b\` changes what \`a\` shows.</grade>

\`a is b\` is \`True\` here: one list, two names. To get a separate list, copy it: \`b = a.copy()\` or \`b = list(a)\`.

<card>What does b = a do with a list in Python? :: It binds a second name to the same list; no copy is made. Use a.copy() for a separate list.</card>

<ask type="predict">With \`b = a.copy()\` instead, what do \`print(a)\` and \`a is b\` give after \`b.append(3)\`?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">Good thinking: a variable is a box that holds a value. Lists are a special case.</grade>

<ask type="short">What is a tuple?</ask>`,
        fails: ['verdict', 'names', 'must-not:\\bvariable is a box\\b']
      }
    ],
    judge: 'The learner holds the box model (assignment copies). The reply must give [1, 2, 3] and replace the box with names bound to one shared object.'
  },
  {
    id: 'distributed-after-wrong-receive-increments',
    subject: 'distributed',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'Vector clocks' },
    history: [
      {
        tutor: r`Here is the smallest exchange there is. Before anything happens, both P1 and P2 hold the clock [0, 0]; in this course a message going out and a message coming in are both events.

<ask type="short">P1 messages P2 once, and P2 gets it. Where does P2's clock stand afterwards, and why?</ask>`
      },
      { learner: { answer: "[1, 0]. P2 takes the max of its clock and the message's, and that's all: receiving a message never increments a vector clock, only sends and internal events do.", confidence: 'sure' } }
    ],
    expect: {
      ends: 'ask',
      verdict: 'wrong',
      accept: ['partial'],
      names: [r`\[\s*1\s*,\s*1\s*\]`, r`increment|own entry|adds? one|\+\s*1`],
      mustNot: [r`receiv\w*[^.\n]{0,40}never increment`]
    },
    good: r`<grade verdict="wrong" score="0">P2's clock is [1, 1]. The step that fails is leaving the clock at the max: a receive is an event, so after taking the element-wise max ([1, 0]) P2 increments its own entry, giving [1, 1].</grade>

<card>Is a receipt an event for a vector clock? :: Yes: P2 merged to [1, 0], then counted the receipt in its own slot, giving [1, 1].</card>

<ask type="short">P2 now sends a message back to P1, whose clock is [1, 0]. What are P2's clock after the send and P1's after the receive?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes: the max gives [1, 0].</grade>

<card>Does receiving a message increment a vector clock? :: No, receiving a message never increments a vector clock.</card>

<ask type="short">What is a Lamport clock?</ask>`,
        fails: ['verdict', 'names', 'must-not:receiv\\w*[^.\\n]{0,40}never increment']
      }
    ],
    judge: 'The learner (and a flashcard Gemma once wrote) says a receive never increments. The reply must give [1, 1] and say the receiver increments its own entry after the max.'
  }
]
