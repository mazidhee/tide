import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { readyAcross, revisitList, SOLID, shareRight, since, standing, STATUS_LABEL, tickedOnly, type ConceptState, type ConceptStatus, type KnowledgeView, type MissedQuestion, type WeekPoint } from '@shared/knowledge'
import { Icon } from './Icon'
import { KnowPage } from './know/KnowPage'

/**
 * What you know, as one page: how much is solid today, what to go back to, what is ready to learn
 * next, how well things have stuck week by week, and every concept by area. It is given its data
 * and what to do when a lesson or a check is asked for, and nothing else, so it can be mounted
 * outside the app (design/prototype/knowledge) exactly as it is inside it.
 */
export interface KnowledgeMapProps {
  data: KnowledgeView
  onLesson(c: ConceptState): void
  onCheck(c: ConceptState): void
  onNewTopic?(): void
  /** Review a topic that is solid or fading: its kept questions that are due; a check when not given */
  onReview?(c: ConceptState): void
  /** A question missed on a topic: the lesson moment it came from, or (with `ask`) the question asked again */
  onMissed?(c: ConceptState, m: MissedQuestion, ask?: boolean): void
  /** The new design: areas as bands of cells, each cell a concept with its level */
  tide?: boolean
  /** The class carrying an area's colour, for its levels */
  areaClass?(area: string): string
}

const NO_AREA = 'Outside your roadmaps'
/** An area this small is shown in full; a bigger one opens when asked */
const OPEN_UP_TO = 24
/** The strip of cells is only worth drawing once the list is too long to take in */
const STRIP_FROM = 13
const SHORT_LIST = 5

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
const pct = (x: number) => `${Math.round(x * 100)}%`

type Filter = ConceptStatus | 'all'

interface Area {
  name: string
  label: string
  topics: ConceptState[]
  counts: Record<ConceptStatus, number>
  private: boolean
}

