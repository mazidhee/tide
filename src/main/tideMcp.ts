/**
 * Tide's MCP server: Tide's own tools (search and read notes, run code and SQL, the learner's
 * profile, plan and past lessons, recording a marked answer) served to Claude over Streamable HTTP
 * on 127.0.0.1. Every request needs this launch's bearer token. The tools are the tutor's existing
 * handlers (main/agent runTideTool), not copies of them. A Claude process started for a lesson
 * sends its lesson's key in a header, so the steps its tool calls make show in that lesson.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import type { AddressInfo } from 'net'
import type { ToolContext } from './agent'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Runs the tool; the context is the lesson's when the caller is a lesson's process */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

/** Where a lesson's tool calls report: set for each turn by main/claudeEngine */
const bindings = new Map<string, ToolContext>()
export const bindLesson = (key: string, ctx: ToolContext) => bindings.set(key, ctx)
export const unbindLesson = (key: string) => bindings.delete(key)

/** A context for a call no lesson is waiting on (Claude Code in a terminal): its steps go nowhere */
function looseContext(key: string): ToolContext {
  let n = 0
  return { signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => `x${++n}`, updateStep: () => {}, web: false, labId: key ? `claude:${key}` : 'claude', chatId: undefined }
}

let tools: McpTool[] | null = null
async function allTools(): Promise<McpTool[]> {
  if (tools) return tools
  const agent = await import('./agent')
  const wrapped: McpTool[] = agent.MCP_TUTOR_TOOLS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
    run: (args, ctx) => agent.runTideTool(t.function.name, args, ctx)
  }))
  tools = [...wrapped, ...(await import('./tideMcpTools')).EXTRA_TOOLS, ...(await import('./exercises')).EXERCISE_TOOLS]
  return tools
}

export interface McpHandle {
  port: number
  token: string
  url: string
  close(): Promise<void>
}

let handle: McpHandle | null = null

const sameToken = (given: string | undefined, token: string) => {
  const a = Buffer.from(given ?? '')
  const b = Buffer.from(`Bearer ${token}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Starts the server once per launch on a random port (or `port`, when the user turned on a fixed
 * one for Claude Code in the terminal). The token is new each launch and lives only in memory.
 */
export async function startMcp(port = 0, token = randomBytes(24).toString('base64url')): Promise<McpHandle> {
  if (handle) return handle
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js')
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')

  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    // Loopback only, by name too: a web page can't reach it through DNS rebinding
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '')
    if (!['127.0.0.1', 'localhost'].includes(host) || req.headers.origin) {
      res.writeHead(403).end()
      return
    }
    if (!sameToken(req.headers.authorization, token)) {
      res.writeHead(401).end()
      return
    }
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end()
      return
    }
    const lesson = String(req.headers['x-tide-lesson'] ?? '')
    const server = new Server({ name: 'tide', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: 'Tide is the learner’s study app. Its tools search and read their notes, run code and SQL in its sandbox, and read and record what they know.' })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await allTools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema: inputSchema as { type: 'object' } })) }))
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      const t = (await allTools()).find((x) => x.name === r.params.name)
      if (!t) return { content: [{ type: 'text', text: `No tool called ${r.params.name}.` }], isError: true }
      try {
        const text = await t.run((r.params.arguments ?? {}) as Record<string, unknown>, bindings.get(lesson) ?? looseContext(lesson))
        return { content: [{ type: 'text', text }] }
      } catch (e) {
        return { content: [{ type: 'text', text: `The tool failed: ${(e as Error).message}` }], isError: true }
      }
    })
    // Stateless: a server and transport per request
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  }

  const http: HttpServer = createServer((req, res) => {
    serve(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(port, '127.0.0.1', () => resolve())
  })
  const actual = (http.address() as AddressInfo).port
  handle = {
    port: actual,
    token,
    url: `http://127.0.0.1:${actual}/mcp`,
    close: () =>
      new Promise<void>((r) => {
        http.close(() => r())
        http.closeAllConnections?.()
        handle = null
      })
  }
  return handle
}

export const mcpHandle = () => handle

// ---------- Claude Code in a terminal ----------

/** The port Tide's MCP server keeps when Claude Code in a terminal is set up to use it (opt-in) */
export const TERMINAL_PORT = 47615
const TOKEN_KEY = 'claude-terminal'

/** A token that outlives a launch, for the terminal's registration; kept in the Keychain like other keys */
async function terminalToken(): Promise<string> {
  const { getKey, setKey } = await import('./cloud')
  let t = getKey(TOKEN_KEY)
  if (!t) {
    t = randomBytes(24).toString('base64url')
    setKey(TOKEN_KEY, t)
  }
  return t
}

/** The server as the settings want it: the fixed port and lasting token when the terminal is set up, else a random port and a token for this launch */
export async function ensureMcp(): Promise<McpHandle> {
  if (handle) return handle
  const { getSettings } = await import('./settings')
  const port = getSettings().ai.claude?.terminalPort
  return port ? startMcp(port, await terminalToken()) : startMcp()
}

/** The command that registers Tide's server with Claude Code for the user's terminal */
export const mcpAddArgs = (port: number, token: string) => ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'tide', `http://127.0.0.1:${port}/mcp`, '--header', `Authorization: Bearer ${token}`]

/**
 * Sets up (or takes away) Tide's tools for Claude Code in a terminal: a fixed port and a lasting
 * token, and `claude mcp add --scope user … tide` run with the user's own Claude Code. The tools
 * work while Tide is open.
 */
export async function setTerminal(on: boolean, run: (args: string[]) => Promise<string>): Promise<{ on: boolean; port?: number; output: string }> {
  const { getSettings, updateSettings } = await import('./settings')
  const ai = getSettings().ai
  await run(['mcp', 'remove', '--scope', 'user', 'tide']).catch(() => '')
  // The server moves (to the fixed port, or back to a random one): lessons' processes start again
  // on it, from their transcript
  const { stopClaude } = await import('./claudeEngine')
  if (!on) {
    updateSettings({ ai: { ...ai, claude: { ...ai.claude, terminalPort: undefined } } })
    stopClaude()
    await handle?.close()
    return { on: false, output: 'Removed Tide from Claude Code.' }
  }
  const port = ai.claude?.terminalPort ?? TERMINAL_PORT
  updateSettings({ ai: { ...ai, claude: { ...ai.claude, terminalPort: port } } })
  stopClaude()
  if (handle && handle.port !== port) await handle.close()
  await ensureMcp()
  const output = await run(mcpAddArgs(port, await terminalToken()))
  return { on: true, port, output: output.replace(/Bearer [\w-]+/g, 'Bearer …') }
}
