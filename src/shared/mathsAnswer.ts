/**
 * The answer box in maths lessons (components/maths/MathsAnswerBox): one answer, three ways in.
 * - Say or type: plain words (Wispr Flow works), read back as rendered maths by Claude's quick
 *   model before marking, so a misreading costs one word to fix.
 * - Maths: an expression editor with a scientific calculator (shared/calc), and a working mode
 *   with one line per step, each step checked against the last by SymPy and marked by Claude.
 * - Paper: photos of handwritten working; Opus transcribes each line as LaTeX with where it sits
 *   on the page, the learner corrects any misread line, then Opus marks each line and the whole.
 *
 * Marks reach the lesson the usual way: the answer goes to the tutor with a note from Tide (which
 * the learner never sees, shared/session ownWords) holding the line marks and the verdict, so the
 * tutor's <grade> agrees with them and the lesson's marking, flashcards and teaching-quality
 * measures take it from there. Pure: prompts, parsing and the note, for the box, main and tests.
 */
import { jsonrepair } from 'jsonrepair'
import { imageMarkdown } from './noteImages'

export type Verdict = 'correct' | 'partial' | 'wrong'
export type StepStatus = 'ok' | 'bad' | 'unknown'
export type AnswerMode = 'words' | 'maths' | 'paper'
export const ANSWER_MODES: AnswerMode[] = ['words', 'maths', 'paper']

/** Where a line sits on its page: fractions of the page's width and height, from the top left */
export type Box = [x0: number, y0: number, x1: number, y1: number]

export interface PaperLine {
  latex: string
  /** Which page (0-based) */
  page: number
  box: Box | null
  /** Claude wasn't sure it read this line right */
  unsure?: boolean
  /** The learner corrected Claude's reading */
  edited?: boolean
}

export interface LineMark {
  /** true right, false wrong, null a line that claims nothing (a heading, words) */
  ok: boolean | null
  note: string
}

export interface Marked {
  lines: LineMark[]
  /** Left to the tutor when only SymPy marked it (it can't see the solution) */
  verdict: Verdict | null
  summary: string
  misconception?: { name: string; text: string }
  by: 'claude' | 'sympy'
}

/** What a marked answer carries into the lesson, and back out for the transcript */
export interface WorkingMarks {
  kind: 'paper' | 'steps'
  /** Vault paths of the photos, in order (paper only) */
  pages: string[]
  lines: PaperLine[]
  marks: Marked
}

export interface CalcResult {
  ok: boolean
  kind?: 'value' | 'solve' | 'truth'
  /** LaTeX */
  exact?: string | null
  /** A decimal (or LaTeX for a matrix), when there is one */
  numeric?: string | null
  /** Nothing simplified: the exact answer is just what was typed */
  unchanged?: boolean
  error?: string
}

export interface StepCheck {
  status: StepStatus
  why: string
}

// ---------- JSON from a model ----------

/** A lone backslash before a command name (\frac written unescaped in a JSON string) doubled, so it survives JSON.parse */
export const escapeLatex = (json: string) => json.replace(/(?<!\\)((?:\\\\)*)\\(?=[a-zA-Z]{2,})/g, '$1\\\\')

export function jsonFrom<T>(reply: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1] ?? reply
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const raw = escapeLatex(fenced.slice(start, end + 1))
  try {
    return JSON.parse(raw) as T
  } catch {
    try {
      return JSON.parse(jsonrepair(raw)) as T
    } catch {
      return null
    }
  }
}

/** Display maths without the dollars or brackets a model wraps it in */
export const bareLatex = (s: string) =>
  String(s ?? '')
    .trim()
    .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    .replace(/^\$([\s\S]*)\$$/, '$1')
    .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
    .replace(/^\\\(([\s\S]*)\\\)$/, '$1')
    .trim()

// ---------- Read-back ----------

