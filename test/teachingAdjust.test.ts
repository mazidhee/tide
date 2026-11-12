import { describe, expect, it } from 'vitest'
import { adjustmentsPrompt, deriveAdjustments, MAX_ACTIVE, parseReview, reviewPrompt, reviewTranscript, RUBRIC_IDS, type LessonReview } from '../src/shared/teachingAdjust'
import { measureTeaching, type TeachingMeasures } from '../src/shared/teachingQuality'

const NOW = new Date(2026, 10, 12).getTime()
const base = {
  lesson: 'l1',
  topic: 'Binary',
  at: NOW,
  taught: NOW - 3600_000,
  model: 'opus'
}
const empty = (): TeachingMeasures => measureTeaching([], [], NOW)

describe('parseReview', () => {
  it('reads scores, notes, next time and the adjustments it recommends', () => {
    const r = parseReview(
      'Here: {"scores": {"clarity": 4, "checking": 2.4, "pacing": 9, "steps": null, "examples": "3", "feedback": 5, "misconceptions": null, "preferences": 4}, "notes": {"pacing": "Drilled hex after two right.", "nonsense": "x"}, "summary": "Good.", "next_time": ["Move on after two right.", "", "Show a worked hex example.", "a", "b"], "adjust": ["less-drill", "made-up", "less-drill"]}',
      base
    )!
    expect(r.scores).toMatchObject({
      clarity: 4,
      checking: 2,
      pacing: 5,
      steps: null,
      examples: 3
    })
    expect(Object.keys(r.scores).sort()).toEqual([...RUBRIC_IDS].sort())
    expect(r.notes).toEqual({ pacing: 'Drilled hex after two right.' })
    expect(r.nextTime).toEqual(['Move on after two right.', 'Show a worked hex example.', 'a'])
    expect(r.adjust).toEqual(['less-drill'])
  })
  it('refuses a reply with no scores', () => {
    expect(parseReview('{"summary": "x"}', base)).toBeNull()
    expect(parseReview('{"scores": {"clarity": null}}', base)).toBeNull()
    expect(parseReview('not json', base)).toBeNull()
  })
})

describe('the review prompt', () => {
  it('hides the tutor’s working and Tide’s notes, and keeps the ends of a long lesson', () => {
    const t = reviewTranscript([
      { role: 'user', content: 'Answer: 5\n\n(Tide: mark this first.)' },
      {
        role: 'assistant',
        content: 'Right. <solution>secret</solution><check lang="python">assert 1</check><ask type="short">Next?</ask>'
      }
    ])
    expect(t).toContain('LEARNER: Answer: 5')
    expect(t).not.toContain('Tide: mark')
    expect(t).not.toContain('secret')
    expect(t).not.toContain('assert')
    const long = reviewTranscript(
      Array.from({ length: 200 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: `turn ${i} ${'x'.repeat(500)}`
      })),
      20_000
    )
    expect(long.length).toBeLessThan(21_000)
    expect(long).toContain('[0] LEARNER')
    expect(long).toContain('[199] TUTOR')
    expect(long).toContain('middle of the lesson cut')
    const p = reviewPrompt({
      topic: 'Binary',
      transcript: 'T',
      pacing: {
        answers: 3,
        drilledAfterMastery: 2,
        moveOnAsks: 1,
        firstTryMisses: 0,
        steps: 2
      },
      answers: []
    })
    expect(p).toContain('2 questions set in a step after two right in a row')
    for (const id of RUBRIC_IDS) expect(p).toContain(`- ${id}:`)
  })
})

const review = (o: Partial<LessonReview>): LessonReview => ({
  ...base,
  scores: Object.fromEntries(RUBRIC_IDS.map((id) => [id, 4])) as LessonReview['scores'],
  notes: {},
  summary: '',
  nextTime: [],
  adjust: [],
  ...o
})

describe('deriveAdjustments', () => {
  it('turns on nothing without evidence', () => {
    expect(deriveAdjustments(empty(), [], {}, NOW)).toEqual([])
    expect(adjustmentsPrompt([])).toBe('')
  })
  it('follows the measures', () => {
    const m = empty()
    m.pacing = {
      drilledAfterMastery: 5,
      steps: 4,
      moveOnAsks: 0,
      firstTryMisses: 0
    }
    m.calibration = {
      ...m.calibration,
      verdict: 'overconfident',
      bias: 0.3,
      answers: 10
    }
    const s = deriveAdjustments(m, [], {}, NOW)
    expect(s.map((x) => x.id).sort()).toEqual(['confidence-why', 'less-drill'])
    expect(s.every((x) => x.active)).toBe(true)
    expect(s.find((x) => x.id === 'less-drill')!.why[0]).toMatch(/5 questions were set after two right/)
  })
  it('follows recent reviews (their picks and low scores), not old ones', () => {
    const recent = review({
      adjust: ['worked-examples'],
      scores: { ...review({}).scores, checking: 2 }
    })
    const old = review({
      at: NOW - 60 * 86_400_000,
      adjust: ['shorter-steps']
    })
    const ids = deriveAdjustments(empty(), [recent, old], {}, NOW).map((x) => x.id)
    expect(ids).toContain('worked-examples')
    expect(ids).toContain('more-checks')
    expect(ids).not.toContain('shorter-steps')
  })
  it('keeps a switched-off one listed and out of the prompt, and caps how many are on', () => {
    const r = review({
      adjust: ['worked-examples', 'less-drill', 'shorter-steps', 'more-checks', 'transfer-early', 'confidence-why']
    })
    const s = deriveAdjustments(empty(), [r], { 'less-drill': { off: true } }, NOW)
    expect(s.filter((x) => x.active)).toHaveLength(MAX_ACTIVE)
    const off = s.find((x) => x.id === 'less-drill')!
    expect(off).toMatchObject({ off: true, active: false })
    expect(adjustmentsPrompt(s)).not.toContain('two right in a row')
    // Off by hand and no longer suggested: still there to switch back on
    expect(deriveAdjustments(empty(), [], { 'shorter-steps': { off: true } }, NOW)).toEqual([
      expect.objectContaining({
        id: 'shorter-steps',
        off: true,
        active: false
      })
    ])
  })
  it('names known misconceptions in the prompt line', () => {
    const s = deriveAdjustments(empty(), [review({ adjust: ['revisit-misconceptions'] })], {}, NOW)
    expect(adjustmentsPrompt(s, ['Place value left to right'])).toMatch(/Known ones: “Place value left to right”/)
  })
})
