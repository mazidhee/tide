/**
 * System design canvases, stored as JSON Canvas (https://jsoncanvas.org), the format Obsidian
 * uses, so a design opens in Obsidian too. Tide adds a `kind` to each node (service, database,
 * queue...), which other apps ignore, and maps it to a canvas colour so it still reads there.
 *
 * The same small set of operations is used by the editor and by the tutor's canvas_edit tool, and
 * `describeCanvas` turns a design into text the model can reason about.
 */

export type ComponentKind = 'client' | 'service' | 'database' | 'cache' | 'queue' | 'lb' | 'gateway' | 'cdn' | 'storage' | 'worker' | 'external' | 'note'

export const COMPONENTS: { kind: ComponentKind; label: string; color: string }[] = [
  { kind: 'client', label: 'Client', color: '5' },
  { kind: 'lb', label: 'Load balancer', color: '6' },
  { kind: 'gateway', label: 'API gateway', color: '6' },
  { kind: 'service', label: 'Service', color: '4' },
  { kind: 'worker', label: 'Worker', color: '4' },
  { kind: 'database', label: 'Database', color: '1' },
  { kind: 'cache', label: 'Cache', color: '2' },
  { kind: 'queue', label: 'Queue', color: '3' },
  { kind: 'storage', label: 'Object storage', color: '1' },
  { kind: 'cdn', label: 'CDN', color: '5' },
  { kind: 'external', label: 'External API', color: '' },
  { kind: 'note', label: 'Note', color: '' }
]
const KINDS = new Set(COMPONENTS.map((c) => c.kind))

export interface CanvasNode {
  id: string
  type: 'text'
  text: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  kind?: ComponentKind
}

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide?: 'top' | 'right' | 'bottom' | 'left'
  toSide?: 'top' | 'right' | 'bottom' | 'left'
  toEnd?: 'arrow' | 'none'
  label?: string
}

export interface Canvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export const NODE_W = 180
export const NODE_H = 72
const GAP_X = 90
const GAP_Y = 50

export function parseCanvas(raw: string): Canvas {
  try {
    const data = JSON.parse(raw || '{}')
    const nodes = (Array.isArray(data.nodes) ? data.nodes : [])
      .filter((n: CanvasNode) => n && typeof n.id === 'string')
      .map((n: CanvasNode & { file?: string; url?: string; label?: string }) => ({
        id: n.id,
        type: 'text' as const,
        // Other node types (files, links, groups) come in as text so nothing is lost from view
        text: typeof n.text === 'string' ? n.text : n.file ?? n.url ?? n.label ?? '',
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        width: Number(n.width) || NODE_W,
        height: Number(n.height) || NODE_H,
        ...(n.color ? { color: String(n.color) } : {}),
        ...(n.kind && KINDS.has(n.kind) ? { kind: n.kind } : {})
      }))
    const ids = new Set(nodes.map((n: CanvasNode) => n.id))
    const edges = (Array.isArray(data.edges) ? data.edges : []).filter((e: CanvasEdge) => e && ids.has(e.fromNode) && ids.has(e.toNode))
    return { nodes, edges }
  } catch {
    return { nodes: [], edges: [] }
  }
}

export const serializeCanvas = (c: Canvas) => JSON.stringify({ nodes: c.nodes, edges: c.edges }, null, '\t') + '\n'

