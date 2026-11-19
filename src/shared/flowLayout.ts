/**
 * Lays a diagram out on the canvas with dagre (layered, few crossings): a mermaid flowchart the
 * tutor wrote, or a canvas that has got messy ("Tidy").
 */
import dagre from '@dagrejs/dagre'
import { groupsOf, liveEdges, type Canvas, type CanvasEdge, type CanvasNode, type ComponentKind } from './canvas'
import type { FlowShape, MermaidFlow } from './mermaidFlow'

const RULES: [RegExp, ComponentKind][] = [
  [/\b(load ?balancer|lb|nginx|haproxy|elb|alb)\b/i, 'lb'],
  [/\b(gateway|api gw|ingress)\b/i, 'gateway'],
  [/\b(cdn|edge cache|cloudfront|akamai)\b/i, 'cdn'],
  [/\b(cache|redis|memcached?|varnish)\b/i, 'cache'],
  [/\b(queue|kafka|rabbitmq|sqs|pub\/?sub|topic|stream|event bus|message bus|broker|nats)\b/i, 'queue'],
  [/\b(s3|bucket|blob|object stor\w*|file stor\w*)\b/i, 'storage'],
  [/\b(db|database|postgres\w*|mysql|sqlite|mongo\w*|dynamo\w*|cassandra|sql|replica|primary|ledger|table store|data ?warehouse)\b/i, 'database'],
  [/\b(worker|consumer|job|cron|scheduler)\b/i, 'worker'],
  [/\b(client|browser|user|mobile|frontend|web app|ios|android|customer)\b/i, 'client'],
  [/\b(stripe|third[- ]party|external|partner|bank|provider|payment network|visa|mastercard)\b/i, 'external'],
  [/\b(service|server|api|backend|app server|microservice|handler|lambda)\b/i, 'service']
]

export function guessKind(label: string, shape?: FlowShape): ComponentKind | undefined {
  // The name says most (a cylinder named Redis is a cache); the shape decides before "service"
  const named = RULES.find(([re]) => re.test(label))?.[1]
  if (named && named !== 'service') return named
  if (shape === 'cylinder') return 'database'
  return named
}

const CHAR_W = 7.4
/** A box sized for its label: wide enough for the longest line, tall enough for every line */
function sizeFor(label: string, withKind: boolean, shape: FlowShape): { width: number; height: number } {
  const lines = label.split('\n')
  const longest = Math.max(...lines.map((l) => l.length))
  const width = Math.round(Math.min(260, Math.max(shape === 'circle' ? 90 : 120, longest * CHAR_W + 36)))
  // Long lines wrap inside the width
  const wrapped = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * CHAR_W) / (width - 32))), 0)
  const height = Math.round(Math.max(44, wrapped * 19 + 24 + (withKind ? 20 : 0)))
  // A diamond's words sit in its middle half: give it the room
  if (shape === 'diamond' && !withKind) return { width: Math.round(Math.min(300, width * 1.35)), height: Math.max(80, Math.round(height * 1.7)) }
  return { width, height }
}

const slugId = (s: string) => s.replace(/[^\w-]+/g, '-')

/**
 * A mermaid flowchart as a canvas. Kinds (database, queue...) are given only when the diagram
 * reads as a system, two or more of its parts named like one; an argument map stays plain boxes.
 */
