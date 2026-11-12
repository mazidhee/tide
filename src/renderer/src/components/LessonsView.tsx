import { useEffect, useMemo, useState } from 'react'
import type { LessonSummary } from '@shared/lessonLog'
import { MODE_LABEL } from '@shared/session'
import { useApp } from '../state'
import { Icon } from './Icon'

const dayLabel = (ms: number) => {
  const d = new Date(ms)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

const where = (l: LessonSummary) => ('path' in l.scope ? l.scope.path.split('/').pop()?.replace(/\.(md|pdf)$/i, '') : undefined)

/**
 * Past lessons: every lesson kept as it went, latest first. Read one as a page (the whole
 * conversation, without the tutor's working), or carry it on where it stopped.
 */
export function LessonsView() {
  const app = useApp()
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    window.tide.lessons.list().then(setLessons).catch(() => setLessons([]))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (lessons ?? []).filter((l) => !q || `${l.topic} ${l.preview} ${where(l) ?? ''}`.toLowerCase().includes(q))
  }, [lessons, query])
  const byDay = useMemo(() => {
    const out: { day: string; items: LessonSummary[] }[] = []
    for (const l of shown) {
      const day = dayLabel(l.started)
      if (out[out.length - 1]?.day === day) out[out.length - 1].items.push(l)
      else out.push({ day, items: [l] })
    }
    return out
  }, [shown])

  const carryOn = async (l: LessonSummary) => {
    const r = await window.tide.lessons.get(l.id)
    if (!r) return app.toast('That lesson couldn’t be read.', { tone: 'error' })
    // Up to the last reply: a cut-off reply, or an answer that never got one, is left off
    const turns = r.turns.map(({ role, content }) => ({ role, content }))
    while (turns.length && (turns[turns.length - 1].role === 'user' || !turns[turns.length - 1].content.trim())) turns.pop()
    app.setView({ kind: 'session', mode: r.mode, scope: r.scope, topic: r.topic, options: r.options, turns, lesson: r.id, ...(r.threads?.length ? { threads: r.threads } : {}), nonce: Date.now() })
  }

  return (
    <div className="page lessons-page">
      <div className="page-inner">
        <header className="pv-head">
          <div>
            <h1 className="page-title">Past lessons</h1>
            <p className="practice-summary">Every lesson, kept as it went. Read one again, or carry it on where it stopped.</p>
          </div>
          {lessons && lessons.length > 6 && (
            <input className="set-input wide lessons-search" type="search" placeholder="Search lessons" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search lessons" />
          )}
        </header>

        {lessons === null ? null : !lessons.length ? (
          <p className="muted">No lessons yet. Each lesson you start is kept here as it goes.</p>
        ) : !shown.length ? (
          <p className="muted">No lesson matches “{query}”.</p>
        ) : (
          byDay.map((g) => (
            <section key={g.day} className="lessons-day">
              <h2>{g.day}</h2>
              <ul className="lessons-list">
                {g.items.map((l) => (
                  <li key={l.id} className="lessons-row">
                    <button className="lessons-main" onClick={() => l.page && app.openPath(l.page)} disabled={!l.page} title="Read this lesson">
                      <span className="lessons-topic">{l.topic.replace(/^What I already know: /, 'Check: ')}</span>
                      <span className="muted small">
                        {[MODE_LABEL[l.mode] ?? 'Lesson', where(l), l.answers ? `${l.answers} answer${l.answers === 1 ? '' : 's'}` : null, l.finished ? 'finished' : 'not finished'].filter(Boolean).join(', ')}
                      </span>
                      {l.preview && <span className="lessons-preview">{l.preview}</span>}
                    </button>
                    {!l.finished && (
                      <button className="btn small" onClick={() => carryOn(l)}>
                        <Icon name="play" size={12} />
                        Continue
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
