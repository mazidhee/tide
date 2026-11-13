import { app } from 'electron'
import { execFileSync, spawn } from 'child_process'
import { createServer } from 'net'
import { existsSync, promises as fs } from 'fs'
import { homedir, tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import { LAB_PACK } from '@shared/labPack'
import type { RunResult, TestResults } from '@shared/types'
import { isSql, LANGUAGE_NAMES, languageOf, missingText, toolFor, type Language, type RunContext } from './languages'
import { TEACH_SERVER, TEST_RUNNER, TIDE_HTTP_HELPER } from './runnerScripts'
import { usesFinanceHelper, writeFinanceHelper } from './finance/helper'

/**
 * Runs code for notes, lessons, interviews and maths checks: Python and JavaScript always, and
 * every other language in ./languages whose toolchain is on this Mac. Code from the student or
 * the model runs under macOS sandbox-exec: no writes outside a scratch folder, and no network
 * beyond this Mac's own loopback, where a practice web server answers for lessons on HTTP.
 */

const TIMEOUT_MS = 10_000
/** Projects get longer: importing pandas or drawing a chart takes a few seconds on its own */
const PROJECT_TIMEOUT_MS = 30_000
/** Compiling is timed apart from running, so a slow compiler does not eat the program's time */
const COMPILE_TIMEOUT_MS = 60_000
/** These take seconds to import before the program's first line runs, so a snippet using them gets a project's time */
const HEAVY_IMPORT = /^\s*(?:import|from)\s+(?:torch|sklearn|scipy)\b/m
const OUTPUT_LIMIT = 20_000
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 3_000_000
/** What a project run copies into the sandbox */
const PROJECT_LIMITS = { files: 300, bytes: 20_000_000, depth: 4 }

export const mathPython = () => join(app.getPath('userData'), 'python', 'bin', 'python')
/** Matplotlib's font cache lives outside the throwaway folder so it's built once, not every run */
const mplConfig = () => join(app.getPath('userData'), 'python', 'mplconfig')
/** Compiler caches (Swift's modules, Go's build cache) are kept too: without them every run compiles the standard library again */
const runCache = () => join(app.getPath('userData'), 'runcache')

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


export const pythonCmd = () => (existsSync(mathPython()) ? [mathPython()] : ['/usr/bin/env', 'python3'])

let userTemp: string | null = null
/** Where Metal keeps compiled graphs for PyTorch on the GPU (MPS); it ignores TMPDIR, so the sandbox lets it write there */
function metalCache(): string {
  if (userTemp === null) {
    try {
      userTemp = execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR']).toString().trim()
    } catch {
      userTemp = tmpdir()
    }
  }
  return join(userTemp, 'com.apple.MetalPerformanceShadersGraph')
}

/** A path as the sandbox may see it: /var and /tmp are links into /private */
const bothForms = (p: string) => (/^\/(var|tmp)\//.test(p) ? [p, `/private${p}`] : [p])

/**
 * The sandbox. Everything is allowed except: writing outside the listed folders, and the network.
 * Of the network, a program may listen on this Mac's own address and connect to the listed ports
 * of it and no others: Tide's practice server and the one port a lesson's own server is given
 * (TIDE_PORT). The rest of loopback stays closed, because other things listen there (the model
 * server, a search engine that reaches the internet, databases). Three things found by trying:
 * one rule naming both ends ("local ip" and "remote ip") lets any outbound connection through, so
 * each direction has its own; opening all of loopback and then closing single ports does not
 * hold (the deny is ignored for most port numbers), while opening single ports does; and a
 * program that listens on every interface (0.0.0.0) can be reached from the local network while
 * it runs, which the sandbox cannot tell from a loopback bind. (The one file under /tmp is where
 * OpenMP, inside PyTorch and scikit-learn, notes that it is loaded; without it every run warns.)
 */
export const profile = (writable: string[], openPorts: number[] = []) => `(version 1)
(allow default)
(deny network*)
(allow network-inbound (local ip "localhost:*"))
(allow network-bind (local ip "localhost:*"))
${openPorts.filter((p) => Number.isInteger(p) && p > 0 && p < 65536).map((p) => `(allow network-outbound (remote ip "localhost:${p}"))`).join('\n')}
(deny file-write*)
(allow file-write* ${writable.flatMap(bothForms).map((p) => `(subpath ${JSON.stringify(p)})`).join(' ')} (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty") (regex #"^/(private/)?tmp/__KMP_REGISTERED_LIB_[0-9_]+$"))
`

/** A port nothing is using now, for a server the program starts itself */
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(0))
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })

