/**
 * The local checker: mechanics that need no model, found in code and anchored to the exact text
 * like any reviewer's comment. It reads only prose: front matter, code, embeds, links' targets,
 * tables and quotations are left alone, and list items aren't held to paragraph rules.
 *
 * Rules (each comment names its rule, says what's wrong, the principle, and asks the learner to
 * fix it, with an example on a different sentence when one helps):
 *   comma-splice        ", it is" after a main clause: two sentences joined by only a comma
 *   sentence-capital    a sentence (after . ? !) or a paragraph that starts in lowercase
 *   lowercase-i         the pronoun written "i" ("i am", "i'm")
 *   space-before-punct  "word ," / "word ?"
 *   double-space        two or more spaces between words
 *   repeated-word       "the the"
 *   question-mark       a direct question ending without "?"
 *   missing-end         a paragraph whose last sentence has no end mark
 *   long-sentence       far longer than the piece's usual sentence
 *   long-paragraph      a paragraph of more than 200 words
 *
 * The same rule in one paragraph makes one comment, with every place it happens marked; after the
 * first two comments of a rule, the rest say so briefly instead of explaining again.
 */
import { findAnchor, frontMatter, habitKey, makeAnchor, type Anchor, type Category, type Severity, type WritingComment } from './writing'

export interface Block {
  kind: 'para' | 'list' | 'heading'
  start: number
  end: number
}

/** Prose blocks with their offsets in the whole text */
export function proseBlocks(md: string): Block[] {
  const out: Block[] = []
  const fmEnd = frontMatter(md).end
  let pos = 0
  let fence: string | null = null
  let cur: Block | null = null
  const close = () => {
    if (cur) out.push(cur)
    cur = null
  }
  for (const line of md.split('\n')) {
    const start = pos
    const end = pos + line.length
    pos = end + 1
    if (start < fmEnd) continue
    const f = line.match(/^\s*(```+|~~~+)/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      continue
    }
    if (f) {
      close()
      fence = f[1]
      continue
    }
    const t = line.trim()
    if (!t || /^(---+|\*\*\*+|___+)$/.test(t) || /^>/.test(t) || /^\|/.test(t) || /^(!\[\[[^\]]*\]\]\s*)+$/.test(t) || /^!\[[^\]]*\]\([^)]*\)$/.test(t) || /^<[^>]+>$/.test(t) || /^\$\$/.test(t)) {
      close()
      continue
    }
    if (/^#{1,6}\s/.test(t)) {
      close()
      out.push({ kind: 'heading', start, end })
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      close()
      cur = { kind: 'list', start, end }
      continue
    }
    if (cur) cur.end = end
    else cur = { kind: 'para', start, end }
  }
  close()
  return out
}

const M = '§'

/**
 * The text with everything that isn't the learner's prose masked out, offsets kept: inline code,
 * embeds and wiki links, link targets, bare URLs, HTML tags and inline maths become "§".
 */
export function maskProse(md: string): string {
  const mask = (s: string) => s.replace(/[^\n]/g, M)
  return md
    .replace(/`[^`\n]+`/g, mask)
    .replace(/!?\[\[[^\]\n]*\]\]/g, mask)
    .replace(/\]\([^)\n]*\)/g, (m) => ']' + mask(m.slice(1)))
    .replace(/https?:\/\/\S+/g, mask)
    .replace(/<[^>\n]+>/g, mask)
    .replace(/\$[^$\n]+\$/g, mask)
}

const ABBREV = /\b(e\.g|i\.e|etc|vs|cf|mr|mrs|ms|dr|st|no|fig|eq|al|approx)\.$/i

