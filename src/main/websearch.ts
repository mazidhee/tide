import { app } from 'electron'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { getSettings, updateSettings } from './settings'

/**
 * Private web search: a SearXNG instance in Docker, bound to this Mac only. It asks several
 * search engines at once and returns JSON, so the tutor gets real web results without an API key.
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

export interface SearchStatus {
  ready: boolean
  detail: string
}

export async function searchStatus(): Promise<SearchStatus> {
  if (await reachable()) return { ready: true, detail: 'Private web search is running on this Mac.' }
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

/** Creates (or restarts) the container and switches the tutor's web search to it */
export async function setupSearch(): Promise<SearchStatus> {
  if (!dockerBin()) return { ready: false, detail: 'Needs Docker Desktop. Install it from docker.com, then set this up.' }
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
  updateSettings({ ai: { ...ai, webSearch: { ...ai.webSearch, provider: 'searxng', url: LOCAL_URL } } })
  return { ready: true, detail: 'Private web search is running on this Mac.' }
}

/** On launch: if the tutor uses the local engine and it is stopped, start it again quietly */
export async function wakeSearch() {
  const cfg = getSettings().ai.webSearch
  if (cfg?.provider !== 'searxng' || cfg.url !== LOCAL_URL || (await reachable())) return
  if (dockerBin()) await docker(['start', NAME], 60_000)
}
