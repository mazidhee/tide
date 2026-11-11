/**
 * Physics scenes stepped by a real rigid-body engine (planck.js, a port of Box2D): a projectile,
 * a pendulum, a mass on a spring, a block on a slope and a collision on a line. Sliders set the
 * scene up and start it again; the picture shows the engine's bodies, the path the formula
 * predicts, and the energy over time; beside it, what was measured against what was predicted.
 */
import { fitCanvas, h, num, rangeField, ring, stat } from '../dom'
import type { PartInfo } from '../parts'
import { PARAMS, collisionTheory, inclineTheory, parsePhysicsPart, predictions, projectileTheory, readParam, type PhysicsPart, type PhysicsSpec, type Scene } from '../physics'
import { PhysicsWorld, SLOPE, SUBSTEPS, WALL } from '../physicsWorld'
import type { SimHost, SimKindDef, SimView } from '../shell'

const BODY_NAME: Record<Scene, string> = { projectile: 'the ball', pendulum: 'the bob', spring: 'the block', incline: 'the block', collision: 'ball' }

function seriesColours(root: HTMLElement, fallback: string): string[] {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  root.appendChild(probe)
  const out = [1, 2, 3].map((i) => {
    probe.style.color = `var(--series-${i})`
    return getComputedStyle(probe).color || fallback
  })
  probe.remove()
  return out
}

const fmt = (v: number | null, unit: string, digits = 2) => (v === null || !Number.isFinite(v) ? '–' : `${num(v, digits)}${unit ? ` ${unit}` : ''}`)

