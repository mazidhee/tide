import { describe, expect, it } from 'vitest'
import { answersOf, bankDirection, decide, difficultyNote, difficultyNoteFor, gradeOf, isSlow, needed, planFor, plannedMove, railLine, replay, START, type Answer, type Known, type Mark, type MoveKind, type Turn } from '../src/shared/difficulty'
import { ownWords } from '../src/shared/session'
import { paceNote } from '../src/shared/pace'

const seq = (marks: string, known?: Known | null) => {
  const MARK: Record<string, Mark> = { r: 'right', p: 'partly', w: 'wrong', s: 'stuck' }
  let state = START
  const moves: MoveKind[] = []
  const levels: number[] = []
  const whys: string[] = []
  for (const c of marks.replace(/\s/g, '')) {
    const d = decide(state, { mark: MARK[c] }, known)
    state = d.state
    moves.push(d.move.kind)
    levels.push(d.move.level)
    whys.push(d.move.why)
  }
  return { moves, levels, whys, state }
}

describe('the difficulty policy', () => {
  it('never steps up on one right answer, and does on two clean ones in a row', () => {
    expect(seq('r').moves).toEqual(['stay'])
    expect(seq('r').whys).toEqual(['One right answer: one more at this level before stepping up'])
    const two = seq('rr')
    expect(two.moves).toEqual(['stay', 'up'])
    expect(two.levels).toEqual([2, 3])
    expect(two.whys[1]).toBe('Two clean answers in a row: a harder problem next')
    // The count starts again at the new level; the hardest level is the ceiling
    expect(seq('rrrrr').moves).toEqual(['stay', 'up', 'stay', 'stay', 'stay'])
    expect(seq('rrrrr').levels).toEqual([2, 3, 3, 3, 3])
  })

  it('a right answer between misses is not a streak', () => {
    expect(seq('rwr').moves).toEqual(['stay', 'stay', 'stay'])
    expect(seq('rprr').moves).toEqual(['stay', 'stay', 'stay', 'up'])
  })

  it('one miss alone never moves the level', () => {
    expect(seq('w').moves).toEqual(['stay'])
    expect(seq('rrw').moves).toEqual(['stay', 'up', 'stay'])
    expect(seq('rrw').levels).toEqual([2, 3, 3])
    expect(seq('w').whys[0]).toBe('One miss: another at this level')
  })

  it('two misses in a row bring a worked example, and the next problem is easier', () => {
    const s = seq('ww')
    expect(s.moves).toEqual(['stay', 'example'])
    expect(s.levels).toEqual([2, 1])
    expect(decide(seq('w').state, { mark: 'wrong' }, null, 'carries').move.why).toBe('Two misses on carries: a worked example next')
    // "I don't know" counts as a miss
    expect(seq('ws').moves).toEqual(['stay', 'example'])
    expect(seq('ss').moves).toEqual(['stay', 'example'])
  })

  it('steps down on a miss beside a shaky answer, or three answers in a row that were not clean', () => {
    expect(seq('pw').moves).toEqual(['stay', 'down'])
    expect(seq('wp').moves).toEqual(['stay', 'down'])
    expect(seq('ppp').moves).toEqual(['stay', 'stay', 'down'])
    expect(seq('pw').whys[1]).toBe('A miss after a shaky answer: an easier problem next')
    expect(seq('wp').whys[1]).toBe('Partly right after a miss: an easier problem next')
    // Already at the easiest level: nowhere to go
    expect(seq('pw pw').levels).toEqual([2, 1, 1, 1])
    expect(seq('pw pw').moves).toEqual(['stay', 'down', 'stay', 'stay'])
  })

  it('does not swing back and forth: after stepping down, going up again takes three clean answers', () => {
    const s = seq('pw rr r')
    expect(s.moves).toEqual(['stay', 'down', 'stay', 'stay', 'up'])
    expect(s.levels).toEqual([2, 1, 1, 1, 2])
    expect(s.whys[2]).toBe('One right answer: 2 more at this level before stepping up')
    expect(s.whys[4]).toBe('Three clean answers in a row since stepping down: a harder problem next')
    // A learner alternating right and wrong stays put instead of bouncing between levels
    expect(seq('rwrwrwrw').levels).toEqual([2, 2, 2, 2, 2, 2, 2, 2])
    // Up, then one miss at the harder level: it holds; only a second miss brings it down
    expect(seq('rr w').levels).toEqual([2, 3, 3])
    expect(seq('rr ww').moves).toEqual(['stay', 'up', 'stay', 'example'])
    expect(seq('rr ww').levels).toEqual([2, 3, 3, 2])
    // And having come down, it takes three clean answers to go back up, not two
    expect(seq('rr ww rr').levels).toEqual([2, 3, 3, 2, 2, 2])
    expect(seq('rr ww rrr').levels.at(-1)).toBe(3)
  })

  it('stops and recaps when the misses carry on after the worked example', () => {
    const s = seq('ww ww')
    expect(s.moves).toEqual(['stay', 'example', 'stay', 'recap'])
    expect(s.whys[3]).toBe('Still missing after the worked example: stopping to recap')
    // From a harder level there is one easier problem first
    expect(seq('rr ww w w').moves).toEqual(['stay', 'up', 'stay', 'example', 'down', 'recap'])
    // A clean answer after the example clears it: the next two misses are a fresh worked example, not a recap
    expect(seq('ww r ww').moves).toEqual(['stay', 'example', 'stay', 'stay', 'example'])
    // After a recap the count starts again
    expect(seq('ww ww w').moves.at(-1)).toBe('stay')
  })

  it('goes back to a named prerequisite when two misses meet a shaky one on the map, weakest first and once each', () => {
    const known: Known = { concept: 0.2, prerequisites: [{ name: 'Place value', estimate: 0.7 }, { name: 'Carrying', estimate: 0.25 }, { name: 'Number bonds', estimate: 0.35 }] }
    const s = seq('ww ww ww', known)
    expect(s.moves).toEqual(['stay', 'prerequisite', 'stay', 'prerequisite', 'stay', 'example'])
    expect(s.whys[1]).toBe('Two misses, and Carrying isn’t solid yet: going back to it first')
    expect(s.whys[3]).toBe('Two misses, and Number bonds isn’t solid yet: going back to it first')
    expect(s.state.visited).toEqual(['Carrying', 'Number bonds'])
    expect(decide(seq('w', known).state, { mark: 'wrong' }, known).move.prerequisite).toBe('Carrying')
    // Going back does not change the level
    expect(s.levels.slice(0, 4)).toEqual([2, 2, 2, 2])
    // Every prerequisite solid: the miss is about this topic, so a worked example
    expect(seq('ww', { concept: 0.5, prerequisites: [{ name: 'Place value', estimate: 0.7 }] }).moves).toEqual(['stay', 'example'])
  })

  it('is slower to reach the hardest level on a concept the map has as new', () => {
    expect(needed({ level: 2, lastChange: null }, { concept: 0.1, prerequisites: [] })).toBe(3)
    expect(needed({ level: 2, lastChange: null }, { concept: 0.7, prerequisites: [] })).toBe(2)
    expect(needed({ level: 2, lastChange: null }, { concept: null, prerequisites: [] })).toBe(2)
    expect(needed({ level: 1, lastChange: null }, { concept: 0.1, prerequisites: [] })).toBe(2)
    expect(needed({ level: 1, lastChange: 'down' }, null)).toBe(3)
    expect(seq('rr', { concept: 0.1, prerequisites: [] }).moves).toEqual(['stay', 'stay'])
    expect(seq('rrr', { concept: 0.1, prerequisites: [] }).moves.at(-1)).toBe('up')
  })

  it('a right answer that needed a hint, or took far longer than usual, counts as partly right', () => {
    expect(gradeOf({ mark: 'right', hints: 1 }, [])).toBe('partly')
    expect(gradeOf({ mark: 'right' }, [])).toBe('clean')
    expect(isSlow(200, [30, 40, 50])).toBe(true)
    expect(isSlow(100, [30, 40, 50])).toBe(false)
    expect(isSlow(80, [10, 10, 10])).toBe(false)
    expect(isSlow(500, [30, 40])).toBe(false)
    expect(isSlow(undefined, [30, 40, 50])).toBe(false)
    let state = START
    const moves: string[] = []
    for (const a of [{ mark: 'right', seconds: 30 }, { mark: 'wrong', seconds: 40 }, { mark: 'right', seconds: 50 }, { mark: 'right', seconds: 400 }, { mark: 'right', hints: 2, seconds: 45 }] as Answer[]) {
      const d = decide(state, a)
      state = d.state
      moves.push(`${d.move.kind}: ${d.move.why}`)
    }
    expect(moves.slice(3)).toEqual(['stay: Right, but slowly: another at this level', 'stay: Right, with a hint: another at this level'])
    expect(state.level).toBe(2)
  })

  it('changes neither of its arguments, and replaying the same answers gives the same result', () => {
    const before = JSON.stringify(START)
    const answers: Answer[] = [{ mark: 'right' }, { mark: 'right' }, { mark: 'wrong' }, { mark: 'wrong' }, { mark: 'partly' }]
    const a = replay(answers)
    expect(JSON.stringify(START)).toBe(before)
    expect(replay(answers)).toEqual(a)
    expect(a.state.level).toBe(1)
    expect(a.last).toMatchObject({ kind: 'down', level: 1 })
    expect(replay([]).last).toBeNull()
  })

  it('over a realistic lesson: a slow start, a wobble, recovery, and a climb', () => {
    //                 wobble at 2 → down → three clean → up → two clean → up → a slip holds → a hint is not clean
    const s = seq('r p w  r r r  r r  w r r')
    expect(s.levels).toEqual([2, 2, 1, 1, 1, 2, 2, 3, 3, 3, 3])
    expect(s.moves).toEqual(['stay', 'stay', 'down', 'stay', 'stay', 'up', 'stay', 'up', 'stay', 'stay', 'stay'])
    // Level changes over the eleven answers: three, and never two in a row in opposite directions
    const changes = s.moves.filter((m) => m === 'up' || m === 'down')
    expect(changes).toEqual(['down', 'up', 'up'])
  })

  it('over a lesson that is not landing: the prerequisite, an easier problem, a worked example, then a recap rather than yet another problem', () => {
    const known: Known = { concept: null, prerequisites: [{ name: 'Modular arithmetic', estimate: 0.2 }] }
    const s = seq('w w  p w  w w  w w', known)
    expect(s.moves).toEqual(['stay', 'prerequisite', 'down', 'stay', 'example', 'stay', 'recap', 'stay'])
    expect(s.levels).toEqual([2, 2, 1, 1, 1, 1, 1, 1])
  })
})

