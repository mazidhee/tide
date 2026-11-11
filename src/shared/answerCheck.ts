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

const decimals = (s: string) => /^-?\d*\.(\d+)$/.exec(s.trim())?.[1].length

/**
 * How far apart two answers may be and still agree, when one is written as a decimal and the other
 * exactly: half a unit in the decimal's last place, so 2/3 agrees with 0.667 and √7 with 2.65. A
 * solution that ends "= 0.9/1.35 = 0.667" was counting the exact answer 2/3 as wrong, and the
 * tutor was then told it couldn't be marked correct. Nothing is allowed between two decimals (0.52
 * is not 0.5), between two exact answers, or for a decimal given to one place.
 */
export function roundingSlack(a: string, b: string): number {
  const [da, db] = [decimals(a), decimals(b)]
  if ((da === undefined) === (db === undefined)) return 0
  const places = (da ?? db) as number
  return places >= 2 ? 0.5 * 10 ** -places : 0
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
        same = abs(N(A) - N(B)) <= max(1e-6 * max(1, abs(N(B))), ${roundingSlack(a, b) * (1 + 1e-9)})
    print('MATCH' if same else 'NOMATCH')
except Exception:
    print('UNKNOWN')
`
}

export type Exact = { result: 'match' | 'mismatch'; theirs: string; expected: string; kind?: 'clocks'; why?: string }

/** Said to the tutor (not shown) with what SymPy found, before it marks the answer */
export const exactNote = (e: Exact) =>
  e.kind === 'clocks'
    ? e.result === 'match'
      ? `(Tide: Tide replayed the vector clocks in this problem: their vectors (${e.theirs}) are right, under one of the two rules taught (a send and a receipt each count as an event, or only internal actions do). Mark it correct unless their reasoning is wrong, and never mark down which of those rules they used.)`
      : `(Tide: Tide replayed the vector clocks in this problem: ${e.why} This can't be marked correct: point at that entry.)`
    : e.result === 'match'
    ? `(Tide: SymPy checked their final answer, ${e.theirs}, against the solution: it is right, by whatever method they reached it. Mark it correct unless a step of their reasoning is actually wrong; a different method from yours is not an error.)`
    : `(Tide: SymPy checked their final answer, ${e.theirs}, against the solution's ${e.expected}: they are not equal, so this can't be marked correct. Point at where it goes wrong.)`

/** Feedback that objects to how an answer was reached and names nothing wrong in it */
export function objectsToMethodOnly(feedback: string): boolean {
  const method =
    /\b(did ?n[o’']t|have ?n[o’']t|has ?n[o’']t|without|instead of|rather than)\b[^.]{0,50}\b(us(e|ed|ing)|appl(y|ied|ying)|comput\w+|calculat\w+|find(ing)?|work(ed|ing)? out|go(ing)? through)\b|\b(standard|expected|usual|conventional|preferred|intended|proper|more efficient)\b[^.]{0,30}\b(way|method|approach|formula|technique|route)\b|\bshould (have )?(used?|appl(y|ied))\b|\bskipped\b/i
  const fault = /\b(errors?|mistakes?|incorrect|wrong|not (right|correct|equal|valid)|miscalculat\w*|forgot|missed|missing|omitted|should be|is actually|isn['’]t|doesn['’]t|does not|fails?|invalid)\b/i
  return method.test(feedback) && !fault.test(feedback)
}

/**
 * A mark that contradicts the exact check, overruled. The check is of the final answer only, so:
 * - their answer is not the solution's and it was marked correct: wrong (a wrong result can't pass);
 * - their answer is the solution's and it was marked wrong: partial at least, since the result is
 *   right whatever the working;
 * - their answer is the solution's and the mark was taken down only for the method (the feedback
 *   names no error, just the route they didn't take): correct. A right answer by an unusual
 *   method marked down is the mistake that costs a learner most.
 * Undefined when the mark can stand.
 */
export function overruled(exact: Exact | null | undefined, verdict: string | undefined, feedback: string): { verdict: 'correct' | 'partial' | 'wrong'; why: string } | undefined {
  if (!exact || !verdict) return undefined
  if (exact.kind === 'clocks') {
    if (exact.result === 'mismatch') return verdict === 'correct' ? { verdict: 'wrong', why: `Tide replayed the clocks: ${exact.why}` } : undefined
    return verdict === 'wrong' ? { verdict: 'partial', why: `Tide replayed the clocks, and your vectors (${exact.theirs}) are what the events give, so this is not wrong.` } : undefined
  }
  if (exact.result === 'mismatch') return verdict === 'correct' ? { verdict: 'wrong', why: 'SymPy checked your final answer against the solution, and it doesn’t come out the same. Look again at the last steps of your working.' } : undefined
  if (verdict !== 'correct' && objectsToMethodOnly(feedback)) return { verdict: 'correct', why: `SymPy checked your final answer, ${exact.theirs}, against the solution, and it is right. The mark above was taken down for the method, not for an error: a different route to the right result is correct.` }
  if (verdict === 'wrong') return { verdict: 'partial', why: `SymPy checked your final answer, ${exact.theirs}, against the solution, and it is right, so this is not wrong. Read the feedback above as being about the working, not the result.` }
  return undefined
}
