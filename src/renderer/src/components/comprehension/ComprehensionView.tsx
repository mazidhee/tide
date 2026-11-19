import { useEffect, useRef, useState } from 'react'
import { resultLine, STEP_LABEL, type CompLesson } from '@shared/comprehension'
import { WEB_SITE_IDS, WEB_SITES, type WebSite } from '@shared/compWeb'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { ComprehensionLesson } from './ComprehensionLesson'
import { lastSite, rememberSite, SITE_SHORT } from './sites'
import { SiteMark } from './Credit'
import '../../styles/writing.css'
import '../../styles/comprehension.css'

/**
 * Comprehension (Learn › Comprehension): the next passage of the book you're reading, a fresh
 * text from Wikipedia, Project Gutenberg or arXiv on what you're studying (quoted exactly and
 * credited), a lesson left part-way, and the lessons done. A lesson opens in place
 * (ComprehensionLesson).
 */

type Next = Awaited<ReturnType<typeof window.tide.comprehension.next>>

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const day = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

type Fresh = { site: WebSite; topic: string; nonce: number }

export function ComprehensionView({ lesson, fresh }: { lesson?: string; fresh?: Fresh }) {
  if (lesson) return <ComprehensionLesson key={lesson} id={lesson} />
  return <ComprehensionHome fresh={fresh} />
}

function ComprehensionHome({ fresh }: { fresh?: Fresh }) {
  const app = useApp()
  const [next, setNext] = useState<Next | null>(null)
  const [lessons, setLessons] = useState<CompLesson[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [site, setSite] = useState<WebSite>(() => fresh?.site ?? lastSite())
  const [topic, setTopic] = useState(fresh?.topic ?? '')
  const [finding, setFinding] = useState('')
  const [miss, setMiss] = useState('')
  const asked = useRef(false)

  useEffect(() => {
    let live = true
    if (!fresh?.topic)
      window.tide.comprehension
        .webTopic()
        .then((t) => live && t.topic && setTopic((x) => x || t.topic!))
        .catch(() => {})
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

  /** A passage from the web: found, checked word for word, and opened; or why not, said here */
  const find = async (s = site, t = topic) => {
    if (!t.trim() || finding) return
    rememberSite(s)
    setMiss('')
    setFinding(`Looking in ${WEB_SITES[s].name} for a passage on ${t.trim()}…`)
    try {
      const l = await window.tide.comprehension.start({
        from: 'web',
        site: s,
        topic: t.trim()
      })
      app.setView({ kind: 'comprehension', lesson: l.id })
    } catch (e) {
      setMiss(clean(e))
      setFinding('')
    }
  }

  // Asked for from Learn: look at once
  useEffect(() => {
    if (fresh?.topic && !asked.current) {
      asked.current = true
      void find(fresh.site, fresh.topic)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh])

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

        <section className="cp-fresh" aria-label="A fresh text">
          <h2 className="section-title">A fresh text</h2>
          <p className="cp-fresh-lede">A passage near what you’re studying, quoted exactly from the source and credited.</p>
          <div className="cp-fresh-card" aria-busy={!!finding}>
            <label className="cp-fresh-topic">
              <span>On</span>
              <input
                value={topic}
                placeholder="a topic, e.g. payment settlement"
                disabled={!!finding}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void find()
                }}
                aria-label="Topic"
              />
            </label>
            <div className="cp-fresh-sites" role="radiogroup" aria-label="From">
              {WEB_SITE_IDS.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={site === s} disabled={!!finding} onClick={() => setSite(s)}>
                  <SiteMark site={s} />
                  <span className="cp-fresh-site-name">{SITE_SHORT[s]}</span>
                  <span className="cp-fresh-site-what">
                    {WEB_SITES[s].what}
                    {s === 'gutenberg' ? ' (USA)' : `, ${WEB_SITES[s].licence.replace(' (arXiv’s metadata)', '')}`}
                  </span>
                </button>
              ))}
            </div>
            <div className="cp-fresh-go">
              <span className={`cp-fresh-status${miss ? ' miss' : ''}`} role="status">
                {finding || miss}
              </span>
              <button className="btn primary" disabled={!topic.trim() || !!finding} onClick={() => void find()}>
                {finding ? 'Looking…' : 'Find a passage'}
              </button>
            </div>
          </div>
        </section>

        {done.length > 0 && (
          <section className="cp-past">
            <h2 className="section-title">Done</h2>
            <ul>
              {done.slice(0, 12).map((l) => (
                <li key={l.id}>
                  <button onClick={() => app.setView({ kind: 'comprehension', lesson: l.id })}>
                    <span className="cp-past-title">
                      {l.source.web && <SiteMark site={l.source.web.site} />}
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
