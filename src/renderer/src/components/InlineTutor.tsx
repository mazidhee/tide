import { Thinking } from './Thinking'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { TutorThread } from '@shared/types'
import { useApp } from '../state'
import { renderMarkdown } from '../lib/markdown'
import { Icon } from './Icon'
import { useThreadEngine } from '../lib/useThreadEngine'
import type { PersonaId } from '@shared/personas'

export const QUICK_ACTIONS: { label: string; prompt: string; quiz?: boolean; panel?: boolean }[] = [
  { label: 'Question me', prompt: 'Ask me one probing question about this that tests whether I really understand it. Don\'t explain yet.' },
  { label: 'Explain', prompt: 'Explain this simply.' },
  { label: 'Check my maths', prompt: 'Check every step of the maths in this passage with SymPy (run_code). Show each step as checked or wrong, and for a wrong one say exactly what is wrong and why.' },
  { label: 'Draw it', prompt: 'Draw this so I can see how it works: a diagram (mermaid) or a step-by-step trace table, then a one-line takeaway.' },
  { label: 'Example', prompt: 'Give me a concrete worked example of this.' },
  { label: 'Quiz me', prompt: 'Quiz me on this.', quiz: true },
  { label: 'Ask the panel', prompt: 'Critique this passage.', panel: true }
]

const KIND_LABEL: Record<string, string> = {
  probe: 'Question for you',
  question: 'Question for you',
  gap: 'Missing piece',
  correction: 'Check this',
  praise: 'Nice'
}

const uid = () => Math.random().toString(36).slice(2, 10)

