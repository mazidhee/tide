/**
 * Where the track packs' programs live once installed (shared/trackPacks, main/packs/install), and
 * what each pack's status is. Only Tide's tools folder is looked in for what Tide installed; the
 * Mac's own tools (Apple's command-line tools, a Homebrew CMake or Java) are detected, never changed.
 */
import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { CMAKE, FOUNDRY, JRE, NISSHI, POSTGRES, trackPack, type PackPart, type TrackPackId, type TrackPackStatus } from '@shared/trackPacks'

/** Tide's tools folder (TIDE_TOOLS_DIR points a development copy or a test at a scratch one) */
export const toolsRoot = () => process.env.TIDE_TOOLS_DIR || join(app.getPath('userData'), 'tools')

export const foundryBin = (name: 'forge' | 'cast' | 'anvil' | 'chisel' | 'solc') => join(toolsRoot(), 'foundry', 'bin', name)
export const forgeStd = () => join(toolsRoot(), 'foundry', 'forge-std', 'src')
export const tideJavaHome = () => join(toolsRoot(), 'bigdata', 'jre', 'Contents', 'Home')
export const nisshiBin = () => join(toolsRoot(), 'bigdata', 'nisshi', 'bin', 'nisshi')
export const pgBin = (name: 'postgres' | 'initdb' | 'pg_ctl') => join(toolsRoot(), 'postgres', 'pg', 'bin', name)
/** The lab's database cluster: made once, the first time Postgres is used */
export const pgData = () => join(toolsRoot(), 'postgres', 'data')
export const tideCmake = () => join(toolsRoot(), 'cpp', 'cmake', 'bin', 'cmake')

export interface Probe {
  exists(path: string): boolean
  /** What the command printed (stdout, else stderr), or null when it failed */
  run(cmd: string, args: string[]): Promise<string | null>
}

export const realProbe: Probe = {
  exists: existsSync,
  run: (cmd, args) =>
    new Promise((resolve) => {
      if (cmd.startsWith('/') && !existsSync(cmd)) return resolve(null)
      execFile(cmd, args, { timeout: 15_000, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME ?? '' } }, (err, stdout, stderr) => resolve(err ? null : (String(stdout) || String(stderr)).trim()))
    })
}

const first = (s: string | null) => (s ?? '').split('\n')[0].trim()
const version = (s: string | null) => /\d+\.\d+(?:\.\d+)?/.exec(s ?? '')?.[0] ?? ''

/** Apple's command-line tools: clang, clangd and lldb-dap. Probed without running the stand-ins, which open Apple's install dialog */
export async function appleTools(p: Probe = realProbe): Promise<{ installed: boolean; clang: string; clangd: string | null; lldbDap: string | null }> {
  const dir = await p.run('/usr/bin/xcode-select', ['-p'])
  if (!dir) return { installed: false, clang: '', clangd: null, lldbDap: null }
  const [clang, clangd, lldbDap] = await Promise.all([p.run('/usr/bin/clang++', ['--version']), p.run('/usr/bin/xcrun', ['-f', 'clangd']), p.run('/usr/bin/xcrun', ['-f', 'lldb-dap'])])
  return { installed: !!clang, clang: version(clang), clangd: clangd ? first(clangd) : null, lldbDap: lldbDap ? first(lldbDap) : null }
}

/** CMake: Tide's own, else one Homebrew installed */
export function cmakePath(p: Pick<Probe, 'exists'> = realProbe): string | null {
  return [tideCmake(), '/opt/homebrew/bin/cmake', '/usr/local/bin/cmake'].find((c) => p.exists(c)) ?? null
}

/** Java for Spark (17 or later): Tide's own runtime, else one the Mac has */
export async function javaHome(p: Probe = realProbe): Promise<string | null> {
  if (p.exists(join(tideJavaHome(), 'bin', 'java'))) return tideJavaHome()
  const home = await p.run('/usr/libexec/java_home', ['-v', '17+'])
  return home && p.exists(join(first(home), 'bin', 'java')) ? first(home) : null
}

function remembered(id: TrackPackId): { sizeMb?: number; seconds?: number } {
  const p = trackPack(id)
  if (!p?.folder) return {}
  try {
    const m = JSON.parse(readFileSync(join(toolsRoot(), p.folder, '.tide-pack.json'), 'utf8')) as { sizeMb?: number; seconds?: number }
    return { ...(m.sizeMb ? { sizeMb: m.sizeMb } : {}), ...(m.seconds ? { seconds: m.seconds } : {}) }
  } catch {
    return {}
  }
}

