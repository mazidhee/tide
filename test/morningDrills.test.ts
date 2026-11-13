/**
 * The morning drills tracker: minutes per drill per day from what each already records, today
 * and this week, the streak (only drills done in Tide) and today's score; and the one
 * "Morning drills" to-do a day in Things, kept in step. Things is mocked.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { drillTally, minutesByDay, mondayOf, minutesLabel } from '../src/shared/morningDrills'
import { freshPrefs, ROUNDS, type RoundRecord, type WorkoutState } from '../src/shared/workout'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tide-morning-drills-')))
const vault = join(base, 'vault')
mkdirSync(join(vault, '.tide'), { recursive: true })
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false }, app: { getPath: () => base, isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault }) }))

const calls: { fn: string; args: unknown[] }[] = []
let status = 'open'
vi.mock('../src/main/things', () => ({
  thingsAvailable: async () => true,
  addTask: async (...args: unknown[]) => (calls.push({ fn: 'addTask', args }), { id: 'todo1' }),
  getTask: async (id: string) => ({ id, type: 'to-do', title: 'Morning drills', status }),
  setTaskDone: async (...args: unknown[]) => void calls.push({ fn: 'setTaskDone', args })
}))
afterAll(() => vi.useRealTimers())

const round = (day: string, id: RoundRecord['round'], ms: number[], morning = `m-${day}`): RoundRecord => ({
  id: `${day}${id}`,
  morning,
  at: Date.parse(`${day}T07:40:00Z`),
  day,
  round: id,
  championship: false,
  items: ms.map((m) => ({ kind: 'speed.x', difficulty: 1000, prompt: '1+1', given: '2', shown: '2', right: true, score: 1, ms: m }))
})
const wholeMorning = (day: string) => ROUNDS.map((r) => round(day, r.id, [60_000, 60_000]))
const state = (rounds: RoundRecord[]): WorkoutState => ({ prefs: freshPrefs(), rounds })

describe('the tally', () => {
  const FRI = '2026-11-13'
  it('counts minutes per drill from each record, by day', () => {
    const by = minutesByDay({ workout: state([round(FRI, 'speed', [90_000, 30_000])]), sprints: [{ at: Date.parse(`${FRI}T08:00:00Z`), seconds: 120 }], review: [{ start: Date.parse(`${FRI}T08:05:00Z`), minutes: 9 }], ticked: [] }, 0)
    expect(by[FRI]).toEqual({ workout: 2, mental: 2, review: 9, total: 13 })
  })

  it('gives today, the week from Monday, the streak (only drills done in Tide), and today’s score', () => {
    const t = drillTally(
      {
        workout: state([...wholeMorning('2026-11-08'), ...wholeMorning('2026-11-11'), ...wholeMorning(FRI)]),
        sprints: [{ at: Date.parse('2026-11-12T08:00:00Z'), seconds: 120 }],
        review: [{ start: Date.parse('2026-11-10T08:00:00Z'), minutes: 12 }],
        // Thursday ticked off in Things without a workout: not a day done
        ticked: ['2026-11-12']
      },
      FRI,
      0
    )
    expect(mondayOf(FRI)).toBe('2026-11-09')
    expect(t.today).toEqual({ workout: 10, review: 0, mental: 0, total: 10 })
    // Sunday's morning is last week's
    expect(t.week).toEqual({ workout: 20, review: 12, mental: 2, total: 34 })
    expect(t.streak).toMatchObject({ current: 1, doneToday: true })
    expect(t.score).toBe(1400)
    expect(t.percent).toBe(100)
    expect(minutesLabel(65)).toBe('1 h 05')
  })

  it('has no score before a whole morning, only the rating', () => {
    const t = drillTally({ workout: state([round(FRI, 'speed', [1000])]), sprints: [], review: [], ticked: [] }, FRI)
    expect(t.score).toBeNull()
    expect(t.rating).toBe(1000)
  })
})

describe('the Morning drills to-do in Things (mocked)', () => {
  it('is added once a day, and a tick there doesn’t extend the streak', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T07:00:00'))
    const { syncThings, drillsTally } = await import('../src/main/morningDrills')
    await syncThings('2026-11-13')
    await syncThings('2026-11-13')
    expect(calls.filter((c) => c.fn === 'addTask')).toHaveLength(1)
    expect(calls[0].args[0]).toMatchObject({ title: 'Morning drills', when: '2026-11-13', tags: ['drill'] })
    status = 'completed'
    expect((await drillsTally()).streak).toMatchObject({ current: 0, doneToday: false })
    vi.useRealTimers()
  })

  it('is ticked in Things when the whole workout is done here', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T08:00:00'))
    status = 'open'
    calls.length = 0
    writeFileSync(join(vault, '.tide', 'workout.jsonl'), wholeMorning('2026-11-14').map((r) => JSON.stringify(r)).join('\n') + '\n')
    writeFileSync(join(vault, '.tide', 'workout.json'), JSON.stringify(freshPrefs()))
    const { syncThings } = await import('../src/main/morningDrills')
    await syncThings('2026-11-14')
    expect(calls).toContainEqual({ fn: 'setTaskDone', args: ['todo1', true] })
    vi.useRealTimers()
  })
})
