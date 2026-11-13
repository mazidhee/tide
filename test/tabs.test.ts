import { describe, expect, it } from 'vitest'
import * as T from '../src/renderer/src/lib/tabs'
import { navBack, navForward } from '../src/renderer/src/lib/history'
import { tabKey } from '../src/renderer/src/lib/tabKeys'
import { clickIntent, clearIntent, setIntent, takeIntent } from '../src/renderer/src/lib/tabIntent'
import { captureScroll, find, pathOf, restoreScroll } from '../src/renderer/src/lib/tabScroll'
import { popKeyOf } from '../src/shared/popout'

type V = T.TabView
const HOME: V = { kind: 'home' }
const note = (path: string): V => ({ kind: 'file', path })
const lesson = (topic: string, nonce = 1): V => ({ kind: 'session', mode: 'teach', scope: { kind: 'vault' }, topic, nonce })
const course: V = { kind: 'courses', id: 'payments-101', lesson: 'rails' }
const notebook: V = { kind: 'notebook', path: 'Payments' }

const ids = (t: T.Tabs) => t.tabs.map((x) => x.id)
const views = (t: T.Tabs) => t.tabs.map((x) => x.nav.current)
const front = (t: T.Tabs) => T.activeTab(t).nav.current

/** Three tabs: Home, a note and a course, the course in front */
function three(): T.Tabs {
  let t = T.initialTabs(HOME, 'a')
  t = T.openTab(t, note('Rails.md'), { id: 'b' })
  t = T.openTab(t, course, { id: 'c' })
  return t
}

describe('opening, closing and switching tabs', () => {
  it('opens a new tab in front, after the one you were on', () => {
    const t = three()
    expect(ids(t)).toEqual(['a', 'b', 'c'])
    expect(t.active).toBe('c')
    expect(front(t)).toEqual(course)
  })

  it('opens a ⌘-click behind, lined up after the tab it came from, in order', () => {
    let t = T.initialTabs(HOME, 'a')
    t = T.openTab(t, note('One.md'), { id: 'x', background: true })
    t = T.openTab(t, note('Two.md'), { id: 'y', background: true })
    expect(t.active).toBe('a')
    expect(ids(t)).toEqual(['a', 'x', 'y'])
    // Once you've moved on, the next one goes right after the tab in front
    t = T.activate(t, 'x')
    t = T.openTab(t, note('Three.md'), { id: 'z', background: true })
    expect(ids(t)).toEqual(['a', 'x', 'z', 'y'])
  })

  it('closing the tab in front brings its right-hand neighbour forward, or the left at the end', () => {
    let t = T.activate(three(), 'b')
    t = T.closeTab(t, 'b')!
    expect(ids(t)).toEqual(['a', 'c'])
    expect(t.active).toBe('c')
    t = T.closeTab(t, 'c')!
    expect(t.active).toBe('a')
  })

  it('closing a tab behind leaves the one in front alone; the last tab is the window’s to close', () => {
    let t = three()
    t = T.closeTab(t, 'a')!
    expect(t.active).toBe('c')
    expect(T.closeTab(T.initialTabs(HOME, 'only'), 'only')).toBeNull()
    expect(T.closeOthers(three(), 'b')).toMatchObject({ active: 'b', tabs: [{ id: 'b' }] })
  })

  it('⌘1–8 go to that tab, ⌘9 to the last; ⌃Tab and ⌃⇧Tab go round', () => {
    let t = three()
    expect(T.activateNumber(t, 1).active).toBe('a')
    expect(T.activateNumber(t, 2).active).toBe('b')
    expect(T.activateNumber(t, 7).active).toBe('c')
    expect(T.activateNumber(T.activate(t, 'a'), 9).active).toBe('c')
    t = T.cycle(t, 1)
    expect(t.active).toBe('a')
    t = T.cycle(t, -1)
    expect(t.active).toBe('c')
    expect(T.cycle(T.initialTabs(HOME), 1).tabs).toHaveLength(1)
  })

  it('reorders by dragging, keeping which tab is in front', () => {
    let t = three()
    t = T.moveTab(t, 'c', 0)
    expect(ids(t)).toEqual(['c', 'a', 'b'])
    expect(t.active).toBe('c')
    t = T.moveTab(t, 'c', 99)
    expect(ids(t)).toEqual(['a', 'b', 'c'])
    expect(T.moveTab(t, 'nope', 0)).toBe(t)
  })
})

