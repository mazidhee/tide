/**
 * Gives the model's memory back when you aren't studying, and loads Gemma only when something
 * needs it. Gemma holds about 10 GB for as long as it is loaded, which on a 24 GB Mac is what
 * makes everything else slow; unloaded, its server holds under 1 GB. Measured on an M4 Pro: the
 * first message after a reload starts in 2 to 5 seconds (against about 1 when loaded), and the
 * lesson you were in is not read again, because its snapshots come back from disk.
 *
 * While Claude is the main tutor (set up, logged in, not at its limit, online), Gemma is loaded on
 * demand (shared/gemmaPolicy):
 * - nothing loads it at launch, on focus, after sleep or in the minute's check;
 * - a job routed to Gemma loads it (Gemma picked, a Claude call that failed or hung), and the
 *   obvious cases load it ahead: Claude hitting its limit, logging out or going offline;
 * - it is unloaded 5 minutes after its last use (never later than the setting), and once at
 *   launch when it is loaded and nobody is using it.
 * When Claude isn't the main tutor, Gemma is kept ready as before: loaded at launch and as you come
 * back to Tide's window, unloaded after the setting's minutes (15 unless you change it).
 * Never unloaded while another client is using the server. Quitting Tide unloads it.
 * Only for mlx-vlm on this Mac, which has the unload command and reloads by itself when asked.
 */
import { logUnload } from './usageLog'
import { app } from 'electron'
import { gemmaIdleMinutes, gemmaStatusLine, reasonFromWhy, shouldWarmGemma, unloadAtLaunch, type ClaudeState, type GemmaReason } from '@shared/gemmaPolicy'
import { ensureModelServer, isMlxVlm, serverReady, tuneModelServer } from './modelServer'
import { inBackground, lastModelUse, modelBusy, sinceAsked } from './modelQueue'
import { getSettings } from './settings'

// ---------- Claude, as the main tutor ----------

let claude: ClaudeState = { main: false, why: 'no-claude' }

async function online(): Promise<boolean> {
  try {
    const e = await import('electron')
    return e.net?.isOnline?.() ?? true
  } catch {
    return true
  }
}

/** Whether Claude is the main tutor now, worked out from scratch (tests replace it) */
let probeClaude = async (): Promise<ClaudeState> => {
  if (getSettings().ai.claude?.teacher === 'gemma') return { main: false, why: 'picked' }
  if (!(await online())) return { main: false, why: 'offline' }
  const { claudeReady } = await import('./claudeEngine')
  const r = await claudeReady()
  if (!r.installed) return { main: false, why: 'no-claude' }
  if (!r.ready) return { main: false, why: reasonFromWhy(r.why) }
  return { main: true }
}
export const setClaudeProbe = (fn: () => Promise<ClaudeState>) => (probeClaude = fn)

/** What was last found (it starts as "not the main tutor", so Tide behaves as before until it knows) */
export const claudeState = () => claude

/**
 * Looks again. When Claude stops being able to teach (its limit, logged out, offline), Gemma is
 * loaded at once, so the first reply it takes over isn't also the one that waits for the load.
 */
export async function refreshClaude(): Promise<ClaudeState> {
  const before = claude
  claude = await probeClaude().catch(() => claude)
  if (before.main && !claude.main && (claude.why === 'limit' || claude.why === 'logged-out' || claude.why === 'offline')) void prewarmGemma(claude.why).catch(() => {})
  return claude
}

// ---------- Who needs Gemma ----------

/** The last job that needed Gemma, and why */
let demand: { reason: GemmaReason; at: number } | null = null
/** When a request last went to Gemma */
let lastGemmaAt = 0

/** A job is going to Gemma for this reason (also counts as use, for the idle timer) */
export function noteGemmaDemand(reason: GemmaReason): void {
  demand = { reason, at: Date.now() }
  lastGemmaAt = Date.now()
}

/** A request just went to Gemma (warm-ups don't count: they would keep it loaded for ever) */
export function markGemmaUsed(): void {
  lastGemmaAt = Date.now()
  demand = { reason: demand?.reason ?? (claude.main ? 'gemma-only' : claude.why ?? 'no-claude'), at: lastGemmaAt }
}

