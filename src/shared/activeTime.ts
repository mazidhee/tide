/**
 * When study time counts: only while you are actually at it. The window is focused, the page is
 * visible and on something to study, and you've touched the keyboard, mouse or trackpad in the
 * last couple of minutes. A lesson left open in Carry on, a pop-out behind other windows, or the
 * tutor's reply streaming while you're away from the Mac never counts.
 */

/** No input for this long and the clock stops */
export const IDLE_MS = 150_000
/** The tutor replying while you read counts, but only this soon after your own last input */
export const READING_GRACE_MS = 5 * 60_000

export interface ActiveState {
  now: number
  /** Your last key, click, scroll or (throttled) pointer move in this window */
  lastInput: number
  /** The last streamed bit of a reply this window shows; 0 for none */
  lastTutor?: number
  focused: boolean
  visible: boolean
  /** The page on screen is something to study (a lesson, reading, practice) */
  onStudy: boolean
}

/** Whether this moment counts as study time */
export function studyingNow(s: ActiveState): boolean {
  if (!s.onStudy || !s.focused || !s.visible) return false
  if (s.now - s.lastInput < IDLE_MS) return true
  return !!s.lastTutor && s.now - s.lastTutor < IDLE_MS && s.now - s.lastInput < READING_GRACE_MS
}

/** When the active stretch really ended: the last sign of you (or the reply you were reading), plus a beat */
export function activeEnd(s: Pick<ActiveState, 'now' | 'lastInput' | 'lastTutor'>): number {
  const last = Math.max(s.lastInput, s.lastTutor && s.lastTutor - s.lastInput < READING_GRACE_MS ? s.lastTutor : 0)
  return Math.min(s.now, last + 30_000)
}

export interface FocusEntry {
  start: number
  minutes: number
  label?: string
  path?: string
  kind?: string
}

/**
 * Logged stretches with overlaps taken out: two windows (a lesson popped out beside the main
 * window) could both log the same minutes before only the focused window counted. Each later
 * stretch is trimmed to start where the earlier one ended; one wholly inside another goes. Read
 * that way, the file itself is never rewritten.
 */
export function withoutOverlaps<T extends FocusEntry>(entries: T[]): T[] {
  const sorted = [...entries].filter((e) => Number.isFinite(e.start) && e.minutes > 0).sort((a, b) => a.start - b.start)
  const out: T[] = []
  let until = -Infinity
  for (const e of sorted) {
    const end = e.start + e.minutes * 60_000
    if (end <= until) continue
    const start = Math.max(e.start, until)
    const minutes = Math.round(((end - start) / 60_000) * 10) / 10
    if (minutes >= 0.5) out.push(start === e.start ? e : { ...e, start, minutes })
    until = end
  }
  return out
}
