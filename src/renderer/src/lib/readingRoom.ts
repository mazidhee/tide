import { useEffect, useState } from 'react'
import type { RoomState } from '@shared/readingRoom'

/**
 * The reading room in the window: the shelf, shared by the room, Home and the router (a book on
 * the shelf opens in the reader), kept fresh after every change; and the reader's own settings
 * (day or night paper, text size, width), which are this window's conveniences.
 */

let shelf: { room: RoomState; week: number } | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

export function refreshShelf(): Promise<void> {
  loading = window.tide.room
    .shelf()
    .then((s) => {
      shelf = s
      listeners.forEach((l) => l())
    })
    .catch(() => {})
    .finally(() => (loading = null))
  return loading
}

export function useShelf(): { room: RoomState; week: number } | null {
  const [, tick] = useState(0)
  useEffect(() => {
    const l = () => tick((n) => n + 1)
    listeners.add(l)
    if (!shelf && !loading) refreshShelf()
    return () => {
      listeners.delete(l)
    }
  }, [])
  return shelf
}

export const onShelf = (path: string) => !!shelf?.room.books.some((b) => b.path === path)

// ---------- The reader's settings ----------

export interface ReaderPrefs {
  paper: 'day' | 'night'
  /** Text size in px */
  size: number
  width: 'narrow' | 'normal' | 'wide'
}

const KEY = 'tide.reader.prefs'
const isDark = () => ['graphite', 'dark', 'midnight', 'ember'].includes(document.documentElement.dataset.theme ?? '')

export function readerPrefs(): ReaderPrefs {
  let saved: Partial<ReaderPrefs> = {}
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    // A private window or cleared storage: the defaults
  }
  return { paper: saved.paper ?? (isDark() ? 'night' : 'day'), size: Math.max(15, Math.min(28, saved.size ?? 20)), width: saved.width ?? 'normal' }
}

export function saveReaderPrefs(p: ReaderPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Kept for this session only
  }
}

export const MEASURE: Record<ReaderPrefs['width'], number> = { narrow: 540, normal: 640, wide: 760 }

// ---------- Checks in the book (components/comprehension/InBookCheck) ----------

/** Per book: whether the in-book checks are on (off by default), how often, and the sections skipped (by sectionKey) */
export interface BookChecks {
  on: boolean
  every: 'chapter' | 'section'
  skipped: string[]
}

const checksKey = (path: string) => `tide.reader.checks:${path}`

export function bookChecksPrefs(path: string): BookChecks {
  let saved: Partial<BookChecks> = {}
  try {
    saved = JSON.parse(localStorage.getItem(checksKey(path)) ?? '{}')
  } catch {
    // The defaults: off
  }
  return { on: saved.on === true, every: saved.every === 'section' ? 'section' : 'chapter', skipped: Array.isArray(saved.skipped) ? saved.skipped.filter((s) => typeof s === 'string').slice(-500) : [] }
}

export function saveBookChecksPrefs(path: string, c: BookChecks) {
  try {
    localStorage.setItem(checksKey(path), JSON.stringify(c))
  } catch {
    // Kept for this session only
  }
}
