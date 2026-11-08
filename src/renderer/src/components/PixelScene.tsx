import { useEffect, useMemo, useRef, useState } from 'react'
import { drawPlace, type Place } from '../lib/pixelWorld'
import { useCharacter } from '../state'

/**
 * A strip of Tide's pixel world (see lib/pixelWorld): the tutor somewhere fitting for the page,
 * with the people and animals around. Edge to edge, softly fading into the page; slow, and still
 * when the system asks for less motion. `rows` is the height in pixel-world pixels.
 */
export function PixelScene({ place, rows = 40, scale = 4, className, onLabel, data }: { place: Place; rows?: number; scale?: number; className?: string; onLabel?(label: string): void; data?: Record<string, unknown> }) {
  const dataRef = useRef(data)
  dataRef.current = data
  const character = useCharacter()
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const [label, setLabel] = useState('')

  useEffect(() => {
    const el = canvas.current
    const box = wrap.current
    if (!el || !box) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    let tick = 0
    let width = 0
    const draw = () => {
      const now = new Date()
      const l = drawPlace({ ctx, width, height: rows, tick, character, hour: now.getHours() + now.getMinutes() / 60, data: dataRef.current }, place)
      setLabel((cur) => (cur === l ? cur : l))
    }
    const resize = () => {
      width = Math.max(100, Math.ceil(box.clientWidth / scale))
      el.width = width
      el.height = rows
      el.style.width = `${width * scale}px`
      el.style.height = `${rows * scale}px`
    }
    resize()
    draw()
    const ro = new ResizeObserver(() => (resize(), draw()))
    ro.observe(box)
    if (reduced) return () => ro.disconnect()
    const timer = setInterval(() => {
      if (document.hidden) return
      tick++
      draw()
    }, 125)
    return () => {
      clearInterval(timer)
      ro.disconnect()
    }
  }, [place, rows, scale, character, reduced])

  useEffect(() => {
    if (label) onLabel?.(label)
  }, [label, onLabel])

  return (
    <div className={`pixel-scene${className ? ` ${className}` : ''}`} ref={wrap} style={{ height: rows * scale }}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  )
}
