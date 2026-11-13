/**
 * Jupyter notebooks (.ipynb, nbformat 4) as Tide reads and writes them. A notebook is opened into
 * a list of cells with their source as one string, and saved back in the shape Jupyter writes:
 * sources and text outputs split into lines, keys sorted, one-space indent, a final newline. Any
 * field Tide doesn't know (metadata, attachments, a newer minor version's keys) is carried through
 * untouched, so a notebook made in JupyterLab comes back from Tide the same apart from the edits.
 */

export type MultiLine = string | string[]

export interface StreamOutput {
  output_type: 'stream'
  name: 'stdout' | 'stderr'
  text: string
}
export interface DataOutput {
  output_type: 'display_data' | 'execute_result'
  data: Record<string, unknown>
  metadata: Record<string, unknown>
  execution_count?: number | null
  /** display_id from a transient block, kept only while the kernel runs (never saved) */
  displayId?: string
}
export interface ErrorOutput {
  output_type: 'error'
  ename: string
  evalue: string
  traceback: string[]
}
export type Output = StreamOutput | DataOutput | ErrorOutput

export type CellType = 'code' | 'markdown' | 'raw'

export interface Cell {
  id: string
  cell_type: CellType
  source: string
  metadata: Record<string, unknown>
  /** Code cells */
  outputs?: Output[]
  execution_count?: number | null
  /** Anything else the file had on the cell (attachments…) */
  extra?: Record<string, unknown>
}

export interface Notebook {
  cells: Cell[]
  metadata: Record<string, unknown>
  nbformat: number
  nbformat_minor: number
  /** Top-level keys Tide doesn't know */
  extra?: Record<string, unknown>
}

export const joinSource = (s: unknown): string => (Array.isArray(s) ? s.map(String).join('') : typeof s === 'string' ? s : '')

/** "a\nb\n" → ["a\n", "b\n"], the way Jupyter stores multi-line strings */
export function splitLines(s: string): string[] {
  if (!s) return []
  const out = s.split(/(?<=\n)/)
  return out
}

