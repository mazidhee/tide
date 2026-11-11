import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import type { ConceptState, KnowledgeView } from '@shared/knowledge'
import { dayMonth, type AimForecast, type Timeline, type TimelineWeek } from '@shared/knowTimeline'
import { Level } from '../tide/Level'
import { AreaMark } from '../tide/AreaMark'
import type { Actions } from './KnowSubjects'

/**
 * What you know, over time. Weeks run along one axis shared by every panel, from half a year back
 * to the furthest aim's deadline: what was made solid each week (and, ahead of now, what will fade
 * if left), the share of returning questions answered right, and each aim's path with its
 * forecast. Then what will fade, week by week, each with Review now. The figures are worked out in
 * the main process (shared/knowTimeline.ts); this only draws them, in plain SVG with the theme's
 * tokens, after the conventions of lib/labChart.ts: one value axis, bars from zero, thin marks,
 * text in the ink tokens, the exact values on hover or with the arrow keys.
 */

const PAD = { l: 40, r: 48 }
const short = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const pct = (x: number) => `${Math.round(x * 100)}%`
const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))
const names = (ids: string[], byId: Map<string, ConceptState>, max = 6) => {
  const list = ids.map((id) => byId.get(id)?.name).filter(Boolean) as string[]
  return list.length > max ? `${list.slice(0, max).join(', ')} and ${list.length - max} more` : list.join(', ')
}

/** A rounded-top column from the baseline */
const column = (x: number, y: number, w: number, h: number) => {
  if (h <= 0) return ''
  const r = Math.min(2, w / 2, h)
  return `M${x},${y + h}V${y + r}q0,${-r} ${r},${-r}H${x + w - r}q${r},0 ${r},${r}V${y + h}Z`
}

export function KnowTimeline({ data, areaClass, actions }: { data: KnowledgeView; areaClass(area: string): string; actions: Actions }) {
  const t = data.timeline
  const byId = useMemo(() => new Map(data.concepts.map((c) => [c.id, c])), [data])
  if (!t) return <p className="kt-none">The timeline isn’t available.</p>
  return <TimelineBody t={t} data={data} byId={byId} areaClass={areaClass} actions={actions} />
}