/** When a connection was refused by the sandbox, one line saying what can be reached, so the tutor does not guess */
export function networkNote(stderr: string, source: string): string {
  if (!/Operation not permitted|EPERM|PermissionError|Could not resolve host|nodename nor servname|ENOTFOUND|fetch failed|Failed to connect|Couldn't connect/i.test(stderr)) return ''
  if (!/socket|connect|http|fetch|urlopen|requests|aiohttp|curl|net\b|TcpStream|URLSession/i.test(source)) return ''
  return `${stderr.endsWith('\n') ? '' : '\n'}There is no internet in Tide's sandbox. A program can reach Tide's practice server (its address is in TIDE_HTTP) and a server it starts itself on 127.0.0.1 at the port in TIDE_PORT, and nothing else.\n`
}

const failed = (stderr: string): RunResult => ({ stdout: '', stderr, exitCode: 1, timedOut: false, durationMs: 0 })

export interface RunOptions {
  /**
   * Hidden tests for a code question. In Python, pytest-style test functions run against the code.
   * In any language, input and output cases as JSON, [{"stdin": "2 3", "expect": "5"}]: the
   * program is compiled once and run on each input, and its output is compared with the expected.
   */
  tests?: string
}

/** One input and output case of a hidden test */
export interface IoCase {
  name: string
  stdin: string
  expect: string
}

const MAX_CASES = 20

/** Input and output cases from a tests field, or null when it is not a JSON list of them */
export function parseCases(tests: string): IoCase[] | null {
  const text = tests.trim()
  if (!text.startsWith('[')) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(raw) || !raw.length) return null
  const out: IoCase[] = []
  for (const [i, c] of raw.slice(0, MAX_CASES).entries()) {
    if (!c || typeof c !== 'object') return null
    const o = c as Record<string, unknown>
    const expected = o.expect ?? o.expected ?? o.output ?? o.stdout
    if (expected === undefined || expected === null) return null
    const input = o.stdin ?? o.input ?? ''
    out.push({ name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `case ${i + 1}`, stdin: typeof input === 'string' ? input : String(input), expect: typeof expected === 'string' ? expected : JSON.stringify(expected) })
  }
  return out
}

/** Output as compared: line endings, spaces at the ends of lines and blank lines at the end don't count */
const normalOutput = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim()

/** Whether a case passed and, when not, why in a line or two */
export function judgeCase(c: IoCase, r: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }): string {
  if (r.timedOut) return 'timed out'
  const got = normalOutput(r.stdout)
  const want = normalOutput(c.expect)
  if (r.exitCode !== 0) return `stopped with exit code ${r.exitCode}${r.stderr.trim() ? `: ${r.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200)}` : ''}`
  if (got === want) return ''
  const shown = (s: string) => JSON.stringify(s.length > 200 ? `${s.slice(0, 200)}…` : s)
  return `input ${shown(c.stdin)}: expected ${shown(want)}, got ${shown(got)}`
}

export async function runCode(language: string, code: string, stdin = '', timeoutMs?: number, opts: RunOptions = {}): Promise<RunResult> {
  if (isSql(language)) return failed('SQL runs in the data lab, not here: use run_sql, or a ```sql block.')
  const lang = languageOf(language)
  if (!lang) return failed(`Running ${language} isn't supported yet. ${LANGUAGE_NAMES} are.`)
  const tests = opts.tests?.trim() ?? ''
  const cases = tests ? parseCases(tests) : null
  if (tests && !cases && lang.id !== 'python') return failed(`Hidden tests in ${lang.name} are input and output cases, as JSON: [{"name": "adds", "stdin": "2 3", "expect": "5"}]. (Test functions are for Python, run with pytest.)`)
  const pyTests = !!tests && !cases
  const tool = await toolFor(lang)
  if (!tool) return failed(missingText(lang))
  const scratch = await fs.mkdtemp(join(tmpdir(), 'tide-run-'))
  const work = join(scratch, 'work')
  await fs.mkdir(work)
  let entry = lang.entry
  if (pyTests) {
    // The answer is imported by the tests, which get its names without having to ask
    await fs.writeFile(join(work, 'answer.py'), code)
    await fs.writeFile(join(work, 'test_answer.py'), /^\s*(from answer import|import answer\b)/m.test(tests) ? tests : `from answer import *\n${tests}`)
  } else if (lang.prepare) {
    const made = await lang.prepare(code)
    entry = made.entry
    await fs.writeFile(join(work, entry), made.code)
  } else {
    await fs.writeFile(join(work, entry), code)
  }
  const limit = timeoutMs ?? (lang.id === 'python' && HEAVY_IMPORT.test(code) ? PROJECT_TIMEOUT_MS : TIMEOUT_MS)
  return execute({ lang, tool: tool.path, scratch, entry, stdin, timeoutMs: limit, source: code, tests: pyTests, ...(cases ? { cases } : {}) })
}