describe('the note for the tutor', () => {
  it('says what to do for each way the answer could be marked, in the form of Tide’s other hidden notes', () => {
    const first = difficultyNote(planFor(START, {}))
    expect(first).toBe('(Tide: Difficulty. However this answer is marked, the next problem is at the same level.)')
    const afterOneRight = difficultyNote(planFor(seq('r').state, {}))
    expect(afterOneRight).toBe('(Tide: Difficulty. If this answer is right, the next problem is one level harder. If this answer is partly right or wrong, the next problem is at the same level.)')
    const afterOneMiss = difficultyNote(planFor(seq('w').state, {}))
    expect(afterOneMiss).toBe(
      '(Tide: Difficulty. If this answer is right, the next problem is at the same level. If this answer is partly right, the next problem is one level easier. If this answer is wrong, set no full problem; show a short worked example of exactly the step they missed, then ask them to do just that one step.)'
    )
    const known: Known = { concept: 0.2, prerequisites: [{ name: 'Carrying', estimate: 0.2 }] }
    expect(difficultyNote(planFor(seq('w', known).state, {}, known))).toContain('If this answer is wrong, set no new problem; go back to Carrying, which this builds on, with one short question on it before returning.)')
    expect(difficultyNote(planFor(seq('ww w').state, {}))).toContain('If this answer is wrong, stop setting problems; recap in a few lines what they have got and what is still shaky, then ask whether to carry on.)')
    // A hint already asked for on this problem: a right answer will not count as clean
    expect(difficultyNote(planFor(seq('r').state, { hints: 1 }))).toBe('(Tide: Difficulty. However this answer is marked, the next problem is at the same level.)')
  })

  it('is one line, starts as every Tide note does, and is hidden from what the learner sees', () => {
    for (const marks of ['', 'r', 'w', 'ww', 'pw', 'rr', 'ww w']) {
      const note = difficultyNote(planFor(seq(marks).state, {}))
      expect(note.startsWith('(Tide: ')).toBe(true)
      expect(note.endsWith(')')).toBe(true)
      expect(note).not.toContain('\n')
      expect(note.length).toBeLessThan(330)
      expect(ownWords(`Answer: 42\n\n${note}`)).toBe('Answer: 42')
    }
  })

  it('is the same text every time for the same lesson so far (the model server’s cache)', () => {
    const history = lesson(['correct', 'wrong'])
    const a = difficultyNoteFor(history, 'Answer: 17')
    expect(a).toBe(difficultyNoteFor(history, 'Answer: something else entirely'))
    expect(a).toBe(difficultyNoteFor(JSON.parse(JSON.stringify(history)), 'Answer: 17'))
    // What the screen measured for the side rail (the step's name) never changes the note
    expect(difficultyNoteFor(history, 'Answer: 17', null, { focus: 'carries' })).toBe(a)
  })

  it('the bank reads the planned move back from the note once the answer is marked', () => {
    const note = difficultyNote(planFor(seq('w').state, {}))
    const message = `Answer: 12\n\n${note}\n(Tide: mark this first.)`
    expect(plannedMove(message, 'correct')).toBe('stay')
    expect(plannedMove(message, 'partial')).toBe('down')
    expect(plannedMove(message, 'wrong')).toBe('example')
    expect(plannedMove(`Answer: 1\n\n${difficultyNote(planFor(START, {}))}`, 'wrong')).toBe('stay')
    expect(plannedMove(`Answer: 1\n\n${difficultyNote(planFor(seq('r').state, {}))}`, 'correct')).toBe('up')
    const known: Known = { concept: null, prerequisites: [{ name: 'Carrying (in base 10)', estimate: 0.1 }] }
    expect(plannedMove(`Answer: 1\n\n${difficultyNote(planFor(seq('w', known).state, {}, known))}`, 'wrong')).toBe('prerequisite')
    expect(plannedMove(`Answer: 1\n\n${difficultyNote(planFor(seq('ww w').state, {}))}`, 'wrong')).toBe('recap')
    expect(plannedMove('Answer: 12', 'correct')).toBeNull()
    expect(bankDirection('up')).toEqual({ dir: 'harder', worked: false })
    expect(bankDirection('stay')).toEqual({ dir: 'same', worked: false })
    expect(bankDirection('down')).toEqual({ dir: 'easier', worked: false })
    expect(bankDirection('example')).toEqual({ dir: 'easier', worked: true })
    expect(bankDirection('recap')).toBeNull()
    expect(bankDirection('prerequisite')).toBeNull()
  })
})

