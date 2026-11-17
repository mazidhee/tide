/**
 * The lecture voice's script: what a professor would SAY for a tutor reply, as opposed to what is
 * written on the screen. Short replies are said in full; longer ones become a faithful spoken
 * version (or, with "Just the gist", the main point and the question). Code, tables, equations and
 * pictures are pointed at, never read out symbol by symbol. Fish S2 Pro takes inline delivery tags
 * ([inhale], [short pause], [excited]…); only those it knows are kept, and not on every sentence.
 *
 * Pure: the main process (main/lectureVoice) asks Claude's quick model for the script and falls
 * back to fallbackScript here when Claude isn't there.
 */

export type LectureTone = 'explain' | 'correct' | 'miss' | 'question'
export type LectureMode = 'all' | 'gist'

/** The delivery tags Fish S2 Pro responds to; anything else in square brackets is removed */
export const LECTURE_TAGS = ['inhale', 'exhale', 'short pause', 'pause', 'emphasis', 'chuckle', 'excited', 'laughing', 'sigh', 'whisper', 'warm', 'curious', 'encouraging'] as const

/** Under this many words of prose, a reply is said in full */
export const FULL_WORDS = 60
/** Under this many spoken words, a reply is an acknowledgement: Kokoro says it at once */
export const ACK_WORDS = 8

// ---------- Reading the reply ----------

