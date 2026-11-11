import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Settings } from '@shared/types'
import { withDefaults } from '@shared/settingsDefaults'

const settingsPath = () => join(app.getPath('userData'), 'settings.json')

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  try {
    const stored = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    cache = withDefaults(stored)
  } catch {
    cache = withDefaults(null)
  }
  return cache!
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  cache = {
    ...current,
    ...patch,
    ai: { ...current.ai, ...(patch.ai ?? {}) }
  }
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(cache, null, 2))
  return cache
}
