import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStep } from '@shared/types'
import { useApp } from '../state'
import { renderMarkdown } from '../lib/markdown'
import { Icon } from './Icon'
import { PillInput, PromptBox } from './PromptBox'
import { createDesign } from '../lib/designs'
import { companyTrend, TIMED_MINUTES, type InterviewRecord } from '@shared/interviews'

export const PREP_FOLDER = 'Interview prep'
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim()

type Round = 'coding' | 'design' | 'behavioural'
const ROUNDS: { round: Round; label: string }[] = [
  { round: 'coding', label: 'Coding round' },
  { round: 'design', label: 'System design' },
  { round: 'behavioural', label: 'Behavioural' }
]

/**
 * Interview prep for one company: Tide researches how it interviews and drafts a plan (the loop,
 * topic checklists, practice problems), saved as a note. Each plan then runs mock rounds in that
 * company's style, with the plan as the interviewer's brief.
 */
export function CompanyPrep({ language }: { language: string }) {
  const app = useApp()
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('Software Engineer')
  const [notes, setNotes] = useState('')
  const [raw, setRaw] = useState('')
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [phase, setPhase] = useState<'form' | 'drafting' | 'review'>('form')
  const [error, setError] = useState('')
  const runId = useRef<string | null>(null)
  const [timed, setTimed] = useState(() => localStorage.getItem('tide.interview.timed') !== 'off')
  const [history, setHistory] = useState<InterviewRecord[]>([])
  useEffect(() => {
    window.tide.practice.interviews().then(setHistory).catch(() => {})
  }, [app.view])
  const minutes = timed ? TIMED_MINUTES : undefined
  // Each plan's company, from its front matter, to match it with its results
  const [companies, setCompanies] = useState<Record<string, string>>({})

  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        if (e.id !== runId.current) return
        if (e.type === 'delta') setRaw((r) => r + e.text)
        else if (e.type === 'step') setSteps((s) => [...s.filter((x) => x.id !== e.step.id), e.step])
        else if (e.type === 'error') {
          setError(e.message)
          setPhase('form')
          runId.current = null
        } else if (e.type === 'done') {
          runId.current = null
          setPhase('review')
        }
      }),
    []
  )
  useEffect(() => () => void (runId.current && window.tide.practice.cancelCompanyPrep(runId.current)), [])

  const plans = useMemo(
    () => app.files.filter((f) => f.kind === 'note' && f.path.startsWith(PREP_FOLDER + '/')).sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)),
    [app.files]
  )

  const planKey = plans.map((p) => p.path).join('|')
  useEffect(() => {
    let live = true
    Promise.all(plans.map((f) => window.tide.vault.read(f.path).then((raw) => [f.path, raw.match(/^company:\s*(.+)$/m)?.[1].trim()] as const).catch(() => [f.path, undefined] as const))).then((rows) => {
      if (live) setCompanies(Object.fromEntries(rows.filter((r): r is readonly [string, string] => !!r[1])))
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey])

  const draft = () => {
    if (!company.trim()) return
    const id = `prep-${Date.now()}`
    runId.current = id
    setRaw('')
    setSteps([])
    setError('')
    setPhase('drafting')
    window.tide.practice.draftCompanyPrep({ id, company: company.trim(), role: role.trim(), notes }).catch((e) => {
      setError((e as Error).message)
      setPhase('form')
    })
  }

  const save = async () => {
    const name = fileSafe(`${company} ${role}`)
    const taken = new Set(app.files.map((f) => f.path.toLowerCase()))
    let path = `${PREP_FOLDER}/${name}.md`
    for (let i = 2; taken.has(path.toLowerCase()); i++) path = `${PREP_FOLDER}/${name} ${i}.md`
    const body = `---\ncompany: ${company.trim()}\nrole: ${role.trim()}\n---\n\n# ${company.trim()}, ${role.trim()}\n\n${notes.trim() ? `> ${notes.trim()}\n\n` : ''}${raw.trim()}\n`
    try {
      await window.tide.vault.write(path, body)
      await app.refreshTree()
      setPhase('form')
      setRaw('')
      setSteps([])
      app.toast(`Saved the ${company.trim()} plan`, { action: { label: 'Open', run: () => app.openPath(path) } })
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const mock = async (path: string, title: string, round: Round) => {
    const plan = await window.tide.vault.read(path).catch(() => '')
    const name = plan.match(/^company:\s*(.+)$/m)?.[1].trim() || title.split(',')[0].trim()
    if (round === 'design') {
      // System design is drawn: open a canvas, with the plan's notes on what they ask in the brief
      const focus = plan.match(/## System design\n([\s\S]*?)(\n## |$)/)?.[1].replace(/- \[[ x]\] /g, '').trim().split('\n').slice(0, 6).join('; ')
      const canvas = await createDesign(app.files, `${name} design ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`)
      await app.refreshTree()
      app.setView({ kind: 'design', path: canvas, start: 'interview', company: name, timed: minutes, topic: focus ? `They tend to ask about: ${focus}` : undefined, nonce: Date.now() })
      return
    }
    const topic = round === 'coding' ? `a ${name}-style coding problem` : `the stories and values ${name} looks for`
    app.setView({ kind: 'session', mode: 'interview', scope: { kind: 'note', path }, topic, options: { language, round, company: name, difficulty: 'hard', timed: minutes }, nonce: Date.now() })
  }

  const html = useMemo(() => (raw ? renderMarkdown(raw, { notePath: `${PREP_FOLDER}/draft.md`, filesByName: app.filesByName }) : ''), [raw, app.filesByName])

  return (
    <section className="challenge-card company-prep">
      {phase === 'form' ? (
        <PromptBox
          value={company}
          onChange={setCompany}
          onSubmit={draft}
          placeholder="Which company? e.g. Bloomberg, Jane Street, Stripe"
          action="Research"
          tools={
            <>
              <PillInput value={role} onChange={setRole} placeholder="Role" icon="tag" width={140} />
              <PillInput value={notes} onChange={setNotes} placeholder="Interview date, what you know" icon="note" width={220} />
            </>
          }
        />
      ) : (
        <>
          <div className="cp-draft-head">
            <span>{phase === 'drafting' ? `Researching ${company}…` : `${company} plan`}</span>
            <div className="row-gap">
              {phase === 'drafting' ? (
                <button className="btn small" onClick={() => runId.current && window.tide.practice.cancelCompanyPrep(runId.current)}>
                  Stop
                </button>
              ) : (
                <>
                  <button className="btn small" onClick={() => setPhase('form')}>
                    Discard
                  </button>
                  <button className="btn small primary" onClick={save} disabled={!raw.trim()}>
                    Save plan
                  </button>
                </>
              )}
            </div>
          </div>
          {steps.length > 0 && (
            <ul className="nt-steps">
              {steps.map((s) => (
                <li key={s.id} className={s.status}>
                  {s.status === 'running' ? <span className="spinner" /> : <Icon name={s.status === 'error' ? 'x' : 'check'} size={13} />}
                  <span>{s.label}</span>
                  {s.detail && <span className="muted">{s.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          {html && <div className="prose compact cp-preview" dangerouslySetInnerHTML={{ __html: html }} />}
        </>
      )}
      {error && <p className="error-text">{error}</p>}
      {plans.length > 0 && phase === 'form' && (
        <>
          <div className="cp-plans-head">
            <span className="muted small">Mock rounds</span>
            <label className="check" title="Like the real thing: a 45-minute clock and no hints">
              <input
                type="checkbox"
                checked={timed}
                onChange={(e) => {
                  setTimed(e.target.checked)
                  localStorage.setItem('tide.interview.timed', e.target.checked ? 'on' : 'off')
                }}
              />
              Timed, {TIMED_MINUTES} min, no hints
            </label>
          </div>
          <ul className="cp-plans">
            {plans.map((f) => {
              const title = f.name.replace(/\.md$/, '')
              const company = companies[f.path] ?? title
              const trend = companyTrend(history, company)
              return (
                <li key={f.path}>
                  <div className="cp-plan-row">
                    <button className="cp-plan-title" onClick={() => app.openPath(f.path)} title="Open the plan">
                      {title}
                    </button>
                    {ROUNDS.map((r) => (
                      <button key={r.round} className="btn small" onClick={() => mock(f.path, title, r.round)}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {trend.length > 0 && (
                    <div className="cp-trend" aria-label={`${company} results`}>
                      {trend.map((t) => (
                        <span key={t.round} className="cp-trend-item" title={`${t.attempts} ${t.attempts === 1 ? 'round' : 'rounds'}${t.verdict ? `, last verdict: ${t.verdict}` : ''}`}>
                          <span className="muted">{ROUNDS.find((r) => r.round === t.round)?.label ?? 'Quant'}</span>
                          <strong>{Math.round(t.last * 100)}%</strong>
                          {t.change !== null && Math.abs(t.change) >= 0.01 && (
                            <span className={t.change > 0 ? 'cp-up' : 'cp-down'}>
                              {t.change > 0 ? '+' : '−'}
                              {Math.round(Math.abs(t.change) * 100)}
                            </span>
                          )}
                          {t.verdict && <span className={`cp-verdict v-${t.verdict.replace(' ', '-')}`}>{t.verdict}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
