/**
 * The physics scenes, stepped by planck.js (a JavaScript port of Box2D, MIT). Box2D integrates
 * with semi-implicit Euler and solves contacts and joints by iteration, so each frame of 1/60 s is
 * taken as several smaller steps (SUBSTEPS); what is measured here is what the engine did, read off its
 * bodies, and is shown beside the textbook prediction (physics.ts) rather than replaced by it.
 */
import { Box, Circle, Edge, Polygon, RevoluteJoint, Settings, Vec2, World, type Body } from 'planck'
import { collisionTheory, inclineTheory, type Scene } from './physics'

export const FRAME = 1 / 60
/**
 * Steps of the engine per frame. A pendulum needs many more: Box2D holds a joint by correcting
 * velocities, which bleeds energy at a rate that falls with the step (a swing from 90° lost 12%
 * in 10 s at 240 steps a second, under 1% at 3,840).
 */
export const SUBSTEPS: Record<Scene, number> = { projectile: 4, pendulum: 64, spring: 4, incline: 4, collision: 4 }
const VELOCITY_ITERATIONS = 10
const POSITION_ITERATIONS = 6

/** Box2D makes slow collisions perfectly inelastic below this closing speed (1 m/s by default); here e means e */
Settings.velocityThreshold = 0.001

/** The slope of the incline scene is this long */
export const SLOPE = 5
/** Where the spring's wall stands, left of the rest position */
export const WALL = -1.6

export interface BodyView {
  shape: 'circle' | 'box'
  x: number
  y: number
  angle: number
  vx: number
  vy: number
  mass: number
  /** Radius, or half width and half height for a box */
  r: number
  hw: number
  hh: number
}

export interface Energy {
  t: number
  kinetic: number
  potential: number
  /** Energy turned to heat by friction or damping since the start */
  lost: number
  total: number
}

export interface Measured {
  label: string
  value: number | null
  unit: string
}

export class PhysicsWorld {
  readonly scene: Scene
  readonly p: Record<string, number>
  time = 0
  private world: World
  private bodies: Body[] = []
  /** Projectile path, x and y in turn */
  trail: number[] = []
  history: Energy[] = []
  private startEnergy = 0
  // What has been measured so far
  landed: { t: number; x: number } | null = null
  peak = -Infinity
  crossings: number[] = []
  private lastSign = 0
  collided: number | null = null
  slid = 0
  private start = { x: 0, y: 0 }

  constructor(scene: Scene, params: Record<string, number>) {
    this.scene = scene
    this.p = { ...params }
    this.world = this.build()
    this.startEnergy = this.energyNow().kinetic + this.energyNow().potential
    this.record()
  }

