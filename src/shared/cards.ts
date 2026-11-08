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
