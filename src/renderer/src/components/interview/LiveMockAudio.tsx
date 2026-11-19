import { useEffect, useRef, useState } from 'react'
import { speakable } from '../../lib/voice'

/**
 * The call's audio: the interviewer's voice (Kokoro, one sentence made while the one before it
 * plays, so speech starts as soon as the first sentence of the reply exists) and the learner's
 * microphone (cut into short pieces at pauses so each is written out while they keep talking,
 * with the turn ending after a longer silence, on push-to-talk release, or by hand).
 */

let ctx: AudioContext | null = null
const audio = () => (ctx ??= new AudioContext())

/** The interviewer's voice: a queue of sentences, captioned as each one starts */
export class InterviewerVoice {
  private queue: Promise<void> = Promise.resolve()
  private stopped = false
  private sources = new Set<AudioBufferSourceNode>()
  private pending = 0
  /** When the first sentence of the current line started playing (performance.now()) */
  firstAudioAt = 0
  onSentence?: (text: string) => void
  onIdle?: () => void

  constructor(
    private voice: string,
    private natural: boolean
  ) {}

  get speaking() {
    return this.pending > 0
  }

  /** A new line: resets the first-audio time */
  begin() {
    this.firstAudioAt = 0
    this.stopped = false
  }

  say(sentence: string) {
    const clean = speakable(sentence)
    if (!clean || this.stopped) return
    this.pending++
    const made = this.make(clean)
    this.queue = this.queue.then(async () => {
      try {
        const play = await made
        if (!this.stopped) {
          this.firstAudioAt ||= performance.now()
          this.onSentence?.(sentence)
          await play()
        }
      } catch {
        // a sentence that couldn't be made is shown but not spoken
        this.onSentence?.(sentence)
      } finally {
        if (--this.pending === 0) this.onIdle?.()
      }
    })
  }

  /** Resolves when everything queued has been spoken */
  idle(): Promise<void> {
    return this.queue
  }

  stop() {
    this.stopped = true
    for (const s of this.sources) s.stop()
    this.sources.clear()
    window.speechSynthesis?.cancel()
  }

  private async make(text: string): Promise<() => Promise<void>> {
    if (this.natural) {
      const wav = await window.tide.voice.speak(text, this.voice, 1)
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
        // A different Mac voice from the tutor's usual pick
        const en = voices.filter((v) => v.lang.startsWith('en'))
        u.voice = en.find((v) => /daniel|serena|kate|oliver/i.test(v.name)) ?? en.find((v) => v.localService) ?? null
        u.onend = () => resolve()
        u.onerror = () => resolve()
        window.speechSynthesis.speak(u)
      })
  }
}

export type MicMode = 'open' | 'ptt'

export interface MicPiece {
  wav: Uint8Array
  /** performance.now() at the start and end of the speech in it */
  start: number
  end: number
}

export interface Mic {
  /** 0–1, the loudest sample of the last frame */
  level(): number
  /** Listening for the learner (off while the interviewer speaks, so it never hears itself) */
  setActive(on: boolean): void
  /** Push-to-talk held */
  setHeld(on: boolean): void
  /** Auto end-of-turn on silence (off while presenting) */
  setAutoEnd(on: boolean): void
  /** Hands over what's been said so far as a piece */
  flush(): void
  stop(): void
}

/**
 * The microphone for a whole call. Speech is anything well above the room's level (measured over
 * the first half second). A pause of 0.8 s closes a piece (`onPiece`, to write out while they go
 * on); `endSilenceMs` of silence after speech ends their turn (`onEnd`), in open-mic mode.
 */
