/**
 * Sharpness training (shared/sharpness has the rules; components/sharp the screens).
 *
 * The stream: unseen problems just past your level in six categories. Claude (Opus) writes an
 * original one and Tide checks it in the sandbox before you see it (shared/sharpness
 * verifyProblem); without Claude, or when a written one fails its checks twice, it comes from the
 * fixed bank. The first attempt is timed, hint-free and rated. After a miss the method hints open
 * (shared/sharpMethods), then a Socratic post-mortem with Opus ends in a recall card about the
 * method (shared/sharpPostmortem). Incident drills have Opus play the system, from the scenario's
 * data (shared/sharpIncidents); without Claude the same data answers by itself.
 *
 * Files, all in the vault: .tide/sharpness.json (ratings and method counts), and under
 * .tide/sharpness/ the attempts, post-mortems, stream cards and written problems. Every attempt,
 * hint, retry, drill step and post-mortem also goes to the learning event log (main/sharpEventLog).
 * Mock interviews feed the ratings, and read them back to pick a level (main/mocks).
 */
import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { parseNumber } from '@shared/mockQuestions'
import { SHARP_BANK, pickFromBank, sharpProblem } from '@shared/sharpBank'
import { attemptEvent, cardReviewEvent, drillStepEvent, hintEvent, postmortemEvent, retryEvent } from '@shared/sharpEvents'
import { INCIDENTS, act, askData, freshDrill, hypothesise, incidentScenario, incidentWriterPrompt, parseIncident, pickIncident, playerPrompt, publicIncident, resolve, rootCauseRight, scoreDrill, SYSTEM_PLAYER, type DrillScore, type DrillState, type IncidentScenario, type PublicIncident } from '@shared/sharpIncidents'
import { afterHint, afterRetry, freshHints, freshMethodStats, isMethod, method, methodHintLeaks, methodReport, nextHint, noteMethods, pickHintMethod, type HintState, type MethodId, type MethodReport, type MethodStats } from '@shared/sharpMethods'
import { cardInCode, coachPrompt, COACH_SYSTEM, dueCards, finishPrompt, newCard, parseFinish, PM_QUESTIONS, PM_STEPS, recallPrompt, recallTopic, reviewCard, type PmAnswers, type PmStep, type Postmortem, type StreamCard } from '@shared/sharpPostmortem'
import {
  benchmarks,
  CATEGORIES,
  categoryInfo,
  checklistCover,
  checkNumber,
  draftProblem,
  freshRatings,
  graderPrompt,
  GRADER_SYSTEM,
  isCategory,
  nextInStream,
  parseGrade,
  parseJsonObject,
  publicSharp,
  rateAttempt,
  ratingBand,
  solvedBy,
  stretchDifficulty,
  timedScore,
  trend,
  trendChange,
  verifyProblem,
  WRITER_SYSTEM,
  writerPrompt,
  type AttemptRecord,
  type Benchmark,
  type PublicSharpProblem,
  type RunOutcome,
  type SharpCategory,
  type SharpPrefs,
  type SharpProblem,
  type StreamItem
} from '@shared/sharpness'
import type { MockRecord } from '@shared/mocks'
import { logLearningEvents } from './sharpEventLog'
import { absPath, readText, writeText } from './vault'

// ---------- The models and the sandbox (a stand-in in tests) ----------

export type SharpJob = 'sharpWrite' | 'sharpMark' | 'sharpCoach' | 'sharpSystem'

