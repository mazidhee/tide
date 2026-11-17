import { app, BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { chunkScript, engineFor, fallbackScript, lengthChoice, pieceTimeout, SCRIPT_SYSTEM, scriptPrompt, sourceOf, spokenWords, stripTags, tidyScript, toneOf, tooSlow, type LectureMode } from '@shared/lectureScript'
import type { LectureState } from '@shared/types'
import { lectureStatus, speak, speakFish, warmFish } from './voice'
import { getSettings } from './settings'

/**
 * The lecture voice for tutor replies. When a reply arrives (Talk on), its spoken script is written
 * (Claude's quick model, or the rules in shared/lectureScript without it), cut into sentence pieces,
 * and each piece made in the background by Fish S2 Pro in the professor's voice: the window plays
 * piece one as soon as it's ready while the rest are made. Scripts and audio are kept per reply, so
 * replaying is instant. Fish failing or too slow: the rest of that reply is Kokoro, with a note.
 * One reply is made at a time; a newer reply goes first.
 */

const root = () => join(app.getPath('userData'), 'lecture-voice')
// By what is said, not how it's marked up: the reply as streamed and as saved give the same id
const idOf = (reply: string, mode: LectureMode) => createHash('sha1').update(`${mode}\n${sourceOf(reply)}`).digest('hex').slice(0, 20)

interface Job {
  state: LectureState
  kokoroVoice: string
  cancelled: boolean
}

const jobs = new Map<string, Job>()
let current: string | null = null
let working = false
const waiting: string[] = []

function publish(st: LectureState) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lecture:progress', st)
}

async function saveState(st: LectureState) {
  await fs.mkdir(join(root(), st.id), { recursive: true })
  await fs.writeFile(join(root(), st.id, 'state.json'), JSON.stringify(st))
}

async function loadState(id: string): Promise<LectureState | null> {
  try {
    const st = JSON.parse(await fs.readFile(join(root(), id, 'state.json'), 'utf8')) as LectureState
    // Only pieces whose audio is on disk count as made
    st.pieces = st.pieces.map((p) => ({ ...p, ready: p.ready && existsSync(pieceFile(id, st.pieces.indexOf(p))) }))
    return st
  } catch {
    return null
  }
}

const pieceFile = (id: string, i: number) => join(root(), id, `${i}.wav`)

/** The spoken script: Claude's quick model, else the rules */
async function writeScript(reply: string, mode: LectureMode): Promise<{ script: string; by: 'claude' | 'rules'; ms: number }> {
  const t0 = Date.now()
  const source = sourceOf(reply)
  const length = lengthChoice(source, mode)
  const claudeOn = getSettings().ai?.claude?.teacher !== 'gemma'
  if (claudeOn) {
    try {
      const { claudeOnce, claudeReady } = await import('./claudeEngine')
      if ((await claudeReady()).ready) {
        const r = await claudeOnce(scriptPrompt(source, toneOf(reply), length), SCRIPT_SYSTEM, 'background', AbortSignal.timeout(25_000), 'haiku', [], 'background')
        const script = tidyScript(r.text, source)
        if (spokenWords(script) > 0) return { script, by: 'claude', ms: Date.now() - t0 }
      }
    } catch {
      // The rules below
    }
  }
  return { script: fallbackScript(reply, mode), by: 'rules', ms: Date.now() - t0 }
}

/**
 * Starts (or finds) a reply's lecture audio and returns where it's at; progress follows on
 * 'lecture:progress'. A reply already made comes straight back, ready.
 */
export async function prepareLecture(req: { reply: string; mode?: LectureMode; kokoroVoice?: string }): Promise<LectureState> {
  const mode = req.mode ?? 'all'
  const id = idOf(req.reply, mode)
  const live = jobs.get(id)
  if (live) {
    bump(id)
    return live.state
  }
  const saved = await loadState(id)
  if (saved && saved.phase === 'done' && saved.pieces.every((p) => p.ready)) return saved
  const st: LectureState = saved ?? { id, phase: 'script', pieces: [], startedAt: Date.now() }
  if (saved) Object.assign(st, { phase: 'audio', startedAt: Date.now(), firstAudioMs: undefined, totalMs: undefined })
  jobs.set(id, { state: st, kokoroVoice: req.kokoroVoice ?? 'bm_george', cancelled: false })
  bump(id)
  void run(id, req.reply, mode)
  return st
}

