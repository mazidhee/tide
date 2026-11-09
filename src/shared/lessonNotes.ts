/**
 * The note a lesson leaves behind: the tutor's takeaways under "From the lesson" (added as it
 * teaches) and the learner's own explanation under "In my words". Both live in one ordinary
 * Markdown note, so everything learned ends up in the vault.
 */

export const LESSON_HEADING = '## From the lesson'
export const OWN_WORDS_HEADING = '## In my words'

/** A new note for a topic: a title, the two sections and a nudge to write */
export function newLessonNote(topic: string): string {
  return `# ${topic}\n\n${LESSON_HEADING}\n\n${OWN_WORDS_HEADING}\n\n`
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Adds takeaways under "From the lesson" (created if missing, just above "In my words" when
 * that exists), skipping any already there. Returns the note unchanged if nothing is new.
 */
export function addTakeaways(note: string, takeaways: string[]): string {
  const have = norm(note)
  const fresh = takeaways.map((t) => t.trim()).filter((t) => t && !have.includes(norm(t).slice(0, 80)))
  if (!fresh.length) return note
  const block = fresh.map((t) => (/^([-*+]\s|\d+\.\s|>|```|\$\$|#)/.test(t) ? t : `- ${t.replace(/\n/g, '\n  ')}`)).join('\n')
  const lines = note.replace(/\s+$/, '').split('\n')
  const lesson = lines.findIndex((l) => l.trim() === LESSON_HEADING)
  const own = lines.findIndex((l) => l.trim() === OWN_WORDS_HEADING)
  if (lesson < 0) {
    // No lesson section yet: put it before "In my words", or at the end with "In my words" after it
    const at = own >= 0 ? own : lines.length
    const tail = own >= 0 ? [] : [OWN_WORDS_HEADING, '']
    lines.splice(at, 0, ...(at > 0 && lines[at - 1].trim() ? [''] : []), LESSON_HEADING, '', block, '', ...tail)
    return tidy(lines)
  }
  // The end of the lesson section: the next heading of the same or higher level, or the end
  let end = lines.length
  for (let i = lesson + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) {
    end = i
    break
  }
  while (end > lesson + 1 && !lines[end - 1].trim()) end--
  // A bullet after a bullet joins the list; anything else gets its own paragraph
  const joins = end > lesson + 1 && /^\s*[-*+]\s/.test(lines[end - 1]) && block.startsWith('- ')
  lines.splice(end, 0, ...(joins ? [] : ['']), block, '')
  if (own < 0) lines.push('', OWN_WORDS_HEADING, '')
  return tidy(lines)
}

const tidy = (lines: string[]) => lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '') + '\n'

/**
 * Whether a paragraph is worth a margin note now: it ends a thought (a sentence or a formula),
 * and it has changed enough since it was last looked at. Each look costs the model seconds, so
 * a word fixed here and there doesn't earn another.
 */
export function readyForMargin(text: string, lastSeen?: string): boolean {
  const t = text.trim()
  if (!/[.!?:)\]]$|\$\$$/.test(t)) return false
  if (!lastSeen) return true
  const a = lastSeen.trim()
  let start = 0
  while (start < a.length && start < t.length && a[start] === t[start]) start++
  let end = 0
  while (end < a.length - start && end < t.length - start && a[a.length - 1 - end] === t[t.length - 1 - end]) end++
  const changed = Math.max(a.length, t.length) - start - end
  return changed / Math.max(a.length, t.length, 1) >= 0.3
}

/** Everything the learner wrote in the note: all of it but the title and the tutor's takeaways */
export function learnerText(note: string): string {
  const lines = note.replace(/^#\s[^\n]*\n/, '').split('\n')
  const out: string[] = []
  let inLesson = false
  for (const l of lines) {
    if (/^#{1,2}\s/.test(l)) inLesson = l.trim() === LESSON_HEADING
    if (!inLesson && l.trim() !== OWN_WORDS_HEADING) out.push(l)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Asked to look at their notes ("review my notes", "can you check what I wrote?") */
export const wantsNotesReview = (text: string) => /\b(review|check|mark|look (at|over)|read|feedback on)\b[^.?!]{0,30}\b(my )?(notes?|what i('ve)? (wrote|written)|my (work|writing|explanation|words))\b/i.test(text)

/** The request that sends what they wrote to the tutor, for feedback that helps them fix it */
export const notesReviewRequest = (mine: string) =>
  `Here is what I've written in my notes for this lesson:\n\n${mine}\n\nReview it against what we covered. First say what's right and why it works. Then at most three things that are wrong, unclear or missing, most important first: quote the exact line, say why it matters and what to change. Then ask one question or problem that tests the weakest point.`
