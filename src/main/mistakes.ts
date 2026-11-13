import { randomUUID } from 'crypto'
import { localDate } from '@shared/coach'
import { dueMistakes, mistakesMarkdown, recordMistake, retested, type Mistake, type NewMistake } from '@shared/mistakes'
import { joinRel, readText, writeText } from './vault'

/**
 * The mistake journal, kept as data in .tide and as a note in the Coach folder so you can read
 * it like anything else. Writes are queued so answers marked back to back don't race.
 */

const STORE = joinRel('.tide', 'mistakes.json')
export const MISTAKES_NOTE = 'Coach/Mistakes.md'
const today = () => localDate()

export async function listMistakes(): Promise<Mistake[]> {
  try {
    const list = JSON.parse(await readText(STORE))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

let queue: Promise<unknown> = Promise.resolve()
function update(fn: (list: Mistake[]) => Mistake[]): Promise<Mistake[]> {
  const run = queue.then(async () => {
    const before = await listMistakes()
    const after = fn(before)
    if (after === before) return before
    await writeText(STORE, JSON.stringify(after, null, 1))
    await writeText(MISTAKES_NOTE, mistakesMarkdown(after))
    return after
  })
  queue = run.catch(() => {})
  return run
}

export async function addMistakes(items: NewMistake[]): Promise<number> {
  let added = 0
  let fresh: Mistake[] = []
  await update((list) => {
    let out = list
    for (const m of items) {
      const next = recordMistake(out, m, today(), randomUUID().slice(0, 8))
      if (next !== out) added++
      out = next
    }
    fresh = out.filter((m) => !list.some((x) => x.id === m.id))
    return out
  })
  // Each new one is a misconception seen, in the learning event log
  if (fresh.length) await Promise.all([import('@shared/learningEvents'), import('./learningLog')]).then(([{ mistakeEvents }, { learningEvent }]) => learningEvent(fresh.flatMap((m) => mistakeEvents(m)))).catch(() => {})
  return added
}

export async function retestMistake(id: string, correct: boolean): Promise<Mistake | null> {
  let result: Mistake | null = null
  let was = ''
  await update((list) =>
    list.map((m) => {
      if (m.id !== id) return m
      was = m.status
      result = retested(m, correct, today())
      return result
    })
  )
  // Fixed now: the misconception is resolved, in the learning event log
  const r = result as Mistake | null
  if (r && r.status === 'fixed' && was !== 'fixed') await Promise.all([import('@shared/learningEvents'), import('./learningLog')]).then(([{ mistakeEvents }, { learningEvent }]) => learningEvent(mistakeEvents(r, Date.now()))).catch(() => {})
  return result
}

export async function mistakesDue(n = 6): Promise<Mistake[]> {
  return dueMistakes(await listMistakes(), today(), n)
}
