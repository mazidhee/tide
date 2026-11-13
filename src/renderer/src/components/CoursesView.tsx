/**
 * Courses from GitHub (shared/courses, main/courses): the catalogue by area, a course with its
 * modules and your progress through them, and a lesson as the course wrote it, with its notebooks'
 * code runnable here. "Learn" starts a lesson taught from the course's own text (the source-led
 * lessons: the tutor questions and marks, the course explains).
 */
import { usePopOutSurface } from '../lib/popout'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CATALOGUE, SOURCES, areaLabel, fromRepo, homeUrl, mediaOf, moduleProgress, nextLesson, registerCourses, sourceOf, sourceSite, suggestCourses, type CatalogueCourse, type CourseArea, type CourseLesson, type CourseModule, type CourseProgress, type CourseRef } from '@shared/courses'
import type { CourseCard, CourseDetail, ImportPhase, LessonContent } from '../../../main/courses'
import type { FreshStatus } from '../../../main/courseFresh'
import { NO_FILTER, SORTS, SOURCE_GROUPS, SUBJECTS, browse, counts, shelves, subjectsOf, type BrowseFilter } from '@shared/courseShelf'
import { useApp } from '../state'
import { Icon, type IconName } from './Icon'
import { renderMarkdown, splitFrontmatter } from '../lib/markdown'
import type { PageCleaning } from '@shared/pageClean'
import { CleanedNote, originalHtml, useShowOriginal } from './CleanedNote'
import { youtubeIdOf } from '@shared/video'
import { VideoPlayer } from './VideoPlayer'
import { ChatPanel } from './ChatPanel'
import { codeBlockClick } from '../lib/runBlocks'
import { currentPage, emptyHistory, goBack, goForward, pushPage, sameTarget, targetUrl, type History, type LinkTarget } from '@shared/links'
import { courseRepos, registerLinkHost } from '../lib/linkNav'
import { clearScreen, setScreen } from '../lib/onScreen'
import type { OnScreen } from '@shared/onScreen'
import { LinkPage, ViewerBar, targetTitle, useSectionInView } from './LinkViewer'


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

