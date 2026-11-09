/**
 * The coach: your goal and focus, a week planned towards them, and today's agenda. The model
 * decides priorities and the week; code supplies the facts (next topics in each roadmap, weak
 * spots, deadlines) and checks the plan only uses topics that really exist.
 */
import { parseOutline, topicTitle, normalizeTitle } from './outline'

export interface CoachSettings {
  /** In one or two sentences, where all of this is heading, in your words (overrides `direction`) */
  goal: string
  /** Where Tide works out you're heading, from your notebooks, goals, memories and study */
  direction?: string
  /** When `direction` was last worked out (ms) */
  directionAt?: number
  /** Notebooks to focus on, most important first */
  focus: string[]
  hoursPerWeek: number
  /** Days of the week to study, 0 = Sunday */
  days: number[]
}

/** Where the learner is heading: what they wrote, else what Tide inferred */
export const aimOf = (s: Pick<CoachSettings, 'goal' | 'direction'>) => s.goal.trim() || s.direction?.trim() || ''

export const DEFAULT_COACH: CoachSettings = { goal: '', focus: [], hoursPerWeek: 10, days: [1, 2, 3, 4, 5, 6] }

export type AgendaKind = 'learn' | 'practice' | 'quiz' | 'review' | 'take-home' | 'test'

export interface AgendaItem {
  kind: AgendaKind
  title: string
  /** The roadmap topic it covers, exactly as in the roadmap */
  topic?: string
  notebook?: string
  minutes: number
  /** Why this, now: one line */
  why?: string
  readings?: { title: string; by?: string; url?: string }[]
  /** Ticked off, by you or by finishing it in Tide */
  done?: boolean
  /** Moved here from an earlier day you didn't get to */
  carried?: boolean
}

export interface WeekPlan {
  weekStart: string
  createdAt: number
  /** The reasoning: what comes first and why */
  summary: string
  priorities: { notebook: string; share: number; reason: string }[]
  days: { date: string; items: AgendaItem[] }[]
  thingsProject?: string
  /** Unfinished items that ran past the end of this plan, for the next one to pick up */
  carry?: AgendaItem[]
}

