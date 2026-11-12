import { useEffect, useRef } from 'react'

/**
 * Study time, tracked without a timer: while you're on something to study and actually at it
 * (typing, scrolling, the tutor replying), the time is logged against it; three quiet minutes stop
 * the clock. Breaks are planned and kept by lib/breaks.ts (shared/breakPlanner). The manual
 * Focus timer takes over when you start it, so nothing is counted twice.
 */

export interface StudyContext {
  label: string
  path?: string
  /** What kind of studying, for the length of a stretch */
  kind: 'lesson' | 'reading' | 'practice' | 'review' | 'chat' | 'exam'
  /** Never interrupted by a break (an exam, a timed round) */
  noBreaks?: boolean
}

const QUIET_MS = 3 * 60_000
const TICK_MS = 15_000

const manualFocusRunning = () => {
  try {
    return !!localStorage.getItem('tide.focus')
  } catch {
    return false
  }
}

export function useAutoTrack(context: StudyContext | null) {
  const ctx = useRef(context)
  ctx.current = context

  useEffect(() => {
    let lastActive = Date.now()
    let seg: { start: number; last: number; ctx: StudyContext } | null = null
    const bump = () => (lastActive = Date.now())
    let moveAt = 0
    const onMove = () => {
      const now = Date.now()
      if (now - moveAt > 5000) (moveAt = now), bump()
    }
    window.addEventListener('keydown', bump, true)
    window.addEventListener('mousedown', bump, true)
    window.addEventListener('wheel', onMove, { capture: true, passive: true })
    window.addEventListener('mousemove', onMove, true)
    // The tutor replying (or speaking) counts: you're listening
    const offAi = window.tide.ai.onEvent(() => onMove())

    const flush = (end: number) => {
      if (!seg) return
      if (end - seg.start >= 60_000) window.tide.learn.logFocus(seg.start, end, { label: seg.ctx.label, path: seg.ctx.path, kind: seg.ctx.kind }).catch(() => {})
      seg = null
    }

    const tick = () => {
      const now = Date.now()
      const c = ctx.current
      const active = !!c && !manualFocusRunning() && now - lastActive < QUIET_MS && (document.hasFocus() || now - lastActive < 60_000)
      if (active) {
        if (!seg) seg = { start: now, last: now, ctx: c }
        else if (seg.ctx.label !== c.label) {
          flush(now)
          seg = { start: now, last: now, ctx: c }
        }
        seg.last = now
        // Long stretches are logged as they go, so the day's numbers are always current
        if (now - seg.start > 5 * 60_000) {
          const keep = seg.ctx
          flush(now)
          seg = { start: now, last: now, ctx: keep }
        }
      } else {
        if (seg) flush(Math.min(now, seg.last + 30_000))
      }
    }
    const timer = setInterval(tick, TICK_MS)
    // Dev only: lets test tooling see the tracker
    if (import.meta.env.DEV) (window as unknown as { __track: unknown }).__track = () => ({ seg, lastActive, ctx: ctx.current, hasFocus: document.hasFocus() })
    const onHide = () => {
      if (document.hidden && seg) flush(Math.min(Date.now(), seg.last + 30_000))
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', () => seg && flush(Math.min(Date.now(), seg.last + 30_000)))
    return () => {
      clearInterval(timer)
      if (seg) flush(Math.min(Date.now(), seg.last + 30_000))
      window.removeEventListener('keydown', bump, true)
      window.removeEventListener('mousedown', bump, true)
      window.removeEventListener('wheel', onMove, true)
      window.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('visibilitychange', onHide)
      offAi()
    }
  }, [])
}