describe('each tab has its own Back and Forward', () => {
  it('pages opened in one tab never show up in another’s history', () => {
    let t = three()
    t = T.goTo(t, { kind: 'library' })
    t = T.goTo(t, note('Ledger.md'))
    t = T.activate(t, 'b')
    t = T.goTo(t, notebook)
    const b = t.tabs.find((x) => x.id === 'b')!.nav
    const c = t.tabs.find((x) => x.id === 'c')!.nav
    expect(b.past).toEqual([note('Rails.md')])
    expect(c.past).toEqual([course, { kind: 'library' }])
    expect(c.current).toEqual(note('Ledger.md'))
    // Back in this tab goes to its own last page
    t = T.withNav(t, 'b', (n) => navBack(n, () => false, HOME))
    expect(front(t)).toEqual(note('Rails.md'))
    t = T.withNav(t, 'b', (n) => navForward(n, () => false))
    expect(front(t)).toEqual(notebook)
    // …and the other tab's history is as it was
    expect(t.tabs.find((x) => x.id === 'c')!.nav).toBe(c)
  })

  it('keeps what a page said about where it was when its tab was left (a book’s page, a course’s lesson)', () => {
    let t = three()
    t = T.replaceCurrent(t, 'c', { ...course, lesson: 'settlement' }, 'Payments 101')
    expect(T.activeTab(t).nav.current).toMatchObject({ lesson: 'settlement' })
    expect(T.activeTab(t).title).toBe('Payments 101')
    // Replacing is not a step: Back still goes where it went before
    expect(T.activeTab(t).nav.past).toEqual([])
  })
})

describe('one lesson, one place', () => {
  it('going to a lesson another tab holds brings that tab forward instead of a second copy', () => {
    let t = three()
    t = T.goTo(t, lesson('Payment rails'))
    const holder = t.active
    t = T.activate(t, 'a')
    t = T.goTo(t, lesson('Payment rails'))
    expect(t.active).toBe(holder)
    expect(views(t).filter((v) => v.kind === 'session')).toHaveLength(1)
    // Home is still Home in the tab you were on
    expect(t.tabs.find((x) => x.id === 'a')!.nav.current).toEqual(HOME)
  })

  it('opening it in a new tab does the same; a background open of it adds nothing', () => {
    let t = T.goTo(three(), lesson('Ledgers'))
    t = T.activate(t, 'a')
    const n = t.tabs.length
    expect(T.goToNewTab(t, lesson('Ledgers'), { background: true }).tabs).toHaveLength(n)
    const t2 = T.goToNewTab(t, lesson('Ledgers'))
    expect(t2.tabs).toHaveLength(n)
    expect(t2.active).toBe('c')
  })

  it('the IDE, a Jupyter notebook and the lab are shared by identity; notes and courses may be open twice', () => {
    expect(T.tabKeyOf({ kind: 'code', root: '/p' })).toBe('code:/p')
    expect(T.tabKeyOf({ kind: 'ipynb', abs: '/p/a.ipynb' })).toBe('ipynb:/p/a.ipynb')
    expect(T.tabKeyOf({ kind: 'lab', terminal: 'lab' })).toBe('lab:lab')
    expect(T.tabKeyOf(note('a.md'))).toBeNull()
    expect(T.tabKeyOf(course)).toBeNull()
    let t = T.goTo(three(), { kind: 'code', root: '/p' })
    t = T.activate(t, 'a')
    t = T.goToNewTab(t, { kind: 'code', root: '/p', file: 'main.py' })
    expect(t.active).toBe('c')
    expect(T.activeTab(t).nav.current).toEqual({ kind: 'code', root: '/p' })
    // A note may be in two tabs
    expect(T.goToNewTab(t, note('Rails.md')).tabs).toHaveLength(4)
  })

  it('tells other windows what its tabs hold, by the pop-out key, so they never open it twice', () => {
    let t = T.goTo(three(), lesson('Ledgers'))
    t = T.openTab(t, { kind: 'code', root: '/p' })
    expect(T.heldKeys(t).sort()).toEqual([popKeyOf(lesson('Ledgers') as never), 'code:/p'].sort())
    expect(T.tabForPopKey(t, 'code:/p')?.nav.current).toEqual({ kind: 'code', root: '/p' })
  })
})

describe('moving a tab to a window of its own, and back', () => {
  it('the tab leaves the row; the only tab goes Home instead', () => {
    const t = three()
    expect(ids(T.afterPopOut(t, 'c', HOME))).toEqual(['a', 'b'])
    const one = T.afterPopOut(T.initialTabs(lesson('x'), 'solo'), 'solo', HOME)
    expect(one.tabs).toHaveLength(1)
    expect(front(one)).toEqual(HOME)
  })

  it('"Return to main window" brings it back as a tab, in front, with the state it carried', () => {
    const back = { ...lesson('Ledgers'), turns: [{ role: 'user', content: 'go on' }] }
    let t = T.adopt(three(), back)
    expect(t.tabs).toHaveLength(4)
    expect(front(t)).toEqual(back)
    // A tab already holding it takes it rather than a second
    t = T.activate(t, 'a')
    t = T.adopt(t, { ...back, turns: [] })
    expect(t.tabs).toHaveLength(4)
    expect(front(t)).toMatchObject({ kind: 'session', turns: [] })
  })
})

