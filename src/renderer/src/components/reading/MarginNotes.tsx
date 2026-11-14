import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Mark, MarkKind } from '@shared/readingRoom'
import { layoutMargins, sameLayout, type MarginItem, type MarginPlace, type MarginSide } from '@shared/marginLayout'

/**
 * Margin notes beside the words they're about (the reader's page). Each note sits level with its
 * passage, in the right margin, or the left when the right would push it far below its words
 * (shared/marginLayout). A note pushed away from its passage has a hairline back to it. At rest a
 * note shows six lines and a "More"; it opens in full while you write in it, focus it or ask.
 * Hovering or focusing a note lights its passage, and the passage lights its note. A window too
 * narrow for a margin shows a small marker beside each passage instead; it opens the note.
 */

export const KIND_LABEL: Record<MarkKind, string> = { highlight: 'Highlight', quote: 'Quote kept', note: 'Margin note', question: 'Question' }

/** A mark that has a note in the margin (or is having one written) */
export const hasMarginNote = (m: Mark, writingId?: string | null) => (m.kind === 'note' || m.kind === 'question' || m.kind === 'quote') && (!!m.note?.trim() || writingId === m.id)

/** The column's widths: below the least, the window shows markers; it grows to the most */
const COL_MIN = 168
const COL_MAX = 232
/** The column starts this far inside the page's edge (the page has 30px of padding), and keeps this much from the window's */
const INSET = 4
const EDGE = 14
/** Where on a note its line arrives: the middle of its label */
const JOIN = 10
/** Lanes in the gutter for lines that run alongside each other (11, 16 and 21px from the column) */
const LANES = 3

type Mode = 'margins' | 'markers'

interface Layout {
  mode: Mode
  col: number
  left: boolean
  places: MarginPlace[]
  /** The middle of each passage's first line, where its line leaves from */
  lines: Record<string, number>
}

const EMPTY: Layout = { mode: 'margins', col: 210, left: false, places: [], lines: {} }

export const noteDomId = (id: string) => `rr-note-${id}`

