import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initSync, PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-web'
import { severityFor, Severity, toMarkers, type RuffDiagnostic } from '../src/renderer/src/lib/ruff/markers'
import { debounce } from '../src/renderer/src/lib/ruff/debounce'
import { RUFF_SETTINGS } from '../src/renderer/src/lib/ruff/settings'

const diag = (code: string | null, row: number, col: number, endRow: number, endCol: number, tags: string[] = []): RuffDiagnostic => ({
  code,
  message: `message for ${code}`,
  tags,
  start_location: { row, column: col },
  end_location: { row: endRow, column: endCol }
})

describe('Ruff diagnostics as Monaco markers', () => {
  it('keeps the range, message, rule code and source', () => {
    const [m] = toMarkers([diag('F401', 1, 8, 1, 10, ['unnecessary'])])
    expect(m).toEqual({
      severity: Severity.Warning,
      message: 'message for F401',
      code: 'F401',
      source: 'Ruff',
      startLineNumber: 1,
      startColumn: 8,
      endLineNumber: 1,
      endColumn: 10,
      tags: [1]
    })
  })

  it('treats code that would fail when run as an error', () => {
    expect(severityFor('F821')).toBe(Severity.Error)
    expect(severityFor('E902')).toBe(Severity.Error)
    expect(severityFor('invalid-syntax')).toBe(Severity.Error)
    expect(severityFor(null)).toBe(Severity.Error)
    expect(severityFor('F401')).toBe(Severity.Warning)
    expect(severityFor('E711')).toBe(Severity.Warning)
  })

  it('gives syntax errors no rule code and widens empty ranges', () => {
    const [m] = toMarkers([diag('invalid-syntax', 3, 5, 3, 5)])
    expect(m.code).toBeUndefined()
    expect(m.endColumn).toBe(6)
  })

  it('pulls an end-of-file error back onto the last line', () => {
    const [m] = toMarkers([diag('invalid-syntax', 4, 1, 4, 1)], 3)
    expect(m.startLineNumber).toBe(3)
    expect(m.endLineNumber).toBe(3)
    expect(m.endColumn).toBeGreaterThan(1)
  })

  it('marks deprecated code', () => {
    expect(toMarkers([diag('F999', 1, 1, 1, 4, ['deprecated'])])[0].tags).toEqual([2])
  })
})

describe('debounce', () => {
  afterEach(() => vi.useRealTimers())

  it('runs once, with the last arguments, after typing stops', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 300)
    d('a')
    vi.advanceTimersByTime(200)
    d('ab')
    vi.advanceTimersByTime(200)
    d('abc')
    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('abc')
  })

  it('cancel drops a pending run and flush runs it now', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 300)
    d(1)
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
    d(2)
    d.flush()
    expect(fn).toHaveBeenCalledWith(2)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('Ruff WebAssembly', () => {
  let ws: Workspace
  beforeAll(() => {
    initSync({ module: readFileSync(resolve('node_modules/@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm')) })
    ws = new Workspace(RUFF_SETTINGS, PositionEncoding.Utf16)
  })

  it('finds an undefined name and an unused import', () => {
    const found = ws.check('import os\n\nprint(total)\n') as RuffDiagnostic[]
    const codes = found.map((d) => d.code).sort()
    expect(codes).toEqual(['F401', 'F821'])
    const markers = toMarkers(found)
    const undefinedName = markers.find((m) => m.code === 'F821')!
    expect(undefinedName).toMatchObject({ severity: Severity.Error, startLineNumber: 3, startColumn: 7, endColumn: 12 })
    expect(markers.find((m) => m.code === 'F401')).toMatchObject({ severity: Severity.Warning, startLineNumber: 1, tags: [1] })
  })

  it('uses UTF-16 columns, as Monaco does', () => {
    const [d] = ws.check('print("😀", nope)\n') as RuffDiagnostic[]
    expect(d.code).toBe('F821')
    // 'print("😀", ' is 12 UTF-16 code units (the emoji is two), so the name starts at column 13
    expect(d.start_location.column).toBe(13)
  })

  it('formats', () => {
    expect(ws.format("x=1;y = [1,2]\nprint( 'hi' )\n")).toBe('x = 1\ny = [1, 2]\nprint("hi")\n')
  })
})
