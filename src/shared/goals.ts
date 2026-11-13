/**
 * Goals: what you're working towards, with or without a date ("Bloomberg SWE interview, mid-March",
 * "Ship the payment rail", "Get strong at ML"). Each is broken down into what it needs, drawn from
 * what Tide already has (roadmaps, projects, kinds of mock, workout rounds, books) or a topic with
 * no roadmap yet. Every roadmap and project in progress is also a standing goal with no date, so
 * nothing is forgotten. The needs become threads for the portfolio scheduler (shared/portfolio).
 *
 * Everything here is pure: the store, the model and the facts live in main/goals.
 */
import type { AimWeight } from './coach'
import type { MockMode } from './mocks'
import { addDays, daysBetween, weeksTo, type Thread, type ThreadKind } from './portfolio'

export type GoalWeight = AimWeight

/** How much a goal pulls on the week */
export const WEIGHT_VALUE: Record<GoalWeight, number> = { main: 3, side: 1.5, curious: 0.6 }

export interface GoalNeed {
  id: string
  kind: ThreadKind
  /** What it links to: a roadmap's notebook, a project's notebook, a mock's kind, a workout round, a book's path; a topic's own title */
  ref: string
  /** What it covers, in a few words */
  label: string
  /** Hours it needs, from where you are now */
  hours: number
  /** Sections of the roadmap it needs, when not all of it */
  sections?: string[]
  /** Depth you could drop if time is short ("C++ depth") */
  optional?: boolean
  /** Another need to make progress on first (its id) */
  after?: string
  why?: string
  /** You dropped it to make the goal fit */
  dropped?: boolean
}

export interface PlanGoal {
  id: string
  title: string
  /** The date it's for (yyyy-mm-dd), if there is one */
  date?: string
  weight: GoalWeight
  needs: GoalNeed[]
  /** Tide's reasoning about what it takes, in a few sentences */
  summary?: string
  /** Who broke it down */
  by?: 'claude' | 'gemma' | 'tide' | 'you'
  createdAt: number
  /** Set aside until a date */
  pausedUntil?: string
  /** An ongoing interest worked out from your roadmaps and projects, not added by you */
  standing?: boolean
  /** Paused with no end */
  off?: boolean
}

export interface GoalsStore {
  version: 1
  goals: PlanGoal[]
  /** Standing goals you've changed: their weight or a pause, by thread id */
  standing: Record<string, { weight?: GoalWeight; pausedUntil?: string; off?: boolean }>
  /** Your aims have been brought in as goals */
  migrated?: boolean
}

export const EMPTY_GOALS: GoalsStore = { version: 1, goals: [], standing: {} }

/** What Tide has to draw a goal's needs from */
export interface Inventory {
  roadmaps: { name: string; left: number; total: number; sections: string[] }[]
  projects: { name: string; notebook: string; current?: string; hoursLeft: number; done: number; total: number }[]
  mocks: { id: MockMode; label: string }[]
  rounds: { id: string; label: string }[]
  books: { title: string; path: string; progress?: number }[]
}

export const threadId = (kind: ThreadKind, ref: string) => `${kind}:${ref.trim().toLowerCase()}`
export const needThread = (n: Pick<GoalNeed, 'kind' | 'ref'>) => threadId(n.kind, n.ref)

const uid = () => Math.random().toString(36).slice(2, 10)

