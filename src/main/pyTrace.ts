/**
 * Real Python traces for visuals: a short snippet (a visual's <script type="text/x-python">, or a
 * shipped one) is run once under sys.settrace in the same sandbox as Tide's code runs (no writes
 * outside a throwaway folder, no network), within a few seconds and a few hundred steps, and what
 * memory held at each step comes back for the frame to replay (TideMachine.python). The tracer is
 * pyTrace.py; the trace's shape is shared/pyTrace.
 *
 * The Python lab (shared/pyLab) traces a longer program one bytecode instruction at a time:
 * traceLab, with the tracer's "ops" mode.
 */
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cleanTrace, MAX_LAB_SOURCE, MAX_LAB_STEPS, MAX_TRACE_SOURCE, type PyTrace } from '@shared/pyTrace'
import TRACER from './pyTrace.py?raw'

type Traced = { trace?: PyTrace; error?: string }

/** The same snippet traced again within a session: the first trace (snippets are pure, and the ids are what they were) */
const done = new Map<string, Promise<Traced>>()

export function traceSnippet(code: unknown): Promise<Traced> {
  return traced(code, false)
}

/** A program for the Python lab: a step before each bytecode instruction, with each code object disassembled */
export function traceLab(code: unknown): Promise<Traced> {
  return traced(code, true)
}

function traced(code: unknown, ops: boolean): Promise<Traced> {
  const src = typeof code === 'string' ? code.replace(/\r\n?/g, '\n').replace(/\s+$/, '') : ''
  const max = ops ? MAX_LAB_SOURCE : MAX_TRACE_SOURCE
  if (!src.trim()) return Promise.resolve({ error: 'There is no Python to trace.' })
  if (src.length > max) return Promise.resolve({ error: `A traced ${ops ? 'program' : 'snippet'} is at most ${max} characters.` })
  const key = `${ops ? 'ops' : 'lines'}\n${src}`
  let p = done.get(key)
  if (!p) {
    p = run(ops ? src : src.trim(), ops)
    done.set(key, p)
    if (done.size > 40) done.delete(done.keys().next().value!)
    // A failure (no Python yet) may be fixed later
    void p.then((r) => r.error && !r.trace && done.delete(key))
  }
  return p
}

async function run(src: string, ops: boolean): Promise<Traced> {
  const TIMEOUT_MS = ops ? 10_000 : 6000
  const { sandboxed, profile, pythonCmd } = await import('./runner')
  const scratch = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'tide-trace-')))
  try {
    await fs.writeFile(join(scratch, 'tracer.py'), TRACER)
    await fs.writeFile(join(scratch, 'snippet.py'), src)
    const sb = join(scratch, 'profile.sb')
    await fs.writeFile(sb, profile([scratch]))
    const env = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, LANG: 'en_US.UTF-8', PYTHONDONTWRITEBYTECODE: '1' }
    const r = await sandboxed(sb, [...pythonCmd(), '-I', join(scratch, 'tracer.py'), join(scratch, 'snippet.py'), join(scratch, 'trace.json'), ...(ops ? ['ops'] : [])], { cwd: scratch, env, timeoutMs: TIMEOUT_MS })
    if (r.timedOut) return { error: `Tracing took longer than ${TIMEOUT_MS / 1000} s and was stopped.` }
    const raw = await fs.readFile(join(scratch, 'trace.json'), 'utf8').catch(() => '')
    if (!raw) return { error: (r.stderr || 'The tracer did not run (is Python 3 on this Mac?)').trim().split('\n').slice(-2).join(' ').slice(0, 300) }
    const trace = cleanTrace(JSON.parse(raw), ops ? MAX_LAB_STEPS : undefined)
    return trace ? { trace } : { error: 'The trace was unreadable.' }
  } catch (e) {
    return { error: `Tracing failed: ${(e as Error).message}`.slice(0, 300) }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}
