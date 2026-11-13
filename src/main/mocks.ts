/**
 * Mock interviews and exams (shared/mocks has the rules and prompts; components/mock the screens).
 *
 * A mock lives here while it runs: the bank problem or design brief, the questions, and everything
 * hidden from the window (the reference solution, the hidden tests, the worked answers). Sonnet is
 * the interviewer, one stateless call per turn with the whole transcript (the system prompt stays
 * the same, so the plan's cache holds it); Opus marks at the end. Without Claude there is no
 * interviewer, and each mock is marked in code: the hidden tests, the design checklist, the quant
 * answers, the shape of the stories. Nothing here falls back to Gemma except the mock exam's paper
 * and marking, which reuse main/exam as it is.
 *
 * At the debrief, what it shows is fed on: the history (.tide/mocks.jsonl, with each mock's whole
 * record in .tide/mocks/), the learner profile, recall questions, the practice roadmap note
 * (Coach/Mock practice.md), the knowledge map, and a lesson record that the teaching measures read.
 */
import { ipcMain, type WebContents } from 'electron'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { BANK, bankProblem, levelFrom, pickProblem, publicProblem, type BankLevel, type BankProblem, type BankTag, type PublicProblem } from '@shared/mockBank'
import { BEHAVIOURAL, DESIGNS, designPrompt, markQuant, quantPaper, type BehaviouralQuestion, type DesignPrompt, type QuantQuestion } from '@shared/mockQuestions'
import {
  examDebrief,
  examTopicLine,
  examTopics,
  interviewerMessage,
  interviewerPrompt,
  interviewerSystem,
  markBehaviouralInCode,
  markCodingInCode,
  markDesignInCode,
  markerPrompt,
  MARKER_SYSTEM,
  markQuantInCode,
  mergeRoadmap,
  mockLesson,
  modeInfo,
  openingMessage,
  half,
  keepableLive,
  overallOf,
  parseMockMarks,
  profileOps,
  QUANT_TOPIC,
  recallFrom,
  recordOf,
  ROADMAP_NOTE,
  rubricFor,
  timeCue,
  verdictFor,
  type MockAnswer,
  type MockDebrief,
  type MockLiveState,
  type MockMode,
  type MockRecord,
  type MockTurn,
  type MomentState
} from '@shared/mocks'
import type { Canvas } from '@shared/canvas'
import { describeCanvas } from '@shared/canvas'
import type { ExamMark, ExamPaper, RunResult } from '@shared/types'
import { absPath, readText, writeText } from './vault'
import { withUsage } from './usageLog'

// ---------- What the window sees ----------

export interface MockSetup {
  mode: MockMode
  minutes: number
  /** Coding: the patterns to draw from (any when empty) */
  tags?: BankTag[]
  /** A particular bank problem or design brief */
  ref?: string
  /** Mock exam: what it covers (empty: what you have studied) */
  focus?: string
}

export interface PublicQuant {
  id: string
  kind: QuantQuestion['kind']
  prompt: string
  target: number
}

export interface MockStarted {
  id: string
  mode: MockMode
  title: string
  minutes: number
  startedAt: number
  /** The interviewer can talk (Claude is ready) */
  interviewer: boolean
  /** Why not, in a few words */
  why?: string
  problem?: PublicProblem
  design?: { id: string; title: string; brief: string }
  quant?: PublicQuant[]
  behavioural?: { id: string; prompt: string; followUp: string }[]
  exam?: ExamPaper
}

export interface MockStatus {
  claude: boolean
  why?: string
  level: BankLevel
  history: MockRecord[]
}

/** What was fed on at the debrief, for the window to say so */
export interface MockFed {
  roadmap: number
  recall: number
  profile: number
  lesson: boolean
}

export interface MockEndInput {
  code?: string
  canvas?: Canvas
  notes?: string
  answers?: MockAnswer[]
  examMarks?: Record<string, ExamMark>
}

// ---------- Live mocks ----------

