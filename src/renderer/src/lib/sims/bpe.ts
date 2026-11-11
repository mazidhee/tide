/**
 * Byte-pair encoding learnt from one short text: the model, the spec and the named parts of the
 * "tokeniser" simulation.
 *
 * The variant is the original word-level BPE (Sennrich, Haddow and Birch, 2016), with every
 * choice fixed so a run is repeatable:
 *   - The starting symbols are characters (Unicode code points), not UTF-8 bytes as production
 *     tokenisers use. Text is put in NFC form and, unless asked otherwise, in lower case.
 *   - Words are whatever sits between spaces (punctuation stays attached to its word). Each word
 *     ends with an end-of-word symbol, written "_" here, so "low" is l o w _. Pairs are counted
 *     inside words only, so a merge never crosses a word boundary.
 *   - One merge: count every adjacent pair of symbols in the text, take the most frequent, and
 *     make it one new token everywhere, left to right. Ties go to the pair that appears first in
 *     the text. Learning stops when no pair occurs twice, or at the number of merges asked for.
 *   - Encoding a new sentence splits it the same way and applies the merges in the order they
 *     were learnt. A character never seen in training has no token and becomes <unk> (id 0).
 */
import type { PartInfo } from './parts'
import { int, onlyVerbs, type Raw, type SimBase } from './specUtil'

/** The end-of-word symbol inside the model: a private-use character, so it cannot clash with real text */
export const END = ''
/** How the end-of-word symbol is written for the learner */
export const END_MARK = '_'
export const UNK = '<unk>'

export const BPE_LIMITS = { text: 600, sentence: 120, merges: [1, 60] as const }

export const DEFAULT_TEXT = 'low low low low low lower lower newest newest newest newest newest newest widest widest widest'
export const DEFAULT_SENTENCE = 'newer lowest wider'

/** A token as the learner sees it: the end-of-word symbol written "_" */
export const show = (token: string) => token.split(END).join(END_MARK)

/** Tidies text for the model: NFC, no control or private-use characters, single spaces, capped by characters (never half of one) */
export function tidy(text: string, max: number, lowercase: boolean): string {
  const clean = text
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cased = lowercase ? clean.toLowerCase() : clean
  return Array.from(cased).slice(0, max).join('').trim()
}

const wordsOf = (text: string) => text.split(' ').filter(Boolean)

/** A word as its starting symbols: its characters, then the end-of-word symbol */
export const symbolsOf = (word: string) => [...Array.from(word), END]

export interface Merge {
  /** Which merge this was, from 1 */
  n: number
  left: string
  right: string
  /** The new token: left and right joined */
  token: string
  id: number
  /** How many times the pair occurred when it was chosen */
  count: number
  /** Other pairs that occurred just as often and lost the tie, in the order they appear in the text */
  tied: [string, string][]
  /** Tokens in the text after this merge */
  length: number
}

export interface PairCount {
  left: string
  right: string
  count: number
}

/** Replaces every adjacent (left, right) with the joined token, scanning left to right */
export function mergePair(symbols: readonly string[], left: string, right: string): string[] {
  const out: string[] = []
  for (let i = 0; i < symbols.length; i++) {
    if (i + 1 < symbols.length && symbols[i] === left && symbols[i + 1] === right) {
      out.push(left + right)
      i++
    } else out.push(symbols[i])
  }
  return out
}

/** Applies merges in the order given, each one everywhere before the next is looked at */
export function applyMerges(symbols: readonly string[], merges: readonly { left: string; right: string }[]): string[] {
  let out = symbols.slice()
  for (const m of merges) if (out.length > 1) out = mergePair(out, m.left, m.right)
  return out
}

export interface Piece {
  /** The token's text (with the model's end-of-word symbol) */
  text: string
  id: number
  /** A character with no token: shown, but encoded as <unk> */
  unknown: boolean
  /** Which word of the sentence it belongs to, from 0 */
  word: number
}

interface Form {
  symbols: string[]
  count: number
}

export class Bpe {
  readonly text: string
  readonly lowercase: boolean
  readonly maxMerges: number
  /** The text as word instances, each an index into forms */
  readonly sequence: number[] = []
  /** Each distinct word once, in order of first appearance, as its current tokens */
  readonly forms: Form[] = []
  /** id → token; id 0 is <unk>, then the characters in order of first appearance, then the merges */
  readonly vocab: string[] = [UNK]
  readonly ids = new Map<string, number>()
  readonly merges: Merge[] = []
  /** Number of single-character tokens (with the end-of-word symbol) */
  readonly alphabet: number
  /** Tokens in the text before any merge */
  readonly startLength: number
  private counted: PairCount[] | null = null

