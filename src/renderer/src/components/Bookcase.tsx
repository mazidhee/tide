import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReadStatus } from '@shared/types'
import { useApp } from '../state'
import { hasTopic, readStatusOf, type LibraryItem } from '../lib/library'
import { coverArt, drawLibrary, shortTitle, spineVars, subjectCode, type CaseSubject, type ShelfKind } from '../lib/bookcase'
import { coverFor, coverTone, knownCover, knownTone } from '../lib/covers'
import { Icon } from './Icon'

type Sort = 'shelf' | 'title' | 'source' | 'date' | 'status'
type Filter = 'all' | ReadStatus

interface Entry {
  item: LibraryItem
  /** Index in the flat list, and data-i on the drawing */
  i: number
  si: number
  kind: ShelfKind
  status: ReadStatus
  short: string
  source: string
  date: string
  face: boolean
}

interface Group {
  code: string
  name: string
  entries: Entry[]
}

const GUT = 176
const STATUS_ORDER: Record<ReadStatus, number> = { reading: 0, unread: 1, read: 2 }
const SORTS: Record<Sort, (a: Entry, b: Entry) => number> = {
  shelf: (a, b) => b.item.mtime - a.item.mtime,
  title: (a, b) => a.short.localeCompare(b.short),
  source: (a, b) => a.source.localeCompare(b.source) || a.short.localeCompare(b.short),
  date: (a, b) => a.item.mtime - b.item.mtime,
  status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.item.mtime - a.item.mtime
}
const SORT_LABEL: [Sort, string][] = [
  ['shelf', 'newest first'],
  ['title', 'title'],
  ['source', 'source'],
  ['date', 'oldest first'],
  ['status', 'reading first']
]
const KIND_NAME: Record<LibraryItem['type'], string> = { article: 'web article', youtube: 'video', pdf: 'PDF', epub: 'book (EPUB)', doc: 'document', link: 'link' }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const pad3 = (n: number) => String(n).padStart(3, '0')
const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}
const kindOf = (t: LibraryItem['type']): ShelfKind => (t === 'pdf' || t === 'epub' ? 'cloth' : t === 'youtube' ? 'video' : 'paper')
const dateOf = (i: LibraryItem) => {
  const t = i.saved ? new Date(i.saved + 'T12:00:00').getTime() : i.mtime
  return t ? new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''
}
const mayHaveCover = (i: LibraryItem) => i.type === 'pdf' || !!i.image
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Shelves by subject (notebooks first, as the Library orders them), then an Unfiled shelf */
function groupItems(items: LibraryItem[], subjects: string[], sort: Sort): { groups: Group[]; flat: Entry[] } {
  const buckets = new Map<number, LibraryItem[]>()
  for (const it of items) {
    let si = subjects.findIndex((s) => hasTopic(it, s))
    if (si < 0) si = subjects.length
    buckets.set(si, [...(buckets.get(si) ?? []), it])
  }
  const taken = new Set<string>()
  const groups: Group[] = []
  const flat: Entry[] = []
  const order = [...buckets.keys()].sort((a, b) => a - b)
  for (const si of order) {
    const name = si < subjects.length ? subjects[si] : 'Unfiled'
    const code = si < subjects.length ? subjectCode(name, taken) : 'UNF'
    const gi = groups.length
    const entries: Entry[] = buckets.get(si)!.map((item) => ({
      item,
      i: 0,
      si: gi,
      kind: kindOf(item.type),
      status: readStatusOf(item),
      short: shortTitle(item.title),
      source: item.type === 'pdf' ? 'PDF' : item.type === 'epub' ? 'EPUB' : item.type === 'doc' ? 'Doc' : item.site || hostOf(item.sourceUrl) || KIND_NAME[item.type],
      date: dateOf(item),
      face: false
    }))
    // One book face-out per shelf (reading, else the newest with a cover), and one video
    const pickFace = (pool: Entry[]) =>
      pool.find((e) => e.status === 'reading' && mayHaveCover(e.item)) ??
      [...pool].filter((e) => mayHaveCover(e.item)).sort((a, b) => b.item.mtime - a.item.mtime)[0] ??
      // nothing with a cover: the newest stands face-out in a made cover
      [...pool].sort((a, b) => b.item.mtime - a.item.mtime)[0]
    const book = pickFace(entries.filter((e) => e.kind !== 'video'))
    const video = pickFace(entries.filter((e) => e.kind === 'video'))
    if (book) book.face = true
    if (video) video.face = true
    entries.sort(SORTS[sort])
    groups.push({ code, name, entries })
  }
  for (const g of groups) for (const e of g.entries) flat.push(Object.assign(e, { i: flat.length }))
  return { groups, flat }
}

