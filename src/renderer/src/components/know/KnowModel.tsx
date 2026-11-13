import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ModelNodeDetail, ModelNodeView, ModelView } from '@shared/learnerModelView'

/**
 * Your model, in What you know: how deep each concept and skill goes (from every lesson, answer,
 * review, build and mock in the learning event log) against where your goals want it, the evidence
 * behind any of them, and a way to put Tide right ("I actually know this"), kept as an event.
 */

const LABEL = ['Not yet', 'Recall', 'Explain', 'Apply', 'Transfer', 'Build or teach', 'Research']
const pct = (x?: number) => (x === undefined ? '' : `${Math.round(x * 100)}%`)
const short = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const plural = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString('en-GB')} ${x === 1 ? one : many}`
const SHOWN = 8

export function KnowModel() {
  const [data, setData] = useState<ModelView | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback((fresh = false) => {
    window.tide.model
      .view(fresh)
      .then((d) => setData(d))
      .catch(() => setFailed(true))
  }, [])
  useEffect(() => load(), [load])
  if (failed) return <p className="tq-empty">Your model couldn’t be read just now.</p>
  if (!data) return <p className="tq-empty">Reading what you’ve done…</p>
  const studied = Object.values(data.counts).reduce((a, b) => a + b, 0)
  if (!data.events) return <p className="tq-lede">Nothing to go on yet. Every lesson, answer, review, build and mock adds to this.</p>
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id))
  const row = (n: ModelNodeView) => <ModelRow key={n.id} n={n} open={open === n.id} onToggle={() => toggle(n.id)} onCorrected={() => load(true)} />
  return (
    <div className="tq km">
      <p className="tq-lede">
        From <b>{plural(data.events, 'learning event')}</b> on <b>{plural(studied, 'concept')}</b>. Depth climbs from recall to apply, transfer to an unseen problem, and building or teaching it; the tick is where your goals want it.
      </p>
      <DepthStrip counts={data.counts} />
      {data.goals.map((g) => (
        <section key={g.id} className="tq-card wide km-card">
          <div className="tq-card-head">
            <h2>{g.name}</h2>
            <span className="tq-meta">
              {g.atTarget} of {plural(g.total, 'concept')} at target{g.begun < g.total ? ` · ${g.begun} begun` : ''}{g.date ? ` · by ${short(Date.parse(g.date))}` : ''}
            </span>
          </div>
          <List items={g.concepts} row={row} />
        </section>
      ))}
      <div className="tq-pair">
        <section className="tq-card km-card">
          <div className="tq-card-head">
            <h2>Skills</h2>
          </div>
          <List items={data.skills.filter((s) => s.events > 0 || s.target !== undefined)} row={row} empty="No skill shows in your work yet." />
        </section>
        <section className="tq-card km-card">
          <div className="tq-card-head">
            <h2>Worth a look</h2>
          </div>
          {data.fading.length > 0 && (
            <>
              <h3>Fading</h3>
              <List items={data.fading} row={row} />
            </>
          )}
          {data.gaps.length > 0 && (
            <>
              <h3>Applied, not yet on an unseen problem</h3>
              <List items={data.gaps} row={row} />
            </>
          )}
          {!data.fading.length && !data.gaps.length && <p className="tq-say">Nothing fading, and no gaps between applying and transferring.</p>}
        </section>
      </div>
      {data.other.length > 0 && (
        <section className="tq-card wide km-card">
          <div className="tq-card-head">
            <h2>Under no goal</h2>
            <span className="tq-meta">{plural(data.other.length, 'concept')} you’ve worked on</span>
          </div>
          <List items={data.other} row={row} />
        </section>
      )}
    </div>
  )
}

function List({ items, row, empty }: { items: ModelNodeView[]; row(n: ModelNodeView): ReactNode; empty?: string }) {
  const [all, setAll] = useState(false)
  if (!items.length) return empty ? <p className="tq-say">{empty}</p> : null
  const shown = all ? items : items.slice(0, SHOWN)
  return (
    <>
      <ul className="km-list">{shown.map(row)}</ul>
      {items.length > SHOWN && (
        <button className="km-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </>
  )
}

function DepthStrip({ counts }: { counts: Record<number, number> }) {
  return (
    <ol className="km-strip" aria-label="Concepts by depth">
      {LABEL.map((l, d) => (
        <li key={d} className={counts[d] ? '' : 'none'}>
          <b>{(counts[d] ?? 0).toLocaleString('en-GB')}</b>
          <span>{l}</span>
        </li>
      ))}
    </ol>
  )
}

function Meter({ depth, target }: { depth: number; target?: number }) {
  return (
    <span className="km-meter" role="img" aria-label={`Depth ${depth} of 6${target !== undefined ? `, target ${target}` : ''}`}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <i key={i} className={`${i <= depth ? 'on' : ''}${target === i ? ' target' : ''}`} />
      ))}
    </span>
  )
}

function ModelRow({ n, open, onToggle, onCorrected }: { n: ModelNodeView; open: boolean; onToggle(): void; onCorrected(): void }) {
  return (
    <li className={`km-row${open ? ' open' : ''}`}>
      <button className="km-line" aria-expanded={open} onClick={onToggle}>
        <span className="km-name">
          {n.name}
          {n.area && <small>{n.area}</small>}
        </span>
        <Meter depth={n.depth} target={n.target} />
        <span className="km-depth">
          {LABEL[n.depth]}
          {n.corrected && <small> · yours</small>}
        </span>
        <span className="km-ret">{pct(n.retention)}</span>
      </button>
      {open && <Detail id={n.id} onCorrected={onCorrected} />}
    </li>
  )
}

function Detail({ id, onCorrected }: { id: string; onCorrected(): void }) {
  const [d, setD] = useState<ModelNodeDetail | null | undefined>(undefined)
  const [fixing, setFixing] = useState(false)
  const [pick, setPick] = useState<number | null>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    let live = true
    window.tide.model
      .node(id)
      .then((x) => live && setD(x))
      .catch(() => live && setD(null))
    return () => {
      live = false
    }
  }, [id])
  if (d === undefined) return <div className="km-detail tq-meta">Reading the evidence…</div>
  if (d === null) return <div className="km-detail tq-meta">No evidence on this one.</div>
  const save = async () => {
    if (pick === null) return
    const next = await window.tide.model.correct(id, pick, note.trim() || undefined).catch(() => null)
    if (next) setD(next)
    setFixing(false)
    setPick(null)
    setNote('')
    onCorrected()
  }
  const shown = d.levels.filter((l) => l.tried || l.level <= Math.max(1, d.node.depth + 1))
  return (
    <div className="km-detail">
      <p className="tq-say">
        Tide has this at <b>{LABEL[d.node.depth]}</b>
        {d.node.target !== undefined && (
          <>
            {' '}
            against a target of <b>{LABEL[d.node.target]}</b>
            {d.targetGoal ? ` (${d.targetGoal})` : d.targetBy && d.targetBy !== 'goals' ? ` (set by ${d.targetBy === 'you' ? 'you' : d.targetBy})` : ''}
          </>
        )}
        .{d.corrected && ` You set it to ${LABEL[d.corrected.depth]} on ${short(d.corrected.at)}; what you’ve done since counts on top.`}
        {d.measures && <span className="km-measures"> {d.measures}.</span>}
      </p>
      <ul className="km-levels">
        {shown.map((l) => (
          <li key={l.level} className={l.reached ? 'on' : ''}>
            <span className="km-tick" aria-hidden>
              {l.reached ? '✓' : '·'}
            </span>
            <span>
              <b>{l.label}</b> {l.reached ? 'shown' : `needs ${l.needs}`}
              {l.tried > 0 && (
                <small>
                  {' '}
                  · {l.credit} from {plural(l.tried, 'try', 'tries')}
                  {l.recent !== null ? `, latest ${pct(l.recent)}` : ''}
                </small>
              )}
            </span>
          </li>
        ))}
      </ul>
      {d.recent.length > 0 && (
        <>
          <h3>What it’s based on</h3>
          <ul className="km-events">
            {d.recent.map((e) => (
              <li key={e.key}>{e.line}</li>
            ))}
          </ul>
        </>
      )}
      {(d.needs.length > 0 || d.usedIn.length > 0) && (
        <p className="tq-meta km-links">
          {d.needs.length > 0 && <>Builds on {d.needs.map((x) => `${x.name} (${LABEL[x.depth].toLowerCase()})`).join(', ')}. </>}
          {d.usedIn.length > 0 && <>Used in {d.usedIn.map((x) => x.name).join(', ')}.</>}
        </p>
      )}
      {fixing ? (
        <div className="km-fix">
          <span className="tq-meta">Where are you really?</span>
          <div className="segmented text" role="group" aria-label="Depth">
            {LABEL.map((l, i) => (
              <button key={i} aria-pressed={pick === i} className={pick === i ? 'on' : ''} onClick={() => setPick(i)}>
                {l}
              </button>
            ))}
          </div>
          <input className="km-note" placeholder="Why, in a few words (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <div className="km-fix-actions">
            <button className="btn small primary" disabled={pick === null} onClick={() => void save()}>
              Save
            </button>
            <button className="btn small ghost" onClick={() => setFixing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        d.kind !== 'goal' && (
          <button className="km-more" onClick={() => setFixing(true)}>
            That’s not right
          </button>
        )
      )}
    </div>
  )
}
