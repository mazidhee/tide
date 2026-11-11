/**
 * When each connection was last used, and how often today: noted where Tide calls it, kept in
 * memory and saved now and then (userData/connection-use.json), for the Connections page.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

type Use = { last: number; day: string; today: number; month?: string; thisMonth?: number; /** Every use, for one-time credits */ total?: number; /** Uses by date (yyyy-mm-dd), the last fortnight */ days?: Record<string, number> }
const file = () => join(app.getPath('userData'), 'connection-use.json')
let uses: Record<string, Use> | null = null
let saving: ReturnType<typeof setTimeout> | undefined

const day = () => new Date().toDateString()
const month = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
/** Midnight i days ago, stepping calendar days so a clock change doesn't skip or repeat one */
const daysAgo = (i: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - i)
  return d
}
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Uses on each of the last seven days, oldest first */
export function weekOf(id: string): number[] {
  const days = load()[id]?.days ?? {}
  return Array.from({ length: 7 }, (_, i) => days[isoDay(daysAgo(6 - i))] ?? 0)
}

function load(): Record<string, Use> {
  if (uses) return uses
  // Counts noted in the last moments before quitting still count against the caps
  if (typeof app.on === 'function') app.on('before-quit', () => saving && save())
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
  const days = Object.fromEntries(Object.entries({ ...(u?.days ?? {}), [date]: (u?.days?.[date] ?? 0) + 1 }).filter(([k]) => k >= isoDay(daysAgo(14))))
  all[id] = { last: Date.now(), day: d, today: u && u.day === d ? u.today + 1 : 1, month: m, thisMonth: u && u.month === m ? (u.thisMonth ?? 0) + 1 : 1, total: (u?.total ?? u?.thisMonth ?? 0) + 1, days }
  clearTimeout(saving)
  saving = setTimeout(save, 2000)
}

function save() {
  clearTimeout(saving)
  saving = undefined
  if (!uses) return
  try {
    writeFileSync(file(), JSON.stringify(uses))
  } catch {
    // A record, never a reason to fail
  }
}


export function useOf(id: string): { last?: number; today: number; thisMonth: number; total: number } {
  const u = load()[id]
  return { last: u?.last, today: u && u.day === day() ? u.today : 0, thisMonth: u && u.month === month() ? (u.thisMonth ?? 0) : 0, total: u?.total ?? u?.thisMonth ?? 0 }
}
