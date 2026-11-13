/**
 * Where a tab was scrolled, kept when you leave it and put back when you return (lib/tabs). The
 * page is built again on return, and its text may arrive a moment later (a note read from disk,
 * a lesson's turns), so each place is tried again for a little while until the page is tall enough,
 * and given up the moment you scroll yourself.
 */

export interface ScrollSpot {
  /** Which element, as a path of tag.class steps from the tab's root */
  path: string
  top: number
  left: number
}

interface ScrollNode {
  tagName: string
  className?: unknown
  parentElement: ScrollNode | null
  children: ArrayLike<ScrollNode>
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
}

const step = (n: ScrollNode) => {
  const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/)[0] : ''
  return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`
}

/** "div.doc-view/div.doc-scroll:0": each step, and which of its like siblings it is */
export function pathOf(n: ScrollNode, root: ScrollNode): string | null {
  const parts: string[] = []
  for (let cur: ScrollNode | null = n; cur && cur !== root; cur = cur.parentElement) {
    const parent: ScrollNode | null = cur.parentElement
    if (!parent) return null
    const s = step(cur)
    let i = 0
    for (const c of Array.from<ScrollNode>(parent.children)) {
      if (c === cur) break
      if (step(c) === s) i++
    }
    parts.unshift(`${s}:${i}`)
  }
  return parts.join('/')
}

export function find(root: ScrollNode, path: string): ScrollNode | null {
  if (!path) return root
  let cur: ScrollNode | null = root
  for (const part of path.split('/')) {
    const at = part.lastIndexOf(':')
    const s = part.slice(0, at)
    const i = Number(part.slice(at + 1))
    let seen = 0
    let next: ScrollNode | null = null
    for (const c of Array.from<ScrollNode>(cur!.children)) {
      if (step(c) !== s) continue
      if (seen++ === i) {
        next = c
        break
      }
    }
    if (!next) return null
    cur = next
  }
  return cur
}

/** Every scrolled element under the root, where it is */
export function captureScroll(root: ScrollNode & { querySelectorAll?: (s: string) => ArrayLike<ScrollNode> }): ScrollSpot[] {
  const out: ScrollSpot[] = []
  const all: ScrollNode[] = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : []
  for (const n of [root, ...all]) {
    if (n.scrollTop <= 0 && n.scrollLeft <= 0) continue
    const path = pathOf(n, root)
    if (path !== null) out.push({ path, top: n.scrollTop, left: n.scrollLeft })
    if (out.length >= 12) break
  }
  return out
}

/**
 * Puts each place back as soon as the page is tall (or wide) enough for it. Gives up after a
 * while, or at once when you scroll, click or press a key. Returns a function that stops it.
 */
export function restoreScroll(root: ScrollNode, spots: ScrollSpot[], opts: { within?: number; frame?: (cb: () => void) => unknown; now?: () => number; win?: Pick<Window, 'addEventListener' | 'removeEventListener'> } = {}): () => void {
  if (!spots.length) return () => {}
  const within = opts.within ?? 2500
  const frame = opts.frame ?? ((cb: () => void) => requestAnimationFrame(cb))
  const now = opts.now ?? (() => Date.now())
  const start = now()
  const left = new Map(spots.map((s) => [s.path, s]))
  let stopped = false
  const stop = () => {
    stopped = true
    opts.win?.removeEventListener('wheel', stop, true)
    opts.win?.removeEventListener('pointerdown', stop, true)
    opts.win?.removeEventListener('keydown', stop, true)
  }
  opts.win?.addEventListener('wheel', stop, true)
  opts.win?.addEventListener('pointerdown', stop, true)
  opts.win?.addEventListener('keydown', stop, true)
  const tick = () => {
    if (stopped) return
    const last = now() - start >= within
    for (const [path, s] of left) {
      const n = find(root, path)
      if (!n) continue
      const roomY = n.scrollHeight - n.clientHeight
      const roomX = n.scrollWidth - n.clientWidth
      if ((roomY >= s.top - 1 && roomX >= s.left - 1) || last) {
        n.scrollTop = s.top
        n.scrollLeft = s.left
        if (Math.abs(n.scrollTop - s.top) <= 1 || last) left.delete(path)
      }
    }
    if (!left.size || last) return stop()
    frame(tick)
  }
  tick()
  return stop
}
