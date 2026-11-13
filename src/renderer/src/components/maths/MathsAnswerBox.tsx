import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Angle } from '@shared/calc'
import { correctLine, dropLine, mathsNote, readBackNote, workingMessage, type AnswerMode, type LineMark, type Marked, type PaperLine } from '@shared/mathsAnswer'
import { pastedImageFiles } from '../../lib/pastedImages'
import { vaultUrl } from '../../lib/markdown'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { Calculator, Tex } from './Calculator'
import { Keypad, type Key } from './Keypad'
import type { MathFieldHandle } from './MathField'
import { PaperView } from './PaperView'
import { PhoneCamera } from './PhoneCamera'
import { savePage } from './paperPages'
import { newLine, WorkingLines, type WorkLine } from './WorkingLines'
import '../../styles/mathsAnswer.css'

/** What the lesson's Submit button shows and does, as the box tells it */
export interface BoxStatus {
  mode: AnswerMode
  ready: boolean
  label: string
  busy: boolean
}

export interface MathsBoxHandle {
  submit(): void
}

const MODES: { id: AnswerMode; label: string; icon: 'mic' | 'format' | 'camera'; title: string }[] = [
  { id: 'words', label: 'Say or type', icon: 'mic', title: 'Answer in plain words, typed or dictated; Tide shows how it read the maths before marking' },
  { id: 'maths', label: 'Maths', icon: 'format', title: 'Write it as maths, a step a line, with a scientific calculator' },
  { id: 'paper', label: 'Paper', icon: 'camera', title: 'Work on paper, then take a photo: Claude reads and marks each line' }
]

const MAX_PAGES = 6

/**
 * The answer box in maths lessons: one answer, three ways in (shared/mathsAnswer).
 * ⌘1 to ⌘3 switch between them and ⌘↩ submits, from any of them.
 */
