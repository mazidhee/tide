import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { FRAME_BOOTSTRAP, fitVisual, parseFrameMessage } from '../src/shared/visuals'

describe('fitVisual: a visual filling the screen', () => {
  it('zooms a fixed-height scene to the room height and widens it to the room shape', () => {
    const f = fitVisual({ w: 1460, h: 760 }, { w: 830, h: 514 })
    expect(f.zoom).toBeCloseTo(760 / 514, 2)
    expect(f.h).toBe(514)
    expect(f.w * f.zoom).toBeLessThanOrEqual(1460)
    expect(f.w * f.zoom).toBeGreaterThan(1455)
    expect(f.h * f.zoom).toBeLessThanOrEqual(760)
  })

  it('is limited by width when the room is narrow, and keeps the card width', () => {
    const f = fitVisual({ w: 1000, h: 2000 }, { w: 800, h: 400 })
    expect(f.zoom).toBe(1.25)
    expect(f.w).toBe(800)
  })

  it('never shrinks, and caps the zoom', () => {
    expect(fitVisual({ w: 600, h: 300 }, { w: 800, h: 900 }).zoom).toBe(1)
    expect(fitVisual({ w: 6000, h: 4000 }, { w: 800, h: 200 }).zoom).toBe(3)
  })
})

describe('F inside the frame', () => {
  it('is passed to Tide as a key message, and only that key', () => {
    expect(FRAME_BOOTSTRAP).toContain("send({ t: 'key', key: 'f' })")
    expect(parseFrameMessage({ tv: 1, t: 'key', key: 'f' })).toEqual({ t: 'key', key: 'f' })
    expect(parseFrameMessage({ tv: 1, t: 'key', key: 'q' })).toBeNull()
  })
})

describe('threeSharp: three.js renderers follow the frame’s pixel ratio', () => {
  it('scales a renderer’s ratio with the device ratio and redraws its last picture', () => {
    const src = readFileSync('src/shared/frame/threeSharp.js', 'utf8')
    const draws: unknown[] = []
    class Renderer {
      ratio = 1
      domElement = { isConnected: true }
      setPixelRatio(v: number) {
        this.ratio = v
      }
      getPixelRatio() {
        return this.ratio
      }
      render(s: unknown) {
        draws.push(s)
      }
    }
    const listeners: (() => void)[] = []
    const self = { THREE: { WebGLRenderer: Renderer }, devicePixelRatio: 2 } as { THREE: { WebGLRenderer: unknown }; devicePixelRatio: number }
    const matchMedia = () => ({ addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: () => undefined })
    new Function('self', 'matchMedia', src)(self, matchMedia)
    const R = self.THREE.WebGLRenderer as new () => Renderer
    const r = new R()
    expect(r).toBeInstanceOf(Renderer)
    r.setPixelRatio(Math.min(2, self.devicePixelRatio))
    r.render('scene')
    // Full screen zooms the frame: 2 → 3
    self.devicePixelRatio = 3
    listeners.shift()!()
    expect(r.getPixelRatio()).toBe(3)
    expect(draws).toEqual(['scene', 'scene'])
    // And back
    self.devicePixelRatio = 2
    listeners.shift()!()
    expect(r.getPixelRatio()).toBe(2)
  })
})
