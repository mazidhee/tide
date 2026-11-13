/**
 * The track packs in the main process: their status, the install a press of Install starts (one
 * at a time per pack, in the background, with progress sent to every window), Apple's own
 * installer for the command-line tools, and the run tracker's records. Registered once from
 * main/index.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { dirname as up } from 'path'
import { trackPack, TRACK_PACKS, type TrackPackId, type TrackPackStatus } from '@shared/trackPacks'
import { fetchTo, installTrackPack, type PackDeps, type Run } from './install'
import { appleTools, packStatus, toolsRoot } from './paths'

function send(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}

/** A command outside the sandbox (tar, unzip, pip, lipo), its output handed over line by line */
export const runLines: Run = (cmd, args, o = {}) =>
  new Promise((resolve) => {
    // uv's and pip's own settings (a cache folder, an index) and the temporary folder pass through
    const passed = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => /^(UV_|PIP_)|^TMPDIR$/.test(e[0]) && typeof e[1] === 'string'))
    const c = spawn(cmd, args, { cwd: o.cwd, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin', HOME: process.env.HOME ?? '', LANG: 'en_US.UTF-8', UV_NO_PROGRESS: '1', ...passed, ...o.env } })
    let out = ''
    let err = ''
    const timer = o.timeoutMs ? setTimeout(() => c.kill('SIGKILL'), o.timeoutMs) : null
    const lines = (stream: NodeJS.ReadableStream, keep: (s: string) => void) => {
      let rest = ''
      stream.on('data', (d) => {
        const s = d.toString()
        keep(s)
        const parts = (rest + s).split('\n')
        rest = parts.pop() ?? ''
        for (const l of parts) o.onLine?.(l)
      })
    }
    lines(c.stdout, (s) => (out = (out + s).slice(-50_000)))
    lines(c.stderr, (s) => (err = (err + s).slice(-50_000)))
    c.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? -1, out, err })
    })
    c.on('error', (e) => resolve({ code: -1, out, err: e.message }))
  })

const tidePython = () => process.env.TIDE_NB_PYTHON || `${app.getPath('userData')}/python/bin/python`

export async function realDeps(): Promise<PackDeps> {
  const tools = toolsRoot()
  await fs.mkdir(tools, { recursive: true })
  const { basePython } = await import('../runner')
  const { findUv } = await import('../notebook/pack')
  const python = tidePython()
  return {
    tools,
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    run: runLines,
    fetchTo,
    freeBytes: () => fs.statfs(tools).then((s) => s.bavail * s.bsize, () => null),
    sizeOf: async (dir) => (await import('../notebook/pack')).duBytes(dir),
    now: () => Date.now(),
    cache: process.env.TIDE_PACK_CACHE || undefined,
    python: { python, dir: up(up(python)), base: basePython(), uv: findUv() },
    appleTools: async () => (await appleTools()).installed
  }
}

export const statusOf = (id: TrackPackId) => packStatus(id, { python: tidePython() })

const installing = new Map<TrackPackId, Promise<TrackPackStatus>>()

/** Installs a pack in the background; a second press waits for the first */
export function installPack(id: TrackPackId, onProgress: (step: string) => void = (step) => send('packs:progress', { id, step })): Promise<TrackPackStatus> {
  const p = trackPack(id)
  if (!p) return Promise.reject(new Error(`No pack called ${id}`))
  const busy = installing.get(id)
  if (busy) return busy
  const job = (async () => {
    const s = await installTrackPack(p, await realDeps(), () => statusOf(id), onProgress)
    // A language server or toolchain found missing earlier is looked for again
    if (s.ready) {
      const { forgetServers } = await import('../ide/languageServers')
      forgetServers()
      ;(await import('../subjects')).forgetRunnable()
      if (id === 'postgres') await (await import('./postgres')).prepareCluster(onProgress).catch(() => {})
    }
    return s
  })().finally(() => installing.delete(id))
  installing.set(id, job)
  return job
}

/** Apple's own installer for the command-line tools: it opens Apple's dialog, which does the rest */
export async function installAppleTools(): Promise<{ started: boolean; detail: string }> {
  const r = await runLines('/usr/bin/xcode-select', ['--install'])
  if (r.code === 0) return { started: true, detail: 'Apple’s installer is open: follow it, then come back and press Check again.' }
  if (/already installed/i.test(r.err)) return { started: false, detail: 'Apple’s command-line tools are already installed.' }
  return { started: false, detail: `Apple’s installer didn’t open: ${r.err.trim().split('\n').pop()?.slice(0, 160) ?? ''}. Run xcode-select --install in Terminal.` }
}

export function registerPacks(): void {
  ipcMain.handle('packs:list', () => TRACK_PACKS.map(({ id, title, about, contents, download, size, where, roadmaps }) => ({ id, title, about, contents, download, size, where, roadmaps })))
  ipcMain.handle('packs:status', (_e, id: TrackPackId) => statusOf(id))
  ipcMain.handle('packs:install', (_e, id: TrackPackId) => installPack(id))
  ipcMain.handle('packs:installing', () => [...installing.keys()])
  ipcMain.handle('packs:appleTools', () => installAppleTools())
  ipcMain.handle('packs:runs', async (_e, experiment: string) => (await import('./runs')).listRuns(String(experiment ?? '')))
  ipcMain.handle('packs:deleteRun', async (_e, experiment: string, id: string) => (await import('./runs')).deleteRun(String(experiment ?? ''), String(id ?? '')))
  ipcMain.handle('lab:pgQuery', async (_e, id: string, sql: string, session?: string) => (await import('./postgres')).pgQuery(String(id ?? ''), String(sql ?? ''), { session: typeof session === 'string' ? session : undefined }))
  ipcMain.handle('lab:pgReset', async (_e, id: string) => (await import('./postgres')).pgReset(String(id ?? '')))
}

/** On quit: the Postgres server stops */
export async function stopPacks(): Promise<void> {
  await (await import('./postgres')).stopPostgres().catch(() => {})
}
