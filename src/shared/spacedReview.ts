/**
 * The week's spaced-review warm-up, as something you can do: the flashcards that are due and the
 * concepts that are fading, named. Opening it runs exactly that (the due cards, then a short recall
 * on each concept) and it is ticked once that is done, never on opening.
 *
 * New cards are not a reason for a warm-up: they come in through lessons and the Review page (20 a
 * session there, a few in Daily practice), so with nothing due and nothing fading no warm-up is planned.
 */
import type { AgendaItem } from './coach'

export interface FadingConcept {
  id: string
  name: string
  /** The chance of remembering it today, 0 to 1 (the knowledge map's estimate) */
  retention?: number
}

export interface SpacedRecall {
  /** The flashcards due when it was planned (ids in .tide/srs.json); opening it takes the ones due then */
  cards: string[]
  /** The fading concepts to recall, lowest retention first */
  concepts: FadingConcept[]
  /** A topic learned the day before, recalled a day later as it starts to fade */
  topics?: string[]
}

/** The most concepts one warm-up recalls */
export const RECALL_MAX = 4

const plain = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** The names it is about, short: two at most, then "+n" */
export function recallNames(r: Pick<SpacedRecall, 'concepts' | 'topics'>): string {
  const names = [...r.concepts.map((c) => plain(c.name)), ...(r.topics ?? []).map(plain)].filter(Boolean)
  const shown = names.slice(0, 2).map((n) => clip(n, 44))
  return names.length ? `${shown.join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}` : ''
}

/**
 * The plan item: its title names what to do ("3 cards due, recall: Two's complement"), its line
 * says why ("fading: 54% retention"). Null when there is nothing due, fading or from yesterday.
 */
export function spacedReviewItem(minutes: number, cards: string[], fading: FadingConcept[], yesterday?: string): AgendaItem | null {
  const concepts = [...fading].sort((a, b) => (a.retention ?? 1) - (b.retention ?? 1)).slice(0, RECALL_MAX)
  const topics = yesterday && !concepts.some((c) => plain(c.name).toLowerCase() === plain(yesterday).toLowerCase()) ? [yesterday] : []
  if (!cards.length && !concepts.length && !topics.length) return null
  const names = recallNames({ concepts, topics })
  const due = cards.length ? `${cards.length} card${cards.length === 1 ? '' : 's'} due` : ''
  const title = due && names ? `${due}, recall: ${names}` : due || `Recall: ${names}`
  const low = concepts[0]?.retention
  const why = [
    concepts.length === 1 && low !== undefined ? `fading: ${Math.round(low * 100)}% retention` : concepts.length > 1 ? `${concepts.length} fading${low !== undefined ? `, lowest ${Math.round(low * 100)}%` : ''}` : '',
    topics.length ? 'learned yesterday' : '',
    due && !concepts.length && !topics.length ? 'due today' : ''
  ].filter(Boolean)
  return {
    kind: 'review',
    title,
    minutes,
    why: why.join(' · ').replace(/^\w/, (c) => c.toUpperCase()),
    recall: { cards, concepts, ...(topics.length ? { topics } : {}) }
  }
}

/** The plan's spaced-review warm-up (not a thread's "Revisit", a phase's firm-up or the mixed review) */
export const isSpacedReview = (it: AgendaItem) => it.kind === 'review' && !it.thread && !it.notebook && !it.gate && !it.mixed

/**
 * What a warm-up recalls when opened: the concepts it names, unless they are solid again by now,
 * then whatever else is fading, up to RECALL_MAX. An item planned before items named anything
 * (a plain "1 fading concept") takes what is fading now.
 */
export function conceptsToRecall(named: FadingConcept[], now: { id: string; status: string }[], fadingNow: FadingConcept[]): FadingConcept[] {
  const status = new Map(now.map((c) => [c.id, c.status]))
  const keep = named.filter((c) => status.get(c.id) !== 'solid')
  const seen = new Set(keep.map((c) => c.id))
  return [...keep, ...fadingNow.filter((c) => !seen.has(c.id))].slice(0, RECALL_MAX)
}

/**
 * The item a tick is meant for. Ticks are sent by position, and the day's list can change under
 * them (the week replanned, a new plan made while a lesson was open): the title must still match,
 * else the item with that title is found, else nothing is ticked.
 */
export function itemToTick(items: AgendaItem[], index: number, title?: string, done = true): number {
  if (title === undefined) return items[index] ? index : -1
  if (items[index]?.title === title) return index
  return items.findIndex((it) => it.title === title && !!it.done !== done)
}

/** A warm-up under way in the app: its due cards in Review, then its recall, then back where it came from */
export interface SpacedRun {
  cards: string[]
  recall: { topic: string; review: import('./review').ReviewSetup; names: string } | null
  /** Where it ends: Your week (opened from the plan) or Review */
  back: 'week' | 'review'
  /** The plan item it ticks once done */
  tick?: { date: string; index: number; title: string }
}
