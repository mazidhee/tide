import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { MARK_NOTE } from '../src/shared/pace'
import { SESSION_FORMAT, SHOW_ME } from '../src/shared/session'
import { decide, type Run } from '../scripts/eval/tutor/compare'
import { judgePrompt, parseJudge } from '../scripts/eval/tutor/judge'
import { buildMessages, lessonTurns } from '../scripts/eval/tutor/request'
import { SCENARIOS } from '../scripts/eval/tutor/scenarios'
import { complete } from '../scripts/eval/tutor/model'
import { rescoreRows } from '../scripts/eval/tutor/rescore'
import { hasTable, paceWords, scoreReply } from '../scripts/eval/tutor/score'
import { summarise, type Row } from '../scripts/eval/tutor/summary'
import { readCompletion, savedTurn, tutorTurn } from '../scripts/eval/tutor/turn'
import { BREADTH_SUBJECTS, SITUATIONS, SUBJECTS, type Expect, type Scenario } from '../scripts/eval/tutor/types'
import { TOOLKITS } from '../src/shared/subjects'
import { SUBJECT_KINDS } from '../src/shared/subjectMap'
import { HANDS_ON } from '../src/shared/session'
import { MIN_BREADTH, MIN_SCENARIOS, validateScenario, validateSet } from '../scripts/eval/tutor/validate'

const fence = (lang: string, body: string) => '```' + lang + '\n' + body + '\n```'

/** A scenario with only what the scorer reads */
const sc = (expect: Expect, situation: Scenario['situation'] = 'after-correct', why = false) => ({ expect, situation, setup: { mode: 'teach' as const, topic: 'Binary search', options: why ? { why: true } : {} } })
const failed = (expect: Expect, reply: string, situation?: Scenario['situation']) => scoreReply(sc(expect, situation), reply).failed
const repaired = (expect: Expect, reply: string, situation?: Scenario['situation']) => scoreReply(sc(expect, situation), reply).repaired

const QUESTION = '<ask type="short">What is the loop invariant of binary search?</ask>'

describe('the scenario set', () => {
  it('is well formed: every request builds, every good reply passes, every bad reply fails as named', () => {
    expect(validateSet(SCENARIOS).problems).toEqual([])
  })

  it('covers every subject in every situation, with at least 60 scenarios', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(MIN_SCENARIOS)
    for (const subject of SUBJECTS) for (const situation of SITUATIONS) expect(SCENARIOS.some((s) => s.subject === subject && s.situation === situation), `${subject} ${situation}`).toBe(true)
  })

  it('has a bad reply marked "correct" for every answer that is not right in the marking situations', () => {
    for (const s of SCENARIOS.filter((x) => x.situation === 'mark-planted-error')) expect(s.bad?.some((b) => b.fails.includes('verdict')), s.id).toBe(true)
  })

  it('notices a scenario that cannot be passed', () => {
    const s = SCENARIOS.find((x) => x.situation === 'after-wrong')!
    expect(validateScenario({ ...s, good: s.good.replace(/verdict="\w+"/, 'verdict="correct"') }).join(' ')).toMatch(/good reply fails: .*verdict/)
    expect(validateScenario({ ...s, bad: [{ reply: s.good, fails: ['verdict'] }] }).join(' ')).toMatch(/should fail verdict/)
  })
})

describe('breadth: subjects outside the core set', () => {
  // A Discuss this turn in philosophy (a humanities scenario) is about a passage, not a lesson's topic, so it has no kinds
  const wide = SCENARIOS.filter((s) => (BREADTH_SUBJECTS as readonly string[]).includes(s.subject) && !s.discuss)

  it('has at least 40 scenarios across at least 20 subjects, each naming its kinds', () => {
    expect(wide.length).toBeGreaterThanOrEqual(MIN_BREADTH.scenarios)
    expect(new Set(wide.map((s) => s.subject)).size).toBeGreaterThanOrEqual(MIN_BREADTH.subjects)
    for (const s of wide) expect(s.kinds?.length, s.id).toBeGreaterThan(0)
  })

  it("sends each lesson its subject's toolkit and none of the others'", () => {
    for (const s of wide) {
      const first = buildMessages(s)[1].content
      for (const k of SUBJECT_KINDS) expect(first.includes(TOOLKITS[k].rules), `${s.id}: ${k}`).toBe(s.kinds!.includes(k))
    }
  })

  it('keeps the code and SQL rules out of lessons that are not built', () => {
    for (const s of wide.filter((x) => ['philosophy', 'world-history', 'music-theory', 'physical-skill', 'linguistics'].includes(x.subject))) expect(buildMessages(s)[1].content, s.id).not.toContain(HANDS_ON)
    for (const s of wide.filter((x) => ['compilers', 'os', 'game-dev'].includes(x.subject))) expect(buildMessages(s)[1].content, s.id).toContain(HANDS_ON)
  })

  it('notices a breadth scenario whose topic is profiled as another kind', () => {
    const s = wide.find((x) => x.subject === 'philosophy')!
    expect(validateScenario({ ...s, kinds: ['build'] }).join(' ')).toMatch(/profiled as interpret, not build/)
    expect(validateScenario({ ...s, kinds: undefined }).join(' ')).toMatch(/names the kinds/)
  })
})

