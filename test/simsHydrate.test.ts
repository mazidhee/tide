// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { startSims } from '../src/renderer/src/lib/sims'
import { ASK_EVENT, askDetail, dispatchAsk } from '../src/renderer/src/lib/sims/parts'
import { SIM_GUIDE, SIM_LESSON_LINE } from '../src/shared/sims'
import { parseSim } from '../src/renderer/src/lib/sims/spec'
import { sessionInstructions } from '../src/shared/session'

const block = (source: string) => `<pre class="code-block" data-lang="sim"><button class="copy-code" type="button">Copy</button><code class="hljs">${source.replace(/</g, '&lt;')}</code></pre>`
const settle = () => new Promise((r) => setTimeout(r, 30))

describe('sim blocks in the page', () => {
  beforeEach(() => (document.body.innerHTML = ''))

  it('leaves half-written JSON and unknown kinds as the code block they were', async () => {
    document.body.innerHTML = block('{"kind":"neural-net","layers":[2,4,') + block('{"kind":"quantum-foam"}') + block('not json at all')
    const before = document.body.innerHTML
    startSims()
    await settle()
    expect(document.querySelectorAll('pre.code-block[data-lang="sim"]')).toHaveLength(3)
    expect(document.querySelector('.sim')).toBeNull()
    // Only a marker of what was tried is added; the code itself is untouched
    expect(Array.from(document.querySelectorAll('pre code'), (c) => c.textContent)).toEqual(['{"kind":"neural-net","layers":[2,4,', '{"kind":"quantum-foam"}', 'not json at all'])
    expect(document.body.innerHTML.replace(/ data-sim-tried="[^"]*"/g, '')).toBe(before)
  })

  it('puts "Ask about this" into a nearby box that asks for a question, and nowhere else', () => {
    document.body.innerHTML = `<div class="thread"><div class="msg"><figure class="sim"></figure></div><textarea placeholder="Type your answer"></textarea><textarea placeholder="Ask your tutor"></textarea></div>`
    startSims()
    const [answer, composer] = Array.from(document.querySelectorAll('textarea'))
    let typed = 0
    composer.addEventListener('input', () => typed++)
    const detail = askDetail('neural-net', 'edge:0:1:2', { label: 'the weight from input 1 to hidden neuron 2 (currently -0.83)', values: { weight: -0.83 } })
    const event = dispatchAsk(document.querySelector('.sim')!, detail)
    expect(event.type).toBe(ASK_EVENT)
    expect(event.defaultPrevented).toBe(true)
    expect(composer.value).toBe('In the simulation, explain the weight from input 1 to hidden neuron 2 (currently -0.83).')
    expect(answer.value).toBe('')
    expect(typed).toBeGreaterThan(0)

    document.body.innerHTML = `<div><figure class="sim"></figure><textarea placeholder="Type your answer"></textarea></div>`
    expect(dispatchAsk(document.querySelector('.sim')!, detail).defaultPrevented).toBe(false)
    expect(document.querySelector('textarea')!.value).toBe('')
  })
})

describe('what the tutor is told', () => {
  it('every example in the guide is a valid simulation, and every kind and part is named', () => {
    const examples = SIM_GUIDE.match(/\{"kind":[^\n]*?\}(?=[.\s])/g) ?? []
    expect(examples).toHaveLength(4)
    expect(examples.map((e) => parseSim(e)?.kind)).toEqual(['neural-net', 'attention', 'gradient-descent', 'softmax'])
    for (const part of ['neuron:1:2', 'edge:0:1:2', 'surface', 'loss', 'token:3', 'row:3', 'scores', 'weights', 'mix', 'point', 'gradient', 'path', 'minimum', 'logit:2', 'probabilities', 'temperature', '"tour"', '"run"', '"pause"', '"sample"'])
      expect(SIM_GUIDE).toContain(part)
    expect(SIM_GUIDE.split(/\s+/).length).toBeLessThan(330)
  })

  it('lessons are pointed at simulations in one line', () => {
    expect(sessionInstructions({ mode: 'teach', topic: 'Backpropagation' })).toContain(SIM_LESSON_LINE)
  })
})
