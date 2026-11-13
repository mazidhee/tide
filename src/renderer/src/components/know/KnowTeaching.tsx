import { useEffect, useState, type ReactNode } from 'react'
import { rubricLabel, RUBRIC_IDS, type AdjustmentState, type LessonReview, type TeachingView } from '@shared/teachingAdjust'
import { CALIBRATION_MIN, CONFIDENCE_LABEL, type Calibration, type MisconceptionRecord, type WeekHints } from '@shared/teachingQuality'
import { useApp } from '../../state'

/**
 * How Tide is teaching you: the measures from your real lessons (shared/teachingQuality), Opus's
 * reviews of finished lessons, and the adjustments Tide makes to its teaching because of them,
 * each with an off switch. Everything except the reviews is worked out from what happened, so it
 * reads the same whichever model taught. Charts follow lib/labChart's conventions: one value axis
 * from zero, thin marks in the --series tokens, text in the ink tokens, exact values on hover or
 * focus, and a table view.
 */

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`)
const short = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const plural = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString('en-GB')} ${x === 1 ? one : many}`
const days = (d: number) => (d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d < 10 ? d.toFixed(1).replace(/\.0$/, '') : Math.round(d)} d`)

export function KnowTeaching() {
  const [data, setData] = useState<TeachingView | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    window.tide.teaching
      .view()
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])
  if (failed) return <p className="tq-empty">The measures couldn’t be read just now.</p>
  if (!data) return <p className="tq-empty">Measuring your lessons…</p>
  return <TeachingBody data={data} setData={setData} />
}

function TeachingBody({ data, setData }: { data: TeachingView; setData(d: TeachingView): void }) {
  const m = data.measures
  if (!m.answers) {
    return (
      <div className="tq">
        <p className="tq-lede">Nothing to measure yet. Once you’ve answered a few questions in a lesson, this page shows how well the teaching is working for you, from what actually happened.</p>
      </div>
    )
  }
  return (
    <div className="tq">
      <p className="tq-lede">
        From <b>{plural(m.lessons, 'lesson')}</b> and <b>{plural(m.answers, 'marked answer')}</b>. Measured from what happened in your lessons, the same whichever model taught.
      </p>
      <Adjustments list={data.adjustments} onChange={setData} />
      <div className="tq-pair">
        <CalibrationCard stated={m.calibration} inferred={m.inferredCalibration} />
        <HintsCard weeks={m.hintWeeks} share={m.hints.share} right={m.hints.right} hinted={m.hints.hinted} dontKnow={m.hints.dontKnow} />
      </div>
      <Misconceptions list={m.misconceptions} />
      <div className="tq-pair">
        <MasteryCard data={data} />
        <RetentionCard data={data} />
      </div>
      <TransferLine data={data} />
      <Reviews data={data} onChange={setData} />
    </div>
  )
}

function Card({ title, id, aside, children, wide }: { title: string; id: string; aside?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`tq-card${wide ? ' wide' : ''}`} aria-labelledby={id}>
      <div className="tq-card-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

// ---------- Adjustments ----------

function Adjustments({ list, onChange }: { list: AdjustmentState[]; onChange(d: TeachingView): void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const flip = (a: AdjustmentState) => {
    setBusy(a.id)
    window.tide.teaching
      .setAdjustment(a.id, a.off)
      .then(onChange)
      .catch(() => {})
      .finally(() => setBusy(null))
  }
  return (
    <Card title="What Tide is changing" id="tq-adj" wide>
      {list.length ? (
        <>
          <p className="tq-say">Tide’s tutor follows these in every lesson, on Claude and on Gemma. Each comes from your measures or a lesson review; switch any of them off.</p>
          <ul className="tq-adj">
            {list.map((a) => (
              <li key={a.id} className={a.active ? 'on' : a.off ? 'off' : 'waiting'}>
                <div className="tq-adj-text">
                  <strong>{a.label}</strong>
                  <span className="tq-adj-line">{a.you}</span>
                  <span className="tq-adj-why">
                    {a.off ? 'Off. ' : !a.active ? 'Waiting: only four are used at once. ' : 'Because: '}
                    {a.why.join('; ')}.
                  </span>
                </div>
                <button type="button" role="switch" aria-checked={!a.off} aria-label={`${a.label}: ${a.off ? 'off' : 'on'}`} disabled={busy === a.id} className={`switch${a.off ? '' : ' on'}`} onClick={() => flip(a)} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="tq-say">No changes yet: nothing in your lessons or their reviews calls for one. Tide teaches as it normally does.</p>
      )}
    </Card>
  )
}

// ---------- A bar chart: one percentage axis, a value per bar, exact values on hover ----------

interface Bar {
  key: string
  label: string
  value: number | null
  /** A reference mark on the same axis (what the bar would be if it matched) */
  ref?: number
  tip: string[]
}

const TICKS = [0, 0.25, 0.5, 0.75, 1]

function PercentBars({ bars, label, refLabel }: { bars: Bar[]; label: string; refLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const bar = hover !== null ? bars[hover] : null
  return (
    <div className="tq-chart" onMouseLeave={() => setHover(null)}>
      <div className="tq-y" aria-hidden="true">
        {[...TICKS].reverse().map((t) => (
          <span key={t}>{pct(t)}</span>
        ))}
      </div>
      <div className="tq-plot" role="img" aria-label={`${label}. The table view lists the numbers.`}>
        <div className="tq-grid" aria-hidden="true">
          {TICKS.map((t) => (
            <span key={t} style={{ bottom: `${t * 100}%` }} />
          ))}
        </div>
        <div className="tq-cols">
          {bars.map((b, i) => (
            <div key={b.key} className={`tq-col${hover === i ? ' on' : ''}`} tabIndex={0} aria-label={`${b.label}: ${b.tip.join(', ')}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              {b.value !== null && <span className="tq-bar" style={{ height: `${Math.max(0.5, b.value * 100)}%` }} />}
              {b.value === null && <span className="tq-nobar">no answers</span>}
              {b.ref !== undefined && refLabel && <span className="tq-ref" style={{ bottom: `${b.ref * 100}%` }} />}
            </div>
          ))}
        </div>
        {bar && (
          <div className={`tq-tip${hover! >= bars.length / 2 && bars.length > 1 ? ' left' : ''}`} style={{ left: `${((hover! + 0.5) / bars.length) * 100}%` }}>
            <strong>{bar.label}</strong>
            {bar.tip.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className="tq-x" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.key}>{b.label}</span>
        ))}
      </div>
    </div>
  )
}