  private build(): World {
    const p = this.p
    const rad = (d: number) => (d * Math.PI) / 180
    switch (this.scene) {
      case 'projectile': {
        const world = new World({ gravity: Vec2(0, -p.g), allowSleep: false })
        const ball = world.createBody({ type: 'dynamic', position: Vec2(0, p.height), bullet: true })
        ball.createFixture(Circle(0.05), { density: 1 / (Math.PI * 0.05 * 0.05) })
        ball.setLinearVelocity(Vec2(p.speed * Math.cos(rad(p.angle)), p.speed * Math.sin(rad(p.angle))))
        this.bodies = [ball]
        this.trail = [0, p.height]
        this.peak = p.height
        return world
      }
      case 'pendulum': {
        // A rigid, massless rod: one body turning on a pin at the pivot, all of its mass in the
        // bob. Box2D then integrates the swing as a rotation, which keeps its energy far better
        // than a free bob held at a distance.
        const world = new World({ gravity: Vec2(0, -p.g), allowSleep: false })
        const pivot = world.createBody({ type: 'static', position: Vec2(0, 0) })
        const arm = world.createBody({ type: 'dynamic', position: Vec2(0, 0), angle: rad(p.angle) })
        const r = bobRadius(p.mass, p.length)
        arm.createFixture(Circle(Vec2(0, -p.length), r), { density: 1 })
        // A point mass: no inertia of its own about its centre
        arm.setMassData({ mass: p.mass, center: Vec2(0, -p.length), I: p.mass * p.length * p.length * (1 + 1e-9) })
        arm.setAngularDamping(p.damping)
        world.createJoint(RevoluteJoint({}, pivot, arm, Vec2(0, 0)))
        this.bodies = [arm]
        this.lastSign = Math.sign(p.angle)
        return world
      }
      case 'spring': {
        const world = new World({ gravity: Vec2(0, 0), allowSleep: false })
        const s = blockHalf(p.mass)
        const block = world.createBody({ type: 'dynamic', position: Vec2(p.stretch, 0), fixedRotation: true })
        block.createFixture(Box(s, s), { density: p.mass / (4 * s * s), friction: 0 })
        this.bodies = [block]
        this.lastSign = Math.sign(p.stretch)
        return world
      }
      case 'incline': {
        const world = new World({ gravity: Vec2(0, -p.g), allowSleep: false })
        const t = rad(p.angle)
        const run = SLOPE * Math.cos(t)
        const rise = SLOPE * Math.sin(t)
        const ground = world.createBody({ type: 'static' })
        if (rise > 0.01) ground.createFixture(Polygon([Vec2(0, 0), Vec2(run, 0), Vec2(0, rise)]), { friction: p.friction })
        ground.createFixture(Edge(Vec2(-2, 0), Vec2(run + 12, 0)), { friction: p.friction })
        const hw = 0.3
        const hh = 0.18
        // Set down a little way along the slope from the top, resting on it
        const along = 0.5
        const sx = along * Math.cos(t)
        const sy = rise - along * Math.sin(t)
        const nx = Math.sin(t)
        const ny = Math.cos(t)
        const block = world.createBody({ type: 'dynamic', position: Vec2(sx + nx * (hh + 0.005), sy + ny * (hh + 0.005)), angle: -t, fixedRotation: true })
        block.createFixture(Box(hw, hh), { density: p.mass / (4 * hw * hh), friction: p.friction })
        this.bodies = [block]
        this.start = { x: block.getPosition().x, y: block.getPosition().y }
        return world
      }
      case 'collision': {
        const world = new World({ gravity: Vec2(0, 0), allowSleep: false })
        const make = (m: number, x: number, u: number) => {
          const r = ballRadius(m)
          const b = world.createBody({ type: 'dynamic', position: Vec2(x, 0), bullet: true, fixedRotation: true })
          b.createFixture(Circle(r), { density: m / (Math.PI * r * r), friction: 0, restitution: p.e })
          b.setLinearVelocity(Vec2(u, 0))
          return b
        }
        this.bodies = [make(p.m1, -2.5 - ballRadius(p.m1), p.u1), make(p.m2, 2.5 + ballRadius(p.m2), p.u2)]
        world.on('begin-contact', () => {
          this.collided ??= this.time
        })
        return world
      }
    }
  }

  /** One frame: 1/60 s of simulated time */
  step(): void {
    if (this.done()) return
    const n = SUBSTEPS[this.scene]
    const dt = FRAME / n
    for (let i = 0; i < n; i++) {
      const before = this.body(0)
      if (this.scene === 'spring') {
        const b = this.bodies[0]
        const x = b.getPosition().x
        const v = b.getLinearVelocity().x
        b.applyForceToCenter(Vec2(-this.p.k * x - this.p.damping * v, 0), true)
      }
      this.world.step(dt, VELOCITY_ITERATIONS, POSITION_ITERATIONS)
      this.time += dt
      this.watch(before, dt)
      if (this.landed) break
    }
    this.record()
  }

  /** Reads what happened in the step just taken: a landing, a highest point, a swing through the middle */
  private watch(before: BodyView, dt: number): void {
    const now = this.body(0)
    if (this.scene === 'projectile') {
      this.peak = Math.max(this.peak, now.y)
      if (now.y <= 0 && this.time > dt / 2 && (before.y > 0 || this.p.height === 0)) {
        // Between the last two positions, where y reached 0
        const f = before.y === now.y ? 1 : before.y / (before.y - now.y)
        const t = this.time - dt + f * dt
        const x = before.x + f * (now.x - before.x)
        this.landed = { t, x }
        this.trail.push(x, 0)
        return
      }
      const [lx, ly] = this.trail.slice(-2)
      if (Math.hypot(now.x - lx, now.y - ly) > 0.02 * Math.max(1, this.p.speed / 5)) this.trail.push(now.x, now.y)
    }
    if (this.scene === 'pendulum' || this.scene === 'spring') {
      // The middle of the swing: x = 0, crossed in the same direction as the first crossing
      const sign = Math.sign(now.x)
      if (sign !== 0 && sign !== this.lastSign && this.lastSign !== 0) {
        const f = before.x / (before.x - now.x)
        this.crossings.push(this.time - dt + f * dt)
      }
      if (sign !== 0) this.lastSign = sign
    }
    if (this.scene === 'incline') this.slid = Math.hypot(now.x - this.start.x, now.y - this.start.y)
  }

