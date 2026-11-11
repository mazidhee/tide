// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { samples } from '../design/prototype/sims/samples/cpu'
import { cpuKind } from '../src/renderer/src/lib/sims/kinds/cpu'
import { mount, parseSim } from '../src/renderer/src/lib/sims/runtime'
import type { CpuSpec } from '../src/renderer/src/lib/sims/cpu'
import type { SimHost } from '../src/renderer/src/lib/sims/shell'

const host = (): SimHost => ({ root: document.createElement('div'), palette: () => ({}) as ReturnType<SimHost['palette']>, select: () => undefined, peek: () => undefined, invalidate: () => undefined, reducedMotion: false })
const sample = (key: string) => parseSim(samples.find((s) => s[0] === key)![2]) as CpuSpec
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

describe('cpu: mounted', () => {
  it('mounts every sample, steps, resets and destroys without an exception', () => {
    for (const [, , json] of samples) {
      const spec = parseSim(json)!
      expect(spec.kind).toBe('cpu')
      const sim = mount(spec, (root) => document.body.append(root))
      for (let i = 0; i < 12; i++) key(sim.root, 's')
      key(sim.root, 'r')
      Array.from(sim.root.querySelectorAll<HTMLButtonElement>('.sim-tour-nav button')).find((b) => b.textContent === 'Next')?.click()
      sim.destroy()
      sim.root.remove()
    }
  })

  it('runs the default program one phase per step and halts', () => {
    const view = cpuKind.create(sample('cpu'), host())
    view.draw()
    expect(view.done!()).toBeNull()
    expect(view.el.querySelector('.sim-cpu-say')!.textContent).toMatch(/^Ready/)
    view.step()
    view.draw()
    expect(view.el.querySelector('.sim-cpu-say')!.textContent).toMatch(/^Fetch: IR ← memory\[0\]/)
    expect(view.el.querySelectorAll('.sim-cpu-row.changed')).toHaveLength(2)
    expect(view.el.querySelectorAll('.sim-cpu-cell.read')).toHaveLength(2)
    let steps = 1
    while (!view.done!() && steps < 1000) {
      view.step()
      steps++
    }
    view.draw()
    expect(steps).toBe(72)
    expect(view.done!()).toBe('Halted after 24 instructions')
    expect(view.describe('memory:total')!.values.decimal).toBe(15)
    expect(view.el.querySelectorAll('.sim-cpu-cell')[19].textContent).toBe('190F')
    view.reset()
    view.draw()
    expect(view.done!()).toBeNull()
    expect(view.describe('memory:total')!.values.decimal).toBe(0)
  })

  it('describes and highlights every part named in the tour sample', () => {
    const spec = sample('cpu-tour')
    const view = cpuKind.create(spec, host())
    view.draw()
    for (const step of spec.tour) {
      expect(view.describe(step.at), step.at).not.toBeNull()
      view.highlight(step.at)
      expect(view.el.querySelectorAll('.sim-hl')).toHaveLength(1)
      for (let i = 0; i < (step.do?.run ?? 0); i++) view.step()
      view.draw()
    }
    expect(view.done!()).toBe('Halted after 5 instructions')
    expect(view.describe('flag:v')!.label).toContain('overflow flag V (1')
    expect(view.describe('memory:result')!.values.decimal).toBe(-128)
    for (const part of ['pc', 'ir', 'phase', 'program', 'memory', 'flags', 'register:1', 'r3', 'flag:z', 'memory:0', 'line:3']) {
      expect(view.describe(part), part).not.toBeNull()
      view.highlight(part)
    }
    view.highlight(null)
    expect(view.el.querySelectorAll('.sim-hl')).toHaveLength(0)
    expect(view.describe('line:99')).toBeNull()
  })

  it('shows assembly errors and runs nothing until the program assembles', () => {
    const view = cpuKind.create(sample('cpu-error'), host())
    view.draw()
    const errors = Array.from(view.el.querySelectorAll('.sim-cpu-errors li')).map((li) => li.textContent)
    expect(errors).toHaveLength(5)
    expect(errors[0]).toBe('Line 1: The value 300 does not fit in 8 bits; expected −128 to 255.')
    expect(view.done!()).toBe('Not assembled: fix line 1 and assemble again')
    view.step()
    expect(view.describe('pc')).toBeNull()
    // The learner fixes it
    const area = view.el.querySelector('textarea')!
    area.value = 'LOADI R0, 3\nHALT'
    Array.from(view.el.querySelectorAll('button')).find((b) => b.textContent === 'Assemble')!.click()
    view.draw()
    expect(view.done!()).toBeNull()
    expect(view.el.querySelector<HTMLElement>('.sim-cpu-editor')!.hidden).toBe(true)
    for (let i = 0; i < 6; i++) view.step()
    expect(view.done!()).toBe('Halted after 2 instructions')
    expect(view.describe('register:0')!.values.decimal).toBe(3)
    // A mistake while editing keeps the editor open and blocks running
    Array.from(view.el.querySelectorAll('button')).find((b) => b.textContent === 'Edit program')!.click()
    area.value = 'LOADI R9, 3'
    Array.from(view.el.querySelectorAll('button')).find((b) => b.textContent === 'Assemble')!.click()
    view.draw()
    expect(view.done!()).toMatch(/^Not assembled: fix line 1/)
    Array.from(view.el.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!.click()
    view.reset()
    view.draw()
    expect(view.done!()).toBeNull()
  })

  it('stops a loop without end', () => {
    const view = cpuKind.create(sample('cpu-runaway'), host())
    let steps = 0
    while (!view.done!() && steps < 10000) {
      view.step()
      steps++
    }
    expect(steps).toBe(120)
    expect(view.done!()).toBe('Stopped after 40 instructions without reaching HALT (the limit for one run)')
  })

  it('selects parts by click', () => {
    const picked: (string | null)[] = []
    const view = cpuKind.create(sample('cpu'), { ...host(), select: (p) => picked.push(p) })
    view.draw()
    view.el.querySelectorAll<HTMLElement>('.sim-cpu-cell')[18].click()
    view.el.querySelectorAll<HTMLElement>('.sim-cpu-flag')[0].click()
    view.el.querySelector<HTMLElement>('button.sim-cpu-line')!.click()
    view.draw()
    expect(picked).toEqual(['memory:18', 'flag:z', 'line:1'])
    expect(view.el.querySelector('.sim-cpu-inspect .sim-panel-title')!.textContent).toContain('Memory cell 18 (n) in full')
    expect(view.el.querySelector('.sim-cpu-sum')!.textContent).toBe('0000 0101 = 4 + 1 = 5')
  })
})
