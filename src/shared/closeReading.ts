/**
 * "Discuss this": a back-and-forth about one passage (a paragraph, a page, a chapter, a highlight)
 * beside the text, in any reader: a PDF, an EPUB, a saved article or a note. Socratic: it asks
 * what the learner thinks the passage says before saying anything itself, then presses on their
 * reading one question at a time. Readings are appraised, never marked right or wrong; plain facts
 * still are. Prompts are built here and every reply is checked here, in code.
 */

import { CLOSE_READING_RULES, settles, THEOLOGY_RULES } from './humanities'
import { locLabel, quotesWithLocation, type PassageLoc } from './passage'
import { findSpoilers, repairSpoilers, spoils, type TermIndex } from './readTogether'

export interface DiscussTurn {
  role: 'tutor' | 'learner'
  text: string
  /** Added to their notes */
  kept?: boolean
}

export interface Discussion {
  id: string
  path: string
  loc: PassageLoc
  /** The passage, quoted at the top */
  passage: string
  turns: DiscussTurn[]
  conclusion?: string
  at: number
}

/** The first question needs no model: what do they think it says, and means */
export const openingQuestion = (loc: PassageLoc) => `<ask type="explain">Before I say anything: what do you think this passage (${locLabel(loc)}) says, and what do you take it to mean?</ask>`

export const DISCUSS_SYSTEM = (opts: { narrative: boolean; theology: boolean }) =>
  [
    'You are Tide, a tutor reading a text closely with the learner. Plain, direct British English; no greetings, no praise for its own sake, no analogies or jokes.',
    CLOSE_READING_RULES,
    opts.narrative ? 'This is a story they are reading for the first time: say nothing about anything after this passage (what happens later, who appears later, how it ends), even as a hint.' : '',
    opts.theology ? THEOLOGY_RULES : ''
  ]
    .filter(Boolean)
    .join('\n\n')

export function discussPrompt(o: { work: string; author?: string; loc: PassageLoc; passage: string; before: string; after: string; turns: DiscussTurn[]; said: string }): string {
  const talk = o.turns.map((t) => `${t.role === 'tutor' ? 'You' : 'Learner'}: ${t.text}`).join('\n\n')
  return `Work: ${o.work}${o.author ? `, by ${o.author}` : ''}
The passage (${locLabel(o.loc)}):
"""
${o.passage}
"""
${o.before ? `Just before it:\n"""\n${o.before}\n"""\n` : ''}${o.after ? `Just after it:\n"""\n${o.after}\n"""\n` : ''}
The discussion so far:
${talk}

Learner: ${o.said}

Respond to their reading. If they made a claim, ask why they think it or what in the text supports it, or offer a strong alternative reading and ask them to answer it. If they answered a plain question of fact, say whether it is right. When you make a point, quote the text with its location, like "…" (${locLabel(o.loc)}). One question, in <ask type="explain">, at the end.`
}

export interface DiscussCheck {
  /** What to show (spoilers taken out) */
  text: string
  /** What the reply must fix, said to the tutor when it is written again */
  problems: string[]
  withheld: boolean
}

/**
 * A reply checked before it is shown: it ends on one question; it quotes the text with a location
 * when it makes a point about it; it doesn't present a reading as settled; it doesn't mark a
 * reading right or wrong; and, for a story, it says nothing from beyond where the learner is.
 */
export function checkDiscussReply(reply: string, o: { loc: PassageLoc; index?: TermIndex; position?: PassageLoc; learnerClaimed: boolean }): DiscussCheck {
  const problems: string[] = []
  const asks = (reply.match(/<ask\b/gi) ?? []).length
  if (asks !== 1) problems.push('End with exactly one question, in <ask type="explain">.')
  if (settles(reply.replace(/<ask\b[\s\S]*?<\/ask>/gi, ''))) problems.push('Do not present a reading as settled: say it is contested where it is, and ask them to weigh it.')
  if (/<grade\b[^>]*verdict\s*=\s*["']?(correct|wrong|partial)/i.test(reply) && o.learnerClaimed) problems.push('Their reading is an interpretation: appraise it with <appraise> or answer it with a question, never a verdict.')
  const words = reply.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  if (words > 170) problems.push('Keep it under 120 words.')
  if (o.learnerClaimed && !quotesWithLocation(reply).length) problems.push(`Quote the text with its location when you answer their reading, like "…" (${locLabel(o.loc)}).`)
  let text = reply
  let withheld = false
  if (o.index && o.position) {
    const f = findSpoilers(reply, o.index, o.position)
    if (spoils(f)) {
      const r = repairSpoilers(reply, f)
      text = r.text
      withheld = r.withheld
      problems.push(`Say nothing from beyond where they have read (${[...f.terms, ...f.future].slice(0, 5).join(', ')}).`)
    }
  }
  return { text, problems, withheld }
}

/** Said (hidden) to the tutor when its reply has to be written again */
export const discussFix = (problems: string[]) => `(Tide checked your reply before the learner saw it. ${problems.join(' ')} Write the whole reply again.)`

/** When nothing usable came back: a question that is always fair */
export const discussFallback = (loc: PassageLoc) => `<ask type="explain">Which words in the passage (${locLabel(loc)}) carry your reading most, and why those?</ask>`

/** A learner's message that makes a claim about the passage (not "I don't know" or a question back) */
export const makesClaim = (said: string) => said.trim().split(/\s+/).length >= 6 && !/^(i don['’]?t know|not sure|no idea)\b/i.test(said.trim()) && !/\?\s*$/.test(said.trim())
