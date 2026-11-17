/**
 * A MongoDB aggregation pipeline, read as the clicks in Metabase's query builder (the "notebook
 * editor": Filter, Summarize, Group by, Join, Custom column, Sort, Row limit) that would build the
 * same question. Each stage maps to a builder action, or is marked native only, with the reason.
 * Being told honestly what the builder can't do is part of the lesson: on MongoDB in particular,
 * Metabase's builder has no joins.
 *
 * Generic: nothing here knows a project, a collection or a company. Pure.
 */

export type BuilderAction = 'Filter' | 'Summarize' | 'Group by' | 'Join' | 'Custom column' | 'Pick columns' | 'Sort' | 'Row limit'

export interface BuilderStep {
  /** The stage's operator, e.g. $match */
  stage: string
  /** What to click; null when the builder can't do it */
  action: BuilderAction | null
  /** In words: what to pick in the builder */
  how: string
  /** Why this stage needs a native query, when it does */
  native?: string
}

export interface BuilderGuide {
  steps: BuilderStep[]
  /** Every stage has a builder action */
  builderOk: boolean
  /** The stages that need a native query, and why (one line each) */
  nativeOnly: string[]
  /** The pipeline cuts dates in a time zone: how that maps onto Metabase's report time zone */
  timezone?: { zone: string; note: string }
}

type Doc = Record<string, unknown>
const isDoc = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: unknown) => (isDoc(v) ? Object.keys(v) : [])

/** "$a.b" → "a › b": a field as the builder lists it (nested fields under their parent) */
export function fieldName(ref: unknown): string {
  if (typeof ref !== 'string') return 'an expression'
  return ref.replace(/^\$+/, '').split('.').join(' › ')
}

const UNIT: Record<string, string> = { year: 'Year', quarter: 'Quarter', month: 'Month', week: 'Week', day: 'Day', hour: 'Hour', minute: 'Minute' }

/** Expression operators the builder's custom expressions can write on MongoDB */
const EXPR_OK = new Set(['$add', '$subtract', '$multiply', '$divide', '$concat', '$cond', '$ifNull', '$abs', '$round', '$floor', '$ceil', '$toLower', '$toUpper', '$trim', '$substr', '$substrCP', '$strLenCP', '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$and', '$or', '$not', '$in', '$switch', '$year', '$month', '$dayOfMonth', '$literal'])
/** Expression operators with no builder equivalent on MongoDB, and why */
const EXPR_NATIVE: Record<string, string> = {
  $toString: 'changing a type (an ObjectId to text) has no builder function on MongoDB',
  $toObjectId: 'changing a type has no builder function on MongoDB',
  $convert: 'changing a type has no builder function on MongoDB',
  $toDate: 'changing a type has no builder function on MongoDB',
  $regexMatch: 'the builder filters with contains / starts with / ends with, not regular expressions',
  $regexFind: 'pulling text out with a regular expression has no builder function',
  $dateToString: 'formatting a date as text in a time zone is done by the column’s display settings, not the query',
  $dateFromString: 'parsing text into a date has no builder function on MongoDB',
  $dateTrunc: 'a truncated date is a Group by with a unit (by Month), not a custom column',
  $median: 'MongoDB in Metabase has no median or percentile aggregation in the builder',
  $percentile: 'MongoDB in Metabase has no median or percentile aggregation in the builder',
  $getField: 'reading a field by a computed name has no builder function',
  $map: 'array expressions have no builder functions',
  $filter: 'array expressions have no builder functions',
  $reduce: 'array expressions have no builder functions',
  $size: 'array expressions have no builder functions',
  $arrayElemAt: 'array expressions have no builder functions',
  $let: 'variables in an expression have no builder equivalent',
  $function: 'server-side JavaScript is never in the builder'
}

/** Every operator used anywhere in an expression */
function operators(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => operators(x, out))
  else if (isDoc(v))
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('$')) out.add(k)
      operators(x, out)
    }
  return out
}

