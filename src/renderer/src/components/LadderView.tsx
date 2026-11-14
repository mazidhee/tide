import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConceptState, KnowledgeView } from '@shared/knowledge'
import type { ChatScope } from '@shared/types'
import type { Celebration } from '@shared/ideaScore'
import { CLIMBED, groundUpNext, ladder, LEVELS, levelsOf, levelUps, RUNGS, type RungState } from '@shared/mathsLadder'
import { useApp } from '../state'
import { Celebrate } from './ideas/Celebrate'

/**
 * The maths ladder, its own page, opened from the Mathematics track and What you know (LadderLink below): arithmetic first, pricing and risk last
 * (shared/mathsLadder), in the same order as the strip above it. One thing to do next, large, at the top; a strip showing
 * the whole climb at a glance; then the rungs, with the one being worked on open to its next
 * topics. A rung moving up a level, or a new title, gets the workout's pixel party once.
 * "Teach me maths from the ground up", said anywhere, opens this page with `go` and starts the
 * next lesson straight away (once per request, so going back here doesn't start it again).
 */

const LEVELS_KEY = 'tide.ladder.levels'
const started = new Set<number>()

const read = (): Record<string, number> | null => {
  try {
    const raw = localStorage.getItem(LEVELS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : null
  } catch {
    return null
  }
}
const write = (v: Record<string, number>) => {
  try {
    localStorage.setItem(LEVELS_KEY, JSON.stringify(v))
  } catch {
    // Remembered for this visit only
  }
}

const share = (r: RungState) => (r.topics.length ? r.solid / r.topics.length : 0)
const chapterLine = (chapters: string[]) => {
  const nums = chapters.map((c) => /chapter\s+(\d+)/i.exec(c)?.[1]).filter(Boolean) as string[]
  return nums.length === chapters.length && nums.length ? `RM_MATH ch. ${nums.join(', ')}` : chapters.slice(0, 2).join(' · ')
}
const STATUS: Record<ConceptState['status'], string> = { solid: 'Solid', fading: 'Fading', learning: 'Learning', new: 'Not started' }

function Pips({ level }: { level: number }) {
  return (
    <span className="ld-pips" role="img" aria-label={`Level ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((k) => (
        <i key={k} className={k <= level ? 'on' : ''} />
      ))}
    </span>
  )
}

export function LadderView({ go }: { go?: number }) {
  const app = useApp()
  const [data, setData] = useState<KnowledgeView | null>(null)
  const [party, setParty] = useState<Celebration | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const rungRefs = useRef(new Map<string, HTMLLIElement>())

  useEffect(() => {
    let live = true
    const load = () =>
      window.tide.knowledge
        .view()
        .then((d) => live && setData(d))
        .catch(() => live && setData({ at: Date.now(), areas: [], concepts: [], ready: [], fading: [], weeks: [] }))
    load()
    const off = window.tideEvents.onBrainEvent((e) => e.kind === 'attempt' && load())
    return () => {
      live = false
      off()
    }
  }, [])

  const l = useMemo(() => (data ? ladder(data.concepts) : null), [data])
  const next = l ? groundUpNext(l) : null

  const scopeOf = (c: ConceptState): ChatScope => {
    const area = data?.areas.find((a) => a.name === c.area)
    return area ? { kind: 'folder', path: area.path } : { kind: 'vault' }
  }
  const learn = (c: ConceptState) => app.setView({ kind: 'session', mode: 'teach', scope: scopeOf(c), topic: c.name, nonce: Date.now() })

  useEffect(() => {
    if (!l) return
    const before = read()
    if (before) {
      const ups = levelUps(before, l)
      const best = ups[ups.length - 1]
      if (best) setParty({ kind: 'party', title: best.title, line: best.line })
    }
    write(levelsOf(l))
    if (go && !started.has(go) && next) {
      started.add(go)
      learn(next.topic)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l])

  if (!l) return <div className="page ladder-page" />
  const here = l.rungs[l.here]
  const nextTitle = l.climbed < RUNGS.length ? RUNGS[l.climbed].title : null
  const shown = open ?? here.rung.id
  const jump = (id: string) => {
    setOpen(id)
    rungRefs.current.get(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }

  return (
    <div className="page ladder-page">
      <div className="page-inner ld">
        <header className="ld-head">
          <h1 className="page-title">Maths ladder</h1>
          <p className="ld-sub">From arithmetic to pricing and risk, one rung at a time. Filled from your maths roadmap and measured by what you can still recall.</p>
        </header>

        <section className="ld-hero" aria-label="Up next">
          <div className="ld-hero-main">
            <p className="ld-kicker">
              Rung {l.here + 1} of {l.rungs.length} · {here.rung.label}
            </p>
            {next ? (
              <>
                <h2 className="ld-next">{next.topic.name}</h2>
                <p className="ld-hero-meta">
                  {next.topic.status === 'fading' ? 'Fading: worth a review before you go higher.' : next.topic.status === 'learning' ? 'Half learnt: pick it up where you left it.' : `Next on ${next.rung.rung.label.toLowerCase()}, ${next.rung.rung.why}.`}
                </p>
                <div className="ld-hero-actions">
                  <button className="btn primary" onClick={() => learn(next.topic)}>
                    {next.topic.status === 'fading' ? 'Review it' : 'Start the lesson'}
                  </button>
                  <span className="ld-hint">or say “teach me maths from the ground up” anywhere</span>
                </div>
              </>
            ) : (
              <h2 className="ld-next">Every rung is strong. What fades shows here first.</h2>
            )}
          </div>
          <div className="ld-badge" aria-label="Your title">
            <span className="ld-badge-label">Title</span>
            <span className="ld-badge-name">{l.title ?? 'Climbing'}</span>
            <span className="ld-badge-sub">{nextTitle ? `${nextTitle} when ${RUNGS[l.climbed].label.toLowerCase()} is strong` : 'The top of the ladder'}</span>
          </div>
        </section>

        <ol className="ld-strip" aria-label="The climb">
          {l.rungs.map((r, i) => (
            <li key={r.rung.id} className={`${i === l.here ? 'here' : ''}${r.level >= CLIMBED ? ' climbed' : ''}`}>
              <button onClick={() => jump(r.rung.id)} title={`${r.rung.label}: ${LEVELS[r.level].toLowerCase()}, ${r.solid} of ${r.topics.length} solid`}>
                <span className="ld-col">
                  <span className="ld-fill" style={{ height: `${Math.max(share(r) * 100, r.begun ? 4 : 0)}%` }} />
                </span>
                <span className="ld-col-label">{r.rung.label.replace('Arithmetic and algebra', 'Algebra').replace('Stochastic processes', 'Stochastic').replace('Pricing and risk', 'Pricing')}</span>
              </button>
            </li>
          ))}
        </ol>

        <ol className="ld-rungs">
          {l.rungs.map((r) => {
            const i = l.rungs.indexOf(r)
            const isOpen = shown === r.rung.id
            const upcoming = r.topics.filter((c) => c.status !== 'solid').slice(0, 5)
            return (
              <li
                key={r.rung.id}
                ref={(el) => {
                  if (el) rungRefs.current.set(r.rung.id, el)
                }}
                className={`ld-rung${i === l.here ? ' here' : ''}${r.level >= CLIMBED ? ' climbed' : ''}${isOpen ? ' open' : ''}`}
              >
                <button className="ld-row" onClick={() => setOpen(isOpen ? '' : r.rung.id)} aria-expanded={isOpen}>
                  <span className="ld-node" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="ld-name">
                    <span className="ld-label">{r.rung.label}</span>
                    <span className="ld-why">{r.rung.why}</span>
                  </span>
                  <span className="ld-bar" aria-hidden>
                    <span style={{ width: `${share(r) * 100}%` }} />
                  </span>
                  <span className="ld-count">
                    {r.solid}/{r.topics.length}
                  </span>
                  <span className="ld-level">
                    <Pips level={r.level} />
                    <span>{LEVELS[r.level]}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="ld-detail">
                    <p className="ld-from">
                      {r.chapters.length ? chapterLine(r.chapters) : 'Nothing on your roadmap here yet: starter topics'}
                      {r.fading ? ` · ${r.fading} fading` : ''}
                      {r.learning ? ` · ${r.learning} being learnt` : ''}
                    </p>
                    {upcoming.length ? (
                      <ul className="ld-topics">
                        {upcoming.map((c) => (
                          <li key={c.id}>
                            <span className={`ld-dot ${c.status}`} aria-hidden />
                            <span className="ld-topic">{c.name}</span>
                            <span className="ld-status">{STATUS[c.status]}</span>
                            <button className="btn small" onClick={() => learn(c)}>
                              {c.status === 'fading' ? 'Review' : 'Learn'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ld-from">Every topic here is solid.</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>

        <p className="ld-foot">A rung is strong when 70% of its topics are solid by the same FSRS estimate as your reviews, and mastered at 90% with nothing fading. Topics come from your maths roadmap’s chapters; one about pricing or risk sits on the top rung wherever it’s listed.</p>
      </div>
      {party && <Celebrate c={party} onClose={() => setParty(null)} />}
    </div>
  )
}

/**
 * The ladder's door, on the Mathematics track and What you know: where you are on it, in one
 * line, the whole page a click away.
 */
export function LadderLink({ className = '', known }: { className?: string; /** What you know, when the page has it already */ known?: KnowledgeView }) {
  const app = useApp()
  const [fetched, setData] = useState<KnowledgeView | null>(null)
  const data = known ?? fetched
  useEffect(() => {
    if (known) return
    let live = true
    window.tide.knowledge
      .view()
      .then((d) => live && setData(d))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [known])
  const l = useMemo(() => (data ? ladder(data.concepts) : null), [data])
  const begun = l && !l.rungs.every((r) => r.starters)
  return (
    <button className={`ld-link ${className}`} onClick={() => app.setView({ kind: 'ladder' })} title="The maths ladder: arithmetic first, pricing and risk last">
      <span className="ld-link-name">Maths ladder</span>
      {begun && (
        <span className="ld-link-where">
          Rung {l.here + 1} of {l.rungs.length}: {l.rungs[l.here].rung.label}
        </span>
      )}
      <span className="ld-link-strip" aria-hidden>
        {(l?.rungs ?? []).map((r, i) => (
          <i key={r.rung.id} className={begun && i === l!.here ? 'here' : r.level >= CLIMBED ? 'climbed' : r.begun ? 'begun' : ''} />
        ))}
      </span>
    </button>
  )
}
