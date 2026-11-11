import { splitSay } from '@shared/characters'
import { CHAT_IMAGES, pastedImageFiles, savePastedImage } from '../lib/pastedImages'
import { imageRefs } from '@shared/noteImages'
import { Thinking } from './Thinking'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { AgentStep, ChatScope, ContextSource, StoredMessage } from '@shared/types'
import { asksForWeb } from '@shared/modelText'
import { useApp } from '../state'
import { renderMarkdown, resolveRelative, vaultUrl } from '../lib/markdown'
import { Icon } from './Icon'
import { chatEngine, EnginePill } from './EnginePill'
import { Professor, type ProfessorState } from './Professor'
import { SpeakButton } from './Voice'

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachment?: string
  sources?: ContextSource[]
  steps?: AgentStep[]
  error?: string
  streaming?: boolean
}

const STEP_ICON: Record<AgentStep['kind'], 'search' | 'note' | 'globe' | 'external' | 'agents' | 'sparkle' | 'terminal' | 'book' | 'canvas'> = {
  canvas: 'canvas',
  search_notes: 'search',
  metabase: 'search',
  read_note: 'note',
  web_search: 'globe',
  read_webpage: 'external',
  delegate: 'agents',
  helper: 'sparkle',
  run_code: 'terminal',
  run_sql: 'terminal',
  load_table: 'terminal',
  remember: 'book',
  terminal: 'terminal'
}

/** One line describing what the tutor did, e.g. "Searched the web twice, read 1 page, used 2 helpers" */
function summarizeSteps(steps: AgentStep[]): string {
  const count = (k: AgentStep['kind']) => steps.filter((s) => s.kind === k).length
  const times = (n: number) => (n === 1 ? '' : n === 2 ? ' twice' : ` ${n} times`)
  const remembered = steps.filter((s) => s.kind === 'remember' && s.label.startsWith('Remembering')).length
  const parts = [
    count('search_notes') && `searched your notes${times(count('search_notes'))}`,
    count('read_note') && `read ${count('read_note')} note${count('read_note') === 1 ? '' : 's'}`,
    count('web_search') && `searched the web${times(count('web_search'))}`,
    count('metabase') && `looked in Metabase${times(count('metabase'))}`,
    count('read_webpage') && `read ${count('read_webpage')} page${count('read_webpage') === 1 ? '' : 's'}`,
    count('run_code') && `ran code${times(count('run_code'))}`,
    count('run_sql') && `ran SQL${times(count('run_sql'))}`,
    count('load_table') && `loaded ${count('load_table') === 1 ? 'a file' : `${count('load_table')} files`} into the lab`,
    count('terminal') && `used the terminal${times(count('terminal'))}`,
    count('helper') && `used ${count('helper')} helpers`,
    remembered && `remembered ${remembered === 1 ? 'something' : `${remembered} things`} about you`
  ].filter(Boolean) as string[]
  const s = parts.join(', ')
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const uid = () => Math.random().toString(36).slice(2)

/** Turns [1] citations in rendered answer HTML into buttons, skipping code. */
function linkCitations(html: string, count: number): string {
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : // Handles [2] as well as grouped citations like [2, 4]
          part.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?![^<]*>)/g, (m, group: string) => {
            const nums = group.split(',').map((n) => Number(n.trim()))
            if (!nums.every((n) => n >= 1 && n <= count)) return m
            return nums.map((n) => `<button class="cite" data-cite="${n}" type="button">${n}</button>`).join('')
          })
    )
    .join('')
}

const toTurn = (m: StoredMessage): Turn => ({ id: m.id, role: m.role, content: m.content, attachment: m.attachment, sources: m.sources, steps: m.steps, error: m.error })

export interface SendOptions {
  attachment?: string
  /** Talk is on: ask for a short spoken reply first, in this character's way */
  voice?: import('@shared/characters').CharacterId
  scope: ChatScope
  instructions?: string
  /** A terminal the tutor can see (and in the Linux lab, use) */
  terminalId?: string
  /** A system design canvas the tutor can read and draw on */
  canvasPath?: string
}

