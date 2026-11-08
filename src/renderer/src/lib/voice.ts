import { splitSay } from '@shared/characters'

/**
 * The tutor's voice in the window: text is spoken a sentence at a time, the next sentence made
 * while the current one plays, so speech starts within about a second however long the answer.
 * Uses Tide's natural voice when it's set up, the Mac's own voices otherwise.
 */

type VoicePrefs = { engine: 'natural' | 'system'; name: string; speed: number }
export const DEFAULT_VOICE: VoicePrefs = { engine: 'natural', name: 'bm_george', speed: 1 }

/** Text to speak: Markdown, LaTeX and code reduced to plain words */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (formula) ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\d+\]/g, '')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\(frac|cdot|times|log|sqrt|sum|int|left|right|text)/g, ' ')
    .replace(/[*_#>`[\]{}|\\^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Splits into sentences, joining very short ones so the voice doesn't sound clipped */
export function sentences(text: string): string[] {
  const parts = text.match(/[^.!?;:]+[.!?;:]+["')\]]*\s*|[^.!?;:]+$/g) ?? []
  const out: string[] = []
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    if (out.length && (out[out.length - 1].length < 40 || p.length < 12)) out[out.length - 1] += ' ' + p
    else out.push(p)
  }
  return out
}

let naturalReady: Promise<boolean> | null = null
const hasNatural = () => (naturalReady ??= window.tide.voice.status().then((s) => s.ready).catch(() => false))
/** Settings changed (voice set up): look again */
export const resetVoiceStatus = () => (naturalReady = null)

let ctx: AudioContext | null = null
const audio = () => (ctx ??= new AudioContext())

/** A queue of speech: push sentences in, they play in order; stop() silences it at once */
export class Speaker {
  private queue: Promise<void> = Promise.resolve()
  private stopped = false
  private sources = new Set<AudioBufferSourceNode>()
  private pending = 0
  onIdle?: () => void

  constructor(private prefs: VoicePrefs) {}

  get speaking() {
    return this.pending > 0
  }

  say(text: string) {
    const clean = speakable(text)
    if (!clean || this.stopped) return
    for (const s of sentences(clean)) {
      this.pending++
      // Make the audio now (in parallel with what's playing), play it when its turn comes
      const made = this.make(s)
      this.queue = this.queue.then(async () => {
        try {
          const play = await made
          if (!this.stopped) await play()
        } catch {
          // A sentence that couldn't be spoken is skipped
        } finally {
          if (--this.pending === 0) this.onIdle?.()
        }
      })
    }
  }

  stop() {
    this.stopped = true
    for (const s of this.sources) s.stop()
    this.sources.clear()
    window.speechSynthesis.cancel()
  }

  private async make(text: string): Promise<() => Promise<void>> {
    if (this.prefs.engine === 'natural' && (await hasNatural())) {
      const wav = await window.tide.voice.speak(text, this.prefs.name, this.prefs.speed)
      const buffer = await audio().decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer)
      return () =>
        new Promise<void>((resolve) => {
          if (this.stopped) return resolve()
          const src = audio().createBufferSource()
          src.buffer = buffer
          src.connect(audio().destination)
          src.onended = () => (this.sources.delete(src), resolve())
          this.sources.add(src)
          src.start()
        })
    }
    return () =>
      new Promise<void>((resolve) => {
        if (this.stopped) return resolve()
        const u = new SpeechSynthesisUtterance(text)
        const voices = window.speechSynthesis.getVoices()
        u.voice = voices.find((v) => /premium|enhanced/i.test(v.name) && v.lang.startsWith('en')) ?? voices.find((v) => v.lang.startsWith('en') && v.localService) ?? null
        u.rate = 1.02 * this.prefs.speed
        u.onend = () => resolve()
        u.onerror = () => resolve()
        window.speechSynthesis.speak(u)
      })
  }
}

/**
 * Speaks a reply while it's still being written. In Talk the tutor opens with a short spoken part
 * (<say>…</say>), and only that is read, sentence by sentence as it arrives: speech starts about a
 * second after the reply does, and long answers stay on screen instead of being read out. A reply
 * without one gets its opening sentences read, never the whole thing.
 */
export class LiveSpeaker {
  private spoken = 0
  private sayDone = false
  private finished = false
  private askSpoken = false
  constructor(private speaker: Speaker) {}

  update(textSoFar: string, done = false) {
    if (this.finished) return
    const { say, closed } = splitSay(textSoFar)
    if (say !== null && !this.sayDone) {
      const end = closed || done ? say.length : lastSentenceEnd(say)
      if (end > this.spoken) {
        this.speaker.say(say.slice(this.spoken, end))
        this.spoken = end
      }
      if (closed || done) this.sayDone = true
      if (!this.sayDone) return
    }
    // The question itself is always read out (an interviewer asks it; it isn't left on the screen)
    const ask = textSoFar.match(/<ask\b[^>]*>([\s\S]*?)<\/ask>/)
    if (ask && !this.askSpoken) {
      this.askSpoken = true
      const q = ask[1].replace(/<[^>]+>/g, ' ').trim()
      // Don't say it twice if the spoken part already asked it
      if (!say || !overlaps(say, q)) this.speaker.say(q)
    }
    if (this.sayDone && (done || this.askSpoken)) {
      this.finished = done || this.askSpoken
      return
    }
    if (say !== null) return
    // Still might be about to open with <say>
    const head = textSoFar.trimStart()
    if (!done && (head.length < 12 || '<say>'.startsWith(head.slice(0, 5)))) return
    if (!done && head.length < 260 && !ask) return
    if (this.askSpoken) {
      this.finished = true
      return
    }
    // No spoken part and no question: read the opening (two sentences), then stop
    const plain = head
      .replace(/<(note|card)\b[^>]*>[\s\S]*?(<\/\1>|$)/g, '\n')
      .replace(/<\/?(ask|grade|plan|summary|hint|scores|scorecard)[^>]*>/g, '\n')
    const para = plain.split(/\n\s*\n/)[0]
    this.speaker.say(sentences(speakable(para)).slice(0, 2).join(' '))
    this.finished = true
  }
}

/** Whether the spoken part already contains most of the question's words */
function overlaps(said: string, question: string): boolean {
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
  const q = words(question)
  if (!q.size) return true
  const s = words(said)
  return [...q].filter((w) => s.has(w)).length / q.size > 0.6
}

const lastSentenceEnd = (t: string) => Math.max(t.lastIndexOf('. '), t.lastIndexOf('? '), t.lastIndexOf('! '), t.lastIndexOf('… ')) + 1

/** Records from the microphone until stop() and returns a 16 kHz mono WAV for dictation */
export async function record(): Promise<{ stop(): Promise<Uint8Array>; cancel(): void; level(): number }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const ac = new AudioContext()
  const source = ac.createMediaStreamSource(stream)
  const analyser = ac.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const chunks: Float32Array[] = []
  // ScriptProcessor is deprecated but needs no extra file and is fine for short dictation
  const node = ac.createScriptProcessor(4096, 1, 1)
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  source.connect(node)
  node.connect(ac.destination)
  const close = () => {
    node.disconnect()
    source.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    ac.close().catch(() => {})
  }
  const levels = new Uint8Array(analyser.frequencyBinCount)
  return {
    level() {
      analyser.getByteTimeDomainData(levels)
      let peak = 0
      for (const v of levels) peak = Math.max(peak, Math.abs(v - 128))
      return peak / 128
    },
    cancel: close,
    async stop() {
      close()
      return toWav(chunks, ac.sampleRate, 16000)
    }
  }
}

function toWav(chunks: Float32Array[], from: number, to: number): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const all = new Float32Array(total)
  let o = 0
  for (const c of chunks) (all.set(c, o), (o += c.length))
  // Downsample by averaging, enough for speech
  const ratio = from / to
  const n = Math.floor(total / ratio)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio)
    const b = Math.min(total, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = a; j < b; j++) sum += all[j]
    pcm[i] = Math.max(-1, Math.min(1, sum / Math.max(1, b - a))) * 32767
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength)
  const v = new DataView(buf)
  const str = (off: number, s: string) => [...s].forEach((ch, i) => v.setUint8(off + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.byteLength, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, to, true)
  v.setUint32(28, to * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.byteLength, true)
  new Int16Array(buf, 44).set(pcm)
  return new Uint8Array(buf)
}

