import { useEffect, useState } from 'react'
import { resultLine, STEP_LABEL, type CompLesson } from '@shared/comprehension'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { ComprehensionLesson } from './ComprehensionLesson'
import '../../styles/writing.css'
import '../../styles/comprehension.css'

/**
 * Comprehension (Learn › Comprehension): the next passage of the book you're reading, a lesson
 * left part-way, and the lessons done. A lesson opens in place (ComprehensionLesson).
 */

type Next = Awaited<ReturnType<typeof window.tide.comprehension.next>>

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const day = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function ComprehensionView({ lesson }: { lesson?: string }) {
  if (lesson) return <ComprehensionLesson key={lesson} id={lesson} />
  return <ComprehensionHome />
}

function ComprehensionHome() {
  const app = useApp()
  const [next, setNext] = useState<Next | null>(null)
  const [lessons, setLessons] = useState<CompLesson[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    window.tide.comprehension
      .next()
      .then((n) => live && setNext(n))
      .catch(() => live && setNext({ passage: null, why: 'no-book' }))
    window.tide.comprehension
      .list()
      .then((l) => live && setLessons(l))
      .catch(() => live && setLessons([]))
    return () => {
      live = false
    }
  }, [])

  const start = async () => {
    setBusy(true)
    try {
      const l = await window.tide.comprehension.start({ from: 'book' })
      app.setView({ kind: 'comprehension', lesson: l.id })
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
      setBusy(false)
    }
  }

  const open = (lessons ?? []).filter((l) => l.step !== 'done')
  const done = (lessons ?? []).filter((l) => l.step === 'done')
  const p = next?.passage

  return (
    <div className="page cp-page cp-home">
      <div className="page-inner narrow">
        <h1 className="page-title">Comprehension</h1>
        <p className="cp-lede">Read a passage once, put it away, and say what it says. Tide checks it against the passage’s own words.</p>

        {open.slice(0, 1).map((l) => (
          <button key={l.id} className="cp-next" onClick={() => app.setView({ kind: 'comprehension', lesson: l.id })}>
            <span className="cp-next-kicker">Carry on · {STEP_LABEL[l.step]}</span>
            <span className="cp-next-title">
              <i>{l.source.work}</i> · {l.source.label}
            </span>
            <span className="cp-next-go">
              <Icon name="back" size={14} />
            </span>
          </button>
        ))}

        {next &&
          (p ? (
            <div className="cp-next static">
              <span className="cp-next-kicker">Next in your book</span>
              <span className="cp-next-title">
                <i>{p.source.work}</i> · {p.source.label}
              </span>
              <span className="cp-next-meta">
                {p.words} words · about {Math.max(1, Math.round(p.words / 200))} min to read
              </span>
              <button className="btn primary" disabled={busy} onClick={() => void start()}>
                Start
              </button>
            </div>
          ) : (
            <div className="cp-empty">
              <p>{next.why === 'finished' ? 'Every passage in the book you’re reading has been used.' : 'Put a book on your reading shelf, or select a passage in the reader and choose Test my understanding.'}</p>
              <button className="btn small" onClick={() => app.setView({ kind: 'reading' })}>
                Open the reading room
              </button>
            </div>
          ))}

        {done.length > 0 && (
          <section className="cp-past">
            <h2 className="section-title">Done</h2>
            <ul>
              {done.slice(0, 12).map((l) => (
                <li key={l.id}>
                  <button onClick={() => app.setView({ kind: 'comprehension', lesson: l.id })}>
                    <span className="cp-past-title">
                      <i>{l.source.work}</i> · {l.source.label}
                    </span>
                    <span className="cp-past-meta">
                      {day(l.finishedAt ?? l.at)}
                      {l.read?.wpm ? ` · ${l.read.wpm} wpm` : ''}
                      {l.grade ? ` · ${resultLine(l)}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
