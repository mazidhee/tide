/**
 * ⌘⇧N belongs to the menu's New Topic, except on a course page with its notes beside the lesson,
 * where it opens and closes those notes. The page handles the key first; when the menu still gets
 * it (it arrives as 'new-topic-key'), the owner registered here takes it, never both.
 */
let owner: (() => void) | null = null
let handledAt = 0

/** The page that owns ⌘⇧N while it is shown; returns the release */
export function ownShiftN(run: () => void): () => void {
  const mine = () => {
    handledAt = Date.now()
    run()
  }
  owner = mine
  return () => {
    if (owner === mine) owner = null
  }
}

/** The page handled the key itself */
export function shiftNHandled(): void {
  handledAt = Date.now()
}

/** The menu's accelerator fired: true when a page took it (or just did) */
export function shiftNToOwner(): boolean {
  if (Date.now() - handledAt < 400) return true
  if (!owner) return false
  owner()
  return true
}
