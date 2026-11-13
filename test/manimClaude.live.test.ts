/**
 * Live: Claude writes two scenes and repairs a broken one, each rendered in the sandbox. Runs only
 * with TIDE_LIVE_CLAUDE=1 and Manim in TIDE_TOOLS_DIR (it uses the learner's Claude plan).
 *   TIDE_LIVE_CLAUDE=1 TIDE_TOOLS_DIR=<scratch>/tools npx vitest run test/manimClaude.live.test.ts
 */
import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beatsUsed, checkScene, DEFAULT_PALETTE, extractScene, planBeats, SCENE_SYSTEM, sceneRepairPrompt, sceneRequest } from '../src/shared/manim'

const tmp = mkdtempSync(join(tmpdir(), 'tide-manim-live-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp, isPackaged: false }, protocol: { handle: () => {} } }))

const tools = process.env.TIDE_TOOLS_DIR
const live = process.env.TIDE_LIVE_CLAUDE === '1' && !!tools && existsSync(join(tools, 'manim', 'venv', 'bin', 'python'))

function claude(prompt: string): { text: string; ms: number } {
  const t0 = Date.now()
  const out = execFileSync('claude', ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--system-prompt', SCENE_SYSTEM, prompt], { encoding: 'utf8', timeout: 240_000, maxBuffer: 10_000_000 })
  return { text: (JSON.parse(out) as { result: string }).result, ms: Date.now() - t0 }
}

const IDEAS = [
  {
    topic: 'The invention of zero',
    idea: 'Brahmagupta (628 CE) treating zero as a number with rules: a number line with a marked at 3, then 3 + 0 lands on 3, 3 − 3 lands on 0, and 3 × 0 collapses to 0, each as a jump on the line',
    beats: ['Brahmagupta, in 628, did something new: he treated zero as a number you can calculate with.', 'Adding zero changes nothing: from 3, a jump of length zero lands on 3.', 'Subtracting a number from itself lands exactly on zero.', 'And multiplying by zero collapses any jump to nothing: three jumps of length zero go nowhere.']
  },
  {
    topic: 'The chain rule',
    idea: 'the chain rule as linked rates: three number lines x, u = 2x, y = u², a small nudge dx on x stretched by 2 on u and by 2u on y, so dy/dx = 2u · 2',
    beats: ['Here are three linked quantities: x, then u equals two x, then y equals u squared.', 'Nudge x a little. u moves twice as far.', 'That change in u is stretched again, by two u, on the way to y.', 'So the rates multiply: dy by dx is dy by du times du by dx.']
  }
]

describe.skipIf(!live)('Claude writes and repairs scenes (live)', async () => {
  const m = await import('../src/main/manim')
  const results: string[] = []

  for (const [n, idea] of IDEAS.entries()) {
    it(`writes and renders: ${idea.topic}`, { timeout: 600_000 }, async () => {
      let r = claude(sceneRequest(idea.idea, idea.beats, idea.topic))
      let code = extractScene(r.text)
      expect(code).toBeTruthy()
      const log = [`${idea.topic}: written in ${(r.ms / 1000).toFixed(1)} s`]
      let out = null
      for (let attempt = 0; attempt <= 2; attempt++) {
        expect(checkScene(code!)).toBeNull()
        expect(beatsUsed(code!)).toBe(idea.beats.length)
        const t0 = Date.now()
        out = await m.renderOnce({ code: code!, beats: idea.beats, palette: DEFAULT_PALETTE, quality: 'medium', tex: !!m.texBin(), voice: '' }, planBeats(idea.beats), await m.sandboxRenderer(), () => {}, join(tmp, `idea${n}-${attempt}`))
        log.push(`render ${attempt}: ${out.ok ? 'ok' : 'failed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s${out.ok ? '' : ` (${out.error?.split('\n').pop()})`}`)
        if (out.ok) break
        r = claude(sceneRepairPrompt(code!, out.error ?? '', idea.beats.length))
        code = extractScene(r.text)
        log.push(`repaired in ${(r.ms / 1000).toFixed(1)} s`)
      }
      writeFileSync(join(tools!, '..', `claude-scene-${n}.py`), code!)
      results.push(log.join('; '))
      console.log(results[results.length - 1], out?.video)
      expect(out?.ok).toBe(true)
    })
  }

  it('repairs a broken scene from its error', { timeout: 600_000 }, async () => {
    const broken = `from tide_manim import *

class TideAnim(TideScene):
    def construct(self):
        line = NumberLine(x_range=[-1, 5, 1], length=10, color=MUTED)
        dot = Dot(line.n2p(3), color=ACCENT)
        self.beat(0, Create(line), FadeIn(dot))
        jump = CurvedArow(line.n2p(3), line.n2p(0), color=ACCENT)
        self.beat(1, Create(jump), dot.animate.move_to(line.n2p(0)))
`
    const beats = ['Start at three.', 'Take three away, and you land on zero.']
    const first = await m.renderOnce({ code: broken, beats, palette: DEFAULT_PALETTE, quality: 'low', tex: false, voice: '' }, planBeats(beats), await m.sandboxRenderer(), () => {}, join(tmp, 'broken-0'))
    expect(first.ok).toBe(false)
    expect(first.error).toMatch(/CurvedArow/)
    const r = claude(sceneRepairPrompt(broken, first.error!, beats.length))
    const fixed = extractScene(r.text)
    expect(fixed).toBeTruthy()
    expect(checkScene(fixed!)).toBeNull()
    const second = await m.renderOnce({ code: fixed!, beats, palette: DEFAULT_PALETTE, quality: 'low', tex: false, voice: '' }, planBeats(beats), await m.sandboxRenderer(), () => {}, join(tmp, 'broken-1'))
    console.log(`repair: error "${first.error?.split('\n').pop()}", fixed by Claude in ${(r.ms / 1000).toFixed(1)} s, rendered ${second.ok ? 'ok' : `failed: ${second.error}`}`)
    expect(second.ok).toBe(true)
  })
})