interface Live {
  id: string
  mode: MockMode
  title: string
  minutes: number
  startedAt: number
  claude: boolean
  problem?: BankProblem
  design?: DesignPrompt
  quant?: QuantQuestion[]
  behavioural?: BehaviouralQuestion[]
  exam?: ExamPaper
  transcript: MockTurn[]
  hints: number
  runs: number
  lastTests: { passed: number; total: number; failed: string[] } | null
  told: number[]
  busy: AbortController | null
  /** What startMock handed the window, and the window's work as it last kept it: a pop-out resumes from these */
  started?: MockStarted
  kept?: MockLiveState
}

const live = new Map<string, Live>()

/** The interviewer and the marker: in tests, a stand-in */
export interface MockModels {
  ready(): Promise<{ ready: boolean; why?: string }>
  /** Sonnet, streamed */
  interview(prompt: string, system: string, signal: AbortSignal): AsyncGenerator<string>
  /** Opus, one reply */
  mark(prompt: string, system: string, signal: AbortSignal): Promise<string>
  /** The sandbox (main/runner.runCode) */
  run(code: string, tests: string): Promise<RunResult>
}

const realModels: MockModels = {
  async ready() {
    const { claudeReady } = await import('./claudeEngine')
    const r = await claudeReady()
    return r.ready ? { ready: true } : { ready: false, why: r.why }
  },
  async *interview(prompt, system, signal) {
    const { claudeStream } = await import('./claudeEngine')
    yield* claudeStream(prompt, system, 'teach', signal)
  },
  async mark(prompt, system, signal) {
    const { claudeOnce } = await import('./claudeEngine')
    return (await claudeOnce(prompt, system, 'mark', signal)).text
  },
  async run(code, tests) {
    const { runCode } = await import('./runner')
    return runCode('python', code, '', 60_000, { tests })
  }
}

let models: MockModels = realModels
export const setMockModels = (m: MockModels | null) => (models = m ?? realModels)

const HISTORY = '.tide/mocks.jsonl'
const recordFile = (id: string) => `.tide/mocks/${id.replace(/[^a-z0-9-]/gi, '')}.json`

