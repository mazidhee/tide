import { Professor } from './Professor'
import { learnIntent, projectIntent } from '@shared/learnIntent'
import { startProject } from '../lib/projects'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatScope, ChatSummary, Memory, NotebookMeta } from '@shared/types'
import { useApp } from '../state'
import { Icon, type IconName } from './Icon'
import { ContextMenu, type MenuState } from './Menu'
import { Composer, TurnView, useConversation } from './Conversation'
import { TalkControls, useTalk } from './Voice'

const DAY = 86_400_000

function groupOf(t: number, now = Date.now()): string {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  if (t >= today) return 'Today'
  if (t >= today - DAY) return 'Yesterday'
  if (t >= today - 6 * DAY) return 'Previous 7 days'
  if (t >= today - 29 * DAY) return 'Previous 30 days'
  return new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

const scopeKey = (s: ChatScope) => (s.kind === 'folder' ? `folder:${s.path}` : s.kind === 'note' || s.kind === 'pages' ? `note:${s.path}` : s.kind)

const STARTERS: { text: string; icon: IconName }[] = [
  { text: 'Explain a hard idea from my notes simply', icon: 'tutor' },
  { text: 'Quiz me on what I studied this week', icon: 'quiz' },
  { text: 'Help me plan what to learn next', icon: 'list' },
  { text: 'What do you remember about me?', icon: 'book' }
]

/** All conversations with the tutor: history on the left, the conversation on the right */
export function ChatPage({ id }: { id?: string }) {
  const app = useApp()
  const convo = useConversation()
  const lastReply = [...convo.turns].reverse().find((t) => t.role === 'assistant')
  const sendRef = useRef<(text: string) => void>(() => {})
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [query, setQuery] = useState('')
  const [input, setInput] = useState('')
  const [scope, setScope] = useState<ChatScope>({ kind: 'vault' })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const voice = useTalk(lastReply ? { key: lastReply.id, content: lastReply.content, streaming: !!lastReply.streaming } : null, (said) => sendRef.current(said), 'path' in scope ? { path: scope.path } : undefined, { box: inputRef, submit: () => sendRef.current(inputRef.current?.value ?? '') })
  const [notebooks, setNotebooks] = useState<NotebookMeta[]>([])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryCount, setMemoryCount] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(() => {
    try {
      return localStorage.getItem('tide.chat.history') !== 'closed'
    } catch {
      return true
    }
  })
  // ⌘J hides and shows the tutor panel elsewhere; here it does the same for the history panel
  useEffect(
    () =>
      window.tideEvents.onMenu((action) => {
        if (action === 'toggle-chat') setHistoryOpen((o) => {
          try {
            localStorage.setItem('tide.chat.history', o ? 'closed' : 'open')
          } catch {
            // remembered for this session only
          }
          return !o
        })
      }),
    []
  )
  const toggleHistory = (open: boolean) => {
    setHistoryOpen(open)
    try {
      localStorage.setItem('tide.chat.history', open ? 'open' : 'closed')
    } catch {
      // remembered for this session only
    }
  }
  const listRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    window.tide.chats.list().then(setChats).catch(() => {})
    window.tide.memory.list().then((l) => setMemoryCount(l.length)).catch(() => {})
  }, [])
  useEffect(() => {
    refresh()
    window.tide.learn.notebooks().then((n) => setNotebooks(n.filter((x) => x.path !== app.settings.libraryFolder))).catch(() => {})
  }, [refresh, app.settings.libraryFolder])
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = window.tide.chats.onChanged(() => {
      clearTimeout(t)
      t = setTimeout(refresh, 150)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [refresh])

  // Open the conversation named in the view (from the tutor panel's history button)
  useEffect(() => {
    if (!id || id === convo.chatId) return
    convo.load(id).then((ok) => {
      if (!ok) return
      const c = chats.find((x) => x.id === id)
      if (c) setScope(c.scope)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight
  }, [convo.turns])

  useEffect(() => {
    inputRef.current?.focus()
  }, [convo.chatId])

  const open = async (c: ChatSummary) => {
    if (convo.busy) return app.toast('Wait for the answer to finish first.')
    if (await convo.load(c.id)) setScope(c.scope)
  }

  const fresh = () => {
    if (convo.busy) return
    convo.reset()
    setInput('')
    setScope({ kind: 'vault' })
  }

  const send = async (text = input) => {
    const build = projectIntent(text)
    if (build) {
      setInput('')
      return startProject(app, build)
    }
    const plan = learnIntent(text)
    if (plan) {
      setInput('')
      app.setView({ kind: 'new-topic', topic: plan.topic, goal: plan.goal, auto: true, nonce: Date.now() })
      return
    }
    if (await convo.send(text, { scope, voice: voice.talk ? (app.settings.character ?? 'professor') : undefined })) setInput('')
  }

  sendRef.current = (t) => void send(t)
  const q = query.trim().toLowerCase()
  const visible = q ? chats.filter((c) => `${c.title} ${c.preview}`.toLowerCase().includes(q)) : chats
  const groups = useMemo(() => {
    const out: { label: string; items: ChatSummary[] }[] = []
    for (const c of visible) {
      const label = c.pinned ? 'Pinned' : groupOf(c.updatedAt)
      const g = out.find((x) => x.label === label)
      if (g) g.items.push(c)
      else out.push({ label, items: [c] })
    }
    return out
  }, [visible])

  const current = chats.find((c) => c.id === convo.chatId)

  const chatMenu = (c: ChatSummary, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: 'Rename', run: () => setRenaming(c.id) },
        { label: c.pinned ? 'Unpin' : 'Pin to top', run: async () => (await window.tide.chats.pin(c.id, !c.pinned), refresh()) },
        {
          label: 'Delete conversation',
          danger: true,
          separatorBefore: true,
          run: async () => {
            if (!window.confirm(`Delete “${c.title}”? This can't be undone.`)) return
            await window.tide.chats.remove(c.id)
            if (c.id === convo.chatId) fresh()
            refresh()
          }
        }
      ]
    })

  const scopeValue = scopeKey(scope)
  const scopeOptions: { key: string; label: string; scope: ChatScope }[] = [
    { key: 'vault', label: 'All my notes', scope: { kind: 'vault' } },
    ...notebooks.map((n) => ({ key: `folder:${n.path}`, label: n.name, scope: { kind: 'folder', path: n.path } as ChatScope })),
    { key: 'none', label: 'Nothing, just chat', scope: { kind: 'none' } }
  ]
  if (!scopeOptions.some((o) => o.key === scopeValue)) scopeOptions.unshift({ key: scopeValue, label: scope.kind === 'note' || scope.kind === 'pages' ? scope.path.split('/').pop()!.replace(/\.(md|pdf)$/i, '') : 'Earlier scope', scope })

  const [atBottom, setAtBottom] = useState(true)
  const onScroll = () => {
    const el = listRef.current
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }
  const toBottom = () => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })

  const scopePicker = (
    <label className="pill select" title="What the tutor answers from">
      <Icon name={scope.kind === 'none' ? 'chat' : scope.kind === 'folder' ? 'folder' : 'book'} size={13} />
      <select
        value={scopeValue}
        onChange={(e) => {
          const o = scopeOptions.find((x) => x.key === e.target.value)
          if (o) setScope(o.scope)
        }}
        aria-label="Answer from"
      >
        {scopeOptions.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={11} className="pill-caret" />
    </label>
  )

  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSend={() => send()}
      busy={convo.busy}
      onStop={convo.stop}
      web={convo.web}
      onWeb={convo.setWeb}
      inputRef={inputRef}
      large
      placeholder={convo.turns.length ? 'Reply to your tutor' : 'Ask anything, or say what you want to learn'}
      tools={
        <>
          {scopePicker}
          <TalkControls voice={voice} onText={(said) => send(said)} where={'path' in scope ? { path: scope.path } : undefined} target={inputRef} />
        </>
      }
    />
  )

  const empty = convo.turns.length === 0 && !convo.loading

  return (
    <div className={`chat-page${historyOpen ? ' with-history' : ''}`}>

      <section className={`cp-main${empty ? ' empty' : ''}`}>
        <header className="cp-head drag">
          {!empty && current && (
            <button
              className="cp-title-btn no-drag"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                chatMenu(current, r.left, r.bottom + 4)
              }}
            >
              <span>{current.title}</span>
              <Icon name="chevron" size={12} className="pill-caret" />
            </button>
          )}
          <div className="cp-head-actions no-drag">
            <button className="icon-btn" title="New chat" aria-label="New chat" onClick={fresh} disabled={convo.busy}>
              <Icon name="compose" size={16} />
            </button>
            {!historyOpen && (
              <button className="icon-btn" title="Show history (⌘J)" aria-label="Show history" onClick={() => toggleHistory(true)}>
                <Icon name="panel" size={16} />
              </button>
            )}
          </div>
        </header>

        {empty ? (
          <div className="cp-hero">
            <TideHero />
            <h2>What are we learning today?</h2>
            <div className="cp-hero-composer">{composer}</div>
            <div className="cp-starters">
              {STARTERS.map((st) => (
                <button key={st.text} onClick={() => send(st.text)}>
                  <Icon name={st.icon} size={14} />
                  <span>{st.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="cp-scroll" ref={listRef} onScroll={onScroll}>
              <div className="cp-thread">
                {convo.turns.map((t, i) => (
                  <TurnView key={t.id} turn={t} showSummaryBreak={convo.summarized > 0 && i === convo.summarized} />
                ))}
              </div>
            </div>
            <div className="cp-dock">
              {!atBottom && (
                <button className="cp-jump" onClick={toBottom} title="Jump to the latest message" aria-label="Jump to the latest message">
                  <Icon name="arrowDown" size={15} />
                </button>
              )}
              {composer}
              <p className="cp-note">Check important answers against the sources.</p>
            </div>
          </>
        )}
      </section>

      {historyOpen && (
      <aside className="cp-side no-drag" aria-label="Conversations">
          {/* no-drag: this sits under the window's title-bar strip, which would otherwise eat clicks */}
        <div className="cp-side-head no-drag">
            <span>History</span>
            <button className="icon-btn small" title="Hide history (⌘J)" aria-label="Hide history" onClick={() => toggleHistory(false)}>
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="cp-search">
            <Icon name="search" size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search conversations" />
          </div>
          <div className="cp-list">
            {groups.map((g) => (
              <section key={g.label}>
                <p className="cp-group">{g.label}</p>
                {g.items.map((c) =>
                  renaming === c.id ? (
                    <form
                      key={c.id}
                      className="cp-rename"
                      onSubmit={async (e) => {
                        e.preventDefault()
                        const v = new FormData(e.currentTarget).get('title') as string
                        if (v.trim()) await window.tide.chats.rename(c.id, v)
                        setRenaming(null)
                        refresh()
                      }}
                    >
                      <input name="title" defaultValue={c.title} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} aria-label="Conversation title" />
                    </form>
                  ) : (
                    <div key={c.id} className={`cp-row${c.id === convo.chatId && convo.turns.length ? ' on' : ''}`} onContextMenu={(e) => (e.preventDefault(), chatMenu(c, e.clientX, e.clientY))}>
                      <button className="cp-open" onClick={() => open(c)} onDoubleClick={() => setRenaming(c.id)} title={c.preview || c.title}>
                        <span className="cp-title">{c.title}</span>
                      </button>
                      <button
                        className="cp-more"
                        title="More"
                        aria-label={`More for ${c.title}`}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect()
                          chatMenu(c, r.left, r.bottom + 4)
                        }}
                      >
                        <Icon name="more" size={14} />
                      </button>
                    </div>
                  )
                )}
              </section>
            ))}
            {!chats.length && <p className="cp-empty">No chats yet.</p>}
            {chats.length > 0 && !visible.length && <p className="cp-empty">No chat matches “{query.trim()}”.</p>}
          </div>
          <button className="cp-memory-btn" onClick={() => setMemoryOpen(true)}>
            <Icon name="book" size={15} />
            <span>Memory</span>
            {memoryCount > 0 && <span className="cp-count">{memoryCount}</span>}
          </button>
        </aside>
      )}

      {memoryOpen && (
        <MemoryDrawer
          onClose={() => {
            setMemoryOpen(false)
            window.tide.memory.list().then((l) => setMemoryCount(l.length))
          }}
        />
      )}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

/** The empty-state mark: the professor, idling until you ask something */
function TideHero() {
  return (
    <span className="cp-hero-mark professor-hero" aria-hidden="true">
      <Professor state="idle" size={84} />
    </span>
  )
}

/** Everything the tutor remembers, to read, correct, add to or remove */
function MemoryDrawer({ onClose }: { onClose(): void }) {
  const app = useApp()
  const [items, setItems] = useState<Memory[] | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const load = useCallback(() => window.tide.memory.list().then((l) => setItems([...l].sort((a, b) => b.updatedAt - a.updatedAt))), [])
  useEffect(() => {
    load()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [load, onClose])
  const fail = (e: unknown) => app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="memory-drawer" role="dialog" aria-label="What Tide remembers">
        <header>
          <h2>What Tide remembers</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" size={15} />
          </button>
        </header>
        <p className="muted small">
          Things the tutor knows about you, used in every chat.
        </p>
        <form
          className="memory-add"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!draft.trim()) return
            try {
              const r = await window.tide.memory.add(draft)
              if (r.duplicate) app.toast('Tide already remembers that.')
              setDraft('')
              load()
            } catch (err) {
              fail(err)
            }
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="E.g. Preparing for Bloomberg interviews by March" maxLength={240} aria-label="Something to remember" />
          <button className="btn small primary" disabled={!draft.trim()}>
            Add
          </button>
        </form>
        <ul className="memory-list">
          {items?.map((m) => (
            <li key={m.id}>
              {editing === m.id ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    await window.tide.memory.update(m.id, new FormData(e.currentTarget).get('text') as string).catch(fail)
                    setEditing(null)
                    load()
                  }}
                >
                  <input name="text" defaultValue={m.text} autoFocus maxLength={240} onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} aria-label="Edit memory" />
                </form>
              ) : (
                <>
                  <button className="memory-text" onClick={() => setEditing(m.id)} title="Click to edit">
                    {m.text}
                  </button>
                  <span className="memory-date">{new Date(m.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                  <button
                    className="icon-btn small"
                    title="Forget this"
                    onClick={async () => {
                      await window.tide.memory.remove(m.id).catch(fail)
                      load()
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
          {items && !items.length && <li className="muted small memory-empty">Nothing yet.</li>}
        </ul>
      </aside>
    </>
  )
}
