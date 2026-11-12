import { useEffect, useRef, useState } from 'react'
import { DictateButton } from '../Voice'
import { Icon } from '../Icon'

export interface ChatLine {
  role: 'interviewer' | 'candidate'
  text: string
  hint?: boolean
}

/**
 * The interviewer beside the work: what was said, the reply as it streams, a box to talk (typed
 * or dictated with Tide's local voice), and a hint button that says what it costs. Without Claude
 * it says so plainly and offers only the bank's hints.
 */
export function MockChat({
  lines,
  streaming,
  busy,
  interviewer,
  why,
  hints,
  hintsLeft,
  onSay,
  onHint,
  placeholder = 'Talk through your thinking, or ask a clarifying question',
  topic
}: {
  lines: ChatLine[]
  streaming: string
  busy: boolean
  interviewer: boolean
  why?: string
  hints: number
  /** null: hints aren't offered in this kind of mock */
  hintsLeft: number | null
  onSay(text: string): void
  onHint(): void
  placeholder?: string
  topic?: string
}) {
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [lines.length, streaming])
  const send = () => {
    const t = draft.trim()
    if (!t || busy || !interviewer) return
    onSay(t)
    setDraft('')
  }
  return (
    <div className="mk-chat">
      <div className="mk-chat-head">
        <span className="mk-chat-title">{interviewer ? 'Interviewer' : 'No interviewer'}</span>
        {hintsLeft !== null && (
          <button className="link-btn quiet mk-hint-btn" onClick={onHint} disabled={busy || hintsLeft <= 0} title="Each hint lowers your Independence score">
            <Icon name="sparkle" size={12} />
            {hints ? `Hint (${hints} taken)` : 'Ask for a hint'}
          </button>
        )}
      </div>
      <div className="mk-chat-lines" aria-live="polite">
        {!interviewer && (
          <p className="mk-chat-note">
            The interviewer needs Claude{why ? ` (${why})` : ''}. Work through it on your own: it is marked in code{hintsLeft !== null ? ', and hints come from the bank' : ''}.
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`mk-line ${l.role}${l.hint ? ' hint' : ''}`}>
            <p>{l.text}</p>
          </div>
        ))}
        {streaming && (
          <div className="mk-line interviewer">
            <p>{streaming}</p>
          </div>
        )}
        {busy && !streaming && <span className="mk-typing" aria-label="The interviewer is answering" />}
        <div ref={end} />
      </div>
      {interviewer && (
        <div className="mk-chat-box">
          <textarea
            ref={box}
            value={draft}
            rows={2}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="mk-chat-actions">
            <DictateButton target={box} onText={(t) => setDraft((d) => (d ? `${d} ${t}` : t))} where={topic ? { topic } : undefined} />
            <button className="icon-btn" title="Send (Return)" disabled={!draft.trim() || busy} onClick={send}>
              <Icon name="send" size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
