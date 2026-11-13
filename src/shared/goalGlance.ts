/**
 * A goal at a glance on Your week: how far along it is and whether it's on track, so each goal
 * reads as one row (a bar, a date, a status) rather than a paragraph.
 */
import type { GoalRow, GoalsView, Inventory, ThreadRow } from './goals'

export type GoalStatus = 'on-track' | 'behind' | 'paused' | 'not-started'

export const STATUS_WORD: Record<GoalStatus, string> = {
  'on-track': 'On track',
  behind: 'Behind',
  paused: 'Paused',
  'not-started': 'Not started'
}

/**
 * How far along, 0 to 1, or null when nothing can be said. A roadmap counts its ticked topics and a
 * project its finished milestones; anything else counts hours spent against hours still needed.
 * Needs are weighed by their hours.
 */
export function goalProgress(goal: GoalRow, inventory: Inventory): number | null {
  let weight = 0
  let done = 0
  for (const n of goal.needs.filter((x) => !x.dropped)) {
    const w = Math.max(1, n.hours)
    let p: number | null = null
    if (n.kind === 'roadmap') {
      const r = inventory.roadmaps.find((x) => x.name === n.ref)
      if (r && r.total > 0) p = (r.total - r.left) / r.total
    } else if (n.kind === 'project') {
      const pr = inventory.projects.find((x) => x.notebook === n.ref)
      if (pr && pr.total > 0) p = pr.done / pr.total
    }
    if (p === null) continue
    weight += w
    done += w * p
  }
  if (weight) return clamp(done / weight)
  const total = goal.spent + goal.hoursLeft
  return total > 0 ? clamp(goal.spent / total) : null
}

const clamp = (x: number) => Math.max(0, Math.min(1, x))

/**
 * On track or behind. A dated goal is behind when Tide measured drift on it or it no longer fits your
 * hours; an ongoing one when it's close to going untouched for longer than it should.
 */
export function goalStatus(goal: GoalRow, view: Pick<GoalsView, 'drift' | 'tradeoffs' | 'threads'>, today: string): GoalStatus {
  if (goal.off || (goal.pausedUntil && goal.pausedUntil > today)) return 'paused'
  if (view.drift.some((d) => d.goal === goal.id) || view.tradeoffs.some((t) => t.goal === goal.id)) return 'behind'
  const thread: ThreadRow | undefined = view.threads.find((t) => t.id === goal.id)
  if (goal.standing && thread) {
    if (thread.gap === null) return 'not-started'
    if (thread.gap >= thread.maxGap - 1) return 'behind'
    return 'on-track'
  }
  if (!goal.standing && goal.spent <= 0) return 'not-started'
  return 'on-track'
}

/** The first sentence, for a one-line summary with the rest on request */
export const firstSentence = (text: string) => text.trim().split(/(?<=[.!?])\s/)[0] ?? ''
