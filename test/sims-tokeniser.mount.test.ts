// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { samples } from '../design/prototype/sims/samples/tokeniser'
import type { TokeniserSpec } from '../src/renderer/src/lib/sims/bpe'
import { tokeniserKind } from '../src/renderer/src/lib/sims/kinds/tokeniser'
import { mount, parseSim } from '../src/renderer/src/lib/sims/runtime'
import type { SimHost } from '../src/renderer/src/lib/sims/shell'

const host = (): SimHost => ({ root: document.createElement('div'), palette: () => ({}) as ReturnType<SimHost['palette']>, select: () => undefined, peek: () => undefined, invalidate: () => undefined, reducedMotion: false })
const sample = (key: string) => parseSim(samples.find((s) => s[0] === key)![2]) as TokeniserSpec
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
const click = (el: Element, text: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text)!.click()
const texts = (el: Element, selector: string) => Array.from(el.querySelectorAll(selector)).map((x) => x.textContent)

describe('tokeniser: mounted', () => {
  it('mounts every sample, steps, walks the tour, resets and destroys without an exception', () => {
    for (const [, , json] of samples) {
      const spec = parseSim(json)!
      expect(spec.kind).toBe('tokeniser')
      const sim = mount(spec, (root) => document.body.append(root))
      for (let i = 0; i < 5; i++) key(sim.root, 's')
      for (let i = 0; i < spec.tour.length; i++) Array.from(sim.root.querySelectorAll<HTMLButtonElement>('.sim-tour-nav button')).find((b) => b.textContent === 'Next')?.click()
      key(sim.root, 'r')
      sim.destroy()
      sim.root.remove()
    }
  })

  it('learns the classic merges one per step and re-splits the sentence each time', () => {
    const view = tokeniserKind.create(sample('tokeniser'), host())
    view.draw()
    expect(view.el.querySelector('.sim-bpe-say')!.textContent).toMatch(/^Ready/)
    expect(texts(view.el, '.sim-bpe-piece .sim-bpe-tok').join(' ')).toBe('n e w e r _ l o w e s t _ w i d e r _')
    expect(view.el.querySelectorAll('.sim-bpe-flow .sim-bpe-tok')).toHaveLength(95)
    expect(view.el.querySelector('.sim-bpe-pair.on')!.textContent).toBe('1e+s9next')
    view.step()
    view.draw()
    expect(view.el.querySelector('.sim-bpe-say')!.textContent).toMatch(/^Merge 1: the most frequent pair is e \+ s \(9 times\)/)
    expect(view.el.querySelectorAll('.sim-bpe-flow .sim-bpe-tok')).toHaveLength(86)
    expect(view.el.querySelectorAll('.sim-bpe-flow .sim-bpe-tok.new')).toHaveLength(9)
    expect(texts(view.el, '.sim-bpe-merge')).toEqual(['1e+s→es×9'])
    let steps = 1
    while (!view.done!() && steps < 100) {
      view.step()
      steps++
    }
    view.draw()
    expect(steps).toBe(15)
    expect(view.done!()).toBe('Finished after 15 merges: every word is one token, so there are no pairs left')
    expect(texts(view.el, '.sim-bpe-piece .sim-bpe-tok').join(' ')).toBe('new e r _ low est_ wid e r _')
    expect(texts(view.el, '.sim-bpe-id').slice(0, 2)).toEqual(['18', '5'])
    expect(view.el.querySelectorAll('.sim-bpe-entry')).toHaveLength(27)
    view.reset()
    view.draw()
    expect(view.done!()).toBeNull()
    expect(view.el.querySelectorAll('.sim-bpe-merge')).toHaveLength(0)
  })

  it('describes and highlights every part named in the tour sample, and acts its verbs', () => {
    const spec = sample('tokeniser-tour')
    const view = tokeniserKind.create(spec, host())
    view.draw()
    for (const step of spec.tour) {
      if (step.do) view.act!(step.do)
      for (let i = 0; i < (step.do?.run ?? 0); i++) view.step()
      view.draw()
      expect(view.describe(step.at), step.at).not.toBeNull()
      view.highlight(step.at)
      expect(view.el.querySelectorAll('.sim-hl'), step.at).toHaveLength(1)
    }
    expect(view.el.querySelector<HTMLInputElement>('.sim-bpe-sentence-input')!.value).toBe('the cat sat on the mat.')
    expect(view.describe('sentence')!.label).toContain('"the cat sat on the mat."')
    for (const part of ['text', 'pairs', 'pair:2', 'merges', 'merge:6', 'vocabulary', 'sentence', 'token:1', 'length']) {
      expect(view.describe(part), part).not.toBeNull()
      view.highlight(part)
    }
    view.highlight(null)
    expect(view.el.querySelectorAll('.sim-hl')).toHaveLength(0)
    expect(view.describe('merge:99')).toBeNull()
    // A new training text through a tour verb starts learning again
    view.act!({ text: 'ab ab ab' })
    view.draw()
    expect(view.describe('text')!.values).toMatchObject({ words: 3, merges: 0 })
  })

  it('re-splits the sentence as the learner types, and marks characters it has never seen', () => {
    const view = tokeniserKind.create(sample('tokeniser'), host())
    for (let i = 0; i < 5; i++) view.step()
    const input = view.el.querySelector<HTMLInputElement>('.sim-bpe-sentence-input')!
    input.value = 'Low qi'
    input.dispatchEvent(new Event('input'))
    view.draw()
    expect(texts(view.el, '.sim-bpe-piece .sim-bpe-tok')).toEqual(['low', '_', 'q', 'i', '_'])
    expect(texts(view.el, '.sim-bpe-id')).toEqual(['16', '4', 'unk 0', '10', '4'])
    expect(view.el.querySelectorAll('.sim-bpe-piece.bad')).toHaveLength(1)
    expect(view.el.querySelector('.sim-bpe-unknown')!.textContent).toMatch(/^"q" never appeared in the training text/)
    expect(view.describe('token:3')!.label).toContain('never seen in training')
    input.value = ''
    input.dispatchEvent(new Event('input'))
    view.draw()
    expect(view.el.querySelectorAll('.sim-bpe-piece')).toHaveLength(0)
    expect(view.describe('token:1')).toBeNull()
  })

  it('lets the learner replace the training text, and refuses an empty one', () => {
    const view = tokeniserKind.create(sample('tokeniser'), host())
    view.step()
    view.draw()
    click(view.el, 'Edit training text')
    const area = view.el.querySelector('textarea')!
    area.value = '   '
    click(view.el, 'Learn from this text')
    view.draw()
    expect(view.el.querySelector('.sim-bpe-problem')!.textContent).toMatch(/nothing to learn from/)
    expect(view.describe('text')!.values.words).toBe(16)
    area.value = 'Banana bandana banana'
    click(view.el, 'Learn from this text')
    view.draw()
    expect(view.el.querySelector<HTMLElement>('.sim-bpe-editor')!.hidden).toBe(true)
    expect(view.describe('text')!.values).toMatchObject({ words: 3, merges: 0, tokens: 22 })
    view.step()
    view.draw()
    // a+n occurs 2 + 2 + 2 = 6 times, n+a 5: a+n is merged first
    expect(texts(view.el, '.sim-bpe-merge')).toEqual(['1a+n→an×6'])
    view.reset()
    view.draw()
    expect(view.describe('text')!.values).toMatchObject({ words: 3, merges: 0 })
  })

  it('starts with merges already learnt when asked, and copes with emoji', () => {
    const view = tokeniserKind.create(sample('tokeniser-odd'), host())
    view.draw()
    expect(view.el.querySelectorAll('.sim-bpe-merge')).toHaveLength(8)
    expect(view.el.querySelectorAll('.sim-bpe-piece.bad').length).toBeGreaterThan(0)
    while (!view.done!()) view.step()
    view.draw()
    expect(view.done!()).toMatch(/^Finished/)
  })

  it('selects parts by click', () => {
    const picked: (string | null)[] = []
    const view = tokeniserKind.create(sample('tokeniser'), { ...host(), select: (p) => picked.push(p) })
    view.step()
    view.draw()
    view.el.querySelectorAll<HTMLElement>('.sim-bpe-pair')[1].click()
    view.el.querySelector<HTMLElement>('.sim-bpe-merge')!.click()
    view.el.querySelectorAll<HTMLElement>('.sim-bpe-piece')[2].click()
    view.el.querySelector<HTMLElement>('.sim-bpe-flow')!.click()
    view.el.querySelector<HTMLElement>('.sim-bpe-vocab')!.click()
    view.el.querySelector<HTMLElement>('.sim-bpe-stats')!.click()
    expect(picked).toEqual(['pair:2', 'merge:1', 'token:3', 'text', 'vocabulary', 'length'])
  })
})