/** The first reason an expression can't be a builder custom expression, if any */
function exprNative(v: unknown): string | null {
  for (const op of operators(v)) {
    if (EXPR_NATIVE[op]) return `${op}: ${EXPR_NATIVE[op]}`
    if (!EXPR_OK.has(op) && !/^\$(gte?|lte?|eq|ne|in|nin|exists|regex|options|and|or|nor|not|expr|elemMatch|size|all|type)$/.test(op)) return `${op} has no builder equivalent on MongoDB`
  }
  return null
}

/** The time zone a date expression cuts in, if it names one */
function zoneOf(v: unknown): string | null {
  if (Array.isArray(v)) {
    for (const x of v) {
      const z = zoneOf(x)
      if (z) return z
    }
  } else if (isDoc(v)) {
    if (typeof v.timezone === 'string') return v.timezone
    for (const x of Object.values(v)) {
      const z = zoneOf(x)
      if (z) return z
    }
  }
  return null
}

const RELATIVE = /\$\$NOW|\$\$CLOCK_TIME/

function describeCondition(field: string, cond: unknown): { text: string; native?: string } {
  const f = fieldName(field)
  if (!isDoc(cond) || !keys(cond).some((k) => k.startsWith('$'))) {
    if (cond instanceof RegExp) return { text: `${f} matches a pattern`, native: 'a regular expression filter: the builder has contains / starts with / ends with only' }
    return { text: `${f} is ${JSON.stringify(cond)}` }
  }
  const parts: string[] = []
  let native: string | undefined
  for (const [op, v] of Object.entries(cond)) {
    const val = JSON.stringify(v)
    if (op === '$eq') parts.push(`is ${val}`)
    else if (op === '$ne') parts.push(`is not ${val}`)
    else if (op === '$in') parts.push(`is one of ${Array.isArray(v) ? v.map((x) => JSON.stringify(x)).join(', ') : val}`)
    else if (op === '$nin') parts.push(`is none of ${Array.isArray(v) ? v.map((x) => JSON.stringify(x)).join(', ') : val}`)
    else if (op === '$gt' || op === '$gte') parts.push(`${op === '$gt' ? 'is after / greater than' : 'is on or after / at least'} ${RELATIVE.test(val) ? 'a relative date (e.g. "Current month")' : val}`)
    else if (op === '$lt' || op === '$lte') parts.push(`${op === '$lt' ? 'is before / less than' : 'is on or before / at most'} ${RELATIVE.test(val) ? 'a relative date' : val}`)
    else if (op === '$exists') parts.push(v ? 'is not empty' : 'is empty')
    else if (op === '$regex') {
      const src = String(v)
      const plain = src.replace(/^\^/, '').replace(/\$$/, '')
      if (/^[\w .-]*$/.test(plain)) parts.push(src.startsWith('^') ? `starts with "${plain}"` : src.endsWith('$') ? `ends with "${plain}"` : `contains "${plain}"`)
      else {
        parts.push(`matches /${src}/`)
        native = 'a regular expression filter: the builder has contains / starts with / ends with only'
      }
    } else if (op === '$options') continue
    else {
      parts.push(`${op} ${val}`)
      native = `${op} has no builder filter`
    }
  }
  return { text: `${f} ${parts.join(' and ')}`, native }
}

