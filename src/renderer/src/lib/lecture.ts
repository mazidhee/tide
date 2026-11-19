import { useSyncExternalStore } from 'react'
import type { LectureState } from '@shared/types'
import { readyToStart, type LectureMode } from '@shared/lectureScript'

/**
 * Plays tutor replies in the lecture voice (main/lectureVoice makes them). One reply plays at a
 * time: piece by piece as each is made, so it starts as soon as the first piece is ready. Pace and
 * speed change the tempo, not the pitch. Any key, or starting to dictate, stops it (barge-in).
 */

export interface LectureView {
  /** Each reply's progress, by the reply text's id */
  states: Record<string, LectureState>
  /** The reply that's playing or paused, and where */
  playing: { id: string; piece: number; paused: boolean } | null
  speed: number
}

let view: LectureView = { states: {}, playing: null, speed: Number(safeGet('tide.lecture.speed')) || 1 }
const listeners = new Set<() => void>()
const set = (patch: Partial<LectureView>) => {
  view = { ...view, ...patch }
  listeners.forEach((l) => l())
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

let subscribed = false
function subscribeMain() {
  if (subscribed) return
  subscribed = true
  window.tide.lecture.onProgress((st) => {
    set({ states: { ...view.states, [st.id]: st } })
    wake()
  })
}

let pace = 0.92
let audio: HTMLAudioElement | null = null
let waker: (() => void) | null = null
const wake = () => {
  const w = waker
  waker = null
  w?.()
}
let run = 0

const ids = new Map<string, string>()
/** The id main gave this reply (once it's been prepared in this window) */
export const idFor = (reply: string, mode: LectureMode) => ids.get(`${mode}\n${reply}`) ?? null

/** Makes the reply's audio in the background (from the cache when it was made before) */
export async function prepare(reply: string, mode: LectureMode, kokoroVoice: string): Promise<LectureState> {
  subscribeMain()
  const st = await window.tide.lecture.prepare({ reply, mode, kokoroVoice })
  ids.set(`${mode}\n${reply}`, st.id)
  set({ states: { ...view.states, [st.id]: view.states[st.id]?.pieces.length && !st.pieces.length ? view.states[st.id] : st } })
  return st
}

export function setPace(p: number) {
  pace = p
  if (audio) audio.playbackRate = pace * view.speed
}

export function setSpeed(s: number) {
  try {
    localStorage.setItem('tide.lecture.speed', String(s))
  } catch {
    // Kept for this window only
  }
  set({ speed: s })
  if (audio) audio.playbackRate = pace * s
}

/**
 * Plays a reply on its own once enough of it is made to play through without a gap (or after the
 * longest wait), unless something stops it first. Returns false when it was stopped.
 */
export async function autoplay(id: string, since: number): Promise<boolean> {
  const mine = run
  for (;;) {
    if (mine !== run) return false
    const st = view.states[id]
    if (st && readyToStart(st.pieces, Date.now() - since)) break
    await new Promise<void>((r) => ((waker = r), setTimeout(r, 700)))
  }
  if (mine !== run) return false
  void play(id)
  return true
}

/** Plays a reply from its first piece, waiting for each piece as it's made */
export async function play(id: string, from = 0) {
  await playRange(id, from)
}

/**
 * Plays pieces [from, to) of a reply or narration, waiting for each as it's made and holding
 * while paused. Resolves true when it played through, false when something stopped it.
 */
export async function playRange(id: string, from = 0, to = Infinity): Promise<boolean> {
  stop()
  const mine = ++run
  set({ playing: { id, piece: from, paused: false } })
  for (let i = from; i < to; i++) {
    let st = view.states[id]
    while (mine === run && (view.playing?.paused || !st || st.phase === 'script' || (st.pieces[i] && !st.pieces[i].ready && !st.pieces[i].failed))) {
      await new Promise<void>((r) => ((waker = r), setTimeout(r, 1500)))
      st = view.states[id]
    }
    if (mine !== run) return false
    const piece = st.pieces[i]
    if (!piece) break
    if (piece.failed) continue
    const wav = await window.tide.lecture.piece(id, i)
    if (mine !== run) return false
    if (!wav) continue
    set({ playing: { id, piece: i, paused: !!view.playing?.paused } })
    await playWav(wav, mine)
    if (mine !== run) return false
  }
  if (mine !== run) return false
  set({ playing: null })
  return true
}

/** A simulation's tour, made in the professor's voice (from the cache when it was made before) */
export async function narrate(says: string[], kokoroVoice = 'bm_george'): Promise<LectureState> {
  subscribeMain()
  const st = await window.tide.lecture.narrate({ says, kokoroVoice })
  set({ states: { ...view.states, [st.id]: view.states[st.id]?.pieces.some((p) => p.ready) ? view.states[st.id] : st } })
  return st
}

/** Waits until a narration can start and play through without a gap (or the longest wait); false if stopped meanwhile */
export async function whenReady(id: string, since: number, stillWanted: () => boolean): Promise<boolean> {
  for (;;) {
    if (!stillWanted()) return false
    const st = view.states[id]
    if (st && readyToStart(st.pieces, Date.now() - since)) return true
    await new Promise<void>((r) => ((waker = r), setTimeout(r, 700)))
  }
}

/** Outside React (a simulation's frame): told whenever anything changes */
export function subscribe(l: () => void): () => void {
  subscribeMain()
  listeners.add(l)
  return () => listeners.delete(l)
}

export const current = () => view

function playWav(wav: Uint8Array, mine: number): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }))
    const a = new Audio(url)
    a.preservesPitch = true
    a.playbackRate = pace * view.speed
    audio = a
    const done = () => {
      URL.revokeObjectURL(url)
      if (audio === a) audio = null
      resolve()
    }
    a.onended = done
    a.onerror = done
    ;(a as HTMLAudioElement & { _stop?: () => void })._stop = done
    if (view.playing?.paused) a.pause()
    else a.play().catch(done)
    if (mine !== run) (a.pause(), done())
  })
}

export function pause() {
  if (!view.playing) return
  audio?.pause()
  set({ playing: { ...view.playing, paused: true } })
}

export function resume() {
  if (!view.playing) return
  void audio?.play()
  set({ playing: { ...view.playing, paused: false } })
  wake()
}

/** Silences it at once */
export function stop() {
  run++
  if (audio) {
    audio.pause()
    ;(audio as HTMLAudioElement & { _stop?: () => void })._stop?.()
  }
  audio = null
  wake()
  if (view.playing) set({ playing: null })
}

export const isPlaying = () => !!view.playing && !view.playing.paused

export function useLecture(): LectureView {
  subscribeMain()
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => view
  )
}

/** Where a reply is at, for its button: preparing (with progress), ready, playing or paused */
export function lectureLabel(st: LectureState | undefined): string {
  if (!st) return ''
  if (st.phase === 'script') return 'Preparing the voice…'
  const made = st.pieces.filter((p) => p.ready).length
  if (made < st.pieces.length) return `Preparing the voice… ${made}/${st.pieces.length}`
  return ''
}
