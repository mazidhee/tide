import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { isDark, tokenThemeFor } from './codeTheme'

/**
 * Monaco, the editor inside VS Code, set up once: its language workers run locally (no CDN), and
 * its colours follow Tide's theme and accent.
 */
;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

/** Monaco language ids for the names used around Tide ("python", "c++", "js"…) */
export function monacoLanguage(name: string | undefined): string {
  const n = (name ?? '').toLowerCase().trim()
  const map: Record<string, string> = {
    py: 'python', python: 'python', js: 'javascript', javascript: 'javascript', node: 'javascript', ts: 'typescript', typescript: 'typescript',
    'c++': 'cpp', cpp: 'cpp', c: 'c', java: 'java', go: 'go', golang: 'go', rust: 'rust', rs: 'rust', sql: 'sql', bash: 'shell', sh: 'shell', shell: 'shell', zsh: 'shell',
    json: 'json', yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css', md: 'markdown', markdown: 'markdown', kotlin: 'kotlin', swift: 'swift', ruby: 'ruby', r: 'r', scala: 'scala', csharp: 'csharp', 'c#': 'csharp', sol: 'sol', solidity: 'sol'
  }
  return map[n] ?? (monaco.languages.getLanguages().some((l) => l.id === n) ? n : 'plaintext')
}

export function languageForFile(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const byExt: Record<string, string> = { py: 'python', js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp', c: 'c', java: 'java', go: 'go', rs: 'rust', sql: 'sql', sh: 'shell', json: 'json', yml: 'yaml', yaml: 'yaml', html: 'html', css: 'css', md: 'markdown', rb: 'ruby', kt: 'kotlin', swift: 'swift', sol: 'sol' }
  return byExt[ext] ?? 'plaintext'
}

const hex = (color: string, fallback: string) => {
  // Resolve any CSS colour (including color-mix) to #rrggbb through a canvas
  try {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = fallback
    ctx.fillStyle = color
    const v = ctx.fillStyle as string
    if (v.startsWith('#')) return v
    // Translucent colours come back as rgba(): Monaco takes them as #rrggbbaa
    const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(v)
    if (!m) return fallback
    const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
    return `#${h(+m[1])}${h(+m[2])}${h(+m[3])}${m[4] !== undefined ? h(+m[4] * 255) : ''}`
  } catch {
    return fallback
  }
}

let textmate: typeof import('./textmate') | null = null

function themeColors() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fb: string) => hex(css.getPropertyValue(name).trim() || fb, fb)
  const bg = v('--code-bg', '#151515')
  return {
    bg,
    ink: v('--ink', '#e8e8e8'),
    muted: v('--ink-muted', '#8a8a8a'),
    accent: v('--accent', '#4f8cff'),
    line: v('--bg-hover', '#222222'),
    raised: v('--bg-raised', bg),
    border: v('--line-strong', '#333333'),
    danger: v('--danger', '#e5534b'),
    warn: v('--warn', '#d29922'),
    info: v('--info', '#4f8cff'),
    ok: v('--good-mark', '#3fb950'),
    dark: isDark(bg)
  }
}

const tokenTheme = () => tokenThemeFor(document.documentElement.dataset.theme, themeColors().dark)

/**
 * Defines (and returns) Monaco's theme from Tide's current CSS colours. Syntax colours come from
 * VS Code's theme for this Tide theme (codeTheme.ts) once TextMate highlighting has loaded; until
 * then, and for languages without a grammar, Monaco's own light or dark rules.
 */
export function tideTheme(): string {
  const { bg, ink, muted, accent, line, raised, border, danger, warn, info, ok, dark } = themeColors()
  const a = (c: string, alpha: string) => c.slice(0, 7) + alpha
  monaco.editor.defineTheme('tide', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: textmate?.rulesFor(bg, ink) ?? [],
    colors: {
      'editor.background': bg,
      'editor.foreground': ink,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': ink,
      'editor.lineHighlightBackground': line,
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': accent,
      'editor.selectionBackground': accent.slice(0, 7) + '40',
      'editorWidget.background': bg,
      'editorGutter.background': bg,
      'editorStickyScroll.background': bg,
      'peekViewEditor.background': bg,
      'peekViewResult.background': bg,
      'scrollbarSlider.background': muted.slice(0, 7) + '33',
      'scrollbarSlider.hoverBackground': muted.slice(0, 7) + '55',
      focusBorder: '#00000000',
      // Widgets (suggestions, hovers, find, peek) sit on Tide's raised surface
      'editorWidget.border': border,
      'editorSuggestWidget.background': raised,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': a(accent, '2e'),
      'editorHoverWidget.background': raised,
      'editorHoverWidget.border': border,
      'editorError.foreground': danger,
      'editorWarning.foreground': warn,
      'editorInfo.foreground': info,
      'editorOverviewRuler.errorForeground': danger,
      'editorOverviewRuler.warningForeground': warn,
      // Diffs: Claude's proposals and git, in Tide's own green and red
      'diffEditor.insertedTextBackground': a(ok, '30'),
      'diffEditor.removedTextBackground': a(danger, '30'),
      'diffEditor.insertedLineBackground': a(ok, '18'),
      'diffEditor.removedLineBackground': a(danger, '18'),
      'diffEditorGutter.insertedLineBackground': a(ok, '24'),
      'diffEditorGutter.removedLineBackground': a(danger, '24'),
      'diffEditor.diagonalFill': a(muted, '22'),
      'diffEditor.unchangedRegionBackground': raised,
      'diffEditor.unchangedRegionForeground': muted,
      'editor.findMatchHighlightBackground': a(accent, '30'),
      'editor.findMatchBackground': a(accent, '55'),
      'editor.wordHighlightBackground': a(accent, '1f'),
      'editor.wordHighlightStrongBackground': a(accent, '2e'),
      'editorBracketMatch.background': a(accent, '22'),
      'editorBracketMatch.border': '#00000000',
      'editorIndentGuide.background1': a(muted, '22'),
      'editorIndentGuide.activeBackground1': a(muted, '55'),
      'editorGhostText.foreground': a(muted, 'aa'),
      'peekView.border': accent,
      'peekViewTitle.background': raised,
      'list.hoverBackground': line,
      'list.activeSelectionBackground': a(accent, '2e'),
      'list.focusBackground': a(accent, '2e'),
      'list.highlightForeground': accent,
      'quickInput.background': raised,
      'input.background': bg,
      'input.border': border
    }
  })
  return 'tide'
}

/** VS Code's TextMate highlighting for a language, loaded on first use (lib/textmate.ts) */
export async function highlight(languageId: string): Promise<void> {
  try {
    textmate ??= await import('./textmate')
    if (!textmate.hasGrammar(languageId)) return
    if (await textmate.ensure(monaco, languageId, tokenTheme())) monaco.editor.setTheme(tideTheme())
  } catch (e) {
    // Monaco's own highlighting stays
    console.warn('[textmate]', e)
  }
}

/** Tide's theme changed: the editor's colours, and the VS Code theme behind the syntax colours */
export async function refreshTheme(): Promise<void> {
  monaco.editor.setTheme(tideTheme())
  if (textmate && (await textmate.syncTheme(monaco, tokenTheme()))) monaco.editor.setTheme(tideTheme())
}

export { monaco }
