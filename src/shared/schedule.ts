/**
 * The week, planned by code. Everything a week needs is already known as facts: the next topics
 * in each roadmap and their order, your hours and days, deadlines and how far behind they are,
 * weak topics, flashcards due, mistakes to retest, what last week left undone and how much of it
 * got done. A scheduler turns those into days far faster (and more reliably) than a model writing
 * JSON; the model only says, in a few sentences, why the week looks the way it does.
 *
 * How it decides:
 * - Shares: each focus notebook gets a share of the week by its rank (1, 1/2, 1/3, …), raised for
 *   a deadline that needs more than that to finish on time, capped so nothing takes the whole week.
 * - Time: the week's minutes, lighter when last week's plan mostly didn't get done.
 * - Fixed slots first: review where there's something to repair, a quiz the day after a new topic
 *   (recall while it's fading), a take-home mid-week, a test on the last day.
 * - Then learning fills each day in 45-minute blocks, from the notebook furthest below its share,
 *   at most two subjects a day, each roadmap strictly in order, carried-over topics first.
 */
import type { AgendaItem, TopicCandidate, WeekPlan } from './coach'

export interface ScheduleInput {
  weekStart: string
  /** The dates you study this week, in order */
  days: string[]
  hoursPerWeek: number
  /** Notebooks, most important first */
  focus: string[]
  /** Next topics per notebook, in roadmap order */
  candidates: TopicCandidate[]
  /** Deadlines: topics left and days to go */
  goals: { notebook: string; left: number; daysLeft: number; name: string }[]
  weak: { title: string; notebook?: string }[]
  dueCards: number
  mistakes: { count: number; topics: string[] }
  /** Learning planned before that didn't get done */
  undone: { topic: string; notebook?: string }[]
  /** Share of last week's plan that got done, if there was one */
  lastDone?: number
}

const BLOCK = 45
const MIN_BLOCK = 30
const MAX_SHARE = 0.7
/** Study hours a roadmap topic takes, for judging deadlines */
const HOURS_PER_TOPIC = 2.5

export interface Shares {
  notebook: string
  share: number
  reason: string
}

export function weekShares(input: Pick<ScheduleInput, 'focus' | 'goals' | 'hoursPerWeek'>): Shares[] {
  const nbs = input.focus
  if (!nbs.length) return []
  const rank = nbs.map((_, i) => 1 / (i + 1))
  const sum = rank.reduce((a, b) => a + b, 0)
  const base = rank.map((r) => r / sum)
  const week = Math.max(1, input.hoursPerWeek)
  const raw = nbs.map((nb, i) => {
    const goal = input.goals.find((g) => g.notebook === nb)
    if (!goal || goal.left <= 0) return { share: base[i], reason: i === 0 ? 'your first focus' : `focus #${i + 1}` }
    const weeks = Math.max(0.5, goal.daysLeft / 7)
    const need = (goal.left * HOURS_PER_TOPIC) / weeks / week
    return need > base[i]
      ? { share: Math.min(MAX_SHARE, need), reason: `${goal.left} topics left for "${goal.name}" with ${Math.max(0, goal.daysLeft)} days to go` }
      : { share: base[i], reason: `on pace for "${goal.name}"` }
  })
  // One subject can't take everything, and the shares add up to the whole week
  const total = raw.reduce((n, r) => n + r.share, 0)
  return nbs.map((nb, i) => ({ notebook: nb, share: nbs.length === 1 ? 1 : raw[i].share / total, reason: raw[i].reason }))
}

