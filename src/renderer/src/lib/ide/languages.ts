/**
 * Which language a workspace file is, and which language server serves it. TypeScript and
 * JavaScript files in the IDE get their own Monaco language ids, served by typescript-language-
 * server, which knows the whole project (its tsconfig, node_modules and other files). Monaco's
 * built-in TypeScript, which sees one file at a time, keeps serving the editors in lessons. Two
 * ids keep the two from answering the same file twice.
 */
import type * as Monaco from 'monaco-editor'
// Monaco's own brackets, comments and auto-closing pairs for TypeScript and JavaScript
import { conf as tsConf } from 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js'
import { conf as jsConf } from 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js'
import type { LspServerId } from '@shared/ide'

export const TS_IDE = 'typescript-ide'
export const JS_IDE = 'javascript-ide'

const BY_EXT: Record<string, string> = {
  py: 'python', pyi: 'python',
  ts: TS_IDE, tsx: TS_IDE, mts: TS_IDE, cts: TS_IDE,
  js: JS_IDE, jsx: JS_IDE, mjs: JS_IDE, cjs: JS_IDE,
  c: 'c', h: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', r: 'r', scala: 'scala', cs: 'csharp',
  sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell',
  json: 'json', jsonc: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', xml: 'xml', svg: 'xml', dockerfile: 'dockerfile', graphql: 'graphql', proto: 'protobuf', lua: 'lua', php: 'php'
}

const BY_NAME: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'shell', '.gitignore': 'ini', '.env': 'ini', 'cargo.lock': 'ini' }

/** The Monaco language of a workspace file; `tsServer` says whether the TypeScript server is there */
export function languageOf(path: string, tsServer = true): string {
  const name = path.split('/').pop()!.toLowerCase()
  const lang = BY_NAME[name] ?? BY_EXT[name.includes('.') ? name.split('.').pop()! : ''] ?? 'plaintext'
  if (!tsServer && lang === TS_IDE) return 'typescript'
  if (!tsServer && lang === JS_IDE) return 'javascript'
  return lang
}

/** The language server for a Monaco language (Python's is separate, lib/lsp/python) */
export const SERVER_FOR: Record<string, LspServerId> = { [TS_IDE]: 'typescript', [JS_IDE]: 'typescript', rust: 'rust', c: 'clangd', cpp: 'clangd', go: 'go' }

/** The languageId the server expects for a file */
export function lspLanguageId(monacoId: string, path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (monacoId === TS_IDE) return ext === 'tsx' ? 'typescriptreact' : 'typescript'
  if (monacoId === JS_IDE) return ext === 'jsx' ? 'javascriptreact' : 'javascript'
  return monacoId
}

const LABELS: Record<string, string> = { [TS_IDE]: 'TypeScript', [JS_IDE]: 'JavaScript', typescript: 'TypeScript', javascript: 'JavaScript', cpp: 'C++', c: 'C', csharp: 'C#', plaintext: 'Plain text', ini: 'Config', json: 'JSON', yaml: 'YAML', html: 'HTML', css: 'CSS', sql: 'SQL', shell: 'Shell', go: 'Go' }
export const languageLabel = (id: string) => LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

/** What Run does for a file: the sandbox runs these (main/languages) */
export const RUNNABLE = new Set(['python', 'javascript', JS_IDE, 'typescript', TS_IDE, 'c', 'cpp', 'rust', 'go', 'java', 'ruby', 'swift', 'kotlin', 'shell'])

let registered = false
/** Registers the IDE's TypeScript and JavaScript ids with Monaco, once */
export function registerIdeLanguages(monaco: typeof Monaco) {
  if (registered) return
  registered = true
  monaco.languages.register({ id: TS_IDE, aliases: ['TypeScript'] })
  monaco.languages.register({ id: JS_IDE, aliases: ['JavaScript'] })
  monaco.languages.setLanguageConfiguration(TS_IDE, tsConf as Monaco.languages.LanguageConfiguration)
  monaco.languages.setLanguageConfiguration(JS_IDE, jsConf as Monaco.languages.LanguageConfiguration)
}
