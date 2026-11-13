// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { GRAPH_GUIDE, GRAPH_KINDS, normalizeExpr, parseGraph, tagsToBlocks, type Graph } from '../src/shared/graphSpec'
import { compileExpr, planeCorners, planeY, region, sample, slope, surfaceGrid } from '../src/renderer/src/lib/graphs/maths'
import { mountGraph } from '../src/renderer/src/lib/graphs/render'
import { buildScene } from '../src/renderer/src/lib/graphs/graphs3d'
import { drawable, startGraphs } from '../src/renderer/src/lib/graphs'
import * as THREE from 'three'

const ok = (src: string | Record<string, unknown>) => {
  const p = parseGraph(src)
  if (!p.ok) throw new Error(p.error)
  return p.graph
}

describe('graphs: reading the spec', () => {
  it('reads typed maths: implicit products, powers, "y =" and function names left whole', () => {
    expect(normalizeExpr('2x')).toBe('2*x')
    expect(normalizeExpr('y = 3(x+1)')).toBe('3*(x+1)')
    expect(normalizeExpr('x(x-1)**2')).toBe('x*(x-1)^2')
    expect(normalizeExpr('log2(x) + atan2')).toBe('log2(x) + atan2')
    expect(normalizeExpr('f(x) = 0.5sin(x)')).toBe('0.5*sin(x)')
    expect(normalizeExpr('(x+1)(x-1)')).toBe('(x+1)*(x-1)')
    expect(normalizeExpr('z = x^2 − y^2')).toBe('x^2 - y^2')
  })

  it('reads every kind from JSON, with defaults', () => {
    const g = ok('{"kind":"plane","fn":["x^2","2x"],"x":[-3,3],"points":[[1,1,"A"]],"vectors":[{"to":[2,1],"label":"v"}],"shade":[{"fn":1,"x":[0,2]}],"asymptotes":["x=0","y=1"],"tangent":[{"fn":1,"at":1}]}')
    expect(g).toMatchObject({ kind: 'plane', x: [-3, 3], points: [{ at: [1, 1], label: 'A' }], vectors: [{ from: [0, 0], to: [2, 1], label: 'v' }], shade: [{ fn: 0, to: null, from: 0, until: 2 }], asymptotes: [{ x: 0 }, { y: 1 }], tangents: [{ fn: 0, at: 1 }] })
    expect((g as Extract<Graph, { kind: 'plane' }>).fns.map((f) => f.expr)).toEqual(['x^2', '2*x'])
    expect(ok('{"kind":"scatter","points":[[1,2],[2,3]],"fit":true}')).toMatchObject({ kind: 'scatter', fit: true })
    expect(ok('{"kind":"histogram","values":[1,2,2,3,3,3]}')).toMatchObject({ kind: 'histogram', bins: 5 })
    expect(ok('{"kind":"line","series":[{"name":"a","points":[[2,1],[1,3]]}]}')).toMatchObject({ series: [{ points: [[1, 3], [2, 1]] }] })
    expect(ok('{"kind":"bar","labels":["Q1","Q2"],"values":[3,5]}')).toMatchObject({ labels: ['Q1', 'Q2'], series: [{ values: [3, 5] }] })
    expect(ok('{"matrix":[[1,1],[0,1]],"vectors":[[1,2,"v"]]}')).toMatchObject({ kind: 'transform', vectors: [{ v: [1, 2], label: 'v' }] })
    expect(ok('{"z":"x^2 - y^2"}')).toMatchObject({ kind: 'surface', x: [-3, 3] })
    expect(ok('{"kind":"space","vectors":[{"to":[1,2,3]}],"planes":["x + 2y - z = 3"]}')).toMatchObject({ kind: 'space', planes: [{ a: 1, b: 2, c: -1, d: 3 }] })
  })

  it('says what is wrong instead of breaking', () => {
    for (const bad of ['not json', '[1,2]', '{"kind":"pie"}', '{"fn":"import os"}', '{"kind":"scatter","points":[[1,2]]}', '{"kind":"transform","matrix":[[1,2]]}', '{"kind":"surface","z":"eval(x)"}', '{"kind":"space"}']) {
      const p = parseGraph(bad)
      expect(p.ok, bad).toBe(false)
      if (!p.ok) expect(p.error.length).toBeGreaterThan(5)
    }
  })

  it('turns the short tag into a graph block, leaving code alone', () => {
    const md = 'Look:\n<plot fn="x^2; 2x" x="-3..3" points="(1,1)" tangent="1"/>\nand `<plot fn="x"/>` in code:\n```\n<plot fn="x"/>\n```'
    const out = tagsToBlocks(md)
    const block = /```graph\n(.*)\n```/.exec(out)![1]
    expect(ok(block)).toMatchObject({ kind: 'plane', x: [-3, 3], points: [{ at: [1, 1] }], tangents: [{ fn: 0, at: 1 }] })
    expect(out).toContain('```\n<plot fn="x"/>\n```')
    expect(tagsToBlocks('no tags')).toBe('no tags')
    expect(ok(/```graph\n(.*)\n```/.exec(tagsToBlocks('<plot kind="bar" labels="a, b" values="1, 2"/>'))![1])).toMatchObject({ kind: 'bar', labels: ['a', 'b'] })
  })

  it('every example in the guide parses', () => {
    const examples = GRAPH_GUIDE.match(/\{"[a-z]+":[^\n]*?\}(?=[;:.\s])/g) ?? []
    expect(examples.length).toBeGreaterThan(5)
    for (const e of examples.filter((x) => !x.includes('…'))) expect(parseGraph(e).ok, e).toBe(true)
    const tag = /<plot [^>]*\/>/.exec(GRAPH_GUIDE)![0]
    expect(ok(/```graph\n(.*)\n```/.exec(tagsToBlocks(tag))![1]).kind).toBe('plane')
  })
})

