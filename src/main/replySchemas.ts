/**
 * The JSON shapes some replies must have, as JSON Schemas. A cloud provider that supports
 * structured outputs (providers.ts, `jsonSchema`) is held to them; every other reply, Gemma's
 * included, is read and repaired by extractJson* in ai.ts, so these never have to be exact:
 * the parsers still check every field. Kept loose on purpose (no `strict`), so a provider never
 * refuses a request over a schema feature it lacks.
 */
import type { ReplySchema } from './cloudStream'

const str = { type: 'string' }
const num = { type: 'number' }
const nums = { type: 'array', items: num }
const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({ type: 'object', properties, required })
const strings = { type: 'array', items: str }

const phase = object({ title: str, weeks: num, outcome: str, project: str, practice: strings })

/** A sized study plan (planner.ts sizePlan) */
export const PLAN_SCHEMA: ReplySchema = {
  name: 'study_plan',
  schema: object({ scope: { type: 'string', enum: ['tool', 'skill', 'discipline', 'career'] }, coding: { type: 'boolean' }, why: str, phases: { type: 'array', items: phase } })
}

/** A plan changed as asked (planner.ts adjustPlan) */
export const ADJUSTED_PLAN_SCHEMA: ReplySchema = {
  name: 'adjusted_plan',
  schema: object({ scope: { type: 'string', enum: ['tool', 'skill', 'discipline', 'career'] }, coding: { type: 'boolean' }, hoursPerWeek: num, why: str, phases: { type: 'array', items: phase } })
}

/** What to read in each phase (planner.ts planReadings) */
export const READINGS_SCHEMA: ReplySchema = {
  name: 'phase_readings',
  schema: object({ phases: { type: 'array', items: object({ phase: num, items: { type: 'array', items: object({ title: str, by: str, why: str }, ['title']) } }) } })
}

/** Which roadmap sections each aim calls for, and classes for untagged ones (curriculum.ts) */
export const SORT_SCHEMA: ReplySchema = {
  name: 'roadmap_sort',
  schema: object(
    {
      aims: { type: 'object', additionalProperties: object({ about: nums, needs: nums, useful: nums }) },
      classes: { type: 'object', additionalProperties: { type: 'string', enum: ['core', 'supporting', 'elective', 'enrichment', 'skip'] } }
    },
    ['aims']
  )
}

/** The topics that are history or background (curriculum.ts) */
export const ENRICH_SCHEMA: ReplySchema = { name: 'roadmap_enrichment', schema: object({ enrichment: nums }) }

/** A roadmap audit's suggested changes (curriculum.ts proposeChanges) */
export const PROPOSALS_SCHEMA: ReplySchema = {
  name: 'roadmap_changes',
  schema: object({
    changes: {
      type: 'array',
      items: object({ kind: { type: 'string', enum: ['place', 'add'] }, targets: strings, to: { type: 'string', enum: ['weekdays', 'weekend', 'later', 'skip'] }, after: str, title: str, why: str }, ['kind', 'why'])
    }
  })
}

/** The check of what a tutor taught (lessonGuard.ts) */
export const CLAIMS_SCHEMA: ReplySchema = {
  name: 'claim_check',
  schema: object(
    {
      ok: { type: 'boolean' },
      errors: { type: 'array', items: object({ quote: str, fix: str }) },
      unsure: { type: 'array', items: object({ quote: str, why: str }) }
    },
    ['ok']
  )
}