export interface SharpModels {
  /** Claude can take Sharpness's jobs now */
  claude(): Promise<{ ready: boolean; why?: string }>
  /** Claude on the job's model; with `fallback`, Gemma when Claude can't. Throws when neither answers */
  ask(job: SharpJob, prompt: string, system: string, o: { fallback: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<{ text: string; by: 'claude' | 'gemma' }>
  runTests(code: string, tests: string): Promise<RunOutcome>
  run(code: string): Promise<RunOutcome>
}

const toOutcome = (r: import('@shared/types').RunResult): RunOutcome => ({ stdout: r.stdout, exitCode: r.exitCode, timedOut: r.timedOut, passed: r.tests?.passed ?? [], failed: r.tests?.failed.map((f) => f.name) ?? [] })

const realModels: SharpModels = {
  async claude() {
    const { jobRoute } = await import('./ai')
    const r = await jobRoute('sharpWrite')
    if (r.who === 'claude') return { ready: true }
    const why = { 'no-claude': 'Claude Code isn’t set up', 'logged-out': 'Claude Code is logged out', limit: 'Claude is at its plan’s limit', offline: 'offline', 'claude-failed': 'Claude failed just now', picked: 'Gemma is picked in Settings', 'gemma-only': 'Gemma only', manual: 'Gemma is picked in Settings' }[r.reason]
    return { ready: false, why }
  },
  async ask(job, prompt, system, o) {
    const ai = await import('./ai')
    if (!o.fallback) {
      const route = await ai.jobRoute(job)
      if (route.who !== 'claude') throw new Error('Claude isn’t available')
      const text = await ai.claudeOr(job, prompt, system, { signal: o.signal, timeoutMs: o.timeoutMs, noFallback: true }, async () => {
        throw new Error('Claude isn’t available')
      })
      return { text, by: 'claude' }
    }
    let by: 'claude' | 'gemma' = 'claude'
    const text = await ai.claudeOr(job, prompt, system, { signal: o.signal, timeoutMs: o.timeoutMs }, () => {
      by = 'gemma'
      return ai.complete(prompt, system, o.signal)
    })
    return { text, by }
  },
  async runTests(code, tests) {
    const { runCode } = await import('./runner')
    return toOutcome(await runCode('python', code, '', 90_000, { tests }))
  },
  async run(code) {
    const { runCode } = await import('./runner')
    return toOutcome(await runCode('python', code, '', 30_000))
  }
}

let models: SharpModels = realModels
export const setSharpModels = (m: SharpModels | null) => (models = m ?? realModels)

// ---------- Files ----------

const PREFS = '.tide/sharpness.json'
const ATTEMPTS = '.tide/sharpness/attempts.jsonl'
const POSTMORTEMS = '.tide/sharpness/postmortems.jsonl'
const CARDS = '.tide/sharpness/cards.json'
const WRITTEN = '.tide/sharpness/written.jsonl'

async function lines<T>(rel: string): Promise<T[]> {
  try {
    return (await readText(rel))
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as T]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

async function append(rel: string, x: unknown) {
  await fs.mkdir(absPath('.tide/sharpness'), { recursive: true })
  await fs.appendFile(absPath(rel), JSON.stringify(x) + '\n')
}

function sane(p: Partial<SharpPrefs>): SharpPrefs {
  const ratings = freshRatings()
  for (const c of CATEGORIES) {
    const r = p.ratings?.[c.id]
    if (r && Number.isFinite(r.r) && Number.isFinite(r.n)) ratings[c.id] = { r: r.r, n: r.n, ...(Number.isFinite(r.last) ? { last: r.last } : {}) }
  }
  const m = p.methods ?? freshMethodStats()
  return { version: 1, ratings, methods: { reached: m.reached ?? {}, hinted: m.hinted ?? {}, unlocked: m.unlocked ?? {}, needed: m.needed ?? {} } }
}

async function readPrefs(): Promise<SharpPrefs> {
  try {
    return sane(JSON.parse(await readText(PREFS)) as Partial<SharpPrefs>)
  } catch {
    return sane({})
  }
}

async function writePrefs(p: SharpPrefs) {
  await fs.mkdir(absPath('.tide'), { recursive: true })
  const tmp = absPath(PREFS) + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(p, null, 2))
  await fs.rename(tmp, absPath(PREFS))
}

async function readCards(): Promise<StreamCard[]> {
  try {
    const v = JSON.parse(await readText(CARDS)) as unknown
    return Array.isArray(v) ? (v as StreamCard[]) : []
  } catch {
    return []
  }
}

const writeCards = (c: StreamCard[]) => writeText(CARDS, JSON.stringify(c, null, 2))

// One write at a time
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const run = queue.then(f, f)
  queue = run.catch(() => {})
  return run
}

export const sharpAttempts = () => lines<AttemptRecord>(ATTEMPTS)
export const sharpPostmortems = () => lines<Postmortem>(POSTMORTEMS)

interface Written {
  at: number
  problem?: SharpProblem
  incident?: IncidentScenario
}

// ---------- Status: the page ----------

export interface CategoryStatus {
  id: SharpCategory
  rating: number
  band: number
  attempts: number
  trend: { at: number; r: number }[]
  change: number | null
  benchmarks: Benchmark[]
}

export interface SharpStatus {
  claude: boolean
  why?: string
  categories: CategoryStatus[]
  stream: StreamItem[]
  methods: { methods: MethodReport[]; train: MethodId[]; unlocks: MethodId[] }
  postmortems: Postmortem[]
  attempts: AttemptRecord[]
  cardsDue: number
  cards: number
  /** Categories your mocks say are weak */
  weak: SharpCategory[]
}

const MOCK_CATEGORY: Record<string, SharpCategory> = { coding: 'algorithms', design: 'design', quant: 'quant' }

/** Categories the mock interviews say are weak: the latest mock of that kind under 60% */
async function weakFromMocks(): Promise<SharpCategory[]> {
  try {
    const { mockHistory } = await import('./mocks')
    const latest = new Map<string, MockRecord>()
    for (const r of await mockHistory()) if (!latest.has(r.mode) || latest.get(r.mode)!.at < r.at) latest.set(r.mode, r)
    return [...latest.values()].filter((r) => MOCK_CATEGORY[r.mode] && r.overall < 0.6).map((r) => MOCK_CATEGORY[r.mode])
  } catch {
    return []
  }
}

export async function sharpStatus(): Promise<SharpStatus> {
  const now = Date.now()
  const [ready, prefs, attempts, pms, cards, weak] = await Promise.all([models.claude().catch(() => ({ ready: false, why: 'Claude isn’t set up' })), readPrefs(), sharpAttempts(), sharpPostmortems(), readCards(), weakFromMocks()])
  const report = methodReport(prefs.methods)
  const due = dueCards(cards, now)
  return {
    claude: ready.ready,
    ...(ready.why ? { why: ready.why } : {}),
    categories: CATEGORIES.map((c) => {
      const rt = prefs.ratings[c.id]
      return { id: c.id, rating: Math.round(rt.r), band: ratingBand(rt, now), attempts: rt.n, trend: trend(attempts, c.id), change: trendChange(attempts, c.id), benchmarks: benchmarks(c.id, rt, now) }
    }),
    stream: nextInStream({ ratings: prefs.ratings, attempts, due: due.map((d) => ({ id: d.id, category: d.category, pattern: d.pattern, prompt: d.front })), train: report.train, now, weak }),
    methods: report,
    postmortems: pms.slice(-60).reverse(),
    attempts: attempts.slice(-40).reverse(),
    cardsDue: due.length,
    cards: cards.length,
    weak
  }
}

// ---------- Live attempts ----------

interface Live {
  id: string
  kind: 'problem' | 'incident'
  category: SharpCategory
  startedAt: number
  minutes: number
  problem?: SharpProblem
  scenario?: IncidentScenario
  drill?: DrillState
  drillScore?: DrillScore
  hints: HintState
  hinted: MethodId[]
  lastMethod?: MethodId
  record?: AttemptRecord
  unlockedBy?: MethodId
  card?: StreamCard
  /** The method the stream asked this one to train */
  training?: MethodId
  pm: { answers: Partial<PmAnswers>; turns: Postmortem['turns'] }
  busy: boolean
}

const live = new Map<string, Live>()
const need = (id: string) => {
  const m = live.get(id)
  if (!m) throw new Error('That attempt has ended.')
  return m
}

export interface SharpStartInput {
  category: SharpCategory
  /** Aim here instead of just past the rating */
  difficulty?: number
  method?: MethodId
  /** A stream card being revisited */
  card?: string
  /** Skip Claude and take one from the bank */
  bank?: boolean
  /** A particular bank problem or scenario */
  ref?: string
}

export interface SharpStarted {
  id: string
  kind: 'problem' | 'incident'
  category: SharpCategory
  startedAt: number
  minutes: number
  problem?: PublicSharpProblem
  incident?: PublicIncident
  /** Who set it: written by Claude and checked, or from the bank */
  written: 'claude' | 'bank'
  /** Why it came from the bank, when Claude was asked */
  why?: string
  training?: { id: MethodId; name: string; what: string }
  card?: { front: string; pattern: string }
}

const FIELDS = 'payments, banking, trading, ML platforms, blockchain infrastructure or data engineering'

/** Claude writes an original problem and Tide checks it; two tries, then null with why */
async function writeProblem(category: SharpProblem['category'], difficulty: number, avoid: string[], method?: MethodId, pattern?: string): Promise<{ problem: SharpProblem } | { why: string }> {
  let fix: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string
    try {
      text = (await models.ask('sharpWrite', writerPrompt({ category, difficulty, avoid, method, pattern, fix }), WRITER_SYSTEM, { fallback: false, timeoutMs: 300_000 })).text
    } catch (e) {
      return { why: (e as Error).message || 'Claude didn’t answer' }
    }
    const raw = parseJsonObject(text)
    if (!raw) {
      fix = 'the reply was not one JSON object'
      continue
    }
    const d = draftProblem(category, raw, difficulty, `w-${category}-${Date.now().toString(36)}`)
    if ('error' in d) {
      fix = d.error
      continue
    }
    const v = await verifyProblem(d, models).catch((e) => ({ ok: false as const, why: (e as Error).message }))
    if (v.ok) {
      await append(WRITTEN, { at: Date.now(), problem: d.problem } satisfies Written).catch(() => {})
      return { problem: d.problem }
    }
    console.warn('[sharpness] a written problem failed its check:', v.why)
    fix = v.why
  }
  return { why: `the problem Claude wrote failed Tide’s check twice (${fix})` }
}

