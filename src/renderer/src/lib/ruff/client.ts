import RuffWorker from './ruff.worker?worker'
import type { RuffDiagnostic } from './markers'

/**
 * Talks to the Ruff worker. The worker (and its WebAssembly) is only started the first time a
 * Python editor asks for something. If Ruff can't load, every call resolves to null and the editor
 * carries on without diagnostics.
 */

let worker: Worker | null = null
let broken = false
let nextId = 1
const pending = new Map<number, (v: unknown) => void>()

const fail = (why: unknown) => {
  if (!broken) console.warn('Ruff is unavailable; Python diagnostics are off.', why)
  broken = true
  worker?.terminate()
  worker = null
  for (const done of pending.values()) done(null)
  pending.clear()
}

function start(): Worker | null {
  if (broken) return null
  if (worker) return worker
  try {
    worker = new RuffWorker()
  } catch (err) {
    fail(err)
    return null
  }
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const done = pending.get(e.data.id)
    pending.delete(e.data.id)
    if (e.data.ok) done?.(e.data.result)
    else if (/could not load|WebAssembly|CompileError|LinkError/i.test(e.data.error ?? '')) fail(e.data.error)
    else done?.(null)
  }
  worker.onerror = (e) => fail(e.message)
  return worker
}

function call(op: 'check' | 'format', source: string): Promise<unknown> {
  const w = start()
  if (!w) return Promise.resolve(null)
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    w.postMessage({ id, op, source })
  })
}

export async function lintPython(source: string): Promise<RuffDiagnostic[] | null> {
  const r = await call('check', source)
  return Array.isArray(r) ? (r as RuffDiagnostic[]) : null
}

/** The formatted source, or null when it can't be formatted (a syntax error, or Ruff is unavailable) */
export async function formatPython(source: string): Promise<string | null> {
  const r = await call('format', source)
  return typeof r === 'string' ? r : null
}
