import { describe, expect, it } from 'vitest'
import { isAnswer, nothingToMark, repairReply, unmarked } from '../src/shared/lessonRepair'
import { ASKED, GO_ON, SHOW_ME, parseBlocks } from '../src/shared/session'

const ASK = '<ask type="short">What does the coordinator do with the votes?</ask>'

describe('what there is to mark', () => {
  it('is an answer, not a question of the learner\'s, Go on, a hint request or "I don\'t know"', () => {
    expect(nothingToMark(`${ASKED}Is linearizable the same as serializable?`)).toBe(true)
    expect(nothingToMark(SHOW_ME)).toBe(true)
    expect(nothingToMark(GO_ON)).toBe(true)
    expect(nothingToMark("I don't know.")).toBe(true)
    expect(nothingToMark('Answer: idk\n(Confidence: guessing)')).toBe(true)
    expect(nothingToMark("I don't know.\n\n(Tide: This turn: they've said twice they don't know.)")).toBe(true)
    expect(nothingToMark('Answer: It waits.\n(Confidence: sure)')).toBe(false)
    expect(nothingToMark("Answer: I don't know the name, but the vote is kept in a log.")).toBe(false)
    expect(isAnswer('Answer: It waits.\n(Confidence: sure)\n\n(Tide: mark this first.)')).toBe(true)
    expect(isAnswer("Answer: I don't know.")).toBe(false)
    expect(isAnswer(`${ASKED}Why?`)).toBe(false)
  })
})

describe('a lesson reply put right by rule', () => {
  // The three below are replies from the tutor benchmark's first baseline (Gemma 4 12B), shortened
  it('takes a mark off "I don\'t know", keeping what it said', () => {
    const reply = `<grade verdict="wrong" score="0.0">You're expected to not know the answer yet. I'll step down to a foundational concept.</grade>\n\nIn two-phase commit a coordinator collects the votes.\n\n${ASK}`
    const r = repairReply(reply, "I don't know.")
    expect(r.repaired).toEqual(['grade'])
    expect(r.text).toBe(`You're expected to not know the answer yet. I'll step down to a foundational concept.\n\nIn two-phase commit a coordinator collects the votes.\n\n${ASK}`)
    expect(parseBlocks(r.text).map((b) => b.kind)).toEqual(['text', 'ask'])
  })

  it('takes a mark off the reply to a question of the learner\'s', () => {
    const reply = `<grade verdict="partial" score="0.5">Both describe consistency, but they are not the same: linearizability is about one object, serializability about transactions.</grade>\n\n${ASK}`
    const r = repairReply(reply, `${ASKED}Is linearizable the same thing as serializable?`)
    expect(r.repaired).toEqual(['grade'])
    expect(r.text).not.toMatch(/<grade|<\/grade>/)
    expect(r.text).toContain('linearizability is about one object')
  })

  it('leaves the mark on an answer alone', () => {
    const reply = `<grade verdict="wrong" score="0">"It commits" is not safe: it has not heard the outcome.</grade>\n\n${ASK}`
    expect(repairReply(reply, 'Answer: It commits.\n(Confidence: sure)')).toEqual({ text: reply, repaired: [] })
  })

  it('closes a grade left open, and makes a numbered question with <continue/> the question', () => {
    const open = `<grade verdict="correct" score="1.0">\n\nRight: page 26, offset 47.\n\n**Problem 2 · warm-up**\n\n${ASK}`
    const closed = repairReply(open, 'Answer: page 26, offset 47')
    expect(closed.repaired).toEqual(['close'])
    expect(parseBlocks(closed.text)[0]).toMatchObject({ kind: 'grade', verdict: 'correct', text: 'Right: page 26, offset 47.' })

    const quiz = '<grade verdict="correct" score="1">"R = 2" is right.</grade>\n\n**Question 3 of 8**\n\nA read returns a value older than the latest write. What does this imply?\n\n<continue/>'
    const asked = repairReply(quiz, 'Answer: R = 2')
    expect(asked.repaired).toEqual(['ask'])
    expect(asked.text).not.toContain('<continue')
    expect(parseBlocks(asked.text).map((b) => b.kind)).toEqual(['grade', 'text', 'ask'])
  })

  it('leaves a rhetorical question before carrying on, and a good reply, exactly as they are', () => {
    const rhetorical = 'So why would anyone want collisions to be hard to find?\n\n<continue/>'
    expect(repairReply(rhetorical, GO_ON)).toEqual({ text: rhetorical, repaired: [] })
    const good = `<grade verdict="correct" score="1">Yes.</grade>\n\n${ASK}`
    expect(repairReply(good, 'Answer: yes')).toEqual({ text: good, repaired: [] })
    expect(unmarked(good)).toBe(`Yes.\n\n${ASK}`)
  })
})