// ---------- Dates ----------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthIn = (t: string) => MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}(${m.slice(3)})?\\b`, 'i').test(t))
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())).padStart(2, '0')}`

/**
 * A date from how people say it: "2026-03-15", "15 March", "March 15", "mid-March", "early April",
 * "end of March", "by March", "in 10 weeks", "in 2 months", "in a couple of months". The next
 * such date after today. Null when the text names none.
 */
export function parseGoalDate(text: string, today: string): string | null {
  const t = text.toLowerCase()
  const exact = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (exact) return exact[0]
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, couple: 2, few: 3 }
  const rel = t.match(/\bin\s+(?:about\s+|around\s+)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|a couple of|a few)\s+(day|week|month)s?\b/)
  if (rel) {
    const raw = rel[1].replace(/^a (couple|few) of$/, '$1')
    const n = Number(raw) || words[raw] || words[raw.split(' ').pop()!] || 1
    if (rel[2] === 'day') return addDays(today, n)
    if (rel[2] === 'week') return addDays(today, n * 7)
    const d = new Date(today + 'T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + n)
    return d.toISOString().slice(0, 10)
  }
  const m = monthIn(t)
  if (m < 0) return null
  const year = Number(today.slice(0, 4))
  const day = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTHS[m].slice(0, 3)}|${MONTHS[m].slice(0, 3)}[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'))
  const d = day ? Number(day[1] ?? day[2]) : /\bmid/.test(t) ? 15 : /\bearly\b|\bstart\b|\bbeginning\b/.test(t) ? 5 : /\blate\b|\bend\b/.test(t) ? 28 : /\bby\b|\bbefore\b/.test(t) ? 1 : 15
  let date = iso(year, m, d)
  if (date <= today) date = iso(year + 1, m, d)
  return date
}

// ---------- Breaking a goal down ----------

const KINDS: ThreadKind[] = ['roadmap', 'project', 'mock', 'workout', 'reading', 'topic']

/** The prompt for breaking a goal down, with everything Tide has to draw from */
export function decomposePrompt(goal: { title: string; date?: string; notes?: string }, inv: Inventory, o: { today: string; hoursPerWeek: number; profile?: string }): string {
  const list = (xs: string[]) => (xs.length ? xs.join('\n') : '  (none)')
  return `A learner wants help reaching a goal. Today is ${o.today}; they study about ${o.hoursPerWeek} hours a week across everything they're working on.

Goal: ${goal.title}${goal.date ? `\nDate: ${goal.date}` : ''}${goal.notes ? `\nTheir notes: ${goal.notes}` : ''}
${o.profile ? `\nWhat Tide knows about them:\n${o.profile.slice(0, 1200)}\n` : ''}
What Tide already has to draw from (link to these by their exact names):
Roadmaps (topics left of total, then sections):
${list(inv.roadmaps.map((r) => `  - ${r.name} (${r.left} of ${r.total} left): ${r.sections.slice(0, 10).join('; ')}`))}
Projects (notebook, milestones done, hours left):
${list(inv.projects.map((p) => `  - ${p.name} [${p.notebook}] ${p.done}/${p.total} milestones, about ${p.hoursLeft} h left${p.current ? `, now on: ${p.current}` : ''}`))}
Mock interview kinds: ${inv.mocks.map((m) => `${m.id} (${m.label})`).join(', ')}
Morning workout rounds: ${inv.rounds.map((r) => `${r.id} (${r.label})`).join(', ')}
Books on their shelf:
${list(inv.books.map((b) => `  - ${b.title} [${b.path}]`))}

Think it through like an expert mentor: what does reaching this goal really take, for this learner, by this date? Break it into 3 to 8 needs. Each need links to one thing above (a roadmap and the sections of it that matter, a project, a kind of mock, a workout round, a book), or is a "topic" with no roadmap yet when nothing above covers it. Estimate honest hours from where they are now. Mark depth that could be dropped if time runs short as optional. Say which need should come after another, if one really builds on it.

