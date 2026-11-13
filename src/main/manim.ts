/**
 * Maths animations in the main process (shared/manim has the rules and shapes):
 * - installing Manim, and TinyTeX for typeset equations, into Tide's own tools folder, only when
 *   the learner presses Install (Settings › Tools, or the one-time offer in a lesson);
 * - rendering a scene in the sandbox (no network, writes only to its own folder, a time and size
 *   limit), one at a time, with progress from the scene's beats;
 * - narration in Tide's voice, made per beat before the render so each beat lasts as long as its
 *   line, and mixed into the video by Manim; captions from when each beat really started;
 * - Claude repairing its own scene from the error, up to two tries;
 * - the cache, by content hash (the same scene, words, colours and voice play at once), with the
 *   lessons that used each video;
 * - the library of Claude's scenes that rendered and were watched (.tide/animations.json);
 * - the MCP tools render_animation and animation_library, and the overnight prep hook.
 */
import { app } from 'electron'
import { spawn } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { createWriteStream, existsSync, promises as fs, readdirSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import {
  CAIRO_WRAPS,
  MANIM_PACK,
  MANIM_PYTHONS,
  PYCAIRO,
  QUALITY_FLAG,
  RENDER_LIMITS,
  SCENE_SYSTEM,
  TEX_PACK,
  animationBlock,
  beatProgress,
  beatsUsed,
  captionsFrom,
  checkScene,
  cleanPalette,
  extractScene,
  parseAnimationBlock,
  planBeats,
  renderError,
  renderKey,
  sceneKey,
  sceneRepairPrompt,
  wavSeconds,
  type AnimPalette,
  type AnimQuality,
  type AnimStatus,
  type AnimationBlock,
  type BeatPlan,
  type Caption,
  type RenderInput
} from '@shared/manim'
import { buildTemplate, templatesFor } from '@shared/manimTemplates'
import { TIDE_MANIM_PY } from '@shared/manimHelper'
import type { McpTool } from './tideMcp'

type Status = { ready: boolean; detail: string }

// ---------- Where things live ----------

/** Tide's tools folder (TIDE_TOOLS_DIR points a development copy at a scratch one) */
export const toolsRoot = () => process.env.TIDE_TOOLS_DIR || join(app.getPath('userData'), 'tools')
const manimVenv = () => join(toolsRoot(), 'manim', 'venv')
export const manimPython = () => join(manimVenv(), 'bin', 'python')
const texRoot = () => join(toolsRoot(), 'tinytex')
/** TinyTeX's bin folder (universal-darwin), or null when it isn't installed */
export function texBin(): string | null {
  const base = join(texRoot(), 'TinyTeX', 'bin')
  try {
    const d = readdirSync(base).find((n) => existsSync(join(base, n, 'latex')))
    return d ? join(base, d) : null
  } catch {
    return null
  }
}
let animDir: string | null = null
export const animRoot = () => (animDir ??= process.env.TIDE_ANIM_DIR || join(app.getPath('userData'), 'animations'))
/** Tests point the cache elsewhere */
export const setAnimRoot = (dir: string) => (animDir = dir)
const videoDir = (key: string) => join(animRoot(), key)
const sceneFile = (key: string) => join(animRoot(), 'scenes', `${key}.json`)

// ---------- Commands outside the sandbox (install, status) ----------

export type Run = (cmd: string, args: string[], o?: { onLine?: (line: string) => void; env?: Record<string, string>; cwd?: string; timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>

export const runCmd: Run = (cmd, args, o = {}) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: o.cwd, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin', HOME: process.env.HOME ?? '', ...o.env } })
    let out = ''
    let err = ''
    let rest = ''
    const timer = o.timeoutMs ? setTimeout(() => c.kill('SIGKILL'), o.timeoutMs) : null
    const lines = (d: Buffer) => {
      const all = (rest + d.toString()).split('\n')
      rest = all.pop() ?? ''
      for (const l of all) o.onLine?.(l)
    }
    c.stdout.on('data', (d: Buffer) => {
      out = (out + d.toString()).slice(-200_000)
      lines(d)
    })
    c.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-200_000)
      lines(d)
    })
    c.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? -1, out, err })
    })
    c.on('error', (e) => resolve({ code: -1, out, err: e.message }))
  })

// ---------- Status ----------

let statusCache: { at: number; value: Status } | null = null

export async function manimStatus(fresh = false): Promise<Status> {
  if (!fresh && statusCache && Date.now() - statusCache.at < 30_000) return statusCache.value
  let value: Status
  if (!existsSync(manimPython())) value = { ready: false, detail: `Not installed: ${MANIM_PACK.download} to download, ${MANIM_PACK.size} on disk` }
  else {
    const r = await runCmd(manimPython(), ['-c', 'from importlib.metadata import version; import cairo; print(version("manim"))'], { timeoutMs: 30_000 })
    value = r.code === 0 ? { ready: true, detail: `Manim ${r.out.trim()}${texBin() ? ', with LaTeX for equations' : ''}` } : { ready: false, detail: 'Not finished: install it again' }
  }
  statusCache = { at: Date.now(), value }
  return value
}

export async function texStatus(): Promise<Status> {
  const bin = texBin()
  if (!bin) return { ready: false, detail: `Not installed: equations are drawn as plain text. ${TEX_PACK.download} to download, ${TEX_PACK.size} on disk` }
  if (!existsSync(join(bin, 'dvisvgm'))) return { ready: false, detail: 'Not finished: install it again' }
  return { ready: true, detail: 'TinyTeX: equations typeset as in a textbook' }
}

// ---------- Installing ----------

export interface ManimInstaller {
  root: string
  run: Run
  exists(path: string): boolean
  freeBytes(): Promise<number | null>
  /** Saves a URL to a file, checking its SHA-256 when given; reports a fraction done */
  download(url: string, dest: string, sha256?: string, onFraction?: (f: number) => void): Promise<void>
}