describe('requests', () => {
  const marked = SCENARIOS.find((s) => s.situation === 'after-wrong')!
  it('are built from the app\'s prompts: its system prompt with the tag rules, the instructions at the head of the first message', () => {
    const m = buildMessages(marked)
    expect(m[0].role).toBe('system')
    expect(m[0].content).toContain(SESSION_FORMAT)
    expect(m[0].content).toMatch(/^You are Tide, a patient tutor/)
    expect(m[0].content).toMatch(/Today is Wednesday,? 11 November 2026\./)
    expect(m[1].content).toMatch(/^How to tutor me here:\nYou are running a TEACH session on: /)
    // The answer as the lesson screen sends it, with the hidden marking note every answer carries
    expect(m[m.length - 1].content).toMatch(/^Answer: [\s\S]+\n\(Confidence: sure\)\n\n\(Tide: mark this first\. /)
    expect(m[m.length - 1].content.endsWith(MARK_NOTE)).toBe(true)
  })

  it('send the learner\'s messages in the lesson screen\'s own forms', () => {
    const show = SCENARIOS.find((s) => s.history.some((t) => 'learner' in t && 'showMe' in t.learner))!
    expect(buildMessages(show).at(-1)!.content).toBe(SHOW_ME)
    const tangent = SCENARIOS.find((s) => s.situation === 'tangent')!
    expect(buildMessages(tangent).at(-1)!.content).toMatch(/^My question: /)
    const idk = SCENARIOS.find((s) => s.situation === 'idk')!
    expect(buildMessages(idk).at(-1)!.content).toMatch(/^I don't know\./)
    // Nothing to mark in a question or an "I don't know", so no marking note
    expect(buildMessages(tangent).at(-1)!.content).not.toContain('mark this first')
    expect(buildMessages(idk).at(-1)!.content).not.toContain('mark this first')
  })

  it('add the hidden pace note the app would add (two "I don\'t know" in a row)', () => {
    const turns = lessonTurns({ mode: 'teach', topic: 'Heaps' }, [{ tutor: QUESTION }, { learner: { idk: true } }, { tutor: QUESTION }, { learner: { idk: true } }])
    expect(turns.at(-1)!.content).toContain("(Tide: This turn: they've said twice they don't know.")
    expect(turns[2].content).toBe("I don't know.")
  })
})

describe('protocol', () => {
  const ends: Expect = { ends: 'ask' }

  it('passes a reply that ends with one question in an ask tag', () => {
    const s = scoreReply(sc(ends), `The invariant is what stays true on every pass of the loop.\n\n${QUESTION}`)
    expect(s.failed).toEqual([])
    expect(s.protocol.score).toBe(1)
    expect(s.pass).toBe(true)
  })

  it('fails a question asked in plain text beside the ask, or with nowhere to answer', () => {
    expect(failed(ends, `Do you know what an invariant is?\n\n${QUESTION}`)).toContain('plain-question')
    expect(failed(ends, `What would you check first?\n\nThe invariant is what stays true on every pass.\n\n${QUESTION}`)).toContain('plain-question')
    // Nothing to answer in: the app offers only Go on
    expect(failed(ends, 'The invariant is what stays true on every pass.\n\nWhat do you think the invariant is?\n\n<continue/>')).toEqual(expect.arrayContaining(['plain-question', 'ends']))
  })

  it('scores a closing question in plain text as the app shows it: made the ask, and counted as a repair', () => {
    const reply = 'The invariant is what stays true on every pass.\n\nWhat do you think the invariant is?'
    expect(failed(ends, reply)).toEqual([])
    expect(repaired(ends, reply)).toEqual(['ask'])
    expect(repaired(ends, `The invariant is what stays true on every pass.\n\n${QUESTION}`)).toEqual([])
    // Where no question was wanted, the question the app would make of it still counts
    expect(failed({ ends: 'nothing' }, 'Look at the middle row.\n\nWhat do you notice?', 'show-me')).toContain('ends')
  })

  it('lets a set-up end in the question its ask then puts (a case and its question, like a problem and its ask)', () => {
    // From the baseline: a correct opening that was failed for plain-question
    const cap = `Imagine a database with two nodes, A and B, cut off from each other. A user writes to node A.\n\nIf the system is to stay available, what must happen at node B?\n\n<ask type="short">What does node B have to do to stay available?</ask>`
    expect(failed(ends, cap)).toEqual([])
    const die = `Suppose you roll a fair die. You are told the result is even. What is the probability that it is a 2?\n\n<ask type="short">The probability, as a fraction.</ask>`
    expect(failed(ends, die)).toEqual([])
  })

  it('lets a problem statement end in a question when its ask follows', () => {
    const reply = `**Problem 1 · warm-up**\n\nA sorted array has 1,000,000 elements. How many comparisons does binary search need at most?\n\n<solution>ceil(log2(1000001)) = 20</solution>\n\n<ask type="problem">Your count, with your reasoning.</ask>`
    expect(failed({ ends: 'ask', setsProblem: true }, reply)).toEqual([])
  })

  it('fails two questions, an unclosed tag, and text after the question', () => {
    expect(failed(ends, `${QUESTION}\n\n<ask type="short">And its complexity?</ask>`)).toEqual(expect.arrayContaining(['one-ask', 'ends']))
    expect(failed(ends, 'Here it is.\n\n<ask type="short">What is the invariant')).toEqual(expect.arrayContaining(['tags-closed', 'ends']))
    expect(failed(ends, `${QUESTION}\n\nTake your time with this one.`)).toContain('ends')
  })

  it('allows hidden working, a note or a card after the question', () => {
    expect(failed(ends, `<ask type="problem">Find the midpoint of lo = 4, hi = 9 without overflow.</ask>\n\n<solution>lo + (hi - lo) / 2 = 4 + 2 = 6</solution>\n<note>mid = lo + (hi - lo) / 2 avoids overflow.</note>`)).toEqual([])
  })

  it('checks <continue/> and "no question" endings', () => {
    expect(failed({ ends: 'continue' }, 'First half of the idea.\n\n<continue/>')).toEqual([])
    expect(failed({ ends: 'continue' }, `First half.\n\n${QUESTION}`)).toContain('ends')
    expect(failed({ ends: 'either' }, 'First half.\n\n<continue/>')).toEqual([])
    expect(failed({ ends: 'nothing' }, `Look at the middle row.\n\n${QUESTION}`, 'show-me')).toContain('ends')
    // The app shows the question and drops the <continue/> beside it
    expect(scoreReply(sc({ ends: 'ask' }), `First half.\n\n${QUESTION}\n\n<continue/>`)).toMatchObject({ failed: [], repaired: ['ask'] })
    expect(failed({ ends: 'continue' }, `First half.\n\n${QUESTION}\n\n<continue/>`)).toContain('ends')
  })

  it('fails a malformed ask: unknown type, a choice without options, code without a language, the wrong type', () => {
    expect(failed(ends, '<ask type="quiz">What is it?</ask>')).toContain('ask-attrs')
    expect(failed(ends, '<ask>What is it?</ask>')).toContain('ask-attrs')
    expect(failed(ends, '<ask type="choice">Which one?</ask>')).toContain('ask-attrs')
    expect(failed(ends, '<ask type="choice" options="O(log n)|O(n)|O(1)">Which one?</ask>')).toEqual([])
    expect(failed(ends, '<ask type="code">Write it.</ask>')).toContain('ask-attrs')
    expect(failed({ ends: 'ask', askTypes: ['explain'] }, QUESTION)).toContain('ask-type')
  })

  it('wants a hidden solution with every problem, and a problem when one is due', () => {
    // Too slight for the app to solve for itself, so nothing will supply it
    expect(failed(ends, '<ask type="problem">Which indices are probed?</ask>')).toContain('solution')
    expect(failed({ ends: 'ask', setsProblem: true }, QUESTION)).toEqual(expect.arrayContaining(['sets-problem', 'solution']))
  })

  it('counts a solution the app would work out itself as a repair, not a failure', () => {
    // lessonGuard solves a numbered problem that came without a solution and attaches it, hidden
    const numbered = '**Problem 2 · harder**\n\nSearch for 7 in [1, 3, 5, 7, 9].\n\n<ask type="problem">Which indices are probed?</ask>'
    expect(failed(ends, numbered)).toEqual([])
    expect(repaired(ends, numbered)).toEqual(['solution'])
    expect(repaired(ends, numbered.replace('<ask', '<solution>4, then 6: indices 2 and 3</solution>\n\n<ask'))).toEqual([])
    // So does a problem or code ask with no "Problem 2" heading (from the baseline: a code task set after a wrong answer)
    const typed = '<ask type="code" lang="c">Change f so that it prints the address of the first element and the size of the pointer.</ask>'
    expect(scoreReply(sc(ends), typed)).toMatchObject({ failed: [], repaired: ['solution'] })
  })

  it('does not want a new solution for another go at the problem just marked', () => {
    const history = [{ tutor: '**Problem 1 · warm-up**\n\n<solution>def mid(lo, hi): return lo + (hi - lo) // 2</solution>\n\n<ask type="code" lang="python">Write mid(lo, hi) without overflow.</ask>' }, { learner: { answer: 'def mid(lo, hi): return (lo + hi) / 2' } }]
    const again = '<grade verdict="partial" score="0.5">"(lo + hi) / 2" gives a float, and the sum can overflow in a fixed-width language.</grade>\n\n<ask type="code" lang="python">Change your mid so it returns an integer and never adds lo and hi.</ask>'
    const marking: Expect = { ends: 'ask', verdict: 'wrong', accept: ['partial'] }
    expect(scoreReply({ ...sc(marking), history }, again)).toMatchObject({ failed: [], repaired: [] })
    // The same task after a question that had no solution is new work: the app has to work its solution out
    expect(scoreReply({ ...sc(marking), history: [{ tutor: QUESTION }, history[1]] }, again)).toMatchObject({ failed: [], repaired: ['solution'] })
    // And a new numbered problem too slight to solve still fails
    expect(scoreReply({ ...sc(marking), history }, again.replace('<ask', '**Problem 2 · same level**\n\n<ask').replace('Change your mid so it returns an integer and never adds lo and hi.', 'Write.')).failed).toContain('solution')
  })

  it('catches an answer leaked into the question', () => {
    expect(failed(ends, '<ask type="problem">How many probes?<solution>3</solution></ask>')).toContain('no-leak')
    expect(failed(ends, '<ask type="choice" options="O(log n) (correct)|O(n)|O(1)">Which one?</ask>')).toContain('no-leak')
    expect(failed({ ends: 'ask', askMustNot: ['\\b20\\b'] }, '<ask type="short">Why is the answer 20 comparisons?</ask>')).toContain('no-leak')
    const repeated = 'The array is halved each time, so 20 comparisons are enough for a million elements.'
    expect(failed(ends, `**Problem 1 · warm-up**\n\n${repeated}\n\n<solution>${repeated}</solution>\n\n<ask type="problem">How many comparisons?</ask>`)).toContain('no-leak')
  })

  it('scores the text the app keeps: hidden reasoning and special tokens are cleaned off first', () => {
    // From the baseline: a stray channel marker inside a grade, which shared/modelText strips before anything is shown
    const s = scoreReply(sc({ ends: 'ask', verdict: 'correct' }), `<grade verdict="correct" score="1"><|channel>thought\n<channel|>Right: the invariant holds on every pass.</grade>\n\n${QUESTION}`)
    expect(s.failed).toEqual([])
    expect(failed(ends, `call:run_code{code:1}\n\n${QUESTION}`)).toContain('clean')
  })

  it('fails greetings, voice tags, echoed notes and tool calls in the text', () => {
    expect(failed(ends, `Great question! Let's look at it.\n\n${QUESTION}`)).toContain('no-preamble')
    expect(failed(ends, `<say>Right, the invariant.</say>\n\n${QUESTION}`)).toContain('clean')
    expect(failed(ends, `(Tide: they asked to be tested.)\n\n${QUESTION}`)).toContain('clean')
    expect(failed(ends, `<|tool_call>call:run_code{}<tool_call|>\n\n${QUESTION}`)).toContain('clean')
  })

  it('checks tags that must and must not be there, and a heading', () => {
    expect(failed({ ends: 'ask', need: ['card', 'note'] }, QUESTION)).toEqual(expect.arrayContaining(['need:card', 'need:note']))
    expect(failed({ ends: 'ask', forbid: ['grade'] }, `<grade verdict="wrong" score="0">No.</grade>\n\n${QUESTION}`)).toContain('forbid:grade')
    expect(failed({ ends: 'ask', heading: 'Why this matters' }, QUESTION, 'open')).toContain('heading')
    const opening = `**Why this matters**\n\n${'Binary search is how sorted data is searched in logarithmic time, in databases, in standard libraries and in version control. '.repeat(3)}\n\n${QUESTION}`
    expect(failed({ ends: 'ask', heading: 'Why this matters' }, opening, 'open')).toEqual([])
  })
})

describe('marking', () => {
  const wrong: Expect = { ends: 'ask', verdict: 'wrong', names: ['overflow'] }
  const grade = (v: string, text: string) => `<grade verdict="${v}" score="${v === 'correct' ? 1 : v === 'wrong' ? 0 : 0.5}">${text}</grade>\n\n${QUESTION}`

  it('scores the verdict against the truth and reads the feedback for what it must name', () => {
    const s = scoreReply(sc(wrong), grade('wrong', '"(lo + hi) / 2" can overflow when both are large: that is the step that fails.'))
    expect(s.marking).toEqual({ score: 1, expected: 'wrong', got: 'wrong', falseCorrect: false, rejectedRight: false, named: true })
    expect(s.failed).toEqual([])
  })

  it('flags the costly mistake: something not right marked correct', () => {
    const s = scoreReply(sc(wrong), grade('correct', 'Yes, that midpoint is right.'))
    expect(s.marking).toMatchObject({ score: 0, falseCorrect: true, named: false })
    expect(s.failed).toEqual(expect.arrayContaining(['verdict', 'names']))
  })

  it('flags a right answer marked down, and catches the error unnamed', () => {
    expect(scoreReply(sc({ ends: 'ask', verdict: 'correct' }), grade('partial', 'Nearly.')).marking).toMatchObject({ score: 0, rejectedRight: true, named: null })
    expect(scoreReply(sc(wrong), grade('wrong', 'Not right. Look again.')).marking).toMatchObject({ score: 1, named: false })
  })

  it('accepts a second fair verdict when the scenario allows one, never otherwise', () => {
    const slip: Expect = { ends: 'ask', verdict: 'partial', accept: ['wrong'] }
    expect(scoreReply(sc(slip), grade('wrong', 'The last step is off.')).marking!.score).toBe(1)
    expect(scoreReply(sc(slip), grade('correct', 'All good.')).marking!.score).toBe(0)
  })

  it('reads the verdict from the opening tag, as the app does: an unclosed grade is not a wrong mark', () => {
    // From the baseline: three right answers scored as marked down because </grade> was missing
    const unclosed = `<grade verdict="correct" score="1.0">\n\nYou divided by the page size, which is right: page 26, offset 47.\n\n<note>Low 8 bits are the offset.</note>\n\n${QUESTION}`
    const s = scoreReply(sc({ ends: 'ask', verdict: 'correct', names: ['page 26'] }), unclosed)
    expect(s.marking).toMatchObject({ score: 1, got: 'correct', rejectedRight: false, named: true })
    // The app closes it where the feedback ends (session.closeGrade), so the learner sees the mark
    expect(s).toMatchObject({ failed: [], repaired: ['close'] })
    expect(scoreReply(sc({ ends: 'ask', verdict: 'correct' }), unclosed.replace('correct', 'partial')).marking).toMatchObject({ score: 0, got: 'partial', rejectedRight: true })
    // A grade with nothing after its feedback can't be closed by rule: the mark is still read, the tag still counts
    const cut = scoreReply(sc({ ends: 'ask', verdict: 'wrong', names: ['duplicate'] }), '<grade verdict="wrong" score="0.1">The ledger will hold a duplicate row.</grade')
    expect(cut.marking).toMatchObject({ score: 1, got: 'wrong', named: true })
    expect(cut.failed).toEqual(expect.arrayContaining(['tags-closed', 'ends']))
  })

  it('scores a mark on what was not an answer as the app leaves it: taken off, the feedback kept', () => {
    // From the baseline: "I don't know" marked wrong 0.0, and a question of the learner's marked "correct"
    const said = (learner: Scenario['history'][number]) => ({ ...sc({ ends: 'ask', forbid: ['grade'], must: ['coordinator'] }, 'idk'), history: [{ tutor: QUESTION }, learner] })
    const reply = `<grade verdict="wrong" score="0.0">That is fine: start from the coordinator, which collects the votes.</grade>\n\n${QUESTION}`
    expect(scoreReply(said({ learner: { idk: true } }), reply)).toMatchObject({ failed: [], repaired: ['grade'] })
    expect(scoreReply(said({ learner: { question: 'Is that the same as Paxos?' } }), reply)).toMatchObject({ failed: [], repaired: ['grade'] })
    expect(scoreReply(said({ learner: { answer: 'It waits.' } }), reply).failed).toEqual(['forbid:grade'])
  })

  it('fails a missing grade, two grades, a grade that comes late and one with no verdict', () => {
    expect(scoreReply(sc(wrong), QUESTION).marking).toMatchObject({ score: 0, got: 'none' })
    expect(failed(wrong, QUESTION)).toEqual(expect.arrayContaining(['graded', 'verdict']))
    expect(failed(wrong, `<grade verdict="wrong" score="0">Overflow.</grade>\n<grade verdict="partial" score="0.5">Or maybe.</grade>\n\n${QUESTION}`)).toContain('graded')
    expect(failed(wrong, `${'Let me first restate what binary search does before I look at your answer in detail. '.repeat(2)}\n\n${grade('wrong', 'It can overflow.')}`)).toContain('grade-first')
    expect(failed(wrong, `<grade score="0">It can overflow.</grade>\n\n${QUESTION}`)).toEqual(expect.arrayContaining(['grade-attrs', 'verdict']))
    expect(failed(wrong, `<grade verdict="wrong" score="7">It can overflow.</grade>\n\n${QUESTION}`)).toContain('grade-attrs')
  })
})

describe('exactness', () => {
  const e: Expect = { ends: 'ask', must: ['\\b20\\b', 'log_?2|logarithm'], mustNot: ['\\b1,?000\\b comparisons'] }
  it('wants the supplied values present and the wrong ones absent, in what the learner reads', () => {
    expect(scoreReply(sc(e), `It takes at most 20 comparisons, the base-2 logarithm of a million rounded up.\n\n${QUESTION}`).exactness!.score).toBe(1)
    const bad = scoreReply(sc(e), `It takes about 1000 comparisons.\n\n${QUESTION}`)
    expect(bad.exactness!.score).toBe(0)
    expect(bad.failed.filter((f) => f.startsWith('must'))).toHaveLength(3)
  })
  it('does not count the hidden solution as said', () => {
    expect(scoreReply(sc(e), `Think about halving.\n\n<ask type="problem">How many comparisons at most?</ask>\n\n<solution>20, from log_2 of a million.</solution>`).exactness!.checks.filter((c) => c.id.startsWith('must:')).every((c) => !c.ok)).toBe(true)
  })
})

describe('pace', () => {
  it('counts what is read, not code, diagrams, notes or hidden working', () => {
    const reply = `Three plain words.\n\n${fence('python', 'def f():\n    return 1')}\n\n<note>${'word '.repeat(50)}</note>\n\n<solution>${'word '.repeat(50)}</solution>\n\n<ask type="short">Two words?</ask>`
    expect(paceWords(reply)).toBe(5)
  })
  it('fails a reply that runs long, by how far over it is, and allows more in Why mode', () => {
    const long = `${'This sentence pads the reply well beyond what a short turn allows. '.repeat(30)}\n\n${QUESTION}`
    const s = scoreReply(sc({ ends: 'ask' }), long)
    expect(s.failed).toContain('pace')
    expect(s.pace.score).toBeLessThan(1)
    expect(s.pace.score).toBeGreaterThan(0)
    expect(scoreReply(sc({ ends: 'ask' }, 'after-correct', true), long).pace.max).toBeGreaterThan(s.pace.max)
    expect(failed({ ends: 'ask', words: { max: 1000 } }, long)).toEqual([])
  })
  it('allows a tenth over the bound: a few words are not a pace fault', () => {
    // From the baseline: 172 words against 170 was a failure
    const of = (n: number) => `${'word '.repeat(n - 8)}\n\n${QUESTION}`
    expect(scoreReply(sc({ ends: 'ask', words: { max: 170 } }), of(172)).pace).toMatchObject({ score: 1, words: 172 })
    expect(failed({ ends: 'ask', words: { max: 170 } }, of(187))).toEqual([])
    const over = scoreReply(sc({ ends: 'ask', words: { max: 170 } }), of(200))
    expect(over.failed).toEqual(['pace'])
    expect(over.pace.score).toBeCloseTo(1 - 30 / 170)
  })
})

describe('the visual asked for', () => {
  const want = (visual: Expect['visual']): Expect => ({ ends: 'nothing', visual })
  const seq = fence('mermaid', 'sequenceDiagram\n    participant A as "Client"\n    participant B as "Server"\n    A->>B: SYN\n    B-->>A: SYN-ACK\n    A->>B: ACK')
  const flow = fence('mermaid', 'flowchart LR\n    A["Source"] --> B["Queue"]\n    B --> C["Warehouse"]')

  it('accepts the right kind of mermaid diagram and rejects another kind, an untyped block and prose', () => {
    expect(failed(want({ kind: 'mermaid', diagram: ['sequenceDiagram'] }), `${seq}\n\nLook at the order of the three messages.`, 'show-me')).toEqual([])
    const wrongKind = scoreReply(sc(want({ kind: 'mermaid', diagram: ['sequenceDiagram'] }), 'show-me'), `${flow}\n\nLook at it.`)
    expect(wrongKind.visual).toMatchObject({ score: 0, found: ['mermaid:flowchart'] })
    expect(failed(want({ kind: 'mermaid' }), `${fence('mermaid', 'Client -> Server: SYN\nServer -> Client: ACK\nClient -> Server: ACK')}\n\nLook.`, 'show-me')).toContain('visual')
    expect(failed(want({ kind: 'mermaid' }), 'The client sends SYN, the server answers, the client acknowledges.', 'show-me')).toContain('visual')
    expect(failed(want({ kind: 'mermaid', diagram: ['stateDiagram'] }), `${fence('mermaid', 'stateDiagram-v2\n    [*] --> Follower\n    Follower --> Candidate: timeout\n    Candidate --> Leader: majority')}\n\nFollow the timeout arrow.`, 'show-me')).toEqual([])
  })

  it('accepts a table with a header and rows, not a list', () => {
    const table = '| step | lo | hi | mid |\n| --- | --- | --- | --- |\n| 1 | 0 | 9 | 4 |\n| 2 | 5 | 9 | 7 |'
    expect(hasTable(table)).toBe(true)
    expect(failed(want({ kind: 'table' }), `${table}\n\nWatch lo move.`, 'show-me')).toEqual([])
    expect(failed(want({ kind: 'table' }), '- step 1: lo 0, hi 9\n- step 2: lo 5, hi 9', 'show-me')).toContain('visual')
    expect(hasTable('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe(false)
  })

  it('accepts a simulation the app can read, of the kind asked for', () => {
    const sim = (json: string) => `${fence('sim', json)}\n\nWatch the path.`
    expect(failed(want({ kind: 'sim', sim: 'gradient-descent' }), sim('{"kind":"gradient-descent","surface":"ravine","optimiser":"momentum","rate":0.05,"momentum":0.9}'), 'show-me')).toEqual([])
    expect(failed(want({ kind: 'sim', sim: 'gradient-descent' }), sim('{"kind":"softmax","logits":[2,1,0.1]}'), 'show-me')).toContain('visual')
    expect(failed(want({ kind: 'sim' }), sim('{"kind":"gradient-descent", surface: ravine}'), 'show-me')).toContain('visual')
    expect(failed(want({ kind: 'sim' }), sim('{"kind":"decision-tree"}'), 'show-me')).toContain('visual')
  })

  it('accepts a simulation in a block labelled json or nothing, which the app draws all the same, and counts the repair', () => {
    // From the baseline: a valid gradient-descent simulation scored as "no sim block"
    const body = '{"kind":"gradient-descent","surface":"ravine","optimiser":"momentum","rate":0.01,"momentum":0.9}'
    const s = scoreReply(sc(want({ kind: 'sim', sim: 'gradient-descent' }), 'show-me'), `${fence('json', body)}\n\nWatch the path.`)
    expect(s.failed).toEqual([])
    expect(s.repaired).toEqual(['sim'])
    expect(failed(want({ kind: 'sim' }), `${fence('', body)}\n\nWatch the path.`, 'show-me')).toEqual([])
    expect(failed(want({ kind: 'sim' }), `${fence('json', '{"rate":0.01}')}\n\nWatch the path.`, 'show-me')).toContain('visual')
  })

  it('accepts any of the kinds a scenario allows', () => {
    const either = want([{ kind: 'table' }, { kind: 'mermaid', diagram: ['flowchart'] }])
    expect(failed(either, `${flow}\n\nLook at the queue.`, 'show-me')).toEqual([])
    expect(failed(either, '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nLook at row 2.', 'show-me')).toEqual([])
    const neither = scoreReply(sc(either, 'show-me'), `${seq}\n\nLook.`)
    expect(neither.failed).toContain('visual')
    expect(neither.visual?.why).toBe('no table')
  })

  it('accepts a chart block with a query, and rejects one without', () => {
    const chart = (json: string) => `${fence('chart', json)}\n\nLook at the dip in March.`
    expect(failed(want({ kind: 'chart' }), chart('{"sql": "SELECT strftime(\'%Y-%m\', created_at) AS month, COUNT(*) AS orders FROM orders GROUP BY 1 ORDER BY 1", "type": "line", "title": "Orders by month"}'), 'show-me')).toEqual([])
    expect(failed(want({ kind: 'chart' }), chart('{"type": "line", "title": "Orders by month"}'), 'show-me')).toContain('visual')
    expect(failed(want({ kind: 'chart' }), chart('orders by month as a line'), 'show-me')).toContain('visual')
  })
})

describe('the Show me note', () => {
  it('lists the kinds in the order to try them, a table of the worked numbers first, and shows how a mermaid node is written', () => {
    const at = (t: string) => SHOW_ME.indexOf(t)
    const order = ['a Markdown table, one row per step, with the same numbers as your explanation', 'plot it with run_code', 'mermaid stateDiagram-v2', 'mermaid sequenceDiagram', 'mermaid flowchart;', 'that sim block', 'mermaid mindmap', 'find_image']
    for (const t of order) expect(at(t), t).toBeGreaterThan(0)
    expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b))
    expect(SHOW_ME).toContain('taking the first that fits')
    expect(SHOW_ME).toContain('like A["Row 2"] --> B["Row 3"]')
    // No longer than the note it replaces (231 words), give or take a line
    expect(SHOW_ME.split(/\s+/).length).toBeLessThanOrEqual(245)
  })

  it('still asks for one visual, one line and no question, which the scorer holds a Show me reply to', () => {
    expect(SHOW_ME).toMatch(/Give the ONE visual that fits what you just taught, then one line saying what to look at in it, and stop: no new problem, no question\./)
    const show = SCENARIOS.filter((s) => s.history.some((t) => 'learner' in t && 'showMe' in t.learner))
    expect(show.length).toBeGreaterThan(3)
    for (const s of show) expect(s.expect.ends, s.id).toBe('nothing')
  })
})

describe('the judge', () => {
  it('is asked with the lesson so far, the reply without its hidden working, and the rubric', () => {
    const s = SCENARIOS.find((x) => x.situation === 'after-wrong')!
    const p = judgePrompt(s, s.good + '\n<solution>SECRET</solution>')
    expect(p).toContain('The learner\'s last answer is in truth wrong.')
    expect(p).toContain('misconception: does it deal with what this learner actually got wrong')
    expect(p).not.toContain('SECRET')
    expect(p).not.toContain('(Tide:')
    expect(p).not.toContain('How to tutor me here')
  })
  it('has its ratings read, n/a left out, and nonsense refused', () => {
    expect(parseJudge('CLARITY: 4\nMISCONCEPTION: n/a\n**SOCRATIC**: 2/5\nACCURACY: 5\nWHY: the question repeats the text.')).toEqual({ clarity: 4, socratic: 2, accuracy: 5, why: 'the question repeats the text.' })
    expect(parseJudge('I think it is fine.')).toBeNull()
    expect(parseJudge('CLARITY: 9')).toBeNull()
  })
})

describe('the summary and the decision', () => {
  const s = sc({ ends: 'ask', verdict: 'wrong', names: ['overflow'] }, 'mark-planted-error')
  const good = scoreReply(s, `<grade verdict="wrong" score="0">It can overflow.</grade>\n\n${QUESTION}`)
  const bad = scoreReply(s, `<grade verdict="correct" score="1">Yes.</grade>\n\n${QUESTION}`)
  const row = (score: typeof good, repeat: number, id = 'a'): Row => ({ id, subject: 'systems', situation: 'mark-planted-error', repeat, score })

  it('gives means over everything and the spread of the per-repeat means', () => {
    const sum = summarise([row(good, 0), row(good, 0, 'b'), row(good, 1), row(bad, 1, 'b')])
    expect(sum.marking.accuracy).toEqual({ mean: 0.75, spread: 0.354, n: 4 })
    expect(sum.marking.falseCorrect.mean).toBe(0.25)
    expect(sum.marking.plantedCaught.mean).toBe(0.75)
    expect(sum.measures.pass.mean).toBe(0.75)
    expect(sum.bySubject.systems.marking.n).toBe(4)
    expect(sum.bySubject.maths.marking).toBeUndefined()
    expect(sum.failures[0]).toEqual({ id: 'verdict', share: 0.25 })
  })

  const run = (rows: Row[], over: Partial<Run> = {}): Run => ({ version: '1', label: 'x', model: 'm', prompts: 'p', settings: { temperature: 0.4, seed: 1, repeats: 3, maxTokens: 1500 }, summary: summarise(rows), ...over })
  const three = (scores: (typeof good)[]) => [0, 1, 2].flatMap((r) => scores.map((sc2, i) => row(sc2, r, `s${i}`)))

  it('says go only when something is clearly better and nothing that matters is worse', () => {
    const base = run(three([good, bad, bad, bad]))
    const better = run(three([good, good, good, bad]))
    expect(decide(base, better)).toMatchObject({ go: true, blockers: [] })
    expect(decide(base, base).go).toBe(false)
    expect(decide(better, base).blockers.join(' ')).toMatch(/marking accuracy fell/)
    expect(decide(better, base).blockers.join(' ')).toMatch(/more not-right answers marked correct/)
  })

  it('leaves a failed request out of every number, and reads only the mark of a saved reply that never finished', () => {
    const rows: Row[] = [row(good, 0, 'a'), { ...row(bad, 0, 'b'), error: '500' }, { ...row(good, 0, 'c'), unfinished: true, stalls: 1 }, { ...row({ ...good, repaired: ['ask'] }, 0, 'd') }]
    const s = summarise(rows)
    expect(s.left).toEqual({ errors: 1, unfinished: 1 })
    expect(s.measures.pass).toMatchObject({ mean: 1, n: 2 })
    expect(s.measures.marking).toMatchObject({ mean: 1, n: 3 })
    expect(s.marking.falseCorrect).toMatchObject({ mean: 0, n: 3 })
    expect(s.repairs).toEqual(expect.arrayContaining([{ id: 'stall', share: 0.333 }, { id: 'ask', share: 0.333 }]))
  })

  it('refuses to compare runs with different scenario sets, prompts and model together, too few repeats, or failed requests', () => {
    const base = run(three([good, bad]))
    const better = run(three([good, good]))
    expect(decide(base, { ...better, version: '2' }).go).toBe(false)
    // New prompts on the same model is what the benchmark is for; new prompts and a new model at once can't be read
    expect(decide(base, { ...better, prompts: 'other' }).blockers).toEqual([])
    expect(decide(base, { ...better, prompts: 'other', model: 'another' }).blockers.join(' ')).toMatch(/prompts and the model both differ/)
    expect(decide(base, { ...better, prompts: 'other', adapter: 'adapters/v1' }).blockers.join(' ')).toMatch(/prompts and the model both differ/)
    expect(decide(base, { ...better, settings: { ...better.settings, repeats: 1 } }).go).toBe(false)
    expect(decide(base, { ...better, errors: 2 }).go).toBe(false)
  })
})

describe('the reply the learner is shown', () => {
  const grade = '<grade verdict="partial" score="0.5">4 KiB is the page size; the table is 4 MiB.</grade>'
  const stall = '\n\n' + '<|channel>thought\n<channel|>'.repeat(3) + '<|channel>thought\n'.repeat(40)
  const user = [{ role: 'user' as const, content: 'Answer: 4 KiB' }]

  it('reads a completion as the app reads a stream: stopped at a thought channel opened part-way through', () => {
    expect(readCompletion(`${grade}\n\n${QUESTION}`)).toEqual({ text: `${grade}\n\n${QUESTION}`, rest: '' })
    const r = readCompletion(`${grade}${stall}`)
    expect(r.stop).toBe('stall')
    expect(r.text.trim()).toBe(grade)
    // Reasoning before the answer begins is not a stall: it is hidden, and the answer follows
    expect(readCompletion(`<|channel>thought\nLet me check.<channel|>${grade}`)).toEqual({ text: grade, rest: '' })
    expect(readCompletion(`${'<|channel>thought\n<channel|>'.repeat(3)}${grade}`).stop).toBe('loop')
    expect(readCompletion(`Right.\n${'and so on\n'.repeat(12)}`).stop).toBe('loop')
  })

  it('carries a stalled turn on with the app\'s own message, and joins the pieces', async () => {
    const asked: { n: number; last: string; extra: number }[] = []
    const t = await tutorTurn(user, async (messages, o) => {
      asked.push({ n: messages.length, last: messages[messages.length - 1].content, extra: o.extra })
      return asked.length === 1 ? `${grade}${stall}` : `**Problem 3 · same level**\n\n${QUESTION}`
    })
    expect(t).toEqual({ reply: `${grade}\n\n**Problem 3 · same level**\n\n${QUESTION}`, stalls: 1, looped: false })
    expect(asked[1]).toMatchObject({ n: 3, extra: 0.15 })
    expect(asked[1].last).toMatch(/^\(Carry on with your reply exactly where it stopped\./)
  })

  it('starts a looping turn over once, and keeps what came before the loop if it loops again', async () => {
    const loop = `Right so far.\n${'and so on\n'.repeat(12)}`
    let calls = 0
    const fresh = await tutorTurn(user, async (_m, o) => (++calls === 1 ? loop : o.retry ? QUESTION : 'no'))
    expect(fresh).toEqual({ reply: QUESTION, stalls: 0, looped: true })
    expect((await tutorTurn(user, async () => loop)).reply).toBe('Right so far.')
  })

  it('reads a saved completion offline: what it went on to write stands in for the carry-on, and a dead stall is unfinished', () => {
    expect(savedTurn(`${grade}${stall}`)).toEqual({ reply: grade, stalls: 1, looped: false, unfinished: true })
    const went = savedTurn(`<grade verdict="correct" score="1"><|channel>thought\n<channel|><|channel>thought\n<channel|>\nRight.</grade>\n\n${QUESTION}`)
    expect(went).toEqual({ reply: `<grade verdict="correct" score="1">\n\nRight.</grade>\n\n${QUESTION}`, stalls: 1, looped: false })
  })

  it('stops reading a streamed completion where the app would, instead of running to the token limit', async () => {
    const sse = (parts: string[]) => parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
    let pulled = 0
    const parts = [grade, '\n\n', '<|channel>', 'thought\n', ...Array(50).fill('<|channel>thought\n')]
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled < parts.length) c.enqueue(new TextEncoder().encode(sse([parts[pulled++]]).replace('data: [DONE]\n\n', '')))
        else c.close()
      }
    })
    let sent: Record<string, unknown> = {}
    const raw = await complete({ base: 'http://localhost:8080/v1', key: '', model: 'mlx-community/gemma-4-12B-it-4bit', messages: user, extra: { temperature: 0.4 } }, async (_url, init) => {
      sent = JSON.parse(String(init.body))
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })
    expect(sent).toMatchObject({ stream: true, temperature: 0.4, logit_bias: { '100': -100 } })
    expect(raw).toBe(`${grade}\n\n<|channel>`)
    expect(pulled).toBeLessThan(10)
    expect(readCompletion(raw)).toMatchObject({ stop: 'stall' })
  })

  it('re-scores the saved baseline with no model: the scorer\'s corrections, without pretending the stalled replies finished', () => {
    const saved = JSON.parse(readFileSync(new URL('../scripts/eval/tutor/results/2026-11-11-14-34-base.json', import.meta.url), 'utf8')) as { rows: Parameters<typeof rescoreRows>[0] }
    const rows = rescoreRows(saved.rows)
    const s = summarise(rows)
    expect(rows).toHaveLength(70)
    expect(s.left).toEqual({ errors: 1, unfinished: 13 })
    // Every answer's mark is read, and only one of 35 is wrong (a subquery marked down for not being a window function)
    expect(s.marking.accuracy).toMatchObject({ n: 35 })
    expect(rows.filter((r) => r.score.marking && !r.score.marking.score).map((r) => r.id)).toEqual(['databases-mark-unusual-correct-running-total'])
    expect(s.marking.falseCorrect.mean).toBe(0)
    expect(s.repairs.find((r) => r.id === 'stall')?.share).toBeCloseTo(17 / 69, 2)
    // No reply the learner would be shown has thinking markers left in it
    expect(rows.some((r) => !r.unfinished && r.score.failed.includes('clean'))).toBe(false)
  })
})

