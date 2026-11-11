/**
 * The data lab: a small SQLite database per conversation or lesson, so the tutor can run real
 * queries while teaching SQL or product analytics and you can change them and run them again.
 * The engine is Tide's Rust module (native/tide-core/src/lab.rs). Each lab lives in memory,
 * starts with both sample datasets ("shop" and "events"), and is dropped after an hour unused;
 * nothing is written to disc and nothing leaves this Mac. A CSV or TSV file from the notes folder
 * can be loaded beside them as a table (labLoadTable).
 */
import { readFileSync, realpathSync, statSync } from 'fs'
import { extname, relative, resolve, sep } from 'path'
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
  /** The learner's own files loaded as tables: table name to the file's path in the notes folder, and whether it belongs to a private project */
  loaded: Map<string, { path: string; private: boolean }>
  /** A private project's file has been loaded and the lab hasn't yet been seen clear of it (see privateHold) */
  tainted: boolean
}

/** Asked whether a path in the notes folder belongs to a private project (projects.privatePath, passed in by whoever loads) */
export type IsPrivate = (path: string) => Promise<boolean>

const DATASETS = ['shop', 'events']
/** The tables those datasets make (native/tide-core/src/lab.rs, `seed`) */
const DATASET_TABLES = ['customers', 'products', 'orders', 'order_items', 'users', 'events']
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
    held = { engine, used: Date.now(), told: false, loaded: new Map(), tainted: false }
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
  // A private file read again is still private; one that can't be read again is gone with everything else
  held.tainted = false
  for (const [table, from] of files) {
    try {
      loadInto(held, from.path, from.private, table)
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
function loadInto(held: Held, path: string, secret: boolean, table?: string): LabLoaded {
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
  held.loaded.set(target, { path: file.rel, private: secret })
  if (secret) held.tainted = true
  return { table: target, path: file.rel, columns: csv.columns, rows, replaced, padded: csv.padded, cut: csv.cut }
}

const notLoaded = (path: string, error: string): LabLoaded => ({ table: '', path, columns: [], rows: 0, replaced: false, padded: 0, cut: 0, error })

/** Whether the file belongs to a private project: asked about the path as written and as it really is on disc, so a link or another spelling of a folder's name is no way round */
async function secretFile(path: string, isPrivate: IsPrivate): Promise<boolean> {
  const file = vaultDataFile(path)
  return (await isPrivate(file.rel)) || (await isPrivate(file.real))
}

/**
 * Loads a CSV or TSV file from the notes folder into that conversation's lab as a table, named
 * after the file (see tableNameFor). Loading the same file again replaces its table; a table of
 * that name that came from anywhere else is kept and the new one is numbered (sales_2). At most
 * 10 MB, 100,000 rows and 100 columns. A file that can't be loaded comes back with `error` set.
 * Whether the file is a private project's is worked out on every load and kept with the table:
 * run_sql then answers only on a private turn (see privateHold).
 */
export async function labLoadTable(id: string, path: string, isPrivate: IsPrivate): Promise<LabLoaded> {
  const held = lab(id)
  if (!held) return notLoaded(path, UNAVAILABLE)
  try {
    return loadInto(held, path, await secretFile(path, isPrivate))
  } catch (e) {
    return notLoaded(path, (e as Error).message)
  }
}

/** For the tutor's load_table tool. A file inside a private project is loaded only on a private turn (one about that project, which stays on this Mac). */
export async function loadTableTool(id: string, path: string, turn: { private: boolean; isPrivate: IsPrivate }): Promise<{ text: string; ok: boolean; detail: string }> {
  const done = (r: LabLoaded) => ({ text: loadedText(r), ok: !r.error, detail: r.error ? 'not loaded' : `${r.table}: ${r.rows.toLocaleString('en-GB')} row${r.rows === 1 ? '' : 's'}` })
  const held = lab(id)
  if (!held) return done(notLoaded(path, UNAVAILABLE))
  try {
    const secret = await secretFile(path, turn.isPrivate)
    if (secret && !turn.private) {
      const rel = vaultDataFile(path).rel
      return done(notLoaded(path, `${rel} belongs to a private project, whose files stay on this Mac. It can be loaded in a lesson or conversation about that project.`))
    }
    return done(loadInto(held, path, secret))
  } catch (e) {
    return done(notLoaded(path, (e as Error).message))
  }
}

/**
 * Why run_sql must not answer on a turn that isn't private, or null when it may. Deliberately the
 * whole lab rather than the tables a query names: a view, a copy (CREATE TABLE … AS SELECT) or a
 * temporary table can carry a private table's rows under any name, so reading the SQL proves
 * nothing. The rule: a lab that has loaded a private project's file is private-only until every
 * such table is gone (dropped; a dropped one is forgotten here) AND nothing is left in the schema
 * but the sample tables and the files loaded from outside private projects, temporary tables and
 * views included. Reset reads loaded files again, so it does not clear this; dropping does.
 * Not caught: private rows copied by INSERT into a sample table or into another loaded table.
 */
function privateHold(held: Held): string | null {
  if (!held.tainted) return null
  const schema = held.engine.schema()
  for (const table of [...held.loaded.keys()]) {
    if (!schema.some((t) => t.kind === 'table' && t.name === table)) held.loaded.delete(table)
  }
  const secret = [...held.loaded].filter(([, from]) => from.private)
  if (secret.length) {
    const names = secret.map(([table, from]) => `${table} (${from.path})`).join(', ')
    const it = secret.length === 1 ? `the table ${secret[0][0]}` : 'those tables'
    return `This lab holds ${secret.length === 1 ? 'a table' : 'tables'} loaded from a private project: ${names}. Its rows stay on this Mac, so run_sql is not available on this turn. It can be queried in a lesson or conversation about that project; the student can clear it by dropping ${it} in an SQL block (DROP TABLE), along with anything made from it.`
  }
  const samples = new Set(DATASET_TABLES)
  const made = schema.map((t) => t.name).filter((n) => !samples.has(n) && !held.loaded.has(n))
  let temp: string[] = []
  try {
    temp = held.engine.query("SELECT name FROM sqlite_temp_schema WHERE type IN ('table', 'view')", 50).rows.map((r) => String(r[0]))
  } catch {
    // No temporary schema to read: nothing is held there
  }
  const left = [...made, ...temp]
  if (left.length) {
    return `This lab held a table loaded from a private project, and ${left.slice(0, 6).join(', ')}${left.length > 6 ? ' and others' : ''} may have been made from it. Those rows stay on this Mac, so run_sql is not available on this turn. It can be queried in a lesson or conversation about that project; the student can clear it by dropping ${left.length === 1 ? 'that table or view' : 'those tables and views'} in an SQL block.`
  }
  held.tainted = false
  return null
}

/**
 * For the tutor's run_sql tool: the result as text. The first one in a conversation ends with what
 * the tables are. `privateTurn` is whether the turn is about a private project (and so stays on this
 * Mac): on any other turn a lab holding a private project's data answers nothing, not even its schema.
 */
export function runSqlTool(id: string, sql: string, privateTurn: boolean): { text: string; ok: boolean; detail: string } {
  const held = lab(id)
  if (!held) return { text: UNAVAILABLE, ok: false, detail: 'unavailable' }
  if (!privateTurn) {
    const why = privateHold(held)
    if (why) return { text: why, ok: false, detail: 'private' }
  }
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
 * Nothing when the lab holds a private project's data and this turn isn't about it.
 */
export function labSchemaNote(id: string, privateTurn: boolean): string {
  const held = lab(id)
  if (!held || (!privateTurn && privateHold(held))) return ''
  held.told = true
  return `${schemaText(labSchema(id))} Write every query against exactly these tables and columns (or a file the student loads), and run it with run_sql before you show it.`
}

/** Whether a lesson is about SQL, and so works in the data lab */
export const aboutSql = (text: string) => /\bsql\b|\bsqlite\b|\bpostgres|\bgroup by\b|\bhaving\b|\bjoins?\b|\bwindow functions?\b|\bselect\b.*\bfrom\b|\bsubquer|\bcte\b|\bquery\b|\bqueries\b/i.test(text)

/** For tests: how many labs are held */
export const labCount = () => labs.size
