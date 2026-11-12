import { useCallback, useState } from 'react'
import type { PersonaId } from '@shared/personas'

export interface PageSettings {
  fullWidth: boolean
  textSize: 's' | 'm' | 'l'
  font: 'serif' | 'sans' | 'mono'
  /** off: no in-note tutor, ask: tutor answers when called, readalong: probes when you pause, strict: challenges every claim */
  tutorMode: 'off' | 'ask' | 'readalong' | 'strict'
  /** Who reads along and answers in this note */
  persona: PersonaId
  /** Reviewers for "Ask the panel" */
  panel: PersonaId[]
  /** Free text instructions for the tutor on this page, e.g. "Quiz me before Friday" */
  tutorInstructions: string
  showResolved: boolean
  /** Read or write, when you switched this note yourself: it opens that way again (shared/noteMode) */
  mode?: 'write' | 'read'
}

const DEFAULTS: PageSettings = {
  fullWidth: false,
  textSize: 'm',
  font: 'serif',
  tutorMode: 'ask',
  persona: 'tutor',
  panel: ['professor', 'interviewer', 'skeptic'],
  tutorInstructions: '',
  showResolved: false
}

const key = (path: string) => `tide.page.${path}`

function load(path: string): PageSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(key(path)) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

export function usePageSettings(path: string) {
  const [state, setState] = useState(() => ({ path, settings: load(path) }))
  // Reload when the note changes
  const settings = state.path === path ? state.settings : load(path)
  if (state.path !== path) setState({ path, settings })

  const update = useCallback(
    (patch: Partial<PageSettings>) => {
      setState((s) => {
        const next = { ...s.settings, ...patch }
        localStorage.setItem(key(path), JSON.stringify(next))
        return { path, settings: next }
      })
    },
    [path]
  )
  return [settings, update] as const
}

export const TEXT_SCALE = { s: 0.9, m: 1, l: 1.14 }
export const FONT_VAR = { serif: 'var(--font-read-serif)', sans: 'var(--font-ui)', mono: 'var(--font-code)' }
