import type { EditorState } from '@codemirror/state'

/** The paragraph around the cursor; on a blank line, the one above. Lines are 0-based. */
export function paragraphAt(state: EditorState): { text: string; line: number } | null {
  const doc = state.doc
  // Headings end a paragraph too: notes often have a heading right above its text, no blank line
  const isText = (n: number) => !!doc.line(n).text.trim() && !/^#{1,6}\s/.test(doc.line(n).text)
  let start = doc.lineAt(state.selection.main.head).number
  if (!isText(start) && start > 1 && isText(start - 1)) start--
  if (!isText(start)) return null
  let end = start
  while (start > 1 && isText(start - 1)) start--
  while (end < doc.lines && isText(end + 1)) end++
  const text = Array.from({ length: end - start + 1 }, (_, i) => doc.line(start + i).text).join('\n').trim()
  return text ? { text, line: start - 1 } : null
}
