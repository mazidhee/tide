// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { FRAME_BOOTSTRAP, VISUAL_CSP, describeState, frameResponse, parseFrameMessage, tellTutor, visualNote, frameUrl, VISUAL_GUIDE, VISUAL_REPAIR_SYSTEM } from '../src/shared/visuals'
import { calc } from '../src/renderer/src/lib/sims/plotExpr'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, protocol: { handle: () => {} } }))
const store = new Map<string, string>()
vi.mock('../src/main/vault', () => ({ readText: async (p: string) => { if (!store.has(p)) throw new Error('none'); return store.get(p)! }, writeText: async (p: string, s: string) => void store.set(p, s) }))

const TIDE_MATH = readFileSync(resolve('src/shared/frame/tideMath.js'), 'utf8')
type TM = { parse(e: string, v?: string[]): { ok: boolean; error?: string; f(s: number | Record<string, number>): number }; plane(el: Element, o: object): { fn(f: string): SVGPathElement; point(at: number[], o?: object): SVGCircleElement; X(x: number): number; Y(y: number): number }; predict(q: string, on: (v: string) => void, into?: Element): HTMLElement; goal(t: string): (met: boolean) => boolean; fmt(v: number, d?: number): string }

/** Runs the frame library in this window, with a visual host that records what it sends */
const sent: unknown[] = []
let loaded = false
function loadTideMath(): { tm: TM; sent: unknown[] } {
  const w = window as unknown as Record<string, unknown>
  sent.length = 0
  w.visual = { predict: (question: string, value: string) => sent.push({ t: 'predict', question, value }), goal: (text: string, met: boolean) => sent.push({ t: 'goal', text, met }) }
  // Once: like the frame, it defines TideMath for good
  if (!loaded) new Function(TIDE_MATH)()
  loaded = true
  return { tm: w.TideMath as TM, sent }
}

