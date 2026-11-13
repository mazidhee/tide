import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { downloadLine, fileFor, packFailureText, packForRoadmap, sizeText, trackPack, TRACK_PACKS, type TrackPack, type TrackPackStatus } from '../src/shared/trackPacks'

/**
 * The track packs' installer, against stand-ins for the network and the processes. With
 * TIDE_PACK_CACHE pointing at a folder holding the packs' downloads (and TIDE_PACK_WHEELS at
 * PySpark's), each pack is installed for real into a scratch tools folder and its size measured:
 *   TIDE_PACK_CACHE=/path/downloads TIDE_PACK_WHEELS=/path/wheels npx vitest run test/trackPacks.test.ts
 */
const dir = mkdtempSync(join(tmpdir(), 'tide-packs-'))
process.env.TIDE_TOOLS_DIR = join(dir, 'tools')
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} } }))
const { filesToInstall, installTrackPack, linkDuplicates, readManifest, verify, fetchTo } = await import('../src/main/packs/install')
const { packStatus } = await import('../src/main/packs/paths')
const { runLines } = await import('../src/main/packs/index')

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const NOT: TrackPackStatus = { id: 'foundry', ready: false, detail: 'Not installed', parts: [] }

/** A tiny pack of two files: a tar.gz with a program in it, and a bare binary */
function tinyPack(root: string): { pack: TrackPack; served: Record<string, Buffer> } {
  const src = join(root, 'src')
  mkdirSync(join(src, 'tool-1.0', 'bin'), { recursive: true })
  writeFileSync(join(src, 'tool-1.0', 'bin', 'hello'), '#!/bin/sh\necho hello 1.0\n', { mode: 0o755 })
  writeFileSync(join(src, 'tool-1.0', 'README'), 'not kept')
  execFileSync('/usr/bin/tar', ['-czf', join(root, 'tool.tar.gz'), '-C', src, 'tool-1.0'])
  const tgz = readFileSync(join(root, 'tool.tar.gz'))
  const bin = Buffer.from('#!/bin/sh\necho second\n')
  const pack: TrackPack = {
    id: 'foundry',
    title: 'Test pack',
    roadmaps: [],
    about: '',
    contents: '',
    download: '1 KB',
    size: '1 KB',
    needsBytes: 1000,
    where: 'Settings',
    folder: 'tiny',
    files: [
      { id: 'tool', name: 'Tool', version: '1.0', url: { arm64: 'https://example.test/tool.tar.gz', x64: 'https://example.test/tool.tar.gz' }, sha256: { arm64: sha(tgz), x64: sha(tgz) }, bytes: { arm64: tgz.length, x64: tgz.length }, unpack: 'tar', into: 'tool', strip: 1, only: ['bin'] },
      { id: 'second', name: 'Second', version: '2.0', url: { arm64: 'https://example.test/second' }, sha256: { arm64: sha(bin) }, bytes: { arm64: bin.length }, unpack: 'binary', into: 'bin', as: 'second' }
    ]
  }
  return { pack, served: { 'https://example.test/tool.tar.gz': tgz, 'https://example.test/second': bin } }
}

function deps(tools: string, served: Record<string, Buffer>, o: { free?: number | null; arch?: 'arm64' | 'x64'; fail?: string; corrupt?: boolean } = {}) {
  const fetched: string[] = []
  return {
    fetched,
    d: {
      tools,
      arch: o.arch ?? ('arm64' as const),
      run: runLines,
      fetchTo: async (url: string, dest: string, onBytes?: (got: number, total: number) => void) => {
        fetched.push(url)
        if (o.fail) throw new Error(o.fail)
        const body = served[url]
        onBytes?.(body.length / 2, body.length)
        onBytes?.(body.length, body.length)
        await fs.writeFile(dest, o.corrupt ? Buffer.concat([body, Buffer.from('x')]) : body)
      },
      freeBytes: async () => (o.free === undefined ? 50e9 : o.free),
      sizeOf: async (p: string) => Number(execFileSync('/usr/bin/du', ['-sk', p]).toString().split('\t')[0]) * 1024,
      now: () => 1000,
      appleTools: async () => false
    }
  }
}

