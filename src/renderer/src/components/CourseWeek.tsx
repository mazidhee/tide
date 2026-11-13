/**
 * This week's course, from the plan (main/coursePlan): which lessons, how long, why this course,
 * and how far along. Shown in Your week; the Courses page's hero uses the same data.
 */
import { useEffect, useState } from 'react'
import { aboutTime, shortTitle, weekLine } from '@shared/coursePlan'
import { useApp } from '../state'
import { Icon } from './Icon'

export type CourseWeekView = Awaited<ReturnType<typeof window.tide.coursePlan.thisWeek>>[number]

/** This week's courses, kept up as lessons are done (and when the window comes back) */
export function useWeekCourses(key: unknown = null): CourseWeekView[] | null {
  const [weeks, setWeeks] = useState<CourseWeekView[] | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      window.tide.coursePlan
        .thisWeek()
        .then((w) => live && setWeeks(w))
        .catch(() => live && setWeeks([]))
    load()
    window.addEventListener('focus', load)
    return () => {
      live = false
      window.removeEventListener('focus', load)
    }
  }, [key])
  return weeks
}

/** The week's course in Your week: one line on what and why, the lessons as a short list, Open */
export function WeekCourses({ weeks }: { weeks: CourseWeekView[] }) {
  const app = useApp()
  const [why, setWhy] = useState(false)
  if (!weeks.length) return null
  return (
    <section className="wk-course" aria-label="This week’s course">
      {weeks.map((w) => {
        const left = w.lessons.length - w.done.length
        return (
          <div key={w.course} className="wk-course-row">
            <span className="wk-course-icon" aria-hidden="true">
              <Icon name="course" size={16} />
            </span>
            <div className="wk-course-body">
              <span className="wk-course-kicker">This week’s course</span>
              <p className="wk-course-line">
                <b>{weekLine(w).replace(/, because .*$/, '')}</b>
                <span className="muted">, because it covers {w.phaseTitle.replace(/\s*[—–(].*$/, '')}, the phase you’re in.</span>
                {(w.why || w.skipped?.length) && (
                  <button className="link-btn quiet wk-more" onClick={() => setWhy(!why)} aria-expanded={why}>
                    {why ? 'Less' : 'Why this course'}
                  </button>
                )}
              </p>
              {why && (
                <div className="wk-course-why">
                  <p>{w.why}</p>
                  {w.skipped?.map((s) => (
                    <p key={s.title} className="muted">
                      {s.title}: {s.why}
                    </p>
                  ))}
                </div>
              )}
              <ol className="wk-course-lessons">
                {w.lessons.map((l) => (
                  <li key={l.id} className={w.done.includes(l.id) ? 'is-done' : ''}>
                    <button onClick={() => app.setView({ kind: 'courses', id: w.course, lesson: l.id })} title={`Open ${l.n} ${l.title}`}>
                      <span className="wk-course-n">{l.n}</span>
                      <span className="wk-course-t">{l.title}</span>
                      <span className="wk-course-m">{w.done.includes(l.id) ? <Icon name="check" size={11} /> : `${l.minutes} min`}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <div className="wk-course-side">
              <span className="muted small">{left ? `${w.done.length} of ${w.lessons.length} done · ${aboutTime(w.lessons.filter((l) => !w.done.includes(l.id)).reduce((n, l) => n + l.minutes, 0))} left` : 'All done this week'}</span>
              {w.next && (
                <button className="btn small primary" onClick={() => app.setView({ kind: 'courses', id: w.course, lesson: w.next!.id })} title={`${shortTitle(w.title)} ${w.next.n} ${w.next.title}`}>
                  <Icon name="play" size={11} /> {w.done.length ? 'Resume' : 'Start'} {w.next.n}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
