import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/tide-test', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {} } }))

const { parseBlocks, sessionInstructions, asksToThink, lastAskType, picksOne, SESSION_FORMAT } = await import('../src/shared/session')
const { notAnAttempt, saysLost, nothingToMark, repairReply, isAnswer: answerToMark } = await import('../src/shared/lessonRepair')
const { paceNote, markNote, LOST_NOTE, THINK_NOTE } = await import('../src/shared/pace')
const { forClaude } = await import('../src/shared/exercises')
const { TUTORIAL, TUTORIAL_CLAUDE } = await import('../src/shared/lessonPlan')
const { lessonMap } = await import('../src/shared/lessonMap')
const { isAnswer } = await import('../src/main/claudeEngine')
const { claudeSystemBase } = await import('../src/shared/tutorPrompt')

const THINK = 'The stack after LOAD_NAME a is [1].\n\n<ask type="think">What would happen to the stack if the next instruction were POP_TOP?</ask>'
const CHECK = '<solution>3</solution>\n\n<ask type="short">How many items are on the stack after BINARY_OP?</ask>'

describe('think asks', () => {
  it('parse as their own ungraded kind', () => {
    const ask = parseBlocks(THINK).find((b) => b.kind === 'ask')
    expect(ask).toMatchObject({ kind: 'ask', type: 'think' })
    // One tap: a think question with options is answered like a choice, and still never marked
    const tap = parseBlocks('<ask type="think" options="it is discarded|it is printed|it stays">What happens to the value?</ask>').find((b) => b.kind === 'ask')
    expect(tap).toMatchObject({ type: 'think', options: ['it is discarded', 'it is printed', 'it stays'] })
    expect(picksOne(tap as never)).toBe(true)
    expect(lastAskType(THINK)).toBe('think')
    expect(asksToThink(THINK)).toBe(true)
    expect(asksToThink(CHECK)).toBe(false)
    // A predict ask stays graded: a sure, wrong guess is a misconception to catch
    expect(asksToThink('<ask type="predict">What will the stack hold?</ask>')).toBe(false)
    // The last question decides: a think question earlier in a reply that ends on a checkpoint is a checkpoint
    expect(asksToThink(`${THINK}\n${CHECK}`)).toBe(false)
  })

  it('are never sent to the marker', () => {
    const req = (prev: string) => ({ session: true, messages: [{ role: 'user', content: 'Start' }, { role: 'assistant', content: prev }, { role: 'user', content: 'Answer: it would drop the 1' }] }) as never
    expect(isAnswer(req(THINK), 'Answer: it would drop the 1')).toBe(false)
    expect(isAnswer(req(CHECK), 'Answer: 1')).toBe(true)
  })

  it('a grade or flashcard on the reply to one is taken off', () => {
    const reply = '<grade verdict="partial" score="0.5">Partly right: POP_TOP removes it.</grade>\n\nRight, it is gone.\n\n<card>What does POP_TOP do? :: Removes the top of the stack</card>\n\n<ask type="think">And then?</ask>'
    expect(nothingToMark('Answer: it would drop the 1', THINK)).toBe(true)
    const fixed = repairReply(reply, 'Answer: it would drop the 1', THINK)
    expect(fixed.text).not.toMatch(/<grade|<card>/)
    expect(fixed.text).toContain('POP_TOP removes it.')
    expect(parseBlocks(fixed.text).some((b) => b.kind === 'grade' || b.kind === 'card')).toBe(false)
    // A key idea's card is no mark: it stays, and is the one card saved from a think answer's reply
    const idea = repairReply(`${reply}\n<card idea>What does POP_TOP do? :: Discards the top of the value stack</card>`, 'Answer: it would drop the 1', THINK)
    const cards = parseBlocks(idea.text).filter((b) => b.kind === 'card')
    expect(cards).toEqual([{ kind: 'card', front: 'What does POP_TOP do?', back: 'Discards the top of the value stack', idea: true }])
    // A checkpoint's answer is still marked as before
    expect(repairReply(reply, 'Answer: 1', CHECK).text).toMatch(/<grade/)
  })

  it('get a conversational note, not the marking one', () => {
    const history = [{ role: 'user' as const, content: 'Start' }, { role: 'assistant' as const, content: THINK }]
    expect(paceNote(history, 'Answer: it would drop the 1')).toBe(THINK_NOTE)
    expect(markNote('Answer: it would drop the 1', THINK)).toBeNull()
    expect(markNote('Answer: 1', CHECK)).not.toBeNull()
  })

  it('count toward no check on the lesson map, and the map still advances on checkpoints', () => {
    const plan = '<plan>\nGoal: By the end you can trace bytecode\n1. Compile then run | the two phases | Done when you can say which errors are which | 6 min\n2. The stack machine | push, pop | Done when you can trace a + b | 8 min\n</plan>'
    const turns = [
      { role: 'user' as const, content: 'Teach me' },
      { role: 'assistant' as const, content: `${plan}\n\nExplanation.\n\n${THINK}` },
      { role: 'user' as const, content: 'Answer: it would drop the 1' },
      { role: 'assistant' as const, content: `Yes, and here is why.\n\n${CHECK}` },
      { role: 'user' as const, content: 'Answer: 1' },
      { role: 'assistant' as const, content: '<grade verdict="correct" score="1">Right.</grade>\n\n<progress step="2"/>Now the stack machine.\n\n<ask type="think">Why a stack?</ask>' }
    ]
    const blocks = turns.map((t) => (t.role === 'assistant' ? parseBlocks(t.content) : null))
    const map = lessonMap(turns, blocks)
    expect(map.steps[0].checks).toBe(1)
    expect(map.steps[0].state).toBe('done')
    expect(map.current).toBe(1)
    expect(map.purposes.get(1)?.think).toBe(true)
  })
})