describe('the humanities scenarios', () => {
  const human = SCENARIOS.filter((s) => ['philosophy', 'theology', 'history', 'literature'].includes(s.subject))
  it('number at least 20, across all four subjects, with close readings, appraisals, contested questions, dates, traditions, a spoiler trap and cited replies', () => {
    expect(human.length).toBeGreaterThanOrEqual(20)
    for (const sub of ['philosophy', 'theology', 'history', 'literature']) expect(human.filter((s) => s.subject === sub).length, sub).toBeGreaterThanOrEqual(4)
    for (const sit of ['close-reading', 'appraise-reading', 'contested', 'fact-date', 'describe-tradition', 'spoiler-trap', 'cited-reply']) expect(human.some((s) => s.situation === sit), sit).toBe(true)
    // Close readings of Meditations and The Prophet: ask about reasoning, quote with a place, offer a counter-reading, no verdict
    for (const s of human.filter((x) => x.situation === 'close-reading')) expect(s.expect, s.id).toMatchObject({ quote: true, challenge: true, counter: true, forbid: ['grade'] })
    expect(human.filter((s) => s.situation === 'close-reading').map((s) => s.discuss?.work)).toEqual(expect.arrayContaining(['Meditations', 'The Prophet']))
  })

  it('send a close reading as the discussion sends it, and score its checks with no model', () => {
    const s = human.find((x) => x.id === 'philosophy-close-reading-meditations-opinion')!
    const m = buildMessages(s)
    expect(m).toHaveLength(2)
    expect(m[0].content).toMatch(/Socratically/)
    expect(m[1].content).toMatch(/The passage \(ch\. 4 ¶7\):[\s\S]*Learner: He is saying harm is all in your head/)
    const lecture = scoreReply(s, 'Marcus means that externals are indifferent. <ask type="explain">Do you see?</ask>')
    expect(lecture.failed).toEqual(expect.arrayContaining(['quoted', 'challenge', 'counter']))
    const spoil = human.find((x) => x.situation === 'spoiler-trap')!
    expect(scoreReply(spoil, 'Later in the novel, "the narrator" (ch. 1 ¶1) explains. <ask type="explain">Why?</ask>').failed).toContain('no-spoiler')
  })

  it('send the appraisal note with an answer to a question of interpretation', () => {
    const s = human.find((x) => x.situation === 'appraise-reading')!
    expect(buildMessages(s).at(-1)!.content).toMatch(/Respond with <appraise>, not <grade>/)
    const f = human.find((x) => x.situation === 'fact-date')!
    expect(buildMessages(f).at(-1)!.content).toMatch(/mark this first/)
  })
})
