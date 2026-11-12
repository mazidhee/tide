/**
 * Video embeds in rendered Markdown (notes, lessons, chat, course text) become players. The
 * Markdown renderer writes a placeholder (<div class="vt-host" data-yt=… or data-file=…>, see
 * lib/markdown embedHtml), which stays a placeholder wherever this doesn't run; here each one
 * that appears in the window gets a VideoPlayer, and is let go when its placeholder leaves the
 * page. One observer for the whole window, so no view has to remember to do it.
 */
import { createRoot, type Root } from 'react-dom/client'
import { VideoPlayer, type VideoSource } from '../components/VideoPlayer'
import { listenForTimestampLinks } from './videoHub'

const mounted = new Map<HTMLElement, Root>()

function sourceOf(el: HTMLElement): { source: VideoSource; start?: number } | null {
  const yt = el.dataset.yt
  if (yt && /^[\w-]{11}$/.test(yt)) {
    const start = Number(el.dataset.start)
    return { source: { kind: 'youtube', id: yt, ...(el.dataset.note ? { path: el.dataset.note } : {}) }, ...(start > 0 ? { start } : {}) }
  }
  const file = el.dataset.file
  if (file) return { source: { kind: 'file', path: file } }
  return null
}

function mount(el: HTMLElement) {
  if (mounted.has(el) || el.dataset.vtMounted) return
  const found = sourceOf(el)
  if (!found) return
  el.dataset.vtMounted = '1'
  el.replaceChildren()
  const root = createRoot(el)
  root.render(<VideoPlayer source={found.source} start={found.start} />)
  mounted.set(el, root)
}

function sweep() {
  for (const [el, root] of mounted) {
    if (el.isConnected) continue
    mounted.delete(el)
    // Not while React may be rendering the view that removed it
    setTimeout(() => root.unmount(), 0)
  }
}

let started = false

export function startVideoEmbeds() {
  if (started || typeof document === 'undefined') return
  started = true
  listenForTimestampLinks()
  const scan = (node: ParentNode) => node.querySelectorAll<HTMLElement>('.vt-host:not([data-vt-mounted])').forEach(mount)
  scan(document)
  let queued = false
  const mo = new MutationObserver((records) => {
    let added = false
    let removed = false
    for (const r of records) {
      if (r.removedNodes.length) removed = true
      for (const n of r.addedNodes) if (n.nodeType === 1 && ((n as HTMLElement).matches('.vt-host') || (n as HTMLElement).querySelector('.vt-host'))) added = true
    }
    if (removed && mounted.size) sweep()
    if (!added || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      scan(document)
    })
  })
  mo.observe(document.body, { childList: true, subtree: true })
}

/** How many embeds have a player (for tests) */
export const mountedEmbeds = () => mounted.size
