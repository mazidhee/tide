/**
 * Claude teaching in Tide. One Claude Code process per lesson or conversation, kept running so
 * each turn sends only the new message and the lesson stays in the plan's prompt cache; stopped
 * after a while idle, and started again (with the transcript so far) if it died. Tide is its
 * hands through MCP (main/tideMcp). Text streams into the same events Gemma's answers use, and
 * Tide's tool calls show as the same steps.
 *
 * Models (shared/claude): ordinary turns on the lesson's model (Sonnet by default); a turn that
 * plans a lesson, checks maths or is asked to go deep switches the same process to the "hard"
 * model for that turn; an answer to a question is first marked by a short separate call on the
 * marking model (Opus), whose verdict the tutor writes into its grade.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { app } from 'electron'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'
import { createHash } from 'crypto'
import type { AgentStep, ChatEvent, ChatMessage, ClaudeModel, ClaudeRole } from '@shared/types'
import { claudeModel, claudeLabel, asksForDepth, rank } from '@shared/claude'
import { checkClaude, childEnv, claudeArgs, findClaude, mcpConfig, parseLine, unavailableReason, userLine, type ClaudeEvent, type ClaudeStatus, type ClaudeUsage } from './claudeCli'
import { getSettings } from './settings'
import type { TurnRequest, ToolContext } from './agent'

/** Claude can't take this turn: Gemma does, and the step says why */
export class ClaudeUnavailable extends Error {}

// ---------- Status ----------

let status: ClaudeStatus | null = null
let checking: Promise<ClaudeStatus> | null = null
/** Until when the plan said no (a limit hit), ms */
let limitedUntil = 0
let lastLimit: { status: string; utilization?: number; window?: string; resetsAt?: number } | null = null

export async function claudeStatus(fresh = false): Promise<ClaudeStatus & { limitedUntil?: number; limit?: typeof lastLimit }> {
  const stale = !status || Date.now() - status.checkedAt > (status.loggedIn ? 10 * 60_000 : 30_000)
  if (fresh || stale) {
    const cmd = command()
    checking ??= (cmd ? checkClaude(cmd) : Promise.resolve<ClaudeStatus>({ installed: false, loggedIn: false, checkedAt: Date.now() })).finally(() => (checking = null))
    if (fresh || !status) status = await checking
    else void checking.then((s) => (status = s))
  }
  return { ...status!, ...(limitedUntil > Date.now() ? { limitedUntil } : {}), limit: lastLimit }
}

/** Runs the user's Claude Code with these arguments (claude mcp add/remove) and returns what it printed */
export function runClaude(args: string[]): Promise<string> {
  const cmd = command()
  if (!cmd) return Promise.reject(new Error('Claude Code isn’t installed'))
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: childEnv(), cwd: app.getPath('home'), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(out.trim() || `claude exited with ${code}`))))
  })
}

/** Forget a limit the plan reported (Check again in Settings: the learner may know it has reset; the next refusal sets it again) */
export const forgetLimit = () => (limitedUntil = 0)

/** Installed without asking it anything (a file check), for routing decisions that can't wait */
export const claudeInstalled = () => !!command()

export async function claudeReady(): Promise<{ installed: boolean; ready: boolean; why?: string }> {
  const s = await claudeStatus()
  if (!s.installed) return { installed: false, ready: false, why: 'not installed' }
  if (!s.loggedIn) return { installed: true, ready: false, why: s.error ?? 'not logged in: run claude in a terminal and log in' }
  if (limitedUntil > Date.now()) return { installed: true, ready: false, why: `at your plan’s limit until ${new Date(limitedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` }
  return { installed: true, ready: true }
}

// ---------- Usage ----------

export interface UsageRecord extends ClaudeUsage {
  at: number
  model: string
  role: ClaudeRole
  ms: number
  firstTokenMs?: number
}

const usageFile = () => join(app.getPath('userData'), 'claude-usage.jsonl')

function recordUse(r: UsageRecord) {
  try {
    appendFileSync(usageFile(), JSON.stringify(r) + '\n')
  } catch {
    // usage is a nicety
  }
}

