/**
 * Postgres in the SQL lab (the Postgres pack): one server for Tide, started the first time a
 * lesson runs Postgres SQL and stopped after 20 minutes unused or when Tide quits. It listens only
 * on 127.0.0.1, on a port picked when it starts, signs in with SCRAM and a password made for this
 * Mac, and runs inside the sandbox (writes only in its data folder, no connections out).
 *
 * Each lesson or conversation gets its own database, copied from a template that holds the same
 * sample data as the SQLite lab (the shop and the product events), with dates as real dates and
 * keys as real constraints. Lessons connect as `learner`, who owns their database but is not a
 * superuser, so COPY ... PROGRAM and server files are out of reach. Two sessions (A and B) per
 * lesson let a lesson show transactions and isolation levels side by side; lock_timeout keeps a
 * blocked session from hanging the lesson.
 */
import { spawn, type ChildProcess } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import type { LabResult, LabTable } from '@shared/lab'
import { resultText } from '@shared/lab'
import { packMissingText } from '@shared/trackPacks'
import { cellOf, PG_TYPES, PgConnection, type PgReply } from './pgwire'
import { pgBin, pgData, toolsRoot } from './paths'

const IDLE_MS = 20 * 60_000
const ADMIN = 'tide_admin'
const LEARNER = 'learner'
const TEMPLATE = 'lab_template'
const MAX_ROWS = 1_000

interface Server {
  child: ChildProcess
  port: number
  admin: PgConnection
  used: number
}

let server: Promise<Server> | null = null
let idleTimer: ReturnType<typeof setInterval> | null = null
const sessions = new Map<string, Map<string, PgConnection>>()
const told = new Set<string>()

export const postgresReady = () => existsSync(pgBin('postgres')) && existsSync(pgBin('initdb'))

const secretFile = () => join(toolsRoot(), 'postgres', 'secret.json')

async function secrets(): Promise<{ admin: string; learner: string }> {
  try {
    return JSON.parse(await fs.readFile(secretFile(), 'utf8'))
  } catch {
    const s = { admin: randomBytes(24).toString('base64url'), learner: randomBytes(24).toString('base64url') }
    await fs.mkdir(join(toolsRoot(), 'postgres'), { recursive: true })
    await fs.writeFile(secretFile(), JSON.stringify(s), { mode: 0o600 })
    return s
  }
}

const runPg = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    const c = spawn(cmd, args, { env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', ...env } })
    let out = ''
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (out += d))
    c.on('close', (code) => resolve({ code: code ?? -1, out }))
    c.on('error', (e) => resolve({ code: -1, out: e.message }))
  })

/** Makes the database cluster once: the admin role signs in with a password Tide keeps beside it */
async function initCluster(onProgress: (s: string) => void): Promise<void> {
  if (existsSync(join(pgData(), 'PG_VERSION'))) return
  onProgress('Setting up the lab’s database (once, a few seconds)…')
  const { admin } = await secrets()
  const pw = join(toolsRoot(), 'postgres', '.pw')
  await fs.writeFile(pw, admin, { mode: 0o600 })
  await fs.rm(pgData(), { recursive: true, force: true })
  const r = await runPg(pgBin('initdb'), ['-D', pgData(), '-U', ADMIN, `--pwfile=${pw}`, '--auth=scram-sha-256', '-E', 'UTF8', '--locale=C', '--no-sync', '--no-instructions'])
  await fs.rm(pw, { force: true })
  if (r.code !== 0) {
    await fs.rm(pgData(), { recursive: true, force: true })
    throw new Error(`initdb failed: ${r.out.trim().split('\n').slice(-3).join(' ')}`)
  }
}

