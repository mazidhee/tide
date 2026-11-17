import { useEffect, useState } from 'react'
import type { View } from '../state'
import { lessonId } from '@shared/lessonLog'
import type { LessonThread } from '@shared/lessonThreads'
import { closedOnce } from '@shared/session'

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

/** A lesson that finished once (its closing summary is in it): it's in Past lessons, never in Carry on */
export function isClosedLesson(o: Pick<Ongoing, 'view' | 'state'>): boolean {
  const turns = (o.state as { turns?: unknown } | null)?.turns
  return o.view?.kind === 'session' && Array.isArray(turns) && closedOnce(turns as { role: string; content: string }[])
}

/** The same teach topic: two entries for it are one lesson (the one with the most turns) */
const teachTopic = (o: Pick<Ongoing, 'view'>) => (o.view?.kind === 'session' && o.view.mode === 'teach' && o.view.topic ? `teach:${o.view.topic}` : null)
const turnsOf = (o: Pick<Ongoing, 'state'>): { role: string }[] => {
  const t = (o.state as { turns?: unknown } | null)?.turns
  return Array.isArray(t) ? (t as { role: string }[]) : []
}
/** The learner did something in it: answered past the opening request, or asked in a thread */
const answered = (o: Pick<Ongoing, 'state'>) => {
  const threads = (o.state as { threads?: unknown } | null)?.threads
  return turnsOf(o).filter((t) => t.role === 'user').length > 1 || (Array.isArray(threads) && threads.length > 0)
}

/**
 * One entry per teach topic: where two exist, the one with fewer turns goes. On load (a one-time
 * clean-up of old duplicates) only one the learner never answered in is dropped; when saving, the
 * shorter one is merged into the longer.
 */
export function dedupeOngoing(list: Ongoing[], onlyUnanswered = false): Ongoing[] {
  const best = new Map<string, Ongoing>()
  for (const o of list) {
    const t = teachTopic(o)
    if (!t) continue
    const b = best.get(t)
    if (!b || turnsOf(o).length > turnsOf(b).length) best.set(t, o)
  }
  return list.filter((o) => {
    const t = teachTopic(o)
    const b = t ? best.get(t) : undefined
    if (!b || b === o) return true
    return onlyUnanswered ? answered(o) : false
  })
}

/**
 * Let go of (Carry on's ×): not brought back by the page still on screen saving itself, nor by
 * another window. Only carrying on in it (a new turn past the count when it was let go) lists it again.
 */
const LET_GO = 'tide.ongoing.letGo'
const letGo = new Map<string, number>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(LET_GO) ?? '{}') as Record<string, number>)
    } catch {
      return []
    }
  })()
)
/** Kept across restarts: a tab restored with the lesson in it doesn't bring it back either */
const keepLetGo = () => {
  try {
    localStorage.setItem(LET_GO, JSON.stringify(Object.fromEntries([...letGo].slice(-50))))
  } catch {
    // no storage (tests)
  }
}
const stillLetGo = (o: Pick<Ongoing, 'key' | 'state'>) => letGo.has(o.key) && turnsOf(o).length <= letGo.get(o.key)!

const store = new Map<string, Ongoing>()
/** The one on screen, saved as it goes but not listed until you leave it (or Tide closes) */
const live = new Map<string, Ongoing>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** In the notes folder beside Tide's other data, written within half a second of each change */
const FILE = '.tide/ongoing.json'
let saving: ReturnType<typeof setTimeout> | undefined
let loaded = false

/** What goes in the file: the lessons left, and the ones on screen in any window */
export function ongoingSnapshot(): Ongoing[] {
  const all = new Map<string, Ongoing>()
  for (const o of [...store.values(), ...live.values()]) if (!isClosedLesson(o) && (!all.has(o.key) || all.get(o.key)!.at < o.at)) all.set(o.key, o)
  return dedupeOngoing([...all.values()], true).sort((a, b) => b.at - a.at).slice(0, 6)
}

const writeNow = () => window.tide.vault.write(FILE, JSON.stringify(ongoingSnapshot())).catch(() => {})

