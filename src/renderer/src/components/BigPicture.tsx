import { useEffect, useRef, useState } from 'react'
import type { PartRef } from '@shared/types'
import { mountPartScene } from '../lib/visuals'

/**
 * A module part's big picture: one interactive 3D scene of the part's grand idea (main/conceptVisuals,
 * written once by the visual model and kept; Tide's own 2D visual when it can't be shown). At the
 * head of a lesson in that part it opens by itself the first time, and stays a click away after.
 */

const seenKey = (p: PartRef) => `tide.bigPicture.seen.${p.module}#${p.part}`
const wasSeen = (p: PartRef) => {
  try {
    return localStorage.getItem(seenKey(p)) === '1'
  } catch {
    return false
  }
}
const markSeen = (p: PartRef) => {
  try {
    localStorage.setItem(seenKey(p), '1')
  } catch {
    // private window: it simply opens again next time
  }
}

/** The scene itself, mounted while shown */
function Scene({ module, part }: { module: string; part: number }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const m = mountPartScene(host.current, { module, part })
    return () => m.destroy()
  }, [module, part])
  return <div ref={host} />
}

/** At the head of a lesson: the big picture of the part its topic is in, if it is in one */
export function LessonBigPicture({ topic }: { topic: string }) {
  const [part, setPart] = useState<PartRef | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    void window.tide.visuals
      .partOf(topic)
      .then((p) => {
        if (!live || !p) return
        setPart(p)
        setOpen(!wasSeen(p))
        markSeen(p)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [topic])
  if (!part) return null
  return (
    <section className="big-picture" aria-label={`The big picture: ${part.title}`}>
      <div className="big-picture-head">
        <h2>The big picture</h2>
        <span className="big-picture-part">
          {part.moduleTitle} · {part.title}
        </span>
        <button className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && <Scene module={part.module} part={part.part} />}
    </section>
  )
}

/** Under a module on its track: each part's big picture, one at a time */
export function ModuleBigPictures({ module }: { module: string }) {
  const [parts, setParts] = useState<{ part: number; title: string; kept: boolean }[]>([])
  const [shown, setShown] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    void window.tide.visuals
      .parts(module)
      .then((p) => live && setParts(p))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [module])
  if (!parts.length) return null
  return (
    <div className="big-picture">
      <div className="big-picture-parts" role="group" aria-label="Each part's big picture">
        {parts.map((p) => (
          <button key={p.part} className="btn" aria-pressed={shown === p.part} onClick={() => setShown((s) => (s === p.part ? null : p.part))} title={p.kept ? 'Drawn and kept' : 'Drawn the first time you open it'}>
            {p.part}. {p.title}
          </button>
        ))}
      </div>
      {shown !== null && <Scene module={module} part={shown} />}
    </div>
  )
}
