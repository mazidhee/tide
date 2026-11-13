import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  animationGuide,
  beatProgress,
  beatsUsed,
  captionAt,
  captionsFrom,
  checkScene,
  cleanPalette,
  DEFAULT_PALETTE,
  extractScene,
  paletteFrom,
  parseAnimationBlock,
  planBeats,
  readingSeconds,
  renderError,
  renderKey,
  toHex,
  wavSeconds,
  type RenderInput
} from '../src/shared/manim'
import { buildTemplate, formulaOk, pyFormula, templatesFor, TEMPLATES } from '../src/shared/manimTemplates'
import { mathsRules } from '../src/shared/mathsMode'

const tmp = mkdtempSync(join(tmpdir(), 'tide-manim-test-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp, isPackaged: false }, protocol: { handle: () => {} } }))
const settings: Record<string, unknown> = { ai: {}, voice: { engine: 'natural', name: 'bm_george', speed: 1 } }
vi.mock('../src/main/settings', () => ({ getSettings: () => settings, updateSettings: (p: Record<string, unknown>) => Object.assign(settings, p) }))
const store = new Map<string, string>()
vi.mock('../src/main/vault', () => ({
  readText: async (p: string) => {
    if (!store.has(p)) throw new Error('none')
    return store.get(p)!
  },
  writeText: async (p: string, s: string) => void store.set(p, s)
}))

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** A PCM WAV of silence, `secs` long */
function wav(secs: number, rate = 24000): Uint8Array {
  const n = Math.round(secs * rate) * 2
  const b = new Uint8Array(44 + n)
  const dv = new DataView(b.buffer)
  const put = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)))
  put(0, 'RIFF')
  dv.setUint32(4, 36 + n, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, rate, true)
  dv.setUint32(28, rate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  put(36, 'data')
  dv.setUint32(40, n, true)
  return b
}

describe('templates', () => {
  it('every template builds with its own settings, with a narration line per beat', () => {
    expect(TEMPLATES.length).toBe(12)
    for (const t of TEMPLATES) {
      const r = buildTemplate(t.id, {})
      expect(r.ok, t.id).toBe(true)
      if (!r.ok) continue
      expect(r.scene.code).toMatch(/^from tide_manim import \*/)
      expect(r.scene.code).toMatch(/class TideAnim\(TideScene\):\n {4}def construct\(self\):/)
      // Some templates number their beats in a loop, so the literal ones are a lower bound
      expect(r.scene.beats.length, t.id).toBeGreaterThanOrEqual(beatsUsed(r.scene.code))
      // Templates are trusted (their formulas go through a restricted eval); Claude's scenes are checked
      if (!r.scene.code.includes('fx(')) expect(checkScene(r.scene.code), t.id).toBeNull()
    }
  })

  it('adapts to the learner’s example and checks each setting', () => {
    const z = buildTemplate('place-value', { number: 2047 })
    expect(z.ok && z.scene.beats.join(' ')).toMatch(/2047 reads as 247/)
    expect(buildTemplate('place-value', { number: 247 })).toMatchObject({ ok: false, why: expect.stringMatching(/0 digit/) })
    expect(buildTemplate('linear-map', { matrix: [[1, 2]] })).toMatchObject({ ok: false, why: expect.stringMatching(/2×2/) })
    expect(buildTemplate('linear-map', { matrix: [[9, 0], [0, 1]] })).toMatchObject({ ok: false, why: expect.stringMatching(/between/) })
    const lm = buildTemplate('linear-map', { matrix: [[2, 0], [0, 3]], vector: [1, 1] })
    expect(lm.ok && lm.scene.beats[4]).toMatch(/\(2, 3\).*became 6/)
    expect(buildTemplate('secant-limit', { f: 'import os' })).toMatchObject({ ok: false })
    expect(buildTemplate('riemann', { a: 3, b: 1 })).toMatchObject({ ok: false, why: expect.stringMatching(/greater than a/) })
    expect(buildTemplate('attention', { words: ['a', 'b'], focus: 4 })).toMatchObject({ ok: false })
    expect(buildTemplate('nope', {})).toMatchObject({ ok: false, why: expect.stringMatching(/Templates: place-value/) })
    expect(buildTemplate('clt', { bogus: 1 })).toMatchObject({ ok: false, why: expect.stringMatching(/not settings of clt: bogus/) })
  })

  it('takes the tutor’s narration only when it has a line for every beat', () => {
    const own = buildTemplate('eigen', {})
    const n = own.ok ? own.scene.beats.length : 0
    const mine = buildTemplate('eigen', {}, Array.from({ length: n }, (_, i) => `line ${i}`))
    expect(mine.ok && mine.scene.beats[0]).toBe('line 0')
    const short = buildTemplate('eigen', {}, ['just one'])
    expect(short.ok && short.scene.beats[0]).not.toBe('just one')
  })

  it('reads formulas as Python, and refuses anything else', () => {
    expect(pyFormula('x^2 + 3y^2')).toBe('x**2 + 3*y**2')
    expect(pyFormula('2x(x+1)')).toBe('2*x*(x+1)')
    expect(formulaOk('sin(x)/x', 'x')).toBe(true)
    expect(formulaOk('__import__("os")', 'x')).toBe(false)
    expect(formulaOk('x*y', 'x')).toBe(false)
    expect(formulaOk('x*y', 'xy')).toBe(true)
  })

  it('finds the templates that fit a topic', () => {
    expect(templatesFor('The invention of zero').map((t) => t.id)).toContain('place-value')
    expect(templatesFor('Eigenvectors and eigenvalues')[0].id).toBe('eigen')
    expect(templatesFor('Backpropagation and the chain rule').map((t) => t.id)).toContain('backprop')
    expect(templatesFor('Compound interest').map((t) => t.id)).toContain('compounding')
  })
})

