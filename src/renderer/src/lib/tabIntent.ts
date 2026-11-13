/**
 * "Open in a new tab", from anywhere a click goes somewhere, without every link and sidebar row
 * having to know about tabs.
 *
 * A ⌘-click (or a middle click on a link, a sidebar row, a card that opens something) leaves an
 * intent here; the app's setView takes it, so the page that click would have opened opens in a tab
 * behind the one you're on instead. ⌘⇧-click opens it in front, as in a browser. Right-clicking
 * such a thing offers "Open in new tab" when it has no menu of its own.
 *
 * The intent lasts only for the click: it is dropped at the next plain click or key, or after a
 * moment, so a stray ⌘-click on something that opens nothing never turns a later page into a tab.
 * Code editors and terminals keep their own ⌘-click (go to definition, open a link).
 */

export interface Intent {
  background: boolean
  at: number
}

let intent: Intent | null = null
const LIFE_MS = 1500

/** What opens a page when clicked: a middle click or a right-click "Open in new tab" acts on these */
export const OPENS = 'a[href], a.wikilink, .nav-item, .tree-row, .ongoing-open, [role="link"], [role="treeitem"], [data-opens]'
/** Where ⌘-click already means something else */
const OWN_CLICKS = '.monaco-editor, .xterm, .td-tabs'

export function setIntent(background: boolean, now = Date.now()) {
  intent = { background, at: now }
}

export function clearIntent() {
  intent = null
}

/** Takes the intent, once: a new tab (in front or behind), or null for the usual place */
export function takeIntent(now = Date.now()): Intent | null {
  const i = intent
  intent = null
  if (!i || now - i.at > LIFE_MS) return null
  return i
}

interface ClickLike {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  target: EventTarget | null
}

const el = (t: EventTarget | null): Element | null => (t && typeof (t as Element).closest === 'function' ? (t as Element) : null)

/** What a click means for tabs: a new one behind, one in front, or nothing */
export function clickIntent(e: ClickLike): 'background' | 'front' | null {
  const t = el(e.target)
  if (t?.closest(OWN_CLICKS)) return null
  if (e.button === 1) return t?.closest(OPENS) ? 'background' : null
  if (e.button === 0 && e.metaKey && !e.ctrlKey && !e.altKey) return e.shiftKey ? 'front' : 'background'
  return null
}

/** The thing a right-click "Open in new tab" would open, when its own menu doesn't say */
export function opener(target: EventTarget | null): HTMLElement | null {
  const t = el(target)
  if (!t || t.closest(OWN_CLICKS)) return null
  return (t.closest(OPENS) as HTMLElement | null) ?? null
}

/** Clicks the thing as if with ⌘ held: what it opens goes to a new tab */
export function openInNewTab(target: HTMLElement, background = false) {
  setIntent(background)
  target.click()
  // Opened nothing (or opened it later than this): the intent doesn't wait for the next page
  setTimeout(() => {
    if (intent && Date.now() - intent.at > 300) clearIntent()
  }, 400)
}

/**
 * Listens for the clicks that open new tabs. Capture phase, so the intent is there before the
 * page's own click handler runs; a middle click is turned into a click on what it landed on.
 */
export function listenForNewTabs(): () => void {
  const down = (e: PointerEvent | MouseEvent) => {
    const what = clickIntent(e)
    if (what) setIntent(what === 'background')
    else clearIntent()
  }
  const aux = (e: MouseEvent) => {
    if (e.button !== 1) return
    const t = opener(e.target)
    if (!t) return
    e.preventDefault()
    openInNewTab(t, true)
  }
  // A middle click on a link would otherwise start autoscroll or paste
  const noAutoscroll = (e: MouseEvent) => {
    if (e.button === 1 && opener(e.target)) e.preventDefault()
  }
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Meta' && e.key !== 'Shift') clearIntent()
  }
  window.addEventListener('mousedown', down, true)
  window.addEventListener('mousedown', noAutoscroll, true)
  window.addEventListener('auxclick', aux, true)
  window.addEventListener('keydown', key, true)
  return () => {
    window.removeEventListener('mousedown', down, true)
    window.removeEventListener('mousedown', noAutoscroll, true)
    window.removeEventListener('auxclick', aux, true)
    window.removeEventListener('keydown', key, true)
  }
}
