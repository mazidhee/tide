/**
 * The data lab: a small SQLite database per conversation or lesson, so the tutor can run real
 * queries while teaching SQL or product analytics and you can change them and run them again.
 * The engine is Tide's Rust module (native/tide-core/src/lab.rs). Each lab lives in memory,
 * starts with both sample datasets ("shop" and "events"), and is dropped after an hour unused;
 * nothing is written to disc and nothing leaves this Mac. A CSV or TSV file from the notes folder
 * can be loaded beside them as a table (labLoadTable).
 */
import { readdirSync, readFileSync, realpathSync, statSync, type Dirent } from 'fs'
import { extname, join, relative, resolve, sep } from 'path'
import { CSV_LIMITS, megabytes, readCsvTable, tableNameFor } from '@shared/csvTable'
import { loadedText, resultText, schemaText, type LabLoaded, type LabResult, type LabTable } from '@shared/lab'
import { tideCore } from './native'
import { absPath, vaultRoot } from './vault'

interface Engine {
  seed(name: string): void
  query(sql: string, maxRows: number): LabResult
  schema(): LabTable[]
  reset(): void
  loadTable(name: string, columns: string[], types: string[], rows: (string | null)[][]): number
}

interface Held {
  engine: Engine
  used: number
  /** Whether the tutor has been told what the tables are */
  told: boolean
  /** The learner's own files loaded as tables: table name to the file's path in the notes folder */
  loaded: Map<string, { path: string }>
}

const DATASETS = ['shop', 'events']
const IDLE_MS = 60 * 60_000
/** What the renderer may ask for: enough for a chart of a daily series, the table shows the first 200 */
const VIEW_ROWS = 1_000
const TOOL_ROWS = 30
const labs = new Map<string, Held>()
let sweeper: ReturnType<typeof setInterval> | undefined

/** Drops the labs nobody has used for an hour */
export function sweepLabs(now = Date.now()): void {
  for (const [id, lab] of labs) if (now - lab.used > IDLE_MS) labs.delete(id)
}

function lab(id: string): Held | null {
  const key = id || 'scratch'
  sweepLabs()
  let held = labs.get(key)
  if (!held) {
    const mod = tideCore<{ Lab?: new (path?: string) => Engine }>()
    if (!mod?.Lab) return null
    const engine = new mod.Lab()
    for (const name of DATASETS) engine.seed(name)
    held = { engine, used: Date.now(), told: false, loaded: new Map() }
    labs.set(key, held)
    sweeper ??= setInterval(sweepLabs, 10 * 60_000)
    sweeper.unref?.()
  }
  held.used = Date.now()
  return held
}

const UNAVAILABLE = 'The data lab is unavailable: Tide’s native module (tide-core) didn’t load.'
const failed = (error: string): LabResult => ({ columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 0, error })

/** Runs one or more statements on that conversation's lab and returns the last result. A mistake in the SQL comes back in `error`. */
export function labQuery(id: string, sql: string, maxRows = VIEW_ROWS): LabResult {
  const held = lab(id)
  if (!held) return failed(UNAVAILABLE)
  if (!String(sql ?? '').trim()) return failed('There is no query to run.')
  try {
    return held.engine.query(String(sql), Math.max(1, Math.min(maxRows, VIEW_ROWS)))
  } catch (e) {
    return failed((e as Error).message)
  }
}

export function labSchema(id: string): LabTable[] {
  try {
    return lab(id)?.engine.schema() ?? []
  } catch {
    return []
  }
}

/** Throws away whatever was changed and puts the sample data back. Files the learner loaded are read again from the notes folder; one that can no longer be read is left out. */
export function labReset(id: string): void {
  const held = lab(id)
  if (!held) return
  held.engine.reset()
  held.told = false
  const files = [...held.loaded]
  held.loaded.clear()
  // A file that can't be read again is gone with everything else
  for (const [table, from] of files) {
    try {
      loadInto(held, from.path, table)
    } catch {
      // Moved, deleted or changed past the limits since it was loaded
    }
  }
}

// ---------- The learner's own data ----------

const inside = (root: string, full: string) => full === root || full.startsWith(root + sep)
const relOf = (root: string, full: string) => relative(root, full).split(sep).join('/')

/**
 * Finds a CSV or TSV file in the notes folder. `path` is relative to the folder; anything that
 * leaves it (.., an absolute path, a link pointing outside) is refused, as is any other kind of
 * file. Gives back the path as written from the folder's root and the path the file really has
 * once links and the disc's own spelling of the name are followed.
 */
