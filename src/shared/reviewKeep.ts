/**
 * Claude's review comments and pending proposals, kept across a reload (main/ide/pair saves them
 * per folder in Tide's data). Pure: what survives when the folder is opened again. A proposal is
 * a whole file's new text, so it is kept only while the file is still what it was proposed
 * against; a comment follows its line by the line's text, and goes when that text is gone.
 */
import type { Proposal, ReviewComment } from './ide'

export interface SavedReview {
  proposals: Proposal[]
  comments: ReviewComment[]
}

/** The line a comment was written on (its text, trimmed), to find it again */
export function anchorOf(text: string, line: number): string {
  return (text.split('\n')[line - 1] ?? '').trim()
}

/** Where the comment's line is now: the same line, else the nearest line with its text; null when it's gone */
export function reanchor(c: ReviewComment, text: string): number | null {
  const lines = text.split('\n')
  if (!c.anchor) return c.line <= lines.length ? c.line : null
  if (lines[c.line - 1]?.trim() === c.anchor) return c.line
  let best: number | null = null
  lines.forEach((l, i) => {
    if (l.trim() === c.anchor && (best === null || Math.abs(i + 1 - c.line) < Math.abs(best - c.line))) best = i + 1
  })
  return best
}

/**
 * What survives, given each file's text now (null: the file is gone or unreadable). `dropped`
 * counts what went because the code changed under it.
 */
export function restoreReview(saved: SavedReview, textOf: (path: string) => string | null): SavedReview & { dropped: number } {
  let dropped = 0
  const proposals = saved.proposals.filter((p) => {
    const now = textOf(p.path)
    const keep = p.isNew ? !now : now === p.original
    if (!keep) dropped++
    return keep
  })
  const comments: ReviewComment[] = []
  for (const c of saved.comments) {
    const now = textOf(c.path)
    const line = now === null ? null : reanchor(c, now)
    if (line === null) dropped++
    else comments.push(line === c.line ? c : { ...c, line })
  }
  return { proposals, comments, dropped }
}
