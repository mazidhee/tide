import { useEffect, useState } from 'react'

/**
 * A study timer. Its state is kept in localStorage, so a running session survives reloads and
 * restarts; one that ran out while the app was closed is logged when it opens again.
 */

export interface FocusState {
  startedAt: number
  /** Planned length; null counts up with no limit */
  durationMs: number | null
  /** Set while paused */
  pausedAt: number | null
  /** Time spent paused so far */
  pausedMs: number
  /** What the session is on, when started from a note, book or problem */
  context?: FocusContext
}

export interface FocusContext {
  label: string
  path?: string
  kind?: 'note' | 'book' | 'problem' | 'session'
}

const KEY = 'tide.focus'
const listeners = new Set<() => void>()

function read(): FocusState | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as FocusState) : null
  } catch {
    return null
  }
}

function write(s: FocusState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    // the timer still runs for this session
  }
  listeners.forEach((l) => l())
}

/** Focused time so far, not counting pauses */
export const elapsed = (s: FocusState, now = Date.now()) => (s.pausedAt ?? now) - s.startedAt - s.pausedMs
export const remaining = (s: FocusState, now = Date.now()) => (s.durationMs === null ? null : Math.max(0, s.durationMs - elapsed(s, now)))

export const startFocus = (minutes: number | null, context?: FocusContext) =>
  write({ startedAt: Date.now(), durationMs: minutes === null ? null : minutes * 60_000, pausedAt: null, pausedMs: 0, context })

export function pauseFocus() {
  const s = read()
  if (s && !s.pausedAt) write({ ...s, pausedAt: Date.now() })
}

export function resumeFocus() {
  const s = read()
  if (s?.pausedAt) write({ ...s, pausedMs: s.pausedMs + (Date.now() - s.pausedAt), pausedAt: null })
}

export function extendFocus(minutes: number) {
  const s = read()
  if (s && s.durationMs !== null) write({ ...s, durationMs: s.durationMs + minutes * 60_000 })
}

/** Ends the session and logs the focused time; returns the minutes logged */
export async function endFocus(at = Date.now()): Promise<number> {
  const s = read()
  if (!s) return 0
  write(null)
  const focused = Math.min(elapsed(s, at), s.durationMs ?? Infinity)
  const minutes = Math.round(focused / 60_000)
  if (minutes >= 1) await window.tide.learn.logFocus(at - focused, at, s.context).catch(() => {})
  return minutes
}

export const formatClock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** The current session, re-rendering every second while one is running */
export function useFocus(): { state: FocusState | null; now: number } {
  const [state, setState] = useState(read)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const sync = () => setState(read())
    listeners.add(sync)
    const onStorage = (e: StorageEvent) => e.key === KEY && sync()
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  useEffect(() => {
    if (!state || state.pausedAt) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [state])
  return { state, now }
}

/** A soft two-note chime, made on the spot so no sound file is needed */
export function chime() {
  try {
    const ctx = new AudioContext()
    ;[660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.22
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 1)
    })
    setTimeout(() => ctx.close(), 1600)
  } catch {
    // no audio device
  }
}
