import { useEffect, useRef } from 'react'
import { activeEnd, studyingNow } from '@shared/activeTime'

/**
 * Study time, tracked without a timer: while you're on something to study and actually at it, the
 * time is logged against it (shared/activeTime says when: this window in front, the page visible,
 * input in the last two and a half minutes). Leaving the page, the window or the Mac stops the
 * clock where you were last seen; a lesson waiting in Carry on never counts. Breaks are planned and kept by lib/breaks.ts (shared/breakPlanner). The manual
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
    let lastInput = Date.now()
    let lastTutor = 0
    let seg: { start: number; ctx: StudyContext } | null = null
    const bump = () => (lastInput = Date.now())
    let moveAt = 0
    const onMove = () => {
      const now = Date.now()
      if (now - moveAt > 5000) (moveAt = now), bump()
    }
    window.addEventListener('keydown', bump, true)
    window.addEventListener('mousedown', bump, true)
    window.addEventListener('wheel', onMove, { capture: true, passive: true })
    window.addEventListener('mousemove', onMove, true)
    // A reply streaming counts as you reading it, only shortly after your own input (shared/activeTime);
    // replies reach every window, so this one only notes it while it is the one in front
    const offAi = window.tide.ai.onEvent(() => {
      if (document.hasFocus() && !document.hidden) lastTutor = Date.now()
    })
    const state = (now: number) => ({ now, lastInput, lastTutor, focused: document.hasFocus(), visible: !document.hidden, onStudy: !!ctx.current && !manualFocusRunning() })

    const flush = (end: number) => {
      if (!seg) return
      if (end - seg.start >= 60_000) window.tide.learn.logFocus(seg.start, end, { label: seg.ctx.label, path: seg.ctx.path, kind: seg.ctx.kind }).catch(() => {})
      seg = null
    }
    // The stretch ends at the last sign of you, not when the idle limit noticed
    const stop = () => seg && flush(Math.max(seg.start, activeEnd({ now: Date.now(), lastInput, lastTutor })))

    const tick = () => {
      const now = Date.now()
      const c = ctx.current
      if (c && studyingNow(state(now))) {
        if (!seg) seg = { start: now, ctx: c }
        else if (seg.ctx.label !== c.label) {
          flush(now)
          seg = { start: now, ctx: c }
        }
        // Long stretches are logged as they go, so the day's numbers are always current
        if (now - seg.start > 5 * 60_000) {
          const keep = seg.ctx
          flush(now)
          seg = { start: now, ctx: keep }
        }
      } else stop()
    }
    const timer = setInterval(tick, TICK_MS)
    // Dev only: lets test tooling see the tracker
    if (import.meta.env.DEV) (window as unknown as { __track: unknown }).__track = () => ({ seg, lastInput, lastTutor, ctx: ctx.current, hasFocus: document.hasFocus(), counting: studyingNow(state(Date.now())) })
    // Leaving the window, or it going out of sight, ends the stretch there and then
    const onHide = () => document.hidden && stop()
    const onBlur = () => stop()
    const onUnload = () => stop()
    // The page changed: the stretch on the old one ends now (you were just here, clicking away)
    const onCtx = () => stop()
    window.addEventListener('tide:studyContext', onCtx)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      clearInterval(timer)
      stop()
      window.removeEventListener('keydown', bump, true)
      window.removeEventListener('mousedown', bump, true)
      window.removeEventListener('wheel', onMove, true)
      window.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('tide:studyContext', onCtx)
      offAi()
    }
  }, [])

  // Leaving the lesson (or whatever was being studied) ends its stretch at once: the next tick
  // would otherwise start the new page's from the old one's last minute
  const label = context?.label ?? null
  const prev = useRef(label)
  useEffect(() => {
    if (prev.current === label) return
    prev.current = label
    window.dispatchEvent(new Event('tide:studyContext'))
  }, [label])
}