/** A Python Manim has wheels for, newest first */
export function findPython(exists: (p: string) => boolean): string | null {
  for (const v of MANIM_PYTHONS) for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', `/Library/Frameworks/Python.framework/Versions/${v}/bin`]) if (exists(join(dir, `python${v}`))) return join(dir, `python${v}`)
  return null
}

const mb = (n: number) => `${Math.round(n / 1e6)} MB`

/** What pip is doing, for the button's line */
function pipLine(line: string): string {
  const got = /^\s*Downloading (?:.*\/)?([A-Za-z0-9_.]+?)-\d[^ ]* \(([^)]+)\)/.exec(line)
  if (got && !/metadata/.test(line)) return `Downloading ${got[1].replace(/_/g, '-')} (${got[2]})…`
  if (/^Installing collected packages/.test(line)) return 'Installing…'
  return ''
}

/**
 * Installs Manim into Tide's tools folder: its own Python environment, pycairo built with its own
 * cairo (there is no macOS wheel), then Manim. Safe to run again; a failure leaves what worked.
 */
export async function installManim(d: ManimInstaller, onProgress: (step: string) => void = () => {}): Promise<Status> {
  const free = await d.freeBytes()
  if (free !== null && free < MANIM_PACK.needsBytes) return { ready: false, detail: `Not enough free space: maths animations take ${MANIM_PACK.size}, and this Mac has ${(free / 1e9).toFixed(1)} GB free.` }
  const venv = join(d.root, 'manim', 'venv')
  const py = join(venv, 'bin', 'python')
  if (!d.exists(py)) {
    const base = findPython(d.exists)
    if (!base) return { ready: false, detail: 'Needs Python 3.11 to 3.14 from Homebrew (brew install python@3.12): Manim has no build for this Mac’s Python yet.' }
    const cc = await d.run('/usr/bin/xcrun', ['--find', 'cc'], { timeoutMs: 20_000 })
    if (cc.code !== 0) return { ready: false, detail: 'Needs Apple’s command-line tools to build cairo: run xcode-select --install in Terminal, then try again.' }
    onProgress('Creating its Python environment…')
    const v = await d.run(base, ['-m', 'venv', venv])
    if (v.code !== 0) return { ready: false, detail: `Couldn’t create a Python environment: ${v.err.trim().slice(-200)}` }
  }
  const pip = (args: string[], o: Parameters<Run>[2] = {}) => d.run(py, ['-m', 'pip', '--disable-pip-version-check', ...args], { timeoutMs: 1_200_000, ...o, onLine: (l) => o.onLine?.(l) ?? (pipLine(l) && onProgress(pipLine(l))) })
  const has = await d.run(py, ['-c', 'import cairo'])
  if (has.code !== 0) {
    const build = join(d.root, 'manim', 'build')
    await fs.rm(build, { recursive: true, force: true })
    await fs.mkdir(build, { recursive: true })
    try {
      onProgress('Downloading pycairo…')
      const tar = join(build, 'pycairo.tar.gz')
      await d.download(PYCAIRO.url, tar, PYCAIRO.sha256)
      const x = await d.run('/usr/bin/tar', ['-xzf', tar, '-C', build])
      if (x.code !== 0) return { ready: false, detail: `Couldn’t unpack pycairo: ${x.err.trim().slice(-160)}` }
      const src = join(build, `pycairo-${PYCAIRO.version}`)
      await fs.mkdir(join(src, 'subprojects'), { recursive: true })
      for (const [name, text] of Object.entries(CAIRO_WRAPS)) await fs.writeFile(join(src, 'subprojects', name), text)
      onProgress('Building cairo for Manim (about 40 MB of sources, a minute or two)…')
      const b = await pip(['install', '--progress-bar', 'off', src, '-Cinstall-args=--skip-subprojects', ...PYCAIRO.setupArgs.map((a) => `-Csetup-args=${a}`)], { onLine: (l) => /Downloading (cairo|pixman|libpng|zlib)/i.test(l) && onProgress(`${l.trim().replace(/^.*Downloading/, 'Downloading').slice(0, 80)}…`) })
      if (b.code !== 0) return { ready: false, detail: `Couldn’t build cairo: ${(b.err.split('\n').filter((l) => /error/i.test(l)).pop() ?? b.err.trim().split('\n').pop() ?? '').trim().slice(0, 200)}` }
    } catch (e) {
      return { ready: false, detail: `Couldn’t download pycairo: ${(e as Error).message}. Check the connection and try again.` }
    } finally {
      await fs.rm(build, { recursive: true, force: true })
    }
  }
  onProgress(`Downloading Manim (${MANIM_PACK.download})…`)
  const m = await pip(['install', '--progress-bar', 'off', '--retries', '8', '--timeout', '60', '--only-binary=:all:', '--no-binary=srt', `manim==${MANIM_PACK.version}`])
  if (m.code !== 0) {
    const err = m.err
    if (/No space left|Errno 28/i.test(err)) return { ready: false, detail: `The disk is full: maths animations take ${MANIM_PACK.size}.` }
    if (/connection|timed out|Temporary failure|Max retries|resolution|unreachable|SSL/i.test(err)) return { ready: false, detail: 'Couldn’t download Manim: check the connection and try again. What was installed is kept.' }
    return { ready: false, detail: `Couldn’t install Manim: ${(err.split('\n').filter((l) => /^ERROR/.test(l)).pop() ?? '').replace(/^ERROR:\s*/, '').slice(0, 200)}` }
  }
  // Compiled now, so renders in the sandbox (which can't write here) start quickly
  onProgress('Preparing it for the first time…')
  await d.run(py, ['-m', 'compileall', '-q', '-j', '0', join(venv, 'lib')], { timeoutMs: 600_000 })
  const ok = await d.run(py, ['-c', 'import manim, cairo; print(manim.__version__)'], { timeoutMs: 120_000 })
  if (ok.code !== 0) return { ready: false, detail: `Installed, but it didn’t load: ${ok.err.trim().split('\n').pop()?.slice(0, 200) ?? ''}` }
  return { ready: true, detail: `Manim ${ok.out.trim()}` }
}

