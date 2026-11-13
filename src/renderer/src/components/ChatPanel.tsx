import { learnIntent } from '@shared/learnIntent'
import { climbLadder } from '../lib/mathsLadder'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatScope } from '@shared/types'
import { fileTitle, useApp, pagesLabel } from '../state'
import { Icon } from './Icon'
import { Composer, TurnView, useConversation } from './Conversation'
import { describeScreen, screenLabel } from '@shared/onScreen'
import { onScreenChange, screenNow } from '../lib/onScreen'
import { formatTime } from '@shared/video'

/** What's on screen in the course reader or the reading sheet, kept fresh (a playing video's moment, once a second) */
function useOnScreen() {
  const [snap, setSnap] = useState(screenNow)
  useEffect(() => {
    const read = () => setSnap(screenNow())
    const off = onScreenChange(read)
    const tick = setInterval(() => {
      const s = screenNow()
      if (s?.video?.playing || (s?.video && snap?.video?.at !== s.video.at)) read()
    }, 1000)
    return () => {
      off()
      clearInterval(tick)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return snap
}

type ScopeChoice = 'note' | 'notebook' | 'vault' | 'none'

const SUGGESTIONS: Record<ScopeChoice, string[]> = {
  note: ['Explain the key ideas simply', 'What should I memorize from this?', 'Give me 3 practice problems'],
  notebook: ['What does this notebook cover?', 'Which topics connect to each other?', 'Make me a study plan'],
  vault: ['What have I been studying lately?', 'Find notes about recursion', 'What are my weakest topics?'],
  none: ['Explain big-O like I’m new to it', 'Help me plan a study session']
}

/** The last request from elsewhere that was passed on, so the panel coming back on screen never sends it a second time */
let handledAsk: number | null = null

/**
 * `dock`: the tutor inside the course reader, so it never fights the video for the right of the
 * window. Folded, it is one bar at the foot of the reading column (what it sees, Explain, Quiz me,
 * the message box); asked something, it opens upwards over the text with the conversation, and
 * folds away again with one click.
 */
export function ChatPanel({ variant = 'panel' }: { variant?: 'panel' | 'dock' } = {}) {
  const dock = variant === 'dock'
  const [open, setOpen] = useState(false)
  const app = useApp()
  const { view, pendingAsk } = app
  const openPath = view.kind === 'file' ? view.path : null
  const isNote = !!openPath && /\.(md|markdown)$/i.test(openPath)
  const isPdf = !!openPath && /\.pdf$/i.test(openPath)
  const notebook = openPath?.includes('/') ? openPath.split('/')[0] : null

  const convo = useConversation()
  const { turns, busy } = convo
  const [choice, setChoice] = useState<ScopeChoice>('vault')
  const [input, setInput] = useState('')
  const [attachment, setAttachment] = useState<string | undefined>()
  const [explicitScope, setExplicitScope] = useState<ChatScope | null>(null)
  // Instructions from a "Teach me" session stay active for the follow-up turns
  const instructionsRef = useRef<string | undefined>(undefined)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // [immersive] The tutor sees what's on screen (lib/onScreen); the chip shows it, and can be turned off for a message
  const screen = useOnScreen()
  const [useScreen, setUseScreen] = useState(true)
  useEffect(() => setUseScreen(true), [screen?.title, screen?.url])

  // Follow what the user is looking at
  useEffect(() => {
    setExplicitScope(null)
    if (isNote || isPdf) setChoice('note')
    else setChoice((c) => (c === 'note' ? 'vault' : c))
  }, [openPath, isNote, isPdf])

  const scope: ChatScope = useMemo(() => {
    if (explicitScope) return explicitScope
    if (choice === 'note' && openPath && (isNote || isPdf)) return { kind: 'note', path: openPath }
    if (choice === 'notebook' && notebook) return { kind: 'folder', path: notebook }
    if (choice === 'none') return { kind: 'none' }
    return { kind: 'vault' }
  }, [choice, explicitScope, openPath, isNote, isPdf, notebook])

  const scopeLabel =
    scope.kind === 'note'
      ? fileTitle(scope.path)
      : scope.kind === 'pages'
        ? pagesLabel(scope)
        : scope.kind === 'folder'
          ? scope.path.split('/').pop()
          : scope.kind === 'vault'
            ? 'All notes'
            : 'General chat'

  useEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [turns])

  const send = async (text: string, opts?: { attachment?: string; scope?: ChatScope; instructions?: string }) => {
    if (!opts?.attachment && climbLadder(text, app.setView)) return setInput('')
    const plan = !opts?.attachment ? learnIntent(text) : null
    if (plan) {
      setInput('')
      app.setView({ kind: 'new-topic', topic: plan.topic, goal: plan.goal, auto: true, nonce: Date.now() })
      return
    }
    const attach = opts?.attachment ?? attachment
    if (dock) setOpen(true)
    const now = useScreen ? screenNow() : null
    const sent = await convo.send(text, { attachment: attach, scope: opts?.scope ?? scope, instructions: opts?.instructions ?? instructionsRef.current, ...(now ? { onScreen: describeScreen(now) } : {}) })
    if (sent) {
      setInput('')
      setAttachment(undefined)
    }
  }

  // Requests coming from elsewhere: "Explain", "Summarize", "Ask about this notebook"
  useEffect(() => {
    if (!pendingAsk || pendingAsk.nonce === handledAsk) return
    handledAsk = pendingAsk.nonce
    if (dock) setOpen(true)
    if (pendingAsk.scope) setExplicitScope(pendingAsk.scope)
    instructionsRef.current = pendingAsk.instructions
    if (pendingAsk.text) send(pendingAsk.text, { attachment: pendingAsk.attachment, scope: pendingAsk.scope, instructions: pendingAsk.instructions })
    else {
      setAttachment(pendingAsk.attachment)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk?.nonce])

  const screenChip = screen && (
    <div className={`chat-screen${useScreen ? '' : ' off'}`}>
      <Icon name={screen.video ? 'video' : screen.kind === 'article' || screen.kind === 'web' ? 'globe' : 'course'} size={12} />
      <span className="chat-screen-text" title={useScreen ? 'The tutor sees this with your message' : 'Not sent with your message'}>
        {useScreen ? 'Sees ' : 'Not sending '}
        <b>{screenLabel(screen)}</b>
        {screen.video && !screenLabel(screen).includes(formatTime(screen.video.at)) ? ` · ${formatTime(screen.video.at)}` : ''}
      </span>
      <button className="icon-btn small" onClick={() => setUseScreen((u) => !u)} title={useScreen ? 'Don’t send what’s on screen' : 'Send what’s on screen'} aria-pressed={useScreen}>
        <Icon name={useScreen ? 'x' : 'plus'} size={11} />
      </button>
    </div>
  )

  if (dock) {
    return (
      <aside className={`chat chat-dock${open ? ' open' : ''}`} aria-label="Tutor">
        {open && (
          <header className="dock-head">
            <span className="dock-title">
              <Icon name="sparkle" size={13} /> Tutor
            </span>
            <span className="dock-gap" />
            {turns.length > 0 && (
              <button className="tool-btn" onClick={() => !busy && (convo.reset(), (instructionsRef.current = undefined))} title="Start a new conversation">
                New chat
              </button>
            )}
            <button className="icon-btn small" title="All conversations" onClick={() => app.setView({ kind: 'chat', id: turns.length ? convo.chatId : undefined })}>
              <Icon name="list" size={14} />
            </button>
            <button className="icon-btn small" title="Fold the tutor away (the conversation is kept)" onClick={() => setOpen(false)} aria-label="Fold the tutor away">
              <Icon name="arrowDown" size={14} />
            </button>
          </header>
        )}
        {open && turns.length > 0 && (
          <div className="chat-list dock-list" ref={listRef}>
            {turns.map((t, i) => (
              <TurnView key={t.id} turn={t} notePath={openPath ?? ''} showSummaryBreak={convo.summarized > 0 && i === convo.summarized} />
            ))}
          </div>
        )}
        <div className="dock-row">
          {screenChip}
          {!busy && (
            <span className="dock-quick">
              {!open && turns.length > 0 && (
                <button className="tool-btn" onClick={() => setOpen(true)}>
                  <Icon name="chat" size={12} /> {Math.ceil(turns.length / 2)} {turns.length > 2 ? 'answers' : 'answer'}
                </button>
              )}
              <button className="tool-btn" onClick={() => send('Explain this part to me.')}>
                Explain this
              </button>
              <button className="tool-btn" onClick={() => send('Quiz me on this: two or three short questions on what’s on my screen, one at a time. Mark each answer before the next.')}>
                Quiz me
              </button>
            </span>
          )}
        </div>
        <Composer value={input} onChange={setInput} onSend={() => send(input)} busy={busy} onStop={convo.stop} web={convo.web} onWeb={convo.setWeb} attachment={attachment} onClearAttachment={() => setAttachment(undefined)} inputRef={inputRef} />
      </aside>
    )
  }

  return (
    <aside className="chat" aria-label="AI tutor">
      <header className="chat-head drag">
        <div className="chat-title no-drag">
          <Icon name="sparkle" size={15} />
          <span>Tutor</span>
        </div>
        <div className="no-drag chat-head-actions">
          {turns.length > 0 && (
            <button
              className="tool-btn"
              onClick={() => {
                if (busy) return
                convo.reset()
                instructionsRef.current = undefined
              }}
              title="Start a new conversation"
            >
              New chat
            </button>
          )}
          <button className="icon-btn" title="All conversations" onClick={() => app.setView({ kind: 'chat', id: turns.length ? convo.chatId : undefined })}>
            <Icon name="list" />
          </button>
          <button className="icon-btn" title="Hide tutor (⌘J)" onClick={() => app.updateSettings({ chatOpen: false })}>
            <Icon name="panel" />
          </button>
        </div>
      </header>

      <div className="chat-scope">
        <span className="muted">Answering from</span>
        <select
          value={explicitScope ? 'explicit' : choice}
          onChange={(e) => {
            setExplicitScope(null)
            setChoice(e.target.value as ScopeChoice)
          }}
          aria-label="What the tutor answers from"
        >
          {explicitScope && <option value="explicit">{scopeLabel}</option>}
          {(isNote || isPdf) && <option value="note">This {isPdf ? 'PDF' : 'note'}</option>}
          {notebook && <option value="notebook">Notebook: {notebook}</option>}
          <option value="vault">All notes</option>
          <option value="none">Nothing, just chat</option>
        </select>
      </div>

      <div className="chat-list" ref={listRef}>
        {turns.length === 0 && screen && useScreen && (
          <div className="chat-empty">
            <p>
              Ask about <strong>{screen.course?.lesson ?? screen.title}</strong>. The tutor sees the section you’re on{screen.video ? ', the video’s moment and what’s said around it' : ''}, and anything you select.
            </p>
            <div className="suggestions">
              {['Explain this part to me.', 'Quiz me on this: two or three short questions on what’s on my screen, one at a time.', 'What should I take away from this?'].map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s.replace(/:.*$/, '')}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.length === 0 && !(screen && useScreen) && (
          <div className="chat-empty">
            <p>Ask anything about {scope.kind === 'none' ? 'any topic' : <strong>{scopeLabel}</strong>}. Answers cite your notes so you can check them.</p>
            <div className="suggestions">
              {SUGGESTIONS[scope.kind === 'note' || scope.kind === 'pages' ? 'note' : scope.kind === 'folder' ? 'notebook' : scope.kind === 'vault' ? 'vault' : 'none'].map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <TurnView key={t.id} turn={t} notePath={openPath ?? ''} showSummaryBreak={convo.summarized > 0 && i === convo.summarized} />
        ))}
      </div>

      {screenChip}
      <Composer
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        busy={busy}
        onStop={convo.stop}
        web={convo.web}
        onWeb={convo.setWeb}
        attachment={attachment}
        onClearAttachment={() => setAttachment(undefined)}
        inputRef={inputRef}
      />
    </aside>
  )
}
