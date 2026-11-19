import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { RUBRIC_LABEL, type ItemMark, type Line, type MockAttempt, type RubricId } from '@shared/interviewMock'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const at = (ms: number) => fmt(Math.floor(ms / 1000))
const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1))

/** A 0–4 score as a short bar and its number */
function Score({ value, label }: { value: number | undefined; label: string }) {
  if (value === undefined) return null
  return (
    <span className="lm-score" title={`${label}: ${value} of 4`}>
      <span className="lm-score-label">{label}</span>
      <span className="lm-score-bar" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < value ? 'on' : ''} />
        ))}
      </span>
      <span className="lm-score-num">{value}</span>
    </span>
  )
}

/** Text with the weak quotes marked: exact match first, then the first few words of the quote */
function Marked({ text, weak }: { text: string; weak: string[] }) {
  const spans = useMemo(() => {
    const lower = text.toLowerCase()
    const found: [number, number][] = []
    for (const w of weak) {
      const q = w.toLowerCase().replace(/[“”"]/g, '').trim()
      let i = lower.indexOf(q)
      let len = q.length
      if (i < 0) {
        const head = q.split(/\s+/).slice(0, 5).join(' ')
        i = head.length > 10 ? lower.indexOf(head) : -1
        len = Math.min(q.length + 10, lower.length - i)
      }
      if (i >= 0) found.push([i, i + len])
    }
    return found.sort((a, b) => a[0] - b[0]).filter((s, k, all) => k === 0 || s[0] >= all[k - 1][1])
  }, [text, weak])
  if (!spans.length) return <>{text}</>
  const out: ReactNode[] = []
  let pos = 0
  spans.forEach(([a, b], k) => {
    out.push(<Fragment key={`t${k}`}>{text.slice(pos, a)}</Fragment>)
    out.push(
      <mark key={`m${k}`} className="lm-weak" title="A weak moment">
        {text.slice(a, b)}
      </mark>
    )
    pos = b
  })
  out.push(<Fragment key="end">{text.slice(pos)}</Fragment>)
  return <>{out}</>
}

const RUBRIC_ORDER: RubricId[] = ['structure', 'specifics', 'ownership', 'risk', 'clarity', 'pace']

/**
 * After the call: the recruiter's feedback in plain words, the overall mark and its change since
 * the last time, three things to fix, each question's marks with time, pace and filler words, the
 * questions they asked at the end, and the transcript with the weak moments marked.
 */
export function LiveMockDebrief({ attempt, delta, onAgain, onHistory, waits }: { attempt: MockAttempt; delta?: { overall: number | null; by: Partial<Record<RubricId, number>> }; onAgain(): void; onHistory(): void; waits?: number[] }) {
  const d = attempt.debrief
  const [tab, setTab] = useState<'marks' | 'transcript'>('marks')
  const weakByItem = new Map(d.items.map((i) => [i.item, i.weak]))
  const persona = attempt.persona
  const avgWait = waits?.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0

  return (
    <div className="lm-debrief">
      <p className="lm-eyebrow">
        Debrief · {attempt.roundName} ·{' '}
        {new Date(attempt.date).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short'
        })}{' '}
        · with {persona.name}
      </p>
      <div className="lm-debrief-head">
        <div className="lm-overall">
          <span className="lm-overall-num">{Number.isFinite(attempt.overall) ? attempt.overall.toFixed(1) : '–'}</span>
          <span className="lm-overall-of">of 4</span>
          {delta?.overall !== null && delta?.overall !== undefined && <span className={`lm-delta${delta.overall > 0 ? ' up' : delta.overall < 0 ? ' down' : ''}`}>{signed(delta.overall)} since last time</span>}
        </div>
        <div className="lm-rubric-row">
          {RUBRIC_ORDER.filter((k) => attempt.scores[k] !== undefined).map((k) => (
            <div key={k} className="lm-rubric">
              <span className="lm-rubric-label">{RUBRIC_LABEL[k]}</span>
              <span className="lm-rubric-val">
                {attempt.scores[k]!.toFixed(1)}
                {delta?.by[k] !== undefined && delta.by[k] !== 0 && <small className={delta.by[k]! > 0 ? 'up' : 'down'}> {signed(delta.by[k]!)}</small>}
              </span>
              <span className="lm-rubric-track" aria-hidden="true">
                <span style={{ width: `${(attempt.scores[k]! / 4) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <section className="lm-feedback">
        <h2 className="lm-h2">Feedback</h2>
        <p className="lm-summary">{d.summary}</p>
        <p className="lm-muted lm-small">
          {d.by === 'claude' ? 'Marked by Claude.' : 'Marked in code (Claude wasn’t available).'} You spoke for {fmt(attempt.durations.speakingSec)} of {fmt(attempt.durations.totalSec)}.
          {d.fillers.total > 0 && ` Filler words: ${d.fillers.total}${d.fillers.top.length ? ` (${d.fillers.top.map(([w, n]) => `“${w}” ${n}`).join(', ')})` : ''}.`}
          {avgWait > 0 && ` The interviewer started replying ${(avgWait / 1000).toFixed(1)} s after you finished, on average.`}
        </p>
      </section>

      <section className="lm-fixes">
        <h2 className="lm-h2">Fix these next time</h2>
        <ol>
          {d.fixes.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ol>
      </section>

      <div className="lm-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'marks'} className={tab === 'marks' ? 'on' : ''} onClick={() => setTab('marks')}>
          Question by question
        </button>
        <button role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? 'on' : ''} onClick={() => setTab('transcript')}>
          Transcript
        </button>
      </div>

      {tab === 'marks' ? (
        <div className="lm-items">
          {d.items.map((i) => (
            <ItemCard key={i.item} i={i} />
          ))}
          {d.askThem && (
            <article className="lm-item">
              <h3 className="lm-item-q">Your questions at the end</h3>
              {d.askThem.asked.length ? (
                <ul className="lm-asked">
                  {d.askThem.asked.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              ) : null}
              <p className={d.askThem.repeated ? 'lm-warn' : 'lm-note'}>{d.askThem.note}</p>
            </article>
          )}
          {d.presentation && (
            <article className="lm-item">
              <h3 className="lm-item-q">The brief’s checklist</h3>
              <p className="lm-muted lm-small">You presented for {fmt(d.presentation.seconds)}.</p>
              <ul className="lm-check">
                {d.presentation.checklist.map((c) => (
                  <li key={c.item} className={c.met ? 'met' : 'missed'}>
                    <span aria-hidden="true">{c.met ? '✓' : '–'}</span> {c.item}
                  </li>
                ))}
              </ul>
            </article>
          )}
        </div>
      ) : (
        <div className="lm-final-transcript">
          {attempt.transcript.map((l: Line, k) => (
            <p key={k} className={`lm-tline ${l.who}`}>
              <span className="lm-tline-who">{l.who === 'them' ? persona.name.split(' ')[0] : 'You'}</span>
              <span className="lm-tline-at">{at(l.at)}</span>
              <span className="lm-tline-text">{l.who === 'you' ? <Marked text={l.text} weak={weakByItem.get(l.item.replace(/#\d+$/, '')) ?? []} /> : l.text}</span>
            </p>
          ))}
        </div>
      )}

      <div className="lm-start">
        <button className="btn primary" onClick={onAgain}>
          Run this round again
        </button>
        <button className="btn ghost" onClick={onHistory}>
          All mocks for this target
        </button>
      </div>
    </div>
  )
}

function ItemCard({ i }: { i: ItemMark }) {
  return (
    <article className="lm-item">
      <h3 className="lm-item-q">{i.kind === 'intro' ? 'Your introduction' : i.kind === 'presentation' ? 'Your presentation' : i.question}</h3>
      <div className="lm-item-scores">
        {RUBRIC_ORDER.map((k) => (
          <Score key={k} value={i.scores[k]} label={RUBRIC_LABEL[k]} />
        ))}
      </div>
      <p className="lm-item-meta">
        {fmt(i.seconds)} · {i.words} words{i.wpm ? ` · ${i.wpm} wpm` : ''}
        {i.fillers ? ` · ${i.fillers} filler${i.fillers === 1 ? '' : 's'}` : ''}
      </p>
      <p className="lm-note">{i.note}</p>
      {i.weak.length > 0 && (
        <ul className="lm-weak-list">
          {i.weak.map((w) => (
            <li key={w}>
              <mark className="lm-weak">“{w}”</mark>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