async function writeIncident(difficulty: number, avoid: string[]): Promise<{ incident: IncidentScenario } | { why: string }> {
  let fix = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string
    try {
      text = (await models.ask('sharpWrite', incidentWriterPrompt({ difficulty, avoid, fields: FIELDS }) + (fix ? `\n\nYour last attempt failed Tide's check: ${fix}. Fix that.` : ''), WRITER_SYSTEM, { fallback: false, timeoutMs: 300_000 })).text
    } catch (e) {
      return { why: (e as Error).message || 'Claude didn’t answer' }
    }
    const s = parseIncident(text, `w-incident-${Date.now().toString(36)}`, difficulty)
    if (!('error' in s)) {
      await append(WRITTEN, { at: Date.now(), incident: s } satisfies Written).catch(() => {})
      return { incident: s }
    }
    fix = s.error
  }
  return { why: `the incident Claude wrote failed Tide’s check twice (${fix})` }
}

export async function startSharp(input: SharpStartInput): Promise<SharpStarted> {
  if (!isCategory(input.category)) throw new Error('Not a category.')
  const now = Date.now()
  const [prefs, attempts, cards, written] = await Promise.all([readPrefs(), sharpAttempts(), readCards(), lines<Written>(WRITTEN)])
  const category = input.category
  const difficulty = Math.round(input.difficulty ?? stretchDifficulty(prefs.ratings[category].r))
  const card = input.card ? cards.find((c) => c.id === input.card) : undefined
  const trainingId = input.method && isMethod(input.method) ? input.method : undefined
  const recent = attempts.filter((a) => a.category === category).slice(-12).map((a) => a.problem)
  const avoid = [...new Set([...attempts.filter((a) => a.category === category).slice(-20).map((a) => a.title), ...written.flatMap((w) => (w.problem?.category === category ? [w.problem.title] : w.incident && category === 'production' ? [w.incident.title] : [])).slice(-20)])]
  const id = `sh-${now.toString(36)}-${randomUUID().slice(0, 6)}`
  const claude = !input.bank && !input.ref && (await models.claude().catch(() => ({ ready: false }))).ready
  let why: string | undefined
  const m: Live = { id, kind: category === 'production' ? 'incident' : 'problem', category, startedAt: 0, minutes: categoryInfo(category).minutes, hints: freshHints(), hinted: [], pm: { answers: {}, turns: [] }, busy: false, ...(card ? { card } : {}), ...(trainingId ? { training: trainingId } : {}) }

  if (category === 'production') {
    let s = input.ref ? incidentScenario(input.ref) : undefined
    if (!s && claude) {
      const w = await writeIncident(difficulty, avoid)
      if ('incident' in w) s = w.incident
      else why = w.why
    }
    s ??= pickIncident({ difficulty, recent, seed: now })
    m.scenario = s
    m.minutes = s.minutes
    m.drill = freshDrill(now)
  } else {
    let p = input.ref ? sharpProblem(input.ref) : undefined
    if (!p && claude) {
      const w = await writeProblem(category, difficulty, avoid, trainingId, card?.pattern)
      if ('problem' in w) p = w.problem
      else why = w.why
    }
    p ??= pickFromBank({ category, difficulty, recent, method: trainingId, pattern: card?.pattern, seed: now })
    m.problem = p
    m.minutes = p.minutes
  }
  m.startedAt = Date.now()
  if (m.drill) m.drill = freshDrill(m.startedAt)
  live.set(id, m)
  const t = trainingId ? method(trainingId) : undefined
  return {
    id,
    kind: m.kind,
    category,
    startedAt: m.startedAt,
    minutes: m.minutes,
    ...(m.problem ? { problem: publicSharp(m.problem) } : {}),
    ...(m.scenario ? { incident: publicIncident(m.scenario) } : {}),
    written: (m.problem ?? m.scenario)!.origin === 'claude' ? 'claude' : 'bank',
    ...(claude && why ? { why } : !claude && !input.bank && !input.ref ? { why: 'Claude isn’t available, so this one is from the fixed bank' } : {}),
    ...(t ? { training: { id: t.id, name: t.name, what: t.what } } : {}),
    ...(card ? { card: { front: card.front, pattern: card.pattern } } : {})
  }
}

