/**
 * A small PostgreSQL client for the SQL lab: the frontend/backend protocol's simple query flow
 * over TCP to the lab's own server on 127.0.0.1, with SCRAM-SHA-256 sign-in. Enough for teaching
 * (several statements at once, every result set, notices, errors with their position and hint)
 * and nothing more, so Tide needs no database driver. Values come back as text and are turned
 * into numbers where the column's type is numeric.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'crypto'
import { Socket, connect } from 'net'

export interface PgField {
  name: string
  typeOid: number
}

export interface PgResultSet {
  fields: PgField[]
  rows: (string | null)[][]
  /** The command tag: "SELECT 3", "INSERT 0 1", "BEGIN" */
  command: string
}

export interface PgError {
  message: string
  code: string
  detail?: string
  hint?: string
  /** 1-based character position in the query */
  position?: number
  severity: string
}

export interface PgReply {
  sets: PgResultSet[]
  notices: string[]
  error?: PgError
  /** Transaction state after the query: I idle, T in a transaction, E in a failed one */
  status: 'I' | 'T' | 'E'
  ms: number
}

/** Type names for the column headers, by OID (pg_type) */
export const PG_TYPES: Record<number, string> = {
  16: 'boolean', 17: 'bytea', 18: 'char', 19: 'name', 20: 'bigint', 21: 'smallint', 23: 'integer', 25: 'text', 26: 'oid', 114: 'json', 142: 'xml',
  700: 'real', 701: 'double precision', 790: 'money', 1042: 'character', 1043: 'varchar', 1082: 'date', 1083: 'time', 1114: 'timestamp', 1184: 'timestamptz',
  1186: 'interval', 1266: 'timetz', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb', 3904: 'int4range', 3906: 'numrange', 3912: 'daterange', 1009: 'text[]', 1007: 'integer[]'
}
const NUMERIC = new Set([20, 21, 23, 26, 700, 701, 1700])

/** A text value as the lab shows it: numbers as numbers when they fit, booleans as words */
export function cellOf(v: string | null, typeOid: number): string | number | null {
  if (v === null) return null
  if (typeOid === 16) return v === 't' ? 'true' : 'false'
  if (NUMERIC.has(typeOid)) {
    const n = Number(v)
    if (Number.isFinite(n) && (typeOid !== 20 || Number.isSafeInteger(n)) && (typeOid !== 1700 || String(n) === v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''))) return n
  }
  return v
}

// ---------- Framing ----------

function message(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(5)
  head.write(type, 0, 'latin1')
  head.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([head, body])
}
const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])])

function startup(user: string, database: string): Buffer {
  const body = Buffer.concat([Buffer.from([0, 3, 0, 0]), cstr('user'), cstr(user), cstr('database'), cstr(database), cstr('application_name'), cstr('Tide SQL lab'), cstr('client_encoding'), cstr('UTF8'), Buffer.from([0])])
  const len = Buffer.alloc(4)
  len.writeInt32BE(body.length + 4)
  return Buffer.concat([len, body])
}

/** ErrorResponse and NoticeResponse fields */
function fields(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i])
    const end = body.indexOf(0, i + 1)
    out[code] = body.toString('utf8', i + 1, end)
    i = end + 1
  }
  return out
}

// ---------- SCRAM-SHA-256 (RFC 5802, RFC 7677) ----------

const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text).digest()

export function scramClientFinal(password: string, clientFirstBare: string, serverFirst: string): { final: string; serverSignature: string } {
  const attrs = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]))
  const salted = pbkdf2Sync(password.normalize('NFKC'), Buffer.from(attrs.s, 'base64'), Number(attrs.i), 32, 'sha256')
  const clientKey = hmac(salted, 'Client Key')
  const storedKey = createHash('sha256').update(clientKey).digest()
  const withoutProof = `c=biws,r=${attrs.r}`
  const auth = `${clientFirstBare},${serverFirst},${withoutProof}`
  const signature = hmac(storedKey, auth)
  const proof = Buffer.from(clientKey.map((b, i) => b ^ signature[i]))
  const serverKey = hmac(salted, 'Server Key')
  return { final: `${withoutProof},p=${proof.toString('base64')}`, serverSignature: hmac(serverKey, auth).toString('base64') }
}

// ---------- The connection ----------

export class PgConnection {
  private sock: Socket
  private buf = Buffer.alloc(0)
  private waiters: ((m: { type: string; body: Buffer }) => void)[] = []
  private queue: { type: string; body: Buffer }[] = []
  private closedWith: Error | null = null
  busy: Promise<unknown> = Promise.resolve()

