import { useState } from 'react'
import type { FreeBook } from '@shared/freeBooks'
import { SITE_NAME } from '@shared/freeBooks'
import { useApp } from '../state'
import { Icon } from './Icon'

/**
 * Free public-domain books, added in one step: search Project Gutenberg and Standard Ebooks by
 * title or author, or paste a link to a book on either. The EPUB comes from the site itself.
 */
export function FreeBookFinder({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<FreeBook[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    if (!q.trim()) return
    setBusy('search')
    setError(null)
    try {
      setFound(await window.tide.reading.freeSearch(q.trim()))
    } catch (e) {
      setError(`Couldn't search: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const add = async (b: FreeBook) => {
    setBusy(b.epub)
    setError(null)
    try {
      const r = await window.tide.reading.freeAdd(b)
      await app.refreshTree()
      app.toast(`Added ${r.title}`, { action: { label: 'Open', run: () => app.openPath(r.path) } })
      onClose()
    } catch (e) {
      setError(`Couldn't add it: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="free-books" aria-label="Free books">
      <form
        className="free-books-row"
        onSubmit={(e) => {
          e.preventDefault()
          search()
        }}
      >
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="A title or author, e.g. Meditations, or a link to a book on either site" aria-label="Search free books" />
        <button className="btn primary" disabled={!q.trim() || !!busy}>
          {busy === 'search' ? 'Searching…' : 'Search'}
        </button>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          <Icon name="x" size={14} />
        </button>
      </form>
      <p className="muted small">From Project Gutenberg and Standard Ebooks, which state their texts are in the public domain in the USA. Each book keeps a note of where it came from.</p>
      {error && <p className="discuss-error">{error}</p>}
      {found && !found.length && <p className="muted">Nothing on either site for that. Try the author's surname, or the title alone.</p>}
      {found && found.length > 0 && (
        <ul className="free-books-list">
          {found.map((b) => (
            <li key={b.epub}>
              <div>
                <strong>{b.title || b.id}</strong>
                {b.author && <span className="muted"> · {b.author}</span>}
                <div className="muted small">{SITE_NAME[b.site]}</div>
              </div>
              <button className="btn small" disabled={!!busy} onClick={() => add(b)}>
                {busy === b.epub ? 'Adding…' : 'Add to library'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