function matchStep(m: unknown): BuilderStep {
  if (!isDoc(m)) return { stage: '$match', action: null, how: 'An empty filter', native: 'not a filter document' }
  const lines: string[] = []
  const natives: string[] = []
  for (const [k, v] of Object.entries(m)) {
    if (k === '$expr') {
      const n = exprNative(v)
      lines.push('Filter › Custom expression (comparing fields or computed values)')
      if (n) natives.push(n)
    } else if (k === '$or' || k === '$and' || k === '$nor') {
      const subs = Array.isArray(v) ? v : []
      const words = subs.flatMap((s) => Object.entries(isDoc(s) ? s : {}).map(([f, c]) => describeCondition(f, c)))
      words.forEach((w) => w.native && natives.push(w.native))
      if (k === '$and') lines.push(...words.map((w) => w.text))
      else if (k === '$or') lines.push(`one Custom expression joining these with OR: ${words.map((w) => w.text).join('; ')}`)
      else natives.push('$nor: “none of these” has no builder filter')
    } else {
      const d = describeCondition(k, v)
      lines.push(d.text)
      if (d.native) natives.push(d.native)
    }
  }
  return { stage: '$match', action: natives.length ? null : 'Filter', how: `Filter: ${lines.join('; ') || 'nothing'}`, ...(natives.length ? { native: natives.join('; ') } : {}) }
}

/** The group key, as Group by columns: a field, a date by unit, or several */
function groupBy(id: unknown): { cols: string[]; native?: string; zone?: string } {
  if (id === null || id === undefined || (typeof id !== 'string' && !isDoc(id))) return { cols: [] }
  if (typeof id === 'string') return { cols: [fieldName(id)] }
  // A date truncated by a unit: { $dateTrunc: { date, unit, timezone } }
  if (isDoc(id.$dateTrunc)) {
    const t = id.$dateTrunc
    const unit = UNIT[String(t.unit ?? '').toLowerCase()] ?? String(t.unit ?? '')
    return { cols: [`${fieldName(t.date)}: ${unit}`], ...(typeof t.timezone === 'string' ? { zone: t.timezone } : {}) }
  }
  if (keys(id).some((k) => k.startsWith('$'))) {
    const op = keys(id)[0]
    const shorthand: Record<string, string> = { $year: 'Year', $month: 'Month of year', $dayOfMonth: 'Day of month', $dayOfWeek: 'Day of week', $hour: 'Hour of day' }
    if (shorthand[op]) return { cols: [`${fieldName(id[op])}: ${shorthand[op]}`] }
    const n = exprNative(id)
    return { cols: ['a custom column'], ...(n ? { native: n } : {}) }
  }
  const cols: string[] = []
  let native: string | undefined
  let zone: string | undefined
  for (const v of Object.values(id)) {
    const g = groupBy(v)
    cols.push(...g.cols)
    native ??= g.native
    zone ??= g.zone
  }
  return { cols, ...(native ? { native } : {}), ...(zone ? { zone } : {}) }
}

/** One accumulator, as a Summarize metric */
function metric(name: string, acc: unknown): { text: string; native?: string } {
  if (!isDoc(acc)) return { text: name, native: 'not an accumulator' }
  const [op] = keys(acc)
  const v = acc[op]
  if (op === '$sum' && (v === 1 || v === '1')) return { text: 'Count of rows' }
  if (op === '$count') return { text: 'Count of rows' }
  if (op === '$sum' && typeof v === 'string') return { text: `Sum of ${fieldName(v)}` }
  if (op === '$sum' && isDoc(v) && isDoc(v.$cond)) return { text: `${name}: a Custom expression, CountIf(…) or SumIf(…) with the condition` }
  if (op === '$avg' && typeof v === 'string') return { text: `Average of ${fieldName(v)}` }
  if (op === '$min' && typeof v === 'string') return { text: `Minimum of ${fieldName(v)}` }
  if (op === '$max' && typeof v === 'string') return { text: `Maximum of ${fieldName(v)}` }
  if (op === '$addToSet' && typeof v === 'string') return { text: `Number of distinct values of ${fieldName(v)} (if a later stage counts the set)` }
  if (op === '$median' || op === '$percentile') return { text: `Median of ${fieldName(isDoc(v) ? v.input : v)}`, native: EXPR_NATIVE.$median }
  if (op === '$push' || op === '$first' || op === '$last' || op === '$mergeObjects' || op === '$top' || op === '$bottom') return { text: `${op} into ${name}`, native: `${op}: the builder only aggregates to a number (count, sum, average, min, max, distinct)` }
  const n = exprNative(v)
  return { text: `${op.replace('$', '')} of a computed value (a Custom expression)`, ...(n ? { native: n } : {}) }
}