  constructor(text: string, options: { lowercase?: boolean; merges?: number } = {}) {
    this.lowercase = options.lowercase !== false
    this.maxMerges = options.merges ?? 24
    this.text = tidy(text, BPE_LIMITS.text, this.lowercase)
    const seen = new Map<string, number>()
    for (const word of wordsOf(this.text)) {
      let at = seen.get(word)
      if (at === undefined) {
        at = this.forms.length
        seen.set(word, at)
        const symbols = symbolsOf(word)
        this.forms.push({ symbols, count: 0 })
        for (const s of symbols)
          if (!this.ids.has(s)) {
            this.ids.set(s, this.vocab.length)
            this.vocab.push(s)
          }
      }
      this.forms[at].count++
      this.sequence.push(at)
    }
    this.alphabet = this.vocab.length - 1
    this.startLength = this.length
  }

  /** Tokens in the text now */
  get length(): number {
    let n = 0
    for (const f of this.forms) n += f.symbols.length * f.count
    return n
  }

  get words(): number {
    return this.sequence.length
  }

  /** How many times shorter the text is than at the start (1 before any merge) */
  get compression(): number {
    return this.length ? this.startLength / this.length : 1
  }

  /**
   * Every adjacent pair with its count, most frequent first; ties in the order the pairs first
   * appear in the text. A pair is counted at every position, so "aaa" holds a + a twice.
   */
  pairs(): PairCount[] {
    if (this.counted) return this.counted
    // A Map keeps insertion order, and the distinct words are in order of first appearance, so
    // the order of insertion is the order of first appearance in the text
    const counts = new Map<string, PairCount>()
    for (const f of this.forms)
      for (let i = 0; i + 1 < f.symbols.length; i++) {
        const key = `${f.symbols[i]}\u0000${f.symbols[i + 1]}`
        const pair = counts.get(key)
        if (pair) pair.count += f.count
        else counts.set(key, { left: f.symbols[i], right: f.symbols[i + 1], count: f.count })
      }
    // Array.prototype.sort is stable, so equal counts keep their first-appearance order
    this.counted = Array.from(counts.values()).sort((a, b) => b.count - a.count)
    return this.counted
  }

  /** Why no further merge will be learnt, or null while one can be */
  get finished(): string | null {
    const n = this.merges.length
    const after = `after ${n} merge${n === 1 ? '' : 's'}`
    if (!this.forms.length) return 'There is no text to learn from'
    const top = this.pairs()[0]
    // Every word starts as at least a character and the end-of-word symbol, so this only happens after merging
    if (!top) return `Finished ${after}: every word is one token, so there are no pairs left`
    if (top.count < 2) return `Finished ${after}: no pair occurs more than once`
    if (n >= this.maxMerges) return `Stopped ${after}, the number asked for`
    return null
  }

  /** Learns one merge: the most frequent pair becomes a token. Null when finished. */
  step(): Merge | null {
    if (this.finished) return null
    const all = this.pairs()
    const top = all[0]
    const token = top.left + top.right
    const id = this.vocab.length
    this.vocab.push(token)
    this.ids.set(token, id)
    for (const f of this.forms) f.symbols = mergePair(f.symbols, top.left, top.right)
    this.counted = null
    const merge: Merge = {
      n: this.merges.length + 1,
      left: top.left,
      right: top.right,
      token,
      id,
      count: top.count,
      tied: all.slice(1).filter((p) => p.count === top.count).map((p) => [p.left, p.right]),
      length: this.length
    }
    this.merges.push(merge)
    return merge
  }

  /** Learns until finished or `n` merges are done; returns how many were learnt */
  run(n = Infinity): number {
    let did = 0
    while (did < n && this.step()) did++
    return did
  }

  /** Splits a sentence with the merges learnt so far, applied in the order they were learnt */
  encode(sentence: string): Piece[] {
    const out: Piece[] = []
    wordsOf(tidy(sentence, BPE_LIMITS.sentence, this.lowercase)).forEach((word, w) => {
      for (const text of applyMerges(symbolsOf(word), this.merges)) {
        const id = this.ids.get(text)
        out.push({ text, id: id ?? 0, unknown: id === undefined, word: w })
      }
    })
    return out
  }

