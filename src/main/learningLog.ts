/**
 * The learning event log: one SQLite file in the vault (.tide/learning.db) that every feature
 * writes its learning acts to, through learningEvent() (shared/learningEvents has the shape). It is
 * additive: each feature keeps its own records as before, and nothing here rewrites them. The same
 * file keeps the learner model's targets (North Star's and yours), the links Claude proposed, and
 * goals registered from elsewhere.
 *
 * SQLite is Node's own (node:sqlite, in Electron's Node and in the tests' alike): no native module
 * to rebuild. When it can't be opened, writes are dropped quietly and reads come back empty; no
 * feature ever fails because of the log.
 */
import { createRequire } from 'module'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { normaliseEvent, type EventIn, type LearningEvent } from '@shared/learningEvents'
import type { Depth } from '@shared/learningEvents'
import type { ModelEdge, ModelGoal, Target } from '@shared/learnerModel'
import { vaultRoot } from './vault'

type Stmt = { run(...a: unknown[]): unknown; all(...a: unknown[]): Record<string, unknown>[]; get(...a: unknown[]): Record<string, unknown> | undefined }
interface Db {
  exec(sql: string): void
  prepare(sql: string): Stmt
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  topic TEXT,
  outcome TEXT,
  lesson TEXT,
  course TEXT,
  project TEXT,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE INDEX IF NOT EXISTS events_kind ON events(kind, at);
CREATE TABLE IF NOT EXISTS event_nodes (
  key TEXT NOT NULL,
  node TEXT NOT NULL,
  PRIMARY KEY (key, node)
);
CREATE INDEX IF NOT EXISTS event_nodes_node ON event_nodes(node);
CREATE TABLE IF NOT EXISTS targets (
  node TEXT PRIMARY KEY,
  depth INTEGER NOT NULL,
  goal TEXT,
  by TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (src, dst, kind)
);
CREATE TABLE IF NOT EXISTS goals (
  source TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (source, id)
);
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`

export const LOG_FILE = '.tide/learning.db'

let db: Db | null = null
let dbFor = ''
let unavailable = false
/** Told after each write, so the model can be built again (main/learnerModel) */
const listeners = new Set<() => void>()
export const onLogChange = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function open(): Db | null {
  let root: string
  try {
    root = vaultRoot()
  } catch {
    return null
  }
  if (dbFor === root && db) return db
  if (dbFor === root && unavailable) return null
  close()
  dbFor = root
  unavailable = false
  try {
    const { DatabaseSync } = createRequire(__filename)('node:sqlite') as { DatabaseSync: new (path: string) => Db }
    const dir = join(root, '.tide')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const d = new DatabaseSync(join(root, LOG_FILE))
    // A plain rollback journal: no -wal files beside it in a synced folder
    d.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;')
    d.exec(SCHEMA)
    db = d
  } catch (e) {
    console.warn('[learning log] unavailable', (e as Error).message)
    unavailable = true
    db = null
  }
  return db
}

/** Closes the file (a vault switch, the tests) */
export function close(): void {
  try {
    db?.close()
  } catch {
    // Already closed
  }
  db = null
  dbFor = ''
  unavailable = false
}

const tx = <T>(d: Db, fn: () => T): T => {
  d.exec('BEGIN')
  try {
    const r = fn()
    d.exec('COMMIT')
    return r
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

function write(d: Db, events: LearningEvent[]): number {
  const up = d.prepare(
    `INSERT INTO events (key, at, kind, source, topic, outcome, lesson, course, project, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET at = excluded.at, kind = excluded.kind, source = excluded.source, topic = excluded.topic, outcome = excluded.outcome, lesson = excluded.lesson, course = excluded.course, project = excluded.project, body = excluded.body`
  )
  const clear = d.prepare('DELETE FROM event_nodes WHERE key = ?')
  const node = d.prepare('INSERT OR IGNORE INTO event_nodes (key, node) VALUES (?, ?)')
  for (const e of events) {
    up.run(e.key, e.at, e.kind, e.source, e.topic ?? null, e.outcome ?? null, e.lesson ?? null, e.course ?? null, e.project ?? null, JSON.stringify(e))
    clear.run(e.key)
    for (const c of e.concepts) node.run(e.key, c)
    for (const s of e.skills) node.run(e.key, `skill:${s}`)
  }
  return events.length
}

const changed = () => {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // A listener's trouble isn't the writer's
    }
  }
}

/**
 * Writes events (the same key again replaces its row). With `replace`, every row whose key starts
 * with that prefix and isn't among these goes: a lesson saved again says all it shows.
 */
export function logEvents(input: EventIn[], o: { replace?: string } = {}): number {
  const d = open()
  if (!d) return 0
  const now = Date.now()
  const events = input.map((e) => normaliseEvent(e, now)).filter((e): e is LearningEvent => !!e)
  if (!events.length && !o.replace) return 0
  try {
    const n = tx(d, () => {
      if (o.replace) {
        const keep = new Set(events.map((e) => e.key))
        const like = `${o.replace.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        const gone = d.prepare("SELECT key FROM events WHERE key LIKE ? ESCAPE '\\'").all(like).map((r) => String(r.key)).filter((k) => !keep.has(k))
        const del = d.prepare('DELETE FROM events WHERE key = ?')
        const delNodes = d.prepare('DELETE FROM event_nodes WHERE key = ?')
        for (const k of gone) {
          del.run(k)
          delNodes.run(k)
        }
      }
      return write(d, events)
    })
    changed()
    return n
  } catch (e) {
    console.warn('[learning log] write', (e as Error).message)
    return 0
  }
}

/**
 * The one call every feature makes when a learning act happens. Never throws and never waits on
 * anything: a feature's own work never depends on the log.
 */
