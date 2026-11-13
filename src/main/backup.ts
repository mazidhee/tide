/**
 * Backups of Tide's own data (shared/backup has the rules): a snapshot of the vault's .tide folder
 * and Tide's app data as one .tar.gz, made each night, on quit when the last is over a day old,
 * and by hand; kept for two weeks of days and eight weeks after; restored from Settings › Backups
 * after a safety snapshot of how things are now, then Tide starts again.
 *
 * The tar is written and read here (POSIX ustar, with a PAX header for long names): no tar
 * command, no package. Everything is streamed through gzip, so the main thread isn't held.
 */
import { app, BrowserWindow, dialog, shell } from 'electron'
import { createWriteStream, existsSync, promises as fs } from 'fs'
import { once } from 'events'
import { join, relative, resolve, sep } from 'path'
import { createGzip, gunzip } from 'zlib'
import { promisify } from 'util'
import {
  keepAppFile,
  keepVaultFile,
  newestBackup,
  nightlyDue,
  parseSnapshotName,
  quitDue,
  snapshotName,
  snapshotsToDelete,
  walkAppDir,
  walkVaultDir,
  type BackupKind,
  type BackupManifest,
  type BackupStatus,
  type Snapshot
} from '@shared/backup'
import { getSettings } from './settings'

const unzip = promisify(gunzip)

/** Where snapshots are made from and kept: passed in, so tests use scratch folders */
export interface BackupRoots {
  /** The vault folder (its .tide is backed up), or null when none is set */
  vault: string | null
  /** Tide's app data */
  app: string
  /** Where the snapshots go */
  folder: string
}

// ---------- Tar ----------

const BLOCK = 512

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0'
}

function header(name: string, size: number, mtime: number, type: '0' | 'x'): Buffer {
  const h = Buffer.alloc(BLOCK)
  h.write(name.slice(0, 100), 0, 'utf8')
  h.write(octal(0o644, 8), 100)
  h.write(octal(0, 8), 108)
  h.write(octal(0, 8), 116)
  h.write(octal(size, 12), 124)
  h.write(octal(Math.floor(mtime / 1000), 12), 136)
  h.write('        ', 148)
  h.write(type, 156)
  h.write('ustar\0', 257)
  h.write('00', 263)
  let sum = 0
  for (const b of h) sum += b
  h.write(octal(sum, 7) + ' ', 148)
  return h
}

const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK)

/** The headers for one entry: a PAX header first when the name is long or not plain ASCII */
function entryHeaders(name: string, size: number, mtime: number): Buffer[] {
  if (Buffer.byteLength(name) <= 100 && /^[\x20-\x7e]*$/.test(name)) return [header(name, size, mtime, '0')]
  const rec = (k: string, v: string) => {
    const body = ` ${k}=${v}\n`
    let len = Buffer.byteLength(body)
    len += String(len).length
    if (String(len).length !== String(len - String(len).length).length) len++
    return `${len}${body}`
  }
  const pax = Buffer.from(rec('path', name))
  const short = name.replace(/[^\x20-\x7e]/g, '_').slice(-99)
  return [header(`PaxHeader/${short}`.slice(0, 100), pax.length, mtime, 'x'), pax, padding(pax.length), header(short, size, mtime, '0')]
}

export interface TarEntry {
  name: string
  data: Buffer
}

/** Every file in a tar, PAX names applied */
export function readTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = []
  let at = 0
  let longName: string | null = null
  while (at + BLOCK <= buf.length) {
    const h = buf.subarray(at, at + BLOCK)
    if (h.every((b) => b === 0)) break
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '')
    const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8)
    const type = String.fromCharCode(h[156] || 48)
    const body = buf.subarray(at + BLOCK, at + BLOCK + size)
    at += BLOCK + size + ((BLOCK - (size % BLOCK)) % BLOCK)
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))
      longName = m ? m[1] : null
      continue
    }
    if (type === '0' || type === '\0') out.push({ name: longName ?? name, data: Buffer.from(body) })
    longName = null
  }
  return out
}

