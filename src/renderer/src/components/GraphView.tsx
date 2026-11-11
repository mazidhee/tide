import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import type { BrainData, BrainEdgeKind, BrainEvent, BrainKind, BrainNode } from '@shared/brain'
import type { MasteryLevel } from '@shared/types'
import { motionPaused } from '../lib/motion'
import { fileTitle, useApp } from '../state'
import { BrainTabs } from './BrainTabs'
import { Icon } from './Icon'

/** Mid-tone hues that read on light and dark backgrounds */
const PALETTE = ['#3fa58f', '#6c8cdb', '#d0775a', '#c59a3a', '#9a72cf', '#4fa3c7', '#c8668f', '#7fa548', '#8f8f8f']

interface Node extends SimulationNodeDatum, BrainNode {}
interface Link extends SimulationLinkDatum<Node> {
  kind: BrainEdgeKind
}

/** How well you know each note, from quizzes and reviews; colours come from the theme */
const LEVELS: { level: MasteryLevel; label: string; color: string }[] = [
  { level: 'weak', label: 'Weak', color: '--danger' },
  { level: 'shaky', label: 'Shaky', color: '--warn' },
  { level: 'solid', label: 'Solid', color: '--info' },
  { level: 'mastered', label: 'Mastered', color: '--accent' },
  { level: 'new', label: 'Not tested', color: '--line-strong' }
]

/** What can be shown or hidden; you and your notebooks always are */
const LAYERS: { kind: BrainKind; label: string }[] = [
  { kind: 'note', label: 'Notes' },
  { kind: 'book', label: 'Books' },
  { kind: 'memory', label: 'Memory' },
  { kind: 'week', label: 'This week' }
]
const LAYERS_KEY = 'tide.graph.layers'
const PULSE_MS = 2600

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

/**
 * Tide's brain: everything it knows about you and your learning as one living graph. You sit in
 * the middle with where you're heading; around you, your notebooks with their notes (linked as you
 * link them, coloured by how well you know them), your books and their chapters tied to the notes
 * they cover, what the tutor remembers about you, and this week's topics. When the tutor learns
 * something, grades an answer, maps a book or plans the week, the node it touched lights up.
 */
