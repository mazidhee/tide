import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { since, type ConceptState, type KnowledgeView, type MissedQuestion } from '@shared/knowledge'
import { KIND_LABEL, kindOf, layout, syllabus, type Subject, type TopicKind } from '@shared/knowSyllabus'
import { fadeText } from '@shared/knowTimeline'
import { Level } from '../tide/Level'
import { AreaMark } from '../tide/AreaMark'
import { Icon } from '../Icon'

/**
 * What you know, by subject: each notebook's roadmap as a syllabus being filled in (shared/knowSyllabus.ts
 * lays it out). A topic opens in place to show what it rests on, the questions missed on it, and
 * what to do next.
 */
export interface Actions {
  onLesson(c: ConceptState): void
  onCheck(c: ConceptState): void
  onReview(c: ConceptState): void
  /** A question missed on it: the lesson moment it came from, or (with `ask`) the question asked again */
  onMissed?(c: ConceptState, m: MissedQuestion, ask?: boolean): void
}

type Filter = 'all' | 'fading' | 'ready' | 'new'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'fading', label: 'Fading' },
  { id: 'ready', label: 'Ready next' },
  { id: 'new', label: 'Not started' }
]
/** Studied besides the roadmap: this many before "more" */
const ALSO_SHOWN = 5

const n = (x: number) => x.toLocaleString('en-GB')
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`

/** A topic's standing in one short line under its name */
export function standingLine(c: ConceptState, kind: TopicKind, now: number): string {
  const studied = c.lastSeen ? `studied ${since(c.lastSeen, now)}` : ''
  if (kind === 'solid') {
    const fade = fadeText(c.fadesAt, now)
    return [fade ? `Solid, ${fade}` : 'Solid', studied].filter(Boolean).join('; ')
  }
  if (kind === 'fading') return `Fading; last right ${since(c.lastRight ?? c.lastSeen, now)}`
  if (kind === 'learning') {
    const answers = c.right + c.partly + c.wrong
    return [`Learning, ${answers ? `${c.right} of ${answers} right` : 'not checked yet'}`, studied].filter(Boolean).join('; ')
  }
  if (kind === 'ready') return c.done ? 'Ready next; ticked on your roadmap' : 'Ready next'
  return c.done ? 'Not started here; ticked on your roadmap' : 'Not started'
}

export function KnowSubjects({ data, ready, areaClass, actions }: { data: KnowledgeView; ready: Set<string>; areaClass(area: string): string; actions: Actions }) {
  const now = data.at
  const notebooks = useMemo(() => data.areas.map((a) => a.name), [data])
  const subjects = useMemo(() => syllabus(data.concepts, ready, notebooks), [data, ready, notebooks])
  const byId = useMemo(() => new Map(data.concepts.map((c) => [c.id, c])), [data])
  const totals = useMemo(() => {
    const t: Record<TopicKind, number> = { solid: 0, fading: 0, learning: 0, ready: 0, new: 0 }
    for (const s of subjects) for (const k of Object.keys(t) as TopicKind[]) t[k] += s.counts[k]
    return t
  }, [subjects])

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [picked, setPicked] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const match = useMemo(() => {
    if (filter === 'all' && !q) return undefined
    return (c: ConceptState) => (filter === 'all' || kindOf(c, ready) === filter) && (!q || c.name.toLowerCase().includes(q) || (c.section ?? '').toLowerCase().includes(q))
  }, [filter, q, ready])

  const unfold = (key: string) => setOpen((s) => new Set(s).add(key))
  const pick = (id: string | null) => setPicked((p) => (p === id ? null : id))

  /** Goes to a topic from somewhere else on the page: clears what narrows it, unfolds it and opens it */
  const goTo = (c: ConceptState) => {
    setFilter('all')
    setQuery('')
    const s = subjects.find((x) => x.area === c.area)
    const p = s?.phases.findIndex((ph) => ph.topics.some((t) => t.id === c.id)) ?? -1
    if (s && p >= 0) {
      const fold = layout(s, ready, open).find((b) => b.kind === 'tail' && b.from <= p && p <= b.to)
      setOpen((o) => {
        const next = new Set(o).add(s.phases[p].key)
        if (fold?.kind === 'tail') next.add(fold.key)
        return next
      })
    }
    if (s && p < 0) setOpen((o) => new Set(o).add(`also:${s.area}`))
    setPicked(c.id)
  }
  useEffect(() => {
    if (!picked) return
    root.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(picked)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [picked])

  /** Up and down move between the rows of a column */
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')]
    const i = rows.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  const count: Record<Filter, number> = { all: totals.solid + totals.fading + totals.learning + totals.ready + totals.new, fading: totals.fading, ready: totals.ready, new: totals.new }
  const shown = subjects.map((s) => ({ s, blocks: layout(s, ready, open, match), also: match ? s.also.filter(match) : s.also })).filter((x) => !match || x.blocks.length || x.also.length)

  return (
    <div ref={root}>
      <div className="ks-tools">
        <div className="segmented text" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} disabled={f.id !== 'all' && !count[f.id]}>
              {f.label}
              <span className="ks-count">{n(count[f.id])}</span>
            </button>
          ))}
        </div>
        <label className="ks-find">
          <Icon name="search" size={14} />
          <input type="search" placeholder="Find a topic" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a topic" />
        </label>
      </div>

      {shown.length ? (
        <div className="ks-cols">
          {shown.map(({ s, blocks, also }) => (
            <section key={s.area} className={`ks-col ${areaClass(s.area)}`} aria-label={s.label} onKeyDown={onKey}>
              <SubjectHead s={s} />
              {blocks.map((b) =>
                b.kind === 'tail' ? (
                  <button key={b.key} className="ks-tail" data-nav onClick={() => unfold(b.key)}>
                    <span>
                      {b.to - b.from + 1} more phases, {plural(b.topics, 'topic')} not started
                    </span>
                    <Icon name="chevron" size={12} />
                  </button>
                ) : (
                  <div key={b.phase.key} className={`ks-phase${b.here ? ' here' : ''}`}>
                    <h3 className="ks-phase-head">
                      <span className="ks-phase-name">{b.phase.name || 'Topics'}</span>
                      {b.here && !match && <span className="ks-here">{s.begun ? 'You are here' : 'Start here'}</span>}
                      <span className="ks-phase-n">
                        {b.phase.solid} of {b.phase.topics.length} solid
                      </span>
                    </h3>
                    <ul className="ks-rows">
                      {b.rows.map((r, i) =>
                        r.kind === 'more' ? (
                          <li key={`more-${i}`}>
                            <button className="ks-more" data-nav onClick={() => unfold(r.key)}>
                              +{n(r.count)} not started
                            </button>
                          </li>
                        ) : (
                          <TopicRow key={r.c.id} c={r.c} kind={kindOf(r.c, ready)} now={now} picked={picked === r.c.id} onPick={() => pick(r.c.id)} area={areaClass(r.c.area)}>
                            {picked === r.c.id && <TopicPanel c={r.c} kind={kindOf(r.c, ready)} data={data} byId={byId} ready={ready} areaClass={areaClass} goTo={goTo} actions={actions} onClose={() => setPicked(null)} />}
                          </TopicRow>
                        )
                      )}
                    </ul>
                  </div>
                )
              )}
              {also.length > 0 && (
                <div className="ks-phase also">
                  <h3 className="ks-phase-head">
                    <span className="ks-phase-name">{s.phases.length ? 'Also studied' : 'Studied'}</span>
                    <span className="ks-phase-n">not on {s.phases.length ? 'the roadmap' : 'a roadmap'}</span>
                  </h3>
                  <ul className="ks-rows">
                    {(match || open.has(`also:${s.area}`) ? also : also.slice(0, ALSO_SHOWN)).map((c) => (
                      <TopicRow key={c.id} c={c} kind={kindOf(c, ready)} now={now} picked={picked === c.id} onPick={() => pick(c.id)} area={areaClass(c.area)}>
                        {picked === c.id && <TopicPanel c={c} kind={kindOf(c, ready)} data={data} byId={byId} ready={ready} areaClass={areaClass} goTo={goTo} actions={actions} onClose={() => setPicked(null)} />}
                      </TopicRow>
                    ))}
                    {!match && !open.has(`also:${s.area}`) && also.length > ALSO_SHOWN && (
                      <li>
                        <button className="ks-more" data-nav onClick={() => unfold(`also:${s.area}`)}>
                          +{n(also.length - ALSO_SHOWN)} more
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <p className="ks-none">No topic matches{q ? ` “${query.trim()}”` : ''}.</p>
      )}
    </div>
  )
}

function SubjectHead({ s }: { s: Subject }) {
  const roadmapTotal = s.phases.reduce((k, p) => k + p.topics.length, 0)
  const solid = s.phases.reduce((k, p) => k + p.solid, 0)
  const here = s.here >= 0 ? s.phases[s.here] : undefined
  const begun = s.counts.solid + s.counts.fading + s.counts.learning
  return (
    <header className="ks-head">
      <h2>
        <AreaMark area={s.area} size={16} />
        <span>{s.label}</span>
      </h2>
      {roadmapTotal > 0 ? (
        <>
          <p className="ks-head-say">
            {solid} of {plural(roadmapTotal, 'topic')} solid
            {s.counts.fading > 0 && `, ${s.counts.fading} fading`}
            {s.private && ', private'}
          </p>
          <div className="ks-fill" role="img" aria-label={`${solid} of ${roadmapTotal} solid, ${s.counts.fading} fading, ${s.counts.learning} learning`}>
            {(['solid', 'fading', 'learning'] as const).map((k) => (s.counts[k] ? <i key={k} className={k} style={{ width: `${Math.max(0.6, (s.counts[k] / Math.max(1, s.total)) * 100)}%` }} /> : null))}
          </div>
          {here && <p className="ks-head-now">{s.begun ? `Now in ${here.name || 'the first part'}` : `Start with ${here.name || 'the first part'}`}</p>}
        </>
      ) : (
        <p className="ks-head-say">{begun ? `${plural(s.total, 'topic')} studied, no roadmap` : 'No roadmap yet'}</p>
      )}
    </header>
  )
}

function TopicRow({ c, kind, now, picked, onPick, area, children }: { c: ConceptState; kind: TopicKind; now: number; picked: boolean; onPick(): void; area: string; children?: ReactNode }) {
  return (
    <li className={`ks-row k-${kind}${picked ? ' on' : ''}`}>
      <button className="ks-row-main" data-row={c.id} data-nav onClick={onPick} aria-expanded={picked}>
        <Level now={c.estimate} high={c.level} area={area} />
        <span className="ks-row-text">
          <span className="ks-row-name">{c.name}</span>
          <span className="ks-row-meta">{standingLine(c, kind, now)}</span>
        </span>
      </button>
      {children}
    </li>
  )
}

const pct = (x: number) => `${Math.round(x * 100)}%`
/** A kept question as plain text: its maths and Markdown marks taken off */
const plain = (s: string) => s.replace(/\$+/g, '').replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, '$1').replace(/[{}*`]/g, '').replace(/\s+/g, ' ').trim()

