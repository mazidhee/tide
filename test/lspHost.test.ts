import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => '/tmp/tide-test', isPackaged: false }, ipcMain: { on: vi.fn(), handle: vi.fn() } }))

import { encodeMessage, LanguageServerHost, MessageReader, SERVER_GONE, type Message } from '../src/main/lspHost'
import { configurationFor, folderPaths, initializeParams } from '../src/main/pythonLanguageServer'

describe('LSP framing', () => {
  it('reads messages split anywhere, several to a chunk, and multi-byte text', () => {
    const a = encodeMessage({ id: 1, result: 'héllo → wörld' })
    const b = encodeMessage({ method: 'x', params: { n: 2 } })
    const all = Buffer.concat([a, b])
    const r = new MessageReader()
    const got: Message[] = []
    // One byte at a time, which also splits the UTF-8 characters
    for (let i = 0; i < all.length; i++) got.push(...r.push(all.subarray(i, i + 1)))
    expect(got).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'héllo → wörld' },
      { jsonrpc: '2.0', method: 'x', params: { n: 2 } }
    ])
    expect(new MessageReader().push(all)).toHaveLength(2)
  })

  it('counts the length in bytes, not characters', () => {
    const m = encodeMessage({ result: 'ü' }).toString('utf8')
    const len = Number(/Content-Length: (\d+)/.exec(m)![1])
    expect(len).toBe(Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', result: 'ü' })))
  })

  it('skips a header without a length and a body that is not JSON', () => {
    const r = new MessageReader()
    const junk = Buffer.from('X-Thing: 1\r\n\r\nContent-Length: 3\r\n\r\nabc')
    expect(r.push(Buffer.concat([junk, encodeMessage({ id: 9, result: null })]))).toEqual([{ jsonrpc: '2.0', id: 9, result: null }])
  })
})

/** A language server that answers initialize and shutdown, and records the rest */
class FakeServer extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  pid = 4242
  got: Message[] = []
  killed = false
  private reader = new MessageReader()
  constructor() {
    super()
    this.stdin.on('data', (c: Buffer) => {
      for (const m of this.reader.push(c)) {
        this.got.push(m)
        if (m.method === 'initialize') this.reply({ id: m.id, result: { capabilities: { hoverProvider: true } } })
        if (m.method === 'shutdown') this.reply({ id: m.id, result: null })
        if (m.method === 'exit') this.die(0)
      }
    })
  }
  reply(m: Message) {
    setImmediate(() => this.stdout.write(encodeMessage(m)))
  }
  die(code: number | null) {
    setImmediate(() => this.emit('exit', code))
  }
  kill() {
    this.killed = true
    this.die(null)
  }
  methods() {
    return this.got.map((m) => m.method ?? `response:${m.id}`)
  }
}

const tick = () => new Promise((r) => setImmediate(r))
const flush = async () => {
  for (let i = 0; i < 6; i++) await tick()
}

const open = (uri: string, text = 'x = 1\n'): Message => ({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'python', version: 1, text } } })

