import { useStudying } from '../lib/studying'
import { endOngoing, getOngoing, keepLive, saveOngoing, sessionKey } from '../lib/sessions'
import type { View } from '../state'
import { PixelScene } from './PixelScene'
import { finishAgendaItem } from '../lib/agenda'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatScope, ExamMark, ExamOptions, ExamPaper } from '@shared/types'
import { cardsToMarkdown } from '@shared/cards'
import { useApp } from '../state'
import { renderMarkdown } from '../lib/markdown'
import { Icon } from './Icon'
import { PopOutButton } from './PopOutButton'
import { usePopOutSurface } from '../lib/popout'
import { readImageFile } from '../lib/pastedImages'

const isHeic = (f: File) => /^image\/hei[cf]$/.test(f.type) || /\.hei[cf]$/i.test(f.name)

type Phase = 'writing' | 'sitting' | 'marking' | 'results' | 'error'

interface Answer {
  text: string
  /** Photos of handwritten working, as downscaled JPEG data URLs */
  images: string[]
}

const key = (q: number, p: number) => `${q}:${p}`

/** Downscales a photo so marking stays fast: longest side 1568px (the most Claude uses), JPEG. An iPhone HEIC is converted by the main process */
function shrink(file: File): Promise<string> {
  if (isHeic(file)) return readImageFile(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 1568 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('That file is not an image'))
    img.src = url
  })
}

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}


