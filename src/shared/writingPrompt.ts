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
import { CATEGORIES, KIND_FOCUS, habitKey, improvements, kindLabel, locateQuote, makeAnchor, type Category, type Overall, type PieceRecord, type ReviewRun, type RubricLine, type Severity, type WritingComment, type WritingKind } from './writing'
import { countHits, type LocalComment } from './writingCheck'

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
     "example": "optional: the same problem shown on a DIFFERENT sentence, never theirs"}
  ]
}
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
  const comments: WritingComment[] = []
  const used: [number, number][] = []
  let k = 0
  for (const c of Array.isArray(j.comments) ? (j.comments as Record<string, unknown>[]) : []) {
    const quote = str(c?.quote, 400)
    const loc = quote ? locateQuote(text, quote) : null
    if (!loc) continue
    // Two comments on the same words: the first stays
    if (used.some(([s, e]) => s === loc.start && e === loc.end)) continue
    used.push([loc.start, loc.end])
    const category = (CATEGORIES as readonly string[]).includes(str(c.category)) ? (str(c.category) as Category) : 'clarity'
    const severity: Severity = c.severity === 'major' || c.severity === 'minor' ? c.severity : 'moderate'
    const rule = str(c.rule, 60)
    let example = str(c.example, 400)
    // An "example" that reuses their sentence is a rewrite: it goes
    if (example && overlap(around(text, loc.start, loc.end), example) > 0.5) example = ''
    const ask = str(c.ask, 400) || 'How would you fix this?'
    comments.push({
      id: `c:${at.toString(36)}:${k++}`,
      category,
      ...(rule ? { rule: ruleId(rule), ruleName: rule.replace(/^\p{Ll}/u, (x) => x.toUpperCase()) } : {}),
      severity,
      anchor: makeAnchor(text, loc.start, loc.end),
      what: str(c.what, 400),
      principle: str(c.principle, 500),
      ask,
      ...(example ? { example } : {}),
      by: 'claude',
      status: 'open',
      at
    })
  }
  return { overall, comments }
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
  return { ...rec, comments: [...kept, ...local, ...theirs], overall, runs: [...rec.runs, run].slice(-30) }
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