export function readClaudeUsage(since: number): UsageRecord[] {
  try {
    return readFileSync(usageFile(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as UsageRecord)
      .filter((r) => r.at >= since)
  } catch {
    return []
  }
}

// ---------- Processes ----------

const IDLE_MS = 20 * 60_000
/** Claude Code's own web tools, offered to lessons that aren't private and have Web on */
export const CLAUDE_WEB_TOOLS = ['WebSearch', 'WebFetch']
/** Each process takes a few hundred MB: the Mac also holds Gemma */
const MAX_LIVE = 3

interface TurnSink {
  onEvent(e: ClaudeEvent): void
  resolve(r: Extract<ClaudeEvent, { type: 'result' }>): void
  reject(e: Error): void
}

/** The command a process runs: the real claude, or (in tests) a stand-in */
// Tests never reach the real one by accident: they set a stand-in
let command = (): string | null => (process.env.VITEST ? null : findClaude(getSettings().ai.claude?.path))
export const setClaudeCommand = (fn: () => string | null) => (command = fn)

export class ClaudeProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private sink: TurnSink | null = null
  private idle: ReturnType<typeof setTimeout> | undefined
  model: ClaudeModel | string
  /** User messages this process has been sent, and the first one's fingerprint */
  turns = 0
  first = ''
  lastUsed = Date.now()
  stderr = ''
  /** The CLI reports the process's cost so far; a turn's is the difference */
  costSoFar = 0

  /** The lesson key its MCP config names, for tool calls' steps; stays the same if the process is adopted under another key */
  readonly binding: string

  constructor(
    public key: string,
    model: ClaudeModel | string,
    private readonly system: string,
    private readonly configFile: string,
    private readonly builtIn: string[] = []
  ) {
    this.model = model
    this.binding = key
  }

  get alive() {
    return !!this.child && this.child.exitCode === null && !this.child.killed
  }

  private start() {
    const cmd = command()
    if (!cmd) throw new ClaudeUnavailable('Claude Code isn’t installed')
    const cwd = join(app.getPath('userData'), 'claude')
    mkdirSync(cwd, { recursive: true })
    const child = spawn(cmd, claudeArgs({ model: this.model, system: this.system, mcpConfig: this.configFile, builtIn: this.builtIn }), { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.stderr = ''
    child.stderr.on('data', (d) => (this.stderr = (this.stderr + String(d)).slice(-2000)))
    createInterface({ input: child.stdout }).on('line', (line) => {
      const e = parseLine(line)
      if (!e || !this.sink) return
      if (e.type === 'result') {
        const s = this.sink
        this.sink = null
        s.resolve(e)
      } else this.sink.onEvent(e)
    })
    child.on('error', (err) => this.child === child && this.fail(new ClaudeUnavailable(`Claude Code didn’t start: ${err.message}`)))
    child.on('exit', (code) => {
      // A process stopped on purpose (replaced, cancelled, idle) has no turn to fail
      if (this.child !== child) return
      this.child = null
      this.fail(new Error(this.stderr.trim().split('\n').pop() || `Claude Code stopped (exit ${code})`))
    })
  }

  private fail(e: Error) {
    const s = this.sink
    this.sink = null
    s?.reject(e)
  }

  /** Sends one message and resolves with the turn's result; events stream to onEvent meanwhile */
  /**
   * `cut` ends the turn early without losing the process: Claude is interrupted, keeps what it
   * wrote so far, and the turn resolves as done (Tide takes over from there, as source-led
   * teaching does when a plan's first step opens with a reading).
   */
  turn(content: string | unknown[], model: ClaudeModel | string, onEvent: (e: ClaudeEvent) => void, signal: AbortSignal, cut?: AbortSignal): Promise<Extract<ClaudeEvent, { type: 'result' }>> {
    if (this.sink) return Promise.reject(new Error('Claude is still answering the last message'))
    if (!this.alive) {
      this.model = model
      this.turns = 0
      this.costSoFar = 0
      this.start()
    }
    clearTimeout(this.idle)
    this.lastUsed = Date.now()
    return new Promise((resolve, reject) => {
      const stop = () => {
        // A cancelled turn can't be taken back mid-answer: the process goes, and the next turn starts a fresh one
        this.stop()
        reject(new DOMException('Cancelled', 'AbortError'))
      }
      if (signal.aborted) return stop()
      signal.addEventListener('abort', stop, { once: true })
      let interrupted = false
      const interrupt = () => {
        if (interrupted || !this.child) return
        interrupted = true
        this.child.stdin.write(JSON.stringify({ type: 'control_request', request_id: `i${Date.now()}`, request: { subtype: 'interrupt' } }) + '\n')
      }
      if (cut?.aborted) interrupt()
      cut?.addEventListener('abort', interrupt, { once: true })
      const done = () => {
        signal.removeEventListener('abort', stop)
        cut?.removeEventListener('abort', interrupt)
        this.lastUsed = Date.now()
        clearTimeout(this.idle)
        this.idle = setTimeout(() => this.stop(), IDLE_MS)
      }
      this.sink = {
        onEvent,
        // Interrupted on purpose: the CLI reports an error, but the turn ended as Tide wanted
        resolve: (r) => (done(), resolve(interrupted && !r.ok ? { ...r, ok: true, error: undefined } : r)),
        reject: (e) => (done(), reject(e))
      }
      if (model !== this.model) {
        this.child!.stdin.write(JSON.stringify({ type: 'control_request', request_id: `m${Date.now()}`, request: { subtype: 'set_model', model } }) + '\n')
        this.model = model
      }
      this.child!.stdin.write(userLine(content))
    })
  }

  /** Starts the process ahead of its first message (Claude Code loads and connects to Tide's tools), at no cost in tokens */
  warm(forMs = 10 * 60_000) {
    if (!this.alive) {
      this.turns = 0
      this.costSoFar = 0
      this.start()
    }
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.stop(), forMs)
  }

  stop() {
    clearTimeout(this.idle)
    const c = this.child
    this.child = null
    if (c && c.exitCode === null) {
      c.stdin.end()
      c.kill('SIGTERM')
      setTimeout(() => c.exitCode === null && c.kill('SIGKILL'), 3000).unref?.()
    }
    this.fail(new Error('Claude was stopped'))
  }
}

const live = new Map<string, ClaudeProcess>()

export function stopClaude(key?: string) {
  for (const [k, p] of live) {
    if (key && k !== key) continue
    p.stop()
    live.delete(k)
  }
}

/** Live processes, for the usage view and tests */
export const liveClaude = () => [...live.values()].filter((p) => p.alive).map((p) => ({ key: p.key, model: p.model, turns: p.turns, lastUsed: p.lastUsed }))

function processFor(key: string, model: string, system: string, config: string, builtIn: string[]): ClaudeProcess {
  let p = live.get(key)
  if (!p) {
    // Room for one more: the one used longest ago goes
    const running = [...live.values()].filter((x) => x.alive)
    if (running.length >= MAX_LIVE) {
      const oldest = running.sort((a, b) => a.lastUsed - b.lastUsed)[0]
      oldest.stop()
      live.delete(oldest.key)
    }
    p = new ClaudeProcess(key, model, system, config, builtIn)
    live.set(key, p)
  }
  return p
}

/** A process started before its lesson is known (main/agent prewarmLesson), by its system prompt and web tools */
const poolKey = (system: string, web: boolean) => `pool:${fp(system)}:${web ? 'web' : 'noweb'}`

/** A process started ahead for this prompt, taken over by the lesson that's starting */
function adopt(system: string, web: boolean, key: string): ClaudeProcess | null {
  const pk = poolKey(system, web)
  const p = live.get(pk)
  if (!p || !p.alive || p.turns > 0) return null
  live.delete(pk)
  p.key = key
  live.set(key, p)
  return p
}

/**
 * When a lesson is about to open (Home's next topic, the Learn page's plan, a note's "Teach me"),
 * Claude Code is started for it with the prompt that lesson will have, so the first answer doesn't
 * also wait for the process to load and reach Tide's tools. No message is sent: it costs nothing.
 */
export async function prewarmClaude(req: Omit<TurnRequest, 'id'>): Promise<void> {
  const { teacherFor } = await import('./teacher')
  if ((await teacherFor({ ...req, id: 'prewarm' }).catch(() => null))?.who !== 'claude') return
  const { stablePrompt } = await import('./agent')
  const { CLAUDE_LESSON_SYSTEM, CLAUDE_TUTOR_SYSTEM, CLAUDE_WEB_NOTE } = await import('@shared/tutorPrompt')
  const web = req.web !== false
  const { forClaude } = await import('@shared/exercises')
  const system = forClaude(await stablePrompt(req.session ? CLAUDE_LESSON_SYSTEM : CLAUDE_TUTOR_SYSTEM, { ...req, id: 'prewarm' }, web, !!req.session)) + (web ? `\n\n${CLAUDE_WEB_NOTE}` : '')
  const pk = poolKey(system, web)
  if (live.get(pk)?.alive) return
  // One waiting at a time
  for (const [k, p] of live) if (k.startsWith('pool:')) (p.stop(), live.delete(k))
  const { ensureMcp } = await import('./tideMcp')
  const mcp = await ensureMcp()
  const settings = getSettings().ai.claude
  const opening = req.session && req.instructions ? claudeModel('hard', settings) : claudeModel('teach', settings, req.claudeModel)
  processFor(pk, opening, system, configFor(pk, mcp.port, mcp.token), web ? CLAUDE_WEB_TOOLS : []).warm()
}

// ---------- A turn ----------

export const fp = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)
const text = (c: ChatMessage['content'] | unknown) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? '').join('\n') : String(c ?? ''))