describe('the language server host', () => {
  let servers: FakeServer[]
  let toEditor: Message[]
  let host: LanguageServerHost
  beforeEach(() => {
    servers = []
    toEditor = []
    host = new LanguageServerHost({
      idleMs: 60_000,
      spawn: () => {
        const s = new FakeServer()
        servers.push(s)
        return s
      },
      initializeParams: () => ({ rootUri: 'file:///ws', workspaceFolders: [{ uri: 'file:///ws', name: 'ws' }] }),
      configuration: (items) => items.map((i) => ({ section: i.section })),
      onMessage: (m) => toEditor.push(m)
    })
  })
  afterEach(() => vi.useRealTimers())

  it('does not start until a document opens, and a request alone fails at once', async () => {
    host.send({ id: 1, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///a.py' } } })
    expect(servers).toHaveLength(0)
    expect(toEditor).toEqual([{ jsonrpc: '2.0', id: 1, error: { code: SERVER_GONE, message: 'No document is open' } }])
  })

  it('starts on the first open, initializes, then sends the document and what waited', async () => {
    host.send(open('file:///a.py', 'print(1)\n'))
    host.send({ method: 'textDocument/didChange', params: { textDocument: { uri: 'file:///a.py', version: 2 }, contentChanges: [{ text: 'print(2)\n' }] } })
    host.send({ id: 7, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///a.py' }, position: { line: 0, character: 1 } } })
    expect(host.state).toBe('starting')
    await flush()
    expect(host.state).toBe('ready')
    const s = servers[0]
    expect(s.methods()).toEqual(['initialize', 'initialized', 'workspace/didChangeConfiguration', 'textDocument/didOpen', 'textDocument/hover'])
    // The open carries the latest text, so the change that came while starting isn't lost
    const opened = s.got.find((m) => m.method === 'textDocument/didOpen')!.params as { textDocument: { text: string; version: number } }
    expect(opened.textDocument).toMatchObject({ text: 'print(2)\n', version: 2 })
    expect(host.capabilities).toEqual({ hoverProvider: true })
  })

  it('answers the server’s own requests and forwards only diagnostics and the editor’s answers', async () => {
    host.send(open('file:///a.py'))
    await flush()
    const s = servers[0]
    s.reply({ id: 100, method: 'workspace/configuration', params: { items: [{ section: 'python' }, { section: 'basedpyright.analysis' }] } })
    s.reply({ id: 101, method: 'window/workDoneProgress/create', params: { token: 't' } })
    s.reply({ method: 'window/logMessage', params: { type: 3, message: 'hello' } })
    s.reply({ method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a.py', diagnostics: [] } })
    host.send({ id: 5, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///a.py' } } })
    await flush()
    s.reply({ id: 5, result: { contents: 'x: int' } })
    s.reply({ id: 999, result: 'nobody asked' })
    await flush()
    expect(s.got.find((m) => m.id === 100)?.result).toEqual([{ section: 'python' }, { section: 'basedpyright.analysis' }])
    expect(s.got.find((m) => m.id === 101)).toMatchObject({ result: null })
    expect(toEditor.map((m) => m.method ?? m.id)).toEqual(['textDocument/publishDiagnostics', 5])
  })

  it('stops after the idle time once the last document closes, and starts again on the next', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    host.send(open('file:///a.py'))
    await flush()
    host.send({ method: 'textDocument/didClose', params: { textDocument: { uri: 'file:///a.py' } } })
    vi.advanceTimersByTime(59_000)
    expect(host.state).toBe('ready')
    // Opening something before the time is up keeps it
    host.send(open('file:///b.py'))
    vi.advanceTimersByTime(120_000)
    expect(host.state).toBe('ready')
    host.send({ method: 'textDocument/didClose', params: { textDocument: { uri: 'file:///b.py' } } })
    vi.advanceTimersByTime(60_000)
    expect(host.state).toBe('stopping')
    await flush()
    expect(servers[0].methods().slice(-2)).toEqual(['shutdown', 'exit'])
    expect(host.state).toBe('stopped')
    expect(servers[0].killed).toBe(false)
    host.send(open('file:///c.py'))
    await flush()
    expect(servers).toHaveLength(2)
    expect(host.state).toBe('ready')
  })

  it('starts again when a file opens while it is stopping', async () => {
    host.send(open('file:///a.py'))
    await flush()
    host.send({ method: 'textDocument/didClose', params: { textDocument: { uri: 'file:///a.py' } } })
    const stopped = host.stop()
    host.send(open('file:///b.py'))
    await stopped
    await flush()
    expect(servers).toHaveLength(2)
    expect(host.state).toBe('ready')
  })

  it('kills a server that ignores shutdown', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    host.send(open('file:///a.py'))
    await flush()
    const s = servers[0]
    s.stdin.removeAllListeners('data')
    const stopped = host.stop(1000)
    vi.advanceTimersByTime(1000)
    await flush()
    await stopped
    expect(s.killed).toBe(true)
    expect(host.state).toBe('stopped')
  })

  it('restarts after a crash with the open documents, and fails the requests that were waiting', async () => {
    host.send(open('file:///a.py', 'a = 1\n'))
    await flush()
    host.send({ id: 3, method: 'textDocument/completion', params: { textDocument: { uri: 'file:///a.py' } } })
    servers[0].die(1)
    await flush()
    expect(toEditor).toContainEqual({ jsonrpc: '2.0', id: 3, error: { code: SERVER_GONE, message: 'The language server stopped' } })
    expect(servers).toHaveLength(2)
    expect(host.state).toBe('ready')
    expect(servers[1].methods()).toContain('textDocument/didOpen')
  })

  it('gives up after repeated crashes rather than looping', async () => {
    host.send(open('file:///a.py'))
    for (let i = 0; i < 6; i++) {
      await flush()
      servers[servers.length - 1].die(1)
    }
    await flush()
    expect(servers.length).toBe(4)
    expect(host.state).toBe('stopped')
  })

  it('forgets the documents when the editor’s window goes', async () => {
    host.send(open('file:///a.py'))
    await flush()
    host.closeAll()
    expect(host.documents.size).toBe(0)
  })
})

describe('basedpyright settings', () => {
  it('points the server at Tide’s Python and the open files’ folders', () => {
    const [python, analysis, other] = configurationFor([{ section: 'python' }, { section: 'basedpyright.analysis' }, { section: 'editor' }], '/env/bin/python', ['/notes/Code/proj']) as [
      { pythonPath: string; analysis: { extraPaths: string[] } },
      { typeCheckingMode: string; diagnosticSeverityOverrides: Record<string, string> },
      null
    ]
    expect(python.pythonPath).toBe('/env/bin/python')
    expect(python.analysis.extraPaths).toEqual(['/notes/Code/proj'])
    expect(analysis.typeCheckingMode).toBe('standard')
    // What Ruff reports, pyright doesn't
    expect(analysis.diagnosticSeverityOverrides.reportUndefinedVariable).toBe('none')
    expect(other).toBeNull()
  })

  it('lists each open file’s folder once, leaving out the empty workspace', () => {
    expect(folderPaths(['file:///notes/Code/p/main.py', 'file:///notes/Code/p/utils.py', 'file:///ws/snippet-1.py', 'inmemory://model/1', 'file:///notes/Code/a%20b/x.py'], '/ws')).toEqual(['/notes/Code/a b', '/notes/Code/p'])
  })

  it('asks for markdown docs, snippets and pull diagnostics are not assumed', () => {
    const p = initializeParams('/tmp/ws') as { rootUri: string; capabilities: { textDocument: { completion: { completionItem: { snippetSupport: boolean; documentationFormat: string[] } } } } }
    expect(p.rootUri).toBe('file:///tmp/ws')
    expect(p.capabilities.textDocument.completion.completionItem.snippetSupport).toBe(true)
    expect(p.capabilities.textDocument.completion.completionItem.documentationFormat[0]).toBe('markdown')
  })
})
