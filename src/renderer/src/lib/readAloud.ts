import { useEffect, useState } from 'react'
import type { BookVoice, ReaderChapter } from '@shared/readingRoom'
import { chapterName } from '@shared/readingRoom'
import { dialogueVoices, pieceAt, speechKey, speechPlan, speechSeconds, type SpeechPiece, type TtsEngineInfo } from '@shared/speech'

/**
 * Reading a book aloud, for the whole window: one player, so it keeps going while you move to the
 * IDE or a note (the mini player shows the line being read), and the reader lights up that line
 * when the book is open. Speech comes from the book's engine (main/tts: Kokoro now) a piece at a
 * time, the next two made while one plays, and the next chapter is made ahead in the background.
 * Without a voice set up, the Mac's own voice reads instead, with the same line-by-line sync.
 */

export interface PlayerState {
  path: string
  title: string
  chapters: ReaderChapter[]
  chapter: number
  plan: SpeechPiece[]
  index: number
  playing: boolean
  loading: boolean
  voice: BookVoice
  /** Using the Mac's voice: Kokoro isn't set up */
  system: boolean
  error?: string
}

export const DEFAULT_BOOK_VOICE: BookVoice = { engine: 'kokoro', narrator: 'bm_george', characters: false, speed: 1 }
export const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5]

