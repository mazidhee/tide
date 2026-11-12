import { describe, expect, it } from 'vitest'
import { SKIP_SAID, asksToMoveOn, isAnswer, notAnAttempt, nothingToMark, repairReply, unmarked } from '../src/shared/lessonRepair'
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

describe('stray tags', async () => {
  const { repairReply } = await import('../src/shared/lessonRepair')
  it('drops a line that is only an invented tag, and nothing else', () => {
    const reply = 'Look at how Raft handles it.\n\n<file_path>Raft (algorithm) - Safety rules</file_path>\n\n<file_path>Raft (algorithm) - Safety rules</file_path>\n\nIn a cluster of 5 nodes, can two leaders win?\n\n<ask>Explain.</ask>'
    const { text, repaired } = repairReply(reply, 'Go on.')
    expect(text).not.toMatch(/file_path/)
    expect(text).toMatch(/Look at how Raft handles it\.\n\nIn a cluster of 5 nodes/)
    expect(text).toMatch(/<ask>Explain\.<\/ask>/)
    expect(repaired).toContain('stray')
  })
  it('keeps a tag mentioned inside a sentence or a code block', () => {
    const reply = 'Use the `<file_path>` element in config.\n\n```xml\n<path>/etc/x</path>\n```'
    expect(repairReply(reply, 'Go on.').text).toMatch(/<file_path>/)
    expect(repairReply(reply, 'Go on.').text).toMatch(/<path>\/etc\/x<\/path>/)
  })
})

import { saysDontKnow as _saysDontKnow } from '../src/shared/lessonRepair'
describe('saying you don’t know is never marked', () => {
  it('reads every way of saying it, after Answer: too', () => {
    for (const s of ['Answer: i dont know i am learning from scratch', "I don't know", 'Answer: no idea', "I haven't learned this yet", 'Answer: I’m learning this from scratch', 'idk']) expect(_saysDontKnow(s)).toBe(true)
    for (const s of ['Answer: 11', 'Answer: I know it is 11 because 8+2+1', 'Answer: fetch, decode, execute']) expect(_saysDontKnow(s)).toBe(false)
  })
})

describe('requests are not answers (seen live, in a lesson on binary and hex)', () => {
  const forgot = "Answer: I don't really remember the conversion. Can you teach me again from scratch? Can we restart with you teaching me because I pretty much forgot it from my session earlier in the day?"
  const moveOn = 'Answer: can we move on though i understadn this'
  const withAnswer = 'Answer: 128 64 32 16 8 4 2 1 = 10010110 I couldn\'t do the fit or no fit typing I did it in my head so I already know it. I feel like we can just move on to the next phase because I already mastered this'

  it('"I don\'t remember, teach me again" and "can we move on" are never marked', () => {
    for (const said of [forgot, moveOn, 'Answer: I forgot how', 'Answer: explain it again please', 'Answer: skip this one', 'Answer: can we go on to the next topic', SKIP_SAID]) {
      expect(isAnswer(said), said).toBe(false)
      expect(nothingToMark(said), said).toBe(true)
    }
    expect(asksToMoveOn(moveOn)).toBe(true)
    expect(asksToMoveOn(SKIP_SAID)).toBe(true)
  })

  it('an answer sent with a request to move on is still marked; an answer is never taken for a request', () => {
    expect(isAnswer(withAnswer)).toBe(true)
    expect(asksToMoveOn(withAnswer)).toBe(true)
    expect(notAnAttempt('Answer: I forgot to carry the one, so it is 1011')).toBe(false)
    expect(notAnAttempt("Answer: I don't remember exactly, but I think it's the base")).toBe(false)
    // "restart" and "the next step" inside an answer are words of the answer
    expect(notAnAttempt('Answer: One row. The broker never hands the consumer the same message twice, so the restart just carries on.')).toBe(false)
    expect(asksToMoveOn('Answer: the next step is to divide the quotient by 2')).toBe(false)
  })

  it('takes the mark and the flashcard off the reply to one', () => {
    const reply = '<grade verdict="wrong" score="0.0">No conversion was attempted, so there is nothing to mark as correct.</grade>\n\n<card>Convert decimal 21 to binary :: 10101</card>\n\n**Start with what you already know: decimal.**\n\n<continue/>'
    const r = repairReply(reply, forgot)
    expect(r.repaired).toContain('grade')
    expect(parseBlocks(r.text).some((b) => b.kind === 'grade' || b.kind === 'card')).toBe(false)
    expect(r.text).toContain('Start with what you already know')
  })
})