/**
 * A stored conversation: its turns, streaming updates, and sending. The main process saves every
 * exchange, so this only keeps what's on screen.
 */
/** Which conversation each turn on screen belongs to, so a query in it runs on that conversation's data lab */
const turnLab = new Map<string, string>()

export function useConversation() {
  const [chatId, setChatId] = useState(newChatId)
  const [turns, setTurns] = useState<Turn[]>([])
  const [summarized, setSummarized] = useState(0)
  const [loading, setLoading] = useState(false)
  const [web, setWebState] = useState(() => localStorage.getItem('tide.chat.web') !== 'off')
  const activeId = useRef<string | null>(null)
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId
  // Each turn's data lab is its conversation's: TurnView reads it from here (see lib/lab.ts)
  if (turnLab.size > 4000) turnLab.clear()
  for (const t of turns) turnLab.set(t.id, chatId)

  const setWeb = useCallback((on: boolean) => {
    setWebState(on)
    localStorage.setItem('tide.chat.web', on ? 'on' : 'off')
  }, [])

  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        setTurns((list) =>
          list.map((t) => {
            if (t.id !== e.id) return t
            if (e.type === 'sources') return { ...t, sources: e.sources }
            if (e.type === 'step') {
              const steps = [...(t.steps ?? [])]
              const at = steps.findIndex((s) => s.id === e.step.id)
              if (at >= 0) steps[at] = { ...steps[at], ...e.step }
              else steps.push(e.step)
              return { ...t, steps }
            }
            if (e.type === 'delta') return { ...t, content: t.content + e.text }
            if (e.type === 'reset') return { ...t, content: '' }
            if (e.type === 'error') return { ...t, error: e.message, streaming: false }
            return { ...t, streaming: false }
          })
        )
        if ((e.type === 'done' || e.type === 'error') && e.id === activeId.current) activeId.current = null
      }),
    []
  )

  // A compaction finishing elsewhere moves the "summarized" marker
  useEffect(
    () =>
      window.tide.chats.onChanged((id) => {
        if (id !== chatIdRef.current || activeId.current) return
        window.tide.chats.get(id).then((c) => c && setSummarized(c.summarizedUpTo))
      }),
    []
  )

  const load = useCallback(async (id: string) => {
    if (activeId.current) return false
    setLoading(true)
    try {
      const c = await window.tide.chats.get(id)
      if (!c) return false
      setChatId(c.id)
      setTurns(c.messages.map(toTurn))
      setSummarized(c.summarizedUpTo)
      return true
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    if (activeId.current) return
    setChatId(newChatId())
    setTurns([])
    setSummarized(0)
  }, [])

  const send = useCallback(
    async (text: string, opts: SendOptions) => {
      const content = text.trim()
      if ((!content && !opts.attachment) || activeId.current) return false
      const question = content || 'Explain this.'
      const userTurn: Turn = { id: uid(), role: 'user', content: question, attachment: opts.attachment }
      const reply: Turn = { id: uid(), role: 'assistant', content: '', streaming: true }
      setTurns((l) => [...l, userTurn, reply])
      activeId.current = reply.id
      // Asking to look something up online switches web search on, rather than getting a refusal
      const useWeb = web || asksForWeb(question)
      if (useWeb && !web) setWeb(true)
      try {
        await window.tide.ai.chat({
          id: reply.id,
          chatId: chatIdRef.current,
          messages: [{ role: 'user', content: question }],
          scope: opts.scope,
          attachment: opts.attachment,
          instructions: opts.instructions,
          terminalId: opts.terminalId,
          canvasPath: opts.canvasPath,
          voice: opts.voice,
          web: useWeb,
          engine: chatEngine()
        })
      } catch (e) {
        activeId.current = null
        setTurns((l) => l.map((t) => (t.id === reply.id ? { ...t, streaming: false, error: (e as Error).message } : t)))
      }
      return true
    },
    [web, setWeb]
  )

  const stop = useCallback(() => {
    if (activeId.current) window.tide.ai.cancel(activeId.current)
  }, [])

  const busy = turns.some((t) => t.streaming)
  return { chatId, turns, summarized, loading, busy, web, setWeb, load, reset, send, stop }
}

