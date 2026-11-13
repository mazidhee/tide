/**
 * Points for building: a milestone done is worth most (more the higher its tier), a ready check
 * passed and a debrief written count too. Days with project work make a streak; points make
 * levels, each with a title. A new level, a tier opening and a milestone done are celebrated with
 * the morning workout's pixel party (components/workout/PartyScene). Pure; main/ideaProjects keeps
 * the record in the notes (.tide/projects/score.json).
 */
import type { Tier } from './ideaLadder'

export type ScoreKind = 'milestone' | 'ready' | 'debrief' | 'project'

export interface ScoreEvent {
  at: number
  kind: ScoreKind
  points: number
  project: string
  /** What it was for, in words */
  label: string
}

export interface ScoreRecord {
  events: ScoreEvent[]
  /** Days (yyyy-mm-dd) with project work */
  days: string[]
  /** Tiers seen open, by area, so a newly opened one is celebrated once */
  opened: Record<string, number>
}

export const emptyScore = (): ScoreRecord => ({ events: [], days: [], opened: {} })

/** What each thing is worth: a milestone by its tier; a ready check more on the first try */
export function pointsFor(kind: ScoreKind, o: { tier?: Tier; firstTry?: boolean } = {}): number {
  const tier = o.tier ?? 2
  if (kind === 'milestone') return 50 * tier
  if (kind === 'ready') return o.firstTry ? 30 : 15
  if (kind === 'debrief') return 25
  return 10
}

export const LEVELS: { at: number; title: string }[] = [
  { at: 0, title: 'Apprentice' },
  { at: 150, title: 'Builder' },
  { at: 450, title: 'Engineer' },
  { at: 1000, title: 'Senior engineer' },
  { at: 2000, title: 'Staff engineer' },
  { at: 3500, title: 'Principal engineer' },
  { at: 6000, title: 'Architect' }
]

export function levelOf(points: number): { level: number; title: string; next: { at: number; title: string } | null; progress: number } {
  let i = 0
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1].at) i++
  const next = LEVELS[i + 1] ?? null
  return { level: i + 1, title: LEVELS[i].title, next, progress: next ? (points - LEVELS[i].at) / (next.at - LEVELS[i].at) : 1 }
}

export const totalPoints = (r: Pick<ScoreRecord, 'events'>) => r.events.reduce((n, e) => n + e.points, 0)

const prevDay = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() - 1)
  return t.toISOString().slice(0, 10)
}

/** Days in a row with project work, ending today or yesterday (a streak lasts until a day is missed) */
export function streakOf(days: string[], today: string): number {
  const set = new Set(days)
  let d = set.has(today) ? today : prevDay(today)
  let n = 0
  while (set.has(d)) {
    n++
    d = prevDay(d)
  }
  return n
}

export interface Celebration {
  kind: 'party' | 'done' | 'streak'
  title: string
  line: string
}

/**
 * Points added, the day counted, and what to celebrate: a new level (a party), else a streak
 * milestone (3, 7, 14, 30 days), else a milestone done (the quieter scene).
 */
export function addScore(r: ScoreRecord, e: ScoreEvent, today: string): { record: ScoreRecord; celebrate: Celebration | null } {
  const before = levelOf(totalPoints(r))
  const record: ScoreRecord = { ...r, events: [...r.events, e].slice(-2000), days: r.days.includes(today) ? r.days : [...r.days, today].slice(-800) }
  const after = levelOf(totalPoints(record))
  const streak = streakOf(record.days, today)
  const newDay = !r.days.includes(today)
  if (after.level > before.level) return { record, celebrate: { kind: 'party', title: after.title.toUpperCase(), line: `Level ${after.level}: ${after.title}. +${e.points} for ${e.label}.` } }
  if (newDay && [3, 7, 14, 30, 60, 100].includes(streak)) return { record, celebrate: { kind: 'streak', title: `${streak} DAYS`, line: `${streak} days in a row building. +${e.points} for ${e.label}.` } }
  if (e.kind === 'milestone') return { record, celebrate: { kind: 'done', title: `+${e.points}`, line: `${e.label}.` } }
  return { record, celebrate: null }
}

/** A tier newly open in an area, celebrated once */
export function newlyOpened(r: ScoreRecord, open: Record<string, number>): { record: ScoreRecord; opened: { area: string; tier: number }[] } {
  const opened = Object.entries(open)
    .filter(([a, t]) => t > (r.opened[a] ?? 1))
    .map(([area, tier]) => ({ area, tier }))
  return { record: { ...r, opened: { ...r.opened, ...open } }, opened }
}