export function cancelSharp(id: string) {
  live.delete(id)
}

// ---------- Grading ----------

export interface TestOutcome {
  passed: string[]
  failed: string[]
  total: number
  error?: string
}

const readable = (n: string) => n.replace(/^test_?/, '').replace(/_/g, ' ')

async function runHidden(p: SharpProblem, code: string): Promise<TestOutcome> {
  const total = [...p.code!.tests.matchAll(/^def\s+test\w*\s*\(/gm)].length
  const r = await models.runTests(code, p.code!.tests)
  if (!r.passed?.length && !r.failed?.length) return { passed: [], failed: [], total, error: r.timedOut ? 'Timed out.' : r.stdout.trim().split('\n').slice(-6).join('\n').slice(0, 600) || 'The tests did not run.' }
  return { passed: r.passed!.map(readable), failed: r.failed!.map(readable), total }
}

/** The hidden tests against the code so far: names and outcomes only */
export async function testSharp(id: string, code: string): Promise<TestOutcome> {
  const m = need(id)
  if (!m.problem?.code) throw new Error('This one has no tests.')
  return runHidden(m.problem, String(code ?? '').slice(0, 40_000))
}

export interface Grade {
  /** Raw, before time (0 to 1) */
  raw: number
  verdict: string
  missing: string[]
  strength?: string
  tests?: TestOutcome
  by: AttemptRecord['by']
}

async function grade(p: SharpProblem, input: { answer?: string; code?: string }, usedMs: number): Promise<Grade> {
  if (p.code) {
    const code = (input.code ?? '').trim()
    if (!code) return { raw: 0, verdict: 'No code.', missing: [], by: 'tests' }
    const t = await runHidden(p, code)
    const raw = t.total ? t.passed.length / t.total : 0
    return { raw, verdict: t.error ? `It didn’t run: ${t.error.split('\n').pop()}` : `${t.passed.length} of ${t.total} hidden tests pass.`, missing: t.failed.slice(0, 4), tests: t, by: 'tests' }
  }
  const answer = (input.answer ?? '').trim()
  if (!answer) return { raw: 0, verdict: 'No answer.', missing: [], by: 'code' }
  if (p.answer && !p.checklist?.length) {
    const v = parseNumber(answer)
    const right = checkNumber(p.answer, v)
    return { raw: right ? 1 : 0, verdict: right ? 'Right.' : v === null ? 'No number found in your answer.' : `${v} isn’t it.`, missing: [], by: 'number' }
  }
  try {
    const r = await models.ask('sharpMark', graderPrompt(p, answer, usedMs / 60_000), GRADER_SYSTEM, { fallback: true, timeoutMs: 180_000 })
    const g = parseGrade(r.text, p)
    if (g) {
      // A number the problem has is checked in code: the grader can't credit a wrong one
      const numberOk = p.answer ? checkNumber(p.answer, parseNumber(answer)) : true
      return { raw: numberOk ? g.score : Math.min(g.score, 0.5), verdict: g.verdict || 'Marked.', missing: g.missing, ...(g.strength ? { strength: g.strength } : {}), by: r.by === 'claude' ? 'opus' : 'gemma' }
    }
  } catch (e) {
    console.warn('[sharpness] grading by model failed, marking in code', (e as Error).message)
  }
  const cov = checklistCover(p.checklist ?? [], answer)
  return { raw: cov.share, verdict: `${cov.covered.length} of ${cov.covered.length + cov.missed.length} key points covered (marked in code).`, missing: cov.missed.slice(0, 4), by: 'code' }
}

export interface SharpSubmitInput {
  answer?: string
  code?: string
  reached?: MethodId[]
  gaveUp?: boolean
}

export interface Reveal {
  solution: string
  pattern: string
  methods: { id: MethodId; name: string }[]
  reference?: string
  answer?: number
  complexity?: string
}

export interface SharpSubmitted {
  score: number
  solved: boolean
  grade: Grade
  before: number
  after: number
  /** The solution and pattern, once solved (after a miss: asked for, after the method hints) */
  reveal?: Reveal
}

function revealOf(p: SharpProblem): Reveal {
  return { solution: p.solution, pattern: p.pattern, methods: p.methods.map((id) => ({ id, name: method(id).name })), ...(p.code ? { reference: p.code.reference, complexity: p.code.complexity } : {}), ...(p.answer ? { answer: p.answer.value } : {}) }
}

/** Keeps a rated attempt: the rating, the method counts, the log, the card if a revisit, the event */
function keepAttempt(m: Live, rec: AttemptRecord, reached: MethodId[], solved: boolean): Promise<void> {
  return serial(async () => {
    const p = await readPrefs()
    p.ratings[rec.category] = rateAttempt(p.ratings[rec.category], rec.difficulty, rec.score, rec.at)
    rec.after = Math.round(p.ratings[rec.category].r)
    p.methods = noteMethods(p.methods, { reached, needed: (m.problem?.methods ?? m.scenario?.methods ?? []).slice(0, 2) })
    await append(ATTEMPTS, rec)
    await writePrefs(p)
    if (m.card) {
      const cards = await readCards()
      const i = cards.findIndex((c) => c.id === m.card!.id)
      if (i >= 0) {
        cards[i] = reviewCard(cards[i], solved, rec.at)
        await writeCards(cards)
      }
      void logLearningEvents(cardReviewEvent({ at: rec.at, category: rec.category, pattern: m.card.pattern, card: m.card.id, solved }))
    }
    void logLearningEvents(attemptEvent(rec))
  })
}

/** The first attempt: graded and rated. A miss opens the method hints and keeps the solution back */
export async function submitSharp(id: string, input: SharpSubmitInput): Promise<SharpSubmitted> {
  const m = need(id)
  const p = m.problem
  if (!p) throw new Error('Drills end with a root cause, not an answer.')
  if (m.record) throw new Error('Already submitted: this is a retry now.')
  if (m.busy) throw new Error('Still marking.')
  m.busy = true
  try {
    const usedMs = Date.now() - m.startedAt
    const reached = (input.reached ?? []).filter(isMethod)
    const g = input.gaveUp ? { raw: 0, verdict: 'Given up.', missing: [], by: 'code' as const } : await grade(p, input, usedMs)
    const score = timedScore(g.raw, usedMs, p.minutes)
    const solved = solvedBy(score)
    const prefs = await readPrefs()
    const before = Math.round(prefs.ratings[m.category].r)
    const rec: AttemptRecord = { id: m.id, at: Date.now(), category: m.category, problem: p.id, title: p.title, pattern: p.pattern, difficulty: p.difficulty, origin: p.origin, score, solved, usedMs, minutes: p.minutes, before, after: before, reached, methodHints: 0, solutionHints: 0, by: g.by }
    await keepAttempt(m, rec, reached, solved)
    m.record = rec
    m.hints = { ...m.hints, submitted: true, missed: !solved }
    return { score, solved, grade: g, before: rec.before, after: rec.after, ...(solved ? { reveal: revealOf(p) } : {}) }
  } finally {
    m.busy = false
  }
}

export interface SharpHint {
  kind: 'method' | 'solution' | null
  text: string
  method?: { id: MethodId; name: string }
}

const HINT_SYSTEM = 'You give one method hint to a learner stuck on a problem: name the problem-solving method and say how it applies here in one or two sentences, as a question if you can. Never give the answer, a formula that solves it, code, or the key insight itself.'

/** "I'm stuck": a method hint first, never the solution first (shared/sharpMethods nextHint) */
export async function hintSharp(id: string, asked: 'method' | 'solution' = 'method'): Promise<SharpHint> {
  const m = need(id)
  const p = m.problem
  if (!p) throw new Error('Drills have the on-call partner instead.')
  const next = nextHint(m.hints, asked)
  if (next.kind === null) return { kind: null, text: next.why }
  const at = Date.now()
  if (next.kind === 'solution') {
    const text = p.hints[m.hints.solutionHints] ?? 'No more solution hints. The worked solution is there when you want it.'
    m.hints = afterHint(m.hints, 'solution')
    void logLearningEvents(hintEvent({ at, category: m.category, pattern: p.pattern, item: p.id, kind: 'solution' }))
    return { kind: 'solution', text }
  }
  const prefs = await readPrefs()
  const id2 = pickHintMethod(p.methods, m.hinted, methodReport(prefs.methods).train)
  const meth = method(id2)
  let text = meth.nudge
  try {
    const r = await models.ask('sharpCoach', `Problem: ${p.title}\n${p.brief}\n\nReference (never reveal): ${p.solution.slice(0, 2000)}\n\nThe method to hint: ${meth.name} (${meth.what}). One or two sentences.`, HINT_SYSTEM, { fallback: true, timeoutMs: 90_000 })
    const t = r.text.trim()
    if (t && t.length < 600 && !methodHintLeaks(t, { answer: p.answer?.value, solution: p.solution, code: p.code?.reference })) text = t
  } catch {
    // the method's own nudge stands
  }
  m.hints = afterHint(m.hints, 'method')
  m.hinted.push(id2)
  m.lastMethod = id2
  await serial(async () => {
    const pr = await readPrefs()
    pr.methods = noteMethods(pr.methods, { hinted: [id2] })
    await writePrefs(pr)
  })
  void logLearningEvents(hintEvent({ at, category: m.category, pattern: p.pattern, item: p.id, kind: 'method', method: id2 }))
  return { kind: 'method', text, method: { id: id2, name: meth.name } }
}

export interface SharpRetried {
  score: number
  solved: boolean
  grade: Grade
  /** The method hint that unlocked it */
  unlockedBy?: { id: MethodId; name: string }
  reveal?: Reveal
}

/** A retry after a miss: marked, not rated. Solved after a method hint counts that method as one that unlocks you */
export async function retrySharp(id: string, input: { answer?: string; code?: string }): Promise<SharpRetried> {
  const m = need(id)
  const p = m.problem
  if (!p || !m.record) throw new Error('Submit a first attempt before retrying.')
  if (m.busy) throw new Error('Still marking.')
  m.busy = true
  try {
    const g = await grade(p, input, Date.now() - m.startedAt)
    const solved = solvedBy(g.raw)
    m.hints = afterRetry(m.hints)
    let unlockedBy: MethodId | undefined
    if (solved && m.lastMethod && !m.unlockedBy && m.hints.solutionHints === 0) {
      unlockedBy = m.lastMethod
      m.unlockedBy = unlockedBy
      await serial(async () => {
        const pr = await readPrefs()
        pr.methods = noteMethods(pr.methods, { unlocked: [unlockedBy!] })
        await writePrefs(pr)
      })
    }
    void logLearningEvents(retryEvent({ at: Date.now(), category: m.category, pattern: p.pattern, item: p.id, score: g.raw, solved, afterMethod: m.lastMethod }))
    return { score: g.raw, solved, grade: g, ...(unlockedBy ? { unlockedBy: { id: unlockedBy, name: method(unlockedBy).name } } : {}), ...(solved ? { reveal: revealOf(p) } : {}) }
  } finally {
    m.busy = false
  }
}

/** The worked solution, after the first attempt */
export function revealSharp(id: string): Reveal & { postmortem?: string; rootCause?: string } {
  const m = need(id)
  if (m.problem) {
    if (!m.record) throw new Error('Submit (or give up) first: the solution comes after a real attempt.')
    return revealOf(m.problem)
  }
  const s = m.scenario!
  if (!m.drill?.resolved) throw new Error('Name a root cause (or give up) first.')
  return { solution: s.postmortem, pattern: s.pattern, methods: s.methods.map((x) => ({ id: x, name: method(x).name })), postmortem: s.postmortem, rootCause: s.rootCause.summary }
}

// ---------- Incident drills ----------

export interface DrillReply {
  reply: string
  /** Which data it was, when it matched one */
  source?: string
  effect?: string
  by: 'opus' | 'code'
  state: DrillState
}

async function voice(m: Live, kind: 'ask' | 'action' | 'hypothesis', text: string, src: import('@shared/sharpIncidents').IncidentSource | null, effect?: import('@shared/sharpIncidents').ActionEffect): Promise<string | null> {
  try {
    const r = await models.ask('sharpSystem', playerPrompt(m.scenario!, m.drill!, kind, text, src, effect), SYSTEM_PLAYER, { fallback: false, timeoutMs: 90_000 })
    // Plain output: no Markdown fences around it
    return r.text.replace(/^\s*```[\w-]*\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim() || null
  } catch {
    return null
  }
}

function drillLive(id: string) {
  const m = need(id)
  if (!m.scenario || !m.drill) throw new Error('This isn’t a drill.')
  if (m.drill.resolved) throw new Error('This drill is over.')
  return m
}

export async function drillAsk(id: string, text: string): Promise<DrillReply> {
  const m = drillLive(id)
  const req = String(text ?? '').trim().slice(0, 600)
  if (!req) throw new Error('Ask for something.')
  const src = (await import('@shared/sharpIncidents')).matchSource(m.scenario!, req)
  const voiced = (await models.claude().catch(() => ({ ready: false }))).ready ? await voice(m, 'ask', req, src) : null
  const r = askData(m.scenario!, m.drill!, req, Date.now(), voiced ?? undefined)
  m.drill = r.state
  void logLearningEvents(drillStepEvent({ at: Date.now(), item: m.scenario!.id, pattern: m.scenario!.pattern, step: 'ask', text: req, source: r.source?.id }))
  return { reply: r.reply, ...(r.source ? { source: r.source.id } : {}), by: voiced ? 'opus' : 'code', state: m.drill }
}

export async function drillHypothesis(id: string, text: string): Promise<DrillReply> {
  const m = drillLive(id)
  const h = String(text ?? '').trim().slice(0, 600)
  if (!h) throw new Error('Say the hypothesis.')
  const voiced = (await models.claude().catch(() => ({ ready: false }))).ready ? await voice(m, 'hypothesis', h, null) : null
  m.drill = hypothesise(m.drill!, h, Date.now(), voiced ?? 'Noted. What data would confirm it, and what would rule it out?')
  void logLearningEvents(drillStepEvent({ at: Date.now(), item: m.scenario!.id, pattern: m.scenario!.pattern, step: 'hypothesis', text: h }))
  return { reply: m.drill.entries[m.drill.entries.length - 1].reply, by: voiced ? 'opus' : 'code', state: m.drill }
}

export async function drillAct(id: string, text: string): Promise<DrillReply> {
  const m = drillLive(id)
  const a = String(text ?? '').trim().slice(0, 600)
  if (!a) throw new Error('Say what you do.')
  const { matchAction } = await import('@shared/sharpIncidents')
  const effect = matchAction(m.scenario!, a)?.effect ?? 'neutral'
  const voiced = (await models.claude().catch(() => ({ ready: false }))).ready ? await voice(m, 'action', a, null, effect) : null
  const r = act(m.scenario!, m.drill!, a, Date.now(), voiced ?? undefined)
  m.drill = r.state
  void logLearningEvents(drillStepEvent({ at: Date.now(), item: m.scenario!.id, pattern: m.scenario!.pattern, step: 'action', text: a, effect: r.effect }))
  return { reply: r.reply, effect: r.effect, by: voiced ? 'opus' : 'code', state: m.drill }
}

export interface DrillResolved {
  score: DrillScore
  right: boolean
  before: number
  after: number
  rootCause: string
  postmortem: string
  state: DrillState
}

const JUDGE_SYSTEM = 'You judge whether an on-call engineer’s stated root cause matches the true one in substance (the mechanism, not the wording). Reply with JSON only: {"match": true|false, "why": "one sentence"}.'

/** The root cause named (or given up on): graded on method, speed and correctness, and rated */
export async function drillResolve(id: string, text: string, gaveUp = false): Promise<DrillResolved> {
  const m = drillLive(id)
  const s = m.scenario!
  const said = gaveUp ? '' : String(text ?? '').trim().slice(0, 1200)
  let right = !gaveUp && rootCauseRight(s, said)
  // Code is strict on words; Opus judges the substance when the words miss
  if (!gaveUp && !right && said.length > 20 && (await models.claude().catch(() => ({ ready: false }))).ready) {
    try {
      const r = await models.ask('sharpMark', `True root cause: ${s.rootCause.summary}\n\nThe engineer's: ${said}`, JUDGE_SYSTEM, { fallback: false, timeoutMs: 90_000 })
      right = parseJsonObject(r.text)?.match === true
    } catch {
      // the code's verdict stands
    }
  }
  m.drill = resolve(s, m.drill!, gaveUp ? '(gave up)' : said, Date.now(), right)
  const score = scoreDrill(s, m.drill)
  m.drillScore = score
  const prefs = await readPrefs()
  const before = Math.round(prefs.ratings.production.r)
  const rec: AttemptRecord = { id: m.id, at: Date.now(), category: 'production', problem: s.id, title: s.title, pattern: s.pattern, difficulty: s.difficulty, origin: s.origin, score: score.overall, solved: right && score.overall >= 0.6, usedMs: Date.now() - m.startedAt, minutes: s.minutes, before, after: before, reached: [], methodHints: 0, solutionHints: 0, by: 'drill' }
  await keepAttempt(m, rec, [], rec.solved)
  m.record = rec
  return { score, right, before, after: rec.after, rootCause: s.rootCause.summary, postmortem: s.postmortem, state: m.drill }
}

// ---------- The post-mortem ----------

export interface PmTurn {
  asked: string
  by: 'opus' | 'gemma' | 'code'
}

/** One step of the post-mortem: the learner's answer, and one Socratic question back */
export async function pmTurn(id: string, step: PmStep, said: string): Promise<PmTurn> {
  const m = need(id)
  if (!m.record) throw new Error('The post-mortem comes after the attempt.')
  if (!PM_STEPS.includes(step)) throw new Error('Not a step.')
  const text = String(said ?? '').trim().slice(0, 2000)
  if (!text) throw new Error('Say something first.')
  m.pm.answers[step] = text
  const kind = m.scenario ? 'incident' : 'problem'
  const src = m.problem ?? m.scenario!
  let asked = PM_QUESTIONS[kind][step].probe
  let by: PmTurn['by'] = 'code'
  try {
    const r = await models.ask('sharpCoach', coachPrompt({ kind, title: src.title, brief: m.problem?.brief ?? `${m.scenario!.page}\n${m.scenario!.system}`, pattern: src.pattern, solution: m.problem?.solution ?? m.scenario!.postmortem, step, answers: m.pm.answers, said: text }), COACH_SYSTEM, { fallback: true, timeoutMs: 90_000 })
    const t = r.text.trim()
    if (t && !methodHintLeaks(t, { answer: m.problem?.answer?.value, code: m.problem?.code?.reference })) {
      asked = t.slice(0, 500)
      by = r.by === 'claude' ? 'opus' : 'gemma'
    }
  } catch {
    // the fixed probe stands
  }
  m.pm.turns.push({ step, said: text, asked })
  return { asked, by }
}

export interface PmFinished {
  postmortem: Postmortem
  /** The card is back in the stream and in recall */
  recall: boolean
}

/** The post-mortem written up: a card about the method or pattern, into recall and back into the stream */
export async function pmFinish(id: string, answers: PmAnswers): Promise<PmFinished> {
  const m = need(id)
  if (!m.record) throw new Error('The post-mortem comes after the attempt.')
  const a: PmAnswers = { stuck: String(answers?.stuck ?? m.pm.answers.stuck ?? '').slice(0, 2000), tried: String(answers?.tried ?? m.pm.answers.tried ?? '').slice(0, 2000), unlock: String(answers?.unlock ?? m.pm.answers.unlock ?? '').slice(0, 2000), pattern: String(answers?.pattern ?? m.pm.answers.pattern ?? '').slice(0, 2000) }
  if (!a.unlock.trim() && !a.pattern.trim()) throw new Error('Say at least what would have unlocked it, or its pattern.')
  const kind = m.scenario ? 'incident' : 'problem'
  const src = (m.problem ?? m.scenario)!
  const methods = src.methods.length ? src.methods : (['understand'] as MethodId[])
  const secrets = { answer: m.problem?.answer?.value, code: m.problem?.code?.reference, solution: m.problem?.solution, title: src.title }
  let made: { pattern: string; method: MethodId; card: Postmortem['card'] } | null = null
  let by: Postmortem['by'] = 'self'
  try {
    const r = await models.ask('sharpCoach', finishPrompt({ kind, title: src.title, pattern: src.pattern, methods, answers: a }), COACH_SYSTEM, { fallback: true, timeoutMs: 120_000 })
    made = parseFinish(r.text, secrets)
    if (made) by = r.by === 'claude' ? 'opus' : 'gemma'
  } catch {
    // made in code below
  }
  const pattern = made?.pattern || src.pattern
  const meth = made?.method ?? m.unlockedBy ?? m.lastMethod ?? methods[0]
  const card = made?.card ?? cardInCode({ pattern, method: meth, answers: a, kind })
  const pm: Postmortem = { id: `pm-${m.id}`, attempt: m.id, at: Date.now(), category: m.category, title: src.title, kind, answers: a, pattern, method: meth, card, by, turns: m.pm.turns }
  let recall = false
  await serial(async () => {
    await append(POSTMORTEMS, pm)
    const cards = await readCards()
    if (!cards.some((c) => c.postmortem === pm.id)) await writeCards([...cards, newCard(pm, pm.at)])
  })
  try {
    const { keepForRecall } = await import('./recall')
    await keepForRecall([{ prompt: recallPrompt(card, pattern), topic: recallTopic(pattern), lesson: `sharp-${m.id}` }])
    recall = true
  } catch (e) {
    console.warn('[sharpness] recall', (e as Error).message)
  }
  void logLearningEvents(postmortemEvent(pm))
  return { postmortem: pm, recall }
}

/** Done with an attempt: drops what was kept in memory */
export function endSharp(id: string) {
  live.delete(id)
}

// ---------- Mocks: they feed the ratings and read them back ----------

const LEVEL_DIFFICULTY = { 1: 1050, 2: 1350, 3: 1700 } as const

/** A mock's result moves the matching category's rating (coding → algorithms, design, quant) */
export async function noteMockForSharpness(r: MockRecord): Promise<void> {
  const category = MOCK_CATEGORY[r.mode]
  if (!category) return
  const { bankProblem } = await import('@shared/mockBank')
  const difficulty = r.mode === 'coding' ? LEVEL_DIFFICULTY[bankProblem(r.ref ?? '')?.level ?? 2] : r.mode === 'design' ? (sharpProblem(`mock-${r.ref}`)?.difficulty ?? 1500) : 1350
  const rec: AttemptRecord = { id: `mock-${r.id}`, at: r.at, category, problem: r.ref ?? r.mode, title: `Mock: ${r.title}`, pattern: r.mode === 'coding' ? 'mock interview' : `${r.mode} mock`, difficulty, origin: 'mock', score: Math.max(0, Math.min(1, r.overall)), solved: r.overall >= 0.7, usedMs: Math.round(r.used * 60_000), minutes: r.minutes, before: 0, after: 0, reached: [], methodHints: 0, solutionHints: r.hints, by: 'mock' }
  await serial(async () => {
    const p = await readPrefs()
    rec.before = Math.round(p.ratings[category].r)
    p.ratings[category] = rateAttempt(p.ratings[category], difficulty, rec.score, rec.at)
    rec.after = Math.round(p.ratings[category].r)
    await append(ATTEMPTS, rec)
    await writePrefs(p)
  })
  void logLearningEvents(attemptEvent(rec))
}

/** The coding mock's level from the algorithms rating: it escalates as you get sharper */
export async function mockLevelFromSharpness(): Promise<1 | 2 | 3 | null> {
  const p = await readPrefs()
  const r = p.ratings.algorithms
  if (r.n < 3) return null
  return r.r >= 1600 ? 3 : r.r >= 1250 ? 2 : 1
}

/** Mock modes for the weakest Sharpness categories (lowest rating first, rated ones only) */
export async function weakMockModes(): Promise<{ mode: 'coding' | 'design' | 'quant'; category: SharpCategory; rating: number }[]> {
  const p = await readPrefs()
  return (Object.entries(MOCK_CATEGORY) as [('coding' | 'design' | 'quant'), SharpCategory][])
    .filter(([, c]) => p.ratings[c].n > 0)
    .map(([mode, category]) => ({ mode, category, rating: Math.round(p.ratings[category].r) }))
    .sort((a, b) => a.rating - b.rating)
}

// ---------- Wiring ----------

export function registerSharpness() {
  ipcMain.handle('sharp:status', () => sharpStatus())
  ipcMain.handle('sharp:start', (_e, input: SharpStartInput) => startSharp(input ?? { category: 'algorithms' }))
  ipcMain.handle('sharp:test', (_e, id: string, code: string) => testSharp(String(id), String(code ?? '')))
  ipcMain.handle('sharp:submit', (_e, id: string, input: SharpSubmitInput) => submitSharp(String(id), { answer: String(input?.answer ?? '').slice(0, 20_000), code: String(input?.code ?? '').slice(0, 40_000), reached: Array.isArray(input?.reached) ? input.reached : [], gaveUp: !!input?.gaveUp }))
  ipcMain.handle('sharp:hint', (_e, id: string, kind: 'method' | 'solution') => hintSharp(String(id), kind === 'solution' ? 'solution' : 'method'))
  ipcMain.handle('sharp:retry', (_e, id: string, input: { answer?: string; code?: string }) => retrySharp(String(id), { answer: String(input?.answer ?? '').slice(0, 20_000), code: String(input?.code ?? '').slice(0, 40_000) }))
  ipcMain.handle('sharp:reveal', (_e, id: string) => revealSharp(String(id)))
  ipcMain.handle('sharp:drillAsk', (_e, id: string, text: string) => drillAsk(String(id), String(text ?? '')))
  ipcMain.handle('sharp:drillHypothesis', (_e, id: string, text: string) => drillHypothesis(String(id), String(text ?? '')))
  ipcMain.handle('sharp:drillAct', (_e, id: string, text: string) => drillAct(String(id), String(text ?? '')))
  ipcMain.handle('sharp:drillResolve', (_e, id: string, text: string, gaveUp: boolean) => drillResolve(String(id), String(text ?? ''), !!gaveUp))
  ipcMain.handle('sharp:pmTurn', (_e, id: string, step: PmStep, said: string) => pmTurn(String(id), step, String(said ?? '')))
  ipcMain.handle('sharp:pmFinish', (_e, id: string, answers: PmAnswers) => pmFinish(String(id), answers))
  ipcMain.handle('sharp:end', (_e, id: string) => endSharp(String(id)))
  ipcMain.handle('sharp:cancel', (_e, id: string) => cancelSharp(String(id)))
  ipcMain.handle('sharp:weakModes', () => weakMockModes())
}

/** The bank's size by category, for the page's "works without Claude" note */
export const bankSizes = () => Object.fromEntries(CATEGORIES.map((c) => [c.id, c.id === 'production' ? INCIDENTS.length : SHARP_BANK.filter((p) => p.category === c.id).length])) as Record<SharpCategory, number>
