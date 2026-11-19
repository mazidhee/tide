import '@xyflow/react/dist/base.css'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd
} from '@xyflow/react'
import { COMPONENTS, isConceptMap, MAP_KINDS, SYSTEM_KINDS, connect, groupAround, makeNode, nodeLabel, placeNode, type Canvas, type CanvasEdge, type CanvasNode, type ComponentKind } from '@shared/canvas'
import { tidyCanvas } from '@shared/flowLayout'
import { Icon, type IconName } from './Icon'
import { EdgeContext, EDGE_TYPES, Markers, type EdgeHooks } from './flow/FlowEdge'
import { toFlowEdges, toFlowNodes, withFlowGeometry, type FlowEdge, type FlowNode } from './flow/model'
import { EditorContext, KindIcon, kindName, NODE_TYPES, type EditorHooks } from './flow/nodes'
import { usePlayer, type Player } from './flow/usePlayer'

interface Props {
  canvas: Canvas
  onChange(next: Canvas): void
  /** Shown on an empty canvas: open a finished example instead */
  onExample?(): void
  /** Bumped when the canvas is replaced from outside (the tutor drew on it), to re-fit if needed */
  version: number
  /** Beside a lesson: smaller controls, the drawing fitted to a narrow panel */
  compact?: boolean
  /** A figure in a message: look, pan, play the flow; nothing moves or changes */
  readOnly?: boolean
  /** Edges to play once as they arrive (what the tutor just drew); a new nonce plays again */
  announce?: { ids: string[]; nonce: number }
  /** Vault files a file card can point at */
  files?: string[]
  openFile?(path: string): void
  readFile?(path: string): Promise<string>
}

const GRID = 20
// Two sets of parts: a concept map's ideas, and a system's components
const PALETTES = { map: MAP_KINDS, system: SYSTEM_KINDS } as const
type PaletteSet = keyof typeof PALETTES

// Copy and paste between canvases in one window
let clipboard: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null = null

