import { reveal } from '../lib/scroll'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit } from '@shared/types'
import { fileTitle, folderOf, useApp } from '../state'
import { Icon, type IconName } from './Icon'

interface Result {
  key: string
  icon: IconName
  title: string
  sub?: string
  run(): void
}

/** Subsequence match score: higher is better, -1 means no match. */
function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const at = t.indexOf(q)
  if (at >= 0) return 1000 - at - t.length / 100
  let qi = 0
  let score = 0
  let last = -1
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += last === i - 1 ? 3 : 1
      last = i
      qi++
    }
  }
  return qi === q.length ? score : -1
}

export function SearchPalette({ onClose }: { onClose(): void }) {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(() => window.tide.search.query(query, 12).then(setHits), 120)
    return () => clearTimeout(t)
  }, [query])

  const results: Result[] = useMemo(() => {
    const open = (path: string, anchor?: string) => () => {
      onClose()
      app.openPath(path, anchor)
    }
    if (!query.trim()) {
      const actions: Result[] = [
        { key: 'a-link', icon: 'link', title: 'Save a link', run: () => app.setDialog('save-link') },
        { key: 'a-review', icon: 'cards', title: 'Review flashcards', run: () => { onClose(); app.setView({ kind: 'study', scope: { kind: 'vault' } }) } },
        { key: 'a-lib', icon: 'library', title: 'Open library', run: () => { onClose(); app.setView({ kind: 'library' }) } },
        { key: 'a-settings', icon: 'settings', title: 'Settings', run: () => { onClose(); app.setView({ kind: 'settings' }) } }
      ]
      const recent = app.recent.slice(0, 6).map<Result>((p) => ({ key: p, icon: /\.pdf$/i.test(p) ? 'pdf' : 'note', title: fileTitle(p), sub: folderOf(p), run: open(p) }))
      return [...recent, ...actions]
    }
    const titles = app.files
      .filter((f) => f.kind === 'note' || f.kind === 'pdf' || f.kind === 'epub' || f.kind === 'doc' || f.kind === 'canvas')
      .map((f) => ({ f, score: fuzzy(query, fileTitle(f.name)) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map<Result>(({ f }) => ({ key: f.path, icon: f.kind === 'pdf' ? 'pdf' : f.kind === 'epub' ? 'book' : f.kind === 'canvas' ? 'canvas' : 'note', title: fileTitle(f.name), sub: folderOf(f.path), run: open(f.path) }))
    const seen = new Set(titles.map((t) => t.key))
    const content = hits
      .filter((h) => !seen.has(h.path))
      .map<Result>((h) => ({
        key: `c-${h.path}`,
        icon: 'search',
        title: h.title,
        sub: (h.heading ? `${h.heading}: ` : '') + h.snippet,
        run: open(h.path, h.heading)
      }))
    const askAi: Result = {
      key: 'ask',
      icon: 'sparkle',
      title: `Ask the tutor: “${query}”`,
      run: () => {
        onClose()
        app.ask(query, { scope: { kind: 'vault' } })
      }
    }
    return [...titles, ...content, askAi]
  }, [query, hits, app, onClose])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    reveal(listRef.current?.querySelector('.active'), { block: 'nearest', behavior: 'auto' })
  }, [active])

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-input">
          <Icon name="search" size={17} />
          <input
            autoFocus
            value={query}
            placeholder="Search notes, PDFs and saved pages"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(results.length - 1, a + 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              }
              if (e.key === 'Enter') results[active]?.run()
            }}
          />
        </div>
        <ul className="palette-list" ref={listRef} role="listbox">
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button className={`palette-row${i === active ? ' active' : ''}`} onMouseEnter={() => setActive(i)} onClick={r.run}>
                <Icon name={r.icon} size={16} />
                <span className="palette-text">
                  <span className="list-title">{r.title}</span>
                  {r.sub && <span className="muted small palette-sub">{r.sub}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
