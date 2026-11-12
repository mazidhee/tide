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

  constructor(
    readonly key: string,
    model: ClaudeModel | string,
    private readonly system: string,
    private readonly configFile: string,
    private readonly builtIn: string[] = []
  ) {
    this.model = model
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
  turn(content: string | unknown[], model: ClaudeModel | string, onEvent: (e: ClaudeEvent) => void, signal: AbortSignal): Promise<Extract<ClaudeEvent, { type: 'result' }>> {
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
      const done = () => {
        signal.removeEventListener('abort', stop)
        this.lastUsed = Date.now()
        clearTimeout(this.idle)
        this.idle = setTimeout(() => this.stop(), IDLE_MS)
      }
      this.sink = {
        onEvent,
        resolve: (r) => (done(), resolve(r)),
        reject: (e) => (done(), reject(e))
      }
      if (model !== this.model) {
        this.child!.stdin.write(JSON.stringify({ type: 'control_request', request_id: `m${Date.now()}`, request: { subtype: 'set_model', model } }) + '\n')
        this.model = model
      }
      this.child!.stdin.write(userLine(content))
    })
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
  if (job === 'maths' || job === 'errors' || job === 'planning') return 'hard'
  if (asksForDepth(said)) return 'hard'
  return 'teach'
}

/** The student is answering the question the tutor's last message asked */
export function isAnswer(req: TurnRequest, said: string): boolean {
  if (!req.session) return false
  const prev = [...req.messages].reverse().find((m) => m.role === 'assistant')
  if (!prev || !/<ask\b/i.test(text(prev.content))) return false
  return !/^\s*(\[hint\]|(i (don'?t|do not) know|go on|continue|skip)\b)/i.test(said)
}

const MARK_SYSTEM = `You mark one answer a student gave in a lesson, for their tutor. Grade against the tutor's own solution when there is one (it is inside <solution>; the student never saw it). "correct" means complete and right, not just heading the right way; a right answer with wrong or missing reasoning is "partial". An equivalent method or ordering is not a mistake. Quote the words of their answer that earned the verdict. Reply with JSON only: {"verdict": "correct" | "partial" | "wrong", "score": 0.0 to 1.0, "why": "one or two sentences: what was right and why, or the exact step that's wrong and why"}.`

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
  const { chooseTeacher } = await import('./teacher')
  const r = await claudeReady()
  const t = chooseTeacher({ setting: getSettings().ai.claude?.teacher, installed: r.installed, ready: r.ready, notReady: r.why, private: false })
  if (t.who !== 'claude') return null
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
export async function claudeTurn(req: TurnRequest, emit: (e: ChatEvent) => void, signal: AbortSignal): Promise<string> {
  const { buildTurn, nextStepId } = await import('./agent')
  const { CLAUDE_LESSON_SYSTEM, CLAUDE_TUTOR_SYSTEM } = await import('@shared/tutorPrompt')
  const { ownWords } = await import('@shared/session')
  const { escalationFor } = await import('@shared/providers')
  const { startMcp } = await import('./tideMcp')
  const { bindLesson, unbindLesson } = await import('./tideMcp')

  const ready = await claudeReady()
  if (!ready.ready) throw new ClaudeUnavailable(ready.why ?? 'not ready')

  const { ctx, messages, mine, secret } = await buildTurn(req, emit, signal, req.session ? CLAUDE_LESSON_SYSTEM : CLAUDE_TUTOR_SYSTEM)
  // Checked again on what the turn actually holds: never send a private turn
  if (ctx.private || mine || secret) throw new ClaudeUnavailable('Private: this stays on your Mac')

  const settings = getSettings().ai.claude
  const said = ownWords(text([...req.messages].reverse().find((m) => m.role === 'user')?.content))
  const role = turnRole(req, said, escalationFor(said, req.askType) ?? null)
  const teachModel = claudeModel('teach', settings, req.claudeModel)
  const model = role === 'hard' ? (rank(claudeModel('hard', settings)) > rank(teachModel) ? claudeModel('hard', settings) : teachModel) : teachModel

  const system = String(messages[0].content)
  const history = messages.slice(1)
  const key = lessonKey(req)
  const mcp = await startMcp()
  const proc = processFor(key, model, system, configFor(key, mcp.port, mcp.token), [])
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
  const fresh = sent.fresh
  const users = history.filter((m) => m.role === 'user').length

  // An answer is marked first by the marking model, when it's stronger than the one teaching
  const markModel = claudeModel('mark', settings)
  if (isAnswer(req, said) && rank(markModel) > rank(model)) {
    const prev = text([...req.messages].reverse().find((m) => m.role === 'assistant')?.content)
    const id = nextStepId()
    emit({ id: req.id, type: 'step', step: { id, kind: 'helper', label: `${claudeLabel(markModel)} is marking your answer`, status: 'running', depth: 0 } })
    const mark = await markAnswer(prev, said, markModel, signal).catch(() => null)
    emit({ id: req.id, type: 'step', step: { id, status: mark ? 'done' : 'error', detail: mark ? `${mark.verdict}, ${(mark.ms / 1000).toFixed(1)} s` : 'no mark: the tutor marks it' } as AgentStep })
    if (mark) markNote = `\n\n(Tide: ${claudeLabel(markModel)} marked this answer against your solution: verdict "${mark.verdict}", score ${mark.score}. Why: ${mark.why})`
  }

  const toolCtx: ToolContext = { signal, sources: ctx.sources, emitSources: ctx.emitSources, step: ctx.step, updateStep: ctx.updateStep, web: false, chatId: req.chatId, labId: req.labId ?? req.chatId }
  bindLesson(key, toolCtx)
  const engineStep = nextStepId()
  emit({ id: req.id, type: 'step', step: { id: engineStep, kind: 'helper', label: `Claude ${claudeLabel(model)} is teaching${fresh && history.length > 1 ? ' (picking the lesson up again)' : ''}`, status: 'running', depth: 0 } })

  const t0 = Date.now()
  let first = 0
  let reply = ''
  let gap = false
  const onEvent = (e: ClaudeEvent) => {
      if (e.type === 'message-start') gap = reply.length > 0
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
    if (fresh && proc.alive) proc.stop()
    proc.first = firstSaid
    let result: Extract<ClaudeEvent, { type: 'result' }>
    try {
      result = await proc.turn(sent.content + markNote, model, onEvent, signal)
    } catch (e) {
      // The process died before it said anything: once more, on a new one, with the whole transcript
      if (reply || signal.aborted || e instanceof ClaudeUnavailable || unavailableReason((e as Error).message + proc.stderr)) throw e
      proc.stop()
      const again = messageToSend(history, { turns: 0, first: '', alive: false })
      emit({ id: req.id, type: 'step', step: { id: engineStep, label: `Claude ${claudeLabel(model)} is teaching (started again)` } as AgentStep })
      result = await proc.turn(again.content + markNote, model, onEvent, signal)
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
    emit({ id: req.id, type: 'step', step: { id: engineStep, status: 'done', detail: `${claudeLabel(model)}, first words in ${(((first || Date.now()) - t0) / 1000).toFixed(1)} s` } as AgentStep })
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
    unbindLesson(key)
  }
}
