import type { Goal, Mastery, NoteMeta } from '@shared/types'
import { itemLink, parseOutline, splitSource, type OutlineLine } from '@shared/outline'
import { fileTitle } from '../state'

export interface GoalTopic {
  text: string
  /** The linked note, when the topic links one */
  path?: string
  done: boolean
  /** Ticked, but quizzes say it hasn't stuck */
  weak: boolean
}

export interface GoalPlan {
  goal: Goal
  topics: GoalTopic[]
  done: number
  total: number
  daysLeft: number
  /** Days for new topics; the rest are kept for review and a mock exam */
  studyDays: number
  reviewDays: number
  perDay: number
  /** Positive = topics ahead of the even pace, negative = behind */
  ahead: number
  today: GoalTopic[]
  reviewTopics: GoalTopic[]
  inReview: boolean
  overdue: boolean
}

const DAY = 86_400_000

/** Topics under the goal's section of the outline (or all of it), in reading order */
function topicsFor(lines: OutlineLine[], section?: string): OutlineLine[] {
  if (!section) return lines
  const start = lines.findIndex((l) => l.kind === 'heading' && l.text.trim() === section.trim())
  if (start < 0) return lines
  const level = (lines[start] as { level: number }).level
  const end = lines.findIndex((l, i) => i > start && l.kind === 'heading' && l.level <= level)
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

/**
 * Plans backwards from the deadline: the last days (at least two, about 15%) are kept for review
 * and a mock exam, the rest share the topics left. Recomputed every time, so it adjusts as topics
 * get ticked and as mastery changes.
 */
export function planGoal(goal: Goal, outlineMd: string, notes: Map<string, NoteMeta>, mastery: Record<string, Mastery>, now = Date.now()): GoalPlan {
  const byName = new Map<string, NoteMeta>()
  for (const n of notes.values()) byName.set(fileTitle(n.path).toLowerCase(), n)
  const items = topicsFor(parseOutline(outlineMd).lines, goal.section).filter((l): l is Extract<OutlineLine, { kind: 'item' }> => l.kind === 'item' && l.checked !== null)
  const topics: GoalTopic[] = items.map((l) => {
    const { target, label } = itemLink(splitSource(l.text).main)
    const note = target ? byName.get(target.toLowerCase()) : undefined
    const m = note ? mastery[note.path] : undefined
    return { text: label, path: note?.path, done: !!l.checked, weak: !!l.checked && !!m && (m.level === 'weak' || m.level === 'shaky') }
  })
  const total = topics.length
  const done = topics.filter((t) => t.done).length
  const deadline = new Date(goal.deadline + 'T23:59:59').getTime()
  const daysLeft = Math.max(0, Math.ceil((deadline - now) / DAY))
  const totalDays = Math.max(1, Math.ceil((deadline - goal.createdAt) / DAY))
  const reviewDays = Math.min(daysLeft, Math.max(2, Math.round(totalDays * 0.15)))
  const studyDays = Math.max(0, daysLeft - reviewDays)
  const remaining = topics.filter((t) => !t.done)
  const perDay = studyDays > 0 ? Math.ceil(remaining.length / studyDays) : remaining.length
  // Where an even pace from the start would have you by today
  const elapsed = Math.max(0, (now - goal.createdAt) / DAY)
  const studyTotal = Math.max(1, totalDays - Math.max(2, Math.round(totalDays * 0.15)))
  const expected = Math.min(total, Math.round((elapsed / studyTotal) * total))
  const inReview = studyDays === 0 && daysLeft > 0
  const reviewTopics = topics.filter((t) => t.weak)
  return {
    goal,
    topics,
    done,
    total,
    daysLeft,
    studyDays,
    reviewDays,
    perDay,
    ahead: done - expected,
    today: inReview ? [] : remaining.slice(0, Math.max(1, perDay)),
    reviewTopics,
    inReview,
    overdue: daysLeft === 0 && remaining.length > 0
  }
}

/** "20 Nov", or "20 Nov 2027" when it isn't this year */
export const formatDeadline = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}
