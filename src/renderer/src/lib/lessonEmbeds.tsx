/**
 * What a lesson brings in from elsewhere, in any rendered Markdown (a lesson, the tutor panel, a
 * note): a reading from another course, a suggested course, a video clip. The Markdown renderer
 * writes a placeholder for each tag (lib/markdown lessonTags); here each placeholder that appears
 * gets its card, and lets it go when it leaves the page, as lib/videoEmbeds does for players.
 */
import { createRoot, type Root } from 'react-dom/client'
import { ReadingCard, SuggestCourseCard } from '../components/RelatedCards'
import { ClipCard } from '../components/ClipCard'

const mounted = new Map<HTMLElement, Root>()
const SELECTOR = '.rel-host:not([data-mounted]),.sug-host:not([data-mounted]),.clip-host:not([data-mounted])'

function mount(el: HTMLElement) {
  if (mounted.has(el)) return
  const d = el.dataset
  let node: React.ReactNode = null
  if (el.classList.contains('rel-host') && d.course && d.path) node = <ReadingCard course={d.course} path={d.path} heading={d.heading || undefined} why={d.why || undefined} />
  else if (el.classList.contains('sug-host') && d.id) node = <SuggestCourseCard id={d.id} why={d.why || undefined} />
  else if (el.classList.contains('clip-host') && d.video && Number.isFinite(Number(d.start)) && Number.isFinite(Number(d.end)))
    node = <ClipCard clip={{ video: d.video, start: Number(d.start), end: Number(d.end), ...(d.why ? { why: d.why } : {}) }} />
  if (!node) return
  el.dataset.mounted = '1'
  el.replaceChildren()
  const root = createRoot(el)
  root.render(node)
  mounted.set(el, root)
}

let started = false

export function startLessonEmbeds() {
  if (started || typeof document === 'undefined') return
  started = true
  const scan = () => document.querySelectorAll<HTMLElement>(SELECTOR).forEach(mount)
  scan()
  let queued = false
  new MutationObserver((records) => {
    if (records.some((r) => r.removedNodes.length) && mounted.size) {
      for (const [el, root] of mounted) {
        if (el.isConnected) continue
        mounted.delete(el)
        setTimeout(() => root.unmount(), 0)
      }
    }
    if (queued || !records.some((r) => r.addedNodes.length)) return
    queued = true
    queueMicrotask(() => {
      queued = false
      scan()
    })
  }).observe(document.body, { childList: true, subtree: true })
}
