/**
 * Where each answer's time went, so "only Gemma is slow" can be checked rather than assumed:
 * Tide's own preparation, each model request (reading the prompt, then writing), the tools the
 * tutor ran, Tide's work on every token, and the window's drawing. The last forty turns are kept
 * in memory for Settings › Speed.
 */
import { AsyncLocalStorage } from 'async_hooks'
import type { TurnSpeed } from '@shared/types'

class Turn {
  readonly t0 = performance.now()
  readonly record: TurnSpeed
  constructor(id: string, kind: TurnSpeed['kind']) {
    this.record = { id, at: Date.now(), kind, prepareMs: 0, calls: [], tools: [], totalMs: 0 }
  }
  /** Milliseconds since the turn began */
  since = () => performance.now() - this.t0
}

const store = new AsyncLocalStorage<Turn>()
const recent: TurnSpeed[] = []

/** Runs one answer with its timings recorded */
export async function timeTurn<T>(id: string, kind: TurnSpeed['kind'], run: () => Promise<T>): Promise<T> {
  const turn = new Turn(id, kind)
  recent.unshift(turn.record)
  recent.length = Math.min(recent.length, 40)
  try {
    return await store.run(turn, run)
  } finally {
    turn.record.totalMs = Math.round(turn.since())
  }
}

/** A model request just went out: the first one ends Tide's preparation */
export function requestSent(): (done: { engine: 'local' | 'cloud'; model: string; firstTokenAt: number; endAt: number; startAt: number; tokens: number; promptTokens?: number; cachedTokens?: number; tideMs: number }) => void {
  const turn = store.getStore()
  if (!turn) return () => {}
  if (!turn.record.calls.length) turn.record.prepareMs = Math.round(turn.since())
  return (d) => {
    const first = d.firstTokenAt || d.endAt
    turn.record.calls.push({
      engine: d.engine,
      model: d.model,
      prefillMs: Math.round(first - d.startAt),
      writeMs: Math.round(d.endAt - first),
      tokens: d.tokens,
      promptTokens: d.promptTokens,
      cachedTokens: d.cachedTokens,
      tideMs: Math.round(d.tideMs * 10) / 10
    })
  }
}

/** A tool the tutor ran (a search, a page, some code): its own time, not Gemma's or Tide's */
export function toolRan(name: string, ms: number) {
  store.getStore()?.record.tools.push({ name, ms: Math.round(ms) })
}

/** The window's report on drawing an answer as it streamed */
export function noteRender(id: string, r: NonNullable<TurnSpeed['render']>) {
  const turn = recent.find((t) => t.id === id)
  if (turn) turn.render = r
}

export const recentSpeed = (): TurnSpeed[] => recent.filter((t) => t.calls.length)
