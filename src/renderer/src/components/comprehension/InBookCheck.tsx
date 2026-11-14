import { useEffect, useRef, useState } from 'react'
import { resultLine, SELF_RUBRIC, sectionCue, sentenceCount, type CompLesson, type HardMark, type SummaryPoint } from '@shared/comprehension'
import type { PassageLoc } from '@shared/passage'
import { useApp } from '../../state'
import '../../styles/comprehension.css'

/**
 * A check in the book (docs/plans/comprehension.md, increment 2): a quiet card in the reading
 * flow, at a chapter's end or a natural break, when the learner has turned checks on for this
 * book. They say what the section said without seeing it again; it is graded against the
 * section's exact words, and the feedback stays here, its words lit in the book above ("Look
 * again"). Words marked hard in the section become cards. Skip hides it for good.
 */

export type Lit = { start: number; end: number; verdict: SummaryPoint['verdict'] | 'all' }

const VERDICT: Record<SummaryPoint['verdict'], string> = { caught: 'Caught', missed: 'Missed', wrong: 'Not what it says' }
const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function InBookCheck(p: {
  path: string
  chapter: string
  /** The section's units, as the book has them */
  units: { loc: PassageLoc; text: string }[]
  /** The section runs to the chapter's end */
  toEnd: boolean
  /** The section's passage (sectionText) */
  text: string
  /** The check already done on this section */
  done?: CompLesson
  /** Time spent reading the section, with the window in view */
  readMs: () => number
  /** Words marked hard in the section, as passage offsets */
  hard: () => HardMark[]
  onLesson: (l: CompLesson) => void
  onSkip: () => void
  /** Light words of the passage in the book (null: clear), scrolling to the first */
  onLight: (spans: Lit[] | null) => void
}) {
  const app = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [lesson, setLesson] = useState<CompLesson | null>(p.done ?? null)
  const [open, setOpen] = useState(!p.done)
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const [noClaude, setNoClaude] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setLesson(p.done ?? null), [p.done])

  const keep = (l: CompLesson) => {
    setLesson(l)
    p.onLesson(l)
  }

  const check = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const l = await window.tide.comprehension.inBook({ path: p.path, locs: p.units.map((u) => u.loc), text: p.text, readMs: p.readMs(), summary: text, marks: p.hard() })
      keep(l)
      const r = await window.tide.comprehension.grade(l.id).catch(() => null)
      if (r?.by === 'claude') {
        keep(r.lesson)
        // The feedback's words lit in the book a moment, so it is clear they are there
      } else setNoClaude(true)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
    setBusy(false)
  }

  const finish = async () => {
    if (!lesson) return
    if (lesson.step === 'done') {
      p.onLight(null)
      return setOpen(false)
    }
    setBusy(true)
    try {
      const l = lesson.marks.length ? await window.tide.comprehension.cards(lesson.id, lesson.marks) : await window.tide.comprehension.update(lesson.id, { step: 'done' })
      keep(l)
      if (lesson.marks.length) app.toast(`${lesson.marks.length} ${lesson.marks.length === 1 ? 'card' : 'cards'} added to Review`)
      p.onLight(null)
      setOpen(false)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
    setBusy(false)
  }

  const selfCheck = async () => {
    if (!lesson) return
    setBusy(true)
    try {
      keep(await window.tide.comprehension.selfCheck(lesson.id, ticks))
      setNoClaude(false)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
    setBusy(false)
  }

  const g = lesson?.grade
  const points = g?.by === 'claude' ? g.points : []
  const lookAgain = () => p.onLight(points.length ? points.map((x) => ({ start: x.start, end: x.end, verdict: x.verdict })) : [{ start: 0, end: p.text.length, verdict: 'all' }])
  const cue = sectionCue(p.units[0]?.text ?? '', p.chapter, p.toEnd)

  // Done and folded: one quiet line, the feedback a click away
  if (lesson && !open && (lesson.step === 'done' || lesson.finishedAt)) {
    return (
      <aside className="ib-card folded" aria-label="Your check on this section">
        <span className="ib-fold-line">{g ? resultLine(lesson) : 'You said what this section said.'}</span>
        <button className="ib-link" onClick={() => setOpen(true)}>
          See it again
        </button>
      </aside>
    )
  }

  // Waiting for the grade, or answered and graded
  if (lesson && (g || noClaude || busy)) {
    return (
      <aside className="ib-card" aria-label="What you caught and missed" aria-busy={busy && !g}>
        {!g && !noClaude && <p className="ib-wait">Reading what you wrote against the section…</p>}
        {!g && noClaude && (
          <>
            <p className="ib-ask">Check it yourself</p>
            <p className="ib-cue">Claude isn’t available just now. Look again at the section, then tick what is true of what you wrote.</p>
            <blockquote className="ib-said">{lesson.summary}</blockquote>
            <div className="ib-ticks" role="group" aria-label="Is it true of what you wrote?">
              {SELF_RUBRIC.map((r) => (
                <label key={r.id} className="ib-tick">
                  <input type="checkbox" checked={!!ticks[r.id]} onChange={(e) => setTicks({ ...ticks, [r.id]: e.target.checked })} />
                  <span>{r.text}</span>
                </label>
              ))}
            </div>
            <div className="ib-acts">
              <button className="ib-go" onClick={lookAgain}>
                Look again
              </button>
              <button className="ib-go primary" disabled={busy} onClick={selfCheck}>
                Done checking
              </button>
            </div>
          </>
        )}
        {g && (
          <>
            <p className="ib-result">{resultLine(lesson)}</p>
            {g.overall && <p className="ib-overall">{g.overall}</p>}
            {points.length > 0 && (
              <ol className="ib-points">
                {points.map((x, i) => (
                  <li key={i}>
                    <button className={`ib-point v-${x.verdict}`} onClick={() => p.onLight([{ start: x.start, end: x.end, verdict: x.verdict }])} title="Show these words in the book">
                      <span className={`ib-rule v-${x.verdict}`} aria-hidden="true" />
                      <span className="ib-point-body">
                        <span className="ib-verdict">{VERDICT[x.verdict]}</span>
                        <span className="ib-point-text">{x.point}</span>
                        {x.said && <span className="ib-point-said">You wrote “{x.said}”</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <div className="ib-acts">
              <button className="ib-go" onClick={lookAgain} title="Back up the page, with these words lit">
                Look again
              </button>
              <button className="ib-go primary" disabled={busy} onClick={finish}>
                {lesson.marks.length && lesson.step !== 'done' ? `Make cards of ${lesson.marks.length} hard ${lesson.marks.length === 1 ? 'word' : 'words'}` : lesson.step === 'done' ? 'Fold away' : 'Done'}
              </button>
            </div>
          </>
        )}
      </aside>
    )
  }

  const n = sentenceCount(text)
  return (
    <aside className="ib-card" aria-label="Say what that section said">
      <p className="ib-ask">Say what that said</p>
      <p className="ib-cue">{cue}. In your own words, without looking back.</p>
      <textarea
        ref={box}
        className="ib-write"
        value={text}
        rows={3}
        placeholder="Three to five sentences…"
        aria-label="What the section said, in your own words"
        onChange={(e) => {
          setText(e.target.value)
          const t = e.target
          t.style.height = 'auto'
          t.style.height = `${t.scrollHeight}px`
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void check()
        }}
      />
      <div className="ib-acts">
        <span className="ib-count">{n ? `${n} ${n === 1 ? 'sentence' : 'sentences'}` : ''}</span>
        <button className="ib-go quiet" onClick={p.onSkip}>
          Skip
        </button>
        <button className="ib-go primary" disabled={!text.trim() || busy} onClick={check}>
          Check
        </button>
      </div>
    </aside>
  )
}
