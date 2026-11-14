/**
 * Visuals kept per concept and per module part (main/conceptVisuals, shared/sceneCache), traces
 * for visuals (shared/pyTrace), ```draw blocks, Tide's own kit visuals, and the lesson kit's note.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { kitVisualFor, KIT_VISUALS, conceptId } from '../src/shared/kitVisuals'
import { keptText, readKept, usable, partKey, partFile, conceptFile } from '../src/shared/sceneCache'
import { cleanTrace, traceSourceOf, withTrace } from '../src/shared/pyTrace'
import { isDrawSource, parseDraw, looksComplete, MAX_VISUAL } from '../src/shared/visuals'
import { withKitVisual } from '../src/shared/subjects'

const store = new Map<string, string>()
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, protocol: { handle: () => {} } }))
vi.mock('../src/main/vault', () => ({
  readText: async (p: string) => {
    if (!store.has(p)) throw new Error('none')
    return store.get(p)!
  },
  writeText: async (p: string, s: string) => void store.set(p, s),
  absPath: (p: string) => `/nowhere/${p}`
}))
const calls: { prompt: string; system: string; role: string }[] = []
let teaches = true
let reply = ''
vi.mock('../src/main/claudeEngine', () => ({
  claudeTeaches: async () => teaches,
  claudeOnce: async (prompt: string, system: string, role: string) => {
    calls.push({ prompt, system, role })
    return { text: reply, model: 'claude-fable-5-1', usage: {}, ms: 1 }
  }
}))
const MODULE = `---
module: computation-foundations
title: Foundations of Computation
track: software-engineering
---
# Foundations of Computation

Depth goal: explain how a program becomes electrical signals.

## 1. How computers work — CORE

### How Computers Work

- [ ] [[Binary, hexadecimal, number representations|Binary, hexadecimal, number representations]]
- [ ] Boolean algebra and logic gates
- [ ] The fetch-decode-execute cycle

## 2. Assembly language — CORE

- [ ] Registers and the stack
`
vi.mock('../src/main/modules', async () => {
  const { parseModule } = await import('../src/shared/modules')
  return { loadCatalogue: async () => ({ modules: [parseModule('Roadmaps/Modules/computation-foundations.md', MODULE)], tracks: [] }) }
})

const SCENE = '<title>From switches to a CPU</title><div id="s"></div><script>visual.steps(["a"], () => {})</script>'

beforeEach(() => {
  store.clear()
  calls.length = 0
  teaches = true
  reply = '```visual\n' + SCENE + '\n```'
})

describe("Tide's own visuals", () => {
  it('are found by a concept’s words, the most specific first, and not by look-alikes', () => {
    expect(kitVisualFor('Binary, hexadecimal, number representations')?.id).toBe('binary-place-value')
    expect(kitVisualFor("two's complement")?.id).toBe('twos-complement')
    expect(kitVisualFor('The fetch-decode-execute cycle')?.id).toBe('fetch-decode-execute')
    expect(kitVisualFor('Boolean algebra and logic gates')?.id).toBe('half-adder')
    expect(kitVisualFor('Combinational circuits: adders, multiplexers')?.id).toBe('ripple-carry-adder')
    expect(kitVisualFor('Recursion and the call stack')?.id).toBe('python-call-frames')
    expect(kitVisualFor('python-names-objects')?.id).toBe('python-names-objects')
    // Not hardware
    expect(kitVisualFor('Binary search')).toBeNull()
    expect(kitVisualFor('Binary trees')).toBeNull()
    expect(kitVisualFor('The carry trade')).toBeNull()
    expect(kitVisualFor('Why did the Roman Republic die?')).toBeNull()
    expect(kitVisualFor('Payment processors and card networks')).toBeNull()
  })

  it('are complete visuals of a sane size, with steps or controls, using the kit', () => {
    for (const v of KIT_VISUALS) {
      expect(looksComplete(v.code), v.id).toBe(true)
      expect(v.code.length).toBeLessThan(MAX_VISUAL)
      expect(v.code, v.id).toMatch(/TideMachine\./)
      expect(conceptId(v.id)).toBe(v.id)
    }
  })

  it('a lesson on such a topic is told to open with one, whoever teaches', () => {
    expect(withKitVisual('', 'The fetch-decode-execute cycle')).toMatch(/```draw block holding the line "concept: fetch-decode-execute"/)
    expect(withKitVisual('A live simulation fits.', 'Logic gates')).toMatch(/^A live simulation fits\.\n\nTide has its own checked visual/)
    expect(withKitVisual('', 'The causes of the First World War')).toBe('')
  })
})

describe('```draw blocks', () => {
  it('name a concept and what to show', () => {
    expect(isDrawSource('draw')).toBe(true)
    expect(isDrawSource('drawing')).toBe(false)
    expect(parseDraw("concept: two's complement\nshow: -5 in 8 bits")).toEqual({ concept: "two's complement", show: '-5 in 8 bits' })
    expect(parseDraw('Binary place value')).toEqual({ concept: 'Binary place value', show: '' })
    expect(parseDraw('show: only this')).toBeNull()
  })
})

describe('kept visuals', () => {
  it('a file is its header and its code, read back the same', () => {
    const text = keptText({ code: SCENE, meta: { model: 'claude-fable-5-1', at: '2026-11-14', checked: true, title: 'A -- B' } })
    expect(text.startsWith('<!-- tide-visual {')).toBe(true)
    // A "--" in the header would end the comment early
    expect(text.split('\n')[0].slice(4, -3)).not.toMatch(/--/)
    const back = readKept(text)!
    expect(back.code).toBe(SCENE)
    expect(back.meta).toMatchObject({ model: 'claude-fable-5-1', checked: true, title: 'A -- B' })
    expect(usable(back)).toBe(true)
    expect(usable({ ...back, meta: { ...back.meta, feedback: 'down' } })).toBe(false)
    expect(usable({ ...back, meta: { ...back.meta, checked: false } })).toBe(false)
    expect(readKept(SCENE)).toBeNull()
    expect(partFile(partKey('computation-foundations', 1))).toBe('.tide/visuals/parts/computation-foundations#1.html')
    expect(conceptFile("Two's complement")).toBe('.tide/visuals/twos-complement.html')
  })

  it('a concept: Tide’s own first, then the model writes it once, kept unchecked until the window’s check passes', async () => {
    const cv = await import('../src/main/conceptVisuals')
    const kit = await cv.visualForConcept({ concept: 'logic gates' })
    expect(kit).toMatchObject({ source: 'kit' })
    expect(calls).toHaveLength(0)
    const fresh = await cv.visualForConcept({ concept: 'B-tree split', show: 'order 3, insert 7' })
    expect(fresh).toMatchObject({ source: 'model', unchecked: true, model: 'claude-fable-5-1' })
    expect(calls[0]).toMatchObject({ role: 'visual' })
    expect(calls[0].prompt).toMatch(/order 3, insert 7/)
    expect(await cv.keepVisual('concept', fresh.key, fresh.code)).toBe(true)
    const again = await cv.visualForConcept({ concept: 'B-tree split' })
    expect(again).toMatchObject({ source: 'kept', code: SCENE })
    expect(calls).toHaveLength(1)
    // Not clear: the next time draws it again
    await cv.visualFeedback('concept', 'B-tree split', 'down')
    await cv.visualForConcept({ concept: 'B-tree split' })
    expect(calls).toHaveLength(2)
  })

  it('a visual that fails its check is dropped, and Redraw asks again even for one Tide has', async () => {
    const cv = await import('../src/main/conceptVisuals')
    const fresh = await cv.visualForConcept({ concept: 'Red-black tree rotation' })
    expect(store.size).toBe(1)
    await cv.dropVisual('concept', fresh.key)
    // (absPath points nowhere in this test: the file is removed from disk there; read it back as gone)
    const redrawn = await cv.visualForConcept({ concept: 'logic gates', redraw: true })
    expect(redrawn.source).toBe('model')
  })

  it('without Claude: Tide’s own visual, or a plain reason', async () => {
    teaches = false
    const cv = await import('../src/main/conceptVisuals')
    expect(await cv.visualForConcept({ concept: 'How a CPU executes an instruction', redraw: true })).toMatchObject({ source: 'kit', error: expect.stringMatching(/Claude is not set up/) })
    expect((await cv.visualForConcept({ concept: 'Bloom filters' })).code).toBeUndefined()
  })

  it('a part’s big picture: written by the visual model from the part’s topics, with Tide’s own 2D visual to fall back on', async () => {
    const cv = await import('../src/main/conceptVisuals')
    expect(await cv.partOfTopic('Boolean algebra and logic gates')).toMatchObject({ module: 'computation-foundations', part: 1, title: 'How computers work' })
    expect(await cv.partOfTopic('Binary, hexadecimal, number representations')).toMatchObject({ part: 1 })
    expect(await cv.partOfTopic('Registers and the stack')).toMatchObject({ part: 2 })
    expect(await cv.partOfTopic('Something else')).toBeNull()
    const s = await cv.partScene({ module: 'computation-foundations', part: 1 })
    expect(s).toMatchObject({ source: 'model', unchecked: true, key: 'computation-foundations#1' })
    expect(s.fallback).toMatch(/TideMachine\.bits/)
    expect(calls[0].system).toMatch(/big picture/)
    expect(calls[0].prompt).toMatch(/This part: How computers work[\s\S]*- Boolean algebra and logic gates/)
    await cv.keepVisual('part', s.key, s.code)
    expect(await cv.partsOfModule('computation-foundations')).toEqual([
      { part: 1, title: 'How computers work', kept: true },
      { part: 2, title: 'Assembly language', kept: false }
    ])
    expect(await cv.partScene({ module: 'computation-foundations', part: 1 })).toMatchObject({ source: 'kept' })
    expect(calls).toHaveLength(1)
  })
})

describe('Python traces for visuals', () => {
  it('finds the snippet a visual asks to trace, without its indent', () => {
    expect(traceSourceOf('<script type="text/x-python">\n    a = 1\n    b = [a]\n</script><div></div>')).toBe('a = 1\nb = [a]')
    expect(traceSourceOf('<script>const a = 1</script>')).toBeNull()
  })

  it('puts the trace in front of the visual, so nothing in it can close the script', () => {
    const t = cleanTrace({ code: 'x = "</script>"', ok: true, steps: [{ line: 1, event: 'line', frames: [{ name: 'module', line: 1, names: [] }], heap: [], out: '' }], objects: [{ id: '0x1', t: 'str', v: "'</script><script>alert(1)</script>'" }] })!
    const code = withTrace('<div id="py"></div>', { trace: t })
    expect(code.match(/<\/script>/g)).toHaveLength(1)
    expect(code).toContain('\\u003c/script>')
    expect(withTrace('<p></p>', { error: 'no python' })).toContain('window.TIDE_TRACE_ERROR = "no python"')
  })

  it('a trace is checked field by field', () => {
    expect(cleanTrace({ steps: [], objects: [{ id: 'not-an-id', t: 'int' }] })).toBeNull()
    expect(cleanTrace({ steps: 'x', objects: [] })).toBeNull()
    const t = cleanTrace({ code: 'a', ok: true, steps: [{ line: 1, event: 'line', frames: [{ name: 'module', line: 1, names: [['a', '0xff'], ['b', 'nope']] }], heap: [0, 7], out: '' }], objects: [{ id: '0xff', t: 'int', v: '1', d: [1] }] })!
    expect(t.steps[0].frames[0].names).toEqual([['a', '0xff']])
    expect(t.steps[0].heap).toEqual([0])
  })
})
