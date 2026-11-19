/**
 * Between a JSON Canvas and xyflow: canvas nodes become flow nodes (groups as parents, positions
 * relative to them), and flow positions go back to the absolute ones the file stores.
 */
import type { Edge, Node } from '@xyflow/react'
import { groupsOf, liveEdges, type Canvas, type CanvasEdge, type CanvasNode, type Side } from '@shared/canvas'

export type CanvasNodeData = { node: CanvasNode }
export type FlowNode = Node<CanvasNodeData>
export type FlowEdgeData = { edge: CanvasEdge; state?: 'active' | 'done'; step?: number; run?: number }
export type FlowEdge = Edge<FlowEdgeData>

export const flowType = (n: CanvasNode) => (n.type === 'group' ? 'group' : n.type === 'file' ? 'file' : n.type === 'link' ? 'link' : 'text')

// The same canvas node gives the same data object, so a node that didn't change doesn't re-render
const dataCache = new WeakMap<CanvasNode, CanvasNodeData>()
const dataFor = (n: CanvasNode) => {
  let d = dataCache.get(n)
  if (!d) dataCache.set(n, (d = { node: n }))
  return d
}

/**
 * The flow nodes for a canvas. Each node's parent is the innermost group it sits in; groups come
 * before what they hold (largest first), as xyflow needs.
 */
export function toFlowNodes(c: Canvas, prev?: Map<string, FlowNode>): FlowNode[] {
  const groups = c.nodes.filter((n) => n.type === 'group').sort((a, b) => b.width * b.height - a.width * a.height)
  const rest = c.nodes.filter((n) => n.type !== 'group')
  const parentOf = new Map<string, CanvasNode>()
  for (const n of [...groups, ...rest]) {
    const g = groupsOf(c, n)[0]
    if (g) parentOf.set(n.id, g)
  }
  return [...groups, ...rest].map((n) => {
    const parent = parentOf.get(n.id)
    const old = prev?.get(n.id)
    // Nothing about it changed: hand xyflow the same object, so it skips the node entirely
    if (old && old.data.node === n && old.parentId === parent?.id && old.position.x === n.x - (parent?.x ?? 0) && old.position.y === n.y - (parent?.y ?? 0)) return old
    const sized = n.type === 'group' || n.type === 'link' || n.type === 'file'
    return {
      id: n.id,
      type: flowType(n),
      position: { x: n.x - (parent?.x ?? 0), y: n.y - (parent?.y ?? 0) },
      data: dataFor(n),
      ...(parent ? { parentId: parent.id } : {}),
      // Groups, files and links are the size the file says; a text box is at least that tall and grows with its text
      ...(sized ? { width: n.width, height: n.height } : { style: { width: n.width, minHeight: n.height } }),
      ...(n.type === 'group' ? { zIndex: -1 } : {}),
      ...(old?.selected ? { selected: true } : {}),
      ...(old?.measured && !sized ? { measured: old.measured } : {})
    } as FlowNode
  })
}

/** Absolute positions of flow nodes (walking up through their groups) */
export function absolutePositions(nodes: FlowNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map<string, { x: number; y: number }>()
  const abs = (n: FlowNode, depth = 0): { x: number; y: number } => {
    const known = out.get(n.id)
    if (known) return known
    const parent = n.parentId ? byId.get(n.parentId) : undefined
    const p = parent && depth < 20 ? abs(parent, depth + 1) : { x: 0, y: 0 }
    const r = { x: p.x + n.position.x, y: p.y + n.position.y }
    out.set(n.id, r)
    return r
  }
  nodes.forEach((n) => abs(n))
  return out
}

/** The canvas with the flow's positions and sizes written back; untouched nodes stay the same objects */
export function withFlowGeometry(c: Canvas, nodes: FlowNode[]): Canvas {
  const pos = absolutePositions(nodes)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let changed = false
  const next = c.nodes.map((n) => {
    const p = pos.get(n.id)
    const f = byId.get(n.id)
    if (!p || !f) return n
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    const width = Math.round(f.width ?? n.width)
    const height = Math.round(f.height ?? n.height)
    if (x === n.x && y === n.y && width === n.width && height === n.height) return n
    changed = true
    return { ...n, x, y, width, height }
  })
  return changed ? { ...c, nodes: next } : c
}

const edgeCache = new WeakMap<CanvasEdge, { key: string; edge: FlowEdge }>()

/** The flow edges; an edge whose state didn't change is the same object as last time */
export function toFlowEdges(c: Canvas, selected: Set<string>, flow?: { active?: string; done: Set<string>; step: number; run: number }): FlowEdge[] {
  return liveEdges(c).map((e) => {
    const state = flow?.active === e.id ? 'active' : flow?.done.has(e.id) ? 'done' : undefined
    const sel = selected.has(e.id)
    const key = `${state ?? ''}|${sel ? 1 : 0}|${state === 'active' ? flow!.run : ''}`
    const hit = edgeCache.get(e)
    if (hit?.key === key) return hit.edge
    const edge: FlowEdge = {
      id: e.id,
      source: e.fromNode,
      target: e.toNode,
      sourceHandle: e.fromSide ?? null,
      targetHandle: e.toSide ?? null,
      type: 'flow',
      selected: sel,
      data: { edge: e, ...(state ? { state, step: flow!.step, run: flow!.run } : {}) },
      ...(state === 'active' ? { zIndex: 5 } : {})
    }
    edgeCache.set(e, { key, edge })
    return edge
  })
}

export const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
