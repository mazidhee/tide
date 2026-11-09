/**
 * Your day as one path: what's done, what's now, then the rest of today and this evening. It
 * merges Things 4 (anything you or the tutor put on Today) with the coach's plan for the day,
 * showing a planned item once even when it's also a to-do in Things.
 */
import { thingsTitle, type AgendaItem } from './coach'

/** A to-do on today's list in Things 4, cut down to what the timeline shows */
export interface DayTask {
  id: string
  title: string
  /** The project, else the area */
  where?: string
  evening: boolean
  done: boolean
  /** When it was ticked off (ms), for the done ones */
  doneAt?: number
  /** A reminder time today, "14:30" */
  at?: string
  deadline?: string
  /** Set by Tide's tutor or coach */
  tide: boolean
  /** The tide:// link in its notes, so it opens in the right place */
  link?: string
  url?: string
}

export interface DaySlot {
  key: string
  title: string
  /** The small line above the title: a time, how long, where it's from */
  meta: string
  part: 'done' | 'open' | 'evening'
  done: boolean
  /** The planned item, by its place in today's plan */
  plan?: { item: AgendaItem; index: number }
  task?: DayTask
}

const LABEL: Record<AgendaItem['kind'], string> = { learn: 'Learn', practice: 'Practise', quiz: 'Quiz', review: 'Review', 'take-home': 'Take-home', test: 'Test' }

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function buildDay(tasks: DayTask[] | null, plan: AgendaItem[]): DaySlot[] {
  const byTitle = new Map((tasks ?? []).map((t) => [t.title, t]))
  const used = new Set<string>()
  const planned: DaySlot[] = plan.map((item, index) => {
    const task = byTitle.get(thingsTitle(item))
    if (task) used.add(task.id)
    const done = !!item.done || !!task?.done
    return {
      key: `p:${index}`,
      title: item.kind === 'learn' && item.topic ? item.topic : item.title,
      meta: [task?.at, LABEL[item.kind], `${item.minutes} min`].filter(Boolean).join(' · '),
      part: done ? 'done' : task?.evening ? 'evening' : 'open',
      done,
      plan: { item, index },
      ...(task ? { task } : {})
    }
  })
  // Only what Tide gave you (tagged "tide" in Things): the rest of your Today list stays in Things
  const own: DaySlot[] = (tasks ?? [])
    .filter((t) => t.tide && !used.has(t.id))
    .map((t) => ({ key: `t:${t.id}`, title: t.title, meta: [t.done && t.doneAt ? clock(t.doneAt) : t.at, t.where].filter(Boolean).join(' · '), part: t.done ? 'done' : t.evening ? 'evening' : 'open', done: t.done, task: t }))
  const all = [...planned, ...own]
  const done = all.filter((s) => s.part === 'done').sort((a, b) => (a.task?.doneAt ?? 0) - (b.task?.doneAt ?? 0))
  // Anything with a time goes first, in time order; the rest keeps its order in Things, then the plan
  const timed = (s: DaySlot) => s.task?.at ?? '99:99'
  const open = all.filter((s) => s.part === 'open').sort((a, b) => timed(a).localeCompare(timed(b)))
  const evening = all.filter((s) => s.part === 'evening').sort((a, b) => timed(a).localeCompare(timed(b)))
  return [...done, ...open, ...evening]
}
