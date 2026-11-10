/**
 * tide:// links: a task in Things 4 (or anywhere) can open Tide exactly where the work is, such as
 * the exam to sit, the note to read, the drill to run. Building and reading them live here so both
 * sides agree.
 */

export type DeepLink =
  | { to: 'open'; path: string }
  | { to: 'notebook'; path: string }
  | { to: 'exam'; topic: string; scope?: string; difficulty?: 'gentle' | 'normal' | 'hard' | 'olympiad'; style?: 'university' | 'problems' | 'short'; questions?: number; minutes?: number }
  | { to: 'session'; mode: 'teach' | 'quiz' | 'recall' | 'interview'; topic: string; scope?: string; round?: 'coding' | 'design' | 'behavioural' | 'quant'; company?: string }
  | { to: 'practice'; tab?: string }
  | { to: 'drill'; kind: 'zetamac' | 'eighty' }
  | { to: 'design'; path?: string; topic?: string; start?: 'teach' | 'interview' }
  /** An item of your week, opened as the week opens it (a Check, a refresher) */
  | { to: 'agenda'; date: string; index: number }

export function buildLink(l: DeepLink): string {
  const { to, ...rest } = l
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== '') q.set(k, String(v))
  const qs = q.toString()
  return `tide://${to}${qs ? `?${qs}` : ''}`
}

const num = (v: string | null, lo: number, hi: number) => (v && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : undefined)
const oneOf = <T extends string>(v: string | null, xs: readonly T[]): T | undefined => (xs as readonly string[]).includes(v ?? '') ? (v as T) : undefined
/** Vault paths only: no absolute paths, no climbing out of the vault */
const safePath = (p: string | null) => (p && !p.startsWith('/') && !p.split('/').includes('..') ? p : undefined)

export function parseLink(url: string): DeepLink | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'tide:') return null
  const to = (u.hostname || u.pathname.replace(/^\/+/, '').split('/')[0]).toLowerCase()
  const g = (k: string) => u.searchParams.get(k)
  switch (to) {
    case 'open':
    case 'notebook': {
      const path = safePath(g('path'))
      return path ? { to, path } : null
    }
    case 'exam': {
      const topic = g('topic')?.slice(0, 200)
      if (!topic) return null
      return {
        to,
        topic,
        ...(g('scope') ? { scope: g('scope')!.slice(0, 300) } : {}),
        ...(oneOf(g('difficulty'), ['gentle', 'normal', 'hard', 'olympiad'] as const) ? { difficulty: oneOf(g('difficulty'), ['gentle', 'normal', 'hard', 'olympiad'] as const) } : {}),
        ...(oneOf(g('style'), ['university', 'problems', 'short'] as const) ? { style: oneOf(g('style'), ['university', 'problems', 'short'] as const) } : {}),
        ...(num(g('questions'), 1, 20) ? { questions: num(g('questions'), 1, 20) } : {}),
        ...(num(g('minutes'), 5, 240) ? { minutes: num(g('minutes'), 5, 240) } : {})
      }
    }
    case 'session': {
      const mode = oneOf(g('mode'), ['teach', 'quiz', 'recall', 'interview'] as const)
      const topic = g('topic')?.slice(0, 200)
      if (!mode || !topic) return null
      const round = oneOf(g('round'), ['coding', 'design', 'behavioural', 'quant'] as const)
      return { to, mode, topic, ...(g('scope') ? { scope: g('scope')!.slice(0, 300) } : {}), ...(round ? { round } : {}), ...(g('company') ? { company: g('company')!.slice(0, 80) } : {}) }
    }
    case 'practice':
      return { to, ...(g('tab') ? { tab: g('tab')!.slice(0, 20) } : {}) }
    case 'drill': {
      const kind = oneOf(g('kind'), ['zetamac', 'eighty'] as const)
      return kind ? { to, kind } : null
    }
    case 'agenda': {
      const date = g('date') ?? ''
      const index = num(g('index'), 0, 50)
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && index !== undefined ? { to, date, index } : null
    }
    case 'design': {
      const start = oneOf(g('start'), ['teach', 'interview'] as const)
      return { to, ...(safePath(g('path')) ? { path: safePath(g('path')) } : {}), ...(g('topic') ? { topic: g('topic')!.slice(0, 200) } : {}), ...(start ? { start } : {}) }
    }
    default:
      return null
  }
}

/** "folder:Machine Learning", "note:ML/Backprop.md", "vault", "none" → a scope */
export function scopeFromLink(s?: string): { kind: 'vault' } | { kind: 'none' } | { kind: 'folder'; path: string } | { kind: 'note'; path: string } {
  if (!s || s === 'none') return { kind: 'none' }
  if (s === 'vault') return { kind: 'vault' }
  const [kind, ...rest] = s.split(':')
  const path = safePath(rest.join(':'))
  if (path && kind === 'folder') return { kind: 'folder', path }
  if (path && kind === 'note') return { kind: 'note', path }
  return { kind: 'none' }
}
