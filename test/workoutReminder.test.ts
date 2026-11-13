import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, Notification: class { static isSupported = () => false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: '' }) }))
const { workoutReminder } = await import('../src/main/workout')
const { freshPrefs } = await import('@shared/workout')
const { dayKey } = await import('@shared/mentalMaths')

const at = (h: number) => new Date(2026, 10, 13, h, 5)
const state = (reminder: 'off' | 'morning' | 'evening') => ({ prefs: { ...freshPrefs(), reminder }, rounds: [] })

describe('the workout reminder', () => {
  it('fires once past the hour you chose while today’s morning isn’t done', () => {
    expect(workoutReminder(state('morning'), at(7), '')).toBeNull()
    expect(workoutReminder(state('morning'), at(9), '')).toEqual({ title: 'Morning workout', body: 'Five rounds, about fifteen minutes.' })
    expect(workoutReminder(state('morning'), at(9), dayKey(at(9).getTime()))).toBeNull()
    expect(workoutReminder(state('evening'), at(9), '')).toBeNull()
    expect(workoutReminder(state('off'), at(21), '')).toBeNull()
  })

  it('a test copy can fire it at any hour, to see it live', () => {
    expect(workoutReminder(state('evening'), at(5), '', true)?.title).toBe('Morning workout')
    expect(workoutReminder(state('off'), at(5), '', true)).toBeNull()
  })
})

describe("a round's clock in words", () => {
  it('reads as whole or half minutes, never a long decimal (a championship is 1.34 times longer)', async () => {
    const { clockWords, roundPlan } = await import('@shared/workout')
    expect(clockWords(180)).toBe('3 minutes')
    expect(clockWords(roundPlan('speed', true).seconds!)).toBe('4 minutes')
    expect(clockWords(270)).toBe('4½ minutes')
    expect(clockWords(60)).toBe('1 minute')
    expect(clockWords(30)).toBe('½ minutes')
  })
})
