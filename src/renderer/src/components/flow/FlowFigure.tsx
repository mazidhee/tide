import { useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Canvas } from '@shared/canvas'
import { CanvasEditor } from '../CanvasEditor'

/** Tall enough for the drawing at a readable size, never taller than most of a screen */
export function figureHeight(c: Canvas, width: number): number {
  if (!c.nodes.length) return 200
  const minX = Math.min(...c.nodes.map((n) => n.x))
  const maxX = Math.max(...c.nodes.map((n) => n.x + n.width))
  const minY = Math.min(...c.nodes.map((n) => n.y))
  const maxY = Math.max(...c.nodes.map((n) => n.y + n.height))
  const k = Math.min(1, (width - 48) / Math.max(1, maxX - minX))
  return Math.round(Math.min(560, Math.max(220, (maxY - minY) * k + 150)))
}

/**
 * A flowchart from a message drawn on the canvas: pan and pinch to look closer, and play a request
 * along its arrows step by step. It can't be edited; it is what the tutor wrote.
 */
function FlowFigure({ canvas }: { canvas: Canvas }) {
  const noop = useMemo(() => () => {}, [])
  return <CanvasEditor canvas={canvas} onChange={noop} version={0} readOnly compact />
}

/** Draws a flowchart into `el`; returns the root so it can be taken down when the message goes */
export function mountFlowFigure(el: HTMLElement, canvas: Canvas): Root {
  el.style.height = `${figureHeight(canvas, el.clientWidth || 640)}px`
  const root = createRoot(el)
  root.render(<FlowFigure canvas={canvas} />)
  return root
}
