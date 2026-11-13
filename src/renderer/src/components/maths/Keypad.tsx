import { useMemo, useState } from 'react'
import katex from 'katex'

/**
 * The maths keypad: a scientific calculator's keys, laid out the way a real one is (digits on the
 * left, operators beside them), in five pages. Each key types into whichever field has the caret:
 * a line of working or the calculator. `#@` takes what's just before the caret (x then x² squares
 * it), `#?` leaves a box to fill, `#0` wraps what's selected. Keys never take the focus, so typing
 * carries on where it was.
 */

export interface Key {
  /** LaTeX shown on the key (or text when `text` is set) */
  label: string
  /** LaTeX typed, or a MathLive command */
  insert?: string
  command?: string | [string, ...unknown[]]
  title: string
  text?: boolean
  tone?: 'digit' | 'op' | 'fn' | 'act'
  wide?: boolean
}

const k = (label: string, insert: string, title: string, tone: Key['tone'] = 'fn', extra: Partial<Key> = {}): Key => ({ label, insert, title, tone, ...extra })
const d = (n: string) => k(n, n, n, 'digit')

export const KEYPAGES: { id: string; label: string; title: string; keys: Key[] }[] = [
  {
    id: 'basic',
    label: '123',
    title: 'Numbers and arithmetic',
    keys: [
      d('7'), d('8'), d('9'), k('\\div', '\\div', 'Divide', 'op'), k('(', '\\left(#0\\right)', 'Brackets', 'op'), k(')', ')', 'Close bracket', 'op'), k('\\frac{\\square}{\\square}', '\\frac{#@}{#?}', 'Fraction (or type /)', 'fn'),
      d('4'), d('5'), d('6'), k('\\times', '\\times', 'Multiply (× between two 3-vectors is the cross product)', 'op'), k('\\square^2', '#@^{2}', 'Square', 'fn'), k('\\square^{\\square}', '#@^{#?}', 'Power (or type ^)', 'fn'), k('\\sqrt{\\square}', '\\sqrt{#0}', 'Square root (or type sqrt)', 'fn'),
      d('1'), d('2'), d('3'), k('-', '-', 'Subtract', 'op'), k('x', 'x', 'x', 'fn'), k('y', 'y', 'y', 'fn'), k('\\sqrt[\\square]{\\square}', '\\sqrt[#?]{#0}', 'nth root', 'fn'),
      d('0'), k('.', '.', 'Decimal point', 'digit'), k('\\pi', '\\pi', 'π (or type pi)', 'fn'), k('+', '+', 'Add', 'op'), k('e', '\\exponentialE', "e, Euler's number", 'fn'), k('=', '=', 'Equals: an equation is solved for x', 'op'), k('\\square_{n}', '#@_{#?}', 'Subscript (or type _)', 'fn')
    ]
  },
  {
    id: 'functions',
    label: 'f(x)',
    title: 'Trig, logs and other functions',
    keys: [
      k('\\sin', '\\sin\\left(#0\\right)', 'Sine'), k('\\cos', '\\cos\\left(#0\\right)', 'Cosine'), k('\\tan', '\\tan\\left(#0\\right)', 'Tangent'), k('\\ln', '\\ln\\left(#0\\right)', 'Natural log'), k('\\log_{10}', '\\log_{10}\\left(#0\\right)', 'Log base 10'), k('\\log_{\\square}', '\\log_{#?}\\left(#0\\right)', 'Log to any base'), k('e^{\\square}', '\\exponentialE^{#0}', 'e to the power'),
      k('\\sin^{-1}', '\\sin^{-1}\\left(#0\\right)', 'Inverse sine (arcsin)'), k('\\cos^{-1}', '\\cos^{-1}\\left(#0\\right)', 'Inverse cosine (arccos)'), k('\\tan^{-1}', '\\tan^{-1}\\left(#0\\right)', 'Inverse tangent (arctan)'), k('|\\square|', '\\left|#0\\right|', 'Absolute value'), k('n!', '#@!', 'Factorial'), k('\\binom{n}{k}', '\\binom{#?}{#?}', 'n choose k'), k('10^{\\square}', '10^{#0}', 'Ten to the power'),
      k('\\sinh', '\\sinh\\left(#0\\right)', 'Hyperbolic sine'), k('\\cosh', '\\cosh\\left(#0\\right)', 'Hyperbolic cosine'), k('\\tanh', '\\tanh\\left(#0\\right)', 'Hyperbolic tangent'), k('\\square^{\\circ}', '#@^{\\circ}', 'Degrees (or type deg)'), k('\\%', '\\%', 'Per cent'), k('\\lfloor \\square \\rfloor', '\\lfloor #0 \\rfloor', 'Floor'), k('\\square^{-1}', '#@^{-1}', 'Reciprocal or inverse'),
      k('<', '<', 'Less than', 'op'), k('\\le', '\\le', 'At most', 'op'), k('>', '>', 'Greater than', 'op'), k('\\ge', '\\ge', 'At least', 'op'), k('\\ne', '\\ne', 'Not equal', 'op'), k(',', ',', 'Comma', 'op'), k('f(x)', 'f\\left(#0\\right)', 'A function f of …')
    ]
  },
  {
    id: 'calculus',
    label: '∫ dx',
    title: 'Calculus: derivatives, integrals, limits, sums',
    keys: [
      k('\\frac{d}{dx}', '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(#0\\right)', 'Derivative with respect to x'), k('\\frac{d^2}{dx^2}', '\\frac{\\mathrm{d}^2}{\\mathrm{d}x^2}\\left(#0\\right)', 'Second derivative'), k("f'(x)", "f'\\left(#?\\right)", 'f prime'), k('\\frac{dy}{dx}', '\\frac{\\mathrm{d}y}{\\mathrm{d}x}', 'dy/dx'), k('\\int', '\\int #0\\,\\mathrm{d}x', 'Integral (or type int)'), k('\\int_a^b', '\\int_{#?}^{#?} #0\\,\\mathrm{d}x', 'Definite integral'), k('dx', '\\,\\mathrm{d}x', 'The differential dx'),
      k('\\lim_{x\\to a}', '\\lim_{x\\to #?} #0', 'Limit (or type lim)'), k('\\lim_{h\\to 0}', '\\lim_{h\\to 0} #0', 'Limit as h → 0, for first principles'), k('\\lim_{x\\to a^+}', '\\lim_{x\\to #?^{+}} #0', 'Limit from the right'), k('\\lim_{x\\to\\infty}', '\\lim_{x\\to\\infty} #0', 'Limit at infinity'), k('\\to', '\\to', 'Tends to'), k('\\infty', '\\infty', 'Infinity (or type oo)'), k('h', 'h', 'h'),
      k('\\sum', '\\sum_{#?=#?}^{#?} #0', 'Sum (sigma)'), k('\\prod', '\\prod_{#?=#?}^{#?} #0', 'Product (pi)'), k('\\sum_{n=1}^{\\infty}', '\\sum_{n=1}^{\\infty} #0', 'Infinite series'), k('n', 'n', 'n'), k('i', 'i', 'i, as an index'), k('t', 't', 't'), k('+C', '+C', 'Constant of integration')
    ]
  },
  {
    id: 'matrix',
    label: '[ ]',
    title: 'Matrices and vectors',
    keys: [
      k('\\begin{pmatrix}\\cdot&\\cdot\\\\\\cdot&\\cdot\\end{pmatrix}', '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}', '2 × 2 matrix'), k('\\begin{pmatrix}\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\end{pmatrix}', '\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}', '3 × 3 matrix'), k('\\begin{pmatrix}\\cdot\\\\\\cdot\\end{pmatrix}', '\\begin{pmatrix}#?\\\\#?\\end{pmatrix}', 'Vector in 2D'), k('\\begin{pmatrix}\\cdot\\\\\\cdot\\\\\\cdot\\end{pmatrix}', '\\begin{pmatrix}#?\\\\#?\\\\#?\\end{pmatrix}', 'Vector in 3D'), k('\\det', '\\det\\left(#0\\right)', 'Determinant'), k('\\begin{vmatrix}\\cdot&\\cdot\\\\\\cdot&\\cdot\\end{vmatrix}', '\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}', 'Determinant, as bars'), k('A^{T}', '#@^{T}', 'Transpose'),
      k('A^{-1}', '#@^{-1}', 'Inverse'), k('\\cdot', '\\cdot', 'Dot (or plain product)', 'op'), k('\\times', '\\times', 'Cross product of two 3-vectors', 'op'), k('\\text{+ row}', '', 'Add a row below', 'act', { command: 'addRowAfter', text: true }), k('\\text{+ col}', '', 'Add a column to the right', 'act', { command: 'addColumnAfter', text: true }), k('\\text{− row}', '', 'Remove this row', 'act', { command: 'removeRow', text: true }), k('\\text{− col}', '', 'Remove this column', 'act', { command: 'removeColumn', text: true })
    ]
  },
  {
    id: 'greek',
    label: 'αβ',
    title: 'Greek letters and constants',
    keys: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'rho', 'sigma', 'tau', 'phi', 'omega', 'Delta', 'Sigma', 'Omega', 'Gamma', 'Phi', 'xi', 'eta']
      .map((g) => k(`\\${g}`, `\\${g}`, g))
      .concat([k('i', '\\imaginaryI', 'i, the imaginary unit'), k('\\pi', '\\pi', 'π'), k('e', '\\exponentialE', "e, Euler's number"), k('\\infty', '\\infty', 'Infinity'), k('\\hbar', '\\hbar', 'h-bar'), k('\\partial', '\\partial', 'Partial'), k('\\nabla', '\\nabla', 'Nabla')])
  }
]