export const nodeLabel = (n: CanvasNode) => n.text.split('\n')[0].replace(/^#+\s*/, '').trim() || 'Untitled'
const kindLabel = (k?: ComponentKind) => COMPONENTS.find((c) => c.kind === k)?.label.toLowerCase() ?? 'box'

/** The design as plain text: every component with its id and kind, then every connection */
export function describeCanvas(c: Canvas): string {
  if (!c.nodes.length) return 'The canvas is empty.'
  const byId = new Map(c.nodes.map((n) => [n.id, n]))
  const nodes = c.nodes.map((n) => {
    const details = n.text.split('\n').slice(1).join(' ').trim()
    return `- [${n.id}] ${nodeLabel(n)} (${kindLabel(n.kind)})${details ? `: ${details}` : ''}`
  })
  const edges = c.edges.map((e) => `- ${nodeLabel(byId.get(e.fromNode)!)} [${e.fromNode}] -> ${nodeLabel(byId.get(e.toNode)!)} [${e.toNode}]${e.label ? `: ${e.label}` : ''}`)
  const linked = new Set(c.edges.flatMap((e) => [e.fromNode, e.toNode]))
  const loose = c.nodes.filter((n) => !linked.has(n.id) && n.kind !== 'note').map(nodeLabel)
  return [`Components (${c.nodes.length}):`, ...nodes, '', `Connections (${c.edges.length}):`, ...(edges.length ? edges : ['- none']), ...(loose.length ? ['', `Not connected to anything: ${loose.join(', ')}`] : [])].join('\n')
}

export type CanvasOp =
  | { op: 'add'; id?: string; label: string; kind?: string; details?: string; near?: string; side?: 'right' | 'below' | 'left' | 'above' }
  | { op: 'connect'; from: string; to: string; label?: string }
  | { op: 'update'; id: string; label?: string; kind?: string; details?: string }
  | { op: 'remove'; id: string }
  | { op: 'disconnect'; from: string; to: string }

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'node'

const overlaps = (c: Canvas, x: number, y: number, w: number, h: number) =>
  c.nodes.some((n) => x < n.x + n.width + 20 && x + w + 20 > n.x && y < n.y + n.height + 20 && y + h + 20 > n.y)

/** A free spot: beside the anchor if given, otherwise to the right of everything */
export function placeNode(c: Canvas, near?: CanvasNode, side: 'right' | 'below' | 'left' | 'above' = 'right', w = NODE_W, h = NODE_H): { x: number; y: number } {
  let x: number
  let y: number
  if (near) {
    x = side === 'right' ? near.x + near.width + GAP_X : side === 'left' ? near.x - w - GAP_X : near.x
    y = side === 'below' ? near.y + near.height + GAP_Y : side === 'above' ? near.y - h - GAP_Y : near.y
  } else if (c.nodes.length) {
    x = Math.max(...c.nodes.map((n) => n.x + n.width)) + GAP_X
    y = Math.min(...c.nodes.map((n) => n.y))
  } else {
    x = 0
    y = 0
  }
  // Step down (or across, for stacked layouts) until the spot is free
  for (let i = 0; i < 40 && overlaps(c, x, y, w, h); i++) {
    if (side === 'below' || side === 'above') x += w + 30
    else y += h + GAP_Y
  }
  return { x: Math.round(x), y: Math.round(y) }
}

/** Finds a node by id, or by its label when the model refers to it by name */
export function findNode(c: Canvas, ref: string): CanvasNode | undefined {
  const r = String(ref ?? '').trim()
  const lower = r.toLowerCase()
  return c.nodes.find((n) => n.id === r) ?? c.nodes.find((n) => nodeLabel(n).toLowerCase() === lower) ?? c.nodes.find((n) => nodeLabel(n).toLowerCase().includes(lower) && lower.length > 2)
}

const kindOf = (k?: string): ComponentKind | undefined => {
  const v = String(k ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const alias: Record<string, ComponentKind> = { loadbalancer: 'lb', db: 'database', sql: 'database', nosql: 'database', redis: 'cache', kafka: 'queue', topic: 'queue', stream: 'queue', s3: 'storage', blob: 'storage', api: 'service', server: 'service', apigateway: 'gateway', user: 'client', browser: 'client', mobile: 'client', thirdparty: 'external', job: 'worker', consumer: 'worker' }
  return KINDS.has(v as ComponentKind) ? (v as ComponentKind) : alias[v]
}

const colorFor = (k?: ComponentKind) => COMPONENTS.find((c) => c.kind === k)?.color || undefined

export function makeNode(c: Canvas, opts: { label: string; kind?: ComponentKind; details?: string; x: number; y: number; id?: string }): CanvasNode {
  const taken = new Set(c.nodes.map((n) => n.id))
  let id = opts.id && !taken.has(opts.id) ? opts.id : slug(opts.label)
  for (let i = 2; taken.has(id); i++) id = `${slug(opts.label)}-${i}`
  const color = colorFor(opts.kind)
  return {
    id,
    type: 'text',
    text: opts.details?.trim() ? `${opts.label}\n${opts.details.trim()}` : opts.label,
    x: opts.x,
    y: opts.y,
    width: NODE_W,
    height: opts.details?.trim() ? NODE_H + 24 : NODE_H,
    ...(color ? { color } : {}),
    ...(opts.kind ? { kind: opts.kind } : {})
  }
}

export function connect(c: Canvas, from: string, to: string, label?: string): Canvas {
  if (from === to || c.edges.some((e) => e.fromNode === from && e.toNode === to)) return c
  const taken = new Set(c.edges.map((e) => e.id))
  let id = `${from}-${to}`
  for (let i = 2; taken.has(id); i++) id = `${from}-${to}-${i}`
  return { ...c, edges: [...c.edges, { id, fromNode: from, toNode: to, toEnd: 'arrow', ...(label?.trim() ? { label: label.trim() } : {}) }] }
}

/**
 * Small models don't always use the exact field names: accept the usual synonyms ("action" for
 * op, "name" for label, "source"/"target" for from/to, "add_node", "connect_nodes"...).
 */
export function normalizeOp(raw: unknown): CanvasOp | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const str = (...keys: string[]) => {
    for (const k of keys) if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim()
    return undefined
  }
  const verb = (str('op', 'action', 'type', 'operation', 'command') ?? '').toLowerCase()
  const from = str('from', 'source', 'fromNode', 'from_node', 'start')
  const to = str('to', 'target', 'toNode', 'to_node', 'end')
  const label = str('label', 'name', 'text', 'title', 'component')
  const id = str('id', 'node', 'nodeId', 'node_id')
  const op = /^(add|create|new|insert)/.test(verb)
    ? 'add'
    : /^(connect|link|edge|arrow)/.test(verb)
      ? 'connect'
      : /^(update|rename|edit|change|set)/.test(verb)
        ? 'update'
        : /^(remove|delete)/.test(verb)
          ? 'remove'
          : /^(disconnect|unlink)/.test(verb)
            ? 'disconnect'
            : // No verb: infer it from the fields
              from && to
              ? 'connect'
              : label
                ? 'add'
                : null
  if (op === 'add') return { op, label: label ?? id ?? '', id: label ? id : undefined, kind: str('kind', 'category', 'componentType', 'component_type'), details: str('details', 'description', 'note', 'subtitle'), near: str('near', 'beside', 'after', 'next_to'), side: str('side', 'position') as 'right' | undefined }
  if (op === 'connect' || op === 'disconnect') return from && to ? { op, from, to, ...(op === 'connect' ? { label: str('label', 'text', 'protocol', 'description') } : {}) } : null
  if (op === 'update') return id || label ? { op, id: (id ?? label)!, label: id ? label : str('new_label', 'newLabel', 'rename'), kind: str('kind'), details: str('details', 'description') } : null
  if (op === 'remove') return id || label ? { op, id: (id ?? label)! } : null
  return null
}

/** Applies the tutor's (or the editor's) operations in order; returns the new canvas and what happened */
export function applyCanvasOps(start: Canvas, rawOps: unknown[]): { canvas: Canvas; log: string[] } {
  let c = start
  const log: string[] = []
  for (const op of rawOps.map(normalizeOp)) {
    if (!op) {
      log.push('skipped an operation that has no op (add, connect, update, remove, disconnect)')
      continue
    }
    if (op.op === 'add') {
      const label = String(op.label ?? '').trim()
      if (!label) {
        log.push('skipped an add with no label')
        continue
      }
      const near = op.near ? findNode(c, op.near) : undefined
      const kind = kindOf(op.kind) ?? 'service'
      const pos = placeNode(c, near, op.side)
      const node = makeNode(c, { label, kind, details: op.details, ...pos, id: op.id ? slug(op.id) : undefined })
      c = { ...c, nodes: [...c.nodes, node] }
      log.push(`added ${label} [${node.id}]`)
    } else if (op.op === 'connect') {
      const a = findNode(c, op.from)
      const b = findNode(c, op.to)
      if (!a || !b) {
        log.push(`couldn't connect ${op.from} to ${op.to}: no such component`)
        continue
      }
      c = connect(c, a.id, b.id, op.label)
      log.push(`connected ${nodeLabel(a)} -> ${nodeLabel(b)}`)
    } else if (op.op === 'update') {
      const n = findNode(c, op.id)
      if (!n) {
        log.push(`couldn't find ${op.id}`)
        continue
      }
      const lines = n.text.split('\n')
      const label = op.label?.trim() || lines[0]
      const details = op.details !== undefined ? op.details.trim() : lines.slice(1).join('\n')
      const kind = op.kind ? kindOf(op.kind) ?? n.kind : n.kind
      const next: CanvasNode = { ...n, text: details ? `${label}\n${details}` : label, ...(kind ? { kind, color: colorFor(kind) } : {}) }
      if (!next.color) delete next.color
      c = { ...c, nodes: c.nodes.map((x) => (x.id === n.id ? next : x)) }
      log.push(`updated ${label}`)
    } else if (op.op === 'remove') {
      const n = findNode(c, op.id)
      if (!n) {
        log.push(`couldn't find ${op.id}`)
        continue
      }
      c = { nodes: c.nodes.filter((x) => x.id !== n.id), edges: c.edges.filter((e) => e.fromNode !== n.id && e.toNode !== n.id) }
      log.push(`removed ${nodeLabel(n)}`)
    } else if (op.op === 'disconnect') {
      const a = findNode(c, op.from)
      const b = findNode(c, op.to)
      const before = c.edges.length
      if (a && b) c = { ...c, edges: c.edges.filter((e) => !((e.fromNode === a.id && e.toNode === b.id) || (e.fromNode === b.id && e.toNode === a.id))) }
      log.push(c.edges.length < before ? `disconnected ${op.from} and ${op.to}` : `no connection between ${op.from} and ${op.to}`)
    }
  }
  return { canvas: c, log }
}

// ---------- Redraw from memory ----------

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'to', 'service', 'server', 'db', 'api', 'layer', 'system'])
const words = (n: CanvasNode) =>
  new Set(
    nodeLabel(n)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/s$/, ''))
      .filter((w) => w.length > 1 && !STOP.has(w))
  )

