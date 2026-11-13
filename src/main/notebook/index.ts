/**
 * Notebooks in Tide (shared/notebook): opening and saving .ipynb files in the vault or a project,
 * new ones from the quant lab's templates, one Jupyter kernel per open notebook (./kernel), the
 * variables and checked exercises through the kernel's tide_nb helper, and the quant pack's
 * install. Registered once from main/index.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { dirname, join, resolve } from 'path'
import type { CheckResult, KernelStartResult, NbFile, NbRef, NbTheme, NbVariable, PackStatus } from '@shared/notebook/api'
import { refKey } from '@shared/notebook/api'
import { QUANT_TEMPLATES, templateById, templateExercise, templateNotebook, type ExerciseSpec } from '@shared/notebook/templates'
import { newNotebook, serializeNotebook } from '@shared/notebook/ipynb'
import { QUANT_PACK, YAHOO_PACK } from '@shared/labPack'
import { Kernel } from './kernel'
import { duBytes, findUv, installArgs, installPack, packStatusOf, realInstaller, rememberedSize, STATUS_CODE } from './pack'
import TIDE_NB from './tide_nb.py?raw'

const userData = () => app.getPath('userData')
const nbDir = () => join(userData(), 'notebook')
/** Tide's own Python; TIDE_NB_PYTHON points a development copy at a scratch environment */
export const notebookPython = () => process.env.TIDE_NB_PYTHON || join(userData(), 'python', 'bin', 'python')
const envDir = () => dirname(dirname(notebookPython()))

function send(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}

// ---------- Files ----------

/** The absolute path of a notebook the window asked for: in the vault, or in a folder the IDE has open */
export async function resolveRef(ref: NbRef): Promise<string> {
  if (ref.vault) {
    const { absPath } = await import('../vault')
    const p = absPath(ref.vault)
    if (!/\.ipynb$/i.test(p)) throw new Error('Not a notebook.')
    return p
  }
  const abs = resolve(String(ref.abs ?? ''))
  if (!/\.ipynb$/i.test(abs)) throw new Error('Not a notebook.')
  const { allowed } = await import('../ide/workspace')
  // Any folder above it that the IDE has open
  for (let d = dirname(abs); d !== dirname(d); d = dirname(d)) {
    try {
      allowed(d)
      return abs
    } catch {
      // not this one
    }
  }
  throw new Error('Open the project in the IDE first.')
}

async function read(ref: NbRef): Promise<NbFile> {
  const p = await resolveRef(ref)
  const [text, st] = await Promise.all([fs.readFile(p, 'utf8'), fs.stat(p)])
  return { text, mtime: st.mtimeMs, dir: dirname(p) }
}

