/**
 * The maths answer box (shared/calc, shared/calcPython, shared/calcHistory, shared/mathsAnswer,
 * main/mathsAnswers): LaTeX read and worked out (exactly with SymPy, in floating point here), the
 * calculator's tape, the read-back, a page of working transcribed with its line boxes, corrections
 * before marking, step-by-step marking, the note that carries marks into the lesson, and what
 * happens without Claude. SymPy runs when a Python with it is found (TIDE_TEST_PYTHON, else
 * python3); those tests are skipped otherwise.
 */
import { execFileSync, spawn } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { describe, expect, it, vi } from 'vitest'
import { CalcError, evalNumeric, formatNumber, lineToSympy, parseLatex, previewOf, toSympy } from '../src/shared/calc'
import { CALC_WORKER } from '../src/shared/calcPython'
import { addEntry, asWorking, lastAnswer, parseHistory, resultOf, type CalcEntry } from '../src/shared/calcHistory'
import {
  boxStyle,
  correctLine,
  decimalAdds,
  dropLine,
  markLinesPrompt,
  marksFromSympy,
  parseLineMarks,
  parseReadBack,
  parseTranscription,
  parseWorkingMarks,
  readBackNote,
  shortDecimal,
  toBox,
  workingMessage
} from '../src/shared/mathsAnswer'
import { ownWords } from '../src/shared/session'

const num = (latex: string, angle: 'rad' | 'deg' = 'rad') => evalNumeric(parseLatex(latex), angle)

// ---------- Reading LaTeX ----------