Return ONLY JSON:
{"date": "yyyy-mm-dd if the goal names or implies a date, else null",
 "summary": "2 or 3 plain sentences to the learner: what it takes and the order to go in",
 "needs": [{"kind": "roadmap|project|mock|workout|reading|topic", "ref": "exact roadmap name, project notebook, mock kind, round id or book path; for a topic, its short title", "label": "what it covers, a few words", "hours": 12, "sections": ["roadmap sections it needs, if not all"], "optional": false, "after": "label of the need it builds on, or null", "why": "one short line"}]}`
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim()

/** The inventory item a model's ref names, matched loosely; null when it names nothing Tide has */
function resolveRef(kind: ThreadKind, ref: string, inv: Inventory): string | null {
  const r = norm(ref)
  if (!r) return null
  const pick = (names: string[]) => names.find((n) => norm(n) === r) ?? names.find((n) => norm(n).includes(r) || r.includes(norm(n)))
  if (kind === 'roadmap') return pick(inv.roadmaps.map((x) => x.name)) ?? null
  if (kind === 'project') {
    const p = inv.projects.find((x) => norm(x.notebook) === r || norm(x.name) === r) ?? inv.projects.find((x) => norm(x.name).includes(r) || r.includes(norm(x.name)))
    return p?.notebook ?? null
  }
  if (kind === 'mock') return inv.mocks.find((m) => r.includes(m.id) || norm(m.label) === r)?.id ?? null
  if (kind === 'workout') return inv.rounds.find((m) => r.includes(m.id) || norm(m.label) === r)?.id ?? null
  if (kind === 'reading') return inv.books.find((b) => norm(b.path) === r || norm(b.title) === r || norm(b.title).includes(r))?.path ?? null
  return ref.trim().slice(0, 80)
}

const labelOf = (kind: ThreadKind, ref: string, inv: Inventory) =>
  kind === 'project' ? (inv.projects.find((p) => p.notebook === ref)?.name ?? ref) : kind === 'mock' ? (inv.mocks.find((m) => m.id === ref)?.label ?? ref) : kind === 'workout' ? (inv.rounds.find((r) => r.id === ref)?.label ?? ref) : kind === 'reading' ? (inv.books.find((b) => b.path === ref)?.title ?? ref) : ref

export interface Decomposition {
  date: string | null
  summary: string
  needs: GoalNeed[]
}

/**
 * Reads a model's breakdown: only kinds Tide knows, refs that exist (a roadmap or project it made
 * up becomes a topic), sane hours, no duplicates, prerequisites resolved to ids. Null when there's
 * nothing usable.
 */
export function parseDecomposition(raw: unknown, inv: Inventory, today: string): Decomposition | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { date?: unknown; summary?: unknown; needs?: unknown }
  if (!Array.isArray(o.needs)) return null
  const needs: (GoalNeed & { afterLabel?: string })[] = []
  const seen = new Set<string>()
  for (const n of o.needs.slice(0, 12)) {
    if (!n || typeof n !== 'object') continue
    const x = n as Record<string, unknown>
    let kind = (KINDS as string[]).includes(String(x.kind)) ? (String(x.kind) as ThreadKind) : 'topic'
    const label = String(x.label ?? x.ref ?? '').trim().slice(0, 80)
    let ref = resolveRef(kind, String(x.ref ?? ''), inv)
    // Something Tide doesn't have: a topic to learn, under the model's label
    if (!ref) {
      kind = 'topic'
      ref = (label || String(x.ref ?? '')).trim().slice(0, 80)
    }
    if (!ref) continue
    const key = `${kind}:${norm(ref)}:${kind === 'roadmap' ? norm(label) : ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const hours = Math.max(1, Math.min(300, Math.round(Number(x.hours) || 10)))
    const sections = Array.isArray(x.sections) && kind === 'roadmap' ? x.sections.map(String).filter((s) => inv.roadmaps.find((r) => r.name === ref)?.sections.some((t) => norm(t) === norm(s))).slice(0, 12) : []
    needs.push({
      id: uid(),
      kind,
      ref,
      label: label || labelOf(kind, ref, inv),
      hours,
      ...(sections.length ? { sections } : {}),
      ...(x.optional === true ? { optional: true } : {}),
      ...(typeof x.why === 'string' && x.why.trim() ? { why: x.why.trim().slice(0, 160) } : {}),
      ...(typeof x.after === 'string' && x.after.trim() && x.after !== 'null' ? { afterLabel: x.after.trim() } : {})
    })
  }
  if (!needs.length) return null
  // Prerequisites by label, to ids; never itself
  for (const n of needs) {
    if (!n.afterLabel) continue
    const before = needs.find((m) => m !== n && (norm(m.label) === norm(n.afterLabel!) || norm(m.ref) === norm(n.afterLabel!)))
    if (before) n.after = before.id
    delete n.afterLabel
  }
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date > today ? o.date : null
  return { date, summary: typeof o.summary === 'string' ? o.summary.trim().slice(0, 600) : '', needs: needs.map(({ afterLabel: _, ...n }) => n) }
}

