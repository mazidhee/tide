import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clock, countWords, resultLine, SELF_RUBRIC, sentenceAround, sentenceCount, STEP_LABEL, toggleMark, type CompLesson, type CompStep, type HardMark, type SummaryPoint } from '@shared/comprehension'
import { stackMargin } from '@shared/writing'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { readerPrefs } from '../../lib/readingRoom'
import { Passage, selectionIn, type Range } from './Passage'
import '../../styles/writing.css'
import '../../styles/comprehension.css'

/**
 * One comprehension lesson (shared/comprehension, main/comprehension). The passage is the hero,
 * in the reader's face. Read it once, timed, marking what's hard; it's put away while you say
 * what it says; then it comes back with what you caught, missed or got wrong beside its exact
 * words, in the writing review's margin cards. The hard words become cards in Review.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const NARROW = 920
/** The steps the learner sees in the bar */
const SHOWN: CompStep[] = ['read', 'summary', 'review', 'words']
const VERDICT: Record<SummaryPoint['verdict'], string> = { caught: 'Caught', missed: 'Missed', wrong: 'Not what it says' }
const uid = () => Math.random().toString(36).slice(2, 9)

export function ComprehensionLesson({ id }: { id: string }) {
  const app = useApp()
  const [lesson, setLesson] = useState<CompLesson | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    window.tide.comprehension
      .get(id)
      .then((l) => live && setLesson(l))
      .catch((e) => live && setError(clean(e)))
    return () => {
      live = false
    }
  }, [id])

  const update = useCallback(
    async (patch: Parameters<typeof window.tide.comprehension.update>[1]) => {
      try {
        const l = await window.tide.comprehension.update(id, patch)
        setLesson(l)
        return l
      } catch (e) {
        app.toast(clean(e), { tone: 'error' })
        return null
      }
    },
    [id, app]
  )

  if (error)
    return (
      <div className="page cp-page">
        <div className="cp-missing">
          <p>{error}</p>
          <button className="btn small" onClick={() => app.setView({ kind: 'comprehension' })}>
            Back to Comprehension
          </button>
        </div>
      </div>
    )
  if (!lesson) return <div className="page cp-page" />

  const step = lesson.step
  return (
    <div className="page cp-page" style={{ ['--cp-size' as string]: `${Math.min(22, Math.max(18, readerPrefs().size))}px` }}>
      <header className="cp-bar">
        <button className="wr-back" onClick={() => app.setView({ kind: 'comprehension' })}>
          <Icon name="back" size={14} />
          Comprehension
        </button>
        <span className="cp-bar-where" title={`${lesson.source.work}${lesson.source.author ? `, ${lesson.source.author}` : ''}`}>
          {lesson.source.work} · {lesson.source.label}
        </span>
        {step !== 'done' && (
          <ol className="cp-steps" aria-label="Steps">
            {SHOWN.map((s) => {
              const k = SHOWN.indexOf(s)
              const at = SHOWN.indexOf(step)
              return (
                <li key={s} className={k === at ? 'now' : k < at ? 'past' : ''} aria-current={k === at ? 'step' : undefined}>
                  {k < at && <Icon name="check" size={11} />}
                  {STEP_LABEL[s]}
                </li>
              )
            })}
          </ol>
        )}
      </header>
      {step === 'read' && <ReadStep lesson={lesson} update={update} />}
      {step === 'summary' && <SummaryStep lesson={lesson} update={update} setLesson={setLesson} />}
      {step === 'review' && <ReviewStep lesson={lesson} update={update} setLesson={setLesson} />}
      {step === 'words' && <WordsStep lesson={lesson} setLesson={setLesson} />}
      {step === 'done' && <DoneStep lesson={lesson} />}
    </div>
  )
}

type Update = (patch: Parameters<typeof window.tide.comprehension.update>[1]) => Promise<CompLesson | null>

const hardRanges = (marks: HardMark[]): Range[] => marks.map((m) => ({ id: m.id, start: m.start, end: m.end, cls: 'cp-hard' }))

// ---------- Read ----------

