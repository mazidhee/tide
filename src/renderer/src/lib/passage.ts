/**
 * Finding a passage in a rendered note by what it says: how a missed question in What you know
 * opens its lesson's page at that question.
 */

/** Words as compared: lower case, letters and digits only, a short ellipsis-cut tail dropped */
const plainWords = (s: string) =>
  s
    .replace(/\s*\S*…\s*$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The innermost block in the page whose text holds the start of `text` (sixty characters of it) */
export function passageSaying(root: HTMLElement, text: string): HTMLElement | null {
  const want = plainWords(text).slice(0, 60)
  if (want.length < 12) return null
  let found: HTMLElement | null = null
  for (const el of root.querySelectorAll<HTMLElement>('p, li, blockquote, td, h1, h2, h3, h4, h5, h6')) {
    if (plainWords(el.textContent ?? '').includes(want)) found = found && found.contains(el) ? el : (found ?? el)
  }
  return found
}
