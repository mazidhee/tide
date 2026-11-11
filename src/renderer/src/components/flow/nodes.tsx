import { createContext, memo, useContext, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { COMPONENTS, nodeDetails, nodeLabel, nodeText, type CanvasNode, type ComponentKind } from '@shared/canvas'
import type { FlowNode } from './model'

export const KIND_ICON: Record<ComponentKind | 'file' | 'link' | 'image' | 'pdf', string> = {
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
  note: 'M5 4h14v12l-4 4H5zM15 20v-4h4',
  file: 'M7 3h7l5 5v11.5A1.5 1.5 0 0 1 17.5 21h-10A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3zM14 3v5h5M9.5 13h5M9.5 16.5h5',
  pdf: 'M7 3h7l5 5v11.5A1.5 1.5 0 0 1 17.5 21h-10A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3zM14 3v5h5M9 17h6',
  image: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15.5 9.5h.01',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'
}

export function KindIcon({ kind, size = 14 }: { kind: keyof typeof KIND_ICON; size?: number }) {
  return (
    <svg className="cvn-glyph" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={KIND_ICON[kind]} />
    </svg>
  )
}

export const kindName = (k?: ComponentKind) => COMPONENTS.find((c) => c.kind === k)?.label

/** JSON Canvas colours: a preset 1–6 (red, orange, yellow, green, cyan, purple) or a hex */
export function canvasColor(color?: string): string | undefined {
  if (!color) return undefined
  if (/^[1-6]$/.test(color)) return `var(--cv-c${color})`
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined
}

/** What the nodes need from the editor around them */
export interface EditorHooks {
  readOnly: boolean
  editing: string | null
  setEditing(id: string | null): void
  saveText(id: string, text: string): void
  saveGroupLabel(id: string, label: string): void
  openFile?(path: string): void
  readFile?(path: string): Promise<string>
}
export const EditorContext = createContext<EditorHooks>({ readOnly: true, editing: null, setEditing: () => {}, saveText: () => {}, saveGroupLabel: () => {} })

function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="top" className="cvn-handle" />
      <Handle type="source" position={Position.Right} id="right" className="cvn-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="cvn-handle" />
      <Handle type="source" position={Position.Left} id="left" className="cvn-handle" />
    </>
  )
}

function Resizer({ selected, min = [80, 40] }: { selected: boolean; min?: [number, number] }) {
  const { readOnly } = useContext(EditorContext)
  if (readOnly) return null
  return <NodeResizer isVisible={selected} minWidth={min[0]} minHeight={min[1]} lineClassName="cvn-resize-line" handleClassName="cvn-resize-handle" />
}

/** A text box being written in: Enter saves, Shift+Enter starts a details line, Escape cancels */
function TextEditor({ initial, onSave, onCancel, label }: { initial: string; onSave(t: string): void; onCancel(): void; label: string }) {
  const [text, setText] = useState(initial)
  const done = useRef(false)
  const save = () => {
    if (done.current) return
    done.current = true
    onSave(text.replace(/\s+$/, ''))
  }
  return (
    <textarea
      className="cvn-input nodrag nowheel"
      autoFocus
      value={text}
      rows={Math.max(1, text.split('\n').length)}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          done.current = true
          onCancel()
        }
      }}
      aria-label={label}
    />
  )
}

function colorStyle(n: CanvasNode): CSSProperties | undefined {
  const c = canvasColor(n.color)
  // A kind brings its own colour; a colour picked in Obsidian tints plain boxes
  return c && !n.kind ? ({ '--node-tint': c } as CSSProperties) : undefined
}

