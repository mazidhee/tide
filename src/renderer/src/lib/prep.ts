import { useEffect, useState } from 'react'
import type { PreparedLesson } from '@shared/lessonPrep'
import type { useApp } from '../state'

/**
 * Lesson prep while you're away (main/lessonPrep), as Home and Learn show it: the prepared lesson
 * waiting ("Ready for you"), and starting it. Starting opens the lesson on its prepared exchange
 * (SessionView), and remembers the week plan's item so finishing it ticks it off.
 */
export function useReadyLesson(): { prep: PreparedLesson | null; refresh(): void } {
  const [prep, setPrep] = useState<PreparedLesson | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    window.tide.prep
      .status()
      .then((s) => live && setPrep(s.ready))
      .catch(() => live && setPrep(null))
    return () => {
      live = false
    }
  }, [n])
  return { prep, refresh: () => setN((x) => x + 1) }
}

const ACTIVE = 'tide.agenda.active'

export function startPrepared(app: ReturnType<typeof useApp>, p: PreparedLesson) {
  if (p.agenda) {
    try {
      localStorage.setItem(ACTIVE, JSON.stringify({ ...p.agenda, topic: p.topic, since: Date.now() }))
    } catch {
      // It just won't tick itself off
    }
  }
  app.setView({ kind: 'session', mode: 'teach', scope: p.scope, topic: p.topic, options: { ...(p.options ?? {}), prep: { id: p.id } }, nonce: Date.now() })
}

/** "Prepared overnight", "Prepared 2 h ago": when, in a few words */
export function preparedWhen(at: number, now = Date.now()): string {
  const d = new Date(at)
  const h = d.getHours()
  const sameDay = new Date(now).toDateString() === d.toDateString()
  const yesterday = new Date(now - 86_400_000).toDateString() === d.toDateString()
  if ((h >= 22 || h < 7) && (sameDay || yesterday)) return 'Prepared overnight'
  const min = Math.round((now - at) / 60_000)
  if (min < 60) return `Prepared ${Math.max(1, min)} min ago`
  if (sameDay) return `Prepared at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  return `Prepared ${d.toLocaleDateString('en-GB', { weekday: 'long' })}`
}
