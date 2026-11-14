import { useEffect, useRef, useState } from 'react'
import { paletteFor, professorFrame, SPEED, type ProfessorPose } from '@shared/professorArt'
import { motionPaused } from '../../lib/motion'
import { useCharacter } from '../../state'

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * The tutor (shared/professorArt) on a canvas, each pixel scale x scale and kept square. He moves
 * only while `playing` (a hovered or focused card) and holds his first frame otherwise, or always
 * when the system asks for reduced motion.
 */
export function PixelProf({ pose, scale, playing = false, className }: { pose: ProfessorPose; scale: number; playing?: boolean; className?: string }) {
  const character = useCharacter()
  const ref = useRef<HTMLCanvasElement>(null)
  const [tick, setTick] = useState(0)
  const moving = playing && !reducedMotion()

  useEffect(() => {
    if (!moving) {
      setTick(0)
      return
    }
    const t = setInterval(() => !motionPaused() && setTick((n) => n + 1), SPEED[pose])
    return () => clearInterval(t)
  }, [moving, pose])

  const grid = professorFrame(pose, tick, false, character)
  const h = grid.length
  const w = grid[0].length

  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const colours = paletteFor(character)
    ctx.clearRect(0, 0, c.width, c.height)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = grid[y][x]
        if (v === '.' || !colours[v]) continue
        ctx.fillStyle = colours[v]
        ctx.fillRect(x * scale, y * scale, scale, scale)
      }
  })

  return <canvas ref={ref} className={`pxprof${className ? ` ${className}` : ''}`} width={w * scale} height={h * scale} aria-hidden="true" />
}
