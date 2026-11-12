/**
 * Lesson threads: a side conversation hanging off one of the tutor's explanations. You ask about
 * something it said (the whole output, or a phrase you selected), ask as many follow-ups as you
 * need, and fold it when you've got it. The lesson itself stays clean: nothing said in a thread is
 * added to the lesson's turns, so its question, marking, pace and progress are untouched. The
 * thread is kept beside the turns in the lesson's record, and the lesson's tutor only hears a line
 * about each one you understood ("the learner asked about X and understood").
 *
 * Pure: the request a thread sends, what its replies show, the note for the lesson's tutor, the
 * takeaway for your notes, and whether something typed in the answer box reads as a question.
 */
import { ASKED, GO_ON, hideWorking, ownWords, parseBlocks, type Block } from './session'
import { isAnswer, saysDontKnow } from './lessonRepair'

export interface ThreadMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LessonThread {
  id: string
  /** The index of the tutor's turn it hangs off, in the lesson's turns */
  at: number
  /** The first words of that turn, to check it still hangs off the same output when restored */
  anchor: string
  /** The phrase selected in the output, when the thread was started from a selection */
  quote?: string
  /** The lesson's question that was waiting when the thread opened: the thread must not answer it */
  waiting?: string
  messages: ThreadMessage[]
  /** Folded with "Got it" */
  understood?: boolean
  /** The lesson's tutor has been told about it (once, in a hidden note) */
  told?: boolean
  /** Its takeaway was added to the lesson's notes */
  noted?: boolean
  started: number
  updated: number
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** What a tutor's output says, as plain reading text: its working, marks and tags left out */
export function outputText(content: string): string {
  return parseBlocks(hideWorking(content))
    .map((b: Block) => (b.kind === 'text' || b.kind === 'note' || b.kind === 'summary' ? b.text : b.kind === 'ask' ? `Question: ${b.prompt}` : b.kind === 'grade' ? b.text : b.kind === 'challenge' ? b.text : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

/** The fingerprint a thread keeps of its output */
export const anchorOf = (content: string) => oneLine(outputText(content)).slice(0, 80)

export function newThread(turns: { role: string; content: string }[], at: number, quote?: string, waiting?: string): LessonThread {
  const now = Date.now()
  return {
    id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at,
    anchor: anchorOf(turns[at]?.content ?? ''),
    ...(quote?.trim() ? { quote: clip(oneLine(quote), 300) } : {}),
    ...(waiting?.trim() ? { waiting: clip(oneLine(waiting), 400) } : {}),
    messages: [],
    started: now,
    updated: now
  }
}

/**
 * The rules a thread's replies follow, sent as its instructions. The same on Claude and on Gemma:
 * Claude (the teaching model) keeps them for the thread's whole process; Gemma reads them each turn.
 */
export const THREAD_RULES = `You are the tutor in a lesson. The learner has opened a side thread under one of your own explanations to ask about it. This thread is apart from the lesson: the lesson's question waits for them, and they go back to it when they understand.
- Answer exactly what they ask, about that explanation (and the phrase they selected, when there is one). Stay on it; don't move the lesson on, start a new topic, or teach the next step.
- Plain prose, short: usually under 150 words, more only if they ask for it. One idea at a time. A small worked example, a few lines of code or a table when it makes the point faster.
- No analogies or jokes unless they ask. No praise or filler.
- Never give away the answer to the lesson's waiting question, even if they ask: help them understand the idea so they can answer it themselves.
- Don't set questions, mark anything, or write lesson tags (<ask>, <grade>, <plan>, <continue/>, <note>, <summary>, <card>). A quick check question in plain words is fine when it helps.
- You may use your tools (run code, query the lesson's data, draw a visual) when showing is clearer than telling.`

/** One tutor turn of the lesson, briefly, for the thread's context */
function lessonLine(t: { role: string; content: string }): string {
  if (t.role === 'user') {
    const mine = ownWords(t.content)
    if (!mine || mine === GO_ON) return ''
    return `Learner: ${clip(oneLine(mine.replace(/^Answer:\s*/, 'Answer: ').replace(new RegExp(`^${ASKED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'Asked: ')), 400)}`
  }
  const said = outputText(t.content)
  return said ? `Tutor: ${clip(oneLine(said), 700)}` : ''
}

export interface ThreadLesson {
  topic: string
  /** The lesson's plan, when it has one */
  plan?: string[]
  turns: { role: 'user' | 'assistant'; content: string }[]
}

/**
 * What the thread's first message carries: the lesson (topic, plan, the turns leading up to the
 * output), the exact output, the selected phrase and the waiting question. Fixed by where the
 * thread hangs, so every follow-up sends it word for word (a model server's cache keeps matching).
 */
export function threadContext(lesson: ThreadLesson, thread: Pick<LessonThread, 'at' | 'quote' | 'waiting'>): string {
  const output = lesson.turns[thread.at]?.content ?? ''
  const before = lesson.turns
    .slice(Math.max(1, thread.at - 4), thread.at)
    .map(lessonLine)
    .filter(Boolean)
  return [
    `(Tide: a side thread in a lesson on "${lesson.topic}".`,
    lesson.plan?.length ? `The lesson's plan: ${lesson.plan.map((s, i) => `${i + 1}. ${s}`).join(' ')}` : '',
    before.length ? `The lesson just before it:\n${before.join('\n')}` : '',
    `The explanation of yours they are asking about, exactly as they see it:\n<<<\n${outputText(output)}\n>>>`,
    thread.quote ? `They selected this phrase in it: "${thread.quote}"` : '',
    thread.waiting ? `The lesson's question waiting for their answer (don't answer it for them): ${thread.waiting}` : '',
    `Answer their question below about it.)`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The messages a thread turn sends: its context on the first question, then the thread as it is */
export function threadMessages(lesson: ThreadLesson, thread: LessonThread): ThreadMessage[] {
  const said = thread.messages.filter((m) => m.role === 'assistant' ? m.content.trim() : true)
  // A reply cut off (or not written) is left out, with the question it answered sent again
  const out: ThreadMessage[] = []
  for (const m of said) {
    if (m.role === 'user' && out[out.length - 1]?.role === 'user') out.pop()
    out.push({ role: m.role, content: m.content })
  }
  const first = out.findIndex((m) => m.role === 'user')
  if (first < 0) return []
  out[first] = { role: 'user', content: `${threadContext(lesson, thread)}\n\n${out[first].content}` }
  return out
}

/** A thread reply as shown: plain text, any lesson tags the model wrote anyway turned back into words */
export function threadReplyText(content: string): string {
  return parseBlocks(hideWorking(content))
    .map((b) => (b.kind === 'text' || b.kind === 'note' || b.kind === 'summary' || b.kind === 'grade' || b.kind === 'challenge' ? b.text : b.kind === 'ask' ? b.prompt : ''))
    .filter(Boolean)
    .join('\n\n')
}

/** What a thread was about, in a few words: the selected phrase, else its first question */
export function threadAbout(t: Pick<LessonThread, 'quote' | 'messages'>): string {
  const q = t.messages.find((m) => m.role === 'user')?.content ?? ''
  return clip(oneLine(t.quote ? `"${t.quote}" (${q})` : q), 160)
}

/**
 * The line the lesson's tutor gets about threads understood since it last heard: what the learner
 * asked about and that they understood it, never the thread itself. Null when there is nothing new.
 */
export function threadsNote(threads: LessonThread[]): string | null {
  const fresh = threads.filter((t) => t.understood && !t.told && t.messages.some((m) => m.role === 'user'))
  if (!fresh.length) return null
  const each = fresh.map((t) => `asked about ${threadAbout(t)} and understood`)
  return `(Tide: in a side thread under your explanation, the learner ${each.join('; then ')}. Build on it; don't repeat it.)`
}

/** The takeaway "Add to notes" keeps: what was asked, and the tutor's last answer */
export function threadTakeaway(t: LessonThread): string {
  const q = t.messages.find((m) => m.role === 'user')?.content.trim() ?? ''
  const a = [...t.messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content ?? ''
  const body = threadReplyText(a).trim()
  if (!q || !body) return ''
  return [`**${oneLine(q)}**`, '', body].join('\n').split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n')
}

/** Questions you asked in a thread */
export const asked = (t: Pick<LessonThread, 'messages'>) => t.messages.filter((m) => m.role === 'user').length

/**
 * Threads to show again: each must still hang off the same output (the lesson can be started again
 * under the same record), and a reply cut off when Tide closed is dropped.
 */
export function restoreThreads(raw: unknown, turns: { role: string; content: string }[]): LessonThread[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is LessonThread => !!t && typeof t === 'object' && typeof (t as LessonThread).id === 'string' && Array.isArray((t as LessonThread).messages) && typeof (t as LessonThread).at === 'number')
    .filter((t) => turns[t.at]?.role === 'assistant' && (!t.anchor || anchorOf(turns[t.at].content) === t.anchor))
    .map((t) => ({ ...t, messages: t.messages.filter((m, i) => m.role === 'user' || m.content.trim() || i < t.messages.length - 1) }))
    .filter((t) => t.messages.length > 0)
}

/** Starts that make it a question about the explanation, with or without a question mark */
const ASKING = /^(why|wait|hold on|so why|but why|i don'?t (get|understand|follow|see)|i'?m (confused|lost|not sure (why|how|what))|(can|could) you (explain|show|go over|say)|please explain|explain (why|how|what)|what do you mean|in nature)\b/i
/** A guess put as a question ("is it 101?") is still an answer */
const TENTATIVE = /^(is it|isn'?t it|would it be|could it be|so it'?s|it'?s|it is|maybe|perhaps|probably|i think|i guess|i believe|my answer|the answer)\b/i

/**
 * Whether what's typed in the answer box reads like a question about the explanation rather than
 * an answer to the lesson's question: then Tide offers to ask it in a thread. An "I don't know" or
 * a tentative guess is never one; a code answer never is either.
 */
export function readsAsQuestion(typed: string): boolean {
  const s = typed.trim()
  if (!s || s.length > 400 || /```/.test(s)) return false
  if (!isAnswer(`Answer: ${s}`) || saysDontKnow(s)) return false
  if (TENTATIVE.test(s)) return false
  if (ASKING.test(s)) return true
  // "101?" or "x = 4?": a short answer with a question mark is a guess
  return /\?\s*$/.test(s) && s.split(/\s+/).length > 3
}
