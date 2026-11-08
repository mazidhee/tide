import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import type { RunResult } from '@shared/types'

/**
 * Runs Python and JavaScript for notes, interviews and maths checks. Code from the student or the
 * model runs under macOS sandbox-exec: no network, and no writes outside a scratch folder.
 */

const TIMEOUT_MS = 10_000
/** Projects get longer: importing pandas or drawing a chart takes a few seconds on its own */
const PROJECT_TIMEOUT_MS = 30_000
const OUTPUT_LIMIT = 20_000
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 3_000_000
/** What a project run copies into the sandbox */
const PROJECT_LIMITS = { files: 300, bytes: 20_000_000, depth: 4 }

export const mathPython = () => join(app.getPath('userData'), 'python', 'bin', 'python')
/** Matplotlib's font cache lives outside the throwaway folder so it's built once, not every run */
const mplConfig = () => join(app.getPath('userData'), 'python', 'mplconfig')

/** Python libraries Tide installs in its own environment: maths checking, then data and plots */
export const PYTHON_LIBRARIES = ['sympy', 'numpy', 'pandas', 'matplotlib']

/**
 * Loaded before the student's program: draws charts off screen and saves every open figure when
 * the program ends (plt.show() saves too), so the output panel can show them.
 */
const SITE_CUSTOMIZE = `import atexit, os, sys
os.environ.setdefault("MPLBACKEND", "Agg")
_n = [0]
def _save():
    plt = sys.modules.get("matplotlib.pyplot")
    if not plt:
        return
    for num in plt.get_fignums():
        if _n[0] >= ${MAX_IMAGES}:
            break
        _n[0] += 1
        plt.figure(num).savefig(os.path.join(os.environ["TIDE_FIGURES"], "figure-%d.png" % _n[0]), dpi=110, bbox_inches="tight")
    plt.close("all")
def _show(*a, **k):
    _save()
_registered = [False]
def _hook():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt and plt.show is not _show:
        plt.show = _show
        if not _registered[0]:
            # Registered after matplotlib's own exit handler, so it runs first, while figures exist
            _registered[0] = True
            atexit.register(_save)
class _Finder:
    """Patches pyplot right after it loads; other imports never pass through here"""
    def find_spec(self, name, path=None, target=None):
        if name != "matplotlib.pyplot":
            return None
        import importlib.machinery
        spec = importlib.machinery.PathFinder.find_spec(name, path)
        if spec and spec.loader and hasattr(spec.loader, "exec_module"):
            run = spec.loader.exec_module
            def exec_module(module):
                run(module)
                _hook()
            spec.loader.exec_module = exec_module
        return spec
sys.meta_path.insert(0, _Finder())
`

function pythonPath() {
  return existsSync(mathPython()) ? mathPython() : '/usr/bin/env'
}

const profile = (scratch: string, mpl: string) => `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath "${scratch}") (subpath "/private${scratch}") (subpath "${mpl}") (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty"))
`

const languageOf = (language: string) => {
  const lang = language.toLowerCase()
  if (['python', 'py', 'python3'].includes(lang)) return 'python'
  if (['javascript', 'js', 'node', 'mjs'].includes(lang)) return 'javascript'
  return null
}

export async function runCode(language: string, code: string, stdin = '', timeoutMs = TIMEOUT_MS): Promise<RunResult> {
  const lang = languageOf(language)
  if (!lang) return { stdout: '', stderr: `Running ${language} isn't supported yet. Python and JavaScript are.`, exitCode: 1, timedOut: false, durationMs: 0 }
  const scratch = await fs.mkdtemp(join(tmpdir(), 'tide-run-'))
  const work = join(scratch, 'work')
  await fs.mkdir(work)
  const entry = lang === 'python' ? 'main.py' : 'main.js'
  await fs.writeFile(join(work, entry), code)
  return execute(lang, scratch, entry, stdin, timeoutMs)
}

/**
 * Runs a file from your Code folder as part of its project: everything in the same folder (other
 * modules, CSV and JSON data) is copied into the sandbox first, so imports and relative paths
 * work. Writes stay in the sandbox and are thrown away afterwards.
 */
export async function runProject(entryAbs: string, stdin = ''): Promise<RunResult> {
  const ext = entryAbs.split('.').pop() ?? ''
  const lang = languageOf(ext)
  if (!lang) return { stdout: '', stderr: `Running .${ext} files isn't supported yet. Python and JavaScript are; use the terminal for the rest.`, exitCode: 1, timedOut: false, durationMs: 0 }
  const root = dirname(entryAbs)
  const scratch = await fs.mkdtemp(join(tmpdir(), 'tide-run-'))
  const work = join(scratch, 'work')
  await fs.mkdir(work)
  let files = 0
  let bytes = 0
  const copy = async (dir: string, depth: number) => {
    if (depth > PROJECT_LIMITS.depth) return
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__' || e.name === 'venv' || e.name === '.venv') continue
      const from = join(dir, e.name)
      const to = join(work, relative(root, from))
      if (e.isDirectory()) {
        await fs.mkdir(to, { recursive: true })
        await copy(from, depth + 1)
      } else if (e.isFile()) {
        const size = (await fs.stat(from)).size
        if (files >= PROJECT_LIMITS.files || bytes + size > PROJECT_LIMITS.bytes) continue
        files++
        bytes += size
        await fs.copyFile(from, to)
      }
    }
  }
  await copy(root, 0)
  return execute(lang, scratch, relative(root, entryAbs), stdin, PROJECT_TIMEOUT_MS)
}

