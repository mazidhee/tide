/**
 * The tab keys the page handles itself: ⌘1–9 to a tab (⌘9 the last), ⌃Tab and ⌃⇧Tab round them.
 * ⌘T, ⌘W and ⇧⌘T come from the File menu (main/index), so they work as in any browser, except
 * where an editor has them first: the IDE keeps ⌘W for its own file tabs and ⌘T for symbols.
 *
 * ⌘1–9 never fire while you type (lib/typing): ⌘1 may be a heading or an editor group. ⌃Tab
 * means nothing to a text field or the note editor, so it still goes round the tabs there (a note
 * opens with its editor focused); only a terminal and the code editor keep it for themselves.
 */
import { typingIn } from './typing'

export type TabKey = { go: number } | { cycle: 1 | -1 }

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'> & { isComposing?: boolean; composedPath?: () => EventTarget[] }

export function tabKey(e: KeyLike): TabKey | null {
  if (e.isComposing) return null
  let k: TabKey | null = null
  if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code ?? '')) k = { go: Number(e.code.slice(5)) }
  else if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) k = { go: Number(e.key) }
  else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') k = { cycle: e.shiftKey ? -1 : 1 }
  if (!k) return null
  if ('go' in k) return typingIn(e) ? null : k
  return ownsCtrlTab(e) ? null : k
}

/** A terminal or the code editor, where ⌃Tab is theirs */
function ownsCtrlTab(e: KeyLike): boolean {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target]
  return path.some((n) => !!n && typeof (n as Element).closest === 'function' && !!(n as Element).closest('.monaco-editor, .xterm'))
}
