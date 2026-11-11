/**
 * The "regex" simulation's spec, the matching it shows and its named parts. Matching is the
 * engine's own (JavaScript RegExp), run off the main thread with a time limit in the app
 * (regexClient.ts), so a pattern that backtracks catastrophically is reported instead of freezing
 * the window. The diagram is drawn from regexp-tree's parse (regexRail.ts).
 *   parts: pattern, flags, diagram, test:N, match:N (in the chosen test), group:N
 */
import type { PartInfo } from './parts'
import { int, onlyVerbs, text, type Raw, type SimBase } from './specUtil'

export const REGEX_LIMITS = { pattern: 160, tests: 6, test: 240, matches: 200, timeMs: 400 }
export const FLAGS = ['g', 'i', 'm', 's'] as const

export interface RegexSpec extends SimBase {
  kind: 'regex'
  pattern: string
  flags: string
  tests: string[]
  /** The test whose matches are listed, from 0 */
  select: number
}

const VERBS = ['pattern', 'flags', 'test']

/** "/ab+c/gi" or "ab+c" with flags given apart */
export function splitLiteral(source: string, flags = ''): { pattern: string; flags: string } {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(source.trim())
  return m ? { pattern: m[1], flags: m[2] || flags } : { pattern: source, flags }
}

export const cleanFlags = (f: unknown) => FLAGS.filter((c) => typeof f === 'string' && f.includes(c)).join('')

export function parseRegexSpec(raw: Raw, base: SimBase): RegexSpec | null {
  const given = typeof raw.pattern === 'string' ? raw.pattern : typeof raw.regex === 'string' ? raw.regex : typeof raw.regexp === 'string' ? raw.regexp : ''
  const lit = splitLiteral(given, typeof raw.flags === 'string' ? raw.flags : 'g')
  if (!lit.pattern) return null
  const list = Array.isArray(raw.tests) ? raw.tests : Array.isArray(raw.strings) ? raw.strings : typeof raw.text === 'string' ? [raw.text] : typeof raw.test === 'string' ? [raw.test] : []
  const tests = list.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, REGEX_LIMITS.test)).slice(0, REGEX_LIMITS.tests)
  if (!tests.length) tests.push('')
  const spec: RegexSpec = { ...base, kind: 'regex', pattern: lit.pattern.slice(0, REGEX_LIMITS.pattern), flags: cleanFlags(lit.flags), tests, select: int(raw.select, 1, 1, tests.length) - 1 }
  for (const step of spec.tour) {
    if (step.do && typeof step.do.pattern === 'string') step.do.pattern = step.do.pattern.slice(0, REGEX_LIMITS.pattern)
    if (step.do && step.do.flags !== undefined) step.do.flags = cleanFlags(step.do.flags)
  }
  return onlyVerbs(spec, VERBS)
}

// ---------- Matching ----------

export interface Group {
  /** From 1 */
  n: number
  name: string | null
  text: string | null
  start: number
}

export interface Match {
  text: string
  start: number
  end: number
  groups: Group[]
}

export type TestResult = { matches: Match[]; capped: boolean }

export type MatchOutcome = { ok: true; results: TestResult[] } | { ok: false; error: string; slow?: boolean }

/** Whether the pattern compiles, and the engine's own message when it doesn't */
export function compile(pattern: string, flags: string): { ok: true; re: RegExp } | { ok: false; error: string } {
  try {
    // d gives each group's position
    return { ok: true, re: new RegExp(pattern, `${cleanFlags(flags).replace('g', '')}gd`) }
  } catch (e) {
    return { ok: false, error: (e as Error).message.replace(/^Invalid regular expression: /, '') }
  }
}

/**
 * Every match in each test (or only the first, without the g flag), with its groups. An empty
 * match moves on one character, as String.prototype.matchAll does.
 */