  /** The text a list of token ids stands for; <unk> comes back as "�" */
  decode(ids: readonly number[]): string {
    return ids
      .map((id) => (id > 0 && id < this.vocab.length ? this.vocab[id] : '�'))
      .join('')
      .split(END)
      .join(' ')
      .trim()
  }

  /** The training text as it is segmented now: one list of tokens per word, in text order */
  segmented(): string[][] {
    return this.sequence.map((at) => this.forms[at].symbols)
  }

  /** The merge that made a token, or null for a single character or <unk> */
  madeBy(id: number): Merge | null {
    return this.merges[id - this.alphabet - 1] ?? null
  }
}

const pairText = (left: string, right: string) => `${show(left)} + ${show(right)}`
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

/** The sentence for a merge: which pair, how often, what the new token is, and how a tie was settled */
export function explainMerge(m: Merge): string {
  const names = m.tied.slice(0, 3).map(([l, r]) => pairText(l, r))
  const list = m.tied.length > 3 ? `${names.join(', ')} and ${m.tied.length - 3} more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  const tie = m.tied.length ? ` It tied with ${list}; the pair that appears first in the text wins.` : ''
  return `Merge ${m.n}: the most frequent pair is ${pairText(m.left, m.right)} (${times(m.count)}), so it becomes one new token, ${show(m.token)}, with id ${m.id}.${tie} The text is now ${m.length} tokens.`
}

// ---------- Spec ----------

export interface TokeniserSpec extends SimBase {
  kind: 'tokeniser'
  /** The training text */
  text: string
  /** Merges to learn at most */
  merges: number
  /** Merges already learnt when it is first shown */
  start: number
  /** The learner's sentence, split with the merges learnt so far */
  sentence: string
  lowercase: boolean
}

const VERBS = ['sentence', 'text'] as const

const words = (v: unknown): string => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' || typeof x === 'number').join(' ') : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

export function parseTokeniserSpec(raw: Raw, base: SimBase): TokeniserSpec | null {
  const lower = raw.lowercase ?? raw.lowerCase ?? raw.lower
  const lowercase = !(lower === false || lower === 'false' || lower === 'no' || raw.case === 'keep')
  const given = tidy(words(raw.text ?? raw.corpus ?? raw.training ?? raw.train), BPE_LIMITS.text, lowercase)
  const text = given || DEFAULT_TEXT
  const merges = int(raw.merges ?? raw.maxMerges ?? raw.steps, 24, ...BPE_LIMITS.merges)
  const sentence = tidy(words(raw.sentence ?? raw.input ?? raw.encode ?? raw.try), BPE_LIMITS.sentence, lowercase)
  const spec: TokeniserSpec = {
    ...base,
    kind: 'tokeniser',
    text,
    merges,
    start: int(raw.start ?? raw.learnt ?? raw.learned ?? raw.pretrain, 0, 0, merges),
    // With no sentence given, the default one for the default text, else the first words of the text
    sentence: sentence || (given ? wordsOf(text).slice(0, 4).join(' ') : DEFAULT_SENTENCE),
    lowercase
  }
  return onlyVerbs(spec, VERBS)
}

// ---------- Named parts ----------

export type TokeniserPart = { type: 'text' | 'pairs' | 'merges' | 'vocabulary' | 'sentence' | 'length' } | { type: 'pair' | 'merge' | 'token'; n: number }

/**
 * text, pairs, pair:N (rank in the counts, from 1), merges, merge:N, vocabulary, sentence,
 * token:N (of the learner's sentence), length (the text's length in tokens).
 */
export function parseTokeniserPart(name: string, bpe: Bpe, sentence: string): TokeniserPart | null {
  const [head, arg, ...more] = name.trim().toLowerCase().split(':')
  if (more.length) return null
  if (arg === undefined) {
    if (head === 'text' || head === 'pairs' || head === 'merges' || head === 'vocabulary' || head === 'sentence' || head === 'length') return { type: head }
    if (head === 'vocab') return { type: 'vocabulary' }
    if (head === 'tokens') return { type: 'sentence' }
    if (head === 'compression') return { type: 'length' }
    return null
  }
  if (!/^\d+$/.test(arg)) return null
  const n = Number(arg)
  if (n < 1) return null
  if (head === 'pair') return n <= bpe.pairs().length ? { type: 'pair', n } : null
  if (head === 'merge') return n <= bpe.merges.length ? { type: 'merge', n } : null
  if (head === 'token') return n <= bpe.encode(sentence).length ? { type: 'token', n } : null
  return null
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function describeTokeniserPart(part: TokeniserPart, bpe: Bpe, sentence: string): PartInfo {
  const learnt = bpe.merges.length
  const so = `with the ${learnt} merge${learnt === 1 ? '' : 's'} learnt so far`
  switch (part.type) {
    case 'text':
      return {
        label: `the training text (${bpe.words} words, now ${bpe.length} tokens, down from ${bpe.startLength} single characters and end-of-word marks)`,
        values: { words: bpe.words, tokens: bpe.length, start: bpe.startLength, merges: learnt }
      }
    case 'length':
      return {
        label: `the length of the training text in tokens (${bpe.length} now, ${bpe.startLength} at the start: ${bpe.compression.toFixed(2)} times shorter)`,
        values: { tokens: bpe.length, start: bpe.startLength, ratio: r2(bpe.compression), merges: learnt }
      }
    case 'pairs': {
      const all = bpe.pairs()
      const top = all[0]
      return {
        label: top ? `the pair counts (${all.length} different adjacent pairs; the most frequent is ${pairText(top.left, top.right)}, ${times(top.count)})` : 'the pair counts (there are no adjacent pairs left)',
        values: Object.fromEntries(all.slice(0, 6).map((p) => [pairText(p.left, p.right), p.count]))
      }
    }
    case 'pair': {
      const all = bpe.pairs()
      const p = all[part.n - 1]
      const next = part.n === 1 && !bpe.finished
      const tied = all.filter((q) => q.count === p.count).length - 1
      return {
        label: `the pair ${pairText(p.left, p.right)}, rank ${part.n} in the counts (it occurs ${times(p.count)}${next ? ' and is merged next' : ''}${next && tied ? `; it ties with ${tied} other${tied === 1 ? '' : 's'} and wins by appearing first in the text` : ''})`,
        values: { rank: part.n, count: p.count, left: show(p.left), right: show(p.right) }
      }
    }
    case 'merges':
      return {
        label: `the merges learnt so far (${learnt} of at most ${bpe.maxMerges}, applied in this order when encoding)`,
        values: Object.fromEntries(bpe.merges.slice(-6).map((m) => [`${m.n}`, `${pairText(m.left, m.right)}`]))
      }
    case 'merge': {
      const m = bpe.merges[part.n - 1]
      return {
        label: `merge ${m.n}, ${pairText(m.left, m.right)} → ${show(m.token)} (the pair occurred ${times(m.count)}; the new token has id ${m.id})`,
        values: { merge: m.n, token: show(m.token), id: m.id, count: m.count, textTokens: m.length }
      }
    }
    case 'vocabulary':
      return {
        label: `the vocabulary (${bpe.vocab.length} tokens: ${UNK}, ${bpe.alphabet} single characters including the end-of-word mark, and ${learnt} merged)`,
        values: { size: bpe.vocab.length, characters: bpe.alphabet, merged: learnt, newest: show(bpe.vocab[bpe.vocab.length - 1]) }
      }
    case 'sentence': {
      const pieces = bpe.encode(sentence)
      const unknown = pieces.filter((p) => p.unknown).length
      return {
        label: `the sentence "${tidy(sentence, BPE_LIMITS.sentence, bpe.lowercase)}" split into ${pieces.length} token${pieces.length === 1 ? '' : 's'} ${so}${unknown ? ` (${unknown} unknown)` : ''}`,
        values: { tokens: pieces.length, unknown, ids: pieces.slice(0, 12).map((p) => p.id).join(' ') }
      }
    }
    case 'token': {
      const p = bpe.encode(sentence)[part.n - 1]
      const by = bpe.madeBy(p.id)
      const how = p.unknown
        ? `a character never seen in training, so it has no token and is encoded as ${UNK}, id 0`
        : by
          ? `id ${p.id}, made by merge ${by.n}: ${pairText(by.left, by.right)}`
          : p.text === END
            ? `id ${p.id}, the end-of-word mark`
            : `id ${p.id}, a single character`
      return {
        label: `token ${part.n} of the sentence, "${show(p.text)}" (${how})`,
        values: { token: show(p.text), id: p.id, word: p.word + 1, ...(by ? { merge: by.n } : {}) }
      }
    }
  }
}
