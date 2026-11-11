/**
 * Keeps live widgets (simulations, lab queries and charts) alive while the text around them is
 * replaced. Tutor text is rendered as HTML that is set again, whole, each time more of it streams
 * in, which throws every widget out of the page and leaves its source block (a fresh <pre>) where
 * it stood. A widget whose source block is unchanged is put back over that block: the same node,
 * with everything it had learned or been told (training progress, the tour step, an edited query
 * and its result).
 *
 * A block is known by where it sits among the live blocks of its kind in its message (the nearest
 * .prose) and by its source text. Two identical blocks in one message are therefore two widgets,
 * and a block whose text has changed is built afresh. A widget that has been out of the page for
 * a few seconds is destroyed.
 */

/** How long a widget may be out of the page before it is destroyed. An object so tests can shorten it. */
export const keep = { ms: 4000 }

interface Entry {
  root: HTMLElement
  destroy(): void
  container: Element
  index: number
  source: string
  /** When it was first seen out of the page; 0 while it is in it */
  lostAt: number
}

export interface Slot {
  container: Element
  index: number
  source: string
}

export interface KeeperOptions {
  /** Matches a widget's root element */
  widget: string
  /** Whether a code block is one of this kind's source blocks (whether or not it has been mounted yet) */
  isSource(pre: HTMLElement): boolean
  /** The text that identifies a source block */
  sourceOf(pre: HTMLElement): string
}

export interface Keeper {
  /** Where a source block sits. Ask before replacing it. */
  slot(pre: HTMLElement): Slot
  /** Look after a widget that has just taken the place of the block at `slot` */
  keep(slot: Slot, root: HTMLElement, destroy: () => void): void
  /** Put widgets that have fallen out of the page back over their unchanged source blocks */
  reclaim(): void
  /** Whether a node is inside one of this kind's widgets */
  owns(node: Node): boolean
  /** How many widgets are being looked after, in the page or out of it */
  readonly size: number
}

export function createKeeper(o: KeeperOptions): Keeper {
  const entries = new Map<HTMLElement, Entry>()
  let sweeper: ReturnType<typeof setTimeout> | undefined
  let sweepAt = 0

  function sweepIn(ms: number): void {
    const at = Date.now() + ms
    if (sweeper !== undefined && sweepAt <= at) return
    clearTimeout(sweeper)
    sweepAt = at
    sweeper = setTimeout(sweep, ms)
  }

  const containerOf = (pre: HTMLElement): Element => pre.closest('.prose') ?? pre.parentElement ?? document.body

  /** This kind's blocks in a message, in order: widgets in place, and source blocks not yet mounted */
  const members = (container: Element): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(`pre.code-block, ${o.widget}`)).filter((el) => (entries.has(el) ? true : el.matches('pre.code-block') && o.isSource(el)))

  function sweep(): void {
    sweeper = undefined
    reclaim()
    const now = Date.now()
    let waiting = false
    for (const e of entries.values()) {
      if (!e.lostAt) continue
      if (now - e.lostAt >= keep.ms) {
        entries.delete(e.root)
        e.destroy()
      } else waiting = true
    }
    if (waiting) sweepIn(Math.max(50, keep.ms / 4))
  }

  function reclaim(): void {
    let lists: Map<Element, HTMLElement[]> | null = null
    for (const e of entries.values()) {
      if (e.root.isConnected) {
        e.lostAt = 0
        continue
      }
      if (!e.lostAt) {
        e.lostAt = Date.now()
        sweepIn(keep.ms)
      }
      if (!e.container.isConnected) continue
      lists ??= new Map()
      let list = lists.get(e.container)
      if (!list) lists.set(e.container, (list = members(e.container)))
      const pre = list[e.index]
      if (!pre || entries.has(pre) || o.sourceOf(pre) !== e.source) continue
      pre.replaceWith(e.root)
      list[e.index] = e.root
      e.lostAt = 0
    }
  }

  return {
    slot(pre) {
      const container = containerOf(pre)
      return { container, index: members(container).indexOf(pre), source: o.sourceOf(pre) }
    },
    keep(slot, root, destroy) {
      // Whatever held this place before has been replaced for good
      for (const e of entries.values())
        if (e.container === slot.container && e.index === slot.index && !e.root.isConnected) {
          entries.delete(e.root)
          e.destroy()
        }
      entries.set(root, { root, destroy, ...slot, lostAt: 0 })
    },
    reclaim,
    owns(node) {
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement
      const root = el?.closest<HTMLElement>(o.widget)
      return !!root && entries.has(root)
    },
    get size() {
      return entries.size
    }
  }
}

/**
 * Watches the whole document for one kind of live block. Widgets are put back at once, before
 * the page is painted; looking for new blocks waits until the text has been still for a moment
 * (or, while something keeps changing, a few moments at most).
 * Changes inside a widget (a simulation repainting its numbers) are not text arriving, and
 * don't put the wait off.
 */
export function watchBlocks(keeper: Keeper, scan: () => void, delay = 500): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  // When the wait began: something that never stops changing (an animated icon) must not put
  // the scan off for ever, so the wait is at most a few delays long
  let since = 0
  const run = () => {
    timer = undefined
    since = 0
    scan()
  }
  const observer = new MutationObserver((records) => {
    keeper.reclaim()
    if (records.every((r) => keeper.owns(r.target))) return
    const now = Date.now()
    if (timer !== undefined && now - since >= delay * 4) return
    since ||= now
    clearTimeout(timer)
    timer = setTimeout(run, delay)
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => {
    observer.disconnect()
    clearTimeout(timer)
  }
}