function groupStep(g: unknown, next?: Doc): { step: BuilderStep; zone?: string; skipNext?: boolean } {
  if (!isDoc(g)) return { step: { stage: '$group', action: null, how: 'A group', native: 'not a group document' } }
  const by = groupBy(g._id)
  const accs = Object.entries(g).filter(([k]) => k !== '_id')
  // Two groups for a distinct count: group by {a, b}, then group by _id.a counting
  if (next && isDoc(next.$group) && isDoc(g._id) && keys(g._id).length === 2) {
    const n = next.$group
    const ref = typeof n._id === 'string' ? n._id.replace(/^\$_id\./, '') : ''
    const [kept, other] = ref && keys(g._id).includes(ref) ? [ref, keys(g._id).find((k) => k !== ref)!] : ['', '']
    const counts = Object.values(n).slice(1).every((a) => isDoc(a) && (a.$sum === 1 || '$count' in a))
    if (kept && counts) {
      const keptCol = groupBy((g._id as Doc)[kept])
      const otherCol = fieldName((g._id as Doc)[other])
      return { step: { stage: '$group ×2', action: 'Summarize', how: `Summarize: Number of distinct values of ${otherCol}, Group by ${keptCol.cols.join(', ')}. (Your two $group stages are one distinct count in the builder.)`, ...(keptCol.native ? { native: keptCol.native } : {}) }, zone: keptCol.zone, skipNext: true }
    }
  }
  const ms = accs.map(([k, a]) => metric(k, a))
  const natives = [by.native, ...ms.map((m) => m.native)].filter(Boolean) as string[]
  const how = `Summarize: ${ms.map((m) => m.text).join(', ') || 'nothing'}${by.cols.length ? `, Group by ${by.cols.join(', ')}` : ' (no Group by: one row)'}`
  return { step: { stage: '$group', action: natives.length ? null : 'Summarize', how, ...(natives.length ? { native: natives.join('; ') } : {}) }, zone: by.zone }
}

function projectStep(stage: string, p: unknown): BuilderStep {
  if (!isDoc(p)) return { stage, action: null, how: stage, native: 'not a document' }
  const computed = Object.entries(p).filter(([, v]) => !(v === 0 || v === 1 || v === true || v === false))
  const picked = Object.entries(p).filter(([, v]) => v === 1 || v === true)
  if (stage === '$project' && !computed.length) return { stage, action: 'Pick columns', how: `Pick columns: ${picked.map(([k]) => k).join(', ') || 'all but the hidden ones'} (the column picker on the data step)` }
  const natives = computed.map(([k, v]) => {
    const n = typeof v === 'string' ? null : exprNative(v)
    return n ? `${k}: ${n}` : null
  }).filter(Boolean) as string[]
  return { stage, action: natives.length ? null : 'Custom column', how: `Custom column: ${computed.map(([k]) => k).join(', ')}`, ...(natives.length ? { native: natives.join('; ') } : {}) }
}

const NATIVE_STAGES: Record<string, string> = {
  $lookup: 'Joins aren’t available in the builder on MongoDB: Metabase’s MongoDB driver doesn’t support them, so any question that combines two collections is a native query',
  $unwind: 'the builder can’t turn one document’s array into rows; nested objects show as columns, arrays don’t',
  $facet: 'several pipelines in one result has no builder equivalent',
  $bucket: 'fixed bucket boundaries: the builder only bins automatically (Group by › binning)',
  $bucketAuto: 'the builder bins a number by itself (Group by › binning), but not this way exactly',
  $replaceRoot: 'reshaping a document has no builder equivalent',
  $replaceWith: 'reshaping a document has no builder equivalent',
  $setWindowFields: 'window functions (running totals over partitions) aren’t in the builder on MongoDB',
  $densify: 'filling missing dates has no builder equivalent',
  $fill: 'filling gaps has no builder equivalent',
  $skip: 'the builder has a row limit, not an offset',
  $sample: 'random samples aren’t in the builder',
  $graphLookup: 'recursive lookups are never in the builder',
  $unionWith: 'combining collections is a native query on MongoDB'
}

