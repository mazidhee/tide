import { learnIntent } from '@shared/learnIntent'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatScope } from '@shared/types'
import { fileTitle, useApp, pagesLabel } from '../state'
import { Icon } from './Icon'
import { Composer, TurnView, useConversation } from './Conversation'

type ScopeChoice = 'note' | 'notebook' | 'vault' | 'none'

const SUGGESTIONS: Record<ScopeChoice, string[]> = {
  note: ['Explain the key ideas simply', 'What should I memorize from this?', 'Give me 3 practice problems'],
  notebook: ['What does this notebook cover?', 'Which topics connect to each other?', 'Make me a study plan'],
  vault: ['What have I been studying lately?', 'Find notes about recursion', 'What are my weakest topics?'],
  none: ['Explain big-O like I’m new to it', 'Help me plan a study session']
}

/** The last request from elsewhere that was passed on, so the panel coming back on screen never sends it a second time */
let handledAsk: number | null = null

export function ChatPanel() {
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
    const plan = !opts?.attachment ? learnIntent(text) : null
    if (plan) {
      setInput('')
      app.setView({ kind: 'new-topic', topic: plan.topic, goal: plan.goal, auto: true, nonce: Date.now() })
      return
    }
    const attach = opts?.attachment ?? attachment
    const sent = await convo.send(text, { attachment: attach, scope: opts?.scope ?? scope, instructions: opts?.instructions ?? instructionsRef.current })
    if (sent) {
      setInput('')
      setAttachment(undefined)
    }
  }

  // Requests coming from elsewhere: "Explain", "Summarize", "Ask about this notebook"
  useEffect(() => {
    if (!pendingAsk || pendingAsk.nonce === handledAsk) return
    handledAsk = pendingAsk.nonce
    if (pendingAsk.scope) setExplicitScope(pendingAsk.scope)
    instructionsRef.current = pendingAsk.instructions
    if (pendingAsk.text) send(pendingAsk.text, { attachment: pendingAsk.attachment, scope: pendingAsk.scope, instructions: pendingAsk.instructions })
    else {
      setAttachment(pendingAsk.attachment)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk?.nonce])

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
        {turns.length === 0 && (
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
