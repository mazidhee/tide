/**
 * The morning workout (shared/workout makes, rates and scores it): the ratings, titles, badges and
 * reminder in .tide/workout.json, and one line per finished round in .tide/workout.jsonl, both in
 * the vault. The first read moves the old daily mental maths over (its level, its days and its
 * reminder) and leaves the old files where they are. Also the reminder notification.
 */
import { promises as fs } from 'fs'
import { BrowserWindow, Notification } from 'electron'
import { dayKey, REMINDER_HOUR, type Reminder } from '@shared/mentalMaths'
import { applyRound, freshPrefs, migrateFromMaths, ROUNDS, workoutStreak, type RoundEvents, type RoundRecord, type WorkoutPrefs, type WorkoutState } from '@shared/workout'
import { RATED } from '@shared/workoutItems'
import { absPath, joinRel } from './vault'
import { getSettings } from './settings'

const PREFS = joinRel('.tide', 'workout.json')
const LOG = joinRel('.tide', 'workout.jsonl')

async function readRounds(): Promise<RoundRecord[]> {
  try {
    return (await fs.readFile(absPath(LOG), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as RoundRecord]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

/** Fills in anything an older or hand-edited file lacks */
function sane(p: Partial<WorkoutPrefs>): WorkoutPrefs {
  const f = freshPrefs()
  const ratings = { ...f.ratings }
  for (const id of RATED) {
    const r = p.ratings?.[id]
    if (r && Number.isFinite(r.r) && Number.isFinite(r.n)) ratings[id] = { r: r.r, n: r.n }
  }
  return {
    version: 1,
    ratings,
    reminder: p.reminder === 'morning' || p.reminder === 'evening' ? p.reminder : 'off',
    importedDays: Array.isArray(p.importedDays) ? p.importedDays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [],
    migratedAt: typeof p.migratedAt === 'number' ? p.migratedAt : null,
    titles: { novice: 0, ...(p.titles ?? {}) },
    badges: { ...(p.badges ?? {}) },
    trophies: Array.isArray(p.trophies) ? p.trophies : []
  }
}

async function writePrefs(p: WorkoutPrefs) {
  await fs.mkdir(absPath(joinRel('.tide')), { recursive: true })
  const tmp = absPath(PREFS) + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(p, null, 2))
  await fs.rename(tmp, absPath(PREFS))
}

async function readPrefs(): Promise<WorkoutPrefs> {
  try {
    return sane(JSON.parse(await fs.readFile(absPath(PREFS), 'utf8')) as Partial<WorkoutPrefs>)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return freshPrefs()
    // First time: carry the mental maths level, days and reminder over; the old files stay
    const { mathsState } = await import('./mentalMaths')
    const old = await mathsState().catch(() => ({ sessions: [], reminder: 'off' as Reminder }))
    const p = migrateFromMaths(old.sessions, old.reminder, Date.now())
    await writePrefs(p).catch(() => {})
    return p
  }
}

export async function workoutState(): Promise<WorkoutState> {
  return { prefs: await readPrefs(), rounds: await readRounds() }
}

// One write at a time: a round saved while another is still being written waits its turn
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const run = queue.then(f, f)
  queue = run.catch(() => {})
  return run
}

const str = (x: unknown, n: number) => String(x ?? '').slice(0, n)

/** Saves one finished round; its day is today where you are now */
export function logWorkoutRound(input: Pick<RoundRecord, 'morning' | 'round' | 'championship' | 'items' | 'combo'>): Promise<{ state: WorkoutState; events: RoundEvents }> {
  return serial(async () => {
    if (!ROUNDS.some((r) => r.id === input.round) || !Array.isArray(input.items)) throw new Error('Not a valid round.')
    const at = Date.now()
    const rec: RoundRecord = {
      id: Math.random().toString(36).slice(2, 10),
      morning: str(input.morning, 40) || `m${at}`,
      at,
      day: dayKey(at),
      round: input.round,
      championship: !!input.championship,
      items: input.items.slice(0, 60).map((it) => ({
        kind: str(it.kind, 40),
        difficulty: Math.max(0, Math.min(3000, Number(it.difficulty) || 1000)),
        prompt: str(it.prompt, 600),
        given: str(it.given, 80),
        shown: str(it.shown, 120),
        right: !!it.right,
        score: Math.max(0, Math.min(1, Number(it.score) || 0)),
        ms: Math.max(0, Math.min(3_600_000, Math.round(Number(it.ms) || 0))),
        ...(Array.isArray(it.steps) ? { steps: it.steps.slice(0, 40).map((s) => str(s, 400)) } : {})
      })),
      ...(Number.isFinite(input.combo) ? { combo: Math.max(0, Math.round(Number(input.combo))) } : {})
    }
    const before = await workoutState()
    const { state, events } = applyRound(before, rec)
    const saved = state.rounds[state.rounds.length - 1]
    await fs.mkdir(absPath(joinRel('.tide')), { recursive: true })
    await fs.appendFile(absPath(LOG), JSON.stringify(saved) + '\n')
    await writePrefs(state.prefs)
    return { state, events }
  })
}

export function setWorkoutReminder(r: Reminder): Promise<Reminder> {
  return serial(async () => {
    const reminder: Reminder = r === 'morning' || r === 'evening' ? r : 'off'
    const p = await readPrefs()
    await writePrefs({ ...p, reminder })
    return reminder
  })
}

let notifiedOn = ''

/**
 * The reminder due now, if any: past the hour you chose, today's morning not done, not yet reminded
 * today. `anyHour` (a development test copy's TIDE_REMINDER_NOW) skips the hour, to see it fire.
 */
export function workoutReminder(state: WorkoutState, now: Date, reminded: string, anyHour = false): { title: string; body: string } | null {
  const today = dayKey(now.getTime())
  const reminder = state.prefs.reminder
  if (reminded === today || reminder === 'off' || (!anyHour && now.getHours() < REMINDER_HOUR[reminder])) return null
  const s = workoutStreak(state, today)
  if (s.doneToday) return null
  return { title: 'Morning workout', body: s.current ? `Fifteen minutes keeps your ${s.current}-day streak going.` : 'Five rounds, about fifteen minutes.' }
}

/**
 * Every few minutes: past the reminder hour, today's morning not done and not yet reminded → one
 * notification. When macOS won't show it (notifications off for Tide), `inApp` says it in Tide's
 * window instead, so the reminder isn't lost without a trace.
 */
export function startWorkoutReminder(open: () => void, opts: { anyHour?: boolean; firstAfterMs?: number; inApp?: (r: { title: string; body: string }) => void } = {}) {
  const check = async () => {
    if (!getSettings().vaultPath) return
    const due = workoutReminder(await workoutState(), new Date(), notifiedOn, opts.anyHour)
    if (!due) return
    notifiedOn = dayKey(Date.now())
    if (opts.anyHour) console.log(`[workout] reminder due (notifications ${Notification.isSupported() ? 'supported' : 'not supported'})`)
    if (!Notification.isSupported()) return opts.inApp?.(due)
    const n = new Notification({ ...due, silent: true })
    n.on('failed', () => opts.inApp?.(due))
    n.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w?.isMinimized()) w.restore()
      open()
    })
    if (opts.anyHour) {
      n.on('show', () => console.log(`[workout] reminder shown: ${due.title}: ${due.body}`))
      n.on('failed', (_e, err) => console.log(`[workout] reminder failed: ${err}`))
    }
    n.show()
  }
  setTimeout(() => void check().catch(() => {}), opts.firstAfterMs ?? 60_000)
  setTimeout(() => void check().catch(() => {}), 60_000)
  setInterval(() => void check().catch(() => {}), 5 * 60_000)
}