const part = (name: string, ready: boolean, detail: string): PackPart => ({ name, ready, detail })
const mb = (n?: number) => (n ? ` · took ${n >= 1000 ? `${(n / 1000).toFixed(2)} GB` : `${Math.round(n)} MB`}` : '')

function summarise(id: TrackPackId, parts: PackPart[], extra: Partial<TrackPackStatus> = {}): TrackPackStatus {
  const p = trackPack(id)!
  const size = remembered(id)
  const ready = parts.every((x) => x.ready)
  const none = parts.every((x) => !x.ready)
  const detail = ready
    ? `${parts.map((x) => x.detail).join(', ')}${mb(size.sizeMb)}`
    : none
      ? `Not installed: ${p.download} to download, ${p.size} on disk`
      : `Not finished: ${parts.filter((x) => !x.ready).map((x) => x.name).join(', ')} still to install`
  return { id, ready, detail, parts, ...size, ...extra }
}

/** The status of one pack on this Mac */
export async function packStatus(id: TrackPackId, o: { probe?: Probe; python?: string; arch?: string } = {}): Promise<TrackPackStatus> {
  const p = o.probe ?? realProbe
  if (id === 'cpp') {
    const apple = await appleTools(p)
    const cmake = cmakePath(p)
    const cmakeV = cmake ? version(await p.run(cmake, ['--version'])) : ''
    const parts = [
      part('clang', apple.installed, apple.installed ? `clang ${apple.clang}` : 'Apple’s command-line tools'),
      part('CMake', !!cmakeV, cmakeV ? `CMake ${cmakeV}` : `CMake ${CMAKE.version}`),
      part('clangd', !!apple.clangd, apple.clangd ? 'clangd' : 'comes with Apple’s command-line tools'),
      part('lldb-dap', !!apple.lldbDap, apple.lldbDap ? 'lldb-dap' : 'comes with Apple’s command-line tools')
    ]
    if (!apple.installed) return { ...summarise(id, parts), detail: 'Needs Apple’s command-line tools first (clang, clangd and lldb-dap, from Apple’s own installer), then CMake (93 MB)', needs: 'xcode' }
    return summarise(id, parts)
  }
  if (id === 'foundry') {
    const [forge, solc] = await Promise.all([p.run(foundryBin('forge'), ['--version']), p.run(foundryBin('solc'), ['--version'])])
    return summarise(id, [part('Foundry', !!forge, forge ? `Foundry ${version(forge) || FOUNDRY.version}` : 'forge, cast, anvil'), part('solc', !!solc, solc ? `solc ${version(solc.split('\n').pop() ?? '') || FOUNDRY.solc}` : 'the compiler'), part('forge-std', p.exists(join(forgeStd(), 'Test.sol')), `forge-std ${FOUNDRY.forgeStd}`)])
  }
  if (id === 'bigdata') {
    const java = await javaHome(p)
    const py = o.python ?? ''
    const libs = py && p.exists(py) ? await p.run(py, ['-c', 'from importlib.metadata import version as v\nfor n in ("pyspark", "kafka-python"):\n    try: print(n, v(n))\n    except Exception: print(n, "-")']) : null
    const have = new Map((libs ?? '').split('\n').map((l) => l.trim().split(/\s+/) as [string, string]))
    const spark = have.get('pyspark')
    const kafka = have.get('kafka-python')
    const arm = (o.arch ?? process.arch) === 'arm64'
    const broker = p.exists(nisshiBin())
    const parts = [
      part('Java', !!java, java ? (java === tideJavaHome() ? `Java ${JRE.version.split('+')[0]}` : 'Java (this Mac’s)') : 'Java runtime'),
      part('PySpark', !!spark && spark !== '-', spark && spark !== '-' ? `PySpark ${spark}` : 'PySpark'),
      part('kafka-python', !!kafka && kafka !== '-', 'kafka-python'),
      ...(arm ? [part('Kafka broker', broker, `Nisshi ${NISSHI.version}`)] : [])
    ]
    return summarise(id, parts, arm ? {} : { unavailable: 'The Kafka-compatible broker has no Intel Mac build; Spark works' })
  }
  if (id === 'postgres') {
    const pg = await p.run(pgBin('postgres'), ['--version'])
    return summarise(id, [part('PostgreSQL', !!pg, pg ? `PostgreSQL ${version(pg) || POSTGRES.version}` : 'PostgreSQL')])
  }
  return { id: 'runs', ready: true, detail: 'Built in: log parameters and metrics with tide_runs, then compare runs in the notebook’s Runs tab', parts: [part('tide_runs', true, 'built in')] }
}