async function execute(lang: 'python' | 'javascript', scratch: string, entry: string, stdin: string, timeoutMs: number): Promise<RunResult> {
  const work = join(scratch, 'work')
  const file = join(work, entry)
  const site = join(scratch, 'site')
  const figures = join(scratch, 'figures')
  await fs.mkdir(site)
  await fs.mkdir(figures)
  await fs.writeFile(join(site, 'sitecustomize.py'), SITE_CUSTOMIZE)
  await fs.mkdir(mplConfig(), { recursive: true }).catch(() => {})
  // The sandbox matches real paths, so resolve any links on the way
  const mpl = await fs.realpath(mplConfig()).catch(() => mplConfig())
  const sb = join(scratch, 'profile.sb')
  await fs.writeFile(sb, profile(scratch, mpl))

  const isJs = lang === 'javascript'
  const py = pythonPath()
  const cmd = !isJs ? (py === '/usr/bin/env' ? ['/usr/bin/env', 'python3', file] : [py, file]) : [process.execPath, file]
  const started = Date.now()

  return new Promise<RunResult>((resolve) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-f', sb, ...cmd], {
      cwd: work,
      env: {
        PATH: '/usr/bin:/bin:/opt/homebrew/bin',
        HOME: scratch,
        TMPDIR: scratch,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONPATH: site,
        MPLBACKEND: 'Agg',
        MPLCONFIGDIR: mpl,
        TIDE_FIGURES: figures,
        ...(isJs ? { ELECTRON_RUN_AS_NODE: '1' } : {})
      }
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const cap = (s: string, add: string) => (s.length > OUTPUT_LIMIT ? s : (s + add).slice(0, OUTPUT_LIMIT))
    child.stdout.on('data', (d) => (stdout = cap(stdout, d.toString())))
    child.stderr.on('data', (d) => (stderr = cap(stderr, d.toString())))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('close', async (exitCode) => {
      clearTimeout(timer)
      const images = await readFigures(figures)
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
      const paths = new RegExp([work, scratch].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/').join('|'), 'g')
      resolve({ stdout, stderr: stderr.replace(paths, ''), exitCode: exitCode ?? -1, timedOut, durationMs: Date.now() - started, ...(images.length ? { images } : {}) })
    })
    child.on('error', async (e) => {
      clearTimeout(timer)
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
      resolve({ stdout, stderr: e.message, exitCode: -1, timedOut: false, durationMs: Date.now() - started })
    })
    if (stdin) child.stdin.write(stdin)
    child.stdin.end()
  })
}

async function readFigures(dir: string): Promise<string[]> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.png')).sort().slice(0, MAX_IMAGES)
  const out: string[] = []
  for (const n of names) {
    const data = await fs.readFile(join(dir, n)).catch(() => null)
    if (data && data.length <= MAX_IMAGE_BYTES) out.push(`data:image/png;base64,${data.toString('base64')}`)
  }
  return out
}

export async function mathStatus(): Promise<{ ready: boolean; detail: string }> {
  if (!existsSync(mathPython())) return { ready: false, detail: 'Not set up yet' }
  const r = await runCode('python', 'import sympy; print(sympy.__version__)')
  return r.exitCode === 0 ? { ready: true, detail: `SymPy ${r.stdout.trim()}` } : { ready: false, detail: r.stderr.slice(0, 200) }
}

export async function librariesStatus(): Promise<{ ready: boolean; detail: string }> {
  if (!existsSync(mathPython())) return { ready: false, detail: 'Not set up yet' }
  const r = await runCode('python', 'import numpy, pandas, matplotlib; print(numpy.__version__, pandas.__version__, matplotlib.__version__)', '', 30_000)
  if (r.exitCode !== 0) return { ready: false, detail: 'NumPy, pandas and Matplotlib are not installed yet' }
  const [np, pd, mpl] = r.stdout.trim().split(' ')
  return { ready: true, detail: `NumPy ${np}, pandas ${pd}, Matplotlib ${mpl}` }
}

/** Adds the data libraries to Tide's Python (about 150 MB), for the Playground and the tutor's run_code */
export async function setupLibraries(): Promise<{ ready: boolean; detail: string }> {
  const math = await setupMath(PYTHON_LIBRARIES)
  if (!math.ready && !existsSync(mathPython())) return math
  return librariesStatus()
}

/** Creates Tide's own Python environment with SymPy, so the system Python is never touched */
export async function setupMath(packages = ['sympy']): Promise<{ ready: boolean; detail: string }> {
  const dir = join(app.getPath('userData'), 'python')
  const run = (cmd: string, args: string[]) =>
    new Promise<{ code: number; err: string }>((resolve) => {
      const c = spawn(cmd, args, { env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin' } })
      let err = ''
      c.stderr.on('data', (d) => (err += d.toString()))
      c.on('close', (code) => resolve({ code: code ?? -1, err }))
      c.on('error', (e) => resolve({ code: -1, err: e.message }))
    })
  if (!existsSync(mathPython())) {
    const v = await run('/usr/bin/env', ['python3', '-m', 'venv', dir])
    if (v.code !== 0) return { ready: false, detail: `Couldn't create a Python environment: ${v.err.slice(0, 200) || 'is Python 3 installed?'}` }
  }
  const p = await run(join(dir, 'bin', 'pip'), ['install', '--quiet', ...packages])
  if (p.code !== 0) return { ready: false, detail: `Couldn't install ${packages.join(', ')}: ${p.err.slice(0, 200)}` }
  return mathStatus()
}
