/**
 * Pop-out windows, from the page's side (main/popout, shared/popout).
 *
 * The page on screen says how it is carried over (usePopOutSurface): the view with its state (a
 * lesson's turns, the IDE's folder), its name for the window title, and what to do once it has
 * gone (a lesson stops keeping itself here). Anything can then pop out the same way, from its
 * toolbar's button, ⌥⌘N, the View menu or a right-click; and come back with "Return to main window".
 *
 * A thing open in one window is held there: the other windows know (useHeld) and bring that
 * window forward rather than open it twice.
 */
import { useEffect, useRef, useState } from 'react'
import { popInfoOf, popKeyOf, popKindOf, type PopInfo, type PopView } from '@shared/popout'
import type { View } from '../state'

/** This window is a pop-out (its location carries focus=<id>) */
export const inFocusWindow = typeof window !== 'undefined' && /[#&]focus=/.test(window.location.hash)

// ---------- What the other windows hold ----------

let held = new Set<string>()
const heldListeners = new Set<() => void>()
const setHeld = (keys: string[]) => {
  held = new Set(keys)
  heldListeners.forEach((l) => l())
}
try {
  window.tide.windows.held().then(setHeld, () => {})
  window.tide.windows.onHeld(setHeld)
} catch {
  // tests, outside Tide
}

/** Another window holds this */
export const heldElsewhere = (key: string) => held.has(key)

/** The keys other windows hold, as they change */
export function useHeld(): Set<string> {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((n) => n + 1)
    heldListeners.add(l)
    return () => void heldListeners.delete(l)
  }, [])
  return held
}

/**
 * Going to a view another window holds brings that window forward instead (true when it did).
 * Called by the app's setView, so every way there (the sidebar, Carry on, a link) behaves alike.
 */
/** Another window holds this view */
export function heldView(v: View): boolean {
  return !!popKindOf(v as PopView) && held.has(popKeyOf(v as PopView))
}

export function focusIfHeld(v: View): boolean {
  if (!popKindOf(v as PopView)) return false
  const key = popKeyOf(v as PopView)
  if (!held.has(key)) return false
  void window.tide.windows.focusKey(key)
  return true
}

// ---------- The page on screen ----------

export interface PopSurface {
  /** The view as it stands, with what's needed to carry on exactly here */
  view?: () => View | null
  /** Its name, for the window title ("Payment rail" in "Payment rail — Tide") */
  name?: string
  /** Called once it has been handed to another window: stop keeping it here */
  handedOver?: () => void | Promise<unknown>
  /** It can't move right now (a reply is being written) */
  busy?: boolean
  /** Why, when it can't */
  busyText?: string
}

let surface: PopSurface | null = null
const surfaceListeners = new Set<() => void>()
const surfaceChanged = () => surfaceListeners.forEach((l) => l())

/** The page says how it pops out. The latest page to mount wins; it is let go when the page goes. */
export function usePopOutSurface(s: PopSurface) {
  const ref = useRef(s)
  ref.current = s
  useEffect(() => {
    // Always the page's latest state, through one stable object
    const me: PopSurface = {
      view: () => ref.current.view?.() ?? null,
      handedOver: () => ref.current.handedOver?.(),
      get name() {
        return ref.current.name
      },
      get busy() {
        return ref.current.busy
      },
      get busyText() {
        return ref.current.busyText
      }
    }
    surface = me
    surfaceChanged()
    return () => {
      if (surface !== me) return
      surface = null
      surfaceChanged()
    }
  }, [])
  useEffect(() => surfaceChanged(), [s.name, s.busy])
}

/** Tests only: what a page would have registered */
export function setSurfaceForTests(s: PopSurface | null) {
  surface = s
}

export function useSurface(): PopSurface | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((n) => n + 1)
    surfaceListeners.add(l)
    return () => void surfaceListeners.delete(l)
  }, [])
  return surface
}

/**
 * The view to hand over: the page's own account of itself, or just the view. (A page still fading
 * out as the next one comes in doesn't speak for it.)
 */
export function handoverView(current: View): View {
  const v = surface?.view?.()
  return v && v.kind === current.kind ? v : current
}

/** What the window would be called and keyed as, for this view */
export function infoFor(v: View, current: View): PopInfo | null {
  const same = popKindOf(current as PopView) && popKeyOf(current as PopView) === popKeyOf(v as PopView)
  return popInfoOf(v as PopView, same ? surface?.name : undefined)
}

interface AppLike {
  view: View
  canGoBack: boolean
  back(): void
  setView(v: View): void
  toast(text: string, opts?: { tone?: 'info' | 'error' }): void
}

/**
 * Opens a view in a window of its own: the one on screen when none is given. When it is the one
 * on screen, this window steps back to where it was; if a window already holds it, that comes
 * forward instead.
 */
export async function popOut(app: AppLike, view?: View, opts: Partial<PopInfo> & { here?: boolean } = {}): Promise<'opened' | 'focused' | 'refused'> {
  const { here, ...given } = opts
  const sameKey = !!view && popKindOf(view as PopView) !== null && popKindOf(app.view as PopView) !== null && popKeyOf(view as PopView) === popKeyOf(app.view as PopView)
  // The page on screen moves (and this window steps back); anything else just opens
  const onScreen = !view || here || sameKey
  if (onScreen && surface?.busy) {
    app.toast(busyText())
    return 'refused'
  }
  const v = view ?? handoverView(app.view)
  const info = infoFor(v, app.view)
  if (!info) {
    app.toast('This page stays in the main window.')
    return 'refused'
  }
  // A lesson stops keeping itself here before its window starts keeping it there; the IDE saves
  if (onScreen) await surface?.handedOver?.()
  const res = await window.tide.windows.openFocus(v, { ...info, ...given })
  if (res === 'opened' && onScreen && !inFocusWindow) {
    if (app.canGoBack) app.back()
    else app.setView({ kind: 'home' })
  }
  return res
}

/** A pop-out puts what it shows back in the main window, as it stands, and closes */
export async function returnToMain(app: AppLike) {
  if (surface?.busy) {
    app.toast(busyText())
    return
  }
  const v = handoverView(app.view)
  await surface?.handedOver?.()
  await window.tide.windows.returnToMain(v)
}

/** Why the page on screen can't move just now */
export const busyText = () => surface?.busyText ?? 'It can move once the reply is written.'

/** The shortcut's label, for tooltips */
export const POP_KEYS = '⌥⌘N'

/**
 * What of Tide's own chrome a window shows. A pop-out shows none of it: no sidebar, not even the
 * one that peeks from the left edge, no floating buttons, no tutor panel; just the one thing.
 */
export function chromeFor(o: { focus: boolean; collapsed: boolean; immersive: boolean; mockFocus: boolean }) {
  const away = o.focus || o.mockFocus
  return {
    sidebar: !away && !o.collapsed && !o.immersive,
    /** The sidebar that slides over from the left edge: a course's, or a collapsed sidebar's */
    peek: !o.focus && (o.immersive || o.collapsed),
    /** ⌘\ opens the peek (in a course) rather than bringing the sidebar back */
    peekKeys: !o.focus && o.immersive,
    floatingControls: !away && o.collapsed && !o.immersive,
    tutorPanel: !o.focus
  }
}