/** Finds the rendered block a thread belongs to, re-anchoring by text if the note was edited. */
function findBlock(article: HTMLElement, thread: TutorThread): HTMLElement | null {
  const blocks = [...article.querySelectorAll<HTMLElement>(':scope > [data-line]')]
  const exact = blocks.find((b) => Number(b.dataset.line) === thread.line)
  // Compare as rendered text: the quote is Markdown, the blocks are not
  const plain = (t: string) => t.replace(/[*_`#>[\]$\\]/g, '').replace(/\s+/g, ' ').trim()
  const probe = plain(thread.quote).slice(0, 60)
  const text = (b: HTMLElement) => plain(b.textContent ?? '')
  if (exact && (!probe || text(exact).includes(probe.slice(0, 30)))) return exact
  const byText = probe ? blocks.find((b) => text(b).includes(probe)) : undefined
  if (byText) return byText
  // A margin note about a paragraph that's since been rewritten no longer belongs anywhere
  return thread.kind === 'readalong' ? null : exact ?? null
}

export interface InlineTutorHandle {
  startThread(block: HTMLElement, quote: string, prompt?: string, quiz?: boolean): void
}

interface Props {
  path: string
  html: string
  articleRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  instructions: string
  enabled: boolean
  showResolved: boolean
  rawRef: RefObject<string>
  onInsert(afterLine: number, markdown: string): void
  handleRef: RefObject<InlineTutorHandle | null>
  persona: PersonaId
  panel: PersonaId[]
  threads: TutorThread[]
  setThreads(update: (t: TutorThread[]) => TutorThread[]): void
}

export function InlineTutor({ path, html, articleRef, scrollRef, instructions, enabled, showResolved, onInsert, handleRef, persona, panel, threads, setThreads }: Props) {
  const { filesByName } = useApp()
  const env = { notePath: path, filesByName }
  const [slots, setSlots] = useState<Map<string, HTMLElement>>(new Map())
  const [hover, setHover] = useState<{ el: HTMLElement; top: number } | null>(null)
  const { ask: engineAsk, streaming } = useThreadEngine(path, instructions, persona, setThreads)
  const ask = useCallback(
    (thread: TutorThread, text: string, quiz?: boolean, usePanel?: boolean) => engineAsk(thread, text, { quiz, panel: usePanel ? panel : undefined }),
    [engineAsk, panel]
  )

  const startThread = useCallback(
    (block: HTMLElement, quote: string, prompt?: string, quiz?: boolean) => {
      const thread: TutorThread = {
        id: uid(),
        line: Number(block.dataset.line ?? 0),
        quote: quote.slice(0, 1200),
        kind: 'ask',
        messages: [],
        createdAt: Date.now()
      }
      setThreads((list) => [...list, thread])
      setHover(null)
      if (prompt) setTimeout(() => ask(thread, prompt, quiz), 0)
    },
    [ask, setThreads]
  )

  useEffect(() => {
    handleRef.current = { startThread }
  }, [handleRef, startThread])

  // Create a slot after each thread's block for the card to render into
  useLayoutEffect(() => {
    const article = articleRef.current
    if (!article) return
    article.querySelectorAll('.tutor-slot').forEach((s) => s.remove())
    const next = new Map<string, HTMLElement>()
    const visible = threads.filter((t) => showResolved || !t.resolved)
    for (const t of visible) {
      const block = findBlock(article, t)
      if (!block) continue
      const slot = document.createElement('div')
      slot.className = 'tutor-slot'
      // Several threads on one block stack in creation order
      let after: Element = block
      while (after.nextElementSibling?.classList.contains('tutor-slot')) after = after.nextElementSibling
      after.after(slot)
      next.set(t.id, slot)
    }
    setSlots(next)
  }, [html, threads.length, showResolved, threads.map((t) => t.resolved).join(), articleRef]) // eslint-disable-line react-hooks/exhaustive-deps

  // Gutter button that follows the block under the pointer
  useEffect(() => {
    const article = articleRef.current
    const scroller = scrollRef.current
    if (!article || !scroller || !enabled) return
    const onMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
      if (!target || target.parentElement !== article) return
      const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      setHover((h) => (h?.el === target ? h : { el: target, top }))
    }
    article.addEventListener('mousemove', onMove)
    return () => article.removeEventListener('mousemove', onMove)
  }, [articleRef, scrollRef, enabled, html])

  const update = (id: string, patch: Partial<TutorThread>) => setThreads((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const remove = (id: string) => setThreads((list) => list.filter((t) => t.id !== id))

  const insert = (thread: TutorThread) => {
    const answer = [...thread.messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())
    const block = articleRef.current && findBlock(articleRef.current, thread)
    if (!answer || !block) return
    const end = Number(block.dataset.lineEnd ?? block.dataset.line)
    const callout = `> [!tutor] Tutor\n${answer.content.trim().split('\n').map((l) => `> ${l}`).join('\n')}`
    onInsert(end, callout)
    update(thread.id, { resolved: true })
  }


  return (
    <>
      {enabled && hover && (
        <button
          className="tutor-gutter"
          style={{ top: hover.top }}
          title="Ask the tutor about this"
          onClick={() => startThread(hover.el, hover.el.textContent ?? '')}
        >
          <Icon name="sparkle" size={14} />
        </button>
      )}
      {threads.map((t) => {
        const slot = slots.get(t.id)
        if (!slot) return null
        const busy = streaming.has(t.id)
        return createPortal(
          <div className={`tutor-thread${t.kind === 'readalong' ? ' readalong' : ''}${t.resolved ? ' resolved' : ''}`} contentEditable={false}>
            <div className="tutor-thread-head">
              <Icon name="sparkle" size={13} />
              <span>{t.kind === 'readalong' ? KIND_LABEL[t.note ?? 'question'] : 'Tutor'}</span>
              <div className="tutor-thread-actions">
                {t.messages.some((m) => m.role === 'assistant' && m.content) && !busy && (
                  <button className="tool-btn" onClick={() => insert(t)} title="Write this answer into the note as a callout">
                    Add to note
                  </button>
                )}
                <button className="tool-btn" onClick={() => update(t.id, { resolved: !t.resolved })}>
                  {t.resolved ? 'Reopen' : 'Done'}
                </button>
                <button className="icon-btn small" onClick={() => remove(t.id)} title="Delete thread">
                  <Icon name="x" size={13} />
                </button>
              </div>
            </div>
            {t.messages.map((m, i) =>
              m.role === 'user' ? (
                <p key={i} className="tutor-q">
                  {m.content}
                </p>
              ) : m.content ? (
                <div key={i} className="prose compact tutor-a" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content, env) }} />
              ) : (
                <Thinking key={i} />
              )
            )}
            {t.messages.length === 0 && (
              <div className="tutor-chips">
                {QUICK_ACTIONS.map((a) => (
                  <button key={a.label} onClick={() => ask(t, a.prompt, a.quiz, a.panel)}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            {!t.resolved && (
              <form
                className="tutor-reply"
                onSubmit={(e) => {
                  e.preventDefault()
                  const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement
                  if (!input.value.trim() || busy) return
                  ask(t, input.value.trim())
                  input.value = ''
                }}
              >
                <input name="q" autoFocus={t.messages.length === 0} placeholder={t.messages.length ? 'Reply or answer' : 'Ask about this passage'} autoComplete="off" />
                <button className="send-btn small" disabled={busy} title="Send">
                  <Icon name="send" size={13} />
                </button>
              </form>
            )}
          </div>,
          slot,
          t.id
        )
      })}
    </>
  )
}
