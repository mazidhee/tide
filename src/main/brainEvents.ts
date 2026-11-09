import type { BrainEvent } from '@shared/brain'

/**
 * What Tide just learned or did (a memory saved, an answer graded, a book mapped, the week
 * planned), for the brain graph to show as it happens. The last few are kept for when it opens.
 */

const listeners = new Set<(e: BrainEvent) => void>()
const recent: BrainEvent[] = []

export function brainEvent(e: Omit<BrainEvent, 'at'>) {
  const event = { ...e, at: Date.now() }
  recent.push(event)
  if (recent.length > 20) recent.shift()
  listeners.forEach((l) => l(event))
}

export const recentBrainEvents = () => [...recent]

export function onBrainEvent(listener: (e: BrainEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