/**
 * Runs a file from your Code folder as part of its project: everything in the same folder (other
 * modules, CSV and JSON data) is copied into the sandbox first, so imports and relative paths
 * work. Writes stay in the sandbox and are thrown away afterwards.
 */
export async function runProject(entryAbs: string, stdin = ''): Promise<RunResult> {
  const ext = entryAbs.split('.').pop() ?? ''
  const lang = languageOf(ext)
  if (!lang) return failed(`Running .${ext} files isn't supported yet. ${LANGUAGE_NAMES} are; use the terminal for the rest.`)
  const tool = await toolFor(lang)
  if (!tool) return failed(missingText(lang))
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
  const source = await fs.readFile(entryAbs, 'utf8').catch(() => '')
  // A project's TypeScript is run by Node as it is, so its imports of other .ts files work
  return execute({ lang, tool: tool.path, scratch, entry: relative(root, entryAbs), stdin, timeoutMs: PROJECT_TIMEOUT_MS, source, tests: false })
}

interface Ran {
  stdout: string
  stderr: string
  exitCode: number
  signal: string | null
  timedOut: boolean
}

/** One command inside the sandbox, with its own time limit; everything it started is stopped with it */
function sandboxed(sb: string, cmd: string[], o: { cwd: string; env: Record<string, string>; stdin?: string; timeoutMs: number }): Promise<Ran> {
  return new Promise<Ran>((resolve) => {
    // Its own process group, so a timeout also stops what it started (a script's `sleep`, a compiler's linker)
    const child = spawn('/usr/bin/sandbox-exec', ['-f', sb, ...cmd], { cwd: o.cwd, env: o.env, detached: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const cap = (s: string, add: string) => (s.length > OUTPUT_LIMIT ? s : (s + add).slice(0, OUTPUT_LIMIT))
    const stopAll = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    child.stdout.on('data', (d) => (stdout = cap(stdout, d.toString())))
    child.stderr.on('data', (d) => (stderr = cap(stderr, d.toString())))
    const timer = setTimeout(() => {
      timedOut = true
      stopAll()
    }, o.timeoutMs)
    // Anything left running in the background would hold the output open
    child.on('exit', stopAll)
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: exitCode ?? -1, signal, timedOut })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: e.message, exitCode: -1, signal: null, timedOut: false })
    })
    child.stdin.on('error', () => {})
    if (o.stdin) child.stdin.write(o.stdin)
    child.stdin.end()
  })
}

/**
 * The practice web server for one run, in the same sandbox as the program. Started only when the
 * code names it (TIDE_HTTP, or the tide_http helper), so nothing else pays for it.
 */
async function startTeachServer(sb: string, scratch: string, env: Record<string, string>): Promise<{ url: string; stop(): void } | null> {
  const file = join(scratch, 'tide_server.py')
  await fs.writeFile(file, TEACH_SERVER)
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-f', sb, ...pythonCmd(), '-I', '-u', file], { cwd: scratch, env, stdio: ['pipe', 'pipe', 'ignore'] })
    const stop = () => {
      child.stdin.destroy()
      child.kill('SIGKILL')
    }
    let out = ''
    const give = (v: { url: string; stop(): void } | null) => {
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      stop()
      give(null)
    }, 5000)
    child.stdout.on('data', (d) => {
      out += d.toString()
      const port = /PORT (\d+)/.exec(out)?.[1]
      if (port) give({ url: `http://127.0.0.1:${port}`, stop })
    })
    child.on('error', () => give(null))
    child.on('close', () => give(null))
  })
}

interface Job {
  lang: Language
  /** The toolchain's binary, '' for the languages Tide brings itself */
  tool: string
  scratch: string
  entry: string
  stdin: string
  timeoutMs: number
  /** The program's text, to see what it asks for */
  source: string
  /** answer.py and test_answer.py are in place: run the tests instead of the program */
  tests: boolean
  /** Run the program once on each case's input, instead of once on stdin */
  cases?: IoCase[]
}

