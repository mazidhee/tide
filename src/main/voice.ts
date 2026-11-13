import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import SERVER_SCRIPT from './voiceServer.py?raw'
import { getKey, setKey } from './cloud'
import { getSettings } from './settings'
import { noteUse } from './connectionUse'

/**
 * A natural voice for the tutor, made on this Mac: Kokoro (82M parameters, about 25 times faster
 * than real time on an M4 Pro) for speech, and Parakeet for dictation. Both run in a small Python
 * service in Tide's own environment, separate from the AI server, started on first use.
 */

const dir = () => join(app.getPath('userData'), 'voice')
const python = () => join(dir(), 'bin', 'python')
const PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
const SPACY_WHEEL = 'https://huggingface.co/spacy/en_core_web_sm/resolve/main/en_core_web_sm-any-py3-none-any.whl'

export const VOICES = [
  { id: 'bm_george', label: 'Professor', detail: 'British, warm and measured' },
  { id: 'bm_fable', label: 'Fable', detail: 'British, lighter' },
  { id: 'bf_emma', label: 'Emma', detail: 'British' },
  { id: 'af_heart', label: 'Heart', detail: 'American, the clearest' },
  { id: 'am_michael', label: 'Michael', detail: 'American' }
] as const

function run(cmd: string, args: string[], timeoutMs = 20 * 60_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: { PATH, HOME: app.getPath('home') } })
    let out = ''
    let err = ''
    const timer = setTimeout(() => c.kill(), timeoutMs)
    c.stdout.on('data', (d) => (out += d.toString()))
    c.stderr.on('data', (d) => (err += d.toString()))
    c.on('close', (code) => (clearTimeout(timer), resolve({ code: code ?? -1, out, err })))
    c.on('error', (e) => (clearTimeout(timer), resolve({ code: -1, out, err: e.message })))
  })
}

/** mlx-audio needs Python 3.10 or newer; macOS ships 3.9, so prefer Homebrew's */
async function findPython(): Promise<string | null> {
  for (const v of ['3.13', '3.12', '3.11', '3.10']) for (const p of ['/opt/homebrew/bin', '/usr/local/bin']) if (existsSync(`${p}/python${v}`)) return `${p}/python${v}`
  const r = await run('/usr/bin/env', ['python3', '-c', 'import sys; print(sys.version_info >= (3, 10))'])
  return r.out.trim() === 'True' ? '/usr/bin/env python3' : null
}

export async function voiceStatus(): Promise<{ ready: boolean; detail: string }> {
  if (!existsSync(python())) return { ready: false, detail: 'Not set up yet' }
  const r = await run(python(), ['-c', 'import mlx_audio, misaki, en_core_web_sm; print("ok")'], 60_000)
  if (r.code !== 0) return { ready: false, detail: 'Setup didn’t finish. Set it up again.' }
  const espeak = existsSync('/opt/homebrew/lib/libespeak-ng.dylib') || existsSync('/usr/local/lib/libespeak-ng.dylib')
  return { ready: true, detail: `Kokoro voice ready${espeak ? '' : ' (install espeak-ng with Homebrew for rare words)'}` }
}

/**
 * Sets up the voice: its own Python environment with mlx-audio, Kokoro's English text tools, and
 * espeak-ng from Homebrew when Homebrew is there. Models download on first use (about 1 GB).
 */
export async function setupVoice(progress: (step: string) => void): Promise<{ ready: boolean; detail: string }> {
  const py = await findPython()
  if (!py) return { ready: false, detail: 'Needs Python 3.10 or newer. Install it with Homebrew: brew install python' }
  if (!existsSync(python())) {
    progress('Creating Tide’s voice environment…')
    const [cmd, ...pre] = py.split(' ')
    const v = await run(cmd, [...pre, '-m', 'venv', dir()])
    if (v.code !== 0) return { ready: false, detail: `Couldn’t create the environment: ${v.err.slice(0, 200)}` }
  }
  const pip = join(dir(), 'bin', 'pip')
  progress('Installing the voice (about 500 MB)…')
  const p = await run(pip, ['install', '--quiet', '--upgrade', 'pip', 'mlx-audio', 'misaki[en]', 'soundfile', 'spacy>=3.8', 'numpy>=2'])
  if (p.code !== 0) return { ready: false, detail: `Couldn’t install the voice: ${p.err.slice(-300)}` }
  // Kokoro's English needs spaCy's small model; GitHub's copy is often slow, Hugging Face's isn't
  progress('Installing English pronunciation…')
  const wheel = join(dir(), 'en_core_web_sm-3.8.0-py3-none-any.whl')
  if (!existsSync(wheel)) {
    const res = await fetch(SPACY_WHEEL, { signal: AbortSignal.timeout(5 * 60_000) }).catch(() => null)
    if (!res?.ok) return { ready: false, detail: 'Couldn’t download the English model. Check the connection and try again.' }
    await fs.writeFile(wheel, Buffer.from(await res.arrayBuffer()))
  }
  // The published wheel pins an older spaCy (and with it NumPy 1, which mlx-audio can't use); it
  // loads fine with the current one, so install it without its pins
  const s = await run(pip, ['install', '--quiet', '--no-deps', wheel])
  if (s.code !== 0) return { ready: false, detail: `Couldn’t install the English model: ${s.err.slice(-300)}` }
  if (!existsSync('/opt/homebrew/lib/libespeak-ng.dylib') && !existsSync('/usr/local/lib/libespeak-ng.dylib') && existsSync('/opt/homebrew/bin/brew')) {
    progress('Installing espeak-ng for rare words…')
    await run('/opt/homebrew/bin/brew', ['install', 'espeak-ng'])
  }
  progress('Warming up the voice…')
  try {
    await ensureServer()
    await call('/warm', { tts: true }, 5 * 60_000)
  } catch (e) {
    return { ready: false, detail: (e as Error).message }
  }
  return voiceStatus()
}