/** Installs TinyTeX and the packages Manim's equations need, into Tide's tools folder */
export async function installTex(d: ManimInstaller, onProgress: (step: string) => void = () => {}): Promise<Status> {
  const free = await d.freeBytes()
  if (free !== null && free < TEX_PACK.needsBytes) return { ready: false, detail: `Not enough free space: equations take ${TEX_PACK.size}.` }
  const root = join(d.root, 'tinytex')
  const bin = () => {
    try {
      const base = join(root, 'TinyTeX', 'bin')
      const sub = readdirSync(base).find((n) => d.exists(join(base, n, 'tlmgr')))
      return sub ? join(base, sub) : null
    } catch {
      return null
    }
  }
  if (!bin()) {
    await fs.mkdir(root, { recursive: true })
    const tar = join(root, 'tinytex.tar.xz')
    try {
      await d.download(TEX_PACK.url, tar, undefined, (f) => onProgress(`Downloading TinyTeX (${Math.round(f * 100)}%)…`))
    } catch (e) {
      return { ready: false, detail: `Couldn’t download TinyTeX: ${(e as Error).message}` }
    }
    onProgress('Unpacking TinyTeX…')
    const x = await d.run('/usr/bin/tar', ['-xJf', tar, '-C', root], { timeoutMs: 600_000 })
    await fs.rm(tar, { force: true })
    if (x.code !== 0) return { ready: false, detail: `Couldn’t unpack TinyTeX: ${x.err.trim().slice(-160)}` }
  }
  const b = bin()
  if (!b) return { ready: false, detail: 'TinyTeX unpacked without its programs: try again' }
  const tlmgr = join(b, 'tlmgr')
  const env = { PATH: `${b}:/usr/bin:/bin` }
  onProgress('Updating TeX’s package manager…')
  await d.run(tlmgr, ['update', '--self'], { env, timeoutMs: 600_000 })
  onProgress('Adding the packages Manim’s equations use…')
  const p = await d.run(tlmgr, ['install', ...TEX_PACK.packages], { env, timeoutMs: 900_000 })
  if (p.code !== 0 && !d.exists(join(b, 'dvisvgm'))) return { ready: false, detail: `Couldn’t add TeX packages: ${(p.err || p.out).trim().split('\n').pop()?.slice(0, 200) ?? ''}` }
  return d.exists(join(b, 'dvisvgm')) && d.exists(join(b, 'latex')) ? { ready: true, detail: 'TinyTeX: equations typeset as in a textbook' } : { ready: false, detail: 'Installed without dvisvgm: try again' }
}

