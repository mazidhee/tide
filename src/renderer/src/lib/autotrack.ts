import { useEffect, useRef, useState } from 'react'

/**
 * Study time, tracked without a timer: while you're on something to study and actually at it
 * (typing, scrolling, the tutor replying), the time is logged against it; three quiet minutes stop
 * the clock. The same tracker paces you: after a stretch of study (about 25 minutes in lessons
 * and quizzes, 45 for deep work like reading and coding) it offers a break; a quiet five minutes
 * counts as one too. Exams and timed interviews are never interrupted. The manual Focus timer
 * takes over when you start it, so nothing is counted twice.
 */

export interface StudyContext {
  label: string
  path?: string
  /** What kind of studying, for the length of a stretch */
  kind: 'lesson' | 'reading' | 'practice' | 'review' | 'chat' | 'exam'
  /** Don't offer breaks (an exam, a timed round) */
  noBreaks?: boolean
}

export type Pace = 'auto' | 'off' | '25' | '50'

type BreakState = { phase: 'none' } | { phase: 'due'; studied: number; minutes: number } | { phase: 'break'; until: number; minutes: number }

const QUIET_MS = 3 * 60_000
const NATURAL_BREAK_MS = 5 * 60_000
const TICK_MS = 15_000

let state: BreakState = { phase: 'none' }
const listeners = new Set<() => void>()
const setState = (s: BreakState) => ((state = s), listeners.forEach((l) => l()))

/** The break offer or the break in progress, for the card that shows it */
export function useBreak(): [BreakState, { take(): void; snooze(): void; end(): void }] {
  const [s, set] = useState(state)
  useEffect(() => {
    const l = () => set(state)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return [
    s,
    {
      take: () => {
        if (state.phase === 'due') setState({ phase: 'break', until: Date.now() + state.minutes * 60_000, minutes: state.minutes })
      },
      snooze: () => {
        snoozedUntil = Date.now() + 10 * 60_000
        setState({ phase: 'none' })
      },
      end: () => {
        streakStart = 0
        setState({ phase: 'none' })
      }
    }
  ]
}

let streakStart = 0
let snoozedUntil = 0

const workMinutes = (pace: Pace, kind: StudyContext['kind']) => (pace === '25' ? 25 : pace === '50' ? 50 : kind === 'reading' || kind === 'practice' ? 45 : 25)
const breakMinutes = (work: number) => (work >= 45 ? 10 : 5)

const manualFocusRunning = () => {
  try {
    return !!localStorage.getItem('tide.focus')
  } catch {
    return false
  }
}

export function useAutoTrack(context: StudyContext | null, pace: Pace) {
  const ctx = useRef(context)
  ctx.current = context
  const paceRef = useRef(pace)
  paceRef.current = pace

  useEffect(() => {
    let lastActive = Date.now()
    let lastQuietCheck = Date.now()
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
      const onBreak = state.phase === 'break'
      if (onBreak && state.phase === 'break' && now >= state.until) {
        setState({ phase: 'none' })
        streakStart = 0
        try {
          new Notification('Tide', { body: 'Break’s over. Back to it when you’re ready.', silent: true })
        } catch {
          // Notifications off
        }
      }
      const active = !!c && !onBreak && !manualFocusRunning() && now - lastActive < QUIET_MS && (document.hasFocus() || now - lastActive < 60_000)
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
        if (!streakStart) streakStart = now
        const work = workMinutes(paceRef.current, c.kind)
        const studied = (now - streakStart) / 60_000
        if (paceRef.current !== 'off' && !c.noBreaks && state.phase === 'none' && now > snoozedUntil && studied >= work) setState({ phase: 'due', studied: Math.round(studied), minutes: breakMinutes(work) })
      } else {
        if (seg) flush(Math.min(now, seg.last + 30_000))
        // A quiet few minutes is a break of its own
        if (now - lastActive > NATURAL_BREAK_MS) {
          streakStart = 0
          if (state.phase === 'due') setState({ phase: 'none' })
        }
      }
      lastQuietCheck = now
    }
    const timer = setInterval(tick, TICK_MS)
    // Dev only: lets test tooling see the tracker
    if (import.meta.env.DEV) (window as unknown as { __track: unknown }).__track = () => ({ seg, lastActive, ctx: ctx.current, state, streakStart, hasFocus: document.hasFocus() })
    const onHide = () => {
      if (document.hidden && seg) flush(Math.min(Date.now(), seg.last + 30_000))
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', () => seg && flush(Math.min(Date.now(), seg.last + 30_000)))
    void lastQuietCheck
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