describe('the maths library in the visual frame', () => {
  it('is loaded by every frame, from Tide, and the frame may run it but nothing from the network', () => {
    const r = frameResponse(frameUrl('vabcdefgh', '<p>hi</p>', null))!
    expect(r.body).toContain('<script src="/lib/tide-math.js" crossorigin="anonymous"></script>')
    // The bootstrap runs first
    expect(r.body.indexOf(FRAME_BOOTSTRAP.slice(0, 40))).toBeLessThan(r.body.indexOf('/lib/tide-math.js'))
    expect(VISUAL_CSP).toMatch(/script-src 'unsafe-inline' tide-visual:/)
    expect(VISUAL_CSP).toMatch(/connect-src 'none'/)
    expect(VISUAL_CSP).not.toMatch(/https?:/)
  })

  it('is served at /lib/ to frame hosts only: Tide’s helpers, KaTeX with its fonts inside, three.js with OrbitControls', async () => {
    const { libraryFor } = await import('../src/main/visualLibs')
    const math = libraryFor('tide-visual://vabcdefgh/lib/tide-math.js')!
    expect(math.headers['content-type']).toMatch(/javascript/)
    expect(math.body).toBe(TIDE_MATH)
    expect(libraryFor('tide-visual://evil.com/lib/tide-math.js')).toBeNull()
    expect(libraryFor('tide-visual://vabcdefgh/lib/nope.js')).toBeNull()
    expect(libraryFor('tide-visual://vabcdefgh/lib/tide-math.js', 'POST')).toBeNull()
    const katex = libraryFor('tide-visual://vabcdefgh/lib/katex.js')!.body
    expect(katex).toContain('data:font/woff2;base64,')
    expect(katex).not.toContain('url(fonts/')
    const three = libraryFor('tide-visual://vabcdefgh/lib/three.js')!.body
    expect(three).not.toMatch(/^\s*(import|export)\s*\{/m)
    // It runs as a classic script and leaves THREE, with OrbitControls, on the window
    const w = window as unknown as Record<string, unknown>
    delete w.THREE
    new Function(three)()
    const T = w.THREE as Record<string, unknown>
    expect(typeof T.Vector3).toBe('function')
    expect(typeof T.WebGLRenderer).toBe('function')
    expect(typeof T.OrbitControls).toBe('function')
  }, 30000)

  it('reads expressions exactly as Tide’s own parser does, and never runs them', () => {
    const { tm } = loadTideMath()
    for (const e of ['x^2 - 3x + 2', '2sin(x)/x', '-x^2', '2^3^2', 'sqrt(abs(x)) + e^x', 'log10(x) + log2(x) + ln(x)', '3(x+1)(x-1)', 'pi x', 'exp(-x^2/2)']) {
      for (const x of [-2, 0.5, 3]) {
        const want = calc(e, x)
        const got = tm.parse(e).f(x)
        if (Number.isNaN(want)) expect(got, `${e} at ${x}`).toBeNaN()
        else expect(got, `${e} at ${x}`).toBeCloseTo(want, 12)
      }
    }
    expect(tm.parse('x*y', ['x', 'y']).f({ x: 2, y: 5 })).toBe(10)
    for (const bad of ['alert(1)', 'constructor', 'x;', 'window.x', '(x']) expect(tm.parse(bad).ok, bad).toBe(false)
    expect(tm.fmt(-0.5, 2)).toBe('−0.50')
  })

  it('draws a plane with curves and draggable points', () => {
    const { tm } = loadTideMath()
    document.body.innerHTML = '<div id="p"></div>'
    const p = tm.plane(document.getElementById('p')!, { x: [-2, 2], y: [-1, 4] })
    const path = p.fn('x^2')
    expect(path.getAttribute('d')).toMatch(/^M/)
    expect(p.X(-2)).toBeLessThan(p.X(2))
    expect(p.Y(4)).toBeLessThan(p.Y(-1))
    const dot = p.point([1, 1], { drag: true, onMove: () => {} })
    expect(dot.getAttribute('tabindex')).toBe('0')
    expect(document.querySelector('svg')).not.toBeNull()
  })
})

describe('the bridge: predict first, a goal, and "Tell the tutor"', () => {
  it('the helpers send the prediction and the goal through the host API', () => {
    const { tm, sent } = loadTideMath()
    document.body.innerHTML = ''
    let locked = ''
    const box = tm.predict('Where will the slope settle?', (v) => (locked = v))
    box.querySelector('input')!.value = '0.25'
    box.querySelector('button')!.click()
    expect(locked).toBe('0.25')
    const met = tm.goal('Goal: get within 0.01')
    met(false)
    met(true)
    met(true)
    expect(sent).toEqual([
      { t: 'predict', question: 'Where will the slope settle?', value: '0.25' },
      { t: 'goal', text: 'Goal: get within 0.01', met: false },
      { t: 'goal', text: 'Goal: get within 0.01', met: true }
    ])
  })

  it('the frame’s host API offers them, and Tide reads the messages strictly', () => {
    expect(FRAME_BOOTSTRAP).toMatch(/predict: function \(question, value\)/)
    expect(FRAME_BOOTSTRAP).toMatch(/goal: function \(text, met\)/)
    expect(parseFrameMessage({ tv: 1, t: 'predict', question: 'q', value: '3' })).toEqual({ t: 'predict', question: 'q', value: '3' })
    expect(parseFrameMessage({ tv: 1, t: 'predict', question: 'q', value: '  ' })).toBeNull()
    expect(parseFrameMessage({ tv: 1, t: 'goal', text: 'g', met: 'yes' })).toEqual({ t: 'goal', text: 'g', met: false })
    expect(parseFrameMessage({ tv: 1, t: 'goal', text: 'x'.repeat(500), met: true })).toMatchObject({ met: true })
  })

  it('what they found reaches the tutor: with the next message, and through "Tell the tutor"', () => {
    const s = { title: 'Taylor terms', report: { text: 'added 4 terms', data: { terms: 4, error: 0.0019 } }, predicted: { question: 'How many terms for 0.01?', value: '3' }, goal: { text: 'Error under 0.01', met: true } }
    expect(describeState(s)).toMatch(/terms = 4/)
    expect(describeState(s)).toMatch(/they predicted "3"/)
    expect(describeState(s)).toMatch(/is met/)
    expect(visualNote(s)).toMatch(/^\(Tide: the learner has been using your visual "Taylor terms"/)
    expect(tellTutor(s)).toMatch(/^From the visual "Taylor terms": .*error = 0.0019.*\. $/)
  })

  it('Claude is told the library is there, and a repair may keep using it', () => {
    expect(VISUAL_GUIDE).toMatch(/TideMath\.plane/)
    expect(VISUAL_GUIDE).toMatch(/TideMath\.predict/)
    expect(VISUAL_REPAIR_SYSTEM).toMatch(/TideMath .* are available/)
  })
})

describe('the library of explorables made on the fly', () => {
  const code = `<title>Taylor series, term by term</title><div id="p"></div><script>const p = TideMath.plane('#p', {x:[-3,3], y:[-2,2]}); TideMath.slider('Terms', {min:1,max:8,value:1}, n => visual.report('terms ' + n, {terms: n}))</script>`
  it('keeps working maths explorables, counts reuse, and finds them by topic', async () => {
    const { keepExplorable, findExplorables, isExplorable, explorableLibraryTool } = await import('../src/main/explorables')
    expect(isExplorable(code, 'Taylor series')).toBe(true)
    expect(isExplorable('<svg></svg>', 'Taylor series')).toBe(false)
    expect(isExplorable(code, 'The French Revolution')).toBe(false)
    expect(await keepExplorable(code, 'Taylor series')).toBe(true)
    expect(await keepExplorable(code, 'Taylor series')).toBe(true)
    const found = await findExplorables('taylor series of sin')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ title: 'Taylor series, term by term', uses: 2 })
    expect(await findExplorables('markov chain')).toEqual([])
    const out = String(await explorableLibraryTool.run({ id: found[0].id }, {} as never))
    expect(out).toContain('```visual\n<title>Taylor series')
  })
})
