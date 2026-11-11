/**
 * Ruff's diagnostics turned into Monaco markers. Kept free of Monaco itself so it can be tested in
 * Node: the numbers below are Monaco's MarkerSeverity and MarkerTag values.
 */

export interface RuffLocation {
  row: number
  column: number
}

/** The parts of a Ruff diagnostic the editor uses */
export interface RuffDiagnostic {
  code: string | null
  message: string
  tags?: string[]
  start_location: RuffLocation
  end_location: RuffLocation
}

export interface Marker {
  severity: number
  message: string
  code?: string
  source: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  tags?: number[]
}

export const Severity = { Hint: 1, Info: 2, Warning: 4, Error: 8 } as const
const Tag = { Unnecessary: 1, Deprecated: 2 } as const

/**
 * Errors are things that will fail when run: syntax errors, undefined names (F821, F822, F823),
 * and the E9 runtime errors. Everything else (unused imports, style) is a warning.
 */
export function severityFor(code: string | null): number {
  if (!code || code === 'invalid-syntax' || code.startsWith('E9')) return Severity.Error
  if (code === 'F821' || code === 'F822' || code === 'F823' || code === 'F632' || code === 'F706' || code === 'F704') return Severity.Error
  return Severity.Warning
}

export function toMarkers(diagnostics: RuffDiagnostic[], lineCount?: number): Marker[] {
  return diagnostics.map((d) => {
    const ruleCode = d.code && d.code !== 'invalid-syntax' ? d.code : undefined
    let startLineNumber = Math.max(1, d.start_location.row)
    let startColumn = Math.max(1, d.start_location.column)
    let endLineNumber = Math.max(startLineNumber, d.end_location.row)
    let endColumn = d.end_location.column
    // Ruff reports an empty range at end of file for some syntax errors; keep it on a real line and
    // at least one character wide so Monaco draws a squiggle
    if (lineCount && startLineNumber > lineCount) {
      startLineNumber = endLineNumber = lineCount
      startColumn = 1
      endColumn = Number.MAX_SAFE_INTEGER
    }
    if (endLineNumber === startLineNumber && endColumn <= startColumn) endColumn = startColumn + 1
    const tags: number[] = []
    if (d.tags?.includes('unnecessary')) tags.push(Tag.Unnecessary)
    if (d.tags?.includes('deprecated')) tags.push(Tag.Deprecated)
    return {
      severity: severityFor(d.code),
      message: d.message,
      ...(ruleCode ? { code: ruleCode } : {}),
      source: 'Ruff',
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
      ...(tags.length ? { tags } : {})
    }
  })
}
