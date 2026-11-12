/**
 * The lesson map in a lesson (shared/lessonMap): a slim track under the toolbar saying which step
 * this is, what's left and roughly how long, that opens into the teacher's plan; a divider in the
 * lesson where each step starts; the line on a question card saying what it's for; and the card
 * at the end saying how each step went and what's next.
 */
import { useEffect, useId, useState, type CSSProperties } from 'react'
import { minutesLabel, stepOutcome, type Divider, type LessonMap, type MapStep, type Purpose } from '@shared/lessonMap'
import { Icon } from './Icon'

const OPEN_KEY = 'tide.lesson.map'
const lower = (s: string) => s.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase())
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function headline(map: LessonMap): { now: string; left: string | null } {
  const time = minutesLabel(map.minutesLeft)
  if (map.phase === 'probe') return { now: 'Finding where you start', left: 'a few questions, then the plan' }
  if (map.phase === 'finished') return { now: 'Lesson finished', left: [map.minutes !== undefined ? `${Math.max(1, Math.round(map.minutes))} min` : null, map.questions ? plural(map.questions, 'question') : null].filter(Boolean).join(' · ') || null }
  if (map.phase === 'recap') return { now: 'Recap: a final mixed problem or two', left: time }
  const st = map.steps[map.current]
  const checks = map.checksLeft !== undefined ? `${plural(map.checksLeft, 'check')} left in this step` : null
  return { now: `Step ${map.current + 1} of ${map.steps.length}: ${lower(st?.title ?? '')}`, left: [checks, time].filter(Boolean).join(' · ') || null }
}

function stepMeta(s: MapStep, k: number, map: LessonMap): string {
  if (s.state === 'done') return 'done'
  if (s.state === 'skipped') return 'skipped'
  if (k === map.current && map.phase === 'steps') return s.estimate ? `now · about ${s.estimate} min` : 'now'
  return s.estimate ? `about ${s.estimate} min` : ''
}

export function LessonTrack({ map, tutor, nextLesson }: { map: LessonMap; tutor: string; nextLesson?: string | null }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === 'open'
    } catch {
      return false
    }
  })
  const id = useId()
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? 'closed' : 'open')
      } catch {
        // only a preference
      }
      return !o
    })
  // Esc folds the plan when focus is in it
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (!(e.target as HTMLElement | null)?.closest?.('.lm-track')) return
      e.preventDefault()
      toggle()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  const { now, left } = headline(map)
  const planned = map.phase !== 'probe' && map.steps.length > 0
  const cols = { '--lm-cols': `repeat(${map.steps.length}, minmax(0, 1fr)) 52px` } as CSSProperties
  const total = map.steps.length
  const top = (
    <div className="lm-top">
      <b className="lm-now">{now}</b>
      {left && <span className="lm-left">{left}</span>}
      {planned && <Icon name="chevron" size={14} className="lm-chev" />}
    </div>
  )
  if (!planned)
    return (
      <div className="lm-track probe" role="status">
        <div className="lm-btn static">{top}</div>
      </div>
    )
  return (
    <div className={`lm-track${open ? ' open' : ''}`}>
      <button className="lm-btn" aria-expanded={open} aria-controls={id} onClick={toggle} title={open ? 'Fold the plan' : "Open the teacher's plan"}>
        {top}
        <div className="lm-segs" style={cols} aria-hidden="true">
          {map.steps.map((s, k) => {
            const state = s.state === 'done' || s.state === 'skipped' ? s.state : k === map.current && map.phase === 'steps' ? 'now' : 'next'
            return <span key={k} className={`lm-seg ${state}`}>{state === 'now' && <i style={{ width: `${Math.max(4, map.fill * 100)}%` }} />}</span>
          })}
          <span className={`lm-seg end${map.phase === 'finished' ? ' done' : map.phase === 'recap' ? ' now' : ''}`} title="Recap and flashcards">
            {map.phase === 'recap' && <i style={{ width: '50%' }} />}
          </span>
        </div>
        <div className="lm-labels" style={cols} aria-hidden="true">
          {map.steps.map((s, k) => (
            <span key={k} className={k === map.current && map.phase === 'steps' ? 'now' : s.state === 'done' || s.state === 'skipped' ? 'past' : ''}>
              {s.title}
            </span>
          ))}
          <span className={map.phase === 'recap' ? 'now' : ''}>Recap</span>
        </div>
        <span className="lm-sr">
          {map.steps.filter((s) => s.state === 'done' || s.state === 'skipped').length} of {total} steps done.
        </span>
      </button>
      <div className="lm-plan" id={id} role="region" aria-label="The teacher's plan" aria-hidden={!open}>
        <div className="lm-plan-in">
          {map.goal && (
            <p className="lm-goal">
              <small>Where this lesson is heading</small>
              {map.goal}
            </p>
          )}
          <ol className="lm-steps">
            {map.steps.map((s, k) => {
              const cur = k === map.current && map.phase === 'steps'
              return (
                <li key={k} className={s.state === 'done' ? 'done' : s.state === 'skipped' ? 'skipped' : cur ? 'cur' : ''} aria-current={cur ? 'step' : undefined}>
                  <span className="lm-dot">{s.state === 'done' ? <Icon name="check" size={12} /> : s.state === 'skipped' ? <Icon name="minus" size={12} /> : k + 1}</span>
                  <div>
                    <h5>
                      {s.title}
                      {s.added && <span className="lm-added">added</span>}
                    </h5>
                    <p>
                      {s.about}
                      {s.state === 'done' && <span className="lm-passed">{s.about ? ' ' : ''}{s.note ?? (s.checks ? `${s.right} of ${s.checks} right` : 'Passed')}</span>}
                      {s.state === 'skipped' && <span className="lm-skipped">{s.about ? ' ' : ''}Moved to your recall reviews</span>}
                      {cur && s.doneWhen && (
                        <>
                          {s.about && <br />}
                          {s.doneWhen}
                        </>
                      )}
                    </p>
                  </div>
                  <span className="lm-meta">{stepMeta(s, k, map)}</span>
                </li>
              )
            })}
          </ol>
          <div className="lm-finish">
            <b>When it ends:</b> after the step {total} check, then a recap, today's flashcards, and the next lesson on your roadmap{nextLesson ? ` (${lower(nextLesson)})` : ''}.
          </div>
          <p className="lm-why">
            The plan can change: if something doesn't click, {tutor.replace(/^The /, 'the ')} adds a step and the map shows it. Press “I've got this, move on” on a question and that point goes to your recall reviews instead.
          </p>
        </div>
      </div>
    </div>
  )
}

