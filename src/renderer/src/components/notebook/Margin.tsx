import { useEffect, useRef, useState } from 'react'
import type { NbVariable, TutorAction, TutorEvent } from '@shared/notebook/api'
import { claudeLabel } from '@shared/claude'
import { Icon } from '../Icon'
import { renderMarkdown } from '../../lib/markdown'
import { useApp } from '../../state'

export interface Turn {
  role: 'you' | 'tutor'
  text: string
  tools?: string[]
  engine?: string
  error?: boolean
}

/** The tutor's side of the margin: what was said, quick asks, and a box */
export function TutorPane({
  turns,
  busy,
  claude,
  activeHasError,
  onAsk,
  onStop
}: {
  turns: Turn[]
  busy: boolean
  claude: { claude: boolean; why?: string } | null
  activeHasError: boolean
  onAsk(action: TutorAction, text?: string): void
  onStop(): void
}) {
  const app = useApp()
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [turns])
  const send = () => {
    const t = draft.trim()
    if (!t || busy) return
    setDraft('')
    onAsk('ask', t)
  }
  return (
    <div className="nb-tutor">
      <div className="nb-tutor-log">
        {!turns.length && (
          <div className="nb-tutor-empty">
            <p>
              Your tutor reads this notebook: its cells, outputs and errors. You write the code; ask for an explanation, help finding a bug, or a checked exercise. It proposes code only when you ask.
            </p>
            {claude && !claude.claude && <p className="nb-muted">Claude isn’t available ({claude.why ?? 'not set up'}), so Gemma answers from the notebook’s text, without running code or setting exercises.</p>}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`nb-turn ${t.role}${t.error ? ' error' : ''}`}>
            {t.tools && t.tools.length > 0 && (
              <div className="nb-turn-tools">
                {[...new Set(t.tools)].map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
            )}
            {t.role === 'you' ? <p>{t.text}</p> : <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.text || (busy && i === turns.length - 1 ? '…' : ''), { notePath: '', filesByName: app.filesByName }) }} />}
            {t.engine && <div className="nb-turn-engine">{t.engine}</div>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="nb-quick">
        <button className="chip" disabled={busy} onClick={() => onAsk(activeHasError ? 'debug' : 'explain')}>
          {activeHasError ? 'Debug this error' : 'Explain this output'}
        </button>
        <button className="chip" disabled={busy} onClick={() => onAsk('next')}>
          Suggest the next cell
        </button>
        <button className="chip" disabled={busy || (!!claude && !claude.claude)} onClick={() => onAsk('exercise')}>
          Set me an exercise
        </button>
        <button className="chip" disabled={busy} onClick={() => onAsk('review')}>
          Review my notebook
        </button>
      </div>
      <div className="nb-compose">
        <textarea
          value={draft}
          placeholder="Ask about this notebook…"
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button className="icon-btn" title="Stop" onClick={onStop}>
            <Icon name="stop" size={15} />
          </button>
        ) : (
          <button className="icon-btn" title="Send" onClick={send} disabled={!draft.trim()}>
            <Icon name="send" size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

export function engineLabel(e: Extract<TutorEvent, { type: 'done' }>): string {
  return e.engine === 'gemma' ? 'Gemma' : claudeLabel(e.model ?? 'sonnet')
}

const shapeText = (v: NbVariable) => (v.shape ? v.shape.join(' × ') : v.len !== undefined ? `${v.len}` : '')

export function VariablesPane({ vars, kernel }: { vars: NbVariable[]; kernel: string }) {
  const [filter, setFilter] = useState('')
  const shown = vars.filter((v) => !filter || v.name.toLowerCase().includes(filter.toLowerCase()) || v.type.toLowerCase().includes(filter.toLowerCase()))
  if (kernel !== 'idle' && kernel !== 'busy') return <p className="nb-muted nb-pad">Variables show here once the kernel is running.</p>
  if (!vars.length) return <p className="nb-muted nb-pad">No variables yet. Run a cell.</p>
  return (
    <div className="nb-vars">
      <input className="nb-vars-filter" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Size</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((v) => (
            <tr key={v.name} title={v.columns ? `columns: ${v.columns.join(', ')}` : v.value}>
              <td className="nb-var-name">{v.name}</td>
              <td className="nb-var-type">
                {v.type}
                {v.dtype ? <span> {v.dtype}</span> : null}
              </td>
              <td className="nb-var-size">{shapeText(v)}</td>
              <td className="nb-var-value">{v.columns ? v.columns.slice(0, 6).join(', ') : v.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
