import { mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatMessage } from '../src/shared/types'

const dir = mkdtempSync(join(tmpdir(), 'tide-thinking-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
const settings = { ai: { claude: {} as Record<string, unknown> } }
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/claudeCli', async (orig) => ({ ...(await orig<object>()), checkClaude: async () => ({ installed: true, loggedIn: true, checkedAt: Date.now() }) }))
vi.mock('../src/main/agent', () => {
  let n = 0
  return {
    nextStepId: () => `s${++n}`,
    stablePrompt: async (base: string) => `SYSTEM ${base.length}`,
    buildTurn: async (req: { messages: ChatMessage[] }, emit: (e: ChatEvent) => void, _s: AbortSignal, base: string) => ({
      ctx: { sources: [], emitSources: () => {}, step: () => `s${++n}`, updateStep: () => {} },
      messages: [{ role: 'system', content: `SYSTEM ${base.length}` }, ...req.messages],
      images: [],
      emit
    })
  }
})
vi.mock('../src/main/tideMcp', () => ({ ensureMcp: async () => ({ port: 1, token: 't', url: '' }), bindLesson: () => {}, unbindLesson: () => {} }))

const LOG = join(dir, 'fake.jsonl')
process.env.FAKE_CLAUDE_LOG = LOG
const thinking = await import('../src/shared/thinking')
const { JOB_ROUTES } = await import('../src/shared/gemmaPolicy')
const engine = await import('../src/main/claudeEngine')
const usage = await import('../src/main/usageLog')
const cli = await import('../src/main/claudeCli')
engine.setClaudeCommand(() => resolve('test/fixtures/fake-claude.mjs'))
const usageDir = join(dir, 'usage')
usage.setUsageDir(usageDir)
afterAll(() => {
  engine.stopClaude()
  usage.setUsageDir(null)
})

type Logged = { args?: string[]; control?: { subtype: string; settings?: { effortLevel?: string } }; turn?: number; effort?: string | null }
const logged = (): Logged[] => {
  try {
    return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}
const effortArg = (args: string[]) => (args.includes('--effort') ? args[args.indexOf('--effort') + 1] : undefined)
const lastStart = () => logged().filter((l) => l.args).pop()!.args!

const say = (messages: ChatMessage[], extra: Record<string, unknown> = {}) =>
  engine.claudeTurn({ id: `r${Math.random()}`, messages, scope: { kind: 'none' }, labId: 'lesson:think', ...extra } as never, () => {}, new AbortController().signal)

beforeEach(() => {
  settings.ai.claude = {}
})

describe('the table', () => {
  it('gives every Claude job and lesson turn a depth', () => {
    for (const [job, r] of Object.entries(JOB_ROUTES)) if (r.role) expect(thinking.THINKING[job]?.effort, job).toBeTruthy()
    for (const k of ['lesson', 'lessonPlan', 'deepTurn', 'mathsLesson', 'thread', 'chat', 'marking', 'plan', 'background']) expect(thinking.THINKING[k]).toBeTruthy()
  })

  it('thinks long for plans, proofs and reviews, a middle amount to teach, and little for chat and background work', () => {
    const e = (k: string) => thinking.effortFor(k)
    for (const k of ['goalPlan', 'projectPlan', 'lessonPlan', 'deepTurn', 'projectMentor', 'workingMark', 'lessonReview', 'plan']) expect(e(k), k).toBe('high')
    for (const k of ['lesson', 'mathsLesson', 'readSeminar']) expect(e(k), k).toBe('medium')
    for (const k of ['chat', 'thread', 'mathsReadBack', 'background', 'profileUpdate', 'marking']) expect(e(k), k).toBe('low')
  })

  it('takes the learner’s override, ignores nonsense, and maps a role’s usage job to its row', () => {
    expect(thinking.effortFor('chat', { chat: 'max' })).toBe('max')
    expect(thinking.effortFor('chat', { chat: 'huge' as never })).toBe('low')
    expect(thinking.effortFor('marking', { marking: 'high' })).toBe('high')
    expect(thinking.effortFor('draft')).toBe('low')
    expect(thinking.effortFor('somethingNew')).toBe('medium')
    expect(thinking.effortFor(undefined)).toBe('medium')
  })

  it('puts the flag on the command line only when there is one, and changes a running process with a control request', () => {
    expect(cli.claudeArgs({ model: 'opus', system: 's', mcpConfig: 'c' })).not.toContain('--effort')
    const args = cli.claudeArgs({ model: 'opus', system: 's', mcpConfig: 'c', effort: 'high' })
    expect(effortArg(args)).toBe('high')
    expect(effortArg(cli.onceArgs('opus', 's', false, 'low'))).toBe('low')
    expect(JSON.parse(cli.effortLine('low', 'x'))).toEqual({ type: 'control_request', request_id: 'x', request: { subtype: 'apply_flag_settings', settings: { effortLevel: 'low' } } })
  })
})

describe('which depth a lesson turn gets', () => {
  const ask = { role: 'assistant' as const, content: 'What is 6 × 7? <ask>Your answer</ask>' }
  const base = { id: 'x', scope: { kind: 'none' }, session: true } as const
  it('plans long, answers and teaches in the middle, and keeps chat and threads quick', () => {
    expect(engine.turnDepth({ ...base, instructions: 'teach', messages: [{ role: 'user', content: 'start' }] } as never, 'start', null)).toBe('lessonPlan')
    expect(engine.turnDepth({ ...base, messages: [{ role: 'user', content: 'a' }, ask, { role: 'user', content: '42' }] } as never, '42', null)).toBe('lesson')
    expect(engine.turnDepth({ ...base, messages: [{ role: 'user', content: 'a' }, ask, { role: 'user', content: '42' }] } as never, '42', null, true)).toBe('mathsLesson')
    expect(engine.turnDepth({ ...base, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'prove it' }] } as never, 'prove it', null)).toBe('deepTurn')
    expect(engine.turnDepth({ ...base, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'x' }] } as never, 'What are the trade-offs between a ledger table per account and one journal?', null)).toBe('deepTurn')
    expect(engine.turnDepth({ ...base, thread: 't', messages: [{ role: 'user', content: 'prove it' }] } as never, 'prove it', null)).toBe('thread')
    expect(engine.turnDepth({ id: 'x', scope: { kind: 'none' }, messages: [{ role: 'user', content: 'hi' }] } as never, 'hi', null)).toBe('chat')
  })
})

