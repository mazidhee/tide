import { useEffect, useRef } from 'react'

/**
 * A tiny pixel world in a tile (24 × 24 pixels, drawn big): a solar system, a sunrise with birds,
 * a night sky, a sine wave drawing itself, a terminal typing, an atom. The Home banner already has
 * the professor; these give the card next to it something of its own, matched to what's next.
 */
export type MomentScene = 'orbit' | 'sunrise' | 'night' | 'wave' | 'code' | 'atom'

const N = 24

/** A scene for a topic: maths draws a wave, code types, physics spins an atom; else the time of day */
export function sceneFor(topic: string | undefined, hour = new Date().getHours()): MomentScene {
  const t = (topic ?? '').toLowerCase()
  if (/\b(physics|quantum|atom|electron|chemistry|molecule|energy|force|momentum|thermo|relativity|particle|optics)\b/.test(t)) return 'atom'
  if (/\b(code|coding|program|python|javascript|typescript|rust|algorithm|data structure|tree|graph|hash|array|linked list|sql|api|git|linux|terminal|compiler|system design|binary search)/.test(t)) return 'code'
  if (/\b(math|maths|algebra|calculus|derivative|integral|matri|vector|linear|probability|statistic|logarithm|exponent|trig|geometry|equation|function|series|proof|number|eigen)/.test(t)) return 'wave'
  return hour >= 6 && hour < 18 ? 'sunrise' : 'night'
}

type Draw = (px: (x: number, y: number, c: string) => void, rect: (x: number, y: number, w: number, h: number, c: string) => void, t: number) => void

const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const stars = (px: Parameters<Draw>[0], t: number, count: number, colour = '#dfe6ff') => {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand(i) * N)
    const y = Math.floor(rand(i + 50) * N)
    if ((t + i * 7) % 40 < 34) px(x, y, (t + i) % 17 < 2 ? '#ffffff' : colour)
  }
}

/** A faint halo round the moon */
const glowMoon = (px: Parameters<Draw>[0]) => {
  for (const [x, y] of [[1, 8], [2, 4], [2, 12], [5, 2], [5, 14], [9, 2], [9, 14]]) px(x, y, '#2a335c')
}

