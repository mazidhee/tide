import { useEffect, useRef } from 'react'
import type { ProfessorPose } from '@shared/professorArt'

/**
 * What this window is studying, for the professor in the menu bar. Several parts can report (the
 * lesson on screen, the focus timer); the most recent one that's still going is the one shown.
 */
const reports = new Map<string, { pose: ProfessorPose; label: string; since: number; at: number; until?: number }>()

function flush() {
  const latest = [...reports.values()].sort((a, b) => b.at - a.at)[0]
  window.tide.studying(latest ? { pose: latest.pose, label: latest.label, since: latest.since, ...(latest.until ? { until: latest.until } : {}) } : null).catch(() => {})
}

export function useStudying(key: string, status: { pose: ProfessorPose; label: string; until?: number } | null) {
  const since = useRef(Date.now())
  const pose = status?.pose
  const label = status?.label
  const until = status?.until
  // A new thing studied starts its own count: the menu bar's "minutes so far" is for this one, not
  // for everything since the window opened
  const was = useRef(label)
  if (was.current !== label) {
    was.current = label
    since.current = Date.now()
  }
  useEffect(() => {
    if (pose && label) reports.set(key, { pose, label, since: since.current, at: reports.get(key)?.at ?? Date.now(), until })
    else reports.delete(key)
    flush()
  }, [key, pose, label, until])
  useEffect(
    () => () => {
      reports.delete(key)
      flush()
    },
    [key]
  )
}