export function vaultDataFile(path: string): { rel: string; real: string; full: string; bytes: number } {
  const asked = String(path ?? '').trim()
  if (!asked) throw new Error('No file was named. Give the path of a .csv or .tsv file in the notes folder.')
  const root = resolve(vaultRoot())
  const full = absPath(asked)
  const rel = relOf(root, full)
  const ext = extname(full).toLowerCase()
  if (ext !== '.csv' && ext !== '.tsv') throw new Error(`The lab loads .csv and .tsv files only, and ${rel || asked} isn't one.`)
  let bytes: number
  let realFull: string
  try {
    const stat = statSync(full)
    if (!stat.isFile()) throw new Error(`${rel} is a folder, not a file.`)
    bytes = stat.size
    realFull = realpathSync.native(full)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`There is no file at ${rel} in the notes folder.`)
    throw e
  }
  const realRoot = realpathSync.native(root)
  if (!inside(realRoot, realFull)) throw new Error(`Path is outside the notes folder: ${asked}`)
  return { rel, real: relOf(realRoot, realFull), full: realFull, bytes }
}

function decode(buf: Buffer): string {
  // Excel's "Unicode text" is UTF-16 with a byte-order mark
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le')
  return buf.toString('utf8')
}

/** Reads the file and puts it in the lab, as `table` when given (a reload) or under a name from the file's name. Throws with a plain message when it can't. */
function loadInto(held: Held, path: string, table?: string): LabLoaded {
  const file = vaultDataFile(path)
  const name = file.rel.split('/').pop() ?? file.rel
  if (file.bytes > CSV_LIMITS.bytes) throw new Error(`${name} is ${megabytes(file.bytes)}; the lab loads files of up to ${megabytes(CSV_LIMITS.bytes)}. Cut it down to the rows and columns you need.`)
  const text = decode(readFileSync(file.full))
  if (text.includes('\0')) throw new Error(`${name} doesn't read as text, so it can't be loaded as a table.`)
  const csv = readCsvTable(text, { delimiter: file.rel.toLowerCase().endsWith('.tsv') ? '\t' : undefined })
  const tables = held.engine.schema()
  const isTable = (n: string) => tables.some((t) => t.kind === 'table' && t.name.toLowerCase() === n)
  // The same file again takes the place of its earlier load; any other table of the name is left alone and this one is numbered
  const earlier = table ?? [...held.loaded].find(([t, from]) => from.path === file.rel && isTable(t))?.[0]
  let target = earlier
  if (!target) {
    const taken = new Set(tables.map((t) => t.name.toLowerCase()))
    const base = tableNameFor(file.rel)
    target = base
    for (let n = 2; taken.has(target); n++) target = `${base}_${n}`
  }
  const replaced = !table && !!earlier
  const rows = held.engine.loadTable(
    target,
    csv.columns.map((c) => c.name),
    csv.columns.map((c) => c.type),
    csv.rows
  )
  held.loaded.set(target, { path: file.rel })
  return { table: target, path: file.rel, columns: csv.columns, rows, replaced, padded: csv.padded, cut: csv.cut }
}

const notLoaded = (path: string, error: string): LabLoaded => ({ table: '', path, columns: [], rows: 0, replaced: false, padded: 0, cut: 0, error })

/**
 * Loads a CSV or TSV file from the notes folder into that conversation's lab as a table, named
 * after the file (see tableNameFor). Loading the same file again replaces its table; a table of
 * that name that came from anywhere else is kept and the new one is numbered (sales_2). At most
 * 10 MB, 100,000 rows and 100 columns. A file that can't be loaded comes back with `error` set.
 */
export async function labLoadTable(id: string, path: string): Promise<LabLoaded> {
  const held = lab(id)
  if (!held) return notLoaded(path, UNAVAILABLE)
  try {
    return loadInto(held, path)
  } catch (e) {
    return notLoaded(path, (e as Error).message)
  }
}

/** For the tutor's load_table tool */
export async function loadTableTool(id: string, path: string): Promise<{ text: string; ok: boolean; detail: string }> {
  const done = (r: LabLoaded) => ({ text: loadedText(r), ok: !r.error, detail: r.error ? 'not loaded' : `${r.table}: ${r.rows.toLocaleString('en-GB')} row${r.rows === 1 ? '' : 's'}` })
  const held = lab(id)
  if (!held) return done(notLoaded(path, UNAVAILABLE))
  try {
    return done(loadInto(held, path))
  } catch (e) {
    return done(notLoaded(path, (e as Error).message))
  }
}

