import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flowOrder, nodeLabel, type Canvas, type CanvasEdge } from '@shared/canvas'

const STEP_MS = 1700

export interface Player {
  /** The edges in the order a request travels them */
  steps: CanvasEdge[]
  /** The step shown, -1 when not playing */
  index: number
  playing: boolean
  /** Bumped on every step, so the dot restarts even on the same edge */
  run: number
  /** A short run of just these edges (what the tutor just drew), then back to rest */
  announcing: boolean
  play(): void
  pause(): void
  next(): void
  prev(): void
  stop(): void
  announce(ids: string[]): void
  caption: string | null
  flow: { active?: string; done: Set<string>; step: number; run: number } | undefined
  /** Node ids lit by the current step: where the request is, and where it came from */
  at: string | undefined
  from: string | undefined
}

/**
 * Plays a request along a canvas's edges, one step at a time: the dot travels the edge, the part
 * it arrives at lights up, and the steps already taken stay marked. Step through by hand or let it
 * run. `announce` plays only the edges the tutor just drew, so the lesson's canvas shows each new
 * step moving as it is explained.
 */
export function usePlayer(canvas: Canvas): Player {
  const all = useMemo(() => flowOrder(canvas), [canvas])
  const [only, setOnly] = useState<string[] | null>(null)
  const steps = useMemo(() => (only ? only.map((id) => all.find((e) => e.id === id)).filter((e): e is CanvasEdge => !!e) : all), [all, only])
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [run, setRun] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const go = useCallback((i: number) => {
    setIndex(i)
    setRun((r) => r + 1)
  }, [])

  // Running: move on after each step; an announcement lets go of the canvas when it's done
  useEffect(() => {
    clearTimeout(timer.current)
    if (!playing || index < 0) return
    timer.current = setTimeout(
      () => {
        if (index + 1 < steps.length) go(index + 1)
        else {
          setPlaying(false)
          if (only) {
            setOnly(null)
            setIndex(-1)
          }
        }
      },
      only && index + 1 >= steps.length ? STEP_MS + 1200 : STEP_MS
    )
    return () => clearTimeout(timer.current)
  }, [playing, index, steps.length, go, only])

  // The canvas changed under a step that no longer exists
  useEffect(() => {
    if (index >= steps.length) {
      setIndex(-1)
      setPlaying(false)
    }
  }, [steps.length, index])

  const play = useCallback(() => {
    setOnly(null)
    setPlaying(true)
    if (index < 0 || index >= all.length - 1 || only) go(0)
  }, [index, all.length, go, only])
  const pause = useCallback(() => setPlaying(false), [])
  const stop = useCallback(() => {
    setPlaying(false)
    setOnly(null)
    setIndex(-1)
  }, [])
  const next = useCallback(() => {
    setPlaying(false)
    setOnly(null)
    go(Math.min(all.length - 1, (only ? -1 : index) + 1))
  }, [all.length, go, index, only])
  const prev = useCallback(() => {
    setPlaying(false)
    setOnly(null)
    go(Math.max(0, index - 1))
  }, [go, index])
  const announce = useCallback(
    (ids: string[]) => {
      if (!ids.length) return
      setOnly(ids)
      setPlaying(true)
      go(0)
    },
    [go]
  )

  const current = index >= 0 ? steps[index] : undefined
  const flow = useMemo(() => {
    if (!current) return undefined
    const done = new Set(steps.slice(0, index).map((e) => e.id))
    return { active: current.id, done, step: index, run }
  }, [current, steps, index, run])
  const byId = useMemo(() => new Map(canvas.nodes.map((n) => [n.id, n])), [canvas.nodes])
  const caption = current ? `${byId.get(current.fromNode) ? nodeLabel(byId.get(current.fromNode)!) : '?'} → ${byId.get(current.toNode) ? nodeLabel(byId.get(current.toNode)!) : '?'}${current.label ? `: ${current.label.replace(/^\s*\d+[.):]?\s+/, '')}` : ''}` : null

  return { steps, index, playing, run, announcing: !!only, play, pause, next, prev, stop, announce, caption, flow, at: current?.toNode, from: current?.fromNode }
}