export const gemmaDemand = () => demand

// ---------- The server ----------

/** Minutes without use before the model is unloaded; 0 keeps it loaded */
export const idleMinutes = () => {
  const ai = getSettings().ai
  return gemmaIdleMinutes({ unloadAfterMinutes: ai.unloadAfterMinutes, withClaudeMinutes: ai.gemmaUnloadWithClaudeMinutes, claudeMain: claude.main })
}

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

/** Whether Gemma is loaded; false when the server can't say */
export async function loaded(): Promise<boolean> {
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
export async function serverIdle(): Promise<{ ms: number; lastAt: number } | null> {
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
      if (res?.ok) logUnload()
      return !!res?.ok
    },
    undefined,
    false
  ).catch(() => false)
}

/**
 * You've been using the model lately (or just opened Tide): worth having it ready. While Claude
 * is the main tutor, only Gemma's own recent use counts.
 */
export const inUse = () => {
  const minutes = idleMinutes()
  if (!minutes) return true
  if (claude.main) return modelBusy() || Date.now() - lastGemmaAt < minutes * 60_000
  return sinceAsked() < minutes * 60_000
}

/** Whether to load Gemma ahead of being asked (launch, focus, sleep, the minute's check) */
export const wantGemmaWarm = () => shouldWarmGemma({ claudeMain: claude.main, demandAt: demand?.at, now: Date.now(), idleMinutes: idleMinutes() })

/** Loads Gemma by reading the chat prompt (tests replace it) */
let warmer = async () => (await import('./agent')).warmChat()
export const setGemmaWarmer = (fn: () => Promise<unknown>) => (warmer = async () => void (await fn()))

let serverCheckedAt = 0
/** Reasons Claude was teaching a moment ago */
const TAKEOVER: GemmaReason[] = ['limit', 'logged-out', 'offline', 'claude-failed']
/**
 * The server running and tuned, ready for a job routed to Gemma: started if it isn't (that loads
 * the model), its speed settings applied. Checked at most once a minute, and only while Claude is
 * the main tutor: otherwise Gemma is kept ready as before (getGemmaReady, minuteCheck).
 */
export async function ensureGemmaServer(force = false): Promise<void> {
  if (!claude.main && !force) return
  if (Date.now() - serverCheckedAt < 60_000 && isMlxVlm()) return
  serverCheckedAt = Date.now()
  if ((await ensureModelServer()) === 'started') await serverReady()
  await tuneModelServer()
}

/**
 * A job is about to go to Gemma: the server is made ready (started if it isn't) and the reason
 * noted for Settings. Says whether Gemma was already loaded, so a lesson can say it is loading.
 */
export async function useGemma(reason: GemmaReason): Promise<{ loaded: boolean }> {
  noteGemmaDemand(reason)
  // Claude just failed: the server may never have been started, since Claude was teaching
  await ensureGemmaServer(claude.main || TAKEOVER.includes(reason)).catch(() => {})
  // Can't tell (not mlx-vlm): say nothing about loading
  return { loaded: server() ? await loaded() : true }
}

let prewarming: Promise<void> | null = null
/** Loads Gemma now, ahead of a job that will need it (Claude at its limit, offline) */
export function prewarmGemma(reason: GemmaReason): Promise<void> {
  noteGemmaDemand(reason)
  prewarming ??= (async () => {
    await ensureGemmaServer(true)
    if (server() && !(await loaded())) await warmer().catch(() => {})
  })().finally(() => (prewarming = null))
  return prewarming
}

let waking: Promise<void> | null = null

/**
 * You're back at Tide: if the model was unloaded and is wanted, start loading it now, so it is
 * ready by the time you ask. `warm` loads it by reading the chat prompt, as at launch.
 */
export function wakeModel(warm: () => Promise<unknown>): void {
  if (waking || !server() || !wantGemmaWarm()) return
  waking = (async () => {
    if (!(await loaded())) await warm().catch(() => {})
  })().finally(() => (waking = null))
}

