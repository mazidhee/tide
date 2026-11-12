import { useEffect, useRef, useState } from 'react'
import { modeInfo, type MockMode } from '@shared/mocks'

type Point = { at: number; score: number; title: string; mode: MockMode }

const pct = (v: number) => `${Math.round(v * 100)}%`
const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * Mock scores over time, oldest to newest. One value axis (0 to 100%), a thin line in --series-1
 * with a point per mock, the latest value labelled, the exact figure on hover or with the arrow
 * keys: the same marks as the knowledge map's retention chart (styles/knowledge.css .know-*).
 */
export function MockTrend({ points }: { points: Point[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
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

  if (points.length < 2) return null
  const H = 132
  const pad = { l: 36, r: 40, t: 12, b: 24 }
  const plotW = width - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const slot = plotW / points.length
  const x = (i: number) => pad.l + slot * (i + 0.5)
  const y = (v: number) => pad.t + plotH * (1 - v)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join('')
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 72))))
  const last = points.length - 1
  const shown = at !== null ? points[at] : null

  return (
    <div
      className="know-chart mk-trend"
      ref={wrap}
      tabIndex={0}
      role="img"
      aria-label={`Mock scores, oldest first. ${points.map((p) => `${day(p.at)}, ${modeInfo(p.mode).short}, ${p.title}: ${pct(p.score)}`).join('. ')}`}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        setAt((cur) => Math.max(0, Math.min(last, (cur ?? (e.key === 'ArrowLeft' ? points.length : -1)) + (e.key === 'ArrowLeft' ? -1 : 1))))
      }}
      onBlur={() => setAt(null)}
      onMouseLeave={() => setAt(null)}
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        const i = Math.floor((e.clientX - box.left - pad.l) / slot)
        setAt(i >= 0 && i < points.length ? i : null)
      }}
    >
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line className={v ? 'know-grid' : 'know-base'} x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
            <text className="know-tick" x={pad.l - 8} y={y(v) + 3.5} textAnchor="end">
              {pct(v)}
            </text>
          </g>
        ))}
        {at !== null && <rect className="know-band" x={pad.l + slot * at} y={pad.t} width={slot} height={plotH} />}
        {points.map((p, i) =>
          i % every === last % every ? (
            <text key={p.at} className="know-tick" x={x(i)} y={H - 6} textAnchor="middle">
              {day(p.at)}
            </text>
          ) : null
        )}
        <path className="know-line-path" d={d} />
        {points.map((p, i) => (
          <circle key={p.at} className="know-point" cx={x(i)} cy={y(p.score)} r={at === i ? 4 : 3} />
        ))}
        {at === null && (
          <text className="know-value" x={x(last) + 8} y={y(points[last].score) + 4}>
            {pct(points[last].score)}
          </text>
        )}
      </svg>
      {shown && at !== null && (
        <div className="know-tip" style={{ left: Math.min(width - 110, Math.max(110, x(at))), top: y(shown.score) }}>
          <span className="know-tip-when">
            {day(shown.at)} · {modeInfo(shown.mode).short}
          </span>
          <span>
            <strong>{pct(shown.score)}</strong> · {shown.title}
          </span>
        </div>
      )}
    </div>
  )
}
