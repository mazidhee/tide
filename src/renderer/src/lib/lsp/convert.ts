/**
 * Language Server Protocol shapes turned into Monaco's, kept free of Monaco itself so they can be
 * tested in Node (as ruff/markers.ts is): positions go from 0-based to 1-based, and enums are
 * passed as Monaco's numbers or names.
 */
import type { Diagnostic, MarkupContent, Range } from 'vscode-languageserver-types'
import { Severity, type Marker } from '../ruff/markers'

export const PYRIGHT_OWNER = 'pyright'

export interface MonacoRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export const toRange = (r: Range): MonacoRange => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1
})

export const toPosition = (p: { lineNumber: number; column: number }) => ({ line: p.lineNumber - 1, character: p.column - 1 })

const SEVERITY: Record<number, number> = { 1: Severity.Error, 2: Severity.Warning, 3: Severity.Info, 4: Severity.Hint }

export function diagnosticToMarker(d: Diagnostic): Marker {
  const r = toRange(d.range)
  // An empty range (end of file) still needs a character for Monaco to draw
  if (r.endLineNumber === r.startLineNumber && r.endColumn <= r.startColumn) r.endColumn = r.startColumn + 1
  const code = typeof d.code === 'object' && d.code ? String((d.code as { value: unknown }).value) : d.code !== undefined ? String(d.code) : undefined
  return {
    severity: SEVERITY[d.severity ?? 1] ?? Severity.Error,
    message: d.message,
    ...(code ? { code } : {}),
    source: 'Pyright',
    ...r,
    ...(d.tags?.length ? { tags: [...d.tags] } : {})
  }
}

/** Ruff codes that say the same as a pyright rule */
const SAME_AS_RUFF: Record<string, string[]> = {
  reportUndefinedVariable: ['F821', 'F822'],
  reportUnusedImport: ['F401'],
  reportUnusedVariable: ['F841'],
  reportRedeclaration: ['F811'],
  reportUnusedExpression: ['B018'],
  reportSelfClsParameterName: ['N804', 'N805']
}
const UNNECESSARY = 1
const isRuffSyntax = (m: Marker) => !m.code || m.code.startsWith('E9')

/**
 * Pyright's markers without those Ruff already shows on the same line, so a mistake is underlined
 * once: syntax errors (both parsers report them), the rules mapped above, and the faded "is not
 * accessed" hints where Ruff flags an unused import or variable.
 */
export function withoutRuffDuplicates(pyright: Marker[], ruff: Marker[]): Marker[] {
  if (!ruff.length) return pyright
  const byLine = new Map<number, Marker[]>()
  for (const m of ruff) for (let l = m.startLineNumber; l <= m.endLineNumber; l++) byLine.set(l, [...(byLine.get(l) ?? []), m])
  return pyright.filter((p) => {
    const same = byLine.get(p.startLineNumber)
    if (!same) return true
    if (!p.code && same.some(isRuffSyntax)) return false
    const codes = p.code ? SAME_AS_RUFF[p.code] : undefined
    if (codes && same.some((r) => r.code && codes.includes(r.code))) return false
    if (p.tags?.includes(UNNECESSARY) && p.severity === Severity.Hint && same.some((r) => r.code === 'F401' || r.code === 'F841')) return false
    return true
  })
}

/** LSP CompletionItemKind (1-based) to the name of Monaco's CompletionItemKind */
const COMPLETION_KIND = [
  '',
  'Text',
  'Method',
  'Function',
  'Constructor',
  'Field',
  'Variable',
  'Class',
  'Interface',
  'Module',
  'Property',
  'Unit',
  'Value',
  'Enum',
  'Keyword',
  'Snippet',
  'Color',
  'File',
  'Reference',
  'Folder',
  'EnumMember',
  'Constant',
  'Struct',
  'Event',
  'Operator',
  'TypeParameter'
] as const
export type CompletionKindName = Exclude<(typeof COMPLETION_KIND)[number], ''>

export function completionKindName(kind: number | undefined): CompletionKindName {
  const name = kind ? COMPLETION_KIND[kind] : undefined
  return name || 'Text'
}

/** LSP SymbolKind is 1-based, Monaco's the same list from 0 */
export const symbolKind = (kind: number) => Math.max(0, kind - 1)

/** Hover and documentation text as Monaco's markdown */
export function markdownOf(doc: string | MarkupContent | { language: string; value: string } | (string | { language: string; value: string })[] | undefined | null): { value: string } | undefined {
  if (!doc) return undefined
  if (Array.isArray(doc)) {
    const parts = doc.map((d) => markdownOf(d)?.value).filter(Boolean)
    return parts.length ? { value: parts.join('\n\n') } : undefined
  }
  if (typeof doc === 'string') return doc.trim() ? { value: doc } : undefined
  if ('kind' in doc) return doc.value.trim() ? { value: doc.kind === 'markdown' ? doc.value : '```\n' + doc.value + '\n```' } : undefined
  return { value: '```' + doc.language + '\n' + doc.value + '\n```' }
}

/** One location from a definition answer, whichever of the two shapes the server used */
export function locationOf(l: { uri: string; range: Range } | { targetUri: string; targetSelectionRange: Range; targetRange: Range }): { uri: string; range: MonacoRange } {
  return 'targetUri' in l ? { uri: l.targetUri, range: toRange(l.targetSelectionRange ?? l.targetRange) } : { uri: l.uri, range: toRange(l.range) }
}
