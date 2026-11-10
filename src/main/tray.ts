import { app, BrowserWindow, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { localDate, todayItems, type AgendaItem } from '@shared/coach'
import { professorBitmap, SPEED, type ProfessorPose } from '@shared/professorArt'
import { getSettings } from './settings'

/**
 * Your tutor in the menu bar. While you study it acts out what you're doing (the chalkboard in a
 * lesson, tea while it's your turn, a book while you read, flashcards in Review, a laptop in
 * Practice, the stopwatch in an exam with the time left beside it, fishing on a break). Otherwise
 * it keeps the time of day: tea in the morning, reading in the afternoon, fishing at dusk, dozing
 * at night. Its menu has today's plan, a focus timer and the wrap-up. Settings can keep it to
 * study time only, or turn it off.
 */

export interface StudyStatus {
  pose: ProfessorPose
  /** What's being studied, e.g. "Teach me: File permissions" */
  label: string
  /** When it began (ms), for the minutes shown beside it */
  since: number
  /** A deadline (an exam's end): shown as a countdown instead */
  until?: number
}

let tray: Tray | null = null
let timer: ReturnType<typeof setInterval> | null = null
let tick = 0
let pose: ProfessorPose | null = null
let agenda: () => Promise<AgendaItem[]> = async () => []
// Each window reports its own; the most recent report is the one shown
const reports = new Map<number, StudyStatus & { at: number }>()

/** Where the menu's commands go: the main window opens the view, starts the timer… */
let command: (c: TrayCommand) => void = () => {}
export type TrayCommand = { type: 'view'; view: unknown } | { type: 'agenda'; date: string; index: number } | { type: 'focus'; minutes: number }

export function initTray(opts: { agenda: () => Promise<AgendaItem[]>; command: (c: TrayCommand) => void }) {
  agenda = opts.agenda
  command = opts.command
  update()
}

const idlePose = (): ProfessorPose => {
  const h = new Date().getHours()
  return h >= 5 && h < 11 ? 'tea' : h >= 11 && h < 17 ? 'book' : h >= 17 && h < 22 ? 'fishing' : 'sleep'
}

const latest = () => [...reports.values()].sort((a, b) => b.at - a.at)[0] ?? null

/** What's being studied right now, for the study data API */
export const currentStudy = () => {
  const s = latest()
  return s ? { label: s.label, since: s.since } : null
}

function frame(p: ProfessorPose) {
  // 16 rows at 2x is a 16-point-tall icon, which sits well in the menu bar
  const { width, height, data } = professorBitmap(p, tick, 2, getSettings().character)
  return nativeImage.createFromBitmap(Buffer.from(data), { width, height, scaleFactor: 2 })
}

const minutes = (since: number) => Math.max(0, Math.floor((Date.now() - since) / 60_000))
const countdown = (until: number) => {
  const s = Math.max(0, Math.round((until - Date.now()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function render() {
  if (!tray) return
  const s = latest()
  tray.setImage(frame(pose ?? idlePose()))
  const title = s ? (s.until ? ` ${countdown(s.until)}` : minutes(s.since) ? ` ${minutes(s.since)}m` : '') : ''
  tray.setTitle(title, { fontType: 'monospacedDigit' })
}

const AGENDA_VERB: Record<AgendaItem['kind'], string> = { learn: 'Learn', practice: 'Practise', quiz: 'Quiz', review: 'Review', 'take-home': 'Take-home', test: 'Test', check: 'Check' }

async function buildMenu(): Promise<Menu> {
  const s = latest()
  const items: MenuItemConstructorOptions[] = []
  if (s) {
    items.push({ label: s.label, enabled: false })
    items.push({ label: s.until ? `${countdown(s.until)} left` : `${minutes(s.since)} minutes so far`, enabled: false })
    items.push({ type: 'separator' })
  }
  const today = await agenda().catch(() => [] as AgendaItem[])
  if (today.length) {
    const left = today.filter((it) => !it.done)
    items.push({ label: left.length ? `Today: ${left.length} to go` : 'Today: all done', enabled: false })
    today.forEach((it, index) => {
      if (it.done) return
      items.push({ label: `${AGENDA_VERB[it.kind]}: ${it.topic && it.kind === 'learn' ? it.topic : it.title} (${it.minutes} min)`.slice(0, 70), click: () => command({ type: 'agenda', date: localDate(), index }) })
    })
    items.push({ type: 'separator' })
  }
  items.push({ label: 'Focus for 25 minutes', click: () => command({ type: 'focus', minutes: 25 }) })
  items.push({ label: 'Wrap up the day', click: () => command({ type: 'view', view: { kind: 'wrapup' } }) })
  items.push({ type: 'separator' })
  items.push({
    label: 'Show Tide',
    click: () => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())
      if (w) (w.show(), w.focus())
      app.focus({ steal: true })
    }
  })
  return Menu.buildFromTemplate(items)
}

function update() {
  const mode = getSettings().menuBar ?? 'always'
  const s = latest()
  if (mode === 'off' || (mode === 'studying' && !s)) {
    if (timer) clearInterval(timer)
    timer = null
    tray?.destroy()
    tray = null
    pose = null
    return
  }
  const next = s?.pose ?? idlePose()
  const changed = next !== pose
  pose = next
  if (!tray) {
    tray = new Tray(frame(pose))
    tray.on('click', async () => tray?.popUpContextMenu(await buildMenu()))
    tray.on('right-click', async () => tray?.popUpContextMenu(await buildMenu()))
  }
  tray.setToolTip(s ? `Tide: ${s.label}` : 'Tide')
  if (changed || !timer) {
    if (timer) clearInterval(timer)
    // Countdowns tick every second; otherwise the scene's own pace (idle ones slower, to save power)
    const pace = s?.until ? Math.min(SPEED[pose], 500) : s ? SPEED[pose] : SPEED[pose] * 2
    timer = setInterval(() => {
      tick++
      // The idle scene follows the clock
      if (!latest() && pose !== idlePose()) return update()
      render()
    }, pace)
  }
  render()
}

/** A window's study status; null when it stops studying (or closes) */
export function reportStudy(windowId: number, status: StudyStatus | null) {
  if (status) reports.set(windowId, { ...status, at: reports.get(windowId)?.at ?? Date.now() })
  else reports.delete(windowId)
  update()
}

/** Settings changed (menu bar mode, character) */
export const refreshTray = () => update()
