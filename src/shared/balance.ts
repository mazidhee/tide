/**
 * Which roadmaps get this week, and what from each: decided from your aims, not from roadmap order.
 *
 * - A roadmap's value is how much your aims need what the next weeks would teach from it (and a
 *   little of the best further on, so foundations in front don't bury it), plus a deadline's pressure, plus a
 *   little for keeping going with something you've been studying.
 * - Weekdays go to at most two roadmaps (or the ones you pinned), in proportion to that value.
 * - Within a roadmap, topics come in your roadmap's order (it's ordered so each builds on the last),
 *   skipping what isn't needed now: electives, skipped sections and history, which goes to the
 *   weekend as short primers instead.
 * - A roadmap Tide hasn't sorted yet is planned in roadmap order, and the week says so.
 */
import { AIM_WEIGHT, classOf, sectionValue, type Overrides, type RoadmapTopic, type SortedRoadmap } from './curriculum'
import type { Aim, TopicCandidate } from './coach'
import { weekShares, type Shares } from './schedule'

export interface BalanceNotebook {
  name: string
  topics: RoadmapTopic[]
  sorted: SortedRoadmap | null
  /** Sorted for the current aims, enough to plan from */
  ready: boolean
}

export interface BalanceInput {
  aims: Aim[]
  notebooks: BalanceNotebook[]
  overrides: Overrides
  goals: { notebook: string; left: number; daysLeft: number; name: string }[]
  hoursPerWeek: number
  /** You pick the week's roadmaps (pinned, most important first), or Tide does */
  pick: 'tide' | 'me'
  pinned: string[]
  /** Minutes studied in each roadmap over the last two weeks */
  recent: Record<string, number>
}

export interface Balance {
  /** The week's roadmaps, most important first */
  focus: string[]
  shares: Shares[]
  /** Weekday topics, per roadmap in order, each with why */
  candidates: TopicCandidate[]
  /** History and background for the weekend, best first */
  primers: TopicCandidate[]
  /** When you pick: what Tide would have picked */
  suggested?: Shares[]
  /** Roadmaps planned in roadmap order because they aren't sorted yet */
  unsorted: string[]
}

const PER_NOTEBOOK = 20
const HOURS_PER_TOPIC = 2.5
const WEEKDAY = new Set(['core', 'supporting'])

/** The aim a section serves most, for the reason line */
function bestAim(sorted: SortedRoadmap | null, sectionId: string, aims: Aim[]): Aim | undefined {
  const serves = sorted?.sections[sectionId]?.serves ?? {}
  return [...aims].sort((a, b) => (serves[b.id] ?? 0) * (AIM_WEIGHT[b.weight] ?? 0.5) - (serves[a.id] ?? 0) * (AIM_WEIGHT[a.weight] ?? 0.5))[0]
}

const short = (t: string) => (t.length > 64 ? `${t.slice(0, 63)}…` : t)

/** Topics for weekdays, in roadmap order */
function weekdayTopics(nb: BalanceNotebook, input: BalanceInput): RoadmapTopic[] {
  const sorted = nb.ready ? nb.sorted : null
  return nb.topics.filter((t) => {
    if (t.checked || t.project) return false
    const cls = classOf(t, sorted, input.overrides, input.aims) ?? (nb.ready ? undefined : t.tagged)
    // Unsorted: everything but your own LATER/OPTIONAL sections; sorted: what's needed now
    if (!nb.ready) return cls !== 'elective' && cls !== 'skip' && !nb.sorted?.enrichment.includes(t.id)
    return cls === undefined || WEEKDAY.has(cls)
  })
}

/** How much a topic's section matters to your aims; a section you tagged core yourself counts as a needed foundation */
const topicValue = (t: RoadmapTopic, nb: BalanceNotebook, input: BalanceInput) => Math.max(sectionValue(nb.sorted?.sections[t.sectionId], input.aims), t.tagged === 'core' ? 0.6 : 0)

/**
 * How much your aims need a roadmap now, 0..1: mostly what the next couple of weeks would teach
 * from it, partly the best of what's further on (so foundations in front don't bury what they lead to)
 */
export function notebookValue(nb: BalanceNotebook, input: BalanceInput): number {
  if (!nb.ready || !nb.sorted) return 0.3
  const left = weekdayTopics(nb, input)
  if (!left.length) return 0
  const soon = left.slice(0, 12)
  const next = soon.reduce((n, t) => n + topicValue(t, nb, input), 0) / soon.length
  const best = [...new Set(left.map((t) => t.sectionId))].map((id) => sectionValue(nb.sorted!.sections[id], input.aims)).sort((a, b) => b - a).slice(0, 3)
  return 0.65 * next + 0.35 * (best.reduce((a, b) => a + b, 0) / Math.max(1, best.length))
}

