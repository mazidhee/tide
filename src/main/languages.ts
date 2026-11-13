import { execFile } from 'child_process'
import { existsSync } from 'fs'
import * as nodeModule from 'module'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Every language the runner can run, as data: its file, how it is compiled and run, and how its
 * toolchain is found on this Mac. Adding one is an entry in LANGUAGES. Nothing here is installed by
 * Tide: a language runs when its toolchain is already on the Mac, and says what to install when not.
 */

export interface Toolchain {
  /** Where the binary may be (~ is the home folder); the first that answers its version probe wins */
  paths: string[]
  /** Paths only known at run time (Tide's tools folder), looked at before `paths` */
  locate?(): string[]
  /** Arguments that print the version, proving it is really there (macOS ships empty stand-ins) */
  version: string[]
  /** A command that must succeed before anything is probed: Apple's stand-ins open an install dialog when run without the tools */
  guard?: string[]
  /**
   * A command that prints the folder holding the real binary at `bin`: a JDK's home, rustc's sysroot.
   * With {tool} in it, it is asked of each path found (rustup's proxy needs the real HOME, the
   * sandbox has another); without, it is asked once and its answer is tried first.
   */
  home?: { cmd: string[]; bin: string }
  /** What the learner is told to do when it is missing */
  install: string
}

export interface RunContext {
  /** The toolchain's binary */
  tool: string
  /** The source file, relative to the working folder */
  entry: string
  /** For a C or C++ project: every source file to compile and link (the entry among them), and flags from its compile_flags.txt */
  sources?: string[]
  flags?: string[]
  /** A folder that outlives the run, for compiler caches */
  cache: string
  /** Tide's Python, as a command */
  python: string[]
  /** The Node that Tide itself runs on */
  node: string
}

export interface Language {
  id: string
  name: string
  /** Other names and file extensions it answers to */
  aliases: string[]
  entry: string
  tool?: Toolchain
  compile?(c: RunContext): string[]
  run(c: RunContext): string[]
  env?(c: RunContext): Record<string, string>
  /** Rewrites a snippet before it is written: TypeScript loses its types here */
  prepare?(code: string): Promise<{ code: string; entry: string }>
}

const APPLE_TOOLS = 'Apple’s command line tools. Install them with: xcode-select --install'
const XCODE = ['/usr/bin/xcode-select', '-p']
const clang = (compiler: string, std: string, entry: string): Language['compile'] => (c) => [compiler, std, '-Wall', '-Wextra', '-g', '-fsanitize=undefined,bounds', '-fno-omit-frame-pointer', ...(c.flags ?? []), '-o', 'prog', ...(c.sources?.length ? c.sources : [c.entry || entry])]

/** Tide's tools folder, where the track packs install (main/packs/paths sets it; this file stays free of Electron) */
let toolsDir: () => string = () => process.env.TIDE_TOOLS_DIR ?? ''
export const setToolsDir = (f: () => string) => {
  toolsDir = f
}
const FOUNDRY = 'the Foundry pack (forge and the Solidity compiler). Add it in Settings › Tools › Foundry pack'

