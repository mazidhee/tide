#!/usr/bin/env node
/**
 * Checks a practice spec and layout end to end in a hidden, throwaway copy of Tide: it builds the app,
 * starts it with a temporary profile and a temporary notes folder holding only the spec and layout
 * given, presses Start in Practice data (a stack of its own, tide-practice-check, 100 ports up, so your
 * practice data and volumes are never touched), then reports what the practice Mongo and Metabase have:
 * collections, tables, questions, dashboards and names the layout couldn't find.
 *
 *   node scripts/check/practice.mjs --spec <spec.json> [--layout <layout.json>] [--no-build] [--keep] [--shot <file.png>]
 *
 * --shot saves Settings › Practice data as it looks at the end.
 * --keep leaves the stack running (http://127.0.0.1:3147) and the profile, for a look afterwards;
 * remove it later with: docker compose -p tide-practice-check down -v
 */
import { execFileSync, execSync, spawn } from 'child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
const has = (k) => argv.includes(k)
const specPath = opt('--spec')
const layoutPath = opt('--layout')
const shotPath = opt('--shot')
if (!specPath) {
  console.error('Usage: node scripts/check/practice.mjs --spec <spec.json> [--layout <layout.json>] [--no-build] [--keep]')
  process.exit(2)
}
const PROJECT = 'tide-practice-check'
const MB = 'http://127.0.0.1:3147'
const port = 9346
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && !t.url.includes('focus='))
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
        let id = 0
        const pending = new Map()
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data)
          if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id)
        }
        const send = (method, params = {}) => new Promise((res) => (pending.set(++id, res), ws.send(JSON.stringify({ id, method, params }))))
        await send('Runtime.enable')
        const run = async (expr) => {
          const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
          if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error')
          return r.result?.result?.value
        }
        const shot = async (file) => writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
        return { run, shot, close: () => ws.close() }
      }
    } catch {
      // not up yet
    }
    await wait(1000)
  }
  throw new Error('Tide did not start (no DevTools page)')
}

const mongo = (js) => execFileSync('docker', ['compose', '-p', PROJECT, 'exec', '-T', 'mongo', 'mongosh', '--quiet', 'practice', '--eval', js], { encoding: 'utf8' }).trim()

