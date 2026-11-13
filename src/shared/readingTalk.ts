/**
 * Claude beside the page: "Challenge me", "What's the argument?" and the end-of-chapter seminar.
 * Prompts, and the checks on what comes back. Pure; main/readingRoom asks the model.
 *
 * The rules are the reading room's: the tutor never just summarises. It states the author's
 * argument, asks for yours, and pushes on the weakest step. It sees the text only up to where
 * you are (a story's later chapters are never sent). Without Claude, Gemma does the same jobs;
 * without any model, the seminar still runs on its fixed questions and keeps your own marks.
 */

import { locLabel, type PassageLoc } from './passage'

export type TalkKind = 'challenge' | 'argument' | 'seminar'

export interface TalkTurn {
  role: 'tutor' | 'learner'
  text: string
}

export interface Talk {
  id: string
  kind: TalkKind
  path: string
  loc?: PassageLoc
  chapter?: string
  passage?: string
  turns: TalkTurn[]
  at: number
  /** Kept on the book page */
  kept?: boolean
}

const PLAIN = 'Write plainly: no analogies, jokes, flattery or filler. Never summarise the passage back. One question at a time. Under 120 words unless asked for more.'

// ---------- Challenge me ----------

export const CHALLENGE_SYSTEM = (narrative: boolean) =>
  [
    'You are a demanding, fair seminar partner reading a book alongside a self-taught learner. Your job is to make them think, not to inform them.',
    'On the first turn: state the author’s argument for the selected passage as two to four short numbered steps ending in the conclusion, in your own words, each step on its own line, then ask which step they would attack, or what they think. Cite places as (ch. 2 ¶4) when you point at the text.',
    'On later turns: take what they said seriously. Find the weakest step, in their view or in the author’s, and push on it with one concrete case. Concede plainly when they have a point, then go one level deeper. If they agree too easily, give the strongest objection and ask them to answer it.',
    narrative ? 'This is a story: you know only the text given to you, up to where they are. Never mention or hint at anything later.' : 'Use only the text given and general knowledge of the work’s ideas. Do not invent quotations.',
    PLAIN
  ].join('\n\n')

export function challengePrompt(o: { title: string; author?: string; chapter?: string; loc?: PassageLoc; passage: string; before: string; turns: TalkTurn[]; said?: string }): string {
  const parts = [`Book: ${o.title}${o.author ? ` by ${o.author}` : ''}`]
  if (o.chapter) parts.push(`Chapter: ${o.chapter}`)
  if (o.before.trim()) parts.push(`What comes just before (for context):\n"""\n${o.before.trim()}\n"""`)
  parts.push(`The passage${o.loc ? ` (${locLabel(o.loc)})` : ''}:\n"""\n${o.passage.trim()}\n"""`)
  if (o.turns.length) parts.push(`The conversation so far:\n${o.turns.map((t) => `${t.role === 'tutor' ? 'You' : 'Learner'}: ${t.text}`).join('\n')}`)
  parts.push(o.said?.trim() ? `The learner says: ${o.said.trim()}\n\nReply.` : 'Open: state the argument in steps, then ask.')
  return parts.join('\n\n')
}

/** When no model can answer: the opening still asks the right question */
export const challengeFallback = (loc?: PassageLoc) =>
  `I can’t reach a model right now, so here is the question to work on alone: what is the author claiming in this passage${loc ? ` (${locLabel(loc)})` : ''}, what must be true for it to follow, and which of those things would you deny?`

// ---------- What's the argument? ----------

export const ARGUMENT_SYSTEM = [
  'You map the core argument of a book as numbered steps: premises and the conclusions drawn from them, in the order the book builds them. Not a summary of events or topics: the reasoning.',
  'You are given the map so far. The learner may have corrected it: their wording stands, never repeat or contradict a step already there.',
  'From the selected passage (and the text up to it), give only the steps to add: none if the passage adds nothing new, at most three. Each step is one plain sentence a reader could disagree with.',
  'Answer exactly in this form:\n<steps>\n1. …\n2. …\n</steps>\n<note>One sentence on how the passage fits the map, citing it as (ch. 2 ¶4).</note>',
  'Do not reveal anything beyond the text you were given.'
].join('\n\n')

