/** Formats cards in the Obsidian Spaced Repetition syntax, multi-line when needed so they round trip. */
export function cardsToMarkdown(cards: { front: string; back: string }[]): string {
  return cards
    .map(({ front, back }) => {
      const f = front.trim()
      const b = back.trim()
      return f.includes('\n') || b.includes('\n') || f.includes('::') || b.includes('::') ? `${f}\n?\n${b}` : `${f}::${b}`
    })
    .join('\n\n')
}

/**
 * A flashcards note with cards added at the end, unless they're in it already: adding the same
 * card twice (a lesson's miss card added automatically, then again after a reload) changes nothing.
 */
export function withCards(existing: string, cardsMarkdown: string): string {
  const add = cardsMarkdown.trim()
  if (!add || hasCards(existing, add)) return existing
  return existing.trimEnd() + '\n\n' + add + '\n'
}

/** Whether these cards (as cardsToMarkdown wrote them) are in a flashcards note */
export const hasCards = (existing: string, cardsMarkdown: string) => {
  const md = cardsMarkdown.trim()
  return !!md && `\n${existing.split(/\r?\n/).join('\n')}\n`.includes(`\n${md}\n`)
}

/** A flashcards note with these cards taken out again (Undo on a card added automatically) */
export function withoutCards(existing: string, cardsMarkdown: string): string {
  const md = cardsMarkdown.trim()
  const text = `\n${existing.split(/\r?\n/).join('\n')}\n`
  const at = md ? text.indexOf(`\n${md}\n`) : -1
  if (at < 0) return existing
  return (text.slice(1, at).trimEnd() + '\n\n' + text.slice(at + md.length + 2).replace(/^\s+/, '')).trim() + '\n'
}
