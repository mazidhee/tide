import { describe, expect, it } from 'vitest'
import { checkRequest, finishWorkTask, freeSlug, titleOf, workTaskPrompt, WORK_TASK_SYSTEM } from '../src/shared/workTask'
import { askDecision, cardOf, commitDecision, newState, noteLearner, publicView, revealDecision, workRules, NEW_TASK_RULE } from '../src/shared/workProject'
import { routeOf } from '../src/shared/flightPlan'
import { sessionInstructions } from '../src/shared/session'

const REQUEST = `Hi,
Can you pull together how many new merchants activated each week since June, split by region? Leadership wants it for Thursday's review.
Thanks, Ada`

/** What the model sends back: wrapped in a fence, as models often do */
const REPLY = `\`\`\`markdown
---
title: Weekly merchant activations by region
stakeholder: Ada, Head of Growth
skills: [$match, $group, $dateTrunc]
---

## Brief
How many new merchants activated each week since 1 June, split by region, for Thursday's leadership review.

## What a good answer contains
- Defines "activated" and says which event marks it
- Weeks in the business's time zone, starting on a stated day
- Every region shown, including ones with no activations

## Steps

### 1. Find activations
Task: Find where activation is recorded and count activations since June.
Data: merchants
Skill: $match

### 2. Group by week and region
Task: Count activations per week and region.
Data: merchants.activatedAt, merchants.region
Skill: $group

### 3. Present it
Task: Shape it as a table leadership can read in a minute.
Data: the result of step 2
Skill: presentation

## Decisions

### D1. What counts as activated?
Step: 1
Ask: Which event would you count as a merchant activating, and why?
Decided: The first successful transaction, since sign-up alone isn't use.
Why: Leadership asks about real use; if the team defines activation as KYC passed, use that instead.
Wrong choices:
- Counting sign-ups, which overstates activation

### D2. Which week?
Step: 2
Ask: When does a week start, and in which time zone?
Decided: Monday weeks in Lagos time.
Why: The business reports in local time.

## Defend it
- Why this definition of activated?
- Why does week 1 look low?
\`\`\``

describe('work through a new task', () => {
  it('turns the model’s draft into a work project marked as a new task, keeping the request as it arrived', () => {
    const r = finishWorkTask(REPLY, { text: REQUEST, from: 'Ada' }, Date.UTC(2026, 10, 19))
    if ('error' in r) throw new Error(r.error)
    expect(r.project.fresh).toBe(true)
    expect(r.project.title).toBe('Weekly merchant activations by region')
    expect(r.project.stakeholder).toBe('Ada, Head of Growth')
    expect(r.project.steps.map((s) => s.title)).toEqual(['Find activations', 'Group by week and region', 'Present it'])
    expect(r.project.decisions.map((d) => d.id)).toEqual(['D1', 'D2'])
    expect(r.project.defend).toHaveLength(2)
    expect(r.md).toMatch(/^---\n[\s\S]*kind: new-task[\s\S]*started: 2026-11-19\n---/)
    expect(r.md).toContain('## The request as it arrived\n\n> Hi,\n> Can you pull together')
    // The request's own section is not read as part of the project
    expect(r.project.brief).not.toContain('Hi,')
  })

  it('fills who asked from the learner when the draft names nobody', () => {
    const r = finishWorkTask(REPLY.replace('stakeholder: Ada, Head of Growth\n', ''), { text: REQUEST, from: 'Ada, Growth' })
    if ('error' in r) throw new Error(r.error)
    expect(r.project.stakeholder).toBe('Ada, Growth')
  })

  it('refuses a draft that isn’t a project', () => {
    expect(finishWorkTask('Sorry, I can’t help with that.', { text: REQUEST })).toHaveProperty('error')
    expect(finishWorkTask('## Brief\nSomething.\n', { text: REQUEST })).toEqual({ error: 'The draft had no steps.' })
  })

  it('runs on the existing machinery: route, checkpoints asked before the usual choice is revealed', () => {
    const r = finishWorkTask(REPLY, { text: REQUEST })
    if ('error' in r) throw new Error(r.error)
    const p = r.project
    const pub = publicView(p)
    expect(pub.fresh).toBe(true)
    expect(JSON.stringify(pub)).not.toContain('first successful transaction')
    expect(routeOf(pub, newState(p.slug)).stops.map((s) => s.key)).toEqual(['s1', 'D1', 's2', 'D2', 's3', 'defend'])
    let s = newState(p.slug)
    expect(revealDecision(p, s, 'D1').error).toMatch(/only after/)
    s = askDecision(p, s, 'D1').state
    s = noteLearner(s, 'When they first take a payment')
    s = commitDecision(p, s, 'D1').state
    const shown = revealDecision(p, s, 'D1')
    expect(shown.text).toContain('usually choose (a new task: nobody has decided this yet)')
    expect(shown.text).toContain('confirm it with whoever asked')
    expect(shown.text).not.toContain('What was actually decided')
    expect(cardOf(p, s)).toMatchObject({ fresh: true, answered: 1, decisions: 2 })
  })

  it('tells the tutor this is a new, real task only for such projects', () => {
    expect(workRules('X', true)).toContain(NEW_TASK_RULE)
    expect(workRules('X')).not.toContain(NEW_TASK_RULE)
    const setup = { mode: 'teach' as const, scope: { kind: 'none' as const }, topic: 'Work project: X', options: { strategy: 'code' as const, workProject: { slug: 'x', title: 'X', fresh: true } } }
    expect(sessionInstructions(setup)).toContain('new, real request from their job')
  })

  it('checks the paste, names practice collections in the prompt, and finds a free slug', () => {
    expect(checkRequest({ text: 'pls do the thing' })).toMatch(/Paste the whole request/)
    expect(checkRequest({ text: REQUEST })).toBeNull()
    const prompt = workTaskPrompt({ text: REQUEST, from: 'Ada' }, [{ name: 'merchants' }, { name: 'transactions' }], '2026-11-19')
    expect(prompt).toContain('Who asked: Ada')
    expect(prompt).toContain('- merchants\n- transactions')
    expect(workTaskPrompt({ text: REQUEST })).toContain('No practice data is set up')
    expect(WORK_TASK_SYSTEM).toContain('## Decisions')
    expect(freeSlug('Weekly activations', ['weekly-activations', 'weekly-activations-2'])).toBe('weekly-activations-3')
    expect(freeSlug('Weekly activations', [])).toBe('weekly-activations')
    expect(titleOf(REQUEST)).toBe('Can you pull together how many new')
  })
})