describe('confusion is a signal, not an answer', () => {
  // The learner's own words, from the lesson that went wrong
  const lost = ['what do you mean what instruction after multiply', 'i am lost does print(1 / ) cause a runtime error or syntax error', 'i so lost', 'i really dont know', "I'm confused", 'explain', 'Can you explain that?', "I don't understand", 'Answer: ', 'Answer: ?', 'you lost me']
  it.each(lost)('"%s" is never marked', (said) => {
    expect(saysLost(said)).toBe(true)
    expect(notAnAttempt(said)).toBe(true)
    expect(notAnAttempt(`Answer: ${said}`)).toBe(true)
    expect(answerToMark(`Answer: ${said}`)).toBe(false)
  })

  it('is never sent to the marker, even after a checkpoint', () => {
    const req = { session: true, messages: [{ role: 'user', content: 'Start' }, { role: 'assistant', content: CHECK }, { role: 'user', content: 'Answer: i am lost does print(1 / ) cause a runtime error or syntax error' }] } as never
    expect(isAnswer(req, 'Answer: i am lost does print(1 / ) cause a runtime error or syntax error')).toBe(false)
  })

  it('gets a hidden note to explain again differently, then a think question', () => {
    const history = [{ role: 'user' as const, content: 'Start' }, { role: 'assistant' as const, content: CHECK }]
    const note = paceNote(history, 'Answer: what do you mean what instruction after multiply')
    expect(note).toBe(LOST_NOTE)
    expect(note).toMatch(/differently/)
    expect(note).toMatch(/think question/)
    expect(note).toMatch(/no <grade>/)
  })

  it('real answers are still marked', () => {
    for (const said of ['Answer: 3', 'Answer: a SyntaxError, so nothing runs', 'Answer: I think POP_TOP discards the value, because the result is never stored', 'Answer: the explain step shows the stack is empty', 'Answer: I was confused at first, but I think it is 3 because BINARY_OP pops two and pushes one, which means the stack goes from two items to one'])
      expect(notAnAttempt(said)).toBe(false)
  })
})

describe('the tutorial teaching style', () => {
  const ins = sessionInstructions({ mode: 'teach', topic: 'How Python runs your code: bytecode and the stack machine' })
  it('is the default for a Teach lesson: explain first, think, then 1 or 2 graded checkpoints', () => {
    expect(ins).toContain('Teach it as a tutorial')
    expect(ins).toContain(TUTORIAL)
    expect(ins).toMatch(/PROBE: place them with 2 or 3 short questions \(never more\)/)
    expect(ins).toMatch(/1 or 2 graded checkpoints/)
    expect(ins).not.toMatch(/under 150 words/)
  })

  it('Claude gets the full form; the local model the short one', () => {
    const claude = forClaude(ins)
    expect(claude).toContain(TUTORIAL_CLAUDE)
    expect(claude).not.toContain(TUTORIAL)
    expect(TUTORIAL.length).toBeLessThan(TUTORIAL_CLAUDE.length * 0.6)
    for (const rule of [/150 to 250/, /type="think"/, /<card idea>/, /haven't been taught to read|notation \(dis, a trace\) before asking/]) {
      expect(TUTORIAL).toMatch(rule)
      expect(TUTORIAL_CLAUDE).toMatch(rule)
    }
  })

  it('the format knows the think kind and that it is never graded', () => {
    expect(SESSION_FORMAT).toMatch(/think \(to reason aloud.*never marked\)/)
    expect(SESSION_FORMAT).toMatch(/but a think one: no grade/)
  })

  it('the stable lesson prompt stays inside its budget', () => {
    expect(claudeSystemBase({ kind: 'lesson' }).length).toBeLessThanOrEqual(19_800)
  })
})
