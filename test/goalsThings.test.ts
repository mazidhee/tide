import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeekPlan } from '../src/shared/coach'

/**
 * Things stays your to-do list: a replanned week tells Things where each to-do went, ticks in
 * Things come back and set off a replan, and a test copy never reaches the real Things at all.
 * Things itself is mocked here; nothing is sent anywhere.
 */

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tide-goals-things-')))
const vault = join(base, 'vault')
mkdirSync(join(vault, '.tide', 'coach'), { recursive: true })

vi.mock('electron', () => ({ app: { getPath: () => base, isPackaged: false, on: () => {} } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: { claude: {} } }) }))

const calls: { fn: string; args: unknown[] }[] = []
const todos = [
  { id: 't1', type: 'to-do', title: 'Graphs', status: 'open' },
  { id: 't2', type: 'to-do', title: 'Project: Payment rail: Ledger', status: 'open' },
  { id: 't3', type: 'to-do', title: 'Attention', status: 'completed' }
]
vi.mock('../src/main/things', () => ({
  TIDE_TAG: 'tide',
  thingsAvailable: async () => true,
  getProject: async (id: string) => (calls.push({ fn: 'getProject', args: [id] }), { id, type: 'project', title: 'This week', status: 'open', 'to-dos': todos }),
  updateTask: async (...args: unknown[]) => (calls.push({ fn: 'updateTask', args }), {}),
  addTask: async (...args: unknown[]) => (calls.push({ fn: 'addTask', args }), {}),
  addProject: async () => ({ id: 'p1' }),
  ensureArea: async () => {},
  searchTasks: async () => []
}))
// The coach's other neighbours, quiet
vi.mock('../src/main/ai', () => ({ completeFor: async () => '', extractJsonObject: () => ({}) }))
vi.mock('../src/main/learn', () => ({ getNotebooks: async () => [], getGoals: async () => [], getMastery: async () => ({}), focusLog: async () => [], listDrills: async () => [], listInterviews: async () => [], studyEvents: async () => [] }))
vi.mock('../src/main/memory', () => ({ listMemories: async () => [] }))
vi.mock('../src/main/brainEvents', () => ({ brainEvent: () => {} }))
vi.mock('../src/main/mistakes', () => ({ listMistakes: async () => [] }))
vi.mock('../src/main/study', () => ({ getCards: async () => [] }))
vi.mock('../src/main/books', () => ({ pagesToRead: async () => [] }))
vi.mock('../src/main/readings', () => ({ readingsForWeek: async () => {} }))
vi.mock('../src/main/curriculum', () => ({ curriculumStatus: async () => [], getOverrides: async () => ({}), loadSorted: async () => null, sortRoadmaps: async () => [], sortRunning: () => false }))
const replans: string[] = []
vi.mock('../src/main/goals', async (orig) => ({ ...(await orig<typeof import('../src/main/goals')>()), replanNow: async (date: string) => (replans.push(date), null), goalsActive: async () => true }))

const { toThings } = await import('../src/main/goals')
const { catchUp } = await import('../src/main/coach')
const { thingsChanges } = await import('../src/shared/portfolio')
const { thingsTitle, localDate } = await import('../src/shared/coach')

const plan = (over: Partial<WeekPlan> = {}): WeekPlan => ({
  weekStart: '2026-11-16',
  createdAt: 1,
  summary: '',
  priorities: [],
  mix: [{ thread: 'roadmap:maths', label: 'Maths', share: 100, minutes: 45, reason: '' }],
  thingsProject: 'p1',
  days: [],
  ...over
})

beforeEach(() => (calls.length = 0))

describe('Things after a replan (mocked)', () => {
  it('moves to-dos to their new day, sends what didn’t fit to next week, and adds new sessions', async () => {
    const changes = thingsChanges(
      {
        moves: [
          { item: { kind: 'learn', title: 'Graphs', topic: 'Graphs', minutes: 45 }, from: '2026-11-17', to: '2026-11-19', why: 'x' },
          { item: { kind: 'project', title: 'Payment rail: Ledger', minutes: 60 }, from: '2026-11-18', to: null, why: 'x' }
        ],
        added: [{ item: { kind: 'learn', title: 'Blockchain', thread: 'roadmap:blockchain', minutes: 20, why: 'Untouched for 9 days' }, date: '2026-11-19' }]
      },
      '2026-11-23',
      thingsTitle
    )
    expect(await toThings(plan(), changes)).toBe(3)
    expect(calls.filter((c) => c.fn !== 'getProject')).toEqual([
      { fn: 'updateTask', args: ['t1', { when: '2026-11-19', deadline: '2026-11-19' }] },
      { fn: 'updateTask', args: ['t2', { when: '2026-11-23' }] },
      { fn: 'addTask', args: [{ title: 'Blockchain', when: '2026-11-19', deadline: '2026-11-19', project: 'p1', tags: ['learn'], notes: 'Untouched for 9 days\n\nAbout 20 minutes.' }] }
    ])
  })

  it('leaves Things alone when the week was never sent there', async () => {
    expect(await toThings(plan({ thingsProject: undefined }), [{ kind: 'move', title: 'Graphs', to: '2026-11-19' }])).toBe(0)
    expect(calls).toEqual([])
  })

  it('ticks from Things come back as done, then the rest of the week is replanned', async () => {
    const today = localDate()
    const week = plan({ weekStart: today, days: [{ date: today, items: [{ kind: 'learn', title: 'Attention', topic: 'Attention', thread: 'roadmap:ml', minutes: 45 }] }] })
    writeFileSync(join(vault, '.tide', 'coach', `week-${today}.json`), JSON.stringify(week))
    replans.length = 0
    await catchUp(today)
    const { getWeek } = await import('../src/main/coach')
    expect((await getWeek(today))!.days[0].items[0].done).toBe(true)
    expect(replans).toEqual([today])
  })
})

describe('the guard: a test copy never writes to the real Things', () => {
  it('finds no Things at all when running on a scratch profile', async () => {
    vi.resetModules()
    vi.doUnmock('../src/main/things')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const before = { data: process.env.TIDE_USER_DATA, api: process.env.TIDE_THINGS_API }
    process.env.TIDE_USER_DATA = base
    delete process.env.TIDE_THINGS_API
    try {
      const things = await import('../src/main/things')
      expect(await things.thingsAvailable()).toBe(false)
      await expect(things.addTask({ title: 'Should never be sent' })).rejects.toThrow(/isn’t set up/)
      await expect(things.updateTask('t1', { completed: true })).rejects.toThrow()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      if (before.data === undefined) delete process.env.TIDE_USER_DATA
      else process.env.TIDE_USER_DATA = before.data
      if (before.api !== undefined) process.env.TIDE_THINGS_API = before.api
    }
  })
})