async function metabase(login) {
  const session = (await (await fetch(`${MB}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: login.email, password: login.password }) })).json()).id
  const call = async (path, body) => (await fetch(`${MB}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Metabase-Session': session }, ...(body ? { body: JSON.stringify(body) } : {}) })).json()
  return { get: (path) => call(path), post: (path, body) => call(path, body) }
}

async function main() {
  if (!has('--no-build')) {
    console.log('  … building')
    execSync('npx electron-vite build', { cwd: root, stdio: 'ignore' })
  }
  const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'))
  const layout = layoutPath ? JSON.parse(readFileSync(resolve(layoutPath), 'utf8')) : null
  const temp = mkdtempSync(join(tmpdir(), 'tide-practice-check-'))
  const vault = join(temp, 'vault')
  mkdirSync(join(vault, 'Practice'), { recursive: true })
  cpSync(resolve(specPath), join(vault, 'Practice/spec.json'))
  if (layoutPath) cpSync(resolve(layoutPath), join(vault, 'Practice/layout.json'))
  writeFileSync(join(temp, 'settings.json'), JSON.stringify({ vaultPath: vault, libraryFolder: 'Library', theme: 'system', ai: { baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: '', agent: false } }))
  const app = spawn('npx', ['electron', '.'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, TIDE_USER_DATA: temp, TIDE_PRACTICE_PROJECT: PROJECT, TIDE_REMOTE_DEBUGGING_PORT: String(port), TIDE_THINGS_API: 'http://127.0.0.1:9/v1' }
  })
  let page = null
  const t0 = Date.now()
  try {
    page = await connect()
    for (let i = 0; i < 30 && !(await page.run('!!window.tide?.practiceData')); i++) await wait(1000)
    const before = await page.run('window.tide.practiceData.status()')
    record('spec reads', !before.spec.problems.length, before.spec.problems.slice(0, 3).join(' ') || `${before.spec.collections} collections, ${before.spec.documents} documents`)
    if (layout) record('layout reads', !before.layout?.problems.length, before.layout?.problems.slice(0, 3).join(' ') || `${before.layout.questions} questions, ${before.layout.dashboards} dashboards`)
    console.log('  … starting the practice stack (Metabase takes a few minutes)')
    const s = await page.run('window.tide.practiceData.start()')
    const mins = ((Date.now() - t0) / 60000).toFixed(1)
    record('starts', s.running && s.metabase === 'ready' && !s.error, s.error ? s.error.slice(0, 300) : `${mins} min`)

    const expected = spec.collections.map((c) => c.name).concat(spec.collections.filter((c) => c.create?.timeseries).map((c) => `system.buckets.${c.name}`))
    const listed = JSON.parse(mongo('JSON.stringify(db.getCollectionInfos({}, { nameOnly: true }).map((c) => c.name))'))
    const notThere = expected.filter((n) => !listed.includes(n))
    record('every collection is in the practice Mongo', !notThere.length, `${listed.length} listed, ${expected.length} expected${notThere.length ? `; missing ${notThere.slice(0, 5).join(', ')}` : ''}`)
    const counts = JSON.parse(mongo(`JSON.stringify(${JSON.stringify(spec.collections.filter((c) => c.count > 0).map((c) => c.name))}.map((n) => [n, db.getCollection(n).countDocuments()]))`))
    const short = counts.filter(([n, k]) => k !== (spec.collections.find((c) => c.name === n).rows?.length ?? spec.collections.find((c) => c.name === n).count))
    record('every collection has its documents', !short.length, short.length ? short.slice(0, 5).map(([n, k]) => `${n} ${k}`).join(', ') : `${counts.reduce((a, [, k]) => a + k, 0)} documents`)

    const login = await page.run('window.tide.practiceData.login()')
    const { get, post } = await metabase(login)
    const db = (await get('/api/database')).data.find((d) => d.engine === 'mongo')
    // Metabase reads a large database in the background: give it time to list every table
    let tables = []
    for (let i = 0; i < 60; i++) {
      tables = (await get(`/api/database/${db.id}/metadata?include_hidden=true`)).tables ?? []
      if (expected.every((n) => tables.some((t) => t.name === n))) break
      await wait(10000)
    }
    const noTable = expected.filter((n) => !tables.some((t) => t.name === n))
    record('Metabase lists every table', !noTable.length, `${tables.length} tables in "${db.name}"${noTable.length ? `; missing ${noTable.slice(0, 8).join(', ')}` : ''}`)

    if (layout) {
      // Built at Start once Metabase had read what the layout names; rebuilt now that every table is in
      const after = await page.run('window.tide.practiceData.layout()')
      const built = after.layout?.built
      record('layout builds', !!built && !after.error, after.error ? after.error.slice(0, 300) : `${built.questions} questions, ${built.dashboards} dashboards, ${built.made} made`)
      record('layout names are all in the data', !!built && !built.missing.length, built?.missing.length ? `${built.missing.length}: ${built.missing.slice(0, 8).join(', ')}` : 'none missing')
      const items = await get('/api/search?models=card&models=dashboard&models=collection')
      const n = (m) => (items.data ?? []).filter((x) => x.model === m && !x.archived).length
      record('Metabase has the questions and dashboards', n('card') >= layout.questions.length && n('dashboard') >= layout.dashboards.length, `${n('collection')} collections, ${n('card')} questions, ${n('dashboard')} dashboards`)
      // A run of each dashboard's cards: errors from the practice database, not from the layout
      let ran = 0
      const failed = []
      for (const d of (items.data ?? []).filter((x) => x.model === 'dashboard')) {
        const dash = await get(`/api/dashboard/${d.id}`)
        for (const dc of dash.dashcards ?? []) {
          if (!dc.card_id) continue
          const r = await post(`/api/card/${dc.card_id}/query`, {}).catch(() => ({ error: 'no answer' }))
          ran++
          if (r.error || r.status === 'failed') failed.push(`${d.name} › ${dc.card?.name}: ${String(r.error).slice(0, 120)}`)
        }
      }
      record('dashboard questions run', !failed.length, `${ran - failed.length}/${ran} ran${failed.length ? `; first: ${failed.slice(0, 3).join(' | ')}` : ''}`)
      if (failed.length) writeFileSync(join(temp, 'failed-cards.txt'), failed.join('\n'))
    }
    if (shotPath) {
      await page.run("window.__tide.setView({ kind: 'settings', section: 'practice' })")
      await wait(4000)
      await page.shot(resolve(shotPath))
      console.log(`  saved ${shotPath}`)
    }
  } catch (e) {
    record('check ran', false, e.message)
  } finally {
    page?.close()
    app.kill()
    if (!has('--keep')) {
      execFileSync('docker', ['compose', '-p', PROJECT, 'down', '-v'], { stdio: 'ignore' })
      rmSync(temp, { recursive: true, force: true })
    } else console.log(`  kept: ${MB} and ${temp}`)
  }
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} passed in ${((Date.now() - t0) / 60000).toFixed(1)} min`)
  process.exit(bad.length ? 1 : 0)
}

main()
