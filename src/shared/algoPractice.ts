/**
 * Daily algorithm practice: one short Python problem a day, at the learner's level, until core
 * Python is done. Pure: main/algoPractice reads the python-core module and the record, makes the
 * day's folder for the IDE and runs the checks.
 *
 * - What the learner knows comes from the python-core module's first part (core language): each
 *   ticked topic opens the parts of Python it teaches (`NEED_TOPICS`). Names and expressions are
 *   always open, so the first problems need nothing else.
 * - The step (1 to 3) follows the results: two clean solves in a row (no hint, passing within two
 *   checks) move it up, a day left unsolved moves it down, a solve with help holds it.
 * - The day's problem is picked once and kept all day: never one solved before, the step nearest
 *   the level (lower before higher), and something the latest ticked topic taught when there is
 *   one. A problem left unsolved comes back after three days, before anything new.
 * - When every core-language topic is ticked, core Python is done and no new problem is picked.
 */
import { ALGO_BANK, type AlgoNeed, type AlgoProblem, type AlgoStep } from './algoBank'
import { addDays } from './mentalMaths'
import type { RoadmapTopic } from './curriculum'

export interface AlgoDay {
  /** YYYY-MM-DD, where the learner is */
  day: string
  id: string
  /** The level when it was picked */
  step: AlgoStep
  /** Times checked (Check, or the IDE's tests on the unchanged test file) */
  checks: number
  hint: boolean
  /** When every test first passed */
  solvedAt?: number
  /** Checks it took to pass (1: the first) */
  checksToPass?: number
  /** Failing tests at the last check */
  failing?: string[]
}

export interface AlgoState {
  days: AlgoDay[]
}

/** The module and part that are "core Python" */
export const CORE_MODULE = 'python-core'

/** Which parts of Python each core-language topic opens, by its title */
export const NEED_TOPICS: [AlgoNeed, RegExp][] = [
  ['control', /control flow/i],
  ['lists', /\blists?\b/i],
  ['strings', /\bstrings?\b/i],
  ['tuples', /\btuples?\b/i],
  // Not "attributes as a dict" in the classes topic
  ['dicts', /^dicts?\b|\bdicts and sets\b|\bdict\/set\b/i],
  ['functions', /\bfunctions?\b|\bscope\b|closures?/i],
  ['recursion', /recursion/i],
  ['exceptions', /exceptions?/i],
  ['classes', /\bclasses\b/i],
  ['comprehensions', /comprehensions?/i]
]

export const NEED_LABEL: Record<AlgoNeed, string> = {
  basics: 'expressions',
  lists: 'lists',
  control: 'loops and if',
  strings: 'strings',
  tuples: 'tuples',
  dicts: 'dicts and sets',
  functions: 'functions',
  recursion: 'recursion',
  exceptions: 'exceptions',
  classes: 'classes',
  comprehensions: 'comprehensions'
}

export const needsOf = (title: string): AlgoNeed[] => NEED_TOPICS.filter(([, re]) => re.test(title)).map(([n]) => n)

export interface CoreProgress {
  /** The python-core module was found */
  found: boolean
  done: number
  total: number
  /** Parts of Python the ticked topics open (always expressions) */
  covered: AlgoNeed[]
  /** What the furthest ticked topic opened, to practise first */
  latest?: AlgoNeed
  /** The first unticked topic */
  next?: string
  finished: boolean
}

/**
 * Core Python from the core-language part's topics (practice lines and projects left out). Without
 * the module everything is open and core Python never counts as finished.
 */
export function coreProgress(topics: RoadmapTopic[] | null): CoreProgress {
  if (!topics) return { found: false, done: 0, total: 0, covered: ALGO_NEEDS, finished: false }
  const taught = topics.filter((t) => !t.project)
  const covered = new Set<AlgoNeed>(['basics'])
  let latest: AlgoNeed | undefined
  for (const t of taught)
    if (t.checked)
      for (const n of needsOf(t.title)) {
        covered.add(n)
        latest = n
      }
  const done = taught.filter((t) => t.checked).length
  return { found: true, done, total: taught.length, covered: ALGO_NEEDS.filter((n) => covered.has(n)), latest, next: taught.find((t) => !t.checked)?.title, finished: taught.length > 0 && done === taught.length }
}

export const ALGO_NEEDS: AlgoNeed[] = ['basics', 'lists', 'control', 'strings', 'tuples', 'dicts', 'functions', 'recursion', 'exceptions', 'classes', 'comprehensions']

const byDay = (a: AlgoDay, b: AlgoDay) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)

/** A solve that shows the step is easy now: no hint, passing within two checks */
export const cleanSolve = (d: AlgoDay) => !!d.solvedAt && !d.hint && (d.checksToPass ?? Infinity) <= 2

/** The level today, from the days before (and today's, once solved) */
export function levelOf(days: AlgoDay[], today: string): AlgoStep {
  let step = 1
  let clean = 0
  for (const d of [...days].sort(byDay)) {
    if (d.day > today || (d.day === today && !d.solvedAt)) continue
    if (cleanSolve(d)) {
      clean++
      if (clean >= 2) {
        step = Math.min(3, step + 1)
        clean = 0
      }
    } else if (!d.solvedAt) {
      step = Math.max(1, step - 1)
      clean = 0
    } else clean = 0
  }
  return step as AlgoStep
}

/** A small, stable number from a string, to break ties the same way all day */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 2 ** 32
}

export const opensFor = (p: AlgoProblem, covered: AlgoNeed[]) => p.needs.every((n) => covered.includes(n))

/**
 * The day's problem: today's if already picked; else an unsolved one back after three days, else
 * the best new one, else (everything open solved) the one solved longest ago. Null once core Python
 * is done and nothing was picked today.
 */
