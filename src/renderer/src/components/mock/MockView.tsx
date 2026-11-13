import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PopOutButton } from '../PopOutButton'
import { usePopOutSurface } from '../../lib/popout'
import { BANK_TAGS, type BankTag } from '@shared/mockBank'
import { DESIGNS } from '@shared/mockQuestions'
import { annotateCanvas, referenceCanvas, clockText, clockTone, modeInfo, openingMessage, remainingMs, rubricFor, type MockAnswer, type MockDebrief, type MockLiveState, type MockMode, type MockPhase, type MockRecord, type RubricItem } from '@shared/mocks'
import type { Canvas } from '@shared/canvas'
import type { ExamMark } from '@shared/types'
import type { MockFed, MockStarted, MockStatus, TestOutcome } from '../../../../main/mocks'
import { useApp } from '../../state'
import { renderMarkdown } from '../../lib/markdown'
import { setMockPhase } from '../../lib/mockPhase'
import { useStudying } from '../../lib/studying'
import { Icon } from '../Icon'
import { PillSegment } from '../PromptBox'
import { CodeEditor } from '../CodeEditor'
import { CanvasEditor } from '../CanvasEditor'
import { MockChat, type ChatLine } from './MockChat'
import { MODE_ICON } from './MockPanel'
import { ExamSitting, markPaper, type ExamAnswers } from './MockExam'

const EXPECT: Record<MockMode, string[]> = {
  coding: [
    'A problem from the bank at your level, in Python, with hidden tests that run in Tide’s sandbox.',
    'Talk through your approach before you code. The interviewer will ask for the time and space complexity, edge cases and how you would test it.',
    'Run the hidden tests as often as you like. Hints are there, but each one costs points.'
  ],
  design: [
    'A brief from payments, banking or a classic web system. Draw on the canvas; keep notes on requirements, numbers and decisions beside it.',
    'Start with requirements and numbers. The interviewer probes scale, consistency, idempotency and failure as the design gets there.',
    'Opus marks against the rubric and annotates your diagram; you get a reference design to compare.'
  ],
  quant: [
    'Mental maths first, then probability and expected value, a market sizing and finance questions (rails, settlement, risk).',
    'Type an answer; numbers can be fractions or percentages. Show your working on the harder ones: it is marked.',
    'The interviewer follows up on your answers. The right answers come at the debrief.'
  ],
  behavioural: ['Three questions, each with a follow-up. Answer in STAR form: situation, task, action, result.', 'Say "I" for what you did. Put a number on the result where you can. You can dictate instead of typing.'],
  exam: ['A paper written from what you have studied lately and what is weak, with mixed question types.', 'Type, or add photos of handwritten working to any answer. Each part is marked against a hidden scheme.']
}

