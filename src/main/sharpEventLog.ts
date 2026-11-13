/**
 * The one place Sharpness writes learning events: Tide's learning event log (main/learningLog
 * learningEvent; shared/sharpEvents maps each act onto its kinds). The first Sharpness build wrote
 * to .tide/sharpness/events.jsonl before the log existed; that file is read in once and retired
 * (renamed to events.jsonl.migrated), with stable keys so a second read-in changes nothing.
 */
import { promises as fs } from 'fs'
import type { EventIn } from '@shared/learningEvents'
import { fromOldEvent, type OldSharpEvent } from '@shared/sharpEvents'
import { absPath } from './vault'

export const OLD_EVENTS_FILE = '.tide/sharpness/events.jsonl'

export type EventSink = (events: EventIn[]) => void

const defaultSink: EventSink = (events) => {
  void import('./learningLog').then((m) => m.learningEvent(events)).catch((e) => console.warn('[sharpness] event log', (e as Error).message))
}

let sink: EventSink = defaultSink
/** For tests: where events go instead of the log */
export const setLearningEventSink = (s: EventSink | null) => (sink = s ?? defaultSink)

/** Writes events; nulls (acts the log has another way) are skipped. Never throws */
export function logLearningEvents(...events: (EventIn | null)[]): void {
  const list = events.filter((e): e is EventIn => !!e)
  if (!list.length) return
  try {
    sink(list)
  } catch (e) {
    console.warn('[sharpness] event log', (e as Error).message)
  }
}

let backfilled = ''

/** The old file read into the log once per vault, then retired. Returns how many events went across */
export async function backfillOldEvents(): Promise<number> {
  let file: string
  try {
    file = absPath(OLD_EVENTS_FILE)
  } catch {
    return 0
  }
  if (backfilled === file) return 0
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    // Nothing to read in (never written, or already retired)
    return 0
  }
  backfilled = file
  const events = text
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        const e = fromOldEvent(JSON.parse(l) as OldSharpEvent)
        return e ? [e] : []
      } catch {
        return []
      }
    })
  if (events.length) {
    const { logEvents } = await import('./learningLog')
    // Written and counted before the file goes, so nothing is lost if the log can't take them
    if (logEvents(events) < events.length) {
      backfilled = ''
      return 0
    }
  }
  await fs.rename(file, `${file}.migrated`).catch(() => {})
  return events.length
}