/** The professor beside each answer, acting out what the tutor is doing right now */
function TideMark({ turn }: { turn: Turn }) {
  const running = turn.steps?.find((s) => s.status === 'running')
  const state: ProfessorState = !turn.streaming
    ? 'idle'
    : running && /search|read|web|related|canvas|terminal/.test(running.kind)
      ? 'reading'
      : turn.content
        ? 'writing'
        : 'thinking'
  return (
    <span className="msg-avatar professor-avatar" aria-hidden="true">
      <Professor state={state} size={30} />
    </span>
  )
}

function StepIcon({ step }: { step: AgentStep }) {
  if (step.status === 'running') return <span className="spinner" />
  return <Icon name={step.status === 'error' ? 'x' : STEP_ICON[step.kind] ?? 'sparkle'} size={13} />
}

/** What the tutor is doing: one live line while it works, a quiet summary you can open afterwards */
function WorkLog({ steps, streaming, answered }: { steps: AgentStep[]; streaming?: boolean; answered: boolean }) {
  const running = [...steps].reverse().find((s) => s.status === 'running')
  if (streaming && !answered) {
    const live = running ?? steps[steps.length - 1]
    return (
      <div className="msg-live" aria-live="polite">
        <StepIcon step={live} />
        <span>{live.label}</span>
        {steps.length > 1 && <span className="msg-live-count">step {steps.length}</span>}
      </div>
    )
  }
  return (
    <details className="msg-work">
      <summary>
        <span>{summarizeSteps(steps) || 'Worked on it'}</span>
        <Icon name="chevron" size={12} />
      </summary>
      <ol>
        {steps.map((s) => (
          <li key={s.id} className={`${s.status}${s.depth ? ' nested' : ''}`}>
            <StepIcon step={s} />
            <span className="msg-step-label">{s.label}</span>
            {s.detail && <span className="msg-step-detail">{s.detail}</span>}
          </li>
        ))}
      </ol>
    </details>
  )
}

/** Sources as chips, one per document or page, carrying every citation number that points to it */
function Sources({ sources }: { sources: ContextSource[] }) {
  const app = useApp()
  const [all, setAll] = useState(false)
  const groups: { key: string; first: ContextSource; nums: number[]; where: string[] }[] = []
  for (const s of sources) {
    const key = s.url ?? s.path
    const g = groups.find((x) => x.key === key)
    if (g) {
      g.nums.push(s.index)
      if (s.heading && !g.where.includes(s.heading)) g.where.push(s.heading)
    } else groups.push({ key, first: s, nums: [s.index], where: s.heading ? [s.heading] : [] })
  }
  const shown = all ? groups : groups.slice(0, 4)
  const whereLabel = (g: (typeof groups)[number]) => {
    if (g.first.url) return hostOf(g.first.url)
    const pages = g.where.map((w) => w.match(/^Page (\d+)$/)?.[1]).filter(Boolean)
    if (pages.length === g.where.length && pages.length) return pages.length === 1 ? `p. ${pages[0]}` : `${pages.length} pages`
    return g.where.length === 1 ? g.where[0] : g.where.length ? `${g.where.length} sections` : ''
  }
  return (
    <div className="msg-sources" aria-label="Sources">
      {shown.map((g) => (
        <button
          key={g.key}
          className="source-chip"
          title={g.first.url ?? [g.first.title, ...g.where].join(' · ')}
          onClick={() => (g.first.url ? window.tide.app.openExternal(g.first.url) : app.openPath(g.first.path, g.first.heading))}
        >
          <span className="source-num">{g.nums.join(', ')}</span>
          <Icon name={g.first.url ? 'globe' : /\.pdf$/i.test(g.first.path) ? 'pdf' : 'note'} size={12} />
          <span className="source-title">{g.first.title.replace(/\.pdf$/i, '')}</span>
          <span className="source-where">{whereLabel(g)}</span>
        </button>
      ))}
      {groups.length > 4 && (
        <button className="source-chip more" onClick={() => setAll((v) => !v)}>
          {all ? 'Fewer' : `+${groups.length - 4} more`}
        </button>
      )}
    </div>
  )
}

