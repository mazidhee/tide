/**
 * Tabs in the main window, like Notion's: a few pages lined up at the top, each with its own Back
 * and Forward (lib/history). Kept pure, so it is tested without the app; state.tsx holds it.
 *
 * - Only the tab on screen is mounted. A tab left is kept as its view (with what the page says it
 *   needs to carry on: a book's page, a course's lesson, a lesson's turns) and its scroll, and is
 *   built again when you come back, the same way Back builds a page again.
 * - Some things are one of a kind (a lesson, the IDE on a project, a notebook's kernel, the lab):
 *   going to one another tab holds brings that tab forward instead of opening it twice, as the
 *   pop-out windows do (lib/popout focusIfHeld). Reading (notes, books, courses) can be open twice.
 * - The tabs and the one in front are kept between launches, without the bulky parts (they are
 *   in the ongoing lessons file) and without anything that would start work on its own.
 */
import { navGo, type Nav } from './history'
import { popKeyOf, popKindOf, popNameOf, type PopView } from '@shared/popout'

export interface TabView {
  kind: string
  [k: string]: unknown
}

export interface Tab<V extends TabView = TabView> {
  id: string
  nav: Nav<V>
  /** The page's own name for itself when last on screen ("Payments 101" for a course) */
  title?: string
  /** The tab it was opened from: tabs opened from one tab line up after it, in order */
  opener?: string
}

export interface Tabs<V extends TabView = TabView> {
  tabs: Tab<V>[]
  active: string
}

