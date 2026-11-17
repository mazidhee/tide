/**
 * The flight plan's tutor column: the project's lesson, through the normal session engine (the same
 * request a lesson sends: the work project's rules in its instructions, its work_project and
 * practice_metabase tools, the workspace's files and shell), in a narrow column beside the editor.
 * One conversation for the whole project, kept on this Mac; each message says which step it's on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { parseBlocks, sessionInstructions, type SessionSetup } from '@shared/session'
import { renderMarkdown } from '../lib/markdown'
import { EnginePill, engineFields, type Engine } from './EnginePill'
import { PixelProf } from './learn/PixelProf'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  /** What the learner sees of their own message (the step note rides hidden) */
  shown?: string
}

const KEY = (slug: string) => `tide.flight.chat.${slug}`
const ENGINE = 'tide.flight.engine'
const uid = () => Math.random().toString(36).slice(2, 10)
const env = { notePath: '', filesByName: new Map<string, string>() }

/** A tutor message as the learner reads it: its text, questions and marks, never the tags */
function shownText(full: string): string {
  return parseBlocks(full)
    .map((b) => (b.kind === 'text' ? b.text : b.kind === 'ask' ? b.prompt : b.kind === 'grade' ? b.text : b.kind === 'summary' ? b.text : b.kind === 'note' ? `> ${b.text}` : ''))
    .filter(Boolean)
    .join('\n\n')
}

export interface FlightTutorHandle {
  send(text: string, shown?: string): void
}

export function FlightTutor({ slug, title, step, stepTitle, root, file, terminalId, onReady }: { slug: string; title: string; step: number; stepTitle: string; root: string; file: string; terminalId: string | null; onReady?(h: FlightTutorHandle): void }) {
  const [turns, setTurns] = useState<Turn[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY(slug)) ?? '[]') as Turn[]
    } catch {
      return []
    }
  })
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [engine, setEngine] = useState<Engine>(() => (localStorage.getItem(ENGINE) as Engine) || 'auto')
  const labId = useMemo(() => `work:${slug}`, [slug])
  const topic = `Work project: ${title}`
  const setup: SessionSetup = useMemo(() => ({ mode: 'teach', scope: { kind: 'none' }, topic, options: { codeRoot: root, strategy: 'code', workProject: { slug, title } } }), [topic, root, slug, title])
  const live = useRef('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(KEY(slug), JSON.stringify(turns.slice(-60)))
    } catch {
      // full or blocked: the conversation still runs
    }
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, slug])

  // The workspace is the lesson's folder, so the tutor's read_file and terminal tools find it
  useEffect(() => {
    if (root) void window.tide.ide.lesson.open(labId, topic, root).catch(() => {})
  }, [labId, topic, root])

  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        if (e.id !== live.current) return
        if (e.type === 'delta') setTurns((t) => (t.length ? [...t.slice(0, -1), { ...t[t.length - 1], content: t[t.length - 1].content + e.text }] : t))
        else if (e.type === 'reset') setTurns((t) => (t.length ? [...t.slice(0, -1), { ...t[t.length - 1], content: '' }] : t))
        else if (e.type === 'error') {
          setTurns((t) => (t.length ? [...t.slice(0, -1), { ...t[t.length - 1], content: `${t[t.length - 1].content}\n\n_${e.message}_` }] : t))
          setBusy(false)
        } else if (e.type === 'done') setBusy(false)
      }),
    []
  )

  const send = useCallback(
    (text: string, shown?: string) => {
      const said = text.trim()
      if (!said || busy) return
      const id = uid()
      live.current = id
      const content = `(On step ${step}: ${stepTitle}. Their file: ${file}.)\n${said}`
      const next: Turn[] = [...turns, { role: 'user', content, shown: shown ?? said }, { role: 'assistant', content: '' }]
      setTurns(next)
      setBusy(true)
      const messages: ChatMessage[] = next.slice(0, -1).map((t) => ({ role: t.role, content: t.content }))
      void window.tide.ai
        .chat({ id, messages, scope: { kind: 'none' }, instructions: sessionInstructions(setup), labId, ...(terminalId ? { terminalId } : {}), codeLesson: { file, root }, session: true, topic, workProject: slug, ...engineFields(engine) })
        .catch((e: Error) => {
          setTurns((t) => [...t.slice(0, -1), { role: 'assistant', content: `_${e.message}_` }])
          setBusy(false)
        })
    },
    [busy, turns, step, stepTitle, file, setup, labId, terminalId, root, topic, slug, engine]
  )

  useEffect(() => onReady?.({ send }), [onReady, send])

  const submit = () => {
    send(draft)
    setDraft('')
  }

  return (
    <section className="fp-col fp-tutor" aria-label="Tutor">
      <div className="fp-hd">
        <span className="fp-prof">
          <PixelProf pose="idle" scale={2} />
        </span>
        <b>Tutor</b>
        <span>· step {step}</span>
        <span className="fp-sp" />
        <EnginePill
          value={engine}
          onChange={(v) => {
            setEngine(v)
            localStorage.setItem(ENGINE, v)
          }}
        />
      </div>
      <div className="fp-bd fp-msgs" ref={listRef} aria-live="polite">
        {!turns.length && <p className="fp-empty">Read the task, then tell the tutor which collection you’d start from and why. You write every pipeline; the tutor reviews it and asks why.</p>}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="fp-msg me">
              <div className="fp-who me">You</div>
              <div className="fp-body">{t.shown ?? t.content}</div>
            </div>
          ) : (
            <div key={i} className="fp-msg">
              <div className="fp-who">
                <PixelProf pose={busy && i === turns.length - 1 ? 'thinking' : 'idle'} scale={2} playing={busy && i === turns.length - 1} />
              </div>
              {t.content ? <div className="fp-body prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(shownText(t.content), env) }} /> : <div className="fp-body fp-thinking">Thinking…</div>}
            </div>
          )
        )}
      </div>
      <div className="fp-askwrap">
        <div className="fp-qr">
          <button onClick={() => send(`Review my pipeline in ${file}: run it on the practice data and ask me about each choice.`, 'Review my pipeline')} disabled={busy}>
            Review my pipeline
          </button>
          <button onClick={() => send('A nudge, please, not the answer: what should I look at next?', 'A nudge, not the answer')} disabled={busy}>
            A nudge, not the answer
          </button>
        </div>
        <div className="fp-ask">
          <textarea
            value={draft}
            placeholder="Ask the tutor…"
            aria-label="Ask the tutor"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <button className="btn small" onClick={submit} disabled={busy || !draft.trim()}>
            Send
          </button>
        </div>
      </div>
    </section>
  )
}
