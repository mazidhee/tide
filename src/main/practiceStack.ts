/**
 * The practice stack, main side (shared/practiceStack has the compose file and labels): Docker
 * Compose runs a MongoDB and a Metabase on loopback ports; the data is generated from the learner's
 * own spec in their notes (shared/practiceData) and loaded with mongoimport inside the container, so
 * nothing needs installing on the Mac but Docker. On first start Metabase is set up through its setup
 * API: a local admin with a generated password, the practice MongoDB added, and an API key for Tide.
 * The password and key are encrypted with the Keychain like Tide's other keys (main/cloud), in
 * Tide's own data, never in the notes.
 *
 * Kept apart from the company Metabase (main/metabase): that stays read-only and is reached only
 * through its own client; this one is reached only through practiceClient, which refuses any address
 * but this Mac's.
 *
 * Where things are kept: <userData>/practice/{docker-compose.yml, seed/, state.json}.
 */
import { app, ipcMain, shell } from 'electron'
import { execFile } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { existsSync, promises as fs, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { composeFile, PRACTICE_DB, PRACTICE_PORTS, PRACTICE_PROJECT, PRACTICE_URL, SPEC_PATHS, type DockerState, type PracticeStatus } from '@shared/practiceStack'
import { generate, specProblems, toExtendedJson, type PracticeSpec } from '@shared/practiceData'
import { applyLayout, indexMeta, LAYOUT_PATHS, layoutNeeds, layoutProblems, type DbMeta, type PracticeLayout } from '@shared/practiceLayout'
import { getKey, setKey } from './cloud'
import { practiceClient, queryRows, type PracticeClient } from './metabase'
import type { McpTool } from './tideMcp'

const KEY_PASSWORD = 'practice-metabase-password'
const KEY_API = 'practice-metabase-key'
const EMAIL = 'practice@tide.local'

const dir = () => join(app.getPath('userData'), 'practice')
const seedDir = () => join(dir(), 'seed')
const composePath = () => join(dir(), 'docker-compose.yml')
const statePath = () => join(dir(), 'state.json')

interface StackState {
  seeded?: { at: number; collections: { name: string; count: number }[]; spec: string }
  layout?: { at: number; questions: number; dashboards: number; made: number; missing: string[] }
  metabase?: { databaseId: number; email: string }
}

function readState(): StackState {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as StackState
  } catch {
    return {}
  }
}
function writeState(s: StackState) {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(statePath(), JSON.stringify(s, null, 2))
}

// ---------- Docker ----------

const DOCKER_PATHS = ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', join(homedir(), '.docker/bin/docker'), '/Applications/Docker.app/Contents/Resources/bin/docker']
export const findDocker = () => DOCKER_PATHS.find((p) => existsSync(p)) ?? null

function run(args: string[], timeoutMs = 120_000): Promise<{ code: number; out: string; err: string }> {
  const docker = findDocker()
  if (!docker) return Promise.resolve({ code: 127, out: '', err: 'Docker isn’t installed.' })
  const PATH = [dirname(docker), '/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.docker/bin'), '/usr/bin', '/bin'].join(':')
  return new Promise((resolve) =>
    execFile(docker, args, { env: { ...process.env, PATH }, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? ((e as { code: number }).code) : 1) : 0, out: String(out), err: String(err) }))
  )
}

const compose = (args: string[], timeoutMs?: number) => run(['compose', '-p', PRACTICE_PROJECT, '-f', composePath(), ...args], timeoutMs)

async function dockerState(): Promise<DockerState> {
  if (!findDocker()) return 'missing'
  const r = await run(['info', '--format', '{{.ServerVersion}}'], 15_000)
  return r.code === 0 && r.out.trim() ? 'ok' : 'not-running'
}

async function running(): Promise<{ mongo: boolean; metabase: boolean }> {
  if (!existsSync(composePath())) return { mongo: false, metabase: false }
  const r = await compose(['ps', '--format', '{{.Service}} {{.State}}'], 20_000)
  const up = (svc: string) => r.out.split('\n').some((l) => l.startsWith(`${svc} `) && /running/.test(l))
  return { mongo: up('mongo'), metabase: up('metabase') }
}

