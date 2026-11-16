import { describe, expect, it } from 'vitest'
import { askDecision, commitDecision, newState, noteLearner, parseWorkProject, progressText, publicView, revealDecision, rubricFor, summaryMarkdown, workRules, WORK_MARK } from '../src/shared/workProject'
import { toolPacks, packTools } from '../src/shared/tutorGuide'
import { claudeSystemBase } from '../src/shared/tutorPrompt'
import { sessionInstructions } from '../src/shared/session'

const MD = `---
title: Counting shop orders
slug: shop-orders
order: 2
stakeholder: Sam, Sales lead
skills: [$match, $group]
---

## Brief
How many orders did we take last month, and what's a typical order worth?

## What a good answer contains
- Counts only completed orders
- Uses the median order value, saying why

## Steps

### 1. Find the orders
Task: Count every order in the orders collection.
Data: orders
Skill: $count

### 2. Typical value
Task: Work out a typical order value.
Data: orders.amount (pence)
Skill: $group, $median

## Decisions

### D1. Average or median?
Step: 2
Ask: Should "typical" be the average or the median order value?
Decided: The median.
Why: A few very large orders pull the mean far above what most customers spend.
Wrong choices:
- The mean, because it is what the old dashboard showed
- The mode

## Defend it
- Why not the mean?
- What would change if refunds were counted?
`

describe('work project files', () => {
  it('reads the brief, steps, decisions and defend-it questions', () => {
    const { project, problems } = parseWorkProject(MD, 'x')
    expect(problems).toEqual([])
    expect(project!.slug).toBe('shop-orders')
    expect(project!.stakeholder).toBe('Sam, Sales lead')
    expect(project!.steps.map((s) => s.title)).toEqual(['Find the orders', 'Typical value'])
    expect(project!.steps[1].data).toBe('orders.amount (pence)')
    expect(project!.decisions[0]).toMatchObject({ id: 'D1', step: 2, decided: 'The median.' })
    expect(project!.decisions[0].wrong).toHaveLength(2)
    expect(project!.rubric).toHaveLength(2)
    expect(project!.defend).toHaveLength(2)
  })

  it('says what is missing', () => {
    const { problems } = parseWorkProject('## Brief\nHi\n\n## Steps\n### 1. A\nTask: a\n\n## Decisions\n### D1. X\nStep: 1\n', 'y')
    expect(problems.join(' ')).toMatch(/Ask:/)
    expect(problems.join(' ')).toMatch(/Decided:/)
  })

  it('the public view has no rubric and no decided choices', () => {
    const { project } = parseWorkProject(MD)
    const text = JSON.stringify(publicView(project!))
    expect(text).not.toMatch(/The median\./)
    expect(text).not.toMatch(/pull the mean/)
    expect(text).not.toMatch(/Counts only completed/)
    expect(text).toMatch(/average or the median/)
  })
})

describe('the session rules', () => {
  const p = parseWorkProject(MD).project!

  it('never reveals a decision before the learner has answered', () => {
    let s = newState(p.slug)
    expect(revealDecision(p, s, 'D1').error).toMatch(/only after the learner has committed/)
    // Not asked yet: nothing to commit
    expect(commitDecision(p, s, 'D1').error).toMatch(/Ask D1 first/)
    s = askDecision(p, s, 'D1').state
    // Asked, but no reply since: still nothing
    expect(commitDecision(p, s, 'D1').error).toMatch(/haven't answered/)
    expect(revealDecision(p, s, 'D1').error).toBeTruthy()
    s = noteLearner(s, 'Median, because big orders skew the mean')
    const c = commitDecision(p, s, 'D1')
    expect(c.error).toBeUndefined()
    expect(c.state.committed.D1.answer).toBe('Median, because big orders skew the mean')
    const r = revealDecision(p, c.state, 'd1')
    expect(r.text).toMatch(/The median\./)
    expect(r.text).toMatch(/Their answer: Median/)
    expect(r.state.revealed).toEqual(['D1'])
  })

  it('a message from before the question is not an answer', () => {
    let s = noteLearner(newState(p.slug), 'I think the mean')
    s = askDecision(p, s, 'D1').state
    expect(commitDecision(p, s, 'D1').error).toBeTruthy()
  })

  it('the page commits what they typed, and refuses an empty answer', () => {
    const s = newState(p.slug)
    expect(commitDecision(p, s, 'D1', 0, ' ').error).toMatch(/Write your answer/)
    const c = commitDecision(p, s, 'D1', 1, 'the median')
    expect(c.state.committed.D1).toMatchObject({ answer: 'the median', via: 'page' })
  })

  it('the rubric opens only once every decision is answered', () => {
    let s = newState(p.slug)
    expect(rubricFor(p, s).error).toMatch(/still open: D1/)
    s = commitDecision(p, s, 'D1', 0, 'median').state
    expect(rubricFor(p, s).text).toMatch(/Counts only completed orders/)
  })

  it('progress lists decision questions but never what was decided', () => {
    const s = askDecision(p, newState(p.slug), 'D1').state
    const t = progressText(p, s)
    expect(t).toMatch(/asked, waiting for their answer/)
    expect(t).not.toMatch(/The median\./)
  })

  it('the summary keeps their answers beside what was decided', () => {
    let s = commitDecision(p, newState(p.slug), 'D1', 0, 'median').state
    s = revealDecision(p, s, 'D1').state
    const md = summaryMarkdown(p, s, 'I counted orders and used the median.', Date.UTC(2026, 10, 16))
    expect(md).toMatch(/you said: median/)
    expect(md).toMatch(/decided at the time: The median\./)
  })
})

describe('the work project layer', () => {
  it('only work project lessons get its tools', () => {
    expect(packTools(toolPacks({ kind: 'lesson' })).has('work_project')).toBe(false)
    expect(packTools(toolPacks({ kind: 'chat' })).has('practice_metabase')).toBe(false)
    const work = packTools(toolPacks({ kind: 'lesson', data: true, workProject: true }))
    expect(work.has('work_project')).toBe(true)
    expect(work.has('practice_metabase')).toBe(true)
    // Never the company Metabase in a practice session
    expect(work.has('metabase')).toBe(false)
  })

  it('the stable lesson prompt is unchanged by it; the rules ride in the instructions', () => {
    expect(claudeSystemBase({ kind: 'lesson' })).not.toMatch(/work_project/)
    expect(claudeSystemBase({ kind: 'lesson' }).length).toBeLessThanOrEqual(19_800)
    const ins = sessionInstructions({ mode: 'teach', topic: 'Work project: Counting', options: { strategy: 'code', codeRoot: '/x/Code/Work/a', workProject: { slug: 'a', title: 'Counting' } } })
    expect(ins).toContain(WORK_MARK)
    expect(workRules('Counting').length).toBeLessThan(2000)
    expect(sessionInstructions({ mode: 'teach', topic: 'Sorting' })).not.toContain(WORK_MARK)
  })
})
