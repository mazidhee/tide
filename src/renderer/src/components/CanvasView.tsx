import { useCallback, useEffect, useRef, useState } from 'react'
import { compareDesigns, describeCanvas, describeComparison, isConceptMap, parseCanvas, serializeCanvas, type Canvas } from '@shared/canvas'
import { parseVerdict, scorecardScore } from '@shared/interviews'
import { createDesign } from '../lib/designs'
import { createExampleDesign } from '../lib/examples'
import { InterviewClock, useInterviewClock } from './InterviewClock'
import { designInstructions, MAP_INSTRUCTIONS, type DesignMode } from '@shared/session'
import { fileTitle, useApp } from '../state'
import { CanvasEditor } from './CanvasEditor'
import { newEdges, useCanvasFiles } from './flow/canvasFiles'
import { Composer, TurnView, useConversation } from './Conversation'
import { Icon } from './Icon'
import { TimeThis } from './TimeThis'

const SUGGESTIONS = ['Review my design', 'Quiz me on my design', 'What breaks at 10x the load?', 'Where are the single points of failure?']
const MAP_SUGGESTIONS = ['Check my map', 'What is missing from my map?', 'Quiz me on this map', 'Label the links I left blank']
const TEACH_TOPICS = ['URL shortener', 'Chat app', 'Rate limiter', 'News feed', 'Market data feed', 'Payment system']

/**
 * A canvas with the tutor beside it: a system design, or a concept map (one with no system parts).
 * Either is a .canvas file in your notes; the tutor sees it on every message and can draw on it, so
 * it can teach a design step by step, run a design interview on what you draw, check a map's links,
 * or review and quiz you on it.
 */
