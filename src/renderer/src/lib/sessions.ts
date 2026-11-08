import { useEffect, useState } from 'react'
import type { View } from '../state'

/**
 * Lessons, quizzes, interviews and exams you've left mid-way, so going elsewhere doesn't lose them.
 * Coming back (with Back, or from "In progress" in the sidebar) carries on exactly where it was;
 * a reply still being written keeps arriving while you're away.
 */
export interface Ongoing {
  key: string
  view: View
  title: string
  /** What the page needs to pick up again (a lesson's turns, an exam's paper and answers) */
  state: unknown
  /** A reply is still being written for it */
  busy: boolean
  at: number
}

const store = new Map<string, Ongoing>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const sessionKey = (v: { kind: string; mode?: string; topic?: string; nonce?: number }) => `${v.kind}:${v.mode ?? ''}:${v.topic ?? ''}:${v.nonce ?? ''}`

export function saveOngoing(o: Omit<Ongoing, 'at'>) {
  store.set(o.key, { ...o, at: Date.now() })
  // Keep a handful: the oldest go first
  const all = [...store.values()].sort((a, b) => b.at - a.at)
  for (const old of all.slice(6)) store.delete(old.key)
  emit()
}

export const getOngoing = (key: string) => store.get(key)

export function endOngoing(key: string) {
  if (store.delete(key)) emit()
}

const followers = new Map<string, () => void>()

/** The lesson is on screen again: it listens for itself */
export function stopFollowing(key: string) {
  followers.get(key)?.()
  followers.delete(key)
}

/**
 * Keeps a reply arriving for a lesson that's off screen: deltas are added to its last turn until
 * the reply is done.
 */
export function followInBackground(key: string, id: string): () => void {
  stopFollowing(key)
  const off = window.tide.ai.onEvent((e) => {
    if (e.id !== id) return
    const o = store.get(key)
    if (!o) return off()
    const turns = (o.state as { turns: { role: string; content: string }[] }).turns
    const last = turns[turns.length - 1]
    if (e.type === 'delta' && last?.role === 'assistant') last.content += e.text
    if (e.type === 'reset' && last?.role === 'assistant') last.content = ''
    if (e.type === 'done' || e.type === 'error') {
      o.busy = false
      off()
      followers.delete(key)
      emit()
    }
  })
  followers.set(key, off)
  return off
}

export function useOngoing(): Ongoing[] {
  const [list, setList] = useState(() => [...store.values()])
  useEffect(() => {
    const l = () => setList([...store.values()].sort((a, b) => b.at - a.at))
    listeners.add(l)
    l()
    return () => {
      listeners.delete(l)
    }
  }, [])
  return list
}