export function argumentPrompt(o: { title: string; author?: string; map: string[]; passage?: string; loc?: PassageLoc; read: string }): string {
  return [
    `Book: ${o.title}${o.author ? ` by ${o.author}` : ''}`,
    `The map so far:\n${o.map.length ? o.map.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(empty)'}`,
    `The text read so far (excerpts, up to where the learner is):\n"""\n${o.read.trim()}\n"""`,
    o.passage?.trim() ? `The selected passage${o.loc ? ` (${locLabel(o.loc)})` : ''}:\n"""\n${o.passage.trim()}\n"""` : 'No passage selected: map the argument of what has been read.',
    'Give the steps to add.'
  ].join('\n\n')
}

/** The steps out of the model's answer (numbering dropped), and its note */
export function parseArgument(reply: string, existing: string[] = []): { steps: string[]; note: string } {
  const clean = reply.replace(/<think>[\s\S]*?<\/think>/g, '')
  const body = /<steps>([\s\S]*?)(?:<\/steps>|$)/i.exec(clean)?.[1] ?? clean
  const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const seen = new Set(existing.map(squash))
  const steps: string[] = []
  for (const line of body.split('\n')) {
    const m = /^\s*(?:\d+[.)]|[-*])\s+(.+)$/.exec(line)
    const s = m?.[1]
      ?.replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!s || s.length < 8 || seen.has(squash(s))) continue
    seen.add(squash(s))
    steps.push(s)
  }
  const note = /<note>([\s\S]*?)(?:<\/note>|$)/i.exec(clean)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
  return { steps: steps.slice(0, 3), note }
}

// ---------- The seminar ----------

export type SeminarStage = 'argued' | 'steelman' | 'take' | 'keep'
export const STAGES: { id: SeminarStage; label: string; minutes: number }[] = [
  { id: 'argued', label: 'What it argued', minutes: 3 },
  { id: 'steelman', label: 'Steelman', minutes: 2 },
  { id: 'take', label: 'Your take', minutes: 3 },
  { id: 'keep', label: 'Keep', minutes: 2 }
]

export const nextStage = (s: SeminarStage): SeminarStage | null => STAGES[STAGES.findIndex((x) => x.id === s) + 1]?.id ?? null

/** Each stage opens with a fixed question: no wait for a model, and the same without one */
export function stageOpening(stage: SeminarStage, chapter: string): string {
  if (stage === 'argued') return `What did ${chapter} argue? Say it in two or three sentences of your own, as steps if you can.`
  if (stage === 'steelman') return 'Now make the strongest case for it: the version a careful defender would give, even if you disagree with it.'
  if (stage === 'take') return 'Your take: where do you stand, and which step would you push on?'
  return 'Here is what seems worth keeping. Untick anything you don’t want; the rest goes to your recall and your book page.'
}

const STAGE_RULE: Record<Exclude<SeminarStage, 'keep'>, string> = {
  argued: 'Stage: what the chapter argued. Compare their statement with the chapter. Say what they got, and sharpen or correct one step with a cited line. Then ask them to restate the step they missed. Never give a full summary.',
  steelman: 'Stage: steelman. Judge whether their case is the strongest one. Add the single best support they left out, from the text, and ask whether it changes their view.',
  take: 'Stage: their own view. Find the weakest step in their position or the author’s and push on it with one concrete case. If they simply agree, give the strongest objection and ask them to answer it.'
}

