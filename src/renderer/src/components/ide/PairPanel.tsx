import { useEffect, useMemo, useRef, useState } from 'react'
import type { BugHunt, PairEvent, PairMode, PairStatus, Proposal } from '@shared/ide'
import { useApp } from '../../state'
import { renderMarkdown } from '../../lib/markdown'
import { Icon } from '../Icon'

interface Msg {
  id: number
  role: 'you' | 'claude'
  text: string
  tools: string[]
  error?: string
  done?: boolean
  ms?: number
}

const MODES: { id: PairMode; label: string; hint: string; starters: string[] }[] = [
  { id: 'ask', label: 'Ask', hint: 'Questions about this project, answered from its code', starters: ['How does this project fit together?', 'Explain the file I have open', 'Why does this fail?'] },
  { id: 'build', label: 'Build together', hint: 'Plan a feature; you write it, Claude explains and proposes the boilerplate', starters: ['Let’s add a feature: ', 'Write tests for the file I have open', 'Help me refactor this'] },
  { id: 'review', label: 'Review my changes', hint: 'Your uncommitted changes, reviewed like a pull request, with comments in the editor', starters: ['Review my changes'] },
  { id: 'bughunt', label: 'Find the bug', hint: 'Claude plants one bug in a copy of the project; you hunt it down', starters: ['Plant a bug for me to find'] }
]

const newSession = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Claude as a pair programmer, in the inspector. Claude works on the project only through Tide's
 * tools (main/ide/pair): its edits come back as proposals, shown as diffs in the editor to keep or
 * undo; review comments appear under their lines; a bug hunt runs in a copy. Without Claude, it
 * says why and points to the tutor, and the rest of the IDE works as before.
 */