const HOURS_PER_TOPIC = 2.5

/**
 * The breakdown without a model: words in the goal matched against roadmaps, projects and books;
 * an interview brings mocks; a goal that matches nothing is a topic to learn.
 */
export function guessNeeds(title: string, inv: Inventory): Decomposition {
  const t = norm(title)
  const words = new Set(t.split(' ').filter((w) => w.length >= 3))
  const needs: GoalNeed[] = []
  const add = (kind: ThreadKind, ref: string, label: string, hours: number, extra: Partial<GoalNeed> = {}) => needs.push({ id: uid(), kind, ref, label, hours: Math.max(1, Math.round(hours)), ...extra })
  const shares = (name: string) => norm(name).split(' ').filter((w) => w.length >= 3 && words.has(w)).length
  const interview = /\binterview|\bswe\b|\bjob\b|\boffer\b|leetcode/.test(t)
  for (const r of inv.roadmaps) {
    const hit = shares(r.name) > 0 || r.sections.some((s) => shares(s) > 0) || (interview && /algorithm|data struct|leetcode|system design|software/i.test(r.name))
    if (hit && r.left) add('roadmap', r.name, r.name, Math.min(80, r.left * HOURS_PER_TOPIC))
  }
  for (const p of inv.projects) if (shares(p.name) > 0 || shares(p.notebook.split('/').pop() ?? '') > 0) add('project', p.notebook, p.name, p.hoursLeft || 10)
  if (interview) {
    add('mock', 'coding', inv.mocks.find((m) => m.id === 'coding')?.label ?? 'Coding', 8)
    if (/\bswe\b|software|engineer|system design/.test(t)) add('mock', 'design', inv.mocks.find((m) => m.id === 'design')?.label ?? 'System design', 6)
    add('mock', 'behavioural', inv.mocks.find((m) => m.id === 'behavioural')?.label ?? 'Behavioural', 3, { optional: true })
    if (/quant|trading|finance|bloomberg|bank/.test(t)) add('mock', 'quant', inv.mocks.find((m) => m.id === 'quant')?.label ?? 'Quant', 4, { optional: true })
  }
  for (const b of inv.books) if (shares(b.title) > 0) add('reading', b.path, b.title, 6, { optional: true })
  if (!needs.length) add('topic', title.trim().slice(0, 80), title.trim().slice(0, 80), 20)
  return { date: null, summary: '', needs: needs.slice(0, 8) }
}

// ---------- Goals into threads ----------

/** Activity on each thread: what was done, when, for how long */
export interface ThreadLog {
  thread: string
  date: string
  minutes: number
}

/** A roadmap or project in progress, for the standing goals */
export interface InProgress {
  kind: 'roadmap' | 'project'
  ref: string
  label: string
  /** Hours left in it, roughly */
  hoursLeft: number
}

/** Your goals, then a standing goal for each roadmap and project in progress that no goal of yours already covers */
export function withStanding(store: GoalsStore, inProgress: InProgress[], now: number): PlanGoal[] {
  const covered = new Set(store.goals.flatMap((g) => g.needs.filter((n) => !n.dropped).map(needThread)))
  const standing = inProgress
    .filter((p) => !covered.has(threadId(p.kind, p.ref)))
    .map((p): PlanGoal => {
      const id = threadId(p.kind, p.ref)
      const own = store.standing[id] ?? {}
      return {
        id,
        title: p.label,
        weight: own.weight ?? 'side',
        needs: [{ id: `${id}:all`, kind: p.kind, ref: p.ref, label: p.label, hours: Math.max(1, Math.round(p.hoursLeft)) }],
        createdAt: now,
        standing: true,
        ...(own.pausedUntil ? { pausedUntil: own.pausedUntil } : {}),
        ...(own.off ? { off: true } : {})
      }
    })
  return [...store.goals, ...standing]
}