function TimelineBody({ t, data, byId, areaClass, actions }: { t: Timeline; data: KnowledgeView; byId: Map<string, ConceptState>; areaClass(area: string): string; actions: Actions }) {
  const now = data.at
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [at, setAt] = useState<number | null>(null)
  const [tipY, setTipY] = useState(30)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setWidth(Math.max(300, Math.round(el.clientWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = t.weeks
  const plotW = width - PAD.l - PAD.r
  const slot = plotW / W.length
  const xi = (i: number) => PAD.l + slot * (i + 0.5)
  /** Where a moment sits: its week's slot, and how far through that week it is */
  const xt = (ms: number) => {
    let i = W.findIndex((w) => ms >= w.start && ms < w.end)
    if (i < 0) i = ms < W[0].start ? 0 : W.length - 1
    const w = W[i]
    const f = Math.max(0, Math.min(1, (ms - w.start) / (w.end - w.start)))
    return PAD.l + slot * (i + f)
  }
  const nowX = xt(now)

  // ---- The lede ----
  const past = W.slice(0, t.now + 1)
  const made = past.reduce((k, w) => k + w.solid.length, 0)
  const lately = W.slice(Math.max(0, t.now - 3), t.now + 1).reduce((k, w) => k + w.solid.length, 0)
  const asked = past.reduce((k, w) => k + w.asked, 0)
  const right = past.reduce((k, w) => k + w.right, 0)
  const soon = new Set(W.slice(t.now, t.now + 4).flatMap((w) => w.fades))
  const lede = [
    made ? `In the last ${past.length} weeks you made ${made} ${made === 1 ? 'topic' : 'topics'} solid${lately === made ? (made === 1 ? ', in the last four weeks' : ', all in the last four weeks') : `, ${lately} in the last four weeks`}.` : `Nothing has been made solid in the last ${past.length} weeks yet.`,
    asked === 1 ? `The one question that came back was answered ${right === 1 ? 'right' : right > 0 ? 'partly right' : 'wrong'}.` : asked ? `Of ${asked} questions that came back, ${pct(right / asked)} were answered right.` : 'No question has come back yet.',
    soon.size ? `${soon.size} ${soon.size === 1 ? 'topic fades' : 'topics fade'} in the next four weeks unless reviewed.` : ''
  ].filter(Boolean)

  // ---- Hover and keys: one week across every panel ----
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - box.left - PAD.l) / slot)
    setAt(i >= 0 && i < W.length ? i : null)
    setTipY(Math.max(30, e.clientY - box.top + 18))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') return setAt(null)
    setTipY(30)
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    setAt((cur) => {
      if (e.key === 'Home') return 0
      if (e.key === 'End') return W.length - 1
      const from = cur ?? t.now
      return Math.max(0, Math.min(W.length - 1, cur === null ? from : from + (e.key === 'ArrowLeft' ? -1 : 1)))
    })
  }

  // Month labels at the first week of each month, spaced so they never collide
  const ticks: { i: number; label: string }[] = []
  let lastX = -Infinity
  W.forEach((w, i) => {
    const d = new Date(w.start)
    const first = i > 0 && new Date(W[i - 1].start).getMonth() !== d.getMonth()
    if (!first || xi(i) - lastX < 44) return
    ticks.push({ i, label: d.toLocaleDateString('en-GB', { month: 'short', ...(d.getMonth() === 0 ? { year: 'numeric' } : {}) }) })
    lastX = xi(i)
  })

  const band = at !== null ? <rect className="kt-hover" x={PAD.l + slot * at} y={0} width={slot} height="100%" /> : null
  const nowLine = (h: number) => <line className="kt-now" x1={nowX} x2={nowX} y1={0} y2={h} />

  // ---- Made solid, and ahead of now what will fade ----
  const H1 = 132
  const top1 = 14
  const plot1 = H1 - top1 - 6
  const ahead = (w: TimelineWeek) => new Set([...w.fades, ...w.due]).size
  const max1 = Math.max(2, ...W.map((w, i) => (i < t.now ? w.solid.length : i === t.now ? Math.max(w.solid.length, ahead(w)) : ahead(w))))
  const step1 = max1 <= 4 ? 1 : max1 <= 10 ? 2 : Math.ceil(max1 / 5)
  const top1v = Math.ceil(max1 / step1) * step1
  const y1 = (v: number) => top1 + plot1 * (1 - v / top1v)
  const barW = Math.max(2, Math.min(14, slot * 0.56))
  const halfW = Math.max(2, Math.min(7, slot * 0.28))

  // ---- Retention ----
  const H2 = 104
  const top2 = 10
  const plot2 = H2 - top2 - 6
  const y2 = (v: number) => top2 + plot2 * (1 - v)
  const shares = W.map((w, i) => (i <= t.now && w.asked ? w.right / w.asked : null))
  const runs: string[] = []
  let run = ''
  shares.forEach((v, i) => {
    if (v === null) {
      if (run) runs.push(run)
      run = ''
    } else run += `${run ? 'L' : 'M'}${xi(i).toFixed(1)},${y2(v).toFixed(1)}`
  })
  if (run) runs.push(run)
  const lastShare = shares.reduce<number>((k, v, i) => (v !== null ? i : k), -1)

  const hovered = at !== null ? W[at] : null
  const total = W.length

  return (
    <div className="kt">
      <p className="kt-say">{lede.join(' ')}</p>

      <div
        className="kt-chart"
        ref={wrap}
        tabIndex={0}
        role="group"
        aria-label={`Weeks from ${short(W[0].start)} to ${short(W[total - 1].start)}. Use the arrow keys to read each week.`}
        onMouseMove={onMove}
        onMouseLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
        onKeyDown={onKey}
      >
        <div className="kt-panel">
          <div className="kt-panel-head">
            <h3>Made solid</h3>
            <span className="kt-key">
              <span>
                <i className="made" />
                first made solid that week
              </span>
              <span>
                <i className="ahead" />
                will fade unless reviewed
              </span>
            </span>
          </div>
          <svg width={width} height={H1} viewBox={`0 0 ${width} ${H1}`} aria-hidden="true">
            {band}
            {[0, top1v / 2, top1v].map((v) => (
              <g key={v}>
                <line className={v ? 'kt-grid' : 'kt-base'} x1={PAD.l} x2={width - PAD.r} y1={y1(v)} y2={y1(v)} />
                <text className="kt-tick" x={PAD.l - 8} y={y1(v) + 4} textAnchor="end">
                  {n(v)}
                </text>
              </g>
            ))}
            {W.map((w, i) => {
              const parts: ReactElement[] = []
              const x = xi(i)
              if (i <= t.now && w.solid.length) {
                const wide = i === t.now ? halfW : barW
                const left = i === t.now ? x - halfW - 1 : x - barW / 2
                parts.push(<path key="m" className="kt-made" d={column(left, y1(w.solid.length), wide, y1(0) - y1(w.solid.length))} />)
              }
              const a = i >= t.now ? ahead(w) : 0
              if (a) {
                const wide = i === t.now ? halfW : barW
                const left = i === t.now ? x + 1 : x - barW / 2
                parts.push(<path key="a" className="kt-ahead" d={column(left + 0.75, y1(a) + 0.75, wide - 1.5, y1(0) - y1(a) - 0.75)} />)
              }
              return parts.length ? <g key={w.start}>{parts}</g> : null
            })}
            {nowLine(H1)}
            <text className="kt-now-label" x={nowX + 5} y={10}>
              Now
            </text>
          </svg>
        </div>

        <div className="kt-panel">
          <div className="kt-panel-head">
            <h3>Retention</h3>
            <span className="kt-key">share of returning questions answered right</span>
          </div>
          {shares.some((v) => v !== null) ? (
            <svg width={width} height={H2} viewBox={`0 0 ${width} ${H2}`} aria-hidden="true">
              {band}
              {[0, 0.5, 1].map((v) => (
                <g key={v}>
                  <line className={v ? 'kt-grid' : 'kt-base'} x1={PAD.l} x2={width - PAD.r} y1={y2(v)} y2={y2(v)} />
                  <text className="kt-tick" x={PAD.l - 8} y={y2(v) + 4} textAnchor="end">
                    {pct(v)}
                  </text>
                </g>
              ))}
              {runs.map((d) => (
                <path key={d} className="kt-line" d={d} />
              ))}
              {shares.map((v, i) => (v === null ? null : <circle key={i} className={`kt-point${at === i ? ' on' : ''}`} cx={xi(i)} cy={y2(v)} r={at === i ? 4 : 3} />))}
              {lastShare >= 0 && at === null && (
                <text className="kt-value" x={xi(lastShare) + 8} y={y2(shares[lastShare]!) + 4}>
                  {pct(shares[lastShare]!)}
                </text>
              )}
              {nowLine(H2)}
            </svg>
          ) : (
            <p className="kt-empty" style={{ marginLeft: PAD.l }}>
              Nothing has come back yet. When recall questions and flashcards return, the share you get right shows here, week by week.
            </p>
          )}
        </div>

        {t.aims.map((a) => (
          <AimPanel key={a.id} a={a} width={width} xt={xt} band={band} nowLine={nowLine} now={now} areaClass={areaClass} />
        ))}

        <svg className="kt-axis" width={width} height={22} viewBox={`0 0 ${width} 22`} aria-hidden="true">
          {ticks.map((k) => (
            <g key={k.i}>
              <line className="kt-base" x1={PAD.l + slot * k.i} x2={PAD.l + slot * k.i} y1={0} y2={5} />
              <text className="kt-tick" x={PAD.l + slot * k.i + 3} y={16}>
                {k.label}
              </text>
            </g>
          ))}
        </svg>

        {hovered && at !== null && (
          <div className="kt-tip" style={{ left: Math.min(width - 150, Math.max(150, xi(at))), top: tipY }} role="status">
            <WeekTip w={hovered} i={at} t={t} byId={byId} />
          </div>
        )}
      </div>
      {!t.aims.length && <p className="kt-none">Set a deadline on a roadmap (Home, Aims) and its forecast appears here.</p>}

      <Upcoming t={t} byId={byId} now={now} areaClass={areaClass} actions={actions} />
    </div>
  )
}