async function execute(job: Job): Promise<RunResult> {
  const { lang, scratch } = job
  const work = join(scratch, 'work')
  const site = join(scratch, 'site')
  const figures = join(scratch, 'figures')
  const testResult = join(scratch, 'tests.json')
  await fs.mkdir(site)
  await fs.mkdir(figures)
  await fs.writeFile(join(site, 'sitecustomize.py'), SITE_CUSTOMIZE)
  await fs.writeFile(join(site, 'tide_http.py'), TIDE_HTTP_HELPER)
  // The finance lab's helper and its market data, only for code that imports it
  if (usesFinanceHelper(job.source)) await writeFinanceHelper(site)
  if (job.tests) await fs.writeFile(join(site, '_tide_tests.py'), TEST_RUNNER)
  await fs.mkdir(mplConfig(), { recursive: true }).catch(() => {})
  if (lang.tool) await fs.mkdir(runCache(), { recursive: true }).catch(() => {})
  // The sandbox matches real paths, so resolve any links on the way
  const mpl = await fs.realpath(mplConfig()).catch(() => mplConfig())
  const cache = await fs.realpath(runCache()).catch(() => runCache())
  const sb = join(scratch, 'profile.sb')
  const writable = [scratch, mpl, cache, metalCache()]
  const lessonPort = await freePort()

  const c: RunContext = { tool: job.tool, entry: job.entry, cache, python: pythonCmd(), node: process.execPath }
  const env: Record<string, string> = {
    PATH: '/opt/homebrew/bin:/usr/bin:/bin',
    HOME: scratch,
    TMPDIR: scratch,
    LANG: 'en_US.UTF-8',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: site,
    MPLBACKEND: 'Agg',
    MPLCONFIGDIR: mpl,
    TIDE_FIGURES: figures,
    TIDE_TEST_RESULT: testResult,
    // Libraries that download or cache (PyTorch, Hugging Face) keep it in the throwaway folder
    XDG_CACHE_HOME: join(scratch, 'cache'),
    TORCH_HOME: join(scratch, 'cache', 'torch'),
    HF_HOME: join(scratch, 'cache', 'huggingface'),
    // The one port a server started by the program can be reached on
    ...(lessonPort ? { TIDE_PORT: String(lessonPort) } : {}),
    // A system proxy must not be asked for an address on this Mac
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
    ...lang.env?.(c)
  }
  const started = Date.now()
  const clean = pathCleaner(scratch, cache)
  const finish = async (r: Omit<RunResult, 'durationMs'>): Promise<RunResult> => {
    server?.stop()
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
    return { ...r, durationMs: Date.now() - started }
  }

  let serverNote = ''
  let server: { url: string; stop(): void } | null = null
  if (/TIDE_HTTP|tide_http/.test(job.source)) {
    // The server listens and connects to nothing, so its own profile opens no port
    const serverSb = join(scratch, 'server.sb')
    await fs.writeFile(serverSb, profile(writable))
    server = await startTeachServer(serverSb, scratch, env)
    if (server) env.TIDE_HTTP = server.url
    else serverNote = '\nTide’s practice server (TIDE_HTTP) could not start: it needs Python 3 on this Mac.'
  }

  await fs.writeFile(sb, profile(writable, [lessonPort, ...(server ? [Number(new URL(server.url).port)] : [])]))

  let warnings = ''
  if (lang.compile) {
    const built = await sandboxed(sb, lang.compile(c), { cwd: work, env, timeoutMs: COMPILE_TIMEOUT_MS })
    if (built.exitCode !== 0 || built.timedOut) return finish({ stdout: '', stderr: clean(built.stderr || built.stdout) + (built.timedOut ? '\nCompiling took too long and was stopped.' : ''), exitCode: built.exitCode || 1, timedOut: built.timedOut })
    warnings = built.stderr
  }

  if (job.cases) {
    const t: TestResults = { passed: [], failed: [] }
    let shown = ''
    for (const k of job.cases) {
      const r = await sandboxed(sb, lang.run(c), { cwd: work, env, stdin: k.stdin, timeoutMs: job.timeoutMs })
      const why = judgeCase(k, { ...r, stderr: clean(r.stderr) })
      if (why) {
        t.failed.push({ name: k.name, message: why })
        // What the first failing case printed to stderr is shown whole: a traceback is worth reading
        if (!shown && r.stderr.trim()) shown = clean(r.stderr)
      } else t.passed.push(k.name)
    }
    const stderr = clean(warnings) + shown
    return finish({ stdout: testSummary(t), stderr: lang.id === 'python' ? stderr + libraryNote(stderr) : stderr, exitCode: t.failed.length ? 1 : 0, timedOut: false, tests: t })
  }

  const ran = await sandboxed(sb, job.tests ? [...c.python, join(site, '_tide_tests.py')] : lang.run(c), { cwd: work, env, stdin: job.stdin, timeoutMs: job.timeoutMs })
  const images = await readFigures(figures)
  let stdout = ran.stdout
  let stderr = clean(warnings + ran.stderr)
  // Node names the file it ran, which for TypeScript is the one with its types blanked out
  if (lang.id === 'typescript') stderr = stderr.replace(/\bmain\.js\b/g, 'main.ts')
  if (ran.signal && !ran.timedOut) stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}(stopped by ${ran.signal})`
  let tests: TestResults | undefined
  if (job.tests) {
    const read = parseTestResult(await fs.readFile(testResult, 'utf8').catch(() => ''))
    if (read.error) stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}${clean(read.error)}`
    else if (!read.tests && !ran.timedOut) stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}The tests did not finish.`
    if (read.tests) {
      tests = read.tests
      stdout += `${stdout && !stdout.endsWith('\n') ? '\n' : ''}${testSummary(tests)}`
    }
  }
  if (lang.id === 'python') stderr += libraryNote(stderr)
  if (ran.exitCode !== 0 || /TIDE_HTTP|TIDE_PORT/.test(job.source)) stderr += networkNote(stderr, job.source)
  return finish({ stdout, stderr: stderr + serverNote, exitCode: ran.exitCode, timedOut: ran.timedOut, ...(images.length ? { images } : {}), ...(tests ? { tests } : {}) })
}

/** Takes this Mac's folders out of messages: the scratch folder goes, the home folder becomes ~ */
export function pathCleaner(scratch: string, cache: string, home = homedir()): (text: string) => string {
  const prefixes = [join(scratch, 'work'), scratch, cache]
    .flatMap(bothForms)
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/')
  const re = new RegExp(prefixes.join('|'), 'g')
  return (text) => text.replace(re, '').split(`${home}/`).join('~/')
}

/** What the test runner wrote, as results */
export function parseTestResult(raw: string): { tests?: TestResults; error?: string } {
  if (!raw.trim()) return {}
  try {
    const o = JSON.parse(raw) as { results?: { name: string; outcome: string; message?: string }[]; error?: string }
    if (o.error) return { error: o.error }
    const results = o.results ?? []
    return {
      tests: {
        passed: results.filter((r) => r.outcome === 'passed').map((r) => r.name),
        failed: results.filter((r) => r.outcome === 'failed').map((r) => ({ name: r.name, message: (r.message ?? '').slice(0, 600) }))
      }
    }
  } catch {
    return {}
  }
}

/** "2 of 3 tests passed", then each test on a line with why it failed */
export function testSummary(t: TestResults): string {
  const total = t.passed.length + t.failed.length
  if (!total) return 'No tests were found (a test is a function whose name starts with test_).'
  const lines = [`${t.passed.length} of ${total} test${total === 1 ? '' : 's'} passed`, ...t.passed.map((n) => `  passed  ${n}`), ...t.failed.map((f) => `  FAILED  ${f.name}${f.message ? `: ${f.message.split('\n').join('\n          ')}` : ''}`)]
  return lines.join('\n') + '\n'
}

/**
 * When a Python library is missing, one line saying which pack it comes in and where the learner
 * sets that up, so the tutor can pass it on instead of guessing.
 */
export function libraryNote(stderr: string): string {
  const name = /ModuleNotFoundError: No module named '([\w.]+)'/.exec(stderr)?.[1]?.split('.')[0]
  if (!name) return ''
  const line = (text: string) => `${stderr.endsWith('\n') ? '' : '\n'}${text}\n`
  if (LAB_PACK.modules.includes(name)) return line(`${name} is in Tide's lab pack (${LAB_PACK.contents}), which isn't installed. The learner can add it in ${LAB_PACK.where} (${LAB_PACK.size}); until then this code cannot run here.`)
  if (name === 'sympy') return line("SymPy isn't installed. The learner can add it in Settings › Tools › Maths checker.")
  if (PYTHON_LIBRARIES.includes(name)) return line(`${name} isn't installed. The learner can add it in Settings › Tools › Data libraries.`)
  return line(`${name} isn't available in Tide's Python: the standard library, the data libraries (${PYTHON_LIBRARIES.join(', ')}) and the lab pack (${LAB_PACK.contents}) are all it can have.`)
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