export async function mockHistory(): Promise<MockRecord[]> {
  try {
    return (await readText(HISTORY))
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as MockRecord]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export async function mockStatus(): Promise<MockStatus> {
  const [r, history] = await Promise.all([models.ready().catch(() => ({ ready: false, why: 'Claude Code isn’t set up' })), mockHistory()])
  return { claude: r.ready, ...(r.why ? { why: r.why } : {}), level: levelFrom(history.filter((h) => h.mode === 'coding').map((h) => h.overall)), history }
}

/** One full mock, kept for its debrief to be opened again */
export async function mockRecord(id: string): Promise<unknown> {
  try {
    return JSON.parse(await readText(recordFile(id)))
  } catch {
    return null
  }
}

/** What a mock exam would cover, from what has been studied */
export async function suggestExamTopics(): Promise<string[]> {
  const [{ listLessons }, { knowledgeView }] = await Promise.all([import('./lessons'), import('./knowledge')])
  const lessons = (await listLessons().catch(() => [])).slice(0, 80).map((l) => ({ topic: l.topic, updated: l.updated, mode: l.mode }))
  const view = await knowledgeView().catch(() => null)
  const concepts = (view?.concepts ?? []).filter((c) => c.seen > 0).map((c) => ({ name: c.name, mastery: c.estimate }))
  return examTopics({ lessons, concepts, now: Date.now() }, 5)
}

/** Starts a mock: picks its problem or questions (writes the exam paper), and starts its clock */
export async function startMock(s: MockSetup): Promise<MockStarted> {
  const id = `${s.mode}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
  const ready = await models.ready().catch(() => ({ ready: false, why: 'Claude Code isn’t set up' }))
  const history = await mockHistory()
  const seed = Date.now()
  const m: Live = { id, mode: s.mode, title: '', minutes: Math.max(5, Math.min(120, Math.round(s.minutes))), startedAt: 0, claude: ready.ready && s.mode !== 'exam', transcript: [], hints: 0, runs: 0, lastTests: null, told: [], busy: null }
  if (s.mode === 'coding') {
    const level = levelFrom(history.filter((h) => h.mode === 'coding').map((h) => h.overall))
    const recent = history.filter((h) => h.mode === 'coding').slice(-8).map((h) => h.ref ?? '')
    m.problem = (s.ref && bankProblem(s.ref)) || pickProblem({ level, tags: s.tags, recent, seed })
    m.title = m.problem.title
  } else if (s.mode === 'design') {
    const recent = new Set(history.filter((h) => h.mode === 'design').slice(-4).map((h) => h.ref))
    const pool = DESIGNS.filter((d) => !recent.has(d.id))
    m.design = (s.ref && designPrompt(s.ref)) || (pool.length ? pool : DESIGNS)[seed % (pool.length || DESIGNS.length)]
    m.title = m.design.title
  } else if (s.mode === 'quant') {
    const short = m.minutes < 25
    m.quant = quantPaper(seed % 100_000, short ? { mental: 5, probability: 3, finance: 1 } : {})
    m.title = 'Quant and finance'
  } else if (s.mode === 'behavioural') {
    const recent = new Set(history.filter((h) => h.mode === 'behavioural').slice(-2).flatMap((h) => (h.ref ?? '').split(',')))
    const pool = BEHAVIOURAL.filter((q) => !recent.has(q.id))
    const from = pool.length >= 3 ? pool : BEHAVIOURAL
    const start = seed % from.length
    m.behavioural = [0, 1, 2].map((i) => from[(start + i * 3) % from.length]).filter((q, i, a) => a.indexOf(q) === i)
    m.title = 'Behavioural'
  } else {
    const topics = s.focus?.trim() ? [s.focus.trim()] : await suggestExamTopics().catch(() => [])
    const topic = s.focus?.trim() || examTopicLine(topics) || 'computer science and finance fundamentals'
    const { generateExam } = await import('./exam')
    const questions = Math.max(3, Math.min(8, Math.round(m.minutes / 9)))
    m.exam = await generateExam({ kind: 'vault' }, topic, { questions, minutes: m.minutes, difficulty: 'normal', style: 'mixed' })
    m.title = s.focus?.trim() || (topics.length ? topics.slice(0, 3).join(', ') : m.exam.title)
  }
  m.startedAt = Date.now()
  live.set(id, m)
  m.started = {
    id,
    mode: m.mode,
    title: m.title,
    minutes: m.minutes,
    startedAt: m.startedAt,
    interviewer: m.claude,
    ...(m.claude || s.mode === 'exam' ? {} : { why: ready.why ?? 'Claude isn’t ready' }),
    ...(m.problem ? { problem: publicProblem(m.problem) } : {}),
    ...(m.design ? { design: { id: m.design.id, title: m.design.title, brief: m.design.brief } } : {}),
    ...(m.quant ? { quant: m.quant.map((q) => ({ id: q.id, kind: q.kind, prompt: q.prompt, target: q.target })) } : {}),
    ...(m.behavioural ? { behavioural: m.behavioural.map((q) => ({ id: q.id, prompt: q.prompt, followUp: q.followUp })) } : {}),
    ...(m.exam ? { exam: m.exam } : {})
  }
  return m.started
}

/** The window's work on a running mock, kept so it can move to another window */
export function keepMock(id: string, state: unknown): boolean {
  const m = live.get(id)
  const kept = keepableLive(state)
  if (!m || !kept) return false
  m.kept = kept
  return true
}

/** A running mock, for a window taking it over: what it started with and the work so far; null once it has ended */
export function resumeMock(id: string): { started: MockStarted; state: MockLiveState } | null {
  const m = live.get(id)
  if (!m?.started) return null
  return { started: m.started, state: m.kept ?? {} }
}

const need = (id: string): Live => {
  const m = live.get(id)
  if (!m) throw new Error('That mock has ended.')
  return m
}

const setupOf = (m: Live) => ({ mode: m.mode as Exclude<MockMode, 'exam'>, minutes: m.minutes, problem: m.problem, design: m.design, quant: m.quant, behavioural: m.behavioural })

export interface SayState {
  code?: string
  canvas?: Canvas
  notes?: string
  /** Quant or behavioural: the question on screen */
  question?: string
}

/**
 * One turn with the interviewer: what the candidate said (or a [start], [hint] or [time] cue) and
 * the state of their work. The reply streams to the window as mock:event and is returned whole.
 */
export async function say(owner: WebContents | null, id: string, text: string, st: SayState = {}, o: { hint?: boolean; check?: string } = {}): Promise<string> {
  const m = need(id)
  if (!m.claude) throw new Error('The interviewer needs Claude. This mock runs without one: work through it and it is marked in code.')
  if (m.busy) throw new Error('The interviewer is still answering.')
  const now = Date.now()
  const at = now - m.startedAt
  const cue = !text.startsWith('[') ? timeCue({ startedAt: m.startedAt, minutes: m.minutes }, now, m.told) : null
  if (cue) m.told.push(cue)
  const said = text.trim()
  const state: MomentState = {
    elapsedMin: at / 60_000,
    leftMin: m.minutes - at / 60_000,
    ...(st.code !== undefined ? { code: st.code } : {}),
    ...(st.canvas ? { canvas: st.canvas } : {}),
    ...(st.notes ? { notes: st.notes } : {}),
    ...(m.mode === 'coding' ? { tests: m.lastTests } : {}),
    ...(st.question ? { question: st.question } : {}),
    ...(o.check ? { check: o.check } : {})
  }
  const message = interviewerMessage(cue ? `${said}\n\n[time] ${cue} minutes left.` : said, state)
  const prompt = interviewerPrompt(m.transcript.map((t) => ({ role: t.role, text: t.hint ? `[hint] ${t.text}` : t.text })), message)
  if (!said.startsWith('[start]')) m.transcript.push({ role: 'candidate', text: said.replace(/^\[hint\]\s*/, '') || 'Can I have a hint?', at, ...(o.hint ? { hint: true } : {}) })
  const ctl = new AbortController()
  m.busy = ctl
  let reply = ''
  try {
    await withUsage({ job: 'mockInterviewer', lesson: `mock:${m.id}`, title: `Mock: ${m.title}` }, async () => {
      for await (const chunk of models.interview(prompt, interviewerSystem(setupOf(m)), AbortSignal.any([ctl.signal, AbortSignal.timeout(90_000)]))) {
        reply += chunk
        if (owner && !owner.isDestroyed()) owner.send('mock:event', { id, delta: chunk })
      }
    })
  } finally {
    m.busy = null
  }
  reply = reply.trim()
  if (reply) m.transcript.push({ role: 'interviewer', text: reply, at: Date.now() - m.startedAt })
  return reply
}

/** A hint: from the interviewer when there is one, else the bank's next hint. Either way it costs points */
export async function hint(owner: WebContents | null, id: string, st: SayState = {}): Promise<{ text: string; hints: number }> {
  const m = need(id)
  m.hints++
  if (m.claude) {
    const text = await say(owner, id, '[hint] Can I have a hint?', st, { hint: true })
    return { text, hints: m.hints }
  }
  const ladder = m.problem?.hints ?? m.design?.probes.map((p) => p.question) ?? []
  const text = ladder[Math.min(m.hints, ladder.length) - 1] ?? 'No more hints for this one.'
  m.transcript.push({ role: 'candidate', text: 'Can I have a hint?', at: Date.now() - m.startedAt, hint: true })
  m.transcript.push({ role: 'interviewer', text, at: Date.now() - m.startedAt })
  return { text, hints: m.hints }
}

/** The last line of a failure that says what went wrong (the assert, or the error) */
export function failureLine(message: string): string {
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean)
  const e = [...lines].reverse().find((l) => /^E\s|Error|assert/.test(l)) ?? lines[lines.length - 1] ?? ''
  return e.replace(/^E\s+/, '').slice(0, 200)
}

export interface TestOutcome {
  passed: string[]
  failed: { name: string; why: string }[]
  total: number
  error?: string
  stdout?: string
}

const readable = (name: string) => name.replace(/^test_?/, '').replace(/_/g, ' ')

/** Runs the candidate's code against the hidden tests in the sandbox: names and outcomes only */
export async function runHiddenTests(id: string, code: string, count = true): Promise<TestOutcome> {
  const m = need(id)
  if (!m.problem) throw new Error('This mock has no tests.')
  const total = [...m.problem.tests.matchAll(/^def\s+test\w*\s*\(/gm)].length
  if (count) m.runs++
  const r = await models.run(code, m.problem.tests)
  if (!r.tests) {
    const error = (r.stderr || r.stdout || 'The tests did not run.').trim().split('\n').slice(-6).join('\n').slice(0, 800)
    m.lastTests = { passed: 0, total, failed: ['(did not run)'] }
    return { passed: [], failed: [], total, error }
  }
  const out: TestOutcome = { passed: r.tests.passed.map(readable), failed: r.tests.failed.map((f) => ({ name: readable(f.name), why: failureLine(f.message) })), total }
  m.lastTests = { passed: out.passed.length, total, failed: out.failed.map((f) => f.name) }
  return out
}

/** A quant answer: checked in code, and with Claude the interviewer's follow-up */
export async function answerQuant(owner: WebContents | null, id: string, qid: string, text: string): Promise<{ followUp?: string }> {
  const m = need(id)
  const q = m.quant?.find((x) => x.id === qid)
  if (!q) throw new Error('No such question.')
  if (!m.claude) return {}
  const mk = markQuant(q, text)
  const check = q.kind === 'finance' ? `covers ${mk.covered?.length ?? 0} of ${q.points?.length ?? 0} key points` : q.kind === 'sizing' ? `${mk.verdict === 'right' ? 'within range' : mk.verdict === 'close' ? 'within an order of magnitude' : 'off by more than an order of magnitude'} (reference about ${q.answer})` : mk.verdict
  // Mental arithmetic moves on without a follow-up: speed is the point
  if (q.kind === 'mental') {
    m.transcript.push({ role: 'candidate', text: `${q.prompt} → ${text}`, at: Date.now() - m.startedAt })
    return {}
  }
  const followUp = await say(owner, id, text, { question: q.prompt }, { check })
  return { followUp }
}

export function cancelMock(id: string) {
  const m = live.get(id)
  m?.busy?.abort()
  live.delete(id)
}

export function stopSaying(id: string) {
  live.get(id)?.busy?.abort()
}

// ---------- The end: marking and the debrief ----------

const transcriptText = (m: Live) => m.transcript.filter((t) => t.role === 'candidate' && !t.hint).map((t) => t.text)

async function opusMarks(m: Live, material: string, facts: string[], work: string): Promise<MockDebrief | null> {
  if (!m.claude || m.mode === 'exam') return null
  const rubric = rubricFor(m.mode)
  const prompt = markerPrompt({ mode: m.mode, title: m.title, rubric, material, facts, transcript: m.transcript, work, minutes: m.minutes })
  try {
    const out = await withUsage({ job: 'mockMark', lesson: `mock:${m.id}`, title: `Mock: ${m.title}` }, () => models.mark(prompt, MARKER_SYSTEM, AbortSignal.timeout(240_000)))
    const parsed = parseMockMarks(out, rubric)
    return parsed ? { ...parsed, by: 'opus' } : null
  } catch (e) {
    console.warn('[mocks] marking failed, marking in code', (e as Error).message)
    return null
  }
}

/** Opus may not score above what the facts allow: the tests passed, and the hints taken */
export function holdToFacts(d: MockDebrief, f: { share?: number; hints?: number }): MockDebrief {
  const scores = d.scores.map((s) => {
    if (s.score === null) return s
    if (s.id === 'problem' && f.share !== undefined) return { ...s, score: Math.min(s.score, half(Math.ceil(f.share * 8) / 2)) }
    if (s.id === 'hints' && f.hints !== undefined) return { ...s, score: Math.min(s.score, half(4 - 1.5 * f.hints)) }
    return s
  })
  const overall = overallOf(scores)
  return { ...d, scores, overall, verdict: d.verdict ?? verdictFor(overall) }
}

export async function endMock(id: string, input: MockEndInput): Promise<{ debrief: MockDebrief; record: MockRecord; fed: MockFed; canvas?: Canvas }> {
  const m = need(id)
  m.busy?.abort()
  const usedMs = Math.min(Date.now() - m.startedAt, m.minutes * 60_000 + 60_000)
  let debrief: MockDebrief
  const graded: { question: string; answer: string; score: number; note: string; hints?: number }[] = []

  if (m.mode === 'coding' && m.problem) {
    const code = input.code ?? ''
    const t = code.trim() ? await runHiddenTests(id, code, false).catch(() => null) : null
    const passed = t?.passed.length ?? 0
    const total = t?.total ?? [...m.problem.tests.matchAll(/^def\s+test/gm)].length
    const facts = { problem: m.problem, code, passed, total, failed: t?.failed.map((f) => f.name) ?? [], runs: m.runs, hints: m.hints, said: transcriptText(m) }
    const byCode = markCodingInCode(facts)
    const opus = await opusMarks(
      m,
      `${m.problem.title}: ${m.problem.prompt}\nExamples: ${m.problem.examples.join('; ')}\nReference solution:\n${m.problem.reference}\nExpected: ${m.problem.complexity.time} time, ${m.problem.complexity.space} space.`,
      [`Hidden tests at the end: ${passed} of ${total} passed${facts.failed.length ? ` (failing: ${facts.failed.join(', ')})` : ''}.`, `They ran the hidden tests ${m.runs} time(s) during the interview.`, `Hints taken: ${m.hints} of ${m.problem.hints.length}.`, `Time used: ${Math.round(usedMs / 60_000)} of ${m.minutes} minutes.`],
      `\`\`\`python\n${code}\n\`\`\``
    )
    debrief = opus ? holdToFacts({ ...opus, modelAnswer: opus.modelAnswer || byCode.modelAnswer }, { share: total ? passed / total : 0, hints: m.hints }) : byCode
    graded.push({ question: `${m.problem.title}: ${m.problem.prompt}`, answer: code, score: total ? passed / total : 0, note: `${passed} of ${total} hidden tests passed.`, hints: m.hints })
  } else if (m.mode === 'design' && m.design) {
    const canvas = input.canvas ?? { nodes: [], edges: [] }
    const byCode = markDesignInCode(m.design, canvas, input.notes ?? '', transcriptText(m))
    const opus = await opusMarks(
      m,
      `${m.design.title}: ${m.design.brief}\nWhat a strong answer covers: ${m.design.checklist.map((c) => `[${c.area}] ${c.point}`).join('; ')}\nA reference answer:\n${m.design.modelAnswer}`,
      [`Checklist points found in their canvas, notes and messages: ${byCode.scores.filter((s) => s.score !== null).map((s) => `${s.id} ${s.note.split('.')[0]}`).join('; ')}.`, `Time used: ${Math.round(usedMs / 60_000)} of ${m.minutes} minutes.`],
      `Canvas:\n${describeCanvas(canvas)}\n\nTheir notes:\n${(input.notes ?? '').trim() || '(none)'}`
    )
    debrief = opus ? { ...opus, modelAnswer: opus.modelAnswer || m.design.modelAnswer } : byCode
    graded.push({ question: `${m.design.title}: ${m.design.brief}`, answer: `${describeCanvas(canvas)}\n${input.notes ?? ''}`, score: debrief.overall, note: debrief.summary })
  } else if (m.mode === 'quant' && m.quant) {
    const answers = input.answers ?? []
    const byCode = markQuantInCode(m.quant, answers)
    const got = new Map(answers.map((a) => [a.id, a]))
    const checks = m.quant.map((q, i) => {
      const a = got.get(q.id)
      const mk = markQuant(q, a?.text ?? '')
      return `${i + 1}. [${q.kind}] ${q.prompt} | answer: ${(a?.text ?? '').trim() || '(none)'} | ${Math.round((a?.ms ?? 0) / 1000)} s | Tide's check: ${mk.verdict}`
    })
    const opus = await opusMarks(m, m.quant.map((q, i) => `${i + 1}. ${q.prompt} — ${q.solution}`).join('\n'), checks, answers.map((a) => `${a.id}: ${a.text}`).join('\n'))
    debrief = opus ? { ...opus, modelAnswer: opus.modelAnswer || byCode.modelAnswer } : byCode
    for (const q of m.quant) {
      const a = got.get(q.id)
      const mk = markQuant(q, a?.text ?? '')
      graded.push({ question: q.prompt, answer: a?.text ?? '', score: mk.score, note: q.solution })
    }
  } else if (m.mode === 'behavioural' && m.behavioural) {
    const answers = input.answers ?? []
    const byCode = markBehaviouralInCode(m.behavioural, answers)
    const opus = await opusMarks(m, m.behavioural.map((q, i) => `${i + 1}. ${q.prompt} (listening for: ${q.probes})`).join('\n'), [`Time used: ${Math.round(usedMs / 60_000)} of ${m.minutes} minutes.`], answers.map((a) => `${a.id}: ${a.text}`).join('\n\n'))
    debrief = opus ? { ...opus, modelAnswer: opus.modelAnswer || byCode.modelAnswer } : byCode
    for (const q of m.behavioural) graded.push({ question: q.prompt, answer: answers.filter((a) => a.id.split(':')[0] === q.id).map((a) => a.text).join('\n'), score: debrief.overall, note: debrief.summary })
  } else if (m.mode === 'exam' && m.exam) {
    const marks = input.examMarks ?? {}
    debrief = examDebrief(m.exam, marks)
    const answers = new Map((input.answers ?? []).map((a) => [a.id, a.text]))
    m.exam.questions.forEach((q) =>
      q.parts.forEach((p, i) => {
        const mk = marks[`${q.number}:${i}`]
        if (mk) graded.push({ question: `${q.text ? `${q.text}\n` : ''}(${p.label}) ${p.text}`, answer: answers.get(`${q.number}:${i}`) ?? '', score: mk.marks ? mk.awarded / mk.marks : 0, note: mk.feedback })
      })
    )
  } else throw new Error('This mock has nothing to mark.')

  const at = Date.now()
  const ref = m.problem?.id ?? m.design?.id ?? m.behavioural?.map((q) => q.id).join(',')
  const record = recordOf({ id: m.id, at, mode: m.mode, title: m.title, minutes: m.minutes, usedMs, debrief, hints: m.hints, ref })
  const fed = await feed(m, debrief, record, graded, input).catch((e) => {
    console.warn('[mocks] feeding the debrief failed', (e as Error).message)
    return { roadmap: 0, recall: 0, profile: 0, lesson: false }
  })
  live.delete(id)
  return { debrief, record, fed }
}

