import { afterAll, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
const ran: { name: string; args: unknown; lab?: string }[] = []
vi.mock('../src/main/agent', () => ({
  MCP_TUTOR_TOOLS: [
    { type: 'function', function: { name: 'run_code', description: 'Run code', parameters: { type: 'object', properties: { language: { type: 'string' }, code: { type: 'string' } }, required: ['language', 'code'] } } },
    { type: 'function', function: { name: 'search_notes', description: 'Search notes', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }
  ],
  runTideTool: async (name: string, args: unknown, ctx: { labId?: string; step(s: unknown): string }) => {
    ran.push({ name, args, lab: ctx.labId })
    ctx.step({ kind: 'run_code', label: `ran ${name}`, status: 'done', depth: 0 })
    return name === 'run_code' ? 'stdout:\n42' : 'No matching passages in the notes.'
  }
}))
const knowledge: unknown[] = []
vi.mock('../src/main/knowledge', () => ({ noteEvidence: async (e: unknown) => void knowledge.push(e) }))

const mcp = await import('../src/main/tideMcp')
const h = await mcp.startMcp()
afterAll(() => h.close())

const connect = async (token = h.token, lesson = 'lab:lesson:1') => {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-Tide-Lesson': lesson } } }))
  return client
}

describe("Tide's MCP server", () => {
  it('listens on loopback only and refuses calls without the launch token', async () => {
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect((await fetch(h.url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(401)
    expect((await fetch(h.url, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer wrong', 'content-type': 'application/json' } })).status).toBe(401)
    // A web page in a browser sends an Origin: refused, token or not
    expect((await fetch(h.url, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${h.token}`, Origin: 'https://evil.example', 'content-type': 'application/json' } })).status).toBe(403)
    await expect(connect('nope')).rejects.toThrow()
  })

  it("serves Tide's own tools, with their schemas", async () => {
    const c = await connect()
    const { tools } = await c.listTools()
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['run_code', 'search_notes', 'learner_profile', 'past_lessons', 'record_answer']))
    expect(tools.find((t) => t.name === 'run_code')?.inputSchema.required).toEqual(['language', 'code'])
    await c.close()
  })

  it("runs a tool with the lesson's context, so its steps show in that lesson", async () => {
    const shown: unknown[] = []
    mcp.bindLesson('lab:lesson:1', { signal: new AbortController().signal, sources: [], emitSources: () => {}, step: (s) => (shown.push(s), 'x'), updateStep: () => {}, web: false, labId: 'lesson:1' })
    const c = await connect()
    const r = await c.callTool({ name: 'run_code', arguments: { language: 'python', code: 'print(6*7)' } })
    expect(r.content).toEqual([{ type: 'text', text: 'stdout:\n42' }])
    expect(ran.at(-1)).toEqual({ name: 'run_code', args: { language: 'python', code: 'print(6*7)' }, lab: 'lesson:1' })
    expect(shown).toHaveLength(1)
    mcp.unbindLesson('lab:lesson:1')
    await c.close()
  })

  it('records a marked answer in What you know', async () => {
    const c = await connect('', '')
      .catch(() => null)
    expect(c).toBeNull()
    const ok = await connect(h.token, '')
    const r = await ok.callTool({ name: 'record_answer', arguments: { topic: 'Python loops', verdict: 'partial' } })
    expect((r.content as { text: string }[])[0].text).toBe('Recorded: partial on Python loops.')
    expect(knowledge[0]).toMatchObject({ topic: 'Python loops', kind: 'partly' })
    const bad = await ok.callTool({ name: 'record_answer', arguments: { topic: 'x', verdict: 'great' } })
    expect((bad.content as { text: string }[])[0].text).toMatch(/correct, partial or wrong/)
    await ok.close()
  })
})
