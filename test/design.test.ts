import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN, DESIGNS, readingFace, resolveDesign } from '../src/shared/design'
import { DEFAULT_SETTINGS, withDefaults } from '../src/shared/settingsDefaults'

describe('the design setting', () => {
  it('defaults to the new design', () => {
    expect(DEFAULT_DESIGN).toBe('tide')
    expect(DEFAULT_SETTINGS.design).toBe('tide')
    expect(withDefaults(null).design).toBe('tide')
  })

  it('gives the new design to someone whose settings were saved before it existed', () => {
    const before = { vaultPath: '/notes', theme: 'midnight' as const, accent: '#4f7cff', fontSize: 19 }
    const s = withDefaults(before)
    expect(s.design).toBe('tide')
    // …and nothing they had chosen is lost
    expect(s.theme).toBe('midnight')
    expect(s.accent).toBe('#4f7cff')
    expect(s.fontSize).toBe(19)
    expect(s.vaultPath).toBe('/notes')
  })

  it('keeps classic selectable, and remembers it', () => {
    expect(DESIGNS.map((d) => d.id)).toEqual(['tide', 'classic'])
    expect(resolveDesign('classic')).toBe('classic')
    expect(withDefaults({ design: 'classic' }).design).toBe('classic')
    expect(withDefaults({ design: 'tide' }).design).toBe('tide')
  })

  it('falls back to the default for anything it does not know', () => {
    for (const v of [undefined, null, '', 'Classic', 'new', 3]) expect(resolveDesign(v)).toBe('tide')
    expect(withDefaults({ design: 'nonsense' as never }).design).toBe('tide')
  })

  it('keeps the model settings merged, as before', () => {
    const s = withDefaults({ ai: { model: 'gemma' } as never })
    expect(s.ai.model).toBe('gemma')
    expect(s.ai.baseUrl).toBe(DEFAULT_SETTINGS.ai.baseUrl)
  })

  it('reads in the serif in the new design and leaves the classic reading font alone', () => {
    expect(readingFace({ design: 'tide' })).toBe('serif')
    expect(readingFace({ design: 'tide', tideReadingFont: 'sans' })).toBe('sans')
    expect(readingFace({ design: 'tide', readingFont: 'sans' })).toBe('serif')
    expect(readingFace({ design: 'classic' })).toBe('sans')
    expect(readingFace({ design: 'classic', readingFont: 'serif', tideReadingFont: 'sans' })).toBe('serif')
    expect(readingFace({})).toBe('serif')
  })
})

// ---------- Every theme, mapped onto the new design's roles, holds WCAG AA ----------

const css = readFileSync(resolve(__dirname, '../src/renderer/src/styles/tide/tokens.css'), 'utf8')
const THEMES = ['light', 'sepia', 'dark', 'graphite', 'midnight', 'ember'] as const

function tokensOf(theme: string): Record<string, string> {
  const at = css.indexOf(`:root[data-design='tide'][data-theme='${theme}'] {`)
  expect(at, `a block for ${theme}`).toBeGreaterThan(-1)
  const body = css.slice(at, css.indexOf('}', at))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** One colour laid over another at a share, as color-mix(in srgb) does */
const mix = (a: string, share: number, b: string) =>
  '#' +
  [1, 3, 5]
    .map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * share + parseInt(b.slice(i, i + 2), 16) * (1 - share)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')

describe('the new design in every theme', () => {
  const ROLES = ['--paper', '--rail', '--sunk', '--raised', '--line', '--line-2', '--ink', '--ink-2', '--ink-3', '--accent', '--accent-ink', '--good', '--warn', '--bad', '--a1', '--a2', '--a3', '--a4', '--a5']

  it.each(THEMES)('%s maps every role to a plain colour', (theme) => {
    const t = tokensOf(theme)
    for (const role of ROLES) expect(t[role], `${theme} ${role}`).toMatch(/^#[0-9a-f]{6}$/)
  })

  it.each(THEMES)('%s: text is AA (4.5:1) on every surface', (theme) => {
    const t = tokensOf(theme)
    for (const surface of ['--paper', '--rail', '--sunk', '--raised'])
      for (const ink of ['--ink', '--ink-2', '--ink-3']) expect(contrast(t[ink], t[surface]), `${theme} ${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(THEMES)('%s: the action colour reads as text, as a button, and on its own soft ground', (theme) => {
    const t = tokensOf(theme)
    const soft = mix(t['--accent'], parseFloat(t['--soft-mix']) / 100, t['--paper'])
    const text = mix(t['--accent'], 0.88, t['--ink'])
    expect(contrast(text, t['--paper']), 'accent text on paper').toBeGreaterThanOrEqual(4.5)
    expect(contrast(text, t['--rail']), 'accent text on the rail').toBeGreaterThanOrEqual(4.5)
    expect(contrast(text, soft), 'accent text on accent-soft').toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--accent-ink'], t['--accent']), 'label on a primary button').toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--ink'], soft), 'ink on accent-soft').toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--ink-2'], soft), 'secondary ink on accent-soft').toBeGreaterThanOrEqual(4.5)
  })

  it.each(THEMES)('%s: good, warn and bad read as text', (theme) => {
    const t = tokensOf(theme)
    for (const state of ['--good', '--warn', '--bad'])
      for (const surface of ['--paper', '--sunk', '--raised']) expect(contrast(t[state], t[surface]), `${theme} ${state} on ${surface}`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(THEMES)('%s: the five area colours are distinct and visible as marks (3:1 is not asked: they sit beside a label)', (theme) => {
    const t = tokensOf(theme)
    const areas = ['--a1', '--a2', '--a3', '--a4', '--a5'].map((a) => t[a])
    expect(new Set(areas).size).toBe(5)
    for (const a of areas) expect(contrast(a, t['--paper']), `${theme} ${a}`).toBeGreaterThanOrEqual(1.8)
  })

  it('scopes every rule of the new design under data-design, so classic is untouched', () => {
    const dir = resolve(__dirname, '../src/renderer/src/styles/tide')
    const { readdirSync } = require('fs') as typeof import('fs')
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.css') && x !== 'fonts.css')) {
      // Strip comments, then every top-level rule must start from the scoped root (or be an at-rule wrapping ones that do)
      const src = readFileSync(resolve(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const scoped = (sel: string) => /^(:root\[data-design='tide'\]|:where\(:root\[data-design='tide'\]\) )/.test(sel.trim())
      /** A selector list split at its top-level commas (not the ones inside :where(a, b)) */
      const parts = (sel: string) => sel.split(/,(?![^()]*\))/)
      let depth = 0
      let outer = ''
      let head = ''
      for (const ch of src) {
        if (ch === '{') {
          const sel = head.trim()
          if (depth === 0 && !sel.startsWith('@')) for (const part of parts(sel)) expect(scoped(part), `${f}: "${part.trim().slice(0, 60)}"`).toBe(true)
          if (depth === 1 && /^@(media|supports|container)/.test(outer)) for (const part of parts(sel)) expect(scoped(part), `${f}: "${part.trim().slice(0, 60)}"`).toBe(true)
          if (depth === 0) outer = sel
          depth++
          head = ''
        } else if (ch === '}') {
          depth--
          head = ''
        } else if (ch === ';') head = ''
        else head += ch
      }
    }
  })
})
