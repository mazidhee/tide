/**
 * Backups of Tide's own data: the rules, with no file access (main/backup does the writing).
 *
 * A snapshot is one .tar.gz holding the vault's .tide folder (under `vault/.tide/`) and Tide's
 * app data (under `app/`), with a manifest first. Caches, model files, Electron's own folders and
 * anything else Tide can make again are left out, so a snapshot stays a few MB. Kept: the newest
 * snapshot of each of the last 14 days that have one, then the newest of each of the 8 weeks
 * before those, and the last 3 safety snapshots (made just before a restore).
 */

export type BackupKind = 'daily' | 'manual' | 'quit' | 'safety'

export interface Snapshot {
  name: string
  kind: BackupKind
  /** When it was made, ms */
  at: number
  bytes: number
}

/** What Settings › Backups shows */
export interface BackupStatus {
  folder: string
  /** A folder the learner chose, not the default one in Tide's app data */
  custom: boolean
  /** The newest snapshot that isn't a safety one */
  last: Snapshot | null
  snapshots: Snapshot[]
  running: boolean
  error?: string
}

export interface BackupManifest {
  v: 1
  at: number
  kind: BackupKind
  app: string
  vault: string | null
  files: number
  bytes: number
}

/** The newest daily snapshots kept, one per day */
export const KEEP_DAYS = 14
/** The weekly snapshots kept after those, one per week */
export const KEEP_WEEKS = 8
/** Safety snapshots kept (made before each restore) */
export const KEEP_SAFETY = 3
/** A backup on quit when the newest is older than this */
export const QUIT_AFTER_MS = 24 * 3600_000
/** The nightly backup runs once a local day, from this hour on (or at the first chance after) */
export const NIGHTLY_HOUR = 2

// ---------- What goes in ----------

/** Folders in the vault's .tide that are caches Tide fills again by itself */
const VAULT_SKIP = new Set(['pdftext', 'epubtext', 'thumbs'])

/**
 * Tide's app data (userData) left out: Electron's and Chromium's own folders, the models and
 * runtimes Tide downloads, search indexes and caches, logs, and the backups themselves.
 */
const APP_SKIP = new Set([
  // Electron and Chromium
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'blob_storage',
  'Service Worker',
  'Shared Dictionary',
  'SharedStorage',
  'SharedStorage-wal',
  'DIPS',
  'DIPS-wal',
  'Cookies',
  'Cookies-journal',
  'Trust Tokens',
  'Trust Tokens-journal',
  'Network Persistent State',
  'TransportSecurity',
  'Local State',
  'Preferences',
  'DevToolsActivePort',
  'Session Storage',
  'Local Storage',
  'IndexedDB',
  'WebStorage',
  'Crashpad',
  'Dictionaries',
  'logs',
  'VideoDecodeStats',
  'databases',
  // Large, downloaded or made again
  'voice',
  'python',
  'searxng',
  'reading-audio',
  'search',
  'runcache',
  'lsp-workspace',
  'Backups'
])

/** Paths below the app data's top level that are made again */
const APP_SKIP_DEEP = [/^ide\/(cache|build)(\/|$)/, /^courses\/index(\/|$)/, /^courses\/[^/]+\/files(\/|$)/, /^videos\/cache(\/|$)/]

const SKIP_FILE = /(^|\/)(\.DS_Store|[^/]*\.(log|tmp|lock|sock))$/i

/** Whether a file in the vault's .tide (its path relative to .tide, with /) goes in a snapshot */
export function keepVaultFile(rel: string): boolean {
  if (!rel || SKIP_FILE.test(rel)) return false
  return !VAULT_SKIP.has(rel.split('/')[0])
}

/** Whether a file in Tide's app data (its path relative to userData, with /) goes in a snapshot */
export function keepAppFile(rel: string): boolean {
  if (!rel || SKIP_FILE.test(rel)) return false
  if (APP_SKIP.has(rel.split('/')[0])) return false
  return !APP_SKIP_DEEP.some((re) => re.test(rel))
}

/** Whether a folder is worth walking into (so a skipped folder of 1.5 GB is never read) */
export function walkVaultDir(rel: string): boolean {
  return !VAULT_SKIP.has(rel.split('/')[0])
}
export function walkAppDir(rel: string): boolean {
  if (APP_SKIP.has(rel.split('/')[0])) return false
  return !APP_SKIP_DEEP.some((re) => re.test(rel))
}

// ---------- Names ----------

const pad = (n: number) => String(n).padStart(2, '0')

/** "tide-2026-11-13-0215-daily.tar.gz", in local time, sortable */
export function snapshotName(at: number, kind: BackupKind): string {
  const d = new Date(at)
  return `tide-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${kind}.tar.gz`
}

/** A snapshot's kind and time from its name, or null for anything else in the folder */
export function parseSnapshotName(name: string): { kind: BackupKind; at: number } | null {
  const m = /^tide-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})?-(daily|manual|quit|safety)\.tar\.gz$/.exec(name)
  if (!m) return null
  const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime()
  return { kind: m[7] as BackupKind, at }
}

// ---------- Which to keep ----------

const dayKey = (at: number) => {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** The Monday that starts an at's week, as a local date */
const weekKey = (at: number) => {
  const d = new Date(at)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dayKey(d.getTime())
}

/**
 * The snapshots to delete. Of the ordinary ones (daily, manual, quit): the newest of each of the
 * last KEEP_DAYS days that have one stay; of the older ones, the newest of each of the KEEP_WEEKS
 * weeks before; everything else goes. Of the safety snapshots, the newest KEEP_SAFETY stay.
 */
export function snapshotsToDelete(all: Snapshot[]): Snapshot[] {
  const ordinary = all.filter((s) => s.kind !== 'safety').sort((a, b) => b.at - a.at)
  const keep = new Set<string>()
  const days: string[] = []
  const byDay = new Set<string>()
  for (const s of ordinary) {
    const d = dayKey(s.at)
    if (byDay.has(d)) continue
    if (days.length >= KEEP_DAYS) break
    byDay.add(d)
    days.push(d)
    keep.add(s.name)
  }
  const oldestDay = days.at(-1)
  const weeks = new Set<string>()
  for (const s of ordinary) {
    if (keep.has(s.name) || (oldestDay && dayKey(s.at) >= oldestDay)) continue
    const w = weekKey(s.at)
    if (weeks.has(w)) continue
    if (weeks.size >= KEEP_WEEKS) break
    weeks.add(w)
    keep.add(s.name)
  }
  const safety = all.filter((s) => s.kind === 'safety').sort((a, b) => b.at - a.at)
  for (const s of safety.slice(0, KEEP_SAFETY)) keep.add(s.name)
  return all.filter((s) => !keep.has(s.name))
}

// ---------- When ----------

/** The newest snapshot that isn't a safety one */
export const newestBackup = (all: Snapshot[]): Snapshot | null => all.filter((s) => s.kind !== 'safety').sort((a, b) => b.at - a.at)[0] ?? null

/** The nightly backup is due: none yet today, and it's past NIGHTLY_HOUR */
export function nightlyDue(last: number | null, now: number): boolean {
  if (new Date(now).getHours() < NIGHTLY_HOUR) return false
  return !last || dayKey(last) !== dayKey(now)
}

/** A backup is due on quit: none in the last 24 hours */
export const quitDue = (last: number | null, now: number) => !last || now - last >= QUIT_AFTER_MS

/** "12.4 MB" */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`
}

export const KIND_LABEL: Record<BackupKind, string> = { daily: 'Nightly', manual: 'By hand', quit: 'On quit', safety: 'Before a restore' }
