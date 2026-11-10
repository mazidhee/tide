import { describe, expect, it } from 'vitest'
import { FOUNDATIONAL, sessionInstructions, whyNote, WHY_RULES } from '../src/shared/session'

describe('Why mode', () => {
  it('adds the why rules to lessons only, and to every way of teaching', () => {
    const teach = { mode: 'teach' as const, topic: 'Binary and hexadecimal' }
    expect(sessionInstructions({ ...teach, options: { why: true } })).toContain(WHY_RULES)
    expect(sessionInstructions({ ...teach, options: { why: true, strategy: 'dialogue' } })).toContain(WHY_RULES)
    expect(sessionInstructions({ ...teach, options: { why: true, refresh: true } })).toContain(WHY_RULES)
    expect(sessionInstructions(teach)).not.toContain(WHY_RULES)
    expect(sessionInstructions({ mode: 'quiz', topic: 'Binary', options: { why: true } })).not.toContain(WHY_RULES)
  })

  it('knows foundations from the roadmap section or the topic', () => {
    expect(FOUNDATIONAL.test('software engineering::foundations of computation > how computers work::binary hexadecimal')).toBe(true)
    expect(FOUNDATIONAL.test('Prime numbers')).toBe(true)
    expect(FOUNDATIONAL.test('Raft leader election')).toBe(false)
    expect(FOUNDATIONAL.test('Kafka consumer groups')).toBe(false)
  })

  it('turns on and off mid-lesson with a hidden note', () => {
    expect(whyNote(true)).toMatch(/^\(Tide: from here on, teach the why/)
    expect(whyNote(false)).toMatch(/explain plainly/)
  })
})
