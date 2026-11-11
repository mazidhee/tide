/**
 * The judgement-only qualities, for a stronger model to rate: what no pattern can check. Optional
 * (the runner asks only when given a judge), and always reported apart from the deterministic
 * scores, because a judge model has its own errors and its own drift between versions.
 *
 * The rubric is the one in README.md, word for word: change both together.
 */
import { hideWorking } from '../../../src/shared/session'
import { learnerText, lessonTurns } from './request'
import { HUMANITIES_SUBJECTS, SITUATION_LABEL, type Scenario } from './types'
import { locLabel } from '../../../src/shared/passage'

export const CRITERIA = ['clarity', 'misconception', 'socratic', 'accuracy'] as const
export type Criterion = (typeof CRITERIA)[number]

export const RUBRIC = `Rate the tutor's reply on each criterion from 1 to 5, or "n/a" where the criterion says so.

clarity: could this learner follow it on one reading?
  5 = one idea, in the order it is needed, every term defined or already used in the lesson, an example where the idea is abstract
  3 = correct and followable, but with a detour, an undefined term, or an example that doesn't quite fit
  1 = muddled, several ideas at once, or it explains something other than what was needed

misconception: does it deal with what this learner actually got wrong or said? ("n/a" when the learner's last message contains no error, confusion or question)
  5 = names the specific wrong idea in the learner's own terms, says why it fails (the exact step or a counter-example), and gives the right idea in its place
  3 = corrects the result but treats the error generically ("not quite, the answer is…") or only partly identifies it
  1 = ignores it, misdiagnoses it, or agrees with it

socratic: does its question make the learner think the next step for themselves? ("n/a" when the reply rightly asks nothing)
  5 = one question, answerable from what they now have, one step beyond it, whose answer would show whether they understood; nothing in the reply gives that answer away
  3 = a reasonable question, but recall of what was just said, too large a step, or half-answered by the text before it
  1 = "does that make sense?", a question unrelated to the gap, several questions, or it answers its own question

accuracy: is everything it states true? (work any calculation yourself)
  5 = nothing wrong
  3 = a loose or misleading statement that would not survive a careful reader
  1 = a wrong fact, result or verdict`

/** For the humanities, the same four criteria read for interpretation and argument */
export const HUMANITIES_RUBRIC = `In the humanities, read the criteria this way:
misconception: a reading is not "wrong" for being contestable. Score whether it engages the learner's actual claim, names its weakest point (no evidence, a step that doesn't follow, an objection ignored, a wrong fact or date), and corrects plain facts plainly.
socratic: does it ask about their reasoning or evidence, or set a strong alternative reading against theirs, one question at a time, without lecturing first or settling a contested question for them?
accuracy: quotations match the text and carry its location; facts and dates are right; traditions are described in their own terms, with any opinion of the tutor's labelled as such (and none on matters of faith unless asked); nothing from beyond the learner's place in a story.`

export const JUDGE_SYSTEM = 'You are an experienced teacher (of mathematics and computer science, or of philosophy, theology, history and literature), assessing a tutor\'s reply to one learner. You are strict and specific, you check facts and calculations yourself, and you reply in exactly the format asked, nothing else.'

export function judgePrompt(s: Scenario, reply: string): string {
  const turns = lessonTurns(s.setup, s.history)
  const transcript = turns.map((t) => `${t.role === 'user' ? 'LEARNER' : 'TUTOR'}: ${t.role === 'user' ? t.content.replace(/\n*\(Tide: [\s\S]*$/, '') : hideWorking(t.content)}`.trim()).join('\n\n')
  const last = s.history.length ? learnerText((s.history[s.history.length - 1] as { learner: Parameters<typeof learnerText>[0] }).learner).split('\n')[0] : turns[0].content
  return `${s.discuss ? `A close reading of ${s.discuss.work}, at ${locLabel(s.discuss.loc)}: "${s.discuss.passage.slice(0, 400)}"` : `A lesson on: ${s.setup.topic}`}${s.setup.options?.why ? ' (the learner asked to be taught the why, Socratically)' : ''}
Situation: ${SITUATION_LABEL[s.situation]}.${s.expect.verdict ? ` The learner's last answer is in truth ${s.expect.verdict}.` : ''}${s.judge ? `\nLook for: ${s.judge}` : ''}

The lesson so far:
"""
${transcript}
"""

The tutor's reply to "${last.slice(0, 160)}":
"""
${hideWorking(reply).trim()}
"""

${RUBRIC}${(HUMANITIES_SUBJECTS as readonly string[]).includes(s.subject) ? `

${HUMANITIES_RUBRIC}` : ''}

Reply with these lines only:
${CRITERIA.map((c) => `${c.toUpperCase()}: 1-5${c === 'misconception' || c === 'socratic' ? ' or n/a' : ''}`).join('\n')}
WHY: one sentence on the weakest point`
}

/** The judge's ratings; a criterion it marked n/a, or left out, is absent. Null when nothing could be read */
export function parseJudge(out: string): (Partial<Record<Criterion, number>> & { why?: string }) | null {
  const got: Partial<Record<Criterion, number>> & { why?: string } = {}
  for (const c of CRITERIA) {
    const m = new RegExp(`^\\s*\\**${c}\\**\\s*:\\s*\\**\\s*([1-5])(?:\\s*/\\s*5)?\\b`, 'im').exec(out)
    if (m) got[c] = Number(m[1])
  }
  const why = /^\s*\**WHY\**\s*:\s*(.+)$/im.exec(out)?.[1]?.trim()
  if (why) got.why = why
  return CRITERIA.some((c) => got[c] !== undefined) ? got : null
}