async function launch(onProgress: (s: string) => void): Promise<Server> {
  if (!postgresReady()) throw new Error(packMissingText('postgres', 'Postgres SQL'))
  await initCluster(onProgress)
  const { profile, freePort } = await import('../runner')
  const data = await fs.realpath(pgData())
  const sb = join(toolsRoot(), 'postgres', 'server.sb')
  await fs.writeFile(sb, profile([data]))
  await stopStale(data)
  const port = await freePort()
  const child = spawn('/usr/bin/sandbox-exec', ['-f', sb, pgBin('postgres'), '-D', data, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'shared_buffers=32MB', '-c', 'max_connections=40', '-c', 'logging_collector=off', '-c', 'log_min_messages=error'], { env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  const keep = (d: Buffer) => (log = (log + d.toString()).slice(-4000))
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  let exited = false
  child.once('exit', () => (exited = true))
  // Ready when it takes connections
  const { connect } = await import('net')
  const t0 = Date.now()
  for (;;) {
    if (exited) throw new Error(`Postgres stopped: ${log.trim().split('\n').pop() ?? ''}`)
    if (Date.now() - t0 > 30_000) {
      child.kill('SIGKILL')
      throw new Error(`Postgres didn’t start: ${log.trim().split('\n').pop() ?? 'no answer'}`)
    }
    const open = await new Promise<boolean>((resolve) => {
      const sock = connect({ host: '127.0.0.1', port }, () => {
        sock.destroy()
        resolve(true)
      })
      sock.on('error', () => resolve(false))
    })
    if (open) break
    await new Promise((r) => setTimeout(r, 100))
  }
  let s: Server
  try {
    const { admin } = await secrets()
    const conn = await PgConnection.open({ port, user: ADMIN, password: admin, database: 'postgres' })
    s = { child, port, admin: conn, used: Date.now() }
    await ensureTemplate(s, onProgress)
  } catch (e) {
    child.kill('SIGINT')
    throw e
  }
  child.once('exit', () => {
    server = null
    sessions.clear()
  })
  idleTimer ??= setInterval(() => {
    void server?.then((x) => {
      if (Date.now() - x.used > IDLE_MS) void stopPostgres()
    })
  }, 60_000)
  idleTimer.unref?.()
  return s
}

/**
 * A server left running by a Tide that crashed holds the data folder: when its pid file names a
 * process that is this postgres, it is asked to stop (fast shutdown) before a new one starts.
 */
async function stopStale(data: string): Promise<void> {
  const pid = Number((await fs.readFile(join(data, 'postmaster.pid'), 'utf8').catch(() => '')).split('\n')[0])
  if (!pid) return
  const cmd = await runPg('/bin/ps', ['-p', String(pid), '-o', 'command='])
  if (cmd.code !== 0 || !cmd.out.includes(pgBin('postgres'))) {
    await fs.rm(join(data, 'postmaster.pid'), { force: true }).catch(() => {})
    return
  }
  try {
    process.kill(pid, 'SIGINT')
  } catch {
    return
  }
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100))
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
  }
}

/** The server, started when first needed */
function running(onProgress: (s: string) => void = () => {}): Promise<Server> {
  server ??= launch(onProgress).catch((e) => {
    server = null
    throw e
  })
  return server
}

