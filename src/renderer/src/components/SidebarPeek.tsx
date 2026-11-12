/**
 * Tide's sidebar while a course is open: out of the way, so the course has the window, and back
 * the moment you want it: move to the left edge (or press ⌘\) and it slides over the page; move
 * away and it goes. Leaving the course puts it back in its place.
 */
import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './Sidebar'
import { useApp } from '../state'

export function SidebarPeek({ dueCount }: { dueCount: number }) {
  const [open, setOpen] = useState(false)
  const { view } = useApp()
  // Going somewhere from it closes it
  useEffect(() => setOpen(false), [view])
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = () => {
    clearTimeout(leave.current)
    setOpen(true)
  }
  const hide = (ms = 260) => {
    clearTimeout(leave.current)
    leave.current = setTimeout(() => setOpen(false), ms)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === '\\') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setOpen((o) => !o)
      } else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      clearTimeout(leave.current)
    }
  }, [])
  return (
    <>
      <div className="peek-edge" onMouseEnter={() => (leave.current = setTimeout(show, 90))} onMouseLeave={() => clearTimeout(leave.current)} aria-hidden="true" />
      <div className={`peek-sidebar${open ? ' open' : ''}`} onMouseEnter={show} onMouseLeave={() => hide()}>
        <Sidebar dueCount={dueCount} />
      </div>
    </>
  )
}