export const SEMINAR_SYSTEM = (stage: Exclude<SeminarStage, 'keep'>, narrative: boolean) =>
  [
    'You lead a ten-minute seminar on one chapter of a book with a single learner, after they have read it.',
    STAGE_RULE[stage],
    narrative ? 'This is a story: you know only the text up to the end of this chapter. Never mention or hint at anything later.' : 'Use only the text given; do not invent quotations.',
    'Cite places as (ch. 2 ¶4).',
    PLAIN
  ].join('\n\n')

export function seminarPrompt(o: { title: string; chapter: string; text: string; turns: TalkTurn[]; said: string }): string {
  return [`Book: ${o.title}`, `Chapter: ${o.chapter}`, `The chapter:\n"""\n${o.text.trim()}\n"""`, `The seminar so far:\n${o.turns.map((t) => `${t.role === 'tutor' ? 'You' : 'Learner'}: ${t.text}`).join('\n')}`, `The learner says: ${o.said.trim()}\n\nReply.`].join('\n\n')
}

export const KEEP_SYSTEM = [
  'From a chapter and a seminar about it, choose what the learner should keep.',
  'Key lines: two to four sentences quoted exactly, word for word, from the chapter, that carry its argument. Ideas: two or three claims the learner worked out or should remember, each with one recall question that tests understanding rather than memory of wording.',
  'Answer exactly in this form, nothing else:\n<line>exact words from the chapter</line>\n<idea q="the recall question">the idea in one sentence</idea>'
].join('\n\n')

export const keepPrompt = (o: { title: string; chapter: string; text: string; turns: TalkTurn[] }) =>
  [`Book: ${o.title}`, `Chapter: ${o.chapter}`, `The chapter:\n"""\n${o.text.trim()}\n"""`, `The seminar:\n${o.turns.map((t) => `${t.role === 'tutor' ? 'Tutor' : 'Learner'}: ${t.text}`).join('\n')}`].join('\n\n')

export interface KeepItem {
  kind: 'line' | 'idea'
  text: string
  /** For an idea: the recall question */
  question?: string
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}']+/gu, ' ').trim()

/**
 * Key lines and ideas from the model's answer. A line counts only if the chapter really says it
 * (word for word, give or take punctuation): an invented quotation is dropped.
 */
export function parseKeep(reply: string, chapterText: string): KeepItem[] {
  const text = squash(chapterText)
  const out: KeepItem[] = []
  for (const m of reply.matchAll(/<line>([\s\S]*?)<\/line>/gi)) {
    const t = m[1].replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '')
    if (t.split(' ').length >= 4 && text.includes(squash(t))) out.push({ kind: 'line', text: t })
  }
  for (const m of reply.matchAll(/<idea(?:\s+q="([^"]*)")?>([\s\S]*?)<\/idea>/gi)) {
    const t = m[2].replace(/\s+/g, ' ').trim()
    if (t.length >= 8) out.push({ kind: 'idea', text: t, ...(m[1]?.trim() ? { question: m[1].trim() } : {}) })
  }
  return out.slice(0, 8)
}

/** Without a model: the chapter's quotes and highlights you made, and your own answers as ideas */
export function keepFallback(marks: { kind: string; text: string }[], turns: TalkTurn[], chapter: string): KeepItem[] {
  const lines = marks.filter((m) => m.kind === 'quote' || m.kind === 'highlight').slice(0, 4).map((m) => ({ kind: 'line' as const, text: m.text.replace(/\s+/g, ' ').trim() }))
  const yours = turns.filter((t) => t.role === 'learner' && t.text.trim().length > 20).slice(-2)
  const ideas = yours.map((t) => ({ kind: 'idea' as const, text: t.text.replace(/\s+/g, ' ').trim().slice(0, 240), question: `What did you conclude about ${chapter}, and why?` }))
  return [...lines, ...ideas]
}

/** The recall question for a kept idea */
export const recallPrompt = (book: string, chapter: string, k: KeepItem) => k.question?.trim() || `${book}, ${chapter}: explain in your own words why “${k.text.replace(/[.]$/, '')}”.`
