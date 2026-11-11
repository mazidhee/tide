/**
 * The lesson's pace, decided by code each turn rather than left to the model's habit of ending
 * every message with a question. Three rules, first match wins; when none applies the tutor
 * chooses (the format lets it explain over more than one message with <continue/>):
 *
 * 1. You asked: "just explain" means explain, no question; "quiz me" means check now.
 * 2. Two misses in a row: a short worked example of exactly the missing step, then you fill in
 *    that one step. Questions that keep failing teach nothing (worked-example research).
 * 3. Two explaining messages in a row: check understanding now, so explanation doesn't run on
 *    unchecked.
 *
 * The note rides at the end of your message, hidden, and is kept with it so later requests send
 * the same text (the model server's prefix cache). The problem bank stands aside on a turn with one.
 */

import { isAnswer } from './lessonRepair'

export const PACE_MARK = '(Tide: This turn:'

/**
 * Said with every answer in a lesson (hidden, like the pace note): the two marking rules the local
 * model drops when they sit only in the format rules, thousands of words back. In the tutor
 * benchmark's baseline it wrote a flashcard after 1 miss in 8 (a <note> instead, which the lesson's
 * instructions ask for in the same breath), and marked a correct subquery down for not being a
 * window function. A 12B model follows the last, most concrete thing it was told, so the rule
 * rides with the answer it applies to.
 */
export const MARK_NOTE = '(Tide: mark this first. A right result by a different method from yours is correct. If it is partial or wrong, add <card>question :: answer</card> for the idea they missed.)'

/** The marking note for what you're sending, when it is an answer to mark */
export const markNote = (said: string): string | null => (isAnswer(said) ? MARK_NOTE : null)

const EXPLAIN = /\b(just|please|can you|could you)\s+(explain|teach|walk me through|show me)\b|\b(keep|carry on|continue)\s+(explaining|going)\b|\bstop (asking|quizzing)\b|\bno (more )?questions\b/i
const CHECK = /\b(quiz|test|check) me\b|\bask me (a|some|more)\b|\bharder (one|question|problem)s?\b|\bgive me (a|another) (problem|question)\b/i

export interface PaceTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Whether a tutor reply ends by carrying on (<continue/>) rather than asking */
export const goesOn = (reply: string) => /<continue\b[^>]*\/?>/i.test(reply)

const verdictOf = (reply: string) => [...reply.matchAll(/<grade\b[^>]*verdict\s*=\s*["']?(correct|partial|wrong)/gi)].pop()?.[1]?.toLowerCase()

/** The hidden note for this turn, or null to let the tutor choose. `said` is what you're sending now */
export function paceNote(history: PaceTurn[], said: string): string | null {
  const words = said.replace(/^Answer:\s*/i, '').replace(/\n\(Confidence: [^)]*\)\s*$/, '')
  if (CHECK.test(words)) return `${PACE_MARK} they asked to be tested. Check their understanding now with one question.)`
  if (EXPLAIN.test(words)) return `${PACE_MARK} they asked you to explain. Explain the next part clearly, ask nothing, and end with <continue/>.)`

  const replies = history.filter((t) => t.role === 'assistant').map((t) => t.content)
  const answers = history.filter((t) => t.role === 'user').map((t) => t.content)
  const idk = (t: string) => /^(Answer:\s*)?(I don['’]t know|idk|no idea|not sure)\.?\s*(\n|$)/i.test(t)
  const isAnswer = (t: string) => /^Answer:/i.test(t) || idk(t)
  // Misses only count on answers (not "Go on" or a question), and only marks given to answers
  const marks = history.flatMap((t, i) => (t.role === 'assistant' && i > 0 && isAnswer(history[i - 1].content) ? [verdictOf(t.content)] : [])).filter(Boolean)
  const lastTwoWrong = isAnswer(said) && marks.length >= 2 && marks.slice(-2).every((v) => v === 'wrong')
  const twoIdk = idk(said) && answers.length > 0 && idk(answers[answers.length - 1])
  if (twoIdk) return `${PACE_MARK} they've said twice they don't know. Don't ask another full question: show a short worked example of exactly the step they're missing, then ask them to fill in just that one step.)`
  if (lastTwoWrong) return `${PACE_MARK} their last two answers were wrong. Mark this one; if it's wrong again, stop setting full questions: show a short worked example of exactly the step they're missing, then ask them to fill in just that one step.)`

  // Explaining for two messages already: time to check
  const run = replies.slice(-2)
  if (run.length === 2 && run.every(goesOn) && /^Go on\.?$/i.test(said.trim())) return `${PACE_MARK} you've explained for two messages. Check their understanding now with one question (a choice question works well here).)`
  return null
}
