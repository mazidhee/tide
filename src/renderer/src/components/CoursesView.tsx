/**
 * Courses from GitHub (shared/courses, main/courses): the catalogue by area, a course with its
 * modules and your progress through them, and a lesson as the course wrote it, with its notebooks'
 * code runnable here. "Learn" starts a lesson taught from the course's own text (the source-led
 * lessons: the tutor questions and marks, the course explains).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AREAS, areaLabel, moduleProgress, nextLesson, repoUrl, suggestCourses, type CatalogueCourse, type CourseArea, type CourseLesson, type CourseModule, type CourseProgress, type CourseRef } from '@shared/courses'
import type { CourseCard, CourseDetail, ImportPhase, LessonContent } from '../../../main/courses'
import { useApp } from '../state'
import { Icon, type IconName } from './Icon'
import { renderMarkdown, splitFrontmatter } from '../lib/markdown'
import { codeBlockClick } from '../lib/runBlocks'

const AREA_TONE: Record<CourseArea, number> = { data: 3, mlops: 2, ml: 1, dl: 5, cs: 4, systems: 3, swe: 1, design: 2, algo: 4, maths: 5, physics: 2 }
const areaStyle = (a: CourseArea) => ({ '--crs-tone': `var(--a${AREA_TONE[a]}, var(--series-${AREA_TONE[a]}))` }) as React.CSSProperties

const KIND_LABEL: Record<CatalogueCourse['kind'], string> = { course: 'Course', book: 'Book', notes: 'Notes', projects: 'Projects', guide: 'Guide' }
const LESSON_ICON: Record<CourseLesson['kind'], IconName> = { reading: 'article', notebook: 'terminal', homework: 'edit' }
const LESSON_LABEL: Record<CourseLesson['kind'], string> = { reading: 'Reading', notebook: 'Notebook', homework: 'Homework' }

const minutes = (words: number) => Math.max(1, Math.round(words / 200))
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const PHASE_LABEL: Record<ImportPhase['phase'], string> = { fetching: 'Downloading', reading: 'Reading the lessons', indexing: 'Indexing for search', done: 'Ready', error: 'Failed' }

/** A lesson's name as a topic: a lesson called only "Introduction" is named by its module and course */
const GENERIC = /^(introduction|intro|overview|about the course|lessons?|readme|setup|summary|getting started|conclusion)$/i
export function lessonTopic(c: Pick<CatalogueCourse, 'title'>, m: Pick<CourseModule, 'title'>, l: Pick<CourseLesson, 'title'>): string {
  if (!GENERIC.test(l.title.trim())) return l.title
  return GENERIC.test(m.title.trim()) ? `${c.title}: ${l.title}` : `${m.title} (${c.title})`
}

