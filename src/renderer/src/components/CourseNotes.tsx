/**
 * Your notes beside a course lesson (shared/courseNotes): one note per course in your vault, a
 * heading per lesson made the first time you write, written in Tide's own editor with Markdown
 * drawn as you type. A passage selected in the lesson comes in as a quote with a link back; on a
 * lesson with a video, the moment you're at goes in as a link that plays the video from there. The
 * tutor beside the lesson reads what you wrote (lib/onScreen).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { appendBlock, courseNotesPath, lessonNotes, momentLink, newCourseNotes, quoteFor, withLessonNotes, type NotesLesson } from '@shared/courseNotes'
import { formatTime } from '@shared/video'
import { Editor, type EditorHandle } from './Editor'
import { Icon } from './Icon'
import { useApp } from '../state'
import { currentPlayer, playerFor } from '../lib/videoHub'
import { screenPartChanged, setScreenPart } from '../lib/onScreen'

export interface NotesQuote {
  text: string
  label: string
  url?: string
  /** A new one each time, so the same passage can be quoted twice */
  nonce: number
}

const SAVE_MS = 500

export function CourseNotes({
  course,
  lesson,
  video,
  quote,
  onClose,
  onQuoted,
  focusOnOpen
}: {
  course: { id: string; title: string; by?: string; url?: string }
  lesson: NotesLesson
  /** The lesson's video playing beside it, if any (its YouTube id) */
  video?: string
  quote?: NotesQuote | null
  onClose(): void
  /** The quote is in: it's not to be put in again (the panel is drawn afresh with each lesson) */
  onQuoted?(): void
  focusOnOpen?: boolean
}) {
  const app = useApp()
  const path = courseNotesPath(course.title)
  const [body, setBody] = useState<string | null>(null)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const bodyRef = useRef('')
  const lessonRef = useRef(lesson)
  lessonRef.current = lesson
  const pending = useRef<{ lesson: NotesLesson; body: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const editor = useRef<EditorHandle | null>(null)
  const exists = useRef(false)

  // Written into the note as it is on disk now, so an edit made elsewhere in it is never lost
  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const p = pending.current
    if (!p) return
    pending.current = null
    setSaved('saving')
    try {
      const disk = await window.tide.vault.read(path).catch(() => null)
      const base = disk ?? newCourseNotes(course)
      const next = withLessonNotes(base, p.lesson, p.body)
      if (next !== disk) await window.tide.vault.write(path, next)
      if (disk === null && next !== base) {
        exists.current = true
        void app.refreshTree()
      }
      setSaved('saved')
    } catch {
      setSaved('failed')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Each lesson's part, read when the lesson opens (what's waiting for the last one is written first)
  useEffect(() => {
    let live = true
    setBody(null)
    void (async () => {
      await flush()
      const doc = await window.tide.vault.read(path).catch(() => null)
      exists.current = doc !== null
      if (!live) return
      const b = doc ? lessonNotes(doc, lesson.id) : ''
      bodyRef.current = b
      setBody(b)
      setSaved('idle')
      screenPartChanged()
    })()
    return () => {
      live = false
    }
  }, [path, lesson.id, flush])
  useEffect(() => () => void flush(), [flush])

  const edit = useCallback(
    (b: string) => {
      bodyRef.current = b
      setBody(b)
      pending.current = { lesson: lessonRef.current, body: b }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void flush()
        screenPartChanged()
      }, SAVE_MS)
    },
    [flush]
  )

  // What the tutor sees: your notes on this lesson
  useEffect(() => setScreenPart('notes', () => bodyRef.current), [])

  // A passage quoted from the lesson, at the end of this lesson's notes
  const quoted = useRef(0)
  useEffect(() => {
    if (!quote || body === null || quoted.current === quote.nonce) return
    quoted.current = quote.nonce
    edit(appendBlock(bodyRef.current, quoteFor(quote.text, quote)))
    onQuoted?.()
    setTimeout(() => editor.current?.focus(), 30)
  }, [quote, body, edit]) // eslint-disable-line react-hooks/exhaustive-deps

  // The video's moment, kept current while it plays
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!video) return setNow(null)
    const read = () => {
      const p = currentPlayer()
      setNow(p && p.key === video && p.time ? p.time() : null)
    }
    read()
    const t = setInterval(read, 1000)
    return () => clearInterval(t)
  }, [video])
  const stamp = () => {
    const p = currentPlayer()
    if (!video || !p || p.key !== video || !p.time) return
    editor.current?.insert(`${momentLink(video, p.time())} `)
  }

  return (
    <section className="cn" aria-label="Your notes on this lesson">
      <header className="cn-head">
        <span className="cn-title">
          <Icon name="edit" size={13} />
          Notes
        </span>
        <span className="cn-where" title={`${path} › ${lesson.title}`}>
          {lesson.title}
        </span>
        <span className="cn-gap" />
        {video && (
          <button className="cn-stamp" disabled={now === null} onClick={stamp} title={now === null ? 'Play the video to note a moment of it' : 'Put this moment of the video in your notes (⌘⇧↩)'}>
            <Icon name="timer" size={12} />
            {now === null ? 'Moment' : formatTime(now)}
          </button>
        )}
        <span className={`cn-saved ${saved}`} aria-live="polite">
          {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : saved === 'failed' ? 'Not saved' : ''}
        </span>
        <button className="icon-btn small" onClick={() => void flush().then(() => app.openPath(path))} title={`Open ${path}`} disabled={!exists.current && !bodyRef.current}>
          <Icon name="external" size={13} />
        </button>
        <button className="icon-btn small" onClick={onClose} title="Close the notes (⌘⇧N)" aria-label="Close the notes">
          <Icon name="x" size={13} />
        </button>
      </header>
      <div
        className="cn-body"
        onKeyDownCapture={(e) => {
          if (e.key === 'Enter' && e.metaKey && e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            stamp()
          }
        }}
        onClick={(e) => {
          // Clicking under the text puts the cursor at its end
          if (e.target === e.currentTarget) editor.current?.focus()
        }}
      >
        {body === null ? (
          <div className="cn-loading" aria-busy="true" />
        ) : (
          <>
            {!body && (
              <p className="cn-hint" aria-hidden="true">
                Write as you {video ? 'watch and ' : ''}read. Select a passage in the lesson to quote it{video ? '; ⌘⇧↩ notes the video’s moment' : ''}.
              </p>
            )}
            <Editor
              key={lesson.id}
              value={body}
              onChange={edit}
              notePath={path}
              handleRef={editor}
              noFocus={!focusOnOpen}
              onLink={(href) => {
                const found = playerFor(href)
                if (!found) return false
                found.player.playAt(found.at)
                return true
              }}
            />
          </>
        )}
      </div>
    </section>
  )
}
