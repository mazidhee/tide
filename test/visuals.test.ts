import { describe, expect, it } from 'vitest'
import {
  FRAME_BOOTSTRAP,
  VISUAL_CSP,
  VISUAL_GUIDE,
  askAboutPart,
  cleanRecord,
  describeState,
  extractVisual,
  frameDocument,
  frameResponse,
  frameUrl,
  fromBase64Url,
  isFrameHost,
  isVisualSource,
  looksComplete,
  parseFrameMessage,
  themeCss,
  toBase64Url,
  visualKey,
  visualNote,
  visualTitle,
  whatsHappening
} from '../src/shared/visuals'
import { CLAUDE_LESSON_SYSTEM, CLAUDE_TUTOR_SYSTEM, TUTOR_LESSON_SYSTEM, TUTOR_SYSTEM } from '../src/shared/tutorPrompt'
import { APP_CSP } from '../src/shared/appCsp'

const GOOD = `<title>Count</title><svg viewBox="0 0 10 10"></svg><script>visual.steps(['a', 'b'], () => {})</script>`

describe('visual blocks', () => {
  it('knows a visual by its fence', () => {
    expect(isVisualSource('visual')).toBe(true)
    expect(isVisualSource('Visual')).toBe(true)
    expect(isVisualSource('html')).toBe(false)
    expect(isVisualSource('sim')).toBe(false)
  })

  it('waits for a whole block: ends at a tag, scripts closed', () => {
    expect(looksComplete(GOOD)).toBe(true)
    expect(looksComplete('<svg></svg><script>visual.steps(')).toBe(false)
    expect(looksComplete('<svg></svg><script>let a = 1</script><script>')).toBe(false)
    expect(looksComplete('<p>')).toBe(false)
  })

  it('takes its title from <title> or a heading', () => {
    expect(visualTitle(GOOD)).toBe('Count')
    expect(visualTitle('<h2 class="x">A B-tree   split</h2>')).toBe('A B-tree split')
    expect(visualTitle('<svg></svg>')).toBe('')
  })

  it('keys a source the same way every time, and differently for any change', () => {
    expect(visualKey(GOOD)).toBe(visualKey(GOOD))
    expect(visualKey(GOOD)).not.toBe(visualKey(GOOD + ' '))
    expect(visualKey(GOOD)).toMatch(/^v[a-z0-9]{4,32}$/)
  })

  it('finds the visual in a reply', () => {
    expect(extractVisual(`Here:\n\`\`\`visual\n${GOOD}\n\`\`\`\nDone`)).toBe(GOOD)
    expect(extractVisual('no block')).toBeNull()
  })
})

