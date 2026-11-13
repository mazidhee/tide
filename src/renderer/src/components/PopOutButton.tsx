/**
 * "Open in new window" in a page's toolbar (lib/popout): the page on screen moves into a window of
 * its own, and this one goes back to where it was. In that window it becomes "Return to main
 * window", which puts it back.
 */
import { useApp, type View } from '../state'
import { busyText, inFocusWindow, POP_KEYS, popOut, returnToMain, useSurface } from '../lib/popout'
import { Icon } from './Icon'
import type { MenuItem } from './Menu'

export function PopOutButton({ view, className = 'tool-btn', label = true, disabled }: { view?: View; className?: string; label?: boolean; disabled?: boolean }) {
  const app = useApp()
  const surface = useSurface()
  // The page on screen may be mid-reply or mid-round; a button for another thing never waits on it
  const busy = (!view && !!surface?.busy) || !!disabled
  const why = disabled ? 'It can move once the reply is written.' : busyText()
  if (inFocusWindow)
    return (
      <button className={`${className} pop-btn`} disabled={busy} onClick={() => void returnToMain(app)} title={busy ? why : 'Return to main window: put this back in Tide’s main window and close this one'} aria-label="Return to main window">
        <Icon name="popin" />
        {label && <span>Return to main</span>}
      </button>
    )
  return (
    <button className={`${className} pop-btn`} disabled={busy} onClick={() => void popOut(app, view)} title={busy ? why : `Open in new window (${POP_KEYS}): just this, in a window of its own`} aria-label="Open in new window">
      <Icon name="popout" />
      {label && <span>New window</span>}
    </button>
  )
}

/** "Open in new window", for a right-click menu: the thing opens in a window of its own (or its window comes forward) */
export const popOutItem = (app: ReturnType<typeof useApp>, view: View): MenuItem => ({ label: 'Open in new window', run: () => void popOut(app, view) })
