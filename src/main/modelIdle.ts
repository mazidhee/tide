/**
 * Gives the model's memory back when you aren't studying. Gemma holds about 10 GB for as long as
 * it is loaded, which on a 24 GB Mac is what makes everything else slow; unloaded, its server holds
 * under 1 GB. Measured on an M4 Pro: the first message after a reload starts in 2 to 5 seconds
 * (against about 1 when loaded), and the lesson you were in is not read again, because its
 * snapshots come back from disk. So:
 * - after a while with nobody waiting on the model (15 minutes unless you change it), it is unloaded;
 * - coming back to Tide's window starts the reload at once, before you have typed anything;
 * - quitting Tide unloads it.
 * Only for mlx-vlm on this Mac, which has the unload command and reloads by itself when asked.
 */
import { app } from 'electron'
import { isMlxVlm } from './modelServer'
import { inBackground, lastModelUse, sinceAsked } from './modelQueue'
import { getSettings } from './settings'

/** Minutes without use before the model is unloaded; 0 keeps it loaded */
export const idleMinutes = () => getSettings().ai.unloadAfterMinutes ?? 15

function server(): { origin: string; headers: Record<string, string> } | null {
  const { baseUrl, apiKey } = getSettings().ai
  try {
    const url = new URL(baseUrl)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !isMlxVlm()) return null
    return { origin: url.origin, headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } }
  } catch {
    return null
  }
}

async function loaded(): Promise<boolean> {
  const s = server()
  if (!s) return false
  const health = (await fetch(`${s.origin}/health`, { headers: s.headers, signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null)) as { loaded_model?: string | null } | null
  return !!health?.loaded_model
}

/**
 * How long the server has gone without a request from anyone: another copy of Tide, a script, an
 * app. Null when it can't say (then only Tide's own use counts, as before). An idle copy of Tide
 * used to unload Gemma within a minute of anything else loading it, so every lesson turn in the
 * copy being used paid a reload (about 4.3 s) and read its snapshot back from disk.
 */
async function serverIdle(): Promise<{ ms: number; lastAt: number } | null> {
  const s = server()
  if (!s) return null
  const m = (await fetch(`${s.origin}/v1/metrics`, { headers: s.headers, signal: AbortSignal.timeout(1500) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { summary?: { in_flight?: number; last_request_at?: number } } | null
  const sum = m?.summary
  if (!sum || typeof sum.last_request_at !== 'number') return null
  const lastAt = sum.last_request_at * 1000
  return { ms: sum.in_flight ? 0 : Date.now() - lastAt, lastAt }
}

/**
 * Unloads the model if it is loaded. It takes its turn in the model's queue like any other
 * background job, so it never lands in the middle of one, and is dropped the moment you ask the
 * model for something. Says whether it unloaded.
 */
export function unloadModel(): Promise<boolean> {
  const s = server()
  if (!s) return Promise.resolve(false)
  return inBackground(
    async (signal) => {
      if (!(await loaded())) return false
      const res = await fetch(`${s.origin}/unload`, { method: 'POST', headers: s.headers, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }).catch(() => null)
      return !!res?.ok
    },
    undefined,
    false
  ).catch(() => false)
}

/** You've been using the model lately (or just opened Tide): worth having it ready */
export const inUse = () => !idleMinutes() || sinceAsked() < idleMinutes() * 60_000

let waking: Promise<void> | null = null

/**
 * You're back at Tide: if the model was unloaded, start loading it now, so it is ready by the time
 * you ask. `warm` loads it by reading the chat prompt, as at launch.
 */
export function wakeModel(warm: () => Promise<unknown>): void {
  if (waking || !server()) return
  waking = (async () => {
    if (!(await loaded())) await warm().catch(() => {})
  })().finally(() => (waking = null))
}

/** Starts watching for idleness, and unloads on quit */
export function watchModelIdle(): void {
  setInterval(() => {
    if (!idleMinutes() || inUse()) return
    // Not while something else is using it
    void serverIdle().then((idle) => {
      if (!idle || idle.ms >= idleMinutes() * 60_000) void unloadModel()
    })
  }, 60_000)
  let leaving = false
  app.on('before-quit', (e) => {
    if (leaving || !idleMinutes() || !server()) return
    // Hold the quit for a moment (three seconds at most) so the unload is sent
    leaving = true
    e.preventDefault()
    const s = server()!
    // Only when the last thing the server did was for this copy of Tide: never under someone else
    const unload = serverIdle().then((idle) => (idle && (idle.ms === 0 || idle.lastAt > lastModelUse() + 2000) ? null : fetch(`${s.origin}/unload`, { method: 'POST', headers: s.headers }).catch(() => null)))
    Promise.race([unload, new Promise((r) => setTimeout(r, 3000))]).finally(() => app.quit())
  })
}
