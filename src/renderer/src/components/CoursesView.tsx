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
import { youtubeIdOf } from '@shared/video'
import { VideoPlayer } from './VideoPlayer'
import { codeBlockClick } from '../lib/runBlocks'


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
  if (id) return <CourseReader id={id} lessonId={lesson} />
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
                  <li key={c.id}>
                    <button className="crs-mine-row" onClick={() => app.setView({ kind: 'courses', id: c.id })}>
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
              <button key={a.id} className={`crs-area-chip${area === a.id ? ' on' : ''}`} onClick={() => setArea(a.id)}>
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
              <section key={a.id} className="crs-area">
                <div className="crs-area-head">
                  <h2 className="crs-section">
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

// ---------- A course: its outline beside the text you are reading ----------

const squash = (t: string) => t.toLowerCase().replace(/<[^>]+>|[^\p{L}\p{N}]+/gu, '')
const sameTitle = (a: string, b: string) => !!b && squash(a) === squash(b)

/**
 * A course, read in place: the outline down the side (modules, lessons, where you are) and the
 * lesson itself in the main column, rendered as the course wrote it, with the tutor one click away.
 * Before it is imported, the column shows the course's README from GitHub, so you can see what it
 * is before you bring it onto this Mac.
 */
function CourseReader({ id, lessonId }: { id: string; lessonId?: string }) {
  const app = useApp()
  const [d, setD] = useState<CourseDetail | null | undefined>(undefined)
  const [content, setContent] = useState<LessonContent | null | undefined>(undefined)
  const [preview, setPreview] = useState<{ markdown: string; url: string } | null | undefined>(undefined)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'import' | 'update' | 'save' | 'remove' | null>(null)
  const phases = useImports()
  const phase = phases[id]
  const mainRef = useRef<HTMLDivElement>(null)
  const load = useCallback(() => window.tide.courses.get(id).then(setD).catch(() => setD(null)), [id])
  useEffect(() => void load(), [load])
  useEffect(() => {
    if (phase?.phase === 'done') void load()
  }, [phase?.phase, load])

  const outline = d?.imported?.outline
  const progress = d?.progress ?? {}
  const next = outline ? nextLesson(outline, progress) : null
  const flat = useMemo(() => outline?.modules.flatMap((m) => m.lessons.map((l) => ({ m, l }))) ?? [], [outline])
  const currentId = lessonId ?? next?.lesson.id ?? flat[0]?.l.id
  const at = flat.findIndex((x) => x.l.id === currentId)
  const here = at >= 0 ? flat[at] : null

  // The lesson's text, or the README before it is imported
  useEffect(() => {
    if (!d) return
    if (!d.imported) {
      if (preview === undefined) window.tide.courses.preview(id).then(setPreview).catch(() => setPreview(null))
      return
    }
    if (!currentId) return setContent(null)
    let live = true
    setContent(undefined)
    window.tide.courses
      .lesson(id, currentId)
      .then((c) => live && setContent(c))
      .catch(() => live && setContent(null))
    mainRef.current?.scrollTo({ top: 0 })
    return () => {
      live = false
    }
  }, [d, id, currentId]) // eslint-disable-line react-hooks/exhaustive-deps
  // The module you are in stays open
  useEffect(() => {
    if (here) setOpen((o) => (o.has(here.m.id) ? o : new Set(o).add(here.m.id)))
  }, [here?.m.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const env = useMemo(() => ({ notePath: '', filesByName: app.filesByName }), [app.filesByName])
  const body = content ? content.markdown : !d?.imported && preview ? preview.markdown : ''
  // The page has the lesson's title over it: the text's own first heading, when it says the same, isn't repeated
  const title = content?.title ?? (!d?.imported ? d?.course.title : '') ?? ''
  const html = useMemo(() => {
    if (!body) return ''
    const text = splitFrontmatter(body).body.replace(/^\s*#\s+(.+)\n+/, (all, h: string) => (sameTitle(h, title) ? '' : all))
    return renderMarkdown(text, env)
  }, [body, env, title])

  // [videos] The YouTube videos the lesson links, played beside its text
  const videos = useMemo(() => (content ? videosIn(content.markdown) : []), [content])

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
  const goTo = (lesson: string) => app.setView({ kind: 'courses', id, lesson })

  if (d === undefined) return <div className="doc-view crs-page crs-immersive" />
  if (!d) {
    return (
      <div className="doc-view crs-page">
        <div className="crs-scroll">
          <div className="crs-wrap">
            <button className="crs-back" onClick={() => app.setView({ kind: 'courses' })}>
              <Icon name="back" size={14} /> Courses
            </button>
            <p className="crs-empty">That course isn’t in the catalogue.</p>
          </div>
        </div>
      </div>
    )
  }
  const c = d.course
  const total = outline?.lessons ?? 0
  const done = outline ? outline.modules.reduce((n, m) => n + moduleProgress(m, progress).done, 0) : 0
  const importing = busy === 'import' || (!!phase && phase.phase !== 'done' && phase.phase !== 'error' && !d.imported)
  const isDone = !!(currentId && progress[currentId]?.done)

  return (
    <div className="doc-view crs-page crs-immersive">
      <main className="crs-main" ref={mainRef}>
        <div className={`crs-article${videos.length ? ' wide' : ''}`}>
          <button className="crs-back" onClick={() => app.setView({ kind: 'courses' })}>
            <Icon name="back" size={14} /> Courses
          </button>
          {d.imported ? (
            content === undefined ? (
              <div className="crs-skeleton" aria-busy="true">
                <span />
                <span />
                <span />
              </div>
            ) : !content || !here ? (
              <p className="crs-empty">That lesson isn’t in the course any more. Update the course, or pick another lesson.</p>
            ) : (
              <>
                <header className="crs-article-head">
                  <p className="crs-kicker">
                    {here.m.title}
                    <span aria-hidden="true">·</span>
                    {LESSON_LABEL[here.l.kind]}
                    <span aria-hidden="true">·</span>
                    {minutes(here.l.words)} min
                  </p>
                  <h1 className="crs-article-title">{content.title}</h1>
                  <p className="crs-attrib">
                    <span>
                      From <a href={content.url} target="_blank" rel="noreferrer">{c.title}</a> by {c.by}
                    </span>
                    <Licence c={c} />
                  </p>
                  <div className="crs-article-actions">
                    <button className="btn primary" onClick={() => void learnLesson(app, c, here.m, here.l)}>
                      <Icon name="tutor" size={14} /> {progress[here.l.id] && !isDone ? 'Carry on with the tutor' : 'Learn this with the tutor'}
                    </button>
                    <button className={`tool-btn${isDone ? ' on' : ''}`} onClick={() => window.tide.courses.mark(id, here.l.id, !isDone).then((p) => setD((x) => (x ? { ...x, progress: p } : x)))}>
                      <Icon name="check" size={13} /> {isDone ? 'Done' : 'Mark as done'}
                    </button>
                    <span className="crs-meta">
                      {content.sections.length > 1 ? `The tutor takes you through it in ${content.sections.length} parts` : 'The tutor takes you through it'}
                    </span>
                  </div>
                </header>
                <div className={videos.length ? 'crs-with-video' : undefined}>
                  {videos.length > 0 && <CourseVideos ids={videos} course={c.title} />}
                  <article className={`prose crs-prose${here.l.kind === 'notebook' ? ' notebook' : ''}`} dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => void codeBlockClick(e.target, { cumulative: here.l.kind === 'notebook' })} />
                </div>
                <nav className="crs-pager">
                  {at > 0 ? (
                    <button className="crs-pager-btn" onClick={() => goTo(flat[at - 1].l.id)}>
                      <span className="crs-meta">Previous</span>
                      <span>{flat[at - 1].l.title}</span>
                    </button>
                  ) : (
                    <span />
                  )}
                  {at < flat.length - 1 && (
                    <button className="crs-pager-btn next" onClick={() => goTo(flat[at + 1].l.id)}>
                      <span className="crs-meta">Next</span>
                      <span>{flat[at + 1].l.title}</span>
                    </button>
                  )}
                </nav>
              </>
            )
          ) : (
            <>
              <header className="crs-article-head">
                <p className="crs-kicker">
                  {KIND_LABEL[c.kind]} <span aria-hidden="true">·</span> {c.level.charAt(0).toUpperCase() + c.level.slice(1)}
                </p>
                <h1 className="crs-article-title">{c.title}</h1>
                <p className="crs-article-lede">{c.covers}.</p>
                <p className="crs-attrib">
                  {preview ? (
                    <span>
                      Its README, read from <a href={preview.url} target="_blank" rel="noreferrer">GitHub</a>. Import the course to read every lesson here.
                    </span>
                  ) : preview === null ? (
                    'Its README could not be read from GitHub just now.'
                  ) : (
                    'Reading its README from GitHub…'
                  )}
                </p>
              </header>
              {preview ? <article className="prose crs-prose" dangerouslySetInnerHTML={{ __html: html }} /> : preview === undefined && <div className="crs-skeleton" aria-busy="true"><span /><span /><span /></div>}
            </>
          )}
        </div>
      </main>
      <aside className="crs-toc" aria-label="Course outline">
        <div className="crs-toc-head">
          <p className="crs-kicker">
            {areaLabel(c.area)} · {KIND_LABEL[c.kind]}
          </p>
          <h1 className="crs-toc-title">{c.title}</h1>
          <p className="crs-toc-by">{c.by}</p>
          {d.imported ? (
            <div className="crs-toc-progress">
              <Bar done={done} total={total} />
              <span className="crs-meta">
                {done} of {total} done
              </span>
            </div>
          ) : (
            <div className="crs-toc-import">
              <p className="crs-meta">Import it to read every lesson here, run its code and learn it with the tutor. Its text is fetched from GitHub into Tide’s own data, not your notes.</p>
              <button className="btn primary wide" disabled={importing} onClick={() => act('import', () => window.tide.courses.import(id))}>
                {importing ? (
                  <>
                    <span className="spinner" /> {phase ? PHASE_LABEL[phase.phase] : 'Starting'}…
                  </>
                ) : (
                  'Import course'
                )}
              </button>
              {phase?.phase === 'error' && <p className="crs-error">{phase.detail}</p>}
            </div>
          )}
          <div className="crs-toc-meta">
            <span className="crs-toc-licence">
              <Licence c={c} />
              <a className="crs-toc-link" href={repoUrl(c)} target="_blank" rel="noreferrer" title={`github.com/${c.repo}`}>
                <Icon name="external" size={12} /> GitHub
              </a>
            </span>
            {d.imported && (
              <div className="crs-toc-actions">
                <button className="icon-btn small" title={busy === 'update' ? 'Updating…' : 'Update from GitHub'} disabled={!!busy} onClick={() => act('update', () => window.tide.courses.update(id))}>
                  <Icon name="refresh" size={14} />
                </button>
                <button
                  className="icon-btn small"
                  title="Save its lessons to your notes, each with its source and licence"
                  disabled={!!busy}
                  onClick={() =>
                    act('save', async () => {
                      const r = await window.tide.courses.saveToNotes(id)
                      await app.refreshTree()
                      app.toast(`Saved ${r.files} lessons to ${r.folder}`, { action: { label: 'Open', run: () => app.setView({ kind: 'notebook', path: r.folder }) } })
                    })
                  }
                >
                  <Icon name="note" size={14} />
                </button>
                <button
                  className="icon-btn small"
                  title="Remove from this Mac (progress is kept)"
                  disabled={!!busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${c.title} from this Mac? Your progress is kept.`)) void act('remove', () => window.tide.courses.remove(id))
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
                <span className="crs-meta">{busy === 'update' ? `${phase ? PHASE_LABEL[phase.phase] : 'Updating'}…` : `Updated ${day(d.imported.updatedAt)}`}</span>
              </div>
            )}
          </div>
        </div>
        {outline && (
          <nav className="crs-toc-modules">
            {outline.modules.map((m, mi) => {
              const p = moduleProgress(m, progress)
              const isOpen = open.has(m.id)
              return (
                <section key={m.id} className={`crs-toc-module${isOpen ? ' open' : ''}`}>
                  <button className="crs-toc-module-head" aria-expanded={isOpen} onClick={() => setOpen((o) => (o.has(m.id) ? new Set([...o].filter((x) => x !== m.id)) : new Set(o).add(m.id)))}>
                    <span className={`crs-module-n${p.done === p.total ? ' complete' : ''}`}>{p.done === p.total ? <Icon name="check" size={11} /> : mi + 1}</span>
                    <span className="crs-toc-module-title">{m.title}</span>
                    <span className="crs-meta">
                      {p.done}/{p.total}
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="crs-toc-lessons">
                      {m.lessons.map((l) => {
                        const lp = progress[l.id]
                        return (
                          <li key={l.id}>
                            <button className={`crs-toc-lesson${l.id === currentId ? ' current' : ''}${lp?.done ? ' done' : lp ? ' begun' : ''}`} onClick={() => goTo(l.id)} aria-current={l.id === currentId ? 'page' : undefined}>
                              <span className="crs-state" aria-hidden="true" />
                              <span className="crs-toc-lesson-title">{l.title}</span>
                              {l.kind !== 'reading' && <Icon name={LESSON_ICON[l.kind]} size={12} />}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })}
          </nav>
        )}
      </aside>
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
          <li key={c.id}>
            <button className="crs-suggest-row" onClick={() => app.setView({ kind: 'courses', id: c.id })}>
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

/** The YouTube videos a lesson's text links or embeds, in order, each once */
export function videosIn(markdown: string): string[] {
  const out: string[] = []
  for (const m of markdown.matchAll(/https?:\/\/(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s)"'\]>]+/gi)) {
    const id = youtubeIdOf(m[0])
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** A course lesson's videos beside its text: one player, a tab for each video; their transcripts are fetched and indexed for lessons to use */
function CourseVideos({ ids, course }: { ids: string[]; course: string }) {
  const [at, setAt] = useState(0)
  useEffect(() => setAt(0), [ids.join()])
  const id = ids[Math.min(at, ids.length - 1)]
  return (
    <aside className="crs-videos" aria-label="This lesson's videos">
      <div className="crs-videos-head">
        <Icon name="video" size={14} />
        <span>{ids.length === 1 ? 'The lesson’s video' : `The lesson’s ${ids.length} videos`}</span>
      </div>
      {ids.length > 1 && (
        <div className="crs-video-tabs" role="tablist">
          {ids.map((v, i) => (
            <button key={v} role="tab" aria-selected={i === at} className={`crs-video-tab${i === at ? ' on' : ''}`} onClick={() => setAt(i)}>
              <span>Video {i + 1}</span>
            </button>
          ))}
        </div>
      )}
      <VideoPlayer key={id} source={{ kind: 'youtube', id, course, fetch: true }} noCinema />
    </aside>
  )
}
