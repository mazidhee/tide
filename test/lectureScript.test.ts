import { describe, expect, it } from 'vitest'
import { speakMaths, readyToStart, chunkScript, cleanTags, engineFor, fallbackScript, isAck, lengthChoice, sourceOf, spokenWords, stripTags, tidyScript, toneOf, tooSlow, LECTURE_TAGS } from '@shared/lectureScript'

const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ') + '.'
const tagsIn = (s: string) => s.match(/\[[^\]]*\]/g) ?? []
const valid = (s: string) => tagsIn(s).every((t) => (LECTURE_TAGS as readonly string[]).includes(t.slice(1, -1)))

describe('length choice', () => {
  it('says short prose in full', () => {
    expect(lengthChoice(sourceOf('A logarithm asks which power turns the base into the number.'), 'all')).toBe('full')
    expect(lengthChoice(sourceOf('A logarithm asks which power turns the base into the number.'), 'gist')).toBe('full')
  })
  it('gives a spoken version of long replies, or the gist when chosen', () => {
    expect(lengthChoice(sourceOf(long(80)), 'all')).toBe('spoken')
    expect(lengthChoice(sourceOf(long(80)), 'gist')).toBe('gist')
  })
  it('never treats a reply with code as short enough to read out', () => {
    expect(lengthChoice(sourceOf('Look:\n```python\nx = 1\n```'), 'all')).toBe('spoken')
  })
})

