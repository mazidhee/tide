import { useEffect, useMemo, useState } from 'react'
import { isScene, paletteFor, professorFrame, SPEED, type ProfessorPose } from '@shared/professorArt'
import type { CharacterId } from '@shared/characters'
import { useCharacter } from '../state'

export type { ProfessorPose, ProfessorScene, ProfessorState } from '@shared/professorArt'

/**
 * Tide's tutor as a little pixel-art professor (drawn in shared/professorArt). He acts out what the
 * tutor is doing, or a quiet scene (tea, the chalkboard, fishing, chess). Drawn as squares, so he
 * stays crisp at any size; still when the system asks for reduced motion.
 */
export function Professor({ state = 'idle', size = 28, title, character }: { state?: ProfessorPose; size?: number; title?: string; character?: CharacterId }) {
  const chosen = useCharacter()
  const who = character ?? chosen
  const colours = paletteFor(who)
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const [tick, setTick] = useState(0)
  const [blink, setBlink] = useState(false)

  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => setTick((n) => n + 1), SPEED[state])
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
  const rects: React.ReactElement[] = []
  g.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v !== '.') rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={colours[v]} />)
    })
  )
  // A scene is wider than he is: same height, more room beside him
  return (
    <svg className={`professor p-${state}${isScene(state) ? ' p-scene' : ''}`} width={(size * w) / 16} height={size} viewBox={`0 0 ${w} 16`} shapeRendering="crispEdges" role="img" aria-label={title ?? 'Tide'}>
      {rects}
    </svg>
  )
}
