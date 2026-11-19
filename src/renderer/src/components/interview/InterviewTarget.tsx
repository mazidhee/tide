import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ANSWER_KINDS,
  areaItems,
  countdown,
  itemMark,
  overallReadiness,
  readiness,
  reviewSlots,
  todaysPlan,
  whenText,
  type Area,
  type AreaReadiness,
  type DrillKind,
  type PlanItem,
  type Progress,
  type QuestionKind,
  type ReviewSlot,
  type TargetBundle
} from '@shared/interviewTarget'
import { useApp, type View } from '../../state'
import { Icon } from '../Icon'
import { Drill } from './Drill'

/**
 * One interview target's page (docs/plans/interview-target.md): when it is, how ready you are,
 * and two ways in. Teach: the course's modules, how to answer each kind of question, the topics
 * the target needs, and the day's cards. Interview: today's plan, then every story, question,
 * case and assessor question as a drill, and the live mock rounds.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`)
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000)
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

/** Readiness, one thin bar per area and the overall figure */
function Readiness({ areas, overall }: { areas: AreaReadiness[]; overall: number | null }) {
  return (
    <section className="it-ready" aria-label="Readiness">
      <div className="it-ready-head">
        <span className="it-eyebrow">Readiness</span>
        <strong className="it-ready-num tabular">{pct(overall)}</strong>
      </div>
      <ul className="it-bars">
        {areas.map((a) => (
          <li key={a.area} className={`it-bar-row${a.score === null ? ' is-empty' : ''}`} title={a.score === null ? 'Nothing for this yet in the target’s files' : `${a.attempted} of ${a.items} tried${a.marks !== null ? `, marks ${pct(a.marks)}` : ''}`}>
            <span className="it-bar-label">{a.label}</span>
            <span className="it-bar-track" aria-hidden="true">
              <span className="it-bar-fill" style={{ width: a.score ? `${Math.max(2, a.score * 100)}%` : 0 }} />
            </span>
            <span className="it-bar-value tabular">{pct(a.score)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A section that opens and closes, with a count and an action beside its title */
function Section({ id, title, count, action, children, open: initial = false }: { id: string; title: string; count?: string; action?: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  const key = `tide.interview.open.${id}`
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? initial : v === '1'
    } catch {
      return initial
    }
  })
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(key, open ? '0' : '1')
    } catch {
      // remembered for now only
    }
  }
  return (
    <section className={`it-sec${open ? ' is-open' : ''}`}>
      <div className="it-sec-head">
        <button className="it-sec-toggle" onClick={toggle} aria-expanded={open}>
          <Icon name="chevron" size={11} className="it-chev" />
          <h2>{title}</h2>
          {count && <span className="it-count">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="it-sec-body">{children}</div>}
    </section>
  )
}

/** A row that starts a drill: what it is, a small meta line, the latest mark */
function Row({ id, title, meta, mark, tries, onClick }: { id?: string; title: string; meta?: string; mark: number | null; tries: number; onClick(): void }) {
  return (
    <li>
      <button className="it-row" onClick={onClick}>
        {id && <span className="it-row-id">{id}</span>}
        <span className="it-row-main">
          <span className="it-row-title">{title}</span>
          {meta && <span className="it-row-meta">{meta}</span>}
        </span>
        <span className="it-row-mark tabular" title={tries ? `${tries} tr${tries === 1 ? 'y' : 'ies'}` : 'Not tried yet'}>
          {mark === null ? <span className="muted">New</span> : pct(mark)}
        </span>
        <Icon name="chevron" size={11} className="it-row-go" />
      </button>
    </li>
  )
}

function Slot({ slot, onReview }: { slot: ReviewSlot; onReview(): void }) {
  const text = slot.state === 'due' ? `${slot.due} due` : slot.state === 'done' ? `Done, ${slot.reviewed} reviewed` : slot.state === 'later' ? `${slot.due} more by tonight` : slot.state === 'missed' ? 'Not done this morning' : 'Nothing due'
  return (
    <div className={`it-slot is-${slot.state}`}>
      <span className="it-slot-label">{slot.label}</span>
      <span className="it-slot-text">{text}</span>
      {slot.state === 'due' && (
        <button className="btn small primary" onClick={onReview}>
          Review now
        </button>
      )}
      {slot.state === 'done' && <Icon name="check" size={13} />}
    </div>
  )
}

export function InterviewTarget({ slug, drill, mode: wantMode }: { slug: string; drill?: { kind: DrillKind; item: string }; mode?: 'teach' | 'interview' }) {
  const app = useApp()
  const [b, setB] = useState<TargetBundle | null | undefined>(undefined)
  const [busy, setBusy] = useState('')
  const [step, setStep] = useState('')
  const [now, setNow] = useState(Date.now())
  const [roundFilter, setRoundFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState<'all' | QuestionKind>('all')
  const cardsTried = useRef(false)

  const load = useCallback(() => window.tide.interview.get(slug).then(setB).catch(() => setB(null)), [slug])
  useEffect(() => {
    void load()
  }, [load, app.files])
  useEffect(() => window.tide.interview.onProgress((p) => p.slug === slug && setStep(p.step)), [slug])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Today's cards go in once a day, from what was taught
  useEffect(() => {
    if (!b || cardsTried.current || b.cards.addedToday) return
    if (!b.files.firm.length && !b.files.stories.length && !b.course) return
    cardsTried.current = true
    window.tide.interview
      .generate(slug, 'cards')
      .then((r) => {
        if (r.added) {
          app.toast(`${r.added} new card${r.added === 1 ? '' : 's'} for today`)
          void load()
        }
      })
      .catch(() => {})
  }, [b, slug, app, load])

  const areas = useMemo(() => (b ? readiness(b.files, b.progress, b.cards) : []), [b])
  const overall = useMemo(() => overallReadiness(areas), [areas])
  const plan = useMemo(() => (b ? todaysPlan(b.files, b.progress, b.cards, now) : []), [b, now])
  const [mode, setMode] = useState<'teach' | 'interview' | null>(() => wantMode ?? null)
  const modeNow = mode ?? (overall !== null && overall >= 0.5 ? 'interview' : 'teach')
  const pickMode = (m: 'teach' | 'interview') => setMode(m)

  const markOf = useCallback(
    (item: string) => {
      const xs = b?.progress.attempts.filter((a) => a.item === item) ?? []
      return { mark: itemMark(xs), tries: xs.length }
    },
    [b]
  )

  if (b === undefined) return <div className="page it-page" />
  if (b === null)
    return (
      <div className="page it-page">
        <div className="page-inner">
          <p className="muted">This interview target isn’t in your vault. It lives in “Interview prep/&lt;name&gt;/target.md”.</p>
          <button className="btn" onClick={() => app.setView({ kind: 'practice' })}>
            Back to Practice
          </button>
        </div>
      </div>
    )

  const f = b.files
  const meta = f.meta
  const go = (kind: DrillKind, item: string) => app.setView({ kind: 'interview', slug, drill: { kind, item }, nonce: Date.now() })
  const startPlan = (p: PlanItem) => {
    if (p.drill === 'cards') return app.setView({ kind: 'study', scope: { kind: 'note', path: b.cards.path } })
    if (p.drill === 'teach') return teach(p.item)
    go(p.drill, p.item)
  }
  const teach = (topic: string, path?: string) =>
    app.setView({ kind: 'session', mode: 'teach', scope: path ? { kind: 'note', path } : { kind: 'folder', path: meta.folder }, topic, nonce: Date.now() })
  const liveMock = (round: string) =>
    // Slot for the live voice mock (built separately: shared/interviewMock, components/interview/LiveMock*)
    app.setView({ kind: 'interview-mock', slug, round } as unknown as View)

  const saved = (p: Progress) => setB((cur) => (cur ? { ...cur, progress: p } : cur))

  // ---------- A drill ----------
  if (drill) {
    const next = plan.find((p) => p.item !== drill.item && p.drill !== 'cards' && p.drill !== 'teach')
    return (
      <div className="page it-page">
        <div className="page-inner narrow">
          <Drill slug={slug} bundle={b} kind={drill.kind} item={drill.item} onSaved={saved} onClose={() => app.setView({ kind: 'interview', slug, mode: 'interview', nonce: Date.now() })} onNext={next ? () => startPlan(next) : undefined} />
        </div>
      </div>
    )
  }

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label)
    try {
      const msg = await fn()
      if (msg) app.toast(msg)
      await load()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
      setStep('')
    }
  }
  const gather = () => run('gather', async () => {
    const c = await window.tide.interview.gather(slug)
    return `Read ${c.items.length} source${c.items.length === 1 ? '' : 's'}${c.errors.length ? `, ${c.errors.length} couldn’t be read` : ''}`
  })
  const generate = (what: 'stories' | 'answers' | 'cards') =>
    run(what, async () => {
      const r = await window.tide.interview.generate(slug, what)
      return r.added ? `Added ${r.added} ${what === 'stories' ? 'stor' + (r.added === 1 ? 'y' : 'ies') : what === 'answers' ? 'model answer' + (r.added === 1 ? '' : 's') : 'card' + (r.added === 1 ? '' : 's')}${r.backup ? '. The old file is backed up.' : ''}${r.note ? ` ${r.note}` : ''}` : r.note ?? 'Nothing to add.'
    })

  const interview = countdown(meta.date, now, meta.timezone)
  const slides = countdown(meta.slidesDue, now, meta.timezone)
  const when = whenText(meta.date, meta.timezone, localZone())
  const slots = reviewSlots(b.cards.dues, b.cards.reviewedToday, now)
  const items = areaItems(f)
  const missingModels = f.questions.filter((q) => !q.model).length
  const rounds = meta.rounds
  const questions = f.questions.filter((q) => (roundFilter === 'all' || q.round === roundFilter) && (kindFilter === 'all' || q.kind === kindFilter))
  const kindsHere = [...new Set(f.questions.map((q) => q.kind))]
  const topics = [...f.frameworks.map((t) => ({ t, path: `${meta.folder}/frameworks.md` })), ...(f.presentation?.research ?? []).map((t) => ({ t, path: `${meta.folder}/presentation.md` }))]
  const firmBySection = f.firm.reduce<Record<string, typeof f.firm>>((acc, x) => ((acc[x.section] ??= []).push(x), acc), {})
  const course = b.course
  const nextModule = course?.modules.find((m) => m.status !== 'locked' && m.status !== 'passed' && m.next)
  const areaMark = (a: Area) => areas.find((x) => x.area === a)

  return (
    <div className="page it-page">
      <div className="page-inner">
        <header className="it-head">
          <div className="it-head-main">
            <span className="it-eyebrow">Interview target</span>
            <h1 className="page-title it-title">{meta.company}</h1>
            {meta.role && <p className="it-role">{meta.role}</p>}
          </div>
          <dl className="it-dates">
            {interview && (
              <div className={interview.past ? 'is-past' : ''}>
                <dt>Interview</dt>
                <dd>
                  <strong>{interview.text}</strong>
                  <span>{when}</span>
                </dd>
              </div>
            )}
            {slides && (
              <div className={slides.past ? 'is-past' : ''}>
                <dt>Slides due</dt>
                <dd>
                  <strong>{slides.text}</strong>
                  <span>{whenText(meta.slidesDue, meta.timezone, localZone())}</span>
                </dd>
              </div>
            )}
            {!interview && (
              <div>
                <dt>Interview</dt>
                <dd>
                  <span>Add a date to target.md</span>
                </dd>
              </div>
            )}
          </dl>
        </header>

        <div className="it-top">
          <Readiness areas={areas} overall={overall} />
          <section className="it-sources" aria-label="Sources">
            <span className="it-eyebrow">Your material</span>
            {b.context ? (
              <p className="it-src-line">
                <strong>{b.context.items.length}</strong> source{b.context.items.length === 1 ? '' : 's'} read {ago(b.context.at)}
                {b.context.errors.length > 0 && <span className="muted" title={b.context.errors.join('\n')}> · {b.context.errors.length} couldn’t be read</span>}
              </p>
            ) : (
              <p className="it-src-line muted">
                {meta.sources.length + meta.links.length ? `${meta.sources.length} folder${meta.sources.length === 1 ? '' : 's'} and ${meta.links.length} link${meta.links.length === 1 ? '' : 's'} not read yet` : 'Add sources and links to target.md'}
              </p>
            )}
            <div className="it-src-tools">
              <button className="btn small" onClick={gather} disabled={!!busy || !(meta.sources.length + meta.links.length)}>
                {busy === 'gather' ? <span className="spinner" /> : <Icon name="refresh" size={12} />}
                {b.context ? 'Read again' : 'Read them'}
              </button>
              <button className="btn small ghost" onClick={() => app.openPath(`${meta.folder}/target.md`)}>
                Open target.md
              </button>
            </div>
            {step && <p className="it-step">{step}</p>}
            {!b.claude && <p className="it-note">Claude isn’t available, so drills are marked in code and nothing new is written. Everything else works.</p>}
          </section>
        </div>

        <nav className="it-modes" role="tablist" aria-label="Teach or interview">
          <button role="tab" aria-selected={modeNow === 'teach'} className={`it-mode${modeNow === 'teach' ? ' on' : ''}`} onClick={() => pickMode('teach')}>
            <Icon name="tutor" size={18} />
            <span>
              <strong>Teach me</strong>
              <span>What they expect, and the subject from zero</span>
            </span>
          </button>
          <button role="tab" aria-selected={modeNow === 'interview'} className={`it-mode${modeNow === 'interview' ? ' on' : ''}`} onClick={() => pickMode('interview')}>
            <Icon name="subInterview" size={18} />
            <span>
              <strong>Interview me</strong>
              <span>Drills and mock rounds, with feedback</span>
            </span>
          </button>
        </nav>

        {modeNow === 'teach' ? (
          <div className="it-body">
            <Section
              id="course"
              title={course ? course.title : 'Course'}
              count={course?.modules.length ? `${course.modules.filter((m) => m.status === 'passed').length} of ${course.modules.length} modules` : undefined}
              open
              action={
                nextModule && course ? (
                  <button className="btn small primary" onClick={() => app.setView({ kind: 'session', mode: 'teach', scope: course.notebook ? { kind: 'folder', path: course.notebook } : { kind: 'folder', path: meta.folder }, topic: nextModule.next!, nonce: Date.now() })}>
                    Next lesson
                  </button>
                ) : undefined
              }
            >
              {!course ? (
                <p className="it-empty">Name a course in target.md (“course: &lt;track id&gt;”) and its modules show here, each lesson followed by that day’s cards.</p>
              ) : !course.modules.length ? (
                <p className="it-empty">The course “{course.track}” isn’t in Roadmaps/Tracks yet.</p>
              ) : (
                <ul className="it-modules">
                  {course.modules.map((m) => (
                    <li key={m.id} className={`is-${m.status}`}>
                      <span className="it-mod-title">{m.title}</span>
                      <span className="it-bar-track" aria-hidden="true">
                        <span className="it-bar-fill" style={{ width: m.total ? `${Math.max(m.solid ? 2 : 0, (m.solid / m.total) * 100)}%` : 0 }} />
                      </span>
                      <span className="it-mod-value tabular">{m.status === 'locked' ? 'Waiting' : m.status === 'passed' ? 'Passed' : `${m.solid} of ${m.total}`}</span>
                      {m.next && m.status !== 'locked' ? (
                        <button className="link-btn small" title={m.next} onClick={() => app.setView({ kind: 'session', mode: 'teach', scope: course.notebook ? { kind: 'folder', path: course.notebook } : { kind: 'folder', path: meta.folder }, topic: m.next!, nonce: Date.now() })}>
                          Learn
                        </button>
                      ) : (
                        <span />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section id="cards" title="Cards" count={b.cards.total ? `${b.cards.total} in the deck` : undefined} open>
              {b.cards.exists ? (
                <div className="it-slots">
                  <Slot slot={slots.morning} onReview={() => app.setView({ kind: 'study', scope: { kind: 'note', path: b.cards.path } })} />
                  <Slot slot={slots.evening} onReview={() => app.setView({ kind: 'study', scope: { kind: 'note', path: b.cards.path } })} />
                </div>
              ) : (
                <p className="it-empty">Cards are added each day from what you were taught, and from the firm’s facts and your stories.</p>
              )}
              <div className="it-inline-tools">
                <button className="btn small" disabled={!!busy || b.cards.addedToday} onClick={() => generate('cards')}>
                  {busy === 'cards' ? <span className="spinner" /> : <Icon name="cards" size={12} />}
                  {b.cards.addedToday ? 'Today’s cards are in' : 'Add today’s cards'}
                </button>
                {b.cards.exists && (
                  <button className="btn small ghost" onClick={() => app.openPath(b.cards.path)}>
                    Open cards.md
                  </button>
                )}
              </div>
            </Section>

            <Section id="answering" title="How to answer" count={`${kindsHere.length} kind${kindsHere.length === 1 ? '' : 's'} of question`}>
              <ul className="it-tiles">
                {ANSWER_KINDS.filter((k) => kindsHere.includes(k.kind)).map((k) => (
                  <li key={k.kind}>
                    <button className="it-tile" onClick={() => teach(`How to answer ${k.label.toLowerCase()} questions in a ${meta.company} ${meta.role || 'interview'}: what interviewers listen for, a structure, and a worked example from my own stories`)}>
                      <span>{k.label}</span>
                      <span className="muted">{f.questions.filter((q) => q.kind === k.kind).length} in your bank</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!kindsHere.length && <p className="it-empty">Add questions to questions.md to see how to answer each kind.</p>}
            </Section>

            <Section id="topics" title="Topics the role needs" count={topics.length ? `${topics.length}` : undefined}>
              {topics.length ? (
                <ul className="it-tiles">
                  {topics.map(({ t, path }) => (
                    <li key={t}>
                      <button className="it-tile" onClick={() => teach(t, path)}>
                        <span>{t}</span>
                        <span className="muted">Teach me from zero</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="it-empty">Add headings to frameworks.md, or research notes to presentation.md, and each becomes a lesson.</p>
              )}
            </Section>
          </div>
        ) : (
          <div className="it-body">
            <Section id="plan" title="Today’s plan" count={plan.length ? `${plan.reduce((n, p) => n + p.minutes, 0)} min` : undefined} open>
              {plan.length ? (
                <ol className="it-plan">
                  {plan.map((p, i) => (
                    <li key={p.key}>
                      <button className="it-plan-item" onClick={() => startPlan(p)}>
                        <span className="it-plan-n tabular">{i + 1}</span>
                        <span className="it-row-main">
                          <span className="it-row-title">{p.label}</span>
                          <span className="it-row-meta">{p.area ? areas.find((a) => a.area === p.area)?.label : 'Cards'} · {p.minutes} min</span>
                        </span>
                        <Icon name="play" size={12} className="it-row-go" />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="it-empty">Nothing left for today. Everything tried today or marked strong.</p>
              )}
            </Section>

            {rounds.length > 0 && (
              <Section id="rounds" title="Mock rounds" count={`${rounds.length}`} open>
                <ul className="it-rounds">
                  {rounds.map((r) => (
                    <li key={r.id}>
                      <span className="it-row-main">
                        <span className="it-row-title">{r.name}</span>
                        <span className="it-row-meta">{[r.kind === 'hirevue' ? 'Recorded video' : r.kind[0].toUpperCase() + r.kind.slice(1), r.minutes ? `${r.minutes} min` : '', r.notes].filter(Boolean).join(' · ')}</span>
                      </span>
                      {/* Live mock: the voice round itself is built in components/interview/LiveMock* */}
                      <button className="btn small" onClick={() => liveMock(r.id)}>
                        <Icon name="mic" size={12} />
                        Live mock
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section
              id="stories"
              title="Stories"
              count={`${f.stories.length} · CV defence ${pct(areaMark('cv')?.score)}`}
              action={
                b.claude && b.context ? (
                  <button className="btn small ghost" disabled={!!busy} onClick={() => generate('stories')}>
                    {busy === 'stories' ? <span className="spinner" /> : <Icon name="sparkle" size={12} />}
                    {f.stories.length ? 'More from my CV' : 'Fill from my CV'}
                  </button>
                ) : undefined
              }
            >
              {f.stories.length ? (
                <ul className="it-rows">
                  {f.stories.map((s) => {
                    const m = markOf(`story:${s.id}`)
                    return <Row key={s.id} id={s.id} title={s.title} meta={[s.bestFor.slice(0, 3).join(', '), s.gaps.length ? `${s.gaps.length} gap${s.gaps.length === 1 ? '' : 's'} to fill` : ''].filter(Boolean).join(' · ')} {...m} onClick={() => go('cv', `story:${s.id}`)} />
                  })}
                </ul>
              ) : (
                <p className="it-empty">{b.claude ? (b.context ? 'No stories yet. Fill them from your CV, then add what only you know.' : 'No stories yet. Read your sources first, then fill them from your CV.') : 'No stories yet. Write them in stories.md.'}</p>
              )}
            </Section>

            <Section
              id="questions"
              title="Questions"
              count={`${f.questions.length}`}
              open
              action={
                b.claude && missingModels > 0 ? (
                  <button className="btn small ghost" disabled={!!busy} onClick={() => generate('answers')}>
                    {busy === 'answers' ? <span className="spinner" /> : <Icon name="sparkle" size={12} />}
                    Model answers for {missingModels}
                  </button>
                ) : undefined
              }
            >
              {f.questions.length > 0 && (
                <div className="it-filters">
                  <select value={roundFilter} onChange={(e) => setRoundFilter(e.target.value)} aria-label="Round">
                    <option value="all">Every round</option>
                    {rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as QuestionKind | 'all')} aria-label="Kind">
                    <option value="all">Every kind</option>
                    {kindsHere.map((k) => (
                      <option key={k} value={k}>
                        {k.replace('-', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {questions.length ? (
                <ul className="it-rows">
                  {questions.map((q) => {
                    const m = markOf(`q:${q.id}`)
                    const round = rounds.find((r) => r.id === q.round)?.name
                    return <Row key={q.id} id={q.id} title={q.text} meta={[q.kind.replace('-', ' '), round, q.model ? 'model answer' : ''].filter(Boolean).join(' · ')} {...m} onClick={() => go(q.kind === 'cv' ? 'cv' : 'behavioural', `q:${q.id}`)} />
                  })}
                </ul>
              ) : (
                <p className="it-empty">{f.questions.length ? 'None match those filters.' : 'No questions yet. Add them to questions.md.'}</p>
              )}
            </Section>

            <Section id="scenarios" title="Scenarios" count={`${f.scenarios.length}`}>
              {f.scenarios.length ? (
                <ul className="it-rows">
                  {f.scenarios.map((c) => (
                    <Row key={c.id} id={c.id} title={c.title} meta={`${c.parts.length} parts · ${c.rubric.length} points to cover`} {...markOf(`scenario:${c.id}`)} onClick={() => go('scenario', `scenario:${c.id}`)} />
                  ))}
                </ul>
              ) : (
                <p className="it-empty">No cases yet. Add them to scenarios.md, a part at a time, with a rubric.</p>
              )}
            </Section>

            <Section id="presentation" title="Presentation" count={f.presentation ? `${f.presentation.checklist.filter((c) => c.done).length} of ${f.presentation.checklist.length} done` : undefined}>
              {f.presentation ? (
                <>
                  {f.presentation.topic && <p className="it-topic">{f.presentation.topic}</p>}
                  <ul className="it-checklist">
                    {f.presentation.checklist.map((c, i) => (
                      <li key={i} className={c.done ? 'is-done' : ''}>
                        <Icon name={c.done ? 'check' : 'dot'} size={12} />
                        {c.text}
                      </li>
                    ))}
                  </ul>
                  <ul className="it-rows">
                    <Row title={`Timed run, ${f.presentation.minutes} minutes`} meta="Speak it; checked against the brief and the clock" {...markOf('talk')} onClick={() => go('talk', 'talk')} />
                    {f.presentation.assessor.map((a) => (
                      <Row key={a.id} id={a.id} title={a.question} meta="Assessor question" {...markOf(`assessor:${a.id}`)} onClick={() => go('assessor', `assessor:${a.id}`)} />
                    ))}
                  </ul>
                </>
              ) : (
                <p className="it-empty">No presentation.md. Add the brief as a checklist and “## Assessor questions”.</p>
              )}
            </Section>

            <Section id="firm" title="Firm facts" count={`${f.firm.length}`} action={f.firm.length ? <button className="btn small ghost" onClick={() => go('firm', 'firm:facts')}>Test me</button> : undefined}>
              {f.firm.length ? (
                <div className="it-firm">
                  {Object.entries(firmBySection).map(([sec, xs]) => (
                    <div key={sec}>
                      <h3>{sec}</h3>
                      <ul>
                        {xs.map((x, i) => (
                          <li key={i}>
                            {x.text}
                            {(x.source || x.date) && <span className="it-src"> {[x.source, x.date].filter(Boolean).join(', ')}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="it-empty">No facts yet. Add them to firm.md, each with its source and date.</p>
              )}
            </Section>

            <Section id="ask" title="Questions to ask" count={`${items.ask.length} interviewer${items.ask.length === 1 ? '' : 's'}`}>
              {f.ask.groups.length ? (
                <>
                  {f.ask.rules.map((r, i) => (
                    <p key={i} className="it-rule">
                      {r}
                    </p>
                  ))}
                  <ul className="it-rows">
                    {f.ask.groups.map((g) => (
                      <Row key={g.who} title={g.who.replace(/\s*\(.*\)\s*$/, '')} meta={`${g.questions.length} question${g.questions.length === 1 ? '' : 's'}`} {...markOf(`ask:${g.who}`)} onClick={() => go('ask', `ask:${g.who}`)} />
                    ))}
                  </ul>
                </>
              ) : (
                <p className="it-empty">No ask-them.md yet. Group questions by who you’ll meet.</p>
              )}
            </Section>
          </div>
        )}
        {meta.notes && (
          <p className="it-foot muted small">
            Notes in target.md · <button className="link-btn small" onClick={() => app.openPath(`${meta.folder}/target.md`)}>open</button>
          </p>
        )}
      </div>
    </div>
  )
}