async function downloadTo(url: string, dest: string, sha256?: string, onFraction?: (f: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`the server answered ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  let got = 0
  let last = 0
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (c: Buffer) => {
    hash.update(c)
    got += c.length
    if (total && onFraction && got - last > total / 50) {
      last = got
      onFraction(got / total)
    }
  })
  await pipeline(body, createWriteStream(dest))
  if (sha256 && hash.digest('hex') !== sha256) {
    await fs.rm(dest, { force: true })
    throw new Error('the download was corrupted (its checksum did not match)')
  }
}

const installer = (): ManimInstaller => ({
  root: toolsRoot(),
  run: runCmd,
  exists: existsSync,
  freeBytes: async () => {
    await fs.mkdir(toolsRoot(), { recursive: true })
    return fs.statfs(toolsRoot()).then((s) => s.bavail * s.bsize, () => null)
  },
  download: downloadTo
})

let installing: Promise<Status> | null = null
let installingTex: Promise<Status> | null = null

/** One install at a time; a second press waits for the first */
export function setupManim(onProgress?: (step: string) => void): Promise<Status> {
  installing ??= installManim(installer(), onProgress).finally(() => {
    installing = null
    statusCache = null
  })
  return installing
}

export function setupTex(onProgress?: (step: string) => void): Promise<Status> {
  installingTex ??= installTex(installer(), onProgress).finally(() => {
    installingTex = null
    statusCache = null
  })
  return installingTex
}

// ---------- Settings ----------

export interface AnimSettings {
  /** Narrate in Tide's voice (on by default); muting in the player is separate */
  narration: boolean
  quality: AnimQuality
  /** The one-time offer to install has been answered */
  prompted: boolean
}

export async function animSettings(): Promise<AnimSettings> {
  const { getSettings } = await import('./settings')
  const a = ((getSettings() as { animations?: Partial<AnimSettings> }).animations ?? {}) as Partial<AnimSettings>
  return { narration: a.narration !== false, quality: a.quality === 'low' ? 'low' : 'medium', prompted: a.prompted === true }
}

export async function setAnimSettings(patch: Partial<AnimSettings>): Promise<AnimSettings> {
  const { updateSettings } = await import('./settings')
  const next = { ...(await animSettings()), ...patch }
  updateSettings({ animations: next } as never)
  return next
}

// ---------- Narration ----------

export interface Narrator {
  /** The voice's name, or '' when there is none ready (the animation is then silent, with captions) */
  voice(): Promise<string>
  /** WAV audio of one line */
  speak(text: string, voice: string): Promise<Uint8Array>
}

let voiceCheck: { at: number; ok: boolean } | null = null

/** Tide's voice as the settings choose it: Kokoro when it's set up, else the Mac's own */
export const tideNarrator: Narrator = {
  async voice() {
    const { getSettings } = await import('./settings')
    const v = getSettings().voice
    if (v?.engine === 'system') return 'system:'
    if (!voiceCheck || Date.now() - voiceCheck.at > 300_000) {
      const { voiceStatus } = await import('./voice')
      voiceCheck = { at: Date.now(), ok: (await voiceStatus().catch(() => ({ ready: false }))).ready }
    }
    return voiceCheck.ok ? `kokoro:${v?.custom || v?.name || 'bm_george'}` : 'system:'
  },
  async speak(text, voice) {
    const [engine, name] = voice.split(':')
    if (engine === 'kokoro') return (await import('./tts')).synth('kokoro', text, name, 1, true)
    // The Mac's own voice, to a WAV file
    const out = join(animRoot(), 'tmp', `say-${randomBytes(6).toString('hex')}.wav`)
    await fs.mkdir(join(animRoot(), 'tmp'), { recursive: true })
    const r = await runCmd('/usr/bin/say', ['-o', out, '--data-format=LEI16@24000', ...(name ? ['-v', name] : []), text], { timeoutMs: 60_000 })
    if (r.code !== 0) throw new Error(r.err || 'say failed')
    const wav = new Uint8Array(await fs.readFile(out))
    await fs.rm(out, { force: true })
    return wav
  }
}

// ---------- Rendering ----------

export interface Renderer {
  python: string
  tex: string | null
  /** Runs a command in the sandbox, its output line by line; resolves when it ends or is stopped */
  sandboxed(cmd: string[], o: { cwd: string; env: Record<string, string>; writable: string[]; timeoutMs: number; maxBytes: number; onLine(line: string): void }): Promise<{ code: number; out: string; timedOut: boolean; tooBig: boolean }>
}

/** du for a folder, in bytes (to stop a render that writes too much) */
async function folderBytes(dir: string): Promise<number> {
  let n = 0
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name)
    if (e.isDirectory()) n += await folderBytes(p)
    else n += (await fs.stat(p).catch(() => ({ size: 0 }))).size
  }
  return n
}

export const sandboxRenderer = async (): Promise<Renderer> => {
  const { profile } = await import('./runner')
  return {
    python: manimPython(),
    tex: texBin(),
    sandboxed: (cmd, o) =>
      new Promise((resolve) => {
        const sb = join(o.cwd, 'sandbox.sb')
        void fs.writeFile(sb, profile(o.writable)).then(() => {
          const child = spawn('/usr/bin/sandbox-exec', ['-f', sb, ...cmd], { cwd: o.cwd, env: o.env, detached: true })
          let out = ''
          let rest = ''
          let timedOut = false
          let tooBig = false
          const stop = () => {
            try {
              if (child.pid) process.kill(-child.pid, 'SIGKILL')
            } catch {
              child.kill('SIGKILL')
            }
          }
          const timer = setTimeout(() => {
            timedOut = true
            stop()
          }, o.timeoutMs)
          const watch = setInterval(() => {
            void folderBytes(o.cwd).then((n) => {
              if (n > o.maxBytes) {
                tooBig = true
                stop()
              }
            })
          }, 3000)
          const take = (d: Buffer) => {
            out = (out + d.toString()).slice(-60_000)
            const lines = (rest + d.toString()).split('\n')
            rest = lines.pop() ?? ''
            for (const l of lines) o.onLine(l)
          }
          child.stdout.on('data', take)
          child.stderr.on('data', take)
          child.on('close', (code) => {
            clearTimeout(timer)
            clearInterval(watch)
            resolve({ code: code ?? -1, out, timedOut, tooBig })
          })
          child.on('error', (e) => {
            clearTimeout(timer)
            clearInterval(watch)
            resolve({ code: -1, out: e.message, timedOut, tooBig })
          })
        })
      })
  }
}

export interface RenderResult {
  ok: boolean
  error?: string
  video?: string
  captions?: Caption[]
  seconds?: number
}

/** Finds the video Manim wrote (media/videos/scene/<quality>/out.mp4) */
async function findVideo(dir: string): Promise<string | null> {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name)
    if (e.isDirectory() && e.name !== 'partial_movie_files') {
      const f = await findVideo(p)
      if (f) return f
    } else if (e.name === 'out.mp4') return p
  }
  return null
}

/**
 * One render in a fresh folder: the scene, tide_manim.py, the narration's WAVs and the beat plan
 * go in; the video and the beat log come out. The folder is the only place it may write.
 */
export async function renderOnce(input: RenderInput, beats: BeatPlan[], r: Renderer, onProgress: (f: number) => void, work: string): Promise<RenderResult> {
  await fs.mkdir(work, { recursive: true })
  await fs.writeFile(join(work, 'scene.py'), input.code)
  await fs.writeFile(join(work, 'tide_manim.py'), TIDE_MANIM_PY)
  await fs.writeFile(join(work, 'beats.json'), JSON.stringify(beats))
  const tex = input.tex && r.tex ? r.tex : null
  const env: Record<string, string> = {
    PATH: `${tex ? `${tex}:` : ''}/usr/bin:/bin`,
    HOME: work,
    TMPDIR: work,
    MPLCONFIGDIR: work,
    TEXMFVAR: join(work, 'texmf-var'),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    TIDE_THEME: JSON.stringify(input.palette),
    TIDE_TEX: tex ? '1' : '0',
    TIDE_BEATS: join(work, 'beats.json'),
    TIDE_BEAT_LOG: join(work, 'log.json')
  }
  const limit = RENDER_LIMITS[input.quality]
  const ran = await r.sandboxed([r.python, '-m', 'manim', 'render', QUALITY_FLAG[input.quality], '--disable_caching', '--progress_bar', 'none', '--media_dir', join(work, 'media'), '-o', 'out', 'scene.py', 'TideAnim'], {
    cwd: work,
    env,
    writable: [work],
    timeoutMs: limit.ms,
    maxBytes: RENDER_LIMITS.bytes,
    onLine: (l) => {
      const p = beatProgress(l)
      if (p) onProgress(Math.min(0.97, p.done / p.total))
    }
  })
  if (ran.timedOut) return { ok: false, error: `It took longer than ${limit.ms / 1000} s to render: make it shorter or simpler.` }
  if (ran.tooBig) return { ok: false, error: 'It wrote more than 200 MB while rendering: make it simpler.' }
  const video = ran.code === 0 ? await findVideo(join(work, 'media')) : null
  if (!video) return { ok: false, error: renderError(ran.out) || `Manim stopped (exit ${ran.code}) without saying why.` }
  const size = (await fs.stat(video)).size
  if (size > RENDER_LIMITS.videoBytes) return { ok: false, error: 'The video came out too large: make it shorter.' }
  let log: unknown = []
  try {
    log = JSON.parse(await fs.readFile(join(work, 'log.json'), 'utf8'))
  } catch {
    // No log: a scene without beats; captions are left out
  }
  const captions = captionsFrom(log, beats.map((b) => b.text))
  return { ok: true, video, captions, seconds: captions.length ? captions[captions.length - 1].end : undefined }
}

// ---------- The queue and the cache ----------

interface Meta {
  key: string
  title: string
  captions: Caption[]
  narrated: boolean
  seconds?: number
  at: number
  lessons: string[]
  /** Claude's scene it came from */
  scene?: string
  template?: string
  ms: number
  quality: AnimQuality
}

interface SceneRecord {
  key: string
  code: string
  beats: string[]
  title: string
  topic: string
  at: number
  /** Repaired versions keep the key the lesson block refers to */
  repaired?: number
}

interface Job {
  key: string
  input: RenderInput
  title: string
  lessons: string[]
  scene?: string
  template?: string
  topic: string
}

const statuses = new Map<string, AnimStatus>()
const queue: Job[] = []
let running = false
let notify: (s: AnimStatus) => void = () => {}
/** Main sends every change of state to the windows */
export const onAnimStatus = (fn: (s: AnimStatus) => void) => (notify = fn)
/** Tests swap the sandbox, Claude and the voice */
export const deps = {
  status: (() => manimStatus()) as () => Promise<Status>,
  hasTex: (() => !!texBin()) as () => boolean,
  renderer: sandboxRenderer as () => Promise<Renderer>,
  narrator: tideNarrator as Narrator,
  repair: async (code: string, error: string, beats: number): Promise<string | null> => {
    const { claudeTeaches, claudeOnce } = await import('./claudeEngine')
    if (!(await claudeTeaches().catch(() => false))) return null
    const r = await claudeOnce(sceneRepairPrompt(code, error, beats), SCENE_SYSTEM, 'teach')
    return extractScene(r.text)
  }
}

const set = (key: string, patch: Partial<AnimStatus>) => {
  const s = { ...(statuses.get(key) ?? { key, state: 'queued' as const, progress: 0, label: '' }), ...patch, key }
  statuses.set(key, s)
  notify(s)
  return s
}

async function readMeta(key: string): Promise<Meta | null> {
  try {
    const alias = join(animRoot(), `${key}.alias`)
    const real = existsSync(alias) ? (await fs.readFile(alias, 'utf8')).trim() : key
    const m = JSON.parse(await fs.readFile(join(videoDir(real), 'meta.json'), 'utf8')) as Meta
    return existsSync(join(videoDir(real), 'video.mp4')) ? m : null
  } catch {
    return null
  }
}

const readyStatus = (m: Meta, key = m.key): AnimStatus => ({ key, state: 'ready', progress: 1, label: 'Ready', title: m.title, video: `tide-anim://v/${m.key}.mp4`, captions: m.captions, narrated: m.narrated, seconds: m.seconds })

let lessonWrites: Promise<unknown> = Promise.resolve()
/** One write at a time, so two animations noted at once both stay */
const noteLesson = (key: string, lesson: string) => (lessonWrites = lessonWrites.then(() => writeLesson(key, lesson)).catch(() => {}))

async function writeLesson(key: string, lesson: string) {
  if (!lesson) return
  const file = join(animRoot(), 'lessons.json')
  await fs.mkdir(animRoot(), { recursive: true })
  let all: Record<string, string[]> = {}
  try {
    all = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    // first one
  }
  const list = all[lesson] ?? []
  if (!list.includes(key)) all[lesson] = [...list, key].slice(-40)
  await fs.writeFile(file, JSON.stringify(all))
}

/** The animations a lesson used, by key */
export async function lessonAnimations(lesson: string): Promise<string[]> {
  try {
    return (JSON.parse(await fs.readFile(join(animRoot(), 'lessons.json'), 'utf8')) as Record<string, string[]>)[lesson] ?? []
  } catch {
    return []
  }
}

async function saveScene(s: SceneRecord) {
  await fs.mkdir(join(animRoot(), 'scenes'), { recursive: true })
  await fs.writeFile(sceneFile(s.key), JSON.stringify(s))
}

async function readScene(key: string): Promise<SceneRecord | null> {
  try {
    return JSON.parse(await fs.readFile(sceneFile(key), 'utf8')) as SceneRecord
  } catch {
    return null
  }
}

/** The colours the lesson last showed an animation in: renders started by Claude or by prep use them */
async function lastPalette(): Promise<AnimPalette> {
  try {
    return cleanPalette(JSON.parse(await fs.readFile(join(animRoot(), 'palette.json'), 'utf8')))
  } catch {
    return cleanPalette({})
  }
}

async function rememberPalette(p: AnimPalette) {
  await fs.mkdir(animRoot(), { recursive: true })
  await fs.writeFile(join(animRoot(), 'palette.json'), JSON.stringify(p)).catch(() => {})
}

export interface AnimRequest {
  block: AnimationBlock | string
  lesson?: string
  topic?: string
  palette?: unknown
  quality?: AnimQuality
}

/** What a block will play: the scene's code and narration, or why it can't */
async function resolve(block: AnimationBlock): Promise<{ code: string; beats: string[]; title: string; scene?: string; template?: string; topic: string } | { why: string }> {
  if (block.scene) {
    const s = await readScene(block.scene)
    return s ? { code: s.code, beats: s.beats, title: block.title || s.title, scene: s.key, topic: s.topic } : { why: 'This animation’s scene isn’t on this Mac.' }
  }
  const built = buildTemplate(block.template ?? '', block.params ?? {}, block.narration)
  return built.ok ? { code: built.scene.code, beats: built.scene.beats, title: block.title || built.scene.title, template: built.scene.template, topic: '' } : { why: built.why }
}

/**
 * Asks for an animation: ready at once from the cache, else queued (one render at a time) with
 * its progress sent as it goes. Unavailable when Manim isn't installed: the lesson then offers
 * to install it and shows the narration as text.
 */
export async function requestAnimation(req: AnimRequest): Promise<AnimStatus> {
  const parsed = typeof req.block === 'string' ? parseAnimationBlock(req.block) : { ok: true as const, block: req.block }
  if (!parsed.ok) return { key: '', state: 'failed', progress: 0, label: 'Not an animation Tide can draw', error: parsed.error }
  const what = await resolve(parsed.block)
  if ('why' in what) return { key: '', state: 'failed', progress: 0, label: 'Not an animation Tide can draw', error: what.why }
  const fallback = { captions: planBeats(what.beats).reduce<Caption[]>((acc, b) => [...acc, { start: acc.length ? acc[acc.length - 1].end : 0, end: (acc.length ? acc[acc.length - 1].end : 0) + b.dur, text: b.text }], []), title: what.title }
  if (!(await deps.status()).ready) return { key: '', state: 'unavailable', progress: 0, label: 'Maths animations aren’t installed', ...fallback }
  const settings = await animSettings()
  const palette = req.palette ? cleanPalette(req.palette) : await lastPalette()
  if (req.palette) void rememberPalette(palette)
  const voice = settings.narration ? await deps.narrator.voice().catch(() => '') : ''
  const input: RenderInput = { code: what.code, beats: what.beats, palette, quality: req.quality ?? settings.quality, tex: deps.hasTex(), voice }
  const key = renderKey(input)
  if (req.lesson) await noteLesson(key, req.lesson)
  const cached = await readMeta(key)
  if (cached) return readyStatus(cached, key)
  const now = statuses.get(key)
  if (now && now.state !== 'failed') return now
  const job: Job = { key, input, title: what.title, lessons: req.lesson ? [req.lesson] : [], scene: what.scene, template: what.template, topic: req.topic || what.topic }
  queue.push(job)
  const s = set(key, { state: 'queued', progress: 0, label: queue.length > 1 || running ? 'Waiting for the one before it…' : 'Starting…', title: what.title, captions: fallback.captions })
  void drain()
  return s
}

/** Where an animation is now */
export async function animationStatus(key: string): Promise<AnimStatus | null> {
  if (!/^m[a-z0-9]{6,40}$/.test(key)) return null
  const m = await readMeta(key)
  return m ? readyStatus(m, key) : statuses.get(key) ?? null
}

/** Waits for a key to be ready or failed (prep, tests) */
export function settled(key: string, timeoutMs = 600_000): Promise<AnimStatus> {
  return new Promise((done) => {
    const t0 = Date.now()
    const tick = async () => {
      const s = await animationStatus(key)
      if (s && (s.state === 'ready' || s.state === 'failed')) return done(s)
      if (Date.now() - t0 > timeoutMs) return done(s ?? { key, state: 'failed', progress: 0, label: 'Timed out' })
      setTimeout(tick, 400)
    }
    void tick()
  })
}

async function drain() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      await runJob(job).catch((e) => set(job.key, { state: 'failed', label: 'It couldn’t be rendered', error: String((e as Error).message ?? e).slice(0, 400) }))
    }
  } finally {
    running = false
  }
}