/** Run once after installing, so the first lesson doesn't wait for initdb and the sample data */
export async function prepareCluster(onProgress: (s: string) => void = () => {}): Promise<void> {
  await running(onProgress)
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
const literal = (v: string) => `'${v.replace(/'/g, "''")}'`

/** A Postgres type for a column of the SQLite sample data, from its declared type and values */
export function pgColumnType(declared: string, values: (string | number | null)[]): string {
  const t = declared.toLowerCase()
  const present = values.filter((v) => v !== null)
  if (/int/.test(t)) return present.every((v) => typeof v === 'number' && Math.abs(v) < 2 ** 31) ? 'integer' : 'bigint'
  if (/real|float|double|numeric|decimal/.test(t)) return present.every((v) => typeof v === 'number' && Math.round(v * 100) === v * 100) ? 'numeric(12,2)' : 'double precision'
  if (present.length && present.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date'
  if (present.length && present.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(v))) return 'timestamp'
  return 'text'
}

/** The SQLite lab's sample data as Postgres DDL and inserts */
export async function sampleDataSql(): Promise<string[]> {
  const { tideCore } = await import('../native')
  const mod = tideCore<{ Lab?: new () => { seed(n: string): void; schema(): LabTable[]; query(sql: string, max: number): LabResult } }>()
  if (!mod?.Lab) return []
  const lab = new mod.Lab()
  lab.seed('shop')
  lab.seed('events')
  const tables = lab.schema().filter((t) => t.kind === 'table')
  const out: string[] = []
  const later: string[] = []
  for (const t of tables) {
    const all = lab.query(`SELECT * FROM ${quote(t.name)}`, 1_000_000)
    const types = t.columns.map((c, i) => pgColumnType(c.type, all.rows.map((r) => r[i])))
    const pk = t.columns.filter((c) => c.primaryKey).map((c) => quote(c.name))
    out.push(`CREATE TABLE ${quote(t.name)} (${t.columns.map((c, i) => `${quote(c.name)} ${types[i]}${c.notNull ? ' NOT NULL' : ''}`).join(', ')}${pk.length ? `, PRIMARY KEY (${pk.join(', ')})` : ''})`)
    for (let i = 0; i < all.rows.length; i += 500) {
      const chunk = all.rows.slice(i, i + 500)
      out.push(`INSERT INTO ${quote(t.name)} VALUES ${chunk.map((r) => `(${r.map((v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : literal(v))).join(', ')})`).join(', ')}`)
    }
    for (const fk of t.foreignKeys) later.push(`ALTER TABLE ${quote(t.name)} ADD FOREIGN KEY (${quote(fk.column)}) REFERENCES ${quote(fk.table)} (${quote(fk.to)})`)
  }
  return [...out, ...later, 'ANALYZE']
}

async function ensureTemplate(s: Server, onProgress: (s: string) => void): Promise<void> {
  const has = await s.admin.query(`SELECT 1 FROM pg_database WHERE datname = ${literal(TEMPLATE)}`)
  if (has.sets[0]?.rows.length) return
  onProgress('Loading the sample data into Postgres…')
  const { learner } = await secrets()
  const role = await s.admin.query(`SELECT 1 FROM pg_roles WHERE rolname = ${literal(LEARNER)}`)
  if (!role.sets[0]?.rows.length) await check(s.admin.query(`CREATE ROLE ${LEARNER} LOGIN PASSWORD ${literal(learner)} NOSUPERUSER NOCREATEDB NOCREATEROLE`))
  await check(s.admin.query(`CREATE DATABASE ${TEMPLATE} OWNER ${LEARNER}`))
  const c = await PgConnection.open({ port: s.port, user: LEARNER, password: learner, database: TEMPLATE })
  try {
    for (const stmt of await sampleDataSql()) await check(c.query(stmt))
  } catch (e) {
    c.close()
    await s.admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE}`)
    throw e
  }
  c.close()
  await check(s.admin.query(`ALTER DATABASE ${TEMPLATE} WITH IS_TEMPLATE true`))
}

async function check(p: Promise<PgReply>): Promise<PgReply> {
  const r = await p
  if (r.error) throw new Error(r.error.message)
  return r
}

export const databaseFor = (labId: string) => `lab_${createHash('sha1').update(labId || 'scratch').digest('hex').slice(0, 12)}`

/** A session's connection to that lesson's database, made (and its database copied from the template) when first needed */
async function session(labId: string, name: string): Promise<PgConnection> {
  const s = await running()
  s.used = Date.now()
  const key = labId || 'scratch'
  const mine = sessions.get(key) ?? new Map<string, PgConnection>()
  sessions.set(key, mine)
  const had = mine.get(name)
  if (had && !had.closed) return had
  const db = databaseFor(key)
  const exists = await s.admin.query(`SELECT 1 FROM pg_database WHERE datname = ${literal(db)}`)
  if (!exists.sets[0]?.rows.length) await check(s.admin.query(`CREATE DATABASE ${db} TEMPLATE ${TEMPLATE} OWNER ${LEARNER}`))
  const { learner } = await secrets()
  const c = await PgConnection.open({ port: s.port, user: LEARNER, password: learner, database: db })
  // A query that runs away, or waits on the other session's lock, stops instead of hanging the lesson
  await c.query("SET statement_timeout = '20s'; SET lock_timeout = '5s'; SET idle_in_transaction_session_timeout = '30min'")
  mine.set(name, c)
  return c
}

/** A reply as the lab's result: the last statement that returned rows, else the last one */
export function labResultOf(r: PgReply, maxRows = MAX_ROWS): LabResult {
  const notes = r.notices.length ? `\n${r.notices.join('\n')}` : ''
  if (r.error) {
    const where = r.error.position ? ` (at character ${r.error.position})` : ''
    const more = [r.error.detail ? `Detail: ${r.error.detail}` : '', r.error.hint ? `Hint: ${r.error.hint}` : '', r.error.code === '55P03' ? 'It waited 5 seconds for a lock the other session holds: finish that session’s transaction (COMMIT or ROLLBACK) and run this again.' : '', r.status === 'E' ? 'The transaction has failed: run ROLLBACK before anything else in this session.' : ''].filter(Boolean)
    return { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: r.ms, error: `${r.error.message}${where}${more.length ? `\n${more.join('\n')}` : ''}` }
  }
  const withRows = [...r.sets].reverse().find((x) => x.fields.length)
  const last = r.sets[r.sets.length - 1]
  const set = withRows ?? last
  if (!set) return { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: r.ms, changes: null }
  if (!set.fields.length) {
    const n = /^(?:INSERT \d+|UPDATE|DELETE|MERGE|COPY) (\d+)$/.exec(set.command)?.[1]
    return { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: r.ms, changes: n ? Number(n) : null, ...(notes ? { error: null } : {}) }
  }
  const rows = set.rows.slice(0, maxRows).map((row) => row.map((v, i) => cellOf(v, set.fields[i].typeOid)))
  return { columns: set.fields.map((f) => f.name), types: set.fields.map((f) => PG_TYPES[f.typeOid] ?? ''), rows, rowCount: set.rows.length, truncated: set.rows.length > maxRows, elapsedMs: r.ms }
}

/** Runs SQL on a lesson's Postgres database, in session A (the default) or B */
export async function pgQuery(labId: string, sql: string, o: { session?: string; maxRows?: number } = {}): Promise<LabResult & { session: string; transaction: 'idle' | 'open' | 'failed' }> {
  const name = /^b$/i.test(o.session ?? '') ? 'B' : 'A'
  const fail = (error: string) => ({ columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 0, error, session: name, transaction: 'idle' as const })
  if (!postgresReady()) return fail(packMissingText('postgres', 'Postgres SQL'))
  if (!sql.trim()) return fail('There is no query to run.')
  try {
    const c = await session(labId, name)
    const r = await c.query(sql)
    return { ...labResultOf(r, o.maxRows), session: name, transaction: r.status === 'T' ? 'open' : r.status === 'E' ? 'failed' : 'idle' }
  } catch (e) {
    return fail((e as Error).message)
  }
}

/** Puts a lesson's database back as it started: both sessions close and it is copied again */
export async function pgReset(labId: string): Promise<void> {
  const key = labId || 'scratch'
  for (const c of sessions.get(key)?.values() ?? []) c.close()
  sessions.delete(key)
  told.delete(key)
  if (!server) return
  const s = await server
  await s.admin.query(`DROP DATABASE IF EXISTS ${databaseFor(key)} WITH (FORCE)`)
}

/** The tables of a lesson's database, for the tutor */
export async function pgSchemaText(labId: string): Promise<string> {
  const r = await pgQuery(labId, `SELECT table_name, string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' GROUP BY table_name ORDER BY table_name`, { maxRows: 100 })
  if (r.error) return ''
  return `The Postgres lab's tables (PostgreSQL 18, the same sample data as the SQLite lab, with dates as date and timestamp, and real primary and foreign keys): ${r.rows.map((row) => `${row[0]} (${row[1]})`).join('; ')}. Session A is the default; start a block with -- session: B to run it in a second connection, to show transactions and isolation levels. lock_timeout is 5 s.`
}

/** For the tutor's run_sql with engine postgres: the result as text, the tables told the first time */
export async function runPgTool(labId: string, sql: string, sessionName?: string): Promise<{ text: string; ok: boolean; detail: string }> {
  const r = await pgQuery(labId, sql, { session: sessionName ?? sessionOf(sql), maxRows: 30 })
  let text = `[Postgres, session ${r.session}${r.transaction === 'open' ? ', inside a transaction' : r.transaction === 'failed' ? ', transaction failed: ROLLBACK first' : ''}]\n${resultText(r)}`
  const key = labId || 'scratch'
  if (!r.error?.includes('isn\'t installed') && !told.has(key)) {
    told.add(key)
    const schema = await pgSchemaText(labId)
    if (schema) text += `\n\n${schema}`
  }
  return { text, ok: !r.error, detail: r.error ? 'error' : r.columns.length ? `${r.rowCount} row${r.rowCount === 1 ? '' : 's'}` : 'done' }
}

/** "-- session: B" on a block's first lines sends it to the second session */
export const sessionOf = (sql: string) => /^\s*--\s*session\s*:?\s*([ab])\b/im.exec(sql.split('\n').slice(0, 3).join('\n'))?.[1]?.toUpperCase() ?? 'A'

export async function stopPostgres(): Promise<void> {
  const s = await server?.catch(() => null)
  for (const m of sessions.values()) for (const c of m.values()) c.close()
  sessions.clear()
  told.clear()
  server = null
  if (!s) return
  s.admin.close()
  // SIGINT: Postgres's fast shutdown, so the next start needs no recovery
  s.child.kill('SIGINT')
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      s.child.kill('SIGKILL')
      resolve()
    }, 5000)
    s.child.once('exit', () => {
      clearTimeout(t)
      resolve()
    })
  })
}