export const READBACK_SYSTEM = `You turn what a learner said or typed about maths into LaTeX, exactly as they meant it, so they can check you understood them before it is marked. Never correct their maths, never finish or simplify it, never answer the question: a wrong answer stays wrong, written exactly. Spoken maths is loose ("x squared plus 3 x all over 2"): choose the reading a maths teacher would, and when it really could be two things, write the likelier and say so in "unclear". Keep their order and every mathematical statement they made, but drop the talk around it ("so I take", "and I get"): join steps with \\quad\\Rightarrow\\quad, separate statements with \\qquad, and keep a word as \\text{…} only when the maths would mislead without it. No dollar signs. Reply with JSON only: {"latex": "…", "unclear": "one short sentence on what could be read another way, or empty"}. When there's no maths in it at all, latex is "".`

export function readBackPrompt(words: string, question?: string): string {
  return `${question ? `The question they're answering (for context only, don't answer it):\n"""\n${question.slice(0, 1500)}\n"""\n\n` : ''}What they said:\n"""\n${words.slice(0, 4000)}\n"""`
}

export function parseReadBack(reply: string): { latex: string; unclear: string } | null {
  const j = jsonFrom<{ latex?: unknown; unclear?: unknown }>(reply)
  if (j && typeof j.latex === 'string') return { latex: bareLatex(j.latex), unclear: typeof j.unclear === 'string' ? j.unclear.trim() : '' }
  // A model that answered with the LaTeX alone
  const t = bareLatex(reply.replace(/```\w*|```/g, ''))
  if (t && !t.includes('{"') && t.length < 2000 && /[\\^_=+\-*/]/.test(t)) return { latex: t, unclear: '' }
  return null
}

// ---------- Paper: reading the page ----------

export const TRANSCRIBE_SYSTEM = `You read a learner's handwritten maths working from photos of paper, for their tutor. Transcribe it line by line, exactly as written, mistakes included: never correct, complete, tidy or reorder anything; a wrong sign stays wrong. Each line of working is one entry, in reading order, page by page. A line that runs onto a second physical line is one entry. Skip crossed-out work and doodles; keep a heading or the question if they wrote it. Words go in \\text{…}. Write fractions, roots, limits, integrals and matrices as LaTeX (\\frac, \\sqrt, \\lim_{h\\to 0}, \\int_0^1 … \\,dx, \\begin{pmatrix}…\\end{pmatrix}), and keep a line that starts with "=" starting with "=". No dollar signs.

For each line give its box on its page: [x0, y0, x1, y1], whole numbers from 0 to 1000 as thousandths of that page's width and height, from the top-left corner, drawn tightly around that line's handwriting. Set "unsure" when you couldn't read part of a line with confidence.

Reply with JSON only: {"lines": [{"page": 1, "latex": "…", "box": [x0, y0, x1, y1], "unsure": false}]}. Pages are numbered from 1 in the order the photos come.`

export function transcribePrompt(pages: number, question?: string): string {
  return `${question ? `The question they were answering (for context, so you can tell what the symbols are):\n"""\n${question.slice(0, 2000)}\n"""\n\n` : ''}${pages === 1 ? 'The photo of their working is above.' : `The ${pages} photos of their working are above, in order: page 1 first.`} Transcribe every line with its box.`
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** A box from a model, in thousandths (or fractions, or percent), as fractions of the page, or null when it isn't one */
export function toBox(raw: unknown): Box | null {
  let v: number[] | null = null
  if (Array.isArray(raw) && raw.length === 4 && raw.every((x) => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x))))) v = raw.map(Number)
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const n = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : Number.NaN)
    if (!Number.isNaN(n('x0'))) v = [n('x0'), n('y0'), n('x1'), n('y1')]
    else if (!Number.isNaN(n('x')) && !Number.isNaN(n('w'))) v = [n('x'), n('y'), n('x') + n('w'), n('y') + n('h')]
  }
  if (!v || v.some((x) => !Number.isFinite(x))) return null
  // Thousandths, as asked; fractions or percent from a model that forgot
  const max = Math.max(...v)
  const scale = max <= 1.0001 ? 1 : max <= 100.0001 && v.some((x) => x % 1 !== 0) ? 100 : 1000
  let [x0, y0, x1, y1] = v.map((x) => clamp01(x / scale))
  if (x1 < x0) [x0, x1] = [x1, x0]
  if (y1 < y0) [y0, y1] = [y1, y0]
  if (x1 - x0 < 0.01 || y1 - y0 < 0.004) return null
  return [x0, y0, x1, y1]
}