export const TextNode = memo(function TextNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ctx = useContext(EditorContext)
  const n = data.node
  const editing = ctx.editing === id
  const kind = n.kind
  const shape = typeof n.shape === 'string' ? n.shape : undefined
  const title = nodeLabel(n)
  const details = nodeDetails(n)
  return (
    <div className={`cvn cvn-text k-${kind ?? 'plain'}${shape ? ` shape-${shape}` : ''}${n.color && !kind ? ' tinted' : ''}`} style={colorStyle(n)} onDoubleClick={() => !ctx.readOnly && ctx.setEditing(id)}>
      <Resizer selected={selected} />
      <Handles />
      {kind && kind !== 'note' && (
        <div className="cvn-head">
          <span className="cvn-icon">
            <KindIcon kind={kind} size={13} />
          </span>
          <span className="cvn-kind">{kindName(kind)}</span>
        </div>
      )}
      {editing ? (
        <TextEditor initial={nodeText(n)} onSave={(t) => ctx.saveText(id, t)} onCancel={() => ctx.setEditing(null)} label="Name; Shift+Enter adds a details line" />
      ) : (
        <>
          <div className="cvn-title">{title}</div>
          {details && <div className="cvn-details">{details}</div>}
        </>
      )}
    </div>
  )
})

const ext = (p: string) => (p.split('.').pop() ?? '').toLowerCase()

/** The start of a note, without its front matter or Markdown marks, for the card */
function preview(md: string): string {
  return md
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').trim())
    .filter(Boolean)
    .slice(0, 6)
    .join('\n')
}

export const FileNode = memo(function FileNode({ data, selected }: NodeProps<FlowNode>) {
  const ctx = useContext(EditorContext)
  const n = data.node
  const path = n.file ?? ''
  const e = ext(path)
  const icon = e === 'pdf' ? 'pdf' : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e) ? 'image' : 'file'
  const name = (path.split('/').pop() ?? path).replace(/\.md$/i, '')
  const folder = path.split('/').slice(0, -1).join('/')
  const [text, setText] = useState('')
  useEffect(() => {
    if (e !== 'md' || !ctx.readFile) return
    let live = true
    ctx.readFile(path)
      .then((t) => live && setText(preview(t)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [path, e, ctx])
  return (
    <div className="cvn cvn-file" style={colorStyle(n)} onDoubleClick={() => ctx.openFile?.(path)} title={ctx.openFile ? `Double-click to open ${path}` : path}>
      <Resizer selected={selected} min={[140, 60]} />
      <Handles />
      <div className="cvn-head">
        <span className="cvn-icon">
          <KindIcon kind={icon} size={13} />
        </span>
        <span className="cvn-kind">{folder || 'File'}</span>
      </div>
      <div className="cvn-title">
        {name}
        {n.subpath && <span className="cvn-sub">{n.subpath}</span>}
      </div>
      {text && <div className="cvn-preview">{text}</div>}
    </div>
  )
})

export const LinkNode = memo(function LinkNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node
  const url = n.url ?? ''
  let host = url
  try {
    host = new URL(url).host.replace(/^www\./, '')
  } catch {
    // not a full URL; show it as it is
  }
  return (
    <div className="cvn cvn-link" style={colorStyle(n)} onDoubleClick={() => url && window.tide?.app.openExternal(url)} title={url}>
      <Resizer selected={selected} min={[140, 60]} />
      <Handles />
      <div className="cvn-head">
        <span className="cvn-icon">
          <KindIcon kind="link" size={13} />
        </span>
        <span className="cvn-kind">{host}</span>
      </div>
      <div className="cvn-url">{url}</div>
    </div>
  )
})

export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ctx = useContext(EditorContext)
  const n = data.node
  const editing = ctx.editing === id
  const tint = canvasColor(n.color)
  return (
    <div className={`cvn-group${tint ? ' tinted' : ''}${selected ? ' on' : ''}`} style={tint ? ({ '--node-tint': tint } as CSSProperties) : undefined}>
      <Resizer selected={selected} min={[120, 80]} />
      <div className="cvn-group-frame" />
      {editing ? (
        <input
          className="cvn-group-input nodrag"
          autoFocus
          defaultValue={n.label ?? ''}
          onBlur={(e) => ctx.saveGroupLabel(id, e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') ctx.setEditing(null)
          }}
          aria-label="Group name"
        />
      ) : (
        <div className="cvn-group-label" onDoubleClick={() => !ctx.readOnly && ctx.setEditing(id)}>
          {nodeLabel(n)}
        </div>
      )}
    </div>
  )
})

export const NODE_TYPES = { text: TextNode, file: FileNode, link: LinkNode, group: GroupNode }
