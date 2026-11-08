import { describe, expect, it } from 'vitest'
import { formatMarkdown, type FormatKind } from '../src/shared/markdownFormat'

/** Applies a format to text with the selection marked as [ and ] */
function apply(marked: string, kind: FormatKind): string {
  const from = marked.indexOf('[')
  const to = marked.indexOf(']') - 1
  const doc = marked.replace('[', '').replace(']', '')
  const e = formatMarkdown(doc, from, to, kind)
  const next = doc.slice(0, e.from) + e.insert + doc.slice(e.to)
  const [a, b] = [Math.min(e.anchor, e.head), Math.max(e.anchor, e.head)]
  return next.slice(0, a) + '[' + next.slice(a, b) + ']' + next.slice(b)
}

describe('formatting markdown', () => {
  it('wraps and unwraps the selection', () => {
    expect(apply('a [word] b', 'bold')).toBe('a **[word]** b')
    expect(apply('a **[word]** b', 'bold')).toBe('a [word] b')
    expect(apply('a [**word**] b', 'bold')).toBe('a [word] b')
    expect(apply('x [log n ]y', 'math')).toBe('x $[log n]$ y')
    expect(apply('[]', 'code')).toBe('`[]`')
  })
  it('makes links, selecting what is left to type', () => {
    expect(apply('see [docs] now', 'link')).toBe('see [docs]([https://]) now')
    expect(apply('see [] now', 'link')).toBe('see [[text]](https://) now')
  })
  it('turns lines into headings and lists, and back', () => {
    expect(apply('Hel[lo]', 'h2')).toBe('## Hello[]')
    expect(apply('## Hel[lo]', 'h2')).toBe('Hello[]')
    expect(apply('# Hel[lo]', 'h2')).toBe('## Hello[]')
    expect(apply('[one\ntwo]', 'bullet')).toBe('[- one\n- two]')
    expect(apply('[- one\n- two]', 'bullet')).toBe('[one\ntwo]')
    expect(apply('[a\n\nb]', 'numbered')).toBe('[1. a\n\n2. b]')
    expect(apply('[- a]', 'task')).toBe('- [ ] a[]')
  })
  it('adds a divider below the line', () => {
    expect(apply('Intro[]', 'divider')).toBe('Intro\n\n---\n[]')
  })
})