export function pickToday(state: AlgoState, core: CoreProgress, today: string, bank: AlgoProblem[] = ALGO_BANK): { id: string; step: AlgoStep } | null {
  const mine = state.days.find((d) => d.day === today)
  if (mine) return { id: mine.id, step: mine.step }
  if (core.finished) return null
  const level = levelOf(state.days, today)
  const open = bank.filter((p) => opensFor(p, core.covered))
  if (!open.length) return null
  const solved = new Set(state.days.filter((d) => d.solvedAt).map((d) => d.id))
  const tried = [...state.days].sort(byDay).filter((d) => !d.solvedAt && !solved.has(d.id))
  const back = tried.find((d) => d.day <= addDays(today, -3) && d.step <= level && open.some((p) => p.id === d.id) && !state.days.some((x) => x.id === d.id && x.day > d.day))
  if (back) return { id: back.id, step: level }
  const seen = new Set(state.days.map((d) => d.id))
  const score = (p: AlgoProblem) => Math.abs(p.step - level) * 10 + (p.step > level ? 5 : 0) - (core.latest && p.needs.includes(core.latest) ? 3 : 0) + hash(today + p.id)
  const fresh = open.filter((p) => !seen.has(p.id)).sort((a, b) => score(a) - score(b))
  if (fresh.length) return { id: fresh[0].id, step: level }
  // Everything open has been tried: one not yet solved, else the solve longest ago
  const unsolved = open.filter((p) => !solved.has(p.id)).sort((a, b) => score(a) - score(b))
  if (unsolved.length) return { id: unsolved[0].id, step: level }
  const lastDone = (id: string) => state.days.filter((d) => d.id === id).reduce((m, d) => (d.day > m ? d.day : m), '')
  const oldest = [...open].sort((a, b) => (lastDone(a.id) < lastDone(b.id) ? -1 : 1) || score(a) - score(b))[0]
  return { id: oldest.id, step: level }
}

/** A check's result, folded into the day's record */
export function withCheck(d: AlgoDay, failing: string[], at: number): AlgoDay {
  const checks = d.checks + 1
  const passed = !failing.length
  return { ...d, checks, failing, ...(passed && !d.solvedAt ? { solvedAt: at, checksToPass: checks } : {}) }
}

export interface AlgoStats {
  /** Days in a row solved, up to today (or yesterday, while today is open) */
  streak: number
  solved: number
  /** Days with a problem picked */
  days: number
  /** The last fortnight, oldest first */
  recent: { day: string; state: 'solved' | 'tried' | 'none' }[]
}

export function algoStats(state: AlgoState, today: string): AlgoStats {
  const by = new Map(state.days.map((d) => [d.day, d]))
  const solvedOn = (day: string) => !!by.get(day)?.solvedAt
  let streak = 0
  let d = solvedOn(today) ? today : addDays(today, -1)
  while (solvedOn(d)) {
    streak++
    d = addDays(d, -1)
  }
  const recent: AlgoStats['recent'] = []
  for (let i = 13; i >= 0; i--) {
    const day = addDays(today, -i)
    const r = by.get(day)
    recent.push({ day, state: r?.solvedAt ? 'solved' : r?.checks ? 'tried' : 'none' })
  }
  return { streak, solved: new Set(state.days.filter((x) => x.solvedAt).map((x) => x.id)).size, days: state.days.length, recent }
}

/** The record read back loosely: anything malformed is dropped */
export function cleanState(raw: unknown): AlgoState {
  const days = (raw as { days?: unknown })?.days
  if (!Array.isArray(days)) return { days: [] }
  const out: AlgoDay[] = []
  for (const x of days as Partial<AlgoDay>[]) {
    if (!x || typeof x.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.day) || typeof x.id !== 'string' || out.some((o) => o.day === x.day)) continue
    out.push({
      day: x.day,
      id: x.id,
      step: x.step === 2 || x.step === 3 ? x.step : 1,
      checks: Math.max(0, Math.round(Number(x.checks) || 0)),
      hint: !!x.hint,
      ...(typeof x.solvedAt === 'number' ? { solvedAt: x.solvedAt, checksToPass: Math.max(1, Math.round(Number(x.checksToPass) || 1)) } : {}),
      ...(Array.isArray(x.failing) ? { failing: x.failing.map(String).slice(0, 20) } : {})
    })
  }
  return { days: out.sort(byDay) }
}

/** What the window gets: the problem without its reference, and the hint only once asked for */
export type PublicAlgo = Omit<AlgoProblem, 'reference' | 'hint' | 'tests'> & { hint?: string; testCount: number }

export function publicAlgo(p: AlgoProblem, hint: boolean): PublicAlgo {
  const { reference: _r, hint: h, tests, ...rest } = p
  return { ...rest, testCount: [...tests.matchAll(/^def test_/gm)].length, ...(hint ? { hint: h } : {}) }
}

export interface AlgoToday {
  today: string
  level: AlgoStep
  core: CoreProgress
  problem: PublicAlgo | null
  record: AlgoDay | null
  /** The day's folder, for the IDE */
  root: string | null
  stats: AlgoStats
}

export interface AlgoCheck {
  passed: string[]
  failed: { name: string; why: string }[]
  /** The code didn't run (a syntax error, say) */
  error?: string
  record: AlgoDay
}

/** The folder's name for a day's problem, and back */
export const folderName = (day: string, id: string) => `${day}-${id}`
export const folderDay = (name: string): { day: string; id: string } | null => {
  const m = /^(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)$/.exec(name)
  return m ? { day: m[1], id: m[2] } : null
}

/** "test_empty_lists" → "empty lists" */
export const testLabel = (name: string) => name.replace(/^.*::/, '').replace(/^test_?/, '').replace(/_/g, ' ').trim() || name
