/**
 * Line changes between two texts, as hunks (jsdiff's diffArrays over lines): the git gutter's
 * added, changed and removed marks, and Claude's proposed edits accepted or rejected one hunk at a
 * time. Pure, so it's tested in Node.
 */
import { diffArrays } from 'diff'

export interface Hunk {
  /** 0-based line index in the old text where it starts */
  oldStart: number
  old: string[]
  /** 0-based line index in the new text */
  newStart: number
  new: string[]
}

const lines = (s: string) => s.split('\n')

export function hunks(before: string, after: string): Hunk[] {
  const out: Hunk[] = []
  let o = 0
  let n = 0
  let cur: Hunk | null = null
  for (const part of diffArrays(lines(before), lines(after))) {
    const count = part.value.length
    if (!part.added && !part.removed) {
      cur = null
      o += count
      n += count
      continue
    }
    if (!cur) out.push((cur = { oldStart: o, old: [], newStart: n, new: [] }))
    if (part.removed) {
      cur.old.push(...part.value)
      o += count
    } else {
      cur.new.push(...part.value)
      n += count
    }
  }
  return out
}

/** The old text with only the chosen hunks applied (all of them gives the new text) */
export function applyHunks(before: string, list: Hunk[], keep: (i: number) => boolean): string {
  const src = lines(before)
  const out: string[] = []
  let at = 0
  list.forEach((h, i) => {
    out.push(...src.slice(at, h.oldStart))
    out.push(...(keep(i) ? h.new : h.old))
    at = h.oldStart + h.old.length
  })
  out.push(...src.slice(at))
  return out.join('\n')
}

export type GutterKind = 'added' | 'modified' | 'deleted'

export interface GutterMark {
  kind: GutterKind
  /** 1-based lines in the new text; a deletion marks the line it was removed above */
  start: number
  end: number
}

/** What VS Code's gutter shows for a file against its last commit */
export function gutterMarks(before: string, after: string): GutterMark[] {
  return hunks(before, after).map((h) => {
    if (!h.old.length) return { kind: 'added', start: h.newStart + 1, end: h.newStart + h.new.length }
    if (!h.new.length) {
      const line = Math.max(1, h.newStart)
      return { kind: 'deleted', start: line, end: line }
    }
    return { kind: 'modified', start: h.newStart + 1, end: h.newStart + h.new.length }
  })
}

/** A unified diff of one file, hunks closer than twice the context merged, for Claude and the bug hunt's answer */
export function unified(path: string, before: string, after: string, context = 3): string {
  const a = lines(before)
  const hs = hunks(before, after)
  if (!hs.length) return ''
  // Group hunks whose context would touch
  const groups: Hunk[][] = []
  for (const h of hs) {
    const last = groups[groups.length - 1]
    const prev = last?.[last.length - 1]
    if (prev && h.oldStart - (prev.oldStart + prev.old.length) <= context * 2) last.push(h)
    else groups.push([h])
  }
  const out = [`--- a/${path}`, `+++ b/${path}`]
  for (const g of groups) {
    const first = g[0]
    const last = g[g.length - 1]
    const s = Math.max(0, first.oldStart - context)
    const e = Math.min(a.length, last.oldStart + last.old.length + context)
    const body: string[] = []
    let at = s
    let added = 0
    let removed = 0
    for (const h of g) {
      body.push(...a.slice(at, h.oldStart).map((l) => ` ${l}`), ...h.old.map((l) => `-${l}`), ...h.new.map((l) => `+${l}`))
      at = h.oldStart + h.old.length
      added += h.new.length
      removed += h.old.length
    }
    body.push(...a.slice(at, e).map((l) => ` ${l}`))
    const ns = first.newStart - (first.oldStart - s)
    out.push(`@@ -${s + 1},${e - s} +${ns + 1},${e - s - removed + added} @@`, ...body)
  }
  return out.join('\n')
}
