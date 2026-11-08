/**
 * One local model, many callers. A local server answers one request at a time, so anything the user
 * is waiting on (chat, sessions, tools, helpers) goes straight through, while background work
 * (titles, compaction, margin notes) waits until the model is idle and is cancelled the moment the
 * user needs it, to be tried again later.
 */

let interactive = 0
let background: { controller: AbortController } | null = null
const waiting: (() => void)[] = []
let pumping: ReturnType<typeof setTimeout> | null = null

const IDLE_MS = 400

/** Starts the next background job once the model has been idle for a moment */
function wake() {
  if (pumping || interactive || background || !waiting.length) return
  pumping = setTimeout(() => {
    pumping = null
    if (interactive || background) return
    waiting.shift()?.()
  }, IDLE_MS)
}

// Interactive requests take turns too: the server batches requests that overlap, and two at once
// each run at about half speed, so the one you're waiting on would arrive later than if it went alone
let lane: Promise<void> = Promise.resolve()

/** Waits for the model to be free of other interactive work; call the result when done */
async function takeTurn(): Promise<() => void> {
  let release!: () => void
  const mine = new Promise<void>((r) => (release = r))
  const before = lane
  lane = before.then(() => mine)
  await before
  return release
}

/** Marks an interactive request for its whole duration, pre-empting background work */
export async function asInteractive<T>(fn: () => Promise<T>): Promise<T> {
  interactive++
  background?.controller.abort()
  const release = await takeTurn()
  try {
    return await fn()
  } finally {
    release()
    interactive--
    wake()
  }
}

/** Same as asInteractive, for streaming generators */
export async function* streamInteractive<T>(gen: () => AsyncGenerator<T>): AsyncGenerator<T> {
  interactive++
  background?.controller.abort()
  const release = await takeTurn()
  try {
    yield* gen()
  } finally {
    release()
    interactive--
    wake()
  }
}

/**
 * Runs background work when the model is free, one job at a time. The job gets a signal that
 * aborts if the user needs the model meanwhile (or if the caller's own signal aborts).
 */
export async function inBackground<T>(fn: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  // Every job queues; the pump hands the model to one at a time
  await new Promise<void>((resolve) => {
    waiting.push(resolve)
    wake()
  })
  const controller = new AbortController()
  background = { controller }
  if (outer?.aborted) {
    background = null
    wake()
    throw new Error('cancelled')
  }
  outer?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    return await fn(controller.signal)
  } finally {
    background = null
    wake()
  }
}

export const modelBusy = () => interactive > 0