describe('graphs: sampling', () => {
  it('evaluates safely, samples exactly, and finds slopes', () => {
    const f = compileExpr('x^2')!
    expect(sample(f, -2, 2, 4)).toEqual([[-2, 4], [-1, 1], [0, 0], [1, 1], [2, 4]])
    expect(slope(f, 3)).toBeCloseTo(6, 6)
    expect(compileExpr('x + q')).toBeNull()
    expect(compileExpr('alert(1)')).toBeNull()
    const g = compileExpr('x*y', 'xy')!
    expect(g(2, 3)).toBe(6)
  })

  it('fits y to the functions, keeps a near x axis in view, and outlines regions', () => {
    const g = ok('{"fn":"x^2 + 3","x":[-2,2]}') as Extract<Graph, { kind: 'plane' }>
    const [lo, hi] = planeY(g, [compileExpr(g.fns[0].expr)!])
    expect(lo).toBeLessThanOrEqual(0)
    expect(hi).toBeGreaterThanOrEqual(7)
    const r = region((x) => x, null, 0, 1, 10)
    expect(r[0]).toEqual([0, 0])
    expect(r[r.length - 1]).toEqual([0, 0])
    // Between two curves: the top then the bottom reversed
    const between = region((x) => x + 1, (x) => x, 0, 1, 2)
    expect(between.map((p) => p[1])).toEqual([1, 1.5, 2, 1, 0.5, 0])
  })

  it('grids surfaces (holes left out) and cuts planes to the box', () => {
    const s = surfaceGrid(ok('{"z":"x^2 + y^2","x":[-1,1],"y":[-1,1]}') as Extract<Graph, { kind: 'surface' }>, 4)!
    expect(s.z[2][2]).toBe(0)
    expect(s.hi).toBe(2)
    const holes = surfaceGrid(ok('{"z":"1/(x*y)","x":[-1,1],"y":[-1,1]}') as Extract<Graph, { kind: 'surface' }>, 2)!
    expect(holes.z[1][1]).toBeNaN()
    for (const [x, y, z] of planeCorners({ a: 1, b: 2, c: -1, d: 3, label: '' }, 2)) expect(x + 2 * y - z).toBeCloseTo(3, 9)
    for (const [x, y, z] of planeCorners({ a: 0, b: 0, c: 0.5, d: 1, label: '' }, 2)) expect(0.5 * z).toBeCloseTo(1, 9)
  })
})

