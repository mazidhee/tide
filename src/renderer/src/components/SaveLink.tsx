import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state'
import { Icon } from './Icon'

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function SaveLinkForm({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const app = useApp()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!compact) inputRef.current?.focus()
  }, [compact])

  const save = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.tide.library.saveUrl(url.trim())
      await app.refreshTree()
      setUrl('')
      onDone?.()
      app.toast(`Saved “${res.title}”`, { action: { label: 'Open', run: () => app.openPath(res.path) } })
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className={`save-link${compact ? ' compact' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="save-link-row">
        <Icon name="link" size={16} />
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a link to an article, YouTube video or PDF"
          aria-label="Link to save"
          spellCheck={false}
        />
        <button className="btn primary" disabled={!url.trim() || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!compact && (
        <p className="muted small">
          Articles, videos and PDFs, saved as notes.
        </p>
      )}
    </form>
  )
}

export function SaveLinkDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Save a link" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <h2>Save a link</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">
          <SaveLinkForm onDone={onClose} />
        </div>
      </div>
    </div>
  )
}
