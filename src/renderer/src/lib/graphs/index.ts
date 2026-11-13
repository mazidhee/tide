/**
 * Lesson graphs (shared/graphSpec) wherever tutor text appears: a ```graph block (or a <plot/>
 * tag, turned into one before rendering, lib/markdown) becomes the graph, drawn locally the moment
 * the block is complete. A block still streaming in stays as code; one that can't be read becomes
 * a short note saying why, never a broken lesson. The drawing code loads with the first graph.
 */
import { createKeeper, watchBlocks } from '../liveBlocks'
import { parseGraph, type Graph } from '@shared/graphSpec'

const sourceOf = (pre: HTMLElement) => pre.querySelector('code')?.textContent ?? ''
const isGraphBlock = (pre: HTMLElement) => /^(graph|plot)$/i.test(pre.dataset.lang ?? '')
const keeper = createKeeper({ widget: 'figure.graph', isSource: isGraphBlock, sourceOf })

let render: Promise<typeof import('./render')> | null = null

/** Why a parsed graph can't be drawn: an expression the reader refuses */
export async function drawable(g: Graph): Promise<string | null> {
  const { compileExpr } = await import('./maths')
  if (g.kind === 'plane') for (const f of g.fns) if (!compileExpr(f.expr)) return `can’t read y = ${f.expr}`
  if (g.kind === 'surface' && !compileExpr(g.expr, 'xy')) return `can’t read z = ${g.expr}`
  return null
}

async function renderBlock(pre: HTMLElement): Promise<void> {
  const code = sourceOf(pre)
  if (!code.trim() || pre.dataset.graphTried === code) return
  // Still streaming: wait for the whole object
  try {
    JSON.parse(code)
  } catch {
    return
  }
  pre.dataset.graphTried = code
  render ??= import('./render')
  const r = await render
  if (!pre.isConnected || pre.dataset.graphTried !== code) return
  const parsed = parseGraph(code)
  const why = parsed.ok ? await drawable(parsed.graph) : parsed.error
  if (!pre.isConnected) return
  const slot = keeper.slot(pre)
  if (!parsed.ok || why) {
    const fig = r.errorFigure(why ?? 'unreadable')
    pre.replaceWith(fig)
    keeper.keep(slot, fig, () => {})
    return
  }
  try {
    const m = r.mountGraph(parsed.graph)
    pre.replaceWith(m.root)
    keeper.keep(slot, m.root, m.destroy)
  } catch (e) {
    const fig = r.errorFigure((e as Error).message || 'it couldn’t be drawn')
    pre.replaceWith(fig)
    keeper.keep(slot, fig, () => {})
  }
}

function scan(): void {
  keeper.reclaim()
  document.querySelectorAll<HTMLElement>('pre.code-block').forEach((pre) => {
    if (isGraphBlock(pre)) void renderBlock(pre)
  })
}

/** Watches the whole document; call once at startup */
export function startGraphs(): void {
  watchBlocks(keeper, scan)
  scan()
}
