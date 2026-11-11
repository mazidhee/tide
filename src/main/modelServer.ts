import { spawn } from 'child_process'
import { connect } from 'net'
import { existsSync, openSync, readdirSync } from 'fs'
import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { getSettings } from './settings'

/**
 * Tunes a local mlx-vlm server for how Tide talks to it.
 *
 * Every chat turn and every step of a tool loop resends the whole conversation, and this Mac reads
 * prompts at a few hundred tokens a second, so a long system prompt costs seconds each time.
 * mlx-vlm can keep the model's state for prompts it has seen (prefix caching) and continue from
 * there, but it ships switched off. Turning it on is a runtime setting, so it is reapplied each
 * launch; it changes speed only, never the answers. Other servers are left alone.
 */
// Gemma 4 mixes sliding-window and full attention, so the server can't reuse part of an old prompt,
// only whole saved snapshots that the new prompt starts with, and it saves them only while reading
// a prompt. Tide marks per-turn context as request-only, so each request saves a snapshot exactly
// where its conversation ends, and reads each answer back as soon as it's written (see readBack in
// agent.ts), so the next turn starts from a snapshot that already holds it. Measured on an M4 Pro
// (scripts/bench/gemma.py):
// - One conversation then needs two or three snapshots (a few hundred MB each), so 2 GB holds it
//   with room for background work; 4 GB only made the server 1.5 GB bigger.
// - Intermediate snapshots (every N tokens) crowd the cache and push the conversation out, so they
//   start only past 8k tokens.
// - The last snapshot is taken 4 tokens before the end, not 1: a prompt ends with the 4 tokens that
//   open the model's turn, which the next prompt never repeats, so at 1 it could never match.
// - Half a GB held back before reading, not the automatic 1.8 GB: with that, a Mac with little
//   free memory had its snapshots thrown away just before they were needed and a whole lesson was
//   read again (a worst turn of 44 s); with none, the cache grew a GB past its budget. At half a
//   GB the worst turn was 2 s and the server no bigger than before.
// - Snapshots also go to disk (up to 20 GB; one long lesson writes several): one pushed out of
//   memory comes back in about a second, and survives a restart.
export const PREFIX_CACHE = { apc_enabled: true, apc_disk_enabled: true, apc_disk_max_gb: 20, apc_memory_max_gb: 2, apc_memory_reserve_gb: 0.5, apc_checkpoint_entries: 6, apc_checkpoint_interval_tokens: 8192, apc_checkpoint_guard_tokens: 4 }

/** Whether the AI server is mlx-vlm, which takes request-only context (see transientContext) */
let mlxVlmServer = false
export const isMlxVlm = () => mlxVlmServer

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'

/**
 * Speculative decoding: Google's small "assistant" model guesses a few tokens ahead and the 12B
 * model checks them in one pass. Answers are the same; code and JSON come out about 30% faster on
 * an M4 Pro. Used only when that draft model has been downloaded and the server runs Gemma 4 12B.
 */
export const DRAFTER_REPO = 'mlx-community/gemma-4-12B-it-qat-assistant-5bit'

export function drafterPath(): string | null {
  const dir = join(homedir(), '.cache', 'huggingface', 'hub', `models--${DRAFTER_REPO.replace('/', '--')}`, 'snapshots')
  try {
    const snap = readdirSync(dir).find((d) => existsSync(join(dir, d, 'model.safetensors')))
    return snap ? join(dir, snap) : null
  } catch {
    return null
  }
}

