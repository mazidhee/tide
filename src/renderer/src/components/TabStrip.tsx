/**
 * The row of tabs at the top of the main area, like Notion's (lib/tabs). It is there only while
 * more than one tab is open: a single page needs no row, and ⌘T, a ⌘-click or "Open in new tab"
 * brings it back.
 *
 * - Click to go to a tab, the × or a middle click to close it, double-click the empty row (or +)
 *   for a new one on Home.
 * - Drag a tab along the row to reorder it; drag it well away from the row, or out of the window,
 *   to move it to a window of its own (lib/popout). "Return to main window" brings it back here.
 * - The keyboard: Tab into the row, ← → between tabs, Return or Space to open one, Delete to close
 *   it, ⌘⇧← ⌘⇧→ to move it, and the context-menu key (⇧F10) for its menu.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useApp, type View } from '../state'
import { Icon, type IconName } from './Icon'
import { ContextMenu, type MenuState } from './Menu'
import { tabIcon, tabTitle, type Tab } from '../lib/tabs'
import { useSurface } from '../lib/popout'
import { useOngoing, sessionKey } from '../lib/sessions'
import { canPopOut, type PopView } from '@shared/popout'

/** How far a tab must move before it is being dragged, and how far from the row it tears off */
const DRAG_START = 4
const TEAR_OFF = 56

interface Drag {
  id: string
  pointer: number
  startX: number
  startY: number
  /** Where in the tab it was taken, from the tab's left edge */
  grab: number
  /** The row's tab edges when the drag began */
  slots: { id: string; left: number; width: number }[]
  dx: number
  index: number
  moving: boolean
  tearing: boolean
}

