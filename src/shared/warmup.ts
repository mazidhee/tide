/**
 * The warm-up before a lesson: knowledge compounds. A new lesson first finds what the learner
 * already studied that it builds on (by name, by the roadmap's prerequisites, by the subject it is
 * in, and by what their past lessons talked about), favours what has faded most (FSRS
 * retrievability), and asks two to five quick recall cards on it before teaching starts. Each card
 * is graded like any review, so it feeds the same schedules. Then the tutor is told what held and
 * what faded: it ties the new topic to the old one and re-teaches what slipped.
 *
 * Nothing here asks a model; main/warmup.ts gathers the inputs.
 */
import type { ReviewItem } from './review'
import type { Verdict } from './types'

/** A concept the learner has met, as the warm-up weighs it */
export interface PriorConcept {
  id: string
  name: string
  area: string
  /** FSRS retrievability now, 0 to 1 */
  estimate: number
  status: 'new' | 'learning' | 'solid' | 'fading'
  seen: number
  firstSeen?: number
  lastSeen?: number
  /** The names of its lesson's plan steps: more words it is about */
  steps: string[]
  /** The topic builds on it (the roadmap says so, up to two links back) */
  prerequisite?: boolean
  /** How strongly a search for the topic hit its past lessons' pages, 0 to 1 */
  searched?: number
}

export interface WarmupCard {
  /** The knowledge map's concept it is on */
  concept: string
  conceptName: string
  /** Where it came from, as shown: "From Binary, hexadecimal… · 12 Nov" */
  from: string
  question: string
  /** What a right answer says, when one is kept */
  answer?: string
  /** The kept question it is (a flashcard, a recall question, a mistake); none: from memory */
  item: ReviewItem | null
  /** How solid the concept is now, 0 to 1 */
  estimate: number
}

export interface WarmupSet {
  topic: string
  cards: WarmupCard[]
  /** The concepts the cards are on, with how they stand: told to the tutor if the warm-up is skipped */
  concepts: { name: string; estimate: number; status: PriorConcept['status'] }[]
}

export interface WarmupResult {
  card: WarmupCard
  verdict: Verdict
}

/** Never more than this: a warm-up is a few seconds a card, two minutes at most */
export const WARMUP_MAX_MS = 2 * 60_000
export const WARMUP_MAX_CARDS = 5
/** How many earlier concepts a warm-up draws from */
export const WARMUP_MAX_CONCEPTS = 4
/** Below this, a concept isn't related enough to bring up */
export const MIN_RELEVANCE = 0.35

const STOP = new Set('a an and are as at be by for from how in into is it its of on or the to what when where which why with vs versus using use your you intro introduction basics basic part chapter lesson'.split(' '))

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The words a name is about, plural and singular counted as one */
export function keyWords(s: string): Set<string> {
  const out = new Set<string>()
  for (const w of norm(s).split(' ')) {
    if (w.length < 2 || STOP.has(w)) continue
    out.add(w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
  }
  return out
}

const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n / Math.min(a.size, b.size)
}

/**
 * How related an earlier concept is to the topic, roughly 0 to 2: a prerequisite counts most, then
 * a name that shares its words, then what its lessons talked about, then the same subject.
 */
export function relevance(topic: string, c: PriorConcept, topicArea = ''): number {
  if (norm(c.name) === norm(topic)) return 0
  const tw = keyWords(topic)
  const byName = overlap(tw, keyWords(c.name))
  const bySteps = overlap(tw, keyWords(c.steps.join(' ')))
  const sameArea = !!topicArea && c.area === topicArea
  return (c.prerequisite ? 1 : 0) + 1.2 * byName + 0.5 * bySteps + 0.6 * (c.searched ?? 0) + (sameArea ? 0.3 : 0)
}

/** What has faded counts for more: refreshing it is what the warm-up is for */
export const fadeWeight = (estimate: number) => 0.6 + (1 - Math.max(0, Math.min(1, estimate)))