const SHAPE: Record<ThreadKind, { session: number; touch: number; hard: boolean }> = {
  roadmap: { session: 45, touch: 20, hard: true },
  topic: { session: 45, touch: 20, hard: true },
  project: { session: 60, touch: 30, hard: true },
  mock: { session: 45, touch: 45, hard: true },
  workout: { session: 15, touch: 15, hard: false },
  reading: { session: 30, touch: 20, hard: false }
}

/** How long a thread may go untouched: a week with a date, ten days standing, a fortnight for something you're only curious about */
export function gapLimit(kind: ThreadKind, dated: boolean, weight: GoalWeight): number {
  if (kind === 'workout') return 3
  if (kind === 'mock') return dated ? 7 : 14
  if (weight === 'curious') return 14
  return dated ? 7 : 10
}

const isPaused = (g: PlanGoal, today: string) => !!g.off || (!!g.pausedUntil && g.pausedUntil > today)

/** Hours spent on a thread since a time */
export const spentOn = (log: ThreadLog[], thread: string, since: string) => log.filter((l) => l.thread === thread && l.date >= since).reduce((n, l) => n + l.minutes, 0) / 60

/**
 * The threads for the scheduler: one per thing worked on, however many goals need it. Its weight
 * is each goal's weight shared across that goal's needs by hours; its date the soonest goal's;
 * hours left what the dated goals still need of it.
 */
export function buildThreads(goals: PlanGoal[], log: ThreadLog[], o: { today: string; fading?: Record<string, number> }): Thread[] {
  const { today } = o
  const out = new Map<string, Thread>()
  const since7 = addDays(today, -7)
  for (const g of goals) {
    const live = g.needs.filter((n) => !n.dropped)
    const totalHours = live.reduce((n, x) => n + x.hours, 0) || 1
    const dated = !!g.date && g.date > today
    const paused = isPaused(g, today)
    const created = new Date(g.createdAt).toISOString().slice(0, 10)
    for (const n of live) {
      const id = needThread(n)
      const shape = SHAPE[n.kind]
      const t: Thread = out.get(id) ?? {
        id,
        label: n.kind === 'roadmap' || n.kind === 'project' ? labelFor(n) : n.kind === 'mock' ? `${n.ref[0].toUpperCase()}${n.ref.slice(1)} mocks` : n.label,
        kind: n.kind,
        weight: 0,
        maxGap: 99,
        ...shape,
        standing: true,
        paused: true
      }
      t.weight += (WEIGHT_VALUE[g.weight] * n.hours) / totalHours * (n.optional ? 0.6 : 1)
      t.maxGap = Math.min(t.maxGap, gapLimit(n.kind, dated, g.weight))
      if (!g.standing) t.standing = false
      if (!paused) t.paused = false
      if (dated && !paused) {
        const left = Math.max(0, n.hours - spentOn(log, id, created))
        if (left > 0) {
          t.hoursLeft = (t.hoursLeft ?? 0) + left
          if (!t.deadline || g.date! < t.deadline) {
            t.deadline = g.date
            t.goal = g.title
          }
        }
      }
      // Waiting on another need that has barely started
      if (n.after) {
        const before = g.needs.find((m) => m.id === n.after && !m.dropped)
        if (before && spentOn(log, needThread(before), created) < 0.3 * before.hours && needThread(before) !== id) t.blockedBy = labelFor(before)
      }
      out.set(id, t)
    }
  }
  for (const t of out.values()) {
    const mine = log.filter((l) => l.thread === t.id)
    const last = mine.reduce<string | undefined>((m, l) => (!m || l.date > m ? l.date : m), undefined)
    if (last) t.lastTouched = last
    t.recent = mine.filter((l) => l.date >= since7).reduce((n, l) => n + l.minutes, 0)
    const f = o.fading?.[t.id]
    if (f) t.fading = f
    // Already under way (studied in the last fortnight): a prerequisite doesn't stop it now
    if (t.blockedBy && last && last >= addDays(today, -14)) delete t.blockedBy
    // A thread something else waits on isn't itself blocked by that
    if (t.blockedBy && [...out.values()].find((x) => x.label === t.blockedBy)?.paused) delete t.blockedBy
  }
  return [...out.values()]
}