describe('code, tables and pictures are described, not read', () => {
  const reply = 'Here is the loop.\n\n```python\nfor i in range(3):\n    print(i)\n```\n\n| n | log2 n |\n|---|---|\n| 2 | 1 |\n| 8 | 3 |\n\nWhat does it print?'
  it('turns them into markers in the source', () => {
    const src = sourceOf(reply)
    expect(src).toContain('[[2 lines of python code on the screen]]')
    expect(src).toMatch(/\[\[a table on the screen, 2 rows, with columns n and log2 n\]\]/)
    expect(src).not.toContain('print(i)')
    expect(src).not.toContain('|')
  })
  it('points at them in the fallback script', () => {
    const s = fallbackScript(reply)
    expect(s).toMatch(/on your screen/)
    expect(s).not.toMatch(/print\(|range\(|\|/)
    expect(stripTags(s)).toMatch(/What does it print\?$/)
  })
})

describe('tags', () => {
  it('keeps only valid tag syntax', () => {
    const s = cleanTags('[Inhale] So. [giggles] This is it. [[a table]] Then [EXCITED]  more? [short  pause]')
    expect(valid(s)).toBe(true)
    expect(s).toContain('[inhale]')
    expect(s).not.toMatch(/giggles|\[\[|\[$/)
  })
  it('never puts two tags in a row or a tag on every sentence', () => {
    const s = cleanTags('[inhale] [emphasis] One. [chuckle] Two. [exhale] Three. [emphasis] Four.')
    expect(s).not.toMatch(/\]\s*\[/)
    const tagged = s.split(/(?<=\.)\s+/).filter((x) => /\[(?!short pause|pause)/.test(x)).length
    expect(tagged).toBeLessThanOrEqual(2)
  })
  it('doesn’t ask the question twice when the script already asked it in other words', () => {
    const s = tidyScript('[inhale] So. What power of 2 gives you 8? Give me the power and the calculation.', 'x\n\nQuestion: What power of 2 gives you 8? Give the power and the calculation behind it.')
    expect(s.match(/power of 2/g)?.length).toBe(1)
  })
  it('tidies Claude’s script and keeps the question a question', () => {
    const s = tidyScript('Script: "[inhale] So, think about the base. [bogus] Which power gives eight"', '...\n\nQuestion: Which power of two gives eight')
    expect(valid(s)).toBe(true)
    expect(stripTags(s)).toMatch(/\?$/)
  })
})

describe('tone', () => {
  it('is excited on a correct grade', () => {
    const r = '<grade verdict="correct" score="1">Yes, three.</grade> Now the next one. <ask>What is log base 2 of 16?</ask>'
    expect(toneOf(r)).toBe('correct')
    const s = fallbackScript(r)
    expect(s.startsWith('[excited]')).toBe(true)
    expect(stripTags(s)).toMatch(/16\?$/)
  })
  it('is gentle after a miss, never excited', () => {
    const r = '<grade verdict="wrong" score="0">It is 3, not 4.</grade> Count the doublings.'
    expect(toneOf(r)).toBe('miss')
    expect(fallbackScript(r)).not.toMatch(/excited|laughing/)
  })
  it('is curious on a question', () => expect(toneOf('Think about it. <ask>Why?</ask>')).toBe('question'))
})

describe('chunking', () => {
  const script = '[excited] Yes! That’s it. [inhale] Now the second idea, which needs a little more room to breathe because it is longer. It carries on here. And here is a third sentence that is also fairly long indeed. [short pause] What do you think?'
  const chunks = chunkScript(script)
  it('starts with a short first piece', () => expect(spokenWords(chunks[0])).toBeLessThanOrEqual(14))
  it('keeps pieces to about 45 words and loses nothing', () => {
    for (const c of chunks) expect(spokenWords(c)).toBeLessThanOrEqual(45)
    expect(stripTags(chunks.join(' '))).toBe(stripTags(script))
  })
  it('keeps a tag with the words after it, never a piece of tags only', () => {
    for (const c of chunks) expect(stripTags(c).length).toBeGreaterThan(0)
    expect(chunks.some((c) => c.startsWith('[inhale] Now'))).toBe(true)
  })
})

describe('which voice', () => {
  const on = { lecture: true, ready: true, fellBack: false }
  it('uses Fish for a real reply', () => expect(engineFor('Let us think about logarithms and what they ask of us.', on)).toBe('fish'))
  it('uses Kokoro for a quick acknowledgement', () => {
    expect(isAck('[short pause] Right, go on.')).toBe(true)
    expect(engineFor('Right, go on.', on)).toBe('kokoro')
  })
  it('falls back to Kokoro when Fish failed, isn’t ready or isn’t chosen', () => {
    const t = 'Let us think about logarithms and what they ask of us.'
    expect(engineFor(t, { ...on, fellBack: true })).toBe('kokoro')
    expect(engineFor(t, { ...on, ready: false })).toBe('kokoro')
    expect(engineFor(t, { ...on, lecture: false })).toBe('kokoro')
  })
  it('calls a piece too slow past its budget', () => {
    expect(tooSlow(40_000, 20)).toBe(false)
    expect(tooSlow(200_000, 20)).toBe(true)
    expect(tooSlow(100_000, 5)).toBe(true)
  })
})

describe('when to start playing', () => {
  const w = (n: number) => Array.from({ length: n }, () => 'word').join(' ') + '.'
  it('waits for the first piece', () => expect(readyToStart([{ text: w(5), ready: false }], 0)).toBe(false))
  it('starts at once when everything is made', () => expect(readyToStart([{ text: w(5), ready: true, ms: 9000, secs: 2 }], 0)).toBe(true))
  it('holds back when the rest would run dry, and not past the longest wait', () => {
    const slow = [{ text: w(5), ready: true, ms: 10_000, secs: 2 }, { text: w(45), ready: false }]
    expect(readyToStart(slow, 2000)).toBe(false)
    expect(readyToStart(slow, 60_000)).toBe(true)
  })
  it('starts when enough is made to cover the rest', () => {
    const fast = [{ text: w(30), ready: true, ms: 6000, secs: 12 }, { text: w(10), ready: false }]
    expect(readyToStart(fast, 2000)).toBe(true)
  })
})

describe('maths in words', () => {
  it('says inline maths, never TeX', () => {
    expect(speakMaths('\\log_2 8 = 3')).toBe('log base 2 of 8 equals 3')
    expect(speakMaths('x^2 + \\frac{1}{2}')).toBe('x squared + 1 over 2')
    expect(sourceOf('So $\\log_2 32$ is? And 2 × 2 = 4.')).toBe('So log base 2 of 32 is? And 2 times 2 equals 4.')
  })
})
