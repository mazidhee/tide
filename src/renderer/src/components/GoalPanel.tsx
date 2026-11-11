import { useState } from 'react'
import type { Goal } from '@shared/types'
import { useApp } from '../state'
import { formatDeadline, type GoalPlan, type GoalTopic } from '../lib/goals'
import { Icon } from './Icon'
import { lateText, type Forecast } from '@shared/forecast'

/** The plan for one goal: pace, today's topics, and where review time starts */
export function GoalPanel({ plan, onRemove, compact }: { plan: GoalPlan; onRemove?: () => void; compact?: boolean }) {
  const app = useApp()
  const { goal } = plan
  const left = plan.total - plan.done
  const pace = plan.inReview
    ? `Review time: everything new should be covered. Go over weak topics and sit a mock exam.`
    : plan.overdue
      ? `The deadline has passed with ${left} topic${left === 1 ? '' : 's'} left.`
      : left === 0
        ? 'All done. Review and sit a mock exam.'
        : `${left} topic${left === 1 ? '' : 's'} left over ${plan.studyDays} study day${plan.studyDays === 1 ? '' : 's'}, about ${plan.perDay} a day, then ${plan.reviewDays} days to review.`
  const status = plan.ahead >= 1 ? `${plan.ahead} ahead of pace` : plan.ahead <= -1 ? `${-plan.ahead} behind pace` : 'On pace'

  const act = (t: GoalTopic, mode: 'teach' | 'quiz') =>
    app.setView({ kind: 'session', mode, scope: t.path ? { kind: 'note', path: t.path } : { kind: 'folder', path: goal.notebook }, topic: t.text, nonce: Date.now() })

  return (
    <section className={`goal${compact ? ' compact' : ''}`}>
      <div className="goal-head">
        <div>
          <h3>{goal.name}</h3>
          <p className="goal-pace">{pace}</p>
        </div>
        <div className="goal-side">
          <span className={`goal-status${plan.ahead <= -1 ? ' behind' : plan.ahead >= 1 ? ' ahead' : ''}`}>{status}</span>
          <span className="muted small">
            {plan.done}/{plan.total} by {formatDeadline(goal.deadline)}
          </span>
          {onRemove && (
            <button className="icon-btn small" title="Remove goal" onClick={onRemove}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="goal-track" aria-hidden="true">
        <span className="goal-done" style={{ width: `${(plan.done / Math.max(1, plan.total)) * 100}%` }} />
      </div>
      {(plan.today.length > 0 || (plan.inReview && plan.reviewTopics.length > 0)) && (
        <ul className="goal-today">
          <li className="goal-today-label">{plan.inReview ? 'Review today' : 'Today'}</li>
          {(plan.inReview ? plan.reviewTopics.slice(0, 5) : plan.today).map((t) => (
            <li key={t.text}>
              <span className="goal-topic">{t.text}</span>
              <button className="tool-btn" onClick={() => act(t, 'teach')}>
                <Icon name="tutor" />
                <span>Teach</span>
              </button>
              <button className="tool-btn" onClick={() => act(t, 'quiz')}>
                <Icon name="quiz" />
                <span>Quiz</span>
              </button>
              {t.path && (
                <button className="icon-btn" title="Open note" onClick={() => app.openPath(t.path!)}>
                  <Icon name="note" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!compact && plan.reviewTopics.length > 0 && !plan.inReview && (
        <p className="muted small goal-weak">
          {plan.reviewTopics.length} ticked topic{plan.reviewTopics.length === 1 ? ' is' : 's are'} still weak in quizzes and will come back in review.
        </p>
      )}
    </section>
  )
}

/** Small form for a new goal on a notebook's outline */
export function GoalForm({ notebook, sections, onSave, onCancel }: { notebook: string; sections: string[]; onSave(g: Goal): void; onCancel(): void }) {
  const inMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const [deadline, setDeadline] = useState(inMonth)
  const [section, setSection] = useState('')
  return (
    <form
      className="goal-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ id: Math.random().toString(36).slice(2, 10), name: `${section || notebook} by ${formatDeadline(deadline)}`, notebook, section: section || undefined, deadline, createdAt: Date.now() })
      }}
    >
      <label className="field-inline">
        Cover
        <select value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="">The whole outline</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="field-inline">
        By
        <input type="date" value={deadline} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDeadline(e.target.value)} required />
      </label>
      <button className="btn primary small">Set goal</button>
      <button type="button" className="btn ghost small" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

/**
 * A goal on Home, at a glance: how far along (a ring), how long is left, whether you're on pace
 * (where you are against where you'd be by today), and the next topic, one click from a lesson.
 */
export function GoalCard({ plan, inThings, forecast }: { plan: GoalPlan; inThings?: boolean; forecast?: Forecast }) {
  const app = useApp()
  const { goal } = plan
  const share = plan.total ? plan.done / plan.total : 0
  const expected = plan.total ? Math.min(1, Math.max(0, (plan.done - plan.ahead) / plan.total)) : 0
  const next = (plan.inReview ? plan.reviewTopics : plan.today)[0]
  // At the pace you've actually kept, running late outranks being on the even schedule so far
  const late = !plan.overdue && !plan.inReview && forecast?.state === 'late'
  const status = plan.overdue ? 'Past the deadline' : plan.inReview ? 'Review time' : late ? 'Running late' : plan.ahead >= 1 ? `${plan.ahead} ahead` : plan.ahead <= -1 ? `${-plan.ahead} behind` : 'On pace'
  const tone = plan.overdue || late || plan.ahead <= -1 ? 'behind' : plan.ahead >= 1 ? 'ahead' : 'ok'
  const r = 18
  const c = 2 * Math.PI * r
  return (
    <div className={`goal-card tone-${tone}`} role="button" tabIndex={0} onClick={() => app.setView({ kind: 'notebook', path: goal.notebook })} onKeyDown={(e) => e.key === 'Enter' && app.setView({ kind: 'notebook', path: goal.notebook })}>
      <div className="goal-card-top">
        <svg width="46" height="46" viewBox="0 0 46 46" className="goal-ring" aria-label={`${Math.round(share * 100)}% done`}>
          <circle cx="23" cy="23" r={r} fill="none" stroke="var(--bg-active)" strokeWidth="5" />
          <circle cx="23" cy="23" r={r} fill="none" stroke="var(--primary, var(--accent))" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 23 23)" />
          <text x="23" y="27" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink-soft)">
            {Math.round(share * 100)}%
          </text>
        </svg>
        <div className="goal-card-title">
          <strong>{goal.name}</strong>
          <span className="muted small">
            {plan.overdue ? 'Deadline passed' : `${plan.daysLeft} day${plan.daysLeft === 1 ? '' : 's'} left`} · {formatDeadline(goal.deadline)}
          </span>
        </div>
        <span className={`goal-chip ${tone}`}>{status}</span>
      </div>
      <div className="goal-pace-bar" title={`${plan.done} of ${plan.total} topics; the mark is where an even pace would be today`}>
        <span className="goal-pace-fill" style={{ width: `${share * 100}%` }} />
        <span className="goal-pace-mark" style={{ left: `${expected * 100}%` }} />
      </div>
      {forecast && <ForecastLine forecast={forecast} plan={plan} />}
      <div className="goal-card-foot">
        {next ? (
          <button
            className="goal-next"
            onClick={(e) => {
              e.stopPropagation()
              app.setView({ kind: 'session', mode: plan.inReview ? 'quiz' : 'teach', scope: next.path ? { kind: 'note', path: next.path } : { kind: 'folder', path: goal.notebook }, topic: next.text, nonce: Date.now() })
            }}
            title={plan.inReview ? 'Quiz yourself on it' : 'Start a lesson on it'}
          >
            <span className="muted">{plan.inReview ? 'Review:' : 'Next:'}</span>
            <span className="goal-next-title">{next.text}</span>
            <span className="outline-next-go">
              <Icon name="tutor" size={12} /> {plan.inReview ? 'Quiz' : 'Learn'}
            </span>
          </button>
        ) : (
          <span className="muted small">All topics covered.</span>
        )}
        {inThings && (
          <span className="goal-things" title="This plan's tasks are in Things 4">
            <Icon name="check" size={11} /> Things
          </span>
        )}
      </div>
    </div>
  )
}

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const hours = (h: number) => (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10)

/**
 * The forecast in a sentence: when you'll finish at the pace you've actually kept, against the
 * deadline, and the weekly hours that would land it. Running late, the tutor can rework the plan.
 */
function ForecastLine({ forecast: f, plan }: { forecast: Forecast; plan: GoalPlan }) {
  const app = useApp()
  if (f.state === 'done') return null
  const needed = f.neededWeeklyHours !== null && Number.isFinite(f.neededWeeklyHours) ? `${hours(f.neededWeeklyHours)} h a week` : null
  const text =
    f.state === 'too-soon'
      ? `Too soon to forecast: a week or two of study shows your pace.${needed ? ` About ${needed} finishes it by ${formatDeadline(plan.goal.deadline)}.` : ''}`
      : f.state === 'no-data'
      ? `No study logged on this lately.${needed ? ` About ${needed} finishes it by ${formatDeadline(plan.goal.deadline)}.` : ''}`
      : f.state === 'late'
        ? `At your ${hours(f.weeklyHours)} h a week you’d finish ${day(f.finish!)}, ${lateText(f.daysLate!)} late.${needed ? ` About ${needed} gets you there.` : ''}`
        : f.state === 'early'
          ? `At your ${hours(f.weeklyHours)} h a week you’ll finish ${day(f.finish!)}, ${lateText(-f.daysLate!)} early.`
          : `At your ${hours(f.weeklyHours)} h a week you’ll finish around ${day(f.finish!)}, right on time.`
  return (
    <div className={`goal-forecast ${f.state}`} onClick={(e) => e.stopPropagation()}>
      <span>{text}</span>
      {(f.state === 'late' || f.state === 'no-data') && (
        <button
          className="goal-forecast-fix"
          onClick={() =>
            app.ask(
              `Help me make my plan for "${plan.goal.name}" fit. I have ${plan.total - plan.done} topics left (about ${hours(f.hoursLeft)} hours of study), the deadline is ${plan.goal.deadline}, and lately I've managed ${hours(f.weeklyHours)} hours a week${needed ? `; I'd need about ${needed}` : ''}. Suggest a realistic choice: more hours, a later deadline, or which topics to cut or skim, and tell me what you'd do.`,
              { scope: { kind: 'folder', path: plan.goal.notebook } }
            )
          }
        >
          Make it fit
        </button>
      )}
    </div>
  )
}
