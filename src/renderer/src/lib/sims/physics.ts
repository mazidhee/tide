/**
 * The "physics" simulation's spec, its scenes and the textbook predictions each scene is checked
 * against. Plain data and arithmetic only: the world itself is stepped by planck.js, a port of
 * Box2D (physicsWorld.ts), which is loaded only when a physics block is shown.
 *   scenes: projectile, pendulum, spring, incline, collision
 *   parts:  body (body:1, body:2 in a collision), velocity, energy, prediction, param:NAME,
 *           trail, rod, spring, slope, momentum
 */
import { num, onlyVerbs, pick, type Raw, type SimBase } from './specUtil'

export const SCENES = ['projectile', 'pendulum', 'spring', 'incline', 'collision'] as const
export type Scene = (typeof SCENES)[number]

export interface ParamDef {
  name: string
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
}

/** Each scene's parameters: what a slider shows, its default and its range */
export const PARAMS: Record<Scene, ParamDef[]> = {
  projectile: [
    { name: 'speed', label: 'Launch speed', unit: 'm/s', value: 15, min: 1, max: 40, step: 0.5 },
    { name: 'angle', label: 'Angle', unit: '°', value: 45, min: 0, max: 90, step: 1 },
    { name: 'height', label: 'Launch height', unit: 'm', value: 0, min: 0, max: 30, step: 0.5 },
    { name: 'g', label: 'Gravity g', unit: 'm/s²', value: 9.81, min: 0.5, max: 30, step: 0.01 }
  ],
  pendulum: [
    { name: 'length', label: 'Length', unit: 'm', value: 2, min: 0.2, max: 10, step: 0.1 },
    { name: 'angle', label: 'Release angle', unit: '°', value: 20, min: 1, max: 170, step: 1 },
    { name: 'mass', label: 'Mass', unit: 'kg', value: 1, min: 0.1, max: 10, step: 0.1 },
    { name: 'g', label: 'Gravity g', unit: 'm/s²', value: 9.81, min: 0.5, max: 30, step: 0.01 },
    { name: 'damping', label: 'Damping', unit: '/s', value: 0, min: 0, max: 1, step: 0.01 }
  ],
  spring: [
    { name: 'k', label: 'Stiffness k', unit: 'N/m', value: 20, min: 1, max: 400, step: 1 },
    { name: 'mass', label: 'Mass', unit: 'kg', value: 1, min: 0.1, max: 10, step: 0.1 },
    { name: 'stretch', label: 'Pulled out by', unit: 'm', value: 0.6, min: -1.2, max: 1.2, step: 0.05 },
    { name: 'damping', label: 'Damping c', unit: 'N·s/m', value: 0, min: 0, max: 20, step: 0.1 }
  ],
  incline: [
    { name: 'angle', label: 'Slope angle', unit: '°', value: 30, min: 0, max: 75, step: 1 },
    { name: 'friction', label: 'Friction μ', unit: '', value: 0.2, min: 0, max: 1.5, step: 0.01 },
    { name: 'mass', label: 'Mass', unit: 'kg', value: 2, min: 0.1, max: 20, step: 0.1 },
    { name: 'g', label: 'Gravity g', unit: 'm/s²', value: 9.81, min: 0.5, max: 30, step: 0.01 }
  ],
  collision: [
    { name: 'm1', label: 'Mass 1', unit: 'kg', value: 1, min: 0.1, max: 10, step: 0.1 },
    { name: 'm2', label: 'Mass 2', unit: 'kg', value: 1, min: 0.1, max: 10, step: 0.1 },
    { name: 'u1', label: 'Velocity 1', unit: 'm/s', value: 3, min: -8, max: 8, step: 0.1 },
    { name: 'u2', label: 'Velocity 2', unit: 'm/s', value: -1, min: -8, max: 8, step: 0.1 },
    { name: 'e', label: 'Restitution e', unit: '', value: 1, min: 0, max: 1, step: 0.01 }
  ]
}

/** Gravity on other worlds, by name: "g":"moon" */
export const PLANETS: Record<string, number> = { earth: 9.81, moon: 1.62, mars: 3.71, jupiter: 24.79, venus: 8.87, mercury: 3.7 }

export interface PhysicsSpec extends SimBase {
  kind: 'physics'
  scene: Scene
  params: Record<string, number>
  autoplay: boolean
}

const VERBS = ['set']

const SCENE_ALIASES: Record<string, Scene> = {
  projectiles: 'projectile',
  'projectile-motion': 'projectile',
  launch: 'projectile',
  cannon: 'projectile',
  'simple-pendulum': 'pendulum',
  'mass-spring': 'spring',
  oscillator: 'spring',
  'harmonic-oscillator': 'spring',
  shm: 'spring',
  ramp: 'incline',
  'inclined-plane': 'incline',
  slope: 'incline',
  collisions: 'collision',
  momentum: 'collision',
  carts: 'collision'
}

