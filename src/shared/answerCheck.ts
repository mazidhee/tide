/**
 * The final answer of a worked problem, compared exactly: the student's against the solution's,
 * by SymPy, so "1/2", "0.5" and "2/4" agree and "e - 1" doesn't pass for "1". Only when both end
 * in something SymPy can read (a number, a fraction, an expression); anything else is left to the
 * tutor. The Python runs in Tide's sandbox (main/runner.ts).
 */

/** LaTeX and typed maths to something SymPy's parser reads */
export function toSympy(s: string): string {
  return s
    .replace(/\$+/g, '')
    .replace(/\\left|\\right|\\,|\\;|\\!|\\ /g, '')
    .replace(/\\[dt]?frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/√\(([^()]+)\)/g, 'sqrt($1)')
    .replace(/√(\w+)/g, 'sqrt($1)')
    .replace(/\\pi|π/g, 'pi')
    .replace(/\\infty|∞/g, 'oo')
    .replace(/\\cdot|\\times|×|·/g, '*')
    .replace(/[−–]/g, '-')
    .replace(/\\ln/g, 'log')
    .replace(/\\(sin|cos|tan|log|exp)/g, '$1')
    .replace(/e\^\{([^{}]+)\}/g, 'exp($1)')
    .replace(/\^\{([^{}]+)\}/g, '**($1)')
    .replace(/\^/g, '**')
    .replace(/[{}]/g, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const READABLE = /^[\w\s.+\-*/()]+$/

/**
 * The last thing a working ends on: after its last "=", or a lone number or fraction at the end,
 * without trailing words, "+ C" or units. Null when it doesn't end on maths.
 */
export function finalAnswer(text: string): string | null {
  const t = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\+\s*C\b/g, '')
    .trim()
  // The last line that has maths in it
  const lines = t.split(/\n|(?<=\.)\s+(?=[A-Z])/).map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
      .replace(/\*\*/g, '')
      .replace(/[.;!]+$/, '')
    const afterEq = line.split(/=|≈/).pop() ?? line
    const cand = toSympy(
      afterEq
        .replace(/^.*\b(so|thus|hence|answer|the answer is|it is|prints?|gives?)\s*:?\s*/i, '')
        .replace(/\s*\(?(approximately|approx\.?|about)\b.*$/i, '')
        .replace(/\s+[a-z]{3,}.*$/i, (m) => (/^\s+(pi|sqrt|log|exp|sin|cos|tan)\b/i.test(m) ? m : ''))
    )
    if (cand && READABLE.test(cand) && /\d|pi|oo/.test(cand) && cand.length <= 60) return cand
  }
  return null
}

/** Python that prints MATCH, NOMATCH or UNKNOWN for two answers */
export function comparePython(a: string, b: string): string {
  return `from sympy import *
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application, convert_xor
T = standard_transformations + (implicit_multiplication_application, convert_xor)
try:
    A = parse_expr(${JSON.stringify(a)}, transformations=T)
    B = parse_expr(${JSON.stringify(b)}, transformations=T)
    same = simplify(A - B) == 0
    if not same and A.is_number and B.is_number:
        same = abs(N(A) - N(B)) <= 1e-6 * max(1, abs(N(B)))
    print('MATCH' if same else 'NOMATCH')
except Exception:
    print('UNKNOWN')
`
}

export type Exact = { result: 'match' | 'mismatch'; theirs: string; expected: string }

/** Said to the tutor (not shown) with what SymPy found, before it marks the answer */
export const exactNote = (e: Exact) =>
  e.result === 'match'
    ? `(Tide: SymPy checked their final answer, ${e.theirs}, against the solution: it is right. Mark the reasoning; the result is correct.)`
    : `(Tide: SymPy checked their final answer, ${e.theirs}, against the solution's ${e.expected}: they are not equal, so this can't be marked correct. Point at where it goes wrong.)`
