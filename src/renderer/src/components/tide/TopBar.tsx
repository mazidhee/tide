import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useApp, type View } from '../../state'
import { Icon } from '../Icon'
import { AreaMark } from './AreaMark'

const SLOT = 'td-topbar-slot'

const TITLES: Partial<Record<View['kind'], string>> = {
  home: 'Home',
  learn: 'Learn',
  library: 'Library',
  study: 'Review',
  daily: 'Daily practice',
  lessons: 'Past lessons',
  practice: 'Practice',
  'new-topic': 'New topic',
  courses: 'Courses',
  coach: 'Your week',
  wrapup: 'Evening wrap-up',
  weekly: 'Weekly review',
  drill: 'Speed drill',
  maths: 'Mental maths',
  workout: 'Morning workout',
  settings: 'Settings'
}

/** Where you are, for the bar: a notebook by its name, a study session by what it is over */
function titleOf(view: View): string[] {
  if (view.kind === 'notebook') return [view.path.split('/').pop() ?? 'Notebook']
  if (view.kind === 'reading') return ['Library', 'Reading']
  if (view.kind === 'study' && view.scope.kind !== 'vault') return ['Review', view.scope.kind === 'none' ? '' : (view.scope.path.split('/').pop() ?? '').replace(/\.(md|pdf)$/i, '')].filter(Boolean)
  return [TITLES[view.kind] ?? 'Tide']
}

/**
 * The top bar of the new design, for the pages that have no toolbar of their own (Home, Learn,
 * Library and the like): where you are on the left, the page's own actions, and one field that
 * opens search. The window is dragged by it.
 */
export function TopBar() {
  const app = useApp()
  const parts = titleOf(app.view)
  return (
    <header className="td-topbar drag">
      <div className="td-crumbs no-drag">
        {parts.map((p, i) => (
          <span key={i} className={i === parts.length - 1 ? 'td-crumb current' : 'td-crumb'}>
            {i > 0 && <Icon name="chevron" size={11} />}
            {i === 0 && app.view.kind === 'notebook' && <AreaMark area={app.view.path} />}
            {p}
          </span>
        ))}
      </div>
      <div className="td-topbar-actions no-drag" id={SLOT} />
      <button className="td-search no-drag" onClick={() => app.setDialog('search')} title="Search your notes, or ask the tutor (⌘K)">
        <Icon name="search" size={14} />
        <span>Search or ask</span>
        <kbd>⌘K</kbd>
      </button>
    </header>
  )
}

/** Puts a page's own actions into the top bar. Draws nothing in the classic design, which has no such bar. */
export function TopBarActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setSlot(document.getElementById(SLOT))
  }, [])
  return slot ? createPortal(children, slot) : null
}
