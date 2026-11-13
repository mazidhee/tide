/**
 * The one place Sharpness writes learning events (shared/sharpEvents). Tide's learning event log is
 * being built separately (branch learner-model); until it lands, events go to
 * .tide/sharpness/events.jsonl in the same shape. When it lands, point `sink` at its writer with
 * setLearningEventSink (or change defaultSink): nothing else in Sharpness changes.
 */
import { promises as fs } from 'fs'
import type { LearningEvent } from '@shared/sharpEvents'
import { absPath } from './vault'

export const EVENTS_FILE = '.tide/sharpness/events.jsonl'

export type EventSink = (events: LearningEvent[]) => Promise<void>

const defaultSink: EventSink = async (events) => {
  await fs.mkdir(absPath('.tide/sharpness'), { recursive: true })
  await fs.appendFile(absPath(EVENTS_FILE), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

let sink: EventSink = defaultSink
export const setLearningEventSink = (s: EventSink | null) => (sink = s ?? defaultSink)

// In order, one write at a time; a failed write never breaks the feature that logged it
let queue: Promise<unknown> = Promise.resolve()

export function logLearningEvents(...events: LearningEvent[]): Promise<void> {
  if (!events.length) return Promise.resolve()
  const run = queue.then(() => sink(events)).catch((e) => console.warn('[sharpness] event log', (e as Error).message))
  queue = run
  return run
}

/** Events written so far (the fallback file only), for the tests and a future import into the real log */
export async function readLearningEvents(): Promise<LearningEvent[]> {
  try {
    return (await fs.readFile(absPath(EVENTS_FILE), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as LearningEvent]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}
