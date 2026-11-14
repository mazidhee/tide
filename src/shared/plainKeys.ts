/**
 * The maths keys for plain text fields (a thread, the lesson's answer box when it isn't the maths
 * box, the chat): the same keypad as the maths answer box (components/maths/Keypad), with keys that
 * type readable text rather than LaTeX. 1011₂, 2⁸ − 1, √(2), x ≤ 3: what a person would write, and
 * what the tutor reads without any markup. Pure, so the tests pin every key's text.
 *
 * A key's `insert` is the text it types. `#0` in it stands for the selection (√( ) wraps what's
 * selected, or leaves the caret between the brackets). `#sup` raises the selection to superscript
 * (2 then select 10 then ⁿ: 2¹⁰). `tex` is what the same key types into the calculator, a MathLive
 * field, when that has the caret instead.
 */

export interface PlainKey {
  label: string
  insert?: string
  tex?: string
  command?: string
  title: string
  text: true
  tone?: 'digit' | 'op' | 'fn' | 'act'
}

export interface PlainPage {
  id: string
  label: string
  title: string
  keys: PlainKey[]
}

const key = (label: string, insert: string, title: string, tone: PlainKey['tone'] = 'fn', tex?: string): PlainKey => ({ label, insert, title, tone, text: true, ...(tex !== undefined ? { tex } : {}) })
const digit = (n: string) => key(n, n, n, 'digit', n)

const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', k: 'ᵏ' }
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎' }

/** "10" → "¹⁰": every character that has a superscript form; the rest stay as they are */
export const superscript = (s: string) => [...s].map((c) => SUPER[c] ?? c).join('')
/** "16" → "₁₆" */
export const subscript = (s: string) => [...s].map((c) => SUB[c] ?? c).join('')

const sup = (d: string) => key(`x${superscript(d)}`, superscript(d), `Superscript ${d}`, 'fn', `^{${d}}`)
const base = (b: string) => key(`n${subscript(b)}`, subscript(b), `Base ${b}, after a number: 1011${subscript(b)}`, 'fn', `_{${b}}`)

export const PLAIN_PAGES: PlainPage[] = [
  {
    id: 'plain-basic',
    label: '123',
    title: 'Numbers and arithmetic',
    keys: [
      digit('7'), digit('8'), digit('9'), key('÷', ' ÷ ', 'Divide', 'op', '\\div'), key('(', '(#0)', 'Brackets', 'op', '\\left(#0\\right)'), key(')', ')', 'Close bracket', 'op', ')'), key('π', 'π', 'π', 'fn', '\\pi'),
      digit('4'), digit('5'), digit('6'), key('×', ' × ', 'Multiply', 'op', '\\times'), key('x²', '²', 'Squared', 'fn', '#@^{2}'), key('x³', '³', 'Cubed', 'fn', '#@^{3}'), key('√( )', '√(#0)', 'Square root', 'fn', '\\sqrt{#0}'),
      digit('1'), digit('2'), digit('3'), key('−', ' − ', 'Subtract', 'op', '-'), key('±', '±', 'Plus or minus', 'op', '\\pm'), key('·', ' · ', 'Times, as a dot', 'op', '\\cdot'), key('xⁿ', '#sup', 'Raise the selection to a power (select 10 after 2: 2¹⁰), or use the superscript keys on the next page', 'fn', '#@^{#?}'),
      digit('0'), key('.', '.', 'Decimal point', 'digit', '.'), key('=', ' = ', 'Equals', 'op', '='), key('+', ' + ', 'Add', 'op', '+'), key('≈', ' ≈ ', 'Roughly equal', 'op', '\\approx'), key('≤', ' ≤ ', 'At most', 'op', '\\le'), key('≥', ' ≥ ', 'At least', 'op', '\\ge')
    ]
  },
  {
    id: 'plain-more',
    label: 'xⁿ ₂',
    title: 'Powers, bases and hex digits',
    keys: [
      ...['0', '1', '2', '3', '4', '5', '6'].map(sup),
      ...['7', '8', '9'].map(sup), key('xⁿ', 'ⁿ', 'Superscript n', 'fn', '^{n}'), key('x⁻', '⁻', 'Superscript minus (2⁻¹)', 'fn', '^{-}'), key('≠', ' ≠ ', 'Not equal', 'op', '\\ne'), key('<', ' < ', 'Less than', 'op', '<'),
      ...['2', '8', '10', '16'].map(base), key('A', 'A', 'Hex digit A (10)', 'digit', 'A'), key('B', 'B', 'Hex digit B (11)', 'digit', 'B'), key('C', 'C', 'Hex digit C (12)', 'digit', 'C'),
      key('D', 'D', 'Hex digit D (13)', 'digit', 'D'), key('E', 'E', 'Hex digit E (14)', 'digit', 'E'), key('F', 'F', 'Hex digit F (15)', 'digit', 'F'), key('0x', '0x', 'Hex prefix, as code writes it', 'fn'), key('0b', '0b', 'Binary prefix, as code writes it', 'fn'), key('→', ' → ', 'Becomes', 'op', '\\to'), key('>', ' > ', 'Greater than', 'op', '>')
    ]
  }
]

