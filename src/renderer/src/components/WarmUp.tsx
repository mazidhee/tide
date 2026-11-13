import { useEffect, useRef, useState } from 'react'
import type { Verdict } from '@shared/types'
import { WARMUP_MAX_MS, warmupTally, type WarmupResult, type WarmupSet } from '@shared/warmup'
import { renderMarkdown } from '../lib/markdown'
import { pageKey } from '../lib/typing'

const ENV = { notePath: '', filesByName: new Map<string, string>() }
const md = (s: string) => renderMarkdown(s, ENV)

const GRADES: { verdict: Verdict; label: string; key: string }[] = [
  { verdict: 'wrong', label: 'Forgot', key: '1' },
  { verdict: 'partial', label: 'Shaky', key: '2' },
  { verdict: 'correct', label: 'Got it', key: '3' }
]

/**
 * The warm-up before a lesson (shared/warmup): a few quick cards on what it builds on, each
 * recalled, revealed and graded in a few seconds (graded like any review, so FSRS hears it),
 * then the lesson begins knowing what held and what faded. One button skips it; it never runs
 * past two minutes.
 */
export function WarmUp({ set, onDone, onProgress }: { set: WarmupSet; onDone(results: WarmupResult[], skipped: boolean): void; onProgress?(results: WarmupResult[]): void }) {
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(false)
  const [results, setResults] = useState<WarmupResult[]>([])
  // What they recall, typed or dictated (Wispr Flow, macOS dictation), however rough: the tutor reads it
  const [said, setSaid] = useState('')
  const [done, setDone] = useState<null | { skipped: boolean }>(null)
  const [inBox, setInBox] = useState(false)
  const started = useRef(Date.now())
  const card = set.cards[i]

  const finish = (r: WarmupResult[], skipped: boolean) => {
    setDone({ skipped })
    onDone(r, skipped)
  }
  const grade = (verdict: Verdict) => {
    if (!card || done) return
    window.tide.warmup.grade(card, verdict).catch(() => {})
    const r = [...results, { card, verdict, ...(said.trim() ? { said: said.trim() } : {}) }]
    setResults(r)
    onProgress?.(r)
    setShown(false)
    setSaid('')
    if (i + 1 >= set.cards.length || Date.now() - started.current > WARMUP_MAX_MS) finish(r, false)
    else setI(i + 1)
  }

  // Space shows the answer, 1 2 3 grade it, when you're not typing somewhere
  const live = useRef({ shown, grade, done })
  live.current = { shown, grade, done }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never while you type: in its own-words box, the tutor's box, the notes, a code editor
      if (live.current.done || !pageKey(e)) return
      if (!live.current.shown && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setShown(true)
      } else if (live.current.shown) {
        const g = GRADES.find((x) => x.key === e.key)
        if (g) (e.preventDefault(), live.current.grade(g.verdict))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (done) {
    const tally = warmupTally(results)
    return (
      <p className="warmup-done" role="status">
        <strong>Warm-up</strong>
        <span>{done.skipped || !results.length ? 'skipped. The tutor still knows what this builds on.' : `${tally}. The tutor picks up from here.`}</span>
      </p>
    )
  }
  if (!card) return null

  return (
    <section className="warmup" aria-label="Warm-up">
      <div className="warmup-head">
        <strong>Warm-up</strong>
        <span>
          {set.cards.length} quick card{set.cards.length === 1 ? '' : 's'} on what this builds on
        </span>
        <span className="warmup-dots" aria-label={`Card ${i + 1} of ${set.cards.length}`}>
          {set.cards.map((_, k) => (
            <i key={k} className={k === i ? 'now' : k < results.length ? (results[k].verdict === 'correct' ? 'held' : 'faded') : ''} />
          ))}
        </span>
        <button className="warmup-skip" onClick={() => finish(results, true)}>
          Skip
        </button>
      </div>
      <div className="warmup-from">{card.from}</div>
      <div className="warmup-q" dangerouslySetInnerHTML={{ __html: md(card.question) }} />
      {!shown ? (
        <textarea
          className="warmup-said"
          rows={2}
          value={said}
          onChange={(e) => setSaid(e.target.value)}
          onFocus={() => setInBox(true)}
          onBlur={() => setInBox(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), setShown(true))
          }}
          placeholder="Say it in your own words, if you like: type or dictate, messy is fine. The tutor reads it and corrects what’s off."
          aria-label="What you remember, in your own words"
        />
      ) : (
        said.trim() && <p className="warmup-yours"><span>You wrote</span> {said.trim()}</p>
      )}
      {shown && card.answer && <div className="warmup-a" dangerouslySetInnerHTML={{ __html: md(card.answer) }} />}
      <div className="warmup-actions">
        {!shown ? (
          <button className="btn primary small" onClick={() => setShown(true)}>
            {card.answer ? 'Show answer' : 'I’ve thought of it'}
            {/* In the own-words box Space is a space: ⌘↩ shows it from there */}
            <kbd>{inBox ? '⌘↩' : 'Space'}</kbd>
          </button>
        ) : (
          GRADES.map((g) => (
            <button key={g.verdict} className={`btn small${g.verdict === 'correct' ? ' primary' : ''}`} onClick={() => grade(g.verdict)}>
              {g.label}
              <kbd>{g.key}</kbd>
            </button>
          ))
        )}
      </div>
    </section>
  )
}