export function scheduleWeek(input: ScheduleInput): WeekPlan {
  const shares = weekShares(input)
  const perDay = (input.hoursPerWeek * 60) / Math.max(1, input.days.length)
  // A week mostly left undone means this one was too big: lighten it
  const scale = input.lastDone !== undefined && input.lastDone < 0.6 ? 0.8 : 1
  const budget = input.days.map(() => Math.round(perDay * scale))
  const plan: AgendaItem[][] = input.days.map(() => [])
  const used = (d: number) => plan[d].reduce((n, it) => n + it.minutes, 0)
  const room = (d: number) => budget[d] - used(d)
  const subjects = (d: number) => new Set(plan[d].map((it) => it.notebook).filter(Boolean))
  const n = input.days.length

  // Queues: carried-over topics first, then each roadmap in order, never a topic twice
  const queue = new Map<string, { topic: string; notebook: string; section?: string; carried?: boolean }[]>()
  const seen = new Set<string>()
  for (const u of input.undone) {
    const nb = u.notebook && input.focus.includes(u.notebook) ? u.notebook : undefined
    if (!nb || seen.has(u.topic)) continue
    seen.add(u.topic)
    queue.set(nb, [...(queue.get(nb) ?? []), { topic: u.topic, notebook: nb, carried: true }])
  }
  for (const c of input.candidates) {
    if (!input.focus.includes(c.notebook) || seen.has(c.topic)) continue
    seen.add(c.topic)
    queue.set(c.notebook, [...(queue.get(c.notebook) ?? []), { topic: c.topic, notebook: c.notebook, section: c.section }])
  }

  // Repair first: weak spots, due cards and mistakes, early in the week and again mid-week
  const repair = input.mistakes.count || input.dueCards || input.weak.length
  if (repair && n) {
    const what = input.mistakes.count
      ? { title: `Retest ${input.mistakes.count} mistake${input.mistakes.count === 1 ? '' : 's'}`, why: `From ${input.mistakes.topics.slice(0, 3).join(', ')}: fix them while you remember the slip` }
      : input.weak.length
        ? { title: `Revisit ${input.weak.slice(0, 2).map((w) => w.title).join(' and ')}`, why: 'Your answers there were shaky; firm them up before building on them' }
        : { title: `${input.dueCards} flashcards due`, why: 'Due today: spaced review keeps them' }
    plan[0].push({ kind: 'review', title: what.title, minutes: 20, why: what.why })
    if (n >= 4 && (input.dueCards || input.weak.length > 2)) plan[Math.floor(n / 2)].push({ kind: 'review', title: input.dueCards ? 'Flashcards and weak spots' : `Revisit ${input.weak[2].title}`, minutes: 15, why: 'A second pass mid-week, spaced from the first' })
  }
  // A test on the last study day; a take-home mid-week once there's enough time for one
  const last = n - 1
  if (n >= 3 && input.hoursPerWeek >= 4) plan[last].push({ kind: 'test', title: "Test on this week's topics", minutes: 30, why: 'Checks what stuck, and shows what to carry into next week' })

  // Learning: each day from the subjects furthest below their share, two subjects at most a day
  const target = new Map(shares.map((s) => [s.notebook, s.share * budget.reduce((a, b) => a + b, 0)]))
  const got = new Map<string, number>()
  const learned: { day: number; topic: string; notebook: string }[] = []
  for (let d = 0; d < n; d++) {
    for (;;) {
      const free = room(d)
      if (free < MIN_BLOCK) break
      const today = subjects(d)
      const options = input.focus
        .filter((nb) => (queue.get(nb)?.length ?? 0) > 0 && (today.has(nb) || today.size < 2))
        // Furthest below its share in proportion, so a smaller subject still gets its turn
        .sort((a, b) => (got.get(a) ?? 0) / Math.max(1, target.get(a) ?? 0) - (got.get(b) ?? 0) / Math.max(1, target.get(b) ?? 0))
      const nb = options[0]
      if (!nb) break
      const next = queue.get(nb)!.shift()!
      const minutes = Math.min(BLOCK, free)
      const goal = input.goals.find((g) => g.notebook === nb && g.left > 0)
      plan[d].push({
        kind: 'learn',
        title: next.topic,
        topic: next.topic,
        notebook: nb,
        minutes,
        why: next.carried ? 'Carried over from last time' : goal && (shares.find((s) => s.notebook === nb)?.reason ?? '').includes('left') ? `Next in ${nb}, to keep "${goal.name}" on time` : `Next in your ${nb} roadmap${next.section ? ` (${next.section})` : ''}`,
        ...(next.carried ? { carried: true } : {})
      })
      got.set(nb, (got.get(nb) ?? 0) + minutes)
      learned.push({ day: d, topic: next.topic, notebook: nb })
    }
  }

  // Spaced retrieval: a short quiz the next study day on what was new the day before (three a week)
  let quizzes = 0
  for (let d = 1; d < n && quizzes < 3; d++) {
    const before = learned.filter((l) => l.day === d - 1)
    if (!before.length) continue
    const q = before[0]
    const shrink = [...plan[d]].reverse().find((it) => it.kind === 'learn')
    if (room(d) < 15 && shrink && shrink.minutes >= 40) shrink.minutes -= 15
    if (room(d) < 15) continue
    plan[d].push({ kind: 'quiz', title: `Quiz: ${q.topic}`, topic: q.topic, notebook: q.notebook, minutes: 15, why: 'Recall it a day later, as it starts to fade' })
    quizzes++
  }
  // A take-home on the top subject, mid-to-late week, built on what that week taught
  const top = input.focus[0]
  const d = Math.max(1, Math.min(last - 1, Math.round(n * 0.6)))
  // Only what was learned before that day: the take-home builds on it
  const taught = learned.filter((l) => l.notebook === top && l.day < d)
  if (top && taught.length >= 2 && input.hoursPerWeek >= 6 && n >= 3) {
    const shrink = [...plan[d]].reverse().find((it) => it.kind === 'learn')
    if (shrink && room(d) < 40) {
      plan[d] = plan[d].filter((it) => it !== shrink)
      queue.get(shrink.notebook!)?.unshift({ topic: shrink.topic!, notebook: shrink.notebook! })
    }
    plan[d].push({ kind: 'take-home', title: `Take-home: build on ${taught[taught.length - 1].topic}`, notebook: top, minutes: Math.max(30, Math.min(60, room(d))), why: 'One harder problem to think through, using this week' })
  }

  const days = input.days.map((date, d) => ({ date, items: plan[d] })).filter((d) => d.items.length)
  // The split as it actually fell, with the reason each subject got its time
  const mins = new Map<string, number>()
  for (const d of days) for (const it of d.items) if (it.notebook) mins.set(it.notebook, (mins.get(it.notebook) ?? 0) + it.minutes)
  const all = [...mins.values()].reduce((a, b) => a + b, 0)
  const priorities = shares.filter((s) => mins.get(s.notebook)).map((s) => ({ notebook: s.notebook, share: Math.round(((mins.get(s.notebook) ?? 0) / Math.max(1, all)) * 100), reason: s.reason }))
  return { weekStart: input.weekStart, createdAt: Date.now(), summary: '', priorities, days }
}

/** The week in a few plain sentences, for when the model can't write it */
export function summaryFromPlan(plan: WeekPlan, input: Pick<ScheduleInput, 'lastDone'>): string {
  const p = plan.priorities
  const parts = [
    p.length ? `This week leans ${p.map((x) => `${x.share}% ${x.notebook}`).join(', ')}${p[0]?.reason ? `, because of ${p[0].reason}` : ''}.` : '',
    plan.days.some((d) => d.items.some((i) => i.kind === 'review')) ? 'It starts by repairing weak spots before building on them.' : '',
    input.lastDone !== undefined && input.lastDone < 0.6 ? 'It is lighter than last week, which was too much.' : ''
  ]
  return parts.filter(Boolean).join(' ')
}