export function flowToCanvas(flow: MermaidFlow): Canvas {
  const guesses = new Map(flow.nodes.map((n) => [n.id, guessKind(n.label, n.shape)]))
  const systemy = [...guesses.values()].filter((k) => k && k !== 'service').length + (flow.nodes.some((n) => n.shape === 'cylinder') ? 1 : 0) >= 2
  const nodes: CanvasNode[] = flow.nodes.map((n) => {
    const kind = systemy ? guesses.get(n.id) : undefined
    const size = sizeFor(n.label, !!kind, n.shape)
    return { id: slugId(n.id), type: 'text', text: n.label, x: 0, y: 0, ...size, ...(kind ? { kind } : {}), ...(n.shape !== 'rect' && !kind ? { shape: n.shape } : {}) }
  })
  const groups: CanvasNode[] = flow.groups.map((g) => ({ id: `group-${slugId(g.id)}`, type: 'group', label: g.label, x: 0, y: 0, width: 0, height: 0 }))
  const edges: CanvasEdge[] = flow.links.map((l, i) => ({
    id: `e${i + 1}-${slugId(l.from)}-${slugId(l.to)}`,
    fromNode: slugId(l.from),
    toNode: slugId(l.to),
    ...(l.fromArrow ? { fromEnd: 'arrow' as const } : {}),
    toEnd: l.toArrow ? ('arrow' as const) : ('none' as const),
    ...(l.label ? { label: l.label } : {}),
    ...(l.dashed ? { dashed: true } : {})
  }))
  const parentOf = new Map<string, string>()
  for (const g of flow.groups) for (const m of g.members) parentOf.set(flow.groups.some((x) => x.id === m) ? `group-${slugId(m)}` : slugId(m), `group-${slugId(g.id)}`)
  return layout({ nodes: [...groups, ...nodes], edges }, flow.direction, parentOf)
}

/**
 * Positions every node with dagre. Groups are laid out as clusters around their members; edges
 * keep their ids and order. `parentOf` maps a node or group id to the group directly holding it.
 */
export function layout(c: Canvas, direction: 'TB' | 'BT' | 'LR' | 'RL', parentOf = new Map<string, string>()): Canvas {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true })
  const across = direction === 'LR' || direction === 'RL'
  g.setGraph({ rankdir: direction, nodesep: across ? 36 : 48, ranksep: across ? 80 : 64, edgesep: 20, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of c.nodes) {
    if (n.type === 'group') g.setNode(n.id, { label: n.label, paddingTop: 34, paddingLeft: 20, paddingRight: 20, paddingBottom: 20 } as Record<string, unknown>)
    else g.setNode(n.id, { width: n.width, height: n.height })
  }
  for (const [child, parent] of parentOf) if (g.hasNode(child) && g.hasNode(parent)) g.setParent(child, parent)
  for (const e of liveEdges(c)) if (g.hasNode(e.fromNode) && g.hasNode(e.toNode) && e.fromNode !== e.toNode) g.setEdge(e.fromNode, e.toNode, { width: e.label ? Math.min(160, e.label.length * 6.5 + 16) : 0, height: e.label ? 22 : 0, labelpos: 'c' }, e.id)
  dagre.layout(g)
  const placed = c.nodes.map((n) => {
    const p = g.node(n.id)
    if (!p || p.x === undefined) return n
    const width = n.type === 'group' ? Math.round(p.width) : n.width
    const height = n.type === 'group' ? Math.round(p.height + 14) : n.height
    return { ...n, x: Math.round(p.x - p.width / 2), y: Math.round(p.y - p.height / 2) - (n.type === 'group' ? 14 : 0), width, height }
  })
  return { ...c, nodes: placed }
}

/**
 * Tidy: lays the canvas out again, top to bottom, keeping every node in the group it was in.
 * Notes and nodes on their own keep their places relative to nothing, so they go where dagre puts them.
 */
export function tidyCanvas(c: Canvas, direction: 'TB' | 'LR' = 'LR'): Canvas {
  const parentOf = new Map<string, string>()
  for (const n of c.nodes) {
    const g = groupsOf(c, n)[0]
    if (g) parentOf.set(n.id, g.id)
  }
  // An empty group has nothing to wrap: dagre would give it no size, so it keeps its own
  const holding = new Set(parentOf.values())
  const empty = c.nodes.filter((n) => n.type === 'group' && !holding.has(n.id))
  const laid = layout({ ...c, nodes: c.nodes.filter((n) => !empty.includes(n)) }, direction, parentOf)
  const maxY = Math.max(0, ...laid.nodes.map((n) => n.y + n.height))
  let x = 0
  const parked = empty.map((n) => {
    const out = { ...n, x, y: maxY + 60 }
    x += n.width + 40
    return out
  })
  // Keep the file's node order: groups stay behind what they hold
  const byId = new Map([...laid.nodes, ...parked].map((n) => [n.id, n]))
  return { ...c, nodes: c.nodes.map((n) => byId.get(n.id) ?? n) }
}