// ---------- Walking ----------

/** Every file under root, relative with /, that `keep` takes, never walking into what `walk` refuses */
async function listFiles(root: string, keep: (rel: string) => boolean, walk: (rel: string) => boolean, skip: string[] = []): Promise<string[]> {
  const out: string[] = []
  const visit = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const full = join(dir, e.name)
      const rel = relative(root, full).split(sep).join('/')
      if (skip.some((s) => full === s || full.startsWith(s + sep))) continue
      if (e.isDirectory()) {
        if (walk(rel)) await visit(full)
      } else if (e.isFile() && keep(rel)) out.push(rel)
    }
  }
  if (existsSync(root)) await visit(root)
  return out.sort()
}

/** What a snapshot of these roots holds: archive name to file on disc */
async function snapshotFiles(roots: BackupRoots): Promise<{ name: string; file: string }[]> {
  const skip = [resolve(roots.folder)]
  const files: { name: string; file: string }[] = []
  if (roots.vault) {
    const tide = join(roots.vault, '.tide')
    for (const rel of await listFiles(tide, keepVaultFile, walkVaultDir, skip)) files.push({ name: `vault/.tide/${rel}`, file: join(tide, rel) })
  }
  for (const rel of await listFiles(roots.app, keepAppFile, walkAppDir, skip)) files.push({ name: `app/${rel}`, file: join(roots.app, rel) })
  return files
}

// ---------- Making one ----------

let running: Promise<Snapshot> | null = null

/** Makes a snapshot in the folder and prunes the old ones; one at a time */
export function makeBackup(kind: BackupKind, roots: BackupRoots = defaultRoots(), now = Date.now()): Promise<Snapshot> {
  if (running) return running
  running = (async () => {
    await fs.mkdir(roots.folder, { recursive: true })
    // A snapshot cut short (Tide stopped while writing it) is never one to keep
    for (const n of await fs.readdir(roots.folder).catch(() => [] as string[])) if (n.endsWith('.tar.gz.part')) await fs.rm(join(roots.folder, n), { force: true })
    const files = await snapshotFiles(roots)
    let name = snapshotName(now, kind)
    // Two in the same second: the later one waits its turn by name
    for (let n = 1; existsSync(join(roots.folder, name)); n++) name = snapshotName(now + n * 1000, kind)
    const path = join(roots.folder, name)
    const part = `${path}.part`
    const out = createWriteStream(part)
    const gz = createGzip({ level: 6 })
    gz.pipe(out)
    const write = async (b: Buffer) => {
      if (!gz.write(b)) await once(gz, 'drain')
    }
    let bytes = 0
    const kept: { name: string; file: string; size: number; mtime: number }[] = []
    for (const f of files) {
      const st = await fs.stat(f.file).catch(() => null)
      if (!st?.isFile()) continue
      kept.push({ ...f, size: st.size, mtime: st.mtimeMs })
      bytes += st.size
    }
    const manifest: BackupManifest = { v: 1, at: now, kind, app: app?.getVersion?.() ?? '', vault: roots.vault, files: kept.length, bytes }
    const mbuf = Buffer.from(JSON.stringify(manifest, null, 1))
    for (const h of entryHeaders('manifest.json', mbuf.length, now)) await write(h)
    await write(mbuf)
    await write(padding(mbuf.length))
    for (const f of kept) {
      // Read whole: a file that changed size while being read is written as it was read
      const data = await fs.readFile(f.file).catch(() => null)
      if (!data) continue
      for (const h of entryHeaders(f.name, data.length, f.mtime)) await write(h)
      await write(data)
      await write(padding(data.length))
    }
    await write(Buffer.alloc(BLOCK * 2))
    gz.end()
    await once(out, 'close')
    await fs.rename(part, path)
    const size = (await fs.stat(path)).size
    await prune(roots.folder).catch(() => {})
    return { name, kind, at: parseSnapshotName(name)!.at, bytes: size }
  })().finally(() => (running = null))
  return running
}