/** Sentences of one block of masked text: [start, end) offsets relative to the whole text */
export function sentences(masked: string, b: Block): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const text = masked.slice(b.start, b.end)
  let s = 0
  const re = /[.?!]+["”’)*_=]*(?=\s+|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    const before = text.slice(s, end)
    if (m[0].startsWith('.') && !m[0].startsWith('..') && ABBREV.test(before.replace(/["”’)*_=]+$/, ''))) continue
    // A decimal or a version number: not a sentence end
    if (/\d$/.test(text.slice(0, m.index)) && /^\d/.test(text.slice(end).trimStart())) continue
    if (before.trim()) out.push({ start: b.start + s + (before.length - before.trimStart().length), end: b.start + end })
    s = end
  }
  const rest = text.slice(s)
  if (rest.trim()) out.push({ start: b.start + s + (rest.length - rest.trimStart().length), end: b.start + s + rest.trimEnd().length })
  return out
}

const wordsIn = (s: string) => (s.match(/[\p{L}\p{N}§][\p{L}\p{N}§'’-]*/gu) ?? []).length

// ---------- The rules' words ----------

interface RuleText {
  name: string
  category: Category
  severity: Severity
  what: string
  principle: string
  ask: string
  example?: string
  /** What a later comment of the same rule says */
  again: string
}

export const RULES: Record<string, RuleText> = {
  'comma-splice': {
    name: 'Comma splice',
    category: 'mechanics',
    severity: 'moderate',
    what: 'Two complete sentences are joined by only a comma.',
    principle: 'A comma can’t hold two independent clauses together on its own. Use a full stop, a semicolon when the two are closely linked, or a joining word (and, but, so, because) that shows how they relate.',
    ask: 'Find where the first complete thought ends. Which fits the link between the two: a full stop, a semicolon, or a word like “but” or “because”?',
    example: 'Not “The loss plateaued, we lowered the learning rate.” but “The loss plateaued, so we lowered the learning rate.”',
    again: 'Another comma splice: two sentences held by a comma.'
  },
  'sentence-capital': {
    name: 'Sentence starts lowercase',
    category: 'mechanics',
    severity: 'minor',
    what: 'A new sentence begins with a lowercase letter.',
    principle: 'A capital marks where a sentence starts; without it the reader can’t see the boundary you made.',
    ask: 'Is this meant to be a new sentence? If so, give it its capital; if not, the mark before it should change.',
    example: 'Not “Is the cache warm? the first call says no.” but “Is the cache warm? The first call says no.”',
    again: 'Another sentence starting lowercase.'
  },
  'lowercase-i': {
    name: 'Lowercase “i”',
    category: 'mechanics',
    severity: 'minor',
    what: 'The pronoun “I” is written lowercase.',
    principle: 'In English the first-person pronoun is always a capital I, wherever it falls in the sentence, and so are its contractions (I’m, I’ve, I’d).',
    ask: 'Capitalise each one marked here.',
    again: 'Lowercase “i” again.'
  },
  'space-before-punct': {
    name: 'Space before punctuation',
    category: 'mechanics',
    severity: 'minor',
    what: 'There’s a space before the punctuation mark.',
    principle: 'In English, commas, full stops, colons, semicolons, question and exclamation marks sit right against the word before them, with the space after.',
    ask: 'Close the gap before each mark highlighted.',
    example: 'Not “Training is slow , but stable .” but “Training is slow, but stable.”',
    again: 'Another space before a punctuation mark.'
  },
  'double-space': {
    name: 'Double space',
    category: 'mechanics',
    severity: 'minor',
    what: 'Two spaces between words.',
    principle: 'One space separates words; extra ones show up as uneven gaps once the piece is published.',
    ask: 'Take out the extra space.',
    again: 'Another double space.'
  },
  'repeated-word': {
    name: 'Repeated word',
    category: 'mechanics',
    severity: 'minor',
    what: 'The same word twice in a row.',
    principle: 'A doubled word is almost always a slip from editing; readers trip on it.',
    ask: 'Read it aloud: which one should stay?',
    again: 'Another doubled word.'
  },
  'question-mark': {
    name: 'Question without “?”',
    category: 'mechanics',
    severity: 'minor',
    what: 'This reads as a direct question but doesn’t end with a question mark.',
    principle: 'A direct question ends with “?”, even a rhetorical one; it tells the reader how to hear the sentence.',
    ask: 'Is this a question you’re asking the reader? Then close it with the mark that says so.',
    example: 'Not “Why does the gradient vanish.” but “Why does the gradient vanish?”',
    again: 'Another question without its question mark.'
  },
  'missing-end': {
    name: 'No end punctuation',
    category: 'mechanics',
    severity: 'minor',
    what: 'The paragraph’s last sentence has no full stop, question mark or exclamation mark.',
    principle: 'Every sentence ends with a mark, the last one in a paragraph too; without it the thought reads as cut off.',
    ask: 'How should this sentence end: a statement, a question, or is something missing from it?',
    again: 'Another paragraph that stops without an end mark.'
  },
  'long-sentence': {
    name: 'Very long sentence',
    category: 'mechanics',
    severity: 'moderate',
    what: 'This sentence is much longer than your others, and the reader has to hold every clause at once.',
    principle: 'One sentence, one main move. A long run of clauses joined by commas usually hides several sentences (and often a comma splice or two).',
    ask: 'Where does each separate thought begin? Mark those joints and decide which deserve their own sentence.',
    example: 'A sentence like “The model overfits, the validation loss rises after epoch three, we stop early, it helps but not enough, so we add dropout” is four or five sentences.',
    again: 'Another very long sentence: look for its joints.'
  },
  'long-paragraph': {
    name: 'Very long paragraph',
    category: 'structure',
    severity: 'moderate',
    what: 'This paragraph runs past 200 words.',
    principle: 'A paragraph is one step in the argument. When it runs this long it usually holds two or three, and the reader loses where one ends.',
    ask: 'What is this paragraph’s one point? Where does it turn to the next one?',
    again: 'Another very long paragraph.'
  }
}

// ---------- The rules ----------

const SUBORDINATE = /^(if|when|whenever|because|although|though|even though|as|since|while|after|before|unless|until|once|whether|where|wherever|given|for every|for each|whatever)\b/i
const SPLICE = /,\s+(?:(i|it|this|he|she|they|we|you|there|these|those)\s+(is|was|are|were|am|do|does|did|have|has|had|will|would|can|could|should|must|seems?|feels?|think|know|get|got|became|becomes|makes?|means?|'s|’s|'m|’m|'re|’re|'ll|’ll|just|never|always|still|really)|(it|he|she)\s+[a-z]{2,}(?:s|ed))\b/gi
const QUESTION_START = /^(why|how come|(?:what|how|who|where|when|which)\s+(?:do|does|did|is|are|was|were|can|could|would|should|will|has|have)|(?:do|does|did|can|could|would|should|will|is|are|isn't|aren't|don't|doesn't|won't|wouldn't|shouldn't|isn’t|aren’t|don’t|doesn’t|won’t)\s+(?:you|i|we|they|it|he|she|this|that|there|anyone|people|the|your|my|not))\b/i
const MATHS_I = /\b(index|element|row|column|item|position|step|variable|term|for|each|layer|token|node|vertex|bit|digit|entry)\s+$/i

interface Hit {
  rule: string
  start: number
  end: number
}

function findHits(md: string): { hits: Hit[]; blocks: Block[] } {
  const masked = maskProse(md)
  const blocks = proseBlocks(md)
  const hits: Hit[] = []
  const push = (rule: string, start: number, end: number) => hits.push({ rule, start, end })
  const allSentences = blocks.filter((b) => b.kind === 'para').flatMap((b) => sentences(masked, b))
  const lengths = allSentences.map((s) => wordsIn(masked.slice(s.start, s.end))).sort((a, b) => a - b)
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0
  for (const b of blocks) {
    if (b.kind === 'heading') continue
    const text = masked.slice(b.start, b.end)
    const at = (i: number) => b.start + i
    let m: RegExpExecArray | null
    // Double spaces between words (not indentation, not a line break's two trailing spaces)
    const dbl = /(?<=[^\s]) {2,}(?=[^\s])/g
    while ((m = dbl.exec(text))) push('double-space', at(m.index - prevWordLen(text, m.index)), at(m.index + m[0].length + nextWordLen(text, m.index + m[0].length)))
    // A space before , ; : ? ! or a single full stop
    const sp = /(?<=[\p{L}\p{N}§)\]"”’*_=]) +(?:[,;:?!]|\.(?!\.))(?=\s|$|["”’)*_=])/gu
    while ((m = sp.exec(text))) push('space-before-punct', at(m.index - prevWordLen(text, m.index)), at(m.index + m[0].length))
    // The pronoun i
    const low = /(?<![\p{L}\p{N}_§'’.\-/\\])i(?:['’](?:m|ve|d|ll))?(?![\p{L}\p{N}_§=(\[\-/])(?!\.\w)/gu
    while ((m = low.exec(text))) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6)
      if (/^\s*(in|=|<|>|\+|-|\)|,\s*j)\b/.test(after) && m[0] === 'i') continue
      if (MATHS_I.test(text.slice(Math.max(0, m.index - 12), m.index))) continue
      push('lowercase-i', at(m.index), at(m.index + m[0].length))
    }
    // Doubled words
    const rep = /(?<![\p{L}\p{N}])(\p{L}+)\s+\1(?![\p{L}\p{N}])/giu
    while ((m = rep.exec(text))) if (!/^(had|that|is)$/i.test(m[1])) push('repeated-word', at(m.index), at(m.index + m[0].length))
    if (b.kind !== 'para') continue
    const words = wordsIn(text)
    if (words > 200) {
      const first = text.trimStart()
      const lead = text.length - first.length
      const cut = first.match(/^(?:\S+\s+){0,6}\S+/)?.[0] ?? first.slice(0, 40)
      push('long-paragraph', at(lead), at(lead + cut.length))
    }
    const ss = sentences(masked, b)
    ss.forEach((s, k) => {
      const sent = masked.slice(s.start, s.end)
      const n = wordsIn(sent)
      // Comma splices: ", it is" after a main clause
      const re = new RegExp(SPLICE.source, 'gi')
      let c: RegExpExecArray | null
      while ((c = re.exec(sent))) {
        const before = sent.slice(0, c.index)
        const clause = before.split(/[,;:]/).pop()!.trim()
        if (wordsIn(before) < 3 || SUBORDINATE.test(sent.trim()) || SUBORDINATE.test(clause) || /\b(and|but|or|so|yet)$/i.test(clause) || /^(that is|that's)/i.test(sent.slice(c.index + 1).trim())) continue
        // The word before the comma through the clause that follows it
        const from = c.index - prevWordLen(sent, c.index)
        push('comma-splice', s.start + from, s.start + c.index + c[0].length)
      }
      // A sentence that starts lowercase (the pronoun i is its own rule)
      const firstChar = sent.match(/^["“'‘(*_=]*(\p{L})/u)
      if (firstChar && /\p{Ll}/u.test(firstChar[1]) && !/^["“'‘(*_=]*i(\s|['’])/.test(sent) && (k > 0 || s.start === b.start + (text.length - text.trimStart().length))) {
        const prev = k > 0 ? ss[k - 1] : null
        // After an ellipsis, a colon-like dash, or a quoted fragment it may be on purpose
        if (!prev || !/\.\.\.["”’]*$|…$/.test(masked.slice(prev.start, prev.end))) {
          const w = sent.match(/^["“'‘(*_=]*\S+/)![0]
          push('sentence-capital', s.start, s.start + w.length)
        }
      }
      // A direct question without its mark
      const plain = sent.replace(/^["“'‘(*_=]+/, '')
      const end = sent.replace(/["”’)*_=\s]+$/, '').slice(-1)
      if (QUESTION_START.test(plain) && end !== '?' && n <= 30) {
        const last = sent.replace(/["”’)*_=\s]+$/, '')
        const tail = last.match(/\S+$/)?.[0] ?? ''
        push('question-mark', s.start + last.length - tail.length, s.start + last.length)
      } else if (k === ss.length - 1 && /[\p{L}\p{N}]/u.test(end)) {
        const last = sent.replace(/["”’)*_=\s]+$/, '')
        const tail = last.match(/(?:\S+\s+)?\S+$/)?.[0] ?? ''
        push('missing-end', s.start + last.length - tail.length, s.start + last.length)
      }
      // Far longer than the piece's usual sentence
      if (n >= 45 || (n >= 32 && median > 0 && n > 2.2 * median)) {
        const lead = sent.match(/^(?:\S+\s+){0,5}\S+/)?.[0] ?? sent.slice(0, 30)
        push('long-sentence', s.start, s.start + lead.length)
      }
    })
  }
  // A masked span never anchors a comment
  return { hits: hits.filter((h) => h.end > h.start && !masked.slice(h.start, h.end).includes(M)), blocks }
}

function prevWordLen(text: string, i: number): number {
  const m = text.slice(Math.max(0, i - 40), i).match(/[^\s]+$/)
  return m ? m[0].length : 0
}
function nextWordLen(text: string, i: number): number {
  const m = text.slice(i, i + 40).match(/^[^\s]+/)
  return m ? m[0].length : 0
}

export type LocalComment = WritingComment

/** Rules whose places are gathered into one comment for the whole piece: the fix is the same each time */
const WHOLE_PIECE = new Set(['lowercase-i', 'double-space', 'space-before-punct'])

/**
 * The local checker's comments on a piece. Journals get the light check (only what gets in the
 * way of reading: splices, missing ends, questions, very long sentences) unless asked for full.
 */
export function checkMechanics(md: string, o: { light?: boolean; at?: number } = {}): LocalComment[] {
  const { hits, blocks } = findHits(md)
  const LIGHT = new Set(['comma-splice', 'missing-end', 'question-mark', 'long-sentence', 'long-paragraph'])
  const blockOf = (pos: number) => blocks.findIndex((b) => pos >= b.start && pos <= b.end)
  const groups = new Map<string, Hit[]>()
  const sorted = hits.filter((h) => !o.light || LIGHT.has(h.rule)).sort((a, b) => a.start - b.start)
  // Overlapping hits of the same rule (a triple space found twice) collapse
  const seen = new Set<string>()
  for (const h of sorted) {
    const k = `${h.rule}:${h.start}`
    if (seen.has(k)) continue
    seen.add(k)
    const key = WHOLE_PIECE.has(h.rule) ? h.rule : `${h.rule}@${blockOf(h.start)}`
    groups.set(key, [...(groups.get(key) ?? []), h])
  }
  const shown = new Map<string, number>()
  const out: LocalComment[] = []
  for (const hs of [...groups.values()].sort((a, b) => a[0].start - b[0].start)) {
    const h = hs[0]
    const r = RULES[h.rule]
    const n = shown.get(h.rule) ?? 0
    shown.set(h.rule, n + 1)
    const brief = n >= 2
    const count = hs.length > 1 ? ` (${hs.length} ${WHOLE_PIECE.has(h.rule) ? 'in this piece' : 'in this paragraph'})` : ''
    out.push({
      id: `t:${h.rule}:${h.start}`,
      category: r.category,
      rule: h.rule,
      ruleName: r.name,
      severity: r.severity,
      anchor: makeAnchor(md, h.start, h.end),
      ...(hs.length > 1 ? { more: hs.slice(1).map((x) => makeAnchor(md, x.start, x.end)) } : {}),
      what: (brief ? r.again : r.what) + count,
      principle: brief ? '' : r.principle,
      ask: r.ask,
      ...(r.example && !brief ? { example: r.example } : {}),
      by: 'tide',
      status: 'open',
      at: o.at ?? Date.now()
    })
  }
  return out
}

/** How many times each rule fires, every place counted (for the habits) */
export function countHits(cs: LocalComment[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of cs) {
    const k = habitKey(c)
    out[k] = (out[k] ?? 0) + 1 + (c.more?.length ?? 0)
  }
  return out
}

/** Whether a rule still fires on the text between two offsets (for "I've fixed it" on a local comment) */
export function stillThere(md: string, rule: string, start: number, end: number): boolean {
  const { hits } = findHits(md)
  return hits.some((h) => h.rule === rule && h.start < end && h.end > start)
}

/**
 * "I've fixed it" on one of the checker's comments: each place it marked, found again in the
 * text as it is now, checked for the same rule. Places whose words are gone count as fixed.
 * Returns the places still wrong (empty: fixed).
 */
export function recheckLocal(md: string, c: WritingComment): Anchor[] {
  if (!c.rule) return []
  const { hits } = findHits(md)
  const left: Anchor[] = []
  for (const a of [c.anchor, ...(c.more ?? [])]) {
    const at = findAnchor(md, a)
    if (!at) continue
    if (hits.some((h) => h.rule === c.rule && h.start <= at.end && h.end >= at.start)) left.push(makeAnchor(md, at.start, at.end))
  }
  return left
}