export function balanceWeek(input: BalanceInput): Balance {
  const week = Math.max(1, input.hoursPerWeek)
  const scored = input.notebooks
    .map((nb) => {
      const value = notebookValue(nb, input)
      const goal = input.goals.find((g) => g.notebook === nb.name && g.left > 0)
      const need = goal ? (goal.left * HOURS_PER_TOPIC) / Math.max(0.5, goal.daysLeft / 7) / week : 0
      const going = (input.recent[nb.name] ?? 0) >= 60 ? 0.1 : 0
      const has = weekdayTopics(nb, input).length > 0
      return { nb, value, need, score: has ? value + Math.min(0.7, need) + going : 0, goal }
    })
    .filter((s) => s.score > 0.15)
    .sort((a, b) => b.score - a.score)

  const reasonFor = (s: (typeof scored)[number]): string => {
    if (s.goal && s.need > s.value) return `${s.goal.left} topics left for "${s.goal.name}" with ${Math.max(0, s.goal.daysLeft)} days to go`
    if (!s.nb.ready) return 'not sorted against your aims yet, so in roadmap order'
    const next = weekdayTopics(s.nb, input)[0]
    const aim = next && bestAim(s.nb.sorted, next.sectionId, input.aims)
    const serving = next && aim && (s.nb.sorted?.sections[next.sectionId]?.serves[aim.id] ?? 0) > 0
    return serving ? `${next.section || s.nb.name}, for ${short(aim.text)}` : `foundations your aims build on`
  }

  // Two roadmaps on weekdays: a third splits the week too thin to make progress in any
  const chosen = scored.slice(0, 2)
  const total = chosen.reduce((n, s) => n + s.score, 0)
  const tideShares: Shares[] = chosen.map((s) => ({ notebook: s.nb.name, share: chosen.length === 1 ? 1 : Math.min(0.7, Math.max(0.3, s.score / total)), reason: reasonFor(s) }))
  // The clamp can leave them not adding up to one
  const sum = tideShares.reduce((n, s) => n + s.share, 0)
  for (const s of tideShares) s.share = s.share / sum

  const pinned = input.pick === 'me' && input.pinned.length
  const focus = pinned ? input.pinned.filter((n) => input.notebooks.some((nb) => nb.name === n)) : tideShares.map((s) => s.notebook)
  const shares = pinned ? weekShares({ focus, goals: input.goals, hoursPerWeek: input.hoursPerWeek }) : tideShares

  const candidates: TopicCandidate[] = []
  for (const name of focus) {
    const nb = input.notebooks.find((n) => n.name === name)
    if (!nb) continue
    for (const t of weekdayTopics(nb, input).slice(0, PER_NOTEBOOK)) {
      const aim = nb.ready ? bestAim(nb.sorted, t.sectionId, input.aims) : undefined
      const serves = aim ? (nb.sorted?.sections[t.sectionId]?.serves[aim.id] ?? 0) : 0
      candidates.push({
        notebook: name,
        topic: t.title,
        section: t.section,
        topicId: t.id,
        ...(t.source ? { source: t.source } : {}),
        why: serves >= 0.6 ? `${t.section ? `${t.section}, ` : ''}${serves >= 1 ? 'for' : 'needed for'} ${short(aim!.text).replace(/^\w/, (c) => c.toLowerCase())}` : `Next in your ${name} roadmap${t.section ? ` (${t.section})` : ''}`
      })
    }
  }

  // Weekend primers: history and background, from this week's roadmaps first, then what you're curious about
  const curious = input.aims.filter((a) => a.weight === 'curious')
  const primers = input.notebooks
    .flatMap((nb) =>
      nb.topics
        .filter((t) => !t.checked && !t.project && classOf(t, nb.sorted, input.overrides, input.aims) === 'enrichment')
        .map((t) => {
          const forCurious = Math.max(0, ...curious.map((a) => nb.sorted?.sections[t.sectionId]?.serves[a.id] ?? 0))
          return { t, rank: (focus.includes(nb.name) ? 2 : 0) + forCurious }
        })
    )
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 4)
    .map(({ t }) => ({ notebook: t.notebook, topic: t.title, section: t.section, topicId: t.id, why: 'Weekend primer: background worth knowing, not a lesson to master' }))

  return {
    focus,
    shares,
    candidates,
    primers,
    ...(pinned ? { suggested: tideShares } : {}),
    unsorted: focus.filter((n) => !input.notebooks.find((nb) => nb.name === n)?.ready)
  }
}
