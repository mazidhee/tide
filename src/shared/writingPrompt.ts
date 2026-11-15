/**
 * Claude's part of a writing review: the prompt (by kind of piece), reading its JSON back into
 * anchored comments, the "I've fixed it" re-check of one span, the Socratic conversation beside
 * the piece, and putting a review together with the local checker's comments.
 *
 * Rules the prompt and the reading both hold: never write the piece for them (an example is
 * always a different sentence, and an example too close to their own words is dropped), protect
 * the voice (stylistic choices that work are named as strengths), and every comment quotes the
 * learner's exact words so it can be anchored.
 */
import { CATEGORIES, KIND_FOCUS, frontMatter, habitKey, improvements, kindLabel, locateQuote, makeAnchor, type Category, type Overall, type PieceRecord, type ReviewRun, type RubricLine, type Severity, type WritingComment, type WritingKind } from './writing'
import { countHits, type LocalComment } from './writingCheck'

/** The hard rule for "Show me" illustrations, shared by the full review and the draft check */
const SHOW_RULE = `"show" is for clarity, structure and argument comments (leave it out for mechanics): teach the technique (join two short sentences, put the point first, cut a hedge, vary the rhythm, add a concrete example, signpost a turn) on an invented, DIFFERENT sentence about a completely different subject (cooking, sport, weather, travel...). HARD RULE: "before" and "after" must not reuse the learner's words, names, images or topic, and must never be a rewrite of their sentence. Any illustration that does is thrown away.`

export const REVIEW_SYSTEM = `You are a demanding, kind writing teacher reviewing a learner's own writing. You never write it for them: no rewrites of their sentences, no suggested replacement text, no "try: ...". You point at the exact words, name the problem and the principle, and ask them to fix it. When an illustration helps, you use a DIFFERENT sentence on a different subject. You protect their voice: you don't flatten style or impose a house tone, and you name stylistic choices that work as strengths. Reply with JSON only.`

/** The review prompt for one piece */
export function reviewPrompt(o: { text: string; kind: WritingKind; title: string; found: LocalComment[]; previous?: { overall?: Overall; resolved: string[]; open: string[] }; light?: boolean }): string {
  const f = KIND_FOCUS[o.kind]
  const mech =
    f.mechanics === 'light' && o.light !== false
      ? 'Mechanics: only where they get in the way of meaning (this is a journal).'
      : 'Mechanics in full: sentence boundaries (comma splices, run-ons, fused sentences), semicolons and colons used wrongly, apostrophes, agreement, capitals, question marks. Name the rule each time ("comma splice", "semicolon joins unrelated clauses").'
  const already = o.found.length
    ? `\nTide's own checker already marked these (don't repeat them; you may add others of the same rule it missed):\n${o.found
        .slice(0, 40)
        .map((c) => `- ${c.ruleName}: "${c.anchor.quote}"`)
        .join('\n')}`
    : ''
  const again = o.previous
    ? `\nThis is a REVIEW AGAIN after a revision. Last time the top points were:\n${(o.previous.overall?.top ?? []).map((t) => `- ${t}`).join('\n') || '- (none kept)'}\nComments they fixed since: ${o.previous.resolved.slice(0, 12).join(' | ') || 'none'}\nStill open: ${o.previous.open.slice(0, 12).join(' | ') || 'none'}\nSay in "improved" what got better (specific), and don't repeat points that are now fixed.`
    : ''
  return `Review this ${kindLabel(o.kind).toLowerCase()}: "${o.title}".
What matters for this kind: ${f.emphasis}
${mech}
Rubric for this kind: ${f.rubric.join(', ')} (score each 1 to 5).${already}${again}

Return JSON exactly in this shape:
{
  "works": ["what works, specific, 1 to 3 items"],
  "voice": ["stylistic choices that work and should be kept, quoting a few of their words"],
  "top": ["the 3 things that matter most, in order"],
  "question": "one question about the argument or the thinking itself",
  "rubric": [{"name": "Clarity", "score": 3, "note": "one line"}],
  "improved": ["only on a review again: what got better"],
  "comments": [
    {"quote": "the learner's exact words, copied character for character, 3 to 15 words",
     "category": "mechanics | clarity | structure | argument | accuracy",
     "rule": "for mechanics: the rule's name, e.g. comma splice",
     "severity": "minor | moderate | major",
     "what": "what is wrong here, one sentence",
     "principle": "the principle behind it, one or two sentences",
     "ask": "ask them to fix it: a question or an instruction, never the fixed text",
     "show": {"before": "a made-up sentence on a different subject with the same kind of problem", "after": "that made-up sentence improved with the technique", "why": "the technique in one line"}}
  ]
}
${SHOW_RULE}
Between 6 and 18 comments, the most important first; prefer clarity, structure and argument over small mechanics. Accuracy: check every technical claim; say why a claim is wrong or overstated.

The piece:
<<<
${o.text}
>>>`
}

