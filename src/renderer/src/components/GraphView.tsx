import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import type { GraphData, Mastery, MasteryLevel } from '@shared/types'
import { fileTitle, useApp } from '../state'
import { Icon } from './Icon'

/** Mid-tone hues that read on light and dark backgrounds */
const PALETTE = ['#3fa58f', '#6c8cdb', '#d0775a', '#c59a3a', '#9a72cf', '#4fa3c7', '#c8668f', '#7fa548', '#8f8f8f']

interface Node extends SimulationNodeDatum {
  path: string
  title: string
  notebook: string
  degree: number
}
type Link = SimulationLinkDatum<Node>

/** How well you know each note, from quizzes and reviews; colours come from the theme */
const LEVELS: { level: MasteryLevel; label: string; color: string }[] = [
  { level: 'weak', label: 'Weak', color: '--danger' },
  { level: 'shaky', label: 'Shaky', color: '--warn' },
  { level: 'solid', label: 'Solid', color: '--info' },
  { level: 'mastered', label: 'Mastered', color: '--accent' },
  { level: 'new', label: 'Not tested', color: '--line-strong' }
]

export function GraphView({ focus }: { focus?: string }) {
  const app = useApp()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<GraphData | null>(null)
  const isNoteFocus = !!focus && /\.md$/i.test(focus)
  const [notebook, setNotebook] = useState<string>(focus && !isNoteFocus ? focus : 'all')
  const [local, setLocal] = useState(isNoteFocus)
  const [hideOrphans, setHideOrphans] = useState(false)
  const [query, setQuery] = useState('')
  const [colorBy, setColorBy] = useState<'notebook' | 'mastery'>(() => (localStorage.getItem('tide.graph.color') === 'mastery' ? 'mastery' : 'notebook'))
  const [mastery, setMastery] = useState<Record<string, Mastery>>({})
  const [onlyLevel, setOnlyLevel] = useState<MasteryLevel | null>(null)
  /** The note picked with a click; its card offers open, quiz and "show around" */
  const [selected, setSelected] = useState<string | null>(null)
  /** The note the graph is narrowed around: the one you came from, or one you chose here */
  const [center, setCenter] = useState<string | null>(isNoteFocus ? focus! : null)
  const hoverRef = useRef<Node | null>(null)
  const openRef = useRef(app.openPath)
  openRef.current = app.openPath

  useEffect(() => {
    window.tide.learn.graph().then(setData)
    window.tide.learn.mastery().then(setMastery).catch(() => {})
  }, [app.files])

  const pickColor = (v: 'notebook' | 'mastery') => {
    setColorBy(v)
    setOnlyLevel(null)
    localStorage.setItem('tide.graph.color', v)
  }
  const levelOf = (path: string): MasteryLevel => mastery[path]?.level ?? 'new'

  const notebooks = useMemo(() => [...new Set(data?.nodes.map((n) => n.notebook).filter(Boolean))].sort(), [data])
  const colorOf = useMemo(() => {
    const map = new Map(notebooks.map((n, i) => [n, PALETTE[i % PALETTE.length]]))
    return (nb: string) => map.get(nb) ?? PALETTE[PALETTE.length - 1]
  }, [notebooks])

  // Pick the visible subgraph
  const { nodes, links } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], links: [] as Link[] }
    let keep = new Set(data.nodes.map((n) => n.path))
    if (notebook !== 'all') keep = new Set(data.nodes.filter((n) => n.notebook === notebook).map((n) => n.path))
    if (local && center) {
      const near = new Set([center])
      for (let depth = 0; depth < 2; depth++) {
        for (const e of data.edges) {
          if (near.has(e.source)) near.add(e.target)
          else if (near.has(e.target)) near.add(e.source)
        }
      }
      keep = near
    }
    const edges = data.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]))
    const nodes: Node[] = data.nodes
      .filter((n) => keep.has(n.path) && (!hideOrphans || linked.has(n.path) || n.path === center))
      .map((n) => ({ ...n }))
    const ids = new Set(nodes.map((n) => n.path))
    return { nodes, links: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e })) as Link[] }
  }, [data, notebook, local, center, hideOrphans])

  const levelCounts = useMemo(() => {
    const out: Partial<Record<MasteryLevel, number>> = {}
    for (const n of nodes) out[levelOf(n.path)] = (out[levelOf(n.path)] ?? 0) + 1
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, mastery])
  const selectRef = useRef(setSelected)
  // Colouring and selection only repaint; they must not restart the layout
  const style = useRef({ colorBy, mastery, onlyLevel, selected })
  style.current = { colorBy, mastery, onlyLevel, selected }
  const redraw = useRef<() => void>(() => {})
  useEffect(() => redraw.current(), [colorBy, mastery, onlyLevel, selected])

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
    const ink = css.getPropertyValue('--ink').trim()
    const muted = css.getPropertyValue('--ink-muted').trim()
    const line = css.getPropertyValue('--line-strong').trim()
    const accent = css.getPropertyValue('--accent').trim()
    const levelColor = new Map(LEVELS.map((l) => [l.level, css.getPropertyValue(l.color).trim()]))
    const q = query.trim().toLowerCase()

    const neighbors = new Map<string, Set<string>>()
    for (const l of links) {
      const s = typeof l.source === 'object' ? (l.source as Node).path : (l.source as string)
      const t = typeof l.target === 'object' ? (l.target as Node).path : (l.target as string)
      if (!neighbors.has(s)) neighbors.set(s, new Set())
      if (!neighbors.has(t)) neighbors.set(t, new Set())
      neighbors.get(s)!.add(t)
      neighbors.get(t)!.add(s)
    }
    const radius = (n: Node) => 4 + Math.sqrt(n.degree) * 2.6
    // Each notebook pulls its notes toward its own spot, so unlinked notes still form readable groups
    const groups = [...new Set(nodes.map((n) => n.notebook))]
    const ring = groups.length > 1 ? 180 + Math.sqrt(nodes.length) * 34 : 0
    const center = new Map(
      groups.map((g, i) => [g, { x: Math.cos((i / groups.length) * Math.PI * 2) * ring, y: Math.sin((i / groups.length) * Math.PI * 2) * ring }])
    )
    // Dense graphs only label the notes that matter; zooming in reveals the rest
    const showAllLabels = nodes.length <= 24

    const sim = forceSimulation<Node>(nodes)
      .force('link', forceLink<Node, Link>(links).id((n) => n.path).distance(60).strength(0.6))
      .force('charge', forceManyBody().strength(-90).distanceMax(260))
      .force('center', forceCenter(0, 0))
      .force('x', forceX<Node>((n) => center.get(n.notebook)?.x ?? 0).strength(0.14))
      .force('y', forceY<Node>((n) => center.get(n.notebook)?.y ?? 0).strength(0.14))
      .force('collide', forceCollide<Node>().radius((n) => radius(n) + 9))

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

    function draw() {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.translate(view.x, view.y)
      ctx.scale(view.k, view.k)
      const { colorBy, mastery, onlyLevel, selected } = style.current
      const fill = (n: Node) => (colorBy === 'mastery' ? levelColor.get(mastery[n.path]?.level ?? 'new')! : colorOf(n.notebook))
      const here = selected ?? focus
      const hover = hoverRef.current
      const lit = hover ? neighbors.get(hover.path) ?? new Set<string>() : null

      ctx.lineWidth = 1 / view.k
      for (const l of links) {
        const s = l.source as Node
        const t = l.target as Node
        const active = hover && (s === hover || t === hover)
        ctx.strokeStyle = active ? accent : line
        ctx.globalAlpha = hover && !active ? 0.25 : 1
        ctx.beginPath()
        ctx.moveTo(s.x!, s.y!)
        ctx.lineTo(t.x!, t.y!)
        ctx.stroke()
      }

      for (const n of nodes) {
        const dim =
          (hover && n !== hover && !lit!.has(n.path)) ||
          (q && !n.title.toLowerCase().includes(q)) ||
          (onlyLevel && (mastery[n.path]?.level ?? 'new') !== onlyLevel)
        ctx.globalAlpha = dim ? 0.15 : 1
        ctx.fillStyle = n.path === focus && colorBy === 'notebook' ? accent : fill(n)
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, radius(n), 0, Math.PI * 2)
        ctx.fill()
        if (n.path === here) {
          ctx.strokeStyle = ink
          ctx.lineWidth = 2 / view.k
          ctx.stroke()
          ctx.lineWidth = 1 / view.k
        }
      }

      // Labels for important, hovered or matching notes, more as you zoom in
      ctx.font = `${12 / view.k}px ${css.getPropertyValue('--font-ui')}`
      ctx.textAlign = 'center'
      for (const n of nodes) {
        const show =
          n === hover ||
          lit?.has(n.path) ||
          n.path === here ||
          (q && n.title.toLowerCase().includes(q)) ||
          (onlyLevel && (mastery[n.path]?.level ?? 'new') === onlyLevel && view.k > 0.6) ||
          (!hover && (view.k > 1.6 || n.degree >= 2 || (showAllLabels && view.k > 0.75)))
        if (!show) continue
        ctx.globalAlpha = hover && n !== hover && !lit!.has(n.path) ? 0.3 : 1
        ctx.fillStyle = n === hover ? ink : muted
        ctx.fillText(n.title.length > 36 ? n.title.slice(0, 34) + '…' : n.title, n.x!, n.y! + radius(n) + 13 / view.k)
      }
      // Notebook names mark each cluster
      if (groups.length > 1 && !hover) {
        ctx.font = `600 ${14 / view.k}px ${css.getPropertyValue('--font-ui')}`
        ctx.fillStyle = muted
        ctx.globalAlpha = 0.9
        for (const g of groups) {
          const members = nodes.filter((n) => n.notebook === g)
          if (!members.length || !g) continue
          const top = Math.min(...members.map((n) => n.y!)) - 22 / view.k
          const cx = members.reduce((s, n) => s + n.x!, 0) / members.length
          ctx.fillText(g, cx, top)
        }
      }
      ctx.globalAlpha = 1
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
      const k = Math.min(2, Math.max(0.3, Math.min(width / (maxX - minX), height / (maxY - minY))))
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
      if (dragging) {
        sim.alphaTarget(0.25).restart()
        dragging.fx = dragging.x
        dragging.fy = dragging.y
      } else panning = { x: e.clientX - view.x, y: e.clientY - view.y }
      userMoved = true
    }
    const onMove = (e: MouseEvent) => {
      if (dragging) {
        moved = true
        const p = toWorld(e)
        dragging.fx = p.x
        dragging.fy = p.y
      } else if (panning) {
        moved = true
        view.x = e.clientX - panning.x
        view.y = e.clientY - panning.y
        draw()
      } else {
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
        dragging.fx = null
        dragging.fy = null
        sim.alphaTarget(0)
        dragging = null
        if (!moved) {
          if (e.detail >= 2) openRef.current(n.path)
          else selectRef.current(n.path)
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
      ro.disconnect()
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [nodes, links, colorOf, focus, query])

  const linkCount = links.length
  const picked = selected ? data?.nodes.find((n) => n.path === selected) : undefined
  const pickedLinks = selected ? (data?.edges.filter((e) => e.source === selected || e.target === selected).length ?? 0) : 0
  const pickedMastery = selected ? mastery[selected] : undefined

  return (
    <div className="doc-view graph-view">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb current">Graph</span>
          <span className="muted page-count">
            {nodes.length} notes, {linkCount} links
          </span>
        </div>
        <div className="toolbar-actions no-drag graph-controls">
          <input className="filter-input small" placeholder="Find a note" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a note" />
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
            <button className={colorBy === 'mastery' ? 'on' : ''} onClick={() => pickColor('mastery')} title="Colour by how well you know each note">
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
        {data && nodes.length === 0 && <div className="empty-state muted">No notes to show with these filters.</div>}
        {data && nodes.length > 0 && linkCount === 0 && (
          <p className="graph-hint muted">No links yet. Use [[Note name]] to connect notes.</p>
        )}
        <canvas ref={canvasRef} />
        <div className="graph-legend">
          {colorBy === 'notebook'
            ? notebooks.map((n) => (
                <button key={n} className={notebook === n ? 'on' : ''} onClick={() => setNotebook(notebook === n ? 'all' : n)}>
                  <span className="legend-dot" style={{ background: colorOf(n) }} />
                  {n}
                </button>
              ))
            : LEVELS.map((l) => (
                <button key={l.level} className={onlyLevel === l.level ? 'on' : ''} onClick={() => setOnlyLevel(onlyLevel === l.level ? null : l.level)} disabled={!levelCounts[l.level]}>
                  <span className="legend-dot" style={{ background: `var(${l.color})` }} />
                  {l.label}
                  <span className="legend-count">{levelCounts[l.level] ?? 0}</span>
                </button>
              ))}
        </div>
        {picked && (
          <div className="graph-card no-drag" role="dialog" aria-label={picked.title}>
            <div className="graph-card-head">
              <p className="graph-card-title">{picked.title}</p>
              <button className="icon-btn small" onClick={() => setSelected(null)} aria-label="Close">
                <Icon name="x" size={12} />
              </button>
            </div>
            <p className="muted small">
              {[picked.notebook, `${pickedLinks} ${pickedLinks === 1 ? 'link' : 'links'}`].filter(Boolean).join(', ')}
              {pickedMastery && pickedMastery.level !== 'new' && (
                <span className={`level-pill level-${pickedMastery.level}`}>{LEVELS.find((l) => l.level === pickedMastery.level)?.label}</span>
              )}
            </p>
            <div className="graph-card-actions">
              <button className="btn small primary" onClick={() => app.openPath(picked.path)}>
                Open
              </button>
              <button
                className="btn small"
                onClick={() => app.setView({ kind: 'session', mode: 'quiz', scope: { kind: 'note', path: picked.path }, topic: picked.title, nonce: Date.now() })}
              >
                Quiz me
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setCenter(picked.path)
                  setLocal(true)
                  setNotebook('all')
                }}
                disabled={local && center === picked.path}
              >
                Show around
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