  body(i: number): BodyView {
    const b = this.bodies[i]
    const pos = b.getWorldCenter()
    const v = b.getLinearVelocity()
    const shape = b.getFixtureList()?.getShape()
    const circle = shape?.getType() === 'circle'
    const r = circle ? shape!.getRadius() : 0
    // The pendulum's body turns about the pivot; its angle is the swing, not the bob's
    let hw = r
    let hh = r
    if (!circle && shape) {
      const verts = (shape as unknown as { m_vertices: { x: number; y: number }[] }).m_vertices
      hw = Math.max(...verts.map((q) => Math.abs(q.x)))
      hh = Math.max(...verts.map((q) => Math.abs(q.y)))
    }
    return { shape: circle ? 'circle' : 'box', x: pos.x, y: pos.y, angle: b.getAngle(), vx: v.x, vy: v.y, mass: b.getMass(), r, hw, hh }
  }

  get count(): number {
    return this.bodies.length
  }

  energyNow(): Energy {
    const p = this.p
    let kinetic = 0
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.body(i)
      kinetic += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy)
    }
    const b = this.body(0)
    let potential = 0
    if (this.scene === 'projectile') potential = b.mass * p.g * b.y
    else if (this.scene === 'pendulum') potential = b.mass * p.g * (b.y + p.length)
    else if (this.scene === 'spring') potential = 0.5 * p.k * b.x * b.x
    else if (this.scene === 'incline') potential = b.mass * p.g * (b.y - b.hh)
    const total = kinetic + potential
    return { t: this.time, kinetic, potential, lost: Math.max(0, (this.startEnergy || total) - total), total }
  }

  private record(): void {
    this.history.push(this.energyNow())
    if (this.history.length > 900) this.history.splice(0, this.history.length - 900)
  }

  momentum(): number {
    let m = 0
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.body(i)
      m += b.mass * b.vx
    }
    return m
  }

  /** A full swing, from the time between the latest crossings of the middle in the same direction */
  period(): number | null {
    const c = this.crossings
    return c.length >= 3 ? c[c.length - 1] - c[c.length - 3] : null
  }

  /** What the engine measured, in the same order as physics.predictions */
  measured(): Measured[] {
    const p = this.p
    switch (this.scene) {
      case 'projectile':
        return [
          { label: 'Range', value: this.landed?.x ?? null, unit: 'm' },
          { label: 'Highest point', value: this.time > 0 ? this.peak : null, unit: 'm' },
          { label: 'Time of flight', value: this.landed?.t ?? null, unit: 's' }
        ]
      case 'pendulum':
        return [
          { label: 'Period, small swings', value: null, unit: 's' },
          { label: 'Period at this angle', value: this.period(), unit: 's' }
        ]
      case 'spring':
        return [{ label: 'Period', value: this.period(), unit: 's' }, ...(p.damping > 0 ? [{ label: 'Damping ratio ζ', value: null, unit: '' }] : [])]
      case 'incline': {
        // From distance and time, s = ½at², once it has moved a little
        const a = this.time > 0.2 ? (2 * this.slid) / (this.time * this.time) : null
        return [{ label: 'Acceleration', value: a !== null && this.slid < 0.03 ? 0 : a, unit: 'm/s²' }]
      }
      case 'collision': {
        const after = this.collided !== null && this.time - this.collided > 0.1
        const e = this.energyNow()
        return [
          { label: 'Velocity 1 after', value: after ? this.body(0).vx : null, unit: 'm/s' },
          { label: 'Velocity 2 after', value: after ? this.body(1).vx : null, unit: 'm/s' },
          { label: 'Kinetic energy after', value: after ? e.kinetic : null, unit: 'J' }
        ]
      }
    }
  }

  /** Why the run has ended, or null while it goes on */
  done(): string | null {
    if (this.scene === 'projectile' && this.landed) return `Landed after ${this.landed.t.toFixed(2)} s`
    if (this.scene === 'incline') {
      const t = (this.p.angle * Math.PI) / 180
      if (this.slid >= SLOPE - 1.1 || (this.body(0).x > SLOPE * Math.cos(t) - 0.3 && this.slid > 0.5)) return `Reached the bottom after ${this.time.toFixed(2)} s`
      if (!inclineTheory(this.p).slides && this.time >= 2) return 'Friction holds the block'
      if (this.time >= 20) return 'Stopped after 20 s'
    }
    if (this.scene === 'collision') {
      const { meet } = collisionTheory(this.p)
      if (this.collided !== null && this.time - this.collided >= 1.5) return 'Collided'
      if (!meet && this.time >= 2) return 'They never meet: the one behind is not catching up'
      if (this.time >= 12) return 'Stopped after 12 s'
    }
    if ((this.scene === 'pendulum' || this.scene === 'spring') && this.time >= 120) return 'Stopped after two minutes'
    return null
  }
}

export const bobRadius = (mass: number, length: number) => Math.min(0.08 + 0.05 * Math.cbrt(mass), length * 0.15)
export const blockHalf = (mass: number) => 0.14 + 0.06 * Math.cbrt(mass)
export const ballRadius = (mass: number) => 0.22 * Math.cbrt(mass)