describe('graphs: drawing each kind', () => {
  const palette = { ink: new THREE.Color('#222'), muted: new THREE.Color('#888'), accent: new THREE.Color('#1257b8'), series: [new THREE.Color('#2a78d6'), new THREE.Color('#eb6834')] }
  it.each(GRAPH_KINDS.filter((k) => k !== 'surface' && k !== 'space'))('%s renders an SVG picture', async (kind) => {
    const specs: Record<string, string> = {
      plane: '{"fn":["x^2","2x"],"shade":[{"fn":1,"x":[0,1]}],"tangent":[{"fn":1,"at":1}],"points":[[1,1,"A"]],"vectors":[{"to":[1,2]}],"asymptotes":["x=2"]}',
      scatter: '{"kind":"scatter","points":[[1,2],[2,3.9],[3,6.1]],"fit":true}',
      histogram: '{"kind":"histogram","values":[1,2,2,3,3,3,4,4,5]}',
      line: '{"kind":"line","series":[{"name":"a","points":[[0,1],[1,3]]},{"name":"b","points":[[0,2],[1,1]]}]}',
      bar: '{"kind":"bar","labels":["Q1","Q2","Q3"],"values":[3,5,2]}',
      transform: '{"kind":"transform","matrix":[[1,1],[0,1]],"vectors":[[1,2,"v"]]}'
    }
    const g = ok(specs[kind])
    expect(await drawable(g)).toBeNull()
    const m = mountGraph(g)
    document.body.replaceChildren(m.root)
    expect(m.root.querySelector('svg'), kind).not.toBeNull()
    if (kind === 'plane' || kind === 'line' || kind === 'scatter') expect(m.root.querySelector('.graph-legend')).not.toBeNull()
    if (kind === 'bar' || kind === 'histogram') expect(m.root.querySelector('.graph-legend')).toBeNull()
    m.destroy()
  })

  it('3D kinds build their scene (WebGL draws it in the app)', () => {
    const surf = buildScene(ok('{"z":"x^2 - y^2","x":[-2,2],"y":[-2,2]}') as Extract<Graph, { kind: 'surface' }>, palette)
    expect(surf.group.children.some((c) => c instanceof THREE.Mesh)).toBe(true)
    const mesh = surf.group.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh
    expect(mesh.geometry.getIndex()!.count).toBe(48 * 48 * 6)
    const space = buildScene(ok('{"kind":"space","vectors":[{"to":[1,2,3],"label":"u"}],"planes":["x + y + z = 1","z = 0"],"points":[[0,0,0],[1,1,1]]}') as Extract<Graph, { kind: 'space' }>, palette)
    expect(space.group.children.filter((c) => c instanceof THREE.ArrowHelper)).toHaveLength(1)
    expect(space.group.children.filter((c) => c instanceof THREE.Points)).toHaveLength(1)
    expect(space.size).toBeGreaterThanOrEqual(3)
  })

  it('a bad graph block becomes a short note, a good one a figure, a half-written one stays code', async () => {
    const block = (s: string) => `<pre class="code-block" data-lang="graph"><code>${s}</code></pre>`
    document.body.innerHTML = block('{"fn":"x^2"}') + block('{"fn":"q + x"}') + block('{"fn":"x^')
    startGraphs()
    for (let i = 0; i < 40 && document.querySelectorAll('figure.graph').length < 2; i++) await new Promise((r) => setTimeout(r, 50))
    expect(document.querySelectorAll('figure.graph:not(.graph-error) svg')).toHaveLength(1)
    expect(document.querySelector('figure.graph-error')?.textContent).toMatch(/Graph not drawn: Can’t read “q \+ x”/)
    expect(document.querySelectorAll('pre.code-block')).toHaveLength(1)
  })
})

describe('graphs: what Claude is handed back', () => {
  it('check_graph returns the block as given, which reads back the same', async () => {
    const { checkGraphTool } = await import('../src/main/maths')
    const out = await checkGraphTool.run({ graph: '{"fn":"sqrt(x)","x":[0,9],"tangent":[{"fn":1,"at":4}]}' }, {} as never)
    const block = /```graph\n(.*)\n```/.exec(String(out))![1]
    expect(ok(block)).toMatchObject({ kind: 'plane', tangents: [{ fn: 0, at: 4 }] })
    expect(String(await checkGraphTool.run({ graph: '{"kind":"pie"}' }, {} as never))).toMatch(/^Not drawable/)
  })
})

describe('graphs: the short form for finance lessons', () => {
  it('every example in it parses', async () => {
    const { GRAPH_BRIEF } = await import('../src/shared/graphSpec')
    const examples = GRAPH_BRIEF.match(/\{"[a-z]+":[^\n]*?\}(?=[,.\s])/g) ?? []
    expect(examples.length).toBe(5)
    for (const e of examples) expect(parseGraph(e).ok, e).toBe(true)
  })
})
