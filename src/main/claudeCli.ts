/**
 * The user's own Claude Code, run unmodified as a child process (`claude -p`). Tide never reads,
 * copies or stores its login: it only spawns the command, with any API key taken out of the
 * child's environment so the user's plan is used, not a key. Pure helpers here (the arguments,
 * the environment, reading the output); the processes themselves are in main/claudeEngine.
 */
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ClaudeModel } from '@shared/types'
import { windowsFromEvent, type WindowReading } from '@shared/usage'

/** Variables that would make the CLI bill an API key or another provider instead of the user's plan */
export const STRIPPED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_MODEL']

const PATHS = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'

/** The child's environment: the parent's, without any key, and with a PATH that finds the usual tools */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  for (const k of STRIPPED_ENV) delete out[k]
  // Electron started from the Dock has a short PATH
  out.PATH = [env.PATH, PATHS].filter(Boolean).join(':')
  // Not a nested session of a Claude Code that launched Tide (dev): a fresh one
  delete out.CLAUDECODE
  delete out.CLAUDE_CODE_ENTRYPOINT
  return out
}

/** Where the claude command is: the setting, then the usual install places */
export function findClaude(configured?: string): string | null {
  const home = homedir()
  const candidates = [configured, '/opt/homebrew/bin/claude', join(home, '.local/bin/claude'), join(home, '.claude/local/claude'), '/usr/local/bin/claude', join(home, '.npm-global/bin/claude')].filter(Boolean) as string[]
  return candidates.find((p) => existsSync(p)) ?? null
}

export interface ClaudeArgs {
  model: ClaudeModel | string
  system: string
  mcpConfig: string
  /** Built-in tools Claude may use as well as Tide's (WebSearch, WebFetch), only for lessons that aren't private */
  builtIn?: string[]
}

/**
 * The command line: streaming in and out, the user's other MCP servers and settings kept out
 * (they added 74k tokens a call), no session written to disk, no built-in tools but the ones
 * named, and only Tide's tools allowed: anything else is refused without asking.
 */
export function claudeArgs(o: ClaudeArgs): string[] {
  const builtIn = o.builtIn ?? []
  return [
    '-p',
    '--model', o.model,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--tools', builtIn.join(','),
    '--strict-mcp-config',
    '--mcp-config', o.mcpConfig,
    '--setting-sources', '',
    '--no-session-persistence',
    '--permission-mode', 'dontAsk',
    '--allowedTools', ['mcp__tide', ...builtIn].join(','),
    '--system-prompt', o.system
  ]
}

