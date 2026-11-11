/**
 * One local model, many callers. A local server answers one request at a time, so anything the user
 * is waiting on (chat, sessions, tools, helpers) goes straight through, while background work
 * (titles, compaction, margin notes) waits until the model is idle and is cancelled the moment the
 * user needs it, to be tried again later.
 */

let interactive = 0
/**
 * The background job holding the model. `keep` names the conversation a warm-up reads (a
 * read-back, a lesson about to start): a turn of that conversation waits for it rather than
 * cancelling it, because what it reads is the start of that turn's own prompt, and the server
 * finishes the chunk of prompt it is reading (up to 2,048 tokens, 10 s cold) even when the request
 * is cancelled, so cancelling only threw the reading away.
 */
let background: { controller: AbortController; keep?: string; done: Promise<void> } | null = null
/** Jobs waiting for the model; `first` ones (warm-ups of the conversation you're in) go ahead of the rest */
const waiting: { start: () => void; first: boolean }[] = []
let pumping: ReturnType<typeof setTimeout> | null = null
/** Until when other background work holds off: you are typing your next answer */
let holdUntil = 0

const IDLE_MS = 400

// Whether the model is working, for the windows: decoration holds still meanwhile, since the
// GPU it would draw with is the one Gemma is using. Idle is announced after a short pause, so
// back-to-back requests don't make it flicker.
const busyListeners = new Set<(busy: boolean) => void>()
let announced = false
let settling: ReturnType<typeof setTimeout> | null = null
function announce() {
  const busy = interactive > 0 || !!background
  if (busy) {
    if (settling) clearTimeout(settling)
    settling = null
    if (!announced) {
      announced = true
      busyListeners.forEach((l) => l(true))
    }
  } else if (announced && !settling) {
    settling = setTimeout(() => {
      settling = null
      if (interactive > 0 || background) return
      announced = false
      busyListeners.forEach((l) => l(false))
    }, IDLE_MS)
  }
}

export function onModelBusy(listener: (busy: boolean) => void): () => void {
  busyListeners.add(listener)
  return () => busyListeners.delete(listener)
}

/** Starts the next background job once the model has been idle for a moment */
function wake() {
  if (pumping || interactive || background || !waiting.length) return
  const held = waiting[0].first ? 0 : holdUntil - Date.now()
  pumping = setTimeout(() => {
    pumping = null
    if (interactive || background || !waiting.length) return
    if (!waiting[0].first && Date.now() < holdUntil) return wake()
    waiting.shift()!.start()
  }, Math.max(IDLE_MS, held))
}

/**
 * You are typing an answer: background work that isn't a warm-up of this conversation waits until
 * you have stopped for a while, and what is running now gives way at once, so the model is free by
 * the time you send. (A job cancelled in the middle of reading its prompt still holds the model
 * until the server finishes the chunk it is on: better that happens while you type.)
 */
export function noteTyping(ms = 10_000): void {
  holdUntil = Math.max(holdUntil, Date.now() + ms)
  if (background && !background.keep) background.controller.abort()
  if (pumping && waiting.length && !waiting[0].first) {
    clearTimeout(pumping)
    pumping = null
    wake()
  }
}

/** Takes the model for something you are waiting on: background work gives way (see `background`) */
async function claim(conversation?: string): Promise<() => void> {
  interactive++
  lastAsked = Date.now()
  announce()
  const b = background
  if (b?.keep && conversation && b.keep === conversation) await b.done
  else b?.controller.abort()
  return takeTurn()
}

function unclaim(release: () => void) {
  release()
  lastAsked = lastUsed = Date.now()
  interactive--
  announce()
  wake()
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

/** Marks an interactive request for its whole duration, pre-empting background work. `conversation`
 *  names the conversation it continues, so a warm-up of that conversation is waited for, not cancelled */
export async function asInteractive<T>(fn: () => Promise<T>, conversation?: string): Promise<T> {
  const release = await claim(conversation)
  try {
    return await fn()
  } finally {
    unclaim(release)
  }
}

/** Same as asInteractive, for streaming generators */
export async function* streamInteractive<T>(gen: () => AsyncGenerator<T>, conversation?: string): AsyncGenerator<T> {
  const release = await claim(conversation)
  try {
    yield* gen()
  } finally {
    unclaim(release)
  }
}

/**
 * Runs background work when the model is free, one job at a time. The job gets a signal that
 * aborts if the user needs the model meanwhile (or if the caller's own signal aborts).
 */
export async function inBackground<T>(fn: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal, usesModel = true, opts: { first?: boolean; keep?: string } = {}): Promise<T> {
  // Every job queues; the pump hands the model to one at a time, warm-ups first
  await new Promise<void>((start) => {
    const first = !!opts.first
    const at = first ? waiting.findIndex((w) => !w.first) : -1
    waiting.splice(at < 0 ? waiting.length : at, 0, { start, first })
    if (first && pumping) {
      clearTimeout(pumping)
      pumping = null
    }
    wake()
  })
  const controller = new AbortController()
  let finished!: () => void
  background = { controller, keep: opts.keep, done: new Promise<void>((r) => (finished = r)) }
  announce()
  if (outer?.aborted) {
    background = null
    finished()
    wake()
    throw new Error('cancelled')
  }
  outer?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    return await fn(controller.signal)
  } finally {
    background = null
    if (usesModel) lastUsed = Date.now()
    finished()
    announce()
    wake()
    // A job that only waited its turn (a settings check) pushed nothing out of the model's cache
    if (usesModel) doneListeners.forEach((l) => l())
  }
}

const doneListeners = new Set<() => void>()

/** Called each time a background job that used the model has finished with it */
export function afterBackground(listener: () => void): void {
  doneListeners.add(listener)
}

export const modelBusy = () => interactive > 0

let lastAsked = Date.now()
let lastUsed = 0
/** When this copy of Tide last finished with the model, for anything */
export const lastModelUse = () => lastUsed
/** Milliseconds since you last waited on the model (a reply, a lesson turn, a check): background work doesn't count */
export const sinceAsked = () => (interactive > 0 ? 0 : Date.now() - lastAsked)
