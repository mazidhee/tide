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

/** More of the page, read when asked (the lesson's notes, its code cells): each part by name; the returned function lets it go */
const parts = new Map<'notes' | 'cells', () => string>()
export function setScreenPart(name: 'notes' | 'cells', get: () => string): () => void {
  parts.set(name, get)
  tell()
  return () => {
    if (parts.get(name) !== get) return
    parts.delete(name)
    tell()
  }
}
/** A part's text changed: the chip beside the message box is redrawn */
export const screenPartChanged = () => tell()

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
  const extra: Partial<OnScreen> = {}
  for (const [name, get] of parts) {
    const t = page ? get().trim() : ''
    if (t) extra[name] = t
  }
  return { ...base, ...(v ? { video: v } : {}), ...(selection ? { selection } : {}), ...extra }
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

/**
 * The section of `root` in view (its heading is the last one above `top`, in the viewport's
 * coordinates) and its text, up to the next heading. What "Show original" brings back
 * (`data-tide-noise`, components/CleanedNote) is passed over: the tutor reads the cleaned page.
 */
export function sectionIn(root: HTMLElement, top: number): { section: string; excerpt: string } | null {
  const hs = [...root.querySelectorAll<HTMLElement>('h1,h2,h3')].filter((x) => !x.closest('[data-tide-noise]'))
  let cur: HTMLElement | null = null
  for (const h of hs) if (h.getBoundingClientRect().top <= top) cur = h
  const h = cur ?? hs[0]
  if (!h) return null
  let text = ''
  for (let n = h.nextElementSibling; n && !/^H[1-3]$/.test(n.tagName) && text.length < 2200; n = n.nextElementSibling) if (!n.hasAttribute('data-tide-noise')) text += `${(n as HTMLElement).innerText ?? n.textContent}\n`
  return { section: (h.innerText ?? h.textContent ?? '').trim(), excerpt: text.trim() }
}