const MAX_REPAIRS = 2

async function runJob(job: Job) {
  const t0 = Date.now()
  set(job.key, { state: 'rendering', progress: 0.02, label: job.input.voice ? 'Recording the narration…' : 'Rendering…' })
  // Narration first: each beat lasts as long as its line takes to say
  const work = join(animRoot(), 'tmp', `${job.key}-${randomBytes(4).toString('hex')}`)
  await fs.mkdir(work, { recursive: true })
  const durations: (number | null)[] = []
  const wavs: (string | undefined)[] = []
  let narrated = false
  if (job.input.voice) {
    for (const [i, text] of job.input.beats.entries()) {
      try {
        const wav = await deps.narrator.speak(text, job.input.voice)
        const secs = wavSeconds(wav)
        if (!secs) throw new Error('not a WAV')
        const f = join(work, `beat-${i}.wav`)
        await fs.writeFile(f, wav)
        durations.push(secs)
        wavs.push(f)
        narrated = true
      } catch {
        durations.push(null)
        wavs.push(undefined)
      }
      set(job.key, { progress: 0.02 + (0.18 * (i + 1)) / job.input.beats.length })
    }
  }
  const beats = planBeats(job.input.beats, durations).map((b, i) => (wavs[i] ? { ...b, wav: wavs[i] } : b))
  const r = await deps.renderer()
  let input = job.input
  let result: RenderResult | null = null
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    set(job.key, { state: 'rendering', label: attempt ? `Rendering the repaired scene (${attempt} of ${MAX_REPAIRS})…` : 'Rendering…' })
    const base = narrated ? 0.2 : 0.02
    result = await renderOnce(input, beats, r, (f) => set(job.key, { progress: base + f * (0.98 - base) }), join(work, `try-${attempt}`))
    if (result.ok || !job.scene || attempt === MAX_REPAIRS) break
    // Claude's own scene: back to Claude with the error
    set(job.key, { state: 'repairing', label: 'Fixing the scene…', error: result.error })
    const fixed = await deps.repair(input.code, result.error ?? '', beats.length).catch(() => null)
    const why = fixed ? checkScene(fixed) : 'no fix came back'
    if (!fixed || why) break
    input = { ...input, code: fixed }
    const s = await readScene(job.scene)
    if (s) await saveScene({ ...s, code: fixed, repaired: (s.repaired ?? 0) + 1 })
  }
  if (!result?.ok || !result.video) {
    await fs.rm(work, { recursive: true, force: true })
    set(job.key, { state: 'failed', progress: 0, label: 'It couldn’t be rendered', error: result?.error })
    return
  }
  const dir = videoDir(job.key)
  await fs.mkdir(dir, { recursive: true })
  await fs.rename(result.video, join(dir, 'video.mp4'))
  await fs.writeFile(join(dir, 'scene.py'), input.code)
  const meta: Meta = { key: job.key, title: job.title, captions: result.captions ?? [], narrated, seconds: result.seconds, at: Date.now(), lessons: job.lessons, scene: job.scene, template: job.template, ms: Date.now() - t0, quality: input.quality }
  await fs.writeFile(join(dir, 'meta.json'), JSON.stringify(meta))
  // A repaired scene is asked for by its new code next time: point that key here too
  if (input.code !== job.input.code) await fs.writeFile(join(animRoot(), `${renderKey(input)}.alias`), job.key)
  await fs.rm(work, { recursive: true, force: true })
  console.log(`[manim] ${job.title}: ${input.quality}, ${((Date.now() - t0) / 1000).toFixed(1)} s${narrated ? ', narrated' : ''}`)
  set(job.key, readyStatus(meta, job.key))
  void trimCache().catch(() => {})
}