export function MathsAnswerBox({
  handle,
  onStatus,
  onSend,
  words,
  setWords,
  wordsRef,
  wordsPlaceholder,
  wordsProps,
  askPrompt,
  question,
  path,
  footer
}: {
  handle: React.MutableRefObject<MathsBoxHandle | null>
  onStatus(s: BoxStatus): void
  /** The answer goes to the tutor: what the transcript shows, and Tide's note for the tutor */
  onSend(body: string, note?: string): void
  words: string
  setWords(v: string): void
  wordsRef: RefObject<HTMLTextAreaElement | null>
  wordsPlaceholder: string
  wordsProps: Record<string, unknown>
  /** The question asked, for the read-back */
  askPrompt: string
  /** The tutor's message with its hidden solution, for marking */
  question: string
  path?: string
  footer: ReactNode
}) {
  const app = useApp()
  const readBackOn = app.settings.maths?.readBack !== false
  const [angle, setAngleState] = useState<Angle>(app.settings.maths?.angle ?? 'rad')
  const setAngle = (a: Angle) => {
    setAngleState(a)
    void app.updateSettings({ maths: { ...app.settings.maths, angle: a } })
  }
  const [mode, setModeState] = useState<AnswerMode>(() => {
    try {
      const m = localStorage.getItem('tide.mathsAnswer.mode') as AnswerMode | null
      return m === 'maths' || m === 'paper' ? m : 'words'
    } catch {
      return 'words'
    }
  })
  const setMode = (m: AnswerMode) => {
    setModeState(m)
    try {
      localStorage.setItem('tide.mathsAnswer.mode', m)
    } catch {
      // only a convenience
    }
  }
  const root = useRef<HTMLDivElement>(null)
  const [claude, setClaude] = useState<{ claude: boolean; why?: string } | null>(null)
  useEffect(() => {
    void window.tide.mathsAnswer
      .status(path)
      .then(setClaude)
      .catch(() => setClaude({ claude: false }))
  }, [path])

  // ---------- Say or type ----------
  const [rb, setRb] = useState<{ for: string; latex: string; unclear: string } | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const inflight = useRef<string | null>(null)
  const [confirmWanted, setConfirmWanted] = useState(false)
  const fetchReadBack = async (text: string) => {
    if (inflight.current === text) return
    inflight.current = text
    setReading(text)
    const r = await window.tide.mathsAnswer.readBack(text, askPrompt, path).catch(() => null)
    if (inflight.current !== text) return
    inflight.current = null
    setReading(null)
    setRb({ for: text, latex: r?.latex ?? '', unclear: r?.unclear ?? '' })
    return r
  }
  // Read back as soon as they pause: by the time they submit, it's usually there
  useEffect(() => {
    if (mode !== 'words' || !readBackOn) return
    const text = words.trim()
    if (text.length < 3 || rb?.for === text) return
    const t = setTimeout(() => void fetchReadBack(text), 1400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, mode, readBackOn])
  const current = rb && rb.for === words.trim() ? rb : null

  const submitWords = async () => {
    const text = words.trim()
    if (!text) return
    if (!readBackOn) return onSend(text)
    if (current) return onSend(text, current.latex ? readBackNote(current.latex) : undefined)
    // Not read back yet: read it now, and show it before marking
    setConfirmWanted(true)
    const r = await fetchReadBack(text)
    // Nothing could read it back (no Claude, no Gemma loaded), or it has no maths in it: it goes as typed
    if (r === null || (r && !r.latex)) onSend(text)
  }
  const sayAgain = () => {
    setRb(null)
    setConfirmWanted(false)
    const ta = wordsRef.current
    if (ta) {
      ta.focus()
      ta.select()
    }
  }

  // ---------- Maths ----------
  const [lines, setLines] = useState<WorkLine[]>(() => [newLine()])
  const [lineMarks, setLineMarks] = useState<LineMark[] | null>(null)
  const [marking, setMarking] = useState<string | null>(null)
  const [mathsError, setMathsError] = useState<string | null>(null)
  const handles = useRef(new Map<string, MathFieldHandle>())
  const calcHandle = useRef<MathFieldHandle | null>(null)
  const active = useRef<MathFieldHandle | null>(null)
  const lastLine = useRef<string | null>(null)
  // The calculator and the keypad open when you want them, and stay as you left them
  const remembered = (key: string) => {
    try {
      return localStorage.getItem(key) === 'on'
    } catch {
      return false
    }
  }
  const [showCalc, setShowCalc] = useState(() => remembered('tide.mathsAnswer.calc'))
  const [showKeys, setShowKeys] = useState(() => remembered('tide.mathsAnswer.keys'))
  const flip = (key: string, set: (f: (on: boolean) => boolean) => void) =>
    set((on) => {
      try {
        localStorage.setItem(key, on ? 'off' : 'on')
      } catch {
        // only a convenience
      }
      return !on
    })
  const toggleCalc = () => flip('tide.mathsAnswer.calc', setShowCalc)
  const toggleKeys = () => flip('tide.mathsAnswer.keys', setShowKeys)
  const lineHandle = () => (lastLine.current && handles.current.get(lastLine.current)) || handles.current.get(lines[lines.length - 1].id) || null
  const onKey = (key: Key) => {
    const target = active.current ?? lineHandle()
    if (!target) return
    if (key.command) target.command(key.command)
    else if (key.insert !== undefined) target.insert(key.insert)
  }
  /** "Insert into my answer": at the caret of the line last worked on; a whole calculation as a new line */
  const insertIntoAnswer = (latex: string, asLine = false) => {
    if (asLine || /=/.test(latex)) {
      const empty = lines.find((l) => !l.latex.trim())
      if (empty) setLines(lines.map((l) => (l.id === empty.id ? { ...l, latex } : l)))
      else setLines([...lines, newLine(latex)])
      return
    }
    const h = lineHandle()
    h?.insert(latex)
  }
  const submitMaths = async () => {
    const ls = lines.map((l) => l.latex.trim()).filter(Boolean)
    if (!ls.length || marking) return
    setMathsError(null)
    if (ls.length === 1) return onSend(`$$${ls[0]}$$`, mathsNote(ls))
    setMarking(claude?.claude ? 'Claude Opus is marking each step…' : 'SymPy is checking each step…')
    const r = await window.tide.mathsAnswer.mark({ question, lines: ls, path, angle }).catch((e: Error) => {
      setMathsError(e.message)
      return null
    })
    setMarking(null)
    if (!r) return
    setLineMarks(r.marks.lines)
    const { body, note } = workingMessage({ kind: 'steps', pages: [], lines: ls.map((latex) => ({ latex, page: 0, box: null })), marks: r.marks })
    onSend(body, note)
  }

  // ---------- Paper ----------
  const [pages, setPages] = useState<string[]>([])
  const [adding, setAdding] = useState(0)
  const [camera, setCamera] = useState(false)
  const [paperLines, setPaperLines] = useState<PaperLine[] | null>(null)
  const [paperMarks, setPaperMarks] = useState<Marked | null>(null)
  const [paperBusy, setPaperBusy] = useState<string | null>(null)
  const [paperError, setPaperError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const addPages = (sources: (File | string)[]) => {
    const room = MAX_PAGES - pages.length
    for (const s of sources.slice(0, Math.max(0, room))) {
      setAdding((n) => n + 1)
      savePage(s)
        .then((p) => {
          setPages((list) => (list.length >= MAX_PAGES ? list : [...list, p]))
          // A new page means a new reading
          setPaperLines(null)
          setPaperMarks(null)
        })
        .catch((e: Error) => setPaperError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
        .finally(() => setAdding((n) => n - 1))
    }
  }
  const readPages = async () => {
    if (!pages.length || paperBusy) return
    setPaperError(null)
    setPaperBusy(pages.length === 1 ? 'Claude Opus is reading your page, line by line…' : `Claude Opus is reading your ${pages.length} pages, line by line…`)
    const r = await window.tide.mathsAnswer.readPaper(pages, askPrompt, path).catch((e: Error) => ({ ok: false as const, error: e.message }))
    setPaperBusy(null)
    if (r.ok) setPaperLines(r.lines)
    else {
      setPaperError(r.error)
      if ('needsClaude' in r && r.needsClaude) setClaude({ claude: false })
    }
  }
  const markPaper = async () => {
    if (!paperLines?.length || paperBusy) return
    setPaperError(null)
    setPaperBusy('Claude Opus is marking each line…')
    const r = await window.tide.mathsAnswer.mark({ question, lines: paperLines.map((l) => l.latex), path, angle }).catch((e: Error) => {
      setPaperError(e.message)
      return null
    })
    setPaperBusy(null)
    if (!r) return
    setPaperMarks(r.marks)
    const { body, note } = workingMessage({ kind: 'paper', pages, lines: paperLines, marks: r.marks })
    onSend(body, note)
  }

  // ---------- Submit, status and keys ----------
  const submit = () => {
    if (mode === 'words') void submitWords()
    else if (mode === 'maths') void submitMaths()
    else if (paperLines) void markPaper()
    else void readPages()
  }
  handle.current = { submit }

  const status: BoxStatus =
    mode === 'words'
      ? { mode, ready: !!words.trim() && !reading, busy: !!reading && confirmWanted, label: readBackOn && words.trim() && !current ? (reading && confirmWanted ? 'Reading it back…' : 'Read it back') : 'Submit' }
      : mode === 'maths'
        ? { mode, ready: lines.some((l) => l.latex.trim()) && !marking, busy: !!marking, label: marking ? 'Marking…' : lines.filter((l) => l.latex.trim()).length > 1 ? 'Mark my working' : 'Submit' }
        : { mode, ready: claude?.claude !== false && !adding && !paperBusy && (paperLines ? paperLines.length > 0 : pages.length > 0), busy: !!paperBusy, label: paperBusy ? (paperLines ? 'Marking…' : 'Reading…') : paperLines ? 'Mark it' : 'Read my working' }
  const statusKey = JSON.stringify(status)
  useEffect(() => onStatus(status), [statusKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || camera) return
      const i = ['1', '2', '3'].indexOf(e.key)
      if (i >= 0) {
        e.preventDefault()
        e.stopPropagation()
        setMode(MODES[i].id)
        if (MODES[i].id === 'words') requestAnimationFrame(() => wordsRef.current?.focus())
        if (MODES[i].id === 'maths') requestAnimationFrame(() => lineHandle()?.focus())
        return
      }
      // ⌘↩ from a maths field or anywhere in the box (the words box submits on its own)
      if (e.key === 'Enter' && root.current?.contains(document.activeElement) && !(document.activeElement instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        e.stopPropagation()
        submit()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  })

  // Pictures pasted or dropped anywhere in the box go to the paper
  const takePictures = (files: File[]) => {
    const pics = pastedImageFiles(files)
    if (!pics.length) return false
    setMode('paper')
    addPages(pics)
    return true
  }

  return (
    <div
      className="ma"
      ref={root}
      data-mode={mode}
      onPaste={(e) => mode === 'paper' && takePictures([...e.clipboardData.files]) && e.preventDefault()}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (mode !== 'words' && takePictures([...e.dataTransfer.files])) e.preventDefault()
      }}
    >
      <div className="ma-bar">
        <div className="ma-seg" role="tablist" aria-label="How you answer">
          {MODES.map((m, i) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} title={`${m.title} (⌘${i + 1})`} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'maths' && (
          <div className="ma-tools">
            <button className={`ma-tool${showKeys ? ' on' : ''}`} onClick={toggleKeys} aria-pressed={showKeys} title={showKeys ? 'Hide the maths keys' : 'Show the maths keys: fractions, roots, trig, calculus, matrices, Greek'}>
              Keys
            </button>
            <button className={`ma-tool${showCalc ? ' on' : ''}`} onClick={toggleCalc} aria-pressed={showCalc} title={showCalc ? 'Hide the calculator' : 'Show the calculator: exact answers and decimals, with a tape'}>
              Calculator
            </button>
          </div>
        )}
      </div>

      {mode === 'words' && (
        <div className="ma-pane ma-words">
          <textarea
            ref={wordsRef}
            className="s-input"
            rows={4}
            autoFocus
            value={words}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={wordsPlaceholder}
            aria-label="Your answer, in words"
            {...wordsProps}
          />
          {readBackOn && words.trim() && (current?.latex || reading) ? (
            <div className={`ma-readback${reading && !current ? ' reading' : ''}`} aria-live="polite">
              <span className="ma-rb-label">Read as</span>
              {reading && !current ? <span className="ma-rb-wait">reading it back…</span> : current ? <Tex latex={`\\displaystyle ${current.latex}`} className="ma-rb-tex" /> : null}
              {current && (
                <button className="ma-rb-again" onClick={sayAgain} title="Select what you said, so you can say or type it again">
                  Not quite?
                </button>
              )}
              {current?.unclear && <p className="ma-rb-unclear">{current.unclear}</p>}
            </div>
          ) : null}
        </div>
      )}

      {mode === 'maths' && (
        <div className={`ma-pane ma-maths${showCalc ? ' with-calc' : ''}`}>
          <div className="ma-work">
            <WorkingLines
              lines={lines}
              onLines={(next) => (setLines(next), setLineMarks(null))}
              marks={lineMarks}
              handles={handles}
              onFocusLine={(id) => {
                lastLine.current = id
                active.current = handles.current.get(id) ?? null
              }}
            />
            {marking && <p className="ma-status">{marking}</p>}
            {mathsError && <p className="ma-error">{mathsError}</p>}
          </div>
          {showCalc && (
            <Calculator
              angle={angle}
              onAngle={setAngle}
              handle={calcHandle}
              onFocus={() => (active.current = calcHandle.current)}
              onInsert={(latex) => insertIntoAnswer(latex)}
            />
          )}
          {showKeys && <Keypad onKey={onKey} />}
        </div>
      )}

      {mode === 'paper' && (
        <div className="ma-pane ma-paper">
          {claude && !claude.claude ? (
            <div className="ma-needs">
              <b>Reading paper needs Claude.</b> {claude.why ? `${claude.why.charAt(0).toUpperCase()}${claude.why.slice(1)}.` : ''} Type or say your working in <button className="link-btn" onClick={() => setMode('words')}>Say or type</button>, or write it in <button className="link-btn" onClick={() => setMode('maths')}>Maths</button>, where SymPy checks each step.
            </div>
          ) : camera ? (
            <PhoneCamera
              onTake={(dataUrl) => {
                setCamera(false)
                addPages([dataUrl])
              }}
              onCancel={() => setCamera(false)}
            />
          ) : paperLines ? (
            <>
              <PaperView
                pages={pages}
                lines={paperLines}
                marks={paperMarks}
                onEdit={paperMarks ? undefined : (i, latex) => setPaperLines(correctLine(paperLines, i, latex))}
                onDrop={paperMarks ? undefined : (i) => setPaperLines(dropLine(paperLines, i))}
              />
              {!paperMarks && (
                <div className="ma-paper-again">
                  <button className="link-btn" onClick={() => (setPaperLines(null), setPaperMarks(null))}>
                    Change the photos
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {(pages.length > 0 || adding > 0) && (
                <div className="ma-pages" aria-label="Your pages">
                  {pages.map((p, i) => (
                    <figure key={p} className="ma-thumb">
                      <img src={vaultUrl(p)} alt={`Page ${i + 1}`} />
                      <figcaption>Page {i + 1}</figcaption>
                      <button className="ma-thumb-x" title="Remove this page" aria-label={`Remove page ${i + 1}`} onClick={() => setPages(pages.filter((x) => x !== p))}>
                        <Icon name="x" size={11} />
                      </button>
                    </figure>
                  ))}
                  {adding > 0 && <div className="ma-thumb loading">Adding…</div>}
                </div>
              )}
              <div className={`ma-drop${pages.length || adding ? ' has-pages' : ''}`}>
                <p className="ma-drop-say">{pages.length ? 'Add another page, or read these.' : 'Work on paper, then add a photo of it.'}</p>
                <div className="ma-drop-acts">
                  <button className="btn small" onClick={() => setCamera(true)} title="Your iPhone becomes the camera (Continuity Camera). Space takes the photo">
                    <Icon name="camera" size={13} /> iPhone camera
                  </button>
                  <button className="btn small" onClick={() => fileInput.current?.click()} title="Pick photos or scans from the Mac">
                    <Icon name="upload" size={13} /> Choose a photo
                  </button>
                </div>
                <p className="ma-drop-or">or drop or paste one here</p>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
                  onChange={(e) => {
                    if (e.target.files) addPages([...e.target.files])
                    e.target.value = ''
                  }}
                />
              </div>
            </>
          )}
          {paperBusy && <p className="ma-status">{paperBusy}</p>}
          {paperError && <p className="ma-error">{paperError}</p>}
        </div>
      )}
      {footer}
    </div>
  )
}
