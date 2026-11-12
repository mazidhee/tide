/**
 * Lesson threads in main: on Gemma a thread goes through the normal chat path (not a lesson turn:
 * no lesson checks, no read-back that would push the lesson out of the model's cache), and a
 * private notebook's thread never reaches Claude.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/tide-test', isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ ai: { agent: true, baseUrl: 'http://localhost:8080/v1', claude: { teacher: 'claude' } } }) }))
vi.mock('../src/main/speed', () => ({ recentSpeed: () => [{ id: 'g1', calls: [{ engine: 'local' }] }, { id: 'g2', calls: [{ engine: 'local' }] }] }))
let who: 'claude' | 'gemma' = 'gemma'
vi.mock('../src/main/teacher', async (orig) => ({ ...(await orig<object>()), teacherFor: async () => ({ who }) }))
const toClaude: ChatRequest[] = []
vi.mock('../src/main/claudeEngine', () => ({
  ClaudeUnavailable: class extends Error {},
  claudeInstalled: () => true,
  claudeReady: async () => ({ installed: true, ready: true }),
  claudeTurn: async (req: ChatRequest, emit: (e: ChatEvent) => void) => {
    toClaude.push(req)
    emit({ id: req.id, type: 'delta', text: 'from claude' })
    return 'from claude'
  }
}))
vi.mock('../src/main/projects', () => ({ privatePath: async (p: string) => p.startsWith('Secret') }))
vi.mock('../src/main/learn', () => ({ getNotebooks: async () => [], filedUnder: () => null }))
vi.mock('../src/main/metabase', () => ({ metabaseHost: () => '', metabaseReady: () => false }))
const toGemma: ChatRequest[] = []
const readBack = vi.fn()
vi.mock('../src/main/agent', () => ({
  agentChat: async (req: ChatRequest, emit: (e: ChatEvent) => void) => {
    toGemma.push(req)
    emit({ id: req.id, type: 'delta', text: 'from gemma' })
  },
  readBack: (...a: unknown[]) => readBack(...a)
}))

const { chat } = await import('../src/main/ai')
const ask = async (req: Partial<ChatRequest>) => {
  const events: ChatEvent[] = []
  await chat({ id: 'g1', scope: { kind: 'none' }, messages: [{ role: 'user', content: '(Tide: a side thread)\n\nWhy?' }], instructions: 'thread rules', labId: 'lesson:x', ...req } as ChatRequest, (e) => events.push(e))
  await new Promise((r) => setTimeout(r, 20))
  return events
}

describe('a lesson thread in main', () => {
  it('on Gemma: the normal chat path, not a lesson turn, and the lesson stays the conversation kept warm', async () => {
    who = 'gemma'
    const events = await ask({ thread: 't1' })
    expect(toGemma).toHaveLength(1)
    expect(toGemma[0].thread).toBe('t1')
    expect(toGemma[0].session).toBeFalsy()
    expect(events.some((e) => e.type === 'replied')).toBe(false)
    expect(events.at(-1)?.type).toBe('done')
    expect(readBack).not.toHaveBeenCalled()
    // An ordinary turn is still read back
    await ask({ id: 'g2', thread: undefined })
    expect(readBack).toHaveBeenCalledTimes(1)
  })

  it('on Claude: the thread is handed over as a thread', async () => {
    who = 'claude'
    await ask({ thread: 't2' })
    expect(toClaude.at(-1)?.thread).toBe('t2')
  })
})

describe('who answers a thread', () => {
  it('a private notebook’s thread stays on Gemma, even with Claude chosen; a public one goes to Claude', async () => {
    const { teacherFor } = await vi.importActual<typeof import('../src/main/teacher')>('../src/main/teacher')
    const thread = { id: 'p', messages: [{ role: 'user' as const, content: 'why?' }], thread: 't', engine: 'claude' as const }
    expect((await teacherFor({ ...thread, scope: { kind: 'folder', path: 'Secret project' } })).who).toBe('gemma')
    expect((await teacherFor({ ...thread, scope: { kind: 'folder', path: 'Python' } })).who).toBe('claude')
  })
})