let counter = 0
export const newTabId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`

export const freshNav = <V>(v: V): Nav<V> => ({ past: [], current: v, future: [] })

export function initialTabs<V extends TabView>(home: V, id = newTabId()): Tabs<V> {
  return { tabs: [{ id, nav: freshNav(home) }], active: id }
}

export const activeTab = <V extends TabView>(t: Tabs<V>): Tab<V> => t.tabs.find((x) => x.id === t.active) ?? t.tabs[0]

export const indexOf = <V extends TabView>(t: Tabs<V>, id: string) => t.tabs.findIndex((x) => x.id === id)

/** Changes one tab's history; null leaves everything as it was */
export function withNav<V extends TabView>(t: Tabs<V>, id: string, change: (n: Nav<V>) => Nav<V> | null): Tabs<V> {
  const i = indexOf(t, id)
  if (i < 0) return t
  const next = change(t.tabs[i].nav)
  if (!next || next === t.tabs[i].nav) return t
  const tabs = t.tabs.slice()
  tabs[i] = { ...tabs[i], nav: next }
  return { ...t, tabs }
}

/** Replaces what a tab shows now, without a step in its history (a page's account of where it is) */
export const replaceCurrent = <V extends TabView>(t: Tabs<V>, id: string, v: V, title?: string): Tabs<V> => {
  const i = indexOf(t, id)
  if (i < 0) return t
  const tabs = t.tabs.slice()
  tabs[i] = { ...tabs[i], nav: { ...tabs[i].nav, current: v }, ...(title !== undefined ? { title } : {}) }
  return { ...t, tabs }
}

export const setTitle = <V extends TabView>(t: Tabs<V>, id: string, title: string | undefined): Tabs<V> => {
  const i = indexOf(t, id)
  if (i < 0 || t.tabs[i].title === title) return t
  const tabs = t.tabs.slice()
  tabs[i] = { ...tabs[i], title }
  return { ...t, tabs }
}

/**
 * Opens a view in a new tab: in front, or behind the one you're on (a ⌘-click). Tabs opened from
 * one tab go after it, in the order they were opened, as in a browser.
 */
export function openTab<V extends TabView>(t: Tabs<V>, v: V, opts: { background?: boolean; id?: string } = {}): Tabs<V> {
  const id = opts.id ?? newTabId()
  const from = indexOf(t, t.active)
  let at = from + 1
  while (at < t.tabs.length && t.tabs[at].opener === t.active) at++
  const tab: Tab<V> = { id, nav: freshNav(v), opener: t.active }
  const tabs = [...t.tabs.slice(0, at), tab, ...t.tabs.slice(at)]
  return { tabs, active: opts.background ? t.active : id }
}

/**
 * Closes a tab. The one in front closing brings its right-hand neighbour forward (the left one at
 * the end). Null when it is the last: the window decides what that means.
 */
export function closeTab<V extends TabView>(t: Tabs<V>, id: string): Tabs<V> | null {
  const i = indexOf(t, id)
  if (i < 0) return t
  if (t.tabs.length === 1) return null
  const tabs = t.tabs.filter((x) => x.id !== id).map((x) => (x.opener === id ? { ...x, opener: undefined } : x))
  if (t.active !== id) return { tabs, active: t.active }
  return { tabs, active: tabs[Math.min(i, tabs.length - 1)].id }
}

/** Closes every tab but one */
export function closeOthers<V extends TabView>(t: Tabs<V>, keep: string): Tabs<V> {
  const tab = t.tabs.find((x) => x.id === keep)
  return tab ? { tabs: [{ ...tab, opener: undefined }], active: keep } : t
}

export function activate<V extends TabView>(t: Tabs<V>, id: string): Tabs<V> {
  if (t.active === id || indexOf(t, id) < 0) return t
  // Once you've moved on, a tab opened from another is just a tab: new ones go after the one in front
  return { tabs: t.tabs.map((x) => (x.opener ? { ...x, opener: undefined } : x)), active: id }
}

/** ⌘1 to ⌘8 go to that tab; ⌘9 always to the last, as in a browser */
export function activateNumber<V extends TabView>(t: Tabs<V>, n: number): Tabs<V> {
  if (n < 1 || n > 9) return t
  const tab = n === 9 ? t.tabs[t.tabs.length - 1] : t.tabs[n - 1]
  return tab ? activate(t, tab.id) : t
}

/** ⌃Tab and ⌃⇧Tab: the next or previous tab, round the end */
export function cycle<V extends TabView>(t: Tabs<V>, delta: number): Tabs<V> {
  if (t.tabs.length < 2) return t
  const i = indexOf(t, t.active)
  const n = t.tabs.length
  return activate(t, t.tabs[(((i + delta) % n) + n) % n].id)
}

/** Drags a tab to another place in the row */
export function moveTab<V extends TabView>(t: Tabs<V>, id: string, to: number): Tabs<V> {
  const from = indexOf(t, id)
  if (from < 0) return t
  const at = Math.max(0, Math.min(t.tabs.length - 1, to))
  if (at === from) return t
  const tabs = t.tabs.slice()
  const [tab] = tabs.splice(from, 1)
  tabs.splice(at, 0, { ...tab, opener: undefined })
  return { ...t, tabs }
}

// ---------- One of a kind ----------

/**
 * The key of a thing only one tab (and one window) may hold at a time, or null when it can be open
 * in several. Lessons, quizzes, exams and mocks keep their state as they go, so two copies would
 * write over each other; the IDE, a Jupyter notebook and the lab each run processes, shared by
 * identity rather than started twice; a workout, a drill and a design board run a clock.
 */
export function tabKeyOf(v: TabView | null | undefined): string | null {
  if (!v) return null
  if (v.kind === 'ipynb') return `ipynb:${String(v.abs ?? '')}`
  if (v.kind === 'lab') return `lab:${String(v.terminal ?? 'lab')}`
  if (v.kind === 'file' && /\.ipynb$/i.test(String(v.path ?? ''))) return `ipynb:${String(v.path)}`
  const kind = popKindOf(v as PopView)
  if (kind === 'lesson' || kind === 'exam' || kind === 'mock' || kind === 'code' || kind === 'workout' || kind === 'drill' || kind === 'design') return popKeyOf(v as PopView)
  return null
}

/** The tab (other than `except`) that holds this one-of-a-kind thing now */
export function holderOf<V extends TabView>(t: Tabs<V>, v: TabView, except?: string): Tab<V> | null {
  const key = tabKeyOf(v)
  if (!key) return null
  return t.tabs.find((x) => x.id !== except && tabKeyOf(x.nav.current) === key) ?? null
}

/** What this window holds that other windows must not open again: every one-of-a-kind tab, by its pop-out key */
export function heldKeys<V extends TabView>(t: Tabs<V>): string[] {
  const keys = new Set<string>()
  for (const x of t.tabs) {
    const v = x.nav.current as PopView
    if (tabKeyOf(v) && popKindOf(v)) keys.add(popKeyOf(v))
  }
  return [...keys]
}

/** The tab showing the thing a pop-out key names */
export const tabForPopKey = <V extends TabView>(t: Tabs<V>, key: string): Tab<V> | null =>
  t.tabs.find((x) => popKindOf(x.nav.current as PopView) && popKeyOf(x.nav.current as PopView) === key) ?? null

/**
 * Going to a view in the tab in front: where it goes, by the one-of-a-kind rule. Another tab
 * holding it comes forward (and goes to the view, which may say more: a turn to show).
 */
export function goTo<V extends TabView>(t: Tabs<V>, v: V): Tabs<V> {
  const other = holderOf(t, v, t.active)
  if (other) return activate(withNav(t, other.id, (n) => navGo(n, v)), other.id)
  return withNav(t, t.active, (n) => navGo(n, v))
}

/** Opening a view in a new tab, unless another tab already holds it: then that one comes forward */
export function goToNewTab<V extends TabView>(t: Tabs<V>, v: V, opts: { background?: boolean; id?: string } = {}): Tabs<V> {
  const other = holderOf(t, v)
  if (other) return opts.background ? t : activate(t, other.id)
  return openTab(t, v, opts)
}

/**
 * A pop-out handed its view back ("Return to main window"): it comes back as a tab, in front. A tab
 * already holding the same thing takes it instead (it carries the pop-out's state: the turns so far).
 */
export function adopt<V extends TabView>(t: Tabs<V>, v: V): Tabs<V> {
  const holder = holderOf(t, v)
  if (holder) return activate(withNav(t, holder.id, (n) => ({ ...n, current: v })), holder.id)
  return openTab(t, v)
}

/** A tab moved to a window of its own: it leaves the row (the only tab goes Home instead) */
export function afterPopOut<V extends TabView>(t: Tabs<V>, id: string, home: V): Tabs<V> {
  return closeTab(t, id) ?? initialTabs(home, id)
}

// ---------- Kept between launches ----------

/** What a view keeps that is too big to keep twice (it is in the ongoing lessons file) */
const BULKY = ['turns', 'threads', 'resume', 'focus']

/**
 * A view as it is kept for the next launch: nothing that would start work on its own when it is
 * opened (a lesson on arrival, a morning workout, a timed design board), nothing bulky.
 */
export function restorable<V extends TabView>(v: V): V {
  const out: TabView = { ...v }
  for (const k of BULKY) delete out[k]
  switch (out.kind) {
    case 'ladder':
      delete out.go
      break
    case 'new-topic':
      delete out.auto
      break
    case 'workout':
      delete out.start
      delete out.championship
      break
    case 'design':
      delete out.start
      delete out.timed
      break
    case 'mock':
      delete out.live
      break
  }
  return out as V
}

const VERSION = 1
const MAX_PAST = 15
const MAX_TABS = 24

export function serializeTabs<V extends TabView>(t: Tabs<V>): string {
  return JSON.stringify({
    v: VERSION,
    active: t.active,
    tabs: t.tabs.slice(0, MAX_TABS).map((x) => ({
      id: x.id,
      ...(x.title ? { title: x.title } : {}),
      nav: { past: x.nav.past.slice(-MAX_PAST).map(restorable), current: restorable(x.nav.current), future: x.nav.future.slice(-MAX_PAST).map(restorable) }
    }))
  })
}

const isView = (v: unknown): v is TabView => !!v && typeof v === 'object' && typeof (v as TabView).kind === 'string'

/** The tabs kept last time, or null when there are none or they can't be read */
export function parseTabs<V extends TabView>(text: string | null | undefined, valid: (v: TabView) => boolean = () => true): Tabs<V> | null {
  if (!text) return null
  try {
    const data = JSON.parse(text) as { v?: number; active?: unknown; tabs?: unknown }
    if (data?.v !== VERSION || !Array.isArray(data.tabs)) return null
    const ok = (v: unknown): v is V => isView(v) && valid(v)
    const tabs: Tab<V>[] = []
    for (const raw of data.tabs as Record<string, unknown>[]) {
      const nav = raw?.nav as Record<string, unknown> | undefined
      if (!nav || !ok(nav.current) || typeof raw.id !== 'string' || tabs.some((x) => x.id === raw.id)) continue
      const list = (l: unknown) => (Array.isArray(l) ? l.filter(ok).map((v) => restorable(v)) : [])
      tabs.push({ id: raw.id, ...(typeof raw.title === 'string' ? { title: raw.title } : {}), nav: { past: list(nav.past), current: restorable(nav.current), future: list(nav.future) } })
    }
    if (!tabs.length) return null
    // A one-of-a-kind thing in two kept tabs (written by an older copy): the second goes
    const seen = new Set<string>()
    const unique = tabs.filter((x) => {
      const k = tabKeyOf(x.nav.current)
      if (!k) return true
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const active = typeof data.active === 'string' && unique.some((x) => x.id === data.active) ? data.active : unique[0].id
    return { tabs: unique, active }
  } catch {
    return null
  }
}

// ---------- What a tab says ----------

const TITLES: Record<string, string> = {
  home: 'Home',
  library: 'Library',
  reading: 'Reading',
  daily: 'Daily practice',
  lessons: 'Past lessons',
  ladder: 'Maths ladder',
  learn: 'Learn',
  practice: 'Practice',
  'new-topic': 'New topic',
  coach: 'Your week',
  learner: 'What the tutor knows',
  wrapup: 'Evening wrap-up',
  weekly: 'Weekly review',
  northstar: 'North Star',
  maths: 'Mental maths',
  help: 'Guide',
  settings: 'Settings',
  workshop: 'Projects',
  projects: 'Projects'
}

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p
const plain = (name: string) => name.replace(/\.(md|markdown|pdf|epub|canvas|ipynb)$/i, '')

/** The tab's label: the page's own name when it gave one, else one made from the view */
export function tabTitle(v: TabView, own?: string): string {
  if (own) return own
  switch (v.kind) {
    case 'file':
    case 'reader':
      return plain(base(String(v.path ?? ''))) || 'Note'
    case 'ipynb':
      return plain(base(String(v.abs ?? ''))) || 'Notebook'
    case 'graph':
      return v.focus ? `Graph: ${plain(base(String(v.focus)))}` : 'What you know'
    case 'study':
      return 'Review'
    case 'courses':
      return v.id ? popNameOf(v as PopView) : 'Courses'
    case 'chat':
      return 'Chat'
    case 'writing':
      return v.path ? plain(base(String(v.path))) : 'Writing'
    case 'comprehension':
      return 'Comprehension'
    case 'lab':
      return v.terminal === 'local' ? 'Terminal' : 'Linux lab'
    case 'session':
    case 'quiz':
    case 'code':
    case 'notebook':
    case 'mock':
    case 'exam':
    case 'drill':
    case 'design':
    case 'workout':
      return popNameOf(v as PopView)
    default:
      return TITLES[v.kind] ?? 'Tide'
  }
}

/** The tab's icon, from Tide's own set (components/Icon) */
export function tabIcon(v: TabView): string {
  switch (v.kind) {
    case 'home':
      return 'home'
    case 'file': {
      const p = String(v.path ?? '')
      if (/\.pdf$/i.test(p)) return 'pdf'
      if (/\.epub$/i.test(p)) return 'book'
      if (/\.canvas$/i.test(p)) return 'canvas'
      if (/\.ipynb$/i.test(p)) return 'flask'
      if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p)) return 'image'
      return 'note'
    }
    case 'reader':
    case 'reading':
      return 'book'
    case 'library':
      return 'library'
    case 'notebook':
      return 'folder'
    case 'graph':
      return 'graph'
    case 'study':
    case 'daily':
      return 'cards'
    case 'quiz':
      return 'quiz'
    case 'session':
    case 'learn':
    case 'new-topic':
      return 'tutor'
    case 'courses':
      return 'course'
    case 'projects':
      return 'projects'
    case 'chat':
      return 'chat'
    case 'lab':
    case 'practice':
      return 'terminal'
    case 'code':
      return 'files'
    case 'ipynb':
      return 'flask'
    case 'design':
      return 'canvas'
    case 'exam':
    case 'mock':
    case 'drill':
    case 'maths':
    case 'workout':
      return 'timer'
    case 'lessons':
      return 'timer'
    case 'coach':
    case 'wrapup':
    case 'weekly':
      return 'list'
    case 'northstar':
      return 'northstar'
    case 'workshop':
      return 'branch'
    case 'help':
      return 'compass'
    case 'settings':
      return 'settings'
    case 'learner':
      return 'person'
    case 'writing':
      return 'compose'
    case 'comprehension':
      return 'book'
    default:
      return 'dot'
  }
}
