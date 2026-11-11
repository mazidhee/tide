import { describe, expect, it } from 'vitest'
import { APPRAISE_NOTE, HUMANITIES_RULES, humanitiesProblems, markingNote, THEOLOGY_RULES } from '../src/shared/humanities'
import { readingOutlineRules } from '../src/shared/readingPlan'
import { HANDS_ON, sessionInstructions } from '../src/shared/session'
import { lessonKit, profileSubject, teachesAsHumanities, TOOLKITS, toolkitText, wordCount } from '../src/shared/subjects'

/** The humanities' rules come to a lesson through the any-subject hook, decided by the subject's profile */
const lesson = (topic: string, subject?: Parameters<typeof lessonKit>[1]) => sessionInstructions({ mode: 'teach', topic, options: subject ? { subject } : undefined })

describe('the humanities through the subject profile', () => {
  it('gives a philosophy lesson the interpret toolkit and the humanities rules, without theology or code', () => {
    const s = lesson("Kant's categorical imperative")
    expect(profileSubject("Kant's categorical imperative").kinds).toEqual(['interpret'])
    expect(s).toContain(TOOLKITS.interpret.rules)
    expect(s).toContain(HUMANITIES_RULES)
    expect(s).not.toContain(THEOLOGY_RULES)
    expect(s).not.toContain(HANDS_ON)
    expect(s.split(HUMANITIES_RULES).length).toBe(2)
  })

  it('gives a physics lesson and a Python lesson none of them', () => {
    for (const t of ["Newton's second law of motion", 'Python generators and yield']) {
      expect(teachesAsHumanities(t), t).toBe(false)
      expect(lesson(t), t).not.toContain('<appraise>')
      expect(lessonKit(t).humanities, t).toBe('')
    }
    expect(lesson('Python generators and yield')).toContain(HANDS_ON)
  })

  it('gives theology its own rules, and history the humanities rules without them', () => {
    const theology = lesson('The problem of evil in Christian theology')
    expect(theology).toContain(HUMANITIES_RULES)
    expect(theology).toContain(THEOLOGY_RULES)
    const history = lesson('The causes of the First World War')
    expect(profileSubject('The causes of the First World War').kinds[0]).toBe('narrative')
    expect(history).toContain(TOOLKITS.narrative.rules)
    expect(history).toContain(HUMANITIES_RULES)
    expect(history).not.toContain(THEOLOGY_RULES)
  })

  it('keeps verdicts where the main kind is build, quant or domain, whatever the second kind', () => {
    for (const t of ['NULL and three-valued logic in SQL', 'Contract law: offer and acceptance']) {
      expect(profileSubject(t).kinds).toContain('interpret')
      expect(teachesAsHumanities(t), t).toBe(false)
      expect(lesson(t), t).not.toContain(HUMANITIES_RULES)
    }
  })

  it("falls back to the humanities' own words for a book the map doesn't know", () => {
    expect(profileSubject('Augustine, Confessions').kinds).toEqual([])
    expect(teachesAsHumanities('Augustine, Confessions')).toBe(true)
    expect(lesson('Augustine, Confessions')).toContain(THEOLOGY_RULES)
    expect(teachesAsHumanities('Zorblax fundamentals')).toBe(false)
  })

  it("follows a profile decided elsewhere (a roadmap's, or the model's) over the topic's words", () => {
    expect(lesson('Week 3: the second half', { kinds: ['interpret'], subjects: [], from: 'model' })).toContain(HUMANITIES_RULES)
    expect(lesson("Kant's categorical imperative", { kinds: ['quant'], subjects: [], from: 'model' })).not.toContain(HUMANITIES_RULES)
  })

  it('sends the appraisal note and the guard only where the profile says so', () => {
    const asks = '<ask type="explain">Why does Kant think a lying promise contradicts itself?</ask>'
    expect(markingNote('(Tide: mark this.)', asks, "Kant's categorical imperative", true)).toBe(APPRAISE_NOTE)
    expect(markingNote('(Tide: mark this.)', asks, "Kant's categorical imperative", false)).toBe('(Tide: mark this.)')
    expect(markingNote('(Tide: mark this.)', asks, 'Contract law: offer and acceptance', teachesAsHumanities('Contract law: offer and acceptance'))).toBe('(Tide: mark this.)')
    expect(humanitiesProblems('Kant', asks, '<grade verdict="wrong">No.</grade>', false)).toEqual([])
    expect(humanitiesProblems('Week 3', asks, '<grade verdict="wrong">No.</grade>', true)[0]).toMatch(/appraise/)
  })

  it("doesn't add the rules twice when main adds a model's profile to a lesson that has them", () => {
    const p = { kinds: ['interpret' as const], subjects: [], from: 'model' as const }
    expect(toolkitText('Augustine, Confessions', p)).toContain(HUMANITIES_RULES)
    expect(toolkitText('Augustine, Confessions', p, { humanities: false })).not.toContain(HUMANITIES_RULES)
  })

  it('keeps lessons within what each side intended (word counts reported)', () => {
    const counts = Object.fromEntries(["Kant's categorical imperative", "Newton's second law of motion", 'Python generators and yield'].map((t) => [t, wordCount(lesson(t))]))
    console.log('lesson instruction word counts', counts)
    // Philosophy: the interpret lesson (about 830 words) plus the humanities rules (under 200)
    expect(counts["Kant's categorical imperative"]).toBeLessThan(1050)
    expect(counts["Newton's second law of motion"]).toBeLessThan(1150)
    expect(counts['Python generators and yield']).toBeLessThan(1400)
  })
})

describe('roadmaps: a book is read in order, a subject is planned by its profile', () => {
  it('gives a book or a reading list the reading rules', () => {
    expect(readingOutlineRules('The Brothers Karamazov', true)).toMatch(/never invent one/)
  })

  it("gives a humanities subject the topic rules, leaving how phases end to the profile's guidance", () => {
    const profiled = readingOutlineRules('Stoic ethics', false, { humanities: teachesAsHumanities('Stoic ethics'), profiled: true })
    expect(profiled).toMatch(/primary sources/)
    expect(profiled).not.toMatch(/not projects/)
    expect(readingOutlineRules('Stoic ethics', false)).toMatch(/not projects/)
    expect(readingOutlineRules("Newton's laws", false, { humanities: teachesAsHumanities("Newton's laws"), profiled: true })).toBe('')
  })
})
