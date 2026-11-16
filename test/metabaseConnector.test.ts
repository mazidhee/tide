import { describe, expect, it } from 'vitest'
import { claudeArgs } from '../src/main/claudeCli'
import { CONNECTOR_PREFIX, CONNECTOR_READ_TOOLS, CONNECTOR_WRITE_TOOLS, connectorCallProblem, connectorSettings, connectorsFrom, guardCommand, serverRule, hookAnswer, looksLikeWrite, withConnector } from '../src/shared/metabaseConnector'
import { knownDataForTutor, KNOWN_DATA_NOTE } from '../src/shared/metabaseData'
import { toolPacks } from '../src/shared/tutorGuide'

const guard = guardCommand(4321, 'tok_en-1')
const base = claudeArgs({ model: 'haiku', system: 'SYS', mcpConfig: '/tmp/mcp.json' })
const flag = (args: string[], f: string) => args[args.indexOf(f) + 1]

describe('the connector allowlist', () => {
  it('names exact read tools only: no wildcard, no write', () => {
    expect(CONNECTOR_READ_TOOLS).toEqual([
      'mcp__claude_ai_Metabase__search',
      'mcp__claude_ai_Metabase__read_resource',
      'mcp__claude_ai_Metabase__construct_query',
      'mcp__claude_ai_Metabase__construct_native_query',
      'mcp__claude_ai_Metabase__query',
      'mcp__claude_ai_Metabase__execute_query',
      'mcp__claude_ai_Metabase__execute_question',
      'mcp__claude_ai_Metabase__execute_sql'
    ])
    for (const t of CONNECTOR_READ_TOOLS) {
      expect(t).toMatch(/^mcp__claude_ai_Metabase__[a-z_]+$/)
      expect(looksLikeWrite(t)).toBe(false)
      expect(CONNECTOR_WRITE_TOOLS).not.toContain(t)
    }
  })
  it('never lets a write tool through, by any of the three locks', () => {
    for (const t of [...CONNECTOR_WRITE_TOOLS, `${CONNECTOR_PREFIX}create_card`, `${CONNECTOR_PREFIX}delete_everything`, `${CONNECTOR_PREFIX}visualize_query`]) {
      expect(CONNECTOR_READ_TOOLS).not.toContain(t)
      expect(connectorCallProblem(t, {})).toMatch(/only reads/)
    }
    for (const t of CONNECTOR_WRITE_TOOLS) expect(looksLikeWrite(t)).toBe(true)
  })
  it('refuses other connectors and Tide-looking names', () => {
    expect(connectorCallProblem('mcp__claude_ai_Gmail__send_message', {})).toBeTruthy()
    expect(connectorCallProblem('mcp__claude_ai_Metabase__search_and_delete', {})).toBeTruthy()
  })
})

describe('the guard', () => {
  it('lets reads through', () => {
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}search`, { term_queries: ['orders'], semantic_queries: null })).toBeNull()
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}execute_sql`, { database_id: 2, sql: 'SELECT count(*) FROM orders LIMIT 5' })).toBeNull()
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}execute_question`, { id: 12 })).toBeNull()
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}query`, { query: { 'lib/type': 'mbql/query', stages: [{ 'lib/type': 'mbql.stage/mbql', 'source-table': ['db', null, 'orders', 'id'] }] }, query_handle: null, continuation_token: null })).toBeNull()
  })
  it('refuses SQL that writes, wherever it hides', () => {
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}execute_sql`, { database_id: 2, sql: 'DELETE FROM orders' })).toMatch(/SELECT/)
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}execute_sql`, { database_id: 2, sql: 'WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x' })).toBeTruthy()
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}execute_sql`, { database_id: 2, sql: 'select 1; drop table t' })).toBeTruthy()
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}construct_native_query`, { database_id: 2, sql: 'UPDATE users SET x = 1' })).toBeTruthy()
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}query`, { query: { stages: [{ 'lib/type': 'mbql.stage/native', native: 'TRUNCATE orders' }] } })).toBeTruthy()
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}execute_query`, { query: 'insert into t values (1)', query_handle: null })).toBeTruthy()
    expect(connectorCallProblem(`${CONNECTOR_PREFIX}execute_sql`, {})).toBeTruthy()
  })
  it('answers as a PreToolUse hook: deny with a reason, else nothing (never an allow that skips the allowlist)', () => {
    expect(hookAnswer('no')).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } })
    expect(hookAnswer(null)).toEqual({})
  })
  it('fails closed when Tide does not answer', () => {
    expect(guard).toContain('http://127.0.0.1:4321/guard/metabase')
    expect(guard).toMatch(/\|\| \{ .*exit 2; \}$/)
    expect(() => guardCommand(1, "x'; rm -rf ~")).toThrow()
  })
})

