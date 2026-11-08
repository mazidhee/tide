import { useEffect, useState } from 'react'
import { formatMinutes } from '@shared/brief'
import { useApp } from '../state'
import { elapsed, endFocus, formatClock, startFocus, useFocus, type FocusContext } from '../lib/focus'
import { Icon } from './Icon'

/**
 * A timer for what's open: a note, a book or a practice problem. Idle, it shows the time already
 * spent here; click to start a stopwatch for it, click again to stop and log it. Starting here while
 * another session runs ends that one first. Hidden when study timers are off in Settings.
 */
export function TimeThis({ context }: { context: FocusContext }) {
  const app = useApp()
  const { state, now } = useFocus()
  const [total, setTotal] = useState<number | null>(null)
  const key = context.path ?? context.label
  const mine = !!state && (state.context?.path ?? state.context?.label) === key

  useEffect(() => {
    if (!context.path) return
    let live = true
    window.tide.learn
      .focusTime(context.path)
      .then((m) => live && setTotal(m))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [context.path, mine])

  if (app.settings.studyTimers === false) return null

  const toggle = async () => {
    if (mine) {
      const m = await endFocus()
      app.toast(m >= 1 ? `Logged ${formatMinutes(m)} on ${context.label}.` : 'Timer stopped. Under a minute, so nothing was logged.')
      return
    }
    if (state) {
      const m = await endFocus()
      if (m >= 1) app.toast(`Logged ${formatMinutes(m)}${state.context ? ` on ${state.context.label}` : ''}, now timing ${context.label}.`)
    }
    startFocus(null, context)
  }

  return (
    <button
      className={`tool-btn time-this${mine ? ' on' : ''}${mine && state?.pausedAt ? ' paused' : ''}`}
      onClick={toggle}
      title={mine ? 'Stop the timer and log the time' : total ? `${formatMinutes(total)} timed here so far. Start a timer` : 'Time how long you study this'}
    >
      <Icon name="timer" />
      <span className="time-this-label">{mine && state ? formatClock(elapsed(state, now)) : total ? formatMinutes(total) : 'Timer'}</span>
    </button>
  )
}