/** The newest request is made first */
function bump(id: string) {
  const i = waiting.indexOf(id)
  if (i >= 0) waiting.splice(i, 1)
  waiting.unshift(id)
}

async function run(id: string, reply: string, mode: LectureMode) {
  const job = jobs.get(id)!
  const st = job.state
  if (!st.script || !st.pieces.length) {
    // The script is kept per reply: written once, even when its audio is made again
    const s = st.script ? { script: st.script, by: st.scriptBy ?? 'rules', ms: 0 } : await writeScript(reply, mode)
    st.script = s.script
    st.scriptBy = s.by
    st.scriptMs ??= s.ms
    const lecture = (getSettings().voice?.lecture ?? 'fish') === 'fish'
    const ready = lecture && (await lectureStatus()).ready
    if (lecture && !ready) st.note = 'The lecture voice isn’t set up, so Kokoro is speaking.'
    st.pieces = chunkScript(s.script).map((text) => ({ text, engine: engineFor(s.script, { lecture, ready, fellBack: false }), ready: false }))
    st.phase = 'audio'
    publish(st)
    await saveState(st)
  }
  void drain()
}

async function drain() {
  if (working) return
  working = true
  try {
    for (;;) {
      const id = waiting.find((x) => jobs.get(x)?.state.pieces.some((p) => !p.ready && !p.failed))
      if (!id) break
      current = id
      const job = jobs.get(id)!
      const st = job.state
      const i = st.pieces.findIndex((p) => !p.ready && !p.failed)
      const piece = st.pieces[i]
      const t0 = Date.now()
      let wav: Uint8Array | null = null
      if (piece.engine === 'fish') {
        try {
          wav = await speakFish(piece.text, 'professor', pieceTimeout(spokenWords(piece.text)))
          if (tooSlow(Date.now() - t0, spokenWords(piece.text))) fallBack(st, 'The lecture voice was slow, so Kokoro is saying the rest.')
        } catch {
          fallBack(st, 'The lecture voice didn’t answer, so Kokoro is saying this.')
          piece.engine = 'kokoro'
        }
      }
      if (!wav) {
        try {
          wav = await speak(stripTags(piece.text), job.kokoroVoice, 1)
        } catch {
          piece.failed = true
        }
      }
      if (wav) {
        await fs.mkdir(join(root(), id), { recursive: true })
        await fs.writeFile(pieceFile(id, i), wav)
        piece.ready = true
        piece.ms = Date.now() - t0
        piece.secs = wavSeconds(wav)
        if (i === 0) st.firstAudioMs = Date.now() - st.startedAt
      }
      if (st.pieces.every((p) => p.ready || p.failed)) {
        st.phase = 'done'
        st.totalMs = Date.now() - st.startedAt
        jobs.delete(id)
        const w = waiting.indexOf(id)
        if (w >= 0) waiting.splice(w, 1)
      }
      publish(st)
      await saveState(st)
    }
  } finally {
    working = false
    current = null
  }
}

/** How long a 16-bit mono WAV plays */
function wavSeconds(wav: Uint8Array): number {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const rate = wav.byteLength > 28 ? v.getUint32(24, true) : 0
  return rate ? (wav.byteLength - 44) / 2 / rate : 0
}

/** Fish let this reply down: what's left of it is Kokoro */
function fallBack(st: LectureState, note: string) {
  st.note = note
  for (const p of st.pieces) if (!p.ready) p.engine = 'kokoro'
}

/** One piece's audio (WAV) */
export async function lecturePiece(id: string, i: number): Promise<Uint8Array | null> {
  const f = pieceFile(id, i)
  return existsSync(f) ? new Uint8Array(await fs.readFile(f)) : null
}

/** The voice is going to be needed (a lesson opened with Talk on): load Fish now */
export async function warmLecture(): Promise<void> {
  if ((getSettings().voice?.lecture ?? 'fish') !== 'fish' || !(await lectureStatus()).ready) return
  await warmFish()
}

export const lectureBusy = () => current

export function registerLecture(handle: <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => void) {
  handle('lecture:prepare', (req: { reply: string; mode?: LectureMode; kokoroVoice?: string }) => prepareLecture(req))
  handle('lecture:piece', (id: string, i: number) => lecturePiece(id, i))
  handle('lecture:status', () => lectureStatus())
  handle('lecture:warm', () => warmLecture())
}
