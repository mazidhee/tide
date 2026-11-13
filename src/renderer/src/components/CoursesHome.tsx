/**
 * The Courses page's home, "continue first": the course you're in as the hero (where you are, the
 * next lesson by name, one Resume), your other courses under way beside it, the weekly check's
 * finds as one line, then the catalogue as calm shelves by subject. Browse, search and New for
 * you stay in CoursesView; this only arranges what is already known about your courses.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CourseCard, CourseDetail } from '../../../main/courses'
import { SOURCES, mediaOf, sourceOf, suggestCourses } from '@shared/courses'
import { coursePlace, glyphFor, subjectShelves, subjectsOf, timeLeft, type CoursePlace, type SubjectId } from '@shared/courseShelf'
import { parseOutline } from '@shared/outline'
import { Icon } from './Icon'
import { CourseArt } from './CourseArt'

const sourceLabel = (c: CourseCard) => SOURCES[sourceOf(c)].label
const levelLabel = (l: CourseCard['level']) => l.charAt(0).toUpperCase() + l.slice(1)

/** A restrained cover: a small drawing of the subject's process, where it comes from, and a quiet mark */
export function CourseCover({ course, size = 'card', subject }: { course: CourseCard; size?: 'hero' | 'mini' | 'card'; /** The shelf it sits on, when it sits on one */ subject?: SubjectId }) {
  return (
    <span className={`crh-cover ${size}`} aria-hidden="true">
      <CourseArt id={course.id} subject={subject ?? subjectsOf(course)[0] ?? 'other'} />
      {size !== 'mini' && (
        <span className="crh-cover-src">
          {mediaOf(course) !== 'text' && <Icon name="video" size={10} />}
          <span className="crh-cover-src-text">{sourceLabel(course)}</span>
        </span>
      )}
      <span className="crh-cover-glyph">{glyphFor(course)}</span>
    </span>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <span className="crh-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`${done} of ${total} lessons`}>
      <i style={{ width: `${pct > 0 ? Math.max(2, pct) : 0}%` }} />
    </span>
  )
}

/** A course from your roadmaps to start with, when nothing is under way */
function useStarter(cards: CourseCard[]): { course: CourseCard; why: string } | null {
  const [found, setFound] = useState<{ course: CourseCard; why: string } | null>(null)
  useEffect(() => {
    if (!cards.length) return
    let live = true
    ;(async () => {
      const nbs = await window.tide.learn.notebooks().catch(() => [])
      for (const nb of nbs.filter((n) => n.outline)) {
        const md: string = await window.tide.vault.read(nb.outline!).catch(() => '')
        const next = parseOutline(md)
          .lines.flatMap((l) => (l.kind === 'item' && l.checked === false ? [l.text] : []))
          .slice(0, 12)
        const hit = suggestCourses(`${nb.name} ${next.join(' ')}`, 1, cards)[0]
        const card = hit && cards.find((c) => c.id === hit.id)
        if (card) {
          if (live) setFound({ course: card, why: `For your ${nb.name} roadmap${next[0] ? `: next up, ${next[0].replace(/\s+[—–-].*$/, '')}` : ''}` })
          return
        }
      }
      // No roadmap to go on: the best-placed new find, else a beginner course
      const fallback = cards.find((c) => c.suggested && !c.imported) ?? cards.find((c) => !c.imported && c.level === 'beginner')
      if (live && fallback) setFound({ course: fallback, why: fallback.suggested?.why ?? 'A good first course' })
    })()
    return () => {
      live = false
    }
  }, [cards])
  return found
}