export function TabStrip() {
  const app = useApp()
  const surface = useSurface()
  const ongoing = useOngoing()
  const rowRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const suppressClick = useRef(false)
  // The tab the keyboard is on (roving tabindex): the one in front unless you've arrowed away
  const [focusId, setFocusId] = useState<string | null>(null)
  const focusable = focusId && app.tabs.some((t) => t.id === focusId) ? focusId : app.activeTab

  // Lessons with a reply arriving: their tab shows a dot while it is behind
  const arriving = useMemo(() => new Set(ongoing.filter((o) => o.busy).map((o) => o.key)), [ongoing])

  // The tab in front is always in sight when the row is too long for the window
  useLayoutEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>(`[data-tab="${app.activeTab}"]`)
    const row = rowRef.current
    if (!el || !row) return
    if (el.offsetLeft < row.scrollLeft) row.scrollLeft = el.offsetLeft - 8
    else if (el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = el.offsetLeft + el.offsetWidth - row.clientWidth + 8
  }, [app.activeTab, app.tabs.length])

  const labelOf = (t: Tab<View>) => {
    const own = t.id === app.activeTab && surface?.name && surface.view?.()?.kind === t.nav.current.kind ? surface.name : t.title
    return tabTitle(t.nav.current, own)
  }

  const order = useMemo(() => {
    if (!drag?.moving) return app.tabs
    const rest = app.tabs.filter((t) => t.id !== drag.id)
    const me = app.tabs.find((t) => t.id === drag.id)!
    return [...rest.slice(0, drag.index), me, ...rest.slice(drag.index)]
  }, [app.tabs, drag])

  const tabMenu = (t: Tab<View>, x: number, y: number) => {
    const others = app.tabs.length > 1
    const movable = canPopOut(t.nav.current as PopView)
    setMenu({
      x,
      y,
      items: [
        { label: 'New tab', run: app.newTab },
        ...(movable ? [{ label: 'Move to new window', run: () => void app.popOutTab(t.id) }] : []),
        { label: 'Close tab', run: () => app.closeTab(t.id), separatorBefore: true },
        ...(others ? [{ label: 'Close other tabs', run: () => app.closeOtherTabs(t.id) }] : []),
        ...(app.canReopenTab ? [{ label: 'Reopen closed tab', run: app.reopenClosedTab }] : [])
      ]
    })
  }

  const focusTab = (id: string) => {
    setFocusId(id)
    requestAnimationFrame(() => rowRef.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus())
  }

  const onKeyDown = (e: ReactKeyboardEvent, t: Tab<View>) => {
    const i = app.tabs.findIndex((x) => x.id === t.id)
    const n = app.tabs.length
    if (e.metaKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      app.moveTab(t.id, i + (e.key === 'ArrowLeft' ? -1 : 1))
      return focusTab(t.id)
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (i + 1) % n
    else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next !== null) {
      e.preventDefault()
      return focusTab(app.tabs[next].id)
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      return app.switchTab(t.id)
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const after = app.tabs[i + 1] ?? app.tabs[i - 1]
      app.closeTab(t.id)
      if (after) focusTab(after.id)
      return
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      tabMenu(t, r.left + 8, r.bottom + 4)
    }
  }

  // ---------- Dragging ----------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, t: Tab<View>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.td-tab-x')) return
    const row = rowRef.current
    if (!row) return
    const slots = [...row.querySelectorAll<HTMLElement>('[data-tab]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.tab!, left: r.left, width: r.width }
    })
    const mine = slots.find((s) => s.id === t.id)
    if (!mine) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ id: t.id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, grab: e.clientX - mine.left, slots, dx: 0, index: app.tabs.findIndex((x) => x.id === t.id), moving: false, tearing: false })
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointer) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moving && Math.hypot(dx, dy) < DRAG_START) return
    const strip = rowRef.current?.getBoundingClientRect()
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight
    const tearing = canPopOut(app.tabs.find((x) => x.id === d.id)?.nav.current as PopView) && (outside || (!!strip && (e.clientY > strip.bottom + TEAR_OFF || e.clientY < strip.top - TEAR_OFF)))
    // Where it would land: past the middle of a neighbour, it takes that one's place
    const rest = d.slots.filter((s) => s.id !== d.id)
    const centre = e.clientX - d.grab + (d.slots.find((s) => s.id === d.id)?.width ?? 0) / 2
    let index = rest.findIndex((s) => centre < s.left + s.width / 2)
    if (index < 0) index = rest.length
    setDrag({ ...d, dx, moving: true, tearing, index })
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointer) return
    setDrag(null)
    if (!d.moving) return
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 0)
    if (d.tearing) return void app.popOutTab(d.id)
    if (d.index !== app.tabs.findIndex((x) => x.id === d.id)) app.moveTab(d.id, d.index)
  }

  // Escape drops a drag where it started
  useEffect(() => {
    if (!drag) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setDrag(null)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [drag])

  /** How far a tab slides while one is dragged: to its place in the new order */
  const shift = (t: Tab<View>): number => {
    if (!drag?.moving) return 0
    if (t.id === drag.id) return drag.dx
    const slots = drag.slots
    if (!slots.length) return 0
    const gap = slots.length > 1 ? Math.max(0, slots[1].left - slots[0].left - slots[0].width) : 0
    let left = slots[0].left
    for (const x of order) {
      if (x.id === t.id) break
      left += (slots.find((s) => s.id === x.id)?.width ?? 0) + gap
    }
    return left - (slots.find((s) => s.id === t.id)?.left ?? left)
  }

  return (
    <div className={`td-tabs drag${drag?.moving ? ' dragging' : ''}`} onDoubleClick={(e) => e.target === e.currentTarget && app.newTab()}>
      <div className="td-tabs-row" role="tablist" aria-label="Open tabs" ref={rowRef} onDoubleClick={(e) => e.target === e.currentTarget && app.newTab()}>
        {app.tabs.map((t) => {
          const active = t.id === app.activeTab
          const label = labelOf(t)
          const v = t.nav.current
          const busy = !active && (v.kind === 'session' || v.kind === 'quiz') && arriving.has(sessionKey(v as { kind: string }))
          const dragged = drag?.moving && drag.id === t.id
          const dx = shift(t)
          return (
            <div
              key={t.id}
              id={`tab-${t.id}`}
              data-tab={t.id}
              role="tab"
              aria-selected={active}
              aria-controls={active ? `tabpanel-${t.id}` : undefined}
              tabIndex={t.id === focusable ? 0 : -1}
              className={`td-tab no-drag${active ? ' active' : ''}${dragged ? ' lifted' : ''}${dragged && drag?.tearing ? ' tearing' : ''}`}
              style={dx ? { transform: `translateX(${dx}px)` } : undefined}
              title={dragged && drag?.tearing ? 'Release to open in a window of its own' : label}
              onClick={() => {
                if (suppressClick.current) return
                app.switchTab(t.id)
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                app.closeTab(t.id)
              }}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onContextMenu={(e) => {
                e.preventDefault()
                tabMenu(t, e.clientX, e.clientY)
              }}
              onKeyDown={(e) => onKeyDown(e, t)}
              onFocus={() => setFocusId(t.id)}
              onPointerDown={(e) => onPointerDown(e, t)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
            >
              <span className="td-tab-icon">{busy ? <span className="td-tab-busy" aria-label="A reply is arriving" /> : <Icon name={tabIcon(v) as IconName} size={14} />}</span>
              <span className="td-tab-title">{label}</span>
              <button
                className="td-tab-x"
                tabIndex={-1}
                aria-label={`Close ${label}`}
                title="Close tab (⌘W)"
                onClick={(e) => {
                  e.stopPropagation()
                  app.closeTab(t.id)
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <button className="td-tab-new no-drag" onClick={app.newTab} title="New tab (⌘T)" aria-label="New tab">
        <Icon name="plus" size={14} />
      </button>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
