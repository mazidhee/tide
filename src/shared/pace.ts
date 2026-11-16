/**
 * The lesson's pace, decided by code each turn rather than left to the model's habit of ending
 * every message with a question. Three rules, first match wins; when none applies the tutor
 * chooses (the format lets it explain over more than one message with <continue/>):
 *
 * 1. You asked: "just explain" means explain, no question; "quiz me" means check now.
 * 2. Two misses in a row: a short worked example of exactly the missing step, then you fill in
 *    that one step. Questions that keep failing teach nothing (worked-example research).
 * 3. Three explaining messages in a row: check understanding now, so explanation doesn't run on
 *    unchecked.
 *
 * The note rides at the end of your message, hidden, and is kept with it so later requests send
 * the same text (the model server's prefix cache). The problem bank stands aside on a turn with one.
 */

import { asksToBeTaughtAgain, asksToMoveOn, isAnswer as marksAnswer, saysLost } from './lessonRepair'
import { asksToThink } from './session'

export const PACE_MARK = '(Tide: This turn:'

/**
 * Said with every answer in a lesson (hidden, like the pace note): the two marking rules the local
 * model drops when they sit only in the format rules, thousands of words back. In the tutor
 * benchmark's baseline it wrote a flashcard after 1 miss in 8 (a <note> instead, which the lesson's
 * instructions ask for in the same breath), and marked a correct subquery down for not being a
 * window function. A 12B model follows the last, most concrete thing it was told, so the rule
 * rides with the answer it applies to.
 */
export const MARK_NOTE = '(Tide: mark this first. A right result is correct, by any method and even without the working asked for. If partial or wrong, add <card>question :: answer</card> for the idea missed.)'

/** The marking note for what you're sending, when it is an answer to mark */
export const markNote = (said: string, asked = ''): string | null => (marksAnswer(said) && !asksToThink(asked) ? MARK_NOTE : null)

/** Lost or confused (lessonRepair saysLost): explained again another way, never marked */
export const LOST_NOTE = `${PACE_MARK} they're lost or confused: a signal, not an answer. Don't mark it: no <grade>, no <card>. Answer any question they asked in it directly, then explain the point again differently, not in the same words: simpler and in smaller steps, with a new picture or a concrete walk-through of one example. Then check their understanding with a think question.)`

/** An answer to a think question: discussed, never marked */
export const THINK_NOTE = `${PACE_MARK} this answers a think question, which is never graded: write no <grade> and no card for a slip in it. Reply as their tutor in conversation: build on what's right, correct any misunderstanding directly with the reason, then the next chunk (150 to 250 words) or a checkpoint. If they've shown they follow a key idea, add its <card idea>question :: answer</card>.)`

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
  // Asked to move on: never kept on the point, and never marked for asking (an answer sent with it is marked)
  if (asksToMoveOn(said)) return `${PACE_MARK} they asked to move on. Don't mark the request or ask about this point again${marksAnswer(said) ? '; mark the answer they sent with it' : ''}. Go on to the next step now. Tide brings this point back later as a recall question.)`
  // Lost or confused, or "what do you mean": explained again another way, not marked
  if (saysLost(said)) return LOST_NOTE
  // Forgotten, or "teach me again": taught again from the start, not marked
  if (asksToBeTaughtAgain(said)) return `${PACE_MARK} they've forgotten this or asked to be taught it again. Don't mark it. Teach it again from the start, simply, with one small worked example, then ask one easy question on it.)`
  // An answer to a think question: a conversation, not a mark
  const asked = [...history].reverse().find((t) => t.role === 'assistant')?.content ?? ''
  if (asksToThink(asked) && /^Answer:/i.test(said)) return THINK_NOTE
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
  // (three: a tutorial step's explanation runs to 300 to 700 words, over more than one message)
  const run = replies.slice(-3)
  if (run.length === 3 && run.every(goesOn) && /^Go on\.?$/i.test(said.trim())) return `${PACE_MARK} you've explained for three messages. Check their understanding now with one question (a think question, or a choice question).)`
  return null
}
