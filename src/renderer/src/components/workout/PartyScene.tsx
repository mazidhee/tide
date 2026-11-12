/**
 * The workout's pixel celebrations on a canvas: the Professor in his party hat dancing, confetti
 * and rising balloons for a new title; a quieter scene for a finished morning; balloons for a
 * streak milestone; a trophy on a plinth for a championship win. Tinted from the theme's accent
 * and the Professor's palette. Still (one frame) when the system asks for reduced motion.
 */
import { useEffect, useRef } from 'react'
import { paletteFor, professorFrame } from '@shared/professorArt'
import { motionPaused } from '../../lib/motion'
import { useCharacter } from '../../state'
import { TROPHY } from './pixel'

export type PartyKind = 'party' | 'done' | 'streak' | 'trophy'

const BALLOON = ['..rrr..', '.rrrrr.', 'rrrrrWr', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...', '...o...', '..o....', '...o...', '....o..']
const PLINTH = ['..ffffffffffff..', '.ffffffffffffff.', '.JJJJJJJJJJJJJJ.', '.JJJJJJJJJJJJJJ.', '.JJJJJJJJJJJJJJ.']

/** "#5cc2ae" or "rgb(…)" → [r, g, b] */
function rgbOf(css: string): [number, number, number] {
  const c = css.trim()
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).replace(/./g, (x) => x + x) : c.slice(1, 7)
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  }
  const m = c.match(/[\d.]+/g)
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [92, 194, 174]
}
const mix = ([r, g, b]: [number, number, number], [r2, g2, b2]: [number, number, number], t: number) => `rgb(${Math.round(r + (r2 - r) * t)}, ${Math.round(g + (g2 - g) * t)}, ${Math.round(b + (b2 - b) * t)})`

export function PartyScene({ kind, height = 300, className }: { kind: PartyKind; height?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const character = useCharacter()

  useEffect(() => {
    const el = canvas.current
    const wrap = box.current
    if (!el || !wrap) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const S = 5
    const W = Math.max(40, Math.floor(wrap.clientWidth / S))
    const H = Math.max(30, Math.floor(height / S))
    el.width = W
    el.height = H
    const css = getComputedStyle(document.documentElement)
    const accent = rgbOf(css.getPropertyValue('--accent') || '#5cc2ae')
    const ink = rgbOf(css.getPropertyValue('--ink') || '#e6e7e9')
    const bg = rgbOf(css.getPropertyValue('--bg-inset') || '#16181a')
    const pal = paletteFor(character)
    const shades = [mix(accent, [255, 255, 255], 0), mix(accent, [255, 255, 255], 0.35), mix(accent, [0, 0, 0], 0.3), mix(accent, ink, 0.5)]
    const colours = [...shades, ...shades, pal.Y, pal.c]
    const balloonColours = [shades[0], shades[1], shades[2], shades[0], pal.Y, shades[1]]
    const floor = mix(bg, ink, 0.12)
    const seeded = (n: number) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
      return x - Math.floor(x)
    }
    const nBalloons = kind === 'party' ? 9 : kind === 'streak' ? 7 : kind === 'trophy' ? 4 : 0
    const nConfetti = kind === 'party' ? 90 : kind === 'trophy' ? 70 : kind === 'streak' ? 50 : 26
    const balloons = Array.from({ length: nBalloons }, (_, i) => ({
      x: 4 + (i * (W - 12)) / Math.max(1, nBalloons - 1) + seeded(i) * 3,
      y: reduced ? H * 0.25 + seeded(i + 9) * H * 0.4 : H + seeded(i + 3) * 40,
      v: 0.16 + seeded(i + 5) * 0.14,
      c: balloonColours[i % balloonColours.length],
      sw: seeded(i + 7) * 6
    }))
    const confetti = Array.from({ length: nConfetti }, (_, i) => ({ x: seeded(i + 20) * W, y: reduced ? seeded(i + 40) * H * 0.8 : -seeded(i + 40) * H, v: 0.2 + seeded(i + 60) * 0.35, c: colours[i % colours.length], d: seeded(i + 80) * 6 }))
    const draw = (rows: string[] | string[][], x: number, y: number, fill: (v: string) => string | null) =>
      rows.forEach((r, j) => {
        for (let i = 0; i < r.length; i++) {
          const f = fill(r[i])
          if (!f) continue
          ctx.fillStyle = f
          ctx.fillRect(Math.round(x) + i, Math.round(y) + j, 1, 1)
        }
      })
    let t = 0
    const pose = kind === 'done' ? 'wave' : 'party'
    const tick = () => {
      ctx.clearRect(0, 0, W, H)
      const ground = H - 6
      ctx.fillStyle = floor
      ctx.fillRect(0, ground, W, 1)
      for (const p of confetti) {
        if (!reduced) {
          p.y += p.v
          if (p.y > ground) p.y = -2
        }
        ctx.fillStyle = p.c
        ctx.fillRect(Math.round(p.x + Math.sin((p.y + p.d) / 6) * 2), Math.round(p.y), 1, (t + p.d) % 8 < 4 ? 2 : 1)
      }
      // The trophy on its plinth, glinting
      let px = Math.floor(W / 2 - 12)
      if (kind === 'trophy') {
        const tx = Math.floor(W / 2 - 8)
        draw(PLINTH, tx, ground - 5, (v) => (v === '.' ? null : pal[v]))
        draw(TROPHY, tx + 3, ground - 16, (v) => (v === '.' ? null : pal[v]))
        const glint = Math.floor(t / 8) % 4
        ctx.fillStyle = '#ffffff'
        if (!reduced || glint === 0) ctx.fillRect(tx + 5 + glint, ground - 14, 1, 1)
        px = tx - 26
      }
      const frame = professorFrame(pose, reduced ? 0 : Math.floor(t / 6), false, character)
      draw(
        frame.map((r) => r.join('')),
        px,
        ground - 16,
        (v) => (v === '.' ? null : pal[v])
      )
      for (const b of balloons) {
        if (!reduced) {
          b.y -= b.v
          if (b.y < -14) b.y = H + 4
        }
        draw(BALLOON, b.x + Math.sin(t / 20 + b.sw) * 1.5, b.y, (v) => (v === '.' ? null : v === 'r' ? b.c : v === 'W' ? 'rgba(255,255,255,0.85)' : mix(bg, ink, 0.45)))
      }
      t++
    }
    tick()
    if (reduced) return
    const id = setInterval(() => !motionPaused() && tick(), 40)
    return () => clearInterval(id)
  }, [kind, height, character])

  return (
    <div ref={box} className={`wo-party-canvas${className ? ` ${className}` : ''}`} style={{ height }} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  )
}