/** The MCP config for one process: Tide's server, with this launch's token and the lesson it serves */
export function mcpConfig(port: number, token: string, lesson: string): string {
  return JSON.stringify({ mcpServers: { tide: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}`, 'X-Tide-Lesson': lesson } } } })
}

/** One user message, as stream-json input takes it */
export function userLine(content: string | unknown[]): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
}

/** A picture ready to send (main/imagePrep) */
export interface ImageInput {
  mediaType: string
  data: string
}

/**
 * A message's content: the text alone, or with pictures as base64 image blocks (the shape the
 * CLI's stream-json input takes, tried against the real `claude -p`). The pictures go first and
 * the words after, as Anthropic advises, so the question is read with the pictures in view.
 */
export function userContent(text: string, images: ImageInput[] = []): string | unknown[] {
  if (!images.length) return text
  return [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })), { type: 'text', text }]
}

/** A one-shot call's command line: stream-json in and out when its message carries pictures, plain JSON out otherwise */
export function onceArgs(model: string, system: string, withImages: boolean): string[] {
  const io = withImages ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']
  return ['-p', '--model', model, ...io, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk', '--system-prompt', system]
}

export interface ClaudeUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  /** Of the output, tokens spent thinking */
  thinking?: number
}

/** What one line of stream-json output means for a turn */
export type ClaudeEvent =
  | { type: 'init'; model: string; tools: string[]; mcp: { name: string; status: string }[] }
  | { type: 'text'; text: string }
  | { type: 'message-start' }
  /** The model is thinking before it writes (its thoughts aren't shown) */
  | { type: 'thinking' }
  | { type: 'tool'; id: string; name: string; input: unknown }
  /** `windows`: every window the event reports (Claude Code 2.1.304 puts the utilization there, under unifiedWindows) */
  | { type: 'rate-limit'; status: string; resetsAt?: number; utilization?: number; window?: string; windows: WindowReading[] }
  | { type: 'result'; ok: boolean; text: string; error?: string; usage: ClaudeUsage; ms: number; firstTokenMs?: number; model?: string }
  | { type: 'other' }

export function parseLine(line: string): ClaudeEvent | null {
  let j: Record<string, any>
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  if (j.type === 'stream_event') {
    const e = j.event ?? {}
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && !j.parent_tool_use_id) return { type: 'text', text: String(e.delta.text ?? '') }
    if (e.type === 'message_start' && !j.parent_tool_use_id) return { type: 'message-start' }
    if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta' && !j.parent_tool_use_id) return { type: 'thinking' }
    return { type: 'other' }
  }
  if (j.type === 'system' && j.subtype === 'init') return { type: 'init', model: String(j.model ?? ''), tools: j.tools ?? [], mcp: j.mcp_servers ?? [] }
  if (j.type === 'assistant') {
    const tool = (j.message?.content ?? []).find((c: { type: string }) => c.type === 'tool_use')
    if (tool) return { type: 'tool', id: tool.id, name: tool.name, input: tool.input }
    return { type: 'other' }
  }
  if (j.type === 'rate_limit_event') {
    const r = j.rate_limit_info ?? {}
    const windows = windowsFromEvent(r)
    const own = windows.find((w) => w.window === r.rateLimitType)
    return { type: 'rate-limit', status: String(r.status ?? ''), resetsAt: r.resetsAt, utilization: r.utilization ?? own?.utilization, window: r.rateLimitType, windows }
  }
  if (j.type === 'result') {
    const u = j.usage ?? {}
    const models = Object.keys(j.modelUsage ?? {})
    return {
      type: 'result',
      ok: j.subtype === 'success' && !j.is_error,
      text: String(j.result ?? ''),
      error: j.subtype !== 'success' || j.is_error ? String(j.result || (j.errors ?? []).join('; ') || j.subtype || 'Claude stopped') : undefined,
      usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, costUsd: j.total_cost_usd ?? 0, ...(u.output_tokens_details?.thinking_tokens ? { thinking: u.output_tokens_details.thinking_tokens } : {}) },
      ms: j.duration_ms ?? 0,
      firstTokenMs: j.ttft_ms,
      // modelUsage adds up the whole process, every model it has used: the caller knows which one this turn ran on
      model: models.length === 1 ? models[0] : undefined
    }
  }
  return { type: 'other' }
}

/** Errors that mean "use Gemma for now": not installed, not logged in, out of plan */
export function unavailableReason(text: string): 'login' | 'limit' | 'network' | null {
  if (/not logged in|please run \/login|invalid api key|authentication|unauthori[sz]ed|oauth/i.test(text)) return 'login'
  if (/usage limit|rate limit|limit reached|out of (extra )?usage|429|overloaded/i.test(text)) return 'limit'
  // No connection to Claude: Gemma takes the turn as it does at a limit (main/modelIdle)
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network error|fetch failed|unable to connect|connection error|request timed out/i.test(text)) return 'network'
  return null
}

/** A reason as the few words a step shows */
export const unavailableText = (why: 'login' | 'limit' | 'network') => (why === 'login' ? 'not logged in' : why === 'network' ? 'offline: no connection to Claude' : 'at your plan’s limit')

export interface ClaudeStatus {
  installed: boolean
  path?: string
  version?: string
  loggedIn: boolean
  /** claude.ai (a plan) or a key; Tide only uses a plan */
  authMethod?: string
  /** pro, max…: the plan's kind as the CLI reports it */
  plan?: string
  checkedAt: number
  error?: string
}

const run = (cmd: string, args: string[], ms: number) =>
  new Promise<string>((resolve, reject) => execFile(cmd, args, { env: childEnv(), timeout: ms, cwd: homedir() }, (err, out) => (err ? reject(err) : resolve(String(out)))))

/** Is Claude Code here and logged in to a plan? Asks the CLI (`claude auth status`), never its files */
export async function checkClaude(configured?: string): Promise<ClaudeStatus> {
  const path = findClaude(configured)
  const at = Date.now()
  if (!path) return { installed: false, loggedIn: false, checkedAt: at }
  try {
    const [version, auth] = await Promise.all([run(path, ['--version'], 10_000).catch(() => ''), run(path, ['auth', 'status'], 15_000)])
    const j = JSON.parse(auth.slice(auth.indexOf('{'))) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string }
    // Only a plan login counts: with an API key the CLI would bill it
    const plan = j.authMethod === 'claude.ai'
    return { installed: true, path, version: version.split(/\s/)[0] || undefined, loggedIn: !!j.loggedIn && plan, authMethod: j.authMethod, plan: j.subscriptionType, checkedAt: at, ...(j.loggedIn && !plan ? { error: 'Logged in with an API key, not a plan' } : {}) }
  } catch (e) {
    return { installed: true, path, loggedIn: false, checkedAt: at, error: (e as Error).message.slice(0, 200) }
  }
}