/** Which lesson or conversation a turn belongs to: the process it goes to */
export function lessonKey(req: Pick<TurnRequest, 'chatId' | 'labId' | 'messages' | 'session'>): string {
  if (req.chatId) return `chat:${req.chatId}`
  if (req.labId) return `lab:${req.labId}`
  return `first:${fp(text(req.messages.find((m) => m.role === 'user')?.content))}`
}

/**
 * What to send: the new message alone when the process already holds everything before it,
 * otherwise (a new process, or the history changed under it) the transcript so far with it.
 */
export function messageToSend(history: { role: string; content: unknown }[], p: { turns: number; first: string; alive: boolean }): { content: string; fresh: boolean } {
  const users = history.filter((m) => m.role === 'user')
  const last = text(history[history.length - 1]?.content)
  const first = fp(text(users[0]?.content))
  if (p.alive && p.first === first && p.turns === users.length - 1) return { content: last, fresh: false }
  if (history.length <= 1) return { content: last, fresh: true }
  const before = history
    .slice(0, -1)
    .map((m) => `${m.role === 'user' ? '[Student]' : '[You, the tutor]'}\n${text(m.content)}`)
    .join('\n\n')
  return { content: `This conversation was already under way; here it is so far:\n\n${before}\n\n---\n\nThe student's new message:\n\n${last}`, fresh: true }
}

