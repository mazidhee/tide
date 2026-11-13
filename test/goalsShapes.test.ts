import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readGoalsFile } from '../src/shared/goals'
import { aimsOf } from '../src/shared/coach'

/**
 * .tide/goals.json has had two shapes: a bare array of roadmap deadlines (the old Aims era) and
 * the Goals store. Both readers shared the file, so the Finance and Interview prep pages crashed
 * with "goals.filter is not a function" and What you know with "goals is not iterable". Every shape
 * here is read without throwing, nothing in the file is dropped, and nothing is written on read.
 */

// The user's real file on 13 Nov (Goals store, no goals yet, one standing weight)
const REAL = { version: 1, goals: [], standing: { 'roadmap:software engineering': { weight: 'main' } }, migrated: true }
// The older shape: roadmap deadlines as a bare array
const OLD = [{ id: 'g1', name: 'Finish Mathematics', notebook: 'Mathematics', deadline: '2026-12-20', createdAt: 1 }]

describe('readGoalsFile', () => {
  it('reads the real Goals store as it is', () => {
    const s = readGoalsFile(REAL)
    expect(s.goals).toEqual([])
    expect(s.standing).toEqual(REAL.standing)
    expect(s.deadlines).toBeUndefined()
    expect(s.migrated).toBe(true)
  })

  it('reads the old bare array as roadmap deadlines', () => {
    const s = readGoalsFile(OLD)
    expect(s.goals).toEqual([])
    expect(s.deadlines).toEqual(OLD)
    expect(s.migrated).toBeUndefined()
  })

  it('sorts a mix apart and keeps what it cannot read', () => {
    const s = readGoalsFile({
      goals: { a: { id: 'a', title: 'Bloomberg interview', weight: 'main', needs: [{ kind: 'mock', ref: 'dsa', label: 'DSA', hours: 10 }], createdAt: 5 }, b: OLD[0], c: { text: 'Get strong at ML', weight: 'side', since: 9 }, d: 42 },
      standing: 'nope'
    })
    expect(s.goals.map((g) => g.title)).toEqual(['Bloomberg interview', 'Get strong at ML'])
    expect(s.goals[1]).toMatchObject({ weight: 'side', needs: [], createdAt: 9 })
    expect(s.deadlines?.map((d) => d.notebook)).toEqual(['Mathematics'])
    expect(s.unread).toEqual([42])
    expect(s.standing).toEqual({})
  })

  it('tolerates nothing at all', () => {
    for (const raw of [null, undefined, 3, 'x', {}, { goals: null }]) expect(readGoalsFile(raw)).toMatchObject({ goals: [], standing: {} })
  })
})

describe('aimsOf on older coach files', () => {
  it('reads aims as plain strings and a missing goal line', () => {
    expect(aimsOf({ aims: ['Quant finance' as never] } as never).map((a) => a.text)).toEqual(['Quant finance'])
    expect(aimsOf({} as never)).toEqual([])
  })
})

// ---------- Through main, on a scratch vault ----------

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tide-goals-shapes-')))
const vault = join(base, 'vault')
mkdirSync(join(vault, '.tide'), { recursive: true })
const file = join(vault, '.tide', 'goals.json')

vi.mock('electron', () => ({ app: { getPath: () => base, isPackaged: false, on: () => {} } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: { claude: {} } }) }))
vi.mock('../src/main/coach', () => ({ getCoach: async () => ({ goal: '', focus: [] }), saveCoach: async () => {} }))

describe('main readers of goals.json', () => {
  beforeEach(async () => (await import('../src/main/goals')).resetGoals())

  it('the real Goals store gives roadmap deadlines as an empty list, not an object', async () => {
    writeFileSync(file, JSON.stringify(REAL))
    const { getGoals } = await import('../src/main/learn')
    const deadlines = await getGoals()
    expect(Array.isArray(deadlines)).toBe(true)
    expect(deadlines.filter(() => true)).toEqual([])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(REAL)
  })

  it('the old array keeps its deadlines, and Goals saving beside them drops nothing', async () => {
    writeFileSync(file, JSON.stringify(OLD))
    const goals = await import('../src/main/goals')
    const { getGoals, saveGoals } = await import('../src/main/learn')
    expect(await getGoals()).toEqual(OLD)
    // Reading writes nothing
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(OLD)
    const store = await goals.loadGoals()
    // The old file is copied aside before Tide first writes the upgraded store
    expect(JSON.parse(readFileSync(join(vault, '.tide', 'goals.before-upgrade.json'), 'utf8'))).toEqual(OLD)
    await goals.saveGoals({ ...store, goals: [{ id: 'x', title: 'Ship the payment rail', weight: 'main', needs: [], createdAt: 1 }] })
    await saveGoals([...(await getGoals()), { id: 'g2', name: 'Finish SWE', notebook: 'Software Engineering', deadline: '2027-01-10', createdAt: 2 }])
    goals.resetGoals()
    const after = await goals.loadGoals()
    expect(after.goals.map((g) => g.id)).toEqual(['x'])
    expect(after.deadlines?.map((d) => d.id)).toEqual(['g1', 'g2'])
    expect(existsSync(file)).toBe(true)
  })
})
