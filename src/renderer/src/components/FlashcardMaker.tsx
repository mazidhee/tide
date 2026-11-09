import { useState } from 'react'
import { cardsToMarkdown } from '@shared/cards'
import { useApp } from '../state'
import { Icon } from './Icon'

interface Card {
  front: string
  back: string
}

export function FlashcardMaker({
  sourcePath,
  focusText,
  pages,
  onClose
}: {
  sourcePath: string
  focusText?: string
  /** A book's chapter: cards from those pages only */
  pages?: { from: number; to: number }
  onClose(): void
}) {
  const app = useApp()
  const [count, setCount] = useState(focusText ? 3 : pages ? 8 : 10)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      setCards(await window.tide.ai.generateFlashcards(sourcePath, count, focusText, pages))
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const kept = (cards ?? []).filter((c) => c.front.trim() && c.back.trim())
    if (!kept.length) return
    const path = await window.tide.study.saveCards(sourcePath, cardsToMarkdown(kept))
    await app.refreshTree()
    onClose()
    app.toast(`Saved ${kept.length} flashcards`, {
      action: { label: 'Review now', run: () => app.setView({ kind: 'study', scope: { kind: 'note', path } }) }
    })
  }

  const update = (i: number, patch: Partial<Card>) =>
    setCards((list) => list!.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Make flashcards">
        <header className="modal-head">
          <h2>{focusText ? 'Flashcards from your selection' : 'Flashcards from this note'}</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </header>

        {!cards && (
          <div className="modal-body">
            {focusText && <blockquote className="selection-quote">{focusText}</blockquote>}
            <p className="muted">
              Edit the cards before saving.
            </p>
            <label className="field-inline">
              How many cards
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[3, 5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="error-text">{error}</p>}
          </div>
        )}

        {cards && (
          <div className="modal-body card-editor">
            {cards.length === 0 && <p className="muted">The AI didn't return any cards. Try again.</p>}
            {cards.map((c, i) => (
              <div className="card-edit" key={i}>
                <textarea value={c.front} rows={2} onChange={(e) => update(i, { front: e.target.value })} aria-label="Question" />
                <textarea value={c.back} rows={2} onChange={(e) => update(i, { back: e.target.value })} aria-label="Answer" />
                <button className="icon-btn" title="Remove card" onClick={() => setCards((l) => l!.filter((_, j) => j !== i))}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <footer className="modal-foot">
          {cards ? (
            <>
              <button className="btn ghost" onClick={generate} disabled={busy}>
                {busy ? 'Writing cards…' : 'Write new ones'}
              </button>
              <button className="btn primary" onClick={save} disabled={!cards.length}>
                Save {cards.length} cards
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={generate} disabled={busy}>
              {busy ? 'Writing cards…' : 'Write cards'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
