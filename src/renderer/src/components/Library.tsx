import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NoteMeta } from '@shared/types'
import { useApp } from '../state'
import { hasTopic, useLibrary, type LibraryItem } from '../lib/library'
import { vaultUrl } from '../lib/markdown'
import { pdfCover } from '../lib/pdfThumb'
import { Icon } from './Icon'
import { sourceIcon } from './Home'
import { coverColor } from './NotebookCover'
import { ReadingFinder } from './ReadingFinder'
import { SaveLinkForm } from './SaveLink'
import { PixelScene } from './PixelScene'

type Filter = 'all' | 'article' | 'youtube' | 'pdf' | 'doc' | 'link'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'article', label: 'Articles' },
  { id: 'youtube', label: 'Videos' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'doc', label: 'Docs' },
  { id: 'link', label: 'Links' }
]

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

type Item = LibraryItem

type Layout = 'grid' | 'list'

const KIND_LABEL: Record<Filter, string> = { all: '', article: 'Article', youtube: 'Video', pdf: 'PDF', doc: 'Doc', link: 'Link' }

/** Cover shape by kind: books stand up, videos and web pages lie flat */
const COVER_RATIO: Record<Filter, number> = { all: 0.62, article: 0.56, youtube: 0.5625, pdf: 1.3, doc: 0.75, link: 0.56 }

const savedLabel = (i: Item) => {
  const t = i.saved ? new Date(i.saved + 'T12:00:00').getTime() : i.mtime
  if (!t) return ''
  const d = new Date(t)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}

/** Loads an item's cover once its card scrolls near the viewport */
function useCover(item: Item, ref: React.RefObject<HTMLElement | null>) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    const io = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        let thumb = await window.tide.library.thumb(item.path, item.image, item.sourceUrl).catch(() => null)
        if (!thumb && item.type === 'pdf') thumb = await pdfCover(item.path)
        if (!cancelled && thumb) setSrc(vaultUrl(thumb))
      },
      { rootMargin: '400px' }
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [item.path, item.image, item.sourceUrl, item.type, ref])
  return src
}

/** A typographic stand-in while a cover loads, or when an item has none */
function MadeCover({ item }: { item: Item }) {
  const host = item.sourceUrl ? hostOf(item.sourceUrl) : ''
  return (
    <div className="lib-made" style={{ ['--cover' as string]: coverColor({ name: item.title }) }}>
      <span className="lib-made-title">{item.title}</span>
      <span className="lib-made-foot">{host || KIND_LABEL[item.type]}</span>
    </div>
  )
}

interface CardProps {
  item: Item
  onOpen(): void
  onTopics(at: { x: number; y: number }): void
}

