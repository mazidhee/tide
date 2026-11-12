import { useEffect, useState } from 'react'
import type { View } from '../state'
import { lessonId } from '@shared/lessonLog'
import type { LessonThread } from '@shared/lessonThreads'

/**
 * Lessons, quizzes, interviews and exams you've left mid-way, so going elsewhere doesn't lose them.
 * Coming back (with Back, or from "In progress" in the sidebar) carries on exactly where it was;
 * a reply still being written keeps arriving while you're away.
 *
 * They're saved to disk as they go, the one on screen too, so quitting Tide, a restart or the Mac
 * shutting down mid-lesson loses nothing: they're back under "In progress" when Tide opens. A
 * reply that was cut off is asked for again.
 */
export interface Ongoing {
  key: string
  view: View
  title: string
  /** What the page needs to pick up again (a lesson's turns, an exam's paper and answers) */
  state: unknown
  /** A reply is still being written for it */
  busy: boolean
  /** Tide closed while a reply was being written: ask for it again when it's opened */
  interrupted?: boolean
  at: number
}

const store = new Map<string, Ongoing>()
/** The one on screen, saved as it goes but not listed until you leave it (or Tide closes) */
const live = new Map<string, Ongoing>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** In the notes folder beside Tide's other data, written within half a second of each change */
const FILE = '.tide/ongoing.json'
let saving: ReturnType<typeof setTimeout> | undefined
let loaded = false

function persist() {
  clearTimeout(saving)
  saving = setTimeout(() => {
    // Not before what was saved last time has been read, or it would be written over
    if (!loaded) return persist()
    const all = new Map<string, Ongoing>()
    for (const o of [...store.values(), ...live.values()]) if (!all.has(o.key) || all.get(o.key)!.at < o.at) all.set(o.key, o)
    window.tide.vault.write(FILE, JSON.stringify([...all.values()].sort((a, b) => b.at - a.at).slice(0, 6))).catch(() => {})
  }, 400)
}

// ---------- Past lessons: every lesson kept as it goes, to read again or carry on ----------

const lessonTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Keeps a lesson in Past lessons (a second after its last change, or now when it finishes) */
export function keepLesson(key: string, view: View, turns: unknown, finished = false, threads?: unknown) {
  if (view.kind !== 'session' || !Array.isArray(turns)) return
  const id = view.lesson ?? lessonId(key)
  clearTimeout(lessonTimers.get(id))
  const save = () => {
    lessonTimers.delete(id)
    window.tide.lessons
      .save({ id, mode: view.mode, topic: view.topic, scope: view.scope, ...(view.options ? { options: view.options } : {}), turns: (turns as { role: 'user' | 'assistant'; content: string }[]).map(({ role, content }) => ({ role, content })), ...(Array.isArray(threads) ? { threads: threads as LessonThread[] } : {}), finished })
      .catch(() => {})
  }
  if (finished) save()
  else lessonTimers.set(id, setTimeout(save, 1000))
}

/** What was in progress when Tide last closed, the lesson on screen included: back under "In progress" */
export async function loadOngoing() {
  try {
    const saved = JSON.parse(await window.tide.vault.read(FILE)) as Ongoing[]
    for (const o of saved) if (o?.key && o.view && !store.has(o.key)) store.set(o.key, { ...o, busy: false, ...(o.busy ? { interrupted: true } : {}) })
    // Lessons from before Past lessons existed (or saved while it wasn't running) are kept there too
    for (const o of saved) if (o?.view?.kind === 'session') keepLesson(o.key, o.view, (o.state as { turns?: unknown })?.turns, false, (o.state as { threads?: unknown })?.threads)
    emit()
  } catch {
    // nothing saved yet, or unreadable
  }
  loaded = true
}
void loadOngoing()

export const sessionKey = (v: { kind: string; mode?: string; topic?: string; nonce?: number }) => `${v.kind}:${v.mode ?? ''}:${v.topic ?? ''}:${v.nonce ?? ''}`

export function saveOngoing(o: Omit<Ongoing, 'at'>) {
  keepLesson(o.key, o.view, (o.state as { turns?: unknown })?.turns, false, (o.state as { threads?: unknown })?.threads)
  live.delete(o.key)
  // The same lesson opened again (from Past lessons, or where something came up) is one entry, not two
  const record = (x: Ongoing) => (x.view.kind === 'session' ? (x.view.lesson ?? lessonId(x.key)) : null)
  const mine = record(o as Ongoing)
  if (mine) for (const x of [...store.values()]) if (x.key !== o.key && record(x) === mine) store.delete(x.key)
  store.set(o.key, { ...o, at: Date.now() })
  // Keep a handful: the oldest go first
  const all = [...store.values()].sort((a, b) => b.at - a.at)
  for (const old of all.slice(6)) store.delete(old.key)
  emit()
  persist()
}

/** The one on screen, as it goes: kept on disk, listed only if Tide closes before you leave it */
export function keepLive(o: Omit<Ongoing, 'at'>) {
  keepLesson(o.key, o.view, (o.state as { turns?: unknown })?.turns, false, (o.state as { threads?: unknown })?.threads)
  live.set(o.key, { ...o, at: Date.now() })
  persist()
}

export const getOngoing = (key: string) => store.get(key)

export function endOngoing(key: string) {
  live.delete(key)
  if (store.delete(key)) emit()
  persist()
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
      persist()
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
