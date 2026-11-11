/**
 * The data lab's blocks outside Electron: the real renderer code (lib/lab.ts, lib/labChart.ts)
 * and the real stylesheets, with results recorded from the real lab (fixtures.mjs).
 *   index.html?theme=light|sepia|graphite|dark|midnight|ember&w=420|900&set=table|bars|lines|edge
 */
import { startLab } from '../../../src/renderer/src/lib/lab'
import fixtures from './fixtures.json'

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') ?? 'light'
const width = Number(params.get('w') ?? 420)
const set = params.get('set') ?? 'bars'

const results = fixtures.results as Record<string, unknown>
;(window as unknown as { tide: unknown }).tide = {
  lab: {
    query: async (_id: string, sql: string) => results[sql.trim()] ?? { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 0.1, error: 'The harness only knows the queries it was built with.' },
    schema: async () => [],
    reset: async () => {}
  }
}

const page = document.getElementById('page')!
page.style.setProperty('--w', `${width}px`)
const wanted = (fixtures.blocks as { set: string; name: string; lang: string; body: string; then?: string[] }[]).filter((b) => b.set === set)
for (const b of wanted) {
  const cell = document.createElement('section')
  const label = document.createElement('h2')
  label.textContent = b.name
  const prose = document.createElement('div')
  prose.className = 'prose msg-prose'
  // As markdown.ts renders a fenced block
  const pre = document.createElement('pre')
  pre.className = 'code-block'
  pre.dataset.lang = b.lang
  const code = document.createElement('code')
  code.className = 'hljs'
  code.textContent = b.body
  pre.append(code)
  prose.append(pre)
  cell.append(label, prose)
  cell.dataset.then = (b.then ?? []).join(',')
  page.append(cell)
}

startLab()

// Run every query, then make the clicks each block asks for
const press = (root: Element, text: string) => [...root.querySelectorAll('button')].find((x) => x.textContent?.trim().startsWith(text))?.click()
setTimeout(() => {
  for (const cell of page.querySelectorAll<HTMLElement>('section')) press(cell, 'Run')
  setTimeout(() => {
    for (const cell of page.querySelectorAll<HTMLElement>('section')) for (const t of (cell.dataset.then ?? '').split(',').filter(Boolean)) press(cell, t)
    // Show one hover readout per chart, as a pointer would
    if (params.get('hover') !== '0') {
      for (const plot of page.querySelectorAll<HTMLElement>('.lab-plot')) {
        const box = plot.getBoundingClientRect()
        plot.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + box.width * 0.62, clientY: box.top + box.height * 0.45, bubbles: true }))
      }
    }
  }, 300)
}, 900)
