import { useEffect, useState } from 'react'
import type { WorkCard } from '@shared/workProject'
import { REQUEST_MIN } from '@shared/workTask'
import { useApp } from '../state'
import { Icon } from './Icon'
import { PlaceTag } from './PracticeSettings'
import '../styles/workProjects.css'

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Projects › Work: the guided work projects in Projects/Work, in their order, and a new task from work */
export function WorkShelf() {
  const app = useApp()
  const [cards, setCards] = useState<WorkCard[] | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    window.tide.work
      .list()
      .then(setCards)
      .catch(() => setCards([]))
  }, [])
  if (!cards) return null
  return (
    <section className="pq-sec wk-shelf" aria-label="Work projects">
      <div className="pq-sec-head">
        <h3>Work projects</h3>
        {cards.length > 0 && <span className="pq-n">{cards.length}</span>}
        <PlaceTag place="practice" />
        <span className="wk-sp" />
        {!open && (
          <button className="btn small" onClick={() => setOpen(true)}>
            <Icon name="plus" size={13} /> Work through a new task
          </button>
        )}
      </div>
      {open && <NewTask onClose={() => setOpen(false)} onMade={(slug) => app.setView({ kind: 'work', slug })} />}
      {cards.length > 0 && (
        <ol className="wk-list">
          {cards.map((c) => (
            <li key={c.slug}>
              <button className="wk-row" onClick={() => app.setView({ kind: 'work', slug: c.slug })}>
                <span className="wk-n">{c.order < 99 ? c.order : '·'}</span>
                <span className="wk-title">
                  {c.title}
                  {c.fresh && <span className="wk-new">new task</span>}
                </span>
                <span className="wk-meta">
                  {c.steps} steps · {c.answered} of {c.decisions} decisions
                </span>
                {c.done ? <Icon name="check" size={14} /> : <Icon name="chevron" size={14} />}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Paste a request from work; Tide drafts it into a guided project (main/workProjects draftFromRequest) and opens it */
export function NewTask({ onClose, onMade }: { onClose(): void; onMade(slug: string): void }) {
  const app = useApp()
  const [text, setText] = useState('')
  const [from, setFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = text.trim().length >= REQUEST_MIN
  const make = async () => {
    setBusy(true)
    try {
      const r = await window.tide.work.fromRequest({ text, from: from.trim() || undefined })
      app.toast(`“${r.title}” is ready: steps, checkpoints and your tutor.`)
      onMade(r.slug)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
      setBusy(false)
    }
  }
  return (
    <div className="wk-new-task">
      <div className="wk-nt-head">
        <h4>Work through a new task</h4>
        <p>Paste the request as it reached you: the email, message or ticket. Tide turns it into a guided project: the steps to do it in, the judgment calls to make at checkpoints, and a tutor beside you. You do the work; you rehearse it on practice data first.</p>
      </div>
      <textarea className="wk-nt-text" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus placeholder={'e.g. “Hi, can you pull together how many new merchants activated each week since June, split by region? Leadership wants it for Thursday’s review.”'} aria-label="The request" />
      <div className="wk-nt-foot">
        <input className="wk-nt-from" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} placeholder="Who asked (optional): name, role" aria-label="Who asked" />
        <span className="wk-sp" />
        <button className="btn ghost small" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary small" onClick={() => void make()} disabled={!ready || busy}>
          {busy ? 'Planning the project…' : 'Make it a guided project'}
        </button>
      </div>
      <p className="wk-nt-note">{busy ? 'Reading the request and laying out the steps and checkpoints. This takes up to a minute.' : 'The request stays in your notes, in Projects/Work. Leave out customer data and passwords.'}</p>
    </div>
  )
}