let state: PlayerState | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function usePlayer(): PlayerState | null {
  const [, tick] = useState(0)
  useEffect(() => {
    const l = () => tick((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return state
}

export const playerState = () => state

let engines: Promise<TtsEngineInfo[]> | null = null
export const ttsEngines = () => (engines ??= window.tide.tts.engines().catch(() => []))
export const resetEngines = () => (engines = null)

let ctx: AudioContext | null = null
const audio = () => (ctx ??= new AudioContext())
let source: AudioBufferSourceNode | null = null
/** Made or being made, by piece index */
const made = new Map<number, Promise<AudioBuffer>>()
let run = 0

const speedOf = (v: BookVoice) => v.speed ?? 1

function planFor(chapters: ReaderChapter[], chapter: number, voice: BookVoice, unit = 0, offset = 0): SpeechPiece[] {
  const c = chapters[chapter]
  if (!c) return []
  return speechPlan(c.units, { narrator: voice.narrator, dialogue: voice.characters ? dialogueVoices(voice.narrator) : undefined, fromUnit: unit, fromOffset: offset })
}

function make(i: number): Promise<AudioBuffer> {
  const s = state!
  const hit = made.get(i)
  if (hit) return hit
  const p = s.plan[i]
  const job = window.tide.tts.synth(s.voice.engine, p.text, p.voice, speedOf(s.voice)).then((wav) => audio().decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer))
  made.set(i, job)
  job.catch(() => made.delete(i))
  return job
}

/** Starts reading a book aloud from a place (a chapter, a unit in it, a character in that unit) */
export async function startReading(o: { path: string; title: string; chapters: ReaderChapter[]; chapter: number; unit?: number; offset?: number; voice?: BookVoice }) {
  stopAudio()
  const voice = o.voice ?? state?.voice ?? DEFAULT_BOOK_VOICE
  const ready = (await ttsEngines()).find((e) => e.id === voice.engine)?.ready ?? false
  state = { path: o.path, title: o.title, chapters: o.chapters, chapter: o.chapter, plan: planFor(o.chapters, o.chapter, voice, o.unit, o.offset), index: 0, playing: true, loading: true, voice, system: !ready }
  made.clear()
  emit()
  void ahead()
  play(++run)
}

function stopAudio() {
  run++
  if (source) {
    source.onended = null
    try {
      source.stop()
    } catch {
      // Already stopped
    }
    source = null
  }
  window.speechSynthesis?.cancel()
}

async function play(r: number) {
  const s = state
  if (!s || r !== run || !s.playing) return
  if (s.index >= s.plan.length) return nextChapter(r)
  const piece = s.plan[s.index]
  if (s.system) return playSystem(r, piece)
  try {
    s.loading = !made.has(s.index)
    emit()
    const buffer = await make(s.index)
    // The next two are made while this one plays
    for (let k = 1; k <= 2; k++) if (s.index + k < s.plan.length) make(s.index + k).catch(() => {})
    if (r !== run || !state?.playing) return
    s.loading = false
    emit()
    const src = audio().createBufferSource()
    src.buffer = buffer
    src.connect(audio().destination)
    src.onended = () => {
      if (r !== run) return
      s.index++
      emit()
      play(r)
    }
    source = src
    if (audio().state === 'suspended') await audio().resume()
    src.start()
  } catch (e) {
    // Kokoro failed (not set up, or stopped): the Mac's voice carries on from here
    s.system = true
    s.error = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    playSystem(r, piece)
  }
}

function playSystem(r: number, piece: SpeechPiece) {
  const s = state!
  s.loading = false
  emit()
  const u = new SpeechSynthesisUtterance(piece.text)
  const voices = window.speechSynthesis.getVoices()
  u.voice = voices.find((v) => /premium|enhanced/i.test(v.name) && v.lang.startsWith('en')) ?? voices.find((v) => v.lang.startsWith('en') && v.localService) ?? null
  u.rate = speedOf(s.voice)
  const started = Date.now()
  // A voice that can't speak ends at once: stop there rather than race through the book
  const fail = () => {
    if (r !== run) return
    s.playing = false
    s.error = 'The Mac’s voice couldn’t read this. Set up the natural voice in Settings › Voice.'
    emit()
  }
  u.onerror = fail
  u.onend = () => {
    if (r !== run) return
    if (Date.now() - started < 120 && piece.text.length > 24) return fail()
    s.index++
    emit()
    play(r)
  }
  window.speechSynthesis.speak(u)
}

function nextChapter(r: number) {
  const s = state!
  if (s.chapter + 1 >= s.chapters.length) {
    s.playing = false
    emit()
    return
  }
  s.chapter++
  s.plan = planFor(s.chapters, s.chapter, s.voice)
  s.index = 0
  made.clear()
  emit()
  void ahead()
  play(r)
}

/** The next chapter made ahead in the background (main/tts waits while this one is being spoken) */
async function ahead() {
  const s = state
  if (!s || s.system || s.chapter + 1 >= s.chapters.length) return
  await prerenderChapter(s.path, s.chapters, s.chapter + 1, s.voice)
}

export async function prerenderChapter(path: string, chapters: ReaderChapter[], chapter: number, voice: BookVoice) {
  const pieces = planFor(chapters, chapter, voice).map((p) => ({ text: p.text, voice: p.voice }))
  if (!pieces.length) return
  await window.tide.tts.prerender({ key: speechKey(voice.engine, voice.narrator, speedOf(voice), `${path}#${chapter}`), engine: voice.engine, voice: voice.narrator, speed: speedOf(voice), pieces }).catch(() => {})
}

export function pause() {
  if (!state) return
  stopAudio()
  state.playing = false
  state.loading = false
  emit()
}

export function resume() {
  if (!state) return
  state.playing = true
  state.error = undefined
  emit()
  play(++run)
}

export function toggle() {
  if (state?.playing) pause()
  else resume()
}

export function stop() {
  stopAudio()
  state = null
  made.clear()
  emit()
}

/** Go to a place: the piece there plays next */
export function seek(chapter: number, unit: number, offset = 0) {
  const s = state
  if (!s) return
  const wasPlaying = s.playing
  stopAudio()
  if (chapter !== s.chapter) {
    s.chapter = chapter
    s.plan = planFor(s.chapters, chapter, s.voice)
    made.clear()
  }
  s.index = pieceAt(s.plan, unit, offset)
  emit()
  if (wasPlaying) play(++run)
}

/** A step back or on, by piece */
export function skip(by: number) {
  const s = state
  if (!s) return
  const p = s.plan[Math.max(0, Math.min(s.plan.length - 1, s.index + by))]
  if (p) seek(s.chapter, p.unit, p.start)
}

/** A new voice or speed: the plan is remade from the piece being read */
export function setVoice(voice: BookVoice) {
  const s = state
  if (!s) return
  const here = s.plan[s.index]
  const wasPlaying = s.playing
  stopAudio()
  s.voice = voice
  s.plan = planFor(s.chapters, s.chapter, voice, here?.unit ?? 0, here?.start ?? 0)
  s.index = 0
  made.clear()
  emit()
  void ahead()
  if (wasPlaying) play(++run)
}

/** What's left of the chapter, read aloud */
export function secondsLeft(s: PlayerState): number {
  return s.plan.slice(s.index).reduce((n, p) => n + speechSeconds(p.text, speedOf(s.voice)), 0)
}

export const nowPiece = (s: PlayerState | null) => (s ? (s.plan[s.index] ?? null) : null)
export const chapterTitle = (s: PlayerState) => (s.chapters[s.chapter] ? chapterName(s.chapters[s.chapter]) : '')
