import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, categoryInfo, difficultyWords, type SharpCategory, type StreamItem } from '@shared/sharpness'
import { method, METHODS } from '@shared/sharpMethods'
import { PM_QUESTIONS, PM_STEPS, type Postmortem } from '@shared/sharpPostmortem'
import type { CategoryStatus, SharpStatus } from '../../../../main/sharpness'
import { useApp } from '../../state'
import { Icon, type IconName } from '../Icon'
import { PillSegment } from '../PromptBox'

export const CATEGORY_ICON: Record<SharpCategory, IconName> = { algorithms: 'subAlgorithms', design: 'subSystems', production: 'bug', ml: 'subLearning', quant: 'subStatistics', proofs: 'subMaths' }

const when = (t: number) => {
  const d = Math.round((Date.now() - t) / 86_400_000)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** A small rating trend: one line in --series-1, the latest point marked */
function Spark({ points, label }: { points: { at: number; r: number }[]; label: string }) {
  if (points.length < 2) return <span className="sh-spark-empty">{points.length ? 'One attempt' : '—'}</span>
  const W = 120
  const H = 30
  const lo = Math.min(...points.map((p) => p.r)) - 10
  const hi = Math.max(...points.map((p) => p.r)) + 10
  const x = (i: number) => 2 + ((W - 6) * i) / (points.length - 1)
  const y = (r: number) => H - 3 - ((H - 6) * (r - lo)) / Math.max(1, hi - lo)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('')
  const last = points[points.length - 1]
  return (
    <svg className="sh-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${points.map((p) => Math.round(p.r)).join(', ')}`}>
      <path d={d} />
      <circle cx={x(points.length - 1)} cy={y(last.r)} r={2.6} />
    </svg>
  )
}

function StreamRow({ item, onStart }: { item: StreamItem; onStart(): void }) {
  const info = categoryInfo(item.category)
  const title = item.kind === 'revisit' ? `Revisit: ${item.card?.pattern}` : item.kind === 'incident' ? 'An incident drill' : `An unseen ${info.short} problem`
  return (
    <li>
      <button className="sh-stream-row" onClick={onStart}>
        <span className="sh-cat-icon" aria-hidden="true">
          <Icon name={item.kind === 'revisit' ? 'refresh' : CATEGORY_ICON[item.category]} size={16} />
        </span>
        <span className="sh-stream-main">
          <span className="sh-stream-title">{title}</span>
          <span className="sh-stream-sub">
            {info.label} · {difficultyWords(item.category, item.difficulty)} · {info.minutes} min
          </span>
        </span>
        <span className="sh-stream-why">
          {item.why !== 'Not tried yet' && item.why !== title && <span>{item.why}</span>}
          {item.method && <span className="sh-train">Trains: {method(item.method).name.toLowerCase()}</span>}
        </span>
        <span className="sh-go">
          Start
          <Icon name="chevron" size={12} />
        </span>
      </button>
    </li>
  )
}

function RatingRow({ c }: { c: CategoryStatus }) {
  const info = categoryInfo(c.id)
  // The next bar not yet met, else the highest one
  const bar = c.benchmarks.find((b) => !b.met) ?? c.benchmarks[c.benchmarks.length - 1]
  const met = c.benchmarks.filter((b) => b.met)
  return (
    <tr>
      <th scope="row">
        <span className="sh-rating-name">
          <Icon name={CATEGORY_ICON[c.id]} size={14} />
          {info.label}
        </span>
      </th>
      <td className="tabular sh-rating-num">
        {c.attempts ? (
          <>
            <strong>{c.rating}</strong>
            <span className="sh-band"> ±{c.band}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        <Spark points={c.trend} label={`${info.label} rating`} />
        {c.change !== null && c.change !== 0 && <span className={`sh-change tabular ${c.change > 0 ? 'up' : 'down'}`}>{c.change > 0 ? `+${c.change}` : c.change}</span>}
      </td>
      <td className="sh-bench">
        {met.length > 0 && (
          <span className="sh-met">
            <Icon name="check" size={11} /> {met[met.length - 1].label}
          </span>
        )}
        {bar && (!bar.met || !met.length) && (
          <>
            <span className="sh-bench-bar">{bar.label}</span>
            <BenchSay say={bar.say} />
          </>
        )}
      </td>
    </tr>
  )
}

/** "Not enough attempts yet: 2 of 5." as five dots, two filled; anything else as it is */
function BenchSay({ say }: { say: string }) {
  const m = /^Not enough attempts yet: (\d+) of (\d+)\.?$/.exec(say)
  if (!m) return <span className="sh-bench-say">{say}</span>
  const n = +m[1]
  const of = +m[2]
  return (
    <span className="sh-bench-dots" role="img" aria-label={say} title={`${n} of ${of} rated attempts before Tide estimates this`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  )
}

function PostmortemItem({ pm }: { pm: Postmortem }) {
  const [open, setOpen] = useState(false)
  const q = PM_QUESTIONS[pm.kind]
  return (
    <li className={`sh-pm${open ? ' open' : ''}`}>
      <button className="sh-pm-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={CATEGORY_ICON[pm.category]} size={14} />
        <span className="sh-pm-title">{pm.title}</span>
        <span className="sh-pm-pattern">{pm.pattern}</span>
        <span className="sh-chip">{method(pm.method).name}</span>
        <span className="sh-pm-when">{when(pm.at)}</span>
        <Icon name="chevron" size={11} className="sh-pm-caret" />
      </button>
      <p className="sh-pm-card">{pm.card.front}</p>
      {open && (
        <div className="sh-pm-body">
          <dl>
            {PM_STEPS.map((s) => (
              <div key={s}>
                <dt>{q[s].label}</dt>
                <dd>{pm.answers[s] || '—'}</dd>
              </div>
            ))}
            <div>
              <dt>The card’s answer</dt>
              <dd>{pm.card.back}</dd>
            </div>
          </dl>
        </div>
      )}
    </li>
  )
}

function HowButton({ open, onClick, label }: { open: boolean; onClick(): void; label: string }) {
  return (
    <button className={`sh-how${open ? ' on' : ''}`} onClick={onClick} aria-expanded={open} title={label}>
      <Icon name="quiz" size={13} />
      <span className="sr-only">{label}</span>
    </button>
  )
}

/** Practice › Sharpness: the stream, the ratings with honest benchmarks, the methods, and the post-mortem library */
export function SharpPanel() {
  const app = useApp()
  const [status, setStatus] = useState<SharpStatus | null>(null)
  const [error, setError] = useState('')
  const [pmFilter, setPmFilter] = useState<SharpCategory | 'all'>('all')
  useEffect(() => {
    window.tide.sharp
      .status()
      .then(setStatus)
      .catch((e) => setError((e as Error).message))
  }, [])
  const start = (category: SharpCategory, extra: { method?: StreamItem['method']; card?: string; bank?: boolean } = {}) => app.setView({ kind: 'sharp', category, ...extra, nonce: Date.now() })
  const pms = useMemo(() => (status?.postmortems ?? []).filter((p) => pmFilter === 'all' || p.category === pmFilter), [status, pmFilter])
  const train = new Set(status?.methods.train ?? [])
  const [how, setHow] = useState<'ratings' | 'methods' | null>(null)

  return (
    <section className="pv-prompt wide sh-panel">
      <p className="sh-who" role="status" title={status?.claude ? 'Opus writes each problem and Tide checks it in the sandbox before you see it. Opus marks, coaches and plays the system in drills.' : status?.why}>
        <Icon name="claude" size={13} />
        {status === null ? 'Checking for Claude…' : status.claude ? 'Written by Opus · checked in the sandbox' : 'Fixed bank · answers checked in code'}
      </p>
      {error && <p className="error-text">{error}</p>}

      <h3 className="sh-h">Up next</h3>
      <ul className="sh-stream">
        {(status?.stream ?? []).map((item, i) => (
          <StreamRow key={`${item.kind}-${item.category}-${i}`} item={item} onStart={() => start(item.category, { method: item.method, card: item.card?.id })} />
        ))}
        {status === null && <li className="sh-stream-loading muted small">Picking what’s next…</li>}
      </ul>
      <div className="sh-any">
        <span className="muted small">Any category</span>
        {CATEGORIES.map((c) => (
          <button key={c.id} className="sh-cat-btn" onClick={() => start(c.id)} title={c.blurb}>
            <Icon name={CATEGORY_ICON[c.id]} size={13} />
            {c.label}
          </button>
        ))}
      </div>

      <div className="sh-h-row">
        <h3 className="sh-h">Ratings</h3>
        <HowButton open={how === 'ratings'} onClick={() => setHow(how === 'ratings' ? null : 'ratings')} label="How ratings work" />
      </div>
      {how === 'ratings' && (
        <p className="sh-note">
          Elo against each problem’s difficulty; ± is how sure it is. Every category starts at 1000 with a wide band. The bars are estimates of how often a first attempt at that level would succeed, said only after 5 rated attempts. Mock interviews count too.
        </p>
      )}
      <div className="sh-table-wrap">
        <table className="sh-ratings">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Rating</th>
              <th scope="col">Trend</th>
              <th scope="col">Against a real bar</th>
            </tr>
          </thead>
          <tbody>
            {(status?.categories ?? []).map((c) => (
              <RatingRow key={c.id} c={c} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="sh-h-row">
        <h3 className="sh-h">Ways in</h3>
        <HowButton open={how === 'methods'} onClick={() => setHow(how === 'methods' ? null : 'methods')} label="How methods are counted" />
      </div>
      {how === 'methods' && <p className="sh-note">Ten methods, after Pólya’s How to Solve It. Tick the ones you used when you submit; Tide counts which ones unlock you and which you never reach for, and trains those.</p>}
      <ul className="sh-methods">
        {METHODS.map((m) => {
          const r = status?.methods.methods.find((x) => x.id === m.id)
          return (
            <li key={m.id} className={`sh-method${train.has(m.id) ? ' train' : ''}`}>
              <span className="sh-method-name">{m.name}</span>
              <span className="sh-method-what" title={m.what}>
                {m.what}
              </span>
              <span className="sh-method-counts tabular">
                {train.has(m.id) ? <span className="sh-train">Training</span> : r?.neverReached ? <span className="sh-never">Never reached for</span> : null}
                {r && (r.reached || r.unlocked) ? (
                  <span>
                    used {r.reached}
                    {r.unlocked ? ` · unlocked ${r.unlocked}` : ''}
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="sh-h-row">
        <h3 className="sh-h">Post-mortems</h3>
        {(status?.postmortems.length ?? 0) > 0 && (
          <PillSegment
            label="Show"
            value={pmFilter}
            onChange={(v) => setPmFilter(v as SharpCategory | 'all')}
            options={[{ value: 'all', label: 'All' }, ...CATEGORIES.filter((c) => status?.postmortems.some((p) => p.category === c.id)).map((c) => ({ value: c.id, label: c.short }))]}
          />
        )}
      </div>
      {status && status.cards > 0 && (
        <p className="sh-note sh-cards">
          <b>{status.cards}</b> card{status.cards === 1 ? '' : 's'} · <b>{status.cardsDue}</b> due
        </p>
      )}
      {pms.length ? (
        <ul className="sh-pms">
          {pms.map((pm) => (
            <PostmortemItem key={pm.id} pm={pm} />
          ))}
        </ul>
      ) : (
        status && <p className="sh-empty" title="Where you got stuck, what would have unlocked it, and the pattern, as a card about the method">None yet. A miss brings a five-minute post-mortem.</p>
      )}
    </section>
  )
}