/** The keys every page shares, down the right: moving, deleting, clearing */
const ACTIONS: Key[] = [
  { label: '←', command: 'moveToPreviousChar', title: 'Left', tone: 'act', text: true },
  { label: '→', command: 'moveToNextChar', title: 'Right', tone: 'act', text: true },
  { label: '⌫', command: 'deleteBackward', title: 'Delete', tone: 'act', text: true },
  { label: 'Clear', command: 'deleteAll', title: 'Clear this field', tone: 'act', text: true }
]

function Label({ k: key }: { k: Key }) {
  const html = useMemo(() => (key.text ? null : katex.renderToString(key.label, { throwOnError: false, strict: 'ignore', output: 'html' })), [key.label, key.text])
  if (html === null) return <span className="kp-text">{key.label.replace(/^\\text\{(.*)\}$/, '$1')}</span>
  return <span className="kp-tex" dangerouslySetInnerHTML={{ __html: html }} />
}

export function Keypad({ onKey, page: initial }: { onKey(key: Key): void; page?: string }) {
  const [page, setPage] = useState(() => {
    try {
      return initial ?? localStorage.getItem('tide.keypad.page') ?? 'basic'
    } catch {
      return 'basic'
    }
  })
  const current = KEYPAGES.find((p) => p.id === page) ?? KEYPAGES[0]
  const pick = (id: string) => {
    setPage(id)
    try {
      localStorage.setItem('tide.keypad.page', id)
    } catch {
      // only a convenience
    }
  }
  // A key press never moves the focus: the field keeps its caret
  const keep = (e: React.MouseEvent) => e.preventDefault()
  return (
    <div className="kp" role="group" aria-label="Maths keypad">
      <div className="kp-pages" role="tablist" aria-label="Keypad pages">
        {KEYPAGES.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === current.id} className={p.id === current.id ? 'on' : ''} title={p.title} onMouseDown={keep} onClick={() => pick(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="kp-body">
        <div className={`kp-grid kp-${current.id}`}>
          {current.keys.map((key, i) => (
            <button key={`${current.id}-${i}`} className={`kp-key ${key.tone ?? 'fn'}`} title={key.title} aria-label={key.title} onMouseDown={keep} onClick={() => onKey(key)}>
              <Label k={key} />
            </button>
          ))}
        </div>
        <div className="kp-actions">
          {ACTIONS.map((key) => (
            <button key={key.label} className="kp-key act" title={key.title} aria-label={key.title} onMouseDown={keep} onClick={() => onKey(key)}>
              <Label k={key} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
