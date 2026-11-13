/**
 * Tide's sidebar while a course is open: out of the way, so the course has the window, and back
 * the moment you want it: move to the left edge (or press ⌘\) and it slides over the page; move
 * away and it goes. Leaving the course puts it back in its place.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './Sidebar'
import { useApp } from '../state'

/** How long the pointer rests at the edge before it opens, and how long it may wander before it closes */
const OPEN_MS = 70
const CLOSE_MS = 380
/** Room around the card the pointer may cross without closing it (a slip past its edge, a gap) */
const SLACK = 28

/**
 * Also while you've collapsed the sidebar: hidden, and there when you move to the left edge, as in
 * Notion. Then ⌘\ stays the app's own toggle (it brings the sidebar back for good), so `keys` is off.
 *
 * Closing follows where the pointer is, not single leave events: the card stays while the pointer
 * is over it or within a little of it, while one of its menus is open, and while you're typing in
 * it. Moving from the edge into the card never cancels the opening.
 */
export function SidebarPeek({ dueCount, keys = true }: { dueCount: number; keys?: boolean }) {
  const [open, setOpen] = useState(false)
  const { view } = useApp()
  const card = useRef<HTMLDivElement>(null)
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const openRef = useRef(false)
  openRef.current = open

  // Going somewhere from it closes it
  useEffect(() => setOpen(false), [view])

  const show = useCallback(() => {
    clearTimeout(closing.current)
    clearTimeout(opening.current)
    setOpen(true)
  }, [])

  /** Whether something should keep the card open: the pointer near it, its menu, or typing in it */
  const held = useCallback((x?: number, y?: number) => {
    const el = card.current
    if (!el) return false
    if (document.querySelector('.context-menu')) return true
    const active = document.activeElement as HTMLElement | null
    if (active && el.contains(active) && active.matches('input, textarea, [contenteditable="true"]')) return true
    if (x === undefined || y === undefined) return false
    const r = el.getBoundingClientRect()
    return x <= r.right + SLACK && y >= r.top - SLACK && y <= r.bottom + SLACK
  }, [])

  const hideSoon = useCallback(() => {
    if (closing.current) return
    closing.current = setTimeout(() => {
      closing.current = undefined
      if (!held()) setOpen(false)
    }, CLOSE_MS)
  }, [held])

  const stay = () => {
    clearTimeout(closing.current)
    closing.current = undefined
  }

  // While open, the pointer's position decides: near the card it stays, well away it goes
  useEffect(() => {
    if (!open) return
    const move = (e: PointerEvent) => (held(e.clientX, e.clientY) ? stay() : hideSoon())
    // The pointer leaving the window, or going into a web view (which takes its events), counts as away
    const out = (e: PointerEvent) => {
      if (!e.relatedTarget) hideSoon()
    }
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerout', out)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerout', out)
    }
  }, [open, held, hideSoon])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (keys && e.metaKey && e.key === '\\') {
        e.preventDefault()
        e.stopImmediatePropagation()
        stay()
        setOpen((o) => !o)
      } else if (e.key === 'Escape' && openRef.current && !document.querySelector('.context-menu')) setOpen(false)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [keys])

  useEffect(
    () => () => {
      clearTimeout(opening.current)
      clearTimeout(closing.current)
    },
    []
  )

  return (
    <>
      <div
        className="peek-edge"
        onPointerEnter={() => {
          stay()
          if (!openRef.current) opening.current = setTimeout(show, OPEN_MS)
        }}
        onPointerLeave={(e) => {
          // Heading right, into where the card appears: let it open. Off up, down or out of the window: don't
          if (!openRef.current && e.clientX <= 1) clearTimeout(opening.current)
        }}
        aria-hidden="true"
      />
      <div ref={card} className={`peek-sidebar${open ? ' open' : ''}`} onPointerEnter={show} onPointerLeave={(e) => !held(e.clientX, e.clientY) && hideSoon()}>
        <Sidebar dueCount={dueCount} peek />
      </div>
    </>
  )
}
