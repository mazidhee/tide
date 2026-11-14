import { forwardRef, useMemo } from 'react'
import { passagePieces } from '@shared/comprehension'

/**
 * A passage in the reader's face: its paragraphs, with ranges (hard marks, graded points) drawn
 * over its exact words. Each piece carries its offsets, so a selection maps back to the
 * passage's characters (`offsetFromPoint`). The first piece of each range has data-anchor, for
 * placing a margin card level with it.
 */

export interface Range {
  id: string
  start: number
  end: number
  /** Classes for the words (cp-hard, cp-pt v-caught…) */
  cls: string
}

interface Props {
  text: string
  ranges: Range[]
  /** Ranges lit (hovered, or the open card's) */
  lit?: Set<string>
  onRangeClick?: (ids: string[], el: HTMLElement) => void
  onRangeHover?: (ids: string[] | null) => void
  className?: string
}

export const Passage = forwardRef<HTMLDivElement, Props>(function Passage({ text, ranges, lit, onRangeClick, onRangeHover, className }, ref) {
  const paras = useMemo(() => passagePieces(text, ranges), [text, ranges])
  const byId = useMemo(() => new Map(ranges.map((r) => [r.id, r])), [ranges])
  return (
    <div className={`cp-passage${className ? ` ${className}` : ''}`} ref={ref} lang="en">
      {paras.map((p) => (
        <p key={p.start} data-off={p.start}>
          {p.pieces.map((s) => {
            if (!s.ids.length) return <span key={s.start} data-off={s.start}>{s.text}</span>
            const cls = [...new Set(s.ids.map((id) => byId.get(id)?.cls ?? ''))].join(' ')
            const on = s.ids.some((id) => lit?.has(id))
            const anchors = s.ids.filter((id) => byId.get(id)?.start === s.start)
            return (
              <mark
                key={s.start}
                data-off={s.start}
                data-ids={s.ids.join(' ')}
                data-anchor={anchors.join(' ') || undefined}
                className={`${cls}${on ? ' on' : ''}`}
                onMouseEnter={onRangeHover ? () => onRangeHover(s.ids) : undefined}
                onMouseLeave={onRangeHover ? () => onRangeHover(null) : undefined}
                onClick={
                  onRangeClick
                    ? (e) => {
                        if (window.getSelection()?.toString()) return
                        e.stopPropagation()
                        onRangeClick(s.ids, e.currentTarget)
                      }
                    : undefined
                }
              >
                {s.text}
              </mark>
            )
          })}
        </p>
      ))}
    </div>
  )
})

/** The passage offset of a point in a selection: the piece it's in, plus characters into that piece */
export function offsetFromPoint(node: Node, offset: number): number | null {
  const el = (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest<HTMLElement>('[data-off]')
  if (!el) return null
  const base = Number(el.dataset.off)
  if (el.tagName === 'P') {
    // A point between pieces: count the text before it
    const r = document.createRange()
    r.setStart(el, 0)
    r.setEnd(node, offset)
    return base + r.toString().length
  }
  if (node.nodeType !== 3) return base + (offset > 0 ? (el.textContent?.length ?? 0) : 0)
  return base + offset
}

/** The current selection inside a passage element, as passage offsets; null when there's none there */
export function selectionIn(root: HTMLElement | null): { start: number; end: number; rect: DOMRect } | null {
  const sel = window.getSelection()
  if (!root || !sel || !sel.rangeCount || !sel.toString().trim()) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const a = offsetFromPoint(range.startContainer, range.startOffset)
  const b = offsetFromPoint(range.endContainer, range.endOffset)
  if (a === null || b === null) return null
  return { start: Math.min(a, b), end: Math.max(a, b), rect: range.getBoundingClientRect() }
}
