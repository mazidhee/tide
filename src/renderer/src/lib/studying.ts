import { useEffect, useRef } from 'react'
import type { ProfessorPose } from '@shared/professorArt'

/**
 * What this window is studying, for the professor in the menu bar. Several parts can report (the
 * lesson on screen, the focus timer); the most recent one that's still going is the one shown.
 */
const reports = new Map<string, { pose: ProfessorPose; label: string; since: number; at: number; until?: number }>()

/**
 * The time that really counted on what's on screen (lib/autotrack, by shared/activeTime's rules),
 * so the menu bar's minutes stop while you're in another app or away from the Mac
 */
let active = { ms: 0, counting: false, at: 0 }

function flush() {
  const latest = [...reports.values()].sort((a, b) => b.at - a.at)[0]
  window.tide.studying(latest ? { pose: latest.pose, label: latest.label, since: latest.since, ...(latest.until ? { until: latest.until } : {}), activeMs: active.ms, counting: active.counting, activeAt: active.at } : null).catch(() => {})
}

/** From the tracker: active time so far on this page, and whether it's counting right now */
export function noteActive(ms: number, counting: boolean) {
  const changed = counting !== active.counting || Math.floor(ms / 60_000) !== Math.floor(active.ms / 60_000) || ms < active.ms
  active = { ms, counting, at: Date.now() }
  if (changed && reports.size) flush()
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