/** Pulls the first JSON object out of a model's reply */
export function jsonIn(text: string): Record<string, unknown> | null {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try {
    return JSON.parse(text.slice(s, e + 1))
  } catch {
    return null
  }
}

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, n) : [])

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])
/** How much of `a`'s wording turns up in `b` (0 to 1) */
export function overlap(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (!x.size) return 0
  let n = 0
  for (const w of x) if (y.has(w)) n++
  return n / x.size
}

/** The sentence (roughly) around a quote, for telling whether an example rewrites it */
const around = (text: string, start: number, end: number) => {
  const s = Math.max(text.lastIndexOf('.', start - 1), text.lastIndexOf('\n', start - 1)) + 1
  const e = text.slice(end).search(/[.?!\n]/)
  return text.slice(s, e < 0 ? text.length : end + e)
}

export const ruleId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/^comma-splices?$/, 'comma-splice')
    .replace(/^run-on(-sentences?)?$/, 'run-on')
    .slice(0, 40)

const STOP = new Set('the a an and or but of to in on at for with is are was were be been it its this that these those as by from not no so if then than i you he she we they my your our their me him her them do does did have has had will would can could should just very'.split(' '))
const content = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w))

/**
 * Whether an illustration reuses the learner's words: most of its wording is their sentence's,
 * it shares a run of four words with the piece (or three that aren't small words), or it borrows
 * three or more of the sentence's own content words (names, images, the topic).
 */
export function reusesTheirWords(text: string, sentence: string, example: string): boolean {
  if (!example.trim()) return false
  if (overlap(sentence, example) > 0.5) return true
  const seq = example.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
  const flat = ' ' + (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).join(' ') + ' '
  const has = (ws: string[]) => flat.includes(' ' + ws.join(' ') + ' ')
  const big = (w: string) => w.length > 2 && !STOP.has(w)
  for (let i = 0; i + 3 <= seq.length; i++) {
    if (i + 4 <= seq.length && has(seq.slice(i, i + 4))) return true
    if (seq.slice(i, i + 3).every(big) && has(seq.slice(i, i + 3))) return true
  }
  const theirs = new Set(content(sentence))
  return new Set(content(example).filter((w) => theirs.has(w))).size >= 3
}

/** One of Claude's comments, anchored; null when its quote isn't in the text (or isn't where it's allowed to be) */
function readComment(c: Record<string, unknown>, text: string, id: string, at: number, within?: { start: number; end: number }[]): WritingComment | null {
  const quote = str(c?.quote, 400)
  if (!quote) return null
  let loc = locateQuote(text, quote)
  if (loc && within && !within.some((w) => loc!.start >= w.start && loc!.end <= w.end)) {
    // The first match was outside the paragraphs checked: look inside each of them
    loc = null
    for (const w of within) {
      const l = locateQuote(text.slice(w.start, w.end), quote)
      if (l) {
        loc = { start: w.start + l.start, end: w.start + l.end }
        break
      }
    }
  }
  if (!loc) return null
  const category = (CATEGORIES as readonly string[]).includes(str(c.category)) ? (str(c.category) as Category) : 'clarity'
  const severity: Severity = c.severity === 'major' || c.severity === 'minor' ? c.severity : 'moderate'
  const rule = str(c.rule, 60)
  const sentence = around(text, loc.start, loc.end)
  let example = str(c.example, 400)
  // An "example" that reuses their sentence is a rewrite: it goes
  if (example && reusesTheirWords(text, sentence, example)) example = ''
  const sh = (c.show && typeof c.show === 'object' ? c.show : {}) as Record<string, unknown>
  const show = { before: str(sh.before, 300), after: str(sh.after, 300), why: str(sh.why, 200) }
  const keepShow = category !== 'mechanics' && !!show.before && !!show.after && show.before !== show.after && !reusesTheirWords(text, sentence, show.before) && !reusesTheirWords(text, sentence, show.after)
  const ask = str(c.ask, 400) || 'How would you fix this?'
  return {
    id,
    category,
    ...(rule ? { rule: ruleId(rule), ruleName: rule.replace(/^\p{Ll}/u, (x) => x.toUpperCase()) } : {}),
    severity,
    anchor: makeAnchor(text, loc.start, loc.end),
    what: str(c.what, 400),
    principle: str(c.principle, 500),
    ask,
    ...(example ? { example } : {}),
    ...(keepShow ? { show: { ...show, why: show.why || str(c.principle, 200) } } : {}),
    by: 'claude',
    status: 'open',
    at
  }
}