/** Names the model often uses for a parameter, to the scene's own name */
const PARAM_ALIASES: Record<string, string> = {
  v: 'speed',
  v0: 'speed',
  velocity: 'speed',
  theta: 'angle',
  h: 'height',
  gravity: 'g',
  l: 'length',
  m: 'mass',
  stiffness: 'k',
  x0: 'stretch',
  amplitude: 'stretch',
  displacement: 'stretch',
  mu: 'friction',
  μ: 'friction',
  restitution: 'e',
  c: 'damping'
}

export const paramDef = (scene: Scene, name: string) => PARAMS[scene].find((p) => p.name === name) ?? null

/** One parameter's value, checked against its scene: a number, a planet's name for g, or null */
export function readParam(scene: Scene, name: string, v: unknown): [string, number] | null {
  const key = PARAM_ALIASES[name.trim().toLowerCase()] ?? name.trim().toLowerCase()
  const def = paramDef(scene, key)
  if (!def) return null
  if (key === 'g' && typeof v === 'string' && PLANETS[v.trim().toLowerCase()] !== undefined) return [key, PLANETS[v.trim().toLowerCase()]]
  const n = num(v, NaN, def.min, def.max)
  return Number.isFinite(n) ? [key, n] : null
}

export function defaults(scene: Scene): Record<string, number> {
  return Object.fromEntries(PARAMS[scene].map((p) => [p.name, p.value]))
}

export function parsePhysicsSpec(raw: Raw, base: SimBase): PhysicsSpec {
  const scene = pick(raw.scene ?? raw.setup ?? raw.type, SCENES, 'projectile', SCENE_ALIASES)
  const params = defaults(scene)
  // Parameters may sit at the top level or under "params"
  const given = { ...raw, ...(raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params) ? (raw.params as Raw) : {}) }
  for (const [k, v] of Object.entries(given)) {
    const read = readParam(scene, k, v)
    if (read) params[read[0]] = read[1]
  }
  const spec: PhysicsSpec = { ...base, kind: 'physics', scene, params, autoplay: raw.autoplay !== false }
  // A tour's {"set":{...}} keeps only this scene's parameters
  for (const step of spec.tour) {
    const set = step.do?.set
    if (!set || typeof set !== 'object' || Array.isArray(set)) continue
    const kept: Record<string, number> = {}
    for (const [k, v] of Object.entries(set)) {
      const read = readParam(scene, k, v)
      if (read) kept[read[0]] = read[1]
    }
    if (Object.keys(kept).length) step.do!.set = kept
    else delete step.do!.set
  }
  return onlyVerbs(spec, VERBS)
}

// ---------- What the textbook says ----------

const rad = (deg: number) => (deg * Math.PI) / 180

export interface Prediction {
  /** What is predicted, in words, with the formula */
  label: string
  formula: string
  value: number
  unit: string
}

export interface ProjectileTheory {
  flightTime: number
  range: number
  maxHeight: number
}

/** A point mass launched from height h with no air: lands when h + v sinθ t − g t² / 2 = 0 */
export function projectileTheory(p: Record<string, number>): ProjectileTheory {
  const { speed: v, angle, height: h, g } = p
  const vx = v * Math.cos(rad(angle))
  const vy = v * Math.sin(rad(angle))
  const flightTime = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g
  return { flightTime, range: vx * flightTime, maxHeight: h + (vy * vy) / (2 * g) }
}

/** The arithmetic-geometric mean: a and b averaged both ways until they agree */
export function agm(a: number, b: number): number {
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]
  return a
}

/** Small-angle period 2π√(L/g), and the exact period at any release angle, 2π√(L/g) ÷ AGM(1, cos(θ₀/2)) */
export function pendulumTheory(p: Record<string, number>): { small: number; wide: number } {
  const small = 2 * Math.PI * Math.sqrt(p.length / p.g)
  return { small, wide: small / agm(1, Math.cos(rad(p.angle) / 2)) }
}

/** Period 2π√(m/k) of an undamped spring; with damping c, the damped period, or none when overdamped */
export function springTheory(p: Record<string, number>): { period: number; damped: number | null; ratio: number } {
  const w0 = Math.sqrt(p.k / p.mass)
  const ratio = p.damping / (2 * Math.sqrt(p.k * p.mass))
  return { period: (2 * Math.PI) / w0, damped: ratio < 1 ? (2 * Math.PI) / (w0 * Math.sqrt(1 - ratio * ratio)) : null, ratio }
}