function TopicPanel(p: {
  c: ConceptState
  kind: TopicKind
  data: KnowledgeView
  byId: Map<string, ConceptState>
  ready: Set<string>
  areaClass(area: string): string
  goTo(c: ConceptState): void
  actions: Actions
  onClose(): void
}) {
  const { c, kind, data } = p
  const now = data.at
  const before = c.prerequisites.map((id) => p.byId.get(id)).filter((x): x is ConceptState => !!x)
  const missed = data.missed?.[c.id] ?? []
  const answers = c.right + c.partly + c.wrong
  const facts = [
    c.stability !== undefined ? `Held at ${pct(c.estimate)}${c.level - c.estimate >= 0.03 ? `, down from ${pct(c.level)}` : ''}.` : '',
    answers ? `${c.right} of ${plural(answers, 'answer')} right${c.wrong ? `, ${c.wrong} wrong or not answered` : ''}.` : c.seen ? 'Taught, not checked yet.' : '',
    kind === 'solid' && c.fadesAt ? `Stays solid until ${new Date(c.fadesAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} if left.` : '',
    c.firstSeen ? `First met ${since(c.firstSeen, now)}.` : ''
  ].filter(Boolean)
  const known = kind === 'solid' || kind === 'fading'
  const panel = useRef<HTMLDivElement>(null)
  return (
    <div
      className="ks-panel"
      ref={panel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          p.onClose()
          ;(panel.current?.previousElementSibling as HTMLElement | null)?.focus()
        }
      }}
    >
      {facts.length > 0 && <p className="ks-panel-facts">{facts.join(' ')}</p>}
      {(c.section || c.origin !== 'roadmap') && <p className="ks-panel-where">{c.origin === 'roadmap' ? `${c.area}, ${c.section}` : `Studied in ${c.area || 'no notebook'}, not on a roadmap`}</p>}
      <div className="ks-panel-sec">
        <h4>Rests on</h4>
        {before.length ? (
          <ul className="ks-refs">
            {before.map((b) => {
              const k = kindOf(b, p.ready)
              return (
                <li key={b.id}>
                  <button onClick={() => p.goTo(b)}>
                    <Level now={b.estimate} high={b.level} area={p.areaClass(b.area)} />
                    <span className="ks-ref-name">{b.name}</span>
                    <span className={`ks-ref-k k-${k}`}>{KIND_LABEL[k]}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="ks-panel-none">{c.origin === 'roadmap' ? 'Nothing before it on the roadmap.' : 'Nothing recorded.'}</p>
        )}
      </div>
      {missed.length > 0 && (
        <div className="ks-panel-sec">
          <h4>Missed, coming back</h4>
          <ul className="ks-missed">
            {missed.slice(0, 3).map((m, i) => (
              <li key={m.id || i}>
                {p.actions.onMissed ? (
                  <button className="ks-missed-q" onClick={() => p.actions.onMissed!(c, m)} title={m.page ? 'Open the lesson at this question' : 'Ask this question again'}>
                    {plain(m.prompt)}
                  </button>
                ) : (
                  <span className="ks-missed-q">{plain(m.prompt)}</span>
                )}
                <span className="ks-missed-side">
                  <span className="ks-missed-when">{m.due <= now ? 'due now' : `back ${new Date(m.due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}</span>
                  {p.actions.onMissed && m.page && (
                    <button className="ks-missed-ask" onClick={() => p.actions.onMissed!(c, m, true)} aria-label={`Ask again: ${plain(m.prompt).slice(0, 80)}`}>
                      Ask again
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {missed.length > 3 && <p className="ks-panel-none">and {missed.length - 3} more</p>}
        </div>
      )}
      <div className="ks-panel-acts">
        {known ? (
          <>
            <button className="btn small primary" onClick={() => p.actions.onReview(c)} title="Ask the questions kept on it that are due">
              Review now
            </button>
            <button className="btn small" onClick={() => p.actions.onCheck(c)} title="A few fresh questions to see where it stands">
              Quick check
            </button>
            <button className="ks-panel-link" onClick={() => p.actions.onLesson(c)}>
              Lesson
            </button>
          </>
        ) : (
          <>
            <button className="btn small primary" onClick={() => p.actions.onLesson(c)}>
              {c.seen ? 'Continue with a lesson' : 'Start a lesson'}
            </button>
            <button className="btn small" onClick={() => p.actions.onCheck(c)}>
              Quick check
            </button>
          </>
        )}
      </div>
    </div>
  )
}

