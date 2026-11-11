/**
 * Matching for the regex simulation, in a worker with a time limit. A pattern with nested
 * quantifiers can take exponential time to fail ((a+)+$ on "aaaa…b"): rather than freeze the
 * window, the worker is stopped and the learner is told that is what happened. Where there are
 * no workers (tests), matching runs in place.
 */
import RegexWorker from './regex.worker?worker'
import { REGEX_LIMITS, runMatches, type MatchOutcome } from './regex'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (o: MatchOutcome) => void>()

function stop(): void {
  worker?.terminate()
  worker = null
}

function start(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new RegexWorker()
  } catch {
    return null
  }
  worker.onmessage = (e: MessageEvent<{ id: number; outcome: MatchOutcome }>) => {
    const done = pending.get(e.data.id)
    pending.delete(e.data.id)
    done?.(e.data.outcome)
  }
  return worker
}

export const SLOW = `Stopped after ${REGEX_LIMITS.timeMs / 1000} s: the engine was still trying ways to match. Nested quantifiers like (a+)+ make it try exponentially many before giving up (catastrophic backtracking).`

export function matchAll(pattern: string, flags: string, tests: string[]): Promise<MatchOutcome> {
  const w = start()
  if (!w) return Promise.resolve(runMatches(pattern, flags, tests))
  const id = nextId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      // Everything still waiting was queued behind the runaway one: answer it all and start afresh
      for (const [k, done] of pending) done(k === id ? { ok: false, error: SLOW, slow: true } : { ok: false, error: 'Stopped with the pattern before it.', slow: true })
      pending.clear()
      stop()
    }, REGEX_LIMITS.timeMs)
    pending.set(id, (o) => {
      clearTimeout(timer)
      resolve(o)
    })
    w.postMessage({ id, pattern, flags, tests })
  })
}
