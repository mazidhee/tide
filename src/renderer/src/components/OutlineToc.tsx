import { reveal } from '../lib/scroll'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { sectionProgress, topicTitle, type OutlineLine } from '@shared/outline'
import { Icon } from './Icon'

interface Props {
  lines: OutlineLine[]
  collapsed: Set<number>
  /** Replaces the collapsed set (and remembers it) */
  setCollapsed(next: Set<number>): void
  /** Element that contains the outline rows; rows carry data-ol="<line index>" */
  bodyRef: React.RefObject<HTMLElement | null>
}

interface Entry {
  index: number
  text: string
  /** 0 for the outline's top level of headings */
  level: number
  done: number
  total: number
}

const MAX_TOPIC_HITS = 40
const MAX_MARKS = 36

/** Heading indices that contain line i, outermost first */
function ancestorsOf(lines: OutlineLine[], i: number): number[] {
  const out: number[] = []
  let level = lines[i].kind === 'heading' ? (lines[i] as { level: number }).level : Infinity
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j]
    if (l.kind === 'heading' && l.level < level) {
      out.unshift(j)
      level = l.level
    }
  }
  return out
}

/**
 * Contents for long outlines, as a quiet rail on the right edge: short marks for each part and
 * chapter that open into the full contents on hover. Every section shows its progress, there's
 * a topic finder, and the section you're reading stays highlighted. Clicking opens any folded
 * sections on the way and scrolls there.
 */