export function CoursesHome({
  cards,
  continuing,
  finished,
  suggested,
  busy,
  onOpen,
  onImport,
  onUpdate,
  onLookNew,
  onBrowse,
  finishedList
}: {
  cards: CourseCard[]
  continuing: CourseCard[]
  finished: CourseCard[]
  suggested: CourseCard[]
  busy(c: CourseCard): string | null
  onOpen(c: CourseCard, lesson?: string): void
  onImport(c: CourseCard): void
  onUpdate(c: CourseCard): void
  onLookNew(): void
  onBrowse(subject: SubjectId | 'all'): void
  finishedList: ReactNode
}) {
  const hero = continuing[0] ?? null
  const others = continuing.slice(1)
  const [place, setPlace] = useState<CoursePlace | null>(null)
  const [showFinished, setShowFinished] = useState(false)
  useEffect(() => {
    setPlace(null)
    if (!hero) return
    let live = true
    window.tide.courses
      .get(hero.id)
      .then((d: CourseDetail | null) => live && d?.imported && setPlace(coursePlace(d.imported.outline, d.progress)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [hero?.id, hero?.imported?.done])
  const starter = useStarter(hero ? [] : cards)
  const shelvesBySubject = useMemo(() => subjectShelves(cards), [cards])
  const newNames = suggested.slice(0, 2).map((c) => c.title)

  const heroNext = place?.next ?? (hero?.imported?.next ? { id: hero.imported.next.id, title: hero.imported.next.title } : null)
  const action = (c: CourseCard, label: string, primary = false) => {
    const b = busy(c)
    if (b)
      return (
        <span className="crs-meta crs-busy">
          <span className="spinner" /> {b}…
        </span>
      )
    return (
      <button className={`btn${primary ? ' primary' : ''} crh-act`} onClick={() => (c.imported ? onOpen(c, c.imported.next?.id) : onImport(c))}>
        {primary && <Icon name="play" size={11} />}
        {label}
      </button>
    )
  }

  return (
    <>
      <div className="crh-top">
        {hero ? (
          <section className="crh-now" aria-label="Continue">
            <CourseCover course={hero} size="hero" />
            <div className="crh-now-body">
              <span className="crh-kicker">Continue</span>
              <button className="crh-now-title" onClick={() => onOpen(hero)} title="Open the course outline">
                {hero.title}
              </button>
              <span className="crh-now-where">
                {place ? `Module ${place.module} of ${place.modules} · ${place.moduleTitle}${place.minutesLeft ? ` · ${timeLeft(place.minutesLeft)} left in this module` : ''}` : `${hero.imported!.done} of ${hero.imported!.lessons} lessons`}
              </span>
              {heroNext && (
                <button className="crh-next" onClick={() => onOpen(hero, heroNext.id)}>
                  <span className="crh-next-label">{hero.imported!.done ? 'Next lesson' : 'First lesson'}</span>
                  <span className="crh-next-title">{heroNext.title}</span>
                </button>
              )}
              <div className="crh-now-progress">
                <Progress done={hero.imported!.done} total={hero.imported!.lessons} />
                <span className="crs-meta">
                  {hero.imported!.done} of {hero.imported!.lessons}
                </span>
              </div>
              <div className="crh-now-acts">
                {action(hero, hero.imported!.done ? 'Resume' : 'Start', true)}
                <button className="btn crh-act" onClick={() => onOpen(hero)}>
                  Course outline
                </button>
                {hero.updateAvailable && (
                  <button className="btn crh-act" onClick={() => onUpdate(hero)} disabled={!!busy(hero)}>
                    <Icon name="refresh" size={12} /> Update
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="crh-now start" aria-label="Start a course">
            {starter ? <CourseCover course={starter.course} size="hero" /> : <span className="crh-cover hero" aria-hidden="true" />}
            <div className="crh-now-body">
              <span className="crh-kicker">Start a course</span>
              {starter ? (
                <>
                  <button className="crh-now-title" onClick={() => onOpen(starter.course)}>
                    {starter.course.title}
                  </button>
                  <span className="crh-now-where">
                    {sourceLabel(starter.course)} · {levelLabel(starter.course.level)}
                  </span>
                  <p className="crh-next crh-why">{starter.why}</p>
                  <div className="crh-now-acts">
                    {action(starter.course, 'Import and start', true)}
                    <button className="btn crh-act" onClick={() => onOpen(starter.course)}>
                      Look inside
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="crh-now-where">Open courses, books and lecture series, taught from their own text.</span>
                  <div className="crh-now-acts">
                    <button className="btn primary crh-act" onClick={() => onBrowse('all')}>
                      Browse the catalogue
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        <div className="crh-stack">
          {others.map((c) => (
            <div key={c.id} className="crh-mini">
              <CourseCover course={c} size="mini" />
              <button className="crh-mini-body" onClick={() => onOpen(c, c.imported!.next?.id)} title={c.imported!.next ? `Resume at ${c.imported!.next.title}` : c.title}>
                <span className="crh-mini-title">
                  {c.title}
                  {c.updateAvailable && <span className="crs-badge updated">Updated</span>}
                </span>
                <span className="crh-mini-next">
                  {c.imported!.next ? (c.imported!.done ? `Next: ${c.imported!.next.title}` : `Start with ${c.imported!.next.title}`) : 'Ready to start'}
                  {c.imported!.done > 0 && ` · ${c.imported!.done} of ${c.imported!.lessons}`}
                </span>
                <Progress done={c.imported!.done} total={c.imported!.lessons} />
              </button>
              {c.updateAvailable ? (
                <button className="btn crh-act" onClick={() => onUpdate(c)} disabled={!!busy(c)}>
                  {busy(c) ? <span className="spinner" /> : <Icon name="refresh" size={12} />} Update
                </button>
              ) : (
                action(c, c.imported!.done ? 'Resume' : 'Start')
              )}
            </div>
          ))}
          {suggested.length > 0 && (
            <div className="crh-new">
              <b>{suggested.length} new for you</b>
              <span className="crh-new-names" title={suggested.map((c) => c.title).join(', ')}>
                {newNames.join(', ')}
                {suggested.length > 2 ? '…' : ''}
              </span>
              <button className="btn crh-act" onClick={onLookNew}>
                Look
              </button>
            </div>
          )}
          {!suggested.length && (
            <button className="crh-new quiet" onClick={onLookNew}>
              <span>Nothing new this week</span>
              <span className="crh-new-names">The weekly check looks for new and updated courses</span>
            </button>
          )}
          {finished.length > 0 && (
            <button className="crs-fold crh-finished" aria-expanded={showFinished} onClick={() => setShowFinished((s) => !s)}>
              <Icon name="chevron" size={10} className="crs-fold-chev" />
              Finished ({finished.length})
            </button>
          )}
        </div>
      </div>
      {showFinished && finishedList}

      {shelvesBySubject.map((s) => (
        <section key={s.id} className="crh-shelf" aria-label={s.label}>
          <h2 className="crh-shelf-head">
            {s.label}
            <span className="crs-meta">{s.total}</span>
            <button className="crs-link crh-all" onClick={() => onBrowse(s.id)}>
              All
            </button>
          </h2>
          <ul className="crh-row">
            {s.courses.map((c) => (
              <li key={c.id}>
                <button className="crh-card" onClick={() => onOpen(c)} title={c.covers}>
                  <CourseCover course={c} subject={s.id} />
                  <span className="crh-card-title">
                    {c.title}
                    {c.suggested && <span className="crs-badge new">New</span>}
                  </span>
                  <span className="crh-card-meta">
                    {levelLabel(c.level)}
                    {c.tier === 'personal' ? ' · Personal study' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button className="crs-link crh-browse-all" onClick={() => onBrowse('all')}>
        Browse all {cards.length} courses, with filters
      </button>
    </>
  )
}
