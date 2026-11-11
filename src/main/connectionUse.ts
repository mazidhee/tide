/**
 * When each connection was last used, and how often today: noted where Tide calls it, kept in
 * memory and saved now and then (userData/connection-use.json), for the Connections page.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

type Use = { last: number; day: string; today: number; month?: string; thisMonth?: number; /** Uses by date (yyyy-mm-dd), the last fortnight */ days?: Record<string, number> }
const file = () => join(app.getPath('userData'), 'connection-use.json')
let uses: Record<string, Use> | null = null
let saving: ReturnType<typeof setTimeout> | undefined

const day = () => new Date().toDateString()
const month = () => new Date().toISOString().slice(0, 7)
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Uses on each of the last seven days, oldest first */
export function weekOf(id: string): number[] {
  const days = load()[id]?.days ?? {}
  return Array.from({ length: 7 }, (_, i) => days[isoDay(new Date(Date.now() - (6 - i) * 86_400_000))] ?? 0)
}

function load(): Record<string, Use> {
  if (uses) return uses
  try {
    uses = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, Use>
  } catch {
    uses = {}
  }
  return uses
}

/** A connection was just used */
export function noteUse(id: string) {
  const all = load()
  const u = all[id]
  const d = day()
  const m = month()
  const date = isoDay(new Date())
  const days = Object.fromEntries(Object.entries({ ...(u?.days ?? {}), [date]: (u?.days?.[date] ?? 0) + 1 }).filter(([k]) => k >= isoDay(new Date(Date.now() - 14 * 86_400_000))))
  all[id] = { last: Date.now(), day: d, today: u && u.day === d ? u.today + 1 : 1, month: m, thisMonth: u && u.month === m ? (u.thisMonth ?? 0) + 1 : 1, days }
  clearTimeout(saving)
  saving = setTimeout(() => {
    try {
      writeFileSync(file(), JSON.stringify(all))
    } catch {
      // A record, never a reason to fail
    }
  }, 2000)
}

export function useOf(id: string): { last?: number; today: number; thisMonth: number } {
  const u = load()[id]
  return { last: u?.last, today: u && u.day === day() ? u.today : 0, thisMonth: u && u.month === month() ? (u.thisMonth ?? 0) : 0 }
}