const pref = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(`tide.canvas.${key}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}
const setPref = (key: string, v: boolean) => {
  try {
    localStorage.setItem(`tide.canvas.${key}`, v ? '1' : '0')
  } catch {
    // private storage; the choice lasts this session
  }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'

/**
 * The canvas: system designs, and the diagrams the tutor draws in lessons, on xyflow. The file
 * stays JSON Canvas, so it opens in Obsidian too. Drag parts in from the palette, drag from a
 * dot to connect, double-click to rename; group, snap, tidy, undo, and play a request along the
 * connections one step at a time.
 */
export function CanvasEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  )
}

function Editor({ canvas, onChange, onExample, version, compact, readOnly = false, announce, files, openFile, readFile }: Props) {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const wrapRef = useRef<HTMLDivElement>(null)
  const markers = `cvm${useId().replace(/[^a-z0-9]/gi, '')}`
  const latest = useRef(canvas)
  latest.current = canvas

  // ---------- History ----------
  const undoStack = useRef<Canvas[]>([])
  const redoStack = useRef<Canvas[]>([])
  const [, setHistoryTick] = useState(0)
  const commit = useCallback(
    (next: Canvas, base: Canvas = latest.current) => {
      if (next === base) return
      undoStack.current = [...undoStack.current.slice(-120), base]
      redoStack.current = []
      setHistoryTick((t) => t + 1)
      latest.current = next
      onChange(next)
    },
    [onChange]
  )
  const travel = useCallback(
    (back: boolean) => {
      const from = back ? undoStack.current : redoStack.current
      const to = back ? redoStack.current : undoStack.current
      const prev = from.pop()
      if (!prev) return
      to.push(latest.current)
      setHistoryTick((t) => t + 1)
      latest.current = prev
      onChange(prev)
    },
    [onChange]
  )

  // ---------- Nodes: xyflow owns them while you drag; the canvas is written when you let go ----------
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(canvas))
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  // Parts just added (or pasted) are selected once they exist
  const pendingSelect = useRef<string[] | null>(null)
  useEffect(() => {
    // Updaters stay pure (React may run them twice); the pending selection is taken here
    const want = pendingSelect.current && pendingSelect.current.every((id) => canvas.nodes.some((n) => n.id === id)) ? pendingSelect.current : null
    if (want) pendingSelect.current = null
    setNodes((prev) => {
      const next = toFlowNodes(canvas, new Map(prev.map((n) => [n.id, n])))
      return want ? next.map((n) => (want.includes(n.id) !== !!n.selected ? { ...n, selected: want.includes(n.id) } : n)) : next
    })
  }, [canvas])

  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [editingEdge, setEditingEdge] = useState<string | null>(null)
  const [snap, setSnap] = useState(() => pref('snap', true))
  const [minimap, setMinimap] = useState(() => pref('minimap', !compact))
  const [help, setHelp] = useState(false)
  const [filePick, setFilePick] = useState(false)
  const player = usePlayer(canvas)

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const next = applyNodeChanges(changes, nodesRef.current)
      nodesRef.current = next
      setNodes(next)
      // A resize has ended: write the new size (and position, when pulled from the top or left)
      if (changes.some((c) => c.type === 'dimensions' && c.resizing === false)) commit(withFlowGeometry(latest.current, next))
    },
    [commit]
  )
  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const sel = changes.filter((c) => c.type === 'select')
    if (!sel.length) return
    setSelectedEdges((prev) => {
      const s = new Set(prev)
      for (const c of sel) if (c.type === 'select') (c.selected ? s.add(c.id) : s.delete(c.id))
      return s
    })
  }, [])

  const edges = useMemo(() => toFlowEdges(canvas, selectedEdges, player.flow), [canvas, selectedEdges, player.flow])
  const shownNodes = useMemo(() => {
    if (!player.at && !player.from) return nodes
    return nodes.map((n) => (n.id === player.at ? { ...n, className: 'flow-at' } : n.id === player.from ? { ...n, className: 'flow-from' } : n))
  }, [nodes, player.at, player.from])

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes])

  // ---------- Viewport ----------
  const touched = useRef(false)
  // A narrow canvas (the tutor open beside it on a laptop) gets an icon-only palette
  const [narrow, setNarrow] = useState(false)
  const narrowRef = useRef(false)
  narrowRef.current = narrow
  // Which parts the palette offers: what's on the canvas says; an empty lesson canvas starts as a map
  const [paletteSet, setPaletteSet] = useState<PaletteSet>(() => (canvas.nodes.length ? (isConceptMap(canvas) ? 'map' : 'system') : compact ? 'map' : 'system'))
  const palette = PALETTES[paletteSet]
  // Fit into the room the floating controls leave: beside the palette, above the toolbar
  const fit = useCallback(
    (duration = 0) => {
      const wrap = wrapRef.current
      if (!wrap || !wrap.clientWidth) return
      const all = rf.getNodes()
      const left = readOnly ? 0 : narrowRef.current ? 64 : 176
      // A figure's caption sits above the drawing while a flow plays
      const top = readOnly ? 40 : 8
      // Room for the toolbar, and in a narrow panel for the caption a playing flow shows above it
      const bottom = compact && !readOnly ? 100 : 58
      const pad = compact ? 18 : 36
      const w = wrap.clientWidth - left - 2 * pad
      const h = wrap.clientHeight - top - bottom - 2 * pad
      if (!all.length || w <= 0 || h <= 0) return rf.setViewport({ x: left + w / 2, y: top + h / 2, zoom: 1 }, { duration })
      const b = rf.getNodesBounds(all)
      const k = Math.min(compact ? 1 : 1.15, Math.max(0.1, Math.min(w / b.width, h / b.height)))
      rf.setViewport({ x: left + pad + (w - b.width * k) / 2 - b.x * k, y: top + pad + (h - b.height * k) / 2 - b.y * k, zoom: k }, { duration })
    },
    [rf, compact, readOnly]
  )
  // A narrow panel keeps fitting the drawing as it settles, until you move the view
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => {
      setNarrow(wrap.clientWidth < 880)
      if (!touched.current) requestAnimationFrame(() => fit())
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [fit])
  // The tutor drew: bring anything out of view into it
  useEffect(() => {
    if (!version) return
    const wrap = wrapRef.current
    if (!wrap) return
    const t = setTimeout(() => {
      const v = rf.getViewport()
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const out = latest.current.nodes.some((n) => {
        const x = n.x * v.zoom + v.x
        const y = n.y * v.zoom + v.y
        return x < 0 || y < 0 || x + n.width * v.zoom > w || y + n.height * v.zoom > h - 56
      })
      if (out || !touched.current) fit(350)
    }, 60)
    return () => clearTimeout(t)
  }, [version, rf, fit])

  // ---------- The tutor's new steps play as they arrive ----------
  const lastAnnounce = useRef(0)
  useEffect(() => {
    if (!announce || announce.nonce === lastAnnounce.current) return
    lastAnnounce.current = announce.nonce
    const t = setTimeout(() => player.announce(announce.ids), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announce])

  // ---------- Adding ----------
  const centre = useCallback(() => {
    const wrap = wrapRef.current!
    const r = wrap.getBoundingClientRect()
    return rf.screenToFlowPosition({ x: r.left + r.width / 2 + (readOnly ? 0 : narrowRef.current ? 32 : 70), y: r.top + r.height / 2 })
  }, [rf, readOnly])

  const selectOnly = useCallback((ids: string[]) => {
    // Not drawn yet: select it when it is
    if (!ids.every((id) => nodesRef.current.some((n) => n.id === id))) pendingSelect.current = ids
    setNodes((ns) => ns.map((n) => (ids.includes(n.id) !== !!n.selected ? { ...n, selected: ids.includes(n.id) } : n)))
    setSelectedEdges(new Set())
  }, [])

  const snapped = (v: number) => (snap ? Math.round(v / GRID) * GRID : Math.round(v))

  const addKind = useCallback(
    (kind: ComponentKind, at?: { x: number; y: number }) => {
      const c = latest.current
      const label = kind === 'note' ? 'Note' : COMPONENTS.find((k) => k.kind === kind)!.label
      const sel = selectedNodes.length === 1 ? c.nodes.find((n) => n.id === selectedNodes[0] && n.type !== 'group') : undefined
      let pos: { x: number; y: number }
      if (at) pos = { x: snapped(at.x - 90), y: snapped(at.y - 36) }
      else if (sel) pos = placeNode(c, sel, 'right')
      else {
        const m = centre()
        pos = placeNode({ ...c, nodes: c.nodes.filter((n) => Math.abs(n.x - m.x) < 400 && Math.abs(n.y - m.y) < 300) }, undefined, 'right')
        if (!c.nodes.length || pos.x > m.x + 300) pos = { x: snapped(m.x - 90), y: snapped(m.y - 36) }
      }
      const node = makeNode(c, { label, kind, ...pos })
      const added = { ...c, nodes: [...c.nodes, node] }
      // From the palette with one part selected: the new part follows on from it
      commit(sel && !at && kind !== 'note' ? connect(added, sel.id, node.id) : added)
      selectOnly([node.id])
      setEditing(node.id)
    },
    [commit, centre, selectedNodes, selectOnly, snap] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const addFile = (path: string) => {
    const c = latest.current
    const m = centre()
    const taken = new Set(c.nodes.map((n) => n.id))
    let id = `file-${(path.split('/').pop() ?? 'file').replace(/\W+/g, '-').toLowerCase()}`.slice(0, 40)
    for (let i = 2; taken.has(id); i++) id = `${id.replace(/-\d+$/, '')}-${i}`
    const node: CanvasNode = { id, type: 'file', file: path, x: snapped(m.x - 130), y: snapped(m.y - 80), width: 260, height: 160 }
    commit({ ...c, nodes: [...c.nodes, node] })
    setFilePick(false)
    selectOnly([id])
  }

  const group = useCallback(() => {
    const c = latest.current
    const members = c.nodes.filter((n) => selectedNodes.includes(n.id) && n.type !== 'group')
    let g: CanvasNode
    if (members.length) g = groupAround(c, members, 'Group')
    else {
      const m = centre()
      g = { ...groupAround(c, [{ id: 'x', type: 'text', x: m.x - 160, y: m.y - 100, width: 320, height: 200 }], 'Group', 0) }
    }
    commit({ ...c, nodes: [g, ...c.nodes] })
    selectOnly([g.id])
    setEditing(g.id)
  }, [commit, selectedNodes, centre, selectOnly])

  const ungroup = useCallback(() => {
    const c = latest.current
    const groups = new Set(c.nodes.filter((n) => selectedNodes.includes(n.id) && n.type === 'group').map((n) => n.id))
    if (groups.size) commit({ ...c, nodes: c.nodes.filter((n) => !groups.has(n.id)), edges: c.edges.filter((e) => !groups.has(e.fromNode) && !groups.has(e.toNode)) })
  }, [commit, selectedNodes])

  // ---------- Removing, copying ----------
  const removeSelected = useCallback(() => {
    const c = latest.current
    const ids = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id))
    if (!ids.size && !selectedEdges.size) return
    commit({ ...c, nodes: c.nodes.filter((n) => !ids.has(n.id)), edges: c.edges.filter((e) => !ids.has(e.fromNode) && !ids.has(e.toNode) && !selectedEdges.has(e.id)) })
    setSelectedEdges(new Set())
  }, [commit, selectedEdges])

  const copy = useCallback(() => {
    const c = latest.current
    const ids = new Set(selectedNodes)
    if (!ids.size) return false
    clipboard = { nodes: c.nodes.filter((n) => ids.has(n.id)), edges: c.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) }
    return true
  }, [selectedNodes])

  const pasteCount = useRef(0)
  const paste = useCallback(() => {
    if (!clipboard?.nodes.length) return
    const c = latest.current
    const taken = new Set([...c.nodes.map((n) => n.id), ...c.edges.map((e) => e.id)])
    const fresh = (id: string) => {
      let n = `${id.replace(/-copy(-\d+)?$/, '')}-copy`
      for (let i = 2; taken.has(n); i++) n = `${id.replace(/-copy(-\d+)?$/, '')}-copy-${i}`
      taken.add(n)
      return n
    }
    const off = GRID * 2 * ++pasteCount.current
    const ids = new Map(clipboard.nodes.map((n) => [n.id, fresh(n.id)]))
    const nodes = clipboard.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, x: n.x + off, y: n.y + off }))
    const edges = clipboard.edges.map((e) => ({ ...e, id: fresh(e.id), fromNode: ids.get(e.fromNode)!, toNode: ids.get(e.toNode)! }))
    // Groups go first so they stay behind what they hold
    commit({ ...c, nodes: [...nodes.filter((n) => n.type === 'group'), ...c.nodes, ...nodes.filter((n) => n.type !== 'group')], edges: [...c.edges, ...edges] })
    selectOnly([...ids.values()])
  }, [commit, selectOnly])

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const ids = new Set(selectedNodes)
      if (!ids.size) return
      const c = latest.current
      // A group carries what it holds
      const moving = new Set(ids)
      for (const g of c.nodes.filter((n) => ids.has(n.id) && n.type === 'group'))
        for (const n of c.nodes) if (n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height) moving.add(n.id)
      commit({ ...c, nodes: c.nodes.map((n) => (moving.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) })
    },
    [commit, selectedNodes]
  )

  const tidy = useCallback(() => {
    commit(tidyCanvas(latest.current, compact ? 'TB' : 'LR'))
    setTimeout(() => fit(400), 60)
  }, [commit, compact, fit])

  const setKind = (id: string, kind: ComponentKind) => {
    const c = latest.current
    const color = COMPONENTS.find((k) => k.kind === kind)?.color
    commit({
      ...c,
      nodes: c.nodes.map((n) => {
        if (n.id !== id) return n
        const next: CanvasNode = { ...n, kind }
        if (color) next.color = color
        else delete next.color
        return next
      })
    })
  }
  const updateEdge = (id: string, patch: Partial<CanvasEdge>) => {
    const c = latest.current
    commit({
      ...c,
      edges: c.edges.map((e) => {
        if (e.id !== id) return e
        const next: CanvasEdge = { ...e, ...patch }
        for (const k of Object.keys(patch) as (keyof CanvasEdge)[]) if (patch[k] === undefined || patch[k] === false) delete next[k]
        return next
      })
    })
  }

  // ---------- Hooks the nodes and edges call ----------
  const editorHooks = useMemo<EditorHooks>(
    () => ({
      readOnly,
      editing,
      setEditing,
      saveText: (id, text) => {
        setEditing(null)
        const c = latest.current
        const n = c.nodes.find((x) => x.id === id)
        if (!n || !text || text === n.text) return
        const lines = text.split('\n').length
        commit({ ...c, nodes: c.nodes.map((x) => (x.id === id ? { ...x, text, height: Math.max(x.height, (x.kind && x.kind !== 'note' ? 64 : 40) + lines * 20) } : x)) })
      },
      saveGroupLabel: (id, label) => {
        setEditing(null)
        const c = latest.current
        if (c.nodes.find((x) => x.id === id)?.label !== label) commit({ ...c, nodes: c.nodes.map((x) => (x.id === id ? { ...x, label } : x)) })
      },
      openFile,
      readFile
    }),
    [readOnly, editing, commit, openFile, readFile]
  )
  const edgeHooks = useMemo<EdgeHooks>(
    () => ({
      markers,
      readOnly,
      editingEdge,
      setEditingEdge,
      saveLabel: (id, label) => {
        setEditingEdge(null)
        const e = latest.current.edges.find((x) => x.id === id)
        if (e && (e.label ?? '') !== label) updateEdge(id, { label: label || undefined })
      },
      reducedMotion: reducedMotion()
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, readOnly, editingEdge, commit]
  )

  // ---------- Connecting ----------
  const onConnect = useCallback((p: { source: string; target: string }) => commit(connect(latest.current, p.source, p.target)), [commit])
  // Let go over a box rather than its dot: connect to the box
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode) return
      const pt = 'changedTouches' in event ? event.changedTouches[0] : event
      const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest<HTMLElement>('.react-flow__node')
      const target = el?.dataset.id
      if (target && target !== state.fromNode.id && latest.current.nodes.find((n) => n.id === target)?.type !== 'group') commit(connect(latest.current, state.fromNode.id, target))
    },
    [commit]
  )

  // ---------- Keyboard ----------
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, [contenteditable="true"]')) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (k === '?' || (e.shiftKey && k === '/')) return handled(), setHelp((h) => !h)
    if (k === 'escape') {
      if (help) return handled(), setHelp(false)
      if (player.index >= 0) return handled(), player.stop()
      return handled(), selectOnly([])
    }
    if (player.index >= 0 && !mod && (k === 'arrowright' || k === 'arrowleft') && !selectedNodes.length) return handled(), k === 'arrowright' ? player.next() : player.prev()
    if (k === 'p' && !mod) return handled(), player.playing ? player.pause() : player.play()
    if (k === 'f' && !mod) return handled(), fit(300)
    if ((k === '1' && e.shiftKey) || (k === '!' && e.shiftKey)) return handled(), fit(300)
    if (mod && (k === '=' || k === '+')) return handled(), rf.zoomIn({ duration: 180 })
    if (mod && k === '-') return handled(), rf.zoomOut({ duration: 180 })
    if (mod && k === '0') return handled(), rf.zoomTo(1, { duration: 180 })
    if (readOnly) return
    if (mod && k === 'z') return handled(), travel(!e.shiftKey)
    if (mod && k === 'y') return handled(), travel(false)
    if (mod && k === 'a') return handled(), selectOnly(latest.current.nodes.map((n) => n.id))
    if (mod && k === 'c') return copy() && handled()
    if (mod && k === 'x') {
      if (copy()) {
        handled()
        removeSelected()
      }
      return
    }
    if (mod && k === 'v') return handled(), paste()
    if (mod && k === 'd') return handled(), copy() && paste()
    if (mod && k === 'g') return handled(), e.shiftKey ? ungroup() : group()
    if (k === 'enter' && selectedNodes.length === 1) return handled(), setEditing(selectedNodes[0])
    if (k === 'n' && !mod) return handled(), addKind('note')
    if (k === 't' && !mod && !e.shiftKey) return handled(), tidy()
    if (k.startsWith('arrow') && selectedNodes.length) {
      const step = e.shiftKey ? GRID : snap ? GRID / 2 : 1
      handled()
      return nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0)
    }
  }

  // ---------- Dropping from the palette ----------
  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData('application/x-tide-kind') as ComponentKind
    if (!kind) return
    e.preventDefault()
    addKind(kind, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }

  const single = selectedNodes.length === 1 ? canvas.nodes.find((n) => n.id === selectedNodes[0]) : undefined
  const singleEdge = selectedEdges.size === 1 && !selectedNodes.length ? canvas.edges.find((e) => selectedEdges.has(e.id)) : undefined
  const many = nodes.length > 200

  return (
    <EditorContext.Provider value={editorHooks}>
      <EdgeContext.Provider value={edgeHooks}>
        <div
          ref={wrapRef}
          className={`cv${compact ? ' compact' : ''}${narrow ? ' narrow' : ''}${readOnly ? ' read-only' : ''}${player.index >= 0 ? ' playing' : ''}`}
          onKeyDown={onKeyDown}
          onDragOver={(e) => e.dataTransfer.types.includes('application/x-tide-kind') && e.preventDefault()}
          onDrop={onDrop}
          onDoubleClick={(e) => {
            if (readOnly || !(e.target as HTMLElement).classList.contains('react-flow__pane')) return
            addKind('service', rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
          }}
        >
          <Markers id={markers} />
          <ReactFlow<FlowNode, FlowEdge>
            nodes={shownNodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={() => commit(withFlowGeometry(latest.current, nodesRef.current))}
            onSelectionDragStop={() => commit(withFlowGeometry(latest.current, nodesRef.current))}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onBeforeDelete={async () => {
              removeSelected()
              return false
            }}
            onEdgeDoubleClick={(_, edge) => !readOnly && setEditingEdge(edge.id)}
            onMoveStart={(ev) => {
              if (ev) touched.current = true
            }}
            onPaneClick={() => {
              setEditing(null)
              setFilePick(false)
            }}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={28}
            snapToGrid={snap && !readOnly}
            snapGrid={[GRID, GRID]}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable={!readOnly}
            edgesFocusable={!readOnly}
            nodesFocusable={!readOnly}
            selectionMode={SelectionMode.Partial}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={isMac ? 'Meta' : 'Control'}
            deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
            panOnScroll={!readOnly}
            zoomOnScroll={false}
            zoomOnPinch
            zoomActivationKeyCode={isMac ? 'Meta' : 'Control'}
            zoomOnDoubleClick={false}
            preventScrolling={!readOnly}
            minZoom={0.1}
            maxZoom={2.5}
            onInit={() => requestAnimationFrame(() => fit())}
            onlyRenderVisibleElements={many}
            elevateNodesOnSelect={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.2} className="cv-bg" />
            {minimap && !readOnly && !narrow && <MiniMap position="bottom-right" pannable zoomable className="cv-minimap" nodeClassName={(n) => `mm k-${(n as FlowNode).data.node.kind ?? (n as FlowNode).data.node.type}`} nodeBorderRadius={4} ariaLabel="Overview of the canvas" />}

            {!readOnly && (
              <Panel position="top-left" className="cv-palette" aria-label="Add a part">
                <div className="cv-pal-sets" role="radiogroup" aria-label="Parts for">
                  {(['map', 'system'] as const).map((set) => (
                    <button key={set} role="radio" aria-checked={paletteSet === set} className={paletteSet === set ? 'on' : ''} onClick={() => setPaletteSet(set)} title={set === 'map' ? 'Concept map: ideas, examples, questions' : 'System design: services, databases, queues'}>
                      <KindIcon kind={set === 'map' ? 'concept' : 'service'} size={13} />
                      <span>{set === 'map' ? 'Map' : 'System'}</span>
                    </button>
                  ))}
                </div>
                {palette.map((kind) => (
                  <button
                    key={kind}
                    className={`cv-pal k-${kind}`}
                    onClick={() => addKind(kind)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-tide-kind', kind)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    title={`Add ${kindName(kind)?.toLowerCase()} (or drag it in)`}
                  >
                    <span className="cvn-icon">
                      <KindIcon kind={kind} size={13} />
                    </span>
                    <span>{kindName(kind)}</span>
                  </button>
                ))}
                <span className="cv-pal-rule" />
                {files && (
                  <button className="cv-pal k-file" onClick={() => setFilePick((f) => !f)} title="Add a note or file from your vault">
                    <span className="cvn-icon">
                      <KindIcon kind="file" size={13} />
                    </span>
                    <span>File</span>
                  </button>
                )}
                <button className="cv-pal k-group" onClick={group} title={`Group the selection (${MOD}G)`}>
                  <span className="cvn-icon">
                    <Icon name="group" size={13} />
                  </span>
                  <span>Group</span>
                </button>
              </Panel>
            )}
            {filePick && files && <FilePicker files={files} onPick={addFile} onClose={() => setFilePick(false)} />}

            {!readOnly && (single || singleEdge) && player.index < 0 && (
              <Panel position="top-center" className="cv-inspect" aria-label="Selection">
                {single && single.type === 'text' && (
                  <>
                    {(single.kind && !palette.includes(single.kind) ? [...palette, single.kind] : palette).map((k) => (
                      <button key={k} className={`cv-chip k-${k}${single.kind === k ? ' on' : ''}`} onClick={() => setKind(single.id, k)} title={kindName(k)} aria-pressed={single.kind === k}>
                        <KindIcon kind={k} size={13} />
                      </button>
                    ))}
                    <span className="cv-sep" />
                  </>
                )}
                {single && single.type === 'group' && <span className="cv-inspect-name">{nodeLabel(single)}</span>}
                {single && single.type === 'group' && (
                  <button className="cv-tb" onClick={ungroup} title={`Ungroup (⇧${MOD}G)`}>
                    <span>Ungroup</span>
                  </button>
                )}
                {singleEdge && (
                  <>
                    <button className="cv-tb" onClick={() => setEditingEdge(singleEdge.id)} title="Label (double-click the line)">
                      <Icon name="edit" size={14} />
                      <span>{singleEdge.label ? 'Rename' : 'Label'}</span>
                    </button>
                    <button className={`cv-tb${singleEdge.animated ? ' on' : ''}`} aria-pressed={!!singleEdge.animated} onClick={() => updateEdge(singleEdge.id, { animated: !singleEdge.animated })} title="Show it flowing all the time">
                      <Icon name="flow" size={14} />
                      <span>Flowing</span>
                    </button>
                    <button className={`cv-tb${singleEdge.dashed ? ' on' : ''}`} aria-pressed={!!singleEdge.dashed} onClick={() => updateEdge(singleEdge.id, { dashed: !singleEdge.dashed })} title="Dashed: async or optional">
                      <span className="cv-dash" aria-hidden="true" />
                      <span>Dashed</span>
                    </button>
                    <button
                      className="cv-tb"
                      onClick={() => {
                        // → then ↔ then — then →
                        const both = singleEdge.fromEnd === 'arrow'
                        const none = singleEdge.toEnd === 'none'
                        updateEdge(singleEdge.id, both ? { fromEnd: undefined, toEnd: 'none' } : none ? { toEnd: undefined } : { fromEnd: 'arrow' })
                      }}
                      title="Arrowheads"
                    >
                      <span className="cv-arrows">{singleEdge.fromEnd === 'arrow' ? '↔' : singleEdge.toEnd === 'none' ? '—' : '→'}</span>
                    </button>
                    <span className="cv-sep" />
                  </>
                )}
                <button className="cv-tb danger" onClick={removeSelected} title="Delete (⌫)" aria-label="Delete">
                  <Icon name="trash" size={14} />
                </button>
              </Panel>
            )}

            {player.caption && (
              <Panel position={readOnly ? 'top-left' : 'bottom-center'} className="cv-caption" aria-live="polite">
                <span className="cv-step">
                  {player.index + 1}
                  <span className="muted">/{player.steps.length}</span>
                </span>
                <span className="cv-caption-text">{player.caption}</span>
              </Panel>
            )}

            <Panel position="bottom-center" className="cv-toolbar" aria-label="Canvas">
              {!readOnly && (
                <>
                  <ToolButton icon="undo" label={`Undo (${MOD}Z)`} onClick={() => travel(true)} disabled={!undoStack.current.length} />
                  <ToolButton icon="redo" label={`Redo (⇧${MOD}Z)`} onClick={() => travel(false)} disabled={!redoStack.current.length} />
                  <span className="cv-sep" />
                </>
              )}
              <FlowControls player={player} />
              {!readOnly && (
                <>
                  <span className="cv-sep" />
                  {!compact && <ToolButton icon="magnet" label="Snap to grid" on={snap} onClick={() => (setSnap(!snap), setPref('snap', !snap))} />}
                  <ToolButton icon="minimap" label="Overview map" on={minimap} onClick={() => (setMinimap(!minimap), setPref('minimap', !minimap))} />
                  <ToolButton icon="tidy" label="Tidy the layout (T)" onClick={tidy} disabled={canvas.nodes.length < 2} />
                </>
              )}
              <span className="cv-sep" />
              <Zoom onFit={() => fit(300)} />
              {!readOnly && !compact && <ToolButton icon="keyboard" label="Keyboard shortcuts (?)" on={help} onClick={() => setHelp(!help)} />}
            </Panel>

            {help && <Shortcuts onClose={() => setHelp(false)} />}
          </ReactFlow>

          {!canvas.nodes.length && !readOnly && (
            <div className="cv-empty">
              <p>{paletteSet === 'map' ? 'Map the ideas' : 'Sketch your design'}</p>
              <p className="muted small">
                {paletteSet === 'map'
                  ? 'Add concepts from the left, drag from a dot to link two, and double-click a link to say how they relate. Or ask the tutor to draw one with you.'
                  : compact
                    ? 'The tutor draws here as it explains. You can add and move parts too.'
                    : 'Drag parts in from the left, then drag from a dot to connect them. Or ask the tutor to start one with you.'}
              </p>
              {onExample && (
                <button className="btn small cv-example" onClick={onExample}>
                  Open a finished example
                </button>
              )}
            </div>
          )}
        </div>
      </EdgeContext.Provider>
    </EditorContext.Provider>
  )
}

function ToolButton({ icon, label, onClick, on, disabled }: { icon: IconName; label: string; onClick(): void; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`cv-tb icon${on ? ' on' : ''}`} onClick={onClick} disabled={disabled} title={label} aria-label={label} {...(on !== undefined ? { 'aria-pressed': on } : {})}>
      <Icon name={icon} size={15} />
    </button>
  )
}

function FlowControls({ player }: { player: Player }) {
  const any = player.steps.length > 0 || player.announcing
  if (!any) return <ToolButton icon="play" label="Play the flow: add connections first" onClick={() => {}} disabled />
  return (
    <>
      {player.index >= 0 && !player.announcing && <ToolButton icon="stepBack" label="Previous step (←)" onClick={player.prev} disabled={player.index <= 0} />}
      <button className={`cv-tb play${player.playing ? ' on' : ''}`} onClick={player.playing ? player.pause : player.play} title={player.playing ? 'Pause (P)' : 'Play a request along the connections, step by step (P)'}>
        <Icon name={player.playing ? 'pause' : 'play'} size={14} />
        <span>{player.playing ? 'Pause' : player.index >= 0 ? 'Play' : 'Play flow'}</span>
      </button>
      {player.index >= 0 && !player.announcing && (
        <>
          <ToolButton icon="stepNext" label="Next step (→)" onClick={player.next} disabled={player.index >= player.steps.length - 1} />
          <ToolButton icon="x" label="Stop (Esc)" onClick={player.stop} />
        </>
      )}
    </>
  )
}

function Zoom({ onFit }: { onFit(): void }) {
  const rf = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  return (
    <>
      <ToolButton icon="minus" label={`Zoom out (${MOD}−)`} onClick={() => rf.zoomOut({ duration: 180 })} />
      <button className="cv-tb cv-zoom-level" onClick={() => rf.zoomTo(1, { duration: 200 })} title={`Actual size (${MOD}0)`}>
        {Math.round(zoom * 100)}%
      </button>
      <ToolButton icon="plus" label={`Zoom in (${MOD}+)`} onClick={() => rf.zoomIn({ duration: 180 })} />
      <ToolButton icon="fit" label="Fit the drawing (F)" onClick={onFit} />
    </>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Pan', 'Scroll, or drag the background'],
  ['Zoom', `Pinch, or ${MOD} + scroll`],
  ['Select several', 'Shift + drag, or ' + MOD + ' + click'],
  ['Rename', 'Double-click, or Enter'],
  ['Connect', 'Drag from a dot to another part'],
  ['Undo / redo', `${MOD}Z / ⇧${MOD}Z`],
  ['Copy, paste, duplicate', `${MOD}C, ${MOD}V, ${MOD}D`],
  ['Group / ungroup', `${MOD}G / ⇧${MOD}G`],
  ['Move a little', 'Arrow keys (Shift: further)'],
  ['Delete', '⌫'],
  ['Add a note', 'N'],
  ['Tidy the layout', 'T'],
  ['Play the flow', 'P, then ← →'],
  ['Fit / actual size', `F / ${MOD}0`]
]

function Shortcuts({ onClose }: { onClose(): void }) {
  return (
    <Panel position="top-right" className="cv-help" aria-label="Keyboard shortcuts">
      <div className="cv-help-head">
        <span>Shortcuts</span>
        <button className="icon-btn small" onClick={onClose} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
      <dl>
        {SHORTCUTS.map(([what, keys]) => (
          <div key={what}>
            <dt>{what}</dt>
            <dd>{keys}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function FilePicker({ files, onPick, onClose }: { files: string[]; onPick(path: string): void; onClose(): void }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return files.filter((f) => words.every((w) => f.toLowerCase().includes(w))).slice(0, 40)
  }, [files, q])
  return (
    <Panel position="top-left" className="cv-files" aria-label="Add a file">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a note or file"
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && shown[0]) onPick(shown[0])
        }}
        aria-label="Find a note or file"
      />
      <div className="cv-files-list">
        {shown.map((f) => (
          <button key={f} onClick={() => onPick(f)} title={f}>
            <span>{(f.split('/').pop() ?? f).replace(/\.md$/i, '')}</span>
            <span className="muted">{f.split('/').slice(0, -1).join('/')}</span>
          </button>
        ))}
        {!shown.length && <p className="muted small">Nothing matches</p>}
      </div>
    </Panel>
  )
}
