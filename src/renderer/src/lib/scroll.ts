/**
 * Scrolls an element into view inside its nearest scrolling container only. The browser's own
 * scrollIntoView also scrolls every overflow-hidden ancestor, which shifts the whole window frame
 * (toolbars cut off, a gap at the top). Never use it on app content.
 */
type Block = 'start' | 'center' | 'end' | 'nearest'

function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

export function reveal(el: Element | null | undefined, { block = 'start', behavior = 'smooth' }: { block?: Block; behavior?: ScrollBehavior } = {}) {
  if (!(el instanceof HTMLElement)) return
  const box = scroller(el)
  if (!box) return
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
  const top = r.top - b.top + box.scrollTop
  let target: number
  if (block === 'start') target = top - margin
  else if (block === 'end') target = top + r.height - box.clientHeight
  else if (block === 'center') target = top - (box.clientHeight - r.height) / 2
  else if (r.top < b.top) target = top - margin
  else if (r.bottom > b.bottom) target = top + r.height - box.clientHeight
  else return
  box.scrollTo({ top: Math.max(0, target), behavior })
}
