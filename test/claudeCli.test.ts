import { describe, expect, it } from 'vitest'
import { childEnv, claudeArgs, mcpConfig, parseLine, unavailableReason, userLine } from '../src/main/claudeCli'

describe('the Claude child process', () => {
  it('never sees an API key, so the plan is used', () => {
    const env = childEnv({ ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'http://x', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDECODE: '1', HOME: '/Users/me', PATH: '/usr/bin' })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.HOME).toBe('/Users/me')
    expect(env.PATH).toContain('/opt/homebrew/bin')
  })

  it('keeps out the user’s own servers and settings, and allows only Tide’s tools', () => {
    const a = claudeArgs({ model: 'sonnet', system: 'S', mcpConfig: '/tmp/m.json' })
    const after = (flag: string) => a[a.indexOf(flag) + 1]
    expect(a).toContain('--strict-mcp-config')
    expect(a).toContain('--no-session-persistence')
    expect(after('--setting-sources')).toBe('')
    expect(after('--tools')).toBe('')
    expect(after('--permission-mode')).toBe('dontAsk')
    expect(after('--allowedTools')).toBe('mcp__tide')
    expect(after('--input-format')).toBe('stream-json')
    expect(a).not.toContain('--bare')
    expect(a).not.toContain('--dangerously-skip-permissions')
    const web = claudeArgs({ model: 'sonnet', system: 'S', mcpConfig: '/tmp/m.json', builtIn: ['WebSearch', 'WebFetch'] })
    expect(web[web.indexOf('--allowedTools') + 1]).toBe('mcp__tide,WebSearch,WebFetch')
  })

  it('gives the MCP server its token and lesson in headers', () => {
    const c = JSON.parse(mcpConfig(4567, 'tok', 'lab:lesson:1'))
    expect(c.mcpServers.tide).toEqual({ type: 'http', url: 'http://127.0.0.1:4567/mcp', headers: { Authorization: 'Bearer tok', 'X-Tide-Lesson': 'lab:lesson:1' } })
  })

  it('writes messages as stream-json input', () => {
    expect(JSON.parse(userLine('hi'))).toEqual({ type: 'user', message: { role: 'user', content: 'hi' } })
  })

  it('reads recorded output', () => {
    expect(parseLine('{"type":"system","subtype":"init","model":"claude-sonnet-5-5","tools":["mcp__tide__run_code"],"mcp_servers":[{"name":"tide","status":"connected"}]}')).toMatchObject({ type: 'init', model: 'claude-sonnet-5-5' })
    expect(parseLine('{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}}')).toEqual({ type: 'text', text: 'Hi' })
    // A subagent's text isn't the tutor's
    expect(parseLine('{"type":"stream_event","parent_tool_use_id":"x","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}')).toEqual({ type: 'other' })
    expect(parseLine('{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"mcp__tide__run_code","input":{"code":"print(1)"}}]}}')).toMatchObject({ type: 'tool', name: 'mcp__tide__run_code' })
    const r = parseLine('{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{"input_tokens":4,"cache_creation_input_tokens":1172,"cache_read_input_tokens":1077,"output_tokens":68},"total_cost_usd":0.0003,"duration_ms":2700,"ttft_ms":2600,"modelUsage":{"claude-haiku-5-5":{}}}')
    expect(r).toMatchObject({ type: 'result', ok: true, usage: { input: 4, output: 68, cacheRead: 1077, cacheWrite: 1172, costUsd: 0.0003 }, model: 'claude-haiku-5-5', firstTokenMs: 2600 })
    expect(parseLine('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1794963600,"rateLimitType":"seven_day","utilization":0.81}}')).toMatchObject({ type: 'rate-limit', status: 'allowed_warning', utilization: 0.81 })
    expect(parseLine('not json')).toBeNull()
  })

  it('tells a missing login and a limit from other failures', () => {
    expect(unavailableReason('Not logged in · Please run /login')).toBe('login')
    expect(unavailableReason('Claude usage limit reached')).toBe('limit')
    expect(unavailableReason('Syntax error in your code')).toBeNull()
  })
})
