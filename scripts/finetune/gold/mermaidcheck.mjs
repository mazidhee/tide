// Parses mermaid diagrams with the app's own mermaid, headless: [{id, body}] on stdin, {id: error} on stdout.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
for (const k of ['navigator', 'Element', 'SVGElement', 'HTMLElement', 'Node', 'DOMParser', 'getComputedStyle']) {
  try {
    globalThis[k] = dom.window[k]
  } catch {
    // some are read-only on newer Node: mermaid's parser doesn't need them
  }
}
const mermaid = (await import('mermaid')).default
mermaid.initialize({ startOnLoad: false })
let input = ''
for await (const chunk of process.stdin) input += chunk
const out = {}
for (const { id, body } of JSON.parse(input)) {
  try {
    await mermaid.parse(body)
  } catch (e) {
    out[id] = String(e.message ?? e).split('\n').slice(0, 3).join(' ')
  }
}
process.stdout.write(JSON.stringify(out))
