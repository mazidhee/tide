// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { samples } from '../design/prototype/sims/samples/raft'
import { KINDS, mount, parseSim } from '../src/renderer/src/lib/sims/runtime'
import type { RaftSpec } from '../src/renderer/src/lib/sims/raft'
import type { SimHost } from '../src/renderer/src/lib/sims/shell'

function standalone(json: string) {
  const spec = parseSim(json) as RaftSpec
  const root = document.createElement('figure')
  root.tabIndex = 0
  document.body.append(root)
  const selected: (string | null)[] = []
  const host: SimHost = { root, palette: () => ({}) as ReturnType<SimHost['palette']>, select: (part) => void selected.push(part), peek: () => undefined, invalidate: () => undefined, reducedMotion: false }
  const view = KINDS.raft.create(spec, host)
  root.append(view.el)
  view.draw()
  const press = (name: string) => {
    const b = Array.from(view.el.querySelectorAll('button')).find((x) => x.textContent === name)
    if (!b) throw new Error(`no button "${name}"`)
    b.click()
    view.draw()
  }
  const run = (steps: number) => {
    for (let i = 0; i < steps; i++) view.step()
    view.draw()
  }
  const text = (selector: string) => view.el.querySelector(selector)?.textContent ?? ''
  return { spec, root, view, selected, press, run, text }
}

