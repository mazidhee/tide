/**
 * Installs the quant pack (shared/labPack QUANT_PACK) into Tide's own Python, in the background,
 * when the learner presses Install (Settings › Tools, or the notebook's first-use card). It uses
 * uv when this Mac has it (several times faster than pip, and it installs in parallel), else pip.
 * The size the environment grew by is measured and kept, so Settings shows the real figure.
 */
import { spawn } from 'child_process'
import { existsSync, promises as fs, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { QUANT_PACK, YAHOO_PACK } from '@shared/labPack'

export type Status = { ready: boolean; detail: string; missing?: string[]; sizeMb?: number }

export interface PackInstaller {
  python: string
  dir: string
  /** uv's path when it's installed, else null (pip is used) */
  uv: string | null
  exists(path: string): boolean
  run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<{ code: number; err: string }>
  status(): Promise<Status>
  freeBytes(): Promise<number | null>
  /** The environment's size on disk in bytes */
  sizeOf(dir: string): Promise<number>
  /** Keeps the measured size for Settings */
  remember(sizeMb: number, seconds: number, tool: string): Promise<void> | void
  basePython(): string
  now(): number
}

/** Where uv usually lives on a Mac; TIDE_UV wins (development) */
export function findUv(home = homedir(), exists: (p: string) => boolean = existsSync, env = process.env): string | null {
  const list = [env.TIDE_UV, '/opt/homebrew/bin/uv', '/usr/local/bin/uv', join(home, '.local/bin/uv'), join(home, '.cargo/bin/uv')].filter((x): x is string => !!x)
  return list.find((p) => exists(p)) ?? null
}

/** The install command for a list of packages, with uv or pip */
export function installArgs(d: Pick<PackInstaller, 'python' | 'uv'>, packages: string[], extra: string[] = []): [string, string[]] {
  if (d.uv) return [d.uv, ['pip', 'install', '--python', d.python, ...extra, ...packages]]
  return [d.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', ...extra, ...packages]]
}

/** A line of uv's or pip's output in words for the progress row; '' when it says nothing useful */
export function packProgress(line: string): string {
  const l = line.trim()
  if (!l || /\.metadata \(/.test(l)) return ''
  let m = /^Downloading (?:.*\/)?([A-Za-z0-9_.]+?)(?:-\d[^ ]*)? \(([^)]+)\)/.exec(l)
  if (m) return `Downloading ${m[1].replace(/_/g, '-')} (${m[2]})…`
  if ((m = /^Collecting ([A-Za-z0-9_.-]+)/.exec(l))) return `Finding ${m[1]}…`
  if ((m = /^Resolved (\d+) packages?/.exec(l))) return `Found ${m[1]} packages…`
  if ((m = /^Building ([A-Za-z0-9_.=-]+)/.exec(l))) return `Building ${m[1]} for this Mac…`
  if ((m = /^Built ([A-Za-z0-9_.-]+)/.exec(l))) return `Built ${m[1]}…`
  if ((m = /^Prepared (\d+) packages?/.exec(l))) return `Downloaded ${m[1]} packages. Installing…`
  if (/^Installing collected packages/.test(l)) return 'Installing…'
  if ((m = /^Installed (\d+) packages?/.exec(l))) return `Installed ${m[1]} packages. Checking them…`
  if (/^Successfully installed/.test(l)) return 'Installed. Checking it…'
  return ''
}

export function packFailure(err: string): string {
  const lines = err.split('\n').map((l) => l.trim())
  const last = (lines.filter((l) => /^(ERROR:|error:|×)/.test(l)).pop() ?? lines.filter(Boolean).pop() ?? '').replace(/^(ERROR:|error:|×)\s*/, '')
  if (/No space left|Errno 28/i.test(err)) return `Couldn't install the quant pack: the disk is full. It needs ${QUANT_PACK.size}.`
  if (/connection|timed out|Temporary failure|Max retries|name resolution|nodename|Network is unreachable|dns error|tcp connect/i.test(err) && !/git clone|Cloning into/.test(err)) return "Couldn't download the quant pack: check the internet connection and try again. What was already installed is kept."
  if (/No matching distribution|Could not find a version|no wheels|unsatisfiable/i.test(err)) return `Couldn't install the quant pack: ${last.slice(0, 160)}. This Python may be too new or too old for one of its libraries.`
  return `Couldn't install the quant pack: ${last.slice(0, 200) || 'the installer stopped without saying why'}`
}

/** "name version" lines ("-" when missing) into a status */
export function packStatusOf(out: string, sizeMb?: number): Status {
  const have = new Map(out.trim().split('\n').map((l) => l.trim().split(/\s+/) as [string, string]))
  const missing = QUANT_PACK.dists.filter((p) => !have.get(p) || have.get(p) === '-')
  if (missing.length === QUANT_PACK.dists.length) return { ready: false, detail: `Not installed yet: ${QUANT_PACK.download} to download, ${QUANT_PACK.size} on disk`, missing }
  if (missing.length) return { ready: false, detail: `Not finished: ${missing.join(', ')} still to install`, missing }
  const v = (p: string) => have.get(p)
  const size = sizeMb ? ` · added ${sizeMb >= 1000 ? `${(sizeMb / 1000).toFixed(2)} GB` : `${Math.round(sizeMb)} MB`}` : ''
  return { ready: true, detail: `Jupyter kernel ${v('ipykernel')}, SciPy ${v('scipy')}, QuantLib ${v('QuantLib')}, cvxpy ${v('cvxpy')}, Polars ${v('polars')}, DuckDB ${v('duckdb')} and more${size}`, missing: [], ...(sizeMb ? { sizeMb } : {}) }
}

export const STATUS_CODE = `from importlib.metadata import version, PackageNotFoundError
for p in ${JSON.stringify(QUANT_PACK.dists)}:
    try:
        print(p, version(p))
    except PackageNotFoundError:
        print(p, "-")
`

/**
 * Installs the pack. Safe to run again: when everything is there nothing runs, and after a
 * failure what did install is kept. cvxpy is installed on its own after the rest: when its OSQP
 * solver can't be built (it fetches sources from GitHub), cvxpy goes in without it.
 */
export async function installPack(d: PackInstaller, onProgress: (step: string) => void = () => {}): Promise<Status> {
  const before = await d.status()
  if (before.ready) return before
  const free = await d.freeBytes()
  if (free !== null && free < QUANT_PACK.needsBytes) return { ready: false, detail: `Not enough free space: the quant pack takes ${QUANT_PACK.size}, and this Mac has ${(free / 1e9).toFixed(1)} GB free.` }
  if (!d.exists(d.python)) {
    onProgress('Creating Tide’s Python environment…')
    const v = await d.run(d.basePython(), ['-m', 'venv', d.dir])
    if (v.code !== 0) return { ready: false, detail: `Couldn't create a Python environment: ${v.err.slice(0, 200) || 'is Python 3 installed?'}` }
  }
  const t0 = d.now()
  const size0 = await d.sizeOf(d.dir).catch(() => 0)
  const tool = d.uv ? 'uv' : 'pip'
  onProgress(`Downloading the quant pack with ${tool} (${QUANT_PACK.download}, ${QUANT_PACK.size} on disk)…`)
  const say = (line: string) => {
    const step = packProgress(line)
    if (step) onProgress(step)
  }
  const [cmd, args] = installArgs(d, QUANT_PACK.packages)
  const main = await d.run(cmd, args, say)
  if (main.code !== 0) return { ready: false, detail: packFailure(main.err) }
  onProgress('Installing cvxpy…')
  const [c1, a1] = installArgs(d, [QUANT_PACK.optimiser])
  const opt = await d.run(c1, a1, say)
  if (opt.code !== 0) {
    onProgress('Installing cvxpy without the OSQP solver (it could not be built here)…')
    const [c2, a2] = installArgs(d, [QUANT_PACK.optimiser], ['--no-deps'])
    const bare = await d.run(c2, a2, say)
    if (bare.code !== 0) return { ready: false, detail: packFailure(bare.err || opt.err) }
  }
  onProgress('Loading it for the first time…')
  const loaded = await d.run(d.python, ['-c', `import ${QUANT_PACK.modules.join(', ')}`])
  if (loaded.code !== 0) return { ready: false, detail: `Installed, but it did not load: ${loaded.err.trim().split('\n').pop()?.slice(0, 200) ?? ''}` }
  const size1 = await d.sizeOf(d.dir).catch(() => 0)
  const sizeMb = size1 > size0 ? (size1 - size0) / 1e6 : 0
  // Kept before the status is read again, so it carries the size
  if (sizeMb) await d.remember(sizeMb, (d.now() - t0) / 1000, tool)
  const after = await d.status()
  if (!after.ready) return { ready: false, detail: `Installed, but it did not load: ${after.detail}` }
  return after
}

/** The real environment, for main/notebook */
export function realInstaller(o: { python: string; dir: string; userData: string; basePython: string; run: PackInstaller['run']; status: () => Promise<Status> }): PackInstaller {
  return {
    python: o.python,
    dir: o.dir,
    uv: findUv(),
    exists: existsSync,
    run: o.run,
    status: o.status,
    freeBytes: () => fs.statfs(o.userData).then((s) => s.bavail * s.bsize, () => null),
    sizeOf: (dir) => duBytes(dir),
    remember: (sizeMb, seconds, tool) => fs.writeFile(join(o.userData, 'quant-pack.json'), JSON.stringify({ sizeMb, seconds, tool, at: Date.now() })).catch(() => {}),
    basePython: () => o.basePython,
    now: () => Date.now()
  }
}

export function rememberedSize(userData: string): { sizeMb: number; seconds: number; tool: string } | null {
  try {
    return JSON.parse(readFileSync(join(userData, 'quant-pack.json'), 'utf8'))
  } catch {
    return null
  }
}

/** du -sk, in bytes */
export async function duBytes(dir: string): Promise<number> {
  // Tide's Python folder can be a link; du would measure the link
  const real = await fs.realpath(dir).catch(() => dir)
  return new Promise((resolve) => {
    const c = spawn('/usr/bin/du', ['-sk', real])
    let out = ''
    c.stdout.on('data', (d) => (out += d))
    c.on('close', () => resolve((parseInt(out, 10) || 0) * 1024))
    c.on('error', () => resolve(0))
  })
}

export const yahooInstallArgs = (d: Pick<PackInstaller, 'python' | 'uv'>) => installArgs(d, YAHOO_PACK.packages)
