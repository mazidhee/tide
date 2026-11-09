import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { COMPONENTS, connect, makeNode, nodeLabel, placeNode, type Canvas, type CanvasEdge, type CanvasNode, type ComponentKind } from '@shared/canvas'
import { Icon } from './Icon'

interface Props {
  canvas: Canvas
  onChange(next: Canvas): void
  /** Shown on an empty canvas: open a finished example instead */
  onExample?(): void
  /** Bumped when the canvas is replaced from outside (the tutor drew on it), to re-fit if needed */
  version: number
  /** Beside a lesson: no palette, the drawing fitted to a narrow panel */
  compact?: boolean
}

type Side = 'top' | 'right' | 'bottom' | 'left'
type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null
interface View {
  x: number
  y: number
  k: number
}

/** Room the palette takes on the left */
const PALETTE_W = 160

const center = (n: CanvasNode) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 })
const anchor = (n: CanvasNode, side: Side) =>
  side === 'top' ? { x: n.x + n.width / 2, y: n.y } : side === 'bottom' ? { x: n.x + n.width / 2, y: n.y + n.height } : side === 'left' ? { x: n.x, y: n.y + n.height / 2 } : { x: n.x + n.width, y: n.y + n.height / 2 }

/** Which sides an arrow leaves and enters by, from where the two boxes sit */
function sides(a: CanvasNode, b: CanvasNode): [Side, Side] {
  const ca = center(a)
  const cb = center(b)
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  if (Math.abs(dx) * 0.6 > Math.abs(dy)) return dx > 0 ? ['right', 'left'] : ['left', 'right']
  return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

const pull = (side: Side, d: number) => (side === 'top' ? { x: 0, y: -d } : side === 'bottom' ? { x: 0, y: d } : side === 'left' ? { x: -d, y: 0 } : { x: d, y: 0 })

function edgePath(a: CanvasNode, b: CanvasNode, e: CanvasEdge) {
  const [sa, sb] = e.fromSide && e.toSide ? [e.fromSide, e.toSide] : sides(a, b)
  const p = anchor(a, sa)
  const q = anchor(b, sb)
  const d = Math.max(40, Math.hypot(q.x - p.x, q.y - p.y) / 3)
  const c1 = pull(sa, d)
  const c2 = pull(sb, d)
  return {
    d: `M${p.x},${p.y} C${p.x + c1.x},${p.y + c1.y} ${q.x + c2.x},${q.y + c2.y} ${q.x},${q.y}`,
    // The curve's midpoint, for the label
    mid: { x: (p.x + 3 * (p.x + c1.x) + 3 * (q.x + c2.x) + q.x) / 8, y: (p.y + 3 * (p.y + c1.y) + 3 * (q.y + c2.y) + q.y) / 8 }
  }
}

const KIND_ICON: Partial<Record<ComponentKind, string>> = {
  client: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 14.5zM9 20h6M12 16v4',
  lb: 'M12 4v5M12 9l-6 6M12 9l6 6M12 9v6M4 18h4M10 18h4M16 18h4',
  gateway: 'M4 12h16M14 6l6 6-6 6M4 6v12',
  service: 'M5 5h14v6H5zM5 13h14v6H5zM8 8h.01M8 16h.01',
  worker: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  database: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  cache: 'M13 3L5 14h6l-1 7 8-11h-6z',
  queue: 'M4 7h4v10H4zM10 7h4v10h-4zM16 7h4v10h-4z',
  storage: 'M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8',
  cdn: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  note: 'M5 4h14v12l-4 4H5zM15 20v-4h4'
}

function KindIcon({ kind }: { kind?: ComponentKind }) {
  const d = KIND_ICON[kind ?? 'service'] ?? KIND_ICON.service!
  return (
    <svg className="cv-kind-icon" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/**
 * A small diagram editor for system design: drag components from the palette, drag from a
 * component's edge dot to another to connect them, double-click to rename (the first line is the
 * name, further lines are details), Delete to remove, ⌘Z to undo. Scroll or drag the background
 * to pan; pinch or ⌘-scroll to zoom.
 */
export function CanvasEditor({ canvas, onChange, version, onExample, compact }: Props) {
  const leftRoom = compact ? 12 : PALETTE_W
  const wrapRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 80, y: 80, k: 1 })
  const [selected, setSelected] = useState<Selection>(null)
  const [editing, setEditing] = useState<{ type: 'node' | 'edge'; id: string; text: string } | null>(null)
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null)
  const drag = useRef<{ kind: 'node'; id: string; dx: number; dy: number; start: Canvas; moved: boolean } | { kind: 'pan'; x: number; y: number; vx: number; vy: number } | null>(null)
  const undo = useRef<Canvas[]>([])
  const redo = useRef<Canvas[]>([])
  const latest = useRef(canvas)
  latest.current = canvas
  const viewRef = useRef(view)
  viewRef.current = view

  /** A change worth undoing; `base` is what to go back to (defaults to the current canvas) */
  const commit = useCallback(
    (next: Canvas, base: Canvas = latest.current) => {
      undo.current = [...undo.current.slice(-80), base]
      redo.current = []
      onChange(next)
    },
    [onChange]
  )

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k }
  }, [])

  const fit = useCallback(() => {
    const wrap = wrapRef.current
    const c = latest.current
    if (!wrap) return
    if (!c.nodes.length) return setView({ x: leftRoom + (wrap.clientWidth - leftRoom) / 2 - 90, y: wrap.clientHeight / 2 - 36, k: 1 })
    const minX = Math.min(...c.nodes.map((n) => n.x)) - 60
    const minY = Math.min(...c.nodes.map((n) => n.y)) - 60
    const maxX = Math.max(...c.nodes.map((n) => n.x + n.width)) + 60
    const maxY = Math.max(...c.nodes.map((n) => n.y + n.height)) + 60
    // The palette sits on the left; centre the design in the space beside it
    const left = leftRoom
    const w = wrap.clientWidth - left
    const h = wrap.clientHeight - 50
    const k = Math.min(1.25, Math.max(0.25, Math.min(w / (maxX - minX), h / (maxY - minY))))
    setView({ k, x: left + w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k })
  }, [leftRoom])

  // Fit on open, and again as the panel settles or the window resizes, until you move the view
  const touched = useRef(false)
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    fit()
    const ro = new ResizeObserver(() => !touched.current && fit())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [fit])
  useEffect(() => {
    if (!version) return
    const wrap = wrapRef.current
    if (!wrap) return
    const v = viewRef.current
    const out = latest.current.nodes.some((n) => {
      const x = n.x * v.k + v.x
      const y = n.y * v.k + v.y
      return x < leftRoom || y < 0 || x + n.width * v.k > wrap.clientWidth || y + n.height * v.k > wrap.clientHeight - 60
    })
    if (out) fit()
  }, [version, fit, leftRoom])

  const addAt = (kind: ComponentKind, x?: number, y?: number) => {
    const wrap = wrapRef.current!
    const v = viewRef.current
    const c = latest.current
    const label = COMPONENTS.find((k) => k.kind === kind)!.label
    let pos: { x: number; y: number }
    if (x !== undefined && y !== undefined) pos = { x: Math.round(x), y: Math.round(y) }
    else {
      // From the palette: beside the selected component and connected to it, else in a free spot in view
      const sel = selected?.type === 'node' ? c.nodes.find((n) => n.id === selected.id) : undefined
      const last = c.nodes.at(-1)
      const mid = { x: ((PALETTE_W + wrap.clientWidth) / 2 - v.x) / v.k - 90, y: (wrap.clientHeight / 2 - v.y) / v.k - 36 }
      pos = sel ? placeNode(c, sel, 'right') : last ? placeNode(c, last, 'right') : { x: Math.round(mid.x), y: Math.round(mid.y) }
    }
    const node = makeNode(c, { label, kind, ...pos })
    const sel = selected?.type === 'node' ? selected.id : null
    const added = { ...c, nodes: [...c.nodes, node] }
    commit(sel ? connect(added, sel, node.id) : added)
    // Keep the new box in view
    const vx = node.x * v.k + v.x
    const vy = node.y * v.k + v.y
    if (vx < PALETTE_W || vy < 0 || vx + node.width * v.k > wrap.clientWidth - 20 || vy + node.height * v.k > wrap.clientHeight - 60)
      setView({ ...v, x: v.x + ((PALETTE_W + wrap.clientWidth) / 2 - (vx + (node.width * v.k) / 2)), y: v.y + (wrap.clientHeight / 2 - (vy + (node.height * v.k) / 2)) })
    setSelected({ type: 'node', id: node.id })
    setEditing({ type: 'node', id: node.id, text: node.text })
  }

  const remove = (sel: Selection) => {
    if (!sel) return
    const c = latest.current
    if (sel.type === 'node') commit({ nodes: c.nodes.filter((n) => n.id !== sel.id), edges: c.edges.filter((e) => e.fromNode !== sel.id && e.toNode !== sel.id) })
    else commit({ ...c, edges: c.edges.filter((e) => e.id !== sel.id) })
    setSelected(null)
  }

  const saveEdit = () => {
    if (!editing) return
    const c = latest.current
    const text = editing.text.replace(/\s+$/, '')
    if (editing.type === 'node') {
      const lines = text.split('\n').length
      if (text && text !== c.nodes.find((n) => n.id === editing.id)?.text)
        commit({ ...c, nodes: c.nodes.map((n) => (n.id === editing.id ? { ...n, text, height: Math.max(n.height, 48 + lines * 22) } : n)) })
    } else {
      commit({ ...c, edges: c.edges.map((e) => (e.id === editing.id ? { ...e, ...(text.trim() ? { label: text.trim() } : { label: undefined }) } : e)) })
    }
    setEditing(null)
  }

  // Keyboard: delete, undo/redo, escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (editing || target.closest('input, textarea, [contenteditable="true"]')) return
      if (!wrapRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
        e.preventDefault()
        remove(selected)
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const from = e.shiftKey ? redo.current : undo.current
        const to = e.shiftKey ? undo.current : redo.current
        const prev = from.pop()
        if (prev) {
          to.push(latest.current)
          onChange(prev)
          setSelected(null)
        }
      } else if (e.key === 'Escape') setSelected(null)
      else if (e.key === 'Enter' && selected?.type === 'node') {
        e.preventDefault()
        const n = latest.current.nodes.find((x) => x.id === selected.id)
        if (n) setEditing({ type: 'node', id: n.id, text: n.text })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Wheel: pan with two fingers, zoom with a pinch or ⌘
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.cv-palette, textarea')) return
      e.preventDefault()
      touched.current = true
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        const r = wrap.getBoundingClientRect()
        const mx = e.clientX - r.left
        const my = e.clientY - r.top
        const k = Math.min(2.5, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.01)))
        setView({ k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k })
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  // Pointer moves and releases are tracked on the window so a drag can leave the canvas
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (d?.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
      else if (d?.kind === 'node') {
        const p = toWorld(e.clientX, e.clientY)
        d.moved = true
        const c = latest.current
        onChange({ ...c, nodes: c.nodes.map((n) => (n.id === d.id ? { ...n, x: Math.round(p.x - d.dx), y: Math.round(p.y - d.dy) } : n)) })
      } else if (linking) {
        const p = toWorld(e.clientX, e.clientY)
        setLinking((l) => (l ? { ...l, x: p.x, y: p.y } : l))
      }
    }
    const onUp = (e: PointerEvent) => {
      const d = drag.current
      drag.current = null
      if (d?.kind === 'node' && d.moved) {
        // One undo step for the whole drag
        undo.current = [...undo.current.slice(-80), d.start]
        redo.current = []
      }
      if (linking) {
        const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-node]')?.dataset.node
        if (target && target !== linking.from) commit(connect(latest.current, linking.from, target))
        setLinking(null)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [linking, onChange, commit, toWorld])

  const byId = new Map(canvas.nodes.map((n) => [n.id, n]))
  const from = linking ? byId.get(linking.from) : undefined

  return (
    <div
      ref={wrapRef}
      className="cv"
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('.cv-node, .cv-edge-hit, .cv-edge-label, .cv-palette, .cv-zoom')) return
        wrapRef.current?.focus()
        setSelected(null)
        if (editing) saveEdit()
        touched.current = true
        drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.cv-node, .cv-edge-label, .cv-palette, .cv-zoom')) return
        const p = toWorld(e.clientX, e.clientY)
        addAt('service', p.x - 90, p.y - 36)
      }}
    >
      <div className="cv-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="cv-edges" width="1" height="1" overflow="visible" aria-hidden="true">
          <defs>
            <marker id="cv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="cv-arrowhead" />
            </marker>
            <marker id="cv-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="cv-arrowhead on" />
            </marker>
          </defs>
          {canvas.edges.map((e) => {
            const a = byId.get(e.fromNode)
            const b = byId.get(e.toNode)
            if (!a || !b) return null
            const { d } = edgePath(a, b, e)
            const on = selected?.type === 'edge' && selected.id === e.id
            return (
              <g key={e.id}>
                <path d={d} className={`cv-edge${on ? ' on' : ''}`} markerEnd={e.toEnd === 'none' ? undefined : on ? 'url(#cv-arrow-on)' : 'url(#cv-arrow)'} />
                <path
                  d={d}
                  className="cv-edge-hit"
                  onPointerDown={(ev) => {
                    ev.stopPropagation()
                    wrapRef.current?.focus()
                    setSelected({ type: 'edge', id: e.id })
                  }}
                  onDoubleClick={(ev) => {
                    ev.stopPropagation()
                    setEditing({ type: 'edge', id: e.id, text: e.label ?? '' })
                  }}
                />
              </g>
            )
          })}
          {from && linking && <line x1={center(from).x} y1={center(from).y} x2={linking.x} y2={linking.y} className="cv-edge linking" />}
        </svg>

        {canvas.edges.map((e) => {
          const a = byId.get(e.fromNode)
          const b = byId.get(e.toNode)
          if (!a || !b) return null
          const { mid } = edgePath(a, b, e)
          const isEditing = editing?.type === 'edge' && editing.id === e.id
          if (!e.label && !isEditing) return null
          return (
            <div
              key={e.id}
              className={`cv-edge-label${selected?.type === 'edge' && selected.id === e.id ? ' on' : ''}`}
              style={{ left: mid.x, top: mid.y }}
              onPointerDown={(ev) => {
                ev.stopPropagation()
                setSelected({ type: 'edge', id: e.id })
              }}
              onDoubleClick={(ev) => {
                ev.stopPropagation()
                setEditing({ type: 'edge', id: e.id, text: e.label ?? '' })
              }}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={editing.text}
                  onChange={(ev) => setEditing({ ...editing, text: ev.target.value })}
                  onBlur={saveEdit}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') saveEdit()
                    if (ev.key === 'Escape') setEditing(null)
                  }}
                  placeholder="Label"
                  aria-label="Connection label"
                />
              ) : (
                e.label
              )}
            </div>
          )
        })}

        {canvas.nodes.map((n) => {
          const on = selected?.type === 'node' && selected.id === n.id
          const isEditing = editing?.type === 'node' && editing.id === n.id
          const [title, ...rest] = n.text.split('\n')
          return (
            <div
              key={n.id}
              data-node={n.id}
              className={`cv-node k-${n.kind ?? 'service'}${on ? ' on' : ''}${linking ? ' target' : ''}`}
              style={{ left: n.x, top: n.y, width: n.width, minHeight: n.height }}
              onPointerDown={(e) => {
                if (e.button !== 0 || isEditing || (e.target as HTMLElement).closest('.cv-handle')) return
                e.stopPropagation()
                wrapRef.current?.focus()
                setSelected({ type: 'node', id: n.id })
                const p = toWorld(e.clientX, e.clientY)
                drag.current = { kind: 'node', id: n.id, dx: p.x - n.x, dy: p.y - n.y, start: latest.current, moved: false }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing({ type: 'node', id: n.id, text: n.text })
              }}
            >
              <span className="cv-kind">
                <KindIcon kind={n.kind} />
                {n.kind !== 'note' && <span>{COMPONENTS.find((c) => c.kind === (n.kind ?? 'service'))?.label}</span>}
              </span>
              {isEditing ? (
                <textarea
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  onBlur={saveEdit}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      saveEdit()
                    }
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  rows={Math.max(1, editing.text.split('\n').length)}
                  aria-label="Component name; Shift+Enter adds a details line"
                />
              ) : (
                <>
                  <span className="cv-title">{title.replace(/^#+\s*/, '') || nodeLabel(n)}</span>
                  {rest.join('\n').trim() && <span className="cv-details">{rest.join('\n').trim()}</span>}
                </>
              )}
              {(['top', 'right', 'bottom', 'left'] as Side[]).map((s) => (
                <span
                  key={s}
                  className={`cv-handle ${s}`}
                  title="Drag to another component to connect"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    const p = toWorld(e.clientX, e.clientY)
                    setLinking({ from: n.id, x: p.x, y: p.y })
                  }}
                />
              ))}
            </div>
          )
        })}
      </div>

      {!canvas.nodes.length && (
        <div className="cv-empty">
          <p>Sketch your design</p>
          <p className="muted small">Add components from the left, then drag from a dot to connect them. Or ask the tutor to start one with you.</p>
          {onExample && (
            <button className="btn small cv-example" onClick={onExample}>
              Open a finished example
            </button>
          )}
        </div>
      )}

      {!compact && (
      <div className="cv-palette" role="toolbar" aria-label="Add a component">
        {COMPONENTS.map((c) => (
          <button key={c.kind} className={`cv-pal k-${c.kind}`} onClick={() => addAt(c.kind)} title={`Add ${c.label.toLowerCase()}`}>
            <KindIcon kind={c.kind} />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      )}

      <div className="cv-zoom">
        <button className="icon-btn small" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))} aria-label="Zoom out">
          <Icon name="minus" size={13} />
        </button>
        <button className="cv-zoom-level" onClick={fit} title="Fit the design">
          {Math.round(view.k * 100)}%
        </button>
        <button className="icon-btn small" onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))} aria-label="Zoom in">
          <Icon name="plus" size={13} />
        </button>
      </div>
    </div>
  )
}