function Licence({ c, long }: { c: CatalogueCourse; long?: boolean }) {
  return (
    <span className={`crs-licence ${c.tier}`} title={c.licenceNote ?? c.licence}>
      {c.tier === 'open' ? c.licence.replace(/\s*\(.*$/, '') : long ? 'For your own study' : 'Personal study'}
    </span>
  )
}

function Bar({ done, started, total }: { done: number; started?: number; total: number }) {
  const pct = total ? (done / total) * 100 : 0
  const begun = total ? ((started ?? 0) / total) * 100 : 0
  return (
    <span className="crs-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <span className="crs-bar-done" style={{ width: `${pct}%` }} />
      <span className="crs-bar-begun" style={{ left: `${pct}%`, width: `${begun}%` }} />
    </span>
  )
}

function useImports() {
  const [phases, setPhases] = useState<Record<string, ImportPhase>>({})
  useEffect(() => window.tide.courses.onProgress((e) => setPhases((p) => ({ ...p, [e.id]: e }))), [])
  return phases
}

/** Starts a lesson taught from the course's own text */
async function learnLesson(app: ReturnType<typeof useApp>, c: CatalogueCourse, m: CourseModule, l: CourseLesson) {
  const content = await window.tide.courses.lesson(c.id, l.id)
  if (!content) return app.toast('That lesson could not be read. Try updating the course.', { tone: 'error' })
  const course: CourseRef = { id: c.id, title: c.title, by: c.by, lesson: l.id, lessonTitle: l.title, kind: l.kind, steps: content.sections.map((s) => s.title), url: content.url, licence: c.licence }
  app.setView({ kind: 'session', mode: 'teach', scope: { kind: 'none' }, topic: lessonTopic(c, m, l), options: { course }, nonce: Date.now() })
}

export function CoursesView({ id, lesson, area }: { id?: string; lesson?: string; area?: CourseArea }) {
  if (id && lesson) return <LessonReader id={id} lessonId={lesson} />
  if (id) return <CoursePage id={id} />
  return <Catalogue area={area} />
}

// ---------- The catalogue ----------

function Catalogue({ area: initialArea }: { area?: CourseArea }) {
  const app = useApp()
  const [cards, setCards] = useState<CourseCard[] | null>(null)
  const [area, setArea] = useState<CourseArea | 'all'>(initialArea ?? 'all')
  const [q, setQ] = useState('')
  const phases = useImports()
  const load = useCallback(() => window.tide.courses.list().then(setCards).catch(() => setCards([])), [])
  useEffect(() => void load(), [load])
  useEffect(() => {
    if (Object.values(phases).some((p) => p.phase === 'done')) void load()
  }, [phases, load])

  const mine = (cards ?? []).filter((c) => c.imported).sort((a, b) => b.imported!.updatedAt - a.imported!.updatedAt)
  const query = q.trim().toLowerCase()
  const shown = (cards ?? []).filter((c) => (area === 'all' || c.area === area) && (!query || `${c.title} ${c.by} ${c.covers} ${c.topics.join(' ')}`.toLowerCase().includes(query)))
  const counts = useMemo(() => Object.fromEntries(AREAS.map((a) => [a.id, (cards ?? []).filter((c) => c.area === a.id).length])), [cards])

  const importIt = (c: CourseCard) =>
    window.tide.courses
      .import(c.id)
      .then(() => load())
      .catch((e) => app.toast(`Couldn’t import ${c.title}: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, { tone: 'error' }))

  return (
    <div className="doc-view crs-page">
      <div className="crs-scroll">
        <div className="crs-wrap">
          <header className="crs-head">
            <div>
              <h1 className="crs-title">Courses</h1>
              <p className="crs-lede">Open courses from GitHub, taught from their own text. The course explains; the tutor asks, marks and fills the gaps. Imported courses stay on this Mac.</p>
            </div>
            <label className="crs-search">
              <Icon name="search" size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a course" aria-label="Find a course" />
            </label>
          </header>

          {mine.length > 0 && (
            <section className="crs-mine" aria-label="Your courses">
              <h2 className="crs-section">Your courses</h2>
              <ul className="crs-mine-rows">
                {mine.map((c) => (
                  <li key={c.id} style={areaStyle(c.area)}>
                    <button className="crs-mine-row" onClick={() => app.setView({ kind: 'courses', id: c.id })}>
                      <span className="crs-tone-dot" aria-hidden="true" />
                      <span className="crs-mine-name">
                        <span className="crs-mine-title">{c.title}</span>
                        <span className="crs-mine-next">{c.imported!.next ? `Next: ${c.imported!.next.title}` : 'Every lesson done'}</span>
                      </span>
                      <span className="crs-mine-progress">
                        <Bar done={c.imported!.done} total={c.imported!.lessons} />
                        <span className="crs-meta">
                          {c.imported!.done} of {c.imported!.lessons}
                        </span>
                      </span>
                      <Icon name="chevron" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <nav className="crs-areas" aria-label="Areas">
            <button className={`crs-area-chip${area === 'all' ? ' on' : ''}`} onClick={() => setArea('all')}>
              All <span className="crs-count">{cards?.length ?? ''}</span>
            </button>
            {AREAS.map((a) => (
              <button key={a.id} className={`crs-area-chip${area === a.id ? ' on' : ''}`} style={areaStyle(a.id)} onClick={() => setArea(a.id)}>
                <span className="crs-tone-dot" aria-hidden="true" />
                {a.label} <span className="crs-count">{counts[a.id] ?? ''}</span>
              </button>
            ))}
          </nav>

          {!cards ? (
            <p className="crs-meta">Loading…</p>
          ) : !shown.length ? (
            <p className="crs-empty">No course matches “{q}”.</p>
          ) : (
            AREAS.filter((a) => shown.some((c) => c.area === a.id)).map((a) => (
              <section key={a.id} className="crs-area" style={areaStyle(a.id)}>
                <div className="crs-area-head">
                  <h2 className="crs-section">
                    <span className="crs-tone-dot" aria-hidden="true" />
                    {a.label}
                  </h2>
                  <span className="crs-meta">{a.blurb}</span>
                </div>
                <ul className="crs-grid">
                  {shown
                    .filter((c) => c.area === a.id)
                    .map((c) => {
                      const ph = phases[c.id]
                      const busy = ph && ph.phase !== 'done' && ph.phase !== 'error'
                      return (
                        <li key={c.id} className={`crs-card${c.imported ? ' imported' : ''}`}>
                          <button className="crs-card-main" onClick={() => app.setView({ kind: 'courses', id: c.id })}>
                            <span className="crs-card-top">
                              <span className="crs-card-title">{c.title}</span>
                              <span className="crs-card-by">{c.by}</span>
                            </span>
                            <span className="crs-card-covers">{c.covers}</span>
                          </button>
                          <span className="crs-card-foot">
                            <span className="crs-tags">
                              <span>{KIND_LABEL[c.kind]}</span>
                              <span>{c.level.charAt(0).toUpperCase() + c.level.slice(1)}</span>
                              <Licence c={c} />
                            </span>
                            {c.imported ? (
                              <span className="crs-card-state">
                                <Bar done={c.imported.done} total={c.imported.lessons} />
                                <span className="crs-meta">
                                  {c.imported.done}/{c.imported.lessons}
                                </span>
                              </span>
                            ) : busy ? (
                              <span className="crs-card-state crs-meta">
                                <span className="spinner" /> {PHASE_LABEL[ph.phase]}…
                              </span>
                            ) : (
                              <button className="btn small" onClick={() => importIt(c)}>
                                Import
                              </button>
                            )}
                          </span>
                        </li>
                      )
                    })}
                </ul>
              </section>
            ))
          )}
          <p className="crs-foot-note">
            Each course is fetched from GitHub when you import it, read on this Mac and shown with its source and licence. Courses without an open licence are for your own study only.
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------- A course ----------

function CoursePage({ id }: { id: string }) {
  const app = useApp()
  const [d, setD] = useState<CourseDetail | null | undefined>(undefined)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'import' | 'update' | 'save' | 'remove' | null>(null)
  const [known, setKnown] = useState<Map<string, string>>(new Map())
  const phases = useImports()
  const phase = phases[id]
  const load = useCallback(() => window.tide.courses.get(id).then(setD).catch(() => setD(null)), [id])
  useEffect(() => void load(), [load])

  // What the knowledge map already says about the course's lessons
  useEffect(() => {
    if (!d?.imported) return
    window.tide.knowledge
      .view()
      .then((v) => {
        const m = new Map<string, string>()
        for (const c of v.concepts) if (c.area === d.course.title && c.status !== 'new') m.set(c.name.toLowerCase(), c.status)
        setKnown(m)
      })
      .catch(() => {})
  }, [d?.imported, d?.course.title])

  const outline = d?.imported?.outline
  const progress = d?.progress ?? {}
  const next = outline ? nextLesson(outline, progress) : null
  // The module you're in opens by itself
  useEffect(() => {
    if (next) setOpen((o) => (o.size ? o : new Set([next.module.id])))
  }, [next?.module.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (kind: NonNullable<typeof busy>, f: () => Promise<unknown>) => {
    setBusy(kind)
    try {
      await f()
      await load()
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const back = (
    <button className="crs-back" onClick={() => app.setView({ kind: 'courses' })}>
      <Icon name="back" size={14} />
      Courses
    </button>
  )
  if (d === undefined) return <Shell>{back}</Shell>
  if (!d) return <Shell>{back}<p className="crs-empty">That course isn’t in the catalogue.</p></Shell>
  const c = d.course
  const total = outline?.lessons ?? 0
  const done = outline ? outline.modules.reduce((n, m) => n + moduleProgress(m, progress).done, 0) : 0
  const importing = busy === 'import' || busy === 'update' || (phase && phase.phase !== 'done' && phase.phase !== 'error')

  return (
    <Shell>
      {back}
      <header className="crs-course-head" style={areaStyle(c.area)}>
        <p className="crs-kicker">
          <span className="crs-tone-dot" aria-hidden="true" />
          {areaLabel(c.area)} · {KIND_LABEL[c.kind]} · {c.level.charAt(0).toUpperCase() + c.level.slice(1)}
        </p>
        <h1 className="crs-title">{c.title}</h1>
        <p className="crs-byline">
          By {c.by} ·{' '}
          <a className="external" href={repoUrl(c)} target="_blank" rel="noreferrer">
            github.com/{c.repo}
          </a>
        </p>
        <p className="crs-lede">{c.covers}.</p>
        <p className="crs-licence-line">
          <Licence c={c} long />
          <span>{c.licenceNote ?? (c.tier === 'open' ? `Openly licensed (${c.licence}): shown with its source and licence.` : c.licence)}</span>
        </p>
      </header>

      {!d.imported ? (
        <section className="crs-import">
          <div>
            <h2 className="crs-section">Import this course</h2>
            <p className="crs-meta">
              Tide downloads its lessons, notebooks and code (not its images or data) with a shallow git clone into its own app data, reads them as {c.kind === 'course' ? 'modules and lessons' : 'chapters'}, and indexes them for search and for your lessons. Nothing goes into your notes unless you ask.
            </p>
          </div>
          <button className="btn primary" disabled={!!importing} onClick={() => act('import', () => window.tide.courses.import(id))}>
            {importing ? (
              <>
                <span className="spinner" /> {phase ? PHASE_LABEL[phase.phase] : 'Starting'}…
              </>
            ) : (
              'Import course'
            )}
          </button>
          {phase?.phase === 'error' && <p className="crs-error">{phase.detail}</p>}
        </section>
      ) : (
        <div className="crs-layout">
          <div className="crs-modules">
            {outline!.modules.map((m, mi) => {
              const p = moduleProgress(m, progress)
              const isOpen = open.has(m.id)
              const single = m.lessons.length === 1 && m.lessons[0].title === m.title
              return (
                <section key={m.id} className={`crs-module${isOpen ? ' open' : ''}${p.done === p.total ? ' complete' : ''}`}>
                  <button className="crs-module-head" aria-expanded={isOpen} onClick={() => setOpen((o) => (o.has(m.id) ? new Set([...o].filter((x) => x !== m.id)) : new Set(o).add(m.id)))}>
                    <span className="crs-module-n">{p.done === p.total ? <Icon name="check" size={12} /> : mi + 1}</span>
                    <span className="crs-module-title">{m.title}</span>
                    <span className="crs-module-progress">
                      <Bar done={p.done} started={p.started} total={p.total} />
                      <span className="crs-meta">
                        {p.done}/{p.total}
                      </span>
                    </span>
                    <Icon name="chevron" size={12} className="crs-chev" />
                  </button>
                  {isOpen && (
                    <ul className="crs-lessons">
                      {m.lessons.map((l) => {
                        const lp = progress[l.id]
                        const k = known.get(lessonTopic(c, m, l).toLowerCase())
                        return (
                          <li key={l.id} className={`crs-lesson${lp?.done ? ' done' : lp ? ' begun' : ''}${next?.lesson.id === l.id ? ' next' : ''}`}>
                            <span className="crs-state" title={lp?.done ? 'Done' : lp ? 'Begun' : 'Not started'} />
                            <button className="crs-lesson-main" onClick={() => app.setView({ kind: 'courses', id, lesson: l.id })}>
                              <Icon name={LESSON_ICON[l.kind]} size={14} />
                              <span className="crs-lesson-title">{single ? LESSON_LABEL[l.kind] : l.title}</span>
                              <span className="crs-meta">
                                {l.kind !== 'reading' ? `${LESSON_LABEL[l.kind]} · ` : ''}
                                {minutes(l.words)} min{lp && (lp.right || lp.partly || lp.wrong) ? ` · ${lp.right} of ${lp.right + lp.partly + lp.wrong} right` : ''}
                                {k ? ` · ${k}` : ''}
                              </span>
                            </button>
                            <button className="btn small crs-learn" onClick={() => void learnLesson(app, c, m, l)} title="A lesson taught from this text: the tutor questions and marks">
                              {lp && !lp.done ? 'Carry on' : 'Learn'}
                            </button>
                          </li>
                        )
                      })}
                      {m.code.length > 0 && (
                        <li className="crs-code-row">
                          <Icon name="terminal" size={13} />
                          <span className="crs-meta">
                            Code: {m.code.slice(0, 4).map((p) => p.split('/').pop()).join(', ')}
                            {m.code.length > 4 ? ` and ${m.code.length - 4} more` : ''}
                          </span>
                        </li>
                      )}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>

          <aside className="crs-rail">
            <div className="crs-rail-block">
              <p className="crs-rail-label">Progress</p>
              <p className="crs-rail-big">
                {done} <span>of {total} lessons</span>
              </p>
              <Bar done={done} total={total} />
              {next ? (
                <button className="btn primary wide" onClick={() => void learnLesson(app, c, next.module, next.lesson)}>
                  {progress[next.lesson.id] ? 'Carry on' : done ? 'Next lesson' : 'Start the course'}
                </button>
              ) : (
                <p className="crs-meta">Every lesson is done.</p>
              )}
              {next && (
                <p className="crs-rail-next">
                  <span className="crs-meta">{next.module.title}</span>
                  <button className="crs-link" onClick={() => app.setView({ kind: 'courses', id, lesson: next.lesson.id })}>
                    {next.lesson.title}
                  </button>
                </p>
              )}
            </div>
            <div className="crs-rail-block">
              <p className="crs-rail-label">On this Mac</p>
              <p className="crs-meta">
                Imported {day(d.imported.importedAt)}
                {d.imported.updatedAt - d.imported.importedAt > 60_000 ? `, updated ${day(d.imported.updatedAt)}` : ''}
                {d.imported.commit ? ` at ${d.imported.commit.slice(0, 7)}` : ''}.
              </p>
              <div className="crs-rail-actions">
                <button className="tool-btn" disabled={!!busy} onClick={() => act('update', () => window.tide.courses.update(id))}>
                  <Icon name="refresh" size={13} /> {busy === 'update' ? `${phase ? PHASE_LABEL[phase.phase] : 'Updating'}…` : 'Update'}
                </button>
                <button
                  className="tool-btn"
                  disabled={!!busy}
                  onClick={() =>
                    act('save', async () => {
                      const r = await window.tide.courses.saveToNotes(id)
                      await app.refreshTree()
                      app.toast(`Saved ${r.files} lessons to ${r.folder}`, { action: { label: 'Open', run: () => app.setView({ kind: 'notebook', path: r.folder }) } })
                    })
                  }
                  title="Copy its lessons into your notes folder, each with its source and licence"
                >
                  <Icon name="note" size={13} /> {busy === 'save' ? 'Saving…' : 'Save to my notes'}
                </button>
                <button
                  className="tool-btn"
                  disabled={!!busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${c.title} from this Mac? Your progress is kept.`)) void act('remove', () => window.tide.courses.remove(id))
                  }}
                >
                  <Icon name="trash" size={13} /> Remove
                </button>
              </div>
            </div>
            <div className="crs-rail-block">
              <p className="crs-rail-label">What you know</p>
              <p className="crs-meta">Lessons you take here count on your knowledge map, under “{c.title}”.</p>
              <button className="crs-link" onClick={() => app.setView({ kind: 'graph', tab: 'know' })}>
                Open the map
              </button>
            </div>
          </aside>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="doc-view crs-page">
      <div className="crs-scroll">
        <div className={`crs-wrap${wide ? '' : ''}`}>{children}</div>
      </div>
    </div>
  )
}

