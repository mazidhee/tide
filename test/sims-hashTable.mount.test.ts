// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { samples } from '../design/prototype/sims/samples/hashTable'
import { KINDS, mount, parseSim } from '../src/renderer/src/lib/sims/runtime'
import type { HashTableSpec } from '../src/renderer/src/lib/sims/hashTable'
import type { SimHost } from '../src/renderer/src/lib/sims/shell'

describe('hash-table: mounted', () => {
  it('mounts every sample, steps, resets and is destroyed without an exception', () => {
    for (const [, , json] of samples) {
      const spec = parseSim(json)
      expect(spec?.kind).toBe('hash-table')
      const sim = mount(spec!, (root) => document.body.append(root))
      expect(sim.root.querySelector('.sim-ht-grid')).not.toBeNull()
      const key = (k: string) => sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
      for (let i = 0; i < 60; i++) key('s')
      key('r')
      for (const b of Array.from(sim.root.querySelectorAll('button'))) if (b.textContent === 'Next') for (let i = 0; i < 6; i++) b.click()
      sim.destroy()
      sim.root.remove()
    }
  })

  it('steps, describes the parts its tour names, acts on each verb and takes typed keys', () => {
    const spec = parseSim(samples.find(([key]) => key === 'hash-table-tour')![2]) as HashTableSpec
    const root = document.createElement('figure')
    document.body.append(root)
    const host: SimHost = { root, palette: () => ({}) as ReturnType<SimHost['palette']>, select: () => undefined, peek: () => undefined, invalidate: () => undefined, reducedMotion: false }
    const view = KINDS['hash-table'].create(spec, host)
    root.append(view.el)
    view.draw()
    expect(view.done?.()).toMatch(/Nothing queued/)
    const cells = () => Array.from(view.el.querySelectorAll('.sim-ht-table:not(.old) .sim-ht-key')).map((c) => c.textContent)
    for (const step of spec.tour) {
      // The frame reads the part before it acts
      expect(view.describe(step.at), step.at).not.toBeNull()
      view.highlight(step.at)
      if (step.do) view.act?.(step.do)
      for (let i = 0; i < (step.do?.run ?? 0) && !view.done?.(); i++) view.step()
      view.draw()
    }
    // The tour ends on linear probing with the keys it left: 26 deleted, 48, 59 and 70 added
    expect(cells().sort()).toEqual(['136', '15', '20', '48', '59', '70', '8'])
    expect(view.el.querySelector<HTMLSelectElement>('.sim-select')?.value).toBe('linear')
    for (const part of ['bucket:0', 'key:15', 'load', 'probe', 'hash', 'collisions', 'strategy']) expect(view.describe(part), part).not.toBeNull()
    expect(view.describe('bucket:999')).toBeNull()
    expect(view.describe('key:26')).toBeNull()
    expect(view.describe('nonsense')).toBeNull()

    view.act?.({ insert: ['cat', 3], delete: 15, search: 'cat', limit: 0.5, strategy: 'chaining' })
    let n = 0
    while (!view.done?.() && n++ < 300) view.step()
    view.draw()
    expect(view.describe('key:cat')?.label).toContain('"cat"')
    expect(view.describe('key:15')).toBeNull()
    expect(view.el.querySelector<HTMLSelectElement>('.sim-select')?.value).toBe('chaining')

    // Typed keys: junk is refused in words, a key starts an operation
    const input = view.el.querySelector<HTMLInputElement>('.sim-ht-input')!
    const press = (name: string) => Array.from(view.el.querySelectorAll('button')).find((b) => b.textContent === name)!.click()
    const said = () => view.el.querySelector('.sim-ht-msg')?.textContent ?? ''
    input.value = ''
    press('Insert')
    view.draw()
    expect(said()).toMatch(/Type a key first/)
    input.value = '4.5'
    press('Insert')
    view.draw()
    expect(said()).toMatch(/not a whole number/)
    input.value = 'elephant'
    press('Insert')
    view.draw()
    expect(said()).toMatch(/up to 6 characters/)
    input.value = 'cat'
    press('Insert')
    view.draw()
    expect(said()).toMatch(/already in the table/)
    input.value = '777'
    press('Delete')
    view.draw()
    expect(said()).toMatch(/not in the table/)
    input.value = 'owl'
    press('Insert')
    while (!view.done?.()) view.step()
    view.draw()
    expect(cells()).toContain('owl')

    // Changing the strategy keeps the keys
    const before = cells().sort()
    for (const strategy of ['linear', 'quadratic', 'double', 'chaining']) {
      const select = view.el.querySelector<HTMLSelectElement>('.sim-select')!
      select.value = strategy
      select.dispatchEvent(new Event('change'))
      view.draw()
      expect(cells().sort()).toEqual(before)
    }
    view.reset()
    view.draw()
    expect(cells().sort()).toEqual(['136', '15', '20', '26', '8'])
    view.highlight(null)
    view.destroy?.()
  })
})