async function write(ref: NbRef, text: string): Promise<{ mtime: number }> {
  const p = await resolveRef(ref)
  // Written whole, then moved into place: a crash never leaves half a notebook
  const tmp = `${p}.tide-${process.pid}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, p)
  return { mtime: (await fs.stat(p)).mtimeMs }
}

async function create(folder: string, name: string, template?: string): Promise<string> {
  const { uniquePath, sanitizeName, joinRel, writeText } = await import('../vault')
  const t = template ? templateById(template) : undefined
  const nb = t ? templateNotebook(t) : newNotebook()
  const rel = uniquePath(joinRel(folder, `${sanitizeName(name || t?.title || 'Untitled')}.ipynb`))
  await writeText(rel, serializeNotebook(nb))
  return rel
}

// ---------- Kernels ----------

/**
 * Where a course's lesson cells run: a folder of the course's own in Tide's data, kept between
 * lessons, so a file one lesson downloads or writes is there for the next. Never the vault.
 */
async function courseRunDir(course: string): Promise<string> {
  const id = String(course).split('/')[0].replace(/[^\w.-]+/g, '-').replace(/^\.+/, '') || 'course'
  const dir = join(nbDir(), 'courses', id)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

interface Open {
  kernel: Kernel
  dir: string
  ref: NbRef
  starting: Promise<KernelStartResult> | null
}
const kernels = new Map<string, Open>()

let siteReady: Promise<string> | null = null
/** tide_nb and tide_finance (with the market data) in a folder on the kernel's PYTHONPATH */
function site(): Promise<string> {
  siteReady ??= (async () => {
    const dir = join(nbDir(), 'site')
    await fs.mkdir(dir, { recursive: true })
    const { writeFinanceHelper } = await import('../finance/helper')
    await writeFinanceHelper(dir)
    await fs.writeFile(join(dir, 'tide_nb.py'), TIDE_NB)
    return dir
  })().catch((e) => {
    siteReady = null
    throw e
  })
  return siteReady
}

const themeCode = (t: NbTheme) => `_tide_nb.theme(__import__("json").loads(${JSON.stringify(JSON.stringify(t))}))`

async function hasKernelPackage(): Promise<boolean> {
  if (!existsSync(notebookPython())) return false
  const { spawn } = await import('child_process')
  return new Promise((res) => {
    const c = spawn(notebookPython(), ['-c', 'import ipykernel, jupyter_client'], { stdio: 'ignore' })
    c.on('close', (code) => res(code === 0))
    c.on('error', () => res(false))
  })
}

/** The environment every notebook kernel (and the tutor's scratch kernel) starts with */
export async function kernelEnv(): Promise<Record<string, string>> {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin',
    HOME: process.env.HOME ?? '',
    LANG: 'en_GB.UTF-8',
    PYTHONPATH: await site(),
    PYTHONNOUSERSITE: '1',
    MPLBACKEND: 'module://matplotlib_inline.backend_inline',
    MPLCONFIGDIR: await fs.realpath(mplDir()).catch(() => mplDir()),
    PLOTLY_RENDERER: 'plotly_mimetype',
    PYTHONUNBUFFERED: '1'
  }
}
export const mplDir = () => join(userData(), 'python', 'mplconfig')

async function start(ref: NbRef, theme: NbTheme): Promise<KernelStartResult> {
  const key = refKey(ref)
  const had = kernels.get(key)
  if (had && had.kernel.state !== 'dead') return had.starting ?? { ok: true }
  if (!(await hasKernelPackage())) return { ok: false, needsPack: true, detail: `The notebook runs on the Jupyter kernel, which is in the quant pack (${QUANT_PACK.size}).` }
  const folder = ref.course ? await courseRunDir(ref.course) : dirname(await resolveRef(ref))
  const kdir = join(nbDir(), 'kernels', createHash('sha1').update(key).digest('hex').slice(0, 12))
  // The sandbox matches real paths, not links: Tide's Python folder may be one
  await fs.mkdir(mplDir(), { recursive: true }).catch(() => {})
  const mpl = await fs.realpath(mplDir()).catch(() => mplDir())
  const realFolder = await fs.realpath(folder).catch(() => folder)
  const { getSettings } = await import('../settings')
  const network = !!getSettings().notebook?.internet
  const kernel = new Kernel(
    {
      python: notebookPython(),
      cwd: folder,
      env: await kernelEnv(),
      writable: [realFolder, mpl],
      network,
      bootstrap: `import tide_nb as _tide_nb\n${themeCode(theme)}`,
      onEvent: (event) => send('notebook:kernel', { key, event })
    },
    kdir
  )
  const open: Open = { kernel, dir: folder, ref, starting: null }
  kernels.set(key, open)
  open.starting = kernel
    .start()
    .then((): KernelStartResult => ({ ok: true }))
    .catch((e): KernelStartResult => ({ ok: false, needsPack: false, detail: `The kernel didn’t start: ${(e as Error).message}` }))
    .finally(() => (open.starting = null))
  return open.starting
}

const kernelOf = (ref: NbRef) => {
  const k = kernels.get(refKey(ref))
  if (!k) throw new Error('The kernel isn’t running.')
  return k.kernel
}

async function variables(ref: NbRef): Promise<NbVariable[]> {
  const k = kernels.get(refKey(ref))?.kernel
  if (!k || k.state === 'dead' || k.state === 'starting' || k.state === 'restarting') return []
  try {
    return JSON.parse((await k.evaluate('_tide_nb.variables()', 10_000)).trim() || '[]')
  } catch {
    return []
  }
}

// ---------- Checked exercises ----------

const exercisesFile = () => join(nbDir(), 'exercises.json')
type StoredExercise = ExerciseSpec & { created: number }

async function storedExercises(): Promise<Record<string, StoredExercise>> {
  try {
    return JSON.parse(await fs.readFile(exercisesFile(), 'utf8'))
  } catch {
    return {}
  }
}

/** Keeps an exercise Claude set, with its hidden tests, outside the notebook file */
export async function saveExercise(e: ExerciseSpec): Promise<void> {
  const all = await storedExercises()
  all[e.id] = { ...e, created: Date.now() }
  await fs.mkdir(nbDir(), { recursive: true })
  await fs.writeFile(exercisesFile(), JSON.stringify(all, null, 1))
}

export async function exerciseSpec(id: string): Promise<ExerciseSpec | undefined> {
  return templateExercise(id) ?? (await storedExercises())[id]
}

/** Runs the hidden tests in a kernel against its variables */
export async function runChecks(kernel: Kernel, tests: ExerciseSpec['tests']): Promise<CheckResult> {
  const out = await kernel.evaluate(`_tide_nb.check(${JSON.stringify(JSON.stringify(tests))})`, 60_000)
  const results = JSON.parse(out.trim() || '[]') as CheckResult['results']
  return { passed: results.length > 0 && results.every((r) => r.ok), results }
}

async function check(ref: NbRef, id: string, session?: string): Promise<CheckResult> {
  const spec = await exerciseSpec(id)
  if (!spec) throw new Error('This exercise’s checks aren’t on this Mac any more.')
  const r = await runChecks(kernelOf(ref), spec.tests)
  // A checked exercise in a notebook, in the learning event log
  {
    const passed = r.results.filter((x) => x.ok).length
    const at = Date.now()
    await Promise.all([import('@shared/learningEvents'), import('../learningLog')])
      .then(([, { learningEvent }]) => learningEvent({ key: `notebook:${id}#${at}`, at, kind: 'answered', source: 'notebook', topic: (spec as { topic?: string }).topic ?? spec.title, outcome: r.passed ? 'correct' : passed ? 'partial' : 'wrong', tests: { passed, total: r.results.length }, level: 3, note: spec.title, skills: r.passed ? [] : ['debugging'] }))
      .catch(() => {})
  }
  if (session) {
    const { noteForTutor } = await import('./tutor')
    noteForTutor(session, `the learner checked the exercise "${spec.title}": ${r.results.filter((x) => x.ok).length} of ${r.results.length} tests passed${r.passed ? '' : `; failing: ${r.results.filter((x) => !x.ok).map((x) => `${x.name} (${x.message ?? ''})`).join('; ')}`}.`)
  }
  return r
}