let server: { child: ChildProcess; port: number } | null = null
let starting: Promise<number> | null = null

async function ensureServer(): Promise<number> {
  if (server && server.child.exitCode === null) return server.port
  if (starting) return starting
  starting = (async () => {
    if (!existsSync(python())) throw new Error('Set up the natural voice in Settings first.')
    const script = join(dir(), 'tide_voice.py')
    await fs.writeFile(script, SERVER_SCRIPT)
    const child = spawn(python(), [script], { env: { PATH, HOME: app.getPath('home'), HF_HUB_DISABLE_TELEMETRY: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    const port = await new Promise<number>((resolve, reject) => {
      let out = ''
      let err = ''
      const timer = setTimeout(() => reject(new Error('The voice took too long to start.')), 60_000)
      child.stdout!.on('data', (d) => {
        out += d.toString()
        const m = out.match(/READY (\d+)/)
        if (m) (clearTimeout(timer), resolve(Number(m[1])))
      })
      child.stderr!.on('data', (d) => (err = (err + d.toString()).slice(-2000)))
      child.on('exit', () => (clearTimeout(timer), reject(new Error(`The voice stopped: ${err.slice(-300)}`))))
    })
    child.on('exit', () => {
      if (server?.child === child) server = null
    })
    server = { child, port }
    return port
  })().finally(() => (starting = null))
  return starting
}

async function call(path: string, body: unknown, timeoutMs = 120_000): Promise<Response> {
  const port = await ensureServer()
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': body instanceof Uint8Array ? 'audio/wav' : 'application/json' },
    body: body instanceof Uint8Array ? Buffer.from(body) : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`Voice: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText}`)
  return res
}

/** One stretch of speech, as WAV bytes */
export async function speak(text: string, voice = 'bm_george', speed = 1): Promise<Uint8Array> {
  noteUse('voice')
  return new Uint8Array(await (await call('/speak', { text, voice, speed })).arrayBuffer())
}

/** Where you were speaking: the topic helps Deepgram spell its jargon */
export type Heard = { path?: string; topic?: string }

/**
 * What was said in a WAV recording. With Deepgram chosen and its key saved, Deepgram's Nova-3
 * writes it out (the lesson's topic is passed as a key term, so its jargon comes out spelled
 * right); otherwise, or when Deepgram fails, Parakeet on this Mac does.
 */
export async function transcribe(wav: Uint8Array, where: Heard = {}): Promise<string> {
  if (getSettings().voice?.dictation === 'deepgram' && getKey(DEEPGRAM)) {
    try {
      noteUse('deepgram')
      return await deepgram(wav, getKey(DEEPGRAM), where.topic)
    } catch (e) {
      if (!existsSync(python())) throw e
    }
  }
  noteUse('voice')
  return ((await (await call('/transcribe', wav)).json()) as { text: string }).text
}

const DEEPGRAM = 'deepgram'

async function deepgram(wav: Uint8Array, key: string, topic?: string): Promise<string> {
  const q = new URLSearchParams({ model: 'nova-3', language: 'en', smart_format: 'true' })
  const term = topic?.replace(/\s+/g, ' ').trim()
  if (term && term.length <= 60) q.append('keyterm', term)
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
    body: Buffer.from(wav),
    signal: AbortSignal.timeout(20_000)
  })
  if (res.status === 401 || res.status === 403) throw new Error('Deepgram didn’t accept the key. Check it in Settings › Voice.')
  if (res.status === 402) throw new Error('Your Deepgram credit has run out. Switch dictation back to Parakeet in Settings › Voice.')
  if (!res.ok) throw new Error(`Deepgram couldn’t write that out (${res.status}).`)
  const j = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } }
  return j.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
}

/** Whether a Deepgram key is saved (the key itself stays in the main process) */
export const hasDeepgram = () => !!getKey(DEEPGRAM)

/** Checks the key on a quarter second of silence (a fraction of a cent), then keeps it in the Keychain */
export async function saveDeepgram(key: string | null): Promise<void> {
  if (!key?.trim()) return setKey(DEEPGRAM, null)
  await deepgram(silence(0.25), key.trim())
  setKey(DEEPGRAM, key.trim())
}

function silence(seconds: number): Uint8Array {
  const n = Math.round(16000 * seconds) * 2
  const v = new DataView(new ArrayBuffer(44 + n))
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 16000, true)
  v.setUint32(28, 32000, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, n, true)
  return new Uint8Array(v.buffer)
}

/** Loads the models ahead of time (opening a lesson with talk on), so the first reply isn't slow */
export async function warmVoice(stt: boolean): Promise<void> {
  await call('/warm', { tts: true, stt }, 5 * 60_000).catch(() => {})
}

export function stopVoice() {
  server?.child.kill()
  server = null
}