let counter = 0
/** A cell id as nbformat 4.5 wants it: 1–64 of [a-zA-Z0-9-_] */
export function newCellId(): string {
  counter = (counter + 1) % 1e6
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36).slice(-5)}${counter.toString(36)}${rnd}`.slice(0, 16)
}

const VALID_ID = /^[a-zA-Z0-9-_]{1,64}$/

function readOutput(o: Record<string, unknown>): Output | null {
  const t = o.output_type
  if (t === 'stream') return { output_type: 'stream', name: o.name === 'stderr' ? 'stderr' : 'stdout', text: joinSource(o.text) }
  if (t === 'display_data' || t === 'execute_result') {
    const data: Record<string, unknown> = {}
    for (const [k, v] of Object.entries((o.data as Record<string, unknown>) ?? {})) data[k] = isJsonMime(k) ? v : joinSource(v)
    const out: DataOutput = { output_type: t, data, metadata: (o.metadata as Record<string, unknown>) ?? {} }
    if (t === 'execute_result') out.execution_count = typeof o.execution_count === 'number' ? o.execution_count : null
    return out
  }
  if (t === 'error') return { output_type: 'error', ename: String(o.ename ?? ''), evalue: String(o.evalue ?? ''), traceback: Array.isArray(o.traceback) ? o.traceback.map(String) : [] }
  return null
}

const splitsLines = (mime: string) => mime.startsWith('text/') || mime === 'application/javascript' || mime === 'image/svg+xml'

/** JSON mime types keep their value as an object; every other one is text (joined from lines) */
export const isJsonMime = (mime: string) => /(^application\/json$)|\+json$/.test(mime)

const CELL_KEYS = new Set(['id', 'cell_type', 'source', 'metadata', 'outputs', 'execution_count'])
const NB_KEYS = new Set(['cells', 'metadata', 'nbformat', 'nbformat_minor'])

/** Reads a .ipynb file's text. Throws a sentence when it isn't a notebook Tide can open. */
export function parseNotebook(text: string): Notebook {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text || '{}')
  } catch {
    throw new Error('This file is not valid JSON, so it is not a notebook Tide can open.')
  }
  if (!raw || typeof raw !== 'object') throw new Error('This file is not a notebook.')
  const nbformat = typeof raw.nbformat === 'number' ? raw.nbformat : 4
  if (nbformat < 4) throw new Error(`This notebook is in an old format (nbformat ${nbformat}). Open and save it once in Jupyter to upgrade it.`)
  const cellsIn = Array.isArray(raw.cells) ? (raw.cells as Record<string, unknown>[]) : []
  const seen = new Set<string>()
  const cells: Cell[] = cellsIn.map((c) => {
    const type: CellType = c.cell_type === 'markdown' ? 'markdown' : c.cell_type === 'raw' ? 'raw' : 'code'
    let id = typeof c.id === 'string' && VALID_ID.test(c.id) && !seen.has(c.id) ? c.id : newCellId()
    while (seen.has(id)) id = newCellId()
    seen.add(id)
    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(c)) if (!CELL_KEYS.has(k)) extra[k] = v
    const cell: Cell = { id, cell_type: type, source: joinSource(c.source), metadata: (c.metadata as Record<string, unknown>) ?? {} }
    if (Object.keys(extra).length) cell.extra = extra
    if (type === 'code') {
      cell.outputs = (Array.isArray(c.outputs) ? (c.outputs as Record<string, unknown>[]) : []).map(readOutput).filter((o): o is Output => !!o)
      cell.execution_count = typeof c.execution_count === 'number' ? c.execution_count : null
    }
    return cell
  })
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) if (!NB_KEYS.has(k)) extra[k] = v
  return { cells, metadata: (raw.metadata as Record<string, unknown>) ?? {}, nbformat, nbformat_minor: typeof raw.nbformat_minor === 'number' ? raw.nbformat_minor : 5, ...(Object.keys(extra).length ? { extra } : {}) }
}

function writeOutput(o: Output): Record<string, unknown> {
  if (o.output_type === 'stream') return { name: o.name, output_type: 'stream', text: splitLines(o.text) }
  if (o.output_type === 'error') return { ename: o.ename, evalue: o.evalue, output_type: 'error', traceback: o.traceback }
  const data: Record<string, unknown> = {}
  // Jupyter splits text into lines, and keeps base64 pictures as one string
  for (const [k, v] of Object.entries(o.data)) data[k] = typeof v === 'string' && splitsLines(k) ? splitLines(v) : v
  const out: Record<string, unknown> = { data, metadata: o.metadata ?? {}, output_type: o.output_type }
  if (o.output_type === 'execute_result') out.execution_count = o.execution_count ?? null
  return out
}

/** Keys in sorted order, recursively, as Jupyter's json.dumps(sort_keys=True) writes them */
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as object).sort()) out[k] = sorted((v as Record<string, unknown>)[k])
    return out
  }
  return v
}

export function serializeNotebook(nb: Notebook): string {
  const minor = Math.max(nb.nbformat_minor, 5) // cell ids need 4.5
  const cells = nb.cells.map((c) => {
    const out: Record<string, unknown> = { ...(c.extra ?? {}), cell_type: c.cell_type, id: c.id, metadata: c.metadata ?? {}, source: splitLines(c.source) }
    if (c.cell_type === 'code') {
      out.execution_count = c.execution_count ?? null
      out.outputs = (c.outputs ?? []).map(writeOutput)
    }
    return out
  })
  const doc = { ...(nb.extra ?? {}), cells, metadata: nb.metadata ?? {}, nbformat: 4, nbformat_minor: minor }
  return JSON.stringify(sorted(doc), null, 1) + '\n'
}

export const PYTHON_METADATA = {
  kernelspec: { display_name: 'Python 3 (Tide)', language: 'python', name: 'python3' },
  language_info: { name: 'python' }
}

export function codeCell(source = '', metadata: Record<string, unknown> = {}): Cell {
  return { id: newCellId(), cell_type: 'code', source, metadata, outputs: [], execution_count: null }
}
export function markdownCell(source = '', metadata: Record<string, unknown> = {}): Cell {
  return { id: newCellId(), cell_type: 'markdown', source, metadata }
}

export function newNotebook(cells: Cell[] = [codeCell()]): Notebook {
  return { cells, metadata: { ...PYTHON_METADATA }, nbformat: 4, nbformat_minor: 5 }
}

/** The notebook as plain text for the tutor: each cell numbered, its outputs summarised */
export function notebookText(nb: Notebook, o: { maxOutput?: number; only?: string[] } = {}): string {
  const max = o.maxOutput ?? 1500
  const lines: string[] = []
  nb.cells.forEach((c, i) => {
    if (o.only && !o.only.includes(c.id)) return
    const ex = c.metadata?.tide as { exercise?: { title?: string } } | undefined
    const head = `### Cell ${i + 1} [${c.cell_type}${c.cell_type === 'code' ? `, run ${c.execution_count ?? 'never'}` : ''}] id=${c.id}${ex?.exercise ? ` (exercise: ${ex.exercise.title ?? 'untitled'})` : ''}`
    lines.push(head, c.cell_type === 'code' ? '```python\n' + c.source + '\n```' : c.source)
    for (const out of c.outputs ?? []) lines.push(outputText(out, max))
  })
  return lines.join('\n')
}

/** One output as text: stream text, the error and its traceback, or the richest text a display has */
export function outputText(out: Output, max = 1500): string {
  const clip = (s: string) => (s.length > max ? `${s.slice(0, max)}… (${s.length - max} more characters)` : s)
  if (out.output_type === 'stream') return `[${out.name}]\n${clip(out.text)}`
  if (out.output_type === 'error') return `[error] ${out.ename}: ${out.evalue}\n${clip(stripAnsi(out.traceback.join('\n')))}`
  const d = out.data
  const kinds = Object.keys(d)
  const pictures = kinds.filter((k) => k.startsWith('image/')).map((k) => `(a ${k} picture)`)
  const plain = typeof d['text/plain'] === 'string' ? clip(d['text/plain'] as string) : ''
  const tide = Object.keys(d).find((k) => k.startsWith('application/vnd.tide'))
  const plotly = d['application/vnd.plotly.v1+json'] ? '(an interactive Plotly chart)' : ''
  return ['[output]', plain, ...pictures, plotly, tide ? `(a Tide visual: ${JSON.stringify(d[tide]).slice(0, 300)})` : ''].filter(Boolean).join('\n')
}

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