/** One message: the user's question, or the tutor's answer with its work, sources and actions */
export function TurnView({
  turn: t,
  notePath,
  showSummaryBreak,
  codeAction
}: {
  turn: Turn
  notePath?: string
  showSummaryBreak?: boolean
  /** A button on each code block in the answer, e.g. "Run in terminal" */
  codeAction?: { label: string; run(code: string): void }
}) {
  const app = useApp()
  const [copied, setCopied] = useState(false)
  const proseRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef(codeAction)
  actionRef.current = codeAction

  // Code blocks get the action button once the answer has finished streaming
  useEffect(() => {
    const el = proseRef.current
    if (!el || t.streaming || !actionRef.current) return
    // Inline commands too (`grep "x" file.txt`), but not lone symbols like `>` or single words like `ls` alone in prose
    el.querySelectorAll(':not(pre) > code').forEach((node) => {
      const code = node as HTMLElement
      const text = code.textContent ?? ''
      if (code.classList.contains('cmd-chip') || text.length < 3 || text.length > 200 || !/^[a-z_.~/][\w.~/-]*\s+\S/i.test(text)) return
      code.classList.add('cmd-chip')
      code.title = actionRef.current!.label
      code.addEventListener('click', (e) => {
        e.stopPropagation()
        actionRef.current?.run(text)
      })
    })
    el.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.code-action')) return
      const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
      if (!code.trim() || code.split('\n').length > 30) return
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'code-action'
      b.textContent = actionRef.current!.label
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        actionRef.current?.run(code.replace(/\n+$/, ''))
      })
      pre.appendChild(b)
    })
  }, [t.content, t.streaming])
  const onAnswerClick = (e: React.MouseEvent) => {
    const cite = (e.target as HTMLElement).closest<HTMLElement>('.cite')
    if (!cite || !t.sources) return
    const src = t.sources.find((s) => s.index === Number(cite.dataset.cite))
    if (src?.url) window.tide.app.openExternal(src.url)
    else if (src) app.openPath(src.path, src.heading)
  }
  const breakLine = showSummaryBreak ? (
    <div className="summary-break" title="Summarized to keep the chat fast">
      <span>Earlier messages summarized</span>
    </div>
  ) : null

  if (t.role === 'user') {
    return (
      <>
        {breakLine}
        <div className="msg user">
          <div className="msg-bubble">
            {t.attachment && <blockquote>{t.attachment.length > 280 ? t.attachment.slice(0, 280) + '…' : t.attachment}</blockquote>}
            <UserText text={t.content} />
          </div>
        </div>
      </>
    )
  }
  // Talk replies open with what was said aloud: shown as a quiet line above the answer
  const spoken = splitSay(t.content)
  return (
    <>
      {breakLine}
      <div className={`msg assistant${t.streaming ? ' streaming' : ''}`}>
        <TideMark turn={t} />
        <div className="msg-body">
          {!!t.steps?.length && <WorkLog steps={t.steps} streaming={t.streaming} answered={!!t.content} />}
          {spoken.say && <p className="msg-said">{spoken.say}</p>}
          {spoken.rest ? (
            <div
              ref={proseRef}
              className="prose msg-prose"
              data-lab={turnLab.get(t.id)}
              onClick={onAnswerClick}
              dangerouslySetInnerHTML={{ __html: linkCitations(renderMarkdown(spoken.rest, { notePath: notePath ?? '', filesByName: app.filesByName }), t.sources?.length ?? 0) }}
            />
          ) : (
            t.streaming &&
            !t.error &&
            !t.steps?.length && (
              <Thinking professor={false} />
            )
          )}
          {t.error && (
            <div className="msg-error">
              <Icon name="x" size={13} />
              <p>{t.error}</p>
              <button className="link-btn" onClick={() => app.setView({ kind: 'settings', section: 'ai' })}>
                AI settings
              </button>
            </div>
          )}
          {!!t.sources?.length && !t.streaming && <Sources sources={t.sources} />}
          {!t.streaming && t.content && (
            <div className="msg-actions">
              <button
                className="icon-btn small"
                title={copied ? 'Copied' : 'Copy'}
                onClick={() =>
                  navigator.clipboard.writeText(t.content).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1400)
                  })
                }
              >
                <Icon name={copied ? 'check' : 'copy'} size={14} />
              </button>
              <SpeakButton text={spoken.rest || t.content} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