type Status = { ready: boolean; detail: string }

/** A command outside the sandbox (python -m venv, pip), its output handed over line by line */
function spawnLines(cmd: string, args: string[], onLine?: (line: string) => void): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin' } })
    let err = ''
    let rest = ''
    c.stdout.on('data', (d) => {
      const lines = (rest + d.toString()).split('\n')
      rest = lines.pop() ?? ''
      for (const l of lines) onLine?.(l)
    })
    c.stderr.on('data', (d) => (err += d.toString()))
    c.on('close', (code) => resolve({ code: code ?? -1, err }))
    c.on('error', (e) => resolve({ code: -1, err: e.message }))
  })
}

/**
 * The Python a new environment is made from: the newest one installed rather than whichever comes
 * first on the PATH, which on a Mac is Apple's old 3.9 (too old for current PyTorch and the rest).
 */
export function basePython(): string {
  const found = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'].filter((p) => existsSync(p))
  return found[0] ?? 'python3'
}

/** Creates Tide's own Python environment with SymPy, so the system Python is never touched */
export async function setupMath(packages = ['sympy']): Promise<Status> {
  const dir = join(app.getPath('userData'), 'python')
  if (!existsSync(mathPython())) {
    const v = await spawnLines(basePython(), ['-m', 'venv', dir])
    if (v.code !== 0) return { ready: false, detail: `Couldn't create a Python environment: ${v.err.slice(0, 200) || 'is Python 3 installed?'}` }
  }
  const p = await spawnLines(join(dir, 'bin', 'pip'), ['install', '--quiet', ...packages])
  if (p.code !== 0) return { ready: false, detail: `Couldn't install ${packages.join(', ')}: ${p.err.slice(0, 200)}` }
  return mathStatus()
}

