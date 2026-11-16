/**
 * Metabase through the user's own Claude connector (claude.ai's Metabase connector, reached by
 * their `claude -p`), for when there is no Metabase API key. It is the company's production data,
 * so it is read-only by three locks, each enough on its own:
 * 1. --allowedTools names only the read tools below (exact names, never a wildcard), and the
 *    process runs in dontAsk mode, so anything else is refused without asking;
 * 2. --disallowedTools names every write tool the connector is known to have (deny wins);
 * 3. a PreToolUse hook sends every Metabase call to Tide (connectorCallProblem), which refuses a
 *    tool that isn't on the list and SQL that isn't a single SELECT; if Tide doesn't answer, the
 *    hook fails closed.
 */
import { sqlProblem } from './metabase'

/** The connector's tools are named mcp__claude_ai_Metabase__<tool> */
export const CONNECTOR_PREFIX = 'mcp__claude_ai_Metabase__'
/** Its name as `claude mcp get` takes it */
export const CONNECTOR_NAME = 'claude.ai Metabase'

/**
 * The only connector tools a Tide process may call, each checked against its description
 * (Claude Code 2.1.304, Metabase's MCP server): search and read_resource read; construct_query and
 * construct_native_query build a query handle without running or saving it; query, execute_query
 * and execute_question run a query or a saved question and return rows; execute_sql runs SQL
 * (Tide's hook lets only a single SELECT through).
 */
export const CONNECTOR_READ_TOOLS = ['search', 'read_resource', 'construct_query', 'construct_native_query', 'query', 'execute_query', 'execute_question', 'execute_sql'].map((t) => CONNECTOR_PREFIX + t)

/** Its tools that create or change things: never allowed, and refused by name as well */
export const CONNECTOR_WRITE_TOOLS = ['create_collection', 'create_dashboard', 'create_metric', 'create_question', 'update_dashboard', 'update_metric', 'update_question', 'delete_question', 'delete_dashboard', 'delete_collection', 'delete_metric', 'archive_question', 'archive_dashboard'].map((t) => CONNECTOR_PREFIX + t)

/** A tool name that sounds like it changes something */
export const looksLikeWrite = (name: string) => /(^|__|_)(create|update|delete|archive|remove|save|edit|move|set|add|upsert|write|send|publish|copy|duplicate|import|share|subscribe|alert|pin|bookmark|revert|restore|trash)(_|$)/i.test(name.replace(CONNECTOR_PREFIX, ''))

/** Strings in a query object that hold native SQL (an MBQL native stage, or a native query) */
function nativeIn(v: unknown, key = ''): string[] {
  if (typeof v === 'string') return /^(native|query|sql)$/i.test(key) && !/^mbql/.test(v) ? [v] : []
  if (Array.isArray(v)) return v.flatMap((x) => nativeIn(x, key))
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => nativeIn(x, k))
  return []
}

const hasNativeStage = (v: unknown) => /mbql\.stage\/native|"native"\s*:/.test(JSON.stringify(v ?? null))

/**
 * Why Tide refuses this connector call, or null when it may go ahead. The hook asks this for every
 * Metabase call the tutor makes.
 */
export function connectorCallProblem(tool: string, input: unknown): string | null {
  if (!CONNECTOR_READ_TOOLS.includes(tool)) return `${tool.replace(CONNECTOR_PREFIX, '')} isn't one of the read tools Tide allows: Tide only reads from Metabase.`
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const name = tool.slice(CONNECTOR_PREFIX.length)
  if (name === 'execute_sql' || name === 'construct_native_query') return sqlProblem(String(args.sql ?? ''))
  if (name === 'query' || name === 'construct_query' || name === 'execute_query') {
    // An MBQL query can carry a native stage: its SQL is checked like any other
    for (const field of ['query']) {
      const v = args[field]
      if (v === null || v === undefined) continue
      if (typeof v === 'string') {
        let parsed: unknown
        try {
          parsed = JSON.parse(v)
        } catch {
          // A query given as text is SQL
          const p = sqlProblem(v)
          if (p) return p
          continue
        }
        if (hasNativeStage(parsed)) for (const s of nativeIn(parsed)) if (sqlProblem(s)) return sqlProblem(s)
      } else if (hasNativeStage(v)) for (const s of nativeIn(v)) if (sqlProblem(s)) return sqlProblem(s)
    }
  }
  return null
}