const ago = (ms: number) => {
  const d = Math.round((Date.now() - ms) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : day(ms)
}

/**
 * The weekly check, drawn as a thread: each source a bead on it, lit as it is read, the thread
 * filling as the check moves on; paused beads breathe while a lesson runs. Below it, the log.
 */
function FreshThread({ status, onClose }: { status: FreshStatus; onClose: () => void }) {
  const doneN = status.steps.filter((s) => s.state === 'done' || s.state === 'failed').length
  const fill = status.steps.length ? doneN / status.steps.length : 0
  return (
    <div className="crs-thread-panel" role="region" aria-label="The weekly check">
      <div className="crs-thread-head">
        <span className="crs-section">{status.running ? 'Checking your sources' : 'The weekly check'}</span>
        <button className="icon-btn small" onClick={onClose} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
      <ol className={`crs-thread${status.running ? ' live' : ''}`} style={{ ['--fill' as string]: String(fill) }}>
        {status.steps.map((s) => (
          <li key={s.id} className={`crs-bead ${s.state}`}>
            <span className="crs-bead-dot" aria-hidden="true">
              {s.state === 'done' && <Icon name="check" size={9} />}
            </span>
            <span className="crs-bead-label">{s.label}</span>
            <span className="crs-meta crs-bead-detail">{s.state === 'paused' ? 'Waiting for your lesson to end' : s.state === 'running' ? 'Reading…' : (s.detail ?? (s.state === 'failed' ? 'Couldn’t be reached' : ''))}</span>
          </li>
        ))}
      </ol>
      {status.log.length > 0 && (
        <details className="crs-log">
          <summary>What was checked ({status.log.length})</summary>
          <ul>
            {status.log.slice(0, 80).map((l, i) => (
              <li key={i} className={`crs-log-row ${l.result}`}>
                <span className="crs-log-when">{new Date(l.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="crs-log-what">{l.what.replace(/^update:/, 'Update · ')}</span>
                <span className="crs-log-res">{l.result}</span>
                <span className="crs-log-detail" title={l.url}>
                  {l.detail ?? l.url ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** Remembered per window: whether New for you is folded, and Browse's last filters */
const remember = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : (JSON.parse(v) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, v: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      // Kept for this visit only
    }
  }
}

const GROUP_PREVIEW = 6
/** Who wrote it, without repeating the source named beside it */
const byline = (c: CatalogueCourse) => {
  const src = SOURCES[sourceOf(c)].label
  return c.by === src ? '' : c.by.replace(new RegExp(`,?\\s*${src}$`), '')
}
const levelLabel = (l: CatalogueCourse['level']) => l.charAt(0).toUpperCase() + l.slice(1)
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** A small select in Browse's toolbar */
function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className={`crs-pick${options[0] && value !== options[0].id ? ' set' : ''}`}>
      <span className="crs-pick-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={10} className="crs-pick-caret" />
    </label>
  )
}

/**
 * The Courses page, in three parts that never mix: Continue (courses under way, one click back to
 * the next lesson), New for you (the weekly check's finds, foldable, each dismissable) and Browse
 * (the whole catalogue by your subjects, filtered by source, format and level, searched and sorted).
 */
function Catalogue({ area: initialArea }: { area?: CourseArea }) {
  const app = useApp()
  const [cards, setCards] = useState<CourseCard[] | null>(null)
  const [filter, setFilter] = useState<BrowseFilter>(() => {
    const saved = remember.get<Partial<BrowseFilter>>('tide.courses.browse', {})
    return { ...NO_FILTER, ...saved, query: '', ...(initialArea ? { subject: subjectsOf({ area: initialArea, title: '', covers: '', topics: [] })[0] } : {}) }
  })
  const [newOpen, setNewOpen] = useState(() => remember.get('tide.courses.newOpen', true))
  const [showFinished, setShowFinished] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [fresh, setFresh] = useState<FreshStatus | null>(null)
  const [threadOpen, setThreadOpen] = useState(false)
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const phases = useImports()
  const set = (patch: Partial<BrowseFilter>) =>
    setFilter((f) => {
      const next = { ...f, ...patch }
      const { query: _q, ...keep } = next
      remember.set('tide.courses.browse', keep)
      return next
    })
  const load = useCallback(
    () =>
      window.tide.courses
        .list()
        .then((c) => {
          // Courses found for you join the catalogue the window knows (links, related material)
          registerCourses(c.filter((x) => !CATALOGUE.some((b) => b.id === x.id)))
          setCards(c)
        })
        .catch(() => setCards([])),
    []
  )
  const loadFresh = useCallback(() => window.tide.courses.fresh().then(setFresh).catch(() => {}), [])
  useEffect(() => void load(), [load])
  useEffect(() => void loadFresh(), [loadFresh])
  useEffect(() => {
    if (Object.values(phases).some((p) => p.phase === 'done')) void load()
  }, [phases, load])
  useEffect(
    () =>
      window.tide.courses.onFresh((e) => {
        setFresh((f) => (f ? { ...f, running: e.running, steps: e.steps } : f))
        if (e.running) setThreadOpen(true)
        else {
          void load()
          void loadFresh()
        }
      }),
    [load, loadFresh]
  )

  const all = cards ?? []
  const { continuing, finished, suggested } = useMemo(() => shelves(all), [all])
  const groups = useMemo(() => browse(all, filter), [all, filter])
  const tally = useMemo(() => counts(all), [all])
  const found = new Set(groups.flatMap((g) => g.courses.map((c) => c.id))).size
  const searching = !!filter.query.trim()
  const narrowed = filter.source !== 'all' || filter.media !== 'all' || filter.level !== 'all'
  const newThisWeek = suggested.filter((c) => Date.now() - c.suggested!.at < 7 * 86_400_000).length

  const importIt = (c: CourseCard) =>
    window.tide.courses
      .import(c.id)
      .then(() => load())
      .catch((e) => app.toast(`Couldn’t import ${c.title}: ${errText(e)}`, { tone: 'error' }))
  const updateIt = (c: CourseCard) =>
    window.tide.courses
      .update(c.id)
      .then(() => {
        app.toast(`${c.title} is up to date`)
        return load()
      })
      .catch((e) => app.toast(`Couldn’t update ${c.title}: ${errText(e)}`, { tone: 'error' }))
  const dismiss = (c: CourseCard) => {
    // It folds away first, then is gone
    setLeaving((s) => new Set(s).add(c.id))
    setTimeout(() => {
      void window.tide.courses.dismiss(c.id).then(load)
    }, 220)
  }
  const checkNow = () => {
    setThreadOpen(true)
    setFresh((f) => (f ? { ...f, running: true } : f))
    void window.tide.courses
      .checkNow()
      .then((r) => {
        if (!r.ran && r.why) app.toast(r.why)
      })
      .catch(() => {})
      .finally(() => {
        void load()
        void loadFresh()
      })
  }
  const open = (c: CourseCard, lesson?: string) => app.setView({ kind: 'courses', id: c.id, ...(lesson ? { lesson } : {}) })
  const busyPhase = (c: CourseCard) => {
    const ph = phases[c.id]
    return ph && ph.phase !== 'done' && ph.phase !== 'error' ? ph : null
  }

  /** The one action a row offers: import it, bring it up to date, or show how far you are */
  const action = (c: CourseCard) => {
    const ph = busyPhase(c)
    if (ph)
      return (
        <span className="crs-meta crs-busy">
          <span className="spinner" /> {PHASE_LABEL[ph.phase]}…
        </span>
      )
    if (c.imported && c.updateAvailable)
      return (
        <button className="btn small" onClick={() => updateIt(c)}>
          <Icon name="refresh" size={12} /> Update
        </button>
      )
    if (c.imported)
      return (
        <span className="crs-row-progress" title={`${c.imported.done} of ${c.imported.lessons} lessons done`}>
          <Bar done={c.imported.done} total={c.imported.lessons} />
          <span className="crs-meta">
            {c.imported.done}/{c.imported.lessons}
          </span>
        </span>
      )
    return (
      <button className="btn small crs-import" onClick={() => importIt(c)}>
        Import
      </button>
    )
  }

  const row = (c: CourseCard) => (
    <li key={c.id} className={`crs-row${c.imported ? ' imported' : ''}`}>
      <button className="crs-row-main" onClick={() => open(c)}>
        <span className="crs-row-top">
          <span className="crs-row-title">{c.title}</span>
          {c.suggested && <span className="crs-badge new">New</span>}
          {c.updateAvailable && <span className="crs-badge updated">Updated</span>}
        </span>
        <span className="crs-row-covers">{c.covers}</span>
        <span className="crs-row-meta">
          <span className="crs-source" title={sourceSite(c)}>
            {mediaOf(c) !== 'text' && <Icon name="video" size={11} />}
            {SOURCES[sourceOf(c)].label}
          </span>
          <span>{levelLabel(c.level)}</span>
          {c.tier === 'personal' && (
            <span className="crs-personal" title={c.licenceNote ?? c.licence}>
              Personal study
            </span>
          )}
          {byline(c) && (
            <span className="crs-row-by" title={c.by}>
              {byline(c)}
            </span>
          )}
        </span>
      </button>
      <span className="crs-row-act">{action(c)}</span>
    </li>
  )

  const continueRow = (c: CourseCard) => {
    const ph = busyPhase(c)
    const next = c.imported!.next
    return (
      <li key={c.id} className="crs-go">
        <button className="crs-go-main" onClick={() => open(c, next?.id)} title={next ? `Resume at ${next.title}` : `Open ${c.title}`}>
          <span className="crs-go-text">
            <span className="crs-go-title">
              {c.title}
              {c.updateAvailable && <span className="crs-badge updated">Updated</span>}
            </span>
            <span className="crs-go-next">
              {next ? (
                <>
                  <span className="crs-go-label">{c.imported!.done ? 'Next' : 'Start with'}</span> {next.title}
                  {next.module && next.module !== next.title && <span className="crs-go-module"> · {next.module}</span>}
                </>
              ) : (
                'Ready to start'
              )}
            </span>
          </span>
          <span className="crs-go-progress">
            <Bar done={c.imported!.done} total={c.imported!.lessons} />
            <span className="crs-meta">
              {c.imported!.done} of {c.imported!.lessons}
            </span>
          </span>
          <span className="crs-go-resume" aria-hidden="true">
            <Icon name="play" size={11} />
            {c.imported!.done ? 'Resume' : 'Start'}
          </span>
        </button>
        {continuing.some((x) => x.updateAvailable) && (
          <span className="crs-go-side">
            {c.updateAvailable && (
          <button className="btn small crs-update-btn" disabled={!!ph} onClick={() => updateIt(c)}>
            {ph ? (
              <>
                <span className="spinner" /> {PHASE_LABEL[ph.phase]}
              </>
            ) : (
              <>
                <Icon name="refresh" size={12} /> Update
              </>
            )}
          </button>
            )}
          </span>
        )}
      </li>
    )
  }

  const freshLine = fresh?.running
    ? 'Checking your sources…'
    : fresh?.lastRun
      ? `Checked ${ago(fresh.lastRun)}${fresh.rankedBy === 'claude' ? ', ranked by Claude' : ''}`
      : 'Checked once a week, never during a lesson'

  return (
    <div className="doc-view crs-page">
      <div className="crs-scroll">
        <div className="crs-wrap">
          <header className="crs-head">
            <div>
              <h1 className="crs-title">Courses</h1>
              <p className="crs-lede">Open courses, books and lecture series, taught from their own text.</p>
            </div>
            <label className="crs-search">
              <Icon name="search" size={14} />
              <input value={filter.query} onChange={(e) => set({ query: e.target.value })} placeholder={`Search ${all.length || ''} courses`} aria-label="Search courses" onKeyDown={(e) => e.key === 'Escape' && set({ query: '' })} />
              {searching && (
                <button className="icon-btn small" aria-label="Clear the search" onClick={() => set({ query: '' })}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </label>
          </header>

          {!searching && continuing.length > 0 && (
            <section className="crs-shelf" aria-label="Continue">
              <div className="crs-shelf-head">
                <h2 className="crs-section">Continue</h2>
                <span className="crs-meta">
                  {continuing.length} under way{finished.length ? `, ${finished.length} finished` : ''}
                </span>
              </div>
              <ul className="crs-go-list">{continuing.map(continueRow)}</ul>
              {finished.length > 0 && (
                <>
                  <button className="crs-fold" aria-expanded={showFinished} onClick={() => setShowFinished((s) => !s)}>
                    <Icon name="chevron" size={10} className="crs-fold-chev" />
                    Finished ({finished.length})
                  </button>
                  {showFinished && <ul className="crs-rows compact">{finished.map(row)}</ul>}
                </>
              )}
            </section>
          )}
          {!searching && !continuing.length && finished.length > 0 && (
            <section className="crs-shelf" aria-label="Finished">
              <button className="crs-fold" aria-expanded={showFinished} onClick={() => setShowFinished((s) => !s)}>
                <Icon name="chevron" size={10} className="crs-fold-chev" />
                Finished ({finished.length})
              </button>
              {showFinished && <ul className="crs-rows compact">{finished.map(row)}</ul>}
            </section>
          )}

          {!searching && (
            <section className={`crs-shelf crs-new${newOpen ? '' : ' folded'}`} aria-label="New for you">
              <div className="crs-shelf-head">
                <button
                  className="crs-fold crs-fold-title"
                  aria-expanded={newOpen}
                  onClick={() => {
                    setNewOpen(!newOpen)
                    remember.set('tide.courses.newOpen', !newOpen)
                  }}
                >
                  <Icon name="chevron" size={10} className="crs-fold-chev" />
                  <span className="crs-section">New for you</span>
                  {suggested.length > 0 && <span className="crs-badge new">{newThisWeek || suggested.length}</span>}
                </button>
                <span className="crs-new-status">
                  <span className={`crs-fresh-dot${fresh?.running ? ' live' : ''}`} aria-hidden="true" />
                  <span className="crs-meta">{freshLine}</span>
                  <button className="crs-link" onClick={() => setThreadOpen((o) => !o)}>
                    {threadOpen ? 'Hide details' : 'Details'}
                  </button>
                  {!fresh?.running && (
                    <button className="crs-link" onClick={checkNow}>
                      Check now
                    </button>
                  )}
                </span>
              </div>
              {threadOpen && fresh && <FreshThread status={fresh} onClose={() => setThreadOpen(false)} />}
              {newOpen &&
                (suggested.length ? (
                  <ul className="crs-new-rows">
                    {suggested.map((c, i) => {
                      const ph = busyPhase(c)
                      return (
                        <li key={c.id} className={`crs-new-row${leaving.has(c.id) ? ' leaving' : ''}`} style={{ ['--i' as string]: String(i) }}>
                          <button className="crs-new-main" onClick={() => open(c)}>
                            <span className="crs-new-top">
                              <span className="crs-row-title">{c.title}</span>
                              {Date.now() - c.suggested!.at < 7 * 86_400_000 && <span className="crs-badge new">This week</span>}
                              <span className="crs-row-meta crs-new-meta">
                              <span className="crs-source">
                                {mediaOf(c) !== 'text' && <Icon name="video" size={11} />}
                                {SOURCES[sourceOf(c)].label}
                              </span>
                              <span>{levelLabel(c.level)}</span>
                              {c.suggested!.by === 'claude' && <span className="crs-by-claude">Chosen by Claude</span>}
                              </span>
                            </span>
                            <span className="crs-new-why">{c.suggested!.why}</span>
                          </button>
                          <span className="crs-new-actions">
                            {ph ? (
                              <span className="crs-meta">
                                <span className="spinner" /> {PHASE_LABEL[ph.phase]}…
                              </span>
                            ) : (
                              <button className="btn small" onClick={() => importIt(c)}>
                                Import
                              </button>
                            )}
                            <button className="icon-btn small" title="Not for me: don’t suggest it again" aria-label={`Dismiss ${c.title}`} onClick={() => dismiss(c)}>
                              <Icon name="x" size={13} />
                            </button>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="crs-meta crs-new-none">Nothing new yet. New and updated courses in your subjects show here; nothing is imported until you choose.</p>
                ))}
            </section>
          )}

          <section className="crs-browse" aria-label="Browse">
            <div className="crs-shelf-head">
              <h2 className="crs-section">{searching ? `Results for “${filter.query.trim()}”` : 'Browse'}</h2>
              <span className="crs-meta">
                {cards ? `${found} of ${all.length}` : ''}
              </span>
            </div>
            <nav className="crs-subjects" aria-label="Subjects">
              <button className={`crs-subject${filter.subject === 'all' ? ' on' : ''}`} aria-pressed={filter.subject === 'all'} onClick={() => set({ subject: 'all' })}>
                All
              </button>
              {SUBJECTS.filter((s) => tally.subjects[s.id]).map((s) => (
                <button key={s.id} className={`crs-subject${filter.subject === s.id ? ' on' : ''}`} aria-pressed={filter.subject === s.id} onClick={() => set({ subject: s.id })}>
                  {s.label} <span className="crs-count">{tally.subjects[s.id]}</span>
                </button>
              ))}
            </nav>
            <div className="crs-toolbar">
              <Pick label="Source" value={filter.source} onChange={(source) => set({ source })} options={[{ id: 'all', label: 'Any' }, ...SOURCE_GROUPS.filter((s) => tally.sources[s.id]).map((s) => ({ id: s.id, label: `${s.label} (${tally.sources[s.id]})` }))]} />
              <Pick label="Format" value={filter.media} onChange={(media) => set({ media })} options={[{ id: 'all', label: 'Any' }, { id: 'video', label: 'Video' }, { id: 'text', label: 'Text' }]} />
              <Pick label="Level" value={filter.level} onChange={(level) => set({ level })} options={[{ id: 'all', label: 'Any' }, { id: 'beginner', label: 'Beginner' }, { id: 'intermediate', label: 'Intermediate' }, { id: 'advanced', label: 'Advanced' }]} />
              {narrowed && (
                <button className="crs-link" onClick={() => set({ source: 'all', media: 'all', level: 'all' })}>
                  Clear
                </button>
              )}
              <span className="crs-toolbar-gap" />
              <Pick label="Sort" value={filter.sort} onChange={(sort) => set({ sort })} options={SORTS} />
            </div>

            {!cards ? (
              <p className="crs-meta">Loading…</p>
            ) : !groups.length ? (
              <p className="crs-empty">
                {searching ? `No course matches “${filter.query.trim()}”.` : 'No course matches these filters.'}{' '}
                {(narrowed || filter.subject !== 'all') && (
                  <button className="crs-link" onClick={() => set({ subject: 'all', source: 'all', media: 'all', level: 'all' })}>
                    Show every course
                  </button>
                )}
              </p>
            ) : (
              <div className="crs-groups" key={`${filter.subject}|${filter.source}|${filter.media}|${filter.level}|${filter.sort}`}>
                {groups.map((g) => {
                  // Browsing everything by subject: each subject shows a few, the rest one click away
                  const cut = filter.sort === 'subject' && filter.subject === 'all' && !searching && !expanded.has(g.id) ? GROUP_PREVIEW : Infinity
                  return (
                    <section key={g.id} className="crs-group">
                      {groups.length > 1 || g.id !== 'all' ? (
                        <h3 className="crs-group-head">
                          <button className="crs-group-name" onClick={() => set({ subject: g.id === 'all' ? 'all' : g.id })} disabled={filter.subject === g.id}>
                            {g.label}
                          </button>
                          <span className="crs-meta">{g.courses.length}</span>
                        </h3>
                      ) : null}
                      <ul className="crs-rows">{g.courses.slice(0, cut).map(row)}</ul>
                      {g.courses.length > cut && (
                        <button className="crs-more" onClick={() => setExpanded((s) => new Set(s).add(g.id))}>
                          Show all {g.courses.length}
                        </button>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </section>
          <p className="crs-foot-note">
            Each course is fetched from its source when you import it (politely: robots.txt is followed and nothing behind a login or a paywall is read), kept on this Mac and shown with its source and licence. Courses without an open licence, including MIT OpenCourseWare and Open Yale, are for your own study only.
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
  const [preview, setPreview] = useState<{ markdown: string; url: string; cleaning?: PageCleaning } | null | undefined>(undefined)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'import' | 'update' | 'save' | 'remove' | null>(null)
  const phases = useImports()
  const phase = phases[id]
  const mainRef = useRef<HTMLDivElement>(null)
  const proseRef = useRef<HTMLElement>(null)
  // Links followed from the lesson, opened here in its column (back returns to the lesson)
  const [hist, setHist] = useState<History<LinkTarget>>(emptyHistory)
  const page = currentPage(hist)
  const [focus, setFocus] = useState(false)
  // In a narrow window the outline is a drawer over the page, opened from the bar
  const [tocOpen, setTocOpen] = useState(false)
  const toggleFocus = () => setFocus((f) => !f)
  // Theatre: while a lesson's video plays, it takes the stage (the outline steps aside to its handle)
  const [theatre, setTheatre] = useState(false)
  useEffect(() => setTheatre(false), [lessonId])
  const away = focus || theatre
  useEffect(() => setTocOpen(false), [lessonId])
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
  // In a window of its own, at the same lesson, under the course's name (lib/popout)
  usePopOutSurface({ name: d?.course.title, view: () => ({ kind: 'courses', id, ...(currentId ? { lesson: currentId } : {}) }) })

  // Links in this course open here: another lesson of it in the outline, anything else as a page over the lesson
  const flatRef = useRef(flat)
  flatRef.current = flat
  useEffect(
    () =>
      registerLinkHost({
        open: (t) => {
          if (t.kind === 'course-file' && t.course === id) {
            const l = flatRef.current.find((x) => x.l.path === t.path && !x.l.range)
            if (l) {
              setHist(emptyHistory)
              return app.setView({ kind: 'courses', id, lesson: l.l.id })
            }
            if (!t.path) return setHist(emptyHistory)
          }
          setHist((h) => pushPage(h, t, sameTarget))
        }
      }),
    [id] // eslint-disable-line react-hooks/exhaustive-deps
  )
  // A new lesson starts with nothing opened over it
  useEffect(() => setHist(emptyHistory), [currentId])
  // A page opens at its top; back on the lesson, it is where you left it
  const lessonTop = useRef(0)
  const wasPage = useRef(false)
  useLayoutEffect(() => {
    const el = mainRef.current
    if (!el) return
    if (page && !wasPage.current) lessonTop.current = el.scrollTop
    if (page) el.scrollTo({ top: 0 })
    else if (wasPage.current) el.scrollTo({ top: lessonTop.current })
    wasPage.current = !!page
  }, [page])

  // The lesson's text, or the README before it is imported. Keyed on whether it's imported, not on
  // the course object: saving reading progress as you scroll replaces that object, and reloading the
  // lesson then threw you back to the top of the page
  const imported = d ? d.imported : undefined
  useEffect(() => {
    if (imported === undefined) return
    if (!imported) {
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
  }, [imported, id, currentId]) // eslint-disable-line react-hooks/exhaustive-deps
  // The module you are in stays open
  useEffect(() => {
    if (here) setOpen((o) => (o.has(here.m.id) ? o : new Set(o).add(here.m.id)))
  }, [here?.m.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const env = useMemo(() => ({ notePath: '', filesByName: app.filesByName }), [app.filesByName])
  const body = content ? content.markdown : !d?.imported && preview ? preview.markdown : ''
  // [clean] The lesson without its badges, sign-up banners and sponsor sections (main/courses, shared/pageClean); the original on request
  const cleaning = content ? content.cleaning : !d?.imported && preview ? preview.cleaning : undefined
  const [original, toggleOriginal] = useShowOriginal(content ?? preview)
  // The page has the lesson's title over it: the text's own first heading, when it says the same, isn't repeated
  const title = content?.title ?? (!d?.imported ? d?.course.title : '') ?? ''
  const html = useMemo(() => {
    if (!body) return ''
    const prep = (md: string) => splitFrontmatter(md).body.replace(/^\s*#\s+(.+)\n+/, (all, h: string) => (sameTitle(h, title) ? '' : all))
    if (original && cleaning) return originalHtml(cleaning, (md) => renderMarkdown(md, env), prep)
    return renderMarkdown(prep(body), env)
  }, [body, env, title, original, cleaning])

  // [videos] The YouTube videos the lesson links, played beside its text
  const videos = useMemo(() => (content ? videosIn(content.markdown) : []), [content])

  // [immersive] What the tutor sees: this lesson, the section in view, a passage selected
  const lessonScreen = useMemo<OnScreen | null>(
    () => (d && content && here ? { kind: 'course-lesson', title: content.title, course: { id, title: d.course.title, module: here.m.title, lesson: content.title }, path: here.l.path, url: content.url } : null),
    [d, content, here, id]
  )
  useEffect(() => {
    if (!lessonScreen || page) return
    setScreen(lessonScreen)
    return () => clearScreen(lessonScreen)
  }, [lessonScreen, page])
  useSectionInView(proseRef, !!content && !page)

  // The tutor's dock keeps to the text's column: its left edge and width, measured
  useLayoutEffect(() => {
    const main = mainRef.current
    const prose = proseRef.current
    if (!main) return
    const clear = () => {
      main.style.removeProperty('--dock-left')
      main.style.removeProperty('--dock-w')
    }
    if (!prose || page) {
      clear()
      return
    }
    const place = () => {
      const m = main.getBoundingClientRect()
      const p = prose.getBoundingClientRect()
      main.style.setProperty('--dock-left', `${Math.round(p.left - m.left)}px`)
      main.style.setProperty('--dock-w', `${Math.round(Math.max(360, p.width))}px`)
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(main)
    ro.observe(prose)
    return () => {
      ro.disconnect()
      clear()
    }
  }, [content, page, theatre])

  // [immersive] How far down the lesson you read, kept with its progress (and so in What you know)
  const readTo = useRef(0)
  useEffect(() => {
    readTo.current = 0
    const el = mainRef.current
    if (!el || !content || !currentId || page) return
    let t: ReturnType<typeof setTimeout> | undefined
    const on = () => {
      const max = el.scrollHeight - el.clientHeight
      const f = max <= 40 ? 1 : Math.min(1, (el.scrollTop + el.clientHeight * 0.15) / max)
      if (f < readTo.current + 0.1 && !(f >= 0.98 && readTo.current < 0.98)) return
      readTo.current = f
      clearTimeout(t)
      t = setTimeout(() => void window.tide.courses.track(id, currentId, { read: readTo.current }).then((p) => setD((x) => (x ? { ...x, progress: p } : x))).catch(() => {}), 1200)
    }
    el.addEventListener('scroll', on, { passive: true })
    // A short lesson that fits on the screen is read once it has been open a while
    const short = setTimeout(on, 20_000)
    return () => {
      el.removeEventListener('scroll', on)
      clearTimeout(short)
      clearTimeout(t)
    }
  }, [content, currentId, page, id])

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

  const lessonUrl = content?.url ?? (d.imported ? null : preview?.url ?? null)
  return (
    <div className={`doc-view crs-page crs-immersive${away ? ' crs-focus' : ''}${theatre ? ' crs-theatre' : ''}${tocOpen ? ' toc-open' : ''}`} onMouseLeave={() => away && setTocOpen(false)}>
      {/* The outline, stepped aside: its handle on the stage's left edge brings it over the page */}
      <button className="crs-outline-handle" onMouseEnter={() => setTocOpen(true)} onClick={() => setTocOpen((o) => !o)} aria-label="Course outline" title="Course outline">
        <Icon name="list" size={14} />
      </button>
      <main className="crs-main" ref={mainRef}>
        <ViewerBar
          back={!!page}
          forward={hist.at < hist.pages.length - 1}
          onBack={() => setHist((h) => goBack(h))}
          onForward={() => setHist((h) => goForward(h))}
          url={page ? targetUrl(page, courseRepos()) : lessonUrl}
          label={page ? targetTitle(page) : (content?.title ?? c.title)}
        >
          <button
            className={`icon-btn small crs-outline-btn${tocOpen ? ' on' : ''}`}
            onClick={() => {
              // Wide: the outline stays beside the page unless you focus; narrow: it opens over the page
              const narrow = (mainRef.current?.parentElement?.clientWidth ?? 2000) < 1000
              if (narrow || theatre) setTocOpen((o) => !o)
              else toggleFocus()
            }}
            title="The course outline (focus hides it)"
            aria-pressed={focus || tocOpen}
          >
            <Icon name={away ? 'list' : 'width'} size={13} />
          </button>
        </ViewerBar>
        {page ? (
          <div className="crs-article wide crs-linked">
            <LinkPage target={page} />
          </div>
        ) : (
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
                  <CleanedNote cleaning={cleaning} original={original} onToggle={toggleOriginal} />
                  <div className="crs-article-actions">
                    <button className="btn primary" onClick={() => void learnLesson(app, c, here.m, here.l)}>
                      <Icon name="tutor" size={14} /> {progress[here.l.id]?.record && !isDone ? 'Carry on with the tutor' : 'Learn this with the tutor'}
                    </button>
                    <button className={`tool-btn${isDone ? ' on' : ''}`} onClick={() => window.tide.courses.mark(id, here.l.id, !isDone).then((p) => setD((x) => (x ? { ...x, progress: p } : x)))}>
                      <Icon name="check" size={13} /> {isDone ? 'Done' : 'Mark as done'}
                    </button>
                    <span className="crs-meta">
                      {content.sections.length > 1 ? `The tutor takes you through it in ${content.sections.length} parts` : 'The tutor takes you through it'}
                    </span>
                  </div>
                </header>
                <div className={videos.length ? `crs-with-video${theatre ? ' theatre' : ''}` : undefined}>
                  {videos.length > 0 && <CourseVideos ids={videos} course={c.title} onActive={setTheatre} onWatched={(v, f) => void window.tide.courses.track(id, here.l.id, { video: { id: v, watched: f } }).catch(() => {})} />}
                  <article className={`prose crs-prose${here.l.kind === 'notebook' ? ' notebook' : ''}`} dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => {
                      void codeBlockClick(e.target, { cumulative: here.l.kind === 'notebook' })
                      if ((e.target as Element).closest?.('.run-code')) void window.tide.courses.track(id, here.l.id, { ran: true }).catch(() => {})
                    }} ref={proseRef} data-link-course={id} data-link-path={here.l.path} data-link-root />
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
                      {fromRepo(c) ? 'Its README, read from ' : 'What it is, read from '}
                      <a href={preview.url} target="_blank" rel="noreferrer">
                        {fromRepo(c) ? 'GitHub' : sourceSite(c)}
                      </a>
                      . Import the course to read every lesson here.
                    </span>
                  ) : preview === null ? (
                    `It could not be read from ${fromRepo(c) ? 'GitHub' : sourceSite(c)} just now.`
                  ) : (
                    `Reading it from ${fromRepo(c) ? 'GitHub' : sourceSite(c)}…`
                  )}
                </p>
                <CleanedNote cleaning={cleaning} original={original} onToggle={toggleOriginal} />
              </header>
              {preview ? <article className="prose crs-prose" dangerouslySetInnerHTML={{ __html: html }} /> : preview === undefined && <div className="crs-skeleton" aria-busy="true"><span /><span /><span /></div>}
            </>
          )}
        </div>
        )}
        {/* The tutor, docked at the foot of the reading column: the right of the window stays the video's */}
        <div className="crs-dock-wrap">
          <ChatPanel variant="dock" />
        </div>
      </main>
      <aside className="crs-toc" aria-label="Course outline" onMouseLeave={() => (away || tocOpen) && setTocOpen(false)}>
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
              <p className="crs-meta">Import it to read every lesson here, run its code and learn it with the tutor. It is fetched from {fromRepo(c) ? 'GitHub' : sourceSite(c)} into Tide’s own data, not your notes.</p>
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
              <a className="crs-toc-link" href={homeUrl(c)} target="_blank" rel="noreferrer" title={homeUrl(c)}>
                <Icon name="external" size={12} /> {SOURCES[sourceOf(c)].label}
              </a>
            </span>
            {d.imported && (
              <div className="crs-toc-actions">
                {d.updateAvailable ? (
                  <button className="btn small" title={`${sourceSite(c)} has changed since you imported it`} disabled={!!busy} onClick={() => act('update', () => window.tide.courses.update(id))}>
                    {busy === 'update' ? <span className="spinner" /> : <Icon name="refresh" size={12} />} Update
                  </button>
                ) : (
                  <button className="icon-btn small" title={busy === 'update' ? 'Updating…' : `Update from ${fromRepo(c) ? 'GitHub' : sourceSite(c)}`} disabled={!!busy} onClick={() => act('update', () => window.tide.courses.update(id))}>
                    <Icon name="refresh" size={14} />
                  </button>
                )}
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
                  {c.by} · {KIND_LABEL[c.kind]} · {c.imported ? `${c.imported.done} of ${c.imported.lessons} lessons done` : `From ${SOURCES[sourceOf(c)].label}`}
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
function CourseVideos({ ids, course, onWatched, onActive }: { ids: string[]; course: string; onWatched?: (id: string, fraction: number) => void; onActive?: (on: boolean) => void }) {
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
      <VideoPlayer key={id} source={{ kind: 'youtube', id, course, fetch: true }} noCinema onActive={onActive} onWatched={(f) => onWatched?.(id, f)} />
    </aside>
  )
}
