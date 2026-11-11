/** Special tokens some local models (Gemma, Qwen) leak into text, like <|channel> or <turn|> */
export const SPECIAL_TOKEN = /<\|[a-z_]+>|<[a-z_]+\|>/g

/** Gemma writes hidden reasoning as <|channel>thought ... <channel|>; Qwen-style models use <think> */
const REASONING_BLOCK = /<\|channel>[\s\S]*?<channel\|>|<think>[\s\S]*?<\/think>/g

export const cleanModelText = (s: string) => s.replace(REASONING_BLOCK, '').replace(SPECIAL_TOKEN, '').replace(/^\s*thought\s*\n/, '')

/**
 * Streaming version: drops reasoning blocks even when their markers arrive split across chunks.
 * Returns the visible part of each chunk.
 */
export function createStreamFilter() {
  let pending = ''
  let inside = false
  // Gemma, with its reasoning token blocked, sometimes still opens with the bare word "thought"
  let head = true
  return (chunk: string): string => {
    pending += chunk
    if (head) {
      if (pending.length < 9 && 'thought\n'.startsWith(pending.trimStart())) return ''
      pending = pending.replace(/^\s*thought\s*\n/, '')
      head = false
    }
    let out = ''
    for (;;) {
      if (inside) {
        const end = pending.search(/<channel\|>|<\/think>/)
        if (end < 0) {
          pending = pending.slice(-12)
          return out
        }
        pending = pending.slice(end).replace(/^<channel\|>|^<\/think>/, '')
        inside = false
      }
      const start = pending.search(/<\|channel>|<think>/)
      if (start >= 0) {
        out += pending.slice(0, start)
        pending = pending.slice(start).replace(/^<\|channel>|^<think>/, '')
        inside = true
        continue
      }
      // Keep a possible partial marker at the end for the next chunk
      const partial = pending.match(/<[|a-z_/]*$/)
      const cut = partial ? partial.index! : pending.length
      out += pending.slice(0, cut)
      pending = pending.slice(cut)
      return out.replace(SPECIAL_TOKEN, '')
    }
  }
}

/** True when the tail of a stream is the same short line or word over and over. Only the tail can
 *  show it, so only the tail is read: the check costs the same on the last token as the first. */