/** Claude's comments in a reply, anchored; one comment per span (the first stays) */
function readComments(list: unknown, text: string, at: number, within?: { start: number; end: number }[], tag = 'c'): WritingComment[] {
  const out: WritingComment[] = []
  let k = 0
  for (const c of Array.isArray(list) ? (list as Record<string, unknown>[]) : []) {
    const r = readComment(c, text, `${tag}:${at.toString(36)}:${k}`, at, within)
    if (!r || out.some((x) => x.anchor.start === r.anchor.start && x.anchor.end === r.anchor.end)) continue
    k++
    out.push(r)
  }
  return out
}

/** Claude's reply as the overall note and anchored comments; comments whose quote isn't in the text are dropped */
export function parseReview(reply: string, text: string, at = Date.now()): { overall: Overall; comments: WritingComment[] } | null {
  const j = jsonIn(reply)
  if (!j) return null
  const rubric: RubricLine[] = Array.isArray(j.rubric)
    ? (j.rubric as Record<string, unknown>[])
        .map((r) => ({ name: str(r?.name, 40), score: Math.max(0, Math.min(5, Math.round(Number(r?.score) || 0))), of: 5, note: str(r?.note, 300) }))
        .filter((r) => r.name)
        .slice(0, 6)
    : []
  const overall: Overall = { works: strs(j.works, 3), voice: strs(j.voice, 3), top: strs(j.top, 3), question: str(j.question, 400), improved: strs(j.improved, 5), rubric }
  return { overall, comments: readComments(j.comments, text, at) }
}

// ---------- Draft check: a paragraph or two while writing ----------

export interface Para {
  start: number
  end: number
  text: string
}

