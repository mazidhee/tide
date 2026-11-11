import { useEffect, useState } from 'react'
import type { KnowledgeView } from '@shared/knowledge'

/**
 * What you know, read once and shared by everything in the new design that shows a concept's
 * level (Home, the rail's count, a lesson's recall card). Read again when an answer is marked.
 */
let cache: KnowledgeView | null = null
let loading: Promise<void> | null = null
let following = false
const listeners = new Set<(k: KnowledgeView | null) => void>()

const load = () => {
  loading ??= window.tide.knowledge
    .view()
    .then((k) => {
      cache = k
      listeners.forEach((l) => l(k))
    })
    .catch(() => {})
    .finally(() => {
      loading = null
    })
  return loading
}

export function useKnowledge(on = true): KnowledgeView | null {
  const [k, setK] = useState(cache)
  useEffect(() => {
    if (!on) return
    listeners.add(setK)
    if (cache) setK(cache)
    else load()
    if (!following) {
      following = true
      window.tideEvents.onBrainEvent((e) => e.kind === 'attempt' && load())
    }
    return () => {
      listeners.delete(setK)
    }
  }, [on])
  return on ? k : null
}
