/**
 * 3D lesson graphs with three.js (MIT), loaded only when a lesson shows one: a surface z = f(x, y),
 * or vectors, planes and points in space, turned with the mouse (OrbitControls). Drawn only when
 * something changes (a drag, a resize, the theme), never in a loop. z points up, as in a textbook.
 * Colours come from the theme: the surface in the accent, guides in muted ink; several planes take
 * the series colours.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SpaceGraph, SurfaceGraph } from '@shared/graphSpec'
import { planeCorners, surfaceGrid } from './maths'

type V3 = [number, number, number]

function cssColour(el: Element, name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  try {
    return new THREE.Color(v || fallback)
  } catch {
    return new THREE.Color(fallback)
  }
}

function label(text: string, colour: THREE.Color, at: V3): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.font = '600 40px system-ui, sans-serif'
    ctx.fillStyle = `#${colour.getHexString()}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 64, 32)
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }))
  sprite.position.set(...at)
  sprite.scale.set(0.5, 0.25, 1)
  return sprite
}

function segment(a: V3, b: V3, colour: THREE.Color, opacity = 1): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)])
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity }))
}

export interface Palette {
  ink: THREE.Color
  muted: THREE.Color
  accent: THREE.Color
  series: THREE.Color[]
}

/** The scene for a graph, without a renderer (so it can be tested): its objects and the box size */
export function buildScene(g: SurfaceGraph | SpaceGraph, p: Palette): { group: THREE.Group; size: number } {
  const group = new THREE.Group()
  let size: number
  if (g.kind === 'surface') {
    const grid = surfaceGrid(g)
    if (!grid) throw new Error(`can’t read z = ${g.expr}`)
    const span = Math.max(g.x[1] - g.x[0], g.y[1] - g.y[0])
    const zSpan = grid.hi - grid.lo || 1
    // Tall surfaces are squashed to the box; the axis says so
    const k = zSpan > span * 1.5 ? (span * 1.2) / zSpan : 1
    const n = grid.xs.length
    const pos: number[] = []
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(grid.xs[i], grid.ys[j], Number.isFinite(grid.z[j][i]) ? grid.z[j][i] * k : NaN)
    const index: number[] = []
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i
        const cells = [a, a + 1, a + n, a + n + 1]
        if (cells.some((c) => !Number.isFinite(pos[c * 3 + 2]))) continue
        index.push(a, a + 1, a + n + 1, a, a + n + 1, a + n)
      }
    for (let c = 2; c < pos.length; c += 3) if (!Number.isFinite(pos[c])) pos[c] = 0
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(index)
    geo.computeVertexNormals()
    group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: p.accent, side: THREE.DoubleSide, transparent: true, opacity: 0.88 })))
    group.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: p.ink, transparent: true, opacity: 0.12 })))
    size = span / 2 + 0.5
    group.userData.zScale = k
  } else {
    const r = g.range
    size = r
    g.planes.forEach((pl, i) => {
      const c = planeCorners(pl, r).map((v) => new THREE.Vector3(...v))
      const geo = new THREE.BufferGeometry().setFromPoints([c[0], c[1], c[2], c[0], c[2], c[3]])
      geo.computeVertexNormals()
      const colour = g.planes.length > 1 ? p.series[i % p.series.length] : p.accent
      group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false })))
    })
    for (const v of g.vectors) {
      const dir = new THREE.Vector3(v.to[0] - v.from[0], v.to[1] - v.from[1], v.to[2] - v.from[2])
      const len = dir.length()
      if (len < 1e-9) continue
      group.add(new THREE.ArrowHelper(dir.clone().normalize(), new THREE.Vector3(...v.from), len, p.accent, Math.min(0.35, len * 0.25), Math.min(0.18, len * 0.12)))
      if (v.label) group.add(label(v.label, p.accent, [v.to[0] * 1.08, v.to[1] * 1.08, v.to[2] * 1.08 + 0.15]))
    }
    if (g.points.length) {
      const geo = new THREE.BufferGeometry().setFromPoints(g.points.map((q) => new THREE.Vector3(...q)))
      group.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: p.ink, size: g.points.length > 200 ? 0.06 : 0.12 })))
    }
  }
  // Axes, z up
  const s = size
  group.add(segment([-s, 0, 0], [s, 0, 0], p.muted), segment([0, -s, 0], [0, s, 0], p.muted), segment([0, 0, -s], [0, 0, s], p.muted))
  group.add(label('x', p.muted, [s + 0.25, 0, 0]), label('y', p.muted, [0, s + 0.25, 0]), label('z', p.muted, [0, 0, s + 0.25]))
  return { group, size }
}

/** Draws a 3D graph into `stage`; returns how to take it down */
export function mount3d(stage: HTMLElement, g: SurfaceGraph | SpaceGraph): () => void {
  const palette = (): Palette => ({
    ink: cssColour(stage, '--ink', '#222'),
    muted: cssColour(stage, '--ink-muted', '#888'),
    accent: cssColour(stage, '--accent', '#1257b8'),
    series: [1, 2, 3, 4].map((i) => cssColour(stage, `--series-${i}`, '#2a78d6'))
  })
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  stage.append(renderer.domElement)
  const scene = new THREE.Scene()
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(3, -4, 6)
  scene.add(new THREE.AmbientLight(0xffffff, 0.75), sun)
  let built = buildScene(g, palette())
  scene.add(built.group)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000)
  camera.up.set(0, 0, 1)
  const d = built.size * 3.2
  camera.position.set(d * 0.8, -d, d * 0.7)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.target.set(0, 0, 0)
  const draw = () => renderer.render(scene, camera)
  controls.addEventListener('change', draw)
  const size = () => {
    const w = stage.clientWidth || 560
    const h = Math.round(Math.min(420, Math.max(260, w * 0.62)))
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    draw()
  }
  const sized = new ResizeObserver(size)
  sized.observe(stage)
  // The theme changed: the same scene in the new colours
  const themed = new MutationObserver(() => {
    scene.remove(built.group)
    built = buildScene(g, palette())
    scene.add(built.group)
    draw()
  })
  themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-design', 'style'] })
  size()
  return () => {
    sized.disconnect()
    themed.disconnect()
    controls.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
}
