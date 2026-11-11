/**
 * A scenario turned into the request the app would send for it, from the app's own prompt code:
 * the system prompt (shared/tutorPrompt), the session's tag rules and instructions
 * (shared/session), the learner's messages in the forms the lesson screen sends, and the hidden
 * pace and notes nudges it adds. No prompt text is written here.
 *
 * What is left out, on purpose: tools (the benchmark talks to the model server directly, so
 * nothing can be run or looked up), the learner's profile and memory, sources and passages, the
 * problem bank and the checks that run after a reply. It measures the prompts and the model.
 */
import { markNote, paceNote } from '../../../src/shared/pace'
import { ASKED, GO_ON, SHOW_ME, notesNudge, openingMessage, sessionInstructions, type SessionSetup } from '../../../src/shared/session'
import { TUTOR_SYSTEM, stableSystem, withInstructions } from '../../../src/shared/tutorPrompt'
import type { Learner, Scenario, Turn } from './types'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** The date in the system prompt, fixed so the same scenario is the same request on any day */
export const BENCH_DATE = new Date(2026, 10, 11)

/** The learner's message as the lesson screen words it (SessionView.submit) */
export function learnerText(l: Learner): string {
  if ('answer' in l) return `Answer: ${l.answer}${l.confidence ? `\n(Confidence: ${l.confidence})` : ''}`
  if ('question' in l) return `${ASKED}${l.question}`
  if ('showMe' in l) return SHOW_ME
  if ('goOn' in l) return GO_ON
  return "I don't know."
}

/** A message with the hidden notes the lesson screen adds to it (SessionView.send), kept with it from then on */
function stored(content: string, history: Message[], mode: SessionSetup['mode']): string {
  if (content.includes('(Tide: ') || history.length < 2) return content
  const notes = [
    mode === 'teach' || mode === 'quiz' ? paceNote(history as { role: 'user' | 'assistant'; content: string }[], content) : null,
    mode === 'teach' || mode === 'quiz' ? markNote(content) : null,
    mode === 'teach' && history.length > 2 ? notesNudge(history.filter((t) => t.role === 'assistant').map((t) => t.content), content) : null
  ].filter((n): n is string => !!n)
  return notes.length ? `${content}\n\n${notes.join('\n')}` : content
}

/** The lesson's turns as the app keeps them: the opening, then the conversation so far */
export function lessonTurns(setup: SessionSetup, history: Turn[]): Message[] {
  const turns: Message[] = [{ role: 'user', content: openingMessage(setup) }]
  for (const t of history) {
    if ('tutor' in t) turns.push({ role: 'assistant', content: t.tutor })
    else turns.push({ role: 'user', content: stored(learnerText(t.learner), turns, setup.mode) })
  }
  return turns
}

/** The system prompt of a lesson with nothing known about the learner */
export const systemPrompt = () => stableSystem(TUTOR_SYSTEM, { today: BENCH_DATE, web: false, session: true })

/** The whole request: system prompt, then the turns with the lesson's instructions at the head of the first */
export function buildMessages(s: Pick<Scenario, 'setup' | 'history'>): Message[] {
  return [{ role: 'system', content: systemPrompt() }, ...withInstructions(lessonTurns(s.setup, s.history), sessionInstructions(s.setup))]
}

/** A short, stable fingerprint of everything sent, so a result records which prompts it measured */
export function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}-${text.length.toString(36)}`
}