export const LANGUAGES: Language[] = [
  { id: 'python', name: 'Python', aliases: ['py', 'python3'], entry: 'main.py', run: (c) => [...c.python, c.entry] },
  { id: 'javascript', name: 'JavaScript', aliases: ['js', 'node', 'mjs'], entry: 'main.js', run: (c) => [c.node, c.entry], env: () => ({ ELECTRON_RUN_AS_NODE: '1' }) },
  { id: 'typescript', name: 'TypeScript', aliases: ['ts'], entry: 'main.ts', prepare: stripTypes, run: (c) => [c.node, c.entry], env: () => ({ ELECTRON_RUN_AS_NODE: '1' }) },
  /**
   * C and C++ are compiled with the Mac's own clang. Warnings are on and the undefined-behaviour
   * checker is built in, so the mistakes a learner makes (reading past an array, overflowing a
   * signed int, using a null pointer) are reported with their line instead of passing silently,
   * which is most of what there is to learn about C.
   */
  { id: 'c', name: 'C', aliases: [], entry: 'main.c', tool: { paths: ['/usr/bin/clang'], guard: XCODE, version: ['--version'], install: APPLE_TOOLS }, compile: clang('/usr/bin/clang', '-std=c17', 'main.c'), run: () => ['./prog'] },
  { id: 'cpp', name: 'C++', aliases: ['c++', 'cc', 'cxx'], entry: 'main.cpp', tool: { paths: ['/usr/bin/clang++'], guard: XCODE, version: ['--version'], install: APPLE_TOOLS }, compile: clang('/usr/bin/clang++', '-std=c++20', 'main.cpp'), run: () => ['./prog'] },
  {
    id: 'rust',
    name: 'Rust',
    aliases: ['rs'],
    entry: 'main.rs',
    tool: { paths: ['~/.cargo/bin/rustc', '/opt/homebrew/bin/rustc', '/usr/local/bin/rustc'], home: { cmd: ['{tool}', '--print', 'sysroot'], bin: 'bin/rustc' }, version: ['--version'], install: 'Rust. Install it from https://rustup.rs, or with: brew install rust' },
    // Unoptimised on purpose: integer overflow and out-of-range indexing panic with their line
    compile: (c) => [c.tool, '--edition', '2021', '-g', '-o', 'prog', c.entry],
    run: () => ['./prog']
  },
  {
    id: 'go',
    name: 'Go',
    aliases: ['golang'],
    entry: 'main.go',
    tool: { paths: ['/opt/homebrew/bin/go', '/usr/local/go/bin/go', '/usr/local/bin/go'], version: ['version'], install: 'Go. Install it with: brew install go' },
    compile: (c) => [c.tool, 'build', '-o', 'prog', c.entry],
    run: () => ['./prog'],
    // The build cache is kept between runs (the standard library is compiled once); nothing is fetched
    env: (c) => ({ GOCACHE: join(c.cache, 'go-build'), GOPATH: join(c.cache, 'go'), GOPROXY: 'off', GOTOOLCHAIN: 'local', GOFLAGS: '-mod=mod', GOTELEMETRY: 'off' })
  },
  {
    id: 'swift',
    name: 'Swift',
    aliases: [],
    entry: 'main.swift',
    tool: { paths: ['/usr/bin/swiftc'], guard: XCODE, version: ['--version'], install: APPLE_TOOLS },
    compile: (c) => [c.tool, '-module-cache-path', join(c.cache, 'swift'), '-o', 'prog', c.entry],
    run: () => ['./prog']
  },
  {
    id: 'java',
    name: 'Java',
    aliases: [],
    entry: 'Main.java',
    // Not /usr/bin/java: without a JDK it is a stand-in that opens a dialog
    tool: { paths: ['/opt/homebrew/opt/openjdk/bin/java', '/usr/local/opt/openjdk/bin/java'], home: { cmd: ['/usr/libexec/java_home'], bin: 'bin/java' }, version: ['-version'], install: 'a JDK. Install one with: brew install openjdk' },
    // One file, compiled in memory and run (JDK 11 and later)
    run: (c) => [c.tool, '-XX:-UsePerfData', c.entry]
  },
  /**
   * Solidity runs through Foundry from the Foundry pack (main/packs/foundry): a snippet is tested,
   * run as a script or compiled in a scratch Foundry project, in the sandbox, with no network.
   */
  { id: 'solidity', name: 'Solidity', aliases: ['sol'], entry: 'Main.sol', tool: { paths: [], locate: () => (toolsDir() ? [join(toolsDir(), 'foundry', 'bin', 'forge')] : []), version: ['--version'], install: FOUNDRY }, run: (c) => [c.tool, 'test'] },
  { id: 'ruby', name: 'Ruby', aliases: ['rb'], entry: 'main.rb', tool: { paths: ['/opt/homebrew/opt/ruby/bin/ruby', '/usr/local/opt/ruby/bin/ruby', '/usr/bin/ruby'], version: ['--version'], install: 'Ruby. Install it with: brew install ruby' }, run: (c) => [c.tool, c.entry] },
  { id: 'bash', name: 'Bash', aliases: ['sh', 'shell'], entry: 'main.sh', tool: { paths: ['/bin/bash'], version: ['--version'], install: 'Bash at /bin/bash' }, run: (c) => [c.tool, c.entry] },
  { id: 'zsh', name: 'zsh', aliases: [], entry: 'main.zsh', tool: { paths: ['/bin/zsh'], version: ['--version'], install: 'zsh at /bin/zsh' }, run: (c) => [c.tool, c.entry] }
]

/** SQL is not run here: it goes to the lesson's data lab (run_sql) */
export const isSql = (language: string) => ['sql', 'sqlite', 'sqlite3'].includes(language.toLowerCase().trim())

export function languageOf(language: string): Language | null {
  const lang = language.toLowerCase().trim().replace(/^\./, '')
  return LANGUAGES.find((l) => l.id === lang || l.aliases.includes(lang)) ?? null
}

/** "Python, JavaScript, … and zsh", for messages */
export const LANGUAGE_NAMES = LANGUAGES.map((l) => l.name)
  .join(', ')
  .replace(/, ([^,]*)$/, ' and $1')

export interface Found {
  path: string
  /** The first line the version probe printed */
  version: string
}