export const isLooping = (text: string) => {
  const tail = text.length > 1500 ? text.slice(-1500) : text
  return /(\b[\w'’-]{1,24}\b)(?:\s+\1){10,}\s*$/.test(tail) || /(.{2,60}\n)\1{8,}$/.test(tail)
}

/** Follows the markers in a growing model stream without reading it all again on every token:
 *  how many reasoning blocks have opened, whether a tool call is open, and whether the visible text
 *  has started a bare "call:name{" line. */
export function streamWatch() {
  const CHANNEL = '<|channel>'
  const OPEN = '<|tool_call'
  const CLOSE = '<tool_call|>'
  let rawSeen = 0
  let textSeen = 0
  let channels = 0
  let lastOpen = -1
  let lastClose = -1
  let bareCall = false
  // Every match that ends past what was read before (a marker can arrive split across tokens)
  const each = (s: string, token: string, from: number, on: (at: number) => void) => {
    for (let i = s.indexOf(token, Math.max(0, from - token.length + 1)); i >= 0; i = s.indexOf(token, i + 1)) if (i + token.length > from) on(i)
  }
  return {
    raw(raw: string) {
      each(raw, CHANNEL, rawSeen, () => channels++)
      each(raw, OPEN, rawSeen, (i) => (lastOpen = i))
      each(raw, CLOSE, rawSeen, (i) => (lastClose = i))
      rawSeen = raw.length
    },
    text(text: string) {
      if (!bareCall) {
        // From the start of the line the new text joins, so "^" still means a line start
        const from = textSeen ? text.lastIndexOf('\n', textSeen - 1) : 0
        bareCall = /(^|\n)\s*call:[A-Za-z_]\w*\{/.test(from > 0 ? text.slice(from) : text)
      }
      textSeen = text.length
    },
    get channels() {
      return channels
    },
    get inCall() {
      return lastOpen > lastClose
    },
    get bareCall() {
      return bareCall
    }
  }
}

/** What a turn must do next, read off its stream: carry on from a stall, or start over from a loop */
export type TurnStop = 'stall' | 'loop'

/**
 * One model turn read as it streams, the way the tutor's harness reads it (main/agent), kept here
 * so anything that measures the tutor outside the app reads a reply by the same rules:
 * - the visible text of each piece, without hidden reasoning or special tokens;
 * - "stall": Gemma opened a thought channel after its answer had begun (it stays there, repeating
 *   it), so what was written is kept and it is asked to carry on (CARRY_ON);
 * - "loop": the same line or word over and over, or three thought channels before any answer.
 * A tool call written as text is never shown and never judged as repetition.
 */
export function turnReader() {
  const filter = createStreamFilter()
  const watch = streamWatch()
  let raw = ''
  let text = ''
  // How many thought-channel openings there were when the answer began; another one after that is a stall
  let channelsAtStart = -1
  return {
    push(delta: string): { visible: string; stop?: TurnStop } {
      raw += delta
      const visible = filter(delta)
      text += visible
      watch.raw(raw)
      watch.text(text)
      // Watch the raw stream too: repeated hidden reasoning blocks never show up in the text
      // Code inside a tool call written as text can repeat lines legitimately: don't judge it
      const inCall = watch.inCall
      const channels = watch.channels
      if (channelsAtStart < 0 && text.trim()) channelsAtStart = channels
      if (!inCall && channelsAtStart >= 0 && channels > channelsAtStart) return { visible: '', stop: 'stall' }
      if (!inCall && (isLooping(text) || isLooping(raw) || channels >= 3)) return { visible: '', stop: 'loop' }
      // Never show a tool call the server passed through as text: judge by the raw stream, since
      // the filter strips the special tokens that mark it, and hold back a bare "call:name{" too
      return { visible: visible && !inCall && !watch.bareCall ? visible : '' }
    },
    /** Everything visible so far */
    get text() {
      return text
    },
    get raw() {
      return raw
    }
  }
}

/** Said to the model (not shown) to pick a stalled reply up where it stopped */
export const CARRY_ON = '(Carry on with your reply exactly where it stopped. Do not repeat anything already written, and no <say> this time.)'

/** The text before a run of repetition, ended at its last full sentence */
export function beforeLoop(text: string): string {
  const m = text.match(/(\b[\w'’-]{1,24}\b)(?:\s+\1){10,}\s*$/) ?? text.match(/(.{2,60}\n)\1{8,}$/)
  let kept = m ? text.slice(0, m.index) : text
  // Also drop a sentence repeated three or more times at the end
  const sentences = kept.match(/[^.!?\n]+[.!?]+\s*/g) ?? []
  while (sentences.length > 2 && sentences[sentences.length - 1].trim() === sentences[sentences.length - 2].trim()) sentences.pop()
  if (sentences.length) kept = kept.slice(0, kept.lastIndexOf(sentences[sentences.length - 1]) + sentences[sentences.length - 1].length)
  return kept.trim()
}

/** True when a message plainly asks for something to be looked up online */
export function asksForWeb(text: string): boolean {
  return /\b(search|look\s+(it|this|that|them)?\s*up|google|browse|check)\b[^.?!]{0,40}\b(web|online|internet|net)\b|\b(search|look)\s+(online|the web|the internet)\b|\bon(line| the (web|internet))\b.{0,20}\b(search|find|look)|\bgoogle\b|\b(latest|recent|current|today'?s|this (week|month|year)|news|newest|just (released|announced)|right now)\b/i.test(
    text
  )
}

// ---------- Recovering tool calls the server didn't parse ----------

/**
 * Gemma 4 writes tool calls in its own syntax: <|tool_call>call:name{key:<|"|>text<|"|>,n:3}<tool_call|>.
 * The server usually turns that into a structured call, but not when the model stutters (a
 * doubled opening tag) or the stream is cut off, and then the call arrives as plain text. This
 * reads those calls back so the tool still runs. Returns [] when there's nothing to recover.
 */
export function recoverToolCalls(raw: string): { name: string; arguments: string }[] {
  const out: { name: string; arguments: string }[] = []
  const re = /<\|tool_call>(?:\s*<\|tool_call>)*\s*call:([A-Za-z_][\w-]*)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const parsed = parseGemmaValue(raw, m.index + m[0].length - 1)
    if (!parsed || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) continue
    out.push({ name: m[1], arguments: JSON.stringify(parsed.value) })
    re.lastIndex = parsed.end
  }
  return out
}

const QUOTE = '<|"|>'

/** Parses one value of Gemma's call syntax starting at i; null if it's cut off or malformed */
function parseGemmaValue(s: string, i: number): { value: unknown; end: number } | null {
  const skip = (j: number) => {
    while (j < s.length && /\s/.test(s[j])) j++
    return j
  }
  i = skip(i)
  if (s.startsWith(QUOTE, i)) {
    const close = s.indexOf(QUOTE, i + QUOTE.length)
    if (close < 0) return null
    return { value: s.slice(i + QUOTE.length, close), end: close + QUOTE.length }
  }
  if (s[i] === '{') {
    const obj: Record<string, unknown> = {}
    let j = skip(i + 1)
    while (j < s.length && s[j] !== '}') {
      const key = s.slice(j).match(/^([A-Za-z_][\w-]*)\s*:/)
      if (!key) return null
      const v = parseGemmaValue(s, j + key[0].length)
      if (!v) return null
      obj[key[1]] = v.value
      j = skip(v.end)
      if (s[j] === ',') j = skip(j + 1)
    }
    return j < s.length ? { value: obj, end: j + 1 } : null
  }
  if (s[i] === '[') {
    const arr: unknown[] = []
    let j = skip(i + 1)
    while (j < s.length && s[j] !== ']') {
      const v = parseGemmaValue(s, j)
      if (!v) return null
      arr.push(v.value)
      j = skip(v.end)
      if (s[j] === ',') j = skip(j + 1)
    }
    return j < s.length ? { value: arr, end: j + 1 } : null
  }
  // A bare number, boolean, null, or an unquoted word
  const bare = s.slice(i).match(/^[^,}\]]+/)
  if (!bare) return null
  const t = bare[0].trim()
  const value = t === 'true' ? true : t === 'false' ? false : t === 'null' ? null : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t
  return { value, end: i + bare[0].length }
}

// ---------- Keeping long drafts from repeating ----------

/**
 * Passes a streamed Markdown draft (an outline, a plan) through line by line. A line that was
 * already written is dropped (the same topic twice is never right), and three repeats in a row
 * mean the model is stuck: `stuck` turns true so the caller can stop and pick up from the last
 * good line. Only whole lines come out, so nothing half-repeated ever reaches the page.
 */
export function createLineGuard() {
  const seen = new Set<string>()
  let pending = ''
  let repeats = 0
  let lastGood = ''
  let stuck = false
  const key = (line: string) =>
    line
      .toLowerCase()
      .replace(/^[\s>#*_\-[\]x\d.)]+/, '')
      .replace(/[\s*_`]+/g, ' ')
      .trim()
  const take = (line: string): string => {
    const k = key(line)
    // Blank lines and rules ("---") are allowed to recur
    if (k.length < 4) return line + '\n'
    if (seen.has(k)) {
      if (++repeats >= 3) stuck = true
      return ''
    }
    repeats = 0
    seen.add(k)
    lastGood = line
    return line + '\n'
  }
  return {
    /** Feed a delta; returns the complete new lines to show */
    push(delta: string): string {
      if (stuck) return ''
      pending += delta
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      let out = ''
      for (const l of lines) {
        out += take(l)
        if (stuck) break
      }
      if (!stuck && isLooping(pending)) stuck = true
      return out
    },
    /** The unfinished last line, once the stream ends */
    end(): string {
      if (stuck || !pending) return ''
      const out = take(pending).replace(/\n$/, '')
      pending = ''
      return out
    },
    get stuck() {
      return stuck
    },
    get lastGood() {
      return lastGood
    }
  }
}

/**
 * Many models (GPT-OSS, Qwen, Claude) write maths as \( … \) and \[ … \]; Tide's renderer reads
 * $ … $ and $$ … $$. Converts the first form to the second, leaving code alone.
 */
export function normalizeMath(text: string): string {
  if (!text.includes('\\(') && !text.includes('\\[')) return text
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$$${m.trim()}$$`).replace(/\\\((.+?)\\\)/g, (_, m: string) => `$${m.trim()}$`)
    )
    .join('')
}