export function GraphView({ focus }: { focus?: string }) {
  const app = useApp()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<BrainData | null>(null)
  const isNoteFocus = !!focus && /\.md$/i.test(focus)
  const [notebook, setNotebook] = useState<string>(focus && !isNoteFocus ? focus : 'all')
  const [local, setLocal] = useState(isNoteFocus)
  const [hideOrphans, setHideOrphans] = useState(false)
  const [query, setQuery] = useState('')
  const [colorBy, setColorBy] = useState<'notebook' | 'mastery'>(() => (localStorage.getItem('tide.graph.color') === 'mastery' ? 'mastery' : 'notebook'))
  const [onlyLevel, setOnlyLevel] = useState<MasteryLevel | null>(null)
  const [layers, setLayers] = useState<Set<BrainKind>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null') as BrainKind[] | null
      return new Set(saved ?? LAYERS.map((l) => l.kind))
    } catch {
      return new Set(LAYERS.map((l) => l.kind))
    }
  })
  /** The node picked with a click; its card offers what fits it */
  const [selected, setSelected] = useState<string | null>(null)
  /** The note the graph is narrowed around: the one you came from, or one you chose here */
  const [center, setCenter] = useState<string | null>(isNoteFocus ? focus! : null)
  const [events, setEvents] = useState<BrainEvent[]>([])
  const pulses = useRef(new Map<string, number>())
  const hoverRef = useRef<Node | null>(null)
  const openRef = useRef(app.openPath)
  openRef.current = app.openPath

  const load = () => window.tide.learn.brain().then(setData).catch(() => {})
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.files])

  // Live: what Tide learns or does shows up as it happens, and the node it touched lights up
  useEffect(() => {
    window.tide.learn.brainEvents().then((e) => setEvents(e.slice(-6).reverse())).catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.tideEvents.onBrainEvent((e) => {
      setEvents((cur) => [e, ...cur].slice(0, 6))
      clearTimeout(timer)
      timer = setTimeout(() => {
        load().then(() => {
          if (e.id) pulses.current.set(e.id, performance.now())
          kick.current()
        })
      }, 600)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickColor = (v: 'notebook' | 'mastery') => {
    setColorBy(v)
    setOnlyLevel(null)
    localStorage.setItem('tide.graph.color', v)
  }
  const toggleLayer = (k: BrainKind) =>
    setLayers((cur) => {
      const next = new Set(cur)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify([...next]))
      } catch {
        // Kept for this session only
      }
      return next
    })

  const notebooks = useMemo(() => (data?.nodes ?? []).filter((n) => n.kind === 'notebook').map((n) => n.label).sort(), [data])
  const colorOf = useMemo(() => {
    const map = new Map(notebooks.map((n, i) => [n, PALETTE[i % PALETTE.length]]))
    return (group: string) => map.get(group) ?? PALETTE[PALETTE.length - 1]
  }, [notebooks])

  // Pick the visible subgraph: the layers that are on, the notebook, or the notes around one
  const { nodes, links } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], links: [] as Link[] }
    const shown = (n: BrainNode) => n.kind === 'you' || n.kind === 'notebook' || (n.kind === 'chapter' ? layers.has('book') : layers.has(n.kind))
    let keep = new Set(data.nodes.filter(shown).map((n) => n.id))
    if (notebook !== 'all') {
      const nb = data.nodes.find((n) => n.kind === 'notebook' && n.label === notebook)
      const inside = new Set(data.nodes.filter((n) => n.group === notebook).map((n) => n.id))
      // A book stays when one of its chapters covers a note in this notebook
      for (const e of data.edges) if (e.kind === 'covers' && inside.has(e.target)) inside.add(e.source)
      for (const n of data.nodes) if (n.kind === 'chapter' && inside.has(n.id)) inside.add(n.group)
      keep = new Set([...keep].filter((id) => id === 'you' || id === nb?.id || inside.has(id)))
    }
    if (local && center) {
      const near = new Set([center])
      for (let depth = 0; depth < 2; depth++) {
        for (const e of data.edges) {
          if (e.kind === 'owns' || e.kind === 'focus') continue
          if (near.has(e.source)) near.add(e.target)
          else if (near.has(e.target)) near.add(e.source)
        }
      }
      keep = new Set([...keep].filter((id) => near.has(id)))
    }
    const edges = data.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
    const linked = new Set(edges.filter((e) => e.kind === 'link').flatMap((e) => [e.source, e.target]))
    const nodes: Node[] = data.nodes.filter((n) => keep.has(n.id) && (!hideOrphans || n.kind !== 'note' || linked.has(n.id) || n.id === center)).map((n) => ({ ...n }))
    const ids = new Set(nodes.map((n) => n.id))
    return { nodes, links: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e })) as Link[] }
  }, [data, notebook, local, center, hideOrphans, layers])

  const levelCounts = useMemo(() => {
    const out: Partial<Record<MasteryLevel, number>> = {}
    for (const n of nodes) if (n.kind === 'note') out[n.level ?? 'new'] = (out[n.level ?? 'new'] ?? 0) + 1
    return out
  }, [nodes])
  const counts = useMemo(() => {
    const c: Partial<Record<BrainKind, number>> = {}
    for (const n of data?.nodes ?? []) c[n.kind] = (c[n.kind] ?? 0) + 1
    return c
  }, [data])

  const selectRef = useRef(setSelected)
  // Colouring and selection only repaint; they must not restart the layout
  const style = useRef({ colorBy, onlyLevel, selected })
  style.current = { colorBy, onlyLevel, selected }
  const redraw = useRef<() => void>(() => {})
  const kick = useRef<() => void>(() => {})
  useEffect(() => redraw.current(), [colorBy, onlyLevel, selected])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !nodes.length) return
    const ctx = canvas.getContext('2d')!
    const ratio = window.devicePixelRatio || 1
    let width = 0
    let height = 0
    const view = { x: 0, y: 0, k: 1 }
    const css = getComputedStyle(document.documentElement)
    const v = (name: string) => css.getPropertyValue(name).trim()
    const ink = v('--ink')
    const muted = v('--ink-muted')
    const line = v('--line-strong')
    const accent = v('--accent')
    const bookColor = v('--info') || '#6c8cdb'
    const memoryColor = '#9a72cf'
    const levelColor = new Map(LEVELS.map((l) => [l.level, v(l.color)]))
    const q = query.trim().toLowerCase()
    const font = v('--font-ui')

    const neighbors = new Map<string, Set<string>>()
    for (const l of links) {
      const s = typeof l.source === 'object' ? (l.source as Node).id : (l.source as string)
      const t = typeof l.target === 'object' ? (l.target as Node).id : (l.target as string)
      if (!neighbors.has(s)) neighbors.set(s, new Set())
      if (!neighbors.has(t)) neighbors.set(t, new Set())
      neighbors.get(s)!.add(t)
      neighbors.get(t)!.add(s)
    }
    const radius = (n: Node) =>
      n.kind === 'you' ? 15 : n.kind === 'notebook' ? 10 : n.kind === 'book' ? 9 : n.kind === 'chapter' ? 4.5 : n.kind === 'memory' ? 4.5 : n.kind === 'week' ? 6 : 4 + Math.min(6, Math.sqrt(n.degree) * 2)

    // You in the middle; notebooks around you, each pulling its notes; books on an outer ring;
    // memories close to you
    const groups = [...new Set(nodes.filter((n) => n.kind === 'notebook').map((n) => n.label))]
    const books = [...new Set(nodes.filter((n) => n.kind === 'book').map((n) => n.id))]
    const ring = 170 + Math.sqrt(nodes.length) * 26
    const spot = new Map<string, { x: number; y: number }>()
    groups.forEach((g, i) => spot.set(g, { x: Math.cos((i / Math.max(1, groups.length)) * Math.PI * 2) * ring, y: Math.sin((i / Math.max(1, groups.length)) * Math.PI * 2) * ring }))
    books.forEach((b, i) => {
      const a = ((i + 0.5) / Math.max(1, books.length)) * Math.PI * 2 + Math.PI / Math.max(2, groups.length)
      spot.set(b, { x: Math.cos(a) * ring * 1.55, y: Math.sin(a) * ring * 1.55 })
    })
    spot.set('you', { x: 0, y: 0 })
    for (const n of nodes) if (n.kind === 'you') (n.fx = 0), (n.fy = 0)

    const pull = (n: Node) => spot.get(n.group) ?? { x: 0, y: 0 }
    const sim = forceSimulation<Node>(nodes)
      .force(
        'link',
        forceLink<Node, Link>(links)
          .id((n) => n.id)
          .distance((l) => (l.kind === 'link' ? 50 : l.kind === 'contains' ? 70 : l.kind === 'remembers' ? 60 : l.kind === 'covers' ? 140 : 160))
          .strength((l) => (l.kind === 'link' ? 0.6 : l.kind === 'covers' ? 0.05 : l.kind === 'owns' || l.kind === 'focus' ? 0.04 : 0.25))
      )
      .force('charge', forceManyBody<Node>().strength((n) => (n.kind === 'note' || n.kind === 'chapter' || n.kind === 'memory' ? -60 : -260)).distanceMax(320))
      .force('x', forceX<Node>((n) => pull(n).x).strength((n) => (n.kind === 'memory' ? 0.3 : 0.12)))
      .force('y', forceY<Node>((n) => pull(n).y).strength((n) => (n.kind === 'memory' ? 0.3 : 0.12)))
      .force('collide', forceCollide<Node>().radius((n) => radius(n) + 8))

    const resize = () => {
      width = wrap.clientWidth
      height = wrap.clientHeight
      canvas.width = width * ratio
      canvas.height = height * ratio
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      if (!view.x && !view.y) {
        view.x = width / 2
        view.y = height / 2
      }
      draw()
    }

    const shape = (n: Node, r: number) => {
      ctx.beginPath()
      if (n.kind === 'book' || n.kind === 'chapter') {
        const w = n.kind === 'book' ? r * 1.5 : r * 1.4
        const h = n.kind === 'book' ? r * 2 : r * 1.8
        ctx.roundRect(n.x! - w / 2, n.y! - h / 2, w, h, Math.min(3, r / 2))
      } else if (n.kind === 'memory') {
        ctx.moveTo(n.x!, n.y! - r * 1.2)
        ctx.lineTo(n.x! + r * 1.2, n.y!)
        ctx.lineTo(n.x!, n.y! + r * 1.2)
        ctx.lineTo(n.x! - r * 1.2, n.y!)
        ctx.closePath()
      } else ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2)
    }

    function draw() {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.translate(view.x, view.y)
      ctx.scale(view.k, view.k)
      const { colorBy, onlyLevel, selected } = style.current
      const here = selected ?? focus
      const hover = hoverRef.current
      const lit = hover ? neighbors.get(hover.id) ?? new Set<string>() : null
      const now = performance.now()
      const fill = (n: Node) =>
        n.kind === 'you' ? ink : n.kind === 'book' || n.kind === 'chapter' ? bookColor : n.kind === 'memory' ? memoryColor : n.kind === 'note' && colorBy === 'mastery' ? levelColor.get(n.level ?? 'new')! : colorOf(n.group)

      for (const l of links) {
        const s = l.source as Node
        const t = l.target as Node
        const active = hover && (s === hover || t === hover)
        ctx.strokeStyle = active ? accent : l.kind === 'covers' ? bookColor : l.kind === 'plan' ? accent : line
        ctx.globalAlpha = hover && !active ? 0.12 : l.kind === 'link' ? 0.9 : l.kind === 'focus' ? 0.7 : l.kind === 'covers' || l.kind === 'plan' ? 0.45 : 0.28
        ctx.lineWidth = (l.kind === 'focus' ? 2 : 1) / view.k
        ctx.setLineDash(l.kind === 'covers' || l.kind === 'plan' ? [4 / view.k, 4 / view.k] : [])
        ctx.beginPath()
        ctx.moveTo(s.x!, s.y!)
        ctx.lineTo(t.x!, t.y!)
        ctx.stroke()
      }
      ctx.setLineDash([])

      for (const n of nodes) {
        const dim =
          (hover && n !== hover && !lit!.has(n.id)) ||
          (q && !n.label.toLowerCase().includes(q) && n.kind !== 'you') ||
          (onlyLevel && n.kind === 'note' && (n.level ?? 'new') !== onlyLevel)
        const r = radius(n)
        ctx.globalAlpha = dim ? 0.15 : 1
        // Something Tide just touched glows for a moment
        const pulse = pulses.current.get(n.id)
        if (pulse !== undefined) {
          const p = (now - pulse) / PULSE_MS
          if (p >= 1) pulses.current.delete(n.id)
          else {
            ctx.save()
            ctx.globalAlpha = (1 - p) * 0.55
            ctx.fillStyle = accent
            ctx.beginPath()
            ctx.arc(n.x!, n.y!, r + 6 + p * 22, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          }
        }
        if (n.kind === 'week') {
          ctx.strokeStyle = colorOf(n.group)
          ctx.lineWidth = 2 / view.k
          ctx.setLineDash([3 / view.k, 2 / view.k])
          shape(n, r)
          ctx.stroke()
          ctx.setLineDash([])
        } else {
          ctx.fillStyle = n.id === focus && colorBy === 'notebook' ? accent : fill(n)
          shape(n, r)
          ctx.fill()
        }
        // A roadmap's progress as a ring around its notebook
        if (n.kind === 'notebook' && n.progress !== undefined) {
          ctx.strokeStyle = accent
          ctx.lineWidth = 2.5 / view.k
          ctx.beginPath()
          ctx.arc(n.x!, n.y!, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, n.progress))
          ctx.stroke()
        }
        if (n.kind === 'you') {
          ctx.strokeStyle = accent
          ctx.lineWidth = 2 / view.k
          ctx.beginPath()
          ctx.arc(n.x!, n.y!, r + 5, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (n.id === here) {
          ctx.strokeStyle = ink
          ctx.lineWidth = 2 / view.k
          shape(n, r + 2)
          ctx.stroke()
        }
      }

      // Labels: you, notebooks and books always; the rest when they matter, more as you zoom in
      ctx.textAlign = 'center'
      for (const n of nodes) {
        const anchor = n.kind === 'you' || n.kind === 'notebook' || n.kind === 'book'
        const show =
          anchor ||
          n === hover ||
          lit?.has(n.id) ||
          n.id === here ||
          pulses.current.has(n.id) ||
          (q && n.label.toLowerCase().includes(q)) ||
          (onlyLevel && n.kind === 'note' && (n.level ?? 'new') === onlyLevel && view.k > 0.6) ||
          (!hover && (view.k > 1.5 || (n.kind === 'note' && n.degree >= 3 && view.k > 0.8) || (n.kind === 'week' && view.k > 1.2)))
        if (!show) continue
        ctx.font = `${anchor ? 600 : 400} ${(anchor ? 13 : 11.5) / view.k}px ${font}`
        ctx.globalAlpha = hover && n !== hover && !lit!.has(n.id) ? 0.3 : 1
        ctx.fillStyle = anchor || n === hover ? ink : muted
        const text = n.label.length > 38 ? n.label.slice(0, 36) + '…' : n.label
        ctx.fillText(text, n.x!, n.y! + radius(n) + (n.kind === 'you' ? 20 : 14) / view.k)
      }
      ctx.globalAlpha = 1
      if (pulses.current.size) glow()
    }

    // Glows run their course on their own frames, and stop as soon as none is left
    let frame = 0
    const glow = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (motionPaused()) pulses.current.clear()
        draw()
      })
    }
    kick.current = () => {
      sim.alpha(Math.max(sim.alpha(), 0.15)).restart()
      draw()
    }

    // Fit the settled layout into view once, unless the user has already moved it
    let ticks = 0
    let userMoved = false
    const fit = () => {
      const xs = nodes.map((n) => n.x!)
      const ys = nodes.map((n) => n.y!)
      const minX = Math.min(...xs) - 60
      const maxX = Math.max(...xs) + 60
      const minY = Math.min(...ys) - 40
      const maxY = Math.max(...ys) + 50
      const k = Math.min(2, Math.max(0.25, Math.min(width / (maxX - minX), height / (maxY - minY))))
      view.k = k
      view.x = width / 2 - ((minX + maxX) / 2) * k
      view.y = height / 2 - ((minY + maxY) / 2) * k
    }
    sim.on('tick', () => {
      if (++ticks === 90 && !userMoved) fit()
      draw()
    })

    const toWorld = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }
    }
    const pick = (e: MouseEvent) => {
      const p = toWorld(e)
      let best: Node | null = null
      let bestD = Infinity
      for (const n of nodes) {
        const d = Math.hypot(n.x! - p.x, n.y! - p.y)
        if (d < radius(n) + 6 / view.k && d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }

    let dragging: Node | null = null
    let panning: { x: number; y: number } | null = null
    let moved = false

    const onDown = (e: MouseEvent) => {
      moved = false
      dragging = pick(e)
      if (dragging && dragging.kind !== 'you') {
        sim.alphaTarget(0.25).restart()
        dragging.fx = dragging.x
        dragging.fy = dragging.y
      } else if (!dragging) panning = { x: e.clientX - view.x, y: e.clientY - view.y }
      userMoved = true
    }
    const onMove = (e: MouseEvent) => {
      if (dragging && dragging.kind !== 'you') {
        moved = true
        const p = toWorld(e)
        dragging.fx = p.x
        dragging.fy = p.y
      } else if (panning) {
        moved = true
        view.x = e.clientX - panning.x
        view.y = e.clientY - panning.y
        draw()
      } else if (!dragging) {
        const hit = pick(e)
        if (hit !== hoverRef.current) {
          hoverRef.current = hit
          canvas.style.cursor = hit ? 'pointer' : 'grab'
          draw()
        }
      }
    }
    const onUp = (e: MouseEvent) => {
      if (dragging) {
        const n = dragging
        if (n.kind !== 'you') {
          n.fx = null
          n.fy = null
        }
        sim.alphaTarget(0)
        dragging = null
        if (!moved) {
          if (e.detail >= 2 && n.path) openRef.current(n.path, n.from ? `page=${n.from}` : undefined)
          else selectRef.current(n.id)
        }
      } else if (panning && !moved) selectRef.current(null)
      panning = null
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userMoved = true
      const r = canvas.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))
      const k = Math.min(4, Math.max(0.2, view.k * factor))
      view.x = mx - ((mx - view.x) * k) / view.k
      view.y = my - ((my - view.y) * k) / view.k
      view.k = k
      draw()
    }

    redraw.current = draw
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    resize()
    return () => {
      sim.stop()
      cancelAnimationFrame(frame)
      ro.disconnect()
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [nodes, links, colorOf, focus, query])

  const picked = selected ? data?.nodes.find((n) => n.id === selected) : undefined
  const noteCount = nodes.filter((n) => n.kind === 'note').length

  return (
    <div className="doc-view graph-view">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb current">Brain</span>
          <BrainTabs tab="graph" />
          <span className="muted page-count">
            {noteCount} notes{counts.book ? `, ${counts.book} books` : ''}
            {counts.memory ? `, ${counts.memory} memories` : ''}
          </span>
        </div>
        <div className="toolbar-actions no-drag graph-controls">
          <input className="filter-input small" placeholder="Find anything" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find in the graph" />
          <select value={notebook} onChange={(e) => setNotebook(e.target.value)} aria-label="Notebook">
            <option value="all">All notebooks</option>
            {notebooks.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <div className="segmented text" role="group" aria-label="Colour notes by">
            <button className={colorBy === 'notebook' ? 'on' : ''} onClick={() => pickColor('notebook')}>
              Notebooks
            </button>
            <button className={colorBy === 'mastery' ? 'on' : ''} onClick={() => pickColor('mastery')} title="Colour notes by how well you know them">
              Mastery
            </button>
          </div>
          {center && (
            <label className="check">
              <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
              Only around {fileTitle(center)}
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={hideOrphans} onChange={(e) => setHideOrphans(e.target.checked)} />
            Hide unlinked
          </label>
        </div>
      </header>
      <div className="graph-canvas" ref={wrapRef}>
        {data && nodes.length <= 1 && <div className="empty-state muted">Nothing to show with these filters.</div>}
        <canvas ref={canvasRef} />

        <div className="brain-layers" role="group" aria-label="Show">
          {LAYERS.map((l) => (
            <button key={l.kind} className={`brain-layer k-${l.kind}${layers.has(l.kind) ? ' on' : ''}`} aria-pressed={layers.has(l.kind)} onClick={() => toggleLayer(l.kind)} disabled={!counts[l.kind]}>
              <span className="brain-glyph" aria-hidden="true" />
              {l.label}
              <span className="legend-count">{counts[l.kind] ?? 0}</span>
            </button>
          ))}
        </div>

        {events.length > 0 && (
          <div className="brain-feed" aria-live="polite" aria-label="What Tide just learned">
            <p className="brain-feed-title">
              <span className="brain-live" aria-hidden="true" />
              Live
            </p>
            <ul>
              {events.map((e) => (
                <li key={`${e.at}:${e.label}`}>
                  <button onClick={() => e.id && setSelected(e.id)} disabled={!e.id}>
                    <span className="brain-feed-label">{e.label}</span>
                    <span className="muted small">{ago(e.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {colorBy === 'mastery' && (
        <div className="graph-legend brain-legend">
          {LEVELS.map((l) => (
                <button key={l.level} className={onlyLevel === l.level ? 'on' : ''} onClick={() => setOnlyLevel(onlyLevel === l.level ? null : l.level)} disabled={!levelCounts[l.level]}>
                  <span className="legend-dot" style={{ background: `var(${l.color})` }} />
                  {l.label}
                  <span className="legend-count">{levelCounts[l.level] ?? 0}</span>
                </button>
              ))}
        </div>
        )}

        {picked && <NodeCard node={picked} data={data!} onClose={() => setSelected(null)} onAround={(id) => (setCenter(id), setLocal(true), setNotebook('all'))} onForgot={load} />}
      </div>
    </div>
  )
}

/** What you can do with the node you picked */
function NodeCard({ node, data, onClose, onAround, onForgot }: { node: BrainNode; data: BrainData; onClose(): void; onAround(id: string): void; onForgot(): void }) {
  const app = useApp()
  const links = data.edges.filter((e) => e.source === node.id || e.target === node.id).length
  const level = node.level && node.level !== 'new' ? LEVELS.find((l) => l.level === node.level) : undefined
  const pages = node.from ? { kind: 'pages' as const, path: node.path!, from: node.from, to: node.to ?? node.from, label: `${node.label} (pages ${node.from}–${node.to})` } : null
  const kindLabel: Record<BrainKind, string> = { you: 'You', notebook: 'Notebook', note: 'Note', book: 'Book', chapter: 'Chapter', memory: 'What the tutor remembers', week: 'This week' }
  return (
    <div className="graph-card no-drag" role="dialog" aria-label={node.label}>
      <div className="graph-card-head">
        <p className="graph-card-title">{node.kind === 'you' ? 'Where you’re heading' : node.label}</p>
        <button className="icon-btn small" onClick={onClose} aria-label="Close">
          <Icon name="x" size={12} />
        </button>
      </div>
      <p className="muted small">
        {[kindLabel[node.kind], node.kind === 'note' || node.kind === 'notebook' ? node.group : '', node.kind === 'note' ? `${links} ${links === 1 ? 'link' : 'links'}` : '', node.progress !== undefined ? `${Math.round(node.progress * 100)}% of the roadmap` : '', pages ? `pages ${pages.from}–${pages.to}` : ''].filter(Boolean).join(', ')}
        {level && <span className={`level-pill level-${node.level}`}>{level.label}</span>}
      </p>
      {node.detail && <p className="graph-card-detail">{node.detail}</p>}
      <div className="graph-card-actions">
        {node.kind === 'you' && (
          <button className="btn small primary" onClick={() => app.setView({ kind: 'coach' })}>
            Your week
          </button>
        )}
        {node.kind === 'notebook' && (
          <button className="btn small primary" onClick={() => app.setView({ kind: 'notebook', path: node.path! })}>
            Open notebook
          </button>
        )}
        {(node.kind === 'note' || node.kind === 'book') && (
          <button className="btn small primary" onClick={() => app.openPath(node.path!)}>
            Open
          </button>
        )}
        {node.kind === 'note' && (
          <>
            <button className="btn small" onClick={() => app.setView({ kind: 'session', mode: 'quiz', scope: { kind: 'note', path: node.path! }, topic: node.label, nonce: Date.now() })}>
              Quiz me
            </button>
            <button className="btn small" onClick={() => onAround(node.id)}>
              Show around
            </button>
          </>
        )}
        {pages && (
          <>
            <button className="btn small primary" onClick={() => app.openPath(pages.path, `page=${pages.from}`)}>
              Read
            </button>
            <button className="btn small" onClick={() => app.setView({ kind: 'session', mode: 'teach', scope: pages, topic: node.label, nonce: Date.now() })}>
              Teach me
            </button>
            <button className="btn small" onClick={() => app.setView({ kind: 'session', mode: 'quiz', scope: pages, topic: node.label, options: { length: 6 }, nonce: Date.now() })}>
              Quiz
            </button>
            <button className="btn small" onClick={() => app.setView({ kind: 'exam', scope: pages, topic: node.label, options: { questions: 5, minutes: 30, difficulty: 'normal', style: 'university' }, nonce: Date.now() })}>
              Test me
            </button>
          </>
        )}
        {node.kind === 'week' && (
          <button
            className="btn small primary"
            onClick={() => {
              const nb = data.nodes.find((n) => n.kind === 'notebook' && n.label === node.group)
              app.setView({ kind: 'session', mode: 'teach', scope: nb?.path ? { kind: 'folder', path: nb.path } : { kind: 'vault' }, topic: node.label, nonce: Date.now() })
            }}
          >
            Learn it
          </button>
        )}
        {node.kind === 'memory' && (
          <button
            className="btn small"
            onClick={async () => {
              await window.tide.memory.remove(node.id.replace(/^mem:/, ''))
              onClose()
              onForgot()
            }}
          >
            Forget this
          </button>
        )}
      </div>
    </div>
  )
}