export interface Probe {
  exists(path: string): boolean
  /** What the command printed, or null when it failed */
  run(cmd: string[]): Promise<string | null>
}

const realProbe: Probe = {
  exists: existsSync,
  run: (cmd) =>
    new Promise((resolve) => {
      execFile(cmd[0], cmd.slice(1), { timeout: 8000, env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/usr/bin:/bin` } }, (err, stdout, stderr) => resolve(err ? null : (stdout || stderr).trim()))
    })
}

/** Finds a toolchain: the first candidate that exists and answers its version probe */
export async function detect(t: Toolchain, probe: Probe = realProbe, home = homedir()): Promise<Found | null> {
  if (t.guard && (await probe.run(t.guard)) === null) return null
  const candidates = [...(t.locate?.() ?? []), ...t.paths].map((p) => p.replace(/^~(?=\/)/, home))
  const perTool = !!t.home?.cmd.includes('{tool}')
  if (t.home && !perTool) {
    const dir = await probe.run(t.home.cmd)
    if (dir) candidates.unshift(join(dir.split('\n')[0], t.home.bin))
  }
  for (const path of candidates) {
    if (!probe.exists(path)) continue
    let tool = path
    if (t.home && perTool) {
      const dir = await probe.run(t.home.cmd.map((a) => (a === '{tool}' ? path : a)))
      const real = dir ? join(dir.split('\n')[0], t.home.bin) : ''
      if (real && probe.exists(real)) tool = real
    }
    const version = await probe.run([tool, ...t.version])
    if (version !== null) return { path: tool, version: version.split('\n')[0].trim() }
  }
  return null
}

const found = new Map<string, Found>()

/**
 * The toolchain for a language, looked for when it is asked for: one found earlier is reused while
 * its binary is still there, one that was missing is looked for again, so installing a language
 * works without restarting Tide.
 */
export async function toolFor(lang: Language): Promise<Found | null> {
  if (!lang.tool) return { path: '', version: '' }
  const known = found.get(lang.id)
  if (known && existsSync(known.path)) return known
  const f = await detect(lang.tool)
  if (f) found.set(lang.id, f)
  else found.delete(lang.id)
  return f
}

/** One line for a language that cannot run here yet */
export const missingText = (lang: Language) => `${lang.name} isn't installed on this Mac, so it was not run. It needs ${lang.tool?.install ?? 'its toolchain'}`

/** "1.99.1" from a version line */
export const versionNumber = (line: string) => line.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? ''

export interface LanguageState {
  id: string
  name: string
  ready: boolean
  version: string
  install: string
}

export async function languageStates(): Promise<LanguageState[]> {
  return Promise.all(
    LANGUAGES.map(async (l) => {
      const f = await toolFor(l)
      return { id: l.id, name: l.name, ready: !!f, version: f ? versionNumber(f.version) : '', install: l.tool?.install ?? '' }
    })
  )
}

/** What Settings and the Connections page show: which languages run, and what the others need */
export async function languagesStatus(): Promise<{ ready: boolean; detail: string }> {
  const all = await languageStates()
  const ready = all.filter((l) => l.ready).map((l) => l.name)
  const missing = all.filter((l) => !l.ready).map((l) => `${l.name} needs ${l.install}`)
  return { ready: true, detail: `${ready.join(', ')} run here.${missing.length ? ` ${missing.join('. ')}.` : ''}` }
}

/**
 * TypeScript to JavaScript with what Node already has: types are blanked out in place, so line and
 * column numbers in errors still match what was written. Syntax that needs rewriting (an enum) is
 * transformed instead. Code that will not parse is handed to Node as it is, which reports the
 * error with its line.
 */
export async function stripTypes(code: string): Promise<{ code: string; entry: string }> {
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (code: string, o: { mode: 'strip' | 'transform' }) => string }).stripTypeScriptTypes
  if (strip) {
    for (const mode of ['strip', 'transform'] as const) {
      try {
        return { code: strip(code, { mode }), entry: 'main.js' }
      } catch (e) {
        if ((e as { code?: string }).code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') break
      }
    }
    return { code, entry: 'main.ts' }
  }
  try {
    // An older Node: the TypeScript compiler, when it is beside Tide (it is in development)
    const name = 'typescript'
    const ts = (await import(/* @vite-ignore */ name)) as { transpileModule(code: string, o: { compilerOptions: Record<string, unknown> }): { outputText: string } }
    return { code: ts.transpileModule(code, { compilerOptions: { target: 'es2022', module: 'esnext', removeComments: false } }).outputText, entry: 'main.js' }
  } catch {
    return { code, entry: 'main.ts' }
  }
}
