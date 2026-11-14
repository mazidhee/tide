/**
 * A Python trace for a visual (main/pyTrace runs it, TideMachine.python replays it). A visual asks
 * for one by holding the snippet in a <script type="text/x-python">: Tide traces it before the
 * frame starts and puts the trace in front of the visual's code as window.TIDE_TRACE, so the frame
 * still needs nothing from outside. Pure: shared by main, the window and the tests.
 */

/** One object as it was at a step; refs are ids ("0x…") */
export interface PyObject {
  id: string
  /** Type name: int, str, list, dict, function, or a class's name */
  t: string
  /** Its value, for atoms (repr, cut short) and functions (their name) */
  v?: string
  /** Items of a list, tuple or set; [key, value] pairs of a dict */
  items?: (string | [string, string])[]
  /** An instance's attributes */
  attrs?: [string, string][]
  /** Items not shown */
  more?: number
  /** A list's allocated slots */
  cap?: number
  /** An int's magnitude in CPython's base-2^30 digits, least significant first */
  d?: number[]
  neg?: boolean
  /** sys.getsizeof */
  sz?: number
}

export interface PyFrame {
  name: string
  line: number
  names: [string, string][]
}

export interface PyStep {
  line: number
  event: 'line' | 'return' | 'exception'
  frames: PyFrame[]
  /** Indexes into the trace's objects: what was reachable at this step */
  heap: number[]
  /** What it had printed so far */
  out: string
  /** The value a function returns (event return) */
  ret?: string
  exc?: string
}

export interface PyTrace {
  code: string
  ok: boolean
  steps: PyStep[]
  objects: PyObject[]
  error?: string
  stopped?: string
}

export const MAX_TRACE_SOURCE = 2000
/** The trace as it goes into the frame, in characters of JSON */
export const MAX_TRACE_JSON = 90_000

const PY_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?text\/x-python["']?[^>]*>([\s\S]*?)<\/script>/i

/** The snippet a visual wants traced, or null */
export function traceSourceOf(code: string): string | null {
  const m = PY_SCRIPT.exec(code)
  if (!m) return null
  const src = dedent(m[1].replace(/\r\n?/g, '\n')).trim()
  return src || null
}

/** Removes the indent every line shares (a snippet indented inside its tag) */
export function dedent(s: string): string {
  const lines = s.split('\n')
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length)
  const cut = indents.length ? Math.min(...indents) : 0
  return cut ? lines.map((l) => l.slice(cut)).join('\n') : s
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const isRef = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{1,16}$/.test(v)

/** A trace as the tracer wrote it, checked field by field; null when it isn't one */
export function cleanTrace(raw: unknown): PyTrace | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.steps) || !Array.isArray(o.objects)) return null
  const objects: PyObject[] = []
  for (const x of o.objects.slice(0, 4000)) {
    if (!x || typeof x !== 'object') return null
    const p = x as Record<string, unknown>
    if (!isRef(p.id) || typeof p.t !== 'string') return null
    const obj: PyObject = { id: p.id, t: p.t.slice(0, 40) }
    const v = str(p.v, 80)
    if (v !== undefined) obj.v = v
    if (Array.isArray(p.items)) obj.items = p.items.slice(0, 32).filter((i): i is string | [string, string] => isRef(i) || (Array.isArray(i) && i.length === 2 && isRef(i[0]) && isRef(i[1])))
    if (Array.isArray(p.attrs)) obj.attrs = p.attrs.slice(0, 32).filter((a): a is [string, string] => Array.isArray(a) && typeof a[0] === 'string' && isRef(a[1])).map(([k, r]) => [k.slice(0, 40), r])
    for (const k of ['more', 'cap', 'sz'] as const) if (typeof p[k] === 'number' && Number.isFinite(p[k])) obj[k] = p[k] as number
    if (Array.isArray(p.d)) obj.d = p.d.filter((n): n is number => typeof n === 'number').slice(0, 8)
    if (p.neg === true) obj.neg = true
    objects.push(obj)
  }
  const steps: PyStep[] = []
  for (const x of o.steps.slice(0, 400)) {
    if (!x || typeof x !== 'object') return null
    const s = x as Record<string, unknown>
    if (typeof s.line !== 'number' || !Array.isArray(s.frames) || !Array.isArray(s.heap)) return null
    const event = s.event === 'return' || s.event === 'exception' ? s.event : 'line'
    const frames: PyFrame[] = s.frames.slice(0, 40).map((f) => {
      const fr = (f ?? {}) as Record<string, unknown>
      return {
        name: str(fr.name, 60) ?? '?',
        line: typeof fr.line === 'number' ? fr.line : 0,
        names: Array.isArray(fr.names) ? fr.names.slice(0, 40).filter((n): n is [string, string] => Array.isArray(n) && typeof n[0] === 'string' && isRef(n[1])).map(([k, r]) => [k.slice(0, 40), r]) : []
      }
    })
    const step: PyStep = { line: s.line, event, frames, heap: s.heap.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < objects.length), out: str(s.out, 4000) ?? '' }
    if (isRef(s.ret)) step.ret = s.ret
    const exc = str(s.exc, 200)
    if (exc) step.exc = exc
    steps.push(step)
  }
  const t: PyTrace = { code: str(o.code, 4000) ?? '', ok: o.ok === true, steps, objects }
  const error = str(o.error, 300)
  if (error) t.error = error
  const stopped = str(o.stopped, 120)
  if (stopped) t.stopped = stopped
  return t
}

/**
 * The visual's code with its trace in front, as window.TIDE_TRACE (or window.TIDE_TRACE_ERROR,
 * for the visual to say). "<" is escaped so nothing in the trace can close the script.
 */
export function withTrace(code: string, r: { trace?: PyTrace; error?: string }): string {
  let json = r.trace ? JSON.stringify(r.trace) : 'null'
  if (json.length > MAX_TRACE_JSON && r.trace) {
    // Too long: the first steps, enough to replay
    const keep = Math.max(10, Math.floor((r.trace.steps.length * MAX_TRACE_JSON) / json.length) - 2)
    json = JSON.stringify({ ...r.trace, steps: r.trace.steps.slice(0, keep), stopped: `Shortened to the first ${keep} steps` })
  }
  const safe = (s: string) => s.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<script>window.TIDE_TRACE = ${safe(json)};${r.error ? ` window.TIDE_TRACE_ERROR = ${safe(JSON.stringify(r.error.slice(0, 300)))};` : ''}</script>\n${code}`
}
