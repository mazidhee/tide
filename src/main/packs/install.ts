/**
 * The track packs' installer (shared/trackPacks): downloads each file once, checks its checksum,
 * unpacks it into a staging folder inside Tide's tools folder, then moves it into place, so a
 * half-finished install never looks finished. What finished is recorded in the pack's
 * .tide-pack.json (each file's version and checksum), so pressing Install again after a failure
 * only fetches what's missing. Python libraries go into Tide's own Python with uv or pip. The size
 * the pack really took is measured at the end and kept for Settings.
 *
 * Nothing here knows about Electron: the network, the processes and the clock come in through
 * PackDeps, so it is tested with stand-ins and once for real against a scratch tools folder.
 */
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, promises as fs } from 'fs'
import { dirname, join, relative } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { downloadLine, fileFor, packFailureText, type MacArch, type PackFile, type TrackPack, type TrackPackStatus } from '@shared/trackPacks'

export type Run = (cmd: string, args: string[], o?: { cwd?: string; env?: Record<string, string>; onLine?: (line: string) => void; timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>

export interface PackDeps {
  /** Tide's tools folder */
  tools: string
  arch: MacArch
  run: Run
  /** Saves a URL to a file, reporting bytes as they arrive */
  fetchTo(url: string, dest: string, onBytes?: (got: number, total: number) => void): Promise<void>
  freeBytes(): Promise<number | null>
  sizeOf(dir: string): Promise<number>
  now(): number
  /** A folder of downloads to take a file from before fetching it (TIDE_PACK_CACHE, for development and tests) */
  cache?: string
  /** Tide's Python, for packs with Python libraries */
  python?: { python: string; dir: string; base: string; uv: string | null }
  /** Apple's command-line tools are installed (lipo thins universal binaries with them) */
  appleTools(): Promise<boolean>
}

export interface Manifest {
  files: Record<string, { version: string; sha: string }>
  python?: string[]
  sizeMb?: number
  seconds?: number
  at?: number
}

export const packDir = (d: Pick<PackDeps, 'tools'>, p: TrackPack) => join(d.tools, p.folder)
const manifestPath = (d: Pick<PackDeps, 'tools'>, p: TrackPack) => join(packDir(d, p), '.tide-pack.json')

export async function readManifest(d: Pick<PackDeps, 'tools'>, p: TrackPack): Promise<Manifest> {
  try {
    const m = JSON.parse(await fs.readFile(manifestPath(d, p), 'utf8')) as Manifest
    return { ...m, files: m.files ?? {} }
  } catch {
    return { files: {} }
  }
}

async function writeManifest(d: Pick<PackDeps, 'tools'>, p: TrackPack, m: Manifest): Promise<void> {
  await fs.mkdir(packDir(d, p), { recursive: true })
  const tmp = `${manifestPath(d, p)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(m, null, 1))
  await fs.rename(tmp, manifestPath(d, p))
}

/** The files of a pack still to install on this Mac: missing, or of another version */
export function filesToInstall(p: TrackPack, m: Manifest, arch: MacArch): PackFile[] {
  return p.files.filter((f) => fileFor(f, arch) && m.files[f.id]?.version !== f.version)
}

async function hashOf(path: string, algo: 'sha256' | 'sha1'): Promise<string> {
  const h = createHash(algo)
  await pipeline(createReadStream(path), h)
  return h.digest('hex')
}

/** Checks a file against the checksum the publisher gives; throws when it doesn't match */
export async function verify(path: string, want: { sha256?: string; sha1?: string }): Promise<string> {
  if (want.sha256) {
    const got = await hashOf(path, 'sha256')
    if (got !== want.sha256) throw new Error(`checksum mismatch for ${path.split('/').pop()}`)
    return got
  }
  if (want.sha1) {
    const got = await hashOf(path, 'sha1')
    if (got !== want.sha1) throw new Error(`checksum mismatch for ${path.split('/').pop()}`)
    return got
  }
  throw new Error('no checksum to check the download against')
}

/** The download's local copy: from the cache folder when it has a good one, else fetched */
async function obtain(d: PackDeps, f: PackFile, dest: string, onProgress: (s: string) => void): Promise<string> {
  const ff = fileFor(f, d.arch)!
  const name = ff.url.split('/').pop()!
  if (d.cache) {
    for (const candidate of [join(d.cache, name), join(d.cache, `${name}-${f.version}`), join(d.cache, `${f.id}-${f.version}`)]) {
      if (!existsSync(candidate)) continue
      try {
        const sha = await verify(candidate, ff)
        await fs.copyFile(candidate, dest)
        onProgress(`Using the ${f.name} ${f.version} already downloaded…`)
        return sha
      } catch {
        // a different file of the same name: fetch it
      }
    }
  }
  let last = -1
  onProgress(downloadLine(f, 0, ff.bytes))
  await d.fetchTo(ff.url, dest, (got, total) => {
    const pct = Math.floor((got / (total || ff.bytes || 1)) * 100)
    if (pct >= last + 2) {
      last = pct
      onProgress(downloadLine(f, got, total || ff.bytes))
    }
  })
  return verify(dest, ff)
}

/** Unpacks one download into `into`, a fresh folder */
async function unpack(d: PackDeps, f: PackFile, file: string, into: string, work: string): Promise<void> {
  await fs.mkdir(into, { recursive: true })
  if (f.unpack === 'binary') {
    const dest = join(into, f.as ?? f.id)
    await fs.copyFile(file, dest)
    await fs.chmod(dest, 0o755)
    return
  }
  let archive = file
  if (f.unpack === 'jar-txz') {
    // A Maven jar is a zip holding the real archive, a .txz
    const x = await d.run('/usr/bin/unzip', ['-o', '-q', file, '*.txz', '-d', work], { timeoutMs: 300_000 })
    if (x.code !== 0) throw new Error(`couldn't open the jar: ${x.err.trim().slice(-200)}`)
    const txz = (await fs.readdir(work)).find((n) => n.endsWith('.txz'))
    if (!txz) throw new Error('the jar held no .txz archive')
    archive = join(work, txz)
  }
  const z = /\.(txz|tar\.xz)$/.test(archive) ? '-xJf' : '-xzf'
  const args = [z, archive, '-C', into, ...(f.strip ? [`--strip-components=${f.strip}`] : [])]
  // Only some members: named after stripping, so they are matched with the leading parts as a wildcard
  const only = (f.only ?? []).map((p) => (f.strip ? `${'*/'.repeat(f.strip)}${p}` : p))
  const x = await d.run('/usr/bin/tar', [...args, ...only.map((p) => `--include=${p}`)], { timeoutMs: 600_000 })
  if (x.code !== 0) throw new Error(`couldn't unpack ${f.name}: ${x.err.trim().slice(-200)}`)
  if (archive !== file) await fs.rm(archive, { force: true })
}

/** Identical libraries saved twice under their versioned names become links to one copy */
export async function linkDuplicates(dir: string): Promise<number> {
  let saved = 0
  const seen = new Map<string, string>()
  let names: string[]
  try {
    names = (await fs.readdir(dir)).sort((a, b) => b.length - a.length || a.localeCompare(b))
  } catch {
    return 0
  }
  for (const name of names) {
    const full = join(dir, name)
    const st = await fs.lstat(full)
    if (!st.isFile() || st.size < 64 * 1024) continue
    const key = `${st.size}:${await hashOf(full, 'sha1')}`
    const first = seen.get(key)
    if (!first) {
      seen.set(key, name)
      continue
    }
    await fs.rm(full)
    await fs.symlink(first, full)
    saved += st.size
  }
  return saved
}

/** After unpacking: thin universal binaries, link duplicated libraries */
async function settle(d: PackDeps, f: PackFile, into: string): Promise<void> {
  if (f.thin?.length && (await d.appleTools())) {
    const arch = d.arch === 'arm64' ? 'arm64' : 'x86_64'
    for (const rel of f.thin) {
      const bin = join(into, rel)
      if (!existsSync(bin)) continue
      const t = await d.run('/usr/bin/lipo', ['-thin', arch, bin, '-output', `${bin}.thin`])
      if (t.code === 0) await fs.rename(`${bin}.thin`, bin)
      else await fs.rm(`${bin}.thin`, { force: true })
    }
  }
  if (f.unpack === 'jar-txz') await linkDuplicates(join(into, 'lib'))
}

/** The install command for Python packages, with uv or pip */
export function pythonInstallArgs(py: NonNullable<PackDeps['python']>, packages: string[]): [string, string[]] {
  if (py.uv) return [py.uv, ['pip', 'install', '--python', py.python, ...packages]]
  return [py.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', ...packages]]
}

/** A line of uv's or pip's output in words for the progress row; '' when it says nothing useful */
function pythonLine(line: string): string {
  const l = line.trim()
  let m = /^Downloading (?:.*\/)?([A-Za-z0-9_.]+?)(?:-\d[^ ]*)? \(([^)]+)\)/.exec(l)
  if (m && !/metadata/.test(l)) return `Downloading ${m[1].replace(/_/g, '-')} (${m[2]})…`
  if ((m = /^Building wheel for ([\w.-]+)/.exec(l)) || (m = /^Building ([\w.=-]+)/.exec(l))) return `Building ${m[1]} (a minute; it unpacks Spark’s libraries)…`
  if (/^Installing collected packages|^Prepared \d+/.test(l)) return 'Installing into Tide’s Python…'
  return ''
}

/**
 * Installs a pack: every file still missing, then its Python libraries, then measures it. Safe
 * to run again; what finished before is kept.
 */
export async function installTrackPack(p: TrackPack, d: PackDeps, status: () => Promise<TrackPackStatus>, onProgress: (step: string) => void = () => {}): Promise<TrackPackStatus> {
  const before = await status()
  if (before.ready) return before
  if (before.needs === 'xcode') return before
  const free = await d.freeBytes()
  if (free !== null && free < p.needsBytes) return { ...before, ready: false, detail: `Not enough free space: the ${p.title} takes ${p.size}, and this Mac has ${(free / 1e9).toFixed(1)} GB free.` }
  const t0 = d.now()
  const dir = packDir(d, p)
  const manifest = await readManifest(d, p)
  const sizeBefore = (p.python && d.python ? await d.sizeOf(d.python.dir).catch(() => 0) : 0) + (existsSync(dir) ? await d.sizeOf(dir).catch(() => 0) : 0)
  const staging = join(d.tools, '.staging', p.id)
  try {
    for (const f of filesToInstall(p, manifest, d.arch)) {
      await fs.rm(staging, { recursive: true, force: true })
      await fs.mkdir(join(staging, 'work'), { recursive: true })
      const download = join(staging, 'download')
      const sha = await obtain(d, f, download, onProgress)
      onProgress(`Unpacking ${f.name}…`)
      const into = join(staging, 'out')
      await unpack(d, f, download, into, join(staging, 'work'))
      await settle(d, f, into)
      // Into place: replaced whole, so an older version's leftovers don't linger
      const final = join(dir, f.into)
      await fs.mkdir(dirname(final), { recursive: true })
      if (f.unpack === 'binary' || f.into === 'bin') {
        await fs.mkdir(final, { recursive: true })
        for (const name of await fs.readdir(into)) {
          await fs.rm(join(final, name), { recursive: true, force: true })
          await fs.rename(join(into, name), join(final, name))
        }
      } else {
        await fs.rm(final, { recursive: true, force: true })
        await fs.rename(into, final)
      }
      manifest.files[f.id] = { version: f.version, sha }
      await writeManifest(d, p, manifest)
    }
    if (p.python && d.python) {
      const py = d.python
      if (!existsSync(py.python)) {
        onProgress('Creating Tide’s Python environment…')
        const v = await d.run(py.base, ['-m', 'venv', py.dir])
        if (v.code !== 0) return { ...before, ready: false, detail: `Couldn't create a Python environment: ${v.err.slice(0, 200) || 'is Python 3 installed?'}` }
      }
      onProgress(`Downloading ${p.python.modules.join(' and ')} into Tide’s Python…`)
      const [cmd, args] = pythonInstallArgs(py, p.python.packages)
      const r = await d.run(cmd, args, { onLine: (l) => pythonLine(l) && onProgress(pythonLine(l)), timeoutMs: 1_800_000 })
      if (r.code !== 0) return { ...before, ready: false, detail: packFailureText(p, r.err || r.out) }
      onProgress('Loading it for the first time…')
      const loaded = await d.run(py.python, ['-c', `import ${p.python.modules.join(', ')}`], { timeoutMs: 120_000 })
      if (loaded.code !== 0) return { ...before, ready: false, detail: `Installed, but it did not load: ${loaded.err.trim().split('\n').pop()?.slice(0, 200) ?? ''}` }
      manifest.python = p.python.packages
    }
  } catch (e) {
    return { ...before, ready: false, detail: packFailureText(p, (e as Error).message) }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    // The staging folder itself, once empty (another pack may be installing beside it)
    await fs.rmdir(join(d.tools, '.staging')).catch(() => {})
  }
  const sizeAfter = (p.python && d.python ? await d.sizeOf(d.python.dir).catch(() => 0) : 0) + (await d.sizeOf(dir).catch(() => 0))
  manifest.sizeMb = Math.max(0, sizeAfter - sizeBefore) / 1e6 + (manifest.sizeMb && sizeBefore ? manifest.sizeMb : 0)
  manifest.seconds = (d.now() - t0) / 1000
  manifest.at = d.now()
  await writeManifest(d, p, manifest)
  const after = await status()
  return after.ready ? after : { ...after, detail: `Installed, but it isn't working yet: ${after.detail}` }
}

/** Saves a URL to a file with fetch, following redirects */
export async function fetchTo(url: string, dest: string, onBytes?: (got: number, total: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`the server answered ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (c: Buffer) => {
    got += c.length
    onBytes?.(got, total)
  })
  await pipeline(body, createWriteStream(dest))
}

/** A path inside the tools folder, for messages: never this Mac's full path */
export const shortPath = (d: Pick<PackDeps, 'tools'>, p: string) => `tools/${relative(d.tools, p)}`