/** Time with the window in view, from start to "I've read it" */
function useActiveClock(running: boolean) {
  const spent = useRef(0)
  const since = useRef<number | null>(null)
  useEffect(() => {
    if (!running) return
    const visible = () => document.visibilityState === 'visible'
    since.current = visible() ? performance.now() : null
    const onVis = () => {
      if (visible()) since.current = performance.now()
      else if (since.current !== null) {
        spent.current += performance.now() - since.current
        since.current = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [running])
  return () => spent.current + (since.current !== null ? performance.now() - since.current : 0)
}

function ReadStep({ lesson, update }: { lesson: CompLesson; update: Update }) {
  const [phase, setPhase] = useState<'ready' | 'reading' | 'read'>(lesson.read ? 'read' : 'ready')
  const [marks, setMarks] = useState<HardMark[]>(lesson.marks)
  const [pop, setPop] = useState<{ x: number; y: number; start: number; end: number; mark?: HardMark } | null>(null)
  const elapsed = useActiveClock(phase === 'reading')
  const passageRef = useRef<HTMLDivElement>(null)
  const colRef = useRef<HTMLDivElement>(null)

  const saveMarks = (next: HardMark[]) => {
    setMarks(next)
    void update({ marks: next })
  }

  const onMouseUp = () => {
    const s = selectionIn(passageRef.current)
    if (!s || !colRef.current) return
    const host = colRef.current.getBoundingClientRect()
    setPop({ x: s.rect.left + s.rect.width / 2 - host.left, y: s.rect.top - host.top, start: s.start, end: s.end })
  }

  const mark = () => {
    if (!pop) return
    saveMarks(toggleMark(marks, lesson.passage, pop.start, pop.end, uid()))
    window.getSelection()?.removeAllRanges()
    setPop(null)
  }

  const finish = async () => {
    setPhase('read')
    await update({ readMs: elapsed() })
  }

  if (phase === 'ready')
    return (
      <div className="cp-body">
        <div className="cp-col">
          <div className="cp-start">
            <p className="cp-start-what">
              {lesson.words.toLocaleString('en-GB')} words from <i>{lesson.source.work}</i>
              {lesson.source.author ? `, ${lesson.source.author}` : ''}
            </p>
            <p className="cp-start-how">Read it once at your own pace. Select anything you find hard to mark it. Then it’s put away and you say what it says.</p>
            <button className="btn primary" onClick={() => setPhase('reading')}>
              Start reading
            </button>
          </div>
        </div>
      </div>
    )

  const read = lesson.read
  return (
    <div className="cp-body">
      <div className="cp-col" ref={colRef} onMouseUp={onMouseUp} onMouseDown={(e) => !(e.target as HTMLElement).closest('.cp-pop') && setPop(null)}>
        <Passage
          ref={passageRef}
          text={lesson.passage}
          ranges={hardRanges(marks)}
          onRangeClick={(ids, el) => {
            const m = marks.find((x) => ids.includes(x.id))
            if (!m || !colRef.current) return
            const r = el.getBoundingClientRect()
            const host = colRef.current.getBoundingClientRect()
            setPop({ x: r.left + r.width / 2 - host.left, y: r.top - host.top, start: m.start, end: m.end, mark: m })
          }}
        />
        {pop && (
          <div className="cp-pop" role="toolbar" aria-label="With these words" style={{ left: pop.x, top: pop.y }} onMouseUp={(e) => e.stopPropagation()}>
            {pop.mark ? (
              <>
                {phase === 'read' && (
                  <button onClick={() => (void window.tide.comprehension.lookup(pop.mark!.text), setPop(null))}>
                    Look up
                  </button>
                )}
                <button onClick={mark}>Unmark</button>
              </>
            ) : (
              <button onClick={mark}>Mark as hard</button>
            )}
          </div>
        )}
        <div className="cp-after">
          {phase === 'reading' ? (
            <>
              <span className="cp-after-note">{marks.length ? `${marks.length} marked as hard` : 'Select words or a line to mark it as hard'}</span>
              <button className="btn primary" onClick={() => void finish()}>
                I’ve read it
              </button>
            </>
          ) : (
            <>
              <span className="cp-after-note">
                {read ? `${clock(read.ms)}${read.wpm ? ` · ${read.wpm} words a minute` : ''}` : ''}
                {marks.length ? ` · ${marks.length} marked: click one to look it up` : ''}
              </span>
              <button className="btn primary" onClick={() => void update({ step: 'summary', marks })}>
                Put it away and write
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Say what it says ----------

function SummaryStep({ lesson, update, setLesson }: { lesson: CompLesson; update: Update; setLesson: (l: CompLesson) => void }) {
  const [text, setText] = useState(lesson.summary ?? '')
  const [busy, setBusy] = useState(false)
  const app = useApp()
  const n = sentenceCount(text)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const onChange = (v: string) => {
    setText(v)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void window.tide.comprehension.update(lesson.id, { summary: v }).catch(() => {}), 900)
  }

  const check = async () => {
    clearTimeout(saveTimer.current)
    setBusy(true)
    const saved = await update({ summary: text })
    if (!saved) return setBusy(false)
    try {
      const can = await window.tide.comprehension.canGrade()
      const r = can ? await window.tide.comprehension.grade(lesson.id) : null
      // Without Claude: the passage comes back for a check of your own
      if (r?.by === 'claude') return setLesson(r.lesson)
      if (r) app.toast('Claude couldn’t check it just now: check it yourself against the passage.')
      await update({ step: 'review' })
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
      setBusy(false)
    }
  }

  return (
    <div className="cp-body">
      <div className="cp-col">
        <div className="cp-away" aria-label="The passage is put away">
          <span className="cp-away-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            The passage is put away
            {lesson.read?.wpm ? ` · read in ${clock(lesson.read.ms)}, ${lesson.read.wpm} words a minute` : ''}
          </span>
        </div>
        <label className="cp-ask" htmlFor="cp-summary">
          What does it say? In your own words, in three to five sentences.
        </label>
        <textarea id="cp-summary" className="cp-write" value={text} onChange={(e) => onChange(e.target.value)} rows={7} disabled={busy} autoFocus spellCheck />
        <div className="cp-after">
          <span className="cp-after-note">{busy ? 'Reading your summary against the passage…' : text.trim() ? `${n} sentence${n === 1 ? '' : 's'}${n > 5 ? ': try saying it in fewer' : ''}` : ''}</span>
          <button className="btn primary" disabled={busy || countWords(text) < 12} onClick={() => void check()}>
            {busy ? 'Checking…' : 'Check it'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Look again ----------

function ReviewStep({ lesson, update, setLesson }: { lesson: CompLesson; update: Update; setLesson: (l: CompLesson) => void }) {
  const g = lesson.grade
  const app = useApp()
  const [ticks, setTicks] = useState<Record<string, boolean>>(g?.ticks ?? {})
  const [active, setActive] = useState<string | null>(null)
  const [hover, setHover] = useState<string[] | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [tops, setTops] = useState<Record<string, number>>({})
  const wrap = useRef<HTMLDivElement>(null)
  const passageRef = useRef<HTMLDivElement>(null)
  const marginRef = useRef<HTMLElement>(null)
  const cards = useRef(new Map<string, HTMLElement>())
  const points = useMemo(() => (g?.by === 'claude' ? g.points.map((p, i) => ({ ...p, id: `p${i}` })) : []), [g])
  const selfCheck = !g || g.by === 'self'

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The margin cards level with their words, none overlapping
  useLayoutEffect(() => {
    if (narrow || !passageRef.current || !marginRef.current) return
    const base = marginRef.current.getBoundingClientRect().top
    const items = points.flatMap((p) => {
      const a = passageRef.current!.querySelector<HTMLElement>(`[data-anchor~="${p.id}"]`)
      const c = cards.current.get(p.id)
      return a && c ? [{ id: p.id, top: a.getBoundingClientRect().top - base, height: c.offsetHeight }] : []
    })
    const next = stackMargin(items, 10, active ?? undefined)
    setTops((t) => (JSON.stringify(t) === JSON.stringify(next) ? t : next))
  }, [points, narrow, active, hover])

  const lit = useMemo(() => new Set([...(hover ?? []), ...(active ? [active] : [])]), [hover, active])
  const ranges = useMemo<Range[]>(() => [...hardRanges(lesson.marks), ...points.map((p) => ({ id: p.id, start: p.start, end: p.end, cls: `cp-pt v-${p.verdict}` }))], [lesson.marks, points])

  const saveSelf = async () => {
    try {
      setLesson(await window.tide.comprehension.selfCheck(lesson.id, ticks))
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
  }

  const goOn = () => void update({ step: lesson.marks.length ? 'words' : 'done' })

  const summary = (
    <div className="cp-said">
      <span className="cp-said-label">What you wrote</span>
      <p>{lesson.summary}</p>
    </div>
  )

  return (
    <div className={`cp-body cp-review${narrow ? ' narrow' : ''}`} ref={wrap}>
      <div className="cp-col">
        {!selfCheck && g && (
          <div className="cp-result">
            <p className="cp-result-line">{resultLine(lesson)}</p>
            {g.overall && <p className="cp-result-overall">{g.overall}</p>}
          </div>
        )}
        {selfCheck && <p className="cp-result-line">Read it again and check what you wrote against it.</p>}
        {(narrow || !selfCheck) && summary}
        <Passage ref={passageRef} text={lesson.passage} ranges={ranges} lit={lit} onRangeHover={setHover} onRangeClick={(ids) => setActive(ids.find((x) => x.startsWith('p')) ?? null)} />
        {narrow && !selfCheck && (
          <div className="cp-cards-list">
            {points.map((p) => (
              <PointCard key={p.id} p={p} on={active === p.id} lit={!!hover?.includes(p.id)} onEnter={() => setHover([p.id])} onLeave={() => setHover(null)} onOpen={() => setActive(active === p.id ? null : p.id)} />
            ))}
          </div>
        )}
        {narrow && selfCheck && <SelfCheck ticks={ticks} setTicks={setTicks} done={g?.by === 'self'} />}
        <div className="cp-after">
          <span className="cp-after-note">{lesson.marks.length ? `${lesson.marks.length} word${lesson.marks.length === 1 ? '' : 's'} marked as hard` : ''}</span>
          {selfCheck && g?.by !== 'self' ? (
            <button className="btn primary" onClick={() => void saveSelf()}>
              Done checking
            </button>
          ) : (
            <button className="btn primary" onClick={goOn}>
              {lesson.marks.length ? 'Next: your hard words' : 'Finish'}
            </button>
          )}
        </div>
      </div>
      {!narrow && (
        <aside className="cp-margin" ref={marginRef} aria-label={selfCheck ? 'Your check' : 'What you caught and missed'}>
          {selfCheck ? (
            <div className="cp-self">
              {summary}
              <SelfCheck ticks={ticks} setTicks={setTicks} done={g?.by === 'self'} />
            </div>
          ) : (
            points.map((p) => (
              <PointCard
                key={p.id}
                p={p}
                top={tops[p.id] ?? 0}
                cardRef={(el) => (el ? cards.current.set(p.id, el) : cards.current.delete(p.id))}
                on={active === p.id}
                lit={!!hover?.includes(p.id)}
                onEnter={() => setHover([p.id])}
                onLeave={() => setHover(null)}
                onOpen={() => setActive(active === p.id ? null : p.id)}
              />
            ))
          )}
        </aside>
      )}
    </div>
  )
}

function PointCard(p: { p: SummaryPoint & { id: string }; top?: number; cardRef?: (el: HTMLElement | null) => void; on: boolean; lit: boolean; onEnter(): void; onLeave(): void; onOpen(): void }) {
  const x = p.p
  return (
    <div
      ref={p.cardRef}
      className={`wr-card cp-card${p.top === undefined ? ' flow' : ''}${p.on ? ' on' : ''}${p.lit ? ' lit' : ''}`}
      style={p.top === undefined ? undefined : { top: p.top }}
      onMouseEnter={p.onEnter}
      onMouseLeave={p.onLeave}
      onClick={p.onOpen}
      role="button"
      tabIndex={0}
      aria-expanded={p.on}
      onKeyDown={(e) => e.key === 'Enter' && p.onOpen()}
    >
      <div className="wr-card-head">
        <span className={`cp-verdict v-${x.verdict}`} aria-hidden="true" />
        <span className="wr-card-label">{VERDICT[x.verdict]}</span>
      </div>
      <p className="wr-card-what">{x.point}</p>
      {p.on && x.said && (
        <div className="wr-card-more">
          <p className="wr-card-eg">
            <span>You wrote</span>
            {x.said}
          </p>
        </div>
      )}
    </div>
  )
}

function SelfCheck({ ticks, setTicks, done }: { ticks: Record<string, boolean>; setTicks: (t: Record<string, boolean>) => void; done: boolean }) {
  return (
    <fieldset className="cp-rubric" disabled={done}>
      <legend>Is it true of what you wrote?</legend>
      {SELF_RUBRIC.map((r) => (
        <label key={r.id} className="cp-tick">
          <input type="checkbox" checked={!!ticks[r.id]} onChange={(e) => setTicks({ ...ticks, [r.id]: e.target.checked })} />
          <span>{r.text}</span>
        </label>
      ))}
    </fieldset>
  )
}

// ---------- Words ----------

function WordsStep({ lesson, setLesson }: { lesson: CompLesson; setLesson: (l: CompLesson) => void }) {
  const app = useApp()
  const [items, setItems] = useState(() => lesson.marks.map((m) => ({ ...m, keep: true })))
  const [busy, setBusy] = useState(false)
  const kept = items.filter((i) => i.keep)

  const save = async (keep: HardMark[]) => {
    setBusy(true)
    try {
      const l = await window.tide.comprehension.cards(lesson.id, keep)
      setLesson(l)
      if (keep.length) app.toast(`${keep.length} card${keep.length === 1 ? '' : 's'} added to Review`)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
      setBusy(false)
    }
  }

  return (
    <div className="cp-body">
      <div className="cp-col">
        <p className="cp-ask">The words you marked, in their sentences. Each one you keep comes back in Review.</p>
        <ul className="cp-words">
          {items.map((m, i) => {
            const sentence = sentenceAround(lesson.passage, m.start, m.end)
            const at = sentence.indexOf(m.text)
            return (
              <li key={m.id} className={m.keep ? '' : 'off'}>
                <label className="cp-word-keep">
                  <input type="checkbox" checked={m.keep} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, keep: e.target.checked } : x)))} aria-label={`Keep “${m.text}”`} />
                </label>
                <div className="cp-word-main">
                  <p className="cp-word-sentence">
                    {at >= 0 ? (
                      <>
                        {sentence.slice(0, at)}
                        <b>{m.text}</b>
                        {sentence.slice(at + m.text.length)}
                      </>
                    ) : (
                      sentence
                    )}
                  </p>
                  <div className="cp-word-meaning">
                    <input
                      value={m.meaning ?? ''}
                      onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, meaning: e.target.value } : x)))}
                      placeholder={countWords(m.text) > 4 ? 'What it says, in plain words' : 'What it means here'}
                      aria-label={`Meaning of “${m.text}”`}
                    />
                    <button className="btn small ghost" onClick={() => void window.tide.comprehension.lookup(m.text)}>
                      Look up
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="cp-after">
          <button className="btn ghost" disabled={busy} onClick={() => void save([])}>
            Skip
          </button>
          <button className="btn primary" disabled={busy || !kept.length} onClick={() => void save(kept.map(({ keep: _k, ...m }) => m))}>
            {kept.length ? `Add ${kept.length} card${kept.length === 1 ? '' : 's'} to Review` : 'Add cards'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Done ----------

function DoneStep({ lesson }: { lesson: CompLesson }) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const next = async () => {
    setBusy(true)
    try {
      const l = await window.tide.comprehension.start({ from: 'book' })
      app.setView({ kind: 'comprehension', lesson: l.id })
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
      setBusy(false)
    }
  }
  const read = lesson.read
  return (
    <div className="cp-body">
      <div className="cp-col cp-done">
        <h1 className="cp-done-title">Done</h1>
        <dl className="cp-facts">
          {lesson.grade && (
            <div>
              <dt>Your summary</dt>
              <dd>{resultLine(lesson)}</dd>
            </div>
          )}
          {read && (
            <div>
              <dt>Your read</dt>
              <dd>
                {lesson.words} words in {clock(read.ms)}
                {read.wpm ? `, ${read.wpm} words a minute` : ''}
              </dd>
            </div>
          )}
          <div>
            <dt>Cards</dt>
            <dd>{lesson.cards?.made ? `${lesson.cards.made} in Review, with their sentences` : 'None this time'}</dd>
          </div>
        </dl>
        <div className="cp-after start">
          {lesson.source.kind === 'book' && (
            <button className="btn primary" disabled={busy} onClick={() => void next()}>
              Next passage
            </button>
          )}
          <button className="btn ghost" onClick={() => app.setView({ kind: 'comprehension' })}>
            Back to Comprehension
          </button>
          {lesson.source.path && (
            <button className="btn ghost" onClick={() => app.openPath(lesson.source.path)}>
              Back to the book
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