export function PairPanel({
  status,
  root,
  rootKind,
  activePath,
  selection,
  proposals,
  onOpenProposal,
  onRetry,
  onOpenHunt,
  pending,
  clearPending
}: {
  status: PairStatus | null
  root: string | null
  rootKind: string | null
  activePath: string | null
  selection: string
  proposals: Proposal[]
  onOpenProposal(p: Proposal): void
  onRetry(): void
  onOpenHunt(h: BugHunt): void
  /** A message to send from elsewhere (Review my changes, Explain in Quick Help) */
  pending: { mode: PairMode; text: string; nonce: number } | null
  clearPending(): void
}) {
  const app = useApp()
  const [mode, setMode] = useState<PairMode>(() => (localStorage.getItem('tide.ide.pairMode') as PairMode) || 'ask')
  const [session, setSession] = useState(newSession)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoEdit, setAutoEdit] = useState(false)
  const [hunt, setHunt] = useState<BugHunt | null>(null)
  const [answer, setAnswer] = useState<BugHunt | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const env = useMemo(() => ({ notePath: '', filesByName: app.filesByName }), [app.filesByName])
  const isHunt = rootKind === 'bughunt'

  useEffect(() => localStorage.setItem('tide.ide.pairMode', mode), [mode])
  useEffect(() => {
    if (root) window.tide.ide.pair.autoEdit(root).then(setAutoEdit).catch(() => {})
    if (root && isHunt) window.tide.ide.pair.hunts().then((h) => setHunt(h.find((x) => x.root === root) ?? null)).catch(() => {})
    else setHunt(null)
    setAnswer(null)
  }, [root, isHunt])
  // A bug hunt's copy talks in bug hunt mode
  useEffect(() => {
    if (isHunt) setMode('bughunt')
  }, [isHunt])
  // A new project or mode is a new conversation
  useEffect(() => {
    setSession((s) => {
      void window.tide.ide.pair.end(s)
      return newSession()
    })
    setMsgs([])
  }, [root, mode])
  useEffect(() => () => void window.tide.ide.pair.end(session), [session])

  useEffect(
    () =>
      window.tide.ide.pair.onEvent((e: PairEvent) => {
        if (e.session !== session) return
        setMsgs((ms) => {
          const last = ms[ms.length - 1]
          if (!last || last.role !== 'claude' || last.done) return ms
          const upd = (m: Partial<Msg>) => [...ms.slice(0, -1), { ...last, ...m }]
          if (e.type === 'delta') return upd({ text: last.text + e.text })
          if (e.type === 'tool') return upd({ tools: [...last.tools, e.label] })
          if (e.type === 'done') return upd({ done: true, ms: e.ms })
          if (e.type === 'error') return upd({ done: true, error: e.message })
          return ms
        })
        if (e.type === 'done' || e.type === 'error') setBusy(false)
      }),
    [session]
  )
  useEffect(() => {
    const el = list.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight
  }, [msgs])

  const send = async (text: string, as: PairMode = mode) => {
    if (!root || !text.trim() || busy) return
    const id = ++seq.current
    setMsgs((ms) => [...ms, { id, role: 'you', text: text.trim(), tools: [], done: true }, { id: id + 0.5, role: 'claude', text: '', tools: [] }])
    setInput('')
    setBusy(true)
    try {
      await window.tide.ide.pair.send({ session, root, mode: as, text: text.trim(), activePath: activePath ?? undefined, selection: selection || undefined })
    } catch (e) {
      setMsgs((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, done: true, error: clean(e) } : m)))
      setBusy(false)
    }
  }

  // Sent from elsewhere: switch mode first (a new conversation), then send
  useEffect(() => {
    if (!pending || !status?.ready) return
    if (pending.mode !== mode) {
      setMode(pending.mode)
      return
    }
    clearPending()
    void send(pending.text, pending.mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, mode, session, status])

  if (!status) return <div className="ix-pair"><p className="ix-empty-note">Checking for Claude…</p></div>
  if (!status.ready)
    return (
      <div className="ix-pair">
        <div className="ix-pair-off">
          <Icon name="claude" size={20} />
          <p className="ix-pair-off-title">Claude isn’t available</p>
          <p className="ix-empty-note">{status.installed ? `Claude Code is installed, but ${status.why ?? 'not ready'}.` : 'Claude Code isn’t installed on this Mac.'} Everything else in the IDE works without it, and the Tutor tab can help with your code on this Mac.</p>
          <button className="btn small" onClick={onRetry}>
            Check again
          </button>
        </div>
      </div>
    )

  const m = MODES.find((x) => x.id === mode)!
  const mine = proposals.filter((p) => p.root === root)

  const startHunt = async () => {
    if (!root) return
    try {
      const h = await window.tide.ide.pair.bugHunt(root)
      onOpenHunt(h)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
  }

  return (
    <div className="ix-pair">
      <div className="ix-pair-modes" role="tablist" aria-label="How to pair">
        {MODES.filter((x) => !isHunt || x.id === 'bughunt').map((x) => (
          <button key={x.id} className={x.id === mode ? 'on' : ''} onClick={() => setMode(x.id)} role="tab" aria-selected={x.id === mode} title={x.hint}>
            {x.label}
          </button>
        ))}
      </div>
      {mine.length > 0 && (
        <div className="ix-pair-proposals">
          {mine.map((p) => (
            <button key={p.id} className="ix-pair-proposal" onClick={() => onOpenProposal(p)}>
              <Icon name="diff" size={13} />
              <span>
                Proposed change to <b>{p.path}</b>
              </span>
              <span className="ix-row-dir">Review</span>
            </button>
          ))}
        </div>
      )}
      <div className="ix-pair-thread" ref={list}>
        {!msgs.length && (
          <div className="ix-pair-welcome">
            <p className="ix-pair-hint">{m.hint}.</p>
            {mode === 'bughunt' && !isHunt ? (
              <>
                <p className="ix-empty-note">Tide copies this project, Claude plants one realistic bug in the copy, and you find it with the tests, the debugger and reading. Your project isn’t touched.</p>
                <button className="btn small primary" onClick={startHunt}>
                  Start a bug hunt
                </button>
              </>
            ) : (
              <div className="ix-pair-starters">
                {m.starters.map((s) => (
                  <button key={s} className="pill" onClick={() => (s.endsWith(': ') ? setInput(s) : void send(s))}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {msgs.map((x) =>
          x.role === 'you' ? (
            <div key={x.id} className="ix-pair-you">
              {x.text}
            </div>
          ) : (
            <div key={x.id} className="ix-pair-claude">
              {x.tools.length > 0 && (
                <ul className="ix-pair-tools">
                  {x.tools.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
              {x.text ? <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(x.text, env) }} /> : !x.done && <span className="ix-pair-thinking">Thinking…</span>}
              {x.error && <p className="ix-pair-error">{x.error}</p>}
              {x.done && x.ms ? <p className="ix-pair-meta">{(x.ms / 1000).toFixed(1)} s</p> : null}
            </div>
          )
        )}
        {isHunt && hunt && (
          <div className="ix-pair-hunt">
            {answer?.answer?.length ? (
              <>
                <p className="ix-pair-hint">The bug Claude planted:</p>
                {answer.answer.map((a) => (
                  <div key={a.path}>
                    <p className="ix-empty-note">{a.explanation}</p>
                    <pre className="ix-pair-diff">{a.diff}</pre>
                  </div>
                ))}
              </>
            ) : (
              <button className="ix-link small" disabled={!hunt.planted && !msgs.length} onClick={() => window.tide.ide.pair.reveal(hunt.id).then(setAnswer).catch((e) => app.toast(clean(e), { tone: 'error' }))}>
                I give up: show me the bug
              </button>
            )}
          </div>
        )}
      </div>
      <form
        className="ix-pair-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mode === 'review' ? 'Ask for a review, or about a comment' : mode === 'bughunt' ? 'Say what you think the bug is' : 'Ask Claude about your code'}
          rows={Math.min(6, Math.max(2, input.split('\n').length))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
          aria-label="Message to Claude"
        />
        <div className="ix-pair-composer-row">
          {!isHunt && (
            <label className="ix-pair-auto" title="Claude writes its edits straight to this project, without a diff to approve">
              <input type="checkbox" checked={autoEdit} onChange={(e) => root && window.tide.ide.pair.autoEdit(root, e.target.checked).then(setAutoEdit)} />
              Let Claude edit
            </label>
          )}
          {selection && <span className="ix-row-dir">Sends your selection</span>}
          <span className="ix-gap" />
          {busy ? (
            <button type="button" className="btn small" onClick={() => void window.tide.ide.pair.stop(session)}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn small primary" disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