// ---------- The spec, in the notes ----------

async function readSpec(): Promise<{ path: string | null; spec: PracticeSpec | null; text: string; problems: string[] }> {
  const { absPath } = await import('./vault')
  for (const rel of SPEC_PATHS) {
    let text: string
    try {
      text = await fs.readFile(absPath(rel), 'utf8')
    } catch {
      continue
    }
    try {
      const raw = rel.endsWith('.json') ? JSON.parse(text) : ((await import('gray-matter')).default as unknown as { engines: { yaml: { parse(s: string): unknown } } }).engines.yaml.parse(text)
      const problems = specProblems(raw)
      return { path: rel, spec: problems.length ? null : (raw as PracticeSpec), text, problems }
    } catch (e) {
      return { path: rel, spec: null, text, problems: [`${rel} can’t be read: ${(e as Error).message}`] }
    }
  }
  return { path: null, spec: null, text: '', problems: [`No spec yet. Put one at ${SPEC_PATHS[0]} in your notes.`] }
}

/** The learner's Metabase layout (collections, questions, dashboards), when there is one */
async function readLayout(): Promise<{ path: string | null; layout: PracticeLayout | null; problems: string[] }> {
  const { absPath } = await import('./vault')
  for (const rel of LAYOUT_PATHS) {
    let text: string
    try {
      text = await fs.readFile(absPath(rel), 'utf8')
    } catch {
      continue
    }
    try {
      const raw = JSON.parse(text)
      const problems = layoutProblems(raw)
      return { path: rel, layout: problems.length ? null : (raw as PracticeLayout), problems }
    } catch (e) {
      return { path: rel, layout: null, problems: [`${rel} can’t be read: ${(e as Error).message}`] }
    }
  }
  return { path: null, layout: null, problems: [] }
}

// ---------- Status ----------

let busy = ''
let lastError = ''

