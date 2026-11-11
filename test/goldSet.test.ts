import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { recallDueNote } from '../src/shared/lessonMemory'
import { SCENARIOS } from '../scripts/eval/tutor/scenarios'
import { learnerText } from '../scripts/eval/tutor/request'
import { scoreReply } from '../scripts/eval/tutor/score'
import type { Scenario } from '../scripts/eval/tutor/types'
import { estimateTokens, matchesBenchmark } from '../scripts/finetune/filters'
import { calibrate, distinctiveNumbers, heldOutCheck, prepareBenchmark, THRESHOLDS } from '../scripts/finetune/gold/heldout'
import { fullExpect, GOLD_SITUATIONS, GOLD_SUBJECTS, goldMessages, nearCopies, parseSource, readGoldLines, simProblems, validateGold, type GoldExample } from '../scripts/finetune/gold/lib'

const DIR = join(__dirname, '..', 'scripts', 'finetune', 'gold')
const KEPT: GoldExample[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.jsonl'))
  .sort()
  .flatMap((f) => readGoldLines(readFileSync(join(DIR, f), 'utf8')))
const BENCH = prepareBenchmark(SCENARIOS)

/** A benchmark scenario dressed as a gold example: what the held-out rule exists to stop */
const asGold = (s: Scenario, over: Partial<GoldExample> = {}) => ({ setup: s.setup, history: s.history, reply: s.good, ...over })

// An invented example, far from every scenario
const SOURCE = String.raw`
@@@@ wrong-heap-parent-index
situation: after-wrong
topic: Binary heaps in an array
voice: overconfident
level: easy
expect: {"verdict":"wrong","names":["i [−-] 1"],"must":["\\b3\\b"],"setsProblem":true}
@@ tutor
**Problem 1 · warm-up**

A binary heap is stored in an array counted from 0. Give the index of the parent of the node at index 8.

<solution>parent(i) = (i − 1) div 2 = 7 div 2 = 3.</solution>
<check lang="python">
assert (8 - 1) // 2 == 3
</check>

<ask type="problem">The parent's index, with the formula you used.</ask>
@@ learner answer sure
4, the parent is at i / 2 so 8 / 2 = 4.
@@ reply
<grade verdict="wrong" score="0.1">"the parent is at i / 2" is the formula for an array counted from 1. Counted from 0, the children of node p are at 2p + 1 and 2p + 2, so the parent of i is (i − 1) div 2, which for 8 is 3.</grade>

<card>Parent of node i in a 0-indexed binary heap? :: (i − 1) div 2. The formula i div 2 belongs to 1-indexed arrays.</card>

<note>0-indexed heap: children of p are 2p + 1 and 2p + 2; parent of i is (i − 1) div 2.</note>

**Problem 2 · same idea**

In the same array, give the index of the parent of the node at index 11.

<solution>(11 − 1) div 2 = 5.</solution>
<check lang="python">
assert (11 - 1) // 2 == 5
</check>

<ask type="problem">The parent's index, with the subtraction shown.</ask>
@@ verify
assert (8 - 1) // 2 == 3 and 8 // 2 == 4 and (11 - 1) // 2 == 5
`
const parsed = parseSource(SOURCE, 'algorithms')
const GOOD = parsed.examples[0]
const change = (over: Partial<GoldExample> & { replyFrom?: [string | RegExp, string] }): GoldExample => {
  const { replyFrom, ...rest } = over
  return { ...GOOD, ...rest, ...(replyFrom ? { reply: GOOD.reply.replace(replyFrom[0], replyFrom[1]) } : {}) }
}
const fails = (g: GoldExample, part: string | RegExp) => expect(validateGold(g).join('\n')).toMatch(part)

describe('the held-out rule', () => {
  it('sets its thresholds above what the benchmark\'s own scenarios share with each other', () => {
    // The explain-from-memory openings all repeat one sentence the lesson's instructions dictate; the gold set has no such lessons.
    // Close readings likewise open with the discussion's own first question (shared/closeReading), written by the app, not the model
    const c = calibrate(SCENARIOS.filter((s) => s.situation !== 'recall-open' && !s.discuss))
    expect(c.wording).toBeLessThan(THRESHOLDS.wording)
    expect(c.wording).toBeGreaterThan(THRESHOLDS.wording / 2) // not set idly high: the threshold is within a factor of two of chance
    expect(c.wordingWhole).toBeLessThan(THRESHOLDS.wordingWhole)
    expect(c.numbers).toBeLessThan(THRESHOLDS.numbers)
    // And it is stricter than the builder's own refusal, which starts at half the wording
    expect(THRESHOLDS.wording).toBeLessThan(0.5)
  })

  it('catches every benchmark scenario presented as a gold example', () => {
    for (const s of SCENARIOS) expect(heldOutCheck(asGold(s), BENCH).clashes.map((c) => c.scenario), s.id).toContain(s.id)
  })

  // An explain-from-memory opening is nothing but its topic and the sentence the instructions dictate: the topic rule is what covers it
  const WORDED = SCENARIOS.filter((s) => s.situation !== 'recall-open')

  it('still catches each one under another topic, by its wording', () => {
    for (const s of WORDED) {
      const kinds = heldOutCheck(asGold(s, { setup: { ...s.setup, topic: 'Knitting patterns' } }), BENCH).clashes.filter((c) => c.scenario === s.id).map((c) => c.kind)
      expect(kinds, s.id).toContain('wording')
    }
  })

  it('still catches each one with every number changed as well, by its wording', () => {
    const renumber = (t: string) => t.replace(/\d/g, (d) => String((Number(d) + 3) % 10))
    for (const s of WORDED) {
      const copy = { setup: { ...s.setup, topic: 'Knitting patterns' }, history: s.history.map((t) => ('tutor' in t ? { tutor: renumber(t.tutor) } : 'answer' in t.learner ? { learner: { ...t.learner, answer: renumber(t.learner.answer) } } : t)), reply: renumber(s.good) }
      expect(heldOutCheck(copy, BENCH).clashes.some((c) => c.scenario === s.id && c.kind === 'wording'), s.id).toBe(true)
    }
  })

  it('catches a scenario\'s calculation put in other words, by its numbers', () => {
    const reworded = {
      setup: { mode: 'teach' as const, topic: 'Adding signed bytes' },
      history: [{ tutor: 'Work out the byte you get from 01100100 plus 01000110.\n\n<solution>10101010</solution>\n\n<ask type="problem">Which byte comes out, and what number is it when read as signed?</ask>' }, { learner: { answer: '10101010 which reads as minus 86' } }],
      reply: '<grade verdict="correct" score="1">"10101010" is the byte, and it reads as -86 because 170 is past 127.</grade>\n\n<ask type="short">Which flag records that?</ask>'
    }
    const found = heldOutCheck(reworded, BENCH).clashes
    expect(found.some((c) => c.kind === 'numbers' && c.scenario === 'systems-after-correct-twos-complement')).toBe(true)
  })

  it('refuses a scenario\'s topic, and a near topic asking the same question', () => {
    expect(heldOutCheck({ setup: { mode: 'teach', topic: 'Raft leader election' }, history: [], reply: 'Something new entirely about how a candidate wins.' }, BENCH).clashes.some((c) => c.kind === 'topic')).toBe(true)
    const s = SCENARIOS.find((x) => x.id === 'systems-idk-page-fault')!
    const asked = 'tutor' in s.history[0] ? s.history[0].tutor.match(/<ask[^>]*>([\s\S]*?)<\/ask>/)![1] : ''
    const near = { setup: { mode: 'teach' as const, topic: 'Page faults in Linux' }, history: [], reply: `**Why this matters**\n\nA fresh paragraph in other words.\n\n<ask type="short">${asked.split(' ').reverse().join(' ')}</ask>` }
    expect(heldOutCheck(near, BENCH).clashes.some((c) => c.kind === 'question' || c.kind === 'topic')).toBe(true)
  })

  it('passes an example that shares nothing', () => {
    expect(parsed.problems).toEqual([])
    expect(heldOutCheck(GOOD, BENCH).clashes).toEqual([])
  })

  it('counts as distinctive only numbers a lesson would be recognised by', () => {
    expect([...distinctiveNumbers('8 bits, 16 KiB, 0.5, 100 s, 1024, 0x2C, 11111011, 3.75 and 183')].sort()).toEqual(['0x2c', '11111011', '183', '3.75'])
  })

  it('holds for every example kept: none shares a topic, wording or numbers with any scenario', () => {
    const topics = new Set(SCENARIOS.map((s) => s.setup.topic.toLowerCase()))
    const benchTexts = SCENARIOS.flatMap((s) => [s.good, ...s.history.flatMap((t) => ('tutor' in t ? [t.tutor] : 'answer' in t.learner ? [t.learner.answer] : 'question' in t.learner ? [t.learner.question] : []))])
    // What build.ts compares a gold example's last learner message with: every benchmark text, as the app words it
    const builderTexts = SCENARIOS.flatMap((s) => [s.good, ...s.history.map((t) => ('tutor' in t ? t.tutor : learnerText(t.learner)))]).filter((t) => t.length > 40)
    let nearest = { wording: 0, wordingWhole: 0, numbers: 0 }
    for (const g of KEPT) {
      const h = heldOutCheck(g, BENCH)
      expect(h.clashes, g.id).toEqual([])
      nearest = { wording: Math.max(nearest.wording, h.nearest.wording), wordingWhole: Math.max(nearest.wordingWhole, h.nearest.wordingWhole), numbers: Math.max(nearest.numbers, h.nearest.numbers) }
      // The builder's own refusals, which it would otherwise apply silently
      expect(topics.has(g.setup.topic.toLowerCase()), g.id).toBe(false)
      expect(matchesBenchmark(g.reply, benchTexts), g.id).toBe(false)
      const last = g.history.at(-1)
      const said = last && 'learner' in last && ('answer' in last.learner || 'question' in last.learner) ? learnerText(last.learner) : ''
      expect(matchesBenchmark(said, builderTexts), g.id).toBe(false)
    }
    expect(nearest.wording).toBeLessThan(THRESHOLDS.wording)
    expect(nearest.wordingWhole).toBeLessThan(THRESHOLDS.wordingWhole)
    expect(nearest.numbers).toBeLessThan(THRESHOLDS.numbers)
  }, 60_000)
})

describe('validating a gold example', () => {
  it('reads the source format and states the situation\'s expectations in full', () => {
    expect(GOOD.id).toBe('algorithms-wrong-heap-parent-index')
    expect(GOOD.group).toBe('binary-heaps-in-an-array')
    expect(GOOD.history).toHaveLength(2)
    expect(GOOD.expect).toMatchObject({ ends: 'ask', verdict: 'wrong', need: ['card'], words: { min: 0, max: 230 } })
    expect(validateGold(GOOD)).toEqual([])
    expect(scoreReply({ expect: GOOD.expect, situation: 'after-correct', setup: GOOD.setup }, GOOD.reply).pass).toBe(true)
  })

  it('adds what each situation always requires', () => {
    const at = (situation: GoldExample['situation'], history: GoldExample['history'] = [], options?: GoldExample['setup']['options']) => fullExpect({ situation, setup: { mode: 'teach', topic: 'T', options }, history }, {})
    expect(at('open')).toMatchObject({ ends: 'ask', heading: 'Why this matters', forbid: ['grade', 'summary', 'solution'], words: { min: 40, max: 260 } })
    expect(at('open', [], { why: true }).words).toEqual({ min: 40, max: 390 })
    expect(at('open', [], { refresh: true }).heading).toBeUndefined()
    expect(at('show-me', [{ tutor: 'x' }, { learner: { showMe: true } }])).toMatchObject({ ends: 'nothing', forbid: ['grade'], words: { max: 90 } })
    expect(at('show-me', [{ tutor: 'x' }, { learner: { question: 'show it running' } }]).ends).toBe('either')
    expect(at('summary')).toMatchObject({ ends: 'nothing', need: ['summary'] })
    expect(at('open-recall')).toMatchObject({ forbid: ['grade', 'summary', 'card'], words: { max: 90 } })
    expect(fullExpect({ situation: 'mark-error', setup: { mode: 'teach', topic: 'T' }, history: [] }, { verdict: 'partial' }).need).toEqual(['card'])
    // Stating them twice changes nothing, so a line in the JSONL can be checked against its own situation
    expect(fullExpect(GOOD, GOOD.expect)).toEqual(GOOD.expect)
  })

  it('refuses a wrong mark, a score that disagrees with it, and a mark that quotes nothing', () => {
    fails(change({ replyFrom: ['verdict="wrong" score="0.1"', 'verdict="correct" score="1"'] }), /scorer: verdict/)
    fails(change({ replyFrom: ['score="0.1"', 'score="0.7"'] }), /a wrong answer scores at most 0.3/)
    fails(change({ replyFrom: ['"the parent is at i / 2"', 'Halving the index'] }), /does not quote the learner/)
    fails(change({ replyFrom: ['"the parent is at i / 2"', '"the parent sits at i over 2"'] }), /does not quote the learner/)
  })

  it('refuses a broken protocol: no card after a miss, no solution, a question in plain text, the answer in the question', () => {
    fails(change({ replyFrom: [/<card>[\s\S]*?<\/card>/, ''] }), /scorer: need:card/)
    // A missing <solution> is no longer the reply's fault to the scorer: the app now works one out for any problem it is set
    // A question the learner cannot answer in: outside the ask, in a reply that sets no problem
    const asksTwice = { ...GOOD, expect: { ...GOOD.expect, setsProblem: false }, reply: GOOD.reply.replace(/\*\*Problem 2[\s\S]*$/, 'So what went wrong with the halving?\n\n<ask type="short">Which array layout does i div 2 belong to?</ask>') }
    fails(asksTwice, /scorer: plain-question/)
    fails({ ...GOOD, expect: { ...GOOD.expect, askMustNot: ['subtraction'] } }, /scorer: no-leak/)
    fails({ ...GOOD, expect: { ...GOOD.expect, must: ['\\b3\\b', 'parent of i is \\(i \\+ 1\\)'] } }, /scorer: must:/)
  })

  it('refuses expectations weaker than the situation requires, and a missing verdict', () => {
    fails({ ...GOOD, expect: { ...GOOD.expect, need: [] } }, /not the full set/)
    fails({ ...GOOD, expect: { ...GOOD.expect, words: { min: 0, max: 900 } } }, /not the full set/)
    const { verdict: _v, ...noVerdict } = GOOD.expect
    fails({ ...GOOD, expect: noVerdict }, /true verdict must be given/)
    const { names: _n, ...noNames } = GOOD.expect
    fails({ ...GOOD, expect: noNames }, /needs "names"/)
  })

  it('refuses the wrong voice: American spelling, praise, an exclamation mark, too many words', () => {
    fails(change({ replyFrom: ['Counted from 0, the children', 'This behavior is common. Counted from 0, the children'] }), /American spelling.*behavior/)
    fails(change({ replyFrom: ['Counted from 0, the children', 'We normalize the index first. Counted from 0, the children'] }), /American spelling.*normalize/)
    fails(change({ replyFrom: ['**Problem 2 · same idea**', 'Great question to try next.\n\n**Problem 2 · same idea**'] }), /praise or padding/)
    fails(change({ replyFrom: ['In the same array, give', 'Now try this one!\n\nIn the same array, give'] }), /exclamation/)
    fails(change({ replyFrom: ['In the same array, give', `${'The heap keeps its shape by filling each level from the left. '.repeat(25)}\n\nIn the same array, give`] }), /scorer: pace/)
    // Code and maths are not prose: a C identifier or a library call may be spelt as its language spells it
    expect(validateGold(change({ replyFrom: ['<note>0-indexed heap:', '<note>`normalize(color)` is a function name. 0-indexed heap:'] }))).toEqual([])
  })

  it('refuses what the builder would alter or leave out', () => {
    fails(change({ replyFrom: ['In the same array', 'In the array 1010 1100 0011 0101'] }), /scrub would alter/)
    fails(change({ replyFrom: ['In the same array', 'In the file /Users/someone/heap.c'] }), /scrub would alter/)
    fails({ ...GOOD, setup: { mode: 'interview', topic: GOOD.setup.topic } }, /not part of the set/)
    fails({ ...GOOD, setup: { ...GOOD.setup, options: { strategy: 'walkthrough' } } }, /needs tools/)
    fails({ ...GOOD, history: [GOOD.history[0], { learner: { answer: `${'x '.repeat(9000)}` } }] }, /too long for the training window/)
  })

  it('refuses an example that states results with nothing to check them', () => {
    const { verify: _v, ...bare } = GOOD
    fails(bare as GoldExample, /needs a verify script/)
    fails({ ...(bare as GoldExample), noverify: 'trust me' }, /code is involved/)
  })

  it('holds the tutor\'s earlier turns to the protocol too', () => {
    const first = 'tutor' in GOOD.history[0] ? GOOD.history[0].tutor : ''
    // A missing <solution> is no longer the reply's fault to the scorer: the app now works one out for any problem it is set
    fails({ ...GOOD, history: [{ tutor: first.replace(/<ask[\s\S]*<\/ask>/, '<continue/>') }, GOOD.history[1]] }, /answers a question turn 1 never asked/)
  })

  it('follows the hidden notes the lesson screen adds to the learner\'s message', () => {
    const tangent = parseSource(
      String.raw`
@@@@ tangent-heap-versus-bst
situation: tangent
topic: Binary heaps in an array
voice: plain
level: easy
expect: {"must":["sorted"]}
noverify: conceptual
@@ tutor
A heap keeps its smallest element at the root.

<note>Min-heap: every parent is at most its children, so the minimum is at the root.</note>

<ask type="short">Where is the largest element of a min-heap of 7 distinct values: which positions could hold it?</ask>
@@ learner answer unsure
one of the leaves
@@ tutor
<grade verdict="correct" score="1">"one of the leaves" is right: a node with a child is smaller than that child.</grade>

<ask type="short">In an array of 7 elements counted from 0, which indices are the leaves?</ask>
@@ learner question
is a heap the same as a binary search tree?
@@ reply
No. A binary search tree is sorted across: everything in a node's left subtree is smaller than it and everything in the right is larger, so an in-order walk gives sorted output. A heap only orders parent against child, which is enough to find the minimum and no more.

<ask type="short">Back to the array of 7 elements: which indices have no children?</ask>`,
      'algorithms'
    ).examples[0]
    // A question of their own, two exchanges in: Tide asks for a note with the reply
    expect(goldMessages(tangent).at(-1)!.content).toContain('End your reply with a <note>')
    fails(tangent, /Tide asks for a <note>/)
    expect(validateGold({ ...tangent, reply: tangent.reply.replace('<ask', '<note>Heap versus BST: a BST is sorted left to right (in-order gives sorted output); a heap only orders each parent against its children.</note>\n\n<ask') })).toEqual([])
  })

  it('builds an opening with what the app would say about earlier lessons, in the app\'s words', () => {
    const recall = [{ prompt: 'Where is the minimum of a min-heap?', topic: 'Binary heaps in an array', reviews: 2, lapses: 1 }]
    const open: GoldExample = { ...GOOD, id: 'x-open-recall', situation: 'open-recall', history: [], before: { recall }, reply: '<ask type="short">Where is the minimum of a min-heap?</ask>', expect: fullExpect({ situation: 'open-recall', setup: GOOD.setup, history: [] }, { askMustNot: ['root'] }), verify: undefined, noverify: 'only repeats the question due' }
    const first = goldMessages(open)[1].content
    expect(first.startsWith(recallDueNote(recall))).toBe(true)
    expect(first).toContain('asked 2 times since, missed 1')
    expect(first).toMatch(/\n\n---\n\nHow to tutor me here:\nYou are running a TEACH session on: Binary heaps in an array/)
    expect(first.endsWith('I want to learn Binary heaps in an array deeply. Start by finding out what I already know.')).toBe(true)
    expect(validateGold(open)).toEqual([])
    fails({ ...open, reply: '<ask type="short">Which element of a min-heap is smallest?</ask>' }, /first question due for recall, in its own words/)
    const prior: GoldExample = { ...open, situation: 'open-prior', before: { prior: [{ topic: 'Hash tables', daysAgo: 2, right: 3 }] } }
    fails(prior, /not close enough to this topic/)
    const close = { ...prior, before: { prior: [{ topic: 'Binary heaps', daysAgo: 2, right: 3, missed: ['Why is building a heap O(n)?'] }] } }
    expect(goldMessages(close)[1].content).toMatch(/^From Tide’s record of earlier lessons[\s\S]*"Binary heaps", 2 days ago\. 3 questions marked: 3 right, 0 partly, 0 wrong\. missed: "Why is building a heap O\(n\)\?"/)
  })

  it('holds a sim block to the kinds and parts that exist', () => {
    expect(simProblems('{"kind":"softmax","logits":[2,1,0.1],"labels":["a","b","c"],"temperature":1,"tour":[{"at":"logit:2","say":"The second logit."}]}')).toEqual([])
    expect(simProblems('{"kind":"gradient-descent","surface":"ravine","optimiser":"momentum","rate":0.05,"momentum":0.9}')).toEqual([])
    expect(simProblems('{"kind":"neural-net","layers":[2,8,8,8,1],"data":"spiral","activation":"relu"}')).toEqual([])
    expect(simProblems('{"kind":"k-means","k":3}').join()).toMatch(/does not exist/)
    expect(simProblems('{"kind":"gradient-descent","surface":"valley","optimizer":"rmsprop"}').join()).toMatch(/"optimizer" is not documented[\s\S]*surface "valley"/)
    expect(simProblems('{"kind":"neural-net","layers":[2,16,1]}').join()).toMatch(/layers/)
    expect(simProblems('{"kind":"neural-net","data":"spiral","activation":"tanh","layers":[2,4,1]}').join()).toMatch(/spiral needs relu/)
    expect(simProblems('{"kind":"softmax","logits":[1,2],"labels":["a"]}').join()).toMatch(/labels/)
    expect(simProblems('{"kind":"attention","tokens":["a","b"],"tour":[{"at":"neuron:1:2","say":"x"}]}').join()).toMatch(/not a part of attention/)
    expect(simProblems("{kind: 'softmax'}").join()).toMatch(/not valid JSON/)
  })

  it('notices replies that are near-copies of one another', () => {
    expect(nearCopies([GOOD, { ...GOOD, id: 'twin', reply: GOOD.reply.replace('index 11', 'index 13') }])).toMatchObject([{ id: 'twin', of: GOOD.id }])
    expect(nearCopies([GOOD, { ...GOOD, id: 'other', reply: '<grade verdict="correct" score="1">"3" is right.</grade>\n\nA different reply altogether, about sifting an element down until both of its children are at least as large as it is.\n\n<ask type="short">How many swaps at most?</ask>' }])).toEqual([])
  })
})

describe('the gold set kept in the repository', () => {
  it('holds between 500 and 800 examples', () => {
    expect(KEPT.length).toBeGreaterThanOrEqual(500)
    expect(KEPT.length).toBeLessThanOrEqual(800)
  })

  it('keeps only examples that pass the scorer and every rule, each with its expectations in full', () => {
    const ids = new Set<string>()
    for (const g of KEPT) {
      expect(ids.has(g.id), `${g.id} twice`).toBe(false)
      ids.add(g.id)
      expect(validateGold(g), g.id).toEqual([])
      expect(scoreReply({ expect: g.expect, situation: 'after-correct', setup: g.setup }, g.reply).failed, g.id).toEqual([])
    }
  })

  it('builds each into a request the builder keeps: the app\'s instructions first, the learner last, within the window', () => {
    for (const g of KEPT) {
      const m = goldMessages(g)
      expect(m[0].role).toBe('system')
      expect(m[1].content, g.id).toContain('How to tutor me here:')
      expect(m.at(-1)!.role, g.id).toBe('user')
      expect(estimateTokens([...m, { role: 'assistant', content: g.reply }]), g.id).toBeLessThanOrEqual(7500)
    }
  })

  it('covers every subject in every situation, with no near-copies', () => {
    for (const subject of GOLD_SUBJECTS) for (const situation of GOLD_SITUATIONS) expect(KEPT.filter((g) => g.subject === subject && g.situation === situation).length, `${subject} × ${situation}`).toBeGreaterThanOrEqual(1)
    for (const subject of GOLD_SUBJECTS) expect(KEPT.filter((g) => g.subject === subject).length, subject).toBeGreaterThanOrEqual(30)
    expect(nearCopies(KEPT)).toEqual([])
  })

  it('shows the model not-right answers marked as such: at least a third of the marks', () => {
    const marked = KEPT.filter((g) => g.expect.verdict)
    const notRight = marked.filter((g) => g.expect.verdict !== 'correct')
    expect(notRight.length / marked.length).toBeGreaterThanOrEqual(1 / 3)
    expect(marked.filter((g) => g.expect.verdict === 'correct').length / marked.length).toBeGreaterThanOrEqual(1 / 3)
  })

  it('varies the learner, the level and the way of teaching', () => {
    for (const voice of ['terse', 'wordy', 'confused', 'overconfident', 'typos', 'plain']) expect(KEPT.filter((g) => g.voice === voice).length, voice).toBeGreaterThanOrEqual(25)
    for (const level of ['easy', 'medium', 'hard']) expect(KEPT.filter((g) => g.level === level).length, level).toBeGreaterThanOrEqual(50)
    expect(KEPT.filter((g) => g.setup.mode === 'quiz').length).toBeGreaterThanOrEqual(14)
    expect(KEPT.filter((g) => g.setup.options?.why).length).toBeGreaterThanOrEqual(28)
    for (const strategy of ['dialogue', 'maths', 'code']) expect(KEPT.filter((g) => g.setup.options?.strategy === strategy).length, strategy).toBeGreaterThanOrEqual(14)
    expect(KEPT.filter((g) => /<continue\b/.test(g.reply)).length).toBeGreaterThanOrEqual(10)
    expect(KEPT.filter((g) => /<plan\b/.test(g.reply)).length).toBeGreaterThanOrEqual(14)
    const visuals = (re: RegExp) => KEPT.filter((g) => g.situation === 'show-me' && re.test(g.reply)).length
    for (const re of [/```mermaid\s*\n\s*(flowchart|graph)/, /```mermaid\s*\n\s*sequenceDiagram/, /```mermaid\s*\n\s*stateDiagram/, /```mermaid\s*\n\s*mindmap/, /```sim/, /```(chart|sql)/, /\|\s*-{2,}/]) expect(visuals(re), String(re)).toBeGreaterThanOrEqual(3)
  })
})
