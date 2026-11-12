import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { fileTree, foldersOf, fuzzyScore, problemCounts, quickOpen, sortProblems, type Problem } from '../src/renderer/src/lib/codeProject'
import { contrast, readable, tokenThemeFor, TOKEN_THEME, type TokenThemeName } from '../src/renderer/src/lib/codeTheme'

describe('the explorer tree', () => {
  it('nests folders, folders before files, names in natural order', () => {
    const t = fileTree(['Code/b.py', 'Code/proj/main.py', 'Code/a.py', 'Code/proj/lib/x10.py', 'Code/proj/lib/x9.py', 'Notes/x.md'], 'Code')
    expect(t.map((n) => n.name)).toEqual(['proj', 'a.py', 'b.py'])
    expect(t[0].children!.map((n) => n.name)).toEqual(['lib', 'main.py'])
    expect(t[0].children![0].children!.map((n) => n.path)).toEqual(['Code/proj/lib/x9.py', 'Code/proj/lib/x10.py'])
  })

  it('lists the folders to open for a file', () => {
    expect(foldersOf('Code/proj/lib/x.py', 'Code')).toEqual(['Code/proj', 'Code/proj/lib'])
    expect(foldersOf('Code/x.py', 'Code')).toEqual([])
  })
})

describe('quick open (⌘P)', () => {
  const paths = ['Code/Key-value store/kv.py', 'Code/Key-value store/test_kv.py', 'Code/scratch.py', 'Code/analysis/main.py', 'Code/kv-notes/readme.md']
  it('matches characters in order, file names first', () => {
    expect(fuzzyScore('xyz', 'Code/scratch.py')).toBeNull()
    expect(quickOpen('kv', paths)[0]).toBe('Code/Key-value store/kv.py')
    expect(quickOpen('main', paths)).toEqual(['Code/analysis/main.py'])
    expect(quickOpen('tkv', paths)[0]).toBe('Code/Key-value store/test_kv.py')
  })

  it('lists everything for an empty query', () => {
    expect(quickOpen('', paths)).toHaveLength(paths.length)
  })
})

describe('the problems panel', () => {
  const p = (path: string, severity: number, line: number): Problem => ({ path, severity, message: 'm', line, column: 1 })
  it('puts errors first, then by file and line, and leaves hints to the editor', () => {
    const list = sortProblems([p('b.py', 4, 1), p('a.py', 8, 9), p('a.py', 1, 1), p('a.py', 8, 2), p('a.py', 2, 3)])
    expect(list.map((x) => [x.path, x.severity, x.line])).toEqual([
      ['a.py', 8, 2],
      ['a.py', 8, 9],
      ['b.py', 4, 1],
      ['a.py', 2, 3]
    ])
    const c = problemCounts(list)
    expect([c.errors, c.warnings]).toEqual([2, 1])
    expect(c.byPath.get('a.py')).toEqual({ errors: 2, warnings: 0 })
  })
})

/** Tide's code backgrounds, read from its stylesheets: every theme of both designs */
function codeBackgrounds(): { design: string; theme: string; bg: string }[] {
  const out: { design: string; theme: string; bg: string }[] = []
  const classic = readFileSync('src/renderer/src/styles/theme.css', 'utf8')
  for (const m of classic.matchAll(/:root\[data-theme='(\w+)'\]\s*\{([^}]*)\}/g)) {
    const bg = /--code-bg:\s*(#[0-9a-f]{3,6})/i.exec(m[2])?.[1]
    if (bg) out.push({ design: 'classic', theme: m[1], bg })
  }
  const tide = readFileSync('src/renderer/src/styles/tide/tokens.css', 'utf8')
  for (const m of tide.matchAll(/:root\[data-design='tide'\]\[data-theme='(\w+)'\]\s*\{([^}]*)\}/g)) {
    const bg = /--sunk:\s*(#[0-9a-f]{3,6})/i.exec(m[2])?.[1]
    if (bg) out.push({ design: 'tide', theme: m[1], bg })
  }
  return out
}

async function tokenColors(name: TokenThemeName): Promise<{ color: string; comment: boolean }[]> {
  const t = (await import(`@shikijs/themes/${name}`)).default as { tokenColors: { scope?: string | string[]; settings: { foreground?: string } }[] }
  return t.tokenColors
    .filter((s) => s.settings.foreground && /^#[0-9a-f]{6}$/i.test(s.settings.foreground))
    .map((s) => ({ color: s.settings.foreground!, comment: (Array.isArray(s.scope) ? s.scope : [s.scope]).some((x) => x === 'comment') }))
}

describe('VS Code’s syntax colours on Tide’s themes', () => {
  const bgs = codeBackgrounds()

  it('finds all six themes in both designs', () => {
    expect(bgs.filter((b) => b.design === 'classic').map((b) => b.theme).sort()).toEqual(Object.keys(TOKEN_THEME).sort())
    expect(bgs.filter((b) => b.design === 'tide').map((b) => b.theme).sort()).toEqual(Object.keys(TOKEN_THEME).sort())
  })

  it('picks a light VS Code theme for light backgrounds and a dark one for dark', () => {
    for (const { theme, bg } of bgs) {
      const dark = contrast(bg, '#000000') < contrast(bg, '#ffffff')
      const name = tokenThemeFor(theme, dark)
      expect(['light-plus', 'solarized-light'].includes(name), `${theme} ${bg}`).toBe(!dark)
    }
    expect(tokenThemeFor('sepia', false)).toBe('solarized-light')
    expect(tokenThemeFor('ember', true)).toBe('monokai')
    expect(tokenThemeFor('unknown', true)).toBe('dark-plus')
  })

  it('keeps every token colour readable (AA; comments at least 3:1), changing only those that need it', async () => {
    for (const { theme, bg, design } of bgs) {
      const dark = contrast(bg, '#000000') < contrast(bg, '#ffffff')
      for (const { color, comment } of await tokenColors(tokenThemeFor(theme, dark))) {
        const min = comment ? 3 : 4.5
        const out = readable(color, bg, min)
        expect(contrast(out, bg), `${design}/${theme}: ${color} → ${out} on ${bg}`).toBeGreaterThanOrEqual(min)
        if (contrast(color, bg) >= min) expect(out).toBe(color.toLowerCase())
      }
    }
  })
})
