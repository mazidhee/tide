import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { itemLink, linkItemText, normalizeTitle, parseOutline, sectionProgress, serializeOutline } from '../src/shared/outline'

const SAMPLE = `---
title: Maths roadmap
---
## Part I — Numbers

Some intro text that is not a list.

### Chapter 1: Numbers

- [x] Why humans started counting — tallying
- [ ] [[2. The Invention of Zero|The invention of zero]]
  - [ ] Babylonian placeholder
- Plain bullet
`

describe('outline', () => {
  it('round-trips exactly', () => {
    expect(serializeOutline(parseOutline(SAMPLE))).toBe(SAMPLE)
  })

  it('round-trips the real roadmap note when present', () => {
    const real = join(homedir(), 'Documents/Study Notes/Roadmaps/RM_MATH.md')
    if (!existsSync(real)) return
    const md = readFileSync(real, 'utf8')
    expect(serializeOutline(parseOutline(md))).toBe(md)
  })

  it('reads headings, checkboxes and depth', () => {
    const o = parseOutline(SAMPLE)
    const items = o.lines.filter((l) => l.kind === 'item')
    expect(items.map((i) => i.kind === 'item' && [i.depth, i.checked])).toEqual([[0, true], [0, false], [1, false], [0, null]])
    expect(sectionProgress(o.lines, o.lines.findIndex((l) => l.kind === 'heading' && l.level === 2))).toEqual({ done: 1, total: 3 })
  })

  it('handles links in topics', () => {
    expect(itemLink('[[2. The Invention of Zero|The invention of zero]]')).toEqual({ target: '2. The Invention of Zero', label: 'The invention of zero' })
    expect(itemLink('Prime numbers')).toEqual({ target: null, label: 'Prime numbers' })
    expect(linkItemText('Prime numbers', 'Primes')).toBe('[[Primes|Prime numbers]]')
  })

  it('matches topic titles to note names', () => {
    expect(normalizeTitle('2. The Invention of Zero.md')).toBe(normalizeTitle('The invention of zero'))
    expect(normalizeTitle('4. The Integers — Negative Numbers and Debt')).toBe(normalizeTitle('The integers — negative numbers, debt'))
    expect(normalizeTitle('Rational numbers (fractions) — ratios')).toBe('rational numbers')
  })
})

describe('roadmap page roles', () => {
  it('separates the roadmap from commentary', async () => {
    const { headingTag, lineRole, parseOutline } = await import('../src/shared/outline')
    const md = `# My roadmap

## 1. Foundations — CORE

### How Computers Work

- [ ] Boolean algebra
**Performance**
- [ ] NumPy
    - _Fluent Python — Ramalho_
> Do C before C++.
- a plain bullet note
---
`
    const { lines } = parseOutline(md)
    const roles = lines.map((_, i) => lineRole(lines, i))
    const by = (text: string) => roles[lines.findIndex((l) => 'text' in l && l.text.includes(text))]
    expect(by('My roadmap')).toBe('title')
    expect(by('Foundations')).toBe('normal')
    expect(by('Performance')).toBe('subhead')
    expect(by('Fluent Python')).toBe('normal')
    expect(by('Do C before')).toBe('note')
    expect(by('plain bullet')).toBe('note')
    expect(roles[lines.findIndex((l) => l.kind === 'raw' && l.text === '---')]).toBe('rule')
    expect(headingTag('1. Foundations — CORE')).toEqual({ title: '1. Foundations', tag: 'Core', suffix: ' — CORE' })
    expect(headingTag('Python — Testing').tag).toBeUndefined()
  })
})