export function Card({ item, onOpen, onTopics }: CardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const src = useCover(item, ref)
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  const host = item.sourceUrl ? hostOf(item.sourceUrl) : ''
  const showImage = src && !broken
  return (
    <div
      ref={ref}
      className={`lib-card k-${item.type}`}
      onContextMenu={(e) => {
        e.preventDefault()
        onTopics({ x: e.clientX, y: e.clientY })
      }}
    >
      <button className="lib-open" onClick={onOpen} title={item.title}>
        <div className="lib-cover" style={{ aspectRatio: `1 / ${COVER_RATIO[item.type]}` }}>
          {(!showImage || !loaded) && <MadeCover item={item} />}
          {showImage && <img src={src} alt="" className={loaded ? 'in' : ''} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} draggable={false} />}
          {item.type === 'youtube' && (
            <span className="lib-play" aria-hidden="true">
              <Icon name="play" size={18} />
            </span>
          )}
          {item.duration && <span className="lib-duration">{item.duration}</span>}
        </div>
        <div className="lib-body">
          <span className="lib-title">{item.title}</span>
          {item.excerpt && (item.type === 'article' || item.type === 'link') && <span className="lib-excerpt">{item.excerpt}</span>}
          {item.topics.length > 0 && (
            <span className="lib-topics">
              {item.topics.map((t) => (
                <span key={t} className="lib-topic">
                  {t}
                </span>
              ))}
            </span>
          )}
          <span className="lib-meta">
            <Icon name={sourceIcon({ path: item.path, sourceType: item.type as NoteMeta['sourceType'] })} size={13} />
            <span className="lib-meta-src">{item.type === 'youtube' ? item.site || 'YouTube' : host || item.site || KIND_LABEL[item.type]}</span>
            <span className="lib-meta-date">{savedLabel(item)}</span>
          </span>
        </div>
      </button>
      <button
        className="lib-tag-btn"
        title="Subjects"
        aria-label={`Subjects for ${item.title}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onTopics({ x: r.right, y: r.bottom + 4 })
        }}
      >
        <Icon name="tag" size={14} />
      </button>
    </div>
  )
}

/** Choose which subjects an item belongs to, or add a new one */
export function TopicPicker({ at, selected, subjects, onChange, onClose }: { at: { x: number; y: number }; selected: string[]; subjects: string[]; onChange(next: string[]): void; onClose(): void }) {
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)
  const isOn = (t: string) => selected.some((s) => s.localeCompare(t, undefined, { sensitivity: 'base' }) === 0)
  const toggle = (t: string) => onChange(isOn(t) ? selected.filter((s) => s.localeCompare(t, undefined, { sensitivity: 'base' }) !== 0) : [...selected, t])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    setPos({ x: Math.max(8, Math.min(at.x - w, window.innerWidth - w - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)) })
  }, [at])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const all = [...subjects, ...selected.filter((s) => !subjects.some((x) => x.localeCompare(s, undefined, { sensitivity: 'base' }) === 0))]
  return createPortal(
    <div ref={ref} className="topic-picker" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Subjects">
      <p className="topic-picker-head">File under</p>
      <div className="topic-picker-list">
        {all.map((t) => (
          <button key={t} role="menuitemcheckbox" aria-checked={isOn(t)} className={isOn(t) ? 'on' : ''} onClick={() => toggle(t)}>
            <span className="topic-check">{isOn(t) && <Icon name="check" size={12} />}</span>
            <span>{t}</span>
          </button>
        ))}
        {!all.length && <p className="muted small">No subjects yet. Add one below.</p>}
      </div>
      <form
        className="topic-picker-add"
        onSubmit={(e) => {
          e.preventDefault()
          const t = draft.replace(/\s+/g, ' ').trim()
          if (!t) return
          if (!isOn(t)) onChange([...selected, t])
          setDraft('')
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New subject" aria-label="New subject" maxLength={40} autoFocus />
      </form>
    </div>,
    document.body
  )
}

/** Masonry: each card goes to the shortest column, so reading order stays left to right */
export function Masonry({ items, onOpen, onTopics }: { items: Item[]; onOpen(i: Item): void; onTopics(i: Item, at: { x: number; y: number }): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(3)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setCols(Math.max(1, Math.floor((e.contentRect.width + 20) / 240))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const columns = useMemo(() => {
    const out: Item[][] = Array.from({ length: cols }, () => [])
    const heights = new Array(cols).fill(0)
    for (const it of items) {
      const c = heights.indexOf(Math.min(...heights))
      out[c].push(it)
      heights[c] += COVER_RATIO[it.type] + 0.38 + (it.excerpt && (it.type === 'article' || it.type === 'link') ? 0.16 : 0) + (it.topics.length ? 0.1 : 0)
    }
    return out
  }, [items, cols])
  return (
    <div ref={ref} className="lib-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {columns.map((col, i) => (
        <div key={i} className="lib-col">
          {col.map((it) => (
            <Card key={it.path} item={it} onOpen={() => onOpen(it)} onTopics={(at) => onTopics(it, at)} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function Library() {
  const app = useApp()
  const { items, subjects, setTopics } = useLibrary()
  const [filter, setFilter] = useState<Filter>('all')
  const [subject, setSubject] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picker, setPicker] = useState<{ path: string; at: { x: number; y: number } } | null>(null)
  const [finding, setFinding] = useState(false)
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return localStorage.getItem('tide.library.layout') === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const pickLayout = (l: Layout) => {
    setLayout(l)
    try {
      localStorage.setItem('tide.library.layout', l)
    } catch {
      // remembered for this session only
    }
  }

  const UNFILED = '\u0000unfiled'
  const bySubject = (i: Item) => !subject || (subject === UNFILED ? i.topics.length === 0 : hasTopic(i, subject))
  const q = query.trim().toLowerCase()
  const visible = items.filter((i) => (filter === 'all' || i.type === filter) && bySubject(i) && (!q || `${i.title} ${i.excerpt} ${i.topics.join(' ')}`.toLowerCase().includes(q)))

  // Type counts follow the subject filter, subject counts follow the type filter
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 }
    items.filter(bySubject).forEach((i) => {
      c.all++
      c[i.type] = (c[i.type] ?? 0) + 1
    })
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, subject])
  const subjectCounts = useMemo(() => {
    const pool = items.filter((i) => filter === 'all' || i.type === filter)
    return { all: pool.length, unfiled: pool.filter((i) => !i.topics.length).length, of: (t: string) => pool.filter((i) => hasTopic(i, t)).length }
  }, [items, filter])
  const usedSubjects = subjects.filter((t) => items.some((i) => hasTopic(i, t)))

  const pickerItem = picker ? items.find((i) => i.path === picker.path) : undefined
  const openPicker = (i: Item, at: { x: number; y: number }) => setPicker({ path: i.path, at })

  return (
    <div className="page library-page">
      <PixelScene place="library" rows={40} scale={3} className="page-scene" />
      <div className="page-inner">
        <header className="page-head">
          <h1 className="page-title">Library</h1>
          <div className="row-gap">
          <button className={`btn${finding ? ' on' : ''}`} onClick={() => setFinding((f) => !f)} title="Ask the tutor to find good reading on the web">
            <Icon name="book" size={15} />
            Find reading
          </button>
          <button
            className="btn"
            onClick={async () => {
              const res = await window.tide.library.importFiles()
              if (res.length) {
                await app.refreshTree()
                app.toast(`Added ${res.length} file${res.length === 1 ? '' : 's'}`)
              }
            }}
          >
            <Icon name="upload" size={15} />
            Add files
          </button>
          </div>
        </header>
        {finding && <ReadingFinder onClose={() => setFinding(false)} />}
        <SaveLinkForm compact />

        {items.length > 0 && (
          <>
            <div className="library-bar">
              <div className="chips" role="tablist" aria-label="Kind">
                {FILTERS.filter((f) => f.id === 'all' || counts[f.id] || filter === f.id).map((f) => (
                  <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
                    {f.label}
                    <span className="chip-count">{counts[f.id] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="library-tools">
                <input className="filter-input" placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter library" />
                <div className="layout-toggle" role="radiogroup" aria-label="Layout">
                  <button role="radio" aria-checked={layout === 'grid'} className={layout === 'grid' ? 'on' : ''} title="Covers" onClick={() => pickLayout('grid')}>
                    <Icon name="grid" size={15} />
                  </button>
                  <button role="radio" aria-checked={layout === 'list'} className={layout === 'list' ? 'on' : ''} title="List" onClick={() => pickLayout('list')}>
                    <Icon name="list" size={15} />
                  </button>
                </div>
              </div>
            </div>
            <div className="subject-bar" role="tablist" aria-label="Subject">
              <button role="tab" aria-selected={!subject} className={`subject${!subject ? ' on' : ''}`} onClick={() => setSubject(null)}>
                All subjects
              </button>
              {usedSubjects.map((t) => (
                <button key={t} role="tab" aria-selected={subject === t} className={`subject${subject === t ? ' on' : ''}`} onClick={() => setSubject(subject === t ? null : t)}>
                  {t}
                  <span className="chip-count">{subjectCounts.of(t)}</span>
                </button>
              ))}
              {subjectCounts.unfiled > 0 && usedSubjects.length > 0 && (
                <button role="tab" aria-selected={subject === UNFILED} className={`subject${subject === UNFILED ? ' on' : ''}`} onClick={() => setSubject(subject === UNFILED ? null : UNFILED)}>
                  Not filed
                  <span className="chip-count">{subjectCounts.unfiled}</span>
                </button>
              )}
              {!usedSubjects.length && <span className="muted small subject-hint">Tag covers to sort by subject.</span>}
            </div>
          </>
        )}

        {items.length === 0 ? (
          <div className="empty-block">
            <p>Your library is empty.</p>
            <p className="muted">
              Paste a link above, or drop PDFs and Word documents anywhere in the window. Everything is saved as files in
              the “{app.settings.libraryFolder}” folder of your notes, so Obsidian can see it too.
            </p>
          </div>
        ) : layout === 'grid' ? (
          visible.length ? <Masonry items={visible} onOpen={(i) => app.openPath(i.path)} onTopics={openPicker} /> : <p className="muted">Nothing matches that filter.</p>
        ) : (
          <ul className="library-list">
            {visible.map((i) => (
              <li key={i.path} className="library-row" onContextMenu={(e) => (e.preventDefault(), openPicker(i, { x: e.clientX, y: e.clientY }))}>
                <button className="library-item" onClick={() => app.openPath(i.path)}>
                  <Icon name={sourceIcon({ path: i.path, sourceType: i.type as NoteMeta['sourceType'] })} size={18} />
                  <div className="library-text">
                    <span className="list-title">{i.title}</span>
                    {i.excerpt && <span className="library-excerpt">{i.excerpt}</span>}
                    <span className="library-row-meta">
                      {i.sourceUrl && hostOf(i.sourceUrl) && <span className="muted small">{hostOf(i.sourceUrl)}</span>}
                      {i.topics.map((t) => (
                        <span key={t} className="lib-topic">
                          {t}
                        </span>
                      ))}
                    </span>
                  </div>
                </button>
                <button
                  className="icon-btn"
                  title="Subjects"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    openPicker(i, { x: r.right, y: r.bottom + 4 })
                  }}
                >
                  <Icon name="tag" size={14} />
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="muted">Nothing matches that filter.</li>}
          </ul>
        )}
      </div>
      {picker && pickerItem && <TopicPicker at={picker.at} selected={pickerItem.topics} subjects={subjects} onChange={(next) => setTopics(pickerItem.path, next)} onClose={() => setPicker(null)} />}
    </div>
  )
}
