import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, openSync, promises as fs } from 'fs'
import { join } from 'path'
import { getSettings, updateSettings } from './settings'

/**
 * Private web search: SearXNG on this Mac only. It asks several search engines at once and returns
 * JSON, so the tutor gets real web results without an API key.
 *
 * It runs as a plain Python program that Tide starts when a search is made and stops after a few
 * idle minutes, so it holds no memory while you aren't searching. (It used to run in Docker, always
 * on: the container needed 430 MB, but kept Docker's Linux VM, several GB, awake for as long as the
 * Mac was up.) Docker is still used where Python or git is missing.
 */

const NAME = 'tide-search'
const IMAGE = 'searxng/searxng:latest'
export const LOCAL_URL = 'http://127.0.0.1:8888'

const DOCKER_PATHS = ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', join(process.env.HOME ?? '', '.docker/bin/docker'), '/Applications/Docker.app/Contents/Resources/bin/docker']

const dockerBin = () => DOCKER_PATHS.find((p) => existsSync(p)) ?? null

function docker(args: string[], timeout = 120_000): Promise<{ ok: boolean; out: string }> {
  const bin = dockerBin()
  if (!bin) return Promise.resolve({ ok: false, out: 'Docker is not installed.' })
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin` } }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: (stdout || stderr || (err?.message ?? '')).trim() })
    )
  })
}

async function reachable(url = LOCAL_URL): Promise<boolean> {
  try {
    const res = await fetch(`${url}/search?format=json&q=test`, { signal: AbortSignal.timeout(6000) })
    return res.ok && (res.headers.get('content-type') ?? '').includes('json')
  } catch {
    return false
  }
}

// ---------- The engine as a plain program ----------

const engineDir = () => join(app.getPath('userData'), 'searxng')
const enginePython = () => join(engineDir(), 'venv', 'bin', 'python')
const engineSource = () => join(engineDir(), 'src')
/** Written once the engine has been installed and seen answering */
const engineReady = () => join(engineDir(), 'engine-ready')
export const nativeSearch = () => existsSync(engineReady()) && existsSync(enginePython()) && existsSync(join(engineSource(), 'searx'))

let engine: ChildProcess | null = null
let starting: Promise<boolean> | null = null
let idle: ReturnType<typeof setTimeout> | undefined
/** Stopped after this long without a search */
const IDLE_MS = 10 * 60_000

function run(cmd: string, args: string[], timeout: number, cwd?: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout, cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` } }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || stderr || err?.message || '').trim() })
    )
  )
}

export function stopSearch(): void {
  clearTimeout(idle)
  engine?.kill()
  engine = null
}

/**
 * Before a search: the engine is running, or is started now (about seven seconds from cold). A no-op when
 * the engine isn't Tide's own program (Docker, or someone else's server).
 */
export async function ensureSearch(): Promise<void> {
  if (!nativeSearch()) return
  clearTimeout(idle)
  idle = setTimeout(stopSearch, IDLE_MS)
  if (engine && engine.exitCode === null && (await reachable())) return
  starting ??= (async () => {
    if (await reachable()) return true
    const log = openSync(join(engineDir(), 'engine.log'), 'a')
    engine = spawn(enginePython(), ['-m', 'searx.webapp'], {
      cwd: engineSource(),
      stdio: ['ignore', log, log],
      env: { ...process.env, SEARXNG_SETTINGS_PATH: join(engineDir(), 'settings.yml'), SEARXNG_PORT: '8888', SEARXNG_BIND_ADDRESS: '127.0.0.1', PYTHONPATH: engineSource() }
    })
    engine.once('exit', () => (engine = null))
    return waitUntilReachable(30_000)
  })().finally(() => (starting = null))
  await starting
}

/** Installs the engine into Tide's own folder: its source, and a Python environment for it */
async function installEngine(): Promise<{ ok: boolean; why: string }> {
  const python = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'].find((p) => existsSync(p))
  if (!python) return { ok: false, why: 'Python 3 isn’t installed' }
  const recent = await run(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], 10_000)
  if (!recent.ok) return { ok: false, why: 'Python 3.10 or newer is needed' }
  await fs.mkdir(engineDir(), { recursive: true })
  if (!existsSync(join(engineSource(), 'searx'))) {
    await fs.rm(engineSource(), { recursive: true, force: true })
    const clone = await run('git', ['clone', '--depth', '1', 'https://github.com/searxng/searxng.git', engineSource()], 300_000)
    if (!clone.ok) return { ok: false, why: `its source couldn’t be downloaded (${clone.out.slice(-120)})` }
  }
  if (!existsSync(enginePython())) {
    const venv = await run(python, ['-m', 'venv', join(engineDir(), 'venv')], 120_000)
    if (!venv.ok) return { ok: false, why: `a Python environment couldn’t be made (${venv.out.slice(-120)})` }
  }
  const deps = await run(enginePython(), ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', join(engineSource(), 'requirements.txt')], 900_000)
  if (!deps.ok) return { ok: false, why: `its libraries couldn’t be installed (${deps.out.slice(-160)})` }
  return { ok: true, why: '' }
}

/** Tide's old always-on container: stopped and told not to restart, so it no longer keeps Docker awake. Not deleted. */
async function retireContainer(): Promise<void> {
  if (!dockerBin()) return
  const state = await docker(['inspect', '-f', '{{.State.Status}}', NAME], 10_000)
  if (!state.ok) return
  await docker(['update', '--restart=no', NAME], 20_000)
  await docker(['stop', NAME], 60_000)
}

