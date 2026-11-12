import { useSyncExternalStore } from 'react'
import type { MockPhase } from '@shared/mocks'

/**
 * Where the mock on screen is (components/mock/MockView): App reads it to tell the break planner,
 * which keeps every break away while the timed session runs (shared/mocks mockStudyContext).
 */
let current: { phase: MockPhase; title: string } | null = null
const listeners = new Set<() => void>()

export function setMockPhase(next: { phase: MockPhase; title: string } | null) {
  if (current?.phase === next?.phase && current?.title === next?.title) return
  current = next
  listeners.forEach((l) => l())
}

export function useMockPhase() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}