describe('the track packs', () => {
  it('each has a measured size, an install path in Settings, and a checksum for every download', () => {
    for (const p of TRACK_PACKS) {
      expect(p.where).toMatch(/Settings › Tools|Runs tab/)
      for (const f of p.files) {
        expect(f.url.arm64).toMatch(/^https:\/\//)
        expect(f.sha256?.arm64 ?? f.sha1?.arm64).toMatch(/^[0-9a-f]{40,64}$/)
        if (f.url.x64) expect(f.sha256?.x64 ?? f.sha1?.x64).toMatch(/^[0-9a-f]{40,64}$/)
      }
    }
    expect(trackPack('runs')!.files).toEqual([])
  })

  it('knows the pack each track needs', () => {
    expect(packForRoadmap('cpp')?.id).toBe('cpp')
    expect(packForRoadmap('blockchain-engineering')?.id).toBe('foundry')
    expect(packForRoadmap('big-data')?.id).toBe('bigdata')
    expect(packForRoadmap('backend')?.id).toBe('postgres')
    expect(packForRoadmap('mle')?.id).toBe('runs')
    expect(packForRoadmap('economics')).toBeUndefined()
  })

  it('has no Kafka broker for an Intel Mac, and says so instead of failing', () => {
    expect(fileFor(trackPack('bigdata')!.files.find((f) => f.id === 'nisshi')!, 'x64')).toBeNull()
    expect(fileFor(trackPack('bigdata')!.files.find((f) => f.id === 'jre')!, 'x64')?.url).toMatch(/x64_mac/)
  })

  it('words downloads and failures plainly', () => {
    const f = trackPack('foundry')!.files[0]
    expect(downloadLine(f, 61_000_000, 122_020_568)).toBe('Downloading Foundry 1.9.0: 49% of 122 MB…')
    expect(sizeText(1_500_000_000)).toBe('1.5 GB')
    const p = trackPack('postgres')!
    expect(packFailureText(p, 'fetch failed: getaddrinfo ENOTFOUND repo1.maven.org')).toMatch(/check the internet connection.*already installed is kept/)
    expect(packFailureText(p, 'checksum mismatch for x.jar')).toMatch(/damaged on the way/)
    expect(packFailureText(p, 'ENOSPC: no space left on device')).toMatch(/disk is full.*about 154 MB/)
  })
})

describe('installing a pack (stand-ins for the network)', () => {
  it('downloads, checks, unpacks only what is kept, and records each file', async () => {
    const root = mkdtempSync(join(dir, 'i1-'))
    const { pack, served } = tinyPack(root)
    const tools = join(root, 'tools')
    const { d, fetched } = deps(tools, served)
    const steps: string[] = []
    let ready = false
    const s = await installTrackPack(pack, d, async () => ({ ...NOT, ready, detail: ready ? 'ready' : 'Not installed' }), (x) => {
      steps.push(x)
      if (/Unpacking Second/.test(x)) ready = true
    })
    expect(s.ready).toBe(true)
    expect(fetched).toEqual(['https://example.test/tool.tar.gz', 'https://example.test/second'])
    expect(execFileSync(join(tools, 'tiny', 'tool', 'bin', 'hello')).toString()).toBe('hello 1.0\n')
    expect(existsSync(join(tools, 'tiny', 'tool', 'README'))).toBe(false)
    expect(execFileSync(join(tools, 'tiny', 'bin', 'second')).toString()).toBe('second\n')
    expect(steps).toContain('Downloading Tool 1.0: 50% of 1 KB…')
    const m = await readManifest({ tools }, pack)
    expect(Object.keys(m.files)).toEqual(['tool', 'second'])
    expect(m.sizeMb).toBeGreaterThan(0)
    // Nothing is left half-done in the tools folder
    expect(existsSync(join(tools, '.staging'))).toBe(false)
  })

  it('fetches only what is missing the second time, and nothing once it is all there', async () => {
    const root = mkdtempSync(join(dir, 'i2-'))
    const { pack, served } = tinyPack(root)
    const tools = join(root, 'tools')
    await installTrackPack(pack, deps(tools, served).d, async () => NOT)
    const m = await readManifest({ tools }, pack)
    delete m.files.second
    await fs.writeFile(join(tools, 'tiny', '.tide-pack.json'), JSON.stringify(m))
    expect(filesToInstall(pack, m, 'arm64').map((f) => f.id)).toEqual(['second'])
    const again = deps(tools, served)
    await installTrackPack(pack, again.d, async () => NOT)
    expect(again.fetched).toEqual(['https://example.test/second'])
    const none = deps(tools, served)
    await installTrackPack(pack, none.d, async () => ({ ...NOT, ready: true }))
    expect(none.fetched).toEqual([])
  })

  it('skips a file with no build for this Mac', async () => {
    const root = mkdtempSync(join(dir, 'i3-'))
    const { pack, served } = tinyPack(root)
    const { d, fetched } = deps(join(root, 'tools'), served, { arch: 'x64' })
    await installTrackPack(pack, d, async () => NOT)
    expect(fetched).toEqual(['https://example.test/tool.tar.gz'])
  })

  it('refuses a damaged download and keeps nothing of it', async () => {
    const root = mkdtempSync(join(dir, 'i4-'))
    const { pack, served } = tinyPack(root)
    const tools = join(root, 'tools')
    const s = await installTrackPack(pack, deps(tools, served, { corrupt: true }).d, async () => NOT)
    expect(s.ready).toBe(false)
    expect(s.detail).toMatch(/damaged on the way/)
    expect(existsSync(join(tools, 'tiny', 'tool'))).toBe(false)
    expect((await readManifest({ tools }, pack)).files).toEqual({})
  })

  it('says when the network fails, and when the disk is too full to start', async () => {
    const root = mkdtempSync(join(dir, 'i5-'))
    const { pack, served } = tinyPack(root)
    const offline = await installTrackPack(pack, deps(join(root, 'tools'), served, { fail: 'fetch failed' }).d, async () => NOT)
    expect(offline.detail).toMatch(/check the internet connection/)
    const full = deps(join(root, 'tools'), served, { free: 10 })
    const s = await installTrackPack(pack, full.d, async () => NOT)
    expect(s.detail).toMatch(/Not enough free space/)
    expect(full.fetched).toEqual([])
  })

  it('takes a download from the cache folder when it holds a good copy', async () => {
    const root = mkdtempSync(join(dir, 'i6-'))
    const { pack, served } = tinyPack(root)
    const cache = join(root, 'cache')
    mkdirSync(cache)
    writeFileSync(join(cache, 'tool.tar.gz'), served['https://example.test/tool.tar.gz'])
    const { d, fetched } = deps(join(root, 'tools'), served)
    await installTrackPack(pack, { ...d, cache }, async () => NOT)
    expect(fetched).toEqual(['https://example.test/second'])
  })

  it('installs Python libraries into Tide’s Python with pip, then loads them', async () => {
    const root = mkdtempSync(join(dir, 'i7-'))
    const pack: TrackPack = { ...tinyPack(root).pack, files: [], python: { packages: ['pyspark==4.3.0'], modules: ['pyspark'] } }
    const calls: string[] = []
    const { d } = deps(join(root, 'tools'), {})
    const s = await installTrackPack(
      pack,
      {
        ...d,
        python: { python: '/env/bin/python', dir: '/env', base: '/usr/bin/python3', uv: null },
        run: async (cmd: string, args: string[]) => {
          calls.push([cmd, ...args].join(' '))
          return { code: 0, out: '', err: '' }
        },
        sizeOf: async () => 0
      },
      async () => NOT
    )
    expect(calls).toEqual(['/usr/bin/python3 -m venv /env', '/env/bin/python -m pip install --disable-pip-version-check --progress-bar off pyspark==4.3.0', '/env/bin/python -c import pyspark'])
    expect(s.detail).toMatch(/isn't working yet/)
  })

  it('links identical libraries saved twice', async () => {
    const lib = mkdtempSync(join(dir, 'lib-'))
    const big = Buffer.alloc(100_000, 7)
    writeFileSync(join(lib, 'libicudata.77.1.dylib'), big)
    writeFileSync(join(lib, 'libicudata.77.dylib'), big)
    writeFileSync(join(lib, 'libicudata.dylib'), big)
    expect(await linkDuplicates(lib)).toBe(200_000)
    expect(readFileSync(join(lib, 'libicudata.dylib'))).toEqual(big)
  })

  it('checks a SHA-1 where that is all the publisher gives', async () => {
    const f = join(dir, 'sha1.bin')
    writeFileSync(f, 'abc')
    expect(await verify(f, { sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d' })).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    await expect(verify(f, { sha1: '0'.repeat(40) })).rejects.toThrow(/checksum/)
  })
})

describe('pack status with nothing installed', () => {
  it('says what each pack would take, and that the run tracker is built in', async () => {
    const probe = { exists: () => false, run: async () => null }
    for (const id of ['foundry', 'postgres'] as const) {
      const s = await packStatus(id, { probe })
      expect(s.ready).toBe(false)
      expect(s.detail).toBe(`Not installed: ${trackPack(id)!.download} to download, ${trackPack(id)!.size} on disk`)
    }
    const cpp = await packStatus('cpp', { probe })
    expect(cpp.needs).toBe('xcode')
    expect(cpp.detail).toMatch(/Apple’s command-line tools first/)
    expect((await packStatus('bigdata', { probe, arch: 'x64' })).unavailable).toMatch(/no Intel Mac build/)
    expect((await packStatus('runs', { probe })).ready).toBe(true)
  })
})

// ---------- Real installs, from downloads already on this Mac ----------

const cache = process.env.TIDE_PACK_CACHE ?? ''
const wheels = process.env.TIDE_PACK_WHEELS ?? ''

describe.skipIf(!cache || !existsSync(cache))('installing each pack for real into a scratch tools folder', () => {
  const sizes: Record<string, unknown> = {}
  const real = async (id: 'cpp' | 'foundry' | 'bigdata' | 'postgres', python?: { python: string; dir: string; base: string; uv: null }) => {
    const pack = trackPack(id)!
    const tools = process.env.TIDE_TOOLS_DIR!
    const { appleTools } = await import('../src/main/packs/paths')
    const d = { tools, arch: 'arm64' as const, run: runLines, fetchTo, freeBytes: async () => null, sizeOf: async (p: string) => Number(execFileSync('/usr/bin/du', ['-sk', p]).toString().split('\t')[0]) * 1024, now: () => Date.now(), cache, ...(python ? { python } : {}), appleTools: async () => (await appleTools()).installed }
    const steps: string[] = []
    const t0 = Date.now()
    const s = await installTrackPack(pack, d, () => packStatus(id, { python: python?.python }), (x) => steps.push(x))
    const m = await readManifest({ tools }, pack)
    sizes[id] = { download: pack.files.reduce((n, f) => n + (f.bytes.arm64 ?? 0), 0), diskMb: m.sizeMb, seconds: (Date.now() - t0) / 1000, detail: s.detail }
    if (process.env.TIDE_PACK_SIZES) writeFileSync(process.env.TIDE_PACK_SIZES, JSON.stringify(sizes, null, 1))
    return s
  }

  it('C++: CMake into the tools folder, thinned to this Mac', async () => {
    const s = await real('cpp')
    if ((await packStatus('cpp')).needs === 'xcode') return
    expect(s.ready).toBe(true)
    expect(execFileSync(join(process.env.TIDE_TOOLS_DIR!, 'cpp', 'cmake', 'bin', 'cmake'), ['--version']).toString()).toMatch(/cmake version 4\.5\.0/)
  }, 300_000)

  it('Foundry: forge, cast, anvil, chisel, solc and forge-std', async () => {
    const s = await real('foundry')
    expect(s.ready).toBe(true)
    expect(s.detail).toMatch(/Foundry 1\.9\.0, solc 0\.8\.38, forge-std 1\.17\.0/)
  }, 300_000)

  it('Postgres: the server binaries, with duplicated libraries linked', async () => {
    const s = await real('postgres')
    expect(s.ready).toBe(true)
    expect(s.detail).toMatch(/PostgreSQL 18\.6/)
  }, 300_000)

  it.skipIf(!wheels)('Big data: Java, the broker, and PySpark into a fresh Python', async () => {
    const venv = join(dir, 'bigdata-venv')
    process.env.PIP_NO_INDEX = '1'
    process.env.PIP_FIND_LINKS = wheels
    const s = await real('bigdata', { python: join(venv, 'bin', 'python'), dir: venv, base: '/opt/homebrew/bin/python3', uv: null })
    delete process.env.PIP_NO_INDEX
    delete process.env.PIP_FIND_LINKS
    expect(s.ready).toBe(true)
    expect(s.detail).toMatch(/Java 21\.0\.13, PySpark 4\.3\.0, kafka-python, Nisshi 0\.8\.2/)
  }, 900_000)
})
