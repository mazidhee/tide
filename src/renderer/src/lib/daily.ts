import { useEffect, useState } from 'react'
import { buildDaily, dailyMinutes, type DailyItem } from '@shared/daily'
import { localDate } from '@shared/coach'

/** Everything due today, mixed into one session (see shared/daily) */
export async function loadDaily(size = 20): Promise<DailyItem[]> {
  const [cards, mistakes, recall, week] = await Promise.all([
    window.tide.study.cards({ kind: 'vault' }).catch(() => []),
    window.tide.mistakes.due(10).catch(() => []),
    window.tide.recall.queue().catch(() => []),
    window.tide.coach.week().catch(() => null)
  ])
  const today = week?.days.find((d) => d.date === localDate())
  const next = (today?.items ?? []).filter((i) => i.kind === 'learn' && !i.done && i.topic).map((i) => ({ topic: i.topic!, notebook: i.notebook }))
  return buildDaily({ cards, mistakes, recall, next, now: Date.now() }, size)
}

/** How much is waiting, for the button on Home */
export function useDailyCount(): { items: number; minutes: number } | null {
  const [count, setCount] = useState<{ items: number; minutes: number } | null>(null)
  useEffect(() => {
    let live = true
    loadDaily()
      .then((items) => live && setCount({ items: items.length, minutes: dailyMinutes(items) }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return count
}
