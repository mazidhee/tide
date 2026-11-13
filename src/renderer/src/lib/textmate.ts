/**
 * VS Code's syntax highlighting in Monaco: the TextMate grammars VS Code uses and the token
 * colours of its built-in themes, through shiki (its grammars and themes, and vscode-textmate).
 * Regular expressions run on shiki's JavaScript engine, so there is no Oniguruma WebAssembly to
 * load. Loaded on first use; each grammar is its own chunk, fetched when a file in that language
 * first opens.
 *
 * Tokens are named by colour (tm<index>[.<font style>]), the way VS Code's own Monaco does it:
 * the grammar resolves scopes to a colour with the theme's full selector rules, and Monaco's theme
 * only has to map each colour index to a readable colour on Tide's background (codeTheme.ts).
 */
import type * as Monaco from 'monaco-editor'
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration, type ThemeRegistrationRaw } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { EncodedTokenMetadata, INITIAL, type StateStack } from 'shiki/textmate'
import { readable, type TokenThemeName } from './codeTheme'

type Loader<T> = () => Promise<{ default: T }>

/**
 * Monaco language id → its grammar (shiki's name differs for the shell). C++ and Ruby keep Monaco's
 * own highlighting: their grammars pull in others (GLSL, Haml, Lua…), about 1 MB, whose licences
 * aren't all known here.
 */
const GRAMMARS: Record<string, Loader<LanguageRegistration[]>> = {
  python: () => import('@shikijs/langs/python'),
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  // The IDE's TypeScript and JavaScript, served by typescript-language-server (lib/ide/languages)
  'typescript-ide': () => import('@shikijs/langs/tsx'),
  'javascript-ide': () => import('@shikijs/langs/javascript'),
  c: () => import('@shikijs/langs/c'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  sql: () => import('@shikijs/langs/sql'),
  shell: () => import('@shikijs/langs/shellscript'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  markdown: () => import('@shikijs/langs/markdown'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  csharp: () => import('@shikijs/langs/csharp'),
  r: () => import('@shikijs/langs/r'),
  scala: () => import('@shikijs/langs/scala'),
  // Monaco's id for Solidity is sol
  sol: () => import('@shikijs/langs/solidity')
}
const SHIKI_NAME: Record<string, string> = { sol: 'solidity', shell: 'shellscript', 'typescript-ide': 'tsx', 'javascript-ide': 'javascript' }

const THEMES: Record<TokenThemeName, Loader<ThemeRegistrationRaw>> = {
  'dark-plus': () => import('@shikijs/themes/dark-plus') as Promise<{ default: ThemeRegistrationRaw }>,
  'light-plus': () => import('@shikijs/themes/light-plus') as Promise<{ default: ThemeRegistrationRaw }>,
  'solarized-light': () => import('@shikijs/themes/solarized-light') as Promise<{ default: ThemeRegistrationRaw }>,
  monokai: () => import('@shikijs/themes/monokai') as Promise<{ default: ThemeRegistrationRaw }>
}

export const hasGrammar = (languageId: string) => languageId in GRAMMARS

let highlighter: Promise<HighlighterCore> | null = null
let themeName: TokenThemeName | null = null
let colorMap: string[] = []
/** Colour indexes the theme uses for comments, which may read a little quieter */
let commentColors = new Set<number>()
const providers = new Map<string, Monaco.IDisposable>()
const loading = new Map<string, Promise<void>>()

const getHighlighter = () => (highlighter ??= createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }))

class TMState implements Monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return new TMState(this.stack)
  }
  equals(other: Monaco.languages.IState) {
    return other instanceof TMState && (other.stack === this.stack || other.stack.equals(this.stack))
  }
}

const MAX_LINE = 20_000