export async function tuneModelServer(): Promise<'enabled' | 'already' | 'unsupported'> {
  const { baseUrl, apiKey } = getSettings().ai
  let origin: string
  try {
    const url = new URL(baseUrl)
    if (!isLocal(url.hostname)) return 'unsupported'
    origin = url.origin
  } catch {
    return 'unsupported'
  }
  const headers = { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }
  const res = await fetch(`${origin}/v1/settings`, { headers, signal: AbortSignal.timeout(3000) }).catch(() => null)
  if (!res?.ok) return 'unsupported'
  const body = (await res.json().catch(() => null)) as { current?: Record<string, unknown> } | null
  if (!body?.current || !('apc_enabled' in body.current)) return 'unsupported'
  mlxVlmServer = true
  // Only what differs (each change reloads the model once; settings the server lacks are skipped)
  const current = body.current
  const changes: Record<string, unknown> = Object.fromEntries(Object.entries(PREFIX_CACHE).filter(([k, v]) => k in current && current[k] !== v))
  const drafter = drafterPath()
  if (drafter && !body.current.draft_model && 'draft_model' in body.current) {
    const models = (await fetch(`${origin}/v1/models`, { headers, signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null)) as { data?: { id: string }[] } | null
    if (models?.data?.some((m) => /gemma-4-12b/i.test(m.id))) Object.assign(changes, { draft_model: drafter, draft_kind: 'mtp' })
  }
  if (!Object.keys(changes).length) return 'already'
  // Both changes reload the model once, together
  const patch = await fetch(`${origin}/v1/settings`, { method: 'PATCH', headers, body: JSON.stringify(changes), signal: AbortSignal.timeout(30_000) }).catch(() => null)
  return patch?.ok ? 'enabled' : 'unsupported'
}

/** What's switched on in the model server, for Settings */
export async function speedStatus(): Promise<{ ready: boolean; detail: string }> {
  const { baseUrl, apiKey } = getSettings().ai
  let origin: string
  try {
    const url = new URL(baseUrl)
    if (!isLocal(url.hostname)) return { ready: false, detail: 'Only for an AI server on this Mac' }
    origin = url.origin
  } catch {
    return { ready: false, detail: 'No AI server set' }
  }
  const res = await fetch(`${origin}/v1/settings`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(3000) }).catch(() => null)
  const body = res?.ok ? ((await res.json().catch(() => null)) as { current?: Record<string, unknown> } | null) : null
  if (!body?.current || !('apc_enabled' in body.current)) return { ready: false, detail: 'Your AI server has no speed settings (they are for mlx-vlm)' }
  const cache = body.current.apc_enabled === true
  const draft = !!body.current.draft_model
  const parts = [cache ? 'prompt cache on' : 'prompt cache off', draft ? 'draft model on' : drafterPath() ? 'draft model off' : 'no draft model downloaded']
  return { ready: cache && (draft || !drafterPath()), detail: parts.join(', ') }
}

export async function applySpeedups(): Promise<{ ready: boolean; detail: string }> {
  await tuneModelServer()
  return speedStatus()
}

// ---------- Starting the server ----------

/** The command that starts Gemma on this Mac: yours, or the usual mlx-vlm one when it's installed */
export function serverCommand(): string {
  const own = getSettings().ai.serverCommand?.trim()
  if (own) return own
  const bin = join(homedir(), 'mlx-env312', 'bin', 'mlx_vlm.server')
  if (!existsSync(bin)) return ''
  let port = '8080'
  try {
    port = new URL(getSettings().ai.baseUrl).port || '8080'
  } catch {
    // keep 8080
  }
  return `${bin} --model mlx-community/gemma-4-12B-it-4bit --port ${port} --draft-block-size 3`
}

let startedAt = 0

/**
 * Starts the local model server when it isn't answering (after a restart, or it was closed),
 * with the command above, at most once every few minutes. It keeps running when Tide quits:
 * other apps may use it, and Tide finds it ready next time. Output goes to model-server.log.
 */
export async function ensureModelServer(): Promise<'running' | 'started' | 'off'> {
  const { baseUrl, autoStart } = getSettings().ai
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return 'off'
  }
  if (!isLocal(url.hostname) || autoStart === false) return 'off'
  // Something listening on the port is a server (maybe busy with a long reply and slow to answer):
  // only when nothing is there at all is it started, so a second copy never loads alongside it
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  const listening = await new Promise<boolean>((done) => {
    const sock = connect({ host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, ''), port })
    sock.setTimeout(2000)
    sock.once('connect', () => (sock.destroy(), done(true)))
    sock.once('timeout', () => (sock.destroy(), done(true)))
    sock.once('error', () => done(false))
  })
  if (listening) return 'running'
  const cmd = serverCommand()
  if (!cmd || Date.now() - startedAt < 4 * 60_000) return 'off'
  startedAt = Date.now()
  const log = openSync(join(app.getPath('userData'), 'model-server.log'), 'a')
  spawn('/bin/zsh', ['-lc', cmd], { detached: true, stdio: ['ignore', log, log] }).unref()
  return 'started'
}

/** Waits for a server just started to answer, up to a couple of minutes (the model loads first) */
export async function serverReady(timeoutMs = 150_000): Promise<boolean> {
  const { baseUrl } = getSettings().ai
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const ok = await fetch(`${new URL(baseUrl).origin}/v1/models`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false)
    if (ok) return true
    await new Promise((r) => setTimeout(r, 3000))
  }
  return false
}
