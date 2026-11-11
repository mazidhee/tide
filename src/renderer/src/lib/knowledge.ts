import { useEffect, useState } from 'react'
import { conceptName, type ConceptState, type KnowledgeView } from '@shared/knowledge'

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
      // Read again when an answer is marked, and once more a moment later: the lesson's own record
      // (which the map also reads) is saved about a second after the mark
      window.tideEvents.onBrainEvent((e) => {
        if (e.kind !== 'attempt') return
        load()
        setTimeout(() => load(), 2500)
      })
    }
    return () => {
      listeners.delete(setK)
    }
  }, [on])
  return on ? k : null
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The concept a lesson or quiz is about: the one with its name, in its notebook's area when two share a name */
export function conceptFor(k: KnowledgeView | null, topic: string, path?: string): ConceptState | null {
  if (!k) return null
  const want = norm(conceptName(topic))
  if (!want) return null
  const named = k.concepts.filter((c) => norm(c.name) === want)
  if (named.length < 2) return named[0] ?? null
  const top = path?.split('/')[0].toLowerCase()
  return named.find((c) => c.area.toLowerCase() === top) ?? named.find((c) => c.seen > 0) ?? named[0]
}