export function learningEvent(e: EventIn | EventIn[], o: { replace?: string } = {}): void {
  try {
    logEvents(Array.isArray(e) ? e : [e], o)
  } catch {
    // Never a reason for a feature to fail
  }
}

const parse = (rows: Record<string, unknown>[]): LearningEvent[] =>
  rows.flatMap((r) => {
    try {
      return [JSON.parse(String(r.body)) as LearningEvent]
    } catch {
      return []
    }
  })

/** Events, oldest first: all of them, since a time, of some kinds, or on one node */
export function readEvents(o: { since?: number; until?: number; kinds?: string[]; node?: string; limit?: number; newest?: boolean } = {}): LearningEvent[] {
  const d = open()
  if (!d) return []
  const where: string[] = []
  const args: unknown[] = []
  if (o.since !== undefined) (where.push('e.at >= ?'), args.push(o.since))
  if (o.until !== undefined) (where.push('e.at <= ?'), args.push(o.until))
  if (o.kinds?.length) (where.push(`e.kind IN (${o.kinds.map(() => '?').join(',')})`), args.push(...o.kinds))
  const from = o.node ? 'events e JOIN event_nodes n ON n.key = e.key AND n.node = ?' : 'events e'
  if (o.node) args.unshift(o.node)
  const sql = `SELECT e.body FROM ${from}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY e.at ${o.newest ? 'DESC' : 'ASC'}, e.key${o.limit ? ` LIMIT ${Math.max(1, Math.floor(o.limit))}` : ''}`
  try {
    return parse(d.prepare(sql).all(...args))
  } catch (e) {
    console.warn('[learning log] read', (e as Error).message)
    return []
  }
}

/** How many events there are, by kind */
export function eventCounts(): Record<string, number> {
  const d = open()
  if (!d) return {}
  return Object.fromEntries(d.prepare('SELECT kind, COUNT(*) AS n FROM events GROUP BY kind').all().map((r) => [String(r.kind), Number(r.n)]))
}

export function hasEvent(key: string): boolean {
  const d = open()
  return !!d?.prepare('SELECT 1 AS x FROM events WHERE key = ?').get(key)
}

// ---------- Meta ----------

export function getMeta(k: string): string | null {
  const d = open()
  const r = d?.prepare('SELECT v FROM meta WHERE k = ?').get(k)
  return r ? String(r.v) : null
}

export function setMeta(k: string, v: string): void {
  open()?.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v)
}

// ---------- Targets ----------

/** Sets how deep something should go (a concept or skill, by id or name); depth null takes the target away */
export function setTargets(list: { node: string; depth: Depth | null; goal?: string; by: string }[]): number {
  const d = open()
  if (!d) return 0
  const up = d.prepare('INSERT INTO targets (node, depth, goal, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(node) DO UPDATE SET depth = excluded.depth, goal = excluded.goal, by = excluded.by, at = excluded.at')
  const del = d.prepare('DELETE FROM targets WHERE node = ?')
  const now = Date.now()
  const n = tx(d, () => {
    let k = 0
    for (const t of list) {
      const node = String(t.node ?? '').trim().slice(0, 300)
      if (!node) continue
      if (t.depth === null) del.run(node)
      else up.run(node, Math.max(0, Math.min(6, Math.round(Number(t.depth) || 0))), t.goal ?? null, String(t.by || 'you').slice(0, 40), now)
      k++
    }
    return k
  })
  changed()
  return n
}

export function readTargets(): Target[] {
  const d = open()
  if (!d) return []
  return d.prepare('SELECT node, depth, goal, by, at FROM targets').all().map((r) => ({ node: String(r.node), depth: Number(r.depth) as Depth, ...(r.goal ? { goal: String(r.goal) } : {}), by: String(r.by), at: Number(r.at) }))
}

// ---------- Links (used in, skills) ----------

export function saveLinks(list: ModelEdge[]): number {
  const d = open()
  if (!d || !list.length) return 0
  const up = d.prepare('INSERT INTO links (src, dst, kind, origin, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(src, dst, kind) DO UPDATE SET origin = excluded.origin, at = excluded.at')
  const now = Date.now()
  const n = tx(d, () => {
    for (const l of list) up.run(l.from, l.to, l.kind, l.origin, now)
    return list.length
  })
  changed()
  return n
}

export function readLinks(): ModelEdge[] {
  const d = open()
  if (!d) return []
  return d.prepare('SELECT src, dst, kind, origin FROM links').all().map((r) => ({ from: String(r.src), to: String(r.dst), kind: String(r.kind) as ModelEdge['kind'], origin: String(r.origin) as ModelEdge['origin'] }))
}

// ---------- Goals from elsewhere (North Star) ----------

/** Replaces the goals one source has registered */
export function setGoals(source: string, goals: Omit<ModelGoal, 'source'>[]): number {
  const d = open()
  if (!d) return 0
  const src = String(source).trim().slice(0, 40)
  if (!src) return 0
  const n = tx(d, () => {
    d.prepare('DELETE FROM goals WHERE source = ?').run(src)
    const ins = d.prepare('INSERT INTO goals (source, id, body, at) VALUES (?, ?, ?, ?)')
    for (const g of goals) if (g?.id && g.title) ins.run(src, String(g.id).slice(0, 200), JSON.stringify({ ...g, source: src }), Date.now())
    return goals.length
  })
  changed()
  return n
}

export function readGoals(): ModelGoal[] {
  const d = open()
  if (!d) return []
  return d.prepare('SELECT body FROM goals').all().flatMap((r) => {
    try {
      return [JSON.parse(String(r.body)) as ModelGoal]
    } catch {
      return []
    }
  })
}