/**
 * For the tutor's run_sql tool: the result as text. The first one in a conversation ends with what
 * the tables are.
 */
export function runSqlTool(id: string, sql: string): { text: string; ok: boolean; detail: string } {
  const held = lab(id)
  if (!held) return { text: UNAVAILABLE, ok: false, detail: 'unavailable' }
  const r = labQuery(id, sql, TOOL_ROWS)
  let text = resultText(r)
  if (!held.told) {
    held.told = true
    text += `\n\n${schemaText(labSchema(id))}`
    const own = [...held.loaded].filter(([table]) => labSchema(id).some((t) => t.name === table))
    if (own.length) text += ` Loaded from the student's own files: ${own.map(([table, from]) => `${table} (${from.path})`).join(', ')}.`
  }
  return { text, ok: !r.error, detail: r.error ? 'error' : r.columns.length ? `${r.rowCount.toLocaleString('en-GB')} row${r.rowCount === 1 ? '' : 's'}` : 'done' }
}

/**
 * What a SQL lesson's tutor is told about the lab before it writes a query: the tables and their
 * columns. Without it, Gemma wrote an example on a column the sample data doesn't have
 * (orders.category) without running it, and the student's Run answered "no such column".
 */
export function labSchemaNote(id: string, files: string[] = []): string {
  const held = lab(id)
  if (!held) return ''
  held.told = true
  const own = files.length
    ? ` The student's own data files in their notes folder, which you CAN load with load_table (path exactly as written) and then query with run_sql: ${files.slice(0, 12).join(', ')}.`
    : ''
  return `You have this lab through your tools in this lesson: run_sql runs a query on it and load_table loads one of the student's .csv or .tsv files into it. Never say you can't see their data or files: load and query them. ${schemaText(labSchema(id))}${own} Before you set a SQL problem, run its reference query with run_sql and check it returns real rows (not empty, not NULL); put that query in the problem's <solution> as a \`\`\`sql block. Write every query against exactly these tables and columns (or a file the student loads), and run it with run_sql before you show it.`
}

/** The .csv and .tsv files in the notes folder (paths from its root), for the tutor to load; a short walk, cached for a minute */
let filesSeen: { at: number; root: string; files: string[] } | null = null
export function dataFiles(): string[] {
  let root: string
  try {
    root = resolve(vaultRoot())
  } catch {
    return []
  }
  if (filesSeen && filesSeen.root === root && Date.now() - filesSeen.at < 60_000) return filesSeen.files
  const files: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || files.length >= 40) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (/\.(csv|tsv)$/i.test(e.name)) files.push(relOf(root, full))
    }
  }
  walk(root, 0)
  filesSeen = { at: Date.now(), root, files }
  return files
}

/**
 * A lesson message that asks for one of their files ("load my orders.csv"): the line that sends
 * the tutor to load_table with its path. Gemma answered "I can't see your local files" without it.
 */
export function loadHint(question: string, files: string[]): string {
  const named = [...question.matchAll(/([\w./-]+\.(?:csv|tsv))\b/gi)].map((m) => m[1].trim().split('/').pop()!.toLowerCase())
  if (!named.length && !/\b(load|open|import|use|query)\b[^.]{0,30}\b(my|our)\b[^.]{0,30}\b(csv|tsv|data|file|spreadsheet)\b/i.test(question)) return ''
  const hits = files.filter((f) => named.includes(f.split('/').pop()!.toLowerCase()))
  if (hits.length) return `The student wants their file loaded: call load_table now with path "${hits[0]}" (it is in their notes folder and you can load it), then query it with run_sql and teach from its real rows.`
  if (named.length) return `The student named a file (${named.join(', ')}) that isn't in their notes folder${files.length ? `; the data files there are ${files.slice(0, 8).join(', ')}` : ''}. Say so, and offer to load one of those with load_table.`
  return files.length ? `The student wants to work on their own data: their files are ${files.slice(0, 8).join(', ')}. Load the one they mean with load_table, then query it with run_sql.` : ''
}

/** Whether a lesson is about SQL, and so works in the data lab */
export const aboutSql = (text: string) => /\bsql\b|\bsqlite\b|\bpostgres|\bgroup by\b|\bhaving\b|\bjoins?\b|\bwindow functions?\b|\bselect\b.*\bfrom\b|\bsubquer|\bcte\b|\bquery\b|\bqueries\b/i.test(text)

/** For tests: how many labs are held */
export const labCount = () => labs.size