async function writeSettings(): Promise<void> {
  await fs.mkdir(engineDir(), { recursive: true })
  const config = join(engineDir(), 'settings.yml')
  if (existsSync(config)) return
  await fs.writeFile(
    config,
    ['use_default_settings: true', 'server:', `  secret_key: "${randomBytes(24).toString('hex')}"`, '  limiter: false', '  image_proxy: false', 'search:', '  safe_search: 0', '  formats:', '    - html', '    - json', ''].join('\n')
  )
}

let moving: Promise<SearchStatus> | null = null

/** Installs the engine as a plain program, hands over from the container, and checks it answers */
function setupNative(): Promise<SearchStatus> {
  moving ??= (async (): Promise<SearchStatus> => {
    const installed = await installEngine()
    if (!installed.ok) return { ready: false, detail: installed.why }
    await writeSettings()
    await retireContainer()
    await fs.writeFile(engineReady(), new Date().toISOString())
    await ensureSearch()
    if (await reachable()) return { ready: true, detail: 'Private web search is set up. It starts when you search and stops when you don’t.' }
    await fs.rm(engineReady(), { force: true })
    return { ready: false, detail: 'the engine was installed but didn’t answer' }
  })().finally(() => (moving = null))
  return moving
}

export interface SearchStatus {
  ready: boolean
  detail: string
}

export async function searchStatus(): Promise<SearchStatus> {
  if (nativeSearch()) return { ready: true, detail: engine ? 'Private web search is running on this Mac.' : 'Private web search starts when you search, and stops when you don’t.' }
  if (await reachable()) return { ready: true, detail: 'Private web search is running on this Mac, in Docker.' }
  if (!dockerBin()) return { ready: false, detail: 'Needs Docker Desktop. Install it from docker.com, then set this up.' }
  const info = await docker(['info', '--format', '{{.ServerVersion}}'], 10_000)
  if (!info.ok) return { ready: false, detail: 'Docker is installed but not running. Open Docker Desktop, then try again.' }
  const state = await docker(['inspect', '-f', '{{.State.Status}}', NAME], 10_000)
  if (!state.ok) return { ready: false, detail: 'Not set up yet.' }
  return { ready: false, detail: `The search container is ${state.out}.` }
}

async function waitUntilReachable(ms: number) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await reachable()) return true
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

/** Sets the engine up (as a plain program, or in Docker where that can't be done) and switches the tutor's web search to it */
export async function setupSearch(): Promise<SearchStatus> {
  const native = await setupNative().catch((e) => ({ ready: false, detail: (e as Error).message }))
  if (native.ready) {
    const ai = getSettings().ai
    // "Fastest available" stays as chosen: it uses this engine when it needs to
    if (ai.webSearch?.provider !== 'auto') updateSettings({ ai: { ...ai, webSearch: { ...ai.webSearch, provider: 'searxng', url: LOCAL_URL } } })
    return native
  }
  if (!dockerBin()) return { ready: false, detail: `Private search couldn’t be set up: ${native.detail}. (Docker Desktop also works, if you have it.)` }
  const info = await docker(['info', '--format', '{{.ServerVersion}}'], 10_000)
  if (!info.ok) return { ready: false, detail: 'Docker is installed but not running. Open Docker Desktop, then try again.' }

  const dir = join(app.getPath('userData'), 'searxng')
  await fs.mkdir(dir, { recursive: true })
  const config = join(dir, 'settings.yml')
  if (!existsSync(config)) {
    await fs.writeFile(
      config,
      [
        'use_default_settings: true',
        'server:',
        `  secret_key: "${randomBytes(24).toString('hex')}"`,
        '  limiter: false',
        '  image_proxy: false',
        'search:',
        '  safe_search: 0',
        '  formats:',
        '    - html',
        '    - json',
        ''
      ].join('\n')
    )
  }

  const exists = await docker(['inspect', '-f', '{{.State.Status}}', NAME], 10_000)
  if (exists.ok) {
    await docker(['start', NAME], 60_000)
  } else {
    const run = await docker(['run', '-d', '--name', NAME, '--restart', 'unless-stopped', '-p', '127.0.0.1:8888:8080', '-v', `${dir}:/etc/searxng`, IMAGE], 600_000)
    if (!run.ok) return { ready: false, detail: `Docker could not start the search engine: ${run.out.slice(0, 200)}` }
  }
  if (!(await waitUntilReachable(60_000))) return { ready: false, detail: 'The search engine started but is not answering yet. Give it a minute and check again.' }
  const ai = getSettings().ai
  if (ai.webSearch?.provider !== 'auto') updateSettings({ ai: { ...ai, webSearch: { ...ai.webSearch, provider: 'searxng', url: LOCAL_URL } } })
  return { ready: true, detail: 'Private web search is running on this Mac.' }
}

/**
 * On launch, when the tutor uses the local engine. Set up as a plain program: nothing to do, it
 * starts with the first search. Still in Docker from an older Tide: the container is started as
 * before. Moving out of Docker downloads and installs the engine, so it only ever happens when you
 * press Set up in Settings, never by itself.
 */
export async function wakeSearch() {
  const cfg = getSettings().ai.webSearch
  if (cfg?.provider !== 'searxng' || cfg.url !== LOCAL_URL || nativeSearch() || (await reachable())) return
  if (dockerBin()) await docker(['start', NAME], 60_000)
}