describe('reading what MathLive writes', () => {
  it('works out arithmetic, fractions, powers and roots here', () => {
    expect(num('\\frac{1}{2}+\\frac{1}{3}')).toBeCloseTo(5 / 6)
    expect(num('2^{10}')).toBe(1024)
    expect(num('\\sqrt{2}\\cdot\\sqrt{8}')).toBeCloseTo(4)
    expect(num('\\sqrt[3]{-8}')).toBeCloseTo(-2)
    expect(num('\\left(-8\\right)^{\\frac{1}{3}}')).toBeCloseTo(-2)
    expect(num('3\\times4\\div2')).toBe(6)
    expect(num('2\\pi')).toBeCloseTo(2 * Math.PI)
    expect(num('-3^2')).toBe(-9)
    expect(num('5!+\\binom{5}{2}')).toBe(130)
    expect(num('\\left|-3\\right|+|2-7|')).toBe(8)
    expect(num('50\\%')).toBe(0.5)
  })

  it('reads trig in radians or degrees, and inverse trig both ways it is written', () => {
    expect(num('\\sin\\left(\\frac{\\pi}{6}\\right)')).toBeCloseTo(0.5)
    expect(num('\\sin\\left(30\\right)', 'deg')).toBeCloseTo(0.5)
    expect(num('\\sin^{-1}\\left(0.5\\right)', 'deg')).toBeCloseTo(30)
    expect(num('\\arctan 1')).toBeCloseTo(Math.PI / 4)
    // 30° is degrees whatever the setting, and never turned twice
    expect(num('\\cos 60^{\\circ}', 'rad')).toBeCloseTo(0.5)
    expect(num('\\cos 60^{\\circ}', 'deg')).toBeCloseTo(0.5)
    expect(num('\\sin^2 x+\\cos^2 x')).toBeNull()
    expect(num('\\sin\\pi')).toBe(0)
  })

  it('reads logs, e and exp', () => {
    expect(num('\\ln\\exponentialE')).toBeCloseTo(1)
    expect(num('\\log_{10}1000')).toBeCloseTo(3)
    expect(num('\\log_{2}\\left(8\\right)')).toBeCloseTo(3)
    expect(num('e^{2}')).toBeCloseTo(Math.E ** 2)
    expect(num('\\exp\\left(1\\right)')).toBeCloseTo(Math.E)
  })

  it('works out sums, products and definite integrals numerically', () => {
    expect(num('\\sum_{i=1}^{10}i^{2}')).toBe(385)
    expect(num('\\prod_{k=1}^{5}k')).toBe(120)
    expect(num('\\int_{0}^{1}x^{2}\\,\\mathrm{d}x')).toBeCloseTo(1 / 3, 8)
    expect(num('\\int_0^{\\pi}\\sin x\\,dx')).toBeCloseTo(2, 8)
    expect(num('\\int x^2\\,dx')).toBeNull()
  })

  it('reads calculus, matrices and relations into SymPy', () => {
    expect(toSympy(parseLatex('\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(x^3\\right)'))).toBe('Derivative((Symbol("x"))**(Integer(3)), (Symbol("x"), 1))')
    expect(toSympy(parseLatex('\\lim_{x\\to0}\\frac{\\sin x}{x}'))).toContain('Limit(')
    expect(toSympy(parseLatex('\\lim_{x\\to0^{+}}\\frac{1}{x}'))).toContain('"+"')
    expect(toSympy(parseLatex('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}'))).toBe('Matrix([[Integer(1), Integer(2)], [Integer(3), Integer(4)]])')
    expect(toSympy(parseLatex('\\det\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}'))).toMatch(/^_det\(Matrix/)
    expect(toSympy(parseLatex('\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}'))).toMatch(/^_det\(Matrix/)
    expect(toSympy(parseLatex('A^{T}'))).toMatch(/^_transpose/)
    expect(toSympy(parseLatex('\\int_{0}^{1}x\\,dx'))).toContain('Integral(Symbol("x"), (Symbol("x"), Integer(0), Integer(1)))')
    expect(toSympy(parseLatex('\\sum_{n=1}^{\\infty}\\frac{1}{n^2}'))).toContain('oo')
    expect(lineToSympy(parseLatex('x^2-4=0'))).toEqual({ parts: ['((Symbol("x"))**(Integer(2)) - Integer(4))', 'Integer(0)'], ops: ['='] })
    // A line of working that carries on from the one above
    expect(lineToSympy(parseLatex('=3x^2-4')).parts[0]).toBeNull()
    // The learner's own f, applied and differentiated
    expect(toSympy(parseLatex("f'(x)"))).toContain('Derivative(Function("f")(Symbol("x"))')
    expect(toSympy(parseLatex('f(x+h)'))).toBe('Function("f")((Symbol("x") + Symbol("h")))')
    // h is a variable in first principles, not a function
    expect(toSympy(parseLatex('h(x+1)'))).toBe('(Symbol("h") * (Symbol("x") + Integer(1)))')
    expect(toSympy(parseLatex('\\sin^{-1}x', ), 'deg')).toBe('_deg(asin(Symbol("x")))')
  })

  it('reads x^23 as TeX does, and Greek with subscripts as names', () => {
    expect(num('2^23')).toBe(12)
    expect(toSympy(parseLatex('\\theta_{1}+x_2'))).toBe('(Symbol("theta_1") + Symbol("x_2"))')
  })

  it('says what is wrong in words a learner can act on', () => {
    expect(() => parseLatex('\\frac{1}{\\placeholder{}}')).toThrow(/empty box/)
    expect(() => parseLatex('\\int x^2')).toThrow(/dx/)
    expect(() => parseLatex('(1+2')).toThrow(CalcError)
    expect(() => parseLatex('')).toThrow(/Nothing/)
  })

  it('previews the decimal while you type, and nothing when there is no value yet', () => {
    expect(previewOf('\\frac{1}{3}')).toBe('0.333333333333')
    expect(previewOf('2x')).toBeNull()
    expect(previewOf('\\frac{1}{')).toBeNull()
    expect(formatNumber(1.5e-9)).toBe('1.5\\times10^{-9}')
    expect(formatNumber(Infinity)).toBe('\\infty')
  })
})

// ---------- SymPy ----------

function findPython(): string | null {
  for (const p of [process.env.TIDE_TEST_PYTHON, 'python3'].filter(Boolean) as string[]) {
    try {
      execFileSync(p, ['-c', 'import sympy'], { stdio: 'ignore', timeout: 20_000 })
      return p
    } catch {
      // not this one
    }
  }
  return null
}
const python = findPython()

async function worker(reqs: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const dir = mkdtempSync(join(tmpdir(), 'tide-calc-test-'))
  const file = join(dir, 'calc.py')
  writeFileSync(file, CALC_WORKER)
  const child = spawn(python!, ['-I', '-u', file], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  const out: Record<string, unknown>[] = []
  const lines = createInterface({ input: child.stdout })
  const done = new Promise<void>((resolve) =>
    lines.on('line', (l) => {
      const j = JSON.parse(l)
      if (!('ready' in j)) out.push(j)
      if (out.length === reqs.length) resolve()
    })
  )
  for (const r of reqs) child.stdin.write(JSON.stringify(r) + '\n')
  await done
  child.kill()
  return out
}
const evalReq = (id: number, latex: string, angle: 'rad' | 'deg' = 'rad') => ({ id, op: 'eval', ...lineToSympy(parseLatex(latex), angle) })

describe.skipIf(!python)('the calculator, exactly (SymPy)', () => {
  it('gives exact answers with their decimals', async () => {
    const cases = ['\\frac{1}{2}+\\frac{1}{3}', '\\sqrt{8}', '\\int_{0}^{1}x^{2}\\,dx', '\\int x^2\\,\\mathrm{d}x', '\\lim_{x\\to0}\\frac{\\sin x}{x}', '\\frac{d}{dx}\\left(x^3\\right)', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}^{-1}', '\\det\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '\\sum_{n=1}^{\\infty}\\frac{1}{n^2}', '\\sin\\left(30\\right)', 'x^2-4=0', '2+2=5', '\\begin{pmatrix}1\\\\0\\\\0\\end{pmatrix}\\times\\begin{pmatrix}0\\\\1\\\\0\\end{pmatrix}', 'x^2-2=0', '\\frac{1}{3}+\\sqrt{2}']
    const r = await worker(cases.map((c, i) => evalReq(i, c, i === 9 ? 'deg' : 'rad')))
    const by = (i: number) => r.find((x) => x.id === i)!
    expect(by(0)).toMatchObject({ ok: true, kind: 'value', exact: '\\frac{5}{6}' })
    expect(shortDecimal(by(0).numeric as string)).toBe('0.833333333333')
    expect(by(1).exact).toBe('2 \\sqrt{2}')
    expect(by(2).exact).toBe('\\frac{1}{3}')
    expect(by(3).exact).toBe('\\frac{x^{3}}{3}')
    expect(by(3).numeric).toBeNull()
    expect(by(4).exact).toBe('1')
    expect(by(5).exact).toBe('3 x^{2}')
    expect(by(6).exact).toContain('\\frac{3}{2}')
    expect(by(7).exact).toBe('-2')
    expect(by(8).exact).toBe('\\frac{\\pi^{2}}{6}')
    expect(by(9).exact).toBe('\\frac{1}{2}')
    expect(by(10)).toMatchObject({ kind: 'solve', exact: 'x = -2,\\quad x = 2' })
    expect(by(11)).toMatchObject({ kind: 'truth', exact: '\\text{false}' })
    expect(by(12).exact).toContain('1')
    // x = ±2 needs no decimals; x = ±√2 does
    expect(by(10).numeric).toBeNull()
    expect(by(13).numeric).toBe('x \\approx -1.41421356237,\\quad x \\approx 1.41421356237')
    // Nothing simplifies: the decimal is the news
    expect(by(14)).toMatchObject({ unchanged: true })
    expect(by(0).unchanged).toBe(false)
  }, 60_000)

  it('checks each step of a working against the one before, and never calls a forward step wrong', async () => {
    const work = [
      "f'(x)=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}",
      '=\\lim_{h\\to0}\\frac{(x+h)^3-4(x+h)+1-x^3+4x-1}{h}',
      '=\\lim_{h\\to0}\\frac{3x^2h+3xh^2+h^3}{h}',
      '=\\lim_{h\\to0}(3x^2+3xh+h^2)',
      '=3x^2'
    ]
    const eqs = ['2x+3=7', '2x=4', 'x=2', 'x^2=4', 'x=2']
    const [a, b] = await worker([
      { id: 1, op: 'chain', lines: work.map((l) => lineToSympy(parseLatex(l))) },
      { id: 2, op: 'chain', lines: eqs.map((l) => lineToSympy(parseLatex(l))) }
    ])
    const st = (r: Record<string, unknown>) => (r.steps as { status: string }[]).map((s) => s.status)
    // The definition can't be checked (f is theirs); the dropped −4h is caught; the rest follows from it
    expect(st(a)).toEqual(['unknown', 'unknown', 'bad', 'ok', 'ok'])
    // An equation isn't held to its sides being equal; squaring gains a root (unknown); taking a square root loses one (bad)
    expect(st(b)).toEqual(['unknown', 'ok', 'ok', 'unknown', 'bad'])
  }, 60_000)
})

// ---------- The tape ----------

describe('the calculator tape', () => {
  const e = (input: string, exact: string | null, numeric: string | null, angle: 'rad' | 'deg' = 'rad'): CalcEntry => ({ id: input + angle, input, exact, numeric, angle, at: 1 })
  it('keeps calculations newest last, moves a repeat to the end, and is bounded', () => {
    let h: CalcEntry[] = []
    h = addEntry(h, e('1+1', '2', '2'))
    h = addEntry(h, e('\\frac{1}{3}', '\\frac{1}{3}', '0.333'))
    h = addEntry(h, e('1+1', '2', '2'))
    expect(h.map((x) => x.input)).toEqual(['\\frac{1}{3}', '1+1'])
    // The same input in degrees is a different calculation
    h = addEntry(h, e('\\sin 30', '\\frac{1}{2}', '0.5', 'deg'))
    h = addEntry(h, e('\\sin 30', null, '-0.988', 'rad'))
    expect(h).toHaveLength(4)
    for (let i = 0; i < 100; i++) h = addEntry(h, e(`${i}`, `${i}`, null))
    expect(h).toHaveLength(60)
  })
  it('carries the last answer on, exact first, and makes a line of working from a calculation', () => {
    const h = [e('\\frac{1}{3}', '\\frac{1}{3}', '0.333'), e('\\int_0^1 e^{-x^2}dx', null, '0.7468')]
    expect(lastAnswer(h)).toBe('0.7468')
    expect(resultOf(h[0])).toBe('\\frac{1}{3}')
    expect(asWorking(h[0])).toBe('\\frac{1}{3}=\\frac{1}{3}')
    expect(asWorking(e('x^2-4=0', 'x = -2,\\quad x = 2', null))).toBe('x = -2,\\quad x = 2')
    expect(lastAnswer([])).toBeNull()
  })
  it('reads a stored tape back, dropping anything malformed', () => {
    expect(parseHistory('not json')).toEqual([])
    expect(parseHistory(JSON.stringify([{ input: '1', exact: '1', numeric: null, angle: 'grad', id: 'a', at: 1 }, { nope: 1 }]))).toEqual([{ input: '1', exact: '1', numeric: null, angle: 'rad', id: 'a', at: 1 }])
  })
  it('shows a decimal beside an exact answer only when it adds something', () => {
    expect(shortDecimal('-2.00000000000000')).toBe('-2')
    expect(decimalAdds('-2', '-2')).toBe(false)
    expect(decimalAdds('\\frac{5}{6}', '0.833333333333')).toBe(true)
    expect(decimalAdds(null, '0.5')).toBe(true)
  })
})

// ---------- Read-back ----------

describe('the read-back', () => {
  it('takes the JSON, with LaTeX left unescaped, fenced, or wrapped in dollars', () => {
    expect(parseReadBack('{"latex": "\\frac{x^2+3x}{2}", "unclear": ""}')).toEqual({ latex: '\\frac{x^2+3x}{2}', unclear: '' })
    expect(parseReadBack('```json\n{"latex": "$f\'(2) = 8$", "unclear": "Could be f of 2 times 8"}\n```')).toEqual({ latex: "f'(2) = 8", unclear: 'Could be f of 2 times 8' })
    // \t and \f in "\theta" and "\frac" are not JSON escapes here
    expect(parseReadBack('{"latex":"\\theta = \\frac{\\pi}{4}","unclear":""}')!.latex).toBe('\\theta = \\frac{\\pi}{4}')
  })
  it('takes bare LaTeX from a model that skipped the JSON, and nothing from prose', () => {
    expect(parseReadBack('x^2 + 3x = 0')).toEqual({ latex: 'x^2 + 3x = 0', unclear: '' })
    expect(parseReadBack('I am not sure what you mean.')).toBeNull()
    expect(parseReadBack('{"latex": "", "unclear": ""}')).toEqual({ latex: '', unclear: '' })
  })
  it('goes to the tutor as a note the learner never sees', () => {
    const msg = `Answer: x squared minus four is zero so x is two\n(Confidence: sure)\n\n(Tide: ${readBackNote('x^2-4=0 \\Rightarrow x=2')})`
    expect(ownWords(msg)).toBe('Answer: x squared minus four is zero so x is two\n(Confidence: sure)')
    expect(msg).toContain('$$x^2-4=0 \\Rightarrow x=2$$')
  })
})

// ---------- Paper ----------

const REPLY = `Here is the transcription:
\`\`\`json
{"lines": [
  {"page": 1, "latex": "f'(x)=\\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}", "box": [40, 120, 760, 190], "unsure": false},
  {"page": 1, "latex": "=\\lim_{h\\to 0}\\frac{3x^2h+3xh^2+h^3}{h}", "box": [40, 210, 820, 280]},
  {"page": 2, "latex": "$f'(2)=8$", "box": {"x": 50, "y": 100, "w": 300, "h": 60}, "unsure": true},
  {"page": 9, "latex": "=3x^2", "box": [0.1, 0.5, 0.4, 0.55]},
  {"page": 1, "latex": "", "box": [1, 2, 3, 4]}
]}
\`\`\``

describe('reading a page of working', () => {
  it('turns Claude’s JSON into lines in page order, with boxes as fractions of the page', () => {
    const lines = parseTranscription(REPLY, 2)!
    expect(lines.map((l) => [l.page, l.latex])).toEqual([
      [0, "f'(x)=\\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}"],
      [0, '=\\lim_{h\\to 0}\\frac{3x^2h+3xh^2+h^3}{h}'],
      [1, "f'(2)=8"],
      // A page that isn't there is the last one
      [1, '=3x^2']
    ])
    expect(lines[0].box).toEqual([0.04, 0.12, 0.76, 0.19])
    expect(lines[2].box).toEqual([0.05, 0.1, 0.35, 0.16])
    expect(lines[2].unsure).toBe(true)
    // Fractions from a model that forgot to use thousandths
    expect(lines[3].box).toEqual([0.1, 0.5, 0.4, 0.55])
  })
  it('mends boxes given backwards, and drops ones too small or not boxes at all', () => {
    expect(toBox([800, 300, 100, 200])).toEqual([0.1, 0.2, 0.8, 0.3])
    expect(toBox([1200, -5, 400, 50])).toEqual([0.4, 0, 1, 0.05])
    expect(toBox([10, 10, 12, 11])).toBeNull()
    expect(toBox('nope')).toBeNull()
    expect(toBox([1, 2, 3])).toBeNull()
  })
  it('places each box over its photo, padded, never past the edge', () => {
    expect(boxStyle([0.1, 0.2, 0.5, 0.3])).toEqual({ left: '9.20%', top: '19.20%', width: '41.60%', height: '11.60%' })
    expect(boxStyle([0, 0, 1, 1])).toEqual({ left: '0.00%', top: '0.00%', width: '100.00%', height: '100.00%' })
  })
  it('returns nothing for a reply with no lines in it', () => {
    expect(parseTranscription('I could not read the photo.', 1)).toBeNull()
    expect(parseTranscription('{"lines": []}', 1)).toBeNull()
  })
  it('lets the learner fix a misread line, or take one out, before it is marked', () => {
    const lines = parseTranscription(REPLY, 2)!
    const fixed = correctLine(lines, 2, '$f\'(2)=3(4)-4=8$')
    expect(fixed[2]).toMatchObject({ latex: "f'(2)=3(4)-4=8", edited: true, unsure: false, box: lines[2].box })
    expect(fixed[0]).toBe(lines[0])
    // The same text again is no correction
    expect(correctLine(lines, 0, lines[0].latex)[0].edited).toBeUndefined()
    expect(dropLine(fixed, 3).map((l) => l.latex)).toEqual(fixed.slice(0, 3).map((l) => l.latex))
  })
})

// ---------- Marking each line ----------

describe('marking working line by line', () => {
  it('puts SymPy’s findings in front of the marker as facts', () => {
    const p = markLinesPrompt('<ask type="problem">Find f′(x)</ask><solution>3x^2-4</solution>', ['a', 'b', 'c'], [
      { status: 'unknown', why: '' },
      { status: 'ok', why: '' },
      { status: 'bad', why: "it isn't equal to the line before" }
    ])
    expect(p).toContain('1. a\n2. b\n3. c')
    expect(p).toContain('line 2: equal (checked)')
    expect(p).toContain("line 3: NOT equal: it isn't equal to the line before")
    expect(p).not.toContain('line 1:')
    expect(markLinesPrompt('q', ['a'])).not.toContain('SymPy')
  })
  it('reads Claude’s marks, by line number, with the verdict and any misconception', () => {
    const m = parseLineMarks('{"lines":[{"n":1,"ok":true,"note":"The definition."},{"n":3,"ok":false,"note":"The \\u2212 4h is missing."},{"n":9,"ok":true}],"verdict":"partial","summary":"Line 3 drops a term.","misconception":{"name":"Distributing a minus","description":"Only the first term was negated."}}', 3)!
    expect(m.lines).toEqual([
      { ok: true, note: 'The definition.' },
      { ok: null, note: '' },
      { ok: false, note: 'The − 4h is missing.' }
    ])
    expect(m).toMatchObject({ verdict: 'partial', summary: 'Line 3 drops a term.', misconception: { name: 'Distributing a minus', text: 'Only the first term was negated.' }, by: 'claude' })
    expect(parseLineMarks('{"lines":[],"verdict":"great"}', 2)).toBeNull()
    expect(parseLineMarks('{"lines":[{"n":1,"ok":true}],"verdict":"correct","misconception":{"name":"x"}}', 1)!.misconception).toBeUndefined()
  })
  it('without Claude, marks only what SymPy proved, and leaves the verdict to the tutor', () => {
    const m = marksFromSympy([{ status: 'unknown', why: '' }, { status: 'ok', why: '' }, { status: 'bad', why: "it isn't equal to the line before" }], 3)
    expect(m.lines.map((l) => l.ok)).toEqual([null, true, false])
    expect(m.lines[2].note).toBe("It isn't equal to the line before.")
    expect(m).toMatchObject({ verdict: null, by: 'sympy' })
    expect(m.summary).toContain('line 3')
    expect(marksFromSympy([], 2).summary).toMatch(/aren’t ones SymPy can check/)
  })
  it('carries the marks into the lesson in a note the learner never sees, and back out for the transcript', () => {
    const lines = parseTranscription(REPLY, 2)!
    const marks = parseLineMarks('{"lines":[{"n":1,"ok":true,"note":"ok"},{"n":2,"ok":false,"note":"−4h dropped"},{"n":3,"ok":true},{"n":4,"ok":true}],"verdict":"partial","summary":"Nearly."}', 4)!
    const { body, note } = workingMessage({ kind: 'paper', pages: ['Chat images/Working 1.jpg', 'Chat images/Working 2.jpg'], lines, marks })
    expect(body).toMatch(/^My working on paper:\n\n!\[Working 1\]\(\/Chat%20images\/Working%201\.jpg\)/)
    // The last line is the final answer, for Tide's exact check
    expect(body.trim().endsWith('4. $=3x^2$')).toBe(true)
    expect(note).toContain('line 2 ✗ −4h dropped')
    expect(note).toContain('Verdict: "partial"')
    const msg = `Answer: ${body}\n(Confidence: unsure)\n\n(Tide: ${note})`
    expect(ownWords(msg)).not.toContain('working-marks')
    const back = parseWorkingMarks(msg)!
    expect(back.kind).toBe('paper')
    expect(back.pages).toHaveLength(2)
    expect(back.lines[0].box).toEqual([0.04, 0.12, 0.76, 0.19])
    expect(back.marks.verdict).toBe('partial')
    expect(parseWorkingMarks('Answer: 42')).toBeNull()
  })
})

// ---------- Main: with and without Claude ----------

const route = { who: 'gemma' as 'gemma' | 'claude', reason: 'no-claude' as const, role: 'mark' as const }
const claudeCalls: { prompt: string; system: string; role: string; images: number }[] = []
let claudeReply = ''
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), on: () => {}, isPackaged: false } }))
vi.mock('../src/main/ai', () => ({
  jobRoute: async () => (route.who === 'claude' ? { who: 'claude', role: 'mark' } : { who: 'gemma', reason: route.reason }),
  complete: async () => {
    throw new Error('Gemma must not be asked')
  }
}))
vi.mock('../src/main/modelIdle', () => ({ loaded: async () => false }))
vi.mock('../src/main/calculator', () => ({ checkSteps: async (lines: string[]) => lines.map((_, i) => (i === 1 ? { status: 'bad', why: "it isn't equal to the line before" } : { status: 'unknown', why: '' })) }))
vi.mock('../src/main/usageLog', () => ({ withUsage: (_s: unknown, fn: () => unknown) => fn() }))
vi.mock('../src/main/claudeEngine', () => ({
  ClaudeUnavailable: class extends Error {},
  claudeOnce: async (prompt: string, system: string, role: string, _signal: unknown, _model: unknown, images: unknown[] = []) => {
    claudeCalls.push({ prompt, system, role, images: images.length })
    return { text: claudeReply, usage: {}, ms: 1, model: 'opus' }
  }
}))