export function runMatches(pattern: string, flags: string, tests: string[]): MatchOutcome {
  const c = compile(pattern, flags)
  if (!c.ok) return c
  const names = new Map<number, string>()
  // Group names in order of their opening bracket
  let n = 0
  for (const m of pattern.matchAll(/\\.|\[(?:\\.|[^\]])*\]|\((\?(<([A-Za-z_$][\w$]*)>)?)?/g)) {
    if (!m[0].startsWith('(')) continue
    // (?: (?= (?! (?<= (?<! don't capture; (?<name> does
    if (m[1] && !m[3]) continue
    n++
    if (m[3]) names.set(n, m[3])
  }
  const all = flags.includes('g')
  const results = tests.map((test): TestResult => {
    const matches: Match[] = []
    let capped = false
    for (const m of test.matchAll(c.re)) {
      const idx = (m as RegExpMatchArray & { indices?: [number, number][] }).indices
      matches.push({
        text: m[0],
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
        groups: m.slice(1).map((g, i) => ({ n: i + 1, name: names.get(i + 1) ?? null, text: g ?? null, start: idx?.[i + 1]?.[0] ?? -1 }))
      })
      if (!all) break
      if (matches.length >= REGEX_LIMITS.matches) {
        capped = true
        break
      }
    }
    return { matches, capped }
  })
  return { ok: true, results }
}

// ---------- Parts ----------

export type RegexPart = { type: 'pattern' | 'flags' | 'diagram' } | { type: 'test' | 'match' | 'group'; i: number }

export function parseRegexPart(name: string, tests: number, matches: number, groups: number): RegexPart | null {
  const [head, arg] = name.trim().toLowerCase().split(':')
  if ((head === 'pattern' || head === 'flags' || head === 'diagram') && arg === undefined) return { type: head }
  const i = Number(arg)
  if (!Number.isInteger(i) || i < 1) return null
  if (head === 'test' && i <= tests) return { type: 'test', i }
  if (head === 'match' && i <= Math.max(matches, 1)) return { type: 'match', i }
  if (head === 'group' && i <= groups) return { type: 'group', i }
  return null
}

const show = (s: string | null) => (s === null ? 'did not take part' : `"${s}"`)

export function describeRegexPart(part: RegexPart, s: { pattern: string; flags: string; tests: string[]; select: number; outcome: MatchOutcome | null; groups: number }): PartInfo {
  const res = s.outcome?.ok ? s.outcome.results[s.select] : null
  switch (part.type) {
    case 'pattern':
      return { label: `the pattern /${s.pattern}/${s.flags}`, values: { groups: s.groups, status: s.outcome === null ? 'matching' : s.outcome.ok ? 'compiles' : s.outcome.error } }
    case 'flags':
      return { label: 'the flags', values: { flags: s.flags || 'none', g: s.flags.includes('g') ? 'every match' : 'first match only', i: s.flags.includes('i') ? 'ignore case' : 'case matters' } }
    case 'diagram':
      return { label: 'the railroad diagram: any path from left to right is a string the pattern matches', values: { pattern: `/${s.pattern}/` } }
    case 'test': {
      const r = s.outcome?.ok ? s.outcome.results[part.i - 1] : null
      return { label: `test string ${part.i}: "${text(s.tests[part.i - 1], 80)}"`, values: { matches: r ? r.matches.length : '–', length: s.tests[part.i - 1].length } }
    }
    case 'match': {
      const m = res?.matches[part.i - 1]
      if (!m) return { label: `match ${part.i} in test ${s.select + 1}`, values: { found: 'no match' } }
      return { label: `match ${part.i} in test ${s.select + 1}: "${m.text}"`, values: { start: m.start, end: m.end, ...Object.fromEntries(m.groups.slice(0, 2).map((g) => [`group ${g.n}`, show(g.text)])) } }
    }
    case 'group': {
      const g = res?.matches[0]?.groups[part.i - 1]
      return { label: `capture group ${part.i}${g?.name ? ` (${g.name})` : ''}`, values: { 'in the first match': g ? show(g.text) : 'no match' } }
    }
  }
}
