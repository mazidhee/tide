/**
 * A check or quiz from the course you're taking (main/courseQuiz): questions written on the
 * passages you read or watched, each citing where in the course it comes from ("from 3.4, at
 * 12:40 in the video"); answered unaided, marked by Opus against the course's own words. A cite
 * opens the lesson there. With no model, the course's own exercises, marked by you.
 */
import { useEffect, useRef, useState } from 'react'
import { citeLabel, type CourseCite } from '@shared/courseQuiz'
import type { Verdict } from '@shared/types'
import { goto } from '../lib/linkNav'
import { seekPlayer } from '../lib/videoHub'
import { useApp } from '../state'
import { Icon } from './Icon'

type Start = Awaited<ReturnType<typeof window.tide.coursePlan.startQuiz>>
type Result = Awaited<ReturnType<typeof window.tide.coursePlan.submitQuiz>>

const VERDICT_WORD: Record<Verdict, string> = { correct: 'Right', partial: 'Partly', wrong: 'Missed' }

/** Where a question comes from in the course, as a link that opens the lesson at that place */
export function CiteLink({ cite, quote }: { cite: CourseCite; quote?: boolean }) {
  const app = useApp()
  const open = () => {
    const here = app.view.kind === 'courses' && app.view.id === cite.course && app.view.lesson === cite.lesson
    const go = () => {
      if (cite.kind === 'video' && cite.at !== undefined) seekPlayer(cite.at, cite.video)
      else if (cite.section) goto({ section: cite.section })
    }
    if (here) go()
    else {
      app.setView({ kind: 'courses', id: cite.course, lesson: cite.lesson })
      setTimeout(go, 1200)
    }
  }
  return (
    <span className="cq-cite">
      <button className="cq-cite-link" onClick={open} title={`Open ${cite.courseTitle} ${cite.n} there`}>
        <Icon name={cite.kind === 'video' ? 'video' : cite.kind === 'exercise' ? 'note' : 'quote'} size={11} />
        <span>
          {cite.courseTitle}, {citeLabel(cite).replace(/^from /, '')}
        </span>
      </button>
      {quote && cite.quote && <q className="cq-quote">{cite.quote}</q>}
    </span>
  )
}