  private constructor(sock: Socket) {
    this.sock = sock
    sock.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d])
      while (this.buf.length >= 5) {
        const len = this.buf.readInt32BE(1)
        if (this.buf.length < len + 1) break
        const m = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, len + 1) }
        this.buf = this.buf.subarray(len + 1)
        const w = this.waiters.shift()
        if (w) w(m)
        else this.queue.push(m)
      }
    })
    const fail = (e: Error) => {
      this.closedWith = e
      for (const w of this.waiters.splice(0)) w({ type: '!', body: Buffer.from(e.message) })
    }
    sock.on('error', fail)
    sock.on('close', () => fail(new Error('The connection to Postgres closed')))
  }

  get closed() {
    return !!this.closedWith
  }

  private next(): Promise<{ type: string; body: Buffer }> {
    const m = this.queue.shift()
    if (m) return Promise.resolve(m)
    if (this.closedWith) return Promise.reject(this.closedWith)
    return new Promise((resolve, reject) =>
      this.waiters.push((x) => {
        if (x.type === '!') reject(new Error(x.body.toString()))
        else resolve(x)
      })
    )
  }

  static async open(o: { port: number; user: string; password: string; database: string; host?: string; timeoutMs?: number }): Promise<PgConnection> {
    const sock = connect({ host: o.host ?? '127.0.0.1', port: o.port })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Postgres didn’t answer')), o.timeoutMs ?? 10_000)
      sock.once('connect', () => {
        clearTimeout(t)
        resolve()
      })
      sock.once('error', (e) => {
        clearTimeout(t)
        reject(e)
      })
    })
    sock.setNoDelay(true)
    const c = new PgConnection(sock)
    sock.write(startup(o.user, o.database))
    let nonce = ''
    let firstBare = ''
    let expectSig = ''
    for (;;) {
      const m = await c.next()
      if (m.type === 'E') {
        sock.destroy()
        throw new Error(fields(m.body).M ?? 'Postgres refused the connection')
      }
      if (m.type === 'R') {
        const kind = m.body.readInt32BE(0)
        if (kind === 0) continue
        if (kind === 10) {
          const mechs = m.body.subarray(4).toString('utf8').split('\0').filter(Boolean)
          if (!mechs.includes('SCRAM-SHA-256')) throw new Error(`Postgres asked for ${mechs.join(', ')}, which Tide doesn't speak`)
          nonce = randomBytes(18).toString('base64')
          firstBare = `n=,r=${nonce}`
          const first = Buffer.from(`n,,${firstBare}`)
          const len = Buffer.alloc(4)
          len.writeInt32BE(first.length)
          sock.write(message('p', Buffer.concat([cstr('SCRAM-SHA-256'), len, first])))
          continue
        }
        if (kind === 11) {
          const serverFirst = m.body.subarray(4).toString('utf8')
          if (!serverFirst.startsWith(`r=${nonce}`)) throw new Error('Postgres answered the sign-in with the wrong nonce')
          const { final, serverSignature } = scramClientFinal(o.password, firstBare, serverFirst)
          expectSig = serverSignature
          sock.write(message('p', Buffer.from(final)))
          continue
        }
        if (kind === 12) {
          const v = /v=([^,]+)/.exec(m.body.subarray(4).toString('utf8'))?.[1]
          if (v !== expectSig) throw new Error('Postgres’s answer to the sign-in didn’t check out')
          continue
        }
        if (kind === 3) {
          sock.write(message('p', cstr(o.password)))
          continue
        }
        throw new Error(`Postgres asked for a sign-in method (${kind}) Tide doesn't speak`)
      }
      if (m.type === 'Z') return c
      // S (parameter status), K (backend key), N (notice): nothing to do
    }
  }

  /** Runs one or more statements (the simple query protocol); every result set comes back */
  query(sql: string): Promise<PgReply> {
    const run = this.busy.then(() => this.run(sql))
    this.busy = run.catch(() => {})
    return run
  }

  private async run(sql: string): Promise<PgReply> {
    const t0 = performance.now()
    this.sock.write(message('Q', cstr(sql)))
    const sets: PgResultSet[] = []
    const notices: string[] = []
    let current: PgResultSet | null = null
    let error: PgError | undefined
    for (;;) {
      const m = await this.next()
      switch (m.type) {
        case 'T': {
          const n = m.body.readInt16BE(0)
          const fs: PgField[] = []
          let i = 2
          for (let k = 0; k < n; k++) {
            const end = m.body.indexOf(0, i)
            const name = m.body.toString('utf8', i, end)
            i = end + 1
            const typeOid = m.body.readInt32BE(i + 6)
            i += 18
            fs.push({ name, typeOid })
          }
          current = { fields: fs, rows: [], command: '' }
          break
        }
        case 'D': {
          const n = m.body.readInt16BE(0)
          const row: (string | null)[] = []
          let i = 2
          for (let k = 0; k < n; k++) {
            const len = m.body.readInt32BE(i)
            i += 4
            if (len < 0) row.push(null)
            else {
              row.push(m.body.toString('utf8', i, i + len))
              i += len
            }
          }
          current?.rows.push(row)
          break
        }
        case 'C':
          sets.push({ ...(current ?? { fields: [], rows: [] }), command: m.body.toString('utf8', 0, m.body.length - 1) })
          current = null
          break
        case 'I':
          current = null
          break
        case 'E': {
          const f = fields(m.body)
          error = { message: f.M ?? 'error', code: f.C ?? '', severity: f.V ?? f.S ?? 'ERROR', ...(f.D ? { detail: f.D } : {}), ...(f.H ? { hint: f.H } : {}), ...(f.P ? { position: Number(f.P) } : {}) }
          break
        }
        case 'N': {
          const f = fields(m.body)
          notices.push(`${f.V ?? f.S ?? 'NOTICE'}: ${f.M ?? ''}`)
          break
        }
        case 'Z':
          return { sets, notices, ...(error ? { error } : {}), status: (String.fromCharCode(m.body[0]) as PgReply['status']) || 'I', ms: performance.now() - t0 }
        default:
          // A (notification), S (parameter status) and the rest: nothing to show
          break
      }
    }
  }

  close(): void {
    try {
      this.sock.write(message('X', Buffer.alloc(0)))
    } catch {
      // already gone
    }
    this.sock.destroy()
  }
}