describe('the command line', () => {
  const args = withConnector(base, guard)
  it('drops --strict-mcp-config (else claude.ai connectors never load) but keeps other settings out', () => {
    expect(base).toContain('--strict-mcp-config')
    expect(args).not.toContain('--strict-mcp-config')
    expect(flag(args, '--setting-sources')).toBe('')
    expect(flag(args, '--permission-mode')).toBe('dontAsk')
    expect(flag(args, '--mcp-config')).toBe('/tmp/mcp.json')
  })
  it('allows Tide and the read tools only, by exact name', () => {
    const allowed = flag(args, '--allowedTools').split(',')
    expect(allowed).toEqual(['mcp__tide', ...CONNECTOR_READ_TOOLS])
    expect(allowed.some((t) => t.includes('*') || t === 'mcp__claude_ai_Metabase' || looksLikeWrite(t))).toBe(false)
  })
  it('refuses the writes by name and sets the guard hook on every Metabase tool', () => {
    expect(flag(args, '--disallowedTools').split(',')).toEqual(CONNECTOR_WRITE_TOOLS)
    const settings = JSON.parse(flag(args, '--settings'))
    expect(settings).toEqual(JSON.parse(connectorSettings(guard)))
    expect(settings.hooks.PreToolUse[0].matcher).toBe('mcp__claude_ai_Metabase__.*')
    expect(Object.keys(settings)).toEqual(['hooks'])
  })
  it('keeps the system prompt last and is the same command line otherwise', () => {
    expect(args.slice(-2)).toEqual(['--system-prompt', 'SYS'])
    expect(claudeArgs({ model: 'haiku', system: 'SYS', mcpConfig: '/tmp/mcp.json', connector: guard })).toEqual(args)
  })
  it('leaves every other lesson exactly as it was', () => {
    expect(claudeArgs({ model: 'haiku', system: 'SYS', mcpConfig: '/tmp/mcp.json' })).toEqual(base)
    expect(base.join(' ')).not.toContain('claude_ai')
  })
})

describe('around it', () => {
  const list = 'Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\nclaude.ai Metabase: https://analytics.example.com/api/metabase-mcp - ✔ Connected\nclaude.ai Microsoft 365: https://m.example/mcp - ✔ Connected\nclaude.ai Sentry: https://mcp.sentry.dev/mcp - ! Needs authentication\npycharm: http://127.0.0.1:1/stream (HTTP) - ✔ Connected\n'
  it('reads claude mcp list', () => {
    expect(connectorsFrom(list)).toEqual({ state: 'connected', others: ['claude.ai Gmail', 'claude.ai Microsoft 365', 'claude.ai Sentry'] })
    expect(connectorsFrom(list.replace('metabase-mcp - ✔ Connected', 'metabase-mcp - ! Needs authentication')).state).toBe('needs-auth')
    expect(connectorsFrom('claude.ai Gmail: x - ✔ Connected').state).toBe('missing')
    expect(connectorsFrom('claude.ai Metabase: x - ✘ Failed to connect').state).toBe('failed')
  })
  it('refuses the other connectors whole, never Metabase', () => {
    expect(serverRule('claude.ai Microsoft 365')).toBe('mcp__claude_ai_Microsoft_365')
    const denied = flag(withConnector(base, guard, [...connectorsFrom(list).others, 'claude.ai Metabase']), '--disallowedTools').split(',')
    expect(denied).toContain('mcp__claude_ai_Gmail')
    expect(denied).toContain('mcp__claude_ai_Microsoft_365')
    expect(denied).not.toContain('mcp__claude_ai_Metabase')
    for (const t of CONNECTOR_READ_TOOLS) expect(denied).not.toContain(t)
  })
  it('a connector lesson does not get Tide’s REST metabase tool', () => {
    expect(toolPacks({ kind: 'lesson', metabase: false, metabaseVia: 'connector', data: true })).not.toContain('metabase')
    expect(toolPacks({ kind: 'lesson', metabase: true, metabaseVia: 'key' })).toContain('metabase')
  })
  it('reads the known-data note without its front matter', () => {
    expect(knownDataForTutor('---\ntags: x\n---\n# Tables\n- orders')).toContain('# Tables\n- orders')
    expect(knownDataForTutor('---\ntags: x\n---\n')).toBe('')
    expect(knownDataForTutor('a'.repeat(100), 10)).toContain(KNOWN_DATA_NOTE)
  })
})
