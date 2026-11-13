/**
 * The margin tutor's tools against a real scratch kernel: running code after replaying the
 * notebook, and setting a checked exercise only when Claude's own solution passes its tests.
 * Needs TIDE_NB_PYTHON (a scratch environment with ipykernel); skipped without it.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const PY = process.env.TIDE_NB_PYTHON ?? ''
const ready = (() => {
  if (!PY || !existsSync(PY)) return false
  try {
    execFileSync(PY, ['-c', 'import ipykernel'], { stdio: 'ignore', timeout: 60_000 })
    return true
  } catch {
    return false
  }
})()
const data = mkdtempSync(join(tmpdir(), 'tide-nbtutor-'))
const sent: unknown[] = []
vi.mock('electron', () => ({ app: { getPath: () => data }, BrowserWindow: { getAllWindows: () => [{ webContents: { isDestroyed: () => false, send: (_c: string, e: unknown) => sent.push(e) } }] }, ipcMain: { handle: () => {}, on: () => {} } }))

describe.skipIf(!ready)('the tutor’s scratch kernel', async () => {
  process.env.TIDE_NB_PYTHON = PY
  const tutor = await import('../src/main/notebook/tutor')
  const ctx = { signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => 's', updateStep: () => {}, web: false, labId: 'nb:k1', chatId: undefined }
  const tool = (n: string) => tutor.NOTEBOOK_TOOLS.find((t) => t.name === n)!
  tutor.setSnapshot('k1', { ref: { vault: 'x.ipynb' }, name: 'x', text: '', code: [{ id: 'a', source: 'import tide_finance as tf\nspot = 100.0' }], kernel: 'Ready' })
  afterAll(() => tutor.end('k1'))

  it('runs code after replaying the notebook', async () => {
    const out = await tool('run_scratch').run({ code: 'print(spot * 2, round(tf.black_scholes(spot, 100, 1, 0.0, 0.2)["price"], 4))', replay: true }, ctx)
    expect(out).toContain('200.0 7.9656')
    expect(out).toMatch(/\[ok\]$/)
  }, 90_000)

  it('sets an exercise only when its solution passes', async () => {
    const bad = await tool('set_exercise').run({ title: 'Double', prompt: 'p', starter: 'x = ...', solution: 'x = spot * 3', tests: [{ name: 'doubled', code: 'assert x == 200, "x should be 200"' }] }, ctx)
    expect(bad).toMatch(/^Not set: your solution fails its own tests: doubled: x should be 200/)
    const good = await tool('set_exercise').run({ title: 'Double', prompt: 'Make x twice spot.', starter: 'x = ...', solution: 'x = spot * 2', tests: [{ name: 'doubled', code: 'assert x == 200, "x should be 200"' }], hint: 'Multiply.' }, ctx)
    expect(good).toMatch(/^Set:/)
    expect(sent.some((e) => (e as { type?: string }).type === 'exercise')).toBe(true)
  }, 90_000)
})
