import { app } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { KOKORO_VOICES, speechKey, type TtsEngineInfo, type TtsVoice } from '@shared/speech'
import { speak, voiceStatus } from './voice'

/**
 * Speech engines for reading aloud (shared/speech). An engine says what it is and makes WAV audio
 * from text; Tide keeps what it made in a cache, so a chapter is made once, and makes the next
 * chapter ahead of time while nothing else is being spoken. Kokoro (main/voice) is the engine now.
 * A better voice is added by registering another engine here: nothing else changes. No engine
 * downloads a model without being set up first in Settings.
 */

export interface TtsEngine {
  id: string
  label: string
  local: boolean
  multiVoice: boolean
  voices(): TtsVoice[]
  status(): Promise<{ ready: boolean; detail: string }>
  synth(text: string, voice: string, speed: number): Promise<Uint8Array>
}

export const kokoro: TtsEngine = {
  id: 'kokoro',
  label: 'Kokoro (on this Mac)',
  local: true,
  multiVoice: true,
  voices: () => KOKORO_VOICES,
  status: voiceStatus,
  synth: (text, voice, speed) => speak(text, voice, speed)
}

const engines = new Map<string, TtsEngine>([[kokoro.id, kokoro]])

/** A new engine (a better voice), ready to be chosen per book */
export function registerEngine(e: TtsEngine) {
  engines.set(e.id, e)
}

export const engineOf = (id: string | undefined) => engines.get(id ?? '') ?? kokoro

export async function listEngines(): Promise<TtsEngineInfo[]> {
  return Promise.all(
    [...engines.values()].map(async (e) => {
      const s = await e.status().catch(() => ({ ready: false, detail: 'Unavailable' }))
      return { id: e.id, label: e.label, local: e.local, ready: s.ready, detail: s.detail, voices: e.voices(), multiVoice: e.multiVoice }
    })
  )
}

// ---------- The cache ----------

let cacheRoot: string | null = null
const cacheDir = () => (cacheRoot ??= join(app.getPath('userData'), 'reading-audio'))
/** Tests point the cache elsewhere */
export const setCacheDir = (dir: string) => (cacheRoot = dir)
const fileFor = (key: string) => join(cacheDir(), key.slice(0, 2), `${key}.wav`)
const MAX_CACHE = 600 * 1024 * 1024

export async function cached(engine: string, voice: string, speed: number, text: string): Promise<Uint8Array | null> {
  const f = fileFor(speechKey(engine, voice, speed, text))
  return existsSync(f) ? new Uint8Array(await fs.readFile(f)) : null
}

/** When something is being spoken now: the background work waits */
let lastAsked = 0

/** A piece of speech: from the cache, else made now and kept */
export async function synth(engineId: string, text: string, voice: string, speed: number, background = false): Promise<Uint8Array> {
  if (!background) lastAsked = Date.now()
  const e = engineOf(engineId)
  const hit = await cached(e.id, voice, speed, text)
  if (hit) return hit
  const wav = await e.synth(text, voice, speed)
  const f = fileFor(speechKey(e.id, voice, speed, text))
  await fs.mkdir(join(f, '..'), { recursive: true })
  await fs.writeFile(f, wav)
  void trim().catch(() => {})
  return wav
}

let trimming = false
/** Oldest audio goes first once the cache passes its size */
async function trim() {
  if (trimming) return
  trimming = true
  try {
    const files: { f: string; size: number; at: number }[] = []
    for (const d of await fs.readdir(cacheDir()).catch(() => [])) {
      for (const n of await fs.readdir(join(cacheDir(), d)).catch(() => [])) {
        const f = join(cacheDir(), d, n)
        const s = await fs.stat(f).catch(() => null)
        if (s) files.push({ f, size: s.size, at: s.mtimeMs })
      }
    }
    let total = files.reduce((n, x) => n + x.size, 0)
    for (const x of files.sort((a, b) => a.at - b.at)) {
      if (total <= MAX_CACHE) break
      await fs.rm(x.f, { force: true })
      total -= x.size
    }
  } finally {
    trimming = false
  }
}

// ---------- Ahead of time ----------

interface Job {
  key: string
  engine: string
  voice: string
  speed: number
  pieces: { text: string; voice: string }[]
}

const queue: Job[] = []
let running = false
const IDLE_MS = 4000

/**
 * Makes a chapter's audio in the background: one piece at a time, only while nothing is being
 * spoken (it waits while you listen), and only with an engine that's set up. A later request for
 * the same chapter replaces the earlier one.
 */
export async function prerender(job: Job): Promise<{ queued: boolean; reason?: string }> {
  const e = engineOf(job.engine)
  const s = await e.status().catch(() => ({ ready: false, detail: '' }))
  if (!s.ready) return { queued: false, reason: 'The voice isn’t set up.' }
  const i = queue.findIndex((j) => j.key === job.key)
  if (i >= 0) queue.splice(i, 1)
  queue.push(job)
  if (queue.length > 3) queue.shift()
  void drain()
  return { queued: true }
}

async function drain() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const job = queue[0]
      const piece = job.pieces.shift()
      if (!piece) {
        queue.shift()
        continue
      }
      // Wait while something is being listened to: the voice is busy with that
      while (Date.now() - lastAsked < IDLE_MS) await new Promise((r) => setTimeout(r, 1000))
      await synth(job.engine, piece.text, piece.voice, job.speed, true).catch(() => {})
    }
  } finally {
    running = false
  }
}

/** How many of these pieces are already made */
export async function cachedCount(engine: string, speed: number, pieces: { text: string; voice: string }[]): Promise<number> {
  let n = 0
  for (const p of pieces) if (existsSync(fileFor(speechKey(engineOf(engine).id, p.voice, speed, p.text)))) n++
  return n
}

export function registerTts(handle: <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => void) {
  handle('tts:engines', () => listEngines())
  handle('tts:synth', (engine: string, text: string, voice: string, speed: number) => synth(engine, text, voice, speed))
  handle('tts:prerender', (job: Job) => prerender(job))
  handle('tts:cachedCount', (engine: string, speed: number, pieces: { text: string; voice: string }[]) => cachedCount(engine, speed, pieces))
}
