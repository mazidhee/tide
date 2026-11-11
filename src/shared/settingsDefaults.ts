import { DEFAULT_DESIGN, resolveDesign } from './design'
import type { Settings } from './types'

/** What a setting is when nothing has been chosen */
export const DEFAULT_SETTINGS: Settings = {
  vaultPath: null,
  libraryFolder: 'Library',
  theme: 'system',
  design: DEFAULT_DESIGN,
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

/**
 * Stored settings over the defaults. A settings file written before a setting existed simply
 * lacks it and takes the default: that is how everyone, including people who already use Tide,
 * gets the new design, and how choosing 'classic' is remembered.
 */
export function withDefaults(stored: Partial<Settings> | null | undefined): Settings {
  const s = stored ?? {}
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...s,
    design: resolveDesign(s.design),
    ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai ?? {}) }
  }
}