/** The earlier concepts a lesson on `topic` should warm up on, the most worth it first */
export function rankPrior(topic: string, concepts: PriorConcept[], topicArea = '', max = WARMUP_MAX_CONCEPTS): PriorConcept[] {
  return concepts
    .filter((c) => c.seen > 0 && c.status !== 'new')
    .map((c) => ({ c, r: relevance(topic, c, topicArea) }))
    .filter((x) => x.r >= MIN_RELEVANCE)
    .sort((a, b) => b.r * fadeWeight(b.c.estimate) - a.r * fadeWeight(a.c.estimate) || (b.c.lastSeen ?? 0) - (a.c.lastSeen ?? 0))
    .slice(0, max)
    .map((x) => x.c)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "From Binary, hexadecimal… · 12 Nov" (the year too when it isn't this year) */
export function fromLabel(name: string, when: number | undefined, now = Date.now()): string {
  // Cut at a word, never mid-word: "Binary, hexadecimal and…"
  const cut = name.slice(0, 30).replace(/\s+\S*$/, '').replace(/[\s,;:]+(and|or|of|the|in|to)?$/i, '').replace(/[,;:]$/, '')
  const short = name.length > 30 ? `${cut || name.slice(0, 29)}…` : name
  if (!when) return `From ${short}`
  const d = new Date(when)
  const year = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : ''
  return `From ${short} · ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`
}

/** The question for a concept with nothing kept on it: recalled from memory, checked against its lesson's plan */
const fromMemory = (c: PriorConcept): Pick<WarmupCard, 'question' | 'answer'> => ({
  question: `From memory: what's the key idea of ${c.name}?`,
  ...(c.steps.length ? { answer: `Your lesson covered: ${c.steps.slice(0, 5).join(' · ')}` } : {})
})

/** Kept items to ask first: the most overdue, then the soonest due */
const byDue = (items: ReviewItem[]) => [...items].sort((a, b) => a.due - b.due)

/**
 * The cards for a warm-up: one on each concept (a kept question when there is one, otherwise from
 * memory), then a second on the most faded ones while there's room, two to five in all. None when
 * nothing earlier is related.
 */
export function warmupCards(ranked: PriorConcept[], kept: Map<string, ReviewItem[]>, now = Date.now(), max = WARMUP_MAX_CARDS): WarmupCard[] {
  const card = (c: PriorConcept, item: ReviewItem | null): WarmupCard => ({
    concept: c.id,
    conceptName: c.name,
    from: fromLabel(c.name, c.firstSeen ?? c.lastSeen, now),
    ...(item ? { question: item.question, ...(item.answer ? { answer: item.answer } : {}) } : fromMemory(c)),
    item,
    estimate: c.estimate
  })
  const queues = ranked.map((c) => ({ c, items: byDue(kept.get(c.id) ?? []) }))
  const out: WarmupCard[] = []
  const asked = new Set<string>()
  for (const q of queues) {
    if (out.length >= max) break
    const item = q.items.shift() ?? null
    if (item) asked.add(item.question)
    out.push(card(q.c, item))
  }
  // Room for more: second questions on the most faded first, only ones actually kept
  const faded = [...queues].sort((a, b) => a.c.estimate - b.c.estimate)
  for (let round = 0; out.length < max && out.length < 2 + ranked.length && round < 3; round++) {
    let added = false
    for (const q of faded) {
      if (out.length >= max) break
      const item = q.items.shift()
      if (!item || asked.has(item.question)) continue
      // A solid concept needs one card, not two
      if (q.c.estimate >= 0.9 && out.length >= 2) continue
      asked.add(item.question)
      out.push(card(q.c, item))
      added = true
    }
    if (!added) break
  }
  return out
}

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

/**
 * What the tutor is told before it teaches: what held and what faded in the warm-up (or, skipped,
 * what the lesson builds on and how it stands), and to build on it explicitly.
 */
export function warmupNote(set: WarmupSet, results: WarmupResult[], skipped: boolean): string {
  if (!set.cards.length) return ''
  if (skipped || !results.length) {
    const list = set.concepts.map((c) => `${c.name} (${c.status === 'solid' ? 'solid' : c.status}, ${Math.round(c.estimate * 100)}% now)`).join('; ')
    return `(Tide: this lesson builds on topics the learner studied before: ${list}. They skipped the warm-up on them. Tie the new topic to these explicitly as you teach: name the earlier idea and show how this builds on it. Before relying on one that is fading, re-teach it in two or three sentences.)`
  }
  const held = results.filter((r) => r.verdict === 'correct')
  const faded = results.filter((r) => r.verdict !== 'correct')
  const line = (r: WarmupResult) => `${r.card.conceptName}: "${clip(r.card.question, 140)}"${r.card.answer ? ` (answer: ${clip(r.card.answer, 160)})` : ''}`
  return [
    `(Tide: before this lesson, the learner did a ${results.length}-card warm-up on earlier topics it builds on.`,
    held.length ? `Held: ${held.map(line).join('; ')}.` : '',
    faded.length ? `Faded (${faded.map((r) => (r.verdict === 'partial' ? 'shaky' : 'forgotten')).join(', ')}): ${faded.map(line).join('; ')}.` : '',
    held.length ? 'Open by tying the new topic to what held, explicitly: name the earlier idea and show how this one builds on it (for example, "you know hex is four bits a digit, so a byte is two hex digits").' : '',
    faded.length ? 'Before relying on anything that faded, re-teach it briefly, in two or three sentences, then move on.' : '',
    "Don't ask the warm-up's questions again.)"
  ]
    .filter(Boolean)
    .join('\n')
}

/** The warm-up's tally for the line it leaves behind: "2 held · 1 to refresh" */
export function warmupTally(results: WarmupResult[]): string {
  const held = results.filter((r) => r.verdict === 'correct').length
  const refresh = results.length - held
  return [held ? `${held} held` : '', refresh ? `${refresh} to refresh` : ''].filter(Boolean).join(' · ')
}

/** For the tutor's lookup mid-lesson (the earlier_concepts tool): what it builds on, how each stands */
export function priorText(topic: string, ranked: PriorConcept[], kept: Map<string, ReviewItem[]>, now = Date.now()): string {
  if (!ranked.length) return `Nothing the learner studied before looks related to ${topic}.`
  return ranked
    .map((c) => {
      const items = byDue(kept.get(c.id) ?? []).slice(0, 2)
      const when = fromLabel(c.name, c.firstSeen ?? c.lastSeen, now).replace(/^From [^·]*·?\s*/, '')
      const steps = c.steps.length ? `\n  Covered: ${c.steps.slice(0, 6).join('; ')}` : ''
      const qs = items.length ? `\n  Kept questions: ${items.map((i) => `"${clip(i.question, 120)}"${i.answer ? ` -> ${clip(i.answer, 100)}` : ''}`).join('; ')}` : ''
      return `- ${c.name} [${c.status}, ${Math.round(c.estimate * 100)}% now${when ? `, first studied ${when}` : ''}${c.prerequisite ? ', a prerequisite' : ''}]${steps}${qs}`
    })
    .join('\n')
}