function persist() {
  clearTimeout(saving)
  saving = setTimeout(() => {
    // Not before what was saved last time has been read, or it would be written over
    if (!loaded) return persist()
    void writeNow()
  }, 400)
}

// ---------- Every window holds the same list ----------
// A lesson can be open in a pop-out while the main window lists the others. Each change is passed
// to the other windows as it happens (main/popout relay), so whichever window writes the file next
// writes everything, and none drops what another holds.

type Op = { op: 'set'; o: Ongoing } | { op: 'live'; o: Ongoing } | { op: 'end'; key: string; letGo?: boolean }
const share = (op: Op) => {
  try {
    window.tide?.windows?.relay?.('ongoing', op)
  } catch {
    // one window only
  }
}

/** A change made in another window */
export function applyOngoingOp(op: Op, opts: { follow?: boolean } = {}) {
  if (op.op !== 'end' && stillLetGo(op.o)) return
  if (op.op === 'set') {
    live.delete(op.o.key)
    store.set(op.o.key, op.o)
    // A lesson's window closed while a reply was arriving: this window keeps it coming
    const activeId = (op.o.state as { activeId?: string | null } | null)?.activeId
    if (opts.follow && op.o.busy && activeId) followInBackground(op.o.key, activeId)
  } else if (op.op === 'live') live.set(op.o.key, op.o)
  else {
    const gone = store.get(op.key) ?? live.get(op.key)
    if (op.letGo && gone) (letGo.set(op.key, turnsOf(gone).length), keepLetGo())
    live.delete(op.key)
    store.delete(op.key)
  }
  emit()
}

/** Writes now what would be written in a moment (a window about to close) */
export async function flushOngoing() {
  clearTimeout(saving)
  if (loaded) await writeNow()
  await flushLessons()
}

// ---------- Past lessons: every lesson kept as it goes, to read again or carry on ----------

const lessonTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lessonSaves = new Map<string, () => Promise<unknown>>()

/** Saves at once the lessons waiting for their second to pass */
export async function flushLessons() {
  const saves = [...lessonSaves.values()]
  for (const id of lessonTimers.keys()) clearTimeout(lessonTimers.get(id))
  lessonTimers.clear()
  lessonSaves.clear()
  await Promise.all(saves.map((s) => s()))
}

/** Keeps a lesson in Past lessons (a second after its last change, or now when it finishes) */
export function keepLesson(key: string, view: View, turns: unknown, finished = false, threads?: unknown) {
  if (view.kind !== 'session' || !Array.isArray(turns)) return
  const id = view.lesson ?? lessonId(key)
  clearTimeout(lessonTimers.get(id))
  const save = () => {
    lessonTimers.delete(id)
    lessonSaves.delete(id)
    return window.tide.lessons
      .save({ id, mode: view.mode, topic: view.topic, scope: view.scope, ...(view.options ? { options: view.options } : {}), turns: (turns as { role: 'user' | 'assistant'; content: string }[]).map(({ role, content }) => ({ role, content })), ...(Array.isArray(threads) ? { threads: threads as LessonThread[] } : {}), finished })
      .catch(() => {})
  }
  if (finished) void save()
  else {
    lessonSaves.set(id, save)
    lessonTimers.set(id, setTimeout(save, 1000))
  }
}

/** What was in progress when Tide last closed, the lesson on screen included: back under "In progress" */
export async function loadOngoing() {
  try {
    const read = JSON.parse(await window.tide.vault.read(FILE)) as Ongoing[]
    // Old duplicates of one teach topic (a short copy never answered in) are dropped, once
    const saved = Array.isArray(read) ? dedupeOngoing(read.filter((o) => o?.key && o.view), true) : []
    if (saved.length !== (Array.isArray(read) ? read.length : 0)) persist()
    for (const o of saved) if (o?.key && o.view && !store.has(o.key) && !isClosedLesson(o) && !stillLetGo(o)) store.set(o.key, { ...o, busy: false, ...(o.busy ? { interrupted: true } : {}) })
    // Lessons from before Past lessons existed (or saved while it wasn't running) are kept there too
    for (const o of saved) if (o?.view?.kind === 'session') keepLesson(o.key, o.view, (o.state as { turns?: unknown })?.turns, isClosedLesson(o), (o.state as { threads?: unknown })?.threads)
    emit()
  } catch {
    // nothing saved yet, or unreadable
  }
  loaded = true
  emit()
}
void loadOngoing()

