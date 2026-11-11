/**
 * Renders ```mermaid code blocks as diagrams anywhere in the app (notes, tutor threads, sessions).
 * The tutor draws recursion trees, graphs and flows this way. Blocks still streaming in are left
 * as code until they parse, so a half-written diagram never flashes an error.
 */
import { repairMermaid } from '@shared/mermaidRepair'
import { parseMermaidFlow } from '@shared/mermaidFlow'
import type { Root } from 'react-dom/client'

// Flowcharts drawn on the canvas, taken down when their message leaves the page
const figures = new Set<{ el: HTMLElement; root: Root }>()
function sweep() {
  for (const f of figures)
    if (!f.el.isConnected) {
      figures.delete(f)
      f.root.unmount()
    }
}

/**
 * A flowchart this app can follow goes on the canvas instead of mermaid's picture: the same
 * boxes and arrows, but you can pan, zoom and play a request along the arrows step by step.
 * Returns false to leave the block to mermaid.
 */
async function renderFlow(pre: HTMLElement, code: string): Promise<boolean> {
  const flow = parseMermaidFlow(code) ?? parseMermaidFlow(repairMermaid(code))
  if (!flow || flow.nodes.length < 2 || !flow.links.length || flow.nodes.length > 80) return false
  const [{ flowToCanvas }, { mountFlowFigure }] = await Promise.all([import('@shared/flowLayout'), import('../components/flow/FlowFigure')])
  if (!pre.isConnected) return true
  const figure = document.createElement('figure')
  figure.className = 'flow-figure'
  figure.setAttribute('aria-label', 'Flowchart. Play the flow to follow it step by step.')
  pre.replaceWith(figure)
  figures.add({ el: figure, root: mountFlowFigure(figure, flowToCanvas(flow)) })
  return true
}

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
let currentTheme = ''

async function getMermaid() {
  mermaidPromise ??= import('mermaid').then((m) => m.default)
  const mermaid = await mermaidPromise
  const dark = document.documentElement.style.colorScheme === 'dark' || ['graphite', 'dark', 'midnight', 'ember'].includes(document.documentElement.dataset.theme ?? '')
  const theme = dark ? 'dark' : 'neutral'
  if (theme !== currentTheme) {
    currentTheme = theme
    const css = getComputedStyle(document.documentElement)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily: css.getPropertyValue('--font-ui'),
      themeVariables: { fontSize: '14px' }
    })
  }
  return mermaid
}

let counter = 0

async function renderBlock(pre: HTMLElement) {
  const code = pre.querySelector('code')?.textContent ?? ''
  if (!code.trim() || pre.dataset.mermaidTried === code) return
  pre.dataset.mermaidTried = code
  try {
    if (await renderFlow(pre, code)) return
  } catch {
    // Fall back to mermaid's own drawing
  }
  const mermaid = await getMermaid()
  try {
    // As written, or mended (a fence opened twice, a mindmap with two roots)
    let source = code
    if (!(await mermaid.parse(source, { suppressErrors: true }))) {
      source = repairMermaid(code)
      if (source === code.trim() || !(await mermaid.parse(source, { suppressErrors: true }))) return
    }
    const { svg } = await mermaid.render(`tide-mermaid-${++counter}`, source)
    if (!pre.isConnected) return
    const figure = document.createElement('figure')
    figure.className = 'mermaid-diagram'
    figure.innerHTML = svg
    pre.replaceWith(figure)
  } catch {
    // Leave the code visible if mermaid can't draw it
  }
}

let timer: ReturnType<typeof setTimeout> | undefined

function scan() {
  sweep()
  document.querySelectorAll<HTMLElement>('pre.code-block[data-lang="mermaid"]').forEach((pre) => void renderBlock(pre))
}

/** Watches the whole document; call once at startup */
export function startMermaid() {
  const observer = new MutationObserver(() => {
    clearTimeout(timer)
    timer = setTimeout(scan, 500)
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  scan()
}