describe('raft: mounted', () => {
  it('mounts every sample, steps, walks its tour, resets and is destroyed without an exception', () => {
    expect(samples.map(([key]) => key).every((key) => key.startsWith('raft'))).toBe(true)
    expect(new Set(samples.map(([key]) => key)).size).toBe(samples.length)
    for (const [, , json] of samples) {
      const spec = parseSim(json)
      expect(spec?.kind).toBe('raft')
      const sim = mount(spec!, (root) => document.body.append(root))
      expect(sim.root.querySelectorAll('.sim-rf-node')).toHaveLength((spec as RaftSpec).nodes)
      const key = (k: string) => sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
      for (let i = 0; i < 60; i++) key('s')
      for (const b of Array.from(sim.root.querySelectorAll('button'))) if (b.textContent === 'Next') for (let i = 0; i < 8; i++) b.click()
      for (let i = 0; i < 20; i++) key('s')
      key('r')
      key('s')
      sim.destroy()
      sim.root.remove()
    }
  })

  it('follows its tour: every part named exists, every verb acts, and the picture ends as the words say', () => {
    const { spec, view, text } = standalone(samples.find(([key]) => key === 'raft-tour')![2])
    expect(spec.tour.length).toBeGreaterThan(4)
    const verbs = new Set<string>()
    for (const step of spec.tour) {
      expect(view.describe(step.at), step.at).not.toBeNull()
      view.highlight(step.at)
      if (step.do) {
        Object.keys(step.do).forEach((v) => verbs.add(v))
        view.act?.(step.do)
      }
      for (let i = 0; i < (step.do?.run ?? 0); i++) view.step()
      view.draw()
    }
    expect([...verbs].sort()).toEqual(['command', 'heal', 'isolate', 'run'])
    // After the heal: one leader in a higher term, the cut-off leader's entry gone, both commands committed everywhere
    expect(view.describe('leader')?.label).toMatch(/^the leader \(node \d, elected for term [2-9]/)
    expect(view.describe('leader')?.label).not.toContain('still believes')
    expect(view.describe('commit')?.label).toBe('the commit index (the highest is 2; nodes 1 to 5 have 2, 2, 2, 2, 2)')
    expect(Array.from(view.el.querySelectorAll('.sim-rf-cells')).map((row) => Array.from(row.querySelectorAll('.sim-rf-cmdtext')).map((c) => c.textContent))).toEqual(Array(5).fill(['x=1', 'y=2']))
    expect(view.el.querySelectorAll('.sim-rf-entry.committed')).toHaveLength(10)
    expect(text('.sim-rf-stat.sim-hl .sim-stat-label')).toBe('Leader')
    view.highlight(null)
    expect(view.el.querySelector('.sim-hl')).toBeNull()
  })

  it('acts on each tour verb, by number or by "leader", and says so', () => {
    const { view, text } = standalone('{"kind":"raft","seed":3}')
    const say = () => {
      view.draw()
      return text('.sim-rf-say')
    }
    // A command with no leader yet runs on until there is one
    view.act?.({ command: 'x=1' })
    expect(say()).toContain("The client's command x=1 goes to the leader")
    const leader = Number(/node (\d)/.exec(view.describe('leader')!.label)![1])
    const other = (leader % 5) + 1
    view.act?.({ stop: other })
    expect(say()).toContain(`Node ${other} stops`)
    expect(view.describe(`node:${other}`)?.label).toContain('stopped')
    view.act?.({ start: other })
    expect(say()).toContain(`Node ${other} starts again`)
    view.act?.({ partition: [[1, 2], [3, 4, 5]] })
    expect(say()).toContain('The network is cut: nodes 1, 2 | nodes 3, 4, 5')
    expect(view.el.querySelectorAll('.sim-rf-links line.cut')).toHaveLength(6)
    view.act?.({ heal: true })
    expect(say()).toContain('whole again')
    view.act?.({ partition: [1, 'leader'] })
    expect(view.describe('network')?.values.state).toBe('partitioned')
    view.act?.({ heal: true, isolate: 'leader' })
    expect(say()).toContain('The network is cut')
    expect(view.describe('network')?.values.sides).toBe([[leader], [1, 2, 3, 4, 5].filter((x) => x !== leader)].sort((a, b) => a[0] - b[0]).map((x) => x.join(' ')).join(' | '))
    view.act?.({ command: 'old=1', to: 'leader' })
    expect(say()).toContain('old=1')
    view.act?.({ heal: true, stop: 'leader' })
    expect(say()).toContain('stops while leader')
    view.act?.({ command: 'z=9', to: other })
    expect(say()).toMatch(/not a leader|No node is leader/)
    view.act?.({ stop: 9 })
    expect(say()).toContain('There is no node 9')
    view.act?.({ start: 'nobody', command: '' })
    for (let i = 0; i < 300; i++) view.step()
    view.draw()
    expect(view.describe('leader')?.values.leader).toMatch(/node \d/)
  })

  it('the learner selects a node, stops and starts it, cuts and heals the network and submits commands', () => {
    const { view, selected, press, run, text } = standalone('{"kind":"raft","nodes":5,"seed":2}')
    const input = view.el.querySelector<HTMLInputElement>('.sim-rf-cmd')!
    // No leader yet: said plainly, and the box keeps the command
    press('Submit')
    expect(text('.sim-rf-say')).toContain('No node is leader')
    expect(view.el.querySelector('.sim-rf-now')?.classList.contains('bad')).toBe(true)
    expect(input.value).toBe('x=1')
    press('Isolate the leader')
    expect(text('.sim-rf-say')).toContain('There is no leader to isolate')
    run(80)
    const leader = Number(/node (\d)/.exec(view.describe('leader')!.label)![1])
    press('Submit')
    expect(text('.sim-rf-say')).toContain(`goes to the leader, node ${leader}`)
    expect(input.value).toBe('x=2')
    input.value = '   '
    press('Submit')
    expect(text('.sim-rf-say')).toContain('The command is empty')
    expect(input.classList.contains('bad')).toBe(true)
    input.value = 'y=7'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    view.draw()
    expect(view.el.querySelectorAll('.sim-rf-cells')[leader - 1].querySelectorAll('.sim-rf-entry')).toHaveLength(2)
    run(60)
    expect(view.el.querySelectorAll('.sim-rf-entry.committed').length).toBe(10)

    // Click a node: it is selected for the readout and for Stop / Isolate
    const cards = Array.from(view.el.querySelectorAll('.sim-rf-node'))
    const target = (leader % 5) + 1
    cards[target - 1].querySelector<HTMLButtonElement>('.sim-rf-main')!.click()
    view.draw()
    expect(selected[selected.length - 1]).toBe(`node:${target}`)
    expect(cards[target - 1].classList.contains('sel')).toBe(true)
    expect(text('.sim-params .sim-label')).toBe(`Node ${target}, follower`)
    press('Stop')
    expect(cards[target - 1].classList.contains('down')).toBe(true)
    expect(cards[target - 1].querySelector('.sim-chip')?.textContent).toBe('Stopped')
    expect(text('.sim-params .sim-label')).toBe(`Node ${target}, stopped`)
    // A message to the stopped node is shown as dropped for a couple of steps
    for (let i = 0; i < 80 && !view.el.querySelector('.sim-rf-pill.dropped'); i++) run(1)
    expect(view.el.querySelector('.sim-rf-pill.dropped')?.textContent).toMatch(/^× /)
    expect(text('.sim-rf-say')).toContain(`node ${target} is stopped`)
    press('Start')
    expect(cards[target - 1].classList.contains('follower')).toBe(true)
    press('Isolate')
    expect(view.el.querySelectorAll('.sim-rf-links line.cut')).toHaveLength(4)
    expect(text('.sim-rf-stat.cut .sim-stat-value')).toContain('|')
    press('Heal')
    expect(view.el.querySelectorAll('.sim-rf-links line.cut')).toHaveLength(0)
    press('Split 2 | 3')
    expect(view.el.querySelectorAll('.sim-rf-links line.cut')).toHaveLength(6)
    press('Isolate the leader')
    expect(view.el.querySelectorAll('.sim-rf-links line.cut')).toHaveLength(4)

    // Other parts are buttons too
    cards[0].querySelector<HTMLButtonElement>('.sim-rf-timer')!.click()
    expect(selected[selected.length - 1]).toBe('timer:1')
    view.el.querySelector<HTMLButtonElement>('.sim-rf-name')!.click()
    expect(selected[selected.length - 1]).toBe('log:1')
    view.el.querySelector<HTMLButtonElement>('.sim-rf-entry')!.click()
    expect(selected[selected.length - 1]).toBe('entry:1:1')
    run(3)
    const pill = view.el.querySelector<HTMLButtonElement>('.sim-rf-pill:not(.dropped)')
    pill?.click()
    if (pill) expect(view.describe(selected[selected.length - 1]!)?.label).toMatch(/^the (RequestVote|reply|AppendEntries|heartbeat)/)
    Array.from(view.el.querySelectorAll<HTMLButtonElement>('.sim-rf-stat')).forEach((b) => b.click())
    expect(selected.slice(-5)).toEqual(['clock', 'term', 'leader', 'commit', 'network'])
    for (const part of ['node:1', 'log:2', 'timer:3', 'entry:1:1', 'leader', 'term', 'commit', 'messages', 'network', 'clock']) {
      expect(view.describe(part), part).not.toBeNull()
      view.highlight(part)
      expect(view.el.querySelector('.sim-hl'), part).not.toBeNull()
    }
    expect(view.describe('node:6')).toBeNull()
    expect(view.describe('entry:1:99')).toBeNull()

    // Reset goes back to the spec's start
    view.reset()
    view.draw()
    expect(view.el.querySelectorAll('.sim-rf-entry')).toHaveLength(0)
    expect(view.el.querySelectorAll('.sim-rf-pill')).toHaveLength(0)
    expect(text('.sim-rf-say')).toContain('Five nodes start as followers')
    expect(view.describe('clock')?.values['time ms']).toBe(0)
    expect(input.value).toBe('x=1')
  })

  it('stops playing only when every node is stopped, and each step changes what is shown', () => {
    const { view, text } = standalone('{"kind":"raft","nodes":3}')
    expect(view.el.querySelector('button')?.textContent).toBe('Stop')
    expect(Array.from(view.el.querySelectorAll('button')).some((b) => b.textContent?.startsWith('Split'))).toBe(false)
    expect(view.done?.()).toBeNull()
    expect(view.stepsPerSecond?.()).toBeGreaterThan(0)
    let before = ''
    for (let i = 0; i < 120; i++) {
      view.step()
      view.draw()
      const shown = `${text('.sim-rf-stats')}|${text('.sim-rf-say')}|${view.el.querySelectorAll('.sim-rf-pill').length}`
      expect(shown).not.toBe(before)
      before = shown
    }
    for (const id of [1, 2, 3]) view.act?.({ stop: id })
    for (let i = 0; i < 20 && !view.done?.(); i++) view.step()
    expect(view.done?.()).toContain('Every node is stopped')
    view.act?.({ start: 2 })
    expect(view.done?.()).toBeNull()
  })
})
