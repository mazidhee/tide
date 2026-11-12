import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { AgentStep } from '@shared/types'
import { asked, threadReplyText, type LessonThread } from '@shared/lessonThreads'
import { Icon } from './Icon'
import { ProfessorStill } from './Professor'

/**
 * Lesson threads (shared/lessonThreads): the pieces the lesson view puts around a tutor's output.
 * Ask on hover or on a selection opens a thread under the output: a line is drawn from it, the
 * card unfolds, and the conversation goes on in there for as long as you need. "Got it" (or Esc,
 * or Back to the lesson) folds it into one line under the output and takes you back to the
 * lesson's question.
 */

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
/** How long the card takes to fold away (styles/threads.css .lt-fold) */
export const FOLD_MS = 380

/** The arrow that marks a thread: down and off to the side */
function ThreadGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
      <path d="m16 11 4 4-4 4" />
    </svg>
  )
}

export function YouAvatar() {
  return (
    <span className="lt-av lt-me" aria-hidden="true">
      Y
    </span>
  )
}

export function TutorAvatar() {
  return (
    <span className="lt-av lt-prof" aria-hidden="true">
      <ProfessorStill size={14} />
    </span>
  )
}

/** The hover pill on an output */
export function AskPill({ onAsk }: { onAsk(): void }) {
  return (
    <button type="button" className="lt-ask" onClick={onAsk} aria-label="Ask about this explanation in a thread" title="Ask about this, in a thread under it">
      <ThreadGlyph />
      Ask
    </button>
  )
}

/**
 * "Ask about this" over text selected in an output. Watches selections in the column; an output
 * is any element marked data-thread-out with its turn index, and a thread's own card never counts.
 */
export function SelectionAsk({ column, onAsk }: { column: RefObject<HTMLElement | null>; onAsk(at: number, quote: string): void }) {
  const [at, setAt] = useState<{ x: number; y: number; turn: number; quote: string } | null>(null)
  useEffect(() => {
    const root = column.current
    if (!root) return
    const onUp = () =>
      setTimeout(() => {
        const sel = window.getSelection()
        const text = sel?.toString().trim() ?? ''
        const node = sel?.anchorNode
        const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null
        const out = el?.closest<HTMLElement>('[data-thread-out]')
        const focus = sel?.focusNode ? (sel.focusNode.nodeType === 1 ? (sel.focusNode as Element) : sel.focusNode.parentElement) : null
        if (!sel || !text || text.length > 300 || !out || !root.contains(out) || el?.closest('.lt-thread') || focus?.closest('[data-thread-out]') !== out) return setAt(null)
        const r = sel.getRangeAt(0).getBoundingClientRect()
        setAt({ x: r.left + r.width / 2, y: r.top, turn: Number(out.dataset.threadOut), quote: text.replace(/\s+/g, ' ') })
      })
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest?.('.lt-sel-pop')) setAt(null)
    }
    const onScroll = () => setAt(null)
    root.addEventListener('mouseup', onUp)
    document.addEventListener('mousedown', onDown)
    root.closest('.session-scroll')?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('mouseup', onUp)
      document.removeEventListener('mousedown', onDown)
      root.closest('.session-scroll')?.removeEventListener('scroll', onScroll)
    }
  }, [column])
  if (!at) return null
  return (
    <button
      type="button"
      className="lt-sel-pop"
      style={{ left: Math.max(8, at.x - 64), top: Math.max(8, at.y - 44) }}
      onClick={() => {
        window.getSelection()?.removeAllRanges()
        setAt(null)
        onAsk(at.turn, at.quote)
      }}
    >
      <ThreadGlyph />
      Ask about this
    </button>
  )
}

/** The floating pill above the answer box while a thread is open */
export function BackPill({ show, onBack }: { show: boolean; onBack(): void }) {
  return (
    <button type="button" className={`lt-back${show ? ' show' : ''}`} onClick={onBack} tabIndex={show ? 0 : -1} aria-hidden={!show} aria-label="Back to the lesson">
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M6 13l6 6 6-6" />
      </svg>
      Back to the lesson <kbd>Esc</kbd>
    </button>
  )
}