function TableToggle({ table, set }: { table: boolean; set(t: boolean): void }) {
  return (
    <button type="button" className="tq-link" aria-pressed={table} onClick={() => set(!table)}>
      {table ? 'Chart' : 'Table'}
    </button>
  )
}

// ---------- Calibration ----------

function CalibrationCard({ stated, inferred }: { stated: Calibration; inferred?: Calibration }) {
  const [table, setTable] = useState(false)
  // What you said, and what was inferred where you said nothing: shown apart, never mixed
  const both = !!inferred?.answers
  const [which, setWhich] = useState<'stated' | 'inferred'>(both && stated.answers < CALIBRATION_MIN ? 'inferred' : 'stated')
  const c = which === 'inferred' && inferred ? inferred : stated
  const guessed = which === 'inferred'
  const say =
    c.verdict === 'too-few'
      ? guessed
        ? `Only ${plural(c.answers, 'answer')} to infer from so far.`
        : c.answers
          ? `Only ${plural(c.answers, 'answer')} came with how sure you were. Tap Guessing, Unsure or Sure under “How sure were you?” after you answer, and this fills in.`
          : 'None of your answers came with how sure you were yet. Tap Guessing, Unsure or Sure under “How sure were you?” after you answer, and this fills in.'
      : c.verdict === 'overconfident'
        ? `You’re overconfident: right ${pct(Math.abs(c.bias!))} less often than you claim.`
        : c.verdict === 'underconfident'
          ? `You’re underconfident: right ${pct(Math.abs(c.bias!))} more often than you claim.`
          : c.verdict === 'unreliable'
            ? 'About right on average, but how sure you feel doesn’t yet tell your right answers from your wrong ones.'
            : 'Well calibrated: how sure you are matches how often you’re right.'
  const bars: Bar[] = c.levels.map((l) => ({
    key: String(l.level),
    label: l.label,
    value: l.accuracy,
    ref: l.claim,
    tip: l.answers ? [`${pct(l.accuracy)} right of ${plural(l.answers, 'answer')}`, `${l.label} means about ${pct(l.claim)}`] : ['No answers yet']
  }))
  return (
    <Card
      title={guessed ? 'How sure you seemed, and how often you were right' : 'How sure you were, and how often you were right'}
      id="tq-cal"
      aside={
        (c.answers > 0 || both) && (
          <>
            {both && (
              <div className="segmented text tq-which" role="radiogroup" aria-label="Whose confidence">
                <button role="radio" aria-checked={!guessed} className={guessed ? '' : 'on'} onClick={() => setWhich('stated')}>
                  You said
                </button>
                <button role="radio" aria-checked={guessed} className={guessed ? 'on' : ''} onClick={() => setWhich('inferred')}>
                  Inferred
                </button>
              </div>
            )}
            <ul className="tq-legend" aria-label="Key">
              <li>
                <i className="sw-bar" />
                Right
              </li>
              <li>
                <i className="sw-ref" />
                If exactly calibrated
              </li>
            </ul>
            <TableToggle table={table} set={setTable} />
          </>
        )
      }
    >
      <p className="tq-say">
        {guessed && <span className="tq-meta">Inferred on {plural(c.answers, 'answer')} you didn’t rate, from hedging words (“I think”, “maybe”) and how long each answer took. A rough guide, kept apart from what you said. </span>}
        {say}
        {c.brier !== null && c.answers >= 3 && <span className="tq-meta"> Brier score {c.brier.toFixed(2)} (0 is perfect; always saying 50% scores 0.25).</span>}
      </p>
      {!c.answers ? null : table ? (
        <table className="tq-table">
          <thead>
            <tr>
              <th>{guessed ? 'You seemed' : 'You said'}</th>
              <th className="r">Answers</th>
              <th className="r">Right</th>
              <th className="r">Claims</th>
            </tr>
          </thead>
          <tbody>
            {c.levels.map((l) => (
              <tr key={l.level}>
                <td>{CONFIDENCE_LABEL[l.level]}</td>
                <td className="r num">{l.answers}</td>
                <td className="r num">{pct(l.accuracy)}</td>
                <td className="r num">{pct(l.claim)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <PercentBars bars={bars} label="Share right at each confidence, beside what each level claims" refLabel="If exactly calibrated" />
      )}
    </Card>
  )
}

// ---------- Hints ----------

function HintsCard({ weeks, share, right, hinted, dontKnow }: { weeks: WeekHints[]; share: number | null; right: number; hinted: number; dontKnow: number }) {
  const [table, setTable] = useState(false)
  const shown = weeks.slice(-12)
  const bars: Bar[] = shown.map((w) => ({
    key: String(w.start),
    label: short(w.start),
    value: w.share,
    tip: [w.right ? `${w.hinted} of ${plural(w.right, 'right answer')} after a hint` : 'No right answers', ...(w.dontKnow ? [`${w.dontKnow} “I don’t know”`] : [])]
  }))
  return (
    <Card title="Right answers that needed a hint" id="tq-hints" aside={<TableToggle table={table} set={setTable} />}>
      <p className="tq-say">
        {right ? (
          <>
            <b>{pct(share)}</b> overall: {hinted} of {plural(right, 'right answer')}
            {dontKnow ? `, and ${dontKnow} “I don’t know”` : ''}. Lower over time means you need less help.
          </>
        ) : (
          'No right answers yet.'
        )}
      </p>
      {table ? (
        <table className="tq-table">
          <thead>
            <tr>
              <th>Week of</th>
              <th className="r">Right</th>
              <th className="r">After a hint</th>
              <th className="r">Share</th>
            </tr>
          </thead>
          <tbody>
            {[...shown].reverse().map((w) => (
              <tr key={w.start}>
                <td>{short(w.start)}</td>
                <td className="r num">{w.right}</td>
                <td className="r num">{w.hinted}</td>
                <td className="r num">{pct(w.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <PercentBars bars={bars} label="Share of right answers that needed a hint, week by week" />
      )}
    </Card>
  )
}

// ---------- Misconceptions ----------

function Misconceptions({ list }: { list: MisconceptionRecord[] }) {
  const open = list.filter((x) => !x.resolvedAt)
  const done = list.filter((x) => x.resolvedAt)
  const item = (x: MisconceptionRecord) => (
    <li key={x.key}>
      <div className="tq-mis-name">
        <strong>{x.name}</strong>
        {x.recurrences > 0 && <span className="tq-tag warn">came back {x.recurrences === 1 ? 'once' : `${x.recurrences} times`}</span>}
        {x.resolvedAt && <span className="tq-tag good">resolved {short(x.resolvedAt)}</span>}
      </div>
      {x.text && <p>{x.text}</p>}
      <span className="tq-meta">
        {x.topic} · first seen {short(x.firstSeen)}
        {x.lastSeen !== x.firstSeen ? `, last ${short(x.lastSeen)}` : ''}
      </span>
    </li>
  )
  return (
    <Card title="Misconceptions" id="tq-mis" wide>
      {list.length ? (
        <>
          <p className="tq-say">Named by the marker when a wrong answer came from a wrong belief rather than a slip. One counts as resolved once you’ve got its topic right twice since, on a later day.</p>
          <div className="tq-mis-cols">
            <div>
              <h3>Open ({open.length})</h3>
              {open.length ? <ul className="tq-mis">{open.map(item)}</ul> : <p className="tq-meta">None open.</p>}
            </div>
            <div>
              <h3>Resolved ({done.length})</h3>
              {done.length ? <ul className="tq-mis">{done.map(item)}</ul> : <p className="tq-meta">None resolved yet.</p>}
            </div>
          </div>
        </>
      ) : (
        <p className="tq-say">None named yet. When a wrong answer comes from a wrong belief, the marker names it, and it’s tracked here until it’s gone.</p>
      )}
    </Card>
  )
}

// ---------- Time to mastery ----------

function MasteryCard({ data }: { data: TeachingView }) {
  const [all, setAll] = useState(false)
  // Lesson topics first, then the steps of their plans
  const rows = [...data.measures.mastery].sort((a, b) => Number(!!a.parent) - Number(!!b.parent) || b.taughtAt - a.taughtAt)
  const shown = all ? rows : rows.slice(0, 8)
  const done = rows.filter((r) => r.days !== undefined)
  const median = done.length ? [...done].sort((a, b) => a.days! - b.days!)[Math.floor(done.length / 2)].days! : null
  return (
    <Card title="Time to mastery" id="tq-mastery">
      <p className="tq-say">
        From first taught to stable recall: two right answers at least a day apart, or a memory that lasts a week.{' '}
        {done.length ? (
          <>
            <b>{done.length}</b> of {plural(rows.length, 'topic')} there, typically in <b>{days(median!)}</b>.
          </>
        ) : rows.length ? (
          'None there yet.'
        ) : (
          ''
        )}
      </p>
      {rows.length > 0 && (
        <table className="tq-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th className="r">Taught</th>
              <th className="r">Answers</th>
              <th className="r">Mastered</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="tq-name">
                  {r.name}
                  {r.parent && <span className="tq-meta"> · a step</span>}
                </td>
                <td className="r num">{short(r.taughtAt)}</td>
                <td className="r num">{r.answers}</td>
                <td className="r num">{r.days !== undefined ? `after ${days(r.days)}` : <span className="tq-meta">not yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > 8 && (
        <button type="button" className="tq-link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </Card>
  )
}

// ---------- Retention ----------

function RetentionCard({ data }: { data: TeachingView }) {
  const r = data.measures.retention
  const tile = (label: string, w: typeof r.day, when: string) => (
    <div className="tq-tile">
      <span className="tq-tile-label">{label}</span>
      <span className="tq-tile-value">{pct(w.share)}</span>
      <span className="tq-meta">{w.asked ? `${plural(w.asked, 'check')}, ${when}` : `no checks ${when} yet`}</span>
    </div>
  )
  return (
    <Card title="Retention" id="tq-ret">
      <p className="tq-say">What a lesson taught, checked again later: a recall question, a retest or an answer in a later lesson.</p>
      <div className="tq-tiles">
        {tile('Next day', r.day, '16 h to 3 days after')}
        {tile('Next week', r.week, '5 to 10 days after')}
      </div>
      {r.concepts.length > 0 && (
        <table className="tq-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th className="r">Taught</th>
              <th className="r">Next day</th>
              <th className="r">Next week</th>
            </tr>
          </thead>
          <tbody>
            {r.concepts.slice(0, 8).map((c) => (
              <tr key={`${c.id}${c.taughtAt}`}>
                <td className="tq-name">{c.name}</td>
                <td className="r num">{short(c.taughtAt)}</td>
                <td className="r num">{c.day === undefined ? '—' : c.day === 1 ? 'right' : c.day === 0 ? 'missed' : 'partly'}</td>
                <td className="r num">{c.week === undefined ? '—' : c.week === 1 ? 'right' : c.week === 0 ? 'missed' : 'partly'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function TransferLine({ data }: { data: TeachingView }) {
  const t = data.measures.transfer
  return (
    <p className="tq-transfer">
      <b>Transfer.</b>{' '}
      {t.tagged
        ? `In a new setting, after learning the idea: near transfer ${t.near.asked ? `${t.near.right} of ${t.near.asked} right first time` : 'not asked yet'}; far transfer ${t.far.asked ? `${t.far.right} of ${t.far.asked}` : 'not asked yet'}.`
        : 'No questions tagged as transfer yet. The tutor now marks the ones that test an idea in a new setting, so this fills in from your next lessons.'}
    </p>
  )
}

// ---------- Reviews ----------

function Reviews({ data, onChange }: { data: TeachingView; onChange(d: TeachingView): void }) {
  const app = useApp()
  const [all, setAll] = useState(false)
  const [asking, setAsking] = useState<string[]>(data.reviewing)
  const ask = (id: string) => {
    setAsking((a) => [...a, id])
    window.tide.teaching
      .review(id)
      .then((r) => {
        if (!r) app.toast('That lesson couldn’t be reviewed just now.')
        return window.tide.teaching.view().then(onChange)
      })
      .catch(() => app.toast('That lesson couldn’t be reviewed just now.'))
      .finally(() => setAsking((a) => a.filter((x) => x !== id)))
  }
  const shown = all ? data.reviews : data.reviews.slice(0, 3)
  return (
    <Card title="Lesson reviews" id="tq-rev" wide>
      <p className="tq-say">
        {data.canReview
          ? 'After a lesson finishes, Opus reads it against a teaching rubric and says what to do differently next time.'
          : 'Reviews need Claude, which isn’t teaching right now. The measures above don’t: they come from your lessons alone.'}
      </p>
      {shown.map((r) => (
        <ReviewItem key={r.lesson} r={r} />
      ))}
      {data.reviews.length > 3 && (
        <button type="button" className="tq-link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${data.reviews.length} reviews`}
        </button>
      )}
      {data.canReview && data.unreviewed.length > 0 && (
        <div className="tq-unrev">
          <h3>Not reviewed yet</h3>
          <ul>
            {data.unreviewed.map((l) => (
              <li key={l.id}>
                <span>
                  {l.topic}{' '}
                  <span className="tq-meta">
                    · {short(l.started)}
                    {l.finished ? '' : ', not finished'}
                  </span>
                </span>
                <button type="button" className="btn small" disabled={asking.includes(l.id)} onClick={() => ask(l.id)}>
                  {asking.includes(l.id) ? 'Opus is reading it…' : 'Review it'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function ReviewItem({ r }: { r: LessonReview }) {
  return (
    <article className="tq-review">
      <header>
        <strong>{r.topic}</strong>
        <span className="tq-meta">
          taught {short(r.taught)} · reviewed {short(r.at)}
        </span>
      </header>
      {r.summary && <p>{r.summary}</p>}
      <dl className="tq-rubric">
        {RUBRIC_IDS.map((id) => {
          const s = r.scores[id]
          return (
            <div key={id}>
              <dt>{rubricLabel(id)}</dt>
              <dd>
                {s === null ? (
                  <span className="tq-meta">n/a</span>
                ) : (
                  <>
                    <span className="tq-pips" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((k) => (
                        <i key={k} className={k <= s ? (s <= 2 ? 'low' : 'on') : ''} />
                      ))}
                    </span>
                    <span className="num">{s}/5</span>
                  </>
                )}
              </dd>
              {r.notes[id] && <span className="tq-note">{r.notes[id]}</span>}
            </div>
          )
        })}
      </dl>
      {r.nextTime.length > 0 && (
        <div className="tq-next">
          <h4>Next time</h4>
          <ol>
            {r.nextTime.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </div>
      )}
    </article>
  )
}