interface ComposerProps {
  value: string
  onChange(v: string): void
  onSend(): void
  busy: boolean
  onStop(): void
  web: boolean
  onWeb(on: boolean): void
  attachment?: string
  onClearAttachment?(): void
  placeholder?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
  large?: boolean
  /** Extra controls on the left of the toolbar, e.g. what to answer from */
  tools?: React.ReactNode
}

/** The message box: text, then a toolbar with the scope, the Web switch and send or stop */
export function Composer({ value, onChange, onSend, busy, onStop, web, onWeb, attachment, onClearAttachment, placeholder, inputRef, large, tools }: ComposerProps) {
  const own = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? own
  const max = large ? 280 : 180
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, max) + 'px'
  }, [value, ref, max])
  const canSend = !!value.trim() || !!attachment
  const latest = useRef(value)
  latest.current = value
  // A screenshot pasted or dropped in is saved to the vault and goes with the message; Gemma sees it
  const addImages = (files: File[]) => {
    if (!files.length) return false
    ;(async () => {
      const embeds: string[] = []
      for (const f of files) embeds.push(await savePastedImage(CHAT_IMAGES, f))
      const v = latest.current
      onChange(`${v}${v && !v.endsWith('\n') ? '\n' : ''}${embeds.join('\n')}\n`)
      ref.current?.focus()
    })().catch(() => {})
    return true
  }
  return (
    <form
      className={`composer${large ? ' large' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        onSend()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.focus()
      }}
    >
      {attachment && (
        <div className="composer-quote">
          <span>{attachment.length > 160 ? attachment.slice(0, 160) + '…' : attachment}</span>
          <button type="button" className="icon-btn small" onClick={onClearAttachment} title="Remove">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      <textarea
        ref={ref}
        value={value}
        rows={1}
        placeholder={placeholder ?? (attachment ? 'Ask about the selected text' : 'Ask your tutor')}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => addImages(pastedImageFiles(e.clipboardData.files)) && e.preventDefault()}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => addImages(pastedImageFiles(e.dataTransfer.files)) && e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onSend()
          }
        }}
      />
      <div className="composer-bar">
        <div className="composer-tools">
          {tools}
          <EnginePill />
          <button
            type="button"
            className={`pill${web ? ' on' : ''}`}
            aria-pressed={web}
            title={web ? 'The tutor may search the web. Click to use only your notes.' : 'The tutor only uses your notes. Click to let it search the web.'}
            onClick={() => onWeb(!web)}
          >
            <Icon name="globe" size={13} />
            {web ? 'Web on' : 'Web off'}
          </button>
        </div>
        {busy ? (
          <button type="button" className="composer-send stop" onClick={onStop} title="Stop" aria-label="Stop">
            <span className="stop-square" />
          </button>
        ) : (
          <button type="submit" className="composer-send" disabled={!canSend} title="Send (Enter)" aria-label="Send">
            <Icon name="arrowUp" size={16} />
          </button>
        )}
      </div>
    </form>
  )
}

/** What you wrote, with any pictures you pasted shown as pictures rather than their embed lines */
function UserText({ text }: { text: string }) {
  const app = useApp()
  const pics = imageRefs(text)
  if (!pics.length) return <p>{text}</p>
  const rest = text.replace(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)/g, '').trim()
  return (
    <>
      <span className="msg-pics">
        {pics.map((p) => {
          const path = resolveRelative(p, { notePath: '', filesByName: app.filesByName })
          return <img key={p} src={vaultUrl(path)} alt="" onClick={() => app.openPath(path)} />
        })}
      </span>
      {rest && <p>{rest}</p>}
    </>
  )
}
