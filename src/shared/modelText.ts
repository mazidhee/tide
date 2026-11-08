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

/** True when the tail of a stream is the same short line or word over and over */
export const isLooping = (text: string) => /(\b[\w'’-]{1,24}\b)(?:\s+\1){10,}\s*$/.test(text) || /(.{2,60}\n)\1{8,}$/.test(text)

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
