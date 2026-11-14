import { describe, expect, it } from 'vitest'
import { setFrontTitle } from '@shared/writingMeta'
import { pieceTitle } from '@shared/writing'

describe('editing a piece title', () => {
  it('changes only the title, and an id that matched it, in a base-k style note', () => {
    const md = '---\nid: Untitled\ntags: []\ndate: 2026-11-14\ntitle: Untitled\ndraft: true\n---\n\nFirst line.\n'
    const out = setFrontTitle(md, 'On attention')
    expect(out).toBe('---\nid: On attention\ntags: []\ndate: 2026-11-14\ntitle: On attention\ndraft: true\n---\n\nFirst line.\n')
    expect(pieceTitle(out, 'thoughts/Untitled.md')).toBe('On attention')
  })
  it('quotes a title that YAML would misread, and keeps an unrelated id', () => {
    const md = '---\nid: abc123\ntitle: Old\n---\nBody'
    const out = setFrontTitle(md, 'Why: a question')
    expect(out).toBe('---\nid: abc123\ntitle: "Why: a question"\n---\nBody')
  })
  it('adds a title to a note without front matter, and ignores an empty title', () => {
    expect(setFrontTitle('Body', 'New')).toBe('---\ntitle: New\n---\nBody')
    expect(setFrontTitle('---\ntitle: Keep\n---\nB', '  ')).toBe('---\ntitle: Keep\n---\nB')
  })
})
