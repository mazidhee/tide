import { afterEach, describe, expect, it, vi } from 'vitest'
import { LspClient } from '../src/renderer/src/lib/lsp/client'
import { completionKindName, diagnosticToMarker, locationOf, markdownOf, symbolKind, toPosition, withoutRuffDuplicates } from '../src/renderer/src/lib/lsp/convert'
import { toMarkers } from '../src/renderer/src/lib/ruff/markers'

function fakeTransport() {
  const sent: Record<string, unknown>[] = []
  let cb: (m: unknown) => void = () => {}
  return { sent, deliver: (m: unknown) => cb(m), transport: { send: (m: unknown) => sent.push(m as Record<string, unknown>), onMessage: (f: (m: unknown) => void) => ((cb = f), () => (cb = () => {})) } }
}

describe('the editor’s LSP client', () => {
  afterEach(() => vi.useRealTimers())

  it('matches answers to requests by id and passes notifications on', async () => {
    const t = fakeTransport()
    const c = new LspClient(t.transport)
    const got: unknown[] = []
    c.on('textDocument/publishDiagnostics', (p) => got.push(p))
    const a = c.request('textDocument/hover', { x: 1 })
    const b = c.request('textDocument/completion', { x: 2 })
    expect(t.sent.map((m) => [m.id, m.method])).toEqual([
      [1, 'textDocument/hover'],
      [2, 'textDocument/completion']
    ])
    t.deliver({ jsonrpc: '2.0', id: 2, result: ['b'] })
    t.deliver({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'no' } })
    t.deliver({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'u' } })
    expect(await a).toBeNull()
    expect(await b).toEqual(['b'])
    expect(got).toEqual([{ uri: 'u' }])
    expect(c.inFlight).toBe(0)
  })

  it('resolves to null when the server never answers', async () => {
    vi.useFakeTimers()
    const c = new LspClient(fakeTransport().transport, 1000)
    const p = c.request('textDocument/hover', {})
    vi.advanceTimersByTime(1000)
    expect(await p).toBeNull()
    expect(c.inFlight).toBe(0)
  })

  it('tells the server when Monaco cancels a request', async () => {
    const t = fakeTransport()
    const c = new LspClient(t.transport)
    let cancel = () => {}
    const p = c.request('textDocument/completion', {}, { isCancellationRequested: false, onCancellationRequested: (f: () => void) => (cancel = f) })
    cancel()
    expect(await p).toBeNull()
    expect(t.sent[1]).toEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } })
  })
})

describe('LSP to Monaco', () => {
  it('turns a type error into a 1-based marker that keeps its rule', () => {
    const m = diagnosticToMarker({ range: { start: { line: 4, character: 9 }, end: { line: 4, character: 16 } }, severity: 1, code: 'reportAssignmentType', source: 'basedpyright', message: 'Type "Literal[\'hi\']" is not assignable to declared type "int"' })
    expect(m).toMatchObject({ severity: 8, code: 'reportAssignmentType', source: 'Pyright', startLineNumber: 5, startColumn: 10, endLineNumber: 5, endColumn: 17 })
  })

  it('keeps tags (faded unused code) and widens an empty range to one character', () => {
    const m = diagnosticToMarker({ range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } }, severity: 4, message: '"x" is not accessed', tags: [1] })
    expect(m).toMatchObject({ severity: 1, tags: [1], startColumn: 4, endColumn: 5 })
  })

  it('maps kinds, symbols, positions and docs', () => {
    expect(completionKindName(3)).toBe('Function')
    expect(completionKindName(9)).toBe('Module')
    expect(completionKindName(undefined)).toBe('Text')
    expect(completionKindName(99)).toBe('Text')
    expect(symbolKind(5)).toBe(4) // Class
    expect(toPosition({ lineNumber: 3, column: 7 })).toEqual({ line: 2, character: 6 })
    expect(markdownOf({ kind: 'markdown', value: '```python\ndef f()\n```' })).toEqual({ value: '```python\ndef f()\n```' })
    expect(markdownOf({ kind: 'plaintext', value: 'a < b' })).toEqual({ value: '```\na < b\n```' })
    expect(markdownOf({ kind: 'markdown', value: '  ' })).toBeUndefined()
    expect(markdownOf(['one', { language: 'python', value: 'x: int' }])).toEqual({ value: 'one\n\n```python\nx: int\n```' })
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }
    expect(locationOf({ uri: 'file:///a.py', range })).toEqual({ uri: 'file:///a.py', range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6 } })
    expect(locationOf({ targetUri: 'file:///b.py', targetRange: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } }, targetSelectionRange: range }).range.startLineNumber).toBe(2)
  })
})

describe('one squiggle per mistake, with Ruff and pyright both on', () => {
  const ruff = toMarkers([
    { code: 'F821', message: 'Undefined name `pritn`', start_location: { row: 3, column: 1 }, end_location: { row: 3, column: 6 } },
    { code: 'F401', message: '`os` imported but unused', tags: ['unnecessary'], start_location: { row: 1, column: 8 }, end_location: { row: 1, column: 10 } },
    { code: 'invalid-syntax', message: 'Expected an expression', start_location: { row: 7, column: 5 }, end_location: { row: 7, column: 6 } }
  ])
  const py = (line: number, code: string | undefined, severity = 1, tags?: number[]) =>
    diagnosticToMarker({ range: { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: 3 } }, severity, ...(code ? { code } : {}), message: code ?? 'syntax', ...(tags ? { tags } : {}) })

  it('drops pyright’s copy of what Ruff already reports on that line', () => {
    const out = withoutRuffDuplicates([py(3, 'reportUndefinedVariable'), py(1, undefined, 4, [1]), py(7, undefined), py(5, 'reportAttributeAccessIssue'), py(7, 'reportCallIssue')], ruff)
    expect(out.map((m) => [m.startLineNumber, m.code])).toEqual([
      [5, 'reportAttributeAccessIssue'],
      [7, 'reportCallIssue']
    ])
  })

  it('keeps everything when Ruff has nothing, and type errors always', () => {
    const all = [py(3, 'reportUndefinedVariable'), py(2, undefined)]
    expect(withoutRuffDuplicates(all, [])).toBe(all)
    expect(withoutRuffDuplicates([py(3, 'reportArgumentType')], ruff)).toHaveLength(1)
  })
})
