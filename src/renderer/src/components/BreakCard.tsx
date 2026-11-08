import { useEffect, useState } from 'react'
import { useBreak } from '../lib/autotrack'
import { useStudying } from '../lib/studying'
import { chime } from '../lib/focus'
import { Professor } from './Professor'

/**
 * The tutor's nudge to rest: after a good stretch it offers a break; during one it goes fishing
 * (in the menu bar too) and counts down; at the end it chimes and you carry on where you were.
 */
export function BreakCard() {
  const [b, act] = useBreak()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (b.phase !== 'break') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [b.phase])
  // The chime when the break ends
  const [wasOnBreak, setWasOnBreak] = useState(false)
  useEffect(() => {
    if (b.phase === 'break') setWasOnBreak(true)
    else if (wasOnBreak) {
      setWasOnBreak(false)
      chime()
    }
  }, [b.phase, wasOnBreak])
  useStudying('break', b.phase === 'break' ? { pose: 'fishing', label: 'On a break', until: b.until } : null)

  if (b.phase === 'none') return null
  if (b.phase === 'due')
    return (
      <div className="break-card" role="status">
        <Professor state="tea" size={26} />
        <div className="break-text">
          <strong>{b.studied} minutes of good work.</strong>
          <span className="muted small">A {b.minutes}-minute break now helps it stick.</span>
        </div>
        <button className="btn small primary" onClick={act.take}>
          Take a break
        </button>
        <button className="btn small ghost" onClick={act.snooze}>
          Keep going
        </button>
      </div>
    )
  const left = Math.max(0, b.until - now)
  return (
    <div className="break-card on-break" role="status">
      <Professor state="fishing" size={26} />
      <div className="break-text">
        <strong>
          Break · {Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}
        </strong>
        <span className="muted small">Stand up, look out of a window, get some water.</span>
      </div>
      <button className="btn small" onClick={act.end}>
        I’m back
      </button>
    </div>
  )
}