describe('the answer box’s model work (main/mathsAnswers)', async () => {
  const m = await import('../src/main/mathsAnswers')
  it('without Claude: paper says it needs Claude, steps are marked by SymPy, and the read-back steps aside', async () => {
    route.who = 'gemma'
    claudeCalls.length = 0
    const paper = await m.readPaper(['Chat images/p.jpg'], 'q')
    expect(paper).toMatchObject({ ok: false, needsClaude: true })
    expect((paper as { error: string }).error).toMatch(/^Reading paper needs Claude/)
    const marked = await m.markWorking({ question: 'q', lines: ['x=1', 'x=2'] })
    expect(marked.marks.by).toBe('sympy')
    expect(marked.marks.lines.map((l) => l.ok)).toEqual([null, false])
    expect(await m.readBack('x squared', 'q')).toBeNull()
    expect(claudeCalls).toHaveLength(0)
  })
  it('with Claude: the read-back goes to the quick model and the marking to the marking model, with SymPy’s facts', async () => {
    route.who = 'claude'
    claudeCalls.length = 0
    claudeReply = '{"latex": "x^2", "unclear": ""}'
    expect(await m.readBack('x squared', 'q')).toEqual({ latex: 'x^2', unclear: '', by: 'claude' })
    expect(claudeCalls[0].role).toBe('background')
    claudeReply = '{"lines":[{"n":1,"ok":true,"note":""},{"n":2,"ok":false,"note":"Not equal."}],"verdict":"wrong","summary":"Line 2."}'
    const marked = await m.markWorking({ question: '<solution>1</solution>', lines: ['x=1', 'x=2'] })
    expect(marked.marks).toMatchObject({ by: 'claude', verdict: 'wrong' })
    expect(claudeCalls[1].role).toBe('mark')
    expect(claudeCalls[1].prompt).toContain('line 2: NOT equal')
  })
})
