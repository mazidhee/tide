import { useEffect, useMemo, useState } from 'react'
import type { KnowledgeView } from '@shared/knowledge'
import type { Celebration } from '@shared/ideaScore'
import { groundUpNext, ladder, LEVELS, levelsOf, levelUps, CLIMBED, type RungState } from '@shared/mathsLadder'
import { Level } from '../tide/Level'
import { Celebrate } from '../ideas/Celebrate'
import type { Actions } from './KnowSubjects'

/**
 * The maths-to-quant ladder (shared/mathsLadder): arithmetic at the bottom, pricing and risk at
 * the top, each rung filled from the learner's maths roadmap and measured by the knowledge map.
 * A rung moving up a level, or a new title, gets the workout's pixel party once.
 */

const LEVELS_KEY = 'tide.ladder.levels'
/** Set by "teach me maths from the ground up" elsewhere: the ladder opens and starts the next lesson */
export const LADDER_GO_KEY = 'tide.ladder.go'

const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
const write = (key: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // Remembered for this visit only
  }
}

function Pips({ level }: { level: number }) {
  return (
    <span className="kl-pips" role="img" aria-label={`Level ${level} of 5: ${LEVELS[level]}`}>
      {[1, 2, 3, 4, 5].map((k) => (
        <i key={k} className={k <= level ? 'on' : ''} />
      ))}
    </span>
  )
}

const chapterLine = (chapters: string[]) => {
  const nums = chapters.map((c) => /chapter\s+(\d+)/i.exec(c)?.[1]).filter(Boolean) as string[]
  if (nums.length === chapters.length && nums.length) return `RM_MATH ch. ${nums.join(', ')}`
  return chapters.slice(0, 3).join(' · ')
}

function RungRow({ r, here, index, onStart }: { r: RungState; here: boolean; index: number; onStart(): void }) {
  const climbed = r.level >= CLIMBED
  return (
    <li className={`kl-rung${here ? ' here' : ''}${climbed ? ' climbed' : ''}`}>
      <span className="kl-node" aria-hidden>
        {index + 1}
      </span>
      <div className="kl-card">
        <div className="kl-top">
          <h3 className="kl-label">{r.rung.label}</h3>
          <span className="kl-level">
            <Pips level={r.level} />
            <span>{LEVELS[r.level]}</span>
          </span>
        </div>
        <p className="kl-why">{r.rung.why}</p>
        <div className="kl-meta">
          <Level now={r.score} />
          <span>
            <b>{r.solid}</b> of {r.topics.length} solid
            {r.fading ? `, ${r.fading} fading` : ''}
            {r.learning ? `, ${r.learning} learning` : ''}
          </span>
          {r.chapters.length > 0 ? <span className="kl-from">{chapterLine(r.chapters)}</span> : r.starters ? <span className="kl-from">Starter topics: none on your roadmap yet</span> : null}
        </div>
        {r.next && (
          <div className="kl-next">
            <span className="kl-next-label">{r.next.status === 'fading' ? 'Review' : r.next.status === 'learning' ? 'Carry on' : 'Next'}</span>
            <span className="kl-next-name">{r.next.name}</span>
            <button className={`btn small${here ? ' primary' : ''}`} onClick={onStart}>
              {r.next.status === 'fading' ? 'Review it' : 'Learn it'}
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

export function KnowLadder({ data, actions }: { data: KnowledgeView; actions: Actions }) {
  const l = useMemo(() => ladder(data.concepts), [data])
  const [party, setParty] = useState<Celebration | null>(null)
  const next = groundUpNext(l)
  const start = () => next && actions.onLesson(next.topic)

  // New levels since this page was last open: one party (the biggest), then remembered
  useEffect(() => {
    const before = read<Record<string, number>>(LEVELS_KEY)
    const now = levelsOf(l)
    if (before) {
      const ups = levelUps(before, l)
      const best = ups[ups.length - 1]
      if (best) setParty({ kind: 'party', title: best.title, line: best.line })
    }
    write(LEVELS_KEY, now)
    // "Teach me maths from the ground up": straight into the next lesson
    if (read<boolean>(LADDER_GO_KEY)) {
      write(LADDER_GO_KEY, null)
      if (next) actions.onLesson(next.topic)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l])

  const here = l.rungs[l.here]
  return (
    <section className="kl" aria-label="Maths ladder">
      <div className="kl-head">
        <div>
          <p className="kl-kicker">{l.title ? `Title: ${l.title}` : 'From arithmetic to pricing'}</p>
          <p className="kl-say">
            {l.climbed === l.rungs.length ? (
              <>Every rung is strong. Keep them that way: what fades shows here first.</>
            ) : (
              <>
                You’re on <b>{here.rung.label.toLowerCase()}</b>: {here.solid} of {here.topics.length} topics solid. <b>{l.climbed}</b> of {l.rungs.length} rungs climbed.
              </>
            )}
          </p>
        </div>
        {next && (
          <button className="btn primary" onClick={start} title={`Starts “${next.topic.name}”`}>
            Teach me from the ground up
          </button>
        )}
      </div>
      <ol className="kl-ladder">
        {[...l.rungs].reverse().map((r) => {
          const i = l.rungs.indexOf(r)
          return <RungRow key={r.rung.id} r={r} index={i} here={i === l.here} onStart={() => r.next && actions.onLesson(r.next)} />
        })}
      </ol>
      <p className="kl-foot">A rung is strong when 70% of its topics are solid by the same FSRS estimate as your reviews, and mastered at 90% with nothing fading. Topics come from your maths roadmap’s chapters; a topic about pricing or risk sits on the top rung wherever it’s listed.</p>
      {party && <Celebrate c={party} onClose={() => setParty(null)} />}
    </section>
  )
}
