import { useEffect, useMemo, useState } from 'react'
import { motionPaused } from '../lib/motion'
import { isScene, paletteFor, professorFrame, SPEED, type ProfessorPose } from '@shared/professorArt'
import type { CharacterId } from '@shared/characters'
import { useCharacter } from '../state'

export type { ProfessorPose, ProfessorScene, ProfessorState } from '@shared/professorArt'

/**
 * Tide's tutor as a little pixel-art professor (drawn in shared/professorArt). He acts out what the
 * tutor is doing, or a quiet scene (tea, the chalkboard, fishing, chess). Drawn as squares, so he
 * stays crisp at any size; still when the system asks for reduced motion.
 */
/**
 * A frame as SVG squares, a run of one colour in a row as one rect. Kept per frame: he re-renders
 * on a timer, and building a React element per square every tick cost 0.4-0.5 s a lesson turn.
 */
const frames = new Map<string, string>()
function drawn(g: ArrayLike<ArrayLike<string>>, colours: Record<string, string>): string {
  const rows = Array.from(g, (r) => Array.from(r).join(''))
  const key = `${JSON.stringify(colours)}|${rows.join('/')}`
  const had = frames.get(key)
  if (had !== undefined) return had
  let out = ''
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const v = row[x]
      let end = x + 1
      while (end < row.length && row[end] === v) end++
      if (v !== '.') out += `<rect x="${x}" y="${y}" width="${end - x + 0.02}" height="1.02" fill="${colours[v]}"/>`
      x = end
    }
  })
  if (frames.size > 400) frames.delete(frames.keys().next().value!)
  frames.set(key, out)
  return out
}

export function Professor({ state = 'idle', size = 28, title, character }: { state?: ProfessorPose; size?: number; title?: string; character?: CharacterId }) {
  const chosen = useCharacter()
  const who = character ?? chosen
  const colours = paletteFor(who)
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const [tick, setTick] = useState(0)
  const [blink, setBlink] = useState(false)

  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => !motionPaused() && setTick((n) => n + 1), SPEED[state])
    return () => clearInterval(t)
  }, [state, reduced])

  // Blinks come at a natural, irregular rhythm
  useEffect(() => {
    if (reduced || state === 'happy') return
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      timer = setTimeout(() => {
        setBlink(true)
        timer = setTimeout(() => {
          setBlink(false)
          next()
        }, 130)
      }, 2400 + Math.random() * 3200)
    }
    next()
    return () => clearTimeout(timer)
  }, [state, reduced])

  const g = professorFrame(state, reduced ? 0 : tick, !reduced && blink, who)
  const w = g[0].length
  const squares = drawn(g, colours)
  // A scene is wider than he is: same height, more room beside him
  return (
    <svg className={`professor p-${state}${isScene(state) ? ' p-scene' : ''}`} width={(size * w) / 16} height={size} viewBox={`0 0 ${w} 16`} shapeRendering="crispEdges" role="img" aria-label={title ?? 'Tide'}>
      <g dangerouslySetInnerHTML={{ __html: squares }} />
    </svg>
  )
}

/** The tutor's face, still: for small avatars that sit in a list (a lesson thread's replies), with no timer each */
export function ProfessorStill({ size = 18, character }: { size?: number; character?: CharacterId }) {
  const chosen = useCharacter()
  const who = character ?? chosen
  const g = professorFrame('idle', 0, false, who)
  const w = g[0].length
  return (
    <svg className="professor p-idle" width={(size * w) / 16} height={size} viewBox={`0 0 ${w} 16`} shapeRendering="crispEdges" aria-hidden="true">
      <g dangerouslySetInnerHTML={{ __html: drawn(g, paletteFor(who)) }} />
    </svg>
  )
}
