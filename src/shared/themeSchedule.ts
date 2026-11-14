import type { Settings, ThemeId } from './types'

/**
 * "System" as a day theme and a night theme: Sepia by day and Midnight by night unless chosen
 * otherwise, switching at set times (07:00 and 19:00 by default) or with macOS's appearance. An
 * explicit theme is drawn as it is.
 */
export type DrawnTheme = Exclude<ThemeId, 'system'>
export type ThemeSwitch = 'time' | 'macos'

export const DAY_THEME: DrawnTheme = 'sepia'
export const NIGHT_THEME: DrawnTheme = 'midnight'
export const DAY_AT = '07:00'
export const NIGHT_AT = '19:00'

type ThemeSettings = Pick<Settings, 'theme' | 'themeDay' | 'themeNight' | 'themeSwitch' | 'themeDayAt' | 'themeNightAt'>

/** "HH:MM" as minutes after midnight, or the fallback when it can't be read */
export function minutesOf(hhmm: string | undefined, fallback: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(fallback)!
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return minutesOf(fallback, fallback)
  return h * 60 + min
}

/** Whether it is day at this time: from the day time up to the night time, across midnight if need be */
export function isDaytime(now: Date, dayAt?: string, nightAt?: string): boolean {
  const t = now.getHours() * 60 + now.getMinutes()
  const d = minutesOf(dayAt, DAY_AT)
  const n = minutesOf(nightAt, NIGHT_AT)
  if (d === n) return true
  return d < n ? t >= d && t < n : t >= d || t < n
}

const drawn = (t: ThemeId | undefined, fallback: DrawnTheme): DrawnTheme => (t && t !== 'system' ? t : fallback)

/** The theme to draw now */
export function resolveTheme(s: ThemeSettings, now: Date, macDark: boolean): DrawnTheme {
  if (s.theme !== 'system') return s.theme
  const day = (s.themeSwitch ?? 'time') === 'macos' ? !macDark : isDaytime(now, s.themeDayAt, s.themeNightAt)
  return day ? drawn(s.themeDay, DAY_THEME) : drawn(s.themeNight, NIGHT_THEME)
}