/** Where a step starts in the lesson: the one before it done, and what this one is */
export function StepDivider({ d, total, fresh }: { d: Divider; total: number; fresh: boolean }) {
  return (
    <div className={`lm-turn${fresh ? ' landing' : ''}`} role="separator" aria-label={d.start ? `Step ${d.start.index + 1} of ${total}: ${d.start.title}` : undefined}>
      <div>
        {d.closed && (
          <span className={d.closed.skipped ? 'lm-turn-skip' : 'lm-turn-ok'}>
            {d.closed.skipped ? `Step ${d.closed.index + 1} moved to your reviews: ${lower(d.closed.title)}` : `✓ Step ${d.closed.index + 1} done: ${lower(d.closed.title)}`}
          </span>
        )}
        {d.start && (
          <>
            <b>
              Step {d.start.index + 1} of {total}: {lower(d.start.title)}
            </b>
            {d.start.about && <span>{d.start.about}</span>}
          </>
        )}
        {!d.start && d.closed && <b>Recap</b>}
      </div>
    </div>
  )
}

/** The line on a question card: what it checks, and what getting it right does */
export function AskPurpose({ p, title }: { p: Purpose; title?: string }) {
  const what = p.checking ? `Checking: ${p.checking}` : title && p.step >= 0 ? `Step ${p.step + 1}: ${lower(title)}` : null
  if (!what && !p.next) return null
  return (
    <div className="lm-purpose">
      {what && <b>{what}</b>}
      {p.next && <span>{p.next}</span>}
    </div>
  )
}

export function MoveOnChip({ onMove, disabled }: { onMove(): void; disabled?: boolean }) {
  return (
    <div className="lm-skip">
      <button className="lm-chip" onClick={onMove} disabled={disabled} title="Move on to the next step; this point goes to your recall reviews and isn't marked">
        I've got this, move on
      </button>
    </div>
  )
}

/** The end of a lesson: how each step went, the time and the questions, and what's next */
export function LessonEnd({
  map,
  topic,
  reviewDays,
  flashcards,
  nextLesson,
  onFlashcards,
  onNext,
  onDone
}: {
  map: LessonMap
  topic: string
  reviewDays: Record<number, number>
  flashcards: number | null
  nextLesson: string | null
  onFlashcards(): void
  onNext(): void
  onDone(): void
}) {
  const facts = [map.minutes !== undefined ? plural(Math.max(1, Math.round(map.minutes)), 'minute') : null, map.questions ? plural(map.questions, 'question') : null].filter(Boolean).join(', ')
  return (
    <section className="lm-end" aria-label="Lesson finished">
      <h3>Lesson finished</h3>
      <p className="lm-end-sub">
        {topic}
        {facts ? `. ${facts}.` : '.'}
      </p>
      <ul>
        {map.steps.map((s, k) => {
          const o = stepOutcome(s, reviewDays[k])
          return (
            <li key={k} className={o.solid ? 'solid' : s.state === 'next' ? 'unreached' : 'shaky'}>
              <span className="lm-end-mark" aria-hidden="true">
                {o.solid ? <Icon name="check" size={13} /> : s.state === 'next' ? '–' : '●'}
              </span>
              <span>{s.title}</span>
              <small>{o.label}</small>
            </li>
          )
        })}
      </ul>
      <div className="lm-end-row">
        <button className="btn primary" onClick={onFlashcards}>
          {flashcards ? `Do today's ${plural(flashcards, 'flashcard')}` : "Today's flashcards"}
        </button>
        {nextLesson && (
          <button className="btn" onClick={onNext}>
            Next: {lower(nextLesson)}
          </button>
        )}
        <button className="btn" onClick={onDone}>
          Done for now
        </button>
      </div>
    </section>
  )
}