describe('the lesson block, colours and the cache key', () => {
  it('reads a template block or a scene block', () => {
    expect(parseAnimationBlock('{"template":"clt","params":{"n":10}}')).toMatchObject({ ok: true, block: { template: 'clt', params: { n: 10 } } })
    expect(parseAnimationBlock('{"scene":"mabc1234","title":"Mine"}')).toMatchObject({ ok: true, block: { scene: 'mabc1234', title: 'Mine' } })
    expect(parseAnimationBlock('{"template":"nope"}').ok).toBe(false)
    expect(parseAnimationBlock('{"scene":"../../etc"}').ok).toBe(false)
    expect(parseAnimationBlock('{"templ').ok).toBe(false)
  })

  it('draws in the theme’s colours, never Manim’s blue on black in a light theme', () => {
    expect(toHex('rgb(212, 98, 42)')).toBe('#d4622a')
    expect(toHex('rgba(0, 0, 0, 0.5)', '#ffffff')).toBe('#808080')
    expect(toHex('#abc')).toBe('#aabbcc')
    const light = paletteFrom({ scheme: 'light', tokens: { bg: 'rgb(250, 249, 246)', ink: 'rgb(20, 20, 20)', accent: 'rgb(79, 124, 255)' } })
    expect(light).toMatchObject({ scheme: 'light', bg: '#faf9f6', ink: '#141414', accent: '#4f7cff' })
    const dark = paletteFrom({ scheme: 'dark', tokens: {} })
    expect(dark.scheme).toBe('dark')
    expect(dark.bg).not.toBe(DEFAULT_PALETTE.bg)
    expect(cleanPalette({ bg: 'red', accent: '#123456' })).toMatchObject({ bg: DEFAULT_PALETTE.bg, accent: '#123456' })
  })

  it('keys a render by everything that changes the video', () => {
    const base: RenderInput = { code: 'x', beats: ['a'], palette: DEFAULT_PALETTE, quality: 'low', tex: false, voice: '' }
    const k = renderKey(base)
    expect(k).toMatch(/^m[a-z0-9]{6,}$/)
    expect(renderKey({ ...base })).toBe(k)
    for (const change of [{ code: 'y' }, { beats: ['b'] }, { palette: { ...DEFAULT_PALETTE, accent: '#000000' } }, { quality: 'medium' as const }, { tex: true }, { voice: 'kokoro:bm_george' }]) expect(renderKey({ ...base, ...change })).not.toBe(k)
  })
})

