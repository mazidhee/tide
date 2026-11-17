import { useEffect, useRef, useState } from 'react'
import type { ChatScope } from '@shared/types'
import { EditorView } from '@codemirror/view'
import { addTakeaways, createNoteSync, learnerText, lessonItems, newLessonNote, ownWordsEnd, OWN_WORDS_HEADING } from '@shared/lessonNotes'
import { useApp } from '../state'
import { Editor, type EditorHandle } from './Editor'
import { renderMarkdown } from '../lib/markdown'
import { Icon } from './Icon'

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

/** The one writer for lesson notes in this window (shared/lessonNotes createNoteSync) */
const noteSync = createNoteSync({ read: (p) => window.tide.vault.read(p), write: (p, t) => window.tide.vault.write(p, t) })
/** This window's last copy of each note, and whether it was being written in, kept across remounts */
const lastText = new Map<string, string>()
const wasEditing = new Map<string, boolean>()

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
  // Shown at once from this window's last copy when the panel comes back (tab switches remount it)
  const [text, setText] = useState<string | null>(() => lastText.get(path) ?? null)
  // Read as it will look (Markdown and maths drawn, as in the lesson); written in the editor
  const [editing, setEditingState] = useState(() => wasEditing.get(path) ?? false)
  const setEditing = (e: boolean | ((x: boolean) => boolean)) =>
    setEditingState((x) => {
      const v = typeof e === 'function' ? e(x) : e
      wasEditing.set(path, v)
      return v
    })
  const created = useRef(exists)
  const latest = useRef(lastText.get(path) ?? '')
  // Typed here since the last write: then this copy is the newest and the file only adds takeaways
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const editor = useRef<EditorHandle | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)

  const adopt = (t: string) => {
    latest.current = t
    lastText.set(path, t)
    setText(t)
  }

  useEffect(() => {
    let live = true
    ;(exists || created.current ? noteSync.read(path) : Promise.resolve(newLessonNote(topic)))
      .then((t) => {
        // Never replace what was typed here and not yet written
        if (live && !dirty.current) adopt(t)
      })
      .catch(() => live && latest.current === '' && adopt(newLessonNote(topic)))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, exists, topic])

  /** Writes the live text through the single writer, then takes in anything the file added */
  const flush = () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    if (!latest.current) return Promise.resolve()
    const sent = latest.current
    const wasDirty = dirty.current
    dirty.current = false
    return noteSync
      .write(path, sent, wasDirty)
      .then((out) => {
        if (!created.current) {
          created.current = true
          app.refreshTree()
        }
        if (out === sent) return
        // The file had takeaways (or newer words) this copy didn't: merge them into the live text
        if (latest.current === sent) adopt(out)
        else adopt(addTakeaways(latest.current, lessonItems(out)))
      })
      .catch(() => {
        dirty.current = dirty.current || wasDirty
      })
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  // New takeaways from the tutor go into the live note (never into the file behind the editor)
  useEffect(() => {
    if (text === null || !takeaways.length) return
    const next = addTakeaways(latest.current, takeaways)
    if (next !== latest.current) {
      adopt(next)
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeaways.join('\u0000'), text === null])

  const edit = (t: string) => {
    if (t === latest.current) return
    latest.current = t
    lastText.set(path, t)
    dirty.current = true
    setText(t)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flushRef.current(), 600)
  }
  // Written now when the panel goes (tab switch, end of lesson) or the window loses focus, never dropped
  useEffect(() => {
    const now = () => {
      if (dirty.current || saveTimer.current) void flushRef.current()
    }
    window.addEventListener('blur', now)
    window.addEventListener('beforeunload', now)
    return () => {
      window.removeEventListener('blur', now)
      window.removeEventListener('beforeunload', now)
      now()
    }
  }, [])

  // The caret goes to the end of your own words, scrolled into view, whenever the editor opens
  useEffect(() => {
    if (!editing || text === null) return
    const v = editor.current?.view()
    if (!v) return
    const at = Math.min(ownWordsEnd(v.state.doc.toString()), v.state.doc.length)
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
    v.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, text === null])
  // Reading: opens at your own words, not at the top
  useEffect(() => {
    if (editing || text === null) return
    const box = viewRef.current
    const own = [...(box?.querySelectorAll('h2') ?? [])].find((h) => h.textContent?.trim() === OWN_WORDS_HEADING.replace(/^##\s*/, ''))
    const pane = box?.closest('.lesson-notes-editor')
    if (own && pane) pane.scrollTop = Math.max(0, own.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, text === null])

  // Everything you wrote, so the tutor can review it whenever you ask
  const mine = text ? learnerText(text) : ''
  if (mineRef) mineRef.current = mine
  return (
    <aside className="lesson-notes" aria-label="Your notes for this lesson">
      <div className="lesson-notes-head">
        <span className="lesson-notes-title">Notes</span>
        <span className="lesson-notes-actions">
        <button className="btn small ghost" onClick={() => setEditing((e) => !e)} disabled={text === null}>
          {editing ? 'Done' : 'Edit'}
        </button>
        <button className="icon-btn small" onClick={() => app.openPath(path)} title={`Open ${path}`} disabled={!created.current && !takeaways.length}>
          <Icon name="external" size={13} />
        </button>
        </span>
      </div>
      <p className="muted small lesson-notes-hint">Key ideas land here as you learn. Write your own anywhere, and ask the tutor to review them.</p>
      <div className="lesson-notes-editor">
        {text !== null &&
          (editing ? (
            <Editor value={text} onChange={edit} notePath={path} handleRef={editor} />
          ) : (
            <div
              ref={viewRef}
              className="prose compact lesson-notes-view"
              title="Click to write in your notes"
              onClick={(e) => !(e.target as HTMLElement).closest('a, button, input') && setEditing(true)}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { notePath: path, filesByName: app.filesByName }) }}
            />
          ))}
      </div>
      <div className="lesson-notes-foot">
        <button className="btn small" disabled={busy || mine.length < 20} onClick={() => onCheck(mine)} title="The tutor reads what you wrote and says what's right, what to fix and why">
          Review my notes
        </button>
      </div>
    </aside>
  )
}
