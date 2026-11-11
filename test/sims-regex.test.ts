// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseRegexPart, runMatches, splitLiteral, type RegexSpec } from '../src/renderer/src/lib/sims/regex'
import { parsePattern, railroad, times } from '../src/renderer/src/lib/sims/regexRail'
import { load, mount } from '../src/renderer/src/lib/sims/runtime'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('regex: the spec and matching', () => {
  it('reads a literal or a pattern with flags, and keeps only flags it shows', () => {
    expect(splitLiteral('/ab+c/gi')).toEqual({ pattern: 'ab+c', flags: 'gi' })
    const spec = parseSim('{"kind":"regexp","pattern":"/\\\\d+/gux","tests":["a1","b22",3]}') as RegexSpec
    expect(spec).toMatchObject({ kind: 'regex', pattern: '\\d+', flags: 'g', tests: ['a1', 'b22'] })
    expect(parseSim('{"kind":"regex","tests":["x"]}')).toBeNull()
  })

  it('finds every match with numbered and named groups, or only the first without g', () => {
    const r = runMatches('(?<area>\\d{3})-(\\d{4})(?:x(\\d+))?', 'g', ['555-1234 and 555-9876x12', 'none'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [one, none] = r.results
    expect(one.matches.map((m) => m.text)).toEqual(['555-1234', '555-9876x12'])
    expect(one.matches[0].groups).toEqual([
      { n: 1, name: 'area', text: '555', start: 0 },
      { n: 2, name: null, text: '1234', start: 4 },
      { n: 3, name: null, text: null, start: -1 }
    ])
    expect(one.matches[1].groups[2]).toMatchObject({ text: '12', start: 22 })
    expect(none.matches).toEqual([])
    const first = runMatches('\\d', '', ['1 2 3'])
    expect(first.ok && first.results[0].matches).toHaveLength(1)
    // Lookarounds don't count as groups
    const look = runMatches('(?<=\\$)(\\d+)(?=\\.)', 'g', ['$12.50'])
    expect(look.ok && look.results[0].matches[0].groups).toEqual([{ n: 1, name: null, text: '12', start: 1 }])
  })

  it('reports the engine\'s own message for a pattern that does not compile', () => {
    const r = runMatches('a(b', 'g', ['ab'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Unterminated group/)
  })

  it('names parts only where they exist', () => {
    expect(parseRegexPart('group:2', 2, 3, 2)).toEqual({ type: 'group', i: 2 })
    expect(parseRegexPart('group:3', 2, 3, 2)).toBeNull()
    expect(parseRegexPart('test:3', 2, 3, 2)).toBeNull()
    expect(parseRegexPart('diagram', 1, 0, 0)).toEqual({ type: 'diagram' })
  })
})

describe('regex: the railroad diagram', () => {
  it('reads quantifiers as counts', () => {
    expect(times({ kind: 'Range', from: 2, to: 2, greedy: true })).toEqual({ min: 2, max: 2 })
    expect(times({ kind: 'Range', from: 2, greedy: true })).toEqual({ min: 2, max: Infinity })
    expect(times({ kind: '?', greedy: true })).toEqual({ min: 0, max: 1 })
  })

  it('draws every construct in words, groups numbered as the matches are', () => {
    const p = parsePattern('^(?<y>\\d{4})-(0[1-9]|1[0-2])(?:-[^\\s]+)*?\\b(?!x)\\1|cat.?$', 'gi')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.groups).toBe(2)
    const { svg, width, height } = railroad(p.ast)
    expect(width).toBeGreaterThan(300)
    expect(height).toBeGreaterThan(60)
    const words = Array.from(svg.querySelectorAll('text'), (t) => t.textContent)
    for (const w of ['start', 'digit', '4 times', 'group 1 · y', 'group 2', '"0"', 'one of 1–9', 'one of 0–2', 'none of whitespace', 'as few as possible', 'word boundary', 'not followed by (not consumed)', 'same text as group 1', '"cat"', 'any character', 'end'])
      expect(words, w).toContain(w)
    expect(svg.querySelector('[data-part="group:2"]')).not.toBeNull()
  })

  it('says why a pattern cannot be read', () => {
    const p = parsePattern('a(b', '')
    expect(p.ok).toBe(false)
  })
})

describe('regex: mounted', () => {
  it('marks matches, follows edits to the pattern and the strings, and a tour', async () => {
    await load('regex')
    const spec = parseSim('{"kind":"regex","pattern":"(\\\\w+)@(\\\\w+)\\\\.com","tests":["ada@lovelace.com, bo@x.com","nothing"],"tour":[{"at":"group:2","say":"x","do":{"flags":"gi","test":"CY@Y.COM"}}]}') as RegexSpec
    const sim = mount(spec, (root) => document.body.append(root))
    await settle()
    expect(sim.root.querySelector('.rr')).not.toBeNull()
    expect(Array.from(sim.root.querySelectorAll('.sim-rx-count'), (c) => c.textContent)).toEqual(['2 matches', '0 matches', '1 match'])
    expect(sim.root.querySelectorAll('.sim-rx-table tbody tr')).toHaveLength(1)
    const input = sim.root.querySelector<HTMLInputElement>('.sim-rx-pattern')!
    input.value = '(\\w+'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    expect(sim.root.querySelector('.sim-pl-err')?.textContent).toMatch(/Unterminated group/)
    expect(sim.root.querySelector('.sim-rx-diagram')?.textContent).toMatch(/returns when the pattern can be read/)
    sim.destroy()
    sim.root.remove()
  })
})