export function CourseQuiz({ course, lessons, kind, variant = 'sheet', onClose, onDone }: { course: string; lessons?: string[]; kind: 'check' | 'quiz'; variant?: 'sheet' | 'inline'; onClose(): void; onDone?(r: Result): void }) {
  const app = useApp()
  const [start, setStart] = useState<Start | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Result | null>(null)
  const [self, setSelf] = useState<Record<string, Verdict>>({})
  const [busy, setBusy] = useState<'write' | 'mark' | ''>('write')
  const [error, setError] = useState('')
  const first = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let live = true
    setBusy('write')
    window.tide.coursePlan
      .startQuiz({ course, ...(lessons?.length ? { lessons } : {}), kind })
      .then((s) => {
        if (!live) return
        setStart(s)
        setTimeout(() => first.current?.focus(), 30)
      })
      .catch((e) => live && setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => live && setBusy(''))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, (lessons ?? []).join(), kind])

  useEffect(() => {
    if (variant !== 'sheet') return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [variant, busy, onClose])

  const submit = async (marks?: Record<string, Verdict>) => {
    if (!start) return
    setBusy('mark')
    try {
      const r = await window.tide.coursePlan.submitQuiz(start.id, answers, marks)
      setResult(r)
      if (!r.needsSelf) onDone?.(r)
    } catch (e) {
      app.toast(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  const where = start ? (start.lessons.length === 1 ? `${start.lessons[0].n} ${start.lessons[0].title}` : `${[...new Set(start.lessons.map((l) => l.n).filter(Boolean))].join(', ')}`) : ''
  const head = (
    <header className="cq-head">
      <div className="cq-head-text">
        <span className="cq-kicker">{kind === 'check' ? 'Check the lesson' : 'Quiz from the course'}</span>
        <h2 className="cq-title">{start ? `${start.questions.length} question${start.questions.length === 1 ? '' : 's'} from ${where}` : kind === 'check' ? 'Three questions from this lesson' : 'Questions from what you studied'}</h2>
        {start && (
          <p className="cq-sub">
            {start.by === 'tide' ? 'The course’s own exercises and words: no model could write questions just now.' : `Written from the course’s text${start.questions.some((q) => q.cite.kind === 'video') ? ', its video' : ''}${start.questions.some((q) => q.cite.kind === 'exercise') ? ' and its exercises' : ''}. Each says where it comes from.`}{' '}
            {start.marker === 'claude' ? 'Opus marks it.' : start.marker === 'gemma' ? 'Gemma marks it.' : 'You mark it against the course.'}
          </p>
        )}
      </div>
      {variant === 'sheet' && (
        <button className="icon-btn small" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon name="x" size={14} />
        </button>
      )}
    </header>
  )

  let body
  if (error)
    body = (
      <>
        <p className="cq-note">{error}</p>
        <div className="cq-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </>
    )
  else if (busy === 'write' || !start)
    body = (
      <div className="cq-writing" aria-busy="true">
        <span className="spinner" /> Reading the lesson{kind === 'quiz' ? 's you studied' : ''} and writing the questions…
      </div>
    )
  else if (result && !result.needsSelf)
    body = (
      <>
        <p className={`cq-result${result.passed ? ' is-pass' : ''}`}>
          <b>
            {result.score} of {result.total}
          </b>
          <span>{result.passed ? (kind === 'check' ? 'Passed: the lesson is marked done' : 'Well held') : 'Not yet: what you missed comes back for recall'}</span>
          <span className="cq-by">marked by {result.by === 'claude' ? 'Opus' : result.by === 'gemma' ? 'Gemma' : 'you'}</span>
        </p>
        <ol className="cq-marks">
          {result.marks.map((m) => (
            <li key={m.id} className={`is-${m.verdict}`}>
              <span className="cq-verdict">{VERDICT_WORD[m.verdict]}</span>
              <p className="cq-q">{m.question}</p>
              {m.feedback && <p className="cq-fb">{m.feedback}</p>}
              <CiteLink cite={m.cite} quote />
            </li>
          ))}
        </ol>
        <div className="cq-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </>
    )
  else
    body = (
      <>
        {result?.needsSelf && <p className="cq-note">No model could mark this. Mark each answer against the course’s words, honestly.</p>}
        <ol className="cq-qs">
          {start.questions.map((q, i) => (
            <li key={q.id}>
              <p className="cq-q">{q.question}</p>
              <CiteLink cite={q.cite} />
              {result?.needsSelf ? (
                <>
                  <p className="cq-a">{answers[q.id] || 'No answer.'}</p>
                  {result.answers?.[q.id] && <p className="cq-fb">{result.answers[q.id]}</p>}
                  <div className="segmented text cq-self">
                    {(['correct', 'partial', 'wrong'] as Verdict[]).map((v) => (
                      <button key={v} className={self[q.id] === v ? 'on' : ''} onClick={() => setSelf({ ...self, [q.id]: v })}>
                        {v === 'correct' ? 'Got it' : v === 'partial' ? 'Partly' : 'Missed'}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <textarea
                  ref={i === 0 ? first : undefined}
                  className="cq-input"
                  rows={3}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && Object.values(answers).some((a) => a.trim())) void submit()
                  }}
                  placeholder="Your answer, without looking"
                  aria-label={`Answer to question ${i + 1}`}
                />
              )}
            </li>
          ))}
        </ol>
        <div className="cq-actions">
          {result?.needsSelf ? (
            <button className="btn primary" disabled={busy === 'mark' || start.questions.some((q) => !self[q.id])} onClick={() => submit(self)}>
              Save my marks
            </button>
          ) : (
            <button className="btn primary" disabled={busy === 'mark' || !Object.values(answers).some((a) => a.trim())} onClick={() => submit()}>
              {busy === 'mark' ? 'Marking…' : 'Mark it'}
            </button>
          )}
          <span className="cq-hint">{busy === 'mark' ? '' : <><kbd>⌘</kbd><kbd>↵</kbd> marks it</>}</span>
          <button className="link-btn" onClick={onClose}>
            Later
          </button>
        </div>
      </>
    )

  if (variant === 'inline')
    return (
      <section className="cq cq-inline" aria-label={kind === 'check' ? 'Check the lesson' : 'Quiz'}>
        {head}
        {body}
      </section>
    )
  return (
    <div className="cq-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="cq cq-sheet" role="dialog" aria-modal="true" aria-label={kind === 'check' ? 'Check the lesson' : 'Quiz'}>
        {head}
        <div className="cq-body">{body}</div>
      </section>
    </div>
  )
}
