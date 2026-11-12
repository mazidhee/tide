/**
 * What's on screen for the tutor (shared/onScreen): the reader sets the page and section, the
 * playing video answers for its own moment when asked, and a passage selected in the reader is
 * kept until the reader is clicked again (focusing the tutor's message box doesn't lose it).
 */
import type { OnScreen, ScreenVideo } from '@shared/onScreen'

let page: OnScreen | null = null
let video: (() => ScreenVideo | null) | null = null
let selection = ''
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((f) => f())

export function setScreen(p: OnScreen | null) {
  page = p
  selection = ''
  tell()
}

/** Updates the page on screen if it is still `title` (a section scrolled into view, say) */
export function patchScreen(patch: Partial<OnScreen>) {
  if (!page) return
  page = { ...page, ...patch }
  tell()
}

export function clearScreen(p: OnScreen | null) {
  if (p && page && page.title !== p.title) return
  page = null
  selection = ''
  tell()
}

/** The player that's open registers how to read its moment; the returned function lets it go (if it is still the one) */
export function setScreenVideo(get: () => ScreenVideo | null): () => void {
  video = get
  tell()
  return () => {
    if (video !== get) return
    video = null
    tell()
  }
}

export function setScreenSelection(text: string) {
  const t = text.trim().slice(0, 4000)
  if (t === selection) return
  selection = t
  tell()
}

/** Everything on screen, right now */
export function screenNow(): OnScreen | null {
  const v = video?.() ?? null
  if (!page && !v) return null
  const base: OnScreen = page ?? { kind: 'video', title: v?.title ?? 'Video' }
  return { ...base, ...(v ? { video: v } : {}), ...(selection ? { selection } : {}) }
}

export function onScreenChange(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** Selection in a reading area: kept when made there, dropped when that area is clicked */
export function trackSelection(root: HTMLElement): () => void {
  const up = () => {
    const sel = window.getSelection()
    const text = sel && !sel.isCollapsed && sel.anchorNode && root.contains(sel.anchorNode) ? sel.toString() : ''
    setScreenSelection(text)
  }
  const down = () => setScreenSelection('')
  root.addEventListener('mouseup', up)
  root.addEventListener('keyup', up)
  root.addEventListener('mousedown', down)
  return () => {
    root.removeEventListener('mouseup', up)
    root.removeEventListener('keyup', up)
    root.removeEventListener('mousedown', down)
  }
}
