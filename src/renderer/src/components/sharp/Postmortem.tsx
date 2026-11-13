import { useState } from 'react'
import { method } from '@shared/sharpMethods'
import { BOX_DAYS, PM_QUESTIONS, PM_STEPS, type PmAnswers, type PmStep, type Postmortem as PM } from '@shared/sharpPostmortem'
import { Icon } from '../Icon'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * The post-mortem: four short steps, each answered and then questioned once (Opus, Socratic; a
 * fixed probe without Claude), then the card about the method or pattern.
 */
export function Postmortem({ id, kind, claude, onDone }: { id: string; kind: 'problem' | 'incident'; claude: boolean; onDone?(pm: PM): void }) {
  const q = PM_QUESTIONS[kind]
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<PmAnswers>({ stuck: '', tried: '', unlock: '', pattern: '' })
  const [asked, setAsked] = useState<Partial<Record<PmStep, string>>>({})
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ pm: PM; recall: boolean } | null>(null)
  const cur = PM_STEPS[step]

  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError('')
    // A second answer on the same step adds to the first
    const full = answers[cur] ? `${answers[cur]}\n${text}` : text
    setAnswers((a) => ({ ...a, [cur]: full }))
    setDraft('')
    try {
      if (!asked[cur]) {
        const r = await window.tide.sharp.pmTurn(id, cur, full)
        setAsked((a) => ({ ...a, [cur]: r.asked }))
      } else setStep((s) => s + 1)
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await window.tide.sharp.pmFinish(id, answers)
      setDone(r ? { pm: r.postmortem, recall: r.recall } : null)
      if (r) onDone?.(r.postmortem)
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <section className="sh-pmw sh-card-made" aria-live="polite">
        <p className="sh-eyebrow">
          <Icon name="cards" size={13} /> Your card · {done.pm.pattern} · {method(done.pm.method).name}
        </p>
        <div className="sh-card">
          <p className="sh-card-front">{done.pm.card.front}</p>
          <p className="sh-card-back">{done.pm.card.back}</p>
        </div>
        <p className="sh-note">
          {done.recall ? 'In recall, and ' : ''}back in your stream in {BOX_DAYS[0]} days as a fresh problem of this pattern. Written {done.pm.by === 'opus' ? 'with Opus' : done.pm.by === 'gemma' ? 'with Gemma' : 'from your words'}.
        </p>
      </section>
    )

  const allAnswered = PM_STEPS.every((s) => answers[s].trim())
  return (
    <section className="sh-pmw">
      <p className="sh-eyebrow">
        <Icon name="compass" size={13} /> {kind === 'incident' ? 'Blameless post-mortem' : 'Post-mortem'} · five minutes{claude ? ' · Opus asks back' : ''}
      </p>
      <ol className="sh-pm-steps">
        {PM_STEPS.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>
            <span className="sh-pm-n tabular">{i + 1}</span>
            <div className="sh-pm-step">
              <p className="sh-pm-q">{i <= step ? q[s].ask : q[s].label}</p>
              {answers[s] && <p className="sh-pm-a">{answers[s]}</p>}
              {asked[s] && i <= step && <p className="sh-pm-coach">{asked[s]}</p>}
            </div>
          </li>
        ))}
      </ol>
      {step < PM_STEPS.length ? (
        <div className="sh-pm-compose">
          <textarea
            className="sh-input"
            rows={3}
            value={draft}
            placeholder={asked[cur] ? 'Answer the question above, or add nothing and go on' : 'In a sentence or two'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
            }}
            autoFocus
          />
          <div className="sh-actions">
            {asked[cur] && (
              <button className="btn small" disabled={busy} onClick={() => setStep((s) => s + 1)}>
                Next step
              </button>
            )}
            <button className="btn primary small" disabled={busy || !draft.trim()} onClick={() => void send()}>
              {busy ? <span className="spinner small" /> : null}
              {asked[cur] ? 'Add and go on' : 'Send'}
            </button>
          </div>
        </div>
      ) : (
        <div className="sh-actions">
          <button className="btn primary" disabled={busy || !allAnswered} onClick={() => void finish()}>
            {busy ? <span className="spinner small" /> : <Icon name="cards" size={13} />}
            Make the card
          </button>
          <span className="muted small">A card about the method or pattern, never the answer.</span>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  )
}
