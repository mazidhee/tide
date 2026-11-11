/**
 * The data lab: a small SQLite database per conversation or lesson, so the tutor can run real
 * queries while teaching SQL or product analytics and you can change them and run them again.
 * The engine is Tide's Rust module (native/tide-core/src/lab.rs). Each lab lives in memory,
 * starts with both sample datasets ("shop" and "events"), and is dropped after an hour unused;
 * nothing is written to disc and nothing leaves this Mac.
 */
import { resultText, schemaText, type LabResult, type LabTable } from '@shared/lab'
import { tideCore } from './native'

interface Engine {
  seed(name: string): void
  query(sql: string, maxRows: number): LabResult
  schema(): LabTable[]
  reset(): void
}

interface Held {
  engine: Engine
  used: number
  /** Whether the tutor has been told what the tables are */
  told: boolean
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
    held = { engine, used: Date.now(), told: false }
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

/** Throws away whatever was changed and puts the sample data back */
export function labReset(id: string): void {
  const held = lab(id)
  if (!held) return
  held.engine.reset()
  held.told = false
}

/** For the tutor's run_sql tool: the result as text. The first one in a conversation ends with what the tables are. */
export function runSqlTool(id: string, sql: string): { text: string; ok: boolean; detail: string } {
  const held = lab(id)
  if (!held) return { text: UNAVAILABLE, ok: false, detail: 'unavailable' }
  const r = labQuery(id, sql, TOOL_ROWS)
  let text = resultText(r)
  if (!held.told) {
    held.told = true
    text += `\n\n${schemaText(labSchema(id))}`
  }
  return { text, ok: !r.error, detail: r.error ? 'error' : r.columns.length ? `${r.rowCount.toLocaleString('en-GB')} row${r.rowCount === 1 ? '' : 's'}` : 'done' }
}

/** For tests: how many labs are held */
export const labCount = () => labs.size