// ---------- A lesson, as the course wrote it ----------

function LessonReader({ id, lessonId }: { id: string; lessonId: string }) {
  const app = useApp()
  const [d, setD] = useState<CourseDetail | null>(null)
  const [content, setContent] = useState<LessonContent | null | undefined>(undefined)
  const [progress, setProgress] = useState<CourseProgress>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setContent(undefined)
    window.tide.courses.get(id).then((x) => {
      setD(x)
      setProgress(x?.progress ?? {})
    })
    window.tide.courses
      .lesson(id, lessonId)
      .then(setContent)
      .catch(() => setContent(null))
    scrollRef.current?.scrollTo({ top: 0 })
  }, [id, lessonId])

  const env = useMemo(() => ({ notePath: '', filesByName: app.filesByName }), [app.filesByName])
  const html = useMemo(() => (content ? renderMarkdown(splitFrontmatter(content.markdown).body, env) : ''), [content, env])
  const outline = d?.imported?.outline
  const flat = outline?.modules.flatMap((m) => m.lessons.map((l) => ({ m, l }))) ?? []
  const at = flat.findIndex((x) => x.l.id === lessonId)
  const here = flat[at]
  const prev = at > 0 ? flat[at - 1] : null
  const next = at >= 0 && at < flat.length - 1 ? flat[at + 1] : null
  const c = d?.course
  const done = !!progress[lessonId]?.done

  return (
    <div className="doc-view crs-page">
      <div className="crs-scroll" ref={scrollRef}>
        <div className="crs-wrap crs-reader">
          <button className="crs-back" onClick={() => app.setView({ kind: 'courses', id })}>
            <Icon name="back" size={14} />
            {c?.title ?? 'Course'}
          </button>
          {content === undefined || !c ? (
            <p className="crs-meta">Loading…</p>
          ) : !content || !here ? (
            <p className="crs-empty">That lesson isn’t in the course any more. Update the course, or pick another lesson.</p>
          ) : (
            <>
              <header className="crs-reader-head" style={areaStyle(c.area)}>
                <p className="crs-kicker">
                  <span className="crs-tone-dot" aria-hidden="true" />
                  {here.m.title} · {LESSON_LABEL[here.l.kind]} · {minutes(here.l.words)} min
                </p>
                <h1 className="crs-title">{content.title}</h1>
                <div className="crs-reader-actions">
                  <button className="btn primary" onClick={() => void learnLesson(app, c, here.m, here.l)}>
                    <Icon name="tutor" size={14} /> {progress[lessonId] && !done ? 'Carry on with the tutor' : 'Learn this with the tutor'}
                  </button>
                  <button className={`tool-btn${done ? ' on' : ''}`} onClick={() => window.tide.courses.mark(id, lessonId, !done).then(setProgress)}>
                    <Icon name="check" size={13} /> {done ? 'Done' : 'Mark as done'}
                  </button>
                  <span className="crs-meta">
                    {content.sections.length} part{content.sections.length === 1 ? '' : 's'} for the tutor to take you through
                  </span>
                </div>
              </header>
              <figure className="crs-source">
                <figcaption>
                  <span className="crs-source-label">From the course</span>
                  <span>
                    {c.title}, by {c.by}
                  </span>
                  <Licence c={c} />
                  <a className="external" href={content.url} target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                </figcaption>
                <article
                  className={`prose crs-prose${here.l.kind === 'notebook' ? ' notebook' : ''}`}
                  dangerouslySetInnerHTML={{ __html: html }}
                  onClick={(e) => void codeBlockClick(e.target, { cumulative: here.l.kind === 'notebook' })}
                />
              </figure>
              <nav className="crs-pager">
                {prev ? (
                  <button className="crs-pager-btn" onClick={() => app.setView({ kind: 'courses', id, lesson: prev.l.id })}>
                    <span className="crs-meta">Previous</span>
                    <span>{prev.l.title}</span>
                  </button>
                ) : (
                  <span />
                )}
                {next && (
                  <button className="crs-pager-btn next" onClick={() => app.setView({ kind: 'courses', id, lesson: next.l.id })}>
                    <span className="crs-meta">Next</span>
                    <span>{next.l.title}</span>
                  </button>
                )}
              </nav>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The courses that teach what you want to learn (shared/courses suggestCourses), for the new-topic
 * page and the Learn page: a short row, each opening its course.
 */
export function CourseSuggestions({ topic, title = 'Open courses that teach this' }: { topic: string; title?: string }) {
  const app = useApp()
  const [cards, setCards] = useState<CourseCard[]>([])
  useEffect(() => {
    if (!topic.trim()) return setCards([])
    let live = true
    // Typing: wait until it settles
    const t = setTimeout(() => {
      const want = suggestCourses(topic, 3).map((c) => c.id)
      if (!want.length) return live && setCards([])
      window.tide.courses
        .list()
        .then((all) => live && setCards(want.map((w) => all.find((c) => c.id === w)!).filter(Boolean)))
        .catch(() => {})
    }, 350)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [topic])
  if (!cards.length) return null
  return (
    <section className="crs-suggest" aria-label={title}>
      <div className="crs-suggest-head">
        <h2 className="crs-section">{title}</h2>
        <button className="crs-link" onClick={() => app.setView({ kind: 'courses' })}>
          All courses
        </button>
      </div>
      <ul className="crs-suggest-rows">
        {cards.map((c) => (
          <li key={c.id} style={areaStyle(c.area)}>
            <button className="crs-suggest-row" onClick={() => app.setView({ kind: 'courses', id: c.id })}>
              <span className="crs-tone-dot" aria-hidden="true" />
              <span className="crs-suggest-name">
                <span className="crs-card-title">{c.title}</span>
                <span className="crs-meta">
                  {c.by} · {KIND_LABEL[c.kind]} · {c.imported ? `${c.imported.done} of ${c.imported.lessons} lessons done` : 'From GitHub'}
                </span>
              </span>
              <Licence c={c} />
              <Icon name="chevron" size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Learn's way in: the courses you have imported, and the way to the catalogue */
export function CourseShelf() {
  const app = useApp()
  const [cards, setCards] = useState<CourseCard[]>([])
  useEffect(() => {
    window.tide.courses
      .list()
      .then(setCards)
      .catch(() => {})
  }, [])
  const mine = cards.filter((c) => c.imported).slice(0, 3)
  return (
    <section className="ws-shelf crs-shelf">
      <div className="ws-shelf-head">
        <h2 className="section-title">Take a course</h2>
        <button className="tool-btn" onClick={() => app.setView({ kind: 'courses' })}>
          {cards.length ? `All ${cards.length} courses` : 'Courses'}
        </button>
      </div>
      {mine.length ? (
        <ul className="ws-shelf-rows">
          {mine.map((c) => (
            <li key={c.id}>
              <button className="ws-shelf-row" onClick={() => app.setView({ kind: 'courses', id: c.id })}>
                <span className="ws-shelf-title">{c.title}</span>
                <span className="muted small">
                  {c.imported!.done} of {c.imported!.lessons} lessons
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Data Engineering Zoomcamp, Neural Networks: Zero to Hero, the Rust book, the System Design Primer: open courses from GitHub, taught from their own text.</p>
      )}
    </section>
  )
}