function similarity(a: CanvasNode, b: CanvasNode): number {
  const wa = words(a)
  const wb = words(b)
  const shared = [...wa].filter((w) => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  const text = union ? shared / union : 0
  const sameKind = (a.kind ?? 'service') === (b.kind ?? 'service')
  // Same kind and some shared words is a match; same kind alone counts for less
  return (sameKind ? 0.45 : 0) + text * 0.55
}

export interface DesignComparison {
  matched: { reference: string; yours: string }[]
  missing: string[]
  extra: string[]
  connectionsFound: number
  connectionsMissing: string[]
  /** 0..1: matched components and connections over everything in the reference */
  score: number
}

/**
 * Compares a design redrawn from memory with the original: components are paired by kind and
 * name (best pairs first), then each connection in the original is looked for between the paired
 * components, in either direction.
 */
export function compareDesigns(reference: Canvas, attempt: Canvas): DesignComparison {
  const ref = reference.nodes.filter((n) => n.kind !== 'note')
  const mine = attempt.nodes.filter((n) => n.kind !== 'note')
  const pairs = ref.flatMap((r) => mine.map((m) => ({ r, m, s: similarity(r, m) }))).filter((p) => p.s >= 0.45).sort((a, b) => b.s - a.s)
  const toMine = new Map<string, CanvasNode>()
  const used = new Set<string>()
  for (const p of pairs) {
    if (toMine.has(p.r.id) || used.has(p.m.id)) continue
    toMine.set(p.r.id, p.m)
    used.add(p.m.id)
  }
  const refIds = new Set(ref.map((n) => n.id))
  const refEdges = reference.edges.filter((e) => refIds.has(e.fromNode) && refIds.has(e.toNode))
  const byId = new Map(ref.map((n) => [n.id, n]))
  let found = 0
  const connectionsMissing: string[] = []
  for (const e of refEdges) {
    const a = toMine.get(e.fromNode)
    const b = toMine.get(e.toNode)
    const there = a && b && attempt.edges.some((x) => (x.fromNode === a.id && x.toNode === b.id) || (x.fromNode === b.id && x.toNode === a.id))
    if (there) found++
    else connectionsMissing.push(`${nodeLabel(byId.get(e.fromNode)!)} -> ${nodeLabel(byId.get(e.toNode)!)}${e.label ? ` (${e.label})` : ''}`)
  }
  const total = ref.length + refEdges.length
  return {
    matched: ref.filter((r) => toMine.has(r.id)).map((r) => ({ reference: nodeLabel(r), yours: nodeLabel(toMine.get(r.id)!) })),
    missing: ref.filter((r) => !toMine.has(r.id)).map(nodeLabel),
    extra: mine.filter((m) => !used.has(m.id)).map(nodeLabel),
    connectionsFound: found,
    connectionsMissing,
    score: total ? (toMine.size + found) / total : 0
  }
}

export function describeComparison(c: DesignComparison): string {
  return [
    `Score: ${Math.round(c.score * 100)}% of the original's components and connections.`,
    `Recalled (${c.matched.length}): ${c.matched.map((m) => (m.reference === m.yours ? m.reference : `${m.reference} (drawn as "${m.yours}")`)).join(', ') || 'none'}`,
    `Missing (${c.missing.length}): ${c.missing.join(', ') || 'none'}`,
    `Added, not in the original (${c.extra.length}): ${c.extra.join(', ') || 'none'}`,
    `Connections recalled: ${c.connectionsFound}; missing: ${c.connectionsMissing.join('; ') || 'none'}`
  ].join('\n')
}
