/**
 * Pop-out windows: one lesson, project, course, note, book, workout, mock or chat in a window of its
 * own, with nothing else on screen. What can pop out, what each window is called, the key that says
 * two windows hold the same thing (so a second click focuses the first instead), and where a new
 * window goes (the size and place last used for its kind, kept on screen).
 *
 * Views are typed loosely here: the renderer's View union lives in renderer/src/state.tsx, and main
 * only ever sees them as data.
 */
import { lessonId } from './lessonLog'
import { modeInfo, type MockMode } from './mocks'

export type PopKind = 'lesson' | 'code' | 'project' | 'course' | 'note' | 'reading' | 'workout' | 'mock' | 'chat' | 'exam' | 'drill' | 'design'

export interface PopView {
  kind: string
  [k: string]: unknown
}

/** What a pop-out is opened with, beside the view itself */
export interface PopInfo {
  key: string
  kind: PopKind
  title: string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p
const noExt = (name: string) => name.replace(/\.(md|markdown|pdf|epub|canvas)$/i, '')
/** "intro-to-payments" → "Intro to payments" */
const humanize = (slug: string) => {
  const s = slug.replace(/[-_]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** The kind of window a view pops out into, or null when it doesn't (Home, Settings, lists) */
export function popKindOf(v: PopView | null | undefined): PopKind | null {
  if (!v) return null
  switch (v.kind) {
    case 'session':
    case 'quiz':
      return 'lesson'
    case 'code':
      return 'code'
    case 'notebook':
      return str(v.path) ? 'project' : null
    case 'courses':
      return 'course'
    case 'file': {
      const p = str(v.path)
      if (!p) return null
      return /\.(pdf|epub)$/i.test(p) ? 'reading' : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p) ? null : 'note'
    }
    // The reading room (and anything else built later) says itself that it is reading
    case 'reading':
    // A book open in the reading room's reader
    case 'reader':
      return 'reading'
    case 'workout':
      return 'workout'
    case 'mock':
      return 'mock'
    case 'chat':
      return 'chat'
    case 'exam':
      return 'exam'
    case 'drill':
      return 'drill'
    case 'design':
      return 'design'
    default:
      return null
  }
}

export const canPopOut = (v: PopView | null | undefined) => popKindOf(v) !== null

/** The lesson record a session is kept under (lib/sessions sessionKey + keepLesson): the same lesson, wherever it is open */
const sessionRecord = (v: PopView) => str(v.lesson) || lessonId(`${v.kind}:${str(v.mode)}:${str(v.topic)}:${v.nonce ?? ''}`)

/**
 * Two views with the same key are the same thing: one window holds it at a time. A project's code
 * is keyed by its folder, so the IDE and a pop-out never edit one project twice.
 */
export function popKeyOf(v: PopView): string {
  switch (v.kind) {
    case 'session':
      return `lesson:${sessionRecord(v)}`
    case 'quiz':
      return `quiz:${JSON.stringify(v.scope ?? null)}`
    case 'code':
      return `code:${str(v.root) || str(v.path)}`
    case 'notebook':
      return `project:${str(v.path)}`
    case 'courses':
      return `course:${str(v.id)}`
    case 'file':
      return `file:${str(v.path)}`
    case 'reading':
    case 'reader':
      return `reading:${str(v.path) || str(v.id)}`
    case 'workout':
      return 'workout'
    case 'mock':
      return `mock:${str(v.mode)}:${str(v.review)}`
    case 'chat':
      return `chat:${str(v.id) || 'new'}`
    case 'exam':
      return `exam:${str(v.topic)}:${v.nonce ?? ''}`
    case 'drill':
      return `drill:${str(v.drill)}`
    case 'design':
      return `design:${str(v.path)}`
    default:
      return `${v.kind}:${JSON.stringify(v)}`
  }
}

/** The thing's own name, before " — Tide" */
export function popNameOf(v: PopView): string {
  switch (v.kind) {
    case 'session':
      return str(v.topic).replace(/\s*\(https?:[^)]*\)\s*$/, '') || 'Lesson'
    case 'quiz':
      return 'Quiz'
    case 'code': {
      const p = str(v.root) || str(v.path)
      return p ? noExt(base(p)) : 'Code'
    }
    case 'notebook':
      return base(str(v.path)) || 'Project'
    case 'courses':
      return str(v.title) || (str(v.id) ? humanize(str(v.id)) : 'Courses')
    case 'file':
    case 'reading':
    case 'reader':
      return str(v.title) || noExt(base(str(v.path))) || 'Reading'
    case 'workout':
      return 'Morning workout'
    case 'mock': {
      const m = str(v.mode)
      try {
        return m ? `Mock: ${modeInfo(m as MockMode).label.toLowerCase()}` : 'Mock interview'
      } catch {
        return 'Mock interview'
      }
    }
    case 'chat':
      return str(v.title) || 'Chat'
    case 'exam':
      return `Exam: ${str(v.topic)}`
    case 'drill':
      return str(v.drill) === 'zetamac' ? 'Arithmetic drill' : str(v.drill) === 'eighty' ? 'Eighty in eight' : 'Drill'
    case 'design':
      return noExt(base(str(v.path))) || 'System design'
    default:
      return 'Tide'
  }
}

/** "Payment rail — Tide": the window's own title, in the Window menu and Mission Control */
export const windowTitle = (name: string) => (name && name !== 'Tide' ? `${name} — Tide` : 'Tide')

export function popInfoOf(v: PopView, name?: string): PopInfo | null {
  const kind = popKindOf(v)
  if (!kind) return null
  return { key: popKeyOf(v), kind, title: windowTitle(name || popNameOf(v)) }
}

// ---------- Where a window goes ----------

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** First-time sizes, by kind: a lesson or a book reads in a column; code and projects want room */
export const DEFAULT_SIZE: Record<PopKind, { width: number; height: number }> = {
  lesson: { width: 1080, height: 820 },
  code: { width: 1320, height: 860 },
  project: { width: 1180, height: 820 },
  course: { width: 1240, height: 840 },
  note: { width: 900, height: 820 },
  reading: { width: 1000, height: 880 },
  workout: { width: 1000, height: 780 },
  mock: { width: 1200, height: 820 },
  chat: { width: 860, height: 800 },
  exam: { width: 1000, height: 820 },
  drill: { width: 820, height: 700 },
  design: { width: 1280, height: 840 }
}

export const MIN_SIZE = { width: 560, height: 420 }

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/**
 * Where a new window of a kind opens: where the last one was left if that is still on a screen
 * (a display unplugged since moves it to the main one), else centred on the main screen. A second
 * window of the same kind steps down and right of one already there, as macOS does.
 */
export function placeWindow(saved: Rect | null | undefined, kind: PopKind, screens: Rect[], taken: Rect[] = []): Rect {
  const main = screens[0] ?? { x: 0, y: 0, width: 1440, height: 900 }
  const size = DEFAULT_SIZE[kind]
  let r: Rect
  // Still on a screen: at least a good handle of it showing
  const visible = !!saved && saved.width > 0 && saved.height > 0 && screens.some((s) => overlap(saved, s) >= Math.min(saved.width * saved.height, 160 * 100))
  if (saved && visible) r = { ...saved }
  else {
    const width = Math.min(saved?.width || size.width, main.width)
    const height = Math.min(saved?.height || size.height, main.height)
    r = { x: Math.round(main.x + (main.width - width) / 2), y: Math.round(main.y + (main.height - height) / 2), width, height }
  }
  r.width = Math.max(MIN_SIZE.width, r.width)
  r.height = Math.max(MIN_SIZE.height, r.height)
  // Step clear of a window already sitting exactly there
  for (let i = 0; i < 12 && taken.some((t) => Math.abs(t.x - r.x) < 8 && Math.abs(t.y - r.y) < 8); i++) {
    r = { ...r, x: r.x + 28, y: r.y + 28 }
  }
  // Kept on the screen it is on: its title bar always reachable
  const screen = screens.find((s) => overlap(r, s) > 0) ?? main
  r.width = Math.min(r.width, screen.width)
  r.height = Math.min(r.height, screen.height)
  r.x = Math.min(Math.max(r.x, screen.x), screen.x + screen.width - r.width)
  r.y = Math.min(Math.max(r.y, screen.y), screen.y + screen.height - r.height)
  return r
}