function create(spec: PhysicsSpec, host: SimHost): SimView {
  const scene = spec.scene
  const params: Record<string, number> = { ...spec.params }
  let world = new PhysicsWorld(scene, params)
  let marked: PhysicsPart | null = null
  let series: string[] | null = null

  const restart = () => {
    world = new PhysicsWorld(scene, params)
    host.invalidate()
  }

  // ---------- Sliders: setting the scene up starts it again ----------
  const sliders = new Map<string, ReturnType<typeof rangeField>>()
  const sliderBox = h('div', { class: 'sim-params sim-ph-params' })
  for (const d of PARAMS[scene]) {
    const field = rangeField(d.unit ? `${d.label} (${d.unit})` : d.label, { min: d.min, max: d.max, step: d.step, value: params[d.name], format: (v) => num(v, d.step < 0.1 ? 2 : d.step < 1 ? 1 : 0) }, (v) => {
      params[d.name] = v
      restart()
    })
    field.input.setAttribute('aria-label', d.label)
    field.input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && host.select(`param:${d.name}`))
    field.el.querySelector('.sim-label')?.addEventListener('click', () => host.select(`param:${d.name}`))
    sliders.set(d.name, field)
    sliderBox.append(field.el)
  }

  // ---------- Picture and energy ----------
  const canvas = h('canvas', { class: 'sim-canvas sim-ph-canvas', tabindex: 0, 'aria-label': `${scene} scene` })
  const energyCanvas = h('canvas', { class: 'sim-canvas sim-ph-energy', 'aria-label': 'Energy over time' })
  const legend = h(
    'div',
    { class: 'sim-legend' },
    h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line s1' }), scene === 'spring' ? 'Kinetic' : 'Kinetic'),
    ...(scene === 'collision' ? [] : [h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line s2' }), scene === 'spring' ? 'Stored in the spring' : 'Potential')]),
    h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line ink' }), 'Total'),
    ...(scene === 'incline' || scene === 'pendulum' || scene === 'spring' ? [h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line muted' }), scene === 'incline' ? 'Lost to friction' : 'Lost')] : [])
  )
  const energyBox = h('button', { type: 'button', class: 'sim-part sim-ph-energybox' }, energyCanvas, legend)
  energyBox.addEventListener('click', () => host.select('energy'))
  const cap = h('span', { class: 'sim-cap' }, scene === 'projectile' ? 'Dotted: the path the formula predicts. Solid: where the engine took the ball.' : 'Click a body to read its numbers.')
  const picture = h('div', { class: 'sim-plot' }, canvas, h('div', { class: 'sim-plot-foot' }, cap), energyBox)

  // ---------- Measured against predicted ----------
  const tbody = h('tbody')
  const table = h('table', { class: 'sim-table' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'n' }, 'Formula'), h('th', { class: 'n' }, 'Engine'))), tbody)
  const predictBox = h('button', { type: 'button', class: 'sim-part sim-panel sim-ph-predict' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Predicted and measured')), table)
  predictBox.addEventListener('click', () => host.select('prediction'))
  const stats = { time: stat('Time'), speed: stat(scene === 'collision' ? 'Momentum' : 'Speed'), energy: stat('Total energy') }
  const says = h('p', { class: 'sim-pl-says' })
  const note = h(
    'p',
    { class: 'sim-note' },
    `Stepped by planck.js, a port of the Box2D engine, ${SUBSTEPS[scene] * 60} times a second. The engine's numbers are measured from its bodies; small differences from the formula are the engine's own steps.${scene === 'incline' ? ' Box2D uses one friction coefficient for sticking and sliding.' : ''}`
  )
  const side = h('div', { class: 'sim-stack' }, h('div', { class: 'sim-stats' }, ...Object.values(stats).map((x) => x.el)), predictBox, says, note)
  const el = h('div', { class: 'sim-ph' }, sliderBox, h('div', { class: 'sim-two' }, picture, side))

  // ---------- Drawing ----------
  let view = { s: 1, ox: 0, oy: 0 }
  const toPx = (x: number, y: number): [number, number] => [view.ox + x * view.s, view.oy - y * view.s]

  function bounds(): [number, number, number, number] {
    const p = params
    switch (scene) {
      case 'projectile': {
        const t = projectileTheory(p)
        return [-0.06 * Math.max(t.range, 2), -0.04 * Math.max(t.maxHeight, 1), Math.max(t.range * 1.08, 2), Math.max(t.maxHeight * 1.15, 1)]
      }
      case 'pendulum': {
        const top = Math.max(0.2 * p.length, -p.length * Math.cos((p.angle * Math.PI) / 180) + 0.25 * p.length)
        return [-1.2 * p.length, -1.2 * p.length, 1.2 * p.length, top]
      }
      case 'spring':
        return [WALL - 0.25, -0.9, 1.9, 0.9]
      case 'incline': {
        const t = (p.angle * Math.PI) / 180
        return [-0.4, -0.35, SLOPE * Math.cos(t) + 1.6, SLOPE * Math.sin(t) + 0.9]
      }
      case 'collision':
        return [-6, -1.1, 6, 1.1]
    }
  }

  function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, colour: string, width = 1.75): void {
    const len = Math.hypot(dx, dy)
    if (len < 3) return
    ctx.strokeStyle = colour
    ctx.fillStyle = colour
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + dx, y + dy)
    ctx.stroke()
    const ux = dx / len
    const uy = dy / len
    ctx.beginPath()
    ctx.moveTo(x + dx, y + dy)
    ctx.lineTo(x + dx - ux * 8 - uy * 4, y + dy - uy * 8 + ux * 4)
    ctx.lineTo(x + dx - ux * 8 + uy * 4, y + dy - uy * 8 - ux * 4)
    ctx.closePath()
    ctx.fill()
  }

  function paint(): void {
    const fit = fitCanvas(canvas)
    if (!fit) return
    const { ctx, w, h: hgt } = fit
    const p = host.palette()
    series ??= seriesColours(host.root, p.css.ink)
    const [x0, y0, x1, y1] = bounds()
    const pad = 18
    const s = Math.min((w - 2 * pad) / (x1 - x0), (hgt - 2 * pad) / (y1 - y0))
    view = { s, ox: (w - (x1 - x0) * s) / 2 - x0 * s, oy: (hgt + (y1 - y0) * s) / 2 + y0 * s }
    ctx.clearRect(0, 0, w, hgt)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.font = `11px ${p.font}`
    const accent = p.css.accent
    const on = (type: PhysicsPart['type']) => marked?.type === type

    // The ground, where there is one
    if (scene !== 'collision' && scene !== 'spring' && scene !== 'pendulum') {
      const [, gy] = toPx(0, 0)
      ctx.strokeStyle = p.css.lineStrong
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, gy)
      ctx.lineTo(w, gy)
      ctx.stroke()
    }

    // A scale bar: a round number of metres
    const metres = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].find((m) => m * s >= 50) ?? 100
    ctx.strokeStyle = p.css.muted
    ctx.fillStyle = p.css.muted
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w - 12 - metres * s, 14)
    ctx.lineTo(w - 12, 14)
    ctx.moveTo(w - 12 - metres * s, 10)
    ctx.lineTo(w - 12 - metres * s, 18)
    ctx.moveTo(w - 12, 10)
    ctx.lineTo(w - 12, 18)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${metres} m`, w - 12 - (metres * s) / 2, 20)

    const b = world.body(0)
    if (scene === 'projectile') {
      // The predicted parabola, dotted
      const rad = (params.angle * Math.PI) / 180
      const t = projectileTheory(params)
      ctx.strokeStyle = p.css.muted
      ctx.lineWidth = 1.25
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      for (let i = 0; i <= 80; i++) {
        const tt = (t.flightTime * i) / 80
        const [px, py] = toPx(params.speed * Math.cos(rad) * tt, params.height + params.speed * Math.sin(rad) * tt - 0.5 * params.g * tt * tt)
        if (i) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.stroke()
      ctx.setLineDash([])
      // The path taken
      ctx.strokeStyle = on('trail') ? accent : series[0]
      ctx.lineWidth = on('trail') ? 3 : 2
      ctx.beginPath()
      for (let i = 0; i < world.trail.length; i += 2) {
        const [px, py] = toPx(world.trail[i], world.trail[i + 1])
        if (i) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.stroke()
      // Launch platform
      if (params.height > 0) {
        const [lx, ly] = toPx(0, params.height)
        const [, gy] = toPx(0, 0)
        ctx.fillStyle = p.css.line
        ctx.fillRect(lx - 10, ly + 5, 10, gy - ly - 5)
      }
    }

    if (scene === 'pendulum') {
      const [px, py] = toPx(0, 0)
      const [bx, by] = toPx(b.x, b.y)
      // The vertical, and the angle from it
      ctx.strokeStyle = p.css.line
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px, py + params.length * s * 1.05)
      ctx.stroke()
      ctx.setLineDash([])
      const theta = Math.atan2(b.x, -b.y)
      ctx.strokeStyle = p.css.muted
      ctx.beginPath()
      ctx.arc(px, py, Math.min(40, params.length * s * 0.3), Math.PI / 2, Math.PI / 2 - theta, theta > 0)
      ctx.stroke()
      ctx.fillStyle = p.css.soft
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`θ ${num((theta * 180) / Math.PI, 1)}°`, px + 8 + (theta > 0 ? 0 : -60), py + Math.min(40, params.length * s * 0.3) + 12)
      ctx.strokeStyle = on('rod') ? accent : p.css.ink
      ctx.lineWidth = on('rod') ? 3 : 1.75
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(bx, by)
      ctx.stroke()
      ctx.fillStyle = p.css.ink
      ctx.fillRect(px - 14, py - 3, 28, 3)
    }

    if (scene === 'spring') {
      const [wx, wy] = toPx(WALL, 0)
      ctx.fillStyle = p.css.line
      ctx.fillRect(wx - 8, wy - 0.7 * s, 8, 1.4 * s)
      // Rest position
      const [rx] = toPx(0, 0)
      ctx.strokeStyle = p.css.line
      ctx.setLineDash([3, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(rx, wy - 0.75 * s)
      ctx.lineTo(rx, wy + 0.75 * s)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = p.css.muted
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('rest', rx, wy + 0.75 * s + 3)
      // The coil, from the wall to the block's left face
      const [ex] = toPx(b.x - b.hw, 0)
      const coils = 12
      const amp = Math.min(10, 0.12 * s)
      ctx.strokeStyle = on('spring') ? accent : p.css.ink
      ctx.lineWidth = on('spring') ? 2.5 : 1.5
      ctx.beginPath()
      ctx.moveTo(wx, wy)
      const lead = 8
      ctx.lineTo(wx + lead, wy)
      for (let i = 1; i <= coils * 2; i++) ctx.lineTo(wx + lead + ((ex - lead - wx - lead) * i) / (coils * 2), wy + (i === coils * 2 ? 0 : i % 2 ? -amp : amp))
      ctx.lineTo(ex, wy)
      ctx.stroke()
      ctx.strokeStyle = p.css.lineStrong
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(wx, wy + b.hh * s)
      ctx.lineTo(w, wy + b.hh * s)
      ctx.stroke()
    }

    if (scene === 'incline') {
      const t = (params.angle * Math.PI) / 180
      const [ax, ay] = toPx(0, 0)
      const [bx2, by2] = toPx(SLOPE * Math.cos(t), 0)
      const [cx2, cy2] = toPx(0, SLOPE * Math.sin(t))
      ctx.fillStyle = p.css.line
      ctx.strokeStyle = on('slope') ? accent : p.css.lineStrong
      ctx.lineWidth = on('slope') ? 2.5 : 1.25
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx2, by2)
      ctx.lineTo(cx2, cy2)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      if (params.angle > 0) {
        ctx.strokeStyle = p.css.muted
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(bx2, by2, 34, Math.PI, Math.PI + t)
        ctx.stroke()
        ctx.fillStyle = p.css.soft
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${num(params.angle, 0)}°`, bx2 - 40, by2 - 3)
      }
    }

    if (scene === 'collision') {
      const [, ly] = toPx(0, -0.6)
      ctx.strokeStyle = p.css.lineStrong
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, ly)
      ctx.lineTo(w, ly)
      ctx.stroke()
    }

    // Bodies, with their velocity arrows
    const vScale = scene === 'projectile' ? Math.min(4, 90 / Math.max(params.speed, 1)) : scene === 'collision' ? 14 : scene === 'pendulum' ? 22 : 30
    for (let i = 0; i < world.count; i++) {
      const bi = world.body(i)
      // Where it landed, not the engine's last step a little below the ground
      const [cx, cy] = scene === 'projectile' && world.landed ? toPx(world.landed.x, 0) : toPx(bi.x, bi.y)
      const colour = series[i] ?? p.css.ink
      const chosen = marked?.type === 'body' && marked.i === i + 1
      ctx.fillStyle = colour
      ctx.strokeStyle = p.css.bg
      ctx.lineWidth = 2
      if (bi.shape === 'circle') {
        const r = scene === 'projectile' ? 6 : Math.max(5, bi.r * s)
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, 2 * Math.PI)
        ctx.fill()
        ctx.stroke()
        if (scene === 'collision') {
          ctx.fillStyle = p.css.bg
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.font = `600 12px ${p.font}`
          ctx.fillText(String(i + 1), cx, cy)
          ctx.font = `11px ${p.font}`
          ctx.fillStyle = p.css.soft
          ctx.textBaseline = 'top'
          ctx.fillText(`${num(bi.mass, 1)} kg`, cx, cy + r + 6)
        }
        if (chosen) {
          ctx.strokeStyle = accent
          ctx.beginPath()
          ctx.arc(cx, cy, r + 6, 0, 2 * Math.PI)
          ctx.stroke()
        }
      } else {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(-bi.angle)
        ctx.fillRect(-bi.hw * s, -bi.hh * s, 2 * bi.hw * s, 2 * bi.hh * s)
        ctx.strokeRect(-bi.hw * s, -bi.hh * s, 2 * bi.hw * s, 2 * bi.hh * s)
        if (chosen) {
          ctx.strokeStyle = accent
          ctx.strokeRect(-bi.hw * s - 5, -bi.hh * s - 5, 2 * bi.hw * s + 10, 2 * bi.hh * s + 10)
        }
        ctx.restore()
      }
      // A landed ball has no velocity worth drawing
      if (!(scene === 'projectile' && world.landed)) arrow(ctx, cx, cy, bi.vx * vScale, -bi.vy * vScale, on('velocity') ? accent : p.css.soft, on('velocity') ? 2.5 : 1.5)
    }
    paintEnergy()
  }

  function paintEnergy(): void {
    const fit = fitCanvas(energyCanvas)
    if (!fit) return
    const { ctx, w, h: hgt } = fit
    const p = host.palette()
    ctx.clearRect(0, 0, w, hgt)
    const hist = world.history
    const top = Math.max(1e-9, ...hist.map((e) => Math.max(e.total, e.kinetic, e.potential, e.lost))) * 1.08
    const t0 = hist[0]?.t ?? 0
    // A flight fills the chart; anything that goes on shows its last stretch
    const span = Math.max(scene === 'projectile' ? projectileTheory(params).flightTime : 6, (hist[hist.length - 1]?.t ?? 0) - t0)
    const X = (t: number) => 6 + ((t - t0) / span) * (w - 12)
    const Y = (v: number) => hgt - 6 - (v / top) * (hgt - 12)
    ctx.strokeStyle = p.css.line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(6, hgt - 6.5)
    ctx.lineTo(w - 6, hgt - 6.5)
    ctx.stroke()
    const line = (pick: (e: (typeof hist)[number]) => number, colour: string, width: number, dash: number[] = []) => {
      ctx.strokeStyle = colour
      ctx.lineWidth = width
      ctx.setLineDash(dash)
      ctx.beginPath()
      hist.forEach((e, i) => (i ? ctx.lineTo(X(e.t), Y(pick(e))) : ctx.moveTo(X(e.t), Y(pick(e)))))
      ctx.stroke()
      ctx.setLineDash([])
    }
    const on = marked?.type === 'energy'
    if (scene === 'incline' || scene === 'pendulum' || scene === 'spring') line((e) => e.lost, p.css.muted, 1.25, [3, 3])
    if (scene !== 'collision') line((e) => e.potential, series?.[1] ?? p.css.ink, 1.75)
    line((e) => e.kinetic, series?.[0] ?? p.css.ink, 1.75)
    line((e) => e.total, on ? p.css.accent : p.css.ink, on ? 2.5 : 1.5)
  }

  // ---------- Selecting a body on the picture ----------
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    for (let i = 0; i < world.count; i++) {
      const b = world.body(i)
      const [cx, cy] = toPx(b.x, b.y)
      if (Math.hypot(cx - mx, cy - my) < Math.max(18, (b.r || b.hw) * view.s + 8)) return host.select(scene === 'collision' ? `body:${i + 1}` : 'body')
    }
  })

  // ---------- The written side ----------
  function sayNow(): string {
    const b = world.body(0)
    const p = params
    const done = world.done()
    switch (scene) {
      case 'projectile':
        return world.landed
          ? `It landed ${num(world.landed.x, 2)} m away after ${num(world.landed.t, 2)} s. The horizontal velocity stayed ${num(b.vx, 2)} m/s the whole way: gravity only changes the vertical part.`
          : `In the air for ${num(world.time, 2)} s. Horizontal velocity ${num(b.vx, 2)} m/s, unchanged; vertical ${num(b.vy, 2)} m/s, falling by ${num(p.g, 2)} m/s every second.`
      case 'pendulum': {
        const T = world.period()
        return T ? `One full swing takes ${num(T, 3)} s. The mass doesn't appear in the period: change it and see.` : 'Wait for two passes through the middle in the same direction: that is one period.'
      }
      case 'spring': {
        const T = world.period()
        return `The spring pulls with −k x = ${num(-p.k * b.x, 2)} N. ${T ? `One oscillation takes ${num(T, 3)} s.` : p.damping > 0 && !(world.crossings.length > 0) ? 'With this much damping it may creep back without swinging through.' : ''}`
      }
      case 'incline': {
        const t = inclineTheory(p)
        return t.slides
          ? `tan θ = ${num(Math.tan((p.angle * Math.PI) / 180), 3)} is more than μ = ${num(p.friction, 2)}, so gravity along the slope beats the most friction can give. ${done ? '' : `Speed now ${num(Math.hypot(b.vx, b.vy), 2)} m/s.`}`
          : `tan θ = ${num(Math.tan((p.angle * Math.PI) / 180), 3)} is not more than μ = ${num(p.friction, 2)}: friction can match gravity along the slope, so the block stays.`
      }
      case 'collision': {
        const t = collisionTheory(p)
        return world.collided !== null
          ? `Momentum before ${num(t.momentum, 2)} kg·m/s, after ${num(world.momentum(), 2)} kg·m/s. Kinetic energy went from ${num(t.keBefore, 2)} J to ${num(world.energyNow().kinetic, 2)} J${p.e < 1 ? ': the rest became heat and sound.' : '.'}`
          : t.meet
            ? `Closing at ${num(p.u1 - p.u2, 2)} m/s. Predict both velocities after, then play.`
            : 'Ball 1 is not catching ball 2, so they will never meet. Make velocity 1 larger than velocity 2.'
      }
    }
  }

  function draw(): void {
    paint()
    const pred = predictions(scene, params)
    const meas = world.measured()
    if (tbody.childElementCount !== pred.length) tbody.replaceChildren(...pred.map(() => h('tr', null, h('th'), h('td', { class: 'n' }), h('td', { class: 'n' }))))
    pred.forEach((q, i) => {
      const cells = tbody.children[i].children
      const m = meas[i]
      cells[0].textContent = q.label
      ;(cells[0] as HTMLElement).title = q.formula
      cells[1].textContent = fmt(q.value, q.unit, 3)
      cells[2].textContent = m?.value === null || m === undefined ? '–' : fmt(m.value, m.unit, 3)
    })
    const b = world.body(0)
    const e = world.energyNow()
    stats.time.set(`${num(world.time, 2)} s`)
    stats.speed.set(scene === 'collision' ? `${num(world.momentum(), 2)} kg·m/s` : `${num(Math.hypot(b.vx, b.vy), 2)} m/s`)
    stats.energy.set(`${num(e.total, 2)} J`)
    const text = sayNow()
    if (says.textContent !== text) says.textContent = text
  }

  function describe(name: string): PartInfo | null {
    const part = parsePhysicsPart(name, scene)
    if (!part) return null
    const p = params
    const e = world.energyNow()
    const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d
    switch (part.type) {
      case 'body': {
        const b = world.body(part.i - 1)
        const values: Record<string, number | string> = { x: r(b.x), y: r(b.y), speed: r(Math.hypot(b.vx, b.vy)), mass: r(b.mass, 2) }
        if (scene === 'pendulum') values.angle = r((Math.atan2(b.x, -b.y) * 180) / Math.PI, 1)
        if (scene === 'collision') values.velocity = r(b.vx)
        return { label: `${scene === 'collision' ? `ball ${part.i}` : BODY_NAME[scene]} at t = ${num(world.time, 2)} s`, values }
      }
      case 'velocity': {
        const b = world.body(0)
        return { label: `the velocity of ${scene === 'collision' ? 'ball 1' : BODY_NAME[scene]} (m/s)`, values: { vx: r(b.vx), vy: r(b.vy), speed: r(Math.hypot(b.vx, b.vy)) } }
      }
      case 'energy':
        return { label: 'the energy (J)', values: { kinetic: r(e.kinetic), potential: r(e.potential), lost: r(e.lost), total: r(e.total) } }
      case 'prediction': {
        const pred = predictions(scene, p)
        const meas = world.measured()
        const values: Record<string, number | string> = {}
        pred.slice(0, 2).forEach((q, i) => {
          values[`${q.label} predicted`] = r(q.value)
          values[`${q.label} measured`] = meas[i]?.value === null || meas[i] === undefined ? 'not yet' : r(meas[i].value!)
        })
        return { label: `the prediction ${pred[0].formula} against the engine`, values }
      }
      case 'param': {
        const d = PARAMS[scene].find((x) => x.name === part.name)!
        return { label: `the ${d.label.toLowerCase()}${d.unit ? ` (${d.unit})` : ''}`, values: { [d.name]: p[d.name] } }
      }
      case 'trail':
        return { label: 'the path the ball took', values: { 'highest y': r(world.peak), 'x now': r(world.body(0).x), points: world.trail.length / 2 } }
      case 'rod': {
        const b = world.body(0)
        return { label: 'the rod', values: { length: p.length, angle: r((Math.atan2(b.x, -b.y) * 180) / Math.PI, 1) } }
      }
      case 'spring': {
        const b = world.body(0)
        return { label: 'the spring', values: { k: p.k, extension: r(b.x), force: r(-p.k * b.x), stored: r(0.5 * p.k * b.x * b.x) } }
      }
      case 'slope': {
        const t = inclineTheory(p)
        return { label: 'the slope', values: { angle: p.angle, mu: p.friction, 'tan θ': r(Math.tan((p.angle * Math.PI) / 180)), slides: t.slides ? 'yes' : 'no' } }
      }
      case 'momentum':
        return { label: 'the momentum (kg·m/s)', values: { before: r(collisionTheory(p).momentum), now: r(world.momentum()) } }
    }
  }

  return {
    el,
    step: () => world.step(),
    stepsPerSecond: () => 60,
    done: () => world.done(),
    reset() {
      world = new PhysicsWorld(scene, params)
    },
    draw,
    relayout() {
      series = null
    },
    describe,
    highlight(name) {
      marked = name ? parsePhysicsPart(name, scene) : null
      for (const [key, field] of sliders) ring(field.el, marked?.type === 'param' && marked.name === key)
      ring(predictBox, marked?.type === 'prediction')
      ring(energyBox, marked?.type === 'energy')
    },
    act(action) {
      const set = action.set
      if (!set || typeof set !== 'object' || Array.isArray(set)) return
      for (const [k, v] of Object.entries(set)) {
        const read = readParam(scene, k, v)
        if (!read) continue
        params[read[0]] = read[1]
        sliders.get(read[0])?.set(read[1])
      }
      world = new PhysicsWorld(scene, params)
    }
  }
}

export const physicsKind: SimKindDef<PhysicsSpec> = {
  label: 'Physics',
  transport: true,
  autoplay: (spec) => spec.autoplay,
  create
}