describe('kept between launches', () => {
  it('restores the tabs, their order, history and the one in front', () => {
    let t = three()
    t = T.goTo(t, note('Ledger.md'))
    t = T.setTitle(t, 'c', 'Ledger')
    t = T.activate(t, 'b')
    const back = T.parseTabs(T.serializeTabs(t))!
    expect(ids(back)).toEqual(['a', 'b', 'c'])
    expect(back.active).toBe('b')
    expect(back.tabs[2].nav.past).toEqual([course])
    expect(back.tabs[2].title).toBe('Ledger')
  })

  it('keeps nothing bulky, and nothing that would start work on its own when Tide opens', () => {
    const t = T.openTab(T.initialTabs(HOME, 'a'), { ...lesson('x'), turns: [{ role: 'user', content: 'hi' }], focus: { turn: 1 } }, { id: 'l' })
    const t2 = T.openTab(t, { kind: 'workout', start: true, championship: true }, { id: 'w' })
    const t3 = T.openTab(t2, { kind: 'new-topic', topic: 'Swaps', auto: true }, { id: 'n' })
    const back = T.parseTabs(T.serializeTabs(t3))!
    expect(back.tabs.find((x) => x.id === 'l')!.nav.current).toEqual(lesson('x'))
    expect(back.tabs.find((x) => x.id === 'w')!.nav.current).toEqual({ kind: 'workout' })
    expect(back.tabs.find((x) => x.id === 'n')!.nav.current).toEqual({ kind: 'new-topic', topic: 'Swaps' })
  })

  it('reads nothing it can’t trust: bad text, unknown pages, a lesson kept twice, a lost active tab', () => {
    expect(T.parseTabs('')).toBeNull()
    expect(T.parseTabs('{nope')).toBeNull()
    expect(T.parseTabs(JSON.stringify({ v: 99, tabs: [] }))).toBeNull()
    const text = JSON.stringify({
      v: 1,
      active: 'gone',
      tabs: [
        { id: 'a', nav: { past: [], current: { kind: 'home' }, future: [] } },
        { id: 'b', nav: { past: [{ kind: 'zap' }], current: lesson('x'), future: [] } },
        { id: 'c', nav: { past: [], current: lesson('x'), future: [] } },
        { id: 'd', nav: { past: [], current: { kind: 'zap' }, future: [] } },
        { id: 'e' }
      ]
    })
    const back = T.parseTabs(text, (v) => v.kind !== 'zap')!
    expect(ids(back)).toEqual(['a', 'b'])
    expect(back.tabs[1].nav.past).toEqual([])
    expect(back.active).toBe('a')
  })
})

describe('what a tab says', () => {
  it('names and marks each page', () => {
    expect(T.tabTitle(note('Maths/Linear algebra.md'))).toBe('Linear algebra')
    expect(T.tabTitle(lesson('Payment rails'))).toBe('Payment rails')
    expect(T.tabTitle(notebook)).toBe('Payments')
    expect(T.tabTitle(course, 'Payments 101')).toBe('Payments 101')
    expect(T.tabTitle(HOME)).toBe('Home')
    expect(T.tabIcon(note('a.pdf'))).toBe('pdf')
    expect(T.tabIcon(lesson('x'))).toBe('tutor')
    expect(T.tabIcon(course)).toBe('course')
  })
})

// ---------- Keys, clicks and scroll ----------

/** An element stand-in: a text field, an editor, or the page */
const el = (field: boolean, code = false) => ({ matches: () => field, isContentEditable: false, closest: (s: string) => (code && s.includes('monaco') ? {} : null) })
const key = (k: Partial<KeyboardEvent> & { target?: unknown }) => {
  const target = k.target ?? el(false)
  return { key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...k, target, composedPath: () => [target] } as unknown as KeyboardEvent
}

