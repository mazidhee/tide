import { useCallback, useEffect, useRef, useState } from 'react'
import { difficultyNoteFor, railLine, type Known, type Turn } from '@shared/difficulty'

/**
 * Adaptive difficulty for a lesson (shared/difficulty.ts has the policy): reads what the knowledge
 * map has on the topic once, when the lesson opens, times each answer from the moment the tutor's
 * reply finished, and gives the lesson screen the hidden note for an answer and the side rail's line.
 */
export function useDifficulty(topic: string, on: boolean, busy: boolean) {
  const [known, setKnown] = useState<Known | null>(null)
  useEffect(() => {
    if (!on) return
    let live = true
    window.tide.difficulty
      .known(topic)
      .then((k) => live && setKnown(k))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [on, topic])
  const knownRef = useRef(known)
  knownRef.current = known

  // When the question was put: the reply finished. Times are kept by the index of the answer's turn
  const askedAt = useRef<number | null>(null)
  const times = useRef<Record<number, number>>({})
  useEffect(() => {
    if (!busy) askedAt.current = Date.now()
  }, [busy])

  /** The note to add to an answer being sent, or null. The answer will be turn number history.length */
  const noteFor = useCallback(
    (history: Turn[], sending: string): string | null => {
      if (!on) return null
      const seconds = askedAt.current ? Math.round((Date.now() - askedAt.current) / 1000) : undefined
      const note = difficultyNoteFor(history, sending, knownRef.current, { times: times.current, seconds })
      if (note && seconds !== undefined) times.current[history.length] = seconds
      return note
    },
    [on]
  )

  /** What Tide did after the last marked answer and why, for the rail; `focus` is the plan's step in hand */
  const line = useCallback((history: Turn[], focus?: string): string | null => (on ? railLine(history, knownRef.current, { times: times.current, focus: focus && focus.length <= 40 ? focus.replace(/[.:]$/, '') : undefined }) : null), [on])

  return { noteFor, line }
}
