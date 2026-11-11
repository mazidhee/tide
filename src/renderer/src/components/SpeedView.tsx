import { useEffect, useMemo, useState } from 'react'
import type { TurnSpeed } from '@shared/types'

/** The four places an answer's time can go, in a fixed order and colour */
const PARTS = [
  { key: 'tide', label: 'Tide', hint: 'Finding your notes, building the prompt, handling each token, drawing' },
  { key: 'read', label: 'Model reading', hint: 'The model reading the prompt before its first word' },
  { key: 'write', label: 'Model writing', hint: 'From the first word to the last' },
  { key: 'tools', label: 'Tools', hint: 'Searches, pages and code the tutor ran' }
] as const
type Part = (typeof PARTS)[number]['key']

function split(t: TurnSpeed): Record<Part, number> {
  const stream = t.calls.reduce((n, c) => n + c.tideMs, 0)
  return {
    tide: t.prepareMs + stream + (t.render?.totalMs ?? 0),
    read: t.calls.reduce((n, c) => n + c.prefillMs, 0),
    // Tide's own work on the stream happens inside the writing time: count it once, as Tide's
    write: Math.max(0, t.calls.reduce((n, c) => n + c.writeMs, 0) - stream),
    tools: t.tools.reduce((n, x) => n + x.ms, 0)
  }
}

const secs = (ms: number) => (ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 9950 ? 1 : 0)} s`)
const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function SpeedView() {
  const [turns, setTurns] = useState<TurnSpeed[] | null>(null)
  useEffect(() => {
    const load = () => window.tide.speed.recent().then(setTurns).catch(() => setTurns([]))
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const sum = useMemo(() => {
    const out: Record<Part, number> = { tide: 0, read: 0, write: 0, tools: 0 }
    for (const t of turns ?? []) for (const [k, v] of Object.entries(split(t))) out[k as Part] += v
    return out
  }, [turns])
  const all = sum.tide + sum.read + sum.write + sum.tools

  if (!turns) return <div className="sp-empty">Reading the timings…</div>
  if (!turns.length) return <div className="sp-empty">Nothing timed yet. Ask the tutor something, then come back: every answer since Tide opened is listed here.</div>

  const perAnswer = sum.tide / turns.length
  const rate = (() => {
    const local = turns.flatMap((t) => t.calls).filter((c) => c.engine === 'local' && c.writeMs > 500)
    const ms = local.reduce((n, c) => n + c.writeMs, 0)
    return ms ? (local.reduce((n, c) => n + c.tokens, 0) / ms) * 1000 : 0
  })()

  return (
    <div className="sp">
      <section className="sp-top">
        <p className="sp-sentence">
          Across the last <b>{turns.length}</b> {turns.length === 1 ? 'answer' : 'answers'}, Tide itself took <b>{secs(perAnswer)}</b> each: <b>{((sum.tide / all) * 100).toFixed(1)}%</b> of the wait. The rest was the model{sum.tools ? ' and its tools' : ''}.
          {rate ? (
            <>
              {' '}
              Gemma wrote at <b>{rate.toFixed(0)}</b> tokens a second.
            </>
          ) : null}
        </p>
        <Bar parts={sum} />
        <ul className="sp-legend">
          {PARTS.filter((p) => sum[p.key] > 0).map((p) => (
            <li key={p.key} title={p.hint}>
              <i className={`sp-${p.key}`} />
              {p.label}
              <span className="num">{secs(sum[p.key] / turns.length)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="sp-table" role="table" aria-label="Recent answers">
        <div className="sp-cols" role="row">
          <span>Answer</span>
          <span>Where the time went</span>
          <span className="r">Tide</span>
          <span className="r">Reading</span>
          <span className="r">Writing</span>
          <span className="r">Total</span>
        </div>
        {turns.map((t) => {
          const p = split(t)
          const call = t.calls[t.calls.length - 1]
          const cached = t.calls.reduce((n, c) => n + (c.cachedTokens ?? 0), 0)
          const prompt = t.calls.reduce((n, c) => n + (c.promptTokens ?? 0), 0)
          return (
            <div key={t.id} className="sp-row" role="row">
              <span className="sp-what">
                <b>{t.kind === 'lesson' ? 'Lesson' : 'Chat'}</b>
                <small>
                  {clock(t.at)}, {call.engine === 'local' ? 'on this Mac' : 'cloud'}
                  {t.calls.length > 1 ? `, ${t.calls.length} requests` : ''}
                </small>
              </span>
              <span className="sp-where">
                <Bar parts={p} />
                <small>
                  {prompt ? `${prompt.toLocaleString('en-GB')} tokens read, ${Math.round((cached / prompt) * 100)}% from memory` : 'Prompt size not reported'}
                  {t.tools.length ? `; ${t.tools.map((x) => `${x.name.replace(/_/g, ' ')} ${secs(x.ms)}`).join(', ')}` : ''}
                </small>
              </span>
              <span className="r num">{secs(p.tide)}</span>
              <span className="r num">{secs(p.read)}</span>
              <span className="r num">{secs(p.write)}</span>
              <span className="r num sp-total">{secs(t.totalMs)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Bar({ parts }: { parts: Record<Part, number> }) {
  const total = PARTS.reduce((n, p) => n + parts[p.key], 0) || 1
  return (
    <div className="sp-bar" role="img" aria-label={PARTS.map((p) => `${p.label} ${secs(parts[p.key])}`).join(', ')}>
      {PARTS.filter((p) => parts[p.key] > 0).map((p) => (
        <span key={p.key} className={`sp-${p.key}`} style={{ flexGrow: parts[p.key] / total }} title={`${p.label}: ${secs(parts[p.key])}`} />
      ))}
    </div>
  )
}
