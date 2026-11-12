import { Fragment, useEffect, useMemo, useState } from 'react'
import { fallbackLabel, jobLabel, modelName, projectionLine, seriesOf, tokensOf, type CallEntry, type DayRow, type GroupRow, type LessonRow, type ReasonRow, type UsageReport, type WindowView } from '@shared/usage'
import { PillSegment } from './PromptBox'
import '../styles/usage.css'

/**
 * Settings › Usage: every model call Tide made (main/usageLog), the Claude plan's windows and
 * whether it's being used, tokens by day and model, jobs, lessons turn by turn, speed, fallbacks
 * and Gemma. Dollar figures are API-price equivalents: the plan isn't billed per token.
 */

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n)))
const money = (usd: number) => (usd === 0 ? '$0' : usd < 0.01 ? '<$0.01' : usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString('en-GB')}`)
const secs = (ms?: number) => (ms ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : '—')
const rate = (tps?: number) => (tps ? `${Math.round(tps)}/s` : '—')
const pct = (x: number) => `${Math.round(x * 100)}%`
const count = (n: number) => n.toLocaleString('en-GB')
const hours = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}
const clock = (at: number) =>
  new Date(at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  })
const dayName = (at: number) =>
  new Date(at).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
const resetText = (at: number, now: number) => {
  const d = new Date(at)
  const same = d.toDateString() === new Date(now).toDateString()
  return `${same ? 'today' : d.toLocaleDateString('en-GB', { weekday: 'long' })} at ${clock(at)}`
}
const swatch = (name: string) => ({
  background: `var(--series-${seriesOf(name)})`
})

export function UsageView({ onOpenModels }: { onOpenModels?(): void }) {
  const [range, setRange] = useState('14')
  const [r, setR] = useState<UsageReport | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let on = true
    window.tide.usage
      .report(Number(range))
      .then((x) => on && setR(x))
      .catch(() => on && setFailed(true))
    return () => {
      on = false
    }
  }, [range])
  if (failed) return <p className="muted">Couldn’t read the usage log.</p>
  if (!r) return <p className="muted">Reading the usage log…</p>
  const empty = r.inRange.calls === 0
  return (
    <div className="us">
      <Plan r={r} onOpenModels={onOpenModels} />
      <Headline r={r} />
      <div className="us-bar">
        <h2 className="us-h">In detail</h2>
        <PillSegment
          label="Period"
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: '7 days' },
            { value: '14', label: '14 days' },
            { value: '30', label: '30 days' }
          ]}
        />
      </div>
      {empty ? (
        <p className="us-empty">No model calls in the last {range} days. Each call is written down from now on: a lesson turn, a mark, a background job.</p>
      ) : (
        <>
          <DayChart days={r.days} models={r.models} />
          <Groups title="By model" rows={r.byModel} first="Model" swatches />
          <Groups title="By job" rows={r.byJob} first="Job" />
          <Lessons lessons={r.lessons} />
          <div className="us-two">
            <Reasons title="Handed to another model" rows={r.handedOver} none="Every call ran where it was meant to." note="Why Gemma (or the next model) took a call: privacy, Claude’s limit, offline." />
            <Reasons title="Calls that failed" rows={r.failed} none="No failed calls." />
          </div>
          <Gemma r={r} />
        </>
      )}
      <p className="us-foot">
        Kept in your notes folder under .tide/usage, a small file a day, for {120} days.
        {r.since ? ` The log starts ${new Date(r.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.` : ''}
      </p>
    </div>
  )
}

// ---------- The plan ----------

function Plan({ r, onOpenModels }: { r: UsageReport; onOpenModels?(): void }) {
  return (
    <section className="us-card us-plan" aria-labelledby="us-plan-h">
      <div className="us-plan-head">
        <h2 className="us-h" id="us-plan-h">
          Your Claude plan
        </h2>
        {onOpenModels && (
          <button type="button" className="us-link" onClick={onOpenModels}>
            Models
          </button>
        )}
      </div>
      <p className="us-verdict">{r.verdict}</p>
      {r.windows.length ? (
        <div className="us-windows">
          {r.windows.map((w) => (
            <Window key={w.window} w={w} now={r.now} line={r.projections[w.window] ?? projectionLine(w, r.now)} />
          ))}
        </div>
      ) : (
        <p className="us-muted">Claude Code hasn’t reported your plan’s windows yet. They come with each Claude lesson turn or long draft.</p>
      )}
      <p className="us-muted us-small">
        These windows count all your Claude use, Claude Code in the terminal included, not only Tide’s. Claude Code reports a percentage only for some windows; Tide shows what it reports and nothing more.
      </p>
    </section>
  )
}

function Window({ w, now, line }: { w: WindowView; now: number; line: string }) {
  const used = w.utilization
  const projected = w.projected !== undefined ? Math.min(1, w.projected) : undefined
  const warn = w.status === 'rejected' || (used ?? 0) >= 0.9 || (w.fullAt && w.resetsAt && w.fullAt < w.resetsAt)
  return (
    <div className="us-window">
      <div className="us-window-top">
        <span className="us-window-name">{w.label}</span>
        <span className="us-window-num">{used !== undefined && !w.stale ? `${pct(used)} used` : w.stale ? 'reset since' : 'not reported'}</span>
      </div>
      <div
        className={`us-meter${warn ? ' warn' : ''}`}
        role="meter"
        aria-label={w.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used !== undefined && !w.stale ? Math.round(used * 100) : undefined}
        aria-valuetext={used !== undefined && !w.stale ? `${pct(used)} used${projected !== undefined ? `, about ${pct(projected)} by the reset` : ''}` : 'Not reported'}
      >
        {used !== undefined && !w.stale && (
          <>
            {projected !== undefined && projected > used && <span className="us-meter-proj" style={{ width: `${projected * 100}%` }} />}
            <span className="us-meter-used" style={{ width: `${Math.max(used * 100, 1)}%` }} />
          </>
        )}
      </div>
      <p className="us-window-line">
        {w.resetsAt && !w.stale ? `Resets ${resetText(w.resetsAt, now)}. ` : ''}
        {w.status === 'rejected' ? 'At the limit: Gemma is teaching until it resets. ' : w.status === 'allowed_warning' ? 'Claude Code says it’s nearly full. ' : ''}
        {line}
      </p>
      {projected !== undefined && <p className="us-window-key">Solid: used so far. Light: the projection to the reset.</p>}
    </div>
  )
}

// ---------- Today and this week ----------

function Headline({ r }: { r: UsageReport }) {
  const tiles = [
    {
      label: 'Calls',
      today: count(r.today.calls),
      week: count(r.week.calls),
      sub: r.week.failed ? `${r.week.failed} failed this week` : undefined
    },
    {
      label: 'Tokens',
      today: tokens(r.today.tokens),
      week: tokens(r.week.tokens),
      sub: `${tokens(r.week.cacheRead)} of the week’s read from the cache`
    },
    {
      label: 'API-price equivalent',
      today: money(r.today.usd),
      week: money(r.week.usd),
      sub: 'Your plan isn’t billed per token'
    },
    {
      label: 'Saved by the cache',
      today: money(r.today.saved),
      week: money(r.week.saved),
      sub: 'About, at API prices'
    }
  ]
  return (
    <section className="us-tiles" aria-label="Today and the last 7 days">
      {tiles.map((t) => (
        <div key={t.label} className="us-tile">
          <span className="us-tile-label">{t.label}</span>
          <span className="us-tile-value">
            {t.today}
            <small>today</small>
          </span>
          <span className="us-tile-week">
            <b>{t.week}</b> in 7 days
          </span>
          {t.sub && <span className="us-tile-sub">{t.sub}</span>}
        </div>
      ))}
    </section>
  )
}

// ---------- Tokens by day ----------

/** A round top for the axis: 1, 2 or 5 × a power of ten, in four steps */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0]
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

function DayChart({ days, models }: { days: DayRow[]; models: string[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const ticks = useMemo(() => niceTicks(Math.max(1, ...days.map((d) => d.tokens))), [days])
  const top = ticks[ticks.length - 1] || 1
  const at = (d: DayRow) => new Date(`${d.date}T12:00:00`).getTime()
  const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 5
  const day = hover !== null ? days[hover] : null
  return (
    <section className="us-card" aria-labelledby="us-days-h">
      <div className="us-card-head">
        <h3 className="us-h3" id="us-days-h">
          Tokens by day
        </h3>
        <ul className="us-legend" aria-label="Models">
          {models.map((m) => (
            <li key={m}>
              <i style={swatch(m)} />
              {m}
            </li>
          ))}
        </ul>
        <button type="button" className="us-link" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {table ? (
        <div className="us-scroll">
          <table className="us-table">
            <thead>
              <tr>
                <th>Day</th>
                {models.map((m) => (
                  <th key={m} className="r">
                    {m}
                  </th>
                ))}
                <th className="r">Calls</th>
                <th className="r">API price</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{dayName(at(d))}</td>
                  {models.map((m) => (
                    <td key={m} className="r num">
                      {d.byModel[m] ? tokens(d.byModel[m]) : '—'}
                    </td>
                  ))}
                  <td className="r num">{d.calls || '—'}</td>
                  <td className="r num">{d.calls ? money(d.usd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="us-chart" onMouseLeave={() => setHover(null)}>
          <div className="us-yaxis" aria-hidden="true">
            {[...ticks].reverse().map((t) => (
              <span key={t}>{tokens(t)}</span>
            ))}
          </div>
          <div className="us-plot" role="img" aria-label={`Tokens a day by model over ${days.length} days. The table view lists the numbers.`}>
            <div className="us-grid" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t} style={{ bottom: `${(t / top) * 100}%` }} />
              ))}
            </div>
            <div className="us-cols">
              {days.map((d, i) => (
                <div key={d.date} className={`us-col${hover === i ? ' on' : ''}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
                  <div className="us-stack" style={{ height: `${(d.tokens / top) * 100}%` }}>
                    {models
                      .filter((m) => d.byModel[m])
                      .map((m) => (
                        <span key={m} style={{ ...swatch(m), flexGrow: d.byModel[m] }} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
            {day && (
              <div className={`us-tip${hover! > days.length / 2 ? ' left' : ''}`} style={{ left: `${((hover! + 0.5) / days.length) * 100}%` }}>
                <strong>{dayName(at(day))}</strong>
                {day.calls ? (
                  <>
                    {models
                      .filter((m) => day.byModel[m])
                      .map((m) => (
                        <span key={m} className="us-tip-row">
                          <i style={swatch(m)} />
                          {m}
                          <b>{tokens(day.byModel[m])}</b>
                        </span>
                      ))}
                    <span className="us-tip-foot">
                      {day.calls} {day.calls === 1 ? 'call' : 'calls'} · {money(day.usd)} at API prices
                    </span>
                  </>
                ) : (
                  <span className="us-tip-foot">No calls</span>
                )}
              </div>
            )}
          </div>
          <div className="us-xaxis" aria-hidden="true">
            {days.map((d, i) => (
              <span key={d.date}>
                {(days.length - 1 - i) % every === 0
                  ? days.length <= 7
                    ? new Date(at(d)).toLocaleDateString('en-GB', {
                        weekday: 'short'
                      })
                    : new Date(at(d)).getDate()
                  : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ---------- By model, by job ----------

function Groups({ title, rows, first, swatches }: { title: string; rows: GroupRow[]; first: string; swatches?: boolean }) {
  return (
    <section className="us-card us-flush" aria-label={title}>
      <h3 className="us-h3 us-pad">{title}</h3>
      <div className="us-scroll">
        <table className="us-table">
          <thead>
            <tr>
              <th>{first}</th>
              <th className="r">Calls</th>
              <th className="r">Input</th>
              <th className="r">Output</th>
              <th className="r" title="Of the output, tokens spent thinking, when the model reports it">
                Thinking
              </th>
              <th className="r">Cache read</th>
              <th className="r">Cache write</th>
              <th className="r">API price</th>
              <th className="r" title="Median time to the first token">
                First token
              </th>
              <th className="r" title="Median output tokens a second, once writing">
                Speed
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key}>
                <td className="us-name">
                  {swatches && <i className="us-sw" style={swatch(g.key)} />}
                  {g.label}
                  {g.failed > 0 && <small className="us-bad">{g.failed} failed</small>}
                </td>
                <td className="r num">{count(g.calls)}</td>
                <td className="r num">{tokens(g.input)}</td>
                <td className="r num">{tokens(g.output)}</td>
                <td className="r num">{g.thinking ? tokens(g.thinking) : '—'}</td>
                <td className="r num">{g.cacheRead ? tokens(g.cacheRead) : '—'}</td>
                <td className="r num">{g.cacheWrite ? tokens(g.cacheWrite) : '—'}</td>
                <td className="r num us-strong">{money(g.usd)}</td>
                <td className="r num">{secs(g.ttft)}</td>
                <td className="r num">{rate(g.tps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------- Lessons ----------

function Lessons({ lessons }: { lessons: LessonRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!lessons.length) return null
  return (
    <section className="us-card us-flush" aria-labelledby="us-lessons-h">
      <h3 className="us-h3 us-pad" id="us-lessons-h">
        Most expensive lessons and conversations
      </h3>
      <div className="us-scroll">
        <table className="us-table us-lessons">
          <thead>
            <tr>
              <th>Lesson</th>
              <th>Models</th>
              <th className="r">Calls</th>
              <th className="r">Tokens</th>
              <th className="r" title="Share of the tokens read from the cache">
                From cache
              </th>
              <th className="r">API price</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((l) => (
              <Fragment key={l.lesson}>
                <tr className={`us-lesson${open === l.lesson ? ' open' : ''}`}>
                  <td>
                    <button type="button" className="us-open" aria-expanded={open === l.lesson} onClick={() => setOpen(open === l.lesson ? null : l.lesson)}>
                      <span className="us-chev" aria-hidden="true" />
                      <span className="us-lesson-title">{l.title}</span>
                      <small>{dayName(l.last)}</small>
                    </button>
                  </td>
                  <td>
                    <span className="us-models">
                      {l.models.map((m) => (
                        <span key={m}>
                          <i className="us-sw" style={swatch(m)} />
                          {m}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="r num">{l.calls}</td>
                  <td className="r num">{tokens(l.tokens)}</td>
                  <td className="r num">{l.tokens ? pct(l.cacheRead / l.tokens) : '—'}</td>
                  <td className="r num us-strong">{money(l.usd)}</td>
                </tr>
                {open === l.lesson && (
                  <tr className="us-drill">
                    <td colSpan={6}>
                      <div className="us-drill-scroll">
                        <Turns turns={l.turns} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Turns({ turns }: { turns: CallEntry[] }) {
  const most = Math.max(...turns.map((t) => t.usd), 1e-9)
  return (
    <table className="us-table us-turns">
      <thead>
        <tr>
          <th>Time</th>
          <th>Model</th>
          <th>Job</th>
          <th className="r">Input</th>
          <th className="r">Output</th>
          <th className="r">Cache read</th>
          <th className="r">Cache write</th>
          <th className="r">First token</th>
          <th className="r">Took</th>
          <th className="r">API price</th>
        </tr>
      </thead>
      <tbody>
        {turns.map((t, i) => {
          const name = modelName(t)
          const newDay = i === 0 || new Date(turns[i - 1].at).toDateString() !== new Date(t.at).toDateString()
          return (
            <Fragment key={i}>
              {newDay && (
                <tr className="us-day">
                  <td colSpan={10}>
                    {new Date(t.at).toLocaleDateString('en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long'
                    })}
                  </td>
                </tr>
              )}
              <tr className={t.ok ? '' : 'us-failed'}>
                <td className="num">{clock(t.at)}</td>
                <td className="us-name">
                  <i className="us-sw" style={swatch(name)} />
                  {name}
                </td>
                <td>
                  {jobLabel(t.job)}
                  {t.thread ? ' (thread)' : ''}
                  {!t.ok && <small className="us-bad">failed: {t.err ?? 'error'}</small>}
                  {t.fb && <small className="us-muted"> · {fallbackLabel(t.fb)}</small>}
                </td>
                <td className="r num">{t.ok ? tokens(t.in) : '—'}</td>
                <td className="r num">
                  {t.ok ? tokens(t.out) : '—'}
                  {t.think ? <small className="us-muted"> ({tokens(t.think)} thinking)</small> : null}
                </td>
                <td className="r num">{t.cr ? tokens(t.cr) : '—'}</td>
                <td className="r num">{t.cw ? tokens(t.cw) : '—'}</td>
                <td className="r num">{secs(t.ttft)}</td>
                <td className="r num">{secs(t.ms)}</td>
                <td className="r num">
                  <span className="us-cost">
                    <span className="us-cost-bar" style={{ width: `${(t.usd / most) * 100}%` }} aria-hidden="true" />
                    {t.p === 'local' ? 'free' : t.ok ? money(t.usd) : '—'}
                  </span>
                </td>
              </tr>
            </Fragment>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={10} className="us-muted">
            {turns.length} calls, {tokens(turns.reduce((n, t) => n + tokensOf(t), 0))} tokens in all
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

// ---------- Fallbacks, Gemma ----------

function Reasons({ title, rows, none, note }: { title: string; rows: ReasonRow[]; none: string; note?: string }) {
  const total = rows.reduce((n, x) => n + x.count, 0)
  return (
    <section className="us-card" aria-label={title}>
      <h3 className="us-h3">
        {title} <span className="us-count">{total}</span>
      </h3>
      {rows.length ? (
        <ul className="us-reasons">
          {rows.map((x) => (
            <li key={x.reason}>
              <span>{x.label}</span>
              <b className="num">{x.count}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="us-muted">{none}</p>
      )}
      {note && rows.length > 0 && <p className="us-muted us-small">{note}</p>}
    </section>
  )
}

function Gemma({ r }: { r: UsageReport }) {
  const g = r.gemma
  return (
    <section className="us-card" aria-labelledby="us-gemma-h">
      <h3 className="us-h3" id="us-gemma-h">
        <i className="us-sw" style={swatch('Gemma')} />
        Gemma on this Mac
      </h3>
      {g.calls ? (
        <dl className="us-facts">
          <div>
            <dt>Calls</dt>
            <dd>{count(g.calls)}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd>{tokens(g.tokens)}</dd>
          </div>
          <div>
            <dt>Time loaded</dt>
            <dd>about {hours(g.loadedMs)}</dd>
          </div>
          <div>
            <dt>First token</dt>
            <dd>{secs(g.ttft)}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{rate(g.tps)}</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>free</dd>
          </div>
        </dl>
      ) : (
        <p className="us-muted">Gemma wasn’t used in this period.</p>
      )}
      {g.calls > 0 && (
        <p className="us-muted us-small">
          Time loaded runs from each stretch’s first call to its unload (or the idle timeout).
          {g.estimated ? ` ${g.estimated} of ${g.calls} calls had no token count from the server, so theirs are estimated from the text.` : ''}
          {g.lastAt ? ` Last used ${dayName(g.lastAt)}, ${clock(g.lastAt)}.` : ''}
        </p>
      )}
    </section>
  )
}
