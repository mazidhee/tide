// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startLab } from '../src/renderer/src/lib/lab'
import { createKeeper, keep } from '../src/renderer/src/lib/liveBlocks'
import { startSims } from '../src/renderer/src/lib/sims'

const pre = (lang: string, source: string) => `<pre class="code-block" data-lang="${lang}"><button class="copy-code" type="button">Copy</button><code class="hljs">${source.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Long enough for the watchers to look for new blocks (they wait for the text to be still) */
const settle = async () => {
  await wait(650)
  // The simulations load on first use; wait for one that has been found to finish appearing
  for (let i = 0; i < 50 && document.querySelector('pre.code-block[data-lang="sim"]'); i++) await wait(100)
}
/** Long enough for a widget to be put back, far too short for a new one to be built */
const blink = () => wait(20)

const NET = '{"kind":"neural-net","layers":[2,3,1],"data":"xor","tour":[{"at":"loss","say":"The loss."},{"at":"loss","say":"Still the loss."},{"say":"Done."}]}'
const SOFTMAX = '{"kind":"softmax","logits":[2,1,0.1]}'

const message = () => document.querySelector<HTMLElement>('.prose')!
const click = (el: Element | null | undefined) => (el as HTMLElement).click()
const byText = (root: Element, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)

let queries: string[] = []

beforeAll(() => {
  ;(window as unknown as { tide: unknown }).tide = {
    lab: {
      query: async (_lab: string, sql: string) => {
        queries.push(sql)
        return { columns: ['n'], types: ['integer'], rows: [[queries.length]], rowCount: 1, truncated: false, elapsedMs: 1 }
      },
      reset: async () => undefined
    }
  }
  startSims()
  startLab()
})

beforeEach(() => {
  keep.ms = 4000
  queries = []
  document.body.innerHTML = '<div class="prose"></div>'
})

afterEach(() => vi.restoreAllMocks())

describe('the keeper', () => {
  const make = () => createKeeper({ widget: '.w', isSource: (p) => p.dataset.lang === 'x', sourceOf: (p) => p.textContent ?? '' })
  const mount = (k: ReturnType<typeof make>, p: HTMLElement) => {
    const slot = k.slot(p)
    const root = document.createElement('div')
    root.className = 'w'
    const destroy = vi.fn()
    p.replaceWith(root)
    k.keep(slot, root, destroy)
    return { root, destroy }
  }
  const x = (text: string) => `<pre class="code-block" data-lang="x">${text}</pre>`

  it('puts each widget back in its own place, even when two blocks are identical', () => {
    const k = make()
    message().innerHTML = `<p>one</p>${x('same')}<p>two</p>${x('same')}`
    const [a, b] = Array.from(message().querySelectorAll<HTMLElement>('pre')).map((p) => mount(k, p))
    message().innerHTML = `<p>one</p>${x('same')}<p>two</p>${x('same')}<p>three, still arriving</p>`
    k.reclaim()
    const now = Array.from(message().querySelectorAll('.w'))
    expect(now[0]).toBe(a.root)
    expect(now[1]).toBe(b.root)
    expect(message().querySelector('pre')).toBeNull()
    expect(k.size).toBe(2)
  })

  it('leaves a block whose text changed, or that sits in another message, to be built afresh', () => {
    const k = make()
    message().innerHTML = x('first') + x('second')
    const [a, b] = Array.from(message().querySelectorAll<HTMLElement>('pre')).map((p) => mount(k, p))
    message().innerHTML = x('first, edited') + x('second')
    k.reclaim()
    expect(message().firstElementChild!.tagName).toBe('PRE')
    expect(message().lastElementChild).toBe(b.root)
    expect(a.root.isConnected).toBe(false)

    // The same text at the same position of a different message is a different block
    document.body.innerHTML = `<div class="prose">${x('first, edited')}${x('second')}</div>`
    k.reclaim()
    expect(document.querySelector('.w')).toBeNull()
  })

  it('destroys a widget that has been out of the page too long, once, and forgets it', async () => {
    keep.ms = 60
    const k = make()
    message().innerHTML = x('gone soon') + x('stays')
    const [a, b] = Array.from(message().querySelectorAll<HTMLElement>('pre')).map((p) => mount(k, p))
    message().innerHTML = x('rewritten') + x('stays')
    k.reclaim()
    expect(a.destroy).not.toHaveBeenCalled()
    await wait(200)
    expect(a.destroy).toHaveBeenCalledTimes(1)
    expect(b.destroy).not.toHaveBeenCalled()
    expect(k.size).toBe(1)
    // Too late now: the block is built again rather than raised from the dead
    message().innerHTML = x('gone soon') + x('stays')
    k.reclaim()
    expect(message().firstElementChild!.tagName).toBe('PRE')
    expect(a.destroy).toHaveBeenCalledTimes(1)
  })

  it('a widget taken out and put back in time is never destroyed', async () => {
    keep.ms = 60
    const k = make()
    message().innerHTML = x('kept')
    const a = mount(k, message().querySelector('pre')!)
    for (let i = 0; i < 6; i++) {
      message().innerHTML = x('kept') + `<p>${'more '.repeat(i)}</p>`
      await wait(25)
      k.reclaim()
    }
    await wait(150)
    expect(a.destroy).not.toHaveBeenCalled()
    expect(message().firstElementChild).toBe(a.root)
  })
})

describe('simulations while the message is still being written', () => {
  it('keeps the same simulation, with its training and tour step, through repeated rewrites', async () => {
    message().innerHTML = `<p>Watch it learn.</p>${pre('sim', NET)}`
    await settle()
    const sim = message().querySelector<HTMLElement>('figure.sim')!
    expect(sim).not.toBeNull()
    click(byText(sim, 'Next'))
    for (let i = 0; i < 3; i++) click(byText(sim, 'Step'))
    const batches = () => Array.from(sim.querySelectorAll('.sim-stat')).find((s) => s.textContent?.startsWith('Batches'))?.querySelector('.sim-stat-value')?.textContent
    expect(sim.querySelector('.sim-tour-count')!.textContent).toBe('2 / 3')
    expect(batches()).toBe('3')

    for (let i = 1; i <= 5; i++) {
      message().innerHTML = `<p>Watch it learn.</p>${pre('sim', NET)}<p>${'And then more words arrive. '.repeat(i)}</p>`
      await blink()
      expect(message().querySelector('figure.sim')).toBe(sim)
      expect(message().querySelector('pre')).toBeNull()
    }
    expect(sim.querySelector('.sim-tour-count')!.textContent).toBe('2 / 3')
    expect(batches()).toBe('3')
    // And it still works where it stands
    click(byText(sim, 'Step'))
    expect(batches()).toBe('4')
    await settle()
    expect(message().querySelectorAll('figure.sim')).toHaveLength(1)
    expect(message().querySelector('figure.sim')).toBe(sim)
  })

  it('builds a changed simulation afresh and keeps the unchanged one beside it', async () => {
    message().innerHTML = pre('sim', NET) + pre('sim', SOFTMAX)
    await settle()
    const [net, soft] = Array.from(message().querySelectorAll<HTMLElement>('figure.sim'))
    expect(net.dataset.kind).toBe('neural-net')
    expect(soft.dataset.kind).toBe('softmax')

    message().innerHTML = pre('sim', NET.replace('[2,3,1]', '[2,4,1]')) + pre('sim', SOFTMAX)
    await blink()
    expect(message().children[0].tagName).toBe('PRE')
    expect(message().children[1]).toBe(soft)
    await settle()
    const rebuilt = message().children[0]
    expect(rebuilt.matches('figure.sim')).toBe(true)
    expect(rebuilt).not.toBe(net)
    expect(message().children[1]).toBe(soft)
  })

  it('destroys a simulation that is not put back: its frame is cancelled and its listeners removed', async () => {
    keep.ms = 80
    message().innerHTML = pre('sim', NET)
    await settle()
    const sim = message().querySelector('figure.sim')!
    const cancelled = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const removed = vi.spyOn(document, 'removeEventListener')
    message().innerHTML = '<p>The tutor thought better of it.</p>'
    await wait(40)
    expect(removed.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(false)
    await wait(400)
    expect(sim.isConnected).toBe(false)
    expect(cancelled).toHaveBeenCalled()
    expect(removed.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(true)
    // Dead for good: asking it to play no longer asks for a frame
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame')
    click(byText(sim, 'Play'))
    expect(frames).not.toHaveBeenCalled()
    // Its source coming back now gets a new simulation, not the dead one
    message().innerHTML = pre('sim', NET)
    await settle()
    expect(message().querySelector('figure.sim')).not.toBeNull()
    expect(message().querySelector('figure.sim')).not.toBe(sim)
  })
})

describe('lab queries and charts while the message is still being written', () => {
  const SQL = 'SELECT count(*) AS n FROM orders'
  const CHART = '{"sql":"SELECT country, count(*) AS n FROM customers GROUP BY 1","title":"Customers"}'

  it('keeps an edited query, its result and the chosen view', async () => {
    message().innerHTML = `<p>Try this.</p>${pre('sql', SQL)}`
    await settle()
    const block = message().querySelector<HTMLElement>('.lab-block')!
    const input = block.querySelector<HTMLTextAreaElement>('textarea.lab-sql')!
    expect(input.value).toBe(SQL)
    input.value = 'SELECT 42 AS n'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    click(block.querySelector('.lab-run'))
    await blink()
    expect(queries).toEqual(['SELECT 42 AS n'])
    expect(block.querySelector('.lab-table td')!.textContent).toBe('1')
    click(byText(block, 'Chart'))
    expect(byText(block, 'Chart')!.getAttribute('aria-pressed')).toBe('true')
    const result = block.querySelector('.lab-result')!.innerHTML

    for (let i = 1; i <= 5; i++) {
      message().innerHTML = `<p>Try this.</p>${pre('sql', SQL)}<p>${'Then change the filter. '.repeat(i)}</p>`
      await blink()
      expect(message().querySelector('.lab-block')).toBe(block)
      expect(message().querySelector('pre.code-block')).toBeNull()
    }
    await settle()
    expect(message().querySelectorAll('.lab-block')).toHaveLength(1)
    expect(block.querySelector<HTMLTextAreaElement>('textarea.lab-sql')!.value).toBe('SELECT 42 AS n')
    expect(block.querySelector('.lab-result')!.innerHTML).toBe(result)
    expect(byText(block, 'Chart')!.getAttribute('aria-pressed')).toBe('true')
    // Nothing was run again behind the learner's back
    expect(queries).toEqual(['SELECT 42 AS n'])
  })

  it('does not run a chart again when the text around it changes, and rebuilds it when its own text does', async () => {
    message().innerHTML = pre('chart', CHART) + pre('sql', SQL)
    await settle()
    const [chart, sql] = Array.from(message().querySelectorAll<HTMLElement>('.lab-block'))
    expect(chart.classList.contains('lab-chart-block')).toBe(true)
    expect(queries).toHaveLength(1)

    message().innerHTML = pre('chart', CHART) + pre('sql', SQL) + '<p>More.</p>'
    await settle()
    expect(Array.from(message().querySelectorAll('.lab-block'))).toEqual([chart, sql])
    expect(queries).toHaveLength(1)

    message().innerHTML = pre('chart', CHART.replace('Customers', 'Customers by country')) + pre('sql', SQL) + '<p>More.</p>'
    await settle()
    const now = Array.from(message().querySelectorAll('.lab-block'))
    expect(now[0]).not.toBe(chart)
    expect(now[0].querySelector('.lab-title')!.textContent).toBe('Customers by country')
    expect(now[1]).toBe(sql)
    expect(queries).toHaveLength(2)
  })

  it('lets go of a query that is not put back', async () => {
    keep.ms = 80
    message().innerHTML = pre('sql', SQL)
    await settle()
    const block = message().querySelector<HTMLElement>('.lab-block')!
    click(block.querySelector('.lab-run'))
    await blink()
    expect(block.querySelector('.lab-table')).not.toBeNull()
    message().innerHTML = '<p>Gone.</p>'
    await wait(400)
    expect(block.isConnected).toBe(false)
    expect(block.querySelector('.lab-result')!.childElementCount).toBe(0)
    message().innerHTML = pre('sql', SQL)
    await settle()
    expect(message().querySelector('.lab-block')).not.toBe(block)
    expect(message().querySelector('.lab-table')).toBeNull()
  })
})