function WeekTip({ w, i, t, byId }: { w: TimelineWeek; i: number; t: Timeline; byId: Map<string, ConceptState> }) {
  const when = i === t.now ? 'This week' : `Week of ${short(w.start)}`
  const fading = [...new Set([...w.fades, ...w.due])]
  return (
    <>
      <b>{when}</b>
      {i <= t.now && <span>{w.solid.length ? `Made solid: ${names(w.solid, byId)}` : 'Nothing made solid'}</span>}
      {i <= t.now && <span>{w.asked ? `${n(w.right)} of ${w.asked} right when they came back (${pct(w.right / w.asked)})` : 'Nothing came back'}</span>}
      {i >= t.now && fading.length > 0 && <span>Fades unless reviewed: {names(fading, byId)}</span>}
      {t.aims
        .filter((a) => a.total)
        .map((a) => {
          const p = i < t.now ? a.path[i] : i === t.now ? a.path[a.path.length - 1] : a.projection.find((x) => x.at >= w.start) ?? null
          if (!p) return null
          return 'likely' in p ? (
            <span key={a.id}>
              {a.area}: about {Math.round(p.likely)} of {a.total} ({Math.round(p.low)} to {Math.round(p.high)})
            </span>
          ) : (
            <span key={a.id}>
              {a.area}: {p.solid} of {a.total} made solid
            </span>
          )
        })}
    </>
  )
}