describe('tab keys', () => {
  it('⌘1–9 go to a tab and ⌃Tab, ⌃⇧Tab go round', () => {
    expect(tabKey(key({ metaKey: true, key: '3', code: 'Digit3' }))).toEqual({ go: 3 })
    expect(tabKey(key({ ctrlKey: true, key: 'Tab' }))).toEqual({ cycle: 1 })
    expect(tabKey(key({ ctrlKey: true, shiftKey: true, key: 'Tab' }))).toEqual({ cycle: -1 })
    expect(tabKey(key({ metaKey: true, shiftKey: true, key: '3', code: 'Digit3' }))).toBeNull()
    expect(tabKey(key({ metaKey: true, key: '0', code: 'Digit0' }))).toBeNull()
    expect(tabKey(key({ key: 'Tab' }))).toBeNull()
  })

  it('⌘1–9 never fire while you type; ⌃Tab is left to a terminal or the code editor only', () => {
    const field = el(true)
    expect(tabKey(key({ metaKey: true, key: '2', code: 'Digit2', target: field }))).toBeNull()
    // A note's editor or a text field has no use for ⌃Tab: it still goes round the tabs
    expect(tabKey(key({ ctrlKey: true, key: 'Tab', target: field }))).toEqual({ cycle: 1 })
    expect(tabKey(key({ ctrlKey: true, key: 'Tab', target: el(true, true) }))).toBeNull()
    expect(tabKey(key({ metaKey: true, key: '2', code: 'Digit2', isComposing: true }))).toBeNull()
  })
})

describe('⌘-click and middle click', () => {
  const at = (opens: boolean, own = false) => ({ closest: (s: string) => (own && s.includes('monaco') ? {} : opens && !s.includes('monaco') ? {} : null) })
  const click = (o: Partial<{ button: number; metaKey: boolean; shiftKey: boolean; target: unknown }>) => ({ button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: at(true), ...o }) as never

  it('⌘-click opens behind, ⌘⇧-click in front, a middle click on a link behind', () => {
    expect(clickIntent(click({ metaKey: true }))).toBe('background')
    expect(clickIntent(click({ metaKey: true, shiftKey: true }))).toBe('front')
    expect(clickIntent(click({ button: 1 }))).toBe('background')
    expect(clickIntent(click({ button: 1, target: at(false) }))).toBeNull()
    expect(clickIntent(click({}))).toBeNull()
  })

  it('leaves a code editor’s own ⌘-click alone', () => {
    expect(clickIntent(click({ metaKey: true, target: at(true, true) }))).toBeNull()
  })

  it('the intent is taken once, and only for a moment', () => {
    setIntent(true, 1000)
    expect(takeIntent(1100)).toEqual({ background: true, at: 1000 })
    expect(takeIntent(1100)).toBeNull()
    setIntent(false, 1000)
    expect(takeIntent(5000)).toBeNull()
    setIntent(false, 1000)
    clearIntent()
    expect(takeIntent(1001)).toBeNull()
  })
})

interface FakeNode {
  tagName: string
  className: string
  parentElement: FakeNode | null
  children: FakeNode[]
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
}
function node(className: string, kids: FakeNode[] = [], h = 100): FakeNode {
  const n: FakeNode = { tagName: 'DIV', className, parentElement: null, children: kids, scrollTop: 0, scrollLeft: 0, scrollHeight: h, clientHeight: 100, scrollWidth: 100, clientWidth: 100 }
  kids.forEach((k) => (k.parentElement = n))
  return n
}
const all = (n: FakeNode): FakeNode[] => n.children.flatMap((c) => [c, ...all(c)])
const rooted = (n: FakeNode) => Object.assign(n, { querySelectorAll: () => all(n) })

describe('where a tab was scrolled', () => {
  it('finds the scrolled element again in the page built anew', () => {
    const scroller = node('doc-scroll', [], 3000)
    const root = rooted(node('tab-body', [node('doc-toolbar'), node('doc-view', [node('doc-scroll'), scroller])]))
    scroller.scrollTop = 1200
    const spots = captureScroll(root)
    expect(spots).toEqual([{ path: 'div.doc-view:0/div.doc-scroll:1', top: 1200, left: 0 }])
    expect(pathOf(scroller, root)).toBe(spots[0].path)
    expect(find(root, spots[0].path)).toBe(scroller)
  })

  it('puts it back once the page is tall enough, and gives up when you scroll', () => {
    const scroller = node('doc-scroll', [], 300)
    const root = node('tab-body', [scroller])
    const frames: (() => void)[] = []
    let now = 0
    restoreScroll(root, [{ path: 'div.doc-scroll:0', top: 900, left: 0 }], { frame: (cb) => frames.push(cb), now: () => now })
    // Not tall enough yet: it waits
    expect(scroller.scrollTop).toBe(0)
    scroller.scrollHeight = 2000
    frames.shift()!()
    expect(scroller.scrollTop).toBe(900)
    expect(frames).toHaveLength(0)

    const other = node('doc-scroll', [], 200)
    const root2 = node('tab-body', [other])
    const stop = restoreScroll(root2, [{ path: 'div.doc-scroll:0', top: 900, left: 0 }], { frame: (cb) => frames.push(cb), now: () => now })
    stop()
    other.scrollHeight = 2000
    frames.shift()?.()
    expect(other.scrollTop).toBe(0)
  })
})
