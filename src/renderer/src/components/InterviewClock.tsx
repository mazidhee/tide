import { useEffect, useRef, useState } from 'react'

/**
 * A timed round's clock. It starts when the round does, counts down in the header, turns amber
 * for the last five minutes and calls onEnd once at zero. `left()` gives the minutes remaining,
 * for telling the interviewer how much time is left.
 */
export function useInterviewClock(minutes: number | undefined, onEnd: () => void) {
  const started = useRef<number | null>(null)
  const ended = useRef(false)
  const [now, setNow] = useState(Date.now())
  const endRef = useRef(onEnd)
  endRef.current = onEnd

  const start = () => {
    if (minutes && started.current === null) started.current = Date.now()
  }
  useEffect(() => {
    if (!minutes) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [minutes])

  const elapsed = started.current === null ? 0 : now - started.current
  const remaining = minutes ? Math.max(0, minutes * 60_000 - elapsed) : 0
  useEffect(() => {
    if (minutes && started.current !== null && remaining === 0 && !ended.current) {
      ended.current = true
      endRef.current()
    }
  }, [minutes, remaining])

  return {
    start,
    remaining,
    elapsedMinutes: () => (started.current === null ? 0 : (Date.now() - started.current) / 60_000),
    left: () => Math.ceil(remaining / 60_000),
    stop: () => {
      ended.current = true
    }
  }
}

export function InterviewClock({ remaining, total }: { remaining: number; total: number }) {
  const m = Math.floor(remaining / 60_000)
  const s = Math.floor((remaining % 60_000) / 1000)
  const tone = remaining === 0 ? ' over' : remaining < 5 * 60_000 ? ' low' : ''
  return (
    <span className={`interview-clock${tone}`} role="timer" aria-label={`${m} minutes ${s} seconds left of ${total}`} title="Timed round, no hints">
      <span className="interview-clock-dot" aria-hidden="true" />
      {remaining === 0 ? "Time's up" : `${m}:${String(s).padStart(2, '0')}`}
    </span>
  )
}
