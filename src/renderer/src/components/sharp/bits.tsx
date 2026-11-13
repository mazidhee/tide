import { useEffect, useState } from 'react'
import { clockText, clockTone } from '@shared/mocks'
import { renderMarkdown } from '../../lib/markdown'

export const md = (s: string) => ({ __html: renderMarkdown(s, { notePath: '', filesByName: new Map() }) })

/** The clock in the toolbar: counts down, then shows how far over */
export function SharpClock({ startedAt, minutes, stopped }: { startedAt: number; minutes: number; stopped?: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (stopped) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [stopped])
  const at = stopped ?? now
  const left = minutes * 60_000 - (at - startedAt)
  const tone = clockTone({ startedAt, minutes }, at)
  return (
    <span className={`interview-clock mk-clock ${tone}`} role="timer" aria-label={left > 0 ? `${clockText(left)} left of ${minutes} minutes` : `${clockText(-left)} over`}>
      <span className="interview-clock-dot" aria-hidden="true" />
      {left > 0 ? clockText(left) : `+${clockText(-left)}`}
    </span>
  )
}