export function OutlineToc({ lines, collapsed, setCollapsed, bodyRef }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  // The rail lives in the main column, outside the scrolling page, so it stays put
  useEffect(() => setHost((bodyRef.current?.closest('.main') as HTMLElement | null) ?? null), [bodyRef])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const hovering = useRef(false)

  const entries: Entry[] = useMemo(() => {
    const heads = lines.map((l, i) => ({ l, i })).filter((x): x is { l: Extract<OutlineLine, { kind: 'heading' }>; i: number } => x.l.kind === 'heading')
    if (!heads.length) return []
    const min = Math.min(...heads.map((h) => h.l.level))
    return heads
      .filter((h) => h.l.level - min <= 2)
      .map((h) => {
        const p = sectionProgress(lines, h.i)
        return { index: h.i, text: h.l.text, level: h.l.level - min, done: p.done, total: p.total }
      })
  }, [lines])

  const q = query.trim().toLowerCase()
  const topicHits = useMemo(() => {
    if (!q) return []
    const hits: { index: number; text: string; under: string }[] = []
    let under = ''
    lines.forEach((l, i) => {
      if (l.kind === 'heading') under = l.text
      else if (l.kind === 'item' && l.checked !== null && hits.length < MAX_TOPIC_HITS) {
        const label = topicTitle(l.text)
        if (label.toLowerCase().includes(q)) hits.push({ index: i, text: label, under })
      }
    })
    return hits
  }, [lines, q])

  // Track the section at the top of the scroller
  useEffect(() => {
    const body = bodyRef.current
    const scroller = body?.closest('.page') as HTMLElement | null
    if (!body || !scroller) return
    let frame = 0
    const update = () => {
      frame = 0
      const line = scroller.getBoundingClientRect().top + 120
      let current: number | null = null
      for (const el of body.querySelectorAll<HTMLElement>('[data-ol-h]')) {
        if (el.getBoundingClientRect().top <= line) current = Number(el.dataset.ol)
        else break
      }
      setActive(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [bodyRef, lines, collapsed])

  // The active entry is the nearest shown heading at or above the scrolled-to line
  const activeEntry = useMemo(() => {
    if (active === null) return null
    let best: number | null = null
    for (const e of entries) if (e.index <= active) best = e.index
    return best
  }, [entries, active])

  useEffect(() => {
    if (activeEntry === null || hovering.current || q) return
    reveal(listRef.current?.querySelector(`[data-toc="${activeEntry}"]`), { block: 'nearest', behavior: 'auto' })
  }, [activeEntry, q])

  const jump = (i: number) => {
    const opening = [...ancestorsOf(lines, i), i].filter((h) => collapsed.has(h))
    if (opening.length) {
      const next = new Set(collapsed)
      opening.forEach((h) => next.delete(h))
      setCollapsed(next)
    }
    // Wait a frame so newly unfolded rows exist before scrolling to them
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = bodyRef.current?.querySelector<HTMLElement>(`[data-ol="${i}"]`)
        if (!el) return
        reveal(el)
        el.classList.remove('flash')
        void el.offsetWidth
        el.classList.add('flash')
        if (!el.dataset.olH) el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
      })
    )
  }

  if (entries.length < 2) return null

  const allHeadings = lines.flatMap((l, i) => (l.kind === 'heading' ? [i] : []))
  const visible = q ? entries.filter((e) => e.text.toLowerCase().includes(q)) : entries

  // Marks: parts and chapters, thinned out evenly for very long outlines
  let markEntries = entries.filter((e) => e.level <= 1)
  if (markEntries.length > MAX_MARKS) markEntries = entries.filter((e) => e.level === 0)
  if (markEntries.length > MAX_MARKS) {
    const step = Math.ceil(markEntries.length / MAX_MARKS)
    markEntries = markEntries.filter((_, i) => i % step === 0)
  }
  const markOn = activeEntry === null ? -1 : markEntries.reduce((best, e, i) => (e.index <= activeEntry ? i : best), -1)

  if (!host) return null
  return createPortal(
    <nav className={`otoc${q ? ' searching' : ''}`} aria-label="Outline contents" onMouseEnter={() => (hovering.current = true)} onMouseLeave={() => (hovering.current = false)}>
      <div className="otoc-marks" aria-hidden="true">
        {markEntries.map((e, i) => (
          <span key={e.index} className={`mark l${e.level}${i === markOn ? ' on' : ''}${e.total > 0 && e.done === e.total ? ' done' : ''}`} />
        ))}
      </div>
      <div className="otoc-panel">
      <div className="toc-head">
        <div className="toc-search">
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query) setQuery('')
                else (e.target as HTMLInputElement).blur()
              }
              if (e.key === 'Enter') {
                const first = visible[0]?.index ?? topicHits[0]?.index
                if (first !== undefined) jump(first)
              }
            }}
            placeholder="Find a section or topic"
            aria-label="Find a section or topic"
            spellCheck={false}
          />
        </div>
        <div className="toc-actions">
          <button className="icon-btn small" title="Fold everything" onClick={() => setCollapsed(new Set(allHeadings))}>
            <Icon name="minus" size={13} />
          </button>
          <button className="icon-btn small" title="Unfold everything" onClick={() => setCollapsed(new Set())}>
            <Icon name="plus" size={13} />
          </button>
        </div>
      </div>
      <div className="toc-list" ref={listRef}>
        {visible.map((e) => {
          const complete = e.total > 0 && e.done === e.total
          return (
            <button key={e.index} data-toc={e.index} className={`toc-row l${e.level}${activeEntry === e.index && !q ? ' on' : ''}${collapsed.has(e.index) ? ' folded' : ''}`} onClick={() => jump(e.index)} title={e.text}>
              <span className="toc-text">{e.text}</span>
              {e.total > 0 && (
                <span className={`toc-count${complete ? ' complete' : ''}`}>
                  {complete ? <Icon name="check" size={11} /> : `${e.done}/${e.total}`}
                </span>
              )}
            </button>
          )
        })}
        {q && topicHits.length > 0 && (
          <>
            <p className="toc-label">Topics</p>
            {topicHits.map((t) => (
              <button key={t.index} className="toc-row topic" onClick={() => jump(t.index)} title={`${t.text} (${t.under})`}>
                <span className="toc-text">{t.text}</span>
                <span className="toc-under">{t.under}</span>
              </button>
            ))}
          </>
        )}
        {q && !visible.length && !topicHits.length && <p className="toc-empty">Nothing called “{query.trim()}”.</p>}
      </div>
      </div>
    </nav>,
    host
  )
}