const LAB_NAMES: Record<string, string> = { torch: 'PyTorch', 'scikit-learn': 'scikit-learn', scipy: 'SciPy', pytest: 'pytest' }

/** Whether the lab pack is in Tide's Python: asked of the package records, so nothing heavy is imported */
export async function labStatus(): Promise<Status> {
  if (!existsSync(mathPython())) return { ready: false, detail: `Not set up yet: ${LAB_PACK.download} to download, ${LAB_PACK.size} on disk` }
  const code = `from importlib.metadata import version, PackageNotFoundError
for p in ${JSON.stringify(LAB_PACK.packages)}:
    try:
        print(p, version(p))
    except PackageNotFoundError:
        print(p, "-")
`
  const r = await runCode('python', code, '', 30_000)
  if (r.exitCode !== 0) return { ready: false, detail: r.stderr.trim().slice(-200) || 'Tide’s Python did not answer' }
  return labStatusOf(r.stdout)
}

/** Reads "name version" lines ("-" for one that is missing) into a status */
export function labStatusOf(out: string): Status {
  const have = new Map(out.trim().split('\n').map((l) => l.trim().split(/\s+/) as [string, string]))
  const missing = LAB_PACK.packages.filter((p) => !have.get(p) || have.get(p) === '-')
  if (missing.length === LAB_PACK.packages.length) return { ready: false, detail: `Not installed yet: ${LAB_PACK.download} to download, ${LAB_PACK.size} on disk` }
  if (missing.length) return { ready: false, detail: `Not finished: ${missing.join(', ')} still to install` }
  return { ready: true, detail: `${Object.keys(LAB_NAMES).map((p) => `${LAB_NAMES[p]} ${have.get(p)}`).join(', ')}, and tqdm, requests, httpx, aiohttp` }
}

/** What pip's output says is happening, in words for the Settings row; '' for a line worth nothing */
export function pipProgress(line: string): string {
  const l = line.trim()
  if (/\.metadata \(/.test(l)) return ''
  const got = /^Downloading (?:.*\/)?([A-Za-z0-9_.]+?)-\d[^ ]* \(([^)]+)\)/.exec(l)
  if (got) return `Downloading ${got[1].replace(/_/g, '-')} (${got[2]})…`
  const finding = /^Collecting ([A-Za-z0-9_.-]+)/.exec(l)
  if (finding) return `Finding ${finding[1]}…`
  if (/^Installing collected packages/.test(l)) return 'Installing (PyTorch takes a minute)…'
  if (/^Successfully installed/.test(l)) return 'Installed. Checking it…'
  return ''
}

