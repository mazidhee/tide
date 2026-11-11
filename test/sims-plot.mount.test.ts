// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { samples } from '../design/prototype/sims/samples/plot'
import { KINDS, mount, parseSim } from '../src/renderer/src/lib/sims/runtime'
import type { PlotSpec } from '../src/renderer/src/lib/sims/plotExpr'
import type { SimHost } from '../src/renderer/src/lib/sims/shell'

const host = (root: HTMLElement): SimHost => ({ root, reducedMotion: true, palette: () => ({ pos: [0, 0, 0], neg: [0, 0, 0], bg: [0, 0, 0], ink: [0, 0, 0], accent: [0, 0, 0], css: { pos: '', neg: '', bg: '', ink: '', soft: '', muted: '', accent: '', line: '', lineStrong: '' }, font: '' }), select() {}, peek() {}, invalidate() {} })

describe('plot: mounted', () => {
  it('every sample mounts in the frame, resets and is destroyed without complaint', () => {
    for (const [key, , json] of samples) {
      const spec = parseSim(json)
      expect(spec?.kind, key).toBe('plot')
      const sim = mount(spec!, (root) => document.body.append(root))
      expect(sim.root.querySelector('canvas')).not.toBeNull()
      // No clock: Reset only
      expect(Array.from(sim.root.querySelectorAll('.sim-bar button'), (b) => b.textContent)).toEqual(['Reset'])
      for (const b of Array.from(sim.root.querySelectorAll<HTMLButtonElement>('.sim-tour-nav button')).filter((b) => b.textContent === 'Next')) for (let i = 0; i < 6; i++) b.click()
      sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
      sim.destroy()
      sim.root.remove()
    }
  })

  it('the view steps, describes every part of the tour, acts on each verb and takes edits', () => {
    const spec = parseSim(samples[1][2]) as PlotSpec
    const root = document.createElement('figure')
    document.body.append(root)
    const view = KINDS.plot.create(spec, host(root))
    root.append(view.el)
    view.draw()
    for (let i = 0; i < 3; i++) view.step()
    for (const step of spec.tour) {
      expect(view.describe(step.at), step.at).not.toBeNull()
      view.highlight(step.at)
      if (step.do) view.act?.(step.do)
      view.draw()
    }
    for (const part of ['function:1', 'function:2', 'point', 'tangent', 'param:a', 'param:b', 'param:c', 'axes']) expect(view.describe(part), part).not.toBeNull()
    expect(view.describe('function:9')).toBeNull()
    expect(view.describe('param:z')).toBeNull()

    view.act?.({ set: { a: 1.5 }, x: 2, function: 1 })
    view.draw()
    expect(view.describe('point')?.values).toEqual({ x: 2, y: 1.5 * 4 - 2, slope: 6 })
    expect(view.describe('param:a')?.values.a).toBe(1.5)
    expect((root.querySelector('input[aria-label="Parameter a"]') as HTMLInputElement).value).toBe('1.5')
    view.act?.({ function: 2 })
    expect(view.describe('point')?.label).toMatch(/^the point on f₂/)
    view.act?.({ window: [-3, 3] })
    expect(view.describe('axes')?.values).toMatchObject({ xMin: -3, xMax: 3 })

    // Typing a broken expression says what is wrong beside it; the others still plot
    const input = root.querySelector<HTMLInputElement>('.sim-pl-expr')!
    input.value = 'a x^2 + (b'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    view.draw()
    expect(root.querySelector('.sim-pl-err')?.textContent).toBe('Cannot be read: Expected a closing bracket after b (character 11).')
    expect(view.describe('function:1')?.label).toMatch(/could not be read/)
    expect(view.describe('function:2')?.label).toMatch(/^the function f₂/)
    input.value = 'k x'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    view.draw()
    expect(root.querySelector('input[aria-label="Parameter k"]')).not.toBeNull()

    // Arrow keys on the picture move the point
    const canvas = root.querySelector('canvas')!
    view.act?.({ function: 1, x: 0 })
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    expect(Number(view.describe('point')?.values.x)).toBeGreaterThan(0)

    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Add a function')?.click()
    view.draw()
    expect(root.querySelectorAll('.sim-pl-fn')).toHaveLength(3)
    root.querySelector<HTMLButtonElement>('.sim-pl-remove')?.click()
    view.draw()
    expect(root.querySelectorAll('.sim-pl-fn')).toHaveLength(2)

    view.reset()
    view.draw()
    expect(root.querySelectorAll('.sim-pl-fn')).toHaveLength(2)
    expect(view.describe('point')?.values.x).toBe(1)
    expect(root.querySelector<HTMLInputElement>('.sim-pl-expr')!.value).toBe('a x^2 + b x + c')
    view.destroy?.()
    root.remove()
  })
})
