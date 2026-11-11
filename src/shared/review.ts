/**
 * The two ways back into a topic from What you know.
 *
 * Review now is spaced review: the questions kept on that topic (recall questions missed in a
 * lesson, flashcards, open mistakes) that are due, asked again one at a time, each one scheduled
 * by how it went in its own store. Nothing due yet, and it takes the ones coming due soonest;
 * nothing kept at all, and it asks a few questions from memory on what was taught.
 *
 * Quick check is a short fresh diagnostic: three to five new questions across the topic's parts,
 * marked without teaching, to see where it stands now.
 */

export type ReviewItemKind = 'recall' | 'card' | 'mistake'

export interface ReviewItem {
  kind: ReviewItemKind
  /** Its id in its own store (.tide/recall.json, .tide/srs.json, .tide/mistakes.json) */
  id: string
  topic: string
  question: string
  /** What a right answer says, when it is kept (a card's back, a mistake's fix) */
  answer?: string
  /** The note a card is in */
  path?: string
  /** When it is due (ms) */
  due: number
}

export interface ReviewSetup {
  /** The knowledge map's concept the review is on */
  concept: string
  /** In the order to ask them; none: questions from memory on what was taught */
  items: ReviewItem[]
}

export interface QuickCheck {
  /** The knowledge map's concept the check is on */
  concept: string
  /** The parts of it a lesson's plan named, to spread the questions across */
  parts: string[]
  /** Questions already kept on it, not to be asked again */
  avoid: string[]
}

/** The most a review asks, and how many questions from memory when nothing is kept */
export const REVIEW_MAX = 6
export const FROM_MEMORY = 3

/**
 * The items for a review: what is due, longest overdue first; when nothing is, the ones coming
 * due soonest (FSRS schedules an early review from the time that has really passed). One question
 * asked once, whichever stores keep it.
 */
export function reviewItems(all: ReviewItem[], now: number, max = REVIEW_MAX): ReviewItem[] {
  const seen = new Set<string>()
  const unique = [...all]
    .sort((a, b) => a.due - b.due)
    .filter((i) => {
      const k = i.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 120)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
  const due = unique.filter((i) => i.due <= now)
  return (due.length ? due : unique.slice(0, Math.min(3, max))).slice(0, max)
}

/** How many questions a Quick check asks: one a part, three to five */
export const checkLength = (parts: number) => (parts ? Math.max(3, Math.min(5, parts)) : 4)

/** A mark as a review grade, for the store each item is kept in */
export const gradeOf = (verdict: 'correct' | 'partial' | 'wrong'): 'good' | 'hard' | 'again' => (verdict === 'correct' ? 'good' : verdict === 'partial' ? 'hard' : 'again')

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

export function reviewInstructions(topic: string, r: ReviewSetup): string {
  if (!r.items.length) {
    return `You are running a SPACED REVIEW of ${topic}, which the learner studied before and may be forgetting. Ask ${FROM_MEMORY} questions, one at a time, that make them retrieve the main ideas from memory (explain, predict, a small problem): no teaching before they answer, and no hints in the question.
After each answer, grade it, and if it isn't right give the right idea in two or three sentences. Ask the next question in the same reply. Number them "Question 2 of ${FROM_MEMORY}". After the last, write a short <summary> of what has held and what needs another look, and no ask tag.`
  }
  const lines = r.items.map((i, k) => `${k + 1}. ${clip(i.question, 400)}${i.answer ? `\n   The right answer: ${clip(i.answer, 300)}` : ''}`)
  return `You are running a SPACED REVIEW of ${topic}: questions the learner has met before, now due to come back. Ask exactly these, in this order, one at a time. Keep each one's meaning; you may reword a little so it reads as a question. Don't teach or hint before they answer.
${lines.join('\n')}
After each answer, grade it against the right answer, and if it isn't right give the right idea in two or three sentences. Ask the next one in the same reply. Number them "Question 2 of ${r.items.length}". After the last, write a short <summary> of what has held and what needs another look, and no ask tag.`
}

export function checkInstructions(topic: string, c: QuickCheck, n: number): string {
  const parts = c.parts.length ? `\n- Spread them across its parts: ${c.parts.map((p) => clip(p, 80)).join('; ')}.` : ''
  const avoid = c.avoid.length ? `\n- Fresh questions only: don't ask these again, or anything close to them:\n${c.avoid.slice(0, 8).map((q) => `  - ${clip(q, 160)}`).join('\n')}` : ''
  return `You are running a QUICK CHECK on ${topic}: a short diagnostic of exactly ${n} questions, to see what the learner knows right now. One question at a time.${parts}${avoid}
- Mix the kinds: explain, predict, error, a small problem. Medium difficulty; one step harder after a right answer, one easier after a wrong one.
- Don't teach. After each answer, grade it and say in one or two sentences what was right or what the right idea is, then ask the next question in the same reply.
- Number them "Question 2 of ${n}".
- After the last, write <summary>what is solid, what is shaky, and the one thing to review</summary> and no ask tag.`
}