/** The debrief, fed on: history, the full record, profile, recall, the roadmap note, the knowledge map, the lesson record */
async function feed(m: Live, debrief: MockDebrief, record: MockRecord, graded: { question: string; answer: string; score: number; note: string; hints?: number }[], input: MockEndInput): Promise<MockFed> {
  await fs.mkdir(absPath('.tide/mocks'), { recursive: true })
  await fs.appendFile(absPath(HISTORY), JSON.stringify(record) + '\n')
  // The mock's result in the learning event log; each marked item goes in on its topic through the knowledge map below
  await Promise.all([import('@shared/learningEvents'), import('./learningLog')]).then(([{ mockEvent }, { learningEvent }]) => learningEvent({ ...mockEvent(record, 'mock'), ...(m.exam?.topic ? { topic: m.exam.topic } : {}) })).catch(() => {})
  await writeText(recordFile(m.id), JSON.stringify({ record, debrief, transcript: m.transcript, problem: m.problem?.id, design: m.design?.id, canvas: input.canvas, code: input.code, notes: input.notes, answers: input.answers?.map((a) => ({ ...a, images: undefined })), quant: m.quant?.map((q) => q.id), exam: m.exam ? { title: m.exam.title, topic: m.exam.topic } : undefined }))
  const fed: MockFed = { roadmap: 0, recall: 0, profile: 0, lesson: false }
  const rubric = rubricFor(m.mode, m.exam)
  const from = `${modeInfo(m.mode).short} mock: ${m.title}`

  // The learner profile: small changes from the scores, by code
  try {
    const { noteMock } = await import('./learnerProfile')
    fed.profile = (await noteMock(profileOps({ mode: m.mode, title: m.title, debrief, rubric, hints: m.hints, at: record.at }), from)).length
  } catch (e) {
    console.warn('[mocks] profile', (e as Error).message)
  }

  // Recall: what was missed comes back as the opening question of a later lesson on its topic
  const quant = m.quant?.map((q) => ({ q, right: markQuant(q, input.answers?.find((a) => a.id === q.id)?.text ?? '').verdict === 'right' }))
  const examMissed = m.exam
    ? m.exam.questions.flatMap((q) => q.parts.flatMap((p, i) => {
        const mk = input.examMarks?.[`${q.number}:${i}`]
        return mk && mk.awarded < mk.marks ? [`${p.text}`.slice(0, 300)] : []
      }))
    : undefined
  const recall = recallFrom({ mode: m.mode, title: m.title, debrief, problem: m.problem, design: m.design, quant, ...(m.exam ? { exam: { topic: m.exam.topic, missed: examMissed ?? [] } } : {}) })
  if (recall.length) {
    try {
      const { keepForRecall } = await import('./recall')
      await keepForRecall(recall.map((r) => ({ ...r, lesson: `mock-${m.id}` })))
      fed.recall = recall.length
    } catch (e) {
      console.warn('[mocks] recall', (e as Error).message)
    }
  }

  // The practice roadmap: what to practise next, as a checklist
  if (debrief.practise.length) {
    const before = await readText(ROADMAP_NOTE).catch(() => '')
    const date = new Date(record.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const after = mergeRoadmap(before, modeInfo(m.mode).label, debrief.practise, `${m.title}, ${date}`)
    if (after !== before) {
      await writeText(ROADMAP_NOTE, after)
      fed.roadmap = (after.match(/^- \[ \]/gm) ?? []).length - (before.match(/^- \[ \]/gm) ?? []).length
    }
  }

  // The knowledge map: each marked item on its topic
  try {
    const { noteEvidence } = await import('./knowledge')
    const topic = (i: number) => (m.problem ? (m.problem.tags[0] === 'dp' ? 'Dynamic programming' : m.problem.tags[0] === 'graphs' ? 'Graph algorithms' : m.problem.title) : m.design ? 'System design' : m.quant ? QUANT_TOPIC[m.quant[i]?.kind ?? 'mental'] : m.exam ? m.exam.topic : '')
    for (const [i, g] of graded.entries()) {
      const t = topic(i)
      if (!t || m.mode === 'behavioural') continue
      await noteEvidence({ topic: t, kind: g.score >= 0.8 ? 'right' : g.score >= 0.4 ? 'partly' : 'wrong', source: `mock:${m.id}`, pos: `q${i}`, at: record.at })
    }
  } catch (e) {
    console.warn('[mocks] knowledge', (e as Error).message)
  }

  // The lesson record: the teaching measures (answers, hints) and the profile's lesson reading take it from there
  try {
    const { saveLesson } = await import('./lessons')
    const r = await saveLesson(mockLesson({ id: `mock-${m.id}`, mode: m.mode, title: m.title, started: m.startedAt, transcript: m.transcript, graded }))
    fed.lesson = !!r
  } catch (e) {
    console.warn('[mocks] lesson', (e as Error).message)
  }
  return fed
}

// ---------- Wiring ----------

export function registerMocks() {
  ipcMain.handle('mocks:status', () => mockStatus())
  ipcMain.handle('mocks:bank', () => bankIndex())
  ipcMain.handle('mocks:start', (_e, s: MockSetup) => startMock(s))
  ipcMain.handle('mocks:say', (e, id: string, text: string, st: SayState) => say(e.sender, String(id), String(text ?? '').slice(0, 8000), st ?? {}))
  ipcMain.handle('mocks:hint', (e, id: string, st: SayState) => hint(e.sender, String(id), st ?? {}))
  ipcMain.handle('mocks:test', (_e, id: string, code: string) => runHiddenTests(String(id), String(code ?? '')))
  ipcMain.handle('mocks:answer', (e, id: string, qid: string, text: string) => answerQuant(e.sender, String(id), String(qid), String(text ?? '').slice(0, 4000)))
  ipcMain.handle('mocks:end', (_e, id: string, input: MockEndInput) => endMock(String(id), input ?? {}))
  ipcMain.handle('mocks:cancel', (_e, id: string) => cancelMock(String(id)))
  ipcMain.handle('mocks:stop', (_e, id: string) => stopSaying(String(id)))
  ipcMain.handle('mocks:history', () => mockHistory())
  ipcMain.handle('mocks:record', (_e, id: string) => mockRecord(String(id)))
  ipcMain.handle('mocks:examTopics', () => suggestExamTopics())
  ipcMain.handle('mocks:keep', (_e, id: string, state: unknown) => keepMock(String(id), state))
  ipcMain.handle('mocks:resume', (_e, id: string) => resumeMock(String(id)))
}

/** For the renderer's bank picker (titles and tags only) */
export const bankIndex = () => BANK.map((p) => ({ id: p.id, title: p.title, tags: p.tags, level: p.level }))