/** Today's date where you are (yyyy-mm-dd), not in UTC: an evening wrap-up belongs to today */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const plusDays = (date: string, n: number) => {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The next study day after a date */
export function nextStudyDay(date: string, days: number[]): string {
  for (let i = 1; i <= 7; i++) {
    const d = plusDays(date, i)
    if (days.includes(new Date(d + 'T12:00:00Z').getUTCDay())) return d
  }
  return plusDays(date, 1)
}

/**
 * Moves a day's unfinished items to another day: into the plan if that day is in it (first in
 * the list, since they're overdue), otherwise into the plan's carry for next week's plan.
 */
export function moveUnfinished(plan: WeekPlan, from: string, to: string): { plan: WeekPlan; moved: AgendaItem[] } {
  const day = plan.days.find((d) => d.date === from)
  const moved = (day?.items ?? []).filter((it) => !it.done).map((it) => ({ ...it, carried: true }))
  if (!moved.length) return { plan, moved }
  const end = plusDays(plan.weekStart, 6)
  const days = plan.days.map((d) => (d.date === from ? { ...d, items: d.items.filter((it) => it.done) } : d))
  if (to > end) return { plan: { ...plan, days, carry: [...(plan.carry ?? []), ...moved] }, moved }
  const target = days.find((d) => d.date === to)
  const next = target ? days.map((d) => (d === target ? { ...d, items: [...moved, ...d.items] } : d)) : [...days, { date: to, items: moved }].sort((a, b) => a.date.localeCompare(b.date))
  return { plan: { ...plan, days: next }, moved }
}

export interface DayStats {
  date: string
  minutes: number
  answers: number
  right: number
  cards: number
  notes: string[]
  topics: string[]
  mistakes: number
  planned: number
  done: number
}

export interface JournalEntry {
  date: string
  text: string
  stats: DayStats
}

export interface WeekReview {
  end: string
  days: DayStats[]
  minutes: number
  byNotebook: { notebook: string; minutes: number; answers: number; right: number; notes: number }[]
  planned: number
  done: number
  mistakesAdded: number
  mistakesFixed: number
  journal: JournalEntry[]
  wentWell?: string
  inTheWay?: string
  change?: string
}

/** Plan completion over the days up to and including a date */
export function planCompletion(plan: WeekPlan | null, until: string): { planned: number; done: number } {
  const days = plan?.days.filter((d) => d.date <= until) ?? []
  const items = days.flatMap((d) => d.items)
  return { planned: items.length, done: items.filter((it) => it.done).length }
}

export interface TopicCandidate {
  notebook: string
  topic: string
  section: string
}

/** The next unfinished topics in a roadmap, in order, with the section each sits in */
export function nextTopics(notebook: string, outlineMd: string, n = 12): TopicCandidate[] {
  const { lines } = parseOutline(outlineMd)
  const out: TopicCandidate[] = []
  let section = ''
  for (const l of lines) {
    if (l.kind === 'heading' && l.level >= 2) section = l.text.replace(/\s+[—–]\s+[A-Z][A-Z ,/&]+$/, '').replace(/\s+[—–]\s+\d.*$/, '')
    if (l.kind === 'item' && l.checked === false && !/^(Exam|Project|Practice):/i.test(l.text)) {
      out.push({ notebook, topic: topicTitle(l.text), section })
      if (out.length >= n) break
    }
  }
  return out
}

/** Monday of the week containing the date (yyyy-mm-dd) */
export function weekStartOf(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

const KINDS: AgendaKind[] = ['learn', 'practice', 'quiz', 'review', 'take-home', 'test']

/**
 * Cleans a model's week: only real dates in this week, only study days, known kinds, sane
 * minutes, and "learn" items only for topics that exist in the focus roadmaps (matched loosely,
 * then renamed to the roadmap's exact wording).
 */
export function validateWeek(raw: Partial<WeekPlan> | null, weekStart: string, candidates: TopicCandidate[], settings: CoachSettings): WeekPlan | null {
  if (!raw || !Array.isArray(raw.days)) return null
  // Models paraphrase topic names ("&" for "and", a word dropped): match on shared words
  const words = (t: string) => new Set(t.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && w !== 'the'))
  const findTopic = (t?: string) => {
    if (!t) return undefined
    const k = normalizeTitle(t)
    const exact = candidates.find((c) => normalizeTitle(c.topic) === k)
    if (exact) return exact
    const want = words(t)
    let best: TopicCandidate | undefined
    let bestScore = 0
    for (const c of candidates) {
      const got = words(c.topic)
      const shared = [...want].filter((w) => got.has(w)).length
      const score = shared / Math.max(want.size, got.size, 1)
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    }
    return bestScore >= 0.7 ? best : undefined
  }
  const dates = new Set(Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  }))
  const days = raw.days
    .filter((d) => d && typeof d.date === 'string' && dates.has(d.date) && settings.days.includes(new Date(d.date + 'T12:00:00Z').getUTCDay()))
    .map((d) => ({
      date: d.date,
      items: (Array.isArray(d.items) ? d.items : [])
        .filter((it) => it && KINDS.includes(it.kind) && typeof it.title === 'string' && it.title.trim())
        .map((it) => {
          const match = findTopic(it.topic ?? (it.kind === 'learn' ? it.title : undefined))
          return {
            kind: it.kind,
            title: it.title.trim().slice(0, 140),
            ...(match ? { topic: match.topic, notebook: match.notebook } : it.notebook && settings.focus.includes(it.notebook) ? { notebook: it.notebook } : {}),
            minutes: Math.max(10, Math.min(180, Math.round(Number(it.minutes) || 45))),
            ...(it.why ? { why: String(it.why).trim().slice(0, 200) } : {})
          } as AgendaItem
        })
        // A "learn" item must be a real topic from the roadmaps
        .filter((it) => it.kind !== 'learn' || it.topic)
        .slice(0, 6)
    }))
    .filter((d) => d.items.length)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!days.length) return null
  // Keep each day inside the learner's budget (models over-fill days): scale minutes down to fit
  const perDay = (settings.hoursPerWeek * 60) / Math.max(1, settings.days.length)
  for (const d of days) {
    const total = d.items.reduce((n, it) => n + it.minutes, 0)
    if (total > perDay * 1.2) {
      const k = (perDay * 1.1) / total
      d.items = d.items.map((it) => ({ ...it, minutes: Math.max(10, Math.round((it.minutes * k) / 5) * 5) }))
    }
  }
  let priorities = (Array.isArray(raw.priorities) ? raw.priorities : [])
    .filter((p) => p && settings.focus.includes(p.notebook))
    .map((p) => ({ notebook: p.notebook, share: Math.max(0, Math.min(100, Math.round(Number(p.share) || 0))), reason: String(p.reason ?? '').trim().slice(0, 300) }))
  // No priorities from the model: the split is however the planned time falls
  if (!priorities.length) {
    const mins = new Map<string, number>()
    for (const d of days) for (const it of d.items) if (it.notebook) mins.set(it.notebook, (mins.get(it.notebook) ?? 0) + it.minutes)
    const all = [...mins.values()].reduce((a, b) => a + b, 0)
    priorities = [...mins.entries()].sort((a, b) => b[1] - a[1]).map(([notebook, m]) => ({ notebook, share: Math.round((m / Math.max(1, all)) * 100), reason: '' }))
  }
  return { weekStart, createdAt: Date.now(), summary: String(raw.summary ?? '').trim().slice(0, 800), priorities, days }
}

/** The title a planned item's to-do has in Things 4 */
export const thingsTitle = (it: Pick<AgendaItem, 'kind' | 'title'>) => `${it.kind === 'learn' ? '' : `${it.kind[0].toUpperCase()}${it.kind.slice(1)}: `}${it.title}`.slice(0, 250)

export function todayItems(plan: WeekPlan | null, date: string): AgendaItem[] {
  return plan?.days.find((d) => d.date === date)?.items ?? []
}

const dayName = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
const KIND_LABEL: Record<AgendaKind, string> = { learn: 'Learn', practice: 'Practise', quiz: 'Quiz', review: 'Review', 'take-home': 'Take-home', test: 'Test' }

/** The week as a note you can read and edit */
export function weekMarkdown(plan: WeekPlan): string {
  const out = [`# Week of ${dayName(plan.weekStart)}`, '', plan.summary, '']
  if (plan.priorities.length) out.push('## Priorities', '', ...plan.priorities.map((p) => `- **${p.notebook}** (${p.share}%): ${p.reason}`), '')
  for (const d of plan.days) {
    out.push(`## ${dayName(d.date)}`, '')
    for (const it of d.items) {
      out.push(`- [${it.done ? 'x' : ' '}] **${KIND_LABEL[it.kind]}:** ${it.topic && it.kind === 'learn' ? `[[${it.topic}]]` : it.title} (${it.minutes} min)${it.why ? ` — ${it.why}` : ''}`)
      for (const r of it.readings ?? []) out.push(`    - ${r.url ? `[${r.title}](${r.url})` : r.title}${r.by ? `, ${r.by}` : ''}`)
    }
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
