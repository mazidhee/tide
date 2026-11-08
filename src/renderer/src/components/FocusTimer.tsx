import { useEffect, useRef, useState } from 'react'
import { useStudying } from '../lib/studying'
import { formatMinutes } from '@shared/brief'
import { useApp } from '../state'
import { chime, elapsed, endFocus, extendFocus, formatClock, pauseFocus, remaining, resumeFocus, startFocus, useFocus } from '../lib/focus'
import { Icon } from './Icon'

const PRESETS: { label: string; minutes: number | null }[] = [
  { label: '25 min', minutes: 25 },
  { label: '50 min', minutes: 50 },
  { label: '90 min', minutes: 90 },
  { label: 'No limit', minutes: null }
]

/**
 * Watches the running session wherever you are (it lives in the app shell, so it still fires with
 * the sidebar collapsed or the timer hidden): when time's up it logs the session, chimes and
 * suggests a break.
 */
export function useFocusCompletion() {
  const app = useApp()
  const { state, now } = useFocus()
  const finishing = useRef(false)
  const left = state ? remaining(state, now) : null
  // The menu bar professor: at the board while you focus, tea when paused, fishing on the break after
  const [breakUntil, setBreakUntil] = useState(0)
  useStudying(
    'focus',
    state
      ? { pose: state.pausedAt ? 'tea' : 'board', label: state.pausedAt ? 'Focus paused' : `Focusing${state.context?.label ? `: ${state.context.label}` : ''}` }
      : breakUntil > now
        ? { pose: 'fishing', label: 'On a break' }
        : null
  )
  useEffect(() => {
    if (!state || left === null || left > 0 || finishing.current) return
    finishing.current = true
    const doneAt = state.startedAt + state.pausedMs + (state.durationMs ?? 0)
    endFocus(Math.min(Date.now(), doneAt)).then((minutes) => {
      finishing.current = false
      chime()
      setBreakUntil(Date.now() + 5 * 60_000)
      const text = `Focus session done: ${formatMinutes(minutes)}. Take a short break.`
      app.toast(text)
      try {
        if (document.hidden) new Notification('Tide', { body: text, silent: true })
      } catch {
        // notifications are off
      }
    })
  }, [state, left, app])
}

/** The sidebar's focus timer: a row that counts down, with a small panel to start, pause and end */
export function FocusTimer() {
  const app = useApp()
  const { state, now } = useFocus()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const left = state ? remaining(state, now) : null
  const spent = state ? elapsed(state, now) : 0

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const progress = state && state.durationMs ? Math.min(1, spent / state.durationMs) : 0
  const paused = !!state?.pausedAt
  const clock = state ? formatClock(left ?? spent) : ''

  if (app.settings.studyTimers === false) return null

  return (
    <div className="focus" ref={ref}>
      <button className={`nav-item focus-row${state ? ' running' : ''}${paused ? ' paused' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="timer" size={16} />
        <span className="focus-what">{state ? (paused ? 'Paused' : state.context?.label ?? 'Focusing') : 'Focus'}</span>
        {state && <span className="focus-clock">{clock}</span>}
        {state && state.durationMs !== null && (
          <span className="focus-bar" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </button>
      {open && (
        <div className="focus-panel" role="dialog" aria-label="Focus timer">
          {state ? (
            <>
              <p className="focus-big">{clock}</p>
              <p className="muted small focus-sub">
                {paused ? 'Paused. ' : ''}
                {state.context ? `On ${state.context.label}. ` : ''}
                {state.durationMs === null ? `Timing since you started.` : `${formatMinutes(Math.round(state.durationMs / 60_000))} session`}
              </p>
              <div className="focus-actions">
                {paused ? (
                  <button className="btn small primary" onClick={resumeFocus}>
                    Resume
                  </button>
                ) : (
                  <button className="btn small" onClick={pauseFocus}>
                    Pause
                  </button>
                )}
                {state.durationMs !== null && (
                  <button className="btn small" onClick={() => extendFocus(5)}>
                    +5 min
                  </button>
                )}
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    const m = await endFocus()
                    setOpen(false)
                    app.toast(m >= 1 ? `Logged ${formatMinutes(m)} of focus.` : 'Session ended. Under a minute, so nothing was logged.')
                  }}
                >
                  End
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="focus-title">Focus for</p>
              <div className="focus-presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="pill"
                    onClick={() => {
                      startFocus(p.minutes)
                      setOpen(false)
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="muted small focus-sub">Your focus time shows up in the morning recap on Home.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
