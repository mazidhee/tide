import { describe, expect, it } from 'vitest'
import { isDaytime, minutesOf, resolveTheme } from '../src/shared/themeSchedule'

const at = (h: number, m = 0) => new Date(2026, 10, 14, h, m)

describe('themeSchedule', () => {
  it('keeps an explicit theme whatever the time or macOS', () => {
    expect(resolveTheme({ theme: 'graphite' }, at(3), false)).toBe('graphite')
    expect(resolveTheme({ theme: 'light' }, at(23), true)).toBe('light')
  })

  it('draws Sepia by day and Midnight by night by default, switching at 07:00 and 19:00', () => {
    expect(resolveTheme({ theme: 'system' }, at(6, 59), false)).toBe('midnight')
    expect(resolveTheme({ theme: 'system' }, at(7), true)).toBe('sepia')
    expect(resolveTheme({ theme: 'system' }, at(18, 59), true)).toBe('sepia')
    expect(resolveTheme({ theme: 'system' }, at(19), false)).toBe('midnight')
  })

  it('uses the chosen day and night themes and times', () => {
    const s = { theme: 'system' as const, themeDay: 'light' as const, themeNight: 'ember' as const, themeDayAt: '08:30', themeNightAt: '21:15' }
    expect(resolveTheme(s, at(8, 29), false)).toBe('ember')
    expect(resolveTheme(s, at(8, 30), false)).toBe('light')
    expect(resolveTheme(s, at(21, 14), false)).toBe('light')
    expect(resolveTheme(s, at(21, 15), false)).toBe('ember')
  })

  it('follows macOS when asked', () => {
    const s = { theme: 'system' as const, themeSwitch: 'macos' as const }
    expect(resolveTheme(s, at(12), true)).toBe('midnight')
    expect(resolveTheme(s, at(23), false)).toBe('sepia')
  })

  it('handles a day that wraps past midnight, and equal times', () => {
    expect(isDaytime(at(23), '22:00', '06:00')).toBe(true)
    expect(isDaytime(at(5), '22:00', '06:00')).toBe(true)
    expect(isDaytime(at(12), '22:00', '06:00')).toBe(false)
    expect(isDaytime(at(3), '09:00', '09:00')).toBe(true)
  })

  it('never resolves to system, and reads bad times as the defaults', () => {
    expect(resolveTheme({ theme: 'system', themeDay: 'system', themeNight: 'system' }, at(12), false)).toBe('sepia')
    expect(resolveTheme({ theme: 'system', themeDay: 'system', themeNight: 'system' }, at(22), false)).toBe('midnight')
    expect(minutesOf('25:00', '07:00')).toBe(420)
    expect(minutesOf('nonsense', '19:00')).toBe(1140)
    expect(minutesOf('7:05', '19:00')).toBe(425)
  })
})