/**
 * Launch, waking from sleep, unlocking: whether Claude can teach is looked at, then, only when Gemma
 * is wanted (Claude can't, or a job needed Gemma lately), the server is started if it isn't running,
 * its speed settings applied, and Gemma loaded by `warm` (unless you've been away a while). While
 * Claude teaches, the server is only looked at: starting it or changing its settings would load
 * the model. Says what it did.
 */
export async function getGemmaReady(warm: () => Promise<unknown>): Promise<'warmed' | 'ready' | 'skipped'> {
  await refreshClaude()
  if (!wantGemmaWarm()) {
    await tuneModelServer({ apply: false })
    return 'skipped'
  }
  if ((await ensureModelServer()) === 'started') await serverReady()
  const r = await tuneModelServer()
  // Not when you haven't used the model for a while (the Mac just woke with Tide in the background): it stays unloaded until you come back
  if (r !== 'unsupported' && inUse()) {
    await warm()
    return 'warmed'
  }
  return 'ready'
}

/**
 * Each minute: a restarted (or closed) server forgets its settings and what it had read, so when
 * Gemma is wanted it is started and tuned again, and reloaded with `warm` when its settings had to
 * be put back. Whether Claude can teach is looked at too: at its limit or offline, Gemma gets ready.
 */
export async function minuteCheck(warm: () => Promise<unknown>): Promise<'warmed' | 'ready' | 'skipped'> {
  await refreshClaude().catch(() => null)
  const r = await inBackground(
    async () => {
      if (!wantGemmaWarm()) return 'skipped' as const
      if ((await ensureModelServer()) === 'started') await serverReady()
      return tuneModelServer()
    },
    undefined,
    false
  )
  if (r === 'skipped') {
    // Only look (it notes whether the server is mlx-vlm), never load
    await tuneModelServer({ apply: false }).catch(() => null)
    return 'skipped'
  }
  if (r === 'enabled' && inUse() && wantGemmaWarm()) {
    await warm()
    return 'warmed'
  }
  return 'ready'
}

/** Once at launch, with Claude teaching: give Gemma's memory back if it's loaded and nobody is using it */
export async function unloadIdleAtLaunch(): Promise<boolean> {
  if (!server() || !claude.main) return false
  const [isLoaded, idle] = await Promise.all([loaded(), serverIdle()])
  if (!unloadAtLaunch({ claudeMain: claude.main, loaded: isLoaded, idle, keepLoaded: idleMinutes() === 0 })) return false
  return unloadModel()
}

// ---------- Settings: what Gemma is doing, and a hand on it ----------

export interface GemmaStatus {
  loaded: boolean | null
  serverUp: boolean
  claudeMain: boolean
  reason?: GemmaReason
  idleMinutes: number
  line: string
}

async function serverAnswers(): Promise<boolean> {
  try {
    const origin = new URL(getSettings().ai.baseUrl).origin
    return await fetch(`${origin}/v1/models`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false)
  } catch {
    return false
  }
}

export async function gemmaStatus(): Promise<GemmaStatus> {
  if (!isMlxVlm()) await tuneModelServer({ apply: false }).catch(() => null)
  const serverUp = await serverAnswers()
  const isLoaded = server() && serverUp ? await loaded() : null
  const minutes = idleMinutes()
  // The reason holds while Gemma is wanted for it; an old one isn't why it's loaded now
  const reason = demand && (!minutes || Date.now() - demand.at < (minutes + 1) * 60_000) ? demand.reason : undefined
  return { loaded: isLoaded, serverUp, claudeMain: claude.main, reason, idleMinutes: minutes, line: gemmaStatusLine({ loaded: isLoaded, claudeMain: claude.main, reason, idleMinutes: minutes, serverUp }) }
}

/** Load by hand (Settings) */
export async function loadGemmaNow(): Promise<GemmaStatus> {
  await prewarmGemma('manual')
  return gemmaStatus()
}

/** Unload by hand (Settings): not while a request is being answered, whoever it's for */
export async function unloadGemmaNow(): Promise<GemmaStatus & { busy?: boolean }> {
  const idle = await serverIdle()
  if (idle && idle.ms === 0) return { ...(await gemmaStatus()), busy: true }
  await unloadModel()
  demand = null
  return gemmaStatus()
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