/** Whether the lessons left open last time have been read yet */
export const ongoingLoaded = () => loaded

export function useOngoingLoaded(): boolean {
  const [ready, setReady] = useState(loaded)
  useEffect(() => {
    if (loaded) return setReady(true)
    const l = () => loaded && setReady(true)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return ready
}
try {
  // The main window keeps a reply coming for a lesson whose window closed mid-reply
  const follow = !/[#&]focus=/.test(window.location.hash)
  window.tide?.windows?.onRelay?.((m) => m.channel === 'ongoing' && applyOngoingOp(m.payload as Op, { follow }))
} catch {
  // tests, outside Tide
}

export const sessionKey = (v: { kind: string; mode?: string; topic?: string; nonce?: number }) => `${v.kind}:${v.mode ?? ''}:${v.topic ?? ''}:${v.nonce ?? ''}`

export function saveOngoing(o: Omit<Ongoing, 'at'>) {
  const closed = isClosedLesson(o)
  keepLesson(o.key, o.view, (o.state as { turns?: unknown })?.turns, closed, (o.state as { threads?: unknown })?.threads)
  if (closed) return endOngoing(o.key)
  if (stillLetGo(o)) {
    live.delete(o.key)
    return
  }
  if (letGo.delete(o.key)) keepLetGo()
  live.delete(o.key)
  // The same lesson opened again (from Past lessons, or where something came up) is one entry, not two
  const record = (x: Ongoing) => (x.view.kind === 'session' ? (x.view.lesson ?? lessonId(x.key)) : null)
  const mine = record(o as Ongoing)
  if (mine) for (const x of [...store.values()]) if (x.key !== o.key && record(x) === mine) store.delete(x.key)
  const kept = { ...o, at: Date.now() }
  store.set(o.key, kept)
  // Two entries for one teach topic are one, the one with the most turns: a shorter copy nobody
  // answered in goes (this one too, when a longer one is already listed)
  const merged = new Set(dedupeOngoing([...store.values()], true).map((x) => x.key))
  for (const k of [...store.keys()]) if (!merged.has(k)) store.delete(k)
  // Keep a handful: the oldest go first
  const all = [...store.values()].sort((a, b) => b.at - a.at)
  for (const old of all.slice(6)) store.delete(old.key)
  emit()
  persist()
  share({ op: 'set', o: kept })
}

/** The one on screen, as it goes: kept on disk, listed only if Tide closes before you leave it */
export function keepLive(o: Omit<Ongoing, 'at'>) {
  const closed = isClosedLesson(o)
  keepLesson(o.key, o.view, (o.state as { turns?: unknown })?.turns, closed, (o.state as { threads?: unknown })?.threads)
  if (closed) return endOngoing(o.key)
  if (stillLetGo(o)) return
  if (letGo.delete(o.key)) keepLetGo()
  const kept = { ...o, at: Date.now() }
  live.set(o.key, kept)
  persist()
  share({ op: 'live', o: kept })
}

export const getOngoing = (key: string) => store.get(key)

/** `letGoOf`: the learner let it go (Carry on's ×), so the page on screen saving itself doesn't bring it back */
export function endOngoing(key: string, letGoOf = false) {
  const gone = store.get(key) ?? live.get(key)
  if (letGoOf) (letGo.set(key, gone ? turnsOf(gone).length : 0), keepLetGo())
  live.delete(key)
  if (store.delete(key)) emit()
  persist()
  share({ op: 'end', key, ...(letGoOf ? { letGo: true } : {}) })
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
  const [list, setList] = useState(() => [...store.values()].filter((o) => !isClosedLesson(o)))
  useEffect(() => {
    const l = () => setList([...store.values()].filter((o) => !isClosedLesson(o)).sort((a, b) => b.at - a.at))
    listeners.add(l)
    l()
    return () => {
      listeners.delete(l)
    }
  }, [])
  return list
}