/** A mark's id inside a quoted attribute selector */
const esc = (id: string) => id.replace(/["\\]/g, '\\$&')

export function MarginNotes(props: {
  pageRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  notes: Mark[]
  /** Changes when the page itself changes (chapter, text size, width): sides are chosen afresh */
  pageKey: string
  writing: { id: string; text: string } | null
  setWriting: (w: { id: string; text: string } | null) => void
  saveWriting: () => void
  flash: string | null
  linked: string | null
  onLink: (id: string | null) => void
}) {
  const { pageRef, scrollRef, notes, pageKey, writing, setWriting, saveWriting, flash, linked, onLink } = props
  const [layout, setLayout] = useState<Layout>(EMPTY)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [long, setLong] = useState<Set<string>>(() => new Set())
  const [popped, setPopped] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const pins = useRef<{ key: string; sides: Record<string, MarginSide> }>({ key: '', sides: {} })
  const watch = useRef<ResizeObserver | null>(null)

  // ---------- Layout: measured from the page, placed by shared/marginLayout ----------

  const measure = useCallback(() => {
    const page = pageRef.current
    const sc = scrollRef.current
    if (!page || !sc) return
    const pr = page.getBoundingClientRect()
    const sr = sc.getBoundingClientRect()
    const padR = parseFloat(getComputedStyle(sc).paddingRight) || 0
    // Room for a column on each side, inside the scroller (the drawer's padding and the scrollbar left out)
    const fit = (room: number) => Math.min(COL_MAX, Math.floor(room + INSET - EDGE))
    const right = fit(sr.left + sc.clientWidth - padR - pr.right)
    const leftRoom = fit(pr.left - sr.left)
    const mode: Mode = right >= COL_MIN ? 'margins' : 'markers'
    const left = mode === 'margins' && leftRoom >= COL_MIN
    const col = left ? Math.min(right, leftRoom) : right
    const items: MarginItem[] = []
    const lines: Record<string, number> = {}
    const measured = new Set<string>()
    for (const m of notes) {
      const el = page.querySelector<HTMLElement>(`[data-mark~="${esc(m.id)}"]`)
      const first = el?.getClientRects()[0]
      if (!first) continue
      const anchor = first.top - pr.top
      lines[m.id] = anchor + first.height / 2
      const box = page.querySelector<HTMLElement>(`[data-note="${esc(m.id)}"]`)
      if (box) measured.add(m.id)
      items.push({ id: m.id, anchor, x: first.left - pr.left, height: mode === 'markers' ? 22 : (box?.offsetHeight ?? 64) })
    }
    // Sides are kept while the page is the same page (scrolling never moves a note across): a new
    // chapter, size or set of notes, or a note opened, focused or written in, chooses again
    const key = `${pageKey}|${mode}|${col}|${left}|${Math.round(page.offsetHeight)}|${items.map((i) => i.id).join(',')}|${[...open].sort().join(',')}|${writing?.id ?? ''}|${focused ?? ''}`
    if (pins.current.key !== key) pins.current = { key, sides: {} }
    const places = layoutMargins(items, mode === 'markers' ? { gap: 4, right: true, left: false } : { left, pinned: pins.current.sides })
    // Only a note measured as it really is keeps its side; one placed on a guess is placed again
    for (const p of places) if (measured.has(p.id)) pins.current.sides[p.id] = p.side
    const next: Layout = { mode, col, left, places, lines }
    setLayout((was) => (was.mode === mode && was.col === col && was.left === left && sameLayout(was.places, places) && Object.keys(lines).every((k) => Math.round(was.lines[k] ?? -1) === Math.round(lines[k])) ? was : next))
    // Which notes are longer than their six lines at rest (an open one keeps what it was)
    const longNow = new Set<string>()
    for (const m of notes) {
      const t = page.querySelector<HTMLElement>(`[data-note="${esc(m.id)}"] .rr-margin-text`)
      if (!t) continue
      const box = t.closest('.rr-margin')
      const folded = !!box && !box.classList.contains('open') && !box.matches(':focus-within')
      if (folded ? t.scrollHeight > t.clientHeight + 1 : long.has(m.id)) longNow.add(m.id)
    }
    if (longNow.size !== long.size || [...longNow].some((id) => !long.has(id))) setLong(longNow)
    // Heights change without a render (focus opens a note): watch each note
    if (watch.current) page.querySelectorAll<HTMLElement>('[data-note]').forEach((n) => watch.current!.observe(n))
  }, [notes, pageKey, pageRef, scrollRef, long, open, writing?.id, focused])

  useLayoutEffect(measure)

  // The window, the page or a note changing size lays the notes out again
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTick((t) => t + 1))
    watch.current = ro
    if (scrollRef.current) ro.observe(scrollRef.current)
    if (pageRef.current) ro.observe(pageRef.current)
    // Fonts arriving move the text
    document.fonts?.ready.then(() => setTick((t) => t + 1)).catch(() => {})
    return () => {
      ro.disconnect()
      watch.current = null
    }
  }, [pageRef, scrollRef, pageKey])

  // A note being written opens its popover in a narrow window
  const shown = layout.mode === 'markers' ? (writing?.id ?? popped) : null
  useEffect(() => {
    if (!popped) return
    const away = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.rr-note-pop, .rr-marker')) setPopped(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || writing) return
      const id = popped
      setPopped(null)
      pageRef.current?.querySelector<HTMLElement>(`[data-note="${esc(id)}"] .rr-marker`)?.focus()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
    }
  }, [popped, writing, pageRef])

  const byId = new Map(layout.places.map((p) => [p.id, p]))
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const body = (m: Mark, inPop: boolean) => (
    <>
      <b>{KIND_LABEL[m.kind]}</b>
      {writing?.id === m.id ? (
        <textarea
          autoFocus
          rows={2}
          value={writing.text}
          ref={grow}
          placeholder={m.kind === 'question' ? 'Your question, for later' : 'Write in the margin…'}
          aria-label={m.kind === 'question' ? 'Your question' : 'Your margin note'}
          onChange={(e) => {
            setWriting({ id: m.id, text: e.target.value })
            grow(e.target)
          }}
          onBlur={saveWriting}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ;(e.target as HTMLTextAreaElement).blur()
            }
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          }}
        />
      ) : (
        <>
          <span className="rr-margin-text" onClick={() => setWriting({ id: m.id, text: m.note ?? '' })} title="Edit this note">
            {m.note}
          </span>
          {!inPop && long.has(m.id) && (
            <button className="rr-margin-more" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(m.id)} aria-expanded={open.has(m.id)}>
              {open.has(m.id) ? 'Less' : 'More'}
            </button>
          )}
        </>
      )}
    </>
  )

  const hover = (id: string) => ({
    onMouseEnter: () => onLink(id),
    onMouseLeave: () => onLink(null),
    onFocus: () => onLink(id),
    onBlur: (e: React.FocusEvent) => !e.currentTarget.contains(e.relatedTarget as Node) && onLink(null)
  })

  if (layout.mode === 'markers')
    return (
      <div className="rr-margins markers" aria-label="Margin notes">
        {notes.map((m) => {
          const p = byId.get(m.id)
          const on = shown === m.id
          return (
            <div key={m.id} className="rr-mark-slot" data-note={m.id} style={{ top: p?.top ?? 0, visibility: p ? undefined : 'hidden' }}>
              <button
                className={`rr-marker${on ? ' on' : ''}${linked === m.id ? ' linked' : ''}${flash === m.id ? ' flash' : ''}`}
                aria-expanded={on}
                aria-controls={on ? noteDomId(m.id) : undefined}
                aria-label={`${KIND_LABEL[m.kind]}: ${(m.note ?? '').slice(0, 80)}`}
                title={on ? undefined : KIND_LABEL[m.kind]}
                onClick={() => setPopped(on ? null : m.id)}
                {...hover(m.id)}
              >
                <i aria-hidden="true" />
              </button>
              {on && (
                <aside id={noteDomId(m.id)} className={`rr-note-pop k-${m.kind}`} role="dialog" aria-label={KIND_LABEL[m.kind]} {...hover(m.id)}>
                  {body(m, true)}
                </aside>
              )}
            </div>
          )
        })}
      </div>
    )

  // Lines that would run alongside each other in a gutter take lanes of their own
  const lanes = new Map<string, number>()
  for (const side of ['right', 'left'] as const) {
    const ends: number[] = []
    for (const p of layout.places.filter((q) => q.side === side && q.displaced && layout.lines[q.id] !== undefined)) {
      const from = layout.lines[p.id] - 2
      let lane = ends.findIndex((e) => e < from)
      if (lane < 0) lane = Math.min(ends.length, LANES - 1)
      ends[lane] = Math.max(ends[lane] ?? -Infinity, p.top + JOIN)
      lanes.set(p.id, lane)
    }
  }

  return (
    <div className="rr-margins" aria-label="Margin notes" style={{ ['--rr-col' as string]: `${layout.col}px` }}>
      {notes.map((m) => {
        const p = byId.get(m.id)
        const line = layout.lines[m.id]
        const lit = linked === m.id
        return (
          <Fragment key={m.id}>
            {p?.displaced && line !== undefined && (
              <span className={`rr-tether ${p.side}${lit ? ' linked' : ''}`} style={{ top: line, height: Math.max(0, p.top + JOIN - line), ['--lane' as string]: `${11 + 5 * (lanes.get(m.id) ?? 0)}px` }} aria-hidden="true" />
            )}
            <aside
              id={noteDomId(m.id)}
              data-note={m.id}
              tabIndex={writing?.id === m.id ? -1 : 0}
              className={`rr-margin k-${m.kind} side-${p?.side ?? 'right'}${open.has(m.id) || writing?.id === m.id ? ' open' : ''}${lit ? ' linked' : ''}${flash === m.id ? ' flash' : ''}`}
              style={{ top: p?.top ?? 0, visibility: p ? undefined : 'hidden' }}
              aria-label={`${KIND_LABEL[m.kind]} on “${m.text.slice(0, 60)}${m.text.length > 60 ? '…' : ''}”`}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter') {
                  e.preventDefault()
                  setWriting({ id: m.id, text: m.note ?? '' })
                }
                if (e.key === 'Escape') e.currentTarget.blur()
              }}
              {...hover(m.id)}
              onFocus={() => (onLink(m.id), setFocused(m.id))}
              onBlur={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                onLink(null)
                setFocused((f) => (f === m.id ? null : f))
              }}
            >
              {body(m, false)}
            </aside>
          </Fragment>
        )
      })}
    </div>
  )
}

/** A textarea as tall as what's in it */
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/**
 * A note pushed out of view below its passage is brought up, as far as the passage can stay on
 * screen: for hovering or focusing the passage.
 */
export function revealNote(scroller: HTMLElement | null, id: string) {
  if (!scroller) return
  const note = scroller.querySelector<HTMLElement>(`.rr-margin[data-note="${esc(id)}"]`)
  const words = scroller.querySelector<HTMLElement>(`[data-mark~="${esc(id)}"]`)
  if (!note || !words) return
  const s = scroller.getBoundingClientRect()
  const n = note.getBoundingClientRect()
  const w = words.getBoundingClientRect()
  const need = n.top + Math.min(n.height, 120) - (s.bottom - 24)
  const room = w.top - (s.top + 72)
  const by = Math.min(need, room)
  if (need <= 0 || by <= 0) return
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  scroller.scrollBy({ top: by, behavior: still ? 'auto' : 'smooth' })
}
