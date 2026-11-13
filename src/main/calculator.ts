/**
 * The maths answer box's exact side: one SymPy process (shared/calcPython) kept running in Tide's
 * sandbox, no network and nowhere to write but its own folder, so after the first call (SymPy's
 * import, about a second) an exact answer or a step check takes milliseconds. Started on first
 * use, stopped after a few idle minutes, and started again if a request runs too long (an integral
 * SymPy can't finish). Works offline and without any model.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { CALC_WORKER } from '@shared/calcPython'
import { CalcError, lineToSympy, parseLatex, type Angle } from '@shared/calc'
import type { CalcResult, StepCheck } from '@shared/mathsAnswer'

const IDLE_MS = 5 * 60_000
const EVAL_MS = 10_000
const CHAIN_MS = 30_000

interface Worker {
  child: ChildProcessWithoutNullStreams
  ready: Promise<{ ready: boolean; error?: string }>
  pending: Map<number, (r: Record<string, unknown>) => void>
  dir: string
}

let worker: Worker | null = null
let starting: Promise<Worker> | null = null
let nextId = 1
let idle: ReturnType<typeof setTimeout> | null = null

function stop() {
  const w = worker
  worker = null
  if (!w) return
  try {
    w.child.kill('SIGKILL')
  } catch {
    // already gone
  }
  for (const done of w.pending.values()) done({ ok: false, error: 'stopped' })
  void fs.rm(w.dir, { recursive: true, force: true }).catch(() => {})
}

async function start(): Promise<Worker> {
  const [{ profile, pythonCmd }] = await Promise.all([import('./runner')])
  const dir = await fs.mkdtemp(join(tmpdir(), 'tide-calc-'))
  const real = await fs.realpath(dir).catch(() => dir)
  const script = join(real, 'calc.py')
  const sb = join(real, 'calc.sb')
  await fs.writeFile(script, CALC_WORKER)
  await fs.writeFile(sb, profile([real]))
  const child = spawn('/usr/bin/sandbox-exec', ['-f', sb, ...pythonCmd(), '-I', '-u', script], {
    cwd: real,
    env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: real, TMPDIR: real, LANG: 'en_US.UTF-8', PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map<number, (r: Record<string, unknown>) => void>()
  let readyFn: (r: { ready: boolean; error?: string }) => void = () => {}
  const ready = new Promise<{ ready: boolean; error?: string }>((r) => (readyFn = r))
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let j: Record<string, unknown>
    try {
      j = JSON.parse(line)
    } catch {
      return
    }
    if ('ready' in j) return readyFn({ ready: !!j.ready, error: j.error as string | undefined })
    const done = pending.get(Number(j.id))
    if (done) {
      pending.delete(Number(j.id))
      done(j)
    }
  })
  child.stderr.on('data', () => {})
  child.on('error', () => readyFn({ ready: false, error: 'Python didn’t start' }))
  child.on('exit', () => {
    readyFn({ ready: false, error: 'Python stopped' })
    if (worker?.child === child) stop()
  })
  child.stdin.on('error', () => {})
  return { child, ready, pending, dir: real }
}

async function ensure(): Promise<Worker> {
  if (worker) return worker
  starting ??= start().then((w) => {
    worker = w
    starting = null
    return w
  })
  return starting
}

async function ask(req: Record<string, unknown>, ms: number): Promise<Record<string, unknown>> {
  const w = await ensure()
  const r = await Promise.race([w.ready, new Promise<{ ready: boolean; error?: string }>((res) => setTimeout(() => res({ ready: false, error: 'SymPy took too long to start' }), 20_000))])
  if (!r.ready) {
    stop()
    return { ok: false, error: /sympy/i.test(r.error ?? '') ? 'SymPy isn’t installed. Add it in Settings › Tools › Maths checker.' : (r.error ?? 'Python isn’t ready') }
  }
  if (idle) clearTimeout(idle)
  idle = setTimeout(stop, IDLE_MS)
  const id = nextId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      w.pending.delete(id)
      // Stuck on something SymPy can't finish: start afresh for the next request
      stop()
      resolve({ ok: false, error: 'That took SymPy too long', slow: true })
    }, ms)
    w.pending.set(id, (j) => {
      clearTimeout(timer)
      resolve(j)
    })
    w.child.stdin.write(JSON.stringify({ ...req, id }) + '\n')
  })
}

/** The exact value (and a decimal) of what the learner typed, in LaTeX */
export async function evaluate(latex: string, angle: Angle = 'rad'): Promise<CalcResult> {
  let line
  try {
    line = lineToSympy(parseLatex(latex), angle)
  } catch (e) {
    return { ok: false, error: e instanceof CalcError ? e.message : 'Tide couldn’t read that' }
  }
  if (line.parts[0] === null) return { ok: false, error: 'Start with a value, not "="' }
  const r = await ask({ op: 'eval', parts: line.parts, ops: line.ops }, EVAL_MS)
  if (!r.ok) return { ok: false, error: friendly(String(r.error ?? '')) }
  return { ok: true, kind: r.kind as CalcResult['kind'], exact: (r.exact as string | null) ?? null, numeric: (r.numeric as string | null) ?? null, ...(r.unchanged ? { unchanged: true } : {}) }
}

/** Each step of a working against the one before: equal, provably not, or can't tell */
export async function checkSteps(latexLines: string[], angle: Angle = 'rad'): Promise<StepCheck[] | null> {
  const lines = latexLines.map((l) => {
    try {
      return lineToSympy(parseLatex(l), angle)
    } catch {
      return { parts: [], ops: [] }
    }
  })
  if (!lines.some((l) => l.parts.length)) return latexLines.map(() => ({ status: 'unknown' as const, why: '' }))
  const r = await ask({ op: 'chain', lines }, CHAIN_MS)
  if (!r.ok || !Array.isArray(r.steps)) return null
  return (r.steps as StepCheck[]).map((s) => ({ status: s.status === 'ok' || s.status === 'bad' ? s.status : 'unknown', why: String(s.why ?? '') }))
}

function friendly(e: string): string {
  if (/SymPy isn/.test(e) || /too long/.test(e)) return e
  if (/ZeroDivision|zoo|division by zero/i.test(e)) return 'That divides by zero'
  if (/NonSquareMatrix|ShapeError|dimension/i.test(e)) return 'Those matrices don’t fit together'
  if (/NotInvertible|singular/i.test(e)) return 'That matrix has no inverse'
  if (/NotImplemented/i.test(e)) return 'SymPy can’t solve that one exactly'
  return 'SymPy couldn’t work that out'
}

/** For quitting */
export const stopCalculator = stop