/** What role this turn's model has: planning a lesson, maths, or asked to go deep → the "hard" model */
export function turnRole(req: TurnRequest, said: string, job: string | null): ClaudeRole {
  const users = req.messages.filter((m) => m.role === 'user').length
  if (req.session && req.instructions && users <= 1) return 'hard'
  if (asksForDepth(said)) return 'hard'
  // An answer is marked by the marking model in its own short call: the lesson goes on in the teaching model
  if (isAnswer(req, said)) return 'teach'
  if (job === 'maths' || job === 'errors' || job === 'planning') return 'hard'
  return 'teach'
}

/** The student is answering the question the tutor's last message asked */
export function isAnswer(req: TurnRequest, said: string): boolean {
  if (!req.session) return false
  const prev = [...req.messages].reverse().find((m) => m.role === 'assistant')
  if (!prev || !/<ask\b/i.test(text(prev.content))) return false
  return !/^\s*(\[hint\]|my question:|(i (don'?t|do not) know|go on|continue|skip)\b)/i.test(said)
}

const MARK_SYSTEM = `You mark one answer a student gave in a lesson, for their tutor. Grade against the tutor's own solution when there is one (it is inside <solution>; the student never saw it). "correct" means complete and right, not just heading the right way; a right answer with wrong or missing reasoning is "partial". An equivalent method or ordering is not a mistake. Quote the words of their answer that earned the verdict. A code answer may come with what Tide's sandbox found when it ran their code against the question's hidden tests (the tests are in the \`\`\`tests block of the question; the results read "N of M tests passed" with each FAILED test and why): it can't be "correct" unless every test passed, and for each failed test say what that test tried and the exact line or idea in their code that makes it fail. A note from Tide on an exact check of their final answer or query is a fact: follow it. Reply with JSON only: {"verdict": "correct" | "partial" | "wrong", "score": 0.0 to 1.0, "why": "one or two sentences: what was right and why, or the exact step that's wrong and why"}.`

/**
 * One call, no tools and no conversation: the whole prompt in, one reply out. For marking, lesson
 * plans and roadmaps, and background jobs. Throws ClaudeUnavailable when Claude can't take it.
 */
export async function claudeOnce(prompt: string, system: string, role: ClaudeRole, signal?: AbortSignal, model: string = claudeModel(role, getSettings().ai.claude)): Promise<{ text: string; usage: ClaudeUsage; ms: number; model: string }> {
  const cmd = command()
  if (!cmd) throw new ClaudeUnavailable('Claude Code isn’t installed')
  const t0 = Date.now()
  const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk', '--system-prompt', system]
  const cwd = join(app.getPath('userData'), 'claude')
  mkdirSync(cwd, { recursive: true })
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''
    let err = ''
    child.stdout.on('data', (d) => (buf += String(d)))
    child.stderr.on('data', (d) => (err = (err + String(d)).slice(-1000)))
    child.on('error', (e) => reject(new ClaudeUnavailable(`Claude Code didn’t start: ${e.message}`)))
    child.on('exit', () => (buf.trim() ? resolve(buf) : reject(unavailableReason(err) ? new ClaudeUnavailable(err.trim().split('\n').pop() ?? 'unavailable') : new Error(err.trim() || 'Claude gave no answer'))))
    signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })
    child.stdin.end(prompt)
  })
  const r = parseLine(out.trim().split('\n').pop() ?? '')
  if (!r || r.type !== 'result') throw new Error('Claude gave no answer')
  recordUse({ ...r.usage, at: Date.now(), model: r.model ?? model, role, ms: Date.now() - t0, firstTokenMs: r.firstTokenMs })
  if (!r.ok) {
    const why = unavailableReason(r.error ?? '')
    if (why === 'limit') limitedUntil = Math.max(limitedUntil, Date.now() + 15 * 60_000)
    throw why ? new ClaudeUnavailable(why === 'login' ? 'not logged in' : 'at your plan’s limit') : new Error(r.error ?? 'Claude stopped')
  }
  return { text: r.text, usage: r.usage, ms: Date.now() - t0, model: r.model ?? model }
}