export async function openMic(o: { mode: MicMode; endSilenceMs?: number; onPiece(p: MicPiece): void; onEnd(): void; onSpeech?(on: boolean): void }): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })
  const ac = new AudioContext()
  const source = ac.createMediaStreamSource(stream)
  const node = ac.createScriptProcessor(2048, 1, 1)
  const frameMs = (2048 / ac.sampleRate) * 1000
  const endMs = o.endSilenceMs ?? 2500
  let floor = 0.01
  let calibrated = 0
  let active = false
  let held = false
  let autoEnd = true
  let speaking = false
  let silentMs = 0
  let pieceSpeechMs = 0
  let turnHadSpeech = false
  let turnSilentMs = 0
  let peak = 0
  let chunks: Float32Array[] = []
  let pieceStart = 0
  let lastLoud = 0
  const preroll: Float32Array[] = []

  const emit = () => {
    if (chunks.length && pieceSpeechMs > 300)
      o.onPiece({
        wav: toWav(chunks, ac.sampleRate, 16000),
        start: pieceStart,
        end: lastLoud || performance.now()
      })
    chunks = []
    pieceSpeechMs = 0
    if (speaking) ((speaking = false), o.onSpeech?.(false))
  }

  node.onaudioprocess = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0))
    let sum = 0
    let pk = 0
    for (const v of data) ((sum += v * v), (pk = Math.max(pk, Math.abs(v))))
    peak = pk
    const rms = Math.sqrt(sum / data.length)
    if (calibrated < 500) {
      floor = calibrated ? floor * 0.8 + rms * 0.2 : rms
      calibrated += frameMs
      return
    }
    const listening = active && (o.mode === 'open' || held)
    if (!listening) {
      if (!active) chunks = []
      preroll.length = 0
      if (!active && speaking) ((speaking = false), o.onSpeech?.(false))
      return
    }
    const loud = rms > Math.max(0.012, floor * 3.2)
    if (!loud && !speaking) floor = floor * 0.98 + rms * 0.02
    if (!speaking) {
      preroll.push(data)
      if (preroll.length > 6) preroll.shift()
      if (loud) {
        speaking = true
        silentMs = 0
        pieceStart = performance.now() - preroll.length * frameMs
        chunks = [...preroll]
        preroll.length = 0
        o.onSpeech?.(true)
      } else if (turnHadSpeech && autoEnd && o.mode === 'open') {
        turnSilentMs += frameMs
        if (turnSilentMs >= endMs) {
          turnHadSpeech = false
          turnSilentMs = 0
          o.onEnd()
        }
      }
      return
    }
    chunks.push(data)
    if (loud) {
      pieceSpeechMs += frameMs
      silentMs = 0
      lastLoud = performance.now()
      turnHadSpeech = pieceSpeechMs > 300 || turnHadSpeech
    } else silentMs += frameMs
    turnSilentMs = loud ? 0 : turnSilentMs + frameMs
    if (silentMs > 800 || chunks.length * frameMs > 40_000) {
      emit()
      silentMs = 0
    }
  }
  source.connect(node)
  node.connect(ac.destination)
  return {
    level: () => peak,
    setActive(on) {
      active = on
      if (!on) {
        chunks = []
        turnHadSpeech = false
        turnSilentMs = 0
      }
    },
    setHeld(on) {
      if (held && !on) emit()
      held = on
    },
    setAutoEnd(on) {
      autoEnd = on
    },
    flush: emit,
    stop() {
      node.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      ac.close().catch(() => {})
    }
  }
}

function toWav(chunks: Float32Array[], from: number, to: number): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const ratio = from / to
  const n = Math.floor(total / ratio)
  const all = new Float32Array(total)
  let off = 0
  for (const c of chunks) (all.set(c, off), (off += c.length))
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio)
    const b = Math.min(total, Math.floor((i + 1) * ratio))
    let s = 0
    for (let j = a; j < b; j++) s += all[j]
    pcm[i] = Math.max(-1, Math.min(1, s / Math.max(1, b - a))) * 32767
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength)
  const v = new DataView(buf)
  const str = (at: number, t: string) => [...t].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)))
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

/** A level meter that follows a mic: bars that light with the level */
export function LevelMeter({ level, label }: { level: number; label?: string }) {
  const bars = 12
  const lit = Math.round(Math.min(1, level * 2.2) * bars)
  return (
    <span className="lm-meter" role="meter" aria-label={label ?? 'Microphone level'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, level * 2.2) * 100)}>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className={i < lit ? 'on' : ''} style={{ height: `${30 + (i / bars) * 70}%` }} />
      ))}
    </span>
  )
}

/** A mic check for the pre-brief: opens the mic, shows its level, closes it on unmount */
export function useMicCheck(on: boolean): {
  level: number
  error: string | null
} {
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const mic = useRef<Mic | null>(null)
  useEffect(() => {
    if (!on) return
    let raf = 0
    let dead = false
    openMic({ mode: 'open', onPiece: () => {}, onEnd: () => {} })
      .then((m) => {
        if (dead) return m.stop()
        mic.current = m
        const tick = () => {
          setLevel((l) => l * 0.6 + m.level() * 0.4)
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => setError('Tide can’t use the microphone. Allow it in System Settings › Privacy & Security › Microphone, or type your answers.'))
    return () => {
      dead = true
      cancelAnimationFrame(raf)
      mic.current?.stop()
      mic.current = null
    }
  }, [on])
  return { level, error }
}