/** The text in a field and what's selected (start = end: just a caret) */
export interface FieldState {
  text: string
  start: number
  end: number
}

/** Spaces round an operator, but no doubled spaces and none at the start of the field */
function spaced(before: string, insert: string, after: string): string {
  let s = insert
  if (s.startsWith(' ') && (before === '' || /\s$/.test(before))) s = s.trimStart()
  if (s.endsWith(' ') && /^\s/.test(after)) s = s.trimEnd()
  return s
}

/** What a key does to a plain text field: the new text and where the caret goes */
export function applyPlainKey(f: FieldState, k: { insert?: string; command?: string }): FieldState {
  const start = Math.max(0, Math.min(f.start, f.end, f.text.length))
  const end = Math.min(f.text.length, Math.max(f.start, f.end))
  const before = f.text.slice(0, start)
  const sel = f.text.slice(start, end)
  const after = f.text.slice(end)
  switch (k.command) {
    case 'moveToPreviousChar': {
      const at = sel ? start : Math.max(0, start - 1)
      return { text: f.text, start: at, end: at }
    }
    case 'moveToNextChar': {
      const at = sel ? end : Math.min(f.text.length, end + 1)
      return { text: f.text, start: at, end: at }
    }
    case 'deleteBackward': {
      if (sel) return { text: before + after, start, end: start }
      if (!before) return { text: f.text, start, end: start }
      // A whole character, surrogate pairs included
      const chars = [...before]
      chars.pop()
      const kept = chars.join('')
      return { text: kept + after, start: kept.length, end: kept.length }
    }
    case 'deleteAll':
      return { text: '', start: 0, end: 0 }
  }
  const ins = k.insert ?? ''
  if (!ins) return { text: f.text, start, end }
  if (ins === '#sup') {
    // Raise what's selected; with nothing selected, the ⁿ to fill in by hand
    const raised = sel ? superscript(sel) : 'ⁿ'
    const at = before.length + raised.length
    return { text: before + raised + after, start: at, end: at }
  }
  if (ins.includes('#0')) {
    const [open, close] = ins.split('#0')
    const text = before + open + sel + close + after
    // Something wrapped: the caret after it; nothing: between the brackets
    const at = sel ? before.length + open.length + sel.length + close.length : before.length + open.length
    return { text, start: at, end: at }
  }
  const s = spaced(before, ins, after)
  const at = before.length + s.length
  return { text: before + s + after, start: at, end: at }
}

/** The calculator's answer (LaTeX) as readable text: \frac{3}{4} → 3/4, 2^{10} → 2¹⁰, \sqrt{2} → √(2) */
export function latexToPlain(latex: string): string {
  let s = latex
    .trim()
    .replace(/\\left|\\right/g, '')
    .replace(/\\pi\b/g, 'π')
    .replace(/\\infty\b/g, '∞')
    .replace(/\\exponentialE\b/g, 'e')
    .replace(/\\imaginaryI\b/g, 'i')
  const group = String.raw`\{([^{}]*)\}`
  const atom = (x: string) => (/^[\p{L}\p{N}.]+$|^\(.*\)$/u.test(x) ? x : `(${x})`)
  // Innermost first, so nested fractions and roots unwind
  for (let i = 0; i < 8; i++) {
    const was = s
    s = s
      .replace(new RegExp(String.raw`\\[dt]?frac` + group + group, 'g'), (_m, a: string, b: string) => `${atom(a)}/${atom(b)}`)
      .replace(new RegExp(String.raw`\\sqrt\[([^\]]*)\]` + group, 'g'), (_m, n: string, a: string) => `${superscript(n)}√(${a})`)
      .replace(new RegExp(String.raw`\\sqrt` + group, 'g'), (_m, a: string) => `√(${a})`)
      .replace(new RegExp(String.raw`\^` + group, 'g'), (_m, a: string) => ([...a].every((c) => SUPER[c]) ? superscript(a) : `^(${a})`))
      .replace(new RegExp(String.raw`_` + group, 'g'), (_m, a: string) => ([...a].every((c) => SUB[c]) ? subscript(a) : `_(${a})`))
      .replace(new RegExp(String.raw`\\(?:mathrm|text|operatorname)` + group, 'g'), '$1')
    if (s === was) break
  }
  s = s
    .replace(/\^(\w)/g, (_m, c: string) => SUPER[c] ?? `^${c}`)
    .replace(/\\times/g, ' × ')
    .replace(/\\div/g, ' ÷ ')
    .replace(/\\cdot/g, ' · ')
    .replace(/\\pm/g, '±')
    .replace(/\\approx/g, ' ≈ ')
    .replace(/\\le(q)?\b/g, ' ≤ ')
    .replace(/\\ge(q)?\b/g, ' ≥ ')
    .replace(/\\ne(q)?\b/g, ' ≠ ')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s*=\s*/g, ' = ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return s
}