/** Claude's reading of the pages: its lines in order, each on a page that exists, boxes as fractions */
export function parseTranscription(reply: string, pages: number): PaperLine[] | null {
  const j = jsonFrom<{ lines?: unknown }>(reply)
  const list = Array.isArray(j?.lines) ? j!.lines : Array.isArray(j) ? (j as unknown[]) : null
  if (!list) return null
  const out: PaperLine[] = []
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue
    const latex = bareLatex(String(item.latex ?? item.tex ?? ''))
    if (!latex) continue
    const p = Math.round(Number(item.page ?? 1)) - 1
    const page = Number.isFinite(p) ? Math.min(Math.max(0, p), Math.max(0, pages - 1)) : 0
    out.push({ latex, page, box: toBox(item.box ?? item.bbox), ...(item.unsure === true ? { unsure: true } : {}) })
  }
  // Page by page, top to bottom: the order the learner wrote in
  return out.length ? out.map((l, i) => ({ l, i })).sort((a, b) => a.l.page - b.l.page || a.i - b.i).map((x) => x.l) : null
}

/** Where a line's box goes over its photo, as CSS percentages, padded a little so the ink isn't cut */
export function boxStyle(box: Box, pad = 0.008): { left: string; top: string; width: string; height: string } {
  const x0 = clamp01(box[0] - pad)
  const y0 = clamp01(box[1] - pad)
  const x1 = clamp01(box[2] + pad)
  const y1 = clamp01(box[3] + pad)
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`
  return { left: pct(x0), top: pct(y0), width: pct(x1 - x0), height: pct(y1 - y0) }
}

/** The learner's correction of one line, before it's marked */
export function correctLine(lines: PaperLine[], index: number, latex: string): PaperLine[] {
  const t = bareLatex(latex)
  return lines.map((l, i) => (i !== index ? l : t === l.latex ? l : { ...l, latex: t, edited: true, unsure: false }))
}

/** A line taken out (Claude read a doodle as working) */
export const dropLine = (lines: PaperLine[], index: number) => lines.filter((_, i) => i !== index)

// ---------- Marking each line ----------

export const MARK_LINES_SYSTEM = `You mark a learner's worked maths line by line, for their tutor. The question and the tutor's own solution are given (the solution is inside <solution> when there is one; the learner never saw it). Their lines are numbered as they wrote them; the reading has been checked by the learner, so take each line as written.

For each line: "ok" true when it is right and follows from what came before (any valid method or order is fine), false when it is wrong or doesn't follow, null for a line that claims nothing (a heading, the question copied out, words). After a wrong line, a later line that correctly follows from it is true, with a note that it carries the earlier slip. "note": one short sentence; for a wrong line, exactly what is wrong (the term dropped, the sign flipped), never a lecture. Tide's exact SymPy checks, when given, are facts about equality between lines: trust a "not equal" unless the line is plainly not an equality claim.

Then the whole answer: "verdict" correct (right and complete), partial (right method with a slip, or incomplete) or wrong. "summary": two or three sentences to the learner ("you"), naming the first wrong line by its number and what to do about it; no praise padding. "misconception": only when a wrong line comes from a specific wrong belief rather than a slip: {"name": "under 8 words", "description": "one sentence"}.

Write any maths in notes and the summary as LaTeX between single dollar signs ($3x^2h - 4h$).

Reply with JSON only: {"lines": [{"n": 1, "ok": true, "note": "…"}], "verdict": "…", "summary": "…", "misconception": null}.`

export function markLinesPrompt(question: string, lines: string[], checks?: StepCheck[]): string {
  const sympy = checks?.some((c) => c.status !== 'unknown')
    ? `\n\nTide's exact SymPy checks of each line against the one before:\n${checks
        .map((c, i) => (c.status === 'unknown' ? null : `line ${i + 1}: ${c.status === 'ok' ? 'equal (checked)' : `NOT equal: ${c.why}`}`))
        .filter(Boolean)
        .join('\n')}`
    : ''
  return `The tutor's message, with the question and its hidden solution:\n"""\n${question.slice(-8000)}\n"""\n\nThe learner's working, line by line:\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}${sympy}`
}

const VERDICTS: Verdict[] = ['correct', 'partial', 'wrong']

export function parseLineMarks(reply: string, count: number): Marked | null {
  const j = jsonFrom<{ lines?: unknown; verdict?: unknown; summary?: unknown; misconception?: unknown }>(reply)
  if (!j || !Array.isArray(j.lines) || !VERDICTS.includes(j.verdict as Verdict)) return null
  const marks: LineMark[] = Array.from({ length: count }, () => ({ ok: null, note: '' }))
  ;(j.lines as Record<string, unknown>[]).forEach((m, k) => {
    if (!m || typeof m !== 'object') return
    const n = Number(m.n ?? m.line ?? k + 1) - 1
    if (!Number.isInteger(n) || n < 0 || n >= count) return
    marks[n] = { ok: m.ok === true || m.ok === 'true' ? true : m.ok === false || m.ok === 'false' ? false : null, note: typeof m.note === 'string' ? m.note.trim() : '' }
  })
  const mis = j.misconception as { name?: unknown; description?: unknown; text?: unknown } | null | undefined
  const name = mis && typeof mis === 'object' && typeof mis.name === 'string' ? mis.name.trim().slice(0, 80) : ''
  return {
    lines: marks,
    verdict: j.verdict as Verdict,
    summary: typeof j.summary === 'string' ? j.summary.trim() : '',
    ...(name && j.verdict !== 'correct' ? { misconception: { name, text: String(mis!.description ?? mis!.text ?? '').trim().slice(0, 300) } } : {}),
    by: 'claude'
  }
}

/** Without Claude: SymPy's checks are the marks (wrong only where a step provably isn't equal), and the verdict is the tutor's */
export function marksFromSympy(checks: StepCheck[], count: number): Marked {
  const lines: LineMark[] = Array.from({ length: count }, (_, i) => {
    const c = checks[i]
    if (!c || c.status === 'unknown') return { ok: null, note: '' }
    return c.status === 'ok' ? { ok: true, note: 'Checked: equal to the line before.' } : { ok: false, note: `${c.why.charAt(0).toUpperCase()}${c.why.slice(1)}.` }
  })
  const bad = lines.findIndex((l) => l.ok === false)
  const ok = lines.filter((l) => l.ok === true).length
  return {
    lines,
    verdict: null,
    summary: bad >= 0 ? `SymPy found that line ${bad + 1} doesn’t follow from the one before.` : ok ? `SymPy checked ${ok === 1 ? 'one step' : `${ok} steps`} and found nothing wrong.` : 'These steps aren’t ones SymPy can check on its own.',
    by: 'sympy'
  }
}

// ---------- Into the lesson ----------

const TAG = 'working-marks'

/** The answer as it's sent: the words the learner sees in the transcript, and Tide's note for the tutor */
export function workingMessage(w: WorkingMarks): { body: string; note: string } {
  const numbered = w.lines.map((l, i) => `${i + 1}. $${l.latex}$`).join('\n')
  const pics = w.pages.map(imageMarkdown).join('\n')
  // The photos first: the working's last line is the final answer Tide checks exactly (main/lessonGuard)
  const body = `${w.kind === 'paper' ? 'My working on paper:' : 'My working:'}\n\n${pics ? `${pics}\n\n` : ''}${numbered}`
  const m = w.marks
  const each = m.lines
    .map((x, i) => (x.ok === null && !x.note ? null : `line ${i + 1} ${x.ok === true ? '✓' : x.ok === false ? '✗' : '·'}${x.note ? ` ${x.note}` : ''}`))
    .filter(Boolean)
    .join('; ')
  const who = m.by === 'claude' ? `Claude marked ${w.kind === 'paper' ? 'this working from the learner’s photo' : 'these steps'} line by line${w.kind === 'paper' ? ' (the learner checked the reading of each line first)' : ''}` : 'Tide checked each step against the one before with SymPy (exact, but it can only tell equal from not equal)'
  const verdict = m.verdict ? ` Verdict: "${m.verdict}". Use this verdict in your <grade>, and teach from the first wrong line.` : ' Mark the whole answer yourself; SymPy’s ✗ is a fact.'
  const mis = m.misconception ? ` The misconception behind it: ${m.misconception.name}${m.misconception.text ? ` (${m.misconception.text})` : ''}. Address it directly.` : ''
  const json = JSON.stringify({ kind: w.kind, pages: w.pages, lines: w.lines.map((l) => ({ ...l, box: l.box ? l.box.map((x) => Math.round(x * 1000) / 1000) : null })), marks: m })
  const note = `${who}: ${each || 'no line could be checked'}.${verdict}${mis}${m.summary ? ` Summary given to the learner: ${m.summary}` : ''}\n<${TAG}>${json}</${TAG}>`
  return { body, note }
}

/** The marks a message carries, for the transcript and for the lesson's marking; null when it has none */
export function parseWorkingMarks(message: string): WorkingMarks | null {
  const m = new RegExp(`<${TAG}>([\\s\\S]*?)</${TAG}>`).exec(message)
  if (!m) return null
  try {
    const j = JSON.parse(m[1]) as WorkingMarks
    if (!j || !Array.isArray(j.lines) || !j.marks || !Array.isArray(j.marks.lines)) return null
    return { kind: j.kind === 'paper' ? 'paper' : 'steps', pages: Array.isArray(j.pages) ? j.pages.map(String) : [], lines: j.lines, marks: j.marks }
  } catch {
    return null
  }
}

/** The note for an answer in words that Tide read back and the learner confirmed */
export const readBackNote = (latex: string) => `the learner confirmed that Tide read their words as this maths: $$${latex}$$`

/** The note an answer typed in the expression editor carries: its LaTeX, which SymPy can read */
export const mathsNote = (latexLines: string[]) => `the learner wrote this in the maths editor: ${latexLines.map((l) => `$$${l}$$`).join(' ')}`

/** The decimal from SymPy's 15 digits, shortened for the display ("0.833333333333333" → "0.833333333333") */
export function shortDecimal(s: string | null | undefined, digits = 12): string | null {
  if (!s) return null
  if (!/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s.trim())) return s
  const x = Number(s)
  if (!Number.isFinite(x)) return s
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax >= 1e12 || ax < 1e-6) {
    const [mant, e] = x.toExponential(digits - 1).split('e')
    return `${mant.replace(/\.?0+$/, '')}\\times10^{${Number(e)}}`
  }
  return String(Number(x.toPrecision(digits)))
}

/** The decimal is worth showing beside the exact answer only when it says something new */
export function decimalAdds(exact: string | null | undefined, decimal: string | null): boolean {
  if (!decimal) return false
  if (!exact) return true
  return exact.replace(/\s/g, '') !== decimal.replace(/\s/g, '')
}
