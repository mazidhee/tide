/**
 * Poke-holes challenges: maths the learner attacks rather than accepts. Three kinds, written by
 * the tutor as a ```challenge block of JSON (renderer/lib/maths/challenge draws it):
 * - counterexample: a claim "lhs rel rhs for every x"; they give values that break it, and Tide
 *   checks them itself by evaluating both sides (no model asked)
 * - wrong-step: a short derivation with one wrong step; they click the one they think it is
 * - asn: always, sometimes or never true; they pick and justify
 * The pick is checked here, at once; the justification goes to the tutor as their answer and is
 * marked like any other (Opus on Claude, the lesson's own marking on Gemma).
 *
 * Claude can prove a challenge before setting it (set_challenge, main/mathsTools): its witness is
 * checked exactly with SymPy, and a check program it writes for the other kinds is run. Pure here,
 * with the evaluator and the sandbox passed in, so it can be tested without either.
 */
import { toSympy } from './answerCheck'

export type Rel = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'prime' | 'integer'
export type VarKind = 'real' | 'integer' | 'natural' | 'positive'
export const RELS: Rel[] = ['=', '!=', '<', '<=', '>', '>=', 'prime', 'integer']

export interface Counterexample {
  type: 'counterexample'
  claim: string
  vars: Record<string, VarKind>
  lhs: string
  rel: Rel
  rhs: string
  hint?: string
}

export interface WrongStep {
  type: 'wrong-step'
  title: string
  steps: string[]
  /** The wrong step, from 1 */
  wrong: number
  why?: string
}

export interface Asn {
  type: 'asn'
  statement: string
  answer: 'always' | 'sometimes' | 'never'
  why?: string
}

export type Challenge = Counterexample | WrongStep | Asn

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const REL_ALIASES: Record<string, Rel> = { '==': '=', '≠': '!=', '<>': '!=', '≤': '<=', '≥': '>=', '=<': '<=', '=>': '>=', 'is prime': 'prime', 'is an integer': 'integer', whole: 'integer' }
const KINDS: VarKind[] = ['real', 'integer', 'natural', 'positive']

/** A block's JSON as a challenge, or null when it isn't one (yet) */
export function parseChallenge(source: string): Challenge | null {
  let raw: Record<string, unknown>
  try {
    const v = JSON.parse(source)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    raw = v as Record<string, unknown>
  } catch {
    return null
  }
  const type = str(raw.type ?? raw.kind).toLowerCase().replace(/[\s_]+/g, '-')
  if (type === 'counterexample' || type === 'counter-example') {
    const relRaw = str(raw.rel ?? raw.relation, 20).toLowerCase()
    const rel = (RELS as string[]).includes(relRaw) ? (relRaw as Rel) : REL_ALIASES[relRaw]
    const lhs = str(raw.lhs, 120)
    const rhs = str(raw.rhs, 120)
    if (!rel || !lhs || (rel !== 'prime' && rel !== 'integer' && !rhs)) return null
    const given = raw.vars && typeof raw.vars === 'object' ? (raw.vars as Record<string, unknown>) : Array.isArray(raw.vars) ? Object.fromEntries((raw.vars as unknown[]).map((v) => [String(v), 'real'])) : { x: 'real' }
    const vars: Record<string, VarKind> = {}
    for (const [name, kind] of Object.entries(given).slice(0, 3)) {
      if (!/^[a-z]$/i.test(name) || name === 'e') continue
      const k = str(kind, 20).toLowerCase()
      vars[name] = (KINDS as string[]).includes(k) ? (k as VarKind) : k === 'int' || k === 'whole' ? 'integer' : k === 'n' || k === 'nat' ? 'natural' : 'real'
    }
    if (!Object.keys(vars).length) return null
    return { type: 'counterexample', claim: str(raw.claim ?? raw.statement) || `${lhs} ${rel} ${rhs}`, vars, lhs, rel, rhs, ...(str(raw.hint) ? { hint: str(raw.hint) } : {}) }
  }
  if (type === 'wrong-step' || type === 'spot-the-error' || type === 'error') {
    const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((s) => str(s, 300)).filter(Boolean).slice(0, 10)
    const wrong = Math.round(Number(raw.wrong ?? raw.answer))
    if (steps.length < 2 || !(wrong >= 1 && wrong <= steps.length)) return null
    return { type: 'wrong-step', title: str(raw.title ?? raw.claim, 160) || 'Find the wrong step', steps, wrong, ...(str(raw.why) ? { why: str(raw.why) } : {}) }
  }
  if (type === 'asn' || type === 'always-sometimes-never') {
    const answer = str(raw.answer, 20).toLowerCase()
    const statement = str(raw.statement ?? raw.claim)
    if (!statement || !['always', 'sometimes', 'never'].includes(answer)) return null
    return { type: 'asn', statement, answer: answer as Asn['answer'], ...(str(raw.why) ? { why: str(raw.why) } : {}) }
  }
  return null
}

// ---------- Checking a counterexample ----------

/** Evaluates an expression in the given variables; NaN when it can't */
export type Evaluate = (expr: string, vars: Record<string, number>) => number

