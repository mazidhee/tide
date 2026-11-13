import { describe, expect, it } from 'vitest'
import { anchorOf, reanchor, restoreReview } from '../src/shared/reviewKeep'
import type { Proposal, ReviewComment } from '../src/shared/ide'

const c = (line: number, anchor?: string): ReviewComment => ({ id: `c${line}`, root: '/r', path: 'a.py', line, severity: 'issue', body: 'b', ...(anchor !== undefined ? { anchor } : {}) })
const p = (original: string, isNew = false): Proposal => ({ id: 'p', root: '/r', path: 'a.py', original, proposed: 'new', explanation: '', created: 0, ...(isNew ? { isNew } : {}) })

describe('what survives a reload', () => {
  it('finds a comment’s line by its text, nearest first', () => {
    const text = 'x = 1\nreturn x\ny = 2\nreturn x\n'
    expect(anchorOf(text, 2)).toBe('return x')
    expect(reanchor(c(2, 'return x'), text)).toBe(2)
    expect(reanchor(c(3, 'return x'), text)).toBe(2)
    expect(reanchor(c(5, 'return x'), text)).toBe(4)
    expect(reanchor(c(1, 'gone'), text)).toBeNull()
    // An old comment without its text: kept while its line exists
    expect(reanchor(c(3), text)).toBe(3)
    expect(reanchor(c(30), text)).toBeNull()
  })

  it('keeps a proposal only while the file is what it was proposed against', () => {
    expect(restoreReview({ proposals: [p('old')], comments: [] }, () => 'old').proposals).toHaveLength(1)
    expect(restoreReview({ proposals: [p('old')], comments: [] }, () => 'changed')).toMatchObject({ proposals: [], dropped: 1 })
    expect(restoreReview({ proposals: [p('', true)], comments: [] }, () => null).proposals).toHaveLength(1)
    expect(restoreReview({ proposals: [p('', true)], comments: [] }, () => 'someone made it').proposals).toHaveLength(0)
    expect(restoreReview({ proposals: [], comments: [c(1, 'x')] }, () => null)).toMatchObject({ comments: [], dropped: 1 })
  })
})