describe('narration timing and captions', () => {
  it('measures speech, and falls back to reading time', () => {
    expect(wavSeconds(wav(2.5))).toBeCloseTo(2.5, 2)
    expect(wavSeconds(new Uint8Array(10))).toBeNull()
    expect(readingSeconds('one two')).toBe(2)
    expect(readingSeconds(Array(27).fill('w').join(' '))).toBeCloseTo(10, 1)
    expect(planBeats(['a b', 'c d e'], [3.2, null])).toEqual([
      { text: 'a b', dur: 3.2 },
      { text: 'c d e', dur: 2 }
    ])
  })

  it('captions follow the beats as the scene logged them', () => {
    const caps = captionsFrom(
      [
        { i: 1, start: 4, end: 9 },
        { i: 0, start: 0, end: 4 },
        { i: 7, start: 9, end: 10 }
      ],
      ['first', 'second']
    )
    expect(caps).toEqual([
      { start: 0, end: 4, text: 'first' },
      { start: 4, end: 9, text: 'second' }
    ])
    expect(captionAt(caps, 4.5)?.text).toBe('second')
    expect(captionAt(caps, 12)).toBeNull()
    expect(beatProgress('TIDE_BEAT 3/5')).toEqual({ done: 3, total: 5 })
  })
})

describe('Claude’s own scenes', () => {
  const good = 'from tide_manim import *\n\nclass TideAnim(TideScene):\n    def construct(self):\n        self.beat(0, Create(Circle(color=ACCENT)))\n        with self.during(1):\n            self.play(FadeIn(Words("hi")))\n'
  it('are checked before they run', () => {
    expect(checkScene(good)).toBeNull()
    expect(beatsUsed(good)).toBe(2)
    expect(checkScene(good.replace('from tide_manim import *', 'from manim import *'))).toMatch(/tide_manim/)
    expect(checkScene(good + 'import os\n')).toMatch(/not os/)
    expect(checkScene(good + '        open("/etc/passwd")\n')).toMatch(/files/)
    expect(checkScene(good.replace(/self\.beat\(0[^\n]*\n/, '').replace(/with self\.during\(1\):\n[^\n]*\n/, '        self.play(Create(Circle()))\n'))).toMatch(/beat/)
  })

  it('come back from Claude as one python block', () => {
    expect(extractScene('Here:\n```python\n' + good + '```\n')).toBe(good)
    expect(extractScene('no code')).toBeNull()
  })

  it('a failed render gives the error and the line in the scene', () => {
    const out = `╭──── Traceback (most recent call last) ────╮
│ /x/manim/cli/render/commands.py:124 in render │
│ /work/scene.py:9 in construct                 │
│ ❱  9 │   self.beat(0, Creat(c))              │
╰────────────────────────────────────────────╯
NameError: name 'Creat' is not defined`
    const e = renderError(out)
    expect(e).toMatch(/scene\.py:9/)
    expect(e).toMatch(/NameError: name 'Creat' is not defined$/)
  })
})

describe('the tutor’s instructions', () => {
  it('Claude is told when to animate and about its tools; Gemma only about templates that fit', () => {
    const claude = mathsRules('claude', 'The invention of zero')
    expect(claude).toMatch(/render_animation/)
    expect(claude).toMatch(/watch, then break it/)
    expect(claude).toMatch(/place-value/)
    const gemma = mathsRules('gemma', 'Eigenvectors and eigenvalues')
    expect(gemma).toMatch(/```animation|language is animation/)
    expect(gemma).toMatch(/eigen/)
    expect(gemma).not.toMatch(/render_animation|animation_library|code \+ narration/)
    expect(animationGuide('gemma', 'Poetry')).toBe('')
  })
})

// ---------- The pipeline in main, with the sandbox, Claude and the voice swapped out ----------

describe('rendering, caching and repair', async () => {
  const m = await import('../src/main/manim')
  const anims = join(tmp, 'animations')
  m.setAnimRoot(anims)
  let renders: string[] = []
  let failFirst = 0
  let alwaysFail = false
  const fakeRenderer = async () => ({
    python: '/x/python',
    tex: null,
    sandboxed: async (_cmd: string[], o: { cwd: string; env: Record<string, string>; onLine(l: string): void }) => {
      const code = await fs.readFile(join(o.cwd, 'scene.py'), 'utf8')
      renders.push(code)
      if (alwaysFail || (failFirst > 0 && failFirst-- > 0)) return { code: 1, out: "Traceback\n  File \"/w/scene.py\", line 5, in construct\nNameError: name 'Creat' is not defined", timedOut: false, tooBig: false }
      const beats = JSON.parse(await fs.readFile(o.env.TIDE_BEATS, 'utf8')) as { dur: number }[]
      let t = 0
      const log = beats.map((b, i) => {
        const e = { i, start: t, end: t + b.dur + 0.35 }
        t = e.end
        o.onLine(`TIDE_BEAT ${i + 1}/${beats.length}`)
        return e
      })
      await fs.writeFile(o.env.TIDE_BEAT_LOG, JSON.stringify(log))
      const dir = join(o.cwd, 'media', 'videos', 'scene', '480p15')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, 'out.mp4'), 'video')
      return { code: 0, out: '', timedOut: false, tooBig: false }
    }
  })
  const spoken: string[] = []
  beforeEach(() => {
    renders = []
    failFirst = 0
    alwaysFail = false
    spoken.length = 0
    m.deps.status = async () => ({ ready: true, detail: 'Manim (test)' })
    m.deps.hasTex = () => false
    m.deps.renderer = fakeRenderer as never
    m.deps.narrator = { voice: async () => 'kokoro:bm_george', speak: async (t: string) => (spoken.push(t), wav(1.5)) }
    m.deps.repair = async () => null
  })

  it('renders once, then plays from the cache by content hash', async () => {
    const block = '{"template":"place-value","params":{"number":205}}'
    const first = await m.requestAnimation({ block, lesson: 'lesson-1', palette: DEFAULT_PALETTE })
    expect(['queued', 'rendering']).toContain(first.state)
    const done = await m.settled(first.key)
    expect(done.state).toBe('ready')
    expect(done.video).toBe(`tide-anim://v/${first.key}.mp4`)
    expect(done.narrated).toBe(true)
    expect(done.captions?.length).toBe(6)
    // Each beat is as long as its narration (1.5 s of speech) plus the pause after it
    expect(done.captions![1].start).toBeCloseTo(1.85, 2)
    expect(renders.length).toBe(1)
    expect(spoken.length).toBe(6)
    const again = await m.requestAnimation({ block, lesson: 'lesson-2', palette: DEFAULT_PALETTE })
    expect(again).toMatchObject({ state: 'ready', key: first.key })
    expect(renders.length).toBe(1)
    expect(await m.lessonAnimations('lesson-2')).toEqual([first.key])
    // A different theme is a different video
    const dark = await m.requestAnimation({ block, palette: { ...DEFAULT_PALETTE, scheme: 'dark', bg: '#111111' } })
    expect(dark.key).not.toBe(first.key)
    await m.settled(dark.key)
    expect(renders.length).toBe(2)
  })

  it('is silent with captions when narration is off or there is no voice', async () => {
    m.deps.narrator = { voice: async () => '', speak: async () => wav(1) }
    const s = await m.requestAnimation({ block: '{"template":"eigen","params":{}}', palette: DEFAULT_PALETTE })
    const done = await m.settled(s.key)
    expect(done.narrated).toBe(false)
    expect(done.captions?.[0].end).toBeCloseTo(readingSeconds(done.captions![0].text) + 0.35, 2)
  })

  it('without Manim, says so and hands back the narration as text', async () => {
    m.deps.status = async () => ({ ready: false, detail: 'Not installed' })
    const s = await m.requestAnimation({ block: '{"template":"clt","params":{"n":10}}' })
    expect(s.state).toBe('unavailable')
    expect(s.captions?.map((c) => c.text).join(' ')).toMatch(/take 10 draws/i)
    expect(renders.length).toBe(0)
    expect(await m.prerenderFor('Central limit theorem', 'prep-1')).toEqual([])
  })

  const scene = (body: string) => `from tide_manim import *\n\nclass TideAnim(TideScene):\n    def construct(self):\n${body}`
  const broken = scene('        self.beat(0, Creat(Circle()))\n')
  const fixed = scene('        self.beat(0, Create(Circle(color=ACCENT)))\n')

  it('Claude repairs its own scene from the error, and the block keeps working', async () => {
    failFirst = 1
    const asked: string[] = []
    m.deps.repair = async (_code, error) => (asked.push(error), fixed)
    const reg = await m.registerScene(broken, ['A circle appears.'], 'A circle', 'circles')
    expect('key' in reg).toBe(true)
    const key = (reg as { key: string }).key
    const s = await m.requestAnimation({ block: JSON.stringify({ scene: key }), palette: DEFAULT_PALETTE })
    const done = await m.settled(s.key)
    expect(done.state).toBe('ready')
    expect(asked[0]).toMatch(/NameError: name 'Creat'/)
    expect(renders).toEqual([broken, fixed])
    // Watched: it joins the library, repaired
    expect(await m.animationUsed(s.key)).toBe(true)
    const kept = JSON.parse(store.get('.tide/animations.json')!) as { code: string }[]
    expect(kept[0].code).toBe(fixed)
    expect(await m.animationLibraryTool.run({ query: 'circle' }, {} as never)).toMatch(new RegExp(key))
  })

  it('gives up after two repairs', async () => {
    alwaysFail = true
    let tries = 0
    m.deps.repair = async () => (tries++, scene(`        self.beat(0, Wait(${tries}))\n`))
    const reg = (await m.registerScene(scene('        self.beat(0, Nope())\n'), ['x'], 'Bad', 'x')) as { key: string }
    const s = await m.requestAnimation({ block: JSON.stringify({ scene: reg.key }), palette: DEFAULT_PALETTE })
    const done = await m.settled(s.key)
    expect(done.state).toBe('failed')
    expect(tries).toBe(2)
    expect(renders.length).toBe(3)
    expect(done.error).toMatch(/NameError/)
  })

  it('never sends a template back to Claude', async () => {
    alwaysFail = true
    let asked = 0
    m.deps.repair = async () => (asked++, null)
    const s = await m.requestAnimation({ block: '{"template":"fourier","params":{"terms":4}}', palette: DEFAULT_PALETTE })
    expect((await m.settled(s.key)).state).toBe('failed')
    expect(asked).toBe(0)
    expect(renders.length).toBe(1)
  })

  it('render_animation checks what Claude asks for and returns the block to paste', async () => {
    const ctx = { step: () => 's1', updateStep: () => {}, chatId: 'chat-1' } as never
    expect(await m.renderAnimationTool.run({ template: 'place-value', params: { number: 33 } }, ctx)).toMatch(/Not rendered: number: it needs a 0 digit/)
    expect(await m.renderAnimationTool.run({ code: broken, narration: ['one', 'two'] }, ctx)).toMatch(/1 beat/)
    const out = await m.renderAnimationTool.run({ template: 'place-value', params: { number: 1040 }, title: 'Zero' }, ctx)
    expect(out).toMatch(/```animation\n\{"template":"place-value","params":\{"number":1040\},"title":"Zero"\}\n```/)
  })

  it('prep renders the next lesson’s animations ahead', async () => {
    const opening = 'Let us start.\n\n```animation\n{"template":"place-value","params":{"number":405}}\n```\n'
    const keys = await m.prerenderFor('The invention of zero and place value', 'prep-9', opening)
    expect(keys.length).toBeGreaterThanOrEqual(1)
    expect(await m.lessonAnimations('prep-9')).toEqual(keys)
    expect(renders.some((r) => /405/.test(r))).toBe(true)
  })
})

describe('installing', async () => {
  const m = await import('../src/main/manim')
  const fake = (o: { python?: boolean; cc?: boolean; free?: number; fail?: string }) => {
    const ran: string[] = []
    const made = new Set<string>()
    return {
      ran,
      d: {
        root: join(tmp, 'tools'),
        exists: (p: string) => made.has(p) || (o.python !== false && p === '/opt/homebrew/bin/python3.12'),
        freeBytes: async () => o.free ?? 50e9,
        download: async (url: string, dest: string) => {
          ran.push(`download ${url.split('/').pop()}`)
          await fs.mkdir(join(dest, '..'), { recursive: true })
        },
        run: async (cmd: string, args: string[]) => {
          const line = `${cmd.split('/').pop()} ${args.join(' ')}`
          ran.push(line)
          if (cmd.endsWith('xcrun')) return { code: o.cc === false ? 1 : 0, out: '', err: '' }
          if (args[1] === 'venv') made.add(join(args[2], 'bin', 'python'))
          if (args[0] === '-c' && args[1] === 'import cairo') return { code: 1, out: '', err: 'no cairo' }
          if (cmd.endsWith('tar')) {
            await fs.mkdir(join(args[3], 'pycairo-1.29.2'), { recursive: true })
            return { code: 0, out: '', err: '' }
          }
          if (o.fail && line.includes(o.fail)) return { code: 1, out: '', err: 'ERROR: Could not connect: Max retries exceeded' }
          return { code: 0, out: '0.22.1', err: '' }
        }
      }
    }
  }

  it('builds cairo, then installs Manim, step by step', async () => {
    const { d, ran } = fake({})
    const steps: string[] = []
    const r = await m.installManim(d, (s) => steps.push(s))
    expect(r).toEqual({ ready: true, detail: 'Manim 0.22.1' })
    const order = ['venv', 'download pycairo', 'tar', '-Cinstall-args=--skip-subprojects', 'manim==0.22.1', 'compileall', 'import manim, cairo']
    let at = -1
    for (const o of order) {
      const i = ran.findIndex((l, j) => j > at && l.includes(o))
      expect(i, o).toBeGreaterThan(at)
      at = i
    }
    expect(existsSync(join(d.root, 'manim', 'build', 'pycairo-1.29.2', 'subprojects', 'cairo.wrap'))).toBe(false)
    expect(steps.some((s) => /Building cairo/.test(s))).toBe(true)
  })

  it('says what is missing, plainly', async () => {
    expect((await m.installManim(fake({ python: false }).d)).detail).toMatch(/Python 3\.11 to 3\.14/)
    expect((await m.installManim(fake({ cc: false }).d)).detail).toMatch(/xcode-select --install/)
    expect((await m.installManim(fake({ free: 1e8 }).d)).detail).toMatch(/Not enough free space/)
    expect((await m.installManim(fake({ fail: 'manim==' }).d)).detail).toMatch(/check the connection/)
  })
})

// ---------- A real render of every template, when Manim is installed in a scratch tools folder ----------

const tools = process.env.TIDE_TOOLS_DIR
const realManim = !!tools && existsSync(join(tools, 'manim', 'venv', 'bin', 'python'))

describe.skipIf(!realManim)('smoke render of each template (low quality, in the sandbox)', async () => {
  const m = await import('../src/main/manim')
  for (const t of TEMPLATES) {
    it(t.id, { timeout: 120_000 }, async () => {
      const r = buildTemplate(t.id, {})
      if (!r.ok) throw new Error(r.why)
      const work = join(tmp, 'smoke', t.id)
      const input: RenderInput = { code: r.scene.code, beats: r.scene.beats, palette: DEFAULT_PALETTE, quality: 'low', tex: !!m.texBin(), voice: '' }
      const out = await m.renderOnce(input, planBeats(r.scene.beats), await m.sandboxRenderer(), () => {}, work)
      expect(out.error ?? '').toBe('')
      expect(out.ok).toBe(true)
      expect((await fs.stat(out.video!)).size).toBeGreaterThan(10_000)
      expect(out.captions?.length).toBe(r.scene.beats.length)
    })
  }
})

describe('the video protocol', async () => {
  const m = await import('../src/main/manim')
  it('serves byte ranges so the player can seek', async () => {
    const f = join(tmp, 'v.mp4')
    await fs.writeFile(f, Buffer.from('0123456789'))
    const whole = await m.videoResponse(f, null)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    const part = await m.videoResponse(f, 'bytes=2-5')
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await part.text()).toBe('2345')
    expect(await (await m.videoResponse(f, 'bytes=7-')).text()).toBe('789')
    expect((await m.videoResponse(f, 'bytes=20-')).status).toBe(416)
  })
})