/** The builder guide for one pipeline */
export function builderGuide(stages: Doc[]): BuilderGuide {
  const steps: BuilderStep[] = []
  let zone: string | null = null
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i]
    const [op] = keys(st)
    if (!op) continue
    const v = st[op]
    zone ??= zoneOf(v)
    if (op === '$match') steps.push(matchStep(v))
    else if (op === '$group') {
      const r = groupStep(v, stages[i + 1])
      steps.push(r.step)
      if (r.skipNext) i++
    } else if (op === '$count') steps.push({ stage: op, action: 'Summarize', how: 'Summarize: Count of rows (no Group by)' })
    else if (op === '$sortByCount') steps.push({ stage: op, action: 'Summarize', how: `Summarize: Count of rows, Group by ${fieldName(v)}; then Sort by Count, descending` })
    else if (op === '$sort') steps.push({ stage: op, action: 'Sort', how: `Sort: ${Object.entries(isDoc(v) ? v : {}).map(([k, d]) => `${fieldName(k)} ${d === -1 ? 'descending' : 'ascending'}`).join(', ')}` })
    else if (op === '$limit') steps.push({ stage: op, action: 'Row limit', how: `Row limit: ${String(v)}` })
    else if (op === '$addFields' || op === '$set' || op === '$project') steps.push(projectStep(op, v))
    else if (op === '$unset') steps.push({ stage: op, action: 'Pick columns', how: 'Pick columns: untick the ones removed' })
    else if (op === '$lookup') steps.push({ stage: op, action: null, how: `Join: ${String((isDoc(v) && v.from) || 'another collection')}`, native: NATIVE_STAGES.$lookup })
    else steps.push({ stage: op, action: null, how: op, native: NATIVE_STAGES[op] ?? `${op} has no builder equivalent` })
  }
  const nativeOnly = steps.filter((s) => s.native).map((s) => `${s.stage}: ${s.native}`)
  const tz = zone
    ? {
        zone,
        note: `Your pipeline cuts dates in ${zone}. The builder has no time zone per question: it buckets dates (Group by … : Month) in Metabase’s report time zone, set once for the whole instance under Admin › Settings › Localization. If that isn’t ${zone}, events near midnight at a month’s edge land in the next or previous month, and your builder rows won’t match your pipeline’s. Your pipeline’s $dateTrunc returns an instant (midnight in ${zone}), which Metabase then shows in the report time zone: that’s why a month can be labelled with the last day of the month before.`
      }
    : undefined
  return { steps, builderOk: !nativeOnly.length && steps.length > 0, nativeOnly, ...(tz ? { timezone: tz } : {}) }
}

/** The guide as text, for the tutor */
export function guideText(g: BuilderGuide): string {
  const lines = g.steps.map((s, i) => `${i + 1}. ${s.stage} → ${s.action ?? 'native only'}: ${s.how}${s.native ? ` (native only: ${s.native})` : ''}`)
  return [
    lines.join('\n'),
    g.builderOk ? 'Every stage has a builder action.' : `Native only here: ${g.nativeOnly.length} stage${g.nativeOnly.length === 1 ? '' : 's'}.`,
    g.timezone ? `Time zone: ${g.timezone.note}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** A metric step: its pipeline ends in one number or a few grouped numbers (a $group or $count) */
export const producesMetric = (stages: Doc[]) => stages.some((s) => '$group' in s || '$count' in s || '$sortByCount' in s)
