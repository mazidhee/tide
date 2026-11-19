import { useEffect, useState } from 'react'
import type { BookVoice, ReaderChapter } from '@shared/readingRoom'
import { chapterName, minutesFor, progressAt, whereLine, wordsLeft } from '@shared/readingRoom'
import { dialogueVoices, pieceAt, speechKey, speechPlan, speechSeconds, type SpeechPiece, type TtsEngineInfo } from '@shared/speech'
import { resumePlace, type ListenPlace } from '@shared/narration'

/**
 * Reading a book aloud, for the whole window: one player, so it keeps going while you move to the
 * IDE or a note (the mini player shows the line being read), and the reader lights up that line
 * when the book is open. Speech comes from the book's engine (main/tts: Kokoro, or the professor)
 * a piece at a time, the next two made while one plays (more for the professor, who is slower to
 * make than to hear), and the next chapter is made ahead in the background. The professor failing
 * hands the rest to Kokoro; without a voice set up, the Mac's own voice reads instead, with the
 * same line-by-line sync. Where you are listening is kept as it goes, to the sentence: Listen picks
 * up there, after a pause, a closed window or a restart.
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
  /** Said quietly: who stood in for the chosen voice */
  note?: string
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

let source: HTMLAudioElement | null = null
let sourceUrl = ''
/** Made or being made, by piece index */
const made = new Map<number, Promise<Uint8Array>>()
let run = 0

const speedOf = (v: BookVoice) => v.speed ?? 1
let engineList: TtsEngineInfo[] = []
void ttsEngines().then((l) => (engineList = l))
const engineInfo = (id: string) => engineList.find((e) => e.id === id)
/** The speed the audio is made at (an engine made at one speed is sped up as it plays, pitch kept) */
const madeSpeed = (v: BookVoice) => (engineInfo(v.engine)?.speedInPlayer ? 1 : speedOf(v))
const playRate = (v: BookVoice) => (engineInfo(v.engine)?.speedInPlayer ? speedOf(v) : 1)
/** How many pieces are made ahead of the one playing */
const lookahead = (v: BookVoice) => (engineInfo(v.engine)?.slow ? 6 : 2)

// ---------- Where you were listening ----------

const placeKey = (path: string) => `tide.listen.at:${path}`

/** Where you stopped listening in a book, to the sentence */
export function listenPlace(path: string): ListenPlace | null {
  try {
    const v = JSON.parse(localStorage.getItem(placeKey(path)) ?? 'null') as ListenPlace | null
    return v && Number.isFinite(v.chapter) && Number.isFinite(v.unit) ? v : null
  } catch {
    return null
  }
}

let placeTimer: ReturnType<typeof setTimeout> | undefined
let placeUnit = ''
/** Keeps the place being read: the sentence here at once, the book's place a moment later */
function keepPlace(now = false) {
  const s = state
  const p = s?.plan[s.index]
  if (!s || !p) return
  try {
    localStorage.setItem(placeKey(s.path), JSON.stringify({ chapter: s.chapter, unit: p.unit, offset: p.start }))
  } catch {
    // Kept for the book's place below
  }
  const unitKey = `${s.path}#${s.chapter}#${p.unit}`
  if (unitKey === placeUnit && !now) return
  placeUnit = unitKey
  clearTimeout(placeTimer)
  const save = () => {
    const c = s.chapters[s.chapter]
    const u = c?.units[p.unit]
    if (!c || !u) return
    window.tide.room.progress(s.path, { loc: u.loc, progress: progressAt(s.chapters, { chapter: s.chapter, unit: p.unit }), label: chapterName(c), where: whereLine(u.text), chapterLeft: minutesFor(wordsLeft(c, p.unit), 220) }).catch(() => {})
  }
  if (now) save()
  else placeTimer = setTimeout(save, 1500)
}

function planFor(chapters: ReaderChapter[], chapter: number, voice: BookVoice, unit = 0, offset = 0): SpeechPiece[] {
  const c = chapters[chapter]
  if (!c) return []
  return speechPlan(c.units, { narrator: voice.narrator, dialogue: voice.characters ? dialogueVoices(voice.narrator) : undefined, fromUnit: unit, fromOffset: offset })
}

function make(i: number): Promise<Uint8Array> {
  const s = state!
  const hit = made.get(i)
  if (hit) return hit
  const p = s.plan[i]
  const job = window.tide.tts.synth(s.voice.engine, p.text, p.voice, madeSpeed(s.voice))
  made.set(i, job)
  job.catch(() => made.delete(i))
  return job
}

