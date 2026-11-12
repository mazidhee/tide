import { ASKED, GO_ON, closeGrade, ownWords, parseBlocks } from './session'
import { isMoveOn } from './lessonPlan'

/**
 * A lesson reply put right before it is kept, where the fault is one a rule can see and fix
 * without asking the model again. Each of these was seen in the tutor benchmark's first baseline
 * (scripts/eval/tutor), in replies that were otherwise good:
 *
 * - "grade": a mark on something that wasn't an answer. Asked a question of your own, or having
 *   said you don't know, you got `<grade verdict="wrong" score="0.0">` (6 of 70 replies): a miss on
 *   your record for something you never answered. The feedback is kept as plain text; the mark goes.
 * - "close": a grade opened and never closed, so the mark and its feedback were hidden (see
 *   closeGrade).
 * - "ask": a numbered question written in plain text and followed by <continue/>, which left only
 *   Go on to press. The <continue/> goes, and the question becomes the ask (parseBlocks).
 *
 * parseBlocks applies the last two by itself wherever a reply is read, so a reply still streaming
 * shows right; this is the same repair on the text, so what is stored, sent back to the model as
 * its own last turn, and scored is well formed too.
 */

/** "I don't know", said with the button or typed as the answer */
const IDK = /^(Answer:\s*)?(I don['’]t know|idk|no idea)\.?\s*$/i

/**
 * Not an answer: "I don't know", however it's typed ("i dont know i am learning from scratch",
 * "no idea, never learned this", "I haven't learned this yet"). Marking it would put a miss on the
 * record (and a flashcard) for something the learner never tried.
 */
const NOT_KNOWN = /^(answer:\s*)?(i\s*(don['’]?t|do not)\s+know|idk|no idea|not a clue|no clue|i have no idea|i('ve| have)? never (learn|learnt|learned|studied|seen|done)|i haven['’]?t (learn|learnt|learned|studied|seen|done)|i['’]?m (learning|starting) (this )?(from scratch|from zero|from the beginning)|(learning|starting) from scratch|i['’]?m (new|a beginner)|pass)\b/i
export function saysDontKnow(said: string): boolean {
  const mine = ownWords(said).replace(/\n\(Confidence: [^)]*\)\s*$/, '').trim()
  return IDK.test(mine) || (NOT_KNOWN.test(mine) && mine.replace(/^answer:\s*/i, '').length < 160 && !/\b(but|because|though|think|maybe|guess|probably|perhaps|is|are|=)\b|\d/i.test(mine.replace(NOT_KNOWN, '')))
}

/** Whether what the learner sent is an answer to mark: not a question of theirs, Go on, a hint request or "I don't know" */
export function isAnswer(said: string): boolean {
  const mine = ownWords(said).replace(/\n\(Confidence: [^)]*\)\s*$/, '').trim()
  return /^Answer:/i.test(mine) && !IDK.test(mine) && !saysDontKnow(mine)
}

/** Whether a mark on the reply to this message has nothing to mark */
export const nothingToMark = (said: string) => {
  const mine = ownWords(said).trim()
  // "I've got this, move on" (shared/lessonPlan) is a request too
  return mine.startsWith(ASKED) || mine === GO_ON || /^\[hint\]$/i.test(mine) || isMoveOn(mine) || saysDontKnow(mine)
}

/** Grades turned back into what they say: the feedback stays, as a paragraph, and no mark is recorded */
export const unmarked = (reply: string) => closeGrade(reply).replace(/<grade\b[^>]*>([\s\S]*?)<\/grade>/gi, (_, body: string) => body.trim())

export function repairReply(reply: string, said: string): { text: string; repaired: string[] } {
  const repaired: string[] = []
  let text = closeGrade(reply)
  if (text !== reply) repaired.push('close')
  if (nothingToMark(said) && /<grade\b/i.test(text)) {
    text = unmarked(text)
    repaired.push('grade')
  }
  // The question parseBlocks makes of a numbered question left with <continue/>
  if (/<continue\b[^>]*\/?>/i.test(text) && parseBlocks(text).some((b) => b.kind === 'ask')) {
    text = text.replace(/\s*<continue\b[^>]*\/?>/gi, '')
    repaired.push('ask')
  }
  // Tags the model invents for things it means to point at (a file, a tool call) are not prose:
  // live, Gemma wrote "<file_path>Raft (algorithm) - Safety rules</file_path>" twice under a reading
  // (outside code blocks: XML in a code block is code)
  const stray = text
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, i) => (i % 2 ? part : part.replace(STRAY_TAG_LINE, '').replace(/\n{3,}/g, '\n\n')))
    .join('')
  if (stray !== text) {
    text = stray
    repaired.push('stray')
  }
  return { text, repaired }
}

/** A line that is only an invented tag: <file_path>…</file_path>, <tool_call>…</tool_call> and the like */
const STRAY_TAG_LINE = /^[ \t]*<(file_path|filepath|file|path|tool_call|tool_code|function_call|image_path|source_path)\b[^>]*>[^\n]*?(?:<\/\1>)?[ \t]*$\n?/gim
