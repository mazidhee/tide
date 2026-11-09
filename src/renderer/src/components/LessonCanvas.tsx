import { useCallback, useEffect, useRef, useState } from 'react'
import { parseCanvas, serializeCanvas, type Canvas } from '@shared/canvas'
import { useApp } from '../state'
import { CanvasEditor } from './CanvasEditor'
import { Icon } from './Icon'

/**
 * The canvas beside a walkthrough: the tutor draws the system as it explains it (each component as
 * it appears, each connection in the order things flow), and you can move, add and correct it. It
 * is an ordinary .canvas file, so it stays with the topic for later.
 */
export function LessonCanvas({ path, lessonId }: { path: string; lessonId: string }) {
  const app = useApp()
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [version, setVersion] = useState(0)
  const pending = useRef<Canvas | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const load = useCallback(
    () =>
      window.tide.vault
        .read(path)
        .then((raw) => {
          pending.current = null
          setCanvas(parseCanvas(raw))
          setVersion((v) => v + 1)
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
    if (c) await window.tide.vault.write(path, serializeCanvas(c)).catch(() => {})
  }, [path])
  useEffect(() => () => void flush(), [flush])

  // When the tutor draws in this lesson, show what it drew
  useEffect(() => {
    const drawing = new Set<string>()
    return window.tide.ai.onEvent((e) => {
      if (e.type !== 'step' || !e.id.startsWith(lessonId)) return
      const key = `${e.id}:${e.step.id}`
      if (e.step.kind === 'canvas') drawing.add(key)
      if (e.step.status === 'done' && drawing.has(key)) {
        flush().then(load)
        app.refreshTree()
      }
    })
  }, [load, flush, lessonId, app])

  const change = (next: Canvas) => {
    setCanvas(next)
    pending.current = next
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 500)
  }

  return (
    <aside className="lesson-canvas" aria-label="The lesson's canvas">
      <div className="lesson-notes-head">
        <span className="lesson-notes-title">Canvas</span>
        <button className="icon-btn small" onClick={() => flush().then(() => app.openPath(path))} title={`Open ${path}`}>
          <Icon name="external" size={13} />
        </button>
      </div>
      <div className="lesson-canvas-body">{canvas && <CanvasEditor canvas={canvas} onChange={change} version={version} />}</div>
    </aside>
  )
}