function AimPanel({ a, width, xt, band, nowLine, now, areaClass }: { a: AimForecast; width: number; xt(ms: number): number; band: ReactElement | null; nowLine(h: number): ReactElement; now: number; areaClass(area: string): string }) {
  const H = 132
  const top = 12
  const plot = H - top - 6
  const y = (count: number) => top + plot * (1 - (a.total ? count / a.total : 0))
  // What was made solid, week by week, then from now the likely line inside its band
  const pathFull = a.path.length ? `M${PAD.l},${y(a.path[0].solid).toFixed(1)}${a.path.map((p) => `L${xt(p.at).toFixed(1)},${y(p.solid).toFixed(1)}`).join('')}` : ''
  const proj = a.projection
  const bandD = proj.length ? `M${proj.map((p) => `${xt(p.at).toFixed(1)},${y(p.high).toFixed(1)}`).join('L')}L${[...proj].reverse().map((p) => `${xt(p.at).toFixed(1)},${y(p.low).toFixed(1)}`).join('L')}Z` : ''
  const likelyD = proj.length ? `M${proj.map((p) => `${xt(p.at).toFixed(1)},${y(p.likely).toFixed(1)}`).join('L')}` : ''
  const dx = xt(a.deadline)
  const inRange = a.deadline > now && dx < width - PAD.r + 1
  const end = proj[proj.length - 1]
  const solidPct = a.total ? a.solid / a.total : 0
  return (
    <div className={`kt-panel kt-aim ${areaClass(a.area)}`}>
      <div className="kt-panel-head">
        <h3>
          <AreaMark area={a.area} size={14} />
          {a.name}
        </h3>
        <span className="kt-key">
          {a.solid} of {a.total} made solid ({pct(solidPct)}), due {dayMonth(a.deadline, now)}
        </span>
      </div>
      <p className={`kt-aim-say${a.state === 'early' ? ' quiet' : ''}`}>
        {a.say}
        {a.band && <span className="kt-aim-band"> {a.band}</span>}
      </p>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
        {band}
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line className={v ? 'kt-grid' : 'kt-base'} x1={PAD.l} x2={width - PAD.r} y1={y(v * a.total)} y2={y(v * a.total)} />
            <text className="kt-tick" x={PAD.l - 8} y={y(v * a.total) + 4} textAnchor="end">
              {pct(v)}
            </text>
          </g>
        ))}
        {bandD && <path className="kt-band" d={bandD} />}
        {likelyD && <path className="kt-likely" d={likelyD} />}
        {pathFull && <path className="kt-path" d={pathFull} />}
        {inRange && (
          <g>
            <line className="kt-deadline" x1={dx} x2={dx} y1={top - 6} y2={H} />
            <text className="kt-tick" x={dx - 4} y={H - 8} textAnchor="end">
              {short(a.deadline)}
            </text>
          </g>
        )}
        {end && inRange && (
          <text className="kt-value" x={Math.min(width - 4, dx + 6)} y={y(end.likely) + 4} textAnchor={dx + 40 > width ? 'end' : 'start'}>
            {pct(end.likely / a.total)}
          </text>
        )}
        {!proj.length && a.state === 'early' && (
          <text className="kt-note" x={xt(now) + 220 > width ? xt(now) - 8 : xt(now) + 8} y={top + plot / 2} textAnchor={xt(now) + 220 > width ? 'end' : 'start'}>
            A forecast after three weeks of study
          </text>
        )}
        {nowLine(H)}
      </svg>
    </div>
  )
}