const labelFor = (n: Pick<GoalNeed, 'kind' | 'label' | 'ref'>) => (n.kind === 'roadmap' ? n.ref : n.label)

// ---------- Honest trade-offs ----------

export type TradeOption =
  | { kind: 'date'; date: string; label: string }
  | { kind: 'drop'; needs: string[]; saves: number; label: string }
  | { kind: 'hours'; add: number; label: string }
  | { kind: 'pause'; goal: string; until: string; frees: number; label: string }

export interface TradeOff {
  goal: string
  title: string
  date: string
  hoursLeft: number
  /** Hours a week it needs, and hours a week it can have */
  need: number
  have: number
  text: string
  options: TradeOption[]
}

const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const h1 = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1))

/** Hours a week that keep a thread alive at its limit (one touch per limit) */
export const keepAliveHours = (t: Pick<Thread, 'touch' | 'maxGap'>) => (t.touch * (7 / t.maxGap)) / 60

/**
 * Whether your dated goals fit your hours, soonest first: each needs its hours left over its weeks
 * left, after what keeps everything else alive and what sooner goals need. Where one doesn't fit,
 * the honest numbers and the ways out: a later date, dropping optional depth, more hours, or
 * pausing the lightest standing goal until then.
 */
export function tradeOffs(goals: PlanGoal[], threads: Thread[], log: ThreadLog[], o: { today: string; hoursPerWeek: number }): TradeOff[] {
  const { today } = o
  const dated = goals.filter((g) => g.date && g.date > today && !isPaused(g, today) && !g.standing).sort((a, b) => a.date!.localeCompare(b.date!))
  const out: TradeOff[] = []
  let earlier = 0
  for (const g of dated) {
    const mine = new Set(g.needs.filter((n) => !n.dropped).map(needThread))
    const created = new Date(g.createdAt).toISOString().slice(0, 10)
    const left = g.needs.filter((n) => !n.dropped).map((n) => ({ n, left: Math.max(0, n.hours - spentOn(log, needThread(n), created)) }))
    const hoursLeft = left.reduce((s, x) => s + x.left, 0)
    if (hoursLeft <= 0) continue
    const weeks = weeksTo(today, g.date!)
    const need = hoursLeft / weeks
    // Everything else stays alive: other threads' touches (shared threads count as this goal's)
    const keep = threads.filter((t) => !mine.has(t.id) && !t.paused && !t.blockedBy && !(t.deadline && t.deadline < g.date!)).reduce((s, t) => s + keepAliveHours(t), 0)
    const have = Math.max(0, o.hoursPerWeek - keep - earlier)
    earlier += Math.min(need, have)
    if (need <= have * 1.05 + 0.25) continue
    const options: TradeOption[] = []
    if (have >= 0.5) {
      const date = addDays(today, Math.ceil((hoursLeft / have) * 7))
      options.push({ kind: 'date', date, label: `Move the date to ${longDate(date)}` })
    }
    // Optional depth, biggest first, until it fits (or all of it, if even that isn't enough)
    const optional = left.filter((x) => x.n.optional && x.left > 0).sort((a, b) => b.left - a.left)
    const short = hoursLeft - have * weeks
    const drop: typeof optional = []
    for (const x of optional) {
      if (drop.reduce((s, y) => s + y.left, 0) >= short) break
      drop.push(x)
    }
    if (drop.length) {
      const saves = Math.round(drop.reduce((s, y) => s + y.left, 0))
      options.push({ kind: 'drop', needs: drop.map((x) => x.n.id), saves, label: `Drop ${drop.map((x) => x.n.label).join(' and ')} (saves ${saves} h)` })
    }
    const add = Math.ceil(need - have)
    options.push({ kind: 'hours', add, label: `Add ${add} h/week` })
    // The lightest standing goal that isn't part of this one, set aside until the date
    const lightest = goals
      .filter((x) => x.standing && !isPaused(x, today) && !x.needs.some((n) => mine.has(needThread(n))))
      .map((x) => ({ x, t: threads.find((t) => t.id === needThread(x.needs[0])) }))
      .filter((y) => y.t && !y.t.paused)
      .sort((a, b) => a.t!.weight - b.t!.weight)[0]
    if (lightest) {
      const frees = Math.round(keepAliveHours(lightest.t!) * 10) / 10
      options.push({ kind: 'pause', goal: lightest.x.id, until: g.date!, frees, label: `Pause ${lightest.t!.label} until ${longDate(g.date!)} (frees ${h1(frees)} h/week)` })
    }
    out.push({
      goal: g.id,
      title: g.title,
      date: g.date!,
      hoursLeft: Math.round(hoursLeft),
      need: Math.round(need * 10) / 10,
      have: Math.round(have * 10) / 10,
      text: `To be ready by ${longDate(g.date!)} you need about ${h1(Math.round(need * 2) / 2)} h/week; you have ${h1(Math.round(have * 2) / 2)}.`,
      options
    })
  }
  return out
}