const MAX_CACHE = 2_000_000_000

/** Oldest videos go once the cache passes its size */
async function trimCache() {
  const dirs: { dir: string; at: number; size: number }[] = []
  for (const e of await fs.readdir(animRoot(), { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !/^m[a-z0-9]+$/.test(e.name)) continue
    const st = await fs.stat(join(animRoot(), e.name, 'video.mp4')).catch(() => null)
    if (st) dirs.push({ dir: join(animRoot(), e.name), at: st.mtimeMs, size: st.size })
  }
  let total = dirs.reduce((n, d) => n + d.size, 0)
  for (const d of dirs.sort((a, b) => a.at - b.at)) {
    if (total <= MAX_CACHE) break
    await fs.rm(d.dir, { recursive: true, force: true })
    total -= d.size
  }
}

/** The video file for the tide-anim: scheme, or null */
export function videoPath(key: string): string | null {
  if (!/^m[a-z0-9]{6,40}$/.test(key)) return null
  const f = join(videoDir(key), 'video.mp4')
  return existsSync(f) ? f : null
}

/** The video, whole or the byte range the player asks for (so it can seek) */
export async function videoResponse(file: string, range: string | null): Promise<Response> {
  const size = (await fs.stat(file)).size
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  let start = 0
  let end = size - 1
  if (m) {
    if (m[1]) start = Number(m[1])
    if (m[2]) end = Math.min(size - 1, Number(m[2]))
    if (!m[1] && m[2]) start = Math.max(0, size - Number(m[2]))
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const handle = await fs.open(file)
  const buf = Buffer.alloc(end - start + 1)
  await handle.read(buf, 0, buf.length, start)
  await handle.close()
  const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(buf.length), 'Cache-Control': 'no-store' }
  if (m) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  return new Response(buf, { status: m ? 206 : 200, headers })
}

// ---------- The library of Claude's scenes ----------

const LIBRARY = '.tide/animations.json'
export const LIBRARY_MAX = 120

interface Kept {
  id: string
  title: string
  topic: string
  code: string
  beats: string[]
  uses: number
  at: number
}

async function readLibrary(): Promise<Kept[]> {
  try {
    const { readText } = await import('./vault')
    const v = JSON.parse(await readText(LIBRARY)) as unknown
    return Array.isArray(v) ? (v as Kept[]).filter((k) => k && typeof k.code === 'string' && typeof k.id === 'string') : []
  } catch {
    return []
  }
}

/** A video was watched in a lesson: Claude's scene behind it joins the library (or counts again) */
export async function animationUsed(key: string): Promise<boolean> {
  const m = await readMeta(key)
  if (!m?.scene) return false
  const s = await readScene(m.scene)
  if (!s || checkScene(s.code)) return false
  const all = await readLibrary()
  const had = all.find((k) => k.id === s.key)
  if (had) {
    had.uses++
    had.at = Date.now()
  } else all.push({ id: s.key, title: s.title, topic: s.topic, code: s.code, beats: s.beats, uses: 1, at: Date.now() })
  all.sort((a, b) => b.uses - a.uses || b.at - a.at)
  const { writeText } = await import('./vault')
  await writeText(LIBRARY, JSON.stringify(all.slice(0, LIBRARY_MAX), null, 1))
  return true
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])