/** What will fade, week by week from now, each with Review now */
function Upcoming({ t, byId, now, areaClass, actions }: { t: Timeline; byId: Map<string, ConceptState>; now: number; areaClass(area: string): string; actions: Actions }) {
  const [all, setAll] = useState(false)
  const weeks = t.weeks
    .slice(t.now)
    .map((w, k) => ({ w, k, ids: [...new Set([...w.fades, ...w.due])].filter((id) => byId.has(id)) }))
    .filter((x) => x.ids.length)
  const shown = all ? weeks : weeks.slice(0, 4)
  const faded = [...byId.values()].filter((c) => !c.parent && c.status === 'fading').sort((a, b) => b.estimate - a.estimate)
  const [allFaded, setAllFaded] = useState(false)
  return (
    <section className="kt-up" aria-labelledby="kt-up-h">
      <h2 id="kt-up-h" className="td-sec">
        Fading ahead
      </h2>
      {(weeks.length > 0 || faded.length > 0) && <p className="kt-up-say">What has already dropped below solid, then what will if it isn’t reviewed, and the recall questions coming due, week by week.</p>}
      {faded.length > 0 && (
        <div className="kt-up-week">
          <h3>Already below solid</h3>
          <ul>
            {(allFaded ? faded : faded.slice(0, 6)).map((c) => (
              <li key={c.id}>
                <Level now={c.estimate} high={c.level} area={areaClass(c.area)} />
                <span className="kt-up-main">
                  <b>{c.name}</b>
                  <span>
                    {c.area || 'No notebook'}, held at {pct(c.estimate)}, down from {pct(c.level)}
                  </span>
                </span>
                <button className="btn small" onClick={() => actions.onReview(c)}>
                  Review now
                </button>
              </li>
            ))}
          </ul>
          {faded.length > 6 && (
            <button className="td-more" onClick={() => setAllFaded((x) => !x)}>
              {allFaded ? 'Fewer' : `All ${faded.length}, the least faded first`}
            </button>
          )}
        </div>
      )}
      {weeks.length ? (
        <>
          {shown.map(({ w, k, ids }) => (
            <div key={w.start} className="kt-up-week">
              <h3>{k === 0 ? 'This week' : k === 1 ? 'Next week' : `Week of ${short(w.start)}`}</h3>
              <ul>
                {ids.map((id) => {
                  const c = byId.get(id)!
                  const due = w.due.includes(id)
                  const fades = w.fades.includes(id)
                  const why = [fades ? (c.status === 'fading' ? 'already below solid' : c.fadesAt && c.fadesAt <= now ? 'fading now' : `fades ${new Date(c.fadesAt!).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`) : '', due ? 'a missed question comes back' : ''].filter(Boolean).join('; ')
                  return (
                    <li key={id}>
                      <Level now={c.estimate} high={c.level} area={areaClass(c.area)} />
                      <span className="kt-up-main">
                        <b>{c.name}</b>
                        <span>
                          {c.area || 'No notebook'}, {why}
                        </span>
                      </span>
                      <button className="btn small" onClick={() => actions.onReview(c)}>
                        Review now
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {weeks.length > 4 && (
            <button className="td-more" onClick={() => setAll((x) => !x)}>
              {all ? 'Fewer weeks' : `All ${weeks.length} weeks`}
            </button>
          )}
        </>
      ) : (
        <p className="kt-none">Nothing is set to fade in the weeks ahead. What you make solid appears here, in the week it would slip.</p>
      )}
    </section>
  )
}