function register(monaco: typeof Monaco, hl: HighlighterCore, languageId: string) {
  providers.get(languageId)?.dispose()
  const grammar = hl.getLanguage(SHIKI_NAME[languageId] ?? languageId)
  providers.set(
    languageId,
    monaco.languages.setTokensProvider(languageId, {
      getInitialState: () => new TMState(INITIAL),
      tokenize(line, state) {
        const s = state as TMState
        if (line.length > MAX_LINE) return { endState: s, tokens: [{ startIndex: 0, scopes: '' }] }
        const r = grammar.tokenizeLine2(line, s.stack, 500)
        const tokens: Monaco.languages.IToken[] = []
        for (let i = 0; i < r.tokens.length; i += 2) {
          const meta = r.tokens[i + 1]
          const fs = EncodedTokenMetadata.getFontStyle(meta)
          tokens.push({ startIndex: r.tokens[i], scopes: `tm${EncodedTokenMetadata.getForeground(meta)}${fs > 0 ? `.${fs}` : ''}` })
        }
        return { endState: new TMState(r.ruleStack), tokens }
      }
    })
  )
}

async function setTheme(monaco: typeof Monaco, hl: HighlighterCore, name: TokenThemeName): Promise<boolean> {
  if (themeName === name) return false
  if (!hl.getLoadedThemes().includes(name)) await hl.loadTheme((await THEMES[name]()).default)
  const { colorMap: map } = hl.setTheme(name)
  colorMap = map.map((c) => c.toLowerCase())
  const theme = hl.getTheme(name)
  commentColors = new Set(
    (theme.settings ?? [])
      .filter((s) => (Array.isArray(s.scope) ? s.scope : [s.scope]).some((x) => x === 'comment' || x === 'punctuation.definition.comment'))
      .map((s) => colorMap.indexOf(String(s.settings?.foreground ?? '').toLowerCase()))
      .filter((i) => i > 0)
  )
  themeName = name
  // Colour indexes changed: every grammar's tokens are drawn again
  for (const id of providers.keys()) register(monaco, hl, id)
  return true
}

/**
 * Highlighting for one language under the given VS Code theme. True when the colours changed, so
 * the caller redefines Monaco's theme with rulesFor().
 */
export function ensure(monaco: typeof Monaco, languageId: string, theme: TokenThemeName): Promise<boolean> {
  return serial(async () => {
    const hl = await getHighlighter()
    const changed = await setTheme(monaco, hl, theme)
    const load = GRAMMARS[languageId]
    if (!load || providers.has(languageId)) return changed
    let pending = loading.get(languageId)
    if (!pending) {
      pending = (async () => {
        const name = SHIKI_NAME[languageId] ?? languageId
        if (!hl.getLoadedLanguages().includes(name)) await hl.loadLanguage((await load()).default)
        register(monaco, hl, languageId)
      })()
      loading.set(languageId, pending)
    }
    await pending
    return true
  })
}

/** Changes the VS Code theme for every language already highlighted; true when it changed */
export function syncTheme(monaco: typeof Monaco, theme: TokenThemeName): Promise<boolean> {
  if (!highlighter) return Promise.resolve(false)
  return serial(async () => setTheme(monaco, await highlighter!, theme))
}

/** One change at a time: two editors opening together must not load and register twice */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => {})
  return next
}

const STYLE = (fs: number) => [fs & 1 ? 'italic' : '', fs & 2 ? 'bold' : '', fs & 4 ? 'underline' : '', fs & 8 ? 'strikethrough' : ''].filter(Boolean).join(' ')

/** Monaco theme rules for the token names above, each colour made readable on Tide's background */
export function rulesFor(bg: string, ink: string): Monaco.editor.ITokenThemeRule[] {
  const rules: Monaco.editor.ITokenThemeRule[] = []
  colorMap.forEach((c, i) => {
    if (!i || !c) return
    // Index 1 is the theme's plain text: Tide's own ink keeps the editor in step with the page
    const fg = (i === 1 ? ink : readable(c, bg, commentColors.has(i) ? 3 : 4.5)).replace('#', '')
    rules.push({ token: `tm${i}`, foreground: fg })
    for (let fs = 1; fs < 16; fs++) rules.push({ token: `tm${i}.${fs}`, foreground: fg, fontStyle: STYLE(fs) })
  })
  return rules
}
