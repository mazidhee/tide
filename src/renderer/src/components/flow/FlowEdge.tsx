import { createContext, memo, useContext, useEffect, useRef, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react'
import type { Side } from '@shared/canvas'
import type { FlowEdge as FlowEdgeType, FlowNode } from './model'
import { canvasColor } from './nodes'

/** What edges need from the editor: the marker ids of this canvas, and saving a label */
export interface EdgeHooks {
  markers: string
  readOnly: boolean
  editingEdge: string | null
  setEditingEdge(id: string | null): void
  saveLabel(id: string, label: string): void
  reducedMotion: boolean
}
export const EdgeContext = createContext<EdgeHooks>({ markers: 'cv', readOnly: true, editingEdge: null, setEditingEdge: () => {}, saveLabel: () => {}, reducedMotion: false })

type Box = { x: number; y: number; w: number; h: number }
const box = (n: InternalNode<FlowNode>): Box => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0 })
const anchor = (b: Box, s: Side) => (s === 'top' ? { x: b.x + b.w / 2, y: b.y } : s === 'bottom' ? { x: b.x + b.w / 2, y: b.y + b.h } : s === 'left' ? { x: b.x, y: b.y + b.h / 2 } : { x: b.x + b.w, y: b.y + b.h / 2 })
const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

/** Which sides a line leaves and enters by, from where the two boxes sit (when the file doesn't say) */
function autoSides(a: Box, b: Box): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  // Side by side if they don't overlap horizontally, else one above the other
  const apartX = b.x > a.x + a.w + 12 || a.x > b.x + b.w + 12
  const apartY = b.y > a.y + a.h + 12 || a.y > b.y + b.h + 12
  if (apartX && (!apartY || Math.abs(dx) * 0.6 > Math.abs(dy))) return dx > 0 ? ['right', 'left'] : ['left', 'right']
  return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/** A dot travelling the line once, for a step of a flow; restarts whenever the step does */
function Packet({ path }: { path: string }) {
  const ref = useRef<SVGAnimateMotionElement>(null)
  useEffect(() => {
    ref.current?.beginElement()
  }, [path])
  return (
    <g className="cve-packet">
      <circle r={9} className="cve-packet-halo" />
      <circle r={4.5} className="cve-packet-dot" />
      <animateMotion ref={ref} dur="1.15s" begin="indefinite" fill="freeze" path={path} calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1" />
    </g>
  )
}

function LabelInput({ initial, onSave, onCancel }: { initial: string; onSave(v: string): void; onCancel(): void }) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const save = () => {
    if (done.current) return
    done.current = true
    onSave(v.trim())
  }
  return (
    <input
      className="cve-input nodrag nopan"
      autoFocus
      value={v}
      size={Math.max(6, v.length + 1)}
      placeholder="Label"
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') {
          done.current = true
          onCancel()
        }
      }}
      aria-label="Connection label"
    />
  )
}

export const FlowEdge = memo(function FlowEdge({ id, source, target, data, selected }: EdgeProps<FlowEdgeType>) {
  const ctx = useContext(EdgeContext)
  const a = useInternalNode<FlowNode>(source)
  const b = useInternalNode<FlowNode>(target)
  if (!a || !b || !data) return null
  const e = data.edge
  const ba = box(a)
  const bb = box(b)
  const auto = autoSides(ba, bb)
  const sa = e.fromSide ?? auto[0]
  const sb = e.toSide ?? auto[1]
  const p = anchor(ba, sa)
  const q = anchor(bb, sb)
  const [path, lx, ly] = getBezierPath({ sourceX: p.x, sourceY: p.y, sourcePosition: POS[sa], targetX: q.x, targetY: q.y, targetPosition: POS[sb], curvature: 0.32 })
  const color = canvasColor(e.color)
  const state = data.state
  const marker = (end?: 'arrow' | 'none', fallback?: 'arrow' | 'none') => ((end ?? fallback) === 'arrow' ? `url(#${ctx.markers}-${selected || state === 'active' ? 'on' : state === 'done' ? 'done' : /^[1-6]$/.test(e.color ?? '') ? `c${e.color}` : 'base'})` : undefined)
  const editing = ctx.editingEdge === id
  const cls = ['cve', selected && 'on', state && `is-${state}`, e.animated && 'flowing', e.dashed && 'dashed', color && 'colored'].filter(Boolean).join(' ')
  return (
    <>
      <BaseEdge id={id} path={path} className={cls} style={color ? { stroke: color } : undefined} markerEnd={marker(e.toEnd, 'arrow')} markerStart={marker(e.fromEnd, 'none')} interactionWidth={18} />
      {state === 'active' && !ctx.reducedMotion && <Packet key={data.run ?? 0} path={path} />}
      {(e.label || editing) && (
        <EdgeLabelRenderer>
          <div
            className={`cve-label nodrag nopan${selected ? ' on' : ''}${state ? ` is-${state}` : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            onDoubleClick={(ev) => {
              ev.stopPropagation()
              if (!ctx.readOnly) ctx.setEditingEdge(id)
            }}
          >
            {editing ? <LabelInput initial={e.label ?? ''} onSave={(v) => ctx.saveLabel(id, v)} onCancel={() => ctx.setEditingEdge(null)} /> : e.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

export const EDGE_TYPES = { flow: FlowEdge }

/** The arrowheads every edge of one canvas refers to, coloured by CSS so they follow the theme */
export function Markers({ id }: { id: string }) {
  const kinds = ['base', 'on', 'done', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']
  return (
    <svg className="cve-markers" width="0" height="0" aria-hidden="true">
      <defs>
        {kinds.map((k) => (
          <marker key={k} id={`${id}-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M1,1.2 L9,5 L1,8.8 z" className={`cve-head ${k}`} />
          </marker>
        ))}
      </defs>
    </svg>
  )
}