export function CanvasView({ path, start, topic, company, timed, reference }: { path: string; start?: DesignMode; topic?: string; company?: string; timed?: number; reference?: string }) {
  const app = useApp()
  const convo = useConversation()
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [version, setVersion] = useState(0)
  const [mode, setMode] = useState<DesignMode>(start ?? 'free')
  const [input, setInput] = useState('')
  const [learn, setLearn] = useState('')
  const [tutorOpen, setTutorOpen] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<Canvas | null>(null)
  const shown = useRef<Canvas | null>(null)
  const [announce, setAnnounce] = useState<{ ids: string[]; nonce: number }>()
  const fileProps = useCanvasFiles()
  const listRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const toastRef = useRef(app.toast)
  toastRef.current = app.toast
  // Redraw from memory: the design learned earlier, to compare against
  const [original, setOriginal] = useState<Canvas | null>(null)
  useEffect(() => {
    if (reference) window.tide.vault.read(reference).then((raw) => setOriginal(parseCanvas(raw))).catch(() => {})
  }, [reference])
  const sendRef = useRef<(text: string) => void>(() => {})
  const clock = useInterviewClock(mode === 'interview' ? timed : undefined, () => sendRef.current("[time] Time's up. Stop here and give me the scorecard and verdict."))

  const load = useCallback(
    () =>
      window.tide.vault
        .read(path)
        .then((raw) => {
          pending.current = null
          const next = parseCanvas(raw)
          // The connections the tutor just drew play once, in the order a request takes them
          const added = shown.current ? newEdges(shown.current, next) : []
          shown.current = next
          setCanvas(next)
          setVersion((v) => v + 1)
          if (added.length) setAnnounce({ ids: added, nonce: Date.now() })
        })
        .catch(() => setCanvas({ nodes: [], edges: [] })),
    [path]
  )
  useEffect(() => {
    load()
  }, [load])

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current)
    const c = pending.current
    pending.current = null
    if (c) await window.tide.vault.write(path, serializeCanvas(c)).catch(() => toastRef.current("Couldn't save the canvas", { tone: 'error' }))
  }, [path])
  useEffect(() => () => void flush(), [flush])

  const change = (next: Canvas) => {
    shown.current = next
    setCanvas(next)
    pending.current = next
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 500)
  }

  // When the tutor draws, it writes the file; load what it drew
  // (updates to a step carry only what changed, so remember which steps are canvas ones)
  useEffect(() => {
    const canvasSteps = new Set<string>()
    return window.tide.ai.onEvent((e) => {
      if (e.type !== 'step') return
      const key = `${e.id}:${e.step.id}`
      if (e.step.kind === 'canvas') canvasSteps.add(key)
      if (e.step.status === 'done' && canvasSteps.has(key)) load()
    })
  }, [load])

  // A concept map, not a system: its own welcome and tutor (an empty canvas opened from a design link stays a design)
  const map = !!canvas?.nodes.length && isConceptMap(canvas) && !start

  const send = async (text: string, as: DesignMode = mode, comparison?: string) => {
    await flush()
    if (as !== mode) setMode(as)
    const isTimed = as === 'interview' && !!timed
    if (isTimed) clock.start()
    const reference = original ? `${describeCanvas(original)}${comparison ? `\n\nThe app's comparison of their drawing with it:\n${comparison}` : ''}` : undefined
    // In a timed round the time left goes with each message, so the interviewer can pace it
    const content = isTimed && !text.startsWith('[time]') ? `[${clock.left() || timed} min left] ${text}` : text
    const instructions = map && as === 'free' ? MAP_INSTRUCTIONS : designInstructions(as, topic || learn || undefined, company, { timed: isTimed ? timed : undefined, reference })
    if (await convo.send(content, { scope: { kind: 'none' }, instructions, canvasPath: path })) setInput('')
  }
  sendRef.current = (text) => send(text)

  const checkDrawing = () => {
    if (!original || !canvas) return
    const c = compareDesigns(original, canvas)
    send(`I'm done. Compare my drawing with the original.`, 'recall', describeComparison(c))
  }

  const openExample = async () => {
    const example = await createExampleDesign(app.files)
    await app.refreshTree()
    app.openPath(example)
  }

  /** A blank canvas to redraw this design from memory, checked against this one */
  const redraw = async () => {
    await flush()
    const copy = await createDesign(app.files, `${title} (from memory)`)
    await app.refreshTree()
    app.setView({ kind: 'design', path: copy, start: 'recall', reference: path, topic: title, nonce: Date.now() })
  }

  // A design interview for a company goes into its history once the scorecard is in
  const loggedRound = useRef(false)
  useEffect(() => {
    if (mode !== 'interview' || !company || loggedRound.current || convo.busy) return
    const last = convo.turns[convo.turns.length - 1]
    if (!last || last.role !== 'assistant' || last.streaming) return
    const score = scorecardScore(last.content)
    if (score === null) return
    loggedRound.current = true
    clock.stop()
    window.tide.practice
      .logInterview({ company, round: 'design', score, verdict: parseVerdict(last.content), timed: !!timed, minutes: clock.elapsedMinutes(), topic })
      .then(() => app.toast(`Saved to your ${company} history: ${Math.round(score * 100)}%`))
      .catch(() => {})
  }, [convo.turns, convo.busy, mode, company, timed, clock, topic, app])

  // A design interview or lesson starts by itself; a redraw waits for the original to load
  useEffect(() => {
    if (started.current || !canvas || !start || start === 'free' || (start === 'recall' && !original)) return
    started.current = true
    if (start === 'recall') return
    send(start === 'interview' ? `I'm ready for the system design interview.${topic ? ` ${topic}` : ''}` : `Teach me to design ${topic || 'a scalable web service'} on this canvas. Start by finding out what I already know.`, start)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, original])

  useEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [convo.turns])

  const title = fileTitle(path.split('/').pop() ?? path).replace(/\.canvas$/i, '')

  return (
    <div className={`lab design${tutorOpen ? ' with-tutor' : ''}`}>
      <header className="doc-toolbar drag lab-head">
        <div className="crumbs no-drag">
          <span className="crumb current">{title}</span>
          <span className="muted lab-sub">{mode === 'interview' ? `Design interview${company ? `, ${company}` : ''}` : mode === 'teach' ? 'Lesson' : mode === 'recall' ? 'From memory' : map ? 'Concept map' : 'System design'}</span>
        </div>
        <div className="toolbar-actions no-drag">
          {mode === 'interview' && timed && <InterviewClock remaining={clock.remaining} total={timed} />}
          {mode === 'recall' && original && (
            <button className="tool-btn primary-ish" onClick={checkDrawing} disabled={convo.busy || !canvas?.nodes.length} title="Compare your drawing with the original">
              <Icon name="check" />
              <span>Check my drawing</span>
            </button>
          )}
          {mode !== 'recall' && mode !== 'interview' && (canvas?.nodes.length ?? 0) >= 3 && (
            <button className="tool-btn" onClick={redraw} title="Redraw this design on a blank canvas, then compare">
              <Icon name="refresh" />
              <span>Redraw from memory</span>
            </button>
          )}
          <TimeThis context={{ label: `Design: ${title}`, path, kind: 'session' }} />
          <button className={`tool-btn${tutorOpen ? ' on' : ''}`} onClick={() => setTutorOpen((o) => !o)} title="Show or hide the tutor">
            <Icon name="panel" />
            <span>Tutor</span>
          </button>
        </div>
      </header>
      <div className="lab-body">
        <section className="design-canvas">{canvas ? <CanvasEditor canvas={canvas} onChange={change} version={version} onExample={mode === 'recall' ? undefined : openExample} announce={announce} {...fileProps} /> : <div className="ide-empty muted">Opening…</div>}</section>
        {tutorOpen && (
          <aside className="lab-tutor no-drag" aria-label="Tutor">
            <div className="lab-thread" ref={listRef}>
              {convo.turns.length === 0 && mode === 'recall' && (
                <div className="lab-welcome">
                  <p className="lab-welcome-title">Redraw it from memory.</p>
                  <p className="muted small">{original ? `${original.nodes.length} components in the original. Draw what you remember, then press Check my drawing.` : 'Opening the original…'}</p>
                </div>
              )}
              {convo.turns.length === 0 && mode !== 'recall' && map && (
                <div className="lab-welcome">
                  <p className="lab-welcome-title">Your study partner.</p>
                  <p className="muted small">Sees your map and can draw on it.</p>
                  <div className="lab-topics">
                    {MAP_SUGGESTIONS.map((q) => (
                      <button key={q} className="pill" onClick={() => send(q, 'free')}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {convo.turns.length === 0 && mode !== 'recall' && !map && (
                <div className="lab-welcome">
                  <p className="lab-welcome-title">Your design partner.</p>
                  <p className="muted small">Sees your canvas and can draw on it.</p>
                  <div className="lab-topics">
                    {SUGGESTIONS.map((q) => (
                      <button key={q} className="pill" disabled={!canvas?.nodes.length} onClick={() => send(q, 'free')}>
                        {q}
                      </button>
                    ))}
                    <button className="pill" onClick={() => send(`Interview me: give me a system design problem${company ? ` like ${company} would` : ''}.`, 'interview')}>
                      Interview me
                    </button>
                  </div>
                  <form
                    className="design-learn"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (learn.trim()) send(`Teach me to design ${learn.trim()} on this canvas. Start by finding out what I already know.`, 'teach')
                    }}
                  >
                    <input value={learn} onChange={(e) => setLearn(e.target.value)} placeholder="Teach me to design…" aria-label="What to design" list="design-topics" />
                    <datalist id="design-topics">
                      {TEACH_TOPICS.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                    <button className="btn small" disabled={!learn.trim()}>
                      Teach
                    </button>
                  </form>
                </div>
              )}
              {convo.turns.map((t) => (
                <TurnView key={t.id} turn={t} />
              ))}
            </div>
            <Composer answeredBy={convo.answeredBy} value={input} onChange={setInput} onSend={() => send(input)} busy={convo.busy} onStop={convo.stop} web={convo.web} onWeb={convo.setWeb} placeholder={map ? 'Ask about your map' : 'Ask about your design'} />
          </aside>
        )}
      </div>
    </div>
  )
}