/** Why pip failed, in a sentence the learner can act on */
export function pipFailure(err: string): string {
  const errors = err.split('\n').filter((l) => /^ERROR:/.test(l.trim()))
  const last = (errors[errors.length - 1] ?? err.trim().split('\n').pop() ?? '').replace(/^\s*ERROR:\s*/, '').trim()
  if (/No space left|Errno 28/i.test(err)) return `Couldn't install the lab pack: the disk is full. It needs ${LAB_PACK.size}.`
  if (/No matching distribution|Could not find a version/i.test(err) && !/connection|retry|resolve/i.test(err)) return `Couldn't install the lab pack: ${last.slice(0, 160)}. This Python may be too new or too old for one of its libraries.`
  if (/connection|timed out|Temporary failure|Max retries|name resolution|nodename|Network is unreachable|SSL/i.test(err)) return "Couldn't download the lab pack: check the internet connection and try again. What was already installed is kept."
  return `Couldn't install the lab pack: ${last.slice(0, 200) || 'pip stopped without saying why'}`
}

export interface LabInstaller {
  /** The environment's python, and the folder the environment lives in */
  python: string
  dir: string
  exists(path: string): boolean
  run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<{ code: number; err: string }>
  status(): Promise<Status>
  /** Free space where the environment lives, or null when it can't be told */
  freeBytes(): Promise<number | null>
}

/**
 * Installs the lab pack with pip. Safe to run again: when everything is there nothing is run, and
 * after a failure the libraries that did install are kept and only the rest are fetched.
 */
export async function installLab(d: LabInstaller, onProgress: (step: string) => void = () => {}): Promise<Status> {
  const before = await d.status()
  if (before.ready) return before
  const free = await d.freeBytes()
  if (free !== null && free < LAB_PACK.needsBytes) return { ready: false, detail: `Not enough free space: the lab pack takes ${LAB_PACK.size}, and this Mac has ${(free / 1e9).toFixed(1)} GB free.` }
  if (!d.exists(d.python)) {
    onProgress('Creating Tide’s Python environment…')
    const v = await d.run(basePython(), ['-m', 'venv', d.dir])
    if (v.code !== 0) return { ready: false, detail: `Couldn't create a Python environment: ${v.err.slice(0, 200) || 'is Python 3 installed?'}` }
  }
  onProgress(`Downloading the lab pack (${LAB_PACK.download}, ${LAB_PACK.size} on disk)…`)
  const p = await d.run(d.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', ...LAB_PACK.packages], (line) => {
    const step = pipProgress(line)
    if (step) onProgress(step)
  })
  if (p.code !== 0) return { ready: false, detail: pipFailure(p.err) }
  // Loading each library once proves it works on this Mac, and the first lesson to use one does not wait for it
  onProgress('Loading it for the first time…')
  const loaded = await d.run(d.python, ['-c', `import ${LAB_PACK.modules.join(', ')}`])
  if (loaded.code !== 0) return { ready: false, detail: `Installed, but it did not load: ${loaded.err.trim().split('\n').pop()?.slice(0, 200) ?? ''}` }
  const after = await d.status()
  return after.ready ? after : { ready: false, detail: `Installed, but it did not load: ${after.detail}` }
}

let labInstall: Promise<Status> | null = null

/**
 * Adds the lab pack (PyTorch, scikit-learn, SciPy, pytest and the HTTP helpers, about 900 MB) to
 * Tide's Python, for lessons and the tutor's run_code. One install at a time: a second press of
 * the button waits for the first.
 */
export function setupLab(onProgress?: (step: string) => void): Promise<Status> {
  if (labInstall) return labInstall
  const dir = join(app.getPath('userData'), 'python')
  labInstall = installLab(
    {
      python: mathPython(),
      dir,
      exists: existsSync,
      run: spawnLines,
      status: labStatus,
      freeBytes: () => fs.statfs(app.getPath('userData')).then((s) => s.bavail * s.bsize, () => null)
    },
    onProgress
  ).finally(() => {
    labInstall = null
  })
  return labInstall
}