/** Starts reading a book aloud from a place (a chapter, a unit in it, a character in that unit) */
export async function startReading(o: { path: string; title: string; chapters: ReaderChapter[]; chapter: number; unit?: number; offset?: number; voice?: BookVoice }) {
  stopAudio()
  let voice = o.voice ?? state?.voice ?? DEFAULT_BOOK_VOICE
  engineList = await ttsEngines()
  let ready = engineInfo(voice.engine)?.ready ?? false
  let note: string | undefined
  // The professor not set up: Kokoro reads, if it is
  if (!ready && voice.engine !== DEFAULT_BOOK_VOICE.engine && engineInfo(DEFAULT_BOOK_VOICE.engine)?.ready) {
    note = `${engineInfo(voice.engine)?.detail ?? 'That voice isn’t set up'}, so George is reading.`
    voice = DEFAULT_BOOK_VOICE
    ready = true
  }
  // Where you stopped listening, to the sentence, when it's the paragraph you're starting from
  const at = o.offset === undefined ? resumePlace(listenPlace(o.path), { chapter: o.chapter, unit: o.unit ?? 0 }) : { chapter: o.chapter, unit: o.unit ?? 0, offset: o.offset }
  state = { path: o.path, title: o.title, chapters: o.chapters, chapter: o.chapter, plan: planFor(o.chapters, o.chapter, voice, at.unit, at.offset), index: 0, playing: true, loading: true, voice, system: !ready, note }
  made.clear()
  emit()
  void ahead()
  play(++run)
}

function stopAudio() {
  run++
  if (source) {
    source.onended = null
    source.onerror = null
    source.pause()
    source = null
  }
  if (sourceUrl) URL.revokeObjectURL(sourceUrl)
  sourceUrl = ''
  window.speechSynthesis?.cancel()
}

async function play(r: number) {
  const s = state
  if (!s || r !== run || !s.playing) return
  if (s.index >= s.plan.length) return nextChapter(r)
  const piece = s.plan[s.index]
  keepPlace()
  if (s.system) return playSystem(r, piece)
  try {
    s.loading = !made.has(s.index)
    emit()
    const wav = await make(s.index)
    // The next ones are made while this one plays, in order
    void aheadOf(r, s.index)
    if (r !== run || !state?.playing) return
    s.loading = false
    emit()
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    sourceUrl = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }))
    const a = new Audio(sourceUrl)
    a.preservesPitch = true
    a.playbackRate = playRate(s.voice)
    const next = () => {
      if (r !== run) return
      s.index++
      emit()
      play(r)
    }
    a.onended = next
    a.onerror = next
    source = a
    await a.play()
  } catch (e) {
    if (r !== run) return
    const message = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    // The professor didn't answer: Kokoro reads on from this sentence
    if (s.voice.engine !== DEFAULT_BOOK_VOICE.engine && engineInfo(DEFAULT_BOOK_VOICE.engine)?.ready) {
      s.note = 'The professor’s voice didn’t answer, so George is reading.'
      s.voice = { ...DEFAULT_BOOK_VOICE, speed: s.voice.speed }
      s.plan = planFor(s.chapters, s.chapter, s.voice, piece.unit, piece.start)
      s.index = 0
      made.clear()
      emit()
      return play(r)
    }
    // Kokoro failed (not set up, or stopped): the Mac's voice carries on from here
    s.system = true
    s.error = message
    playSystem(r, piece)
  }
}

/** Makes the pieces after one, one at a time (the voice makes one at a time anyway), so the nearest is first */
async function aheadOf(r: number, from: number) {
  const s = state
  if (!s) return
  for (let k = 1; k <= lookahead(s.voice) && from + k < s.plan.length; k++) {
    if (r !== run || state !== s) return
    await make(from + k).catch(() => {})
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
  engineList = await ttsEngines()
  await window.tide.tts.prerender({ key: speechKey(voice.engine, voice.narrator, madeSpeed(voice), `${path}#${chapter}`), engine: voice.engine, voice: voice.narrator, speed: madeSpeed(voice), pieces }).catch(() => {})
}

export function pause() {
  if (!state) return
  stopAudio()
  keepPlace(true)
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
  keepPlace(true)
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
  s.note = undefined
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