async function metabaseUp(): Promise<boolean> {
  const r = await fetch(`${PRACTICE_URL}/api/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
  return !!r?.ok
}

export async function practiceStatus(): Promise<PracticeStatus> {
  const docker = await dockerState()
  const st = readState()
  const spec = await readSpec().catch(() => ({ path: null, spec: null, text: '', problems: ['The notes folder isn’t open.'] }))
  const lay = await readLayout().catch(() => ({ path: null, layout: null, problems: [] as string[] }))
  const layout = { path: lay.path, problems: lay.problems, questions: lay.layout?.questions.length ?? 0, dashboards: lay.layout?.dashboards.length ?? 0, built: st.layout ?? null }
  const specInfo = { path: spec.path, problems: spec.problems, name: spec.spec?.name, collections: spec.spec?.collections.length ?? 0, documents: spec.spec?.collections.reduce((s, c) => s + c.count, 0) ?? 0 }
  const base = { docker, running: false, mongo: 'down' as const, metabase: 'down' as const, setUp: !!st.metabase && !!getKey(KEY_API), seeded: st.seeded ?? null, spec: specInfo, layout, url: PRACTICE_URL, ports: PRACTICE_PORTS, ...(busy ? { busy } : {}), ...(lastError ? { error: lastError } : {}) }
  if (docker !== 'ok') return base
  const up = await running()
  const mbReady = up.metabase && (await metabaseUp())
  return { ...base, running: up.mongo || up.metabase, mongo: up.mongo ? 'up' : 'down', metabase: up.metabase ? (mbReady ? 'ready' : 'starting') : 'down' }
}

// ---------- Data ----------

const mongosh = (js: string) => compose(['exec', '-T', 'mongo', 'mongosh', '--quiet', PRACTICE_DB, '--eval', js], 60_000)

async function waitFor(what: () => Promise<boolean>, ms: number, label: string) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await what().catch(() => false)) return
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`${label} didn’t come up in ${Math.round(ms / 60_000)} minutes.`)
}

/** Generates the data from the spec and loads it, replacing each collection */
async function seed(): Promise<void> {
  const spec = await readSpec()
  if (!spec.spec) throw new Error(spec.problems.join(' '))
  busy = 'Generating practice data…'
  const data = generate(spec.spec)
  await fs.rm(seedDir(), { recursive: true, force: true })
  await fs.mkdir(seedDir(), { recursive: true })
  for (const [name, docs] of data) await fs.writeFile(join(seedDir(), `${name}.json`), toExtendedJson(docs))
  busy = 'Loading practice data…'
  await mongosh('db.dropDatabase()')
  // Copied into the container (no shared folder needed), then loaded there with mongoimport
  await compose(['exec', '-T', 'mongo', 'sh', '-c', 'rm -rf /tmp/seed && mkdir -p /tmp/seed'])
  const cp = await compose(['cp', `${seedDir()}/.`, 'mongo:/tmp/seed/'], 300_000)
  if (cp.code !== 0) throw new Error(`Copying the data into MongoDB failed: ${(cp.err || cp.out).slice(0, 300)}`)
  for (const [name] of data) {
    const r = await compose(['exec', '-T', 'mongo', 'mongoimport', '--quiet', '--db', PRACTICE_DB, '--collection', name, '--drop', '--jsonArray', '--file', `/tmp/seed/${name}.json`], 300_000)
    if (r.code !== 0 || /Failed|error/i.test(r.err)) throw new Error(`Loading ${name} failed: ${(r.err || r.out).slice(0, 300)}`)
  }
  // A collection with no documents still exists (Metabase lists it), as in the database it copies
  const empty = [...data].filter(([, docs]) => !docs.length).map(([name]) => name)
  if (empty.length) await mongosh(`${JSON.stringify(empty)}.forEach((n) => { if (!db.getCollectionNames().includes(n)) db.createCollection(n) })`)
  await compose(['exec', '-T', 'mongo', 'rm', '-rf', '/tmp/seed'])
  const st = readState()
  writeState({ ...st, seeded: { at: Date.now(), collections: [...data].map(([name, docs]) => ({ name, count: docs.length })), spec: createHash('sha1').update(spec.text).digest('hex').slice(0, 12) } })
}

// ---------- Metabase, set up once ----------

async function mbFetch<T>(path: string, init: { method?: string; body?: unknown; session?: string } = {}): Promise<T> {
  const res = await fetch(`${PRACTICE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.session ? { 'X-Metabase-Session': init.session } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(60_000)
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Metabase ${path}: ${text.slice(0, 200)}`)
  return (text ? JSON.parse(text) : null) as T
}

const DATABASE = () => ({ engine: 'mongo', name: 'Practice data', details: { host: 'mongo', port: 27017, dbname: PRACTICE_DB, 'use-conn-uri': false, ssl: false } })

/** The admin, the practice database and Tide's API key: made once, kept in Tide's data */
async function setUpMetabase(): Promise<void> {
  const st = readState()
  if (st.metabase && getKey(KEY_API)) {
    // Still good? (a Metabase volume removed by hand starts empty)
    const ok = await practiceClient({ url: PRACTICE_URL, key: getKey(KEY_API) }).get('/api/database').then(() => true, () => false)
    if (ok) return
  }
  busy = 'Setting up Metabase…'
  const props = await mbFetch<{ 'setup-token'?: string; 'has-user-setup'?: boolean }>('/api/session/properties')
  let password = getKey(KEY_PASSWORD)
  let session: string
  if (!props['has-user-setup']) {
    password = `${randomBytes(18).toString('base64url')}-Tp1`
    setKey(KEY_PASSWORD, password)
    const made = await mbFetch<{ id: string }>('/api/setup', {
      method: 'POST',
      body: { token: props['setup-token'], user: { first_name: 'Practice', last_name: 'Learner', email: EMAIL, password, site_name: 'Tide practice' }, prefs: { site_name: 'Tide practice', site_locale: 'en', allow_tracking: false } }
    })
    session = made.id
  } else {
    if (!password) throw new Error('This practice Metabase was set up before and Tide no longer has its password. Use Reset with “start Metabase afresh”, or remove the tide-practice_metabase volume.')
    session = (await mbFetch<{ id: string }>('/api/session', { method: 'POST', body: { username: EMAIL, password } })).id
  }
  const dbs = await mbFetch<{ data: { id: number; engine: string; details?: { dbname?: string } }[] }>('/api/database', { session })
  const db = dbs.data.find((d) => d.engine === 'mongo' && d.details?.dbname === PRACTICE_DB) ?? (await mbFetch<{ id: number }>('/api/database', { method: 'POST', session, body: DATABASE() }))
  const groups = await mbFetch<{ id: number; name: string }[]>('/api/permissions/group', { session })
  const admin = groups.find((g) => /admin/i.test(g.name)) ?? { id: 2 }
  const key = await mbFetch<{ unmasked_key: string }>('/api/api-key', { method: 'POST', session, body: { name: `Tide ${new Date().toISOString().slice(0, 16)}`, group_id: admin.id } })
  setKey(KEY_API, key.unmasked_key)
  writeState({ ...readState(), metabase: { databaseId: db.id, email: EMAIL } })
}

/** The practice Metabase's address and key, once it is set up */
export function practiceAuth(): { url: string; key: string; databaseId: number } | null {
  const st = readState()
  const key = getKey(KEY_API)
  return st.metabase && key ? { url: PRACTICE_URL, key, databaseId: st.metabase.databaseId } : null
}

export const practiceMetabase = (): PracticeClient | null => {
  const a = practiceAuth()
  return a ? practiceClient(a) : null
}

async function sync() {
  const a = practiceAuth()
  if (a) await practiceClient(a).post(`/api/database/${a.databaseId}/sync_schema`, {}).catch(() => null)
}

// ---------- The layout ----------

/**
 * Recreates the learner's layout in the practice Metabase: waits until the database has synced every
 * table and field the layout names (a fresh load takes a while), then makes or updates in place.
 */
async function buildLayout(): Promise<void> {
  const lay = await readLayout()
  if (!lay.path) return
  if (!lay.layout) throw new Error(lay.problems.slice(0, 3).join(' '))
  const a = practiceAuth()
  if (!a) throw new Error('The practice Metabase isn’t set up yet: press Start first.')
  const c = practiceClient(a)
  busy = 'Waiting for Metabase to read the practice data…'
  const need = layoutNeeds(lay.layout)
  let meta: DbMeta = { tables: [] }
  const end = Date.now() + 300_000
  for (;;) {
    meta = await c.get<DbMeta>(`/api/database/${a.databaseId}/metadata`)
    const ix = indexMeta(meta)
    const left = [...need].filter((n) => (n.startsWith('table ') ? ix.table(n.slice(6)) === undefined : !(() => { const [t, ...p] = n.slice(6).split('.'); return ix.field(t, p.join('.')) !== undefined })()))
    if (!left.length || Date.now() > end) break
    await new Promise((r) => setTimeout(r, 5000))
  }
  busy = 'Building your Metabase layout…'
  const r = await applyLayout(c, lay.layout, a.databaseId, meta)
  writeState({ ...readState(), layout: { at: Date.now(), questions: Object.keys(r.questionIds).length, dashboards: Object.keys(r.dashboardIds).length, made: r.created.collections + r.created.questions + r.created.dashboards, missing: r.missing } })
}

export const rebuildLayout = () =>
  one(async () => {
    lastError = ''
    try {
      await buildLayout()
    } catch (e) {
      lastError = `Layout: ${(e as Error).message}`
    }
    busy = ''
    return practiceStatus()
  })

// ---------- Start, stop, reset ----------

async function prepare() {
  mkdirSync(seedDir(), { recursive: true })
  writeFileSync(composePath(), composeFile())
}

let work: Promise<unknown> | null = null
const one = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (work) await work.catch(() => null)
  const p = fn().finally(() => {
    busy = ''
    if (work === p) work = null
  })
  work = p
  return p
}

async function needDocker() {
  const d = await dockerState()
  if (d === 'missing') throw new Error('Docker isn’t installed. Install Docker Desktop to run practice data.')
  if (d === 'not-running') throw new Error('Docker isn’t running. Open Docker Desktop and try again.')
}

export const startPractice = () =>
  one(async () => {
    lastError = ''
    try {
      await needDocker()
      await prepare()
      busy = 'Starting the containers…'
      const up = await compose(['up', '-d'], 600_000)
      if (up.code !== 0) throw new Error(`Docker couldn’t start the practice stack: ${(up.err || up.out).trim().split('\n').slice(-2).join(' ')}`)
      busy = 'Waiting for MongoDB…'
      await waitFor(async () => (await mongosh('db.adminCommand("ping").ok')).out.trim() === '1', 120_000, 'MongoDB')
      if (!readState().seeded) await seed()
      busy = 'Starting Metabase (this takes a minute or two)…'
      await waitFor(metabaseUp, 360_000, 'Metabase')
      await setUpMetabase()
      await sync()
      await buildLayout().catch((e: Error) => {
        lastError = `Layout: ${e.message}`
      })
    } catch (e) {
      lastError = (e as Error).message
    }
    busy = ''
    return practiceStatus()
  })

export const stopPractice = () =>
  one(async () => {
    lastError = ''
    if ((await dockerState()) === 'ok' && existsSync(composePath())) {
      busy = 'Stopping…'
      const r = await compose(['stop'], 120_000)
      if (r.code !== 0) lastError = `Docker couldn’t stop it: ${r.err.trim().slice(0, 200)}`
    }
    busy = ''
    return practiceStatus()
  })

/** Generates the data again from the spec and reloads it; questions saved in Metabase are kept */
export const resetPractice = () =>
  one(async () => {
    lastError = ''
    try {
      await needDocker()
      await prepare()
      if (!(await running()).mongo) {
        busy = 'Starting MongoDB…'
        const up = await compose(['up', '-d', 'mongo'], 300_000)
        if (up.code !== 0) throw new Error(up.err.trim().slice(0, 300))
        await waitFor(async () => (await mongosh('db.adminCommand("ping").ok')).out.trim() === '1', 120_000, 'MongoDB')
      }
      await seed()
      await sync()
    } catch (e) {
      lastError = (e as Error).message
    }
    busy = ''
    return practiceStatus()
  })

export function registerPractice(): void {
  ipcMain.handle('practice:status', () => practiceStatus())
  ipcMain.handle('practice:start', () => startPractice())
  ipcMain.handle('practice:stop', () => stopPractice())
  ipcMain.handle('practice:reset', () => resetPractice())
  ipcMain.handle('practice:layout', () => rebuildLayout())
  ipcMain.handle('practice:open', () => shell.openExternal(PRACTICE_URL))
  // Local only, and yours: the practice admin Tide made, for signing in to it yourself
  ipcMain.handle('practice:login', () => {
    const password = getKey(KEY_PASSWORD)
    return readState().metabase && password ? { email: EMAIL, password } : null
  })
}

// ---------- The tutor's tool ----------

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

async function collections(c: PracticeClient, db: number): Promise<string> {
  const meta = await c.get<{ tables: { id: number; name: string; fields: { name: string; base_type?: string; database_type?: string }[] }[] }>(`/api/database/${db}/metadata`)
  return meta.tables.map((t) => `- ${t.name} (table ${t.id}): ${t.fields.slice(0, 40).map((f) => `${f.name} ${String(f.database_type ?? f.base_type ?? '').replace('type/', '')}`).join(', ')}`).join('\n') || 'No collections yet: Metabase may still be syncing. Try again in a moment.'
}

/** The learner's own file in their lesson folder: a question is saved from their words, never the tutor's */
async function learnerFile(labId: string | undefined, file: string): Promise<string> {
  const { lessonOf } = await import('./ide/lesson')
  const l = lessonOf(labId ?? '')
  if (!l) throw new Error('This lesson has no workspace folder.')
  const rel = file.replace(/^\/+/, '')
  if (!rel || rel.includes('..')) throw new Error('Give the file’s path inside their workspace.')
  return fs.readFile(join(l.root, rel), 'utf8')
}

export const PRACTICE_TOOL: McpTool = {
  name: 'practice_metabase',
  description:
    'The practice Metabase and its MongoDB on this Mac ("Practice, yours to break"), never their company data. Actions: collections (the practice collections and their fields), pipeline (run an aggregation pipeline the learner wrote: give their text, as db.<collection>.aggregate([...]) or with collection), question (read one saved question by id), questions (list saved questions), save_question (save the pipeline in one of their workspace files as a Metabase question, only when they ask: name and file).',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['collections', 'pipeline', 'question', 'questions', 'save_question'] },
      pipeline: { type: 'string' },
      collection: { type: 'string' },
      id: { type: 'number' },
      name: { type: 'string' },
      file: { type: 'string', description: 'save_question: their file in the workspace, e.g. step2.js' }
    },
    required: ['action']
  },
  async run(args, ctx) {
    const a = practiceAuth()
    if (!a) return 'The practice data isn’t running. Ask them to start it in Settings › Practice data.'
    const c = practiceClient(a)
    const { parsePipeline } = await import('@shared/mongoPipeline')
    const { resultTable } = await import('@shared/resultCompare')
    switch (args.action) {
      case 'collections':
        return collections(c, a.databaseId)
      case 'pipeline': {
        const p = parsePipeline(String(args.pipeline ?? ''))
        if ('error' in p) return p.error
        const coll = p.collection ?? String(args.collection ?? '')
        if (!coll) return 'Say which collection: db.<collection>.aggregate([...]) or give collection.'
        ctx.step({ kind: 'helper', label: `Ran a pipeline on the practice ${coll}`, status: 'done', depth: 0 })
        const r = await queryRows({ database: a.databaseId, pipeline: { collection: coll, stages: p.stages } }, 50, c)
        return r.error ? `The pipeline failed: ${clip(r.error, 400)}` : `${r.rows.length}${r.truncated ? '+' : ''} rows in ${(r.ms / 1000).toFixed(1)} s.\n${resultTable(r, 25)}`
      }
      case 'question': {
        const q = await c.get<{ name: string; dataset_query?: { native?: { query?: string; collection?: string } } }>(`/api/card/${Number(args.id)}`)
        return `Question ${Number(args.id)}: ${q.name}\n${q.dataset_query?.native ? `On ${q.dataset_query.native.collection}:\n${clip(String(q.dataset_query.native.query ?? ''), 2500)}` : clip(JSON.stringify(q.dataset_query ?? {}), 1500)}`
      }
      case 'questions': {
        const all = await c.get<{ id: number; name: string; database_id?: number }[]>('/api/card?f=all')
        return all.filter((q) => q.database_id === a.databaseId).map((q) => `- question ${q.id}: ${q.name}`).join('\n') || 'No saved questions yet.'
      }
      case 'save_question': {
        const name = String(args.name ?? '').trim()
        if (!name) return 'Give the question a name.'
        const text = await learnerFile(ctx.labId, String(args.file ?? ''))
        const p = parsePipeline(text)
        if ('error' in p) return `Their file isn’t a pipeline Tide can read: ${p.error}`
        const coll = p.collection ?? String(args.collection ?? '')
        if (!coll) return 'Their file doesn’t name the collection (db.<collection>.aggregate).'
        const made = await c.post<{ id: number }>('/api/card', { name, type: 'question', display: 'table', visualization_settings: {}, dataset_query: { database: a.databaseId, type: 'native', native: { collection: coll, query: JSON.stringify(p.stages) } } })
        ctx.step({ kind: 'helper', label: `Saved “${name}” in the practice Metabase`, status: 'done', depth: 0 })
        return `Saved as question ${made.id} in the practice Metabase (${PRACTICE_URL}/question/${made.id}).`
      }
      default:
        return 'Unknown action. Use collections, pipeline, question, questions or save_question.'
    }
  }
}