/** Down the slope: a = g(sinθ − μ cosθ) when tanθ > μ; otherwise friction holds the block */
export function inclineTheory(p: Record<string, number>): { slides: boolean; acceleration: number } {
  const t = rad(p.angle)
  const a = p.g * (Math.sin(t) - p.friction * Math.cos(t))
  return { slides: Math.tan(t) > p.friction + 1e-9, acceleration: Math.max(0, a) }
}

/** One-dimensional collision with restitution e: momentum kept, closing speed times e is the parting speed */
export function collisionTheory(p: Record<string, number>): { meet: boolean; v1: number; v2: number; momentum: number; keBefore: number; keAfter: number } {
  const { m1, m2, u1, u2, e } = p
  const momentum = m1 * u1 + m2 * u2
  const meet = u1 > u2
  const v1 = meet ? (momentum + m2 * e * (u2 - u1)) / (m1 + m2) : u1
  const v2 = meet ? (momentum + m1 * e * (u1 - u2)) / (m1 + m2) : u2
  return { meet, v1, v2, momentum, keBefore: 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2, keAfter: 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2 }
}

export function predictions(scene: Scene, p: Record<string, number>): Prediction[] {
  switch (scene) {
    case 'projectile': {
      const t = projectileTheory(p)
      return [
        { label: 'Range', formula: 'vₓ · t', value: t.range, unit: 'm' },
        { label: 'Highest point', formula: 'h + v_y² ÷ 2g', value: t.maxHeight, unit: 'm' },
        { label: 'Time of flight', formula: '(v_y + √(v_y² + 2gh)) ÷ g', value: t.flightTime, unit: 's' }
      ]
    }
    case 'pendulum': {
      const t = pendulumTheory(p)
      return [
        { label: 'Period, small swings', formula: '2π √(L ÷ g)', value: t.small, unit: 's' },
        { label: 'Period at this angle', formula: '2π √(L ÷ g) ÷ AGM(1, cos(θ₀/2))', value: t.wide, unit: 's' }
      ]
    }
    case 'spring': {
      const t = springTheory(p)
      return [
        { label: 'Period', formula: '2π √(m ÷ k)', value: t.period, unit: 's' },
        ...(p.damping > 0 ? [{ label: 'Damping ratio ζ', formula: 'c ÷ 2√(km)', value: t.ratio, unit: '' }] : [])
      ]
    }
    case 'incline': {
      const t = inclineTheory(p)
      return [{ label: t.slides ? 'Acceleration down the slope' : 'Acceleration (friction holds it)', formula: 'g (sin θ − μ cos θ)', value: t.acceleration, unit: 'm/s²' }]
    }
    case 'collision': {
      const t = collisionTheory(p)
      return [
        { label: 'Velocity 1 after', formula: '(Σmu + m₂e(u₂ − u₁)) ÷ Σm', value: t.v1, unit: 'm/s' },
        { label: 'Velocity 2 after', formula: '(Σmu + m₁e(u₁ − u₂)) ÷ Σm', value: t.v2, unit: 'm/s' },
        { label: 'Kinetic energy after', formula: '½m₁v₁² + ½m₂v₂²', value: t.keAfter, unit: 'J' }
      ]
    }
  }
}

// ---------- Parts ----------

export type PhysicsPart =
  | { type: 'body'; i: number }
  | { type: 'velocity' | 'energy' | 'prediction' | 'trail' | 'rod' | 'spring' | 'slope' | 'momentum' }
  | { type: 'param'; name: string }

const SCENE_PARTS: Record<Scene, string[]> = {
  projectile: ['trail'],
  pendulum: ['rod'],
  spring: ['spring'],
  incline: ['slope'],
  collision: ['momentum']
}

export function parsePhysicsPart(name: string, scene: Scene): PhysicsPart | null {
  const [head, arg] = name.trim().toLowerCase().split(':')
  if (head === 'body' || head === 'ball' || head === 'bob' || head === 'block' || head === 'cart') {
    const i = arg === undefined ? 1 : Number(arg)
    const most = scene === 'collision' ? 2 : 1
    return Number.isInteger(i) && i >= 1 && i <= most ? { type: 'body', i } : null
  }
  if (head === 'param' && arg) return paramDef(scene, PARAM_ALIASES[arg] ?? arg) ? { type: 'param', name: PARAM_ALIASES[arg] ?? arg } : null
  if (head === 'gravity' || head === 'g') return paramDef(scene, 'g') ? { type: 'param', name: 'g' } : null
  if (arg !== undefined) return null
  if (head === 'velocity' || head === 'energy' || head === 'prediction') return { type: head }
  if (SCENE_PARTS[scene].includes(head)) return { type: head as 'trail' }
  return null
}

