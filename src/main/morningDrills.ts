/**
 * The morning drills tracker (shared/morningDrills): the records each drill already keeps, put
 * together for the workout page and Home, and one to-do a day in Things, "Morning drills". The
 * to-do is added the first time Tide looks each day; ticking it in Things marks the day done, and
 * finishing the whole workout ticks it there. Which to-do belongs to which day, and the days
 * ticked, are kept in .tide/morning-drills.json. A test copy never reaches the real Things
 * (main/things).
 */
import { buildLink } from '@shared/deeplink'
import { dayKey } from '@shared/mentalMaths'
import { mornings } from '@shared/workout'
import { drillTally, THINGS_TITLE, type DrillTally } from '@shared/morningDrills'
import { joinRel, readText, writeText } from './vault'

const STORE = joinRel('.tide', 'morning-drills.json')

interface Store {
  /** The Things to-do made for each day */
  todos: Record<string, string>
  /** Days ticked off in Things */
  ticked: string[]
}

async function load(): Promise<Store> {
  try {
    const raw = JSON.parse(await readText(STORE)) as Partial<Store>
    return { todos: raw.todos && typeof raw.todos === 'object' ? raw.todos : {}, ticked: Array.isArray(raw.ticked) ? raw.ticked.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [] }
  } catch {
    return { todos: {}, ticked: [] }
  }
}

const save = (s: Store) => writeText(STORE, JSON.stringify(s))

let syncing: Promise<void> | null = null

/**
 * Today's to-do in Things: added once, its tick read back, and ticked there when the whole
 * workout is done here. Quietly does nothing when Things isn't reachable.
 */
export function syncThings(today = dayKey(Date.now())): Promise<void> {
  syncing ??= (async () => {
    const things = await import('./things')
    if (!(await things.thingsAvailable())) return
    const s = await load()
    let id = s.todos[today]
    if (!id) {
      const item = await things.addTask({ title: THINGS_TITLE, when: today, tags: ['drill'], notes: `The morning workout, daily practice and mental maths.\n\n[Open the workout in Tide](${buildLink({ to: 'practice', tab: 'workout' })})` })
      if (!item?.id) return
      id = item.id
      s.todos[today] = id
      await save(s)
    }
    const task = await things.getTask(id)
    if (task?.status === 'completed') {
      if (!s.ticked.includes(today)) await save({ ...s, ticked: [...s.ticked, today].sort().slice(-400) })
      return
    }
    const { workoutState } = await import('./workout')
    const w = await workoutState()
    if (task?.status === 'open' && mornings(w.rounds).some((m) => m.complete && m.day === today)) await things.setTaskDone(id, true)
  })()
    .catch(() => {})
    .finally(() => (syncing = null))
  return syncing
}

/** Today's and this week's minutes, the streak and today's score */
export async function drillsTally(): Promise<DrillTally> {
  const today = dayKey(Date.now())
  await Promise.race([syncThings(today), new Promise((r) => setTimeout(r, 3000))])
  const [{ workoutState }, learn] = await Promise.all([import('./workout'), import('./learn')])
  const since = Date.now() - 9 * 86_400_000
  const [workout, sprints, focus, s] = await Promise.all([workoutState(), learn.listDrills().catch(() => []), learn.focusLog(since).catch(() => []), load()])
  return drillTally(
    {
      workout,
      sprints: sprints.filter((d) => d.at >= since).map((d) => ({ at: d.at, seconds: d.seconds })),
      review: focus.filter((e) => e.label === 'Daily practice').map((e) => ({ start: e.start, minutes: e.minutes })),
      ticked: s.ticked
    },
    today
  )
}