export type CounterResult =
  | { ok: true; lhs: number; rhs: number; line: string }
  | { ok: false; reason: 'unreadable' | 'domain' | 'holds' | 'undefined'; line: string }

const isPrime = (n: number) => {
  if (!Number.isInteger(n) || n < 2) return false
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false
  return true
}

/** Whether lhs rel rhs holds, with a tolerance for rounding on equality */
export function relHolds(rel: Rel, a: number, b: number): boolean {
  const eps = 1e-9 * Math.max(1, Math.abs(a), Number.isFinite(b) ? Math.abs(b) : 0)
  switch (rel) {
    case '=':
      return Math.abs(a - b) <= eps
    case '!=':
      return Math.abs(a - b) > eps
    case '<':
      return a < b - eps
    case '<=':
      return a <= b + eps
    case '>':
      return a > b + eps
    case '>=':
      return a >= b - eps
    case 'prime':
      return isPrime(Math.round(a)) && Math.abs(a - Math.round(a)) <= eps
    case 'integer':
      return Math.abs(a - Math.round(a)) <= eps
  }
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : String(Math.round(v * 1e6) / 1e6)).replace('-', '−')
const REL_WORD: Record<Rel, string> = { '=': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥', prime: 'is prime', integer: 'is a whole number' }

/** Their values read as numbers ("1/2", "-3", "sqrt(2)"), or which one couldn't be read */
export function readValues(given: Record<string, string>, evaluate: Evaluate): { values: Record<string, number> } | { bad: string } {
  const values: Record<string, number> = {}
  for (const [name, text] of Object.entries(given)) {
    const v = evaluate(text.trim().replace(/[−–]/g, '-'), {})
    if (!text.trim() || !Number.isFinite(v)) return { bad: name }
    values[name] = v
  }
  return { values }
}

/** Checks their counterexample: does the claim fail at these values (inside its domain)? */
export function checkCounterexample(c: Counterexample, given: Record<string, string>, evaluate: Evaluate): CounterResult {
  const read = readValues(given, evaluate)
  if ('bad' in read) return { ok: false, reason: 'unreadable', line: `Tide can’t read the value of ${read.bad}: give a number, a fraction like 1/2, or something like sqrt(2).` }
  const { values } = read
  for (const [name, kind] of Object.entries(c.vars)) {
    const v = values[name]
    if (v === undefined) return { ok: false, reason: 'unreadable', line: `Give a value for ${name}.` }
    const whole = Math.abs(v - Math.round(v)) < 1e-12
    if ((kind === 'integer' && !whole) || (kind === 'natural' && !(whole && v >= 1)) || (kind === 'positive' && !(v > 0))) return { ok: false, reason: 'domain', line: `The claim is about ${kind === 'natural' ? 'whole numbers from 1' : kind === 'positive' ? 'positive numbers' : 'whole numbers'}: ${name} = ${fmt(v)} isn’t one.` }
  }
  const lhs = evaluate(c.lhs, values)
  const rhs = c.rel === 'prime' || c.rel === 'integer' ? NaN : evaluate(c.rhs, values)
  const at = Object.entries(values).map(([n, v]) => `${n} = ${fmt(v)}`).join(', ')
  if (!Number.isFinite(lhs) || (c.rel !== 'prime' && c.rel !== 'integer' && !Number.isFinite(rhs))) return { ok: false, reason: 'undefined', line: `At ${at} one side isn’t defined, so this doesn’t test the claim. Try values where both sides exist.` }
  const holds = relHolds(c.rel, lhs, rhs)
  const sides = c.rel === 'prime' || c.rel === 'integer' ? `${c.lhs} = ${fmt(lhs)}` : `${c.lhs} = ${fmt(lhs)} and ${c.rhs} = ${fmt(rhs)}`
  if (holds) return { ok: false, reason: 'holds', line: `At ${at}: ${sides}, so the claim holds there. Look for somewhere it can’t.` }
  return { ok: true, lhs, rhs, line: `At ${at}: ${sides}, so “${c.lhs} ${REL_WORD[c.rel]}${c.rel === 'prime' || c.rel === 'integer' ? '' : ` ${c.rhs}`}” is false. A counterexample.` }
}

// ---------- What goes to the tutor ----------

/** The start of their answer, for them to finish with their reasoning */
export function answerStart(c: Challenge, pick: { values?: Record<string, string>; step?: number; choice?: Asn['answer'] }, verdict: string): string {
  if (c.type === 'counterexample') return `Counterexample: ${Object.entries(pick.values ?? {}).map(([n, v]) => `${n} = ${v}`).join(', ')} (${verdict}). Why it breaks the claim: `
  if (c.type === 'wrong-step') return `The wrong step is step ${pick.step}: “${c.steps[(pick.step ?? 1) - 1]}” (${verdict}). Why it’s wrong, and the fix: `
  return `It is ${pick.choice} true (${verdict}). My reasons: `
}

// ---------- Proving one before it is set (Claude's set_challenge) ----------

export interface ChallengeIO {
  run(lang: string, code: string, stdin: string): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut?: boolean }>
}

