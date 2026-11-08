import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Settings } from '@shared/types'

const DEFAULTS: Settings = {
  vaultPath: null,
  libraryFolder: 'Library',
  theme: 'system',
  sidebarCollapsed: false,
  chatOpen: true,
  readingWidth: 'normal',
  readingFont: 'sans',
  studyTimers: true,
  fontSize: 17,
  ai: {
    baseUrl: 'http://localhost:8080/v1',
    apiKey: '',
    model: '',
    embeddingModel: '',
    temperature: 0.4,
    agent: true,
    contextTokens: 16384,
    webSearch: { provider: 'wikipedia' }
  }
}

const settingsPath = () => join(app.getPath('userData'), 'settings.json')

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  try {
    const stored = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    cache = { ...DEFAULTS, ...stored, ai: { ...DEFAULTS.ai, ...(stored.ai ?? {}) } }
  } catch {
    cache = structuredClone(DEFAULTS)
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