export async function findScenes(query: string, limit = 5): Promise<Kept[]> {
  const q = words(query)
  if (!q.size) return []
  return (await readLibrary())
    .map((k) => {
      const w = words(`${k.title} ${k.topic}`)
      let hit = 0
      for (const x of q) if (w.has(x)) hit++
      return { k, score: hit / q.size + Math.min(k.uses, 10) * 0.01 }
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.k)
}

// ---------- Claude's tools ----------

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })

/** Registers Claude's own scene (checked) and returns its key, or why it can't be used */
export async function registerScene(code: string, beats: string[], title: string, topic: string): Promise<{ key: string } | { why: string }> {
  const why = checkScene(code)
  if (why) return { why }
  const used = beatsUsed(code)
  if (!beats.length || beats.length !== used) return { why: `The scene has ${used} beat${used === 1 ? '' : 's'} (self.beat/self.during 0 to ${used - 1}); give exactly ${used} narration line${used === 1 ? '' : 's'}.` }
  const key = sceneKey(code)
  await saveScene({ key, code: code.trim() + '\n', beats: beats.map((b) => b.trim().slice(0, 400)), title: title.slice(0, 120) || 'An animation', topic: topic.slice(0, 160), at: Date.now() })
  return { key }
}

export const renderAnimationTool: McpTool = {
  name: 'render_animation',
  description:
    'Put a short narrated maths animation (Manim) in the lesson. Either template + params (a tested scene filled in from the learner\'s example; see your instructions for the list) or code + narration (your own TideScene, when no template fits). Tide checks it, starts rendering at once and returns the ```animation block to paste into your reply; keep teaching, the video slots in when it is ready. Your own scene is repaired from its error if it fails.',
  inputSchema: obj({
    template: { type: 'string', description: 'A template id, e.g. "place-value"' },
    params: { type: 'object', description: 'The template\'s settings, e.g. {"number": 2047}' },
    code: { type: 'string', description: 'Your own scene: from tide_manim import *, class TideAnim(TideScene), self.beat(i, …) per narration line' },
    narration: { type: 'array', items: { type: 'string' }, description: 'One line per beat. Required with code; optional with a template (then exactly as many lines as it has beats)' },
    title: { type: 'string', description: 'A short title shown above the video' },
    topic: { type: 'string', description: 'The lesson topic, for the library' }
  }),
  async run(args, ctx) {
    const title = typeof args.title === 'string' ? args.title : ''
    const narration = Array.isArray(args.narration) ? args.narration.filter((s): s is string => typeof s === 'string') : undefined
    let block: AnimationBlock
    if (typeof args.code === 'string' && args.code.trim()) {
      const reg = await registerScene(args.code, narration ?? [], title, String(args.topic ?? ''))
      if ('why' in reg) return `Not rendered: ${reg.why}`
      block = { scene: reg.key, ...(title ? { title } : {}) }
    } else {
      const id = String(args.template ?? '')
      const params = args.params && typeof args.params === 'object' ? (args.params as Record<string, unknown>) : {}
      const built = buildTemplate(id, params, narration)
      if (!built.ok) return `Not rendered: ${built.why}`
      if (narration?.length && narration.length !== built.scene.beats.length) return `Not rendered: ${id} has ${built.scene.beats.length} beats; give exactly that many narration lines, or none to use its own.`
      block = { template: id, params, ...(title ? { title } : {}), ...(narration?.length ? { narration } : {}) }
    }
    const step = ctx.step({ kind: 'run_code', label: 'Rendering an animation', status: 'running', depth: 0 })
    const s = await requestAnimation({ block, lesson: ctx.chatId ?? '', topic: String(args.topic ?? '') })
    ctx.updateStep(step, { status: s.state === 'failed' ? 'error' : 'done', label: s.state === 'unavailable' ? 'Animations aren’t installed yet' : 'Started an animation', detail: s.error?.slice(0, 140) })
    if (s.state === 'failed') return `Not rendered: ${s.error}`
    const note = s.state === 'unavailable' ? 'Manim isn’t installed on this Mac yet: the learner is offered the install, and sees the narration as text meanwhile, so keep the explanation complete in your words.' : s.state === 'ready' ? 'It was already rendered.' : 'It is rendering now (usually under 10 s).'
    return `${note} Paste this where it belongs, then keep teaching:\n${animationBlock(block)}`
  }
}

