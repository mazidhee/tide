/**
 * Whether a key belongs to where you are typing, so a page-wide shortcut leaves it alone.
 *
 * Every window-wide key handler (Space to flip a card, digits to pick, Return to start) asks this
 * first. It looks through the event's whole path, so a field inside a shadow root, a code editor
 * (CodeMirror, Monaco, a terminal) or any contenteditable counts, not just a bare <textarea>.
 * Space and Return on a focused button, link or checkbox belong to that control, too.
 */

const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"], .cm-editor, .monaco-editor, .xterm'
const CONTROL = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]'

function elementsOf(e: Pick<Event, 'target'> & { composedPath?: () => EventTarget[] }): Element[] {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : []
  const list = (path.length ? path : [e.target]).filter((n): n is Element => !!n && typeof (n as Element).matches === 'function')
  return list
}

/** The key lands in a text field, an editor or anything editable */
export function typingIn(e: Pick<Event, 'target'> & { composedPath?: () => EventTarget[] }): boolean {
  for (const el of elementsOf(e)) {
    if ((el as HTMLElement).isContentEditable || el.matches(FIELD)) return true
  }
  return false
}

/**
 * A plain key (no ⌘, ⌃ or ⌥) meant for the page rather than for the focused thing: not typed into
 * a field or editor, and not Space or Return on a focused button or link (those press it).
 */
export function pageKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false
  if (typingIn(e)) return false
  if ((e.key === ' ' || e.key === 'Enter') && elementsOf(e).some((el) => el.matches(CONTROL))) return false
  return true
}