// ---------- Drift ----------

export interface Drift {
  goal: string
  thread: string
  label: string
  weeksBehind: number
  text: string
}

/**
 * Where a dated goal's need is behind where steady progress would have it: the hours you'd expect
 * by now against the hours spent, in weeks of its usual pace. Only after a week, and only a week or
 * more behind.
 */
export function driftOf(goals: PlanGoal[], log: ThreadLog[], today: string): Drift[] {
  const out: Drift[] = []
  for (const g of goals) {
    if (!g.date || g.standing || isPaused(g, today) || g.date <= today) continue
    const created = new Date(g.createdAt).toISOString().slice(0, 10)
    const total = Math.max(1, daysBetween(created, g.date))
    const elapsed = daysBetween(created, today)
    if (elapsed < 7) continue
    let worst: Drift | null = null
    for (const n of g.needs.filter((x) => !x.dropped && !x.optional)) {
      const rate = n.hours / (total / 7)
      const expected = n.hours * (elapsed / total)
      const behind = expected - spentOn(log, needThread(n), created)
      const weeks = Math.floor(behind / Math.max(0.1, rate))
      if (weeks >= 1 && (!worst || weeks > worst.weeksBehind))
        worst = { goal: g.id, thread: needThread(n), label: labelFor(n), weeksBehind: weeks, text: `${labelFor(n)} is ${weeks} week${weeks === 1 ? '' : 's'} behind for ${g.title} (${longDate(g.date)}).` }
    }
    if (worst) out.push(worst)
  }
  return out
}

/** Your goals' titles and weights as aims, for what sorts roadmaps against where you're heading */
export function aimsFromGoals(goals: PlanGoal[]): { id: string; text: string; weight: GoalWeight; since: number }[] {
  return goals.filter((g) => !g.standing).map((g) => ({ id: g.id, text: g.title.slice(0, 160), weight: g.weight, since: g.createdAt }))
}

// ---------- The page ----------

export interface GoalRow extends PlanGoal {
  /** Hours left on its needs, and hours a week that takes by its date */
  hoursLeft: number
  perWeek?: number
  spent: number
}

export interface ThreadRow {
  id: string
  label: string
  kind: ThreadKind
  lastTouched?: string
  gap: number | null
  maxGap: number
  paused: boolean
  standing: boolean
  blockedBy?: string
}

export interface GoalsView {
  goals: GoalRow[]
  threads: ThreadRow[]
  tradeoffs: TradeOff[]
  drift: Drift[]
  inventory: Inventory
  hoursPerWeek: number
  thinking: string[]
}

