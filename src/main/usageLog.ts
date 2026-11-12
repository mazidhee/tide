/**
 * The usage log: one line per model call (Claude, Gemma, cloud), each window reading Claude Code
 * reports, and each Gemma unload, kept in the vault's .tide/usage as a JSONL file a day. Files
 * older than KEEP_DAYS are removed. Never a reason for a call to fail: every write is best effort.
 *
 * What a call was for (its job, lesson, side thread, and whether it took over from Claude) comes
 * from the code around it: withUsage() sets it for everything that code awaits (AsyncLocalStorage),
 * so the call sites in claudeEngine, cloud and ai stay one line each.
 */
import { AsyncLocalStorage } from 'async_hooks'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { vaultRoot } from './vault'
import { buildReport, parseUsageLine, type CallEntry, type UsageLine, type UsageReport, type WindowReading } from '@shared/usage'

export const KEEP_DAYS = 120

// ---------- Where ----------

let dirOverride: string | null = null
/** Tests (and only tests) point the log somewhere else */
export const setUsageDir = (dir: string | null) => (dirOverride = dir)

function usageDir(): string | null {
  if (dirOverride) return dirOverride
  try {
    return join(vaultRoot(), '.tide', 'usage')
  } catch {
    // No notes folder yet: nothing is kept
    return null
  }
}

const fileFor = (dir: string, at: number) => {
  const d = new Date(at)
  return join(dir, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.jsonl`)
}

const DAY_FILE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/
const fileDate = (name: string) => {
  const m = DAY_FILE.exec(name)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null
}

/** Removes day files older than `keepDays` */
export function rotate(dir: string, now: number, keepDays = KEEP_DAYS): string[] {
  const cut = new Date(now)
  cut.setHours(0, 0, 0, 0)
  cut.setDate(cut.getDate() - keepDays)
  const gone: string[] = []
  try {
    for (const name of readdirSync(dir)) {
      const at = fileDate(name)
      if (at !== null && at < cut.getTime()) {
        unlinkSync(join(dir, name))
        gone.push(name)
      }
    }
  } catch {
    // nothing to rotate
  }
  return gone
}

let rotatedFor = ''
function write(line: UsageLine) {
  const dir = usageDir()
  if (!dir) return
  try {
    mkdirSync(dir, { recursive: true })
    const file = fileFor(dir, line.at)
    // A new day's first line: the old files go
    if (rotatedFor !== file && !existsSync(file)) rotate(dir, line.at)
    rotatedFor = file
    appendFileSync(file, JSON.stringify(line) + '\n')
  } catch {
    // Usage is a record, never a reason to fail a request
  }
}

/** Every line from `since` on (ms), oldest file first */
export function readUsageLines(since: number, dir = usageDir()): UsageLine[] {
  if (!dir || !existsSync(dir)) return []
  const first = new Date(since)
  first.setHours(0, 0, 0, 0)
  const out: UsageLine[] = []
  for (const name of readdirSync(dir).sort()) {
    const at = fileDate(name)
    if (at === null || at < first.getTime()) continue
    try {
      for (const l of readFileSync(join(dir, name), 'utf8').split('\n')) {
        const e = l && parseUsageLine(l)
        if (e && e.at >= since) out.push(e)
      }
    } catch {
      // a file being written: skipped this time
    }
  }
  return out
}

// ---------- What a call was for ----------

export interface UsageScope {
  job?: string
  lesson?: string
  title?: string
  thread?: string
  /** Set once Claude has failed in this scope: the calls that follow took over, for this reason */
  fallback?: string
}

const scopes = new AsyncLocalStorage<UsageScope>()

/** Runs `fn` with these facts about its calls (on top of any outer scope's) */
export function withUsage<T>(scope: UsageScope, fn: () => T): T {
  return scopes.run({ ...scopes.getStore(), ...scope }, fn)
}

/** As withUsage, for a generator: each step runs inside the scope */
export async function* withUsageGen<T>(scope: UsageScope, gen: () => AsyncGenerator<T>): AsyncGenerator<T> {
  const s = { ...scopes.getStore(), ...scope }
  const it = scopes.run(s, gen)
  try {
    for (;;) {
      const r = await scopes.run(s, () => it.next())
      if (r.done) return
      yield r.value
    }
  } finally {
    await scopes.run(s, () => it.return?.(undefined))
  }
}

/** Claude couldn't take it: what runs next in this scope took over, for this reason */
export function noteFallback(reason: string) {
  const s = scopes.getStore()
  if (s) s.fallback = reason
}

export const currentScope = (): UsageScope => scopes.getStore() ?? {}

// ---------- Writing ----------

/** One call. Job and lesson come from the scope unless given; `job` here is only the default */
export function logCall(e: Omit<CallEntry, 'k' | 'job'> & { job?: string; defaultJob?: string }) {
  const s = currentScope()
  const { defaultJob, ...rest } = e
  const line: CallEntry = {
    k: 'call',
    ...rest,
    job: e.job ?? s.job ?? defaultJob ?? 'other',
    ...(s.lesson && !e.lesson ? { lesson: s.lesson } : {}),
    ...(s.title && !e.title ? { title: s.title.slice(0, 80) } : {}),
    ...(s.thread && !e.thread ? { thread: s.thread } : {}),
    // Claude's own calls never "took over"; anything after a Claude failure did
    ...(s.fallback && e.p !== 'claude' && !e.fb ? { fb: s.fallback } : {})
  }
  for (const k of ['think', 'ttft', 'err', 'fb', 'est', 'lesson', 'title', 'thread'] as const) if (line[k] === undefined || line[k] === 0 || line[k] === false) delete line[k]
  line.ms = Math.round(line.ms)
  if (line.ttft) line.ttft = Math.round(line.ttft)
  line.usd = Math.round(line.usd * 1e6) / 1e6
  write(line)
}

/** Readings already written, so a reading repeated on every call isn't written every time */
const lastWindow = new Map<string, { sig: string; at: number }>()

/** What a rate_limit_event said about each window. A reading that hasn't changed is written at most every 30 minutes */
export function logWindows(readings: WindowReading[], at = Date.now()) {
  for (const r of readings) {
    const sig = `${r.status}|${r.utilization ?? ''}|${r.resetsAt ?? ''}`
    const prev = lastWindow.get(r.window)
    if (prev && prev.sig === sig && at - prev.at < 30 * 60_000) continue
    lastWindow.set(r.window, { sig, at })
    write({
      k: 'win',
      at,
      w: r.window,
      status: r.status,
      ...(r.utilization !== undefined ? { util: r.utilization } : {}),
      ...(r.resetsAt ? { resets: r.resetsAt * 1000 } : {})
    })
  }
}

export const logUnload = (at = Date.now()) => write({ k: 'unload', at })

/** For tests: forget what was written */
export const resetUsageLog = () => {
  lastWindow.clear()
  rotatedFor = ''
}

// ---------- Reading ----------

/** Settings › Usage: the last `range` days (and enough before for the weekly window's pace) */
export function usageReport(range = 14, now = Date.now(), gemmaIdleMinutes = 5): UsageReport {
  const days = Math.max(range, 8)
  const since = new Date(now)
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - days)
  return buildReport(readUsageLines(since.getTime()), {
    now,
    range,
    gemmaIdleMs: Math.max(1, gemmaIdleMinutes) * 60_000
  })
}
