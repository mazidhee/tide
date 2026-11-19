import { useEffect, useState } from 'react'
import { countdown, type TargetSummary } from '@shared/interviewTarget'
import { useApp } from '../../state'
import { Icon } from '../Icon'

/**
 * Practice › Interview prep: the interview targets in the vault, each with its countdown and
 * readiness, and a form for a new one. The Home card shows a target whose day is two weeks away
 * or less.
 */

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`)
const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)

export function InterviewPrepPanel() {
  const app = useApp()
  const [targets, setTargets] = useState<TargetSummary[] | null>(null)
  const [form, setForm] = useState(false)
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [slides, setSlides] = useState('')
  const [sources, setSources] = useState('')
  const [links, setLinks] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    window.tide.interview.list().then(setTargets).catch(() => setTargets([]))
  }, [app.files])

  const create = async () => {
    setError('')
    try {
      const r = await window.tide.interview.create({ company, role, date: date ? (time ? `${date}T${time}` : date) : undefined, slidesDue: slides || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, sources: lines(sources), links: lines(links) })
      await app.refreshTree()
      app.setView({ kind: 'interview', slug: r.slug, nonce: Date.now() })
    } catch (e) {
      setError(clean(e))
    }
  }

  const now = Date.now()
  return (
    <section className="pv-prompt it-prep">
      <h2 className="pv-title">Preparing for a real interview</h2>
      <p className="pv-sub">One company, one date. Tide teaches what they expect, then interviews you until the day.</p>
      {targets && targets.length > 0 && (
        <ul className="it-targets">
          {targets.map((t) => {
            const c = countdown(t.date, now, t.timezone)
            return (
              <li key={t.slug}>
                <button className="it-target" onClick={() => app.setView({ kind: 'interview', slug: t.slug, nonce: Date.now() })}>
                  <span className="it-row-main">
                    <span className="it-row-title">{t.company}</span>
                    <span className="it-row-meta">{[t.role, c?.text].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="it-mini" aria-hidden="true">
                    <span style={{ width: `${(t.readiness ?? 0) * 100}%` }} />
                  </span>
                  <span className="it-row-mark tabular">{pct(t.readiness)}</span>
                  <Icon name="chevron" size={11} className="it-row-go" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {targets && !targets.length && !form && <p className="it-empty">No targets yet. A target is a folder in “Interview prep” with a target.md.</p>}
      {form ? (
        <div className="it-form">
          <label>
            <span>Company</span>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Northwind Capital" autoFocus />
          </label>
          <label>
            <span>Role</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Graduate analyst" />
          </label>
          <div className="it-form-row">
            <label>
              <span>Interview day</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              <span>Time</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label>
              <span>Slides due</span>
              <input type="date" value={slides} onChange={(e) => setSlides(e.target.value)} />
            </label>
          </div>
          <label>
            <span>Sources folder</span>
            <input value={sources} onChange={(e) => setSources(e.target.value)} placeholder="/Users/you/Documents/Job prep (your CV, notes, the brief)" />
          </label>
          <label>
            <span>Links</span>
            <textarea rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="The job posting, your GitHub, the firm’s pages. One per line." />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="it-actions">
            <span className="it-grow" />
            <button className="btn" onClick={() => setForm(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!company.trim()} onClick={create}>
              Create target
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => setForm(true)}>
          <Icon name="plus" size={13} />
          New target
        </button>
      )}
    </section>
  )
}

/** Home: the nearest target within 14 days, its countdown and readiness */
export function InterviewHomeCard({ variant = 'classic' }: { variant?: 'classic' | 'tide' }) {
  const app = useApp()
  const [t, setT] = useState<TargetSummary | null>(null)
  useEffect(() => {
    const now = Date.now()
    window.tide.interview
      .list()
      .then((xs) =>
        setT(
          xs.find((x) => {
            const c = countdown(x.date, now, x.timezone)
            return !!c && !c.past && c.days <= 14
          }) ?? null
        )
      )
      .catch(() => {})
  }, [])
  if (!t) return null
  const c = countdown(t.date, Date.now(), t.timezone)!
  const open = () => app.setView({ kind: 'interview', slug: t.slug, nonce: Date.now() })
  const body = (
    <>
      <p className="it-home-when">
        <strong>{c.days <= 0 ? c.text : `${c.days} day${c.days === 1 ? '' : 's'}`}</strong>
        <span>{c.days > 0 ? 'to go' : ''}{t.role ? ` · ${t.role}` : ''}</span>
      </p>
      <div className="it-home-ready">
        <span className="it-bar-track" aria-hidden="true">
          <span className="it-bar-fill" style={{ width: `${Math.max(2, (t.readiness ?? 0) * 100)}%` }} />
        </span>
        <span className="tabular">{pct(t.readiness)} ready</span>
      </div>
    </>
  )
  if (variant === 'tide')
    return (
      <section className="it-home">
        <div className="td-sec-head first">
          <h2 className="td-sec">{t.company}</h2>
          <button className="td-more" onClick={open}>
            Practise
          </button>
        </div>
        {body}
      </section>
    )
  return (
    <section className="rail-card it-home">
      <div className="rail-head">
        <h2>{t.company}</h2>
        <button className="home-link small" onClick={open}>
          Practise
          <Icon name="chevron" size={10} />
        </button>
      </div>
      {body}
    </section>
  )
}
