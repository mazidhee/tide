import { useEffect, useRef, useState } from 'react'
import type { FindStatus } from '../lib/pdfTools'
import { Icon } from './Icon'

/** What the count says: "3 of 17", "No matches", or nothing yet */
export function findLabel(query: string, s: FindStatus | null): string {
  if (!query.trim() || !s) return ''
  if (s.state === 'notFound') return 'No matches'
  if (!s.total) return s.state === 'pending' ? 'Searching…' : ''
  return `${Math.max(1, s.current)} of ${s.total}${s.total >= 1000 ? '+' : ''}`
}

/**
 * Find in the PDF: type to search every page, Enter for the next match, Shift+Enter for the one
 * before, Escape to close. Matches are highlighted on the pages; the count says where you are.
 */
export function PdfFindBar({ status, onFind, onClose, focusNonce }: { status: FindStatus | null; onFind: (query: string, opts?: { previous?: boolean; again?: boolean }) => void; onClose: () => void; focusNonce: number }) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusNonce])
  useEffect(() => () => clearTimeout(typing.current), [])

  const change = (q: string) => {
    setQuery(q)
    clearTimeout(typing.current)
    // A short pause, so a long book isn't searched for every letter
    typing.current = setTimeout(() => onFind(q), 180)
  }
  const step = (previous: boolean) => {
    if (!query.trim()) return
    clearTimeout(typing.current)
    onFind(query, { previous, again: true })
  }
  const label = findLabel(query, status)

  return (
    <div className="pdf-find-bar" role="search" onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <Icon name="search" size={14} className="pdf-find-icon" />
      <input
        ref={input}
        value={query}
        placeholder="Find in PDF"
        aria-label="Find in PDF"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className={`pdf-find-count${status?.state === 'notFound' && query.trim() ? ' none' : ''}`} aria-live="polite">
        {label}
      </span>
      <button className="icon-btn small" title="Previous match (⇧↩)" aria-label="Previous match" disabled={!status?.total} onClick={() => step(true)}>
        <Icon name="chevron" size={14} className="pdf-find-up" />
      </button>
      <button className="icon-btn small" title="Next match (↩)" aria-label="Next match" disabled={!status?.total} onClick={() => step(false)}>
        <Icon name="chevron" size={14} className="pdf-find-down" />
      </button>
      <button className="icon-btn small" title="Close (Esc)" aria-label="Close find" onClick={onClose}>
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