export const animationLibraryTool: McpTool = {
  name: 'animation_library',
  description: "Your own animation scenes from earlier lessons that rendered and were watched: look here before writing a new scene. With query: the closest (id, title, topic, uses). With id: its code and narration, to pass to render_animation as they are or adapted to this learner's numbers.",
  inputSchema: obj({ query: { type: 'string' }, id: { type: 'string' } }),
  async run(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : ''
    if (id) {
      const k = (await readLibrary()).find((x) => x.id === id)
      return k ? `"${k.title}" (from a lesson on ${k.topic}, used ${k.uses}×). Narration:\n${k.beats.map((b, i) => `${i}. ${b}`).join('\n')}\nCode:\n\`\`\`python\n${k.code}\`\`\`` : `No scene ${id} in the library.`
    }
    const found = await findScenes(String(args.query ?? ''))
    if (!found.length) return 'Nothing in the library matches: use a template, or write a scene (it is kept once it is watched).'
    return found.map((k) => `- ${k.id}: "${k.title}" (topic: ${k.topic}; used ${k.uses}×)`).join('\n') + '\nCall again with id to get one.'
  }
}

export const ANIMATION_TOOLS = [renderAnimationTool, animationLibraryTool]

// ---------- Overnight prep ----------

/**
 * Renders the next lesson's animations ahead of time: the blocks its prepared opening uses and
 * the templates that fit its topic (with their own settings), at the quality lessons use. Only
 * when Manim is installed; never downloads anything.
 */
export async function prerenderFor(topic: string, lesson: string, opening = '', max = 3): Promise<string[]> {
  if (!(await deps.status()).ready) return []
  const blocks: AnimationBlock[] = []
  for (const m of opening.matchAll(/```(?:animation|manim)\s*\n([\s\S]*?)```/g)) {
    const p = parseAnimationBlock(m[1].trim())
    if (p.ok) blocks.push(p.block)
  }
  for (const t of templatesFor(topic)) if (!blocks.some((b) => b.template === t.id)) blocks.push({ template: t.id, params: {} })
  const keys: string[] = []
  for (const block of blocks.slice(0, max)) {
    const s = await requestAnimation({ block, lesson, topic })
    if (!s.key) continue
    const done = await settled(s.key)
    if (done.state === 'ready') keys.push(s.key)
  }
  return keys
}
