import { useEffect, useRef, useState } from 'react'
import type { ChatScope } from '@shared/types'
import { addTakeaways, learnerText, newLessonNote } from '@shared/lessonNotes'
import { useApp } from '../state'
import { Editor } from './Editor'
import { Icon } from './Icon'

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

/** The note a lesson writes to: the topic's own note if there is one, otherwise a new one in the notebook */
function notePathFor(files: { path: string; name: string; kind?: string }[], topic: string, scope: ChatScope): { path: string; exists: boolean } {
  if (scope.kind === 'note' && /\.md$/i.test(scope.path)) return { path: scope.path, exists: true }
  const want = fileSafe(topic).toLowerCase()
  const found = files.find((f) => f.kind === 'note' && f.name.replace(/\.md$/i, '').toLowerCase() === want)
  if (found) return { path: found.path, exists: true }
  const folder = scope.kind === 'folder' ? scope.path : 'Lessons'
  return { path: `${folder}/${fileSafe(topic) || 'Lesson'}.md`, exists: false }
}

/**
 * The lesson's note, beside the lesson: the tutor's takeaways land under "From the lesson" as it
 * teaches, and you write under "In my words". Saved as an ordinary note, created on first use.
 */
export function LessonNotes({ topic, scope, takeaways, onCheck, busy, mineRef }: { topic: string; scope: ChatScope; takeaways: string[]; onCheck(mine: string): void; busy: boolean; mineRef?: { current: string } }) {
  const app = useApp()
  const [{ path, exists }] = useState(() => notePathFor(app.files, topic, scope))
  const [text, setText] = useState<string | null>(null)
  const created = useRef(exists)
  const latest = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    let live = true
    ;(exists ? window.tide.vault.read(path) : Promise.resolve(newLessonNote(topic)))
      .then((t) => {
        if (!live) return
        latest.current = t
        setText(t)
      })
      .catch(() => live && setText(newLessonNote(topic)))
    return () => {
      live = false
    }
  }, [path, exists, topic])

  const save = async (t: string) => {
    latest.current = t
    await window.tide.vault.write(path, t)
    if (!created.current) {
      created.current = true
      app.refreshTree()
    }
  }

  // New takeaways from the tutor go into the note as they arrive
  useEffect(() => {
    if (text === null || !takeaways.length) return
    const next = addTakeaways(latest.current, takeaways)
    if (next !== latest.current) {
      setText(next)
      save(next).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeaways.join('\u0000'), text === null])

  const edit = (t: string) => {
    latest.current = t
    setText(t)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(t).catch(() => {}), 600)
  }
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // Everything you wrote, so the tutor can review it whenever you ask
  const mine = text ? learnerText(text) : ''
  if (mineRef) mineRef.current = mine
  return (
    <aside className="lesson-notes" aria-label="Your notes for this lesson">
      <div className="lesson-notes-head">
        <span className="lesson-notes-title">Notes</span>
        <button className="icon-btn small" onClick={() => app.openPath(path)} title={`Open ${path}`} disabled={!created.current && !takeaways.length}>
          <Icon name="external" size={13} />
        </button>
      </div>
      <p className="muted small lesson-notes-hint">Key ideas land here as you learn. Write your own anywhere, and ask the tutor to review them.</p>
      <div className="lesson-notes-editor">{text !== null && <Editor value={text} onChange={edit} />}</div>
      <div className="lesson-notes-foot">
        <button className="btn small" disabled={busy || mine.length < 20} onClick={() => onCheck(mine)} title="The tutor reads what you wrote and says what's right, what to fix and why">
          Review my notes
        </button>
      </div>
    </aside>
  )
}
