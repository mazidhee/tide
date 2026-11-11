/// <reference lib="webworker" />
import init, { Workspace, PositionEncoding } from '@astral-sh/ruff-wasm-web'
import wasmUrl from '@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm?url'
import { RUFF_SETTINGS } from './settings'

/**
 * Ruff (the Python linter and formatter) compiled to WebAssembly, run off the main thread. Messages:
 * { id, op: 'check' | 'format', source } → { id, ok, result } or { id, ok: false, error }.
 */

const bytes = async (url: string): Promise<ArrayBuffer> => {
  // fetch() can't read file:// URLs in the packaged app; XHR can
  try {
    const res = await fetch(url)
    if (res.ok) return await res.arrayBuffer()
  } catch {
    /* fall through */
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    xhr.responseType = 'arraybuffer'
    xhr.onload = () => (xhr.response ? resolve(xhr.response as ArrayBuffer) : reject(new Error('empty')))
    xhr.onerror = () => reject(new Error(`could not load ${url}`))
    xhr.send()
  })
}

let workspace: Promise<Workspace> | null = null
const ready = () =>
  (workspace ??= (async () => {
    await init({ module_or_path: await bytes(new URL(wasmUrl, self.location.href).href) })
    return new Workspace(RUFF_SETTINGS, PositionEncoding.Utf16)
  })())

self.onmessage = async (e: MessageEvent<{ id: number; op: 'check' | 'format'; source: string }>) => {
  const { id, op, source } = e.data
  try {
    const ws = await ready()
    const result = op === 'check' ? ws.check(source) : ws.format(source)
    self.postMessage({ id, ok: true, result })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) })
  }
}
