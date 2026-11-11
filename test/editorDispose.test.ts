import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/lib/ruff/client', () => ({
  lintPython: vi.fn(async () => []),
  formatPython: vi.fn(async () => null)
}))

import { watchPython } from '../src/renderer/src/lib/ruff/editor'

function fakeModel() {
  let disposed = false
  return {
    dispose: () => (disposed = true),
    isDisposed: () => disposed,
    getLanguageId: () => 'python',
    getVersionId: () => 1,
    getLineCount: () => 1,
    getValue: () => {
      if (disposed) throw new Error('Model is disposed!')
      return 'x = 1\n'
    }
  }
}

describe('the code editor closing while Ruff lints', () => {
  it('never reads a disposed model ("Model is disposed!" when a code answer was handed in)', async () => {
    vi.useFakeTimers()
    const model = fakeModel()
    const noop = { dispose() {} }
    const editor = { getModel: () => model, onDidChangeModelContent: () => noop, onDidChangeModelLanguage: () => noop, onDidChangeModel: () => noop }
    const setModelMarkers = vi.fn()
    const monaco = { editor: { setModelMarkers }, languages: { registerDocumentFormattingEditProvider: vi.fn() } }
    const stop = watchPython(monaco as never, editor as never)
    const errors: unknown[] = []
    const onErr = (e: unknown) => errors.push(e)
    process.on('unhandledRejection', onErr)
    vi.advanceTimersByTime(400) // the lint starts, and awaits the linter
    // The editor is closed, in the order CodeEditor now uses: editor, then its model
    stop()
    model.dispose()
    vi.useRealTimers()
    await new Promise((r) => setTimeout(r, 20))
    process.off('unhandledRejection', onErr)
    expect(errors).toEqual([])
    // Only the clearing as it stopped: no markers set on a closed editor
    expect(setModelMarkers).toHaveBeenCalledTimes(1)
    const { lintPython } = await import('../src/renderer/src/lib/ruff/client')
    expect(lintPython).not.toHaveBeenCalled()
  })
})
