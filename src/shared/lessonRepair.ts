import { ASKED, GO_ON, closeGrade, ownWords, parseBlocks } from './session'

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

/** Whether what the learner sent is an answer to mark: not a question of theirs, Go on, a hint request or "I don't know" */
export function isAnswer(said: string): boolean {
  const mine = ownWords(said).replace(/\n\(Confidence: [^)]*\)\s*$/, '').trim()
  return /^Answer:/i.test(mine) && !IDK.test(mine)
}

/** Whether a mark on the reply to this message has nothing to mark */
export const nothingToMark = (said: string) => {
  const mine = ownWords(said).trim()
  return mine.startsWith(ASKED) || mine === GO_ON || /^\[hint\]$/i.test(mine) || IDK.test(mine.replace(/\n\(Confidence: [^)]*\)\s*$/, '').trim())
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
  return { text, repaired }
}