export function KnowledgeMap({ data, onLesson, onCheck, onReview, onMissed, onNewTopic, tide, areaClass = () => '' }: KnowledgeMapProps) {
  const now = data.at
  const byId = useMemo(() => new Map(data.concepts.map((c) => [c.id, c])), [data])
  const parts = useMemo(() => {
    const m = new Map<string, ConceptState[]>()
    for (const c of data.concepts) if (c.parent) m.set(c.parent, [...(m.get(c.parent) ?? []), c])
    for (const l of m.values()) l.sort((a, b) => a.order - b.order)
    return m
  }, [data])
  const topics = useMemo(() => data.concepts.filter((c) => !c.parent), [data])
  const counts = useMemo(() => {
    const n: Record<ConceptStatus, number> = { solid: 0, fading: 0, learning: 0, new: 0 }
    for (const c of topics) n[c.status]++
    return n
  }, [topics])
  const areas = useMemo(() => {
    const m = new Map<string, Area>()
    for (const c of topics) {
      const a = m.get(c.area) ?? { name: c.area, label: c.area || NO_AREA, topics: [], counts: { solid: 0, fading: 0, learning: 0, new: 0 }, private: true }
      a.topics.push(c)
      a.counts[c.status]++
      a.private &&= c.private
      m.set(c.area, a)
    }
    for (const a of m.values()) a.topics.sort((x, y) => Number(x.origin !== 'roadmap') - Number(y.origin !== 'roadmap') || x.order - y.order || x.name.localeCompare(y.name))
    // Where there is something to see first; an area nothing has happened in yet goes last
    return [...m.values()].sort((a, b) => Number(!!b.name) - Number(!!a.name) || b.topics.length - b.counts.new - (a.topics.length - a.counts.new) || a.label.localeCompare(b.label))
  }, [topics])

  const readyAll = useMemo(() => data.ready.map((id) => byId.get(id)).filter((c): c is ConceptState => !!c), [data, byId])
  const readyIds = useMemo(() => new Set(data.ready), [data])
  const revisit = useMemo(() => revisitList(data.concepts, readyIds), [data, readyIds])

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [shut, setShut] = useState<Set<string>>(() => new Set())
  const [picked, setPicked] = useState<string | null>(null)
  const [more, setMore] = useState<{ revisit: boolean; ready: boolean }>({ revisit: false, ready: false })
  // In the new design an area shows what you have begun and what is ready; the rest opens when asked
  const [whole, setWhole] = useState<Set<string>>(() => new Set())
  const rootRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const narrowed = filter !== 'all' || !!q
  const matches = (c: ConceptState) => (filter === 'all' || c.status === filter) && (!q || c.name.toLowerCase().includes(q) || (c.section ?? '').toLowerCase().includes(q))
  const isOpen = (a: Area) => (narrowed ? !shut.has(a.name) : open.has(a.name) || (a.topics.length <= OPEN_UP_TO && !shut.has(a.name)))
  const toggle = (a: Area) => {
    const was = isOpen(a)
    const flip = (set: Set<string>, on: boolean) => {
      const next = new Set(set)
      if (on) next.add(a.name)
      else next.delete(a.name)
      return next
    }
    setOpen((s) => flip(s, !was))
    setShut((s) => flip(s, was))
  }

  /** Goes to a concept wherever it is: opens its area, shows its detail and brings it into view */
  const goTo = (c: ConceptState) => {
    const target = c.parent ? byId.get(c.parent) ?? c : c
    setFilter('all')
    setQuery('')
    setOpen((s) => new Set(s).add(target.area))
    setShut((s) => {
      const next = new Set(s)
      next.delete(target.area)
      return next
    })
    setPicked(target.id)
  }
  useEffect(() => {
    if (!picked) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-concept="${CSS.escape(picked)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [picked])

  if (!topics.length) {
    return (
      <div className="know" ref={rootRef}>
        <header className="know-head">
          <h1 className="page-title">What you know</h1>
          <p className="know-lede">Nothing yet. The topics of your roadmaps appear here, and every lesson, quiz and recall question adds what it showed: what is solid, what is fading, and what is ready to learn next.</p>
          {onNewTopic && (
            <button className="btn primary" onClick={onNewTopic}>
              Start a topic
            </button>
          )}
        </header>
      </div>
    )
  }

  const total = topics.length
  const begun = total - counts.new
  const shownRevisit = more.revisit ? revisit : revisit.slice(0, SHORT_LIST)
  const readyTop = more.ready ? readyAll.slice(0, 40) : readyAcross(readyAll, SHORT_LIST)

  if (tide) return <KnowPage data={data} areaClass={areaClass} actions={{ onLesson, onCheck, onReview: onReview ?? onCheck, onMissed }} />

  return (
    <div className="know" ref={rootRef}>
      <header className="know-head">
        <h1 className="page-title">What you know</h1>
        <p className="know-lede">
          {begun === 0 ? (
            <>
              {plural(total, 'topic')} on your roadmaps, none studied here yet. This fills in as you take lessons and answer questions.
            </>
          ) : (
            <>
              <strong>{counts.solid.toLocaleString('en-GB')}</strong> of {plural(total, 'topic')} {counts.solid === 1 ? 'is' : 'are'} solid today
              {counts.fading > 0 && (
                <>
                  , <strong>{counts.fading}</strong> {counts.fading === 1 ? 'is' : 'are'} fading
                </>
              )}
              {counts.learning > 0 && (
                <>
                  {counts.fading > 0 ? ' and ' : ', '}
                  <strong>{counts.learning}</strong> {counts.learning === 1 ? 'is' : 'are'} in progress
                </>
              )}
              .
            </>
          )}
        </p>
        <Share counts={counts} total={total} />
        <p className="know-key" aria-hidden="true">
          {(['solid', 'fading', 'learning', 'new'] as ConceptStatus[]).map((s) => (
            <span key={s}>
              <span className={`know-dot s-${s}`} />
              {STATUS_LABEL[s]}
            </span>
          ))}
        </p>
      </header>

      <div className="know-two">
        <section aria-labelledby="know-revisit">
          <h2 id="know-revisit" className="know-h">
            Revisit
            {revisit.length > 0 && <span className="know-n">{revisit.length}</span>}
          </h2>
          {revisit.length ? (
            <ul className="know-list">
              {shownRevisit.map((c) => (
                <Line key={c.id} c={c} now={now} sub={`${c.area || NO_AREA} · ${why(c, now)}`} action="Check" onAction={() => onCheck(c)} onOpen={() => goTo(c)} />
              ))}
            </ul>
          ) : (
            <p className="know-none">{begun ? 'Nothing is slipping. What you have learnt is holding.' : 'What starts to fade, or was answered wrong, is listed here.'}</p>
          )}
          {revisit.length > SHORT_LIST && (
            <button className="know-more" onClick={() => setMore((m) => ({ ...m, revisit: !m.revisit }))}>
              {more.revisit ? 'Show fewer' : `Show all ${revisit.length}`}
            </button>
          )}
        </section>

        <section aria-labelledby="know-ready">
          <h2 id="know-ready" className="know-h">
            Ready next
            {readyAll.length > 0 && <span className="know-n">{readyAll.length}</span>}
          </h2>
          {readyAll.length ? (
            <ul className="know-list">
              {readyTop.map((c) => (
                <Line key={c.id} c={c} now={now} sub={`${c.area || NO_AREA} · ${after(c, byId)}`} action={c.seen ? 'Continue' : 'Start'} onAction={() => onLesson(c)} onOpen={() => goTo(c)} />
              ))}
            </ul>
          ) : (
            <p className="know-none">Nothing is ready yet: what the next topics build on needs another look first.</p>
          )}
          {readyAll.length > SHORT_LIST && (
            <button className="know-more" onClick={() => setMore((m) => ({ ...m, ready: !m.ready }))}>
              {more.ready ? 'Show fewer' : readyAll.length > 40 ? 'Show the first 40' : `Show all ${readyAll.length}`}
            </button>
          )}
        </section>
      </div>

      <section className="know-block" aria-labelledby="know-retention">
        <h2 id="know-retention" className="know-h">
          Retention
        </h2>
        <Retention weeks={data.weeks} />
      </section>

      <section className="know-block" aria-labelledby="know-areas">
        <div className="know-bar">
          <h2 id="know-areas" className="know-h">
            By area
          </h2>
          <div className="know-filters">
            <div className="segmented text know-status" role="group" aria-label="Show">
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>
                All
              </button>
              {(['solid', 'fading', 'learning', 'new'] as ConceptStatus[]).map((s) => (
                <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(filter === s ? 'all' : s)} aria-pressed={filter === s} disabled={!counts[s]}>
                  <span className={`know-dot s-${s}`} aria-hidden="true" />
                  {STATUS_LABEL[s]}
                  <span className="know-count">{counts[s].toLocaleString('en-GB')}</span>
                </button>
              ))}
            </div>
            {total > 12 && <input className="filter-input small" type="search" placeholder="Find a topic" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a topic" />}
          </div>
        </div>

        {areas.map((a) => {
          const rows = narrowed ? a.topics.filter(matches) : a.topics
          if (narrowed && !rows.length) return null
          const opened = isOpen(a)
          const done = a.counts.solid
          return (
            <div key={a.name} className={`know-area${opened ? ' open' : ''}`}>
              <button className="know-area-head" onClick={() => toggle(a)} aria-expanded={opened}>
                <Icon name="chevron" size={14} className="know-chev" />
                <span className="know-area-name">{a.label}</span>
                <span className="know-area-meta">
                  {narrowed ? `${rows.length} of ${a.topics.length}` : `${done} of ${a.topics.length} solid`}
                  {!narrowed && a.counts.fading > 0 && <span className="know-warn"> · {a.counts.fading} fading</span>}
                  {a.private && ' · private, stays on this Mac'}
                </span>
              </button>
              {a.topics.length >= STRIP_FROM && <Strip topics={a.topics} dim={narrowed ? (c) => !matches(c) : undefined} picked={picked} onPick={goTo} />}
              {opened && <Rows rows={rows} now={now} byId={byId} parts={parts} ready={readyIds} picked={picked} onPick={(id) => setPicked(picked === id ? null : id)} goTo={goTo} onLesson={onLesson} onCheck={onCheck} onReview={onReview} />}
            </div>
          )
        })}
        {narrowed && !areas.some((a) => a.topics.some(matches)) && <p className="know-none">No topic matches{q ? ` “${query.trim()}”` : ''}.</p>}
      </section>

      <p className="know-foot">
        An estimate, not a mark: the chance you would remember a topic today, by the same model as your reviews (FSRS). Each answer is a review: a right one after a gap makes it last much longer, a wrong one or one you couldn’t answer makes it harder to keep, and it fades with the time since. A topic is solid when your last answer was right and the chance is {pct(SOLID)} or more.
      </p>
    </div>
  )
}

const why = (c: ConceptState, now: number) => {
  if (c.status === 'solid') return standing(c, now).detail.replace(' if unused', '')
  if (c.status === 'fading') return `last right ${since(c.lastRight ?? c.lastSeen, now)}`
  const answers = c.right + c.partly + c.wrong
  return `${c.right} of ${answers} right`
}

/** What a ready topic follows on from */
function after(c: ConceptState, byId: Map<string, ConceptState>): string {
  const before = c.prerequisites.map((id) => byId.get(id)?.name).filter(Boolean)
  if (c.seen) return standing(c, 0).detail || 'begun'
  if (before.length) return `after ${before[0]}${before.length > 1 ? ` and ${before.length - 1} more` : ''}`
  return c.section ? `opens ${c.section}` : 'nothing needed first'
}

/** The whole of it as one bar: how much is solid, fading, in progress and not started */
function Share({ counts, total }: { counts: Record<ConceptStatus, number>; total: number }) {
  const order: ConceptStatus[] = ['solid', 'fading', 'learning', 'new']
  return (
    <div className="know-share" role="img" aria-label={order.map((s) => `${STATUS_LABEL[s]} ${counts[s]}`).join(', ')}>
      {order.map((s) => (counts[s] ? <span key={s} className={`s-${s}`} style={{ flexGrow: counts[s] }} title={`${STATUS_LABEL[s]}: ${counts[s]} of ${total}`} /> : null))}
    </div>
  )
}

/** How solid, as a short bar; when it has faded, a tick marks where it stood */
function Meter({ c }: { c: ConceptState }) {
  return (
    <span className={`know-meter s-${c.status}`} role="img" aria-label={`${pct(c.estimate)} solid`} title={`${pct(c.estimate)}${c.status === 'fading' ? `, was ${pct(c.level)}` : ''}`}>
      <span style={{ width: `${Math.round(c.estimate * 100)}%` }} />
      {c.status === 'fading' && <i style={{ left: `${Math.round(c.level * 100)}%` }} />}
    </span>
  )
}

function Line({ c, sub, action, onAction, onOpen }: { c: ConceptState; now: number; sub: string; action: string; onAction(): void; onOpen(): void }) {
  return (
    <li className="know-line">
      <button className="know-line-main" onClick={onOpen} title="Show it in its area">
        <span className="know-line-name">{c.name}</span>
        <span className="know-line-sub">{sub}</span>
      </button>
      <Meter c={c} />
      <button className="btn small" onClick={onAction}>
        {action}
      </button>
    </li>
  )
}

/** Every topic of an area as one cell, in roadmap order: its height is how solid it is, its colour its status */
function Strip({ topics, dim, picked, onPick }: { topics: ConceptState[]; dim?: (c: ConceptState) => boolean; picked: string | null; onPick(c: ConceptState): void }) {
  // A section's cells stay together, so a line never ends part-way through one
  const groups: ConceptState[][] = []
  for (const c of topics) {
    const last = groups[groups.length - 1]
    if (last && last[0].section === c.section && last.length < 40) last.push(c)
    else groups.push([c])
  }
  return (
    <div className="know-strip" aria-label="Every topic, in roadmap order">
      {groups.map((g) => (
        <span key={g[0].id} className="know-strip-group" title={g[0].section}>
          {g.map((c) => (
          <button
            key={c.id}
            className={`know-cell s-${c.status}${dim?.(c) ? ' dim' : ''}${picked === c.id ? ' picked' : ''}${tickedOnly(c) ? ' ticked' : ''}`}
            title={`${c.name}: ${STATUS_LABEL[c.status].toLowerCase()}${c.status !== 'new' ? `, ${pct(c.estimate)}` : c.done ? ' (ticked)' : ''}`}
            aria-label={`${c.name}, ${STATUS_LABEL[c.status]}`}
            onClick={() => onPick(c)}
          >
            <span style={{ height: `${c.status === 'new' ? 0 : Math.max(18, Math.round(c.estimate * 100))}%` }} />
          </button>
          ))}
        </span>
      ))}
    </div>
  )
}

function Rows(p: {
  rows: ConceptState[]
  now: number
  byId: Map<string, ConceptState>
  parts: Map<string, ConceptState[]>
  ready: Set<string>
  picked: string | null
  onPick(id: string): void
  goTo(c: ConceptState): void
  onLesson(c: ConceptState): void
  onCheck(c: ConceptState): void
  onReview?(c: ConceptState): void
}) {
  let section: string | undefined | null = null
  return (
    <ul className="know-rows">
      {p.rows.map((c) => {
        const head = c.section !== section && (c.section || section !== null) ? c.section || 'From lessons' : null
        section = c.section
        const s = standing(c, p.now)
        const on = p.picked === c.id
        return (
          <li key={c.id} data-concept={c.id} className={on ? 'on' : ''}>
            {head && <h3 className="know-section">{head}</h3>}
            <div className="know-row">
              <button className="know-row-main" onClick={() => p.onPick(c.id)} aria-expanded={on}>
                <span className="know-row-name">{c.name}</span>
                {p.ready.has(c.id) && <span className="know-tag">Ready</span>}
                <span className={`know-row-status s-${c.status}`}>
                  {s.label}
                  {s.detail && <span className="know-row-detail"> · {s.detail}</span>}
                </span>
                <Meter c={c} />
              </button>
              <span className="know-row-acts">
                <button className="btn small ghost" onClick={() => p.onLesson(c)}>
                  Lesson
                </button>
                <button className="btn small ghost" onClick={() => p.onCheck(c)}>
                  Check
                </button>
              </span>
            </div>
            {on && <Detail c={c} {...p} />}
          </li>
        )
      })}
    </ul>
  )
}

function Detail({ c, now, byId, parts, goTo, onLesson, onCheck, onReview }: { c: ConceptState; now: number; byId: Map<string, ConceptState>; parts: Map<string, ConceptState[]>; goTo(c: ConceptState): void; onLesson(c: ConceptState): void; onCheck(c: ConceptState): void; onReview?(c: ConceptState): void }) {
  const before = c.prerequisites.map((id) => byId.get(id)).filter((x): x is ConceptState => !!x)
  const steps = parts.get(c.id) ?? []
  const answers = c.right + c.partly + c.wrong
  const facts = [
    answers ? `${plural(answers, 'answer')}: ${c.right} right${c.partly ? `, ${c.partly} partly` : ''}${c.wrong ? `, ${c.wrong} wrong or not answered` : ''}` : c.seen ? 'Taught, with no marked answer yet' : c.done ? 'Ticked on your roadmap; Tide has not asked about it' : 'Nothing recorded yet',
    c.lastRight ? `last right ${since(c.lastRight, now)}` : c.lastSeen ? `last seen ${since(c.lastSeen, now)}` : '',
    c.stability !== undefined ? `now ${pct(c.estimate)}${c.status === 'fading' ? `, down from ${pct(c.level)}` : ''}` : '',
    c.stability !== undefined ? `90% likely to be remembered ${c.stability < 10 ? c.stability.toFixed(1).replace(/\.0$/, '') : Math.round(c.stability)} days after its last review` : ''
  ].filter(Boolean)
  return (
    <div className="know-detail">
      <p>{facts.join(' · ')}.</p>
      {before.length > 0 && (
        <p>
          <span className="know-k">Builds on</span>
          {before.map((b) => (
            <button key={b.id} className={`know-ref s-${b.status}`} onClick={() => goTo(b)}>
              <span className={`know-dot s-${b.status}`} aria-hidden="true" />
              {b.name}
              <span className="know-ref-s">{standing(b, now).label.toLowerCase()}</span>
            </button>
          ))}
        </p>
      )}
      {steps.length > 0 && (
        <div className="know-parts">
          <span className="know-k">Parts taught</span>
          <ul>
            {steps.map((s) => {
              const st = standing(s, now)
              return (
                <li key={s.id}>
                  <span className={`know-dot s-${s.status}`} aria-hidden="true" />
                  <span className="know-part-name">{s.name}</span>
                  <span className="know-part-s">
                    {st.label.toLowerCase()}
                    {st.detail ? `, ${st.detail}` : ''}
                  </span>
                  <button className="know-part-go" onClick={() => onCheck(s)}>
                    Check
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <div className="know-detail-acts">
        {(c.status === 'solid' || c.status === 'fading') && onReview ? (
          <>
            <button className="btn small primary" onClick={() => onReview(c)}>
              Review now
            </button>
            <button className="btn small" onClick={() => onCheck(c)}>
              Quick check
            </button>
            <button className="btn small" onClick={() => onLesson(c)}>
              Lesson
            </button>
          </>
        ) : (
          <>
            <button className="btn small primary" onClick={() => (c.status === 'solid' || c.status === 'fading' ? onCheck(c) : onLesson(c))}>
              {c.status === 'solid' || c.status === 'fading' ? 'Quick check' : c.seen ? 'Continue with a lesson' : 'Start a lesson'}
            </button>
            <button className="btn small" onClick={() => (c.status === 'solid' || c.status === 'fading' ? onLesson(c) : onCheck(c))}>
              {c.status === 'solid' || c.status === 'fading' ? 'Lesson' : 'Quick check'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Retention by week ----------

const weekLabel = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const count = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * The share of returning questions answered right, week by week. One value axis (0 to 100%), a
 * thin line with a point for each week that had any, gaps where nothing came back, and the exact
 * figures on hover or with the arrow keys. Text is in the ink tokens; the line is --series-1.
 */
function Retention({ weeks }: { weeks: WeekPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(840)
  const [at, setAt] = useState<number | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const asked = weeks.reduce((n, w) => n + w.asked, 0)
  const right = weeks.reduce((n, w) => n + w.right, 0)
  if (!asked) {
    return <p className="know-none">Nothing has come back yet. When recall questions return, and when you are asked again about a topic from an earlier sitting, this shows the share you get right each week.</p>
  }

  const H = 148
  const pad = { l: 36, r: 34, t: 12, b: 24 }
  const plotW = width - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const slot = plotW / weeks.length
  const x = (i: number) => pad.l + slot * (i + 0.5)
  const y = (v: number) => pad.t + plotH * (1 - v)
  const shares = weeks.map(shareRight)
  // Joined only where neighbouring weeks both have a value: a week with nothing is a gap, not a zero
  const runs: string[] = []
  let run = ''
  shares.forEach((v, i) => {
    if (v === null) {
      if (run) runs.push(run)
      run = ''
    } else run += `${run ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
  })
  if (run) runs.push(run)
  const lastI = shares.reduce<number>((k, v, i) => (v !== null ? i : k), -1)
  const every = Math.max(1, Math.ceil(weeks.length / Math.max(2, Math.floor(plotW / 78))))
  const shown = at !== null ? weeks[at] : null
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setAt((cur) => Math.max(0, Math.min(weeks.length - 1, (cur ?? (e.key === 'ArrowLeft' ? weeks.length : -1)) + (e.key === 'ArrowLeft' ? -1 : 1))))
  }

  return (
    <>
      <p className="know-chart-say">
        Of {plural(asked, 'question')} that came back in the last {weeks.length} weeks, <strong>{pct(right / asked)}</strong> were answered right.
      </p>
      <div
        className="know-chart"
        ref={wrap}
        tabIndex={0}
        role="img"
        aria-label={`Share of returning questions answered right, by week. ${weeks.map((w) => `Week of ${weekLabel(w.start)}: ${w.asked ? `${count(w.right)} of ${w.asked}` : 'none'}`).join('. ')}`}
        onKeyDown={onKey}
        onBlur={() => setAt(null)}
        onMouseLeave={() => setAt(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const i = Math.floor((e.clientX - box.left - pad.l) / slot)
          setAt(i >= 0 && i < weeks.length ? i : null)
        }}
      >
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line className={v ? 'know-grid' : 'know-base'} x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
              <text className="know-tick" x={pad.l - 8} y={y(v) + 3.5} textAnchor="end">
                {pct(v)}
              </text>
            </g>
          ))}
          {at !== null && <rect className="know-band" x={pad.l + slot * at} y={pad.t} width={slot} height={plotH} />}
          {weeks.map((w, i) =>
            i % every === (weeks.length - 1) % every ? (
              <text key={w.start} className="know-tick" x={x(i)} y={H - 6} textAnchor="middle">
                {i === weeks.length - 1 ? 'This week' : weekLabel(w.start)}
              </text>
            ) : null
          )}
          {runs.map((d) => (
            <path key={d} className="know-line-path" d={d} />
          ))}
          {shares.map((v, i) => (v === null ? null : <circle key={i} className={`know-point${at === i ? ' on' : ''}`} cx={x(i)} cy={y(v)} r={at === i ? 4 : 3} />))}
          {lastI >= 0 && at === null && (
            <text className="know-value" x={x(lastI) + 8} y={y(shares[lastI]!) + 4}>
              {pct(shares[lastI]!)}
            </text>
          )}
        </svg>
        {shown && at !== null && (
          <div className="know-tip" style={{ left: Math.min(width - 96, Math.max(96, x(at))), top: shares[at] === null ? pad.t + plotH / 2 : y(shares[at]!) }}>
            <span className="know-tip-when">Week of {weekLabel(shown.start)}</span>
            {shown.asked ? (
              <span>
                <strong>{pct(shown.right / shown.asked)}</strong> · {count(shown.right)} of {shown.asked} right
              </span>
            ) : (
              <span>Nothing came back</span>
            )}
          </div>
        )}
      </div>
    </>
  )
}