export function ExamView({ scope, topic, options, view }: { scope: ChatScope; topic: string; options: ExamOptions; view?: View }) {
  const ongoingKey = view ? sessionKey(view as { kind: string; topic?: string; nonce?: number }) : null
  const app = useApp()
  const [phase, setPhase] = useState<Phase>('writing')
  const [paper, setPaper] = useState<ExamPaper | null>(null)
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [marks, setMarks] = useState<Record<string, ExamMark>>({})
  const [markingAt, setMarkingAt] = useState('')
  const [startedAt, setStartedAt] = useState(0)
  useStudying('view', phase === 'sitting' ? { pose: 'stopwatch', label: `Exam: ${topic}`, until: options.minutes > 0 ? startedAt + options.minutes * 60_000 : undefined } : phase === 'marking' ? { pose: 'reading', label: `Marking: ${topic}` } : phase === 'writing' ? { pose: 'writing', label: `Setting your paper: ${topic}` } : null)
  const [now, setNow] = useState(Date.now())
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [cardsSaved, setCardsSaved] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const attachTo = useRef<string>('')
  const env = { notePath: scope.kind === 'note' || scope.kind === 'pages' ? scope.path : '', filesByName: app.filesByName }
  const md = (s: string) => ({ __html: renderMarkdown(s, env) })

  const write = useCallback(async () => {
    setPhase('writing')
    setError('')
    try {
      const p = await window.tide.exam.generate(scope, topic, options)
      setPaper(p)
      setAnswers({})
      setMarks({})
      setStartedAt(Date.now())
      setPhase('sitting')
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setPhase('error')
    }
  }, [scope, topic, options])

  useEffect(() => {
    // Left mid-paper and come back to: the same paper, your answers, the clock still running
    // Moved into a window of its own: the paper, answers and clock come with it
    const saved = view?.kind === 'exam' && view.resume ? { state: view.resume } : ongoingKey ? getOngoing(ongoingKey) : undefined
    if (saved) {
      const st = saved.state as { paper: ExamPaper; answers: Record<string, Answer>; startedAt: number }
      setPaper(st.paper)
      setAnswers(st.answers)
      setStartedAt(st.startedAt)
      setPhase('sitting')
      return
    }
    write()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [write])
  // Moved to its own window: this one mustn't keep a copy as unfinished
  const moved = useRef(false)
  const keepRef = useRef({ phase, paper, answers, startedAt })
  keepRef.current = { phase, paper, answers, startedAt }
  // The same paper and clock in a window of its own, or back (lib/popout)
  usePopOutSurface({
    name: `Exam: ${topic}`,
    view: () => {
      const k = keepRef.current
      return k.phase === 'sitting' && k.paper ? { kind: 'exam', scope, topic, options, nonce: view?.kind === 'exam' ? view.nonce : undefined, resume: { paper: k.paper, answers: k.answers, startedAt: k.startedAt } } : null
    },
    handedOver: () => {
      if (ongoingKey) endOngoing(ongoingKey)
      moved.current = true
    }
  })
  useEffect(() => {
    if (ongoingKey && (phase === 'marking' || phase === 'results')) endOngoing(ongoingKey)
  }, [phase, ongoingKey])
  // Your answers are saved to disk as you write them, so quitting Tide mid-paper loses nothing
  useEffect(() => {
    if (ongoingKey && view && phase === 'sitting' && paper && !moved.current) keepLive({ key: ongoingKey, view, title: `Exam: ${topic}`, state: { paper, answers, startedAt }, busy: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paper, answers, startedAt, ongoingKey])
  useEffect(
    () => () => {
      const k = keepRef.current
      if (ongoingKey && view && k.phase === 'sitting' && k.paper && !moved.current) saveOngoing({ key: ongoingKey, view, title: `Exam: ${topic}`, state: { paper: k.paper, answers: k.answers, startedAt: k.startedAt }, busy: false })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ongoingKey]
  )

  useEffect(() => {
    if (phase !== 'sitting') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [phase])

  const total = useMemo(() => paper?.questions.reduce((n, q) => n + q.parts.reduce((m, p) => m + p.marks, 0), 0) ?? 0, [paper])
  const left = startedAt + options.minutes * 60_000 - now
  const timeUp = options.minutes > 0 && left <= 0

  const setAnswer = (k: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [k]: { ...{ text: '', images: [] }, ...a[k], ...patch } }))

  const addImages = async (k: string, files: File[]) => {
    const urls = (await Promise.all(files.filter((f) => f.type.startsWith('image/') || isHeic(f)).map((f) => shrink(f).catch(() => '')))).filter(Boolean)
    if (urls.length) setAnswers((a) => ({ ...a, [k]: { text: a[k]?.text ?? '', images: [...(a[k]?.images ?? []), ...urls] } }))
  }

  const handIn = async () => {
    if (!paper) return
    setPhase('marking')
    const result: Record<string, ExamMark> = {}
    for (const q of paper.questions) {
      for (let i = 0; i < q.parts.length; i++) {
        const k = key(q.number, i)
        setMarkingAt(`${q.number}(${q.parts[i].label})`)
        const a = answers[k] ?? { text: '', images: [] }
        if (!a.text.trim() && !a.images.length) {
          result[k] = { awarded: 0, marks: q.parts[i].marks, feedback: 'No answer given.', missed: '' }
        } else {
          try {
            result[k] = await window.tide.exam.mark(q, i, a.text, a.images)
          } catch (e) {
            result[k] = { awarded: 0, marks: q.parts[i].marks, feedback: `Couldn't mark this part: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, missed: '' }
          }
        }
        setMarks({ ...result })
        const r = result[k]
        window.tide.learn.recordAttempt({
          path: scope.kind === 'note' || scope.kind === 'pages' ? scope.path : undefined,
          topic,
          mode: 'quiz',
          verdict: r.awarded >= r.marks ? 'correct' : r.awarded === 0 ? 'wrong' : 'partial',
          score: r.marks ? r.awarded / r.marks : 0,
          question: q.parts[i].text.slice(0, 300)
        })
      }
    }
    setPhase('results')
    // Lost marks go in the mistake journal, with what would have earned them
    const missed = paper.questions.flatMap((q) =>
      q.parts.flatMap((p, i) => {
        const r = result[key(q.number, i)]
        const a = answers[key(q.number, i)]
        if (!r || r.awarded >= r.marks || r.feedback.startsWith("Couldn't mark")) return []
        const stem = q.text.trim() && q.parts.length > 1 ? `${q.text.trim().slice(0, 400)}\n\n` : q.parts.length === 1 && q.text.trim() !== p.text.trim() ? `${q.text.trim().slice(0, 400)}\n\n` : ''
        return [{ topic, path: scope.kind === 'note' || scope.kind === 'pages' || scope.kind === 'folder' ? scope.path : undefined, source: options.style === 'problems' ? ('take-home' as const) : ('exam' as const), question: `${stem}${p.text}`, answer: a?.text, fix: r.missed || r.feedback }]
      })
    )
    if (missed.length) window.tide.mistakes.add(missed).catch(() => {})
    finishAgendaItem(topic)
    setSavedPath(await saveToNotes(result))
  }

  const saveToNotes = async (result: Record<string, ExamMark>) => {
    if (!paper) return null
    const date = new Date().toISOString().slice(0, 10)
    const safe = topic.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim().slice(0, 60) || 'Exam'
    const base = `Exams/${safe} ${date}`
    const got = Object.values(result).reduce((n, m) => n + m.awarded, 0)
    let body = `---\ntitle: "${paper.title.replace(/"/g, "'")}"\nsource_type: exam\nscore: "${got}/${total}"\nsat: ${date}\ntags:\n  - exam\n---\n\n# ${paper.title}\n\n**${got} / ${total} marks (${Math.round((got / Math.max(1, total)) * 100)}%)**, ${options.minutes} minutes.\n\n`
    for (const q of paper.questions) {
      body += `## Question ${q.number}\n\n${q.text ? q.text + '\n\n' : ''}`
      for (let i = 0; i < q.parts.length; i++) {
        const p = q.parts[i]
        const a = answers[key(q.number, i)]
        const m = result[key(q.number, i)]
        body += `### (${p.label}) [${p.marks}]\n\n${p.text}\n\n**My answer:**\n\n${a?.text.trim() || (a?.images.length ? '' : '_No answer_')}\n\n`
        for (let j = 0; j < (a?.images.length ?? 0); j++) {
          const img = `${base} images/q${q.number}${p.label}-${j + 1}.jpg`
          await window.tide.vault.writeImage(img, a!.images[j])
          body += `![[${img.split('/').pop()}]]\n\n`
        }
        body += `> [!${m.awarded >= m.marks ? 'success' : m.awarded === 0 ? 'failure' : 'warning'}] ${m.awarded} / ${m.marks}\n> ${m.feedback.replace(/\n/g, '\n> ')}\n\n<details><summary>Mark scheme</summary>\n\n${p.scheme}\n\n</details>\n\n`
      }
    }
    const path = `${base}.md`
    await window.tide.vault.write(path, body)
    await app.refreshTree()
    return path
  }

  const saveMissedCards = async () => {
    if (!paper) return
    const cards = paper.questions.flatMap((q) => q.parts.map((p, i) => ({ p, m: marks[key(q.number, i)] }))).filter(({ m }) => m && m.missed && m.awarded < m.marks).map(({ p, m }) => ({ front: p.text.slice(0, 300), back: m.missed }))
    if (!cards.length) return
    await window.tide.study.saveCards(savedPath ?? `Exams/${topic}.md`, cardsToMarkdown(cards))
    setCardsSaved(true)
    await app.refreshTree()
  }

  const got = Object.values(marks).reduce((n, m) => n + m.awarded, 0)

  return (
    <div className="doc-view exam">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb">Exam</span>
          <Icon name="chevron" size={11} />
          <span className="crumb current">{paper?.title ?? topic}</span>
        </div>
        <div className="toolbar-actions no-drag">
          {phase === 'sitting' && options.minutes > 0 && (
            <span className={`exam-clock${left < 5 * 60_000 ? ' low' : ''}${timeUp ? ' up' : ''}`} aria-live="polite">
              {timeUp ? "Time's up" : clock(left)}
            </span>
          )}
          {phase === 'sitting' && paper && <PopOutButton />}
          {phase === 'sitting' && (
            <button className="btn primary small" onClick={handIn}>
              Hand in
            </button>
          )}
          <button className="tool-btn" onClick={() => app.back()}>
            <Icon name="x" />
            <span>{phase === 'results' ? 'Close' : 'Leave'}</span>
          </button>
        </div>
      </header>

      <div className="doc-scroll">
        {(phase === 'writing' || phase === 'sitting') && <PixelScene place="exam-hall" rows={40} scale={3} className="exam-scene" />}
        <div className="exam-paper">
          {phase === 'writing' && (
            <div className="exam-status">
              <span className="spinner" />
              <div>
                <p>Writing your exam paper on {topic}…</p>
                <p className="muted small">Writing your paper. This can take a minute.</p>
              </div>
            </div>
          )}
          {phase === 'error' && (
            <div className="chat-error">
              <p>{error}</p>
              <button className="link-btn" onClick={write}>
                Try again
              </button>
            </div>
          )}

          {paper && phase !== 'writing' && (
            <>
              <header className="exam-head">
                <h1>{paper.title}</h1>
                <p className="exam-meta">
                  {total} marks{options.minutes > 0 ? `, ${options.minutes} minutes` : ''}
                  {phase === 'results' && (
                    <>
                      . You scored <strong>{got}</strong> ({Math.round((got / Math.max(1, total)) * 100)}%).
                    </>
                  )}
                </p>
                <p className="exam-instructions">{paper.instructions} You can type, or paste a photo of your handwritten working (⌘V) into any answer.</p>
              </header>

              {paper.questions.map((q) => {
                const qMarks = q.parts.reduce((n, p) => n + p.marks, 0)
                return (
                  <section key={q.number} className="exam-q">
                    <h2>
                      <span>Question {q.number}</span>
                      <span className="exam-marks">[{qMarks} marks]</span>
                    </h2>
                    {q.text && <div className="prose" dangerouslySetInnerHTML={md(q.text)} />}
                    {q.parts.map((p, i) => {
                      const k = key(q.number, i)
                      const a = answers[k]
                      const m = marks[k]
                      return (
                        <div key={k} className="exam-part">
                          <div className="exam-part-q">
                            <span className="exam-label">({p.label})</span>
                            <div className="prose" dangerouslySetInnerHTML={md(p.text)} />
                            <span className="exam-marks">[{p.marks}]</span>
                          </div>
                          {phase === 'sitting' ? (
                            <div className="exam-answer" onPaste={(e) => {
                              const files = [...e.clipboardData.files]
                              if (files.some((f) => f.type.startsWith('image/') || isHeic(f))) {
                                e.preventDefault()
                                addImages(k, files)
                              }
                            }}>
                              <textarea
                                value={a?.text ?? ''}
                                onChange={(e) => setAnswer(k, { text: e.target.value })}
                                rows={4}
                                placeholder="Your answer, with working"
                              />
                              <div className="exam-photos">
                                {(a?.images ?? []).map((src, j) => (
                                  <div key={j} className="exam-photo">
                                    <img src={src} alt={`Photo ${j + 1} of your working`} />
                                    <button className="icon-btn small" title="Remove photo" onClick={() => setAnswer(k, { images: a!.images.filter((_, x) => x !== j) })}>
                                      <Icon name="x" size={12} />
                                    </button>
                                  </div>
                                ))}
                                <button
                                  className="exam-add-photo"
                                  onClick={() => {
                                    attachTo.current = k
                                    fileInput.current?.click()
                                  }}
                                >
                                  <Icon name="image" size={14} />
                                  Add photo
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="exam-marked">
                              {(a?.text.trim() || a?.images.length) ? (
                                <div className="exam-your">
                                  {a?.text.trim() && <p>{a.text}</p>}
                                  {a?.images.map((src, j) => <img key={j} src={src} alt={`Your working, photo ${j + 1}`} />)}
                                </div>
                              ) : (
                                <p className="muted small">No answer</p>
                              )}
                              {m ? (
                                <div className={`exam-feedback ${m.awarded >= m.marks ? 'full' : m.awarded === 0 ? 'none' : 'some'}`}>
                                  <span className="exam-score">
                                    {m.awarded} / {m.marks}
                                  </span>
                                  <div className="prose compact" dangerouslySetInnerHTML={md(m.feedback)} />
                                  <details>
                                    <summary>Mark scheme</summary>
                                    <div className="prose compact" dangerouslySetInnerHTML={md(p.scheme)} />
                                  </details>
                                </div>
                              ) : (
                                phase === 'marking' && <p className="muted small">Waiting to be marked…</p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </section>
                )
              })}

              {phase === 'marking' && (
                <div className="exam-status sticky">
                  <span className="spinner" />
                  <p>Marking {markingAt}…</p>
                </div>
              )}

              {phase === 'results' && (
                <div className="row-gap exam-actions">
                  {savedPath && (
                    <button className="btn" onClick={() => app.openPath(savedPath)}>
                      <Icon name="note" size={14} />
                      Open the marked paper
                    </button>
                  )}
                  <button className="btn" disabled={cardsSaved} onClick={saveMissedCards}>
                    {cardsSaved ? 'Flashcards saved' : 'Make flashcards from what I missed'}
                  </button>
                  <button className="btn primary" onClick={write}>
                    <Icon name="refresh" size={14} />
                    New paper
                  </button>
                </div>
              )}
              {phase === 'sitting' && (
                <div className="row-gap end exam-actions">
                  <button className="btn primary" onClick={handIn}>
                    Hand in for marking
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addImages(attachTo.current, [...e.target.files])
          e.target.value = ''
        }}
      />
    </div>
  )
}