/**
 * Hands-free listening: hears when you start and stop talking, and hands over each thing you say
 * as a WAV. Tuned to the room: the first half second sets the noise floor; speech is anything well
 * above it, and a pause of about 0.9 s ends it. While paused (the tutor is speaking or thinking)
 * nothing is heard, so it never answers its own voice.
 */
export async function listen(onUtterance: (wav: Uint8Array) => void, opts: { onSpeaking?(on: boolean): void } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const ac = new AudioContext()
  const source = ac.createMediaStreamSource(stream)
  const node = ac.createScriptProcessor(2048, 1, 1)
  const frameMs = (2048 / ac.sampleRate) * 1000
  let floor = 0.01
  let calibrated = 0
  let paused = false
  let speaking = false
  let silentMs = 0
  let speechMs = 0
  const preroll: Float32Array[] = []
  let chunks: Float32Array[] = []
  node.onaudioprocess = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0))
    let sum = 0
    for (const v of data) sum += v * v
    const rms = Math.sqrt(sum / data.length)
    if (calibrated < 500) {
      floor = calibrated ? floor * 0.8 + rms * 0.2 : rms
      calibrated += frameMs
      return
    }
    if (paused) {
      if (speaking) (speaking = false), opts.onSpeaking?.(false)
      chunks = []
      return
    }
    const loud = rms > Math.max(0.012, floor * 3.2)
    if (!speaking) {
      // Keep a little before speech starts, so first syllables aren't clipped
      preroll.push(data)
      if (preroll.length > 6) preroll.shift()
      if (!loud) floor = floor * 0.98 + rms * 0.02
      if (loud) {
        speaking = true
        silentMs = 0
        speechMs = 0
        chunks = [...preroll]
        opts.onSpeaking?.(true)
      }
      return
    }
    chunks.push(data)
    speechMs += frameMs
    silentMs = loud ? 0 : silentMs + frameMs
    if (silentMs > 900 || speechMs > 45_000) {
      speaking = false
      opts.onSpeaking?.(false)
      // Short bumps and coughs aren't speech
      if (speechMs - silentMs > 350) onUtterance(toWav(chunks, ac.sampleRate, 16000))
      chunks = []
    }
  }
  source.connect(node)
  node.connect(ac.destination)
  return {
    pause(on: boolean) {
      paused = on
    },
    stop() {
      node.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      ac.close().catch(() => {})
    }
  }
}
