import { useEffect, useState } from 'react'
import type { PreparedLesson } from '@shared/lessonPrep'
import type { useApp } from '../state'

/**
 * Lesson prep while you're away (main/lessonPrep), as Home and Learn show it: the prepared lesson
 * waiting ("Ready for you"), only while it is still the plan's next lesson, and starting it.
 * Starting opens the lesson on its prepared exchange (SessionView), and remembers the week plan's
 * item so finishing it ticks it off. `preparing`: the plan's next lesson has no prep yet (one is
 * being made, or will be at the next quiet time); Home shows the plain lesson with a quiet note.
 */
export function useReadyLesson(): { prep: PreparedLesson | null; preparing: boolean; refresh(): void } {
  const [state, setState] = useState<{ prep: PreparedLesson | null; preparing: boolean }>({ prep: null, preparing: false })
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    window.tide.prep
      .status()
      .then((s) => live && setState({ prep: s.ready, preparing: !s.ready && (s.preparing || !!s.queued) }))
      .catch(() => live && setState({ prep: null, preparing: false }))
    return () => {
      live = false
    }
  }, [n])
  return { ...state, refresh: () => setN((x) => x + 1) }
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

/** "Prepared overnight", "Prepared 20 min ago", "Prepared yesterday": when, in a few words */
export function preparedWhen(at: number, now = Date.now()): string {
  const d = new Date(at)
  const n = new Date(now)
  const h = d.getHours()
  const sameDay = n.toDateString() === d.toDateString()
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).toDateString() === d.toDateString()
  const min = Math.round((now - at) / 60_000)
  if (min < 60) return `Prepared ${Math.max(1, min)} min ago`
  // Overnight only when it's now the morning after, not for something made at 23:00 and seen at 23:50
  const nowH = n.getHours()
  if ((h >= 22 || h < 7) && (sameDay || yesterday) && nowH >= 5 && nowH < 14) return 'Prepared overnight'
  if (sameDay) return `Prepared today at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  if (yesterday) return 'Prepared yesterday'
  return `Prepared ${d.toLocaleDateString('en-GB', { weekday: 'long' })}`
}
