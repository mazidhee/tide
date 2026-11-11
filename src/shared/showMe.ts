import { solutionOf } from './lessonCheck'
import { hideWorking, parseBlocks } from './session'

/**
 * Show me while a question is waiting. The button is hidden then (showMeOffered); this is the check
 * behind it, for a "show me" that reaches the tutor anyway (typed): the picture may show the setup,
 * never the result. Seen live,
 * a Show me pressed on an open vector clock problem drew every clock, the answer included. The
 * reply is held until it's checked against the waiting question's hidden <solution>: a picture with
 * the solution's final line or its answer values in it is drawn again as the setup only, or held back.
 */

const text = (c: unknown) => (typeof c === 'string' ? c : '')

/** The question waiting for an answer when Show me was pressed: its words and hidden solution, or null */
export function waitingQuestion(messages: { role: string; content: unknown }[]): { question: string; solution: string } | null {
  for (const m of [...messages].reverse()) {
    // Answered since: nothing is waiting
    if (m.role === 'user' && /^Answer:/i.test(text(m.content).trim())) return null
    if (m.role !== 'assistant') continue
    const reply = text(m.content)
    const ask = parseBlocks(reply).filter((b) => b.kind === 'ask').pop()
    const solution = solutionOf(reply)
    // A reply that asks nothing (an earlier picture) is passed over; one that asks without a solution has nothing to hold back
    if (!ask) continue
    return solution ? { question: hideWorking(reply), solution } : null
  }
  return null
}

const norm = (t: string) => t.toLowerCase().replace(/\$|\\[a-z]+|[`*_]/g, '').replace(/\s+/g, ' ').trim()
const compact = (t: string) => t.replace(/\s+/g, '')

/** The solution's final line: where a worked answer ends */
export function finalLine(solution: string): string {
  const lines = solution.split('\n').map((l) => l.trim()).filter((l) => l && !/^```/.test(l))
  const last = lines[lines.length - 1] ?? ''
  // A last line that is one long sentence: its last clause
  return last.split(/(?<=[.;])\s+/).filter(Boolean).pop() ?? last
}

/** The values a solution's final line gives that the question didn't: vectors, and numbers that aren't single digits */
export function answerValues(solution: string, question: string): string[] {
  const end = finalLine(solution)
  const given = compact(question)
  const vectors = [...end.matchAll(/\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)+\s*\]/g)].map((m) => compact(m[0]))
  const numbers = [...end.replace(/\[[^\]]*\]/g, ' ').matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?:\/\d+)?(?![\w.])/g)].map((m) => m[0]).filter((n) => n.replace(/^-/, '').length >= 2)
  return [...new Set([...vectors, ...numbers])].filter((v) => !given.includes(v))
}

/** What in a Show me reply gives the waiting answer away, or null when it shows only the setup */
export function givesAway(reply: string, waiting: { question: string; solution: string }): string | null {
  const shown = hideWorking(reply)
  const end = norm(finalLine(waiting.solution))
  if (end.length >= 12 && norm(shown).includes(end)) return 'the last line of the answer'
  const flat = compact(shown)
  const hit = answerValues(waiting.solution, waiting.question).find((v) => (v.startsWith('[') ? flat.includes(v) : new RegExp(`(?<![\\w.])${v.replace(/[.[\]/-]/g, '\\$&')}(?![\\w.])`).test(shown)))
  return hit ? `the answer's ${hit}` : null
}

/** Said to the tutor when its picture gave the answer away: draw it again, the setup only */
export const setupOnlyNote = (what: string) =>
  `(Tide: your picture showed ${what}, and the student hasn't answered that question yet. Draw it again showing only the setup: what the question gives and how it is laid out, with the results left blank or as "?". Same kind of visual, one line on what to look at, nothing else.)`

/** Shown instead of a picture that gave the answer away twice */
export const WITHHELD = '_Tide held this picture back: it showed the answer to the question you are working on. Answer it first, then press Show me again to see it worked through._'

/**
 * Whether Show me is offered under the latest reply: not while a question in it waits for an
 * answer (the owner's decision, 2026-11-11), and again once it has been answered, skipped or
 * swapped for being taught. The check on the reply above stays for a "show me" typed meanwhile.
 */
export function showMeOffered(turns: { role: string; content: string }[]): boolean {
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'assistant') return false
  return !parseBlocks(last.content).some((b) => b.kind === 'ask' && b.prompt.trim())
}

/** A message asking to see it drawn ("show me", "draw it", "as a diagram"), typed rather than the button; never an answer */
export const asksToSee = (said: string) => !/^Answer:/i.test(said.trim()) && /\bshow me\b|\bdraw (it|this|that|me)\b|\bas an? (picture|diagram|table|plot|chart)\b|\bvisuali[sz]e\b/i.test(said.split(/\n\s*\(Tide:/)[0])