describe('Claude Code is told how hard to think', () => {
  it('a one-shot job runs at its own depth, and the log keeps it', async () => {
    await usage.withUsage({ job: 'goalPlan' }, () => engine.claudeOnce('plan my goal', 'sys', 'hard'))
    expect(effortArg(lastStart())).toBe('high')
    await usage.withUsage({ job: 'mathsReadBack' }, () => engine.claudeOnce('read x^2 back', 'sys', 'background'))
    expect(effortArg(lastStart())).toBe('low')
    // No job named: its role's row
    await engine.claudeOnce('summarise', 'sys', 'background')
    expect(effortArg(lastStart())).toBe('low')
    const calls = readdirSync(usageDir).flatMap((f) => readFileSync(join(usageDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    expect(calls.find((c) => c.job === 'goalPlan')?.eff).toBe('high')
  })

  it('marking an answer runs low, and in a maths lesson at medium; Settings can change it', async () => {
    await engine.markAnswer('Q <ask>x</ask>', '42', 'opus', new AbortController().signal)
    expect(effortArg(lastStart())).toBe('low')
    await engine.markAnswer('Q <ask>x</ask>', '42', 'opus', new AbortController().signal, [], [], true)
    expect(effortArg(lastStart())).toBe('medium')
    settings.ai.claude = { thinking: { marking: 'xhigh' } }
    await engine.markAnswer('Q <ask>x</ask>', '42', 'opus', new AbortController().signal)
    expect(effortArg(lastStart())).toBe('xhigh')
  })

  it('a lesson process starts at its turn’s depth and is changed between messages, not restarted', async () => {
    const m1: ChatMessage[] = [{ role: 'user', content: 'hello there' }]
    const r1 = await say(m1, { labId: 'lesson:depth', session: true })
    expect(effortArg(lastStart())).toBe('medium')
    const pid = /pid (\d+)/.exec(r1)![1]
    const m2: ChatMessage[] = [...m1, { role: 'assistant', content: r1 }, { role: 'user', content: 'go deeper on that' }]
    const r2 = await say(m2, { labId: 'lesson:depth', session: true })
    expect(r2).toContain(`pid ${pid} turn 2`)
    const m3: ChatMessage[] = [...m2, { role: 'assistant', content: r2 }, { role: 'user', content: 'ok next' }]
    await say(m3, { labId: 'lesson:depth', session: true })
    const controls = logged().filter((l) => l.control?.subtype === 'apply_flag_settings').map((l) => l.control!.settings!.effortLevel)
    expect(controls.slice(-2)).toEqual(['high', 'medium'])
    const turns = logged().filter((l) => l.turn !== undefined)
    expect(turns.slice(-3).map((t) => t.effort)).toEqual(['medium', 'high', 'medium'])
  })

  it('a chat reply is quick', async () => {
    await say([{ role: 'user', content: 'what is a bond' }], { labId: undefined, chatId: 'c-think' })
    expect(effortArg(lastStart())).toBe('low')
  })
})
