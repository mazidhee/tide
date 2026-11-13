/**
 * Reading a book aloud. Speech comes from pluggable engines (main/tts): each says who it is, what
 * voices it has, and whether it can give dialogue its own voices; Kokoro, on this Mac, is the one
 * there now, and a better engine is added by registering another. Pure here: the voice lists, and
 * the plan for reading a chapter: the text cut into pieces (a sentence or two, or a stretch of
 * quoted speech), each with its exact place in the text, so the reader can light up the line
 * being spoken and pick up again from any point.
 */

export interface TtsVoice {
  id: string
  label: string
  detail?: string
}

export interface TtsEngineInfo {
  id: string
  label: string
  /** Runs on this Mac */
  local: boolean
  ready: boolean
  detail: string
  voices: TtsVoice[]
  /** Several voices at once, so quoted dialogue can have its own */
  multiVoice: boolean
}

/** Kokoro's English voices (the voice files are small and fetched on first use; the model is the one already set up) */
export const KOKORO_VOICES: TtsVoice[] = [
  { id: 'bm_george', label: 'George', detail: 'British, warm and measured' },
  { id: 'bm_fable', label: 'Fable', detail: 'British, lighter' },
  { id: 'bm_lewis', label: 'Lewis', detail: 'British, deep' },
  { id: 'bm_daniel', label: 'Daniel', detail: 'British, plain' },
  { id: 'bf_emma', label: 'Emma', detail: 'British' },
  { id: 'bf_isabella', label: 'Isabella', detail: 'British' },
  { id: 'bf_alice', label: 'Alice', detail: 'British' },
  { id: 'af_heart', label: 'Heart', detail: 'American, the clearest' },
  { id: 'af_bella', label: 'Bella', detail: 'American' },
  { id: 'af_nicole', label: 'Nicole', detail: 'American, soft' },
  { id: 'am_michael', label: 'Michael', detail: 'American' },
  { id: 'am_adam', label: 'Adam', detail: 'American' }
]

/** Two voices for dialogue that differ from the narrator (and from each other) */
export function dialogueVoices(narrator: string, voices: TtsVoice[] = KOKORO_VOICES): string[] {
  const accent = narrator.slice(0, 1)
  const male = narrator[1] === 'm'
  const pick = (want: (v: TtsVoice) => boolean) => voices.find((v) => v.id !== narrator && want(v))?.id
  const a = pick((v) => v.id[0] === accent && (v.id[1] === 'm') !== male) ?? pick(() => true)
  const b = pick((v) => v.id !== a && v.id[0] === accent && (v.id[1] === 'm') === male) ?? pick((v) => v.id !== a)
  return [a, b].filter((x): x is string => !!x)
}

export interface SpeechPiece {
  /** Index of the unit (paragraph) in the chapter */
  unit: number
  /** Characters in the unit's text, end exclusive */
  start: number
  end: number
  text: string
  voice: string
  dialogue?: boolean
}

const QUOTE = /“[^”]*”|"[^"\n]*"/g
const MAX = 320

/** Sentence spans of a text, short ones joined so the voice isn't clipped */
export function sentenceSpans(text: string, from = 0, to = text.length): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const re = /[^.!?;:…]+(?:[.!?;:…]+["'”’)\]]*|$)\s*/g
  re.lastIndex = from
  const slice = text.slice(0, to)
  let m: RegExpExecArray | null
  while ((m = re.exec(slice)) && m.index < to) {
    if (!m[0]) {
      re.lastIndex++
      continue
    }
    let start = m.index
    let end = m.index + m[0].length
    while (start < end && /\s/.test(text[start])) start++
    while (end > start && /\s/.test(text[end - 1])) end--
    if (end <= start) continue
    const last = out[out.length - 1]
    if (last && (last.end - last.start < 40 || end - start < 12) && end - last.start <= MAX) last.end = end
    else out.push({ start, end })
  }
  return out
}

/**
 * The pieces to speak from a place in a chapter onward. With dialogue voices, quoted speech is
 * read in a character voice: a new paragraph is a new speaker (the voices take turns), and quotes
 * in one paragraph split by a short "he said," stay with the same speaker.
 */
export function speechPlan(units: { text: string }[], o: { narrator: string; dialogue?: string[]; fromUnit?: number; fromOffset?: number }): SpeechPiece[] {
  const out: SpeechPiece[] = []
  const voices = o.dialogue?.filter(Boolean) ?? []
  let speaker = -1
  for (let u = Math.max(0, o.fromUnit ?? 0); u < units.length; u++) {
    const text = units[u].text
    const begin = u === (o.fromUnit ?? 0) ? Math.max(0, Math.min(text.length, o.fromOffset ?? 0)) : 0
    const runs: { start: number; end: number; quote: boolean }[] = []
    if (voices.length) {
      let at = begin
      let lastQuoteEnd = -1
      let turned = false
      for (const q of text.matchAll(QUOTE)) {
        const qs = q.index!
        const qe = qs + q[0].length
        if (qe <= begin) continue
        if (qs > at) runs.push({ start: at, end: qs, quote: false })
        // A new speaker for each paragraph, not for every quote in it
        if (!turned || (lastQuoteEnd >= 0 && qs - lastQuoteEnd > 60)) {
          speaker = (speaker + 1) % voices.length
          turned = true
        }
        runs.push({ start: Math.max(qs, begin), end: qe, quote: true })
        at = qe
        lastQuoteEnd = qe
      }
      if (at < text.length) runs.push({ start: at, end: text.length, quote: false })
    } else runs.push({ start: begin, end: text.length, quote: false })
    for (const r of runs) {
      const voice = r.quote ? voices[Math.max(0, speaker)] : o.narrator
      for (const s of sentenceSpans(text, r.start, r.end)) {
        const piece = text.slice(s.start, s.end)
        if (!/[\p{L}\p{N}]/u.test(piece)) continue
        out.push({ unit: u, start: s.start, end: s.end, text: piece, voice, ...(r.quote ? { dialogue: true } : {}) })
      }
    }
  }
  return out
}

/** The piece being spoken at a place in the text (the one it falls in, or the next one) */
export function pieceAt(plan: SpeechPiece[], unit: number, offset: number): number {
  const i = plan.findIndex((p) => p.unit > unit || (p.unit === unit && p.end > offset))
  return i < 0 ? Math.max(0, plan.length - 1) : i
}

/** Seconds a piece takes to say, roughly (for "7:42 left" before the audio exists) */
export const speechSeconds = (text: string, speed = 1) => ((text.match(/[\p{L}\p{N}’']+/gu) ?? []).length / 165) * 60 / Math.max(0.5, speed)

/** "7:42" */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

/** The cache's name for a piece of audio: the same words in the same voice at the same speed are made once */
export function speechKey(engine: string, voice: string, speed: number, text: string): string {
  let h = 2166136261
  const s = `${engine}|${voice}|${speed.toFixed(2)}|${text}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let h2 = 5381
  for (let i = 0; i < s.length; i++) h2 = (Math.imul(h2, 33) ^ s.charCodeAt(i)) >>> 0
  return `${(h >>> 0).toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}${s.length.toString(16)}`
}