const SCENES: Record<MomentScene, { bg: string; draw: Draw }> = {
  // Cards come back round like planets: each on its own orbit, at its own pace
  orbit: {
    bg: '#0d1330',
    draw: (px, rect, t) => {
      stars(px, t, 8, '#5d6a9e')
      for (const r of [5, 8, 11])
        for (let a = 0; a < r * 6; a += 2) {
          const ang = (a / (r * 6)) * Math.PI * 2
          px(Math.round(12 + Math.cos(ang) * r), Math.round(12 + Math.sin(ang) * r * 0.62), '#26305a')
        }
      rect(11, 11, 2, 2, '#ffd36b')
      px(10, 11, '#f5a742'), px(13, 12, '#f5a742'), px(11, 10, '#fff1b8'), px(12, 13, '#f08a3c')
      const planets: [number, number, string, number][] = [
        [5, 0.09, '#8fc1e3', 1],
        [8, 0.055, '#e0795b', 2],
        [11, 0.034, '#b7e07a', 2]
      ]
      planets.forEach(([r, speed, c, size], i) => {
        const ang = t * speed + i * 2.1
        const x = Math.round(12 + Math.cos(ang) * r)
        const y = Math.round(12 + Math.sin(ang) * r * 0.62)
        rect(x, y, size, size, c)
      })
    }
  },
  sunrise: {
    bg: '#9fd0ee',
    draw: (px, rect, t) => {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (y > 12) px(x, y, y > 18 ? '#5f9a4f' : '#c9e7f5')
      const sy = 11 - Math.round(Math.sin(t * 0.04) * 1.5)
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9) px(16 + dx, sy + dy, dx * dx + dy * dy <= 4 ? '#ffd36b' : '#ffb84d')
      for (let x = 0; x < N; x++) px(x, 18 - Math.round(Math.sin(x * 0.45) * 1.5), '#76b062')
      rect(0, 19, N, 5, '#5f9a4f')
      // Birds: little V shapes, flapping as they cross
      for (let b = 0; b < 3; b++) {
        const x = ((t * 0.25 + b * 9) % (N + 8)) - 4
        const y = 5 + b * 2 + Math.round(Math.sin(t * 0.2 + b) * 0.6)
        const up = (Math.floor(t / 3) + b) % 2 === 0
        px(Math.round(x), y, '#2e3a4a')
        px(Math.round(x) - 1, y + (up ? -1 : 0), '#2e3a4a')
        px(Math.round(x) + 1, y + (up ? -1 : 0), '#2e3a4a')
      }
      px(4, 3, '#ffffff'), rect(3, 4, 4, 1, '#ffffff'), rect(18, 4, 3, 1, '#eef7fc')
    }
  },
  night: {
    bg: '#141a33',
    draw: (px, rect, t) => {
      stars(px, t, 22)
      // A crescent: the moon's disc with a smaller dark disc taken out of its right side
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const inMoon = dx * dx + dy * dy <= 20
          const inShadow = (dx - 2.4) ** 2 + (dy + 1) ** 2 <= 15
          if (inMoon && !inShadow) px(7 + dx, 8 + dy, dx < -2 ? '#fff7d6' : '#f1e3b0')
        }
      glowMoon(px)
      // A shooting star now and then
      const s = t % 90
      if (s < 10) for (let k = 0; k < 4; k++) px(20 - s * 1.5 + k, 3 + s * 0.8 - k * 0.5, k ? '#9aa6d6' : '#ffffff')
      rect(0, 20, N, 4, '#0b1024')
      for (let x = 0; x < N; x++) px(x, 19 - Math.round(Math.sin(x * 0.6 + 1) * 1.2 + 1), '#0b1024')
    }
  },
  // y = sin x, drawn across the axes, then again
  wave: {
    bg: '#16202b',
    draw: (px, rect, t) => {
      rect(2, 12, 20, 1, '#3b4a5a')
      rect(4, 3, 1, 18, '#3b4a5a')
      px(21, 11, '#3b4a5a'), px(21, 13, '#3b4a5a'), px(3, 4, '#3b4a5a'), px(5, 4, '#3b4a5a')
      const progress = (t % 60) / 40
      const upto = Math.min(17, Math.floor(progress * 17))
      for (let i = 0; i <= upto; i++) {
        const x = 5 + i
        const y = Math.round(12 - Math.sin((i / 17) * Math.PI * 2) * 6)
        px(x, y, i === upto ? '#ffffff' : '#5cc8e8')
      }
      // A dot tracing the curve, with its shadow on the axis
      if (progress < 1.05) {
        const x = 5 + upto
        px(x, 13, '#f4c95d')
      }
      // A tiny "sin" label in the corner
      const S = ['111', '100', '111', '001', '111']
      S.forEach((row, y) => [...row].forEach((c, x) => c === '1' && px(15 + x, 2 + y, '#7f93ad')))
      px(19, 2, '#7f93ad'), rect(19, 4, 1, 3, '#7f93ad')
      rect(21, 4, 1, 3, '#7f93ad'), px(22, 4, '#7f93ad'), rect(23, 5, 1, 2, '#7f93ad')
    }
  },
  // A terminal: lines of code typing out, a blinking cursor
  code: {
    bg: '#0f1412',
    draw: (px, rect, t) => {
      rect(0, 0, N, 3, '#1d2622')
      px(2, 1, '#e5534b'), px(4, 1, '#d4a12b'), px(6, 1, '#34a853')
      const lines: [number, number, string][] = [
        [2, 9, '#c792ea'],
        [4, 12, '#82aaff'],
        [4, 7, '#c3e88d'],
        [6, 10, '#f78c6c'],
        [4, 5, '#c3e88d'],
        [2, 6, '#c792ea']
      ]
      const total = lines.reduce((n, [, w]) => n + w, 0)
      let typed = Math.floor(t * 0.6) % (total + 12)
      lines.forEach(([indent, width, colour], i) => {
        const y = 5 + i * 3
        const w = Math.max(0, Math.min(width, typed))
        typed -= width
        if (w) rect(indent, y, w, 1, colour)
        if (typed < 0 && typed > -width - 1 && Math.floor(t / 4) % 2 === 0) rect(indent + w, y - 1, 1, 2, '#e0e0e0')
      })
    }
  },
  // Electrons on three tilted orbits round a nucleus
  atom: {
    bg: '#1a1630',
    draw: (px, rect, t) => {
      stars(px, t, 8, '#4a4370')
      const orbits = [0, Math.PI / 3, (2 * Math.PI) / 3]
      for (const tilt of orbits)
        for (let a = 0; a < 60; a += 2) {
          const ang = (a / 60) * Math.PI * 2
          const x = Math.cos(ang) * 10
          const y = Math.sin(ang) * 3.5
          px(Math.round(12 + x * Math.cos(tilt) - y * Math.sin(tilt)), Math.round(12 + x * Math.sin(tilt) + y * Math.cos(tilt)), '#3d3566')
        }
      rect(11, 11, 2, 2, '#ff7a90')
      px(10, 12, '#8fc1e3'), px(13, 11, '#8fc1e3')
      orbits.forEach((tilt, i) => {
        const ang = t * 0.12 + i * 2
        const x = Math.cos(ang) * 10
        const y = Math.sin(ang) * 3.5
        rect(Math.round(12 + x * Math.cos(tilt) - y * Math.sin(tilt)), Math.round(12 + x * Math.sin(tilt) + y * Math.cos(tilt)), 2, 2, '#f4c95d')
      })
    }
  }
}

export function PixelMoment({ scene, size = 72 }: { scene: MomentScene; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const { bg, draw } = SCENES[scene]
    const px = (x: number, y: number, c: string) => {
      if (x < 0 || y < 0 || x >= N || y >= N) return
      ctx.fillStyle = c
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1)
    }
    const rect = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c
      ctx.fillRect(Math.round(x), Math.round(y), w, h)
    }
    let t = 0
    const frame = () => {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, N, N)
      draw(px, rect, t)
    }
    frame()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => {
      if (document.hidden) return
      t++
      frame()
    }, 110)
    return () => clearInterval(timer)
  }, [scene])
  return <canvas ref={canvas} width={N} height={N} className="pixel-moment" style={{ width: size, height: size }} role="img" aria-label={`A small animation: ${scene}`} />
}