// ---------- The quant pack ----------

function spawnLines(cmd: string, args: string[], onLine?: (line: string) => void): Promise<{ code: number; err: string }> {
  return import('child_process').then(
    ({ spawn }) =>
      new Promise((res) => {
        const c = spawn(cmd, args, { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin', HOME: process.env.HOME ?? '', UV_NO_PROGRESS: '1', ...(process.env.UV_CACHE_DIR ? { UV_CACHE_DIR: process.env.UV_CACHE_DIR } : {}) } })
        let err = ''
        const lines = (stream: NodeJS.ReadableStream, keep: boolean) => {
          let rest = ''
          stream.on('data', (d) => {
            const s = d.toString()
            if (keep) err = (err + s).slice(-20_000)
            const parts = (rest + s).split('\n')
            rest = parts.pop() ?? ''
            for (const l of parts) onLine?.(l)
          })
        }
        lines(c.stdout, false)
        // uv writes its progress to stderr
        lines(c.stderr, true)
        c.on('close', (code) => res({ code: code ?? -1, err }))
        c.on('error', (e) => res({ code: -1, err: e.message }))
      })
  )
}

async function packStatus(): Promise<PackStatus> {
  const installer = findUv() ? 'uv' : 'pip'
  const base = { installer, yahoo: false } as const
  if (!existsSync(notebookPython())) return { ...base, ready: false, detail: `Not set up yet: ${QUANT_PACK.download} to download, ${QUANT_PACK.size} on disk`, missing: QUANT_PACK.dists }
  let out = ''
  const r = await spawnLines(notebookPython(), ['-c', `${STATUS_CODE}\ntry:\n    print("yfinance", version("yfinance"))\nexcept PackageNotFoundError:\n    print("yfinance", "-")\n`], (l) => (out += l + '\n'))
  if (r.code !== 0) return { ...base, ready: false, detail: r.err.trim().split('\n').pop()?.slice(0, 200) || 'Tide’s Python did not answer' }
  const s = packStatusOf(out, rememberedSize(userData())?.sizeMb)
  return { ...base, ...s, yahoo: /^yfinance [^-]/m.test(out) }
}

let installing: Promise<PackStatus> | null = null
function install(): Promise<PackStatus> {
  if (installing) return installing
  installing = import('../runner')
    .then(({ basePython }) => installPack(realInstaller({ python: notebookPython(), dir: envDir(), userData: userData(), basePython: basePython(), run: spawnLines, status: packStatus }), (step) => send('notebook:packProgress', step)))
    .then(async (s) => ({ ...(await packStatus()), ...(s.ready ? {} : { ready: false, detail: s.detail }) }))
    .finally(() => (installing = null))
  return installing
}

async function installYahoo(): Promise<PackStatus> {
  const [cmd, args] = installArgs({ python: notebookPython(), uv: findUv() }, YAHOO_PACK.packages)
  send('notebook:packProgress', 'Installing yfinance…')
  const r = await spawnLines(cmd, args)
  const s = await packStatus()
  return r.code === 0 ? s : { ...s, detail: `Couldn't install yfinance: ${r.err.trim().split('\n').pop()?.slice(0, 160) ?? ''}` }
}

export async function packSize(): Promise<number> {
  return duBytes(envDir())
}

// ---------- IPC ----------

export function registerNotebook(): void {
  ipcMain.handle('notebook:read', (_e, ref: NbRef) => read(ref))
  ipcMain.handle('notebook:write', (_e, ref: NbRef, text: string) => write(ref, String(text)))
  ipcMain.handle('notebook:create', (_e, folder: string, name: string, template?: string) => create(String(folder ?? ''), String(name ?? ''), template))
  ipcMain.handle('notebook:templates', () => QUANT_TEMPLATES.map(({ id, title, summary, needs }) => ({ id, title, summary, needs })))
  ipcMain.handle('notebook:start', (_e, ref: NbRef, theme: NbTheme) => start(ref, theme))
  ipcMain.handle('notebook:execute', (_e, ref: NbRef, id: string, code: string) => {
    kernelOf(ref).execute(String(code), { id: String(id) })
  })
  ipcMain.handle('notebook:interrupt', (_e, ref: NbRef) => kernelOf(ref).interrupt())
  ipcMain.handle('notebook:restart', async (_e, ref: NbRef) => {
    const k = kernels.get(refKey(ref))
    if (!k) return { ok: false, needsPack: false, detail: 'The kernel isn’t running.' }
    try {
      await k.kernel.restart()
      return { ok: true }
    } catch (e) {
      return { ok: false, needsPack: false, detail: (e as Error).message }
    }
  })
  ipcMain.handle('notebook:shutdown', async (_e, ref: NbRef) => {
    const k = kernels.get(refKey(ref))
    kernels.delete(refKey(ref))
    await k?.kernel.shutdown()
  })
  ipcMain.handle('notebook:variables', (_e, ref: NbRef) => variables(ref))
  ipcMain.handle('notebook:theme', async (_e, ref: NbRef, theme: NbTheme) => {
    const k = kernels.get(refKey(ref))?.kernel
    if (k && (k.state === 'idle' || k.state === 'busy')) await k.evaluate(themeCode(theme)).catch(() => '')
  })
  ipcMain.handle('notebook:check', (_e, ref: NbRef, id: string, session?: string) => check(ref, String(id), session))
  ipcMain.handle('notebook:packStatus', () => packStatus())
  ipcMain.handle('notebook:installPack', () => install())
  ipcMain.handle('notebook:installYahoo', () => installYahoo())
  ipcMain.handle('notebook:tutor:status', async () => (await import('./tutor')).tutorStatus())
  ipcMain.handle('notebook:tutor:send', async (_e, req) => (await import('./tutor')).send(req))
  ipcMain.handle('notebook:tutor:stop', async (_e, id: string) => (await import('./tutor')).stop(id))
  ipcMain.handle('notebook:tutor:end', async (_e, id: string) => (await import('./tutor')).end(id))
  ipcMain.handle('notebook:tutor:resolve', async (_e, id: string, kept: string | null) => (await import('./tutor')).resolveProposal(id, kept))
  ipcMain.on('notebook:tutor:snapshot', (_e, session: string, snap) => {
    if (typeof session === 'string' && snap && typeof snap.text === 'string') void import('./tutor').then((t) => t.setSnapshot(session, snap))
  })
}

/** On quit: every kernel stops */
export async function stopNotebooks(): Promise<void> {
  await Promise.all([...kernels.values()].map((k) => k.kernel.shutdown().catch(() => {})))
  kernels.clear()
  const { stopTutors } = await import('./tutor')
  await stopTutors()
}

/** For the tutor: the notebook's live kernel, when it runs */
export const liveKernel = (ref: NbRef) => kernels.get(refKey(ref))?.kernel ?? null
export { site as kernelSite }