describe('the frame', () => {
  it('serves only GET requests to a fresh v-host at the root, with strict headers', () => {
    const url = frameUrl('vabc1234', GOOD, null)
    const r = frameResponse(url)!
    expect(r.body).toContain(GOOD)
    expect(r.headers['content-security-policy']).toBe(VISUAL_CSP)
    expect(r.headers['x-dns-prefetch-control']).toBe('off')
    expect(r.headers['permissions-policy']).toMatch(/camera=\(\).*microphone=\(\)/)
    expect(frameResponse(url, 'POST')).toBeNull()
    expect(frameResponse(url.replace('vabc1234', 'evil.com'))).toBeNull()
    expect(frameResponse(url.replace('vabc1234/', 'vabc1234/other'))).toBeNull()
    expect(frameResponse('tide-visual://vabc1234/?c=%%%')).toBeNull()
    expect(frameResponse('https://vabc1234/?c=YQ')).toBeNull()
    expect(isFrameHost('vabc123')).toBe(true)
    expect(isFrameHost('v1')).toBe(false)
  })

  it('has no network at all, and nothing but inline scripts', () => {
    expect(VISUAL_CSP).toMatch(/default-src 'none'/)
    expect(VISUAL_CSP).toMatch(/connect-src 'none'/)
    expect(VISUAL_CSP).toMatch(/frame-src 'none'/)
    expect(VISUAL_CSP).toMatch(/form-action 'none'/)
    // Inline scripts, and Tide's own libraries served to the frame from tide-visual: (main/visualLibs), nothing else
    expect(VISUAL_CSP).toMatch(/script-src 'unsafe-inline' tide-visual:(;|$)/)
    expect(VISUAL_CSP).not.toMatch(/https?:|\*|'self'/)
    expect(VISUAL_CSP).toMatch(/img-src data: blob:/)
  })

  it('the app page lets visual frames in, and nothing new besides', () => {
    expect(APP_CSP).toMatch(/frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com tide-visual:;/)
    expect(APP_CSP).toMatch(/script-src 'self' 'wasm-unsafe-eval';/)
    // The only changes to the app's own policy: tide-visual: in frame-src, and tide-anim: (the maths animations' videos, main/manim) in media-src
    const before = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' vault: data: https:; font-src 'self' data:; connect-src 'self' vault:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; worker-src 'self' blob:; media-src 'self' vault: https:"
    expect(APP_CSP.replace(' tide-visual:', '').replace(' tide-anim:', '')).toBe(before)
  })

  it('runs the bootstrap before the visual, and passes theme tokens only when they are colours', () => {
    const doc = frameDocument(GOOD, { scheme: 'dark', tokens: { ink: 'rgb(230, 231, 233)', accent: 'red; } body { background: url(https://x)', bg: '#26292d' } })
    expect(doc.indexOf(FRAME_BOOTSTRAP)).toBeLessThan(doc.indexOf(GOOD))
    expect(doc).toContain('--ink: rgb(230, 231, 233);')
    expect(doc).toContain('--bg: #26292d;')
    expect(doc).not.toContain('url(https://x)')
    expect(doc).toContain('color-scheme: dark;')
    expect(themeCss(null)).toBe(':root { color-scheme: light; }')
  })

  it('carries any text through its URL intact', () => {
    const s = 'α → β, "quotes", </script> and emoji 🧠'
    expect(fromBase64Url(toBase64Url(s))).toBe(s)
    expect(toBase64Url(s)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('the bootstrap parses as a script', () => {
    expect(() => new Function(FRAME_BOOTSTRAP)).not.toThrow()
  })
})

describe('messages from a frame', () => {
  it('takes only the known shapes, with limits', () => {
    expect(parseFrameMessage({ tv: 1, t: 'beat' })).toEqual({ t: 'beat' })
    expect(parseFrameMessage({ tv: 1, t: 'ready', h: 210.4, drawn: true, steps: 3 })).toEqual({ t: 'ready', h: 210, drawn: true, steps: 3 })
    expect(parseFrameMessage({ tv: 1, t: 'size', h: 1e9 })).toEqual({ t: 'size', h: 100_000 })
    expect(parseFrameMessage({ tv: 1, t: 'steps', i: 9, n: 3, say: 'x', playing: 'yes' })).toEqual({ t: 'steps', i: 2, n: 3, say: 'x', playing: false })
    expect((parseFrameMessage({ tv: 1, t: 'report', text: 'x'.repeat(5000) }) as { text: string }).text).toHaveLength(400)
    expect(parseFrameMessage({ tv: 1, t: 'report', text: 'moved', data: { a: 1, b: 'two', c: { deep: 1 }, d: NaN, e: true } })).toEqual({ t: 'report', text: 'moved', data: { a: 1, b: 'two', e: true } })
  })

  it('refuses anything else', () => {
    for (const bad of [null, 'beat', [], { t: 'beat' }, { tv: 2, t: 'beat' }, { tv: 1, t: 'eval', code: 'x' }, { tv: 1, t: 'size' }, { tv: 1, t: 'select', label: '  ' }, { tv: 1, t: 'error', msg: 5 }, { tv: 1, t: 'steps', i: 0 }])
      expect(parseFrameMessage(bad)).toBeNull()
  })
})

describe('what the tutor hears', () => {
  const s = { title: 'Resize', step: { i: 2, n: 7, say: 'Double to 8' }, report: { text: 'moved the slider', data: { load: 0.75 } }, selected: { label: 'bucket 3', data: { keys: '12 20' } } }
  it('describes the state with its numbers', () => {
    expect(describeState(s)).toBe('it is at step 3 of 7 ("Double to 8"); the visual reports: moved the slider (load = 0.75); the learner selected bucket 3 (keys = 12 20)')
    expect(visualNote(s)).toMatch(/^\(Tide: the learner has been using your visual "Resize": it is at step 3/)
    expect(visualNote({ title: 'x' })).toBe('')
  })
  it('asks about this state, and asks them to predict the next step', () => {
    expect(whatsHappening(s)).toMatch(/^What's happening here, in the visual "Resize"\?/)
    expect(whatsHappening(s)).toMatch(/predict what the next step will do, as an <ask>/)
    expect(askAboutPart(s)).toMatch(/^In the visual "Resize", what is bucket 3 \(keys = 12 20\)\?/)
  })
})

describe("Claude's instructions", () => {
  it('Claude is told how to write visuals, with examples', () => {
    for (const sys of [CLAUDE_TUTOR_SYSTEM, CLAUDE_LESSON_SYSTEM]) {
      expect(sys).toContain(VISUAL_GUIDE)
    }
    expect(VISUAL_GUIDE.match(/```visual/g)).toHaveLength(2)
    expect(VISUAL_GUIDE).toMatch(/visual\.steps/)
    expect(VISUAL_GUIDE).toMatch(/keyboard accessible/i)
  })

  it("Gemma's prompts never mention them: private notebooks keep to the fixed simulations and mermaid", () => {
    for (const sys of [TUTOR_SYSTEM, TUTOR_LESSON_SYSTEM]) {
      expect(sys).not.toContain('```visual')
      expect(sys).not.toMatch(/visual\.steps|custom visual/i)
    }
  })

  it('the examples are themselves good visuals: complete, titled, and parse', () => {
    const blocks = [...VISUAL_GUIDE.matchAll(/```visual\n([\s\S]*?)\n```/g)].map((m) => m[1])
    for (const b of blocks) {
      expect(looksComplete(b)).toBe(true)
      expect(visualTitle(b)).not.toBe('')
      const script = /<script>([\s\S]*?)<\/script>/.exec(b)![1]
      expect(() => new Function(script)).not.toThrow()
    }
  })
})

describe('kept records', () => {
  it('keeps known statuses and bounded fields only', () => {
    expect(cleanRecord({ status: 'ok', at: 5 })).toEqual({ status: 'ok', at: 5 })
    expect(cleanRecord({ status: 'fallback', fallback: '```mermaid\nA-->B\n```', errors: ['a', 3], at: 1 })).toEqual({ status: 'fallback', fallback: '```mermaid\nA-->B\n```', errors: ['a'], at: 1 })
    expect(cleanRecord({ status: 'run-this' })).toBeNull()
    expect(cleanRecord({ status: 'ok', code: 'x'.repeat(70_000), at: 1 })).toEqual({ status: 'ok', at: 1 })
  })
})
