import { useEffect, useRef, useState } from 'react'
import type { MockAttempt, MockRound } from '@shared/interviewMock'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const KIND_LABEL: Record<string, string> = {
  behavioural: 'Behavioural',
  technical: 'Technical',
  presentation: 'Presentation',
  hirevue: 'Recorded',
  general: 'General'
}

/**
 * Overall marks of past mocks, oldest to newest, on the 0–4 scale: the same marks as Practice ›
 * Mock's trend (components/mock/MockTrend, styles/knowledge.css .know-*), a thin line with a point
 * per mock, the latest labelled, the exact figure on hover or with the arrow keys.
 */
export function LiveMockTrend({ attempts }: { attempts: MockAttempt[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [at, setAt] = useState<number | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setWidth(Math.max(260, Math.round(el.clientWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  if (attempts.length < 2) return null
  const H = 128
  const pad = { l: 28, r: 36, t: 12, b: 24 }
  const plotW = width - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const slot = plotW / attempts.length
  const x = (i: number) => pad.l + slot * (i + 0.5)
  const y = (v: number) => pad.t + plotH * (1 - v / 4)
  const d = attempts.map((a, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(a.overall).toFixed(1)}`).join('')
  const last = attempts.length - 1
  const shown = at !== null ? attempts[at] : null
  return (
    <div
      className="know-chart lm-trend"
      ref={wrap}
      tabIndex={0}
      role="img"
      aria-label={`Live mock marks out of 4, oldest first. ${attempts.map((a) => `${day(a.date)}, ${a.roundName}: ${a.overall.toFixed(1)}`).join('. ')}`}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        setAt((cur) => Math.max(0, Math.min(last, (cur ?? (e.key === 'ArrowLeft' ? attempts.length : -1)) + (e.key === 'ArrowLeft' ? -1 : 1))))
      }}
      onBlur={() => setAt(null)}
      onMouseLeave={() => setAt(null)}
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        const i = Math.floor((e.clientX - box.left - pad.l) / slot)
        setAt(i >= 0 && i < attempts.length ? i : null)
      }}
    >
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
        {[0, 2, 4].map((v) => (
          <g key={v}>
            <line className={v ? 'know-grid' : 'know-base'} x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
            <text className="know-tick" x={pad.l - 8} y={y(v) + 3.5} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {at !== null && <rect className="know-band" x={pad.l + slot * at} y={pad.t} width={slot} height={plotH} />}
        {attempts.map((a, i) =>
          i === 0 || i === last || attempts.length <= 8 ? (
            <text key={a.id} className="know-tick" x={x(i)} y={H - 6} textAnchor="middle">
              {day(a.date)}
            </text>
          ) : null
        )}
        <path className="know-line-path" d={d} />
        {attempts.map((a, i) => (
          <circle key={a.id} className="know-point" cx={x(i)} cy={y(a.overall)} r={at === i ? 4 : 3} />
        ))}
        {at === null && (
          <text className="know-value" x={x(last) + 8} y={y(attempts[last].overall) + 4}>
            {attempts[last].overall.toFixed(1)}
          </text>
        )}
      </svg>
      {shown && at !== null && (
        <div
          className="know-tip"
          style={{
            left: Math.min(width - 110, Math.max(110, x(at))),
            top: y(shown.overall)
          }}
        >
          <span className="know-tip-when">
            {day(shown.date)} · {shown.roundName}
          </span>
          <span>
            <strong>{shown.overall.toFixed(1)}</strong> of 4 · {shown.persona.name}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * The target's mocks: start a round, the trend of marks, and each past mock (opens its debrief).
 */
export function LiveMockHistory({ title, rounds, attempts, onRound, onOpen }: { title: string; rounds: MockRound[]; attempts: MockAttempt[]; onRound(id: string): void; onOpen(a: MockAttempt): void }) {
  const sorted = [...attempts].sort((a, b) => a.date.localeCompare(b.date))
  return (
    <div className="lm-history">
      <p className="lm-eyebrow">Live mocks</p>
      <h1 className="page-title">{title}</h1>
      <section className="lm-brief-block">
        <h2 className="lm-h2">Run a round</h2>
        <div className="lm-rounds">
          {rounds.map((r) => {
            const mine = sorted.filter((a) => a.round === r.id)
            const lastOne = mine[mine.length - 1]
            return (
              <button key={r.id} className="lm-round" onClick={() => onRound(r.id)}>
                <span className="lm-round-name">{r.name}</span>
                <span className="lm-muted">
                  {KIND_LABEL[r.kind] ?? r.kind} · {r.minutes} min
                </span>
                <span className="lm-round-last">{lastOne ? `Last: ${lastOne.overall.toFixed(1)} of 4, ${day(lastOne.date)}` : 'Not run yet'}</span>
              </button>
            )
          })}
          {!rounds.length && <p className="lm-muted">This target has no rounds yet. Add them to its target note.</p>}
        </div>
      </section>
      {sorted.length > 0 && (
        <section className="lm-brief-block">
          <h2 className="lm-h2">Your marks so far</h2>
          <LiveMockTrend attempts={sorted} />
          <ul className="lm-past">
            {[...sorted].reverse().map((a) => (
              <li key={a.id}>
                <button className="lm-past-row" onClick={() => onOpen(a)}>
                  <span className="lm-past-date">{day(a.date)}</span>
                  <span className="lm-past-round">{a.roundName}</span>
                  <span className="lm-muted">with {a.persona.name}</span>
                  <span className="lm-past-score">{a.overall.toFixed(1)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
