import { describe, expect, it } from 'vitest'
import { fishText, narrationLine, narrationPieces, resumePlace, stepRange } from '../src/shared/narration'
import { stripTags } from '../src/shared/lectureScript'

describe('narration: what the professor says', () => {
  it('turns square brackets into round ones, so Fish never reads them as delivery tags', () => {
    expect(fishText('layers [2, 4, 1] and [pause]')).toBe('layers (2, 4, 1) and (pause)')
  })

  it('says a tour step in plain words: no Markdown, code marks or TeX', () => {
    const line = narrationLine('Watch **the loss** fall as `rate` grows: $x^2$ is the bowl [2,4,1].')
    expect(line).toBe('Watch the loss fall as rate grows: x squared is the bowl (2,4,1).')
  })

  it('keeps each piece with its step, and drops a step with nothing to say', () => {
    const says = ['Order 3: a node holds one or two keys. Every leaf is on the same level.', '', 'Insert 150. The leaf splits and its median moves up, so the parent overflows and splits too, and finally the root splits: the only way the tree gets taller.']
    const pieces = narrationPieces(says)
    expect(pieces.length).toBeGreaterThanOrEqual(2)
    expect(pieces.every((p) => p.step === 0 || p.step === 2)).toBe(true)
    expect(pieces.map((p) => p.step)).toEqual([...pieces.map((p) => p.step)].sort())
    expect(pieces.map((p) => stripTags(p.text)).join(' ')).toContain('the only way the tree gets taller')
    expect(stepRange(pieces, 1)).toEqual([0, 0])
    const [a, b] = stepRange(pieces, 2)
    expect(b).toBeGreaterThan(a)
    expect(pieces.slice(a, b).every((p) => p.step === 2)).toBe(true)
    expect(b).toBe(pieces.length)
  })
})

describe('narration: where you were listening', () => {
  it('picks up at the sentence you stopped at, when you start from that paragraph', () => {
    expect(resumePlace({ chapter: 2, unit: 5, offset: 140 }, { chapter: 2, unit: 5 })).toEqual({ chapter: 2, unit: 5, offset: 140 })
  })

  it('starts the paragraph you are at when you have moved on since', () => {
    expect(resumePlace({ chapter: 2, unit: 5, offset: 140 }, { chapter: 2, unit: 9 })).toEqual({ chapter: 2, unit: 9, offset: 0 })
    expect(resumePlace(null, { chapter: 0, unit: 0 })).toEqual({ chapter: 0, unit: 0, offset: 0 })
  })
})
