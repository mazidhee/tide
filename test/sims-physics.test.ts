// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { PARAMS, SCENES, collisionTheory, defaults, inclineTheory, parsePhysicsPart, predictions, projectileTheory } from '../src/renderer/src/lib/sims/physics'
import { PhysicsWorld } from '../src/renderer/src/lib/sims/physicsWorld'
import { load, mount } from '../src/renderer/src/lib/sims/runtime'
import { parseSim } from '../src/renderer/src/lib/sims/spec'
import type { PhysicsSpec } from '../src/renderer/src/lib/sims/physics'

const run = (w: PhysicsWorld, frames: number) => {
  for (let i = 0; i < frames && !w.done(); i++) w.step()
  return w
}

describe('physics: the spec', () => {
  it('reads a scene, its settings by any usual name, and a planet for g; clamps the rest', () => {
    const spec = parseSim('{"kind":"physics","scene":"projectile motion","v0":20,"theta":60,"gravity":"moon","height":-5}') as PhysicsSpec
    expect(spec.scene).toBe('projectile')
    expect(spec.params).toMatchObject({ speed: 20, angle: 60, g: 1.62, height: 0 })
    expect((parseSim('{"kind":"pendulum","length":3}') as PhysicsSpec).scene).toBe('pendulum')
    expect((parseSim('{"kind":"physics","scene":"ramp","params":{"mu":0.4}}') as PhysicsSpec).params.friction).toBe(0.4)
    // A tour keeps only this scene's settings
    const toured = parseSim('{"kind":"physics","scene":"spring","tour":[{"say":"a","do":{"set":{"k":50,"angle":3}}},{"say":"b","do":{"set":{"angle":3},"explode":1}}]}') as PhysicsSpec
    expect(toured.tour.map((s) => s.do)).toEqual([{ set: { k: 50 } }, undefined])
  })

  it('names each scene\'s parts and no others', () => {
    expect(parsePhysicsPart('body', 'pendulum')).toEqual({ type: 'body', i: 1 })
    expect(parsePhysicsPart('body:2', 'collision')).toEqual({ type: 'body', i: 2 })
    expect(parsePhysicsPart('body:2', 'projectile')).toBeNull()
    expect(parsePhysicsPart('rod', 'pendulum')).toEqual({ type: 'rod' })
    expect(parsePhysicsPart('rod', 'spring')).toBeNull()
    expect(parsePhysicsPart('param:theta', 'projectile')).toEqual({ type: 'param', name: 'angle' })
    expect(parsePhysicsPart('gravity', 'collision')).toBeNull()
  })
})

describe('physics: the engine against the formula', () => {
  it('a projectile lands where the formula says, within the engine\'s step', () => {
    for (const p of [defaults('projectile'), { ...defaults('projectile'), angle: 30, height: 10, g: 3.71 }]) {
      const t = projectileTheory(p)
      const w = run(new PhysicsWorld('projectile', p), 2000)
      expect(w.done()).toMatch(/^Landed/)
      expect(w.landed!.x).toBeCloseTo(t.range, 0)
      expect(Math.abs(w.landed!.x - t.range) / t.range).toBeLessThan(0.01)
      expect(Math.abs(w.peak - t.maxHeight)).toBeLessThan(0.05)
      expect(Math.abs(w.landed!.t - t.flightTime)).toBeLessThan(0.01)
    }
  })

  it('a pendulum swings with the exact period at any angle, and keeps nearly all its energy', () => {
    for (const angle of [10, 60, 120]) {
      const p = { ...defaults('pendulum'), angle }
      const w = run(new PhysicsWorld('pendulum', p), 600)
      const wide = predictions('pendulum', p)[1].value
      expect(Math.abs(w.period()! - wide) / wide, `${angle}°`).toBeLessThan(0.005)
      const e = w.energyNow()
      // Box2D's joint bleeds a little energy, more the wider the swing; the picture shows it as lost
      expect(e.lost / (e.total + e.lost), `${angle}°`).toBeLessThan(angle > 90 ? 0.02 : 0.005)
    }
  })

  it('a spring oscillates with period 2π√(m/k); damping takes energy out', () => {
    const p = { ...defaults('spring'), k: 50, mass: 2 }
    const w = run(new PhysicsWorld('spring', p), 600)
    expect(w.period()).toBeCloseTo(2 * Math.PI * Math.sqrt(2 / 50), 2)
    const damped = run(new PhysicsWorld('spring', { ...p, damping: 2 }), 600)
    expect(damped.energyNow().lost).toBeGreaterThan(0.5 * damped.energyNow().lost + damped.energyNow().total)
  })

  it('a block slides with a = g(sin θ − μ cos θ), or friction holds it', () => {
    const p = defaults('incline')
    const w = run(new PhysicsWorld('incline', p), 1200)
    expect(w.done()).toMatch(/^Reached the bottom/)
    expect(Math.abs(w.measured()[0].value! - inclineTheory(p).acceleration)).toBeLessThan(0.08)
    const held = run(new PhysicsWorld('incline', { ...p, friction: 0.8 }), 600)
    expect(held.done()).toBe('Friction holds the block')
    expect(held.measured()[0].value).toBe(0)
  })

  it('a collision keeps momentum and gives the velocities the formula does, for any e', () => {
    for (const e of [1, 0.5, 0]) {
      const p = { ...defaults('collision'), m1: 3, e }
      const t = collisionTheory(p)
      const w = run(new PhysicsWorld('collision', p), 1200)
      expect(w.done()).toBe('Collided')
      const [v1, v2, ke] = w.measured().map((m) => m.value!)
      expect(v1).toBeCloseTo(t.v1, 3)
      expect(v2).toBeCloseTo(t.v2, 3)
      expect(ke).toBeCloseTo(t.keAfter, 3)
      expect(w.momentum()).toBeCloseTo(t.momentum, 6)
    }
    expect(run(new PhysicsWorld('collision', { ...defaults('collision'), u1: -1, u2: 2 }), 600).done()).toMatch(/never meet/)
  })
})

describe('physics: mounted', () => {
  it('every scene mounts, plays, answers for its parts, takes a tour\'s settings and is destroyed', async () => {
    await load('physics')
    for (const scene of SCENES) {
      const spec = parseSim(JSON.stringify({ kind: 'physics', scene, tour: [{ at: 'prediction', say: 'x', do: { set: { [PARAMS[scene][0].name]: PARAMS[scene][0].max } } }] })) as PhysicsSpec
      const sim = mount(spec, (root) => document.body.append(root))
      expect(sim.root.querySelectorAll('canvas')).toHaveLength(2)
      expect(Array.from(sim.root.querySelectorAll('.sim-bar button'), (b) => b.textContent)).toEqual(['Play', 'Step', 'Reset'])
      expect(sim.root.querySelectorAll('input[type=range]')).toHaveLength(PARAMS[scene].length)
      const slider = sim.root.querySelector<HTMLInputElement>(`input[aria-label="${PARAMS[scene][0].label}"]`)!
      expect(Number(slider.value)).toBe(PARAMS[scene][0].max)
      for (let i = 0; i < 5; i++) sim.root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      expect(sim.root.querySelectorAll('.sim-table tbody tr').length).toBe(predictions(scene, defaults(scene)).length)
      sim.destroy()
      sim.root.remove()
    }
  })
})
