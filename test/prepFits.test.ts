import { describe, expect, it } from 'vitest'
import { prepFits, prepReason, PREP_FRESH_MS, type PlanNext } from '../src/shared/lessonPrep'
import { preparedWhen } from '../src/renderer/src/lib/prep'

// Friday 13 Nov, 23:29: Boolean algebra prepared without Claude, its reason the old roadmap wording
const friday = new Date(2026, 10, 13, 23, 29).getTime()
const sunday = new Date(2026, 10, 15, 11, 27).getTime()
const boolean = {
  status: 'ready' as const,
  at: friday,
  topic: 'Boolean algebra and logic gates',
  topicId: 'computation foundations::how computers work > how computers work::boolean algebra and logic gates',
  notebook: 'Software Engineering',
  why: 'Next in your Software Engineering roadmap (How Computers Work)',
  by: 'local' as const
}
const running: PlanNext = {
  topic: 'Running Python: the interpreter, the REPL, a script, and what happens between source and output',
  kind: 'learn',
  notebook: 'Software Engineering'
}

describe('a prepared lesson is only next while the plan says so', () => {
  it('hides Friday’s Boolean algebra once North Star replanned today around Python from the ground up', () => {
    expect(prepFits(boolean, { topic: 'Python from the ground up', kind: 'check', notebook: 'Software Engineering' }, sunday)).toEqual({ show: false, why: 'plan moved on' })
    expect(prepFits(boolean, running, sunday)).toEqual({ show: false, why: 'plan moved on' })
  })

  it('shows it when it is still the plan’s next lesson, by topic or by roadmap id', () => {
    const at = new Date(2026, 10, 15, 2).getTime()
    expect(prepFits({ ...boolean, at }, { topic: 'Teach me: boolean algebra and  logic gates', kind: 'learn' }, sunday)).toEqual({ show: true })
    expect(prepFits({ ...boolean, at }, { topic: 'Boolean algebra', topicId: boolean.topicId, kind: 'learn' }, sunday)).toEqual({ show: true })
  })

  it('waits behind a Check for its own section', () => {
    const p = { ...boolean, at: sunday - 3_600_000, topic: running.topic, topicId: undefined }
    expect(prepFits(p, { topic: running.topic, kind: 'check' }, sunday)).toEqual({ show: false, why: 'check first' })
  })

  it('expires after two days whatever the plan says, and never shows a used one or one with nothing planned', () => {
    expect(prepFits(boolean, { topic: boolean.topic, kind: 'learn' }, friday + PREP_FRESH_MS - 1)).toEqual({ show: true })
    expect(prepFits(boolean, { topic: boolean.topic, kind: 'learn' }, friday + PREP_FRESH_MS + 1)).toEqual({ show: false, why: 'expired' })
    expect(prepFits({ ...boolean, status: 'used' }, { topic: boolean.topic, kind: 'learn' }, sunday)).toEqual({ show: false, why: 'used' })
    expect(prepFits(boolean, null, friday + 1000)).toEqual({ show: false, why: 'nothing planned' })
  })
})

describe('its reason line, said from today’s data', () => {
  it('never repeats the old stored roadmap wording: the module way instead', () => {
    expect(prepReason(boolean, { notebook: 'Software Engineering', module: 'How Computers Work', why: 'Next in your Software Engineering roadmap (How Computers Work)' })).toBe('Next · How Computers Work')
    expect(prepReason(boolean, { notebook: 'Software Engineering', section: 'Basics' })).toBe('Next · Software Engineering, Basics')
  })
  it('uses the plan’s reason as it reads now, and Claude’s own line for a lesson it planned', () => {
    expect(prepReason(boolean, { why: 'Python from the ground up, needed for your aim' })).toBe('Python from the ground up, needed for your aim')
    const planned = { ...boolean, by: 'claude' as const, why: 'Binary is fading, so we firm it up first.', plan: { steps: [{ title: 'Gates' }] } }
    expect(prepReason(planned, { why: 'Something else' })).toBe('Binary is fading, so we firm it up first.')
  })
})

describe('when it was prepared, said accurately', () => {
  it('says today, yesterday, or the weekday', () => {
    expect(preparedWhen(new Date(2026, 10, 15, 9, 5).getTime(), new Date(2026, 10, 15, 16).getTime())).toBe('Prepared today at 09:05')
    expect(preparedWhen(new Date(2026, 10, 14, 15).getTime(), new Date(2026, 10, 15, 16).getTime())).toBe('Prepared yesterday')
    expect(preparedWhen(new Date(2026, 10, 13, 15).getTime(), new Date(2026, 10, 15, 16).getTime())).toBe('Prepared Friday')
  })
})
