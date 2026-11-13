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
const saved: { path: string; md: string }[] = []
vi.mock('../src/main/study', () => ({ saveCards: async (path: string, md: string) => (saved.push({ path, md }), path.replace(/\.md$/, ' (Flashcards).md')) }))
vi.mock('../src/main/search', () => ({
  reindexPath: async () => {},
  indexReady: async () => {},
  search: async (_q: string, _n: number, filter?: (p: string) => boolean) => [{ path: 'Library/Videos/Talk.md', title: 'Talk', heading: 'Transcript', text: 'raft leader election' }, { path: 'Python/x.md', title: 'x', heading: '', text: 'raft' }].filter((h) => !filter || filter(h.path))
}))
let settings: { libraryFolder: string; ai: { claude?: { terminalPort?: number } } } = { libraryFolder: 'Library', ai: {} }
vi.mock('../src/main/settings', () => ({ getSettings: () => settings, updateSettings: (p: typeof settings) => (settings = { ...settings, ...p }) }))
const keys = new Map<string, string>()
vi.mock('../src/main/cloud', () => ({ getKey: (k: string) => keys.get(k), setKey: (k: string, v: string) => keys.set(k, v) }))
vi.mock('../src/main/claudeEngine', () => ({ stopClaude: () => {} }))
const kept: unknown[] = []
vi.mock('../src/main/recall', () => ({
  keepForRecall: async (items: unknown[]) => void kept.push(...items),
  recallItems: () => [{ id: '1', prompt: 'What does activate change?', topic: 'Python venv', due: 0 }, { id: '2', prompt: 'Later one', topic: 'Rust', due: Date.now() + 86_400_000 }]
}))
vi.mock('../src/main/courses', () => ({
  searchCourses: async () => [{ course: 'pyds', path: 'notebooks/01.md', title: 'Intro', heading: 'Lists', text: 'list comprehension', score: 1 }],
  courseFile: async (c: string, p: string) => (c === 'pyds' && p === 'notebooks/01.md' ? '# Intro\nfull text' : null)
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
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['run_code', 'search_notes', 'learner_profile', 'past_lessons', 'earlier_concepts', 'record_answer']))
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

  it('makes flashcards, keeps recall questions, and finds courses and transcripts', async () => {
    const c = await connect(h.token, '')
    const text = async (name: string, args: Record<string, unknown>) => ((await c.callTool({ name, arguments: args })).content as { text: string }[])[0].text
    expect(await text('make_flashcards', { topic: 'Python venv', cards: [{ front: 'What does activate change?', back: 'Only PATH' }] })).toMatch(/Saved 1 card to Flashcards\/Python venv \(Flashcards\)\.md/)
    expect(saved[0].md).toBe('What does activate change?::Only PATH')
    expect(await text('make_flashcards', { topic: 'x', cards: [{ front: 'a', back: 'b' }], note: 'Secret/plan.md' })).toMatch(/Saved 1 card to Secret\/plan/)
    expect(await text('schedule_recall', { topic: 'Python venv', questions: ['Q1 (A1)'] })).toBe('Kept 1 for recall on Python venv.')
    expect(kept[0]).toMatchObject({ prompt: 'Q1 (A1)', topic: 'Python venv' })
    expect(await text('recall_due', { topic: 'python' })).toBe('- [due] (Python venv) What does activate change?')
    expect(await text('search_courses', { query: 'comprehension' })).toContain('(course: pyds, path: notebooks/01.md)')
    expect(await text('read_course', { course: 'pyds', path: 'notebooks/01.md' })).toBe('# Intro\nfull text')
    const t = await text('search_transcripts', { query: 'raft' })
    expect(t).toContain('Library/Videos/Talk.md')
    expect(t).not.toContain('Python/x.md')
    await c.close()
  })

  it('registers Tide with Claude Code for the terminal on a fixed port, and takes it away', async () => {
    const ran: string[][] = []
    const run = async (args: string[]) => (ran.push(args), args[1] === 'add' ? `Added HTTP MCP server tide with ${args.at(-1)}` : '')
    const r = await mcp.setTerminal(true, run)
    expect(r).toMatchObject({ on: true, port: mcp.TERMINAL_PORT })
    expect(r.output).not.toMatch(/Bearer [\w-]{10}/)
    const add = ran.find((a) => a[1] === 'add')!
    expect(add.slice(0, 8)).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'tide', `http://127.0.0.1:${mcp.TERMINAL_PORT}/mcp`])
    const token = add.at(-1)!.replace('Authorization: Bearer ', '')
    expect(token).toBe(keys.get('claude-terminal'))
    // The server now answers on the fixed port, with the lasting token
    const now = await mcp.ensureMcp()
    expect(now.port).toBe(mcp.TERMINAL_PORT)
    const client = new Client({ name: 'terminal', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcp.TERMINAL_PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    expect((await client.listTools()).tools.length).toBeGreaterThan(5)
    await client.close()
    const off = await mcp.setTerminal(false, run)
    expect(off.on).toBe(false)
    expect(ran.at(-1)).toEqual(['mcp', 'remove', '--scope', 'user', 'tide'])
    expect(settings.ai.claude?.terminalPort).toBeUndefined()
  })
})