/** The piece's paragraphs (after the front matter), with where they are */
export function paragraphs(text: string): Para[] {
  const from = frontMatter(text).end
  const out: Para[] = []
  const push = (a: number, b: number) => {
    const raw = text.slice(a, b)
    const lead = raw.length - raw.trimStart().length
    const t = raw.trim()
    // Headings, embeds and rules aren't prose to check
    if (t && !/^(#{1,6}\s|!\[\[|---$|```)/.test(t)) out.push({ start: a + lead, end: a + lead + t.length, text: t })
  }
  const re = /\n[ \t]*\n/g
  re.lastIndex = from
  let s = from
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(s, m.index)
    s = m.index + m[0].length
  }
  push(s, text.length)
  return out
}

/** A short key for a paragraph's wording (spacing ignored) */
export function paraKey(p: string): string {
  let h = 5381
  for (const ch of p.replace(/\s+/g, ' ').trim()) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0
  return h.toString(36)
}

/** The paragraphs written or changed since the last check (keys from `checked`) */
export function changedParagraphs(text: string, checked: string[] | undefined): Para[] {
  const seen = new Set(checked ?? [])
  return paragraphs(text).filter((p) => !seen.has(paraKey(p.text)))
}

/** The paragraph a position is in (or the paragraphs a selection touches) */
export function paragraphsAt(text: string, from: number, to = from): Para[] {
  const ps = paragraphs(text)
  const hit = ps.filter((p) => p.end >= from && p.start <= to)
  if (hit.length) return hit
  // In the blank space between paragraphs: the one just before
  const before = ps.filter((p) => p.end <= from)
  return before.length ? [before[before.length - 1]] : ps.slice(0, 1)
}

export const DRAFT_SYSTEM = `You are a writing teacher looking over a learner's shoulder while they draft. The piece is UNFINISHED: never judge it as a whole, never ask for a thesis, a claim or a conclusion, never say the piece doesn't yet say something. Look only at the paragraph(s) you're given: does each sentence flow into the next, is each one clear, does the rhythm work. You never rewrite their sentences. Reply with JSON only.`

/** The draft check's prompt: only the paragraphs given, light and about flow and clarity */
export function draftPrompt(o: { text: string; parts: { text: string }[]; kind: WritingKind }): string {
  return `They're drafting a ${kindLabel(o.kind).toLowerCase()} and asked you to look at what they just wrote.
${o.parts.length > 1 ? 'The paragraphs' : 'The paragraph'} to check:
${o.parts.map((p) => `<<<\n${p.text}\n>>>`).join('\n')}

Return JSON exactly in this shape:
{
  "note": "one short line on how it reads so far (flow and clarity), specific, no verdict on the piece",
  "comments": [
    {"quote": "their exact words from the paragraph(s) above, copied character for character, 3 to 15 words",
     "category": "clarity | structure | mechanics",
     "rule": "for mechanics only: the rule's name",
     "severity": "minor | moderate",
     "what": "what gets in the way here, one short sentence",
     "principle": "the principle, one sentence",
     "ask": "a question or an instruction, never the fixed text",
     "show": {"before": "a made-up sentence on a different subject with the same kind of problem", "after": "that made-up sentence improved", "why": "the technique in one line"}}
  ]
}
${SHOW_RULE}
At most 4 comments, flow and clarity first (how sentences join, where the point sits, rhythm, hedges, vague words); mechanics only where they blur the meaning. Fewer is fine: if it reads well, say so and return no comments. Quote only from the paragraph(s) to check.

For context only (don't comment on it), the piece so far begins:
<<<
${o.text.slice(0, 3000)}
>>>`
}

/** The draft check's reply: a line on how it reads, and comments inside the paragraphs checked */
export function parseDraftCheck(reply: string, text: string, parts: { start: number; end: number }[], at = Date.now()): { note: string; comments: WritingComment[] } | null {
  const j = jsonIn(reply)
  if (!j) return null
  const comments = readComments(j.comments, text, at, parts, 'd')
    .filter((c) => c.category !== 'argument' && c.category !== 'accuracy')
    .slice(0, 4)
    .map((c) => ({ ...c, severity: c.severity === 'major' ? ('moderate' as const) : c.severity, draft: true }))
  return { note: str(j.note, 300), comments }
}

/**
 * A draft check put together: the checker's and the last draft check's open comments inside the
 * checked paragraphs give way to the new ones; the full review's comments (there and elsewhere)
 * are left as they are. The checked paragraphs are remembered so the next check looks only at what changed.
 */
export function combineDraftCheck(rec: PieceRecord, o: { text: string; parts: Para[]; local: LocalComment[]; claude: WritingComment[] }): PieceRecord {
  const inside = (c: { anchor: { start: number; end: number } }) => o.parts.some((p) => c.anchor.start >= p.start && c.anchor.end <= p.end)
  const local = o.local.filter(inside).map((c) => ({ ...c, draft: true, more: (c.more ?? []).filter((m) => inside({ anchor: m })) }))
  const theirs = o.claude.filter((c) => !(c.category === 'mechanics' && local.some((l) => l.anchor.start < c.anchor.end && c.anchor.start < l.anchor.end)))
  // The full review's own comments there stay (they follow their words); the last check's go
  const kept = rec.comments.filter((c) => c.status !== 'open' || !inside(c) || (c.by === 'claude' && !c.draft))
  // The keys of paragraphs still in the piece, with the ones just checked
  const now = new Set(paragraphs(o.text).map((p) => paraKey(p.text)))
  const checked = [...new Set([...(rec.checked ?? []), ...o.parts.map((p) => paraKey(p.text))])].filter((k) => now.has(k))
  return { ...rec, comments: [...kept, ...local, ...theirs], checked }
}

/** The overall note without Claude: what the checker can say from the counts */
export function localOverall(found: LocalComment[], prev?: ReviewRun, next?: ReviewRun): Overall {
  const byRule = new Map<string, number>()
  for (const c of found) byRule.set(c.ruleName ?? c.category, (byRule.get(c.ruleName ?? c.category) ?? 0) + 1 + (c.more?.length ?? 0))
  const top = [...byRule].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r}: ${n} place${n === 1 ? '' : 's'}`)
  return { works: [], voice: [], top, question: '', improved: prev && next ? improvements(prev, next) : [], rubric: [] }
}

/**
 * A review put together: the checker's comments, then Claude's (a Claude mechanics comment on the
 * same words as one of the checker's is left out), the run for the habits, and the record updated.
 * Open comments from the last review give way to the new ones; resolved and dismissed ones stay
 * in the record (for the counts) but aren't shown.
 */
export function combineReview(rec: PieceRecord, o: { text: string; words: number; kind: WritingKind; local: LocalComment[]; claude?: { overall: Overall; comments: WritingComment[] } | null; at: number }): PieceRecord {
  const local = o.local
  const theirs = (o.claude?.comments ?? []).filter((c) => !(c.category === 'mechanics' && local.some((l) => l.anchor.start < c.anchor.end && c.anchor.start < l.anchor.end && (l.rule === c.rule || !c.rule))))
  const counts = countHits(local)
  for (const c of theirs) counts[habitKey(c)] = (counts[habitKey(c)] ?? 0) + 1
  const run: ReviewRun = { at: o.at, words: o.words, by: o.claude ? 'claude' : 'tide', kind: o.kind, counts }
  const prev = rec.runs[rec.runs.length - 1]
  const overall = o.claude?.overall ?? localOverall(local, prev, run)
  // On a review again, code adds what the counts show improved to what Claude said
  if (prev && o.claude) overall.improved = [...overall.improved, ...improvements(prev, run).filter((l) => !overall.improved.some((x) => x.includes(l.split(':')[0])))].slice(0, 6)
  const kept = rec.comments.filter((c) => c.status !== 'open').slice(-200)
  return { ...rec, comments: [...kept, ...local, ...theirs], overall, runs: [...rec.runs, run].slice(-30), checked: paragraphs(o.text).map((p) => paraKey(p.text)) }
}

// ---------- "I've fixed it" ----------

export const RECHECK_SYSTEM = 'You check whether a learner fixed one specific problem in their own writing. You never rewrite their text. Reply with JSON only.'

export function recheckPrompt(c: WritingComment, passage: string): string {
  return `The comment was on these words: "${c.anchor.quote}"
Problem: ${c.what}${c.ruleName ? ` (${c.ruleName})` : ''}
Principle: ${c.principle}

The passage as it reads now:
<<<
${passage}
>>>

Is that problem fixed now, without a new problem of the same kind? Reply {"fixed": true|false, "note": "one sentence: what is better, or what is still wrong (don't give the fix)"}`
}

export function parseRecheck(reply: string): { fixed: boolean; note: string } | null {
  const j = jsonIn(reply)
  if (!j || typeof j.fixed !== 'boolean') return null
  return { fixed: j.fixed, note: str(j.note, 300) }
}

/** The passage a re-check looks at: the paragraph around a span */
export function passageAround(text: string, start: number, end: number): { start: number; end: number; text: string } {
  const s = text.lastIndexOf('\n\n', Math.max(0, start - 1))
  const e = text.indexOf('\n\n', end)
  const from = s < 0 ? 0 : s + 2
  const to = e < 0 ? text.length : e
  return { start: from, end: to, text: text.slice(from, to) }
}

// ---------- The conversation beside the piece ----------

/** The Socratic conversation's instructions (Learn's "Review my writing" challenges, in a side panel) */
export function challengeSystem(kind: WritingKind): string {
  return `You are a Socratic sparring partner on the learner's own ${kindLabel(kind).toLowerCase()}. Challenge their thinking: one pointed question or counterargument at a time, tied to an exact short quote from their text (put the quote in “curly quotes”). Push back on vague answers. Never rewrite their text or offer replacement sentences. Keep each reply under 90 words. Plain text, no headings.`
}

