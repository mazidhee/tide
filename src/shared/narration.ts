import { chunkScript, sourceOf, spokenWords } from './lectureScript'

/**
 * The professor's voice beyond tutor replies: narrating a simulation's tour as it runs, and
 * reading a library book aloud. Pure here: what is said for each tour step, and the text the
 * voice model is given (it reads words in square brackets as delivery tags, so a book's or a
 * simulation's own brackets become round ones).
 */

/** Text for Fish: square brackets are its delivery tags, so the text's own become round ones */
export const fishText = (text: string) => text.replace(/\[/g, '(').replace(/\]/g, ')')

/** A tour step's words as the professor says them: Markdown, code marks and inline maths in plain words */
export function narrationLine(say: string): string {
  return sourceOf(fishText(say))
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface NarrationPiece {
  text: string
  /** The tour step this is said at (from 0) */
  step: number
}

/** A tour cut into pieces for the voice: a step's words stay with their step, a sentence or two a piece */
export function narrationPieces(says: string[]): NarrationPiece[] {
  return says.flatMap((say, step) => {
    const line = narrationLine(say)
    if (!spokenWords(line)) return []
    return chunkScript(line, 30).map((text) => ({ text, step }))
  })
}

/** Which pieces belong to a step, as [from, to) */
export function stepRange(pieces: { step?: number }[], step: number): [number, number] {
  const from = pieces.findIndex((p) => p.step === step)
  if (from < 0) return [0, 0]
  let to = from
  while (to < pieces.length && pieces[to].step === step) to++
  return [from, to]
}

/**
 * How long to wait, after a step's words end, for the simulation to finish what the step set
 * running (its "run" of steps) before going on: long enough for a training run to be seen, never
 * so long the narration seems stuck.
 */
export const CATCH_UP_MS = 8000
/** A breath between steps */
export const STEP_GAP_MS = 450

// ---------- Where you were listening ----------

export interface ListenPlace {
  chapter: number
  unit: number
  /** Characters into the unit: the sentence being read */
  offset: number
}

/** The place to start listening from: where you stopped listening, if that's in the paragraph you're at */
export function resumePlace(saved: ListenPlace | null, at: { chapter: number; unit: number }): ListenPlace {
  if (saved && saved.chapter === at.chapter && saved.unit === at.unit) return saved
  return { chapter: at.chapter, unit: at.unit, offset: 0 }
}