/** How the moment feels: the latest grade decides, else whether it ends on a question */
export function toneOf(reply: string): LectureTone {
  const verdict = [...reply.matchAll(/<grade\b[^>]*verdict\s*=\s*["']?(correct|partial|wrong)/gi)].pop()?.[1]?.toLowerCase()
  if (verdict === 'correct') return 'correct'
  if (verdict === 'wrong' || verdict === 'partial') return 'miss'
  if (/<ask\b/i.test(reply)) return 'question'
  const plain = reply.replace(/```[\s\S]*?```/g, '').replace(/<[^>]+>/g, '').trim()
  return /\?["')\]]*$/.test(plain) ? 'question' : 'explain'
}

/**
 * The reply as source for the script: Markdown and Tide's tags reduced to prose, with code,
 * tables, display maths and pictures replaced by [[markers]] saying what they are, so the writer
 * describes them instead of reading them.
 */
export function sourceOf(reply: string): string {
  let s = reply
    // Tide's bookkeeping, never spoken
    .replace(/<(plan|scores|scorecard|summary|solution|check|tests|meta|lesson-map)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(exercise|visual|diagram|figure|manim|plot|canvas|explorable|sim)\b[^>]*\/>/gi, ' [[a picture on the screen]] ')
    .replace(/<(visual|diagram|figure|manim|plot|canvas|explorable|sim)\b[^>]*>[\s\S]*?<\/\1>/gi, ' [[a picture on the screen]] ')
    .replace(/```(mermaid|dot|svg)[\s\S]*?```/gi, ' [[a diagram on the screen]] ')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang: string, body: string) => ` [[${describeCode(lang, body)}]] `)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex: string) => ` [[an equation on the screen: ${tex.trim().slice(0, 80)}]] `)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [[a picture on the screen]] ')
  s = tablesToMarkers(s)
  s = s
    .replace(/<ask\b[^>]*>([\s\S]*?)<\/ask>/gi, '\n\nQuestion: $1\n\n')
    .replace(/<grade\b[^>]*>([\s\S]*?)<\/grade>/gi, '$1\n\n')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$([^$\n]+)\$/g, (_m, tex: string) => speakMaths(tex))
    .replace(/\s*×\s*/g, ' times ')
    .replace(/(\d)\s*=\s*(\d)/g, '$1 equals $2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_]/g, '$1$2')
  return s
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Inline maths in words: log base 2 of 8, a over b, x squared; other commands dropped */
export function speakMaths(tex: string): string {
  return tex
    .replace(/\\log_\{?([^}\s]+)\}?\s*\(?([^)\s=]+)\)?/g, 'log base $1 of $2')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1 over $2')
    .replace(/\^\{?2\}?/g, ' squared')
    .replace(/\^\{?3\}?/g, ' cubed')
    .replace(/\^\{([^}]*)\}|\^(\w)/g, (_m, a?: string, b?: string) => ` to the power ${a ?? b}`)
    .replace(/\\(cdot|times)/g, ' times ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/\s*=\s*/g, ' equals ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function describeCode(lang: string, body: string): string {
  const lines = body.split('\n').filter((l) => l.trim()).length
  return `${lines > 1 ? `${lines} lines of` : 'a line of'} ${lang ? `${lang} ` : ''}code on the screen`
}

function tablesToMarkers(s: string): string {
  return s.replace(/(^\|.*\|[ \t]*\n)(^\|[\s:|-]+\|[ \t]*\n)((?:^\|.*\|[ \t]*(?:\n|$))*)/gm, (_m, head: string, _sep: string, rows: string) => {
    const cols = head.split('|').map((c) => c.trim()).filter(Boolean)
    const n = rows.split('\n').filter((r) => r.trim()).length
    return ` [[a table on the screen, ${n} row${n === 1 ? '' : 's'}, with columns ${listOf(cols.slice(0, 5))}]] \n`
  })
}

const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** Words of prose (markers don't count): decides said in full or spoken version */
export const proseWords = (source: string) => source.replace(/\[\[[^\]]*\]\]/g, ' ').split(/\s+/).filter((w) => /\w/.test(w)).length

/** Words that will be heard, delivery tags left out */
export const spokenWords = (script: string) => stripTags(script).split(/\s+/).filter((w) => /\w/.test(w)).length

export const stripTags = (script: string) => script.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()

/** Said in full (short), or a faithful spoken version / the gist (long) */
export function lengthChoice(source: string, mode: LectureMode): 'full' | 'spoken' | 'gist' {
  if (proseWords(source) < FULL_WORDS && !/\[\[/.test(source)) return 'full'
  return mode === 'gist' ? 'gist' : 'spoken'
}

// ---------- Tags ----------

/**
 * Keeps only tags Fish knows, lower-cased, never two in a row, never one on every sentence (at
 * most one per two sentences, pauses aside), and never a tag left in a [[marker]] or after the
 * last word.
 */
export function cleanTags(script: string): string {
  const known = new Set<string>(LECTURE_TAGS)
  let s = script
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[([^\]]*)\]/g, (_m, t: string) => {
      const tag = t.trim().toLowerCase().replace(/\s+/g, ' ')
      return known.has(tag) ? `[${tag}]` : ' '
    })
    // Two tags in a row: keep the first
    .replace(/(\[[a-z ]+\])(\s*\[[a-z ]+\])+/g, '$1')
    .replace(/\[[a-z ]+\]\s*$/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .trim()
  // Density: expressive tags on at most every other sentence
  const parts = s.split(/(?<=[.!?…])\s+/)
  let lastTagged = -2
  s = parts
    .map((p, i) => {
      const expressive = (p.match(/\[([a-z ]+)\]/g) ?? []).filter((t) => !/pause/.test(t))
      if (!expressive.length) return p
      if (i - lastTagged < 2) return p.replace(/\[(?!short pause|pause)[a-z ]+\]\s*/g, '')
      lastTagged = i
      // One expressive tag per sentence
      let seen = false
      return p.replace(/\[(?!short pause|pause)[a-z ]+\]\s*/g, (t) => (seen ? '' : ((seen = true), t)))
    })
    .join(' ')
  return s.replace(/\s+/g, ' ').trim()
}

// ---------- Writing it (Claude) ----------

export const SCRIPT_SYSTEM = `You turn a tutor's written reply into what a warm, unhurried university professor would SAY aloud in a one-to-one lesson. The text is spoken by a voice model that understands inline delivery tags in square brackets.

Rules:
- Faithful: every idea, step, number and the question at the end stays. Rephrase for the ear; never add new teaching, analogies or jokes.
- Never read code, tables, equations or diagrams symbol by symbol. A [[marker]] stands for one on the screen: point the learner to it and say what to look at ("I've put the code on your screen. Look at the third line, where the loop starts."). Say simple maths in words ("x squared plus one").
- Sound like speech: contractions, short sentences, natural signposts ("So.", "Now,", "Here's the thing."). No lists, no headings, no Markdown, no emoji.
- Weave in delivery tags naturally, NOT on every sentence: about one tag per two or three sentences. Allowed tags, exactly as written: [inhale] [exhale] [short pause] [pause] [emphasis] [chuckle] [excited] [laughing]. Use [inhale] before starting a new idea, [short pause] before a key point or after a question is posed, [emphasis] right before the word that matters.
- A question for the learner is the last sentence and ends with a question mark.
- Output only the spoken script, nothing else.`

const TONE_NOTE: Record<LectureTone, string> = {
  correct: 'The learner just got it RIGHT. Open with genuine, quick delight: start with [excited] and a short happy reaction ("Yes! That\'s exactly it."), then carry on warmly.',
  miss: 'The learner just missed. Be gentle and encouraging, never disappointed: acknowledge what was good, then the fix, calmly. No [excited], no [laughing].',
  question: 'This reply asks the learner something. Be curious and inviting; let the question land with a [short pause] before it.',
  explain: 'This reply explains. Be warm and measured, like a favourite lecturer at the board.'
}

const LENGTH_NOTE = {
  full: 'The reply is short: say all of it, close to word for word, only made speakable.',
  spoken: 'The reply is long: give a faithful spoken version of all of its teaching, in the same order. Do not summarise or drop content; just make it sound spoken.',
  gist: 'The learner chose "Just the gist": say the one main idea in two or three sentences, point to anything on the screen in one sentence, then ask the question if there is one.'
} as const

export function scriptPrompt(source: string, tone: LectureTone, length: 'full' | 'spoken' | 'gist'): string {
  return `${TONE_NOTE[tone]}\n${LENGTH_NOTE[length]}\n\nThe written reply:\n<reply>\n${source}\n</reply>`
}

/** Claude's script, tidied: no quotes or labels round it, tags checked, the question kept a question */
export function tidyScript(text: string, source: string): string {
  let s = text
    .replace(/^\s*(script|spoken script|here(?:'s| is) the script)\s*:\s*/i, '')
    .replace(/^["“]|["”]$/g, '')
    .replace(/[*_#`>|]/g, ' ')
  s = cleanTags(s)
  return keepQuestion(s, source)
}

/** When the reply ends on a question, the script does too (with its question mark) */
function keepQuestion(script: string, source: string): string {
  const q = lastQuestion(source)
  if (!q) return script
  if (/\?\s*$/.test(stripTags(script))) return script
  // Already asked in other words near the end: don't ask twice
  const tail = new Set(stripTags(script).toLowerCase().split(/(?<=[.!?])\s+/).slice(-3).join(' ').match(/[a-z0-9]{3,}/g) ?? [])
  const words = q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  if (words.length && words.filter((w) => tail.has(w)).length / words.length > 0.6) {
    // A question in the asking form gets its question mark, so it's said as a question
    return script.replace(/(^|[.!?]\s+)((?:\[[a-z ]+\]\s*)?(?:what|which|why|how|can|could|do|does|is|are|would|will|where|when|who)\b[^.!?]*)[.!]?\s*$/i, '$1$2?')
  }
  return `${script} [short pause] ${q}`
}

function lastQuestion(source: string): string | null {
  const m = source.match(/Question:\s*([^\n]+)/g)
  if (m) {
    const q = m[m.length - 1].replace(/^Question:\s*/, '').trim()
    // "What power gives 8? Show the working." is already a question: kept as it is
    return /\?/.test(q) ? q : `${q.replace(/[.!]$/, '')}?`
  }
  const sentences = source.replace(/\[\[[^\]]*\]\]/g, '').split(/(?<=[.!?])\s+/)
  const last = sentences[sentences.length - 1]?.trim()
  return last && /\?$/.test(last) ? last : null
}

// ---------- Without Claude ----------

const OPENERS: Record<LectureTone, string> = {
  correct: '[excited] Yes! That’s exactly it.',
  miss: 'Not quite, [short pause] but you’re close.',
  question: '',
  explain: ''
}

/** A marker said aloud: pointed at, never read */
function sayMarker(m: string): string {
  if (/code/.test(m)) return `I’ve put ${m.replace(/ on the screen$/, '')} on your screen. Have a look at it with me.`
  if (/table/.test(m)) return `There’s ${m.replace(' on the screen', ' on your screen')}.`
  if (/equation/.test(m)) return 'I’ve written the equation on your screen. Take a moment to read it.'
  if (/diagram|picture/.test(m)) return 'Have a look at the picture on your screen.'
  return 'Have a look at your screen.'
}

/**
 * The script without Claude: the reply made speakable, markers pointed at, a reaction to a grade,
 * an [inhale] before each new paragraph and a [short pause] before the question. The gist keeps
 * the first two sentences, the pointers and the question.
 */
export function fallbackScript(reply: string, mode: LectureMode = 'all'): string {
  const source = sourceOf(reply)
  const tone = toneOf(reply)
  const length = lengthChoice(source, mode)
  const question = lastQuestion(source)
  let paras = source
    .split('\n\n')
    .map((p) => p.replace(/^Question:\s*/, '').replace(/^•\s*/, ''))
    .map((p) => p.replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => ` ${sayMarker(inner)} `).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (question) paras = paras.filter((p) => p.trim() !== question.trim())
  if (length === 'gist') {
    const all = paras.join(' ').split(/(?<=[.!?])\s+/)
    const pointers = all.filter((x) => /on your screen/.test(x))
    paras = [[...all.filter((x) => !/on your screen/.test(x)).slice(0, 2), ...pointers.slice(0, 1)].join(' ')]
  }
  const opener = OPENERS[tone]
  // Don't react twice when the reply already opens with its own reaction
  const first = paras[0] ?? ''
  const reacted = tone === 'correct' ? /^(yes|exactly|right|correct|spot on|perfect|great|nice)\b/i.test(first) : tone === 'miss' ? /^(not quite|almost|close|nearly|no\b)/i.test(first) : false
  const body = paras.map((p, i) => (i > 0 ? `[inhale] ${p}` : p)).join(' ')
  let s = [reacted ? (tone === 'correct' ? `[excited] ${first}` : first) : opener, reacted ? paras.slice(1).map((p) => `[inhale] ${p}`).join(' ') : body].filter(Boolean).join(' ')
  if (question) s = `${s} [short pause] ${question}`
  return cleanTags(s)
}

// ---------- Saying it in pieces ----------

/**
 * Pieces to make one at a time: the first short (one sentence, so speech starts soon), the rest a
 * few sentences of up to about 45 words (each piece costs Fish a fixed few seconds to read the
 * reference voice, so fewer, longer pieces finish sooner). A tag stays with the words after it; no piece is only
 * tags.
 */
export function chunkScript(script: string, max = 45): string[] {
  const sentences = script
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…]["”’)]?)\s+(?=\[|[A-Z“"'‘(]|\d)/)
    .map((s) => s.trim())
    .filter(Boolean)
  // A sentence of tags only joins the next
  const merged: string[] = []
  let carry = ''
  for (const s of sentences) {
    if (!stripTags(s)) {
      carry += `${s} `
      continue
    }
    merged.push(`${carry}${s}`.trim())
    carry = ''
  }
  if (carry.trim() && merged.length) merged[merged.length - 1] += ` ${carry.trim()}`
  const out: string[] = []
  for (const s of merged) {
    const last = out[out.length - 1]
    const w = spokenWords
    // The first piece stays one sentence (unless it's tiny), so the voice starts quickly
    const join = last === undefined ? false : out.length === 1 ? w(last) < 6 && w(last) + w(s) <= 14 : w(last) + w(s) <= max
    if (join) out[out.length - 1] = `${last} ${s}`
    else out.push(s)
  }
  return out.map((c) => cleanTags(c)).filter((c) => stripTags(c))
}

/** A reply that's only an acknowledgement ("Right, go on."): Kokoro says it at once, no dead air */
export const isAck = (script: string) => spokenWords(script) < ACK_WORDS

// ---------- Which voice ----------

export interface EngineState {
  /** The lecture voice chosen in Settings */
  lecture: boolean
  /** It is set up (model downloaded, clip there) */
  ready: boolean
  /** It failed or was too slow earlier in this reply */
  fellBack: boolean
}

/** Fish, unless it isn't chosen or ready, already failed this reply, or the reply is a quick acknowledgement */
export function engineFor(script: string, st: EngineState): 'fish' | 'kokoro' {
  if (!st.lecture || !st.ready || st.fellBack) return 'kokoro'
  return isAck(script) ? 'kokoro' : 'fish'
}

/**
 * Whether a piece took too long: Fish runs at about 0.15 to 0.6 times real time on an M4 Pro
 * (slower when memory is short), plus a few seconds a piece, so a piece of n words (about n / 2.5
 * seconds of speech) may take up to about 15 times that, and at least a minute and a half (the
 * first piece can wait behind the model loading); past it, the rest
 * of the reply is said by Kokoro.
 */
export function tooSlow(ms: number, words: number): boolean {
  return ms > pieceTimeout(words)
}

/** The longest Fish may take for a piece before it's given up on (then Kokoro says it) */
export const pieceTimeout = (words: number) => Math.min(180_000, Math.max(90_000, (words / 2.5) * 15 * 1000))

// ---------- When to start ----------

export interface PieceTiming {
  text: string
  ready: boolean
  failed?: boolean
  /** How long it took to make, ms */
  ms?: number
  /** How long it plays, seconds */
  secs?: number
}

/**
 * Whether playing can start without running dry: the audio already made, plus most of what's still
 * to be made (it arrives while the start plays), covers the time the rest takes to make at the
 * rate seen so far. Starts anyway after maxWaitMs (you've been reading), and at once when it's all
 * made.
 */
export function readyToStart(pieces: PieceTiming[], waitedMs: number, maxWaitMs = 45_000): boolean {
  if (!pieces.length || !pieces[0].ready) return false
  if (pieces.every((p) => p.ready || p.failed)) return true
  if (waitedMs >= maxWaitMs) return true
  const made = pieces.filter((p) => p.ready && p.ms && p.secs)
  const rate = made.reduce((n, p) => n + p.ms! / 1000, 0) / Math.max(0.1, made.reduce((n, p) => n + p.secs!, 0))
  let buffered = 0
  for (const p of pieces) {
    if (!p.ready) break
    buffered += p.secs ?? spokenWords(p.text) / 2.5
  }
  const left = pieces.filter((p) => !p.ready && !p.failed).reduce((n, p) => n + spokenWords(p.text) / 2.5, 0)
  return left * rate <= buffered + left * 0.8
}
