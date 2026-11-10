/**
 * When each connection was last used, and how often today: noted where Tide calls it, kept in
 * memory and saved now and then (userData/connection-use.json), for the Connections page.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

type Use = { last: number; day: string; today: number }
const file = () => join(app.getPath('userData'), 'connection-use.json')
let uses: Record<string, Use> | null = null
let saving: ReturnType<typeof setTimeout> | undefined

const day = () => new Date().toDateString()

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
  all[id] = { last: Date.now(), day: d, today: u && u.day === d ? u.today + 1 : 1 }
  clearTimeout(saving)
  saving = setTimeout(() => {
    try {
      writeFileSync(file(), JSON.stringify(all))
    } catch {
      // A record, never a reason to fail
    }
  }, 2000)
}

export function useOf(id: string): { last?: number; today: number } {
  const u = load()[id]
  return { last: u?.last, today: u && u.day === day() ? u.today : 0 }
}
