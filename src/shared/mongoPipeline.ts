/**
 * MongoDB aggregation pipelines as a learner writes them, made safe to run through Metabase's
 * native query API: read (`db.payments.aggregate([...])`, a bare `[...]` pipeline, shell syntax with
 * unquoted keys, ISODate() and ObjectId()), refused when a stage writes or runs JavaScript on the
 * server, and capped with a `$limit` so a result is never more than a handful of rows.
 */
import { jsonrepair } from 'jsonrepair'

export interface Pipeline {
  /** The collection, when the text names it (db.<collection>.aggregate) */
  collection?: string
  stages: Record<string, unknown>[]
}

/** Stages that write, or reach outside one read of this collection's documents */
const WRITE_STAGES = new Set(['$out', '$merge', '$currentOp', '$listSessions', '$listLocalSessions', '$planCacheStats', '$changeStream', '$shardedDataDistribution'])
/** Operators that run JavaScript on the server */
const JS_OPERATORS = new Set(['$function', '$accumulator', '$where'])

/** Shell helpers turned into extended JSON, which Metabase's Mongo driver reads */
function shellToJson(src: string): string {
  return src
    .replace(/\b(?:new\s+)?ISODate\(\s*(["'])([^"']*)\1\s*\)/g, (_m, _q, d) => JSON.stringify({ $date: d }))
    .replace(/\bnew\s+Date\(\s*(["'])([^"']*)\1\s*\)/g, (_m, _q, d) => JSON.stringify({ $date: d }))
    .replace(/\bObjectId\(\s*(["'])([0-9a-fA-F]{24})\1\s*\)/g, (_m, _q, id) => JSON.stringify({ $oid: id }))
    .replace(/\bNumber(?:Long|Int|Decimal)\(\s*["']?(-?[\d.]+)["']?\s*\)/g, '$1')
}

/** Comments outside strings, so a // in a URL or a regex string is kept */
function stripComments(src: string): string {
  let out = ''
  let quote = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      out += c
      if (c === '\\') out += src[++i] ?? ''
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      out += c
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 1
    } else out += c
  }
  return out
}

/** The code of a ```mongodb (or js, json) block, or the text itself */
export function pipelineText(text: string): string | null {
  const t = String(text ?? '')
  const blocks = [...t.matchAll(/```(?:mongodb|mongo|js|javascript|json)?[ \t]*\n([\s\S]*?)```/gi)].map((m) => m[1].trim()).filter((b) => /aggregate\s*\(|^\s*\[/.test(stripComments(b)))
  if (blocks.length) return blocks[blocks.length - 1]
  const at = t.search(/db\.[\w$-]+\.aggregate\s*\(|db\.getCollection\(/)
  if (at >= 0) return t.slice(at).trim()
  const s = stripComments(t).trim()
  return s.startsWith('[') || s.startsWith('{') ? s : null
}

/** A pipeline from text, or why it can't be read */
export function parsePipeline(text: string): Pipeline | { error: string } {
  const raw = pipelineText(text)
  if (!raw) return { error: 'Write the pipeline as db.<collection>.aggregate([ … ]) or as a [ … ] list of stages.' }
  let src = stripComments(raw).trim().replace(/;\s*$/, '')
  let collection: string | undefined
  const call = /^db\.(?:getCollection\(\s*["']([^"']+)["']\s*\)|([\w$-]+))\.aggregate\s*\(([\s\S]*)\)\s*(?:\.toArray\(\s*\))?$/.exec(src)
  if (call) {
    collection = call[1] ?? call[2]
    src = call[3].trim()
    // aggregate(pipeline, options): the options are dropped
    const end = matchingBracket(src)
    if (end > 0) src = src.slice(0, end + 1)
  }
  if (!src.startsWith('[')) return { error: 'A pipeline is a list of stages in square brackets: [ { $match: … }, { $group: … } ].' }
  let stages: unknown
  try {
    stages = JSON.parse(shellToJson(src))
  } catch {
    try {
      stages = JSON.parse(jsonrepair(shellToJson(src)))
    } catch (e) {
      return { error: `The pipeline isn't valid: ${(e as Error).message.slice(0, 160)}` }
    }
  }
  if (!Array.isArray(stages)) return { error: 'A pipeline is a list of stages.' }
  for (const [i, s] of stages.entries()) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: `Stage ${i + 1} isn't a { $stage: … } object.` }
    const keys = Object.keys(s)
    if (keys.length !== 1 || !keys[0].startsWith('$')) return { error: `Stage ${i + 1} should have exactly one $ key (like { $match: … }), it has ${keys.join(', ') || 'none'}.` }
  }
  return { ...(collection ? { collection } : {}), stages: stages as Record<string, unknown>[] }
}

function matchingBracket(s: string): number {
  let depth = 0
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Why this pipeline can't run (it writes, or runs JavaScript on the server), or null */
export function pipelineProblem(p: Pipeline): string | null {
  if (!p.stages.length) return 'The pipeline has no stages.'
  const seen = (v: unknown): string | null => {
    if (Array.isArray(v)) {
      for (const x of v) {
        const r = seen(x)
        if (r) return r
      }
      return null
    }
    if (!v || typeof v !== 'object') return null
    for (const [k, x] of Object.entries(v)) {
      if (WRITE_STAGES.has(k)) return `${k} writes or reads outside this collection: Tide only reads Metabase, it never changes it.`
      if (JS_OPERATORS.has(k)) return `${k} runs JavaScript on the database server, which Tide doesn't allow.`
      const r = seen(x)
      if (r) return r
    }
    return null
  }
  return seen(p.stages)
}

/**
 * The stages as they are sent: a final `$limit` of at most `max` rows, kept below any the learner
 * wrote. `$facet` returns one document, so it never needs more.
 */
export function limited(stages: Record<string, unknown>[], max: number): Record<string, unknown>[] {
  const last = stages[stages.length - 1]
  const own = last && typeof last.$limit === 'number' ? last.$limit : null
  if (own !== null && own <= max) return stages
  return [...(own !== null ? stages.slice(0, -1) : stages), { $limit: own !== null ? Math.min(own, max) : max }]
}

/** The pipeline as a learner reads it: one stage a line */
export function showPipeline(collection: string | undefined, stages: Record<string, unknown>[]): string {
  const body = stages.map((s) => `  ${JSON.stringify(s)}`).join(',\n')
  return collection ? `db.${collection}.aggregate([\n${body}\n])` : `[\n${body}\n]`
}
