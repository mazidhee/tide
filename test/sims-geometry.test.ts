// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { angleAt, det, eigen, lerpMatrix, measure, parseGeometryPart, polygonArea, readFigure, type GeometrySpec } from '../src/renderer/src/lib/sims/geometry'
import { load, mount } from '../src/renderer/src/lib/sims/runtime'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('geometry: the spec and its arithmetic', () => {
  it('reads points, figures in words, and which points move', () => {
    const spec = parseSim('{"kind":"geometry","points":{"A":[0,0],"B":[4,0],"C":{"x":1,"y":3},"bad":[1,1],"D":[1]},"draw":["triangle A B C","angle B A C","circle A r=2","segment A Z","dance A B"],"move":["C","Q"]}') as GeometrySpec
    expect(spec.mode).toBe('construction')
    expect(Object.keys(spec.points)).toEqual(['A', 'B', 'C'])
    expect(spec.figures.map((f) => f.type)).toEqual(['polygon', 'angle', 'circle'])
    expect(spec.movable).toEqual(['C'])
    expect(spec.window[0]).toBeLessThan(0)
    // Nothing given: a triangle to drag
    const plain = parseSim('{"kind":"geometry"}') as GeometrySpec
    expect(plain.figures).toEqual([{ type: 'polygon', points: ['A', 'B', 'C'] }])
    expect(plain.movable).toEqual(['A', 'B', 'C'])
    expect(readFigure('vector A', { A: [1, 2] })).toEqual({ type: 'vector', a: null, b: 'A' })
  })

  it('a matrix makes it a linear map; entries are clamped and either shape is read', () => {
    const spec = parseSim('{"kind":"matrix","matrix":[2,1,0,99],"vectors":{"v":[1,2]}}') as GeometrySpec
    expect(spec.mode).toBe('transform')
    expect(spec.matrix).toEqual([[2, 1], [0, 5]])
    expect(spec.window).toEqual([-4, 4])
  })

  it('measures lengths, angles, areas and the angle sum', () => {
    const p = { A: [0, 0], B: [4, 0], C: [0, 3] } as Record<string, [number, number]>
    expect(measure({ type: 'segment', a: 'B', b: 'C' }, p)).toEqual({ length: 5 })
    expect(angleAt(p.B, p.A, p.C)).toBeCloseTo(90, 9)
    expect(polygonArea([p.A, p.B, p.C])).toBe(6)
    expect(measure({ type: 'polygon', points: ['A', 'B', 'C'] }, p)).toEqual({ area: 6, perimeter: 12, 'angle sum': 180 })
    expect(measure({ type: 'circle', centre: 'A', through: 'B', radius: 1 }, p).radius).toBe(4)
    expect(measure({ type: 'line', a: 'A', b: 'B' }, p)).toEqual({ slope: 0, 'y-intercept': 0 })
  })

  it('finds real eigenvectors, says when there are none, and morphs from the identity', () => {
    const shear = eigen([[1, 1], [0, 1]])
    expect(shear).toHaveLength(1)
    expect(shear[0].value).toBe(1)
    expect(shear[0].vector).toEqual([1, 0])
    const stretch = eigen([[2, 0], [0, 3]])
    expect(stretch.map((e) => e.value).sort()).toEqual([2, 3])
    expect(eigen([[0, -1], [1, 0]])).toEqual([])
    const sym = eigen([[2, 1], [1, 2]])
    for (const e of sym) {
      const [x, y] = e.vector
      expect(2 * x + y).toBeCloseTo(e.value * x, 9)
      expect(x + 2 * y).toBeCloseTo(e.value * y, 9)
    }
    expect(det([[2, 1], [1, 2]])).toBe(3)
    expect(lerpMatrix([[3, 2], [0, 1]], 0.5)).toEqual([[2, 1], [0, 1]])
  })

  it('names parts however they are spelled', () => {
    const spec = parseSim('{"kind":"geometry","draw":["polygon A B C","segment A B","angle B A C"]}') as GeometrySpec
    expect(parseGeometryPart('polygon:CAB', spec, spec.points)?.type).toBe('figure')
    expect(parseGeometryPart('segment:BA', spec, spec.points)?.type).toBe('figure')
    expect(parseGeometryPart('angle:CAB', spec, spec.points)?.type).toBe('figure')
    expect(parseGeometryPart('angle:ABC', spec, spec.points)).toBeNull()
    expect(parseGeometryPart('point:A', spec, spec.points)?.type).toBe('point')
    expect(parseGeometryPart('det', spec, spec.points)).toBeNull()
  })
})

describe('geometry: mounted', () => {
  it('draws with Mafs, lists measurements, follows a tour and a moved point', async () => {
    await load('geometry')
    const spec = parseSim('{"kind":"geometry","points":{"A":[0,0],"B":[4,0],"C":[0,3]},"draw":["polygon A B C","angle B A C"],"tour":[{"at":"polygon:ABC","say":"x","do":{"move":["C",0,4]}}]}') as GeometrySpec
    const sim = mount(spec, (root) => document.body.append(root))
    await settle()
    expect(sim.root.querySelector('.MafsView')).not.toBeNull()
    expect(Array.from(sim.root.querySelectorAll('.sim-ge-row .sim-ge-label'), (e) => e.textContent)).toEqual(['triangle ABC', 'angle BAC (at A)', 'point A', 'point B', 'point C'])
    sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    sim.destroy()
    sim.root.remove()
  })

  it('a linear map shows its determinant and eigenvalues, and takes a new matrix', async () => {
    const { geometryKind } = await import('../src/renderer/src/lib/sims/kinds/geometry')
    const spec = parseSim('{"kind":"geometry","matrix":[[2,0],[0,3]],"vectors":{"v":[1,1]}}') as GeometrySpec
    const root = document.createElement('figure')
    document.body.append(root)
    const view = geometryKind.create(spec, { root, reducedMotion: true, palette: () => ({}) as never, select() {}, peek() {}, invalidate() {} })
    root.append(view.el)
    view.draw()
    expect(view.describe('det')?.values).toEqual({ det: 6 })
    expect(view.describe('vector:v')?.values).toMatchObject({ Av: '(2, 3)' })
    view.act?.({ matrix: [[0, -1], [1, 0]] })
    view.draw()
    expect(view.describe('eigen')?.label).toMatch(/none are real/)
    expect(root.querySelector('.sim-pl-says')?.textContent).toMatch(/No direction stays put/)
    view.act?.({ t: 0 })
    expect(view.describe('det')?.values).toEqual({ det: 1 })
    view.destroy?.()
    await settle()
  })
})
