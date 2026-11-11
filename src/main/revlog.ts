/**
 * The review log: one line per review, recall questions and flashcards alike, in the vault as
 * .tide/revlog.jsonl. It keeps what a scheduler needs to fit its parameters to this learner later:
 * the rating (1 again, 2 hard, 3 good, 4 easy), the days since the item's previous review, the
 * item, its kind and when it happened.
 */
import { promises as fs } from 'fs'
import { absPath, joinRel } from './vault'

export interface RevlogEntry {
  /** 1 again, 2 hard, 3 good, 4 easy */
  rating: 1 | 2 | 3 | 4
  /** Days since the item's previous review; 0 for its first */
  elapsedDays: number
  id: string
  kind: 'recall' | 'flashcard'
  /** ms since 1970 */
  at: number
}

export const REVLOG_FILE = joinRel('.tide', 'revlog.jsonl')
const DAY = 86_400_000

export const RATING = { again: 1, hard: 2, good: 3, easy: 4 } as const

export const elapsedDays = (from: number | undefined, to: number) => (from === undefined ? 0 : Math.max(0, Math.round(((to - from) / DAY) * 1000) / 1000))

/** Appends reviews to the log; a failure to write never stops a review */
export async function appendRevlog(entries: RevlogEntry[]): Promise<void> {
  if (!entries.length) return
  try {
    await fs.mkdir(absPath('.tide'), { recursive: true })
    await fs.appendFile(absPath(REVLOG_FILE), entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  } catch (e) {
    console.warn('[revlog] not written', e)
  }
}