export function challengePrompt(text: string, turns: { role: 'tutor' | 'learner'; text: string }[]): string {
  const talk = turns.map((t) => `${t.role === 'tutor' ? 'You' : 'Learner'}: ${t.text}`).join('\n\n')
  return `Their piece:
<<<
${text.slice(0, 24000)}
>>>
${talk ? `\nThe conversation so far:\n${talk}\n\nReply to the learner's last message.` : '\nOpen with your first challenge: the claim most worth testing.'}`
}

// ---------- Topics ----------

export interface Topic {
  title: string
  /** A short description (the Things to-do's notes) */
  note?: string
  /** The group it sits in: a Things heading, or the topics note's section */
  group: string
  from: 'things' | 'note'
  /** The Things to-do */
  thingsId?: string
  /** Ticked in the topics note */
  done?: boolean
}

/** Things to-dos and the topics note together: Things first, the note's items whose titles aren't there already after */
export function mergeTopics(things: Topic[], note: Topic[]): Topic[] {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const seen = new Set(things.map((t) => key(t.title)))
  return [...things, ...note.filter((t) => !seen.has(key(t.title)))]
}

/** A Things list's open to-dos as topics, grouped by heading */
export function topicsFromThings(items: { id: string; type: string; title: string; notes?: string; status: string; heading?: { title: string } }[], project: string): Topic[] {
  return items
    .filter((i) => i.type === 'to-do' && i.status === 'open' && i.title.trim())
    .map((i) => ({ title: i.title.trim(), ...(i.notes?.trim() ? { note: i.notes.trim().split('\n')[0].slice(0, 200) } : {}), group: i.heading?.title ?? project, from: 'things' as const, thingsId: i.id }))
}