/**
 * One call streamed as it's written: no tools, no conversation. For long drafts (a roadmap's
 * outline) where the learner watches it appear. Throws ClaudeUnavailable before any text when
 * Claude can't take it.
 */
export async function* claudeStream(prompt: string, system: string, role: ClaudeRole, signal?: AbortSignal, model: string = claudeModel(role, getSettings().ai.claude)): AsyncGenerator<string> {
  const cmd = command()
  if (!cmd) throw new ClaudeUnavailable('Claude Code isn’t installed')
  const t0 = Date.now()
  const args = ['-p', '--model', model, '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk', '--system-prompt', system]
  const cwd = join(app.getPath('userData'), 'claude')
  mkdirSync(cwd, { recursive: true })
  const child = spawn(cmd, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
  const kill = () => child.kill('SIGTERM')
  signal?.addEventListener('abort', kill, { once: true })
  let err = ''
  child.stderr.on('data', (d) => (err = (err + String(d)).slice(-1000)))
  const lines = createInterface({ input: child.stdout })
  const exited = new Promise<void>((r) => child.on('close', () => r()))
  child.on('error', () => {})
  child.stdin.end(prompt)
  let first = 0
  let result: Extract<ClaudeEvent, { type: 'result' }> | null = null
  try {
    for await (const line of lines) {
      const e = parseLine(line)
      if (!e) continue
      if (e.type === 'text' && e.text) {
        first ||= Date.now()
        yield e.text
      } else if (e.type === 'rate-limit') {
        lastLimit = { status: e.status, utilization: e.utilization, window: e.window, resetsAt: e.resetsAt }
        if (e.status === 'rejected' && e.resetsAt) limitedUntil = e.resetsAt * 1000
      } else if (e.type === 'result') result = e
    }
  } finally {
    signal?.removeEventListener('abort', kill)
    if (child.exitCode === null) kill()
  }
  await exited
  if (signal?.aborted) return
  if (!result) throw unavailableReason(err) ? new ClaudeUnavailable(err.trim().split('\n').pop() ?? 'unavailable') : new Error(err.trim() || 'Claude gave no answer')
  recordUse({ ...result.usage, at: Date.now(), model: result.model ?? model, role, ms: Date.now() - t0, firstTokenMs: first ? first - t0 : undefined })
  if (!result.ok) {
    const why = unavailableReason(result.error ?? '')
    if (why === 'limit') limitedUntil = Math.max(limitedUntil, Date.now() + 15 * 60_000)
    throw why ? new ClaudeUnavailable(why === 'login' ? 'not logged in' : 'at your plan’s limit') : new Error(result.error ?? 'Claude stopped')
  }
}

/** Claude teaches (the setting, with Claude Code set up and not at its limit): for work with nothing private in it */
export async function claudeTeaches(): Promise<boolean> {
  const { chooseTeacher } = await import('./teacher')
  const r = await claudeReady()
  return chooseTeacher({ setting: getSettings().ai.claude?.teacher, installed: r.installed, ready: r.ready, notReady: r.why, private: false }).who === 'claude'
}

/**
 * A draft streamed by Claude on the given role's model when Claude teaches, else by `fallback`
 * (Gemma's streamDraft). Gemma also takes over if Claude can't before writing anything.
 * Only for prompts with nothing private in them.
 */
export async function* draftWithClaude(system: string, user: string, role: ClaudeRole, signal: AbortSignal, fallback: () => AsyncGenerator<string>, isPrivate = false): AsyncGenerator<string> {
  if (isPrivate || !(await claudeTeaches())) return yield* fallback()
  let any = false
  try {
    for await (const t of claudeStream(user, system, role, signal)) {
      any = true
      yield t
    }
  } catch (e) {
    if (any || !(e instanceof ClaudeUnavailable)) throw e
    yield* fallback()
  }
}

/** A one-shot job on Claude's background model (Haiku) when Claude teaches and the job is not private; null to leave it to Gemma */
export async function backgroundOnClaude(prompt: string, system: string | undefined, signal?: AbortSignal, isPrivate = false): Promise<string | null> {
  if (isPrivate || !(await claudeTeaches())) return null
  try {
    return (await claudeOnce(prompt, system ?? 'You are a careful assistant.', 'background', signal)).text
  } catch (e) {
    if (e instanceof ClaudeUnavailable) return null
    throw e
  }
}

/** A short, separate call on the marking model: its verdict for the tutor to write */
export async function markAnswer(question: string, answer: string, model: string, signal: AbortSignal): Promise<{ verdict: string; score: number; why: string; ms: number } | null> {
  const r = await claudeOnce(`The tutor's message, with the question and its hidden solution:\n"""\n${question.slice(-8000)}\n"""\n\nThe student's answer:\n"""\n${answer.slice(0, 6000)}\n"""`, MARK_SYSTEM, 'mark', signal, model).catch(() => null)
  if (!r) return null
  try {
    const j = JSON.parse(/\{[\s\S]*\}/.exec(r.text)?.[0] ?? '') as { verdict?: string; score?: number; why?: string }
    if (!j.verdict || !['correct', 'partial', 'wrong'].includes(j.verdict)) return null
    return { verdict: j.verdict, score: Number(j.score ?? (j.verdict === 'correct' ? 1 : j.verdict === 'partial' ? 0.5 : 0)), why: String(j.why ?? ''), ms: r.ms }
  } catch {
    return null
  }
}

/**
 * Planning work (a roadmap, a lesson plan) on Claude when Claude teaches, else on Gemma or the
 * cloud helper as before. Only for prompts that hold nothing private (a topic, public research).
 */
export async function planOnClaude(prompt: string, system: string | undefined, signal?: AbortSignal): Promise<string | null> {
  if (!(await claudeTeaches())) return null
  try {
    return (await claudeOnce(prompt, system ?? 'You are a careful expert.', 'hard', signal)).text
  } catch (e) {
    if (e instanceof ClaudeUnavailable) return null
    throw e
  }
}

let configDir = ''
function configFor(key: string, port: number, token: string): string {
  configDir ||= join(app.getPath('userData'), 'claude')
  mkdirSync(configDir, { recursive: true })
  const file = join(configDir, `mcp-${fp(key)}.json`)
  // Holds this launch's token for Tide's own server only (never the user's Claude login); readable by the user alone
  writeFileSync(file, mcpConfig(port, token, key), { mode: 0o600 })
  return file
}

/**
 * One turn taught by Claude. Throws ClaudeUnavailable before anything is shown when Claude can't
 * take it (missing, logged out, at the plan's limit), so the caller hands it to Gemma.
 */
export async function claudeTurn(req: TurnRequest, emit: (e: ChatEvent) => void, signal: AbortSignal, cut?: AbortSignal): Promise<string> {
  const { buildTurn, nextStepId } = await import('./agent')
  const { CLAUDE_LESSON_SYSTEM, CLAUDE_TUTOR_SYSTEM, CLAUDE_WEB_NOTE } = await import('@shared/tutorPrompt')
  const { ownWords } = await import('@shared/session')
  const { escalationFor } = await import('@shared/providers')
  const { ensureMcp: startMcp } = await import('./tideMcp')
  const { bindLesson, unbindLesson } = await import('./tideMcp')

  const ready = await claudeReady()
  if (!ready.ready) throw new ClaudeUnavailable(ready.why ?? 'not ready')

  // Problems are set through set_exercise, proven first (main/exercises), not written with their own checks
  if (req.session && req.instructions) req = { ...req, instructions: (await import('@shared/exercises')).forClaude(req.instructions) }
  const { ctx, messages, mine, secret } = await buildTurn(req, emit, signal, req.session ? CLAUDE_LESSON_SYSTEM : CLAUDE_TUTOR_SYSTEM)
  // Checked again on what the turn actually holds: never send a private turn
  if (ctx.private || mine || secret) throw new ClaudeUnavailable('Private: this stays on your Mac')

  const settings = getSettings().ai.claude
  const said = ownWords(text([...req.messages].reverse().find((m) => m.role === 'user')?.content))
  const role = turnRole(req, said, escalationFor(said, req.askType) ?? null)
  const teachModel = claudeModel('teach', settings, req.claudeModel)
  const model = role === 'hard' ? (rank(claudeModel('hard', settings)) > rank(teachModel) ? claudeModel('hard', settings) : teachModel) : teachModel

  // Claude's own web search and page reading, for a lesson with Web on (Claude never gets a private one)
  const web = req.web !== false
  const { forClaude } = await import('@shared/exercises')
  const system = forClaude(String(messages[0].content)) + (web ? `\n\n${CLAUDE_WEB_NOTE}` : '')
  const history = messages.slice(1)
  // Web on or off is fixed when a process starts: switching it starts another, from the transcript
  const key = lessonKey(req) + (web ? ':web' : '')
  const mcp = await startMcp()
  const proc = (live.get(key)?.alive ? null : adopt(system, web, key)) ?? processFor(key, model, system, configFor(key, mcp.port, mcp.token), web ? CLAUDE_WEB_TOOLS : [])
  // Known by the student's own first message, as the window sends it (the context Tide adds to it can change)
  const firstSaid = fp(text(req.messages.find((m) => m.role === 'user')?.content))
  const sent = messageToSend(history, { turns: proc.turns, first: proc.first === firstSaid ? fp(text(history.find((m) => m.role === 'user')?.content)) : proc.first, alive: proc.alive })
  // Why a process was given the transcript again, for tuning (no lesson text is kept)
  if (sent.fresh && history.length > 1) {
    try {
      appendFileSync(join(app.getPath('userData'), 'claude', 'restarts.log'), JSON.stringify({ at: Date.now(), key, alive: proc.alive, turns: proc.turns, users: history.filter((m) => m.role === 'user').length, sameFirst: proc.first === firstSaid }) + '\n')
    } catch {
      // only a log
    }
  }
  let markNote = ''
  let verdict: 'correct' | 'partial' | 'wrong' | undefined
  // Show me and Draw it: on Claude, a custom visual is one of the pictures it can choose
  const { asksToSee } = await import('@shared/showMe')
  const { SHOW_ME_VISUAL_NOTE } = await import('@shared/visuals')
  const seeNote = asksToSee(said) || /^Draw this so I can see how it works/i.test(said) ? `\n\n${SHOW_ME_VISUAL_NOTE}` : ''
  const fresh = sent.fresh
  const users = history.filter((m) => m.role === 'user').length

  // A query or a final answer is checked exactly first (the lab, SymPy), as on Gemma's lessons
  const answering = isAnswer(req, said)
  const exact = answering ? await import('./lessonGuard').then((g) => g.exactCheck(req)).catch(() => null) : null
  const exactSaid = exact ? `\n\n${(await import('@shared/answerCheck')).exactNote(exact)}` : ''
  if (exact) emit({ id: req.id, type: 'step', step: { id: nextStepId(), kind: 'helper', label: exact.kind === 'sql' ? (exact.result === 'match' ? 'Ran your query beside the reference: the same rows' : 'Ran your query beside the reference: the rows differ') : exact.result === 'match' ? 'Checked your final answer: it’s right' : 'Checked your final answer: it isn’t right yet', status: 'done', depth: 0 } })
  // An answer is marked first by the marking model, when it's stronger than the one teaching
  const markModel = claudeModel('mark', settings)
  if (answering && rank(markModel) > rank(model)) {
    const prev = text([...req.messages].reverse().find((m) => m.role === 'assistant')?.content)
    const id = nextStepId()
    emit({ id: req.id, type: 'step', step: { id, kind: 'helper', label: `${claudeLabel(markModel)} is marking your answer`, status: 'running', depth: 0 } })
    const mark = await markAnswer(prev, said + exactSaid, markModel, signal).catch(() => null)
    verdict = mark?.verdict as typeof verdict
    emit({ id: req.id, type: 'step', step: { id, status: mark ? 'done' : 'error', detail: mark ? `${mark.verdict}, ${(mark.ms / 1000).toFixed(1)} s` : 'no mark: the tutor marks it' } as AgentStep })
    if (mark) markNote = `\n\n(Tide: ${claudeLabel(markModel)} marked this answer against your solution: verdict "${mark.verdict}", score ${mark.score}. Why: ${mark.why})`
  }
  // No separate marker (the tutor is already the strongest model): the exact check goes to the tutor itself
  if (exactSaid && !markNote) markNote = exactSaid

  const toolCtx: ToolContext = { signal, sources: ctx.sources, emitSources: ctx.emitSources, step: ctx.step, updateStep: ctx.updateStep, web: false, chatId: req.chatId, labId: req.labId ?? req.chatId }
  bindLesson(proc.binding, toolCtx)
  // What set_exercise needs of this turn: the topic, the lesson so far and the mark, for the level (main/exercises)
  const { setLessonInfo } = await import('./exercises')
  setLessonInfo(toolCtx.labId, { topic: req.topic, path: 'path' in req.scope ? req.scope.path : undefined, private: false, history: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text(m.content) })), ...(verdict ? { verdict } : {}) })
  const engineStep = nextStepId()
  emit({ id: req.id, type: 'step', step: { id: engineStep, kind: 'helper', label: `Claude ${claudeLabel(model)} is teaching${fresh && history.length > 1 ? ' (picking the lesson up again)' : ''}`, status: 'running', depth: 0 } })

  const t0 = Date.now()
  let first = 0
  let reply = ''
  let gap = false
  let thinking = false
  const onEvent = (e: ClaudeEvent) => {
      if (e.type === 'thinking') {
        if (!thinking && !reply) emit({ id: req.id, type: 'step', step: { id: engineStep, label: `Claude ${claudeLabel(model)} is thinking` } as AgentStep })
        thinking = true
      } else if (e.type === 'message-start') gap = reply.length > 0
      else if (e.type === 'text' && e.text) {
        // A new message after a tool call: keep it apart from what came before
        const sep = gap && !/\n\n$/.test(reply) ? (reply.endsWith('\n') ? '\n' : '\n\n') : ''
        gap = false
        if (!first) first = Date.now()
        reply += sep + e.text
        emit({ id: req.id, type: 'delta', text: sep + e.text })
      } else if (e.type === 'rate-limit') {
        lastLimit = { status: e.status, utilization: e.utilization, window: e.window, resetsAt: e.resetsAt }
        if (e.status === 'rejected' && e.resetsAt) limitedUntil = e.resetsAt * 1000
      } else if (e.type === 'tool' && !e.name.startsWith('mcp__tide__')) {
        emit({ id: req.id, type: 'step', step: { id: nextStepId(), kind: /fetch/i.test(e.name) ? 'read_webpage' : 'web_search', label: e.name, status: 'done', depth: 0 } })
      }
  }
  try {
    // A process holding some other history starts again, from the transcript
    if (fresh && proc.alive && proc.turns > 0) proc.stop()
    proc.first = firstSaid
    let result: Extract<ClaudeEvent, { type: 'result' }>
    try {
      result = await proc.turn(sent.content + markNote + seeNote, model, onEvent, signal, cut)
    } catch (e) {
      // The process died before it said anything: once more, on a new one, with the whole transcript
      if (reply || signal.aborted || e instanceof ClaudeUnavailable || unavailableReason((e as Error).message + proc.stderr)) throw e
      proc.stop()
      const again = messageToSend(history, { turns: 0, first: '', alive: false })
      emit({ id: req.id, type: 'step', step: { id: engineStep, label: `Claude ${claudeLabel(model)} is teaching (started again)` } as AgentStep })
      result = await proc.turn(again.content + markNote + seeNote, model, onEvent, signal, cut)
    }
    proc.turns = users
    const turnCost = Math.max(0, result.usage.costUsd - proc.costSoFar)
    proc.costSoFar = result.usage.costUsd
    result.usage.costUsd = turnCost
    recordUse({ ...result.usage, at: Date.now(), model: result.model && result.model.includes(String(model)) ? result.model : String(model), role, ms: Date.now() - t0, firstTokenMs: first ? first - t0 : undefined })
    if (!result.ok) {
      const why = unavailableReason(result.error ?? '')
      if (why === 'limit' && !limitedUntil) limitedUntil = Date.now() + 15 * 60_000
      if (why && !reply) throw new ClaudeUnavailable(why === 'login' ? 'not logged in' : 'at your plan’s limit')
      throw new Error(result.error ?? 'Claude stopped')
    }
    emit({ id: req.id, type: 'step', step: { id: engineStep, label: `Claude ${claudeLabel(model)} is teaching`, status: 'done', detail: `${thinking ? 'thought first, ' : ''}first words in ${(((first || Date.now()) - t0) / 1000).toFixed(1)} s` } as AgentStep })
    return reply
  } catch (e) {
    emit({ id: req.id, type: 'step', step: { id: engineStep, status: 'error' } as AgentStep })
    // Nothing shown yet and the process never answered: Gemma can take the turn
    const msg = (e as Error).message
    if (!reply && !(e instanceof DOMException) && (e instanceof ClaudeUnavailable || unavailableReason(msg + proc.stderr))) {
      proc.stop()
      live.delete(key)
      throw e instanceof ClaudeUnavailable ? e : new ClaudeUnavailable(unavailableReason(msg + proc.stderr) === 'login' ? 'not logged in' : 'at your plan’s limit')
    }
    throw e
  } finally {
    unbindLesson(proc.binding)
  }
}