/** The hook's answer, as Claude Code reads a PreToolUse hook's JSON output */
export function hookAnswer(problem: string | null): Record<string, unknown> {
  return problem ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: problem } } : {}
}

/** The hook's command: asks Tide's guard, and stops the call when Tide doesn't answer (exit 2 blocks) */
export function guardCommand(port: number, token: string): string {
  if (!Number.isInteger(port) || !/^[\w-]+$/.test(token)) throw new Error('bad guard address')
  return `curl -sf --max-time 10 -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}/guard/metabase || { echo 'Tide could not check this Metabase call, so it was stopped.' >&2; exit 2; }`
}

/** The --settings a connector process starts with: only the hook (no other settings are read) */
export function connectorSettings(guard: string): string {
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'mcp__claude_ai_Metabase__.*', hooks: [{ type: 'command', command: guard, timeout: 15 }] }] } })
}

/**
 * A command line given the connector: Claude Code loads claude.ai's connectors only without
 * --strict-mcp-config (tried against 2.1.304; --setting-sources '' still keeps the user's own MCP
 * servers out), the read tools are added to the allowlist, the writes refused by name, and the
 * guard hook set.
 */
export function withConnector(args: string[], guard: string, /** The user's other claude.ai connectors (connectorsFrom): refused whole, so their hundreds of tools stay out of the lesson */ others: string[] = []): string[] {
  const out = args.filter((a) => a !== '--strict-mcp-config')
  const i = out.indexOf('--allowedTools')
  if (i < 0) out.push('--allowedTools', CONNECTOR_READ_TOOLS.join(','))
  else out[i + 1] = [...out[i + 1].split(',').filter(Boolean), ...CONNECTOR_READ_TOOLS].join(',')
  out.push('--disallowedTools', [...CONNECTOR_WRITE_TOOLS, ...others.map(serverRule).filter((r) => r !== CONNECTOR_PREFIX.slice(0, -2))].join(','), '--settings', connectorSettings(guard))
  // The system prompt stays last, as the caller put it
  const s = out.indexOf('--system-prompt')
  if (s >= 0) out.push(...out.splice(s, 2))
  return out
}

/** A claude.ai connector's whole-server permission rule: "claude.ai Microsoft 365" is mcp__claude_ai_Microsoft_365 */
export const serverRule = (name: string) => `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}`

/** `claude mcp list`'s output, read: the Metabase connector's state, and the user's other claude.ai connectors */
export function connectorsFrom(text: string): { state: 'connected' | 'needs-auth' | 'failed' | 'missing'; others: string[] } {
  const lines = text.split('\n').map((l) => l.match(/^(claude\.ai [^:]+):\s.*?-\s*(.+)$/)).filter((m): m is RegExpMatchArray => !!m)
  const mine = lines.find((m) => m[1] === CONNECTOR_NAME)
  const status = mine?.[2] ?? ''
  const state = !mine ? 'missing' : /connected/i.test(status) && !/fail|not connected/i.test(status) ? 'connected' : /auth/i.test(status) ? 'needs-auth' : 'failed'
  return { state, others: lines.map((m) => m[1]).filter((n) => n !== CONNECTOR_NAME) }
}

/** What the tutor is told about the connector's tools, in a Metabase lesson without a key */
export const CONNECTOR_LESSON_NOTE = `Their Metabase is reached through their Claude connector, read-only. Its tools: mcp__claude_ai_Metabase__search (find tables, questions, dashboards), mcp__claude_ai_Metabase__read_resource (metabase://databases, metabase://database/{id}/tables, metabase://table/{id}/fields, metabase://question/{id}, metabase://dashboard/{id}/items), mcp__claude_ai_Metabase__execute_sql (a single SELECT on a SQL database id), mcp__claude_ai_Metabase__execute_question (a saved question's rows), and mcp__claude_ai_Metabase__query (a query-builder, MBQL, query: the way to read a MongoDB database, since execute_sql can't run a pipeline there). Keep queries small: aggregate or LIMIT. Never try to create, save or change anything in Metabase: those tools are blocked, and the student builds things themselves. Tide's own metabase tool isn't available in this lesson; the "Answer:" check of a Metabase exercise is done by you running both queries, since Tide can't run them itself without a Metabase key.`