/** Typed in the answer box, but it reads as a question about the explanation */
export function AnswerHint({ show, question, onThread, onAnswer }: { show: boolean; question: string; onThread(): void; onAnswer(): void }) {
  return (
    <div className={`lt-hint${show ? ' show' : ''}`} role="status" aria-hidden={!show}>
      <div>
        <div className="lt-hint-in">
          <span>That reads like a question about the explanation, not your answer{question ? ` to “${question.length > 70 ? `${question.slice(0, 69).trimEnd()}…` : question}”` : ''}.</span>
          <span className="lt-hint-acts">
            <button type="button" className="btn primary small" onClick={onThread} tabIndex={show ? 0 : -1}>
              Ask in a thread
            </button>
            <button type="button" className="btn small" onClick={onAnswer} tabIndex={show ? 0 : -1}>
              It's my answer
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

interface SlotProps {
  thread: LessonThread
  open: boolean
  /** A reply is being written in it */
  streaming: boolean
  steps?: AgentStep[]
  error?: string
  /** The lesson has a notes pane to add to */
  notes: boolean
  render(markdown: string): string
  onSend(text: string): void
  onRetry(): void
  onFold(understood: boolean): void
  onReopen(): void
  onNotes(): void
}

/** One thread under its output: the card while it's open, the folded line once it's done */
export function ThreadSlot(p: SlotProps) {
  const { thread, open } = p
  // The card stays while it folds away, then the line takes its place
  const [card, setCard] = useState(open)
  const [unfolded, setUnfolded] = useState(false)
  const wire = useRef<SVGPathElement>(null)
  useEffect(() => {
    if (open) {
      setCard(true)
      let b = 0
      const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setUnfolded(true))))
      return () => (cancelAnimationFrame(a), cancelAnimationFrame(b))
    }
    setUnfolded(false)
    const t = setTimeout(() => setCard(false), reducedMotion() ? 0 : FOLD_MS)
    return () => clearTimeout(t)
  }, [open])
  // The line is drawn from the output down into the card
  useLayoutEffect(() => {
    if (!card || !open || reducedMotion() || !wire.current?.animate) return
    wire.current.animate([{ strokeDasharray: '1', strokeDashoffset: 1 }, { strokeDasharray: '1', strokeDashoffset: 0 }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' })
  }, [card, open])

  if (!card) {
    const n = asked(thread)
    if (!n) return null
    const first = thread.messages.find((m) => m.role === 'user')?.content ?? ''
    return (
      <div className="lt-chip-row">
        <button type="button" className="lt-chip" onClick={p.onReopen} aria-label={`Reopen the thread: ${first}. ${n} question${n === 1 ? '' : 's'}${thread.understood ? ', understood' : ''}`}>
          <span className="lt-stack">
            <YouAvatar />
            <TutorAvatar />
          </span>
          <span className="lt-chip-q">{first}</span>
          <span>
            {n} question{n === 1 ? '' : 's'}
          </span>
          {thread.understood && (
            <span className="lt-ok">
              <Icon name="check" size={13} />
              understood
            </span>
          )}
        </button>
      </div>
    )
  }
  return (
    <div className={`lt-fold${unfolded ? ' open' : ''}`}>
      <div className="lt-fold-in">
        <section className="lt-thread" aria-label={thread.quote ? `Thread on “${thread.quote}”` : 'Thread on this explanation'}>
          <svg className="lt-wire" aria-hidden="true">
            <path ref={wire} pathLength={1} d="M13 0 V 20 Q 13 30 23 30 H 34" />
            <circle cx="13" cy="0" r="3" />
          </svg>
          <ThreadCard {...p} />
        </section>
      </div>
    </div>
  )
}

function ThreadCard(p: SlotProps) {
  const { thread, streaming } = p
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  // Focus the composer once the card has opened
  useEffect(() => {
    const t = setTimeout(() => box.current?.focus({ preventScroll: true }), reducedMotion() ? 0 : 300)
    return () => clearTimeout(t)
  }, [])
  // New words keep the end in view, unless you've scrolled up to read
  const last = thread.messages[thread.messages.length - 1]
  useLayoutEffect(() => {
    const el = body.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [thread.messages.length, last?.content.length, p.steps?.length])
  const fit = () => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }
  const go = () => {
    const q = text.trim()
    if (!q || streaming) return
    setText('')
    requestAnimationFrame(fit)
    stick.current = true
    p.onSend(q)
  }
  // Only what the tutor did with its tools (ran code, looked something up): not which model is answering
  const tools = p.steps?.filter((x) => x.kind !== 'helper')
  const waiting = streaming && last?.role === 'assistant' && !last.content && !tools?.length
  return (
    <div className="lt-card">
      <div className="lt-head">
        <span className="lt-ttl">
          <ThreadGlyph />
          Thread
        </span>
        {thread.quote ? <span className="lt-quote">“{thread.quote}”</span> : <span>on this explanation</span>}
        <span className="lt-sp" />
        <button type="button" className="lt-x" onClick={() => p.onFold(false)} aria-label="Fold the thread" title="Fold the thread (Esc)">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div
        className="lt-body"
        ref={body}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {thread.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="lt-msg">
              <YouAvatar />
              <div className="lt-me-text">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="lt-msg">
              <TutorAvatar />
              <div>
                {i === thread.messages.length - 1 && !!tools?.length && (
                  <ul className="work-log lt-steps">
                    {tools.map((s) => (
                      <li key={s.id} className={`step ${s.status}`}>
                        {s.status === 'running' ? <span className="spinner" /> : <Icon name={s.kind === 'run_code' || s.kind === 'run_sql' ? 'terminal' : s.kind === 'web_search' ? 'globe' : 'search'} size={13} />}
                        <span className="step-label">{s.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {waiting && i === thread.messages.length - 1 ? (
                  <span className="lt-dots" role="status" aria-label="The tutor is writing">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <div className="prose compact lt-tutor" dangerouslySetInnerHTML={{ __html: withCaret(p.render(threadReplyText(m.content)), streaming && i === thread.messages.length - 1) }} />
                )}
              </div>
            </div>
          )
        )}
        {p.error && (
          <div className="lt-error" role="alert">
            <span>{p.error}</span>
            <button type="button" className="link-btn" onClick={p.onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
      <div className="lt-composer">
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={thread.messages.length ? 'Ask a follow-up…' : 'What would you like to understand?'}
          aria-label="Ask in this thread"
          onChange={(e) => {
            setText(e.target.value)
            fit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              go()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              p.onFold(false)
            }
          }}
        />
        <button type="button" className="lt-send" aria-label="Ask" disabled={!text.trim() || streaming} onClick={go}>
          <Icon name="send" size={14} />
        </button>
      </div>
      <div className="lt-foot">
        <button type="button" className="btn primary small lt-got" onClick={() => p.onFold(true)} disabled={!thread.messages.length}>
          <Icon name="check" size={13} />
          Got it · back to the lesson
        </button>
        {p.notes && (
          <button type="button" className={`btn small${thread.noted ? ' lt-done' : ''}`} onClick={p.onNotes} disabled={thread.noted || streaming || !thread.messages.some((m) => m.role === 'assistant' && m.content.trim())}>
            {thread.noted ? (
              <>
                <Icon name="check" size={13} />
                Added to notes
              </>
            ) : (
              'Add to notes'
            )}
          </button>
        )}
        <span className="lt-keys">
          <kbd>↵</kbd> ask · <kbd>Esc</kbd> back
        </span>
      </div>
    </div>
  )
}

/** The caret at the end of the words still arriving */
function withCaret(html: string, on: boolean): string {
  if (!on) return html
  const caret = '<span class="lt-caret" aria-hidden="true"></span>'
  return /<\/p>\s*$/.test(html) ? html.replace(/<\/p>\s*$/, `${caret}</p>`) : html + caret
}

/**
 * The phrase a thread is about, highlighted in its output while the thread is open: a CSS custom
 * highlight, so the rendered output itself is never changed.
 */
export function highlightQuote(out: Element | null, quote: string | undefined): () => void {
  const reg = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!out || !quote || !reg || !H) return () => {}
  // The text of the output, node by node, to find the phrase even across formatting
  const nodes: { node: Text; from: number }[] = []
  let all = ''
  const walk = document.createTreeWalker(out, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    if (n.parentElement?.closest('.lt-ask, .s-tutor-tools')) continue
    nodes.push({ node: n, from: all.length })
    all += n.data
  }
  const squash = (s: string) => s.replace(/\s+/g, ' ')
  // Whitespace differs between the selection and the DOM: match with runs of space as one
  const flat = squash(all)
  const at = flat.indexOf(squash(quote))
  if (at < 0) return () => {}
  // Map positions in the squashed text back to the real one
  const real = (pos: number) => {
    let i = 0
    let j = 0
    while (j < pos && i < all.length) {
      if (/\s/.test(all[i])) {
        while (i + 1 < all.length && /\s/.test(all[i + 1])) i++
      }
      i++
      j++
    }
    return i
  }
  const start = real(at)
  const end = real(at + squash(quote).length)
  const place = (pos: number) => {
    const hit = [...nodes].reverse().find((n) => n.from <= pos) ?? nodes[0]
    return { node: hit.node, offset: Math.min(pos - hit.from, hit.node.data.length) }
  }
  const range = document.createRange()
  const a = place(start)
  const b = place(end)
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  reg.set('tide-thread', new H(range))
  return () => reg.delete('tide-thread')
}
