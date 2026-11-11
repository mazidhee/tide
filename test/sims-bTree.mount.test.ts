// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { samples } from '../design/prototype/sims/samples/bTree'
import { mount, parseSim } from '../src/renderer/src/lib/sims/runtime'
import { KINDS } from '../src/renderer/src/lib/sims/runtime'
import type { BTreeSpec } from '../src/renderer/src/lib/sims/btree'
import type { SimHost } from '../src/renderer/src/lib/sims/shell'

describe('b-tree: mounted', () => {
  it('mounts every sample, steps, resets and is destroyed without an exception', () => {
    for (const [, , json] of samples) {
      const spec = parseSim(json)
      expect(spec?.kind).toBe('b-tree')
      const sim = mount(spec!, (root) => document.body.append(root))
      expect(sim.root.querySelector('.sim-bt-svg')).not.toBeNull()
      const key = (k: string) => sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
      for (let i = 0; i < 12; i++) key('s')
      key('r')
      for (const b of Array.from(sim.root.querySelectorAll('button'))) if (b.textContent === 'Next') for (let i = 0; i < 6; i++) b.click()
      sim.destroy()
      sim.root.remove()
    }
  })

  it('steps, describes the parts its tour names, acts on each verb and takes typed keys', () => {
    const spec = parseSim(samples.find(([key]) => key === 'b-tree-tour')![2]) as BTreeSpec
    const root = document.createElement('figure')
    document.body.append(root)
    const host: SimHost = { root, palette: () => ({}) as ReturnType<SimHost['palette']>, select: () => undefined, peek: () => undefined, invalidate: () => undefined, reducedMotion: false }
    const view = KINDS['b-tree'].create(spec, host)
    root.append(view.el)
    view.draw()
    expect(view.done?.()).toMatch(/Nothing queued/)
    for (const step of spec.tour) {
      // The frame reads the part before it acts
      expect(view.describe(step.at), step.at).not.toBeNull()
      view.highlight(step.at)
      if (step.do) view.act?.(step.do)
      for (let i = 0; i < (step.do?.run ?? 0) && !view.done?.(); i++) view.step()
      view.draw()
    }
    for (const part of ['root', 'node:1:1', 'node:2:1', 'path', 'height', 'fill', 'order', 'step']) expect(view.describe(part), part).not.toBeNull()
    expect(view.describe('node:9:9')).toBeNull()
    expect(view.describe('nonsense')).toBeNull()

    view.act?.({ insert: [1, 2], delete: 1, search: '2' })
    let n = 0
    while (!view.done?.() && n++ < 100) view.step()
    view.draw()
    expect(view.describe('key:2')).not.toBeNull()
    expect(view.describe('key:1')).toBeNull()

    // Typed keys: junk is refused in words, a number starts an operation
    const input = view.el.querySelector<HTMLInputElement>('.sim-bt-input')!
    const press = (name: string) => Array.from(view.el.querySelectorAll('button')).find((b) => b.textContent === name)!.click()
    input.value = 'four'
    press('Insert')
    view.draw()
    expect(view.el.querySelector('.sim-bt-msg')?.textContent).toMatch(/not a whole number/)
    input.value = '2'
    press('Insert')
    view.draw()
    expect(view.el.querySelector('.sim-bt-msg')?.textContent).toMatch(/already in the tree/)
    input.value = '777'
    press('Delete')
    view.draw()
    expect(view.el.querySelector('.sim-bt-msg')?.textContent).toMatch(/not in the tree/)
    input.value = '33'
    press('Insert')
    while (!view.done?.()) view.step()
    view.draw()
    expect(view.describe('key:33')).not.toBeNull()
    expect(view.el.querySelectorAll('.sim-bt-key').length).toBeGreaterThan(5)

    // Changing the order keeps the keys
    const before = view.el.querySelectorAll('.sim-bt-key').length
    Array.from(view.el.querySelectorAll<HTMLButtonElement>('.sim-seg-btn')).find((b) => b.textContent === '7')!.click()
    view.draw()
    expect(view.el.querySelectorAll('.sim-bt-key').length).toBe(before)
    view.reset()
    view.draw()
    view.highlight(null)
    view.destroy?.()
  })
})