const TAG_LABEL: Partial<Record<BankTag, string>> = { system: 'System-flavoured', dp: 'DP' }
const tagLabel = (t: BankTag) => TAG_LABEL[t] ?? t[0].toUpperCase() + t.slice(1)
/** A quote of code (set in the code face) rather than of words said */
const codeLike = (q: string) => /\n\s+\S|^\s*(def|class|return|if|for|while|import|from)\b|[=({]\s*$|\w\(.*\)\s*$|self\./m.test(q) && !/^(I|I'm|We|My)\b/.test(q.trim())
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const md = (s: string) => ({ __html: renderMarkdown(s, { notePath: '', filesByName: new Map() }) })

interface Result {
  debrief: MockDebrief
  record: MockRecord
  fed?: MockFed
  canvas?: Canvas
  code?: string
}

export function MockView({ mode, review, live }: { mode: MockMode; review?: string; live?: string }) {
  const app = useApp()
  const info = modeInfo(mode)
  // A running mock moved here from another window starts where it was (main keeps its work)
  const [phase, setPhase] = useState<MockPhase>(review ? 'marking' : live ? 'preparing' : 'brief')
  const [status, setStatus] = useState<MockStatus | null>(null)
  const [minutes, setMinutes] = useState(info.minutesDefault)
  const [tags, setTags] = useState<BankTag[]>([])
  const [designRef, setDesignRef] = useState('')
  const [focus, setFocus] = useState('')
  const [topics, setTopics] = useState<string[] | null>(null)
  const [started, setStarted] = useState<MockStarted | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [leaving, setLeaving] = useState(false)
  const [markingNote, setMarkingNote] = useState('')

  // The work
  const [code, setCode] = useState('')
  const [canvas, setCanvas] = useState<Canvas>({ nodes: [], edges: [] })
  const [notes, setNotes] = useState('')
  const [answers, setAnswers] = useState<MockAnswer[]>([])
  const [examAnswers, setExamAnswers] = useState<ExamAnswers>({})
  const [tests, setTests] = useState<TestOutcome | null>(null)
  const [testing, setTesting] = useState(false)

  // The interviewer
  const [lines, setLines] = useState<ChatLine[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [hints, setHints] = useState(0)

  const title = started?.title ?? result?.record.title ?? info.label
  useEffect(() => {
    setMockPhase({ phase, title })
    return () => setMockPhase(null)
  }, [phase, title])
  useStudying('view', phase === 'live' && started ? { pose: 'stopwatch', label: `Mock: ${title}`, until: started.startedAt + started.minutes * 60_000 } : phase === 'marking' ? { pose: 'reading', label: `Marking: ${title}` } : null)

  // A running mock taken over from another window: what it started with and the work so far
  useEffect(() => {
    if (!live || review) return
    window.tide.mocks
      .resume(live)
      .then((r) => {
        if (!r) throw new Error('That mock has ended.')
        const st = r.state
        opened.current = true
        setStarted(r.started)
        setCode(st.code ?? r.started.problem?.starter ?? '')
        if (st.canvas) setCanvas(st.canvas)
        setNotes(st.notes ?? '')
        setAnswers(st.answers ?? [])
        setExamAnswers((st.examAnswers ?? {}) as ExamAnswers)
        setLines((st.lines ?? []) as ChatLine[])
        setHints(st.hints ?? 0)
        setNow(Date.now())
        setPhase('live')
      })
      .catch((e) => {
        setError(clean(e))
        setPhase('brief')
      })
  }, [live, review])

  useEffect(() => {
    if (review) {
      window.tide.mocks
        .record(review)
        .then((r) => {
          const saved = r as { record: MockRecord; debrief: MockDebrief; canvas?: Canvas; code?: string } | null
          if (!saved) throw new Error('That mock’s record is missing.')
          setResult({ debrief: saved.debrief, record: saved.record, canvas: saved.canvas, code: saved.code })
          setPhase('debrief')
        })
        .catch((e) => {
          setError(clean(e))
          setPhase('brief')
        })
      return
    }
    window.tide.mocks.status().then(setStatus).catch(() => setStatus({ claude: false, why: 'unavailable', level: 2, history: [] }))
    if (mode === 'exam') window.tide.mocks.examTopics().then(setTopics).catch(() => setTopics([]))
  }, [mode, review])

  // The streamed reply, as it is written
  useEffect(() => window.tide.mocks.onEvent((e) => e.id === started?.id && setStreaming((s) => s + e.delta)), [started?.id])

  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [phase])

  const clock = started ? { startedAt: started.startedAt, minutes: started.minutes } : null
  const left = clock ? remainingMs(clock, now) : 0

  const workState = useCallback(() => (mode === 'coding' ? { code } : mode === 'design' ? { canvas, notes } : {}), [mode, code, canvas, notes])

  const talk = useCallback(
    async (text: string, extra: { question?: string } = {}, show = true) => {
      if (!started?.interviewer) return
      if (show) setLines((l) => [...l, { role: 'candidate', text }])
      setBusy(true)
      setStreaming('')
      try {
        const reply = await window.tide.mocks.say(started.id, text, { ...workState(), ...extra })
        if (reply) setLines((l) => [...l, { role: 'interviewer', text: reply }])
      } catch (e) {
        setLines((l) => [...l, { role: 'interviewer', text: `(The interviewer couldn’t answer: ${clean(e)})` }])
      } finally {
        setStreaming('')
        setBusy(false)
      }
    },
    [started, workState]
  )

  const askHint = async () => {
    if (!started) return
    setLines((l) => [...l, { role: 'candidate', text: 'Can I have a hint?', hint: true }])
    setBusy(true)
    setStreaming('')
    try {
      const h = await window.tide.mocks.hint(started.id, workState())
      setHints(h.hints)
      setLines((l) => [...l, { role: 'interviewer', text: h.text }])
    } catch (e) {
      setLines((l) => [...l, { role: 'interviewer', text: `(No hint: ${clean(e)})` }])
    } finally {
      setStreaming('')
      setBusy(false)
    }
  }

  const start = async () => {
    setError('')
    setPhase('preparing')
    try {
      const s = await window.tide.mocks.start({ mode, minutes, ...(tags.length ? { tags } : {}), ...(designRef ? { ref: designRef } : {}), ...(focus.trim() ? { focus: focus.trim() } : {}) })
      setStarted(s)
      setCode(s.problem?.starter ?? '')
      setNow(Date.now())
      setPhase('live')
    } catch (e) {
      setError(clean(e))
      setPhase('brief')
    }
  }

  // The interviewer opens
  const opened = useRef(false)
  useEffect(() => {
    if (phase !== 'live' || !started?.interviewer || opened.current || mode === 'exam') return
    opened.current = true
    void talk(openingMessage(mode as Exclude<MockMode, 'exam'>), {}, false)
  }, [phase, started, mode, talk])

  const runTests = async () => {
    if (!started || testing) return
    setTesting(true)
    try {
      setTests(await window.tide.mocks.test(started.id, code))
    } catch (e) {
      setTests({ passed: [], failed: [], total: 0, error: clean(e) })
    } finally {
      setTesting(false)
    }
  }

  const ending = useRef(false)
  const end = useCallback(async () => {
    if (!started || ending.current) return
    ending.current = true
    setPhase('marking')
    try {
      let examMarks: Record<string, ExamMark> | undefined
      let examList: MockAnswer[] | undefined
      if (mode === 'exam' && started.exam) {
        setMarkingNote('Marking each part against the scheme…')
        examMarks = await markPaper(started.exam, examAnswers, (where) => setMarkingNote(`Marking ${where}…`))
        examList = Object.entries(examAnswers).map(([id, a]) => ({ id, text: a.text, ms: 0 }))
      } else setMarkingNote(started.interviewer ? 'Opus is marking against the rubric…' : 'Marking in code…')
      const r = await window.tide.mocks.end(started.id, { ...(mode === 'coding' ? { code } : {}), ...(mode === 'design' ? { canvas, notes } : {}), ...(mode === 'quant' || mode === 'behavioural' ? { answers } : {}), ...(examMarks ? { examMarks, answers: examList } : {}) })
      setResult({ ...r, ...(mode === 'design' ? { canvas } : {}), ...(mode === 'coding' ? { code } : {}) })
      setPhase('debrief')
    } catch (e) {
      setError(clean(e))
      ending.current = false
      setPhase('live')
    }
  }, [started, mode, code, canvas, notes, answers, examAnswers])

  // Time's up: hand it in
  useEffect(() => {
    if (phase === 'live' && clock && left === 0) void end()
  }, [phase, clock, left, end])

  const leave = () => {
    if (phase === 'live' && !leaving) {
      setLeaving(true)
      setTimeout(() => setLeaving(false), 4000)
      return
    }
    if (started && phase === 'live') void window.tide.mocks.cancel(started.id)
    app.back()
  }

  const rubric = useMemo(() => rubricFor(mode, started?.exam ?? null), [mode, started])

  // ---------- Moving to a window of its own, mid-mock ----------
  // The work is kept in main as it changes, so a pop-out (or the main window, on return) carries on from it
  const liveState = useCallback((): MockLiveState => ({ code, canvas, notes, answers, examAnswers, lines, hints }), [code, canvas, notes, answers, examAnswers, lines, hints])
  const keepNow = useCallback(() => {
    if (phase === 'live' && started) void window.tide.mocks.keep(started.id, liveState()).catch(() => {})
  }, [phase, started, liveState])
  useEffect(() => {
    if (phase !== 'live' || !started) return
    const t = setTimeout(keepNow, 600)
    return () => clearTimeout(t)
  }, [phase, started, keepNow])
  usePopOutSurface({
    name: phase === 'live' ? title : undefined,
    busy: busy || testing || phase === 'preparing' || phase === 'marking',
    busyText: phase === 'marking' ? 'It can move once the debrief is ready.' : 'It can move once the interviewer has answered.',
    view: () => {
      if (phase === 'live' && started) {
        // Kept now, before the other window asks for it
        keepNow()
        return { kind: 'mock', mode, live: started.id }
      }
      return { kind: 'mock', mode, ...(review ? { review } : {}) }
    }
  })

  return (
    <div className={`doc-view mock mk-${mode} mk-phase-${phase}`}>
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <button className="crumb crumb-link" onClick={() => app.setView({ kind: 'practice' })}>
            Practice
          </button>
          <Icon name="chevron" size={11} />
          <span className="crumb current">{phase === 'live' || phase === 'debrief' || phase === 'marking' ? title : info.label}</span>
        </div>
        <div className="toolbar-actions no-drag">
          {phase === 'live' && clock && (
            <span className={`interview-clock mk-clock ${clockTone(clock, now)}`} role="timer" aria-label={`${clockText(left)} left of ${clock.minutes} minutes`}>
              <span className="interview-clock-dot" aria-hidden="true" />
              {left === 0 ? "Time's up" : clockText(left)}
            </span>
          )}
          {phase === 'live' && (
            <button className="btn primary small" onClick={() => void end()}>
              {mode === 'exam' ? 'Hand in' : 'End and mark'}
            </button>
          )}
          <button className={`tool-btn${leaving ? ' mk-confirm' : ''}`} onClick={leave} title={phase === 'live' ? 'Leave without marking' : 'Close'}>
            <Icon name="x" />
            <span>{leaving ? 'Leave without marking?' : phase === 'debrief' ? 'Close' : 'Leave'}</span>
          </button>
          {(phase === 'brief' || phase === 'live' || !!review) && <PopOutButton />}
        </div>
      </header>

      {error && phase !== 'live' && <p className="error-text mk-error">{error}</p>}

      {phase === 'brief' && (
        <Brief
          mode={mode}
          status={status}
          rubric={rubric}
          minutes={minutes}
          onMinutes={setMinutes}
          tags={tags}
          onTags={setTags}
          designRef={designRef}
          onDesign={setDesignRef}
          focus={focus}
          onFocus={setFocus}
          topics={topics}
          onStart={start}
        />
      )}

      {(phase === 'preparing' || phase === 'marking') && (
        <div className="mk-wait">
          <span className="spinner" />
          <p>{phase === 'preparing' ? (mode === 'exam' ? 'Writing your paper from what you have studied…' : 'Setting the problem…') : markingNote || 'Opening the debrief…'}</p>
          {phase === 'preparing' && mode === 'exam' && <p className="muted small">This can take a minute. The clock starts when the paper is ready.</p>}
        </div>
      )}

      {phase === 'live' && started && (
        <>
          {error && <p className="error-text mk-error">{error}</p>}
          {mode === 'coding' && started.problem && (
            <div className="mk-live mk-split">
              <aside className="mk-side">
                <section className="mk-problem">
                  <h1>{started.problem.title}</h1>
                  <div className="prose compact" dangerouslySetInnerHTML={md(started.problem.prompt)} />
                  <div className="mk-examples">
                    {started.problem.examples.map((e) => (
                      <code key={e}>{e}</code>
                    ))}
                  </div>
                </section>
                <MockChat lines={lines} streaming={streaming} busy={busy} interviewer={started.interviewer} why={started.why} hints={hints} hintsLeft={started.problem.hintCount - hints} onSay={(t) => void talk(t)} onHint={askHint} topic={started.problem.title} />
              </aside>
              <div className="mk-work">
                <div className="mk-editor">
                  <CodeEditor value={code} onChange={setCode} language="python" fill onSubmit={runTests} />
                </div>
                <TestBar tests={tests} testing={testing} names={started.problem.testNames} onRun={runTests} />
              </div>
            </div>
          )}

          {mode === 'design' && started.design && (
            <div className="mk-live mk-split design">
              <div className="mk-work mk-canvas">
                <CanvasEditor canvas={canvas} onChange={setCanvas} version={0} />
              </div>
              <aside className="mk-side">
                <section className="mk-problem">
                  <h1>{started.design.title}</h1>
                  <p>{started.design.brief}</p>
                </section>
                <label className="mk-notes">
                  <span>Notes: requirements, numbers, decisions</span>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} placeholder={'Functional: …\nNon-functional: 99.99%, p99 < 300 ms\nPeak: 2,000 payments/s'} />
                </label>
                <MockChat lines={lines} streaming={streaming} busy={busy} interviewer={started.interviewer} why={started.why} hints={hints} hintsLeft={5 - hints} onSay={(t) => void talk(t)} onHint={askHint} topic={started.design.title} placeholder="Explain a choice, or ask about the requirements" />
              </aside>
            </div>
          )}

          {mode === 'quant' && started.quant && (
            <QuantSitting
              started={started}
              answers={answers}
              onAnswer={async (a, q) => {
                setAnswers((xs) => [...xs.filter((x) => x.id !== a.id), a])
                if (!started.interviewer || q.kind === 'mental') {
                  if (started.interviewer) void window.tide.mocks.answer(started.id, q.id, a.text)
                  return
                }
                setLines((l) => [...l, { role: 'candidate', text: `${q.prompt}\n→ ${a.text}` }])
                setBusy(true)
                setStreaming('')
                try {
                  const r = await window.tide.mocks.answer(started.id, q.id, a.text)
                  if (r.followUp) setLines((l) => [...l, { role: 'interviewer', text: r.followUp! }])
                } catch (e) {
                  setLines((l) => [...l, { role: 'interviewer', text: `(No follow-up: ${clean(e)})` }])
                } finally {
                  setStreaming('')
                  setBusy(false)
                }
              }}
              onDone={() => void end()}
              chat={<MockChat lines={lines} streaming={streaming} busy={busy} interviewer={started.interviewer} why={started.why} hints={0} hintsLeft={null} onSay={(t) => void talk(t)} onHint={() => {}} placeholder="Answer the follow-up, or think aloud" />}
            />
          )}

          {mode === 'behavioural' && started.behavioural && (
            <BehaviouralSitting
              started={started}
              lines={lines}
              busy={busy}
              onAnswer={async (id, text, question) => {
                setAnswers((xs) => [...xs.filter((x) => x.id !== id), { id, text, ms: 0 }])
                if (started.interviewer) await talk(text, { question })
              }}
              onDone={() => void end()}
              chat={<MockChat lines={lines} streaming={streaming} busy={busy} interviewer={started.interviewer} why={started.why} hints={0} hintsLeft={null} onSay={(t) => void talk(t)} onHint={() => {}} placeholder="Reply to the interviewer" />}
            />
          )}

          {mode === 'exam' && started.exam && <ExamSitting paper={started.exam} answers={examAnswers} onChange={setExamAnswers} onHandIn={() => void end()} />}
        </>
      )}

      {phase === 'debrief' && result && <Debrief mode={mode} result={result} rubric={rubricFor(mode, started?.exam ?? null).length ? rubricFor(mode, started?.exam ?? null) : result.debrief.scores.map((s) => ({ id: s.id, label: s.id.replace(/^q(\d+)$/, 'Question $1'), what: '' }))} designId={started?.design?.id} onAgain={() => app.setView({ kind: 'mock', mode, nonce: Date.now() })} />}
    </div>
  )
}

// ---------- The brief ----------

function Brief(p: {
  mode: MockMode
  status: MockStatus | null
  rubric: RubricItem[]
  minutes: number
  onMinutes(m: number): void
  tags: BankTag[]
  onTags(t: BankTag[]): void
  designRef: string
  onDesign(id: string): void
  focus: string
  onFocus(s: string): void
  topics: string[] | null
  onStart(): void
}) {
  const info = modeInfo(p.mode)
  const level = p.status?.level
  return (
    <div className="doc-scroll">
      <div className="mk-brief">
        <p className="mk-eyebrow">
          <Icon name={MODE_ICON[p.mode]} size={14} />
          Mock · {info.short}
        </p>
        <h1 className="mk-h1">{info.label}</h1>

        <section className="mk-block">
          <h2>What to expect</h2>
          <ul className="mk-expect">
            {EXPECT[p.mode].map((x) => (
              <li key={x}>{x}</li>
            ))}
            <li>The clock runs from the moment you start. No breaks interrupt it and the sidebar steps away. When time is up your work is handed in as it is.</li>
          </ul>
          <p className="mk-who">
            <Icon name="claude" size={13} />
            {p.mode === 'exam'
              ? 'The paper is written and each part marked by Claude when it is ready (Opus marks), or by Gemma on this Mac.'
              : p.status === null
                ? 'Checking for Claude…'
                : p.status.claude
                  ? 'Sonnet interviews you; Opus marks.'
                  : `Claude isn’t ready${p.status.why ? ` (${p.status.why})` : ''}. You can still sit it: no interviewer, and it is marked in code.`}
          </p>
        </section>

        <section className="mk-block">
          <h2>Set up</h2>
          <div className="mk-setup">
            <div className="mk-field">
              <span className="mk-label">Time</span>
              <PillSegment label="Minutes" value={String(p.minutes)} onChange={(v) => p.onMinutes(Number(v))} options={info.minutes.map((m) => ({ value: String(m), label: `${m} min` }))} />
            </div>
            {p.mode === 'coding' && (
              <div className="mk-field">
                <span className="mk-label">Patterns{level ? <span className="muted"> · your level: {level === 1 ? 'warm-up' : level === 2 ? 'interview standard' : 'hard'}</span> : null}</span>
                <div className="chips mk-tags" role="group" aria-label="Patterns to draw from">
                  {BANK_TAGS.map((t) => (
                    <button key={t} className={`chip${p.tags.includes(t) ? ' on' : ''}`} aria-pressed={p.tags.includes(t)} onClick={() => p.onTags(p.tags.includes(t) ? p.tags.filter((x) => x !== t) : [...p.tags, t])}>
                      {tagLabel(t)}
                    </button>
                  ))}
                </div>
                <span className="muted small">{p.tags.length ? 'One problem on any of these.' : 'Any pattern. Pick some to narrow it.'}</span>
              </div>
            )}
            {p.mode === 'design' && (
              <div className="mk-field">
                <span className="mk-label">Brief</span>
                <div className="chips mk-tags" role="group" aria-label="Design brief">
                  <button className={`chip${!p.designRef ? ' on' : ''}`} aria-pressed={!p.designRef} onClick={() => p.onDesign('')}>
                    Surprise me
                  </button>
                  {DESIGNS.map((d) => (
                    <button key={d.id} className={`chip${p.designRef === d.id ? ' on' : ''}`} aria-pressed={p.designRef === d.id} onClick={() => p.onDesign(d.id)}>
                      {d.title.replace(/^An? /, '').replace(/^./, (c) => c.toUpperCase())}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {p.mode === 'exam' && (
              <div className="mk-field">
                <span className="mk-label">Covers</span>
                <input className="mk-input" value={p.focus} onChange={(e) => p.onFocus(e.target.value)} placeholder={p.topics?.length ? `What you’ve studied: ${p.topics.slice(0, 3).join(', ')}` : 'A topic, or leave empty for what you have studied'} />
                {p.topics && p.topics.length > 0 && (
                  <div className="chips mk-tags">
                    {p.topics.map((t) => (
                      <button key={t} className={`chip${p.focus === t ? ' on' : ''}`} onClick={() => p.onFocus(p.focus === t ? '' : t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {p.rubric.length > 0 && (
          <section className="mk-block">
            <h2>How it is marked</h2>
            <ol className="mk-rubric">
              {p.rubric.map((r) => (
                <li key={r.id}>
                  <span className="mk-rubric-label">{r.label}</span>
                  <span className="mk-rubric-what">
                    {r.what}
                    {r.needsClaude ? <em> Needs Claude.</em> : null}
                  </span>
                </li>
              ))}
            </ol>
            <p className="muted small">Each item is scored from 0 to 4. The debrief quotes the moments that decided it.</p>
          </section>
        )}
        {p.mode === 'exam' && <p className="muted small mk-block">Each question is marked out of its own marks; the debrief scores each question from 0 to 4.</p>}

        <div className="mk-start">
          <button className="btn primary large" onClick={p.onStart}>
            <Icon name="timer" size={15} />
            Start the clock · {p.minutes} min
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- The coding tests ----------

function TestBar({ tests, testing, names, onRun }: { tests: TestOutcome | null; testing: boolean; names: string[]; onRun(): void }) {
  const failed = new Map((tests?.failed ?? []).map((f) => [f.name, f.why]))
  const passed = new Set(tests?.passed ?? [])
  return (
    <div className="mk-tests">
      <div className="mk-tests-head">
        <button className="btn small" onClick={onRun} disabled={testing}>
          {testing ? <span className="spinner small" /> : <Icon name="play" size={12} />}
          Run hidden tests
        </button>
        <span className="muted small">⌘↵</span>
        {tests && !tests.error && (
          <span className="mk-tests-count tabular">
            {tests.passed.length} of {tests.total} passed
          </span>
        )}
      </div>
      {tests?.error ? (
        <pre className="mk-tests-error">{tests.error}</pre>
      ) : (
        <ul className="mk-tests-list">
          {names.map((n) => (
            <li key={n} className={passed.has(n) ? 'pass' : failed.has(n) ? 'fail' : ''}>
              <span className="mk-test-mark" aria-hidden="true">
                {passed.has(n) ? <Icon name="check" size={11} /> : failed.has(n) ? <Icon name="x" size={11} /> : <Icon name="dot" size={11} />}
              </span>
              <span className="mk-test-name">{n}</span>
              {failed.get(n) && <code className="mk-test-why">{failed.get(n)}</code>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Quant ----------

const KIND_LABEL = { mental: 'Mental maths', probability: 'Probability', ev: 'Expected value', sizing: 'Market sizing', finance: 'Finance' } as const

function QuantSitting({ started, answers, onAnswer, onDone, chat }: { started: MockStarted; answers: MockAnswer[]; onAnswer(a: MockAnswer, q: NonNullable<MockStarted['quant']>[number]): void; onDone(): void; chat: React.ReactNode }) {
  const qs = started.quant!
  const [i, setI] = useState(() => Math.min(answers.length, qs.length - 1))
  const [text, setText] = useState('')
  const [since, setSince] = useState(Date.now())
  const input = useRef<HTMLTextAreaElement>(null)
  const q = qs[i]
  useEffect(() => input.current?.focus(), [i])
  const submit = () => {
    if (!text.trim()) return
    onAnswer({ id: q.id, text: text.trim(), ms: Date.now() - since }, q)
    setText('')
    setSince(Date.now())
    if (i < qs.length - 1) setI(i + 1)
    else onDone()
  }
  const long = q.kind === 'sizing' || q.kind === 'finance' || q.kind === 'ev' || q.kind === 'probability'
  return (
    <div className="mk-live mk-split quant">
      <div className="mk-work mk-question-col">
        <ol className="mk-progress" aria-label="Questions">
          {qs.map((x, k) => (
            <li key={x.id} className={k === i ? 'on' : answers.some((a) => a.id === x.id) ? 'done' : ''} title={`${k + 1}. ${KIND_LABEL[x.kind]}`} />
          ))}
        </ol>
        <div className="mk-question">
          <p className="mk-eyebrow">
            {i + 1} of {qs.length} · {KIND_LABEL[q.kind]}
            <span className="muted"> · aim for {q.target < 60 ? `${q.target} s` : `${Math.round(q.target / 60)} min`}</span>
          </p>
          <p className="mk-question-text">{q.prompt}</p>
          <textarea
            ref={input}
            className={`mk-answer${long ? ' long' : ''}`}
            value={text}
            rows={long ? 5 : 1}
            placeholder={q.kind === 'mental' ? 'Answer' : q.kind === 'finance' ? 'Your answer' : 'Your answer, with working (e.g. 1/6, 0.52, 24 billion)'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (!long || e.metaKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="mk-question-actions">
            <span className="muted small">{long ? '⌘↵ to answer' : '↵ to answer'}</span>
            <button className="btn primary small" onClick={submit} disabled={!text.trim()}>
              {i < qs.length - 1 ? 'Answer' : 'Answer and finish'}
            </button>
          </div>
        </div>
      </div>
      <aside className="mk-side">{chat}</aside>
    </div>
  )
}

// ---------- Behavioural ----------

function BehaviouralSitting({ started, lines, busy, onAnswer, onDone, chat }: { started: MockStarted; lines: ChatLine[]; busy: boolean; onAnswer(id: string, text: string, question: string): Promise<void>; onDone(): void; chat: React.ReactNode }) {
  const qs = started.behavioural!
  const [i, setI] = useState(0)
  const [stage, setStage] = useState<'answer' | 'follow'>('answer')
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const q = qs[i]
  const lastInterviewer = [...lines].reverse().find((l) => l.role === 'interviewer')?.text
  const followUp = started.interviewer ? lastInterviewer : q.followUp
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const submit = async () => {
    if (!text.trim()) return
    const id = stage === 'answer' ? q.id : `${q.id}:follow`
    const t = text.trim()
    setText('')
    await onAnswer(id, t, stage === 'answer' ? q.prompt : `${q.prompt} (follow-up: ${followUp ?? ''})`)
    if (stage === 'answer') setStage('follow')
    else if (i < qs.length - 1) {
      setI(i + 1)
      setStage('answer')
    } else onDone()
  }
  return (
    <div className="mk-live mk-split behavioural">
      <div className="mk-work mk-question-col">
        <ol className="mk-progress" aria-label="Questions">
          {qs.map((x, k) => (
            <li key={x.id} className={k === i ? 'on' : k < i ? 'done' : ''} />
          ))}
        </ol>
        <div className="mk-question">
          <p className="mk-eyebrow">
            Question {i + 1} of {qs.length}
            {stage === 'follow' ? ' · follow-up' : ''}
          </p>
          <p className="mk-question-text">{q.prompt}</p>
          {stage === 'follow' && <p className="mk-follow">{busy ? 'The interviewer is reading your answer…' : followUp}</p>}
          <textarea ref={box} className="mk-answer long" value={text} rows={9} placeholder={stage === 'answer' ? 'Situation, task, action, result. Say "I" for what you did.' : 'Your answer to the follow-up'} onChange={(e) => setText(e.target.value)} />
          <div className="mk-question-actions">
            <span className="muted small tabular">{words} words{stage === 'answer' ? ' · about 200–350 is two minutes spoken' : ''}</span>
            <button className="btn primary small" onClick={() => void submit()} disabled={!text.trim() || busy}>
              {stage === 'answer' ? 'Answer' : i < qs.length - 1 ? 'Next question' : 'Finish'}
            </button>
          </div>
        </div>
      </div>
      <aside className="mk-side">{chat}</aside>
    </div>
  )
}

// ---------- The debrief ----------

function Debrief({ mode, result, rubric, designId, onAgain }: { mode: MockMode; result: Result; rubric: RubricItem[]; designId?: string; onAgain(): void }) {
  const app = useApp()
  const { debrief: d, record: r, fed } = result
  const [view, setView] = useState<'yours' | 'reference'>('yours')
  const label = (id: string) => rubric.find((x) => x.id === id)?.label ?? id
  const design = mode === 'design' ? DESIGNS.find((x) => x.id === (designId ?? r.ref)) : undefined
  const annotated = useMemo(() => (result.canvas ? annotateCanvas(result.canvas, d.annotations ?? []) : null), [result.canvas, d.annotations])
  const reference = useMemo(() => (design ? referenceCanvas(design) : null), [design])
  const by = d.by === 'opus' ? 'Marked by Opus' : d.by === 'examiner' ? 'Marked part by part' : 'Marked in code'
  return (
    <div className="doc-scroll">
      <div className="mk-debrief">
        <p className="mk-eyebrow">
          <Icon name={MODE_ICON[mode]} size={14} />
          {modeInfo(mode).label} · {r.used} of {r.minutes} min{r.hints ? ` · ${r.hints} hint${r.hints === 1 ? '' : 's'}` : ''} · {by}
        </p>
        <h1 className="mk-h1">{r.title}</h1>
        <div className="mk-overall">
          <strong className="tabular">{Math.round(d.overall * 100)}%</strong>
          {d.verdict && mode !== 'exam' && <span className="mk-verdict">{d.verdict[0].toUpperCase() + d.verdict.slice(1)}</span>}
        </div>
        {d.summary && <p className="mk-lede">{d.summary}</p>}

        <section className="mk-block">
          <h2>Scores</h2>
          <ul className="mk-scores">
            {d.scores.map((s) => (
              <li key={s.id}>
                <div className="mk-score-row">
                  <span className="mk-score-label">{label(s.id)}</span>
                  <span className="mk-bar" aria-hidden="true">
                    <span style={{ width: `${((s.score ?? 0) / 4) * 100}%` }} />
                  </span>
                  <span className="mk-score-num tabular">{s.score === null ? '—' : `${s.score} / 4`}</span>
                </div>
                {s.note && <p className="mk-score-note">{s.note}</p>}
                {s.quote && <blockquote className={`mk-quote${codeLike(s.quote) ? ' code' : ''}`}>{s.quote}</blockquote>}
              </li>
            ))}
          </ul>
        </section>

        {d.moments.length > 0 && (
          <section className="mk-block">
            <h2>Moments that decided it</h2>
            <ul className="mk-moments">
              {d.moments.map((m, i) => (
                <li key={i}>
                  <blockquote className={`mk-quote${codeLike(m.quote) ? ' code' : ''}`}>{m.quote}</blockquote>
                  <p>{m.note}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {mode === 'design' && annotated && (
          <section className="mk-block">
            <div className="mk-block-head">
              <h2>{view === 'yours' ? 'Your design, annotated' : 'A reference design'}</h2>
              {design && <PillSegment label="Design" value={view} onChange={(v) => setView(v as 'yours' | 'reference')} options={[{ value: 'yours', label: 'Yours' }, { value: 'reference', label: 'Reference' }]} />}
            </div>
            <div className="mk-canvas-review">
              <CanvasEditor key={view} canvas={view === 'yours' || !reference ? annotated : reference} onChange={() => {}} version={view === 'yours' ? 1 : 2} compact />
            </div>
          </section>
        )}

        {d.modelAnswer && (
          <section className="mk-block">
            <h2>{mode === 'coding' ? 'Reference solution' : mode === 'exam' ? 'Where the marks were' : 'A model answer'}</h2>
            <div className="prose compact mk-model" dangerouslySetInnerHTML={md(d.modelAnswer)} />
          </section>
        )}

        {mode === 'coding' && result.code && (
          <details className="mk-block mk-yours">
            <summary>Your code</summary>
            <pre>
              <code>{result.code}</code>
            </pre>
          </details>
        )}

        <section className="mk-block">
          <h2>What to practise next</h2>
          {d.practise.length ? (
            <ul className="mk-practise">
              {d.practise.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing stood out. Try a harder one.</p>
          )}
          {fed && (
            <p className="mk-fed">
              {[fed.roadmap ? `Added ${fed.roadmap} to your Mock practice note` : '', fed.recall ? `${fed.recall} question${fed.recall === 1 ? '' : 's'} kept for recall in later lessons` : '', fed.profile ? 'your learner profile updated' : '', fed.lesson ? 'kept with your lessons' : ''].filter(Boolean).join(' · ') || 'Saved to your history.'}
            </p>
          )}
        </section>

        <div className="mk-actions">
          <button className="btn" onClick={() => app.openPath('Coach/Mock practice.md')}>
            <Icon name="note" size={14} />
            Open Mock practice
          </button>
          <button className="btn" onClick={() => app.setView({ kind: 'practice' })}>
            Back to Practice
          </button>
          <button className="btn primary" onClick={onAgain}>
            <Icon name="refresh" size={14} />
            Another {modeInfo(mode).short.toLowerCase()} mock
          </button>
        </div>
      </div>
    </div>
  )
}