export type Proof = { ok: true; detail: string; checked: boolean } | { ok: false; why: string; fatal?: boolean }

const pyStr = (s: string) => JSON.stringify(s)

/** SymPy decides, exactly, whether "lhs rel rhs" holds at the given values */
export function holdsProgram(c: Counterexample, at: Record<string, string>): string {
  const names = Object.keys(c.vars)
  const sides = c.rel === 'prime' ? `ok = bool(isprime(L)) if L.is_integer else False` : c.rel === 'integer' ? `ok = bool(L.is_integer)` : `ok = bool(simplify(${{ '=': 'Eq(L, R)', '!=': 'Ne(L, R)', '<': 'Lt(L, R)', '<=': 'Le(L, R)', '>': 'Gt(L, R)', '>=': 'Ge(L, R)' }[c.rel as Exclude<Rel, 'prime' | 'integer'>]}))`
  return [
    'from sympy import *',
    `syms = {${names.map((n) => `${pyStr(n)}: Symbol(${pyStr(n)})`).join(', ')}}`,
    `vals = {syms[k]: nsimplify(sympify(v, locals=syms), rational=True) for k, v in ${JSON.stringify(Object.fromEntries(names.map((n) => [n, toSympy(at[n] ?? '')])))}.items()}`,
    `L = sympify(${pyStr(toSympy(c.lhs))}, locals=syms).subs(vals)`,
    c.rel === 'prime' || c.rel === 'integer' ? 'R = 0' : `R = sympify(${pyStr(toSympy(c.rhs))}, locals=syms).subs(vals)`,
    'L, R = simplify(L), simplify(R)',
    "if L.has(zoo, nan, oo, -oo) or R.has(zoo, nan, oo, -oo) or not L.is_real:\n    print('UNDEFINED')\nelse:",
    `    ${sides}`,
    "    print('HOLDS' if ok else 'FAILS')"
  ].join('\n')
}

/**
 * Proves a challenge: a counterexample's witness must break the claim (and its example, when
 * given, satisfy it, so the claim isn't simply false everywhere); a wrong-step or asn check, when
 * given, must print the same answer. Without a check those two are set unproven, for the marker.
 */
export async function proveChallenge(c: Challenge, extra: { witness?: Record<string, string>; example?: Record<string, string>; check?: string }, io: ChallengeIO): Promise<Proof> {
  const run = async (code: string) => {
    const r = await io.run('python', code, '')
    if (/No module named '?sympy/i.test(r.stderr)) throw Object.assign(new Error("SymPy isn't installed in Tide's Python here (Settings › Tools › Maths checker)"), { fatal: true })
    if (r.exitCode !== 0 || r.timedOut) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-4).join('\n').slice(0, 400) || 'the check failed')
    return r.stdout.trim().split('\n').filter(Boolean).pop()?.trim() ?? ''
  }
  try {
    if (c.type === 'counterexample') {
      if (!extra.witness || !Object.keys(c.vars).every((n) => extra.witness?.[n])) return { ok: false, why: `Give witness: values for ${Object.keys(c.vars).join(', ')} that break the claim, so Tide can prove it is false.` }
      const w = await run(holdsProgram(c, extra.witness))
      if (w === 'UNDEFINED') return { ok: false, why: 'At the witness one side is undefined: give values where both sides exist.' }
      if (w !== 'FAILS') return { ok: false, why: `SymPy finds the claim HOLDS at the witness (${Object.entries(extra.witness).map(([k, v]) => `${k} = ${v}`).join(', ')}): it is not a counterexample. Fix the claim or the witness.` }
      if (extra.example) {
        const e = await run(holdsProgram(c, extra.example))
        if (e !== 'HOLDS') return { ok: false, why: 'SymPy finds the claim fails at the example too: an example should be a case where it holds, so the claim is tempting.' }
      }
      return { ok: true, checked: true, detail: `SymPy confirms the claim fails at the witness${extra.example ? ' and holds at the example' : ''}` }
    }
    if (!extra.check) return { ok: true, checked: false, detail: 'set without a machine check: the marker reads their reasoning' }
    const out = (await run(extra.check)).toLowerCase()
    const expected = c.type === 'wrong-step' ? String(c.wrong) : c.answer
    if (out !== expected) return { ok: false, why: `The check printed ${out || 'nothing'}, but the challenge says ${expected}. Fix one of them (the check must print only the ${c.type === 'wrong-step' ? 'wrong step\'s number' : 'answer: always, sometimes or never'} as its last line).` }
    return { ok: true, checked: true, detail: `the SymPy check agrees: ${expected}` }
  } catch (e) {
    const err = e as Error & { fatal?: boolean }
    return { ok: false, why: `Tide couldn't run the check: ${err.message}`, ...(err.fatal ? { fatal: true } : {}) }
  }
}

/** The block to paste into a reply */
export const challengeBlock = (c: Challenge) => `\`\`\`challenge\n${JSON.stringify(c)}\n\`\`\``