/** A lesson's turns: an opening, a first problem, then an answer and its marked reply per verdict */
function lesson(verdicts: ('correct' | 'partial' | 'wrong' | 'idk')[], extra: { hintBefore?: number } = {}): Turn[] {
  const turns: Turn[] = [
    { role: 'user', content: 'Teach me long addition.' },
    { role: 'assistant', content: 'Here is the idea.\n\n**Problem 1 · same level**\n\n<ask type="problem">What is 27 + 48?</ask>' }
  ]
  verdicts.forEach((v, i) => {
    if (extra.hintBefore === i) turns.push({ role: 'user', content: '[hint] (nudge please)' }, { role: 'assistant', content: 'Look at the ones column.' })
    turns.push({ role: 'user', content: v === 'idk' ? "I don't know" : `Answer: ${i}\n\n(Tide: mark this first. A right result by a different method from yours is correct.)` })
    turns.push({ role: 'assistant', content: v === 'idk' ? 'Let us look at it together.' : `<grade verdict="${v}" score="${v === 'correct' ? 1 : 0}">feedback</grade>\n\n**Problem ${i + 2}**\n\n<ask type="problem">Next?</ask>` })
  })
  return turns
}

describe('read from a lesson’s turns', () => {
  it('takes each answer’s mark from the reply that followed it, hints from the requests before it, and times where measured', () => {
    expect(answersOf(lesson(['correct', 'partial', 'wrong', 'idk']))).toEqual([{ mark: 'right' }, { mark: 'partly' }, { mark: 'wrong' }, { mark: 'stuck' }])
    expect(answersOf(lesson(['correct', 'correct'], { hintBefore: 1 }))).toEqual([{ mark: 'right' }, { mark: 'right', hints: 1 }])
    expect(answersOf(lesson(['correct']), { 2: 41 })).toEqual([{ mark: 'right', seconds: 41 }])
    // A question of theirs or "Go on" is not an answer
    expect(answersOf([...lesson(['correct']), { role: 'user', content: 'Go on.' }, { role: 'assistant', content: 'More.<continue/>' }, { role: 'user', content: 'Why does carrying work?' }, { role: 'assistant', content: 'Because…' }])).toHaveLength(1)
  })

  it('says nothing until the lesson has set a numbered problem, and nothing on a message that is not an answer', () => {
    const opening: Turn[] = [{ role: 'user', content: 'Teach me long addition.' }, { role: 'assistant', content: 'First, what do you know?\n\n<ask type="short">What is 7 + 8?</ask>' }]
    expect(difficultyNoteFor(opening, 'Answer: 15')).toBeNull()
    expect(railLine(opening)).toBeNull()
    const history = lesson(['correct'])
    expect(difficultyNoteFor(history, 'Go on.')).toBeNull()
    expect(difficultyNoteFor(history, 'Why is that?')).toBeNull()
    expect(difficultyNoteFor(history, "I don't know")).toBeNull()
    expect(difficultyNoteFor(history, 'Answer: 75')).toBe('(Tide: Difficulty. If this answer is right, the next problem is one level harder. If this answer is partly right or wrong, the next problem is at the same level.)')
  })

  it('a hint asked for on this problem is counted with the answer being sent', () => {
    const history = [...lesson(['correct']), { role: 'user' as const, content: '[hint] (nudge please)' }, { role: 'assistant' as const, content: 'Think about the tens.' }]
    expect(difficultyNoteFor(history, 'Answer: 75')).toBe('(Tide: Difficulty. However this answer is marked, the next problem is at the same level.)')
  })

  it('gives the side rail one line: what Tide did after the last marked answer, and why', () => {
    expect(railLine(lesson([]))).toBeNull()
    expect(railLine(lesson(['correct']))).toBe('One right answer: one more at this level before stepping up')
    expect(railLine(lesson(['correct', 'correct']))).toBe('Two clean answers in a row: a harder problem next')
    expect(railLine(lesson(['wrong', 'wrong']), null, { focus: 'carries' })).toBe('Two misses on carries: a worked example next')
    expect(railLine(lesson(['wrong', 'idk']))).toBe('Two misses: a worked example next')
  })

  it('stands aside when the pace note already speaks for the turn: the two never say different things about two misses', () => {
    const history = lesson(['wrong', 'wrong'])
    // The existing pace rule fires on a third answer after two wrong marks…
    expect(paceNote(history, 'Answer: 3')).toMatch(/their last two answers were wrong/)
    // …and by then the policy has already called for the worked example the pace note asks for
    expect(replay(answersOf(history)).last!.kind).toBe('example')
  })
})