const statusNote = (e: Entry) =>
  e.status === 'unread'
    ? e.item.type === 'youtube'
      ? 'Saved to watch. Tide can teach it to you from the transcript, or quiz you once you have.'
      : "On the shelf, waiting. Unread books are the useful part of a library: they map what you don't know yet."
    : e.status === 'reading'
      ? 'In progress. Tide can pick up where you left off, or quiz you on what you have covered.'
      : 'Finished. A short quiz every few weeks keeps it from fading.'

function Dot({ s }: { s: ReadStatus }) {
  return s === 'unread' ? null : <i className={`bc-dot ${s}`} />
}

function Mark({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/** The preview's cover: the real one when it has it, a generated one otherwise */
function PreviewCover({ e }: { e: Entry }) {
  const [src, setSrc] = useState<string | null>(() => knownCover(e.item.path))
  const [ok, setOk] = useState(true)
  useEffect(() => {
    let live = true
    setOk(true)
    setSrc(knownCover(e.item.path))
    coverFor(e.item).then((u) => live && setSrc(u))
    return () => {
      live = false
    }
  }, [e.item])
  const video = e.kind === 'video'
  const cw = video ? 192 : 98
  const ch = video ? 108 : Math.round(cw / (e.kind === 'paper' ? 0.75 : 0.7))
  const art = coverArt({ title: e.item.title, byline: e.source, key: e.item.path, kind: e.kind, tone: knownTone(e.item.path) }, cw, ch)
  return (
    <div className={`bc-pv-cover${video ? ' video' : ''}`}>
      <div className="bc-pv-art" style={{ width: cw, height: ch }}>
        {!video && <span className="bc-pv-pages" aria-hidden="true" />}
        <svg width={cw} height={ch} viewBox={`0 0 ${cw} ${ch}`} dangerouslySetInnerHTML={{ __html: art }} />
        {src && ok && <img src={src} alt="" draggable={false} onError={() => setOk(false)} />}
        {video && (
          <span className="bc-pv-play" aria-hidden="true">
            <Icon name="play" size={14} />
          </span>
        )}
        {video && e.item.duration && <span className="bc-pv-dur">{e.item.duration}</span>}
      </div>
    </div>
  )
}

export function Bookcase({ items, subjects, setStatus, tide }: { items: LibraryItem[]; subjects: string[]; setStatus(path: string, s: ReadStatus): void; /** The new design: no index down the left; the shelves fill the window, with what to pick up next laid over them */ tide?: boolean }) {
  const app = useApp()
  const [sort, setSort] = useState<Sort>('shelf')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<'filter' | 'sort' | null>(null)
  const [selPath, setSelPath] = useState<string | null>(null)
  const [zoom, setZoomState] = useState(1)
  const [fitMode, setFitMode] = useState(true)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [active, setActive] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const stageRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const libRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const whereRef = useRef<HTMLSpanElement>(null)
  const ctrRef = useRef<HTMLSpanElement>(null)
  const listHover = useRef(false)

  const q = query.trim().toLowerCase()
  const { groups, flat } = useMemo(() => groupItems(items, subjects, sort), [items, subjects, sort])
  const byPath = useMemo(() => new Map(flat.map((e) => [e.item.path, e])), [flat])
  const flatRef = useRef(flat)
  flatRef.current = flat
  const sel = selPath ? (byPath.get(selPath) ?? null) : null
  const open = !!sel

  // Drawn once per data or order change; hover, dimming, covers and colours are patched in place
  const drawing = useMemo(() => {
    const cs: CaseSubject[] = groups.map((g) => ({
      code: g.code,
      name: g.name,
      items: g.entries.map((e) => ({
        key: e.item.path,
        i: e.i,
        title: e.item.title,
        kind: e.kind,
        status: e.status,
        face: e.face,
        byline: e.source,
        tone: knownTone(e.item.path),
        cover: e.face ? knownCover(e.item.path) : null
      }))
    }))
    return drawLibrary(cs)
  }, [groups])

  const matches = useCallback((e: Entry) => (filter === 'all' || e.status === filter) && (!q || `${e.item.title} ${e.source} ${e.date} ${e.item.excerpt}`.toLowerCase().includes(q)), [filter, q])
  const anyQ = !!q || filter !== 'all'

  /* --------------------------------------------------------- zoom & fit */
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [flat.length > 0])
  const vb = drawing.vb
  const { z, overlay } = useMemo(() => {
    if (!fitMode) return { z: zoom, overlay: true }
    const ah = size.h - 30 - 58
    const f = (side: number) => clamp(Math.min((size.w - 48 - GUT - side) / vb[2], ah / vb[3]), 0.5, 2)
    if (open) {
      const zp = f(340)
      if (zp >= 0.62) return { z: zp, overlay: false }
      return { z: f(0), overlay: true }
    }
    return { z: f(0), overlay: false }
  }, [fitMode, zoom, size, vb, open])
  const setZoom = (nz: number) => {
    const s = scrollerRef.current
    const cx = s ? (s.scrollLeft + s.clientWidth / 2) / Math.max(1, s.scrollWidth) : 0.5
    const cy = s ? (s.scrollTop + s.clientHeight / 2) / Math.max(1, s.scrollHeight) : 0.5
    setFitMode(false)
    setZoomState(clamp(nz, 0.5, 2.2))
    requestAnimationFrame(() => {
      if (!s) return
      s.scrollLeft = cx * s.scrollWidth - s.clientWidth / 2
      s.scrollTop = cy * s.scrollHeight - s.clientHeight / 2
    })
  }
  const fit = () => {
    setFitMode(true)
    scrollerRef.current?.scrollTo({ top: 0, left: 0 })
  }

  /* -------------------------------------------------- shelves in view */
  const scrollable = () => {
    const s = scrollerRef.current
    return !!s && s.scrollHeight > s.clientHeight + 4
  }
  const goToCase = useCallback((i: number) => {
    setActive(i)
    const p = libRef.current?.querySelector<HTMLElement>(`.bc-plate[data-i="${i}"]`)
    if (!p) return
    if (scrollable()) p.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
    p.classList.remove('flash')
    void p.offsetWidth
    p.classList.add('flash')
  }, [])
  const onScroll = () => {
    if (!scrollable()) return
    const s = scrollerRef.current!
    const lib = libRef.current!
    const cy = s.scrollTop + s.clientHeight / 2
    let best = active
    let bd = Infinity
    lib.querySelectorAll<HTMLElement>('.bc-plate').forEach((p) => {
      const d = Math.abs(cy - (lib.offsetTop + p.offsetTop))
      if (d < bd) {
        bd = d
        best = +p.dataset.i!
      }
    })
    if (best !== active) setActive(best)
  }
  // Keep the list's group for the shelf in view on screen
  useEffect(() => {
    const list = listRef.current
    const g = list?.querySelector<HTMLElement>(`.bc-grp[data-i="${active}"]`)
    if (!list || !g || listHover.current) return
    const top = g.offsetTop - list.offsetTop
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - 80) list.scrollTo({ top: top - 4, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [active])

  /* ------------------------------------------------ patches on the svg */
  const svgBooks = () => svgRef.current?.querySelectorAll<SVGGElement>('.bk') ?? []
  useEffect(() => {
    svgBooks().forEach((g) => {
      const e = flat[+g.dataset.i!]
      g.classList.toggle('dim', anyQ && !!e && !matches(e))
    })
  }, [drawing, matches, anyQ, flat])
  useEffect(() => {
    svgRef.current?.querySelectorAll('.bk.sel').forEach((x) => x.classList.remove('sel'))
    if (sel) svgRef.current?.querySelector(`.bk[data-i="${sel.i}"]`)?.classList.add('sel')
  }, [drawing, sel])

  // Covers and their colours, loaded as shelves scroll into view and patched onto the drawing
  useEffect(() => {
    const svg = svgRef.current
    const root = scrollerRef.current
    if (!svg || !root) return
    let live = true
    const queue: number[] = []
    let running = 0
    const patch = (path: string, url: string | null, tone: string | null | undefined) => {
      const e = flatRef.current.find((x) => x.item.path === path)
      if (!e || !live) return
      const g = svg.querySelector<SVGGElement>(`.bk[data-i="${e.i}"]`)
      if (!g) return
      if (url && e.face) {
        const img = g.querySelector<SVGImageElement>('image[data-cover]')
        if (img && img.getAttribute('href') !== url) {
          img.setAttribute('href', url)
          img.removeAttribute('visibility')
        }
      }
      if (tone !== undefined) for (const [k, v] of Object.entries(spineVars(e.kind, path, tone))) g.style.setProperty(k, v)
    }
    const pump = () => {
      while (live && running < 3 && queue.length) {
        const e = flatRef.current[queue.shift()!]
        if (!e) continue
        running++
        const path = e.item.path
        coverFor(e.item)
          .then(async (url) => {
            if (!live) return
            patch(path, url, undefined)
            if (url && knownTone(path) === undefined) {
              const tone = await coverTone(path, url)
              if (tone) patch(path, url, tone)
            }
          })
          .finally(() => {
            running--
            pump()
          })
      }
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue
          io.unobserve(en.target)
          const i = +(en.target as SVGGElement).dataset.i!
          const e = flatRef.current[i]
          if (!e) continue
          // Face-out covers first, they show the most
          if (e.face) queue.unshift(i)
          else queue.push(i)
        }
        pump()
      },
      { root, rootMargin: '300px' }
    )
    svg.querySelectorAll('.bk').forEach((g) => io.observe(g))
    return () => {
      live = false
      io.disconnect()
    }
  }, [drawing])

  /* ------------------------------------------------- hover & tooltip */
  const hoverPath = useRef<string | null>(null)
  const clearPeek = () => listRef.current?.querySelectorAll('.bc-r.peek').forEach((x) => x.classList.remove('peek'))
  const updateCounter = (e?: Entry | null) => {
    const g = groups[active]
    if (!whereRef.current || !ctrRef.current) return
    if (e) {
      ctrRef.current.textContent = pad3(e.i + 1)
      whereRef.current.textContent = `${groups[e.si].code.toLowerCase()} · shelf ${drawing.shelfOf[e.item.path] ?? 1}`
    } else if (g) {
      ctrRef.current.textContent = pad3(groups.slice(0, active + 1).reduce((n, x) => n + x.entries.length, 0))
      whereRef.current.textContent = g.name.toLowerCase()
    }
  }
  useEffect(() => updateCounter(null))
  const hideTip = () => {
    hoverPath.current = null
    tipRef.current?.classList.remove('on')
    clearPeek()
    updateCounter(null)
  }
  const onMove = (ev: React.PointerEvent) => {
    const g = (ev.target as Element).closest?.('.bk') as SVGGElement | null
    const tip = tipRef.current
    const stage = stageRef.current
    if (!tip || !stage) return
    if (!g) {
      if (hoverPath.current) hideTip()
      return
    }
    const e = flat[+g.dataset.i!]
    if (!e) return
    if (hoverPath.current !== e.item.path) {
      hoverPath.current = e.item.path
      const st = e.status === 'unread' ? '<span>unread</span>' : `<span class="bc-tm-st"><i class="bc-dot ${e.status}"></i>${e.status}</span>`
      const t = document.createElement('div')
      t.className = 'bc-tt'
      t.textContent = e.item.title
      const m = document.createElement('div')
      m.className = 'bc-tm'
      m.innerHTML = `<span></span>${st}`
      m.firstElementChild!.textContent = [e.source, e.item.type === 'youtube' ? e.item.duration : e.date].filter(Boolean).join(' · ')
      tip.replaceChildren(t, m)
      tip.classList.add('on')
      if (!scrollable() && e.si !== active) setActive(e.si)
      updateCounter(e)
      clearPeek()
      listRef.current?.querySelector(`.bc-r[data-i="${e.i}"]`)?.classList.add('peek')
    }
    const sr = stage.getBoundingClientRect()
    let x = ev.clientX - sr.left + 14
    let y = ev.clientY - sr.top + 16
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    if (x + tw > sr.width - 8) x = ev.clientX - sr.left - tw - 12
    if (y + th > sr.height - 44) y = ev.clientY - sr.top - th - 12
    tip.style.transform = `translate(${x}px,${y}px)`
  }

  /* --------------------------------------------------------- preview */
  const openPreview = (e: Entry, pan?: boolean) => {
    const wasOpen = !!sel
    setSelPath(e.item.path)
    setActive(e.si)
    if (pan || !wasOpen) requestAnimationFrame(() => goToCase(e.si))
  }
  const closePreview = () => setSelPath(null)
  const step = (d: number) => {
    if (!sel) return
    const list = groups[sel.si].entries
    const nb = list[list.indexOf(sel) + d]
    if (nb) openPreview(nb)
  }
  const scope = (e: Entry) => ({ kind: 'note' as const, path: e.item.path })
  const teach = (e: Entry) => app.setView({ kind: 'session', mode: 'teach', scope: scope(e), topic: e.item.title, nonce: Date.now() })
  const quiz = (e: Entry) => app.setView({ kind: 'session', mode: 'quiz', scope: scope(e), topic: e.item.title, options: { length: 6 }, nonce: Date.now() })

  /* -------------------------------------------------------- keyboard */
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === '/') {
      e.preventDefault()
      searchRef.current?.focus()
    } else if (e.key === 'Escape') {
      if (menu) setMenu(null)
      else if (sel) closePreview()
    } else if (e.key === 'ArrowRight' && sel) step(1)
    else if (e.key === 'ArrowLeft' && sel) step(-1)
    else if (e.key === 'ArrowDown' && !sel) {
      e.preventDefault()
      goToCase(Math.min(groups.length - 1, active + 1))
    } else if (e.key === 'ArrowUp' && !sel) {
      e.preventDefault()
      goToCase(Math.max(0, active - 1))
    } else if (e.key === '+' || e.key === '=') setZoom(z * 1.18)
    else if (e.key === '-') setZoom(z / 1.18)
    else if (e.key === '0') fit()
    else if (e.key === 'Enter' && sel && !(t.closest('button') && t !== document.body)) app.openPath(sel.item.path)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e)
    const close = (e: MouseEvent) => !(e.target as Element).closest?.('.bc-pop, .bc-tbtn') && setMenu(null)
    window.addEventListener('keydown', h)
    window.addEventListener('mousedown', close)
    return () => {
      window.removeEventListener('keydown', h)
      window.removeEventListener('mousedown', close)
    }
  }, [])

  // Searching jumps to the first shelf with a match when the one in view has none
  useEffect(() => {
    if (!q) return
    const id = setTimeout(() => {
      if (groups[active]?.entries.some(matches)) return
      const i = groups.findIndex((g) => g.entries.some(matches))
      if (i >= 0) goToCase(i)
    }, 220)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  /* ----------------------------------------------------------- totals */
  const n = flat.length
  const nRead = flat.filter((e) => e.status === 'read').length
  const nReading = flat.filter((e) => e.status === 'reading').length
  const nUnread = n - nRead - nReading
  const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0)
  const groupStats = groups.map((g) => {
    const r = g.entries.filter((e) => e.status === 'read').length
    const rd = g.entries.filter((e) => e.status === 'reading').length
    return { read: r, reading: rd, n: g.entries.length, hits: anyQ ? g.entries.filter(matches).length : g.entries.length }
  })
  const [mx, my, vw, vh] = vb
  const selPos = sel ? groups[sel.si].entries.indexOf(sel) : -1

  if (!n)
    return (
      <div className="bc-empty">
        <p>No shelves to fill yet.</p>
        <p className="muted">Save a link, a video or a PDF into the Library and it will be shelved here under its subject.</p>
      </div>
    )

  return (
    <div className={tide ? 'bc td-bc' : 'bc'}>
      <header className="bc-top">
        <div className="bc-crumb">
          <Icon name="library" size={14} />
          <span>Library</span>
          <span className="bc-sep">/</span>
          <b>shelves</b>
          <span className="bc-tag">
            {n} · {groups.length} {groups.length === 1 ? 'subject' : 'subjects'}
          </span>
        </div>
        <div className="bc-spacer" />
        <div className="bc-ctrls">
          <label className="bc-search">
            <Icon name="search" size={13} />
            <input
              ref={searchRef}
              type="text"
              placeholder="search titles, sources, dates"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search the shelves"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('')
                  e.currentTarget.blur()
                }
                if (e.key === 'Enter') {
                  const hit = flat.find(matches)
                  if (hit) openPreview(hit, true)
                }
              }}
            />
            <kbd>/</kbd>
          </label>
          <button className="bc-tbtn" aria-expanded={menu === 'filter'} aria-haspopup="true" onClick={() => setMenu(menu === 'filter' ? null : 'filter')}>
            <svg className="bc-ic" viewBox="0 0 16 16">
              <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
            </svg>
            filter <span className="bc-val">{filter}</span>
          </button>
          <button className="bc-tbtn" aria-expanded={menu === 'sort'} aria-haspopup="true" onClick={() => setMenu(menu === 'sort' ? null : 'sort')}>
            <svg className="bc-ic" viewBox="0 0 16 16">
              <path d="M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5" />
            </svg>
            sort <span className="bc-val">{SORT_LABEL.find(([k]) => k === sort)![1]}</span>
          </button>
          {menu === 'filter' && (
            <div className="bc-pop" role="menu" style={{ right: 96 }}>
              <h6>status</h6>
              {(['all', 'unread', 'reading', 'read'] as Filter[]).map((k) => (
                <button key={k} role="menuitemradio" aria-checked={filter === k} className={`bc-opt${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
                  <Icon name="check" size={13} />
                  {k}
                  <span className="bc-n">{k === 'all' ? n : flat.filter((e) => e.status === k).length}</span>
                </button>
              ))}
              <div className="bc-legend">
                <span>
                  <i className="bc-lg">
                    <i className="bc-dot read" />
                  </i>
                  dot at the foot · read
                </span>
                <span>
                  <i className="bc-lg">
                    <i className="bc-dot reading" />
                  </i>
                  pulled forward, slip · reading
                </span>
                <span>
                  <i className="bc-lg bc-faint">—</i>flush on the shelf · unread
                </span>
              </div>
            </div>
          )}
          {menu === 'sort' && (
            <div className="bc-pop" role="menu">
              <h6>order on the shelf</h6>
              {SORT_LABEL.map(([k, l]) => (
                <button
                  key={k}
                  role="menuitemradio"
                  aria-checked={sort === k}
                  className={`bc-opt${sort === k ? ' on' : ''}`}
                  onClick={() => {
                    setSort(k)
                    setMenu(null)
                  }}
                >
                  <Icon name="check" size={13} />
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {!tide && <aside className="bc-side">
        <div className="bc-side-head">
          <div className="bc-k">antilibrary</div>
          <div className="bc-big">
            <b>{nUnread}</b>
            <span>
              unread of {n} · {Math.round(pct(nUnread, n))}% ahead
            </span>
          </div>
          <div className="bc-anti">
            <div className="bc-bar">
              <i style={{ width: `${pct(nRead, n)}%` }} className="r" />
              <i style={{ width: `${pct(nReading, n)}%` }} className="g" />
            </div>
            <div className="bc-cap">
              <span>{nRead} read</span>
              <span>{nReading} reading</span>
            </div>
          </div>
        </div>
        <div
          className="bc-list"
          ref={listRef}
          onPointerEnter={() => (listHover.current = true)}
          onPointerLeave={() => {
            listHover.current = false
            svgRef.current?.querySelectorAll('.bk.peek').forEach((x) => x.classList.remove('peek'))
          }}
          onPointerOver={(ev) => {
            const r = (ev.target as Element).closest('.bc-r') as HTMLElement | null
            svgRef.current?.querySelectorAll('.bk.peek').forEach((x) => x.classList.remove('peek'))
            if (r) svgRef.current?.querySelector(`.bk[data-i="${r.dataset.i}"]`)?.classList.add('peek')
          }}
        >
          {groups.map((g, gi) => {
            const st = groupStats[gi]
            const shut = collapsed.has(gi)
            return (
              <div key={g.name} className={`bc-grp${shut ? ' collapsed' : ''}${gi === active ? ' active' : ''}`} data-i={gi}>
                <div className="bc-gh">
                  <button
                    className="bc-tog"
                    aria-label={`Toggle ${g.name}`}
                    aria-expanded={!shut}
                    onClick={() =>
                      setCollapsed((c) => {
                        const nx = new Set(c)
                        if (nx.has(gi)) nx.delete(gi)
                        else nx.add(gi)
                        return nx
                      })
                    }
                  >
                    {shut ? '+' : '–'}
                  </button>
                  <button className="bc-nm" onClick={() => goToCase(gi)}>
                    <span>{g.name.toLowerCase()}</span>
                    <span className="bc-ct">{anyQ ? `${st.hits}/${st.n}` : st.n}</span>
                    <span className="bc-pct">{Math.round(pct(st.read, st.n))}% read</span>
                  </button>
                </div>
                {!shut && (
                  <div className="bc-rows">
                    {g.entries.map((e) =>
                      anyQ && !matches(e) ? null : (
                        <button key={e.item.path} className={`bc-r${sel === e ? ' sel' : ''}`} data-i={e.i} onClick={() => openPreview(e, true)}>
                          <span className="bc-t">
                            <Mark text={e.short} q={q} />
                          </span>
                          <span className="bc-m">
                            <Mark text={[e.source, e.date].filter(Boolean).join(' · ')} q={q} />
                          </span>
                          <span className="bc-st">
                            <Dot s={e.status} />
                          </span>
                        </button>
                      )
                    )}
                    {anyQ && st.hits === 0 && <div className="bc-empty-note">no matches</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>}

      <main
        className="bc-stage"
        ref={stageRef}
        aria-label="Bookcase"
        onPointerLeave={hideTip}
        onClick={(ev) => {
          const g = (ev.target as Element).closest('.bk') as SVGGElement | null
          if (g) {
            const e = flat[+g.dataset.i!]
            if (e) openPreview(e)
          } else if (!(ev.target as Element).closest('.bc-preview, .bc-plate') && sel) closePreview()
        }}
        onDoubleClick={(ev) => {
          const g = (ev.target as Element).closest('.bk') as SVGGElement | null
          const e = g ? flat[+g.dataset.i!] : null
          if (e) app.openPath(e.item.path)
        }}
      >
        <div className="bc-scroller" ref={scrollerRef} onScroll={onScroll} onPointerMove={onMove}>
          <div className={`bc-world${open && !overlay ? ' shift' : ''}`}>
            <div className="bc-lib" ref={libRef} style={{ width: Math.round(GUT + vw * z), height: Math.round(vh * z) }}>
              <svg
                ref={svgRef}
                style={{ left: GUT }}
                width={(vw * z).toFixed(1)}
                height={(vh * z).toFixed(1)}
                viewBox={vb.map((v) => v.toFixed(1)).join(' ')}
                role="img"
                aria-label="Library bookcase"
                dangerouslySetInnerHTML={{ __html: drawing.body }}
              />
              {drawing.plates.map((p) => {
                const g = groups[p.si]
                const st = groupStats[p.si]
                return (
                  <button
                    key={g.name}
                    className={`bc-plate${p.si === active ? ' active' : ''}${anyQ && st.hits === 0 ? ' nomatch' : ''}`}
                    data-i={p.si}
                    style={{ width: Math.round(GUT - 22 + (p.sx - mx) * z), top: Math.round(((p.top + p.bot) / 2 - my) * z) }}
                    onClick={() => goToCase(p.si)}
                  >
                    <span className="bc-code">{g.code}</span>
                    <span className="bc-pname">{g.name}</span>
                    <span className="bc-meta">
                      <span>
                        {st.n} · {Math.round(pct(st.read, st.n))}% read
                      </span>
                      <span className="bc-mb">
                        <i className="r" style={{ width: `${pct(st.read, st.n)}%` }} />
                        <i className="g" style={{ width: `${pct(st.reading, st.n)}%` }} />
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="bc-tip" ref={tipRef} />

        <section className={`bc-preview${open ? ' open' : ''}`} aria-label="Preview" aria-hidden={!open}>
          {sel && (
            <>
              <div className="bc-pv-top">
                <span>
                  {groups[sel.si].code} · shelf {drawing.shelfOf[sel.item.path] ?? 1} · {pad3(selPos + 1)}/{pad3(groups[sel.si].entries.length)}
                </span>
                <span className="bc-spacer" />
                <button className="icon-btn" disabled={selPos <= 0} title="Previous (←)" onClick={() => step(-1)}>
                  <Icon name="back" size={14} />
                </button>
                <button className="icon-btn" disabled={selPos >= groups[sel.si].entries.length - 1} title="Next (→)" onClick={() => step(1)}>
                  <Icon name="chevron" size={14} />
                </button>
                <button className="icon-btn" title="Close (Esc)" onClick={closePreview}>
                  <Icon name="x" size={14} />
                </button>
              </div>
              <div className="bc-pv-body">
                <PreviewCover e={sel} />
                <h2 className="bc-pv-title">{sel.item.title}</h2>
                <div className="bc-pv-by">{[sel.source, sel.item.type === 'youtube' ? sel.item.duration : '', sel.date].filter(Boolean).join(' · ')}</div>
                <dl className="bc-pv-meta">
                  <dt>subject</dt>
                  <dd>{groups[sel.si].name}</dd>
                  <dt>status</dt>
                  <dd>
                    <div className="bc-seg" role="radiogroup" aria-label="Reading status">
                      {(['unread', 'reading', 'read'] as ReadStatus[]).map((k) => (
                        <button key={k} role="radio" aria-checked={sel.status === k} className={sel.status === k ? 'on' : ''} onClick={() => setStatus(sel.item.path, k)}>
                          {k}
                        </button>
                      ))}
                    </div>
                  </dd>
                  <dt>format</dt>
                  <dd className="bc-mono">{KIND_NAME[sel.item.type] + (sel.item.type === 'youtube' && sel.item.duration ? ` · ${sel.item.duration}` : '')}</dd>
                  {hostOf(sel.item.sourceUrl) && (
                    <>
                      <dt>source</dt>
                      <dd className="bc-mono">{hostOf(sel.item.sourceUrl)}</dd>
                    </>
                  )}
                  <dt>shelf</dt>
                  <dd className="bc-mono">
                    {groups[sel.si].code.toLowerCase()} / {drawing.shelfOf[sel.item.path] ?? 1} · position {selPos + 1}
                  </dd>
                </dl>
                {sel.item.excerpt && sel.item.type !== 'pdf' ? <p className="bc-pv-note">{sel.item.excerpt}</p> : <p className="bc-pv-note">{statusNote(sel)}</p>}
              </div>
              <div className="bc-pv-act">
                <button className="btn primary bc-wide" onClick={() => app.openPath(sel.item.path)}>
                  <Icon name={sel.item.type === 'youtube' ? 'play' : 'book'} size={14} />
                  Open<kbd>↵</kbd>
                </button>
                <button className="btn" onClick={() => teach(sel)}>
                  <Icon name="sparkle" size={14} />
                  Teach me
                </button>
                <button className="btn" onClick={() => quiz(sel)}>
                  <Icon name="quiz" size={14} />
                  Quiz me
                </button>
                {sel.item.type === 'pdf' && (
                  <button className="btn bc-wide" onClick={() => app.openPath(sel.item.path)}>
                    <Icon name="note" size={14} />
                    Read guide
                  </button>
                )}
              </div>
            </>
          )}
        </section>
        <footer className="bc-foot">
          <span className="bc-hint">
            <b>hover</b> to pull out · <b>click</b> to preview · <b>/</b> search
          </span>
          <span className="bc-ctr">
            <span ref={whereRef}>—</span>
            <span>
              <span className="bc-n" ref={ctrRef}>
                000
              </span>{' '}
              / {pad3(n)}
            </span>
          </span>
        </footer>
      </main>

      <nav className="bc-rail" aria-label="Subject index">
        <button
          className={`bc-pill${anyQ ? '' : ' on'}`}
          onClick={() => {
            setQuery('')
            setFilter('all')
            fit()
          }}
        >
          all {n}
        </button>
        <div className="bc-idx">
          {groups.map((g, i) => {
            const st = groupStats[i]
            return (
              <button key={g.name} className={`bc-ix${i === active ? ' on' : ''}${anyQ && st.hits === 0 ? ' nomatch' : ''}`} title={`${g.name} · ${Math.round(pct(st.read, st.n))}% read`} onClick={() => goToCase(i)}>
                {g.code}
                <span className="bc-rb">
                  <i style={{ width: `${pct(st.read, st.n)}%` }} />
                </span>
              </button>
            )
          })}
        </div>
        <div className="bc-zoom">
          <button className="icon-btn" title="Zoom in (+)" onClick={() => setZoom(z * 1.18)}>
            <Icon name="plus" size={14} />
          </button>
          <button className="icon-btn" title="Zoom out (−)" onClick={() => setZoom(z / 1.18)}>
            <Icon name="minus" size={14} />
          </button>
          <button className="icon-btn" title="Fit (0)" onClick={fit}>
            <svg className="bc-ic" viewBox="0 0 16 16">
              <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
            </svg>
          </button>
        </div>
        <div className="bc-zpct">{Math.round(z * 100)}%</div>
      </nav>
      {tide && (
        <section className="td-tray" aria-label="What to pick up">
          <p className="td-tray-say">
            <b>{n}</b> on the shelves: <b>{nReading}</b> open, <b>{nRead}</b> read, <b>{nUnread}</b> waiting.
            <span>{flat.some((e) => e.status === 'reading') ? 'Carry on reading:' : nUnread ? 'Newest, not yet opened:' : ''}</span>
          </p>
          {(() => {
            const reading = flat.filter((e) => e.status === 'reading').sort((a, b) => b.item.mtime - a.item.mtime)
            const pick = reading.length ? reading.slice(0, 3) : flat.filter((e) => e.status === 'unread').sort((a, b) => b.item.mtime - a.item.mtime).slice(0, 3)
            if (!pick.length) return null
            return (
              <>
                <ul aria-label={reading.length ? 'Carry on reading' : 'Newest on the shelf, not yet opened'}>
                  {pick.map((e) => (
                    <li key={e.item.path}>
                      <button className="td-tray-open" onClick={() => app.openPath(e.item.path)} title={`Open ${e.item.title}`}>
                        <b>{e.item.title}</b>
                        <span>{[groups[e.si].name, KIND_NAME[e.item.type], e.date].filter(Boolean).join(', ')}</span>
                      </button>
                      <button className="icon-btn" title="Find it on the shelf" aria-label={`Find ${e.item.title} on the shelf`} onClick={() => openPreview(e, true)}>
                        <Icon name="library" size={14} />
                      </button>
                      <button className="btn small" onClick={() => app.openPath(e.item.path)}>
                        {reading.length ? 'Carry on' : 'Open'}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          })()}
        </section>
      )}
    </div>
  )
}
