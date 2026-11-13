/**
 * Explore later: something the tutor mentioned in passing that you want to come back to, just for
 * curiosity ("The Babylonians used base 60..."). Kept from a selection or a tutor's message, with a
 * link back to the exact lesson and message it came up in. Later it becomes a short standalone
 * side lesson (10 to 15 minutes, no probe or plan), and once that is done the item is marked
 * explored and points at it. Stored in the vault, at .tide/explore.json (main/explore).
 *
 * Pure: the item, its title (the model's, or the first words), the line saying where it came
 * from, and the side lesson's rules and opening.
 */
import type { ChatScope, SessionMode } from './types'

/** Where it came up: the lesson's record, its topic, and the tutor's message (and thread reply) */
export interface ExploreFrom {
  /** The lesson's record id (shared/lessonLog), to open it again; none for a session that isn't kept */
  lesson?: string
  topic: string
  mode?: SessionMode
  /** The tutor's turn, by its index in the lesson's turns */
  turn?: number
  /** It came up in a side thread under that turn: the thread, and the reply's index in it */
  thread?: string
  reply?: number
}

export interface ExploreItem {
  id: string
  /** What you selected, or the tutor's message */
  text: string
  /** A few words, made by the model in the background; the first words until then */
  title: string
  /** The title is the model's */
  titled?: boolean
  /** The subject the lesson was in, when known */
  subject?: string
  from: ExploreFrom
  /** When it was kept */
  at: number
  /** The side lesson it was explored in, once that finished */
  explored?: { at: number; lesson?: string; topic: string }
}

/** What a capture sends: everything but what main fills in */
export type ExploreInput = Pick<ExploreItem, 'text' | 'subject' | 'from'>

/** The side lesson a curiosity item starts (SessionSetup options.curiosity) */
export interface CuriositySetup {
  id: string
  text: string
  from: ExploreFrom
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** The text kept: Markdown and the tutor's tags taken off, one paragraph, not too long */
export function cleanExploreText(s: string): string {
  return clip(
    oneLine(
      s
        .replace(/<[^>]+>/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[*_`#>]+/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    ),
    1200
  )
}

/** A title until the model's arrives: the first words, up to a sentence's end */
export function fallbackTitle(text: string): string {
  const t = oneLine(cleanExploreText(text))
  const sentence = t.split(/(?<=[.!?])\s/)[0] ?? t
  const words = sentence.replace(/[.!?:;,]+$/, '').split(' ')
  const short = words.slice(0, 7).join(' ')
  const title = words.length > 7 ? `${short}…` : short
  return title ? title[0].toUpperCase() + title.slice(1) : 'Something to explore'
}

export const TITLE_SYSTEM = 'You name things a learner wants to explore later. Reply with a short title only: 2 to 6 words, sentence case, no quotes and no full stop.'

export const titlePrompt = (text: string, topic: string) =>
  `In a lesson on "${topic}", this came up and the learner wants to explore it later, for curiosity:\n"""\n${clip(text, 1000)}\n"""\n\nName what there is to explore in it, as a short title (for example "Why the Babylonians counted in 60s"). Reply with the title only.`

/** The model's reply as a title, or null when it isn't one */
export function cleanTitle(reply: string): string | null {
  const line = reply
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  if (!line) return null
  const t = line.replace(/^(title:\s*)/i, '').replace(/^["'“‘#*\s]+|["'”’.*\s]+$/g, '').trim()
  if (!t || t.length > 80 || t.split(/\s+/).length > 12) return null
  return t[0].toUpperCase() + t.slice(1)
}

export function newExploreItem(input: ExploreInput, now = Date.now()): ExploreItem {
  const text = cleanExploreText(input.text)
  return {
    id: `x${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text,
    title: fallbackTitle(text),
    ...(input.subject ? { subject: input.subject } : {}),
    from: { ...input.from, topic: oneLine(input.from.topic) },
    at: now
  }
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }

/** "12 Nov", with the year when it isn't this one */
export function shortDate(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  return d.toLocaleDateString('en-GB', d.getFullYear() === new Date(now).getFullYear() ? SHORT_DATE : { ...SHORT_DATE, year: 'numeric' })
}

/** "from Binary, hexadecimal… · 12 Nov" */
export function fromLine(item: Pick<ExploreItem, 'from' | 'at'>, now = Date.now()): string {
  return `from ${clip(item.from.topic.replace(/^What I already know: /, ''), 34)} · ${shortDate(item.at, now)}`
}

/** Not yet explored first, newest first; the explored ones after, most recent first */
export function sortExplore(items: ExploreItem[]): ExploreItem[] {
  return [...items].sort((a, b) => (a.explored ? 1 : 0) - (b.explored ? 1 : 0) || (b.explored?.at ?? b.at) - (a.explored?.at ?? a.at))
}

/** The side lesson's rules: short, for curiosity, no probe and no plan */
export function curiosityRules(topic: string, c: CuriositySetup): string {
  return `You are running a short SIDE LESSON, just for curiosity, on: ${topic}.
It came up in their lesson on "${c.from.topic}", where this was said:
"""
${clip(c.text, 800)}
"""
It takes 10 to 15 minutes. No probe and no plan: start straight in.
1. Open by picking up exactly what was said, then tell the story behind it: what it is, where it comes from, why it is so, and what it connects to. Concrete and accurate: names, dates and numbers only when you are sure of them.
2. Teach it in 3 to 5 short messages, each under 150 words, one idea at a time. End each with one light question that makes them think (<ask type="short">…</ask>), or <continue/>. No problem sets: grade an answer in a line, kindly, and move on.
3. Once, briefly, tie it back to what they were learning in "${c.from.topic}".
When you explain something worth keeping, also write it for their notes: <note>the point in 1 to 3 lines</note>.
After about four exchanges, or as soon as they say they're done, write <summary>what they found out, in 2 or 3 lines, and one thing to look up next if they want more</summary>.`
}

/** The message that opens the side lesson */
export const curiosityOpening = (topic: string, c: CuriositySetup) => `This came up in my lesson on ${c.from.topic} and I'm curious: "${clip(oneLine(c.text), 400)}". Tell me more about ${topic}.`