/** The snapshots in a folder, newest first */
export async function listSnapshots(folder: string): Promise<Snapshot[]> {
  const names = await fs.readdir(folder).catch(() => [] as string[])
  const out: Snapshot[] = []
  for (const name of names) {
    const p = parseSnapshotName(name)
    if (!p) continue
    const st = await fs.stat(join(folder, name)).catch(() => null)
    if (st?.isFile()) out.push({ name, kind: p.kind, at: p.at, bytes: st.size })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Deletes what the rules don't keep; returns the names deleted */
export async function prune(folder: string): Promise<string[]> {
  const gone = snapshotsToDelete(await listSnapshots(folder))
  for (const s of gone) await fs.rm(join(folder, s.name), { force: true })
  return gone.map((s) => s.name)
}

// ---------- Restoring ----------

/** A snapshot's files, read whole (snapshots are a few MB) */
export async function readSnapshot(file: string): Promise<{ manifest: BackupManifest | null; entries: TarEntry[] }> {
  const entries = readTar(await unzip(await fs.readFile(file)))
  const m = entries.find((e) => e.name === 'manifest.json')
  let manifest: BackupManifest | null = null
  try {
    manifest = m ? (JSON.parse(m.data.toString('utf8')) as BackupManifest) : null
  } catch {
    manifest = null
  }
  return { manifest, entries: entries.filter((e) => e !== m) }
}

/** A name from the archive as a path under base, or null when it would land outside it */
function inside(base: string, rel: string): string | null {
  if (!rel || rel.includes('\0')) return null
  const full = resolve(base, rel)
  return full.startsWith(resolve(base) + sep) ? full : null
}

/**
 * Puts a snapshot back: first a safety snapshot of how things are now (in the same folder), then
 * each backed-up place is made to match the snapshot: its files written, and files of the kinds a
 * snapshot holds that it doesn't have removed. Caches and everything left out of snapshots are
 * left alone. Returns the safety snapshot.
 */
export async function restoreSnapshot(name: string, roots: BackupRoots = defaultRoots()): Promise<{ safety: Snapshot; files: number }> {
  if (!parseSnapshotName(name) || name.includes('/') || name.includes('\\')) throw new Error('That isn’t one of Tide’s snapshots.')
  const file = join(roots.folder, name)
  if (!existsSync(file)) throw new Error('That snapshot isn’t there any more.')
  // Read before anything changes: a damaged file stops the restore with nothing touched
  const { entries } = await readSnapshot(file)
  if (!entries.length) throw new Error('That snapshot is empty or damaged.')
  const safety = await makeBackup('safety', roots)
  const tide = roots.vault ? join(roots.vault, '.tide') : null
  const want = { vault: new Set<string>(), app: new Set<string>() }
  let written = 0
  for (const e of entries) {
    const [top, ...rest] = e.name.split('/')
    const rel = rest.join('/')
    let target: string | null = null
    if (top === 'vault' && tide && rel.startsWith('.tide/')) {
      const r = rel.slice('.tide/'.length)
      if (!keepVaultFile(r)) continue
      target = inside(tide, r)
      if (target) want.vault.add(r)
    } else if (top === 'app') {
      if (!keepAppFile(rel)) continue
      target = inside(roots.app, rel)
      if (target) want.app.add(rel)
    }
    if (!target) continue
    await fs.mkdir(join(target, '..'), { recursive: true })
    await fs.writeFile(target, e.data)
    written++
  }
  // What the snapshot didn't have goes, of what a snapshot would have held
  const skip = [resolve(roots.folder)]
  if (tide) for (const rel of await listFiles(tide, keepVaultFile, walkVaultDir, skip)) if (!want.vault.has(rel)) await fs.rm(join(tide, rel), { force: true })
  for (const rel of await listFiles(roots.app, keepAppFile, walkAppDir, skip)) if (!want.app.has(rel)) await fs.rm(join(roots.app, rel), { force: true })
  return { safety, files: written }
}

// ---------- In the app ----------

export const DEFAULT_FOLDER = () => join(app.getPath('userData'), 'Backups')

function defaultRoots(): BackupRoots {
  const s = getSettings()
  return { vault: s.vaultPath && existsSync(s.vaultPath) ? s.vaultPath : null, app: app.getPath('userData'), folder: s.backups?.folder || DEFAULT_FOLDER() }
}

let lastError = ''

export async function backupStatus(): Promise<BackupStatus> {
  const roots = defaultRoots()
  const snapshots = await listSnapshots(roots.folder)
  return { folder: roots.folder, custom: roots.folder !== DEFAULT_FOLDER(), last: newestBackup(snapshots), snapshots, running: !!running, ...(lastError ? { error: lastError } : {}) }
}

async function tryBackup(kind: BackupKind): Promise<Snapshot | null> {
  try {
    const s = await makeBackup(kind)
    lastError = ''
    return s
  } catch (e) {
    lastError = (e as Error).message
    console.warn(`[backup] ${kind}: ${lastError}`)
    return null
  }
}

/** Each 10 minutes: the nightly snapshot when one is due; and one on quit when the last is over a day old */
export function watchBackups(): void {
  const check = async () => {
    const roots = defaultRoots()
    const last = newestBackup(await listSnapshots(roots.folder))
    if (nightlyDue(last?.at ?? null, Date.now())) await tryBackup('daily')
  }
  setTimeout(() => void check().catch(() => {}), 90_000)
  setInterval(() => void check().catch(() => {}), 10 * 60_000)
  // Held until the quit snapshot is written: another part of Tide asking to quit meanwhile is held too
  let state: 'idle' | 'checking' | 'done' = 'idle'
  app.on('before-quit', (e) => {
    if (state === 'done') return
    e.preventDefault()
    if (state === 'checking') return
    state = 'checking'
    void (async () => {
      try {
        const last = newestBackup(await listSnapshots(defaultRoots().folder))
        if (quitDue(last?.at ?? null, Date.now())) await Promise.race([tryBackup('quit'), new Promise((r) => setTimeout(r, 20_000))])
      } catch {
        // Never a reason not to quit
      } finally {
        state = 'done'
        app.quit()
      }
    })()
  })
}

export function registerBackups(handle: <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => void): void {
  handle('backups:status', () => backupStatus())
  handle('backups:now', async () => {
    const s = await makeBackup('manual')
    lastError = ''
    return { snapshot: s, status: await backupStatus() }
  })
  handle('backups:reveal', async (name?: string) => {
    const roots = defaultRoots()
    await fs.mkdir(roots.folder, { recursive: true })
    const p = name && parseSnapshotName(String(name)) ? join(roots.folder, String(name)) : roots.folder
    if (p === roots.folder) await shell.openPath(roots.folder)
    else shell.showItemInFolder(p)
  })
  handle('backups:chooseFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win!, { title: 'Keep backups in', properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return backupStatus()
    const { updateSettings, getSettings } = await import('./settings')
    updateSettings({ backups: { ...getSettings().backups, folder: res.filePaths[0] } })
    return backupStatus()
  })
  handle('backups:defaultFolder', async () => {
    const { updateSettings, getSettings } = await import('./settings')
    const { folder: _f, ...rest } = getSettings().backups ?? {}
    void _f
    updateSettings({ backups: rest })
    return backupStatus()
  })
  /** Restore, after the window has asked; Tide starts again when it's done */
  handle('backups:restore', async (name: string) => {
    const r = await restoreSnapshot(String(name ?? ''))
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 600)
    return { safety: r.safety.name, files: r.files }
  })
}

// For tests
export { snapshotFiles as _snapshotFiles }
