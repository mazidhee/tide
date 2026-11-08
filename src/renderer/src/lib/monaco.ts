import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

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
    json: 'json', yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css', md: 'markdown', markdown: 'markdown', kotlin: 'kotlin', swift: 'swift', ruby: 'ruby', r: 'r', scala: 'scala', csharp: 'csharp', 'c#': 'csharp'
  }
  return map[n] ?? (monaco.languages.getLanguages().some((l) => l.id === n) ? n : 'plaintext')
}

export function languageForFile(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const byExt: Record<string, string> = { py: 'python', js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp', c: 'c', java: 'java', go: 'go', rs: 'rust', sql: 'sql', sh: 'shell', json: 'json', yml: 'yaml', yaml: 'yaml', html: 'html', css: 'css', md: 'markdown', rb: 'ruby', kt: 'kotlin', swift: 'swift' }
  return byExt[ext] ?? 'plaintext'
}

const hex = (color: string, fallback: string) => {
  // Resolve any CSS colour (including color-mix) to #rrggbb through a canvas
  try {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = fallback
    ctx.fillStyle = color
    const v = ctx.fillStyle as string
    return v.startsWith('#') ? v : fallback
  } catch {
    return fallback
  }
}

/** Defines (and returns) a Monaco theme from Tide's current CSS colours */
export function tideTheme(): string {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fb: string) => hex(css.getPropertyValue(name).trim() || fb, fb)
  const bg = v('--code-bg', '#151515')
  const ink = v('--ink', '#e8e8e8')
  const muted = v('--ink-muted', '#8a8a8a')
  const accent = v('--accent', '#4f8cff')
  const line = v('--bg-hover', '#222222')
  const n = parseInt(bg.slice(1), 16)
  const dark = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 140
  monaco.editor.defineTheme('tide', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.foreground': ink,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': ink,
      'editor.lineHighlightBackground': line,
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': accent,
      'editor.selectionBackground': accent + '40',
      'editorWidget.background': bg,
      'editorGutter.background': bg,
      'scrollbarSlider.background': muted + '33',
      'scrollbarSlider.hoverBackground': muted + '55',
      focusBorder: '#00000000'
    }
  })
  return 'tide'
}

export { monaco }
