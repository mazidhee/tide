// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { samples } from '../design/prototype/sims/samples/blockchain'
import type { BlockchainSpec } from '../src/renderer/src/lib/sims/chain'
import { KINDS, mount, parseSim } from '../src/renderer/src/lib/sims/runtime'
import type { SimHost, SimView } from '../src/renderer/src/lib/sims/shell'

const host = (root: HTMLElement): SimHost => ({ root, reducedMotion: true, palette: () => ({ pos: [0, 0, 0], neg: [0, 0, 0], bg: [0, 0, 0], ink: [0, 0, 0], accent: [0, 0, 0], css: { pos: '', neg: '', bg: '', ink: '', soft: '', muted: '', accent: '', line: '', lineStrong: '' }, font: '' }), select() {}, peek() {}, invalidate() {} })
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
/** Waits (drawing as the frame would) until the picture says what is expected */
async function until(view: SimView, ok: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 600; i++) {
    view.draw()
    if (ok()) return
    await tick()
  }
  throw new Error(`never happened: ${what}`)
}

describe('blockchain: mounted', () => {
  it('every sample mounts in the frame, takes keys and is destroyed without complaint', async () => {
    for (const [key, , json] of samples.slice(0, 2)) {
      const spec = parseSim(json)
      expect(spec?.kind, key).toBe('blockchain')
      const sim = mount(spec!, (root) => document.body.append(root))
      expect(Array.from(sim.root.querySelectorAll('.sim-bar button'), (b) => b.textContent)).toEqual(['Play', 'Step', 'Reset'])
      for (const k of ['s', 's', 'r', 's']) sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
      await tick(20)
      sim.destroy()
      sim.root.remove()
    }
    await tick(20)
  })

  it('the view mines honestly, steps, acts on each verb, describes every part of the tour and resets', async () => {
    const spec = parseSim(samples[1][2]) as BlockchainSpec
    const root = document.createElement('figure')
    document.body.append(root)
    const view = KINDS.blockchain.create(spec, host(root))
    root.append(view.el)
    const cards = () => Array.from(root.querySelectorAll<HTMLElement>('.sim-bc-card:not(.ghost)'))
    const chips = () => cards().map((c) => c.querySelector('.sim-chip')?.textContent)
    const says = () => root.querySelector('.sim-bc-says')?.textContent ?? ''
    const stat = (label: string) => Array.from(root.querySelectorAll('.sim-stat')).find((s) => s.textContent?.startsWith(label))?.querySelector('.sim-stat-value')?.textContent

    // Before anything has been hashed it says so
    view.draw()
    expect(says()).toBe('Mining the starting blocks…')
    expect(root.querySelector('.sim-bc-card.ghost')?.textContent).toMatch(/^Block 1: mining…/)
    expect(view.describe('block:1')).toBeNull()
    expect(view.describe('tip')?.label).toBe('the tip of the chain (still being mined)')
    await until(view, () => cards().length === 4, 'starting blocks')
    expect(chips()).toEqual(['valid', 'valid', 'valid', 'valid'])
    expect(root.querySelector('.sim-bc-card.ghost')).toBeNull()
    expect(says()).toMatch(/^The chain is ready: 4 blocks/)
    expect(view.done?.()).toBeNull()

    // Step: a batch lands a moment later and the tries go up
    const tried = stat('Hashes tried')
    view.step()
    await until(view, () => stat('Hashes tried') !== tried, 'a step')
    expect(root.querySelectorAll('.sim-bc-miner .sim-bc-tried')[1].textContent).toMatch(/^nonces 0–7 → [0-9a-f]{12}… (misses|meets the target)$/)
    for (let i = 0; i < 3; i++) view.step()
    await tick(30)

    // The tour's verbs, in order
    for (const step of spec.tour) {
      if (step.do) view.act?.(step.do)
      const verb = Object.keys(step.do ?? {})[0]
      if (verb === 'tamper') await until(view, () => chips()[1] !== 'valid' || chips()[2] === 'broken link', 'tamper')
      if (verb === 'repair') await until(view, () => chips()[Number(step.do?.repair) - 1].startsWith('valid'), `repair ${step.do?.repair}`)
      if (verb === 'fork') await until(view, () => chips().filter((c) => c === 'competing').length === 2, 'fork')
      if (verb === 'mine') await until(view, () => chips().includes('orphaned'), 'longest chain')
      view.highlight(step.at)
      expect(view.describe(step.at), step.at).not.toBeNull()
      view.draw()
    }
    expect(chips().filter((c) => c === 'orphaned')).toHaveLength(1)
    expect(Number(stat('Spent re-mining')?.replace(/,/g, ''))).toBeGreaterThan(0)
    expect(stat('Orphaned blocks')).toBe('1')
    expect(says()).toContain('follow the valid chain with the most work')
    for (const part of ['block:1', 'hash:2', 'nonce:3', 'link:4', 'orphan:1', 'difficulty', 'tip', 'fork', 'miner:a', 'miner:b']) expect(view.describe(part), part).not.toBeNull()
    expect(view.describe('block:99')).toBeNull()
    expect(view.describe('orphan:2')).toBeNull()

    // Editing a block's data is tampering
    const input = cards()[0].querySelector('input')!
    input.value = 'Genesis, edited'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await until(view, () => chips()[1] === 'broken link', 'edit')
    expect(view.describe('block:1')?.label).toContain('data "Genesis, edited"')
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Mine again')?.click()
    await until(view, () => chips()[0] === 'valid again', 'mine again')
    expect(chips()[1]).toBe('broken link')

    view.act?.({ difficulty: 1 })
    await until(view, () => says().startsWith('Difficulty 1'), 'difficulty')
    expect(view.describe('difficulty')?.values.difficulty).toBe(1)

    view.reset()
    view.draw()
    expect(cards()).toHaveLength(0)
    await until(view, () => cards().length === 4, 'starting blocks again')
    expect(chips()).toEqual(['valid', 'valid', 'valid', 'valid'])
    expect(stat('Spent re-mining')).toBe('0')
    view.destroy?.()
    root.remove()
    await tick(20)
  })
})
