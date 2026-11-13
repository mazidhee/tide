// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { startSims } from '../src/renderer/src/lib/sims'
import { ASK_EVENT, askDetail, dispatchAsk } from '../src/renderer/src/lib/sims/parts'
import { FULL_SIM_GUIDE, SIM_GUIDE, SIM_KINDS, simGuide, simKindsFor, simLesson } from '../src/shared/sims'
import { TUTOR_LESSON_SYSTEM, TUTOR_SYSTEM, stableSystem } from '../src/shared/tutorPrompt'
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
    const examples = FULL_SIM_GUIDE.match(/\{"kind":[^\n]*?\}(?=[.\s])/g) ?? []
    expect(examples.map((e) => parseSim(e)?.kind)).toEqual([...SIM_KINDS])
    for (const part of ['neuron:1:2', 'edge:0:1:2', 'surface', 'loss', 'token:3', 'row:3', 'scores', 'weights', 'mix', 'point', 'gradient', 'path', 'minimum', 'logit:2', 'probabilities', 'temperature', '"tour"', '"run"', '"pause"', '"sample"'])
      expect(SIM_GUIDE).toContain(part)
    // Short enough to sit in every turn's system prompt
    expect(SIM_GUIDE.split(/\s+/).length).toBeLessThan(800)
  })

  it('every part and every "do" the guide names exists in its simulation', async () => {
    const { mount } = await import('../src/renderer/src/lib/sims/runtime')
    const { load } = await import('../src/renderer/src/lib/sims/runtime')
    const examples = FULL_SIM_GUIDE.match(/\{"kind":[^\n]*?\}(?=[.\s])/g) ?? []
    const partsText = FULL_SIM_GUIDE.slice(FULL_SIM_GUIDE.indexOf('Parts to point at:'), FULL_SIM_GUIDE.indexOf('Counting starts at 1'))
    for (const kind of SIM_KINDS) {
      const named = new RegExp(`${kind} ([^;.]*)[;.]`).exec(partsText)?.[1] ?? ''
      const parts = named.replace(/ \([^)]*\)/g, '').split(',').map((p) => p.trim()).filter(Boolean)
      expect(parts.length, kind).toBeGreaterThan(2)
      const line = FULL_SIM_GUIDE.split('\n').find((l) => l.trim().startsWith(`- ${kind},`)) ?? ''
      const verbs = (line.split(' do: ')[1] ?? '').match(/\{"[a-z]+":(\[\[.*?\]\]|\{.*?\}|[^{}]*?)\}/g) ?? []
      const spec = parseSim(JSON.stringify({ ...JSON.parse(examples[SIM_KINDS.indexOf(kind)]), tour: verbs.map((v) => ({ say: 'x', do: JSON.parse(v) })) }))!
      // The kind keeps every verb the guide teaches
      expect(spec.tour.map((s) => JSON.stringify(s.do)), kind).toEqual(verbs)
      const view = (await load(kind)).create(spec as never, { root: document.body, reducedMotion: true, palette: () => ({}) as never, select() {}, peek() {}, invalidate() {} })
      for (let i = 0; i < 400; i++) view.step()
      // Work that lands a moment later (real hashing) is waited for
      for (let i = 0; i < 100 && parts.some((part) => !view.describe(part)); i++) {
        await settle()
        view.step()
      }
      for (const part of parts) expect(view.describe(part), `${kind} ${part}`).not.toBeNull()
      view.destroy?.()
    }
    expect(mount).toBeTypeOf('function')
    // The chess search plays its 200 moves for real
  }, 30000)

  it('a block labelled json, or not labelled, is a simulation when its "kind" is one', async () => {
    const examples = FULL_SIM_GUIDE.match(/\{"kind":[^\n]*?\}(?=[.\s])/g) ?? []
    document.body.innerHTML = examples.map((e, i) => block(e).replace('data-lang="sim"', i % 2 ? 'data-lang="json"' : 'data-lang=""')).join('') + block('{"kind":"quantum-foam"}').replace('"sim"', '"json"') + block('{"type":"x","kind":"raft"}').replace('"sim"', '"json"')
    startSims()
    // The kinds built on a library load it first
    for (let i = 0; i < 40 && document.querySelectorAll('figure.sim').length < SIM_KINDS.length; i++) await new Promise((r) => setTimeout(r, 100))
    expect(Array.from(document.querySelectorAll('figure.sim'), (f) => (f as HTMLElement).dataset.kind)).toEqual([...SIM_KINDS])
    expect(document.querySelectorAll('pre.code-block')).toHaveLength(2)
  })

  it('a lesson is told how to write only the simulations its topic can use, and nothing when none fits', () => {
    expect(simKindsFor('Backpropagation and the chain rule')).toEqual(['neural-net'])
    expect(simKindsFor('Momentum in gradient descent')).toEqual(['gradient-descent'])
    expect(simKindsFor('Raft leader election')).toEqual(['raft'])
    expect(simKindsFor('Composite B-tree indexes')).toEqual(['b-tree'])
    for (const plain of ['Integer promotion in C', 'Consistent hashing', 'Window functions: running totals', 'Two-phase commit', 'Variance of sums of random variables']) expect(simKindsFor(plain), plain).toEqual([])

    const lesson = sessionInstructions({ mode: 'teach', topic: 'Backpropagation' })
    expect(lesson).toContain('A live simulation fits this topic (neural-net).')
    expect(lesson).toContain('- neural-net, a small network learning by backpropagation: {"kind":"neural-net"')
    expect(lesson).toContain('Parts to point at: neural-net input, layer:1, neuron:1:2 (layer, neuron), edge:0:1:2 (from layer, from neuron, to neuron), output, surface, loss. Counting starts at 1')
    expect(lesson).not.toMatch(/"kind":"(raft|b-tree|cpu|plot)"/)
    // The example it is given is still one the app can draw
    expect(parseSim(/\{"kind":"neural-net"[^\n]*?\}(?=[.\s])/.exec(lesson)![0])?.kind).toBe('neural-net')
    expect(sessionInstructions({ mode: 'teach', topic: 'Integer promotion in C' })).not.toMatch(/A live simulation fits|"kind":|sim block/)
    expect(simLesson('Two-phase commit')).toBe('')
  })

  it('the guide for every kind is the whole guide, and for a few is far shorter', () => {
    expect(simGuide(SIM_KINDS)).toBe(FULL_SIM_GUIDE)
    // The chat guide names the finance kinds in one line; a finance lesson gets them written out
    expect(SIM_GUIDE).toContain('- Finance (ledger, payments, stablecoin, risk)')
    expect(simLesson('Netting and RTGS settlement')).toContain('- payments, money between banks')
    const words = (t: string) => t.split(/\s+/).filter(Boolean).length
    expect(words(SIM_GUIDE)).toBeGreaterThan(550)
    expect(words(simLesson('Momentum in gradient descent'))).toBeLessThan(240)
    expect(SIM_GUIDE).toContain('whose language is sim (never json)')
  })

  it('a lesson\'s system prompt leaves out the guide and the tools a lesson cannot call; a chat keeps them', () => {
    const lesson = stableSystem(TUTOR_SYSTEM, { today: new Date(2026, 10, 11), web: true, session: true })
    const chat = stableSystem(TUTOR_SYSTEM, { today: new Date(2026, 10, 11), web: true })
    expect(chat).toContain(SIM_GUIDE)
    expect(lesson).not.toContain('"kind":')
    for (const tool of ['study_plan:', 'remember:', 'forget:', 'things_assign', 'metabase (only when connected)', 'delegate (only offered']) {
      expect(chat, tool).toContain(`- ${tool}`)
      expect(lesson, tool).not.toContain(`- ${tool}`)
    }
    // What a lesson can call, and how to teach, are all still there
    for (const kept of ['- search_notes / read_note', '- web_search / read_webpage', '- run_code:', '- run_sql:', '- find_image:', '- find_explainer:', 'Rules:', 'Teach visually too', 'Format rules (the app turns these tags into interactive UI'])
      expect(lesson, kept).toContain(kept)
    expect(TUTOR_LESSON_SYSTEM.split(/\s+/).length).toBeLessThan(700)
  })
})
