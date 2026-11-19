// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { narrationPieces } from '../src/shared/narration'
import type { LectureState } from '../src/shared/types'

/**
 * A narrated tour, with the voice faked: the window's lecture player (lib/lecture) is replaced by
 * one that records what it was asked to say and what the simulation showed at that moment.
 */
const said: { from: number; to: number; count: string; say: string; tree: string }[] = []
let release: (() => void) | null = null
let holdStep = -1
const view: { states: Record<string, LectureState>; playing: null | { id: string; piece: number; paused: boolean } } = { states: {}, playing: null }
const fake = {
  narrate: vi.fn(async (says: string[]) => {
    const st: LectureState = { id: 'n1', phase: 'done', startedAt: 0, pieces: narrationPieces(says).map((p) => ({ text: p.text, step: p.step, engine: 'fish' as const, ready: true, ms: 100, secs: 2 })) }
    view.states[st.id] = st
    return st
  }),
  whenReady: vi.fn(async () => true),
  playRange: vi.fn(async (id: string, from: number, to: number) => {
    const root = document.querySelector('figure.sim')!
    said.push({ from, to, count: root.querySelector('.sim-tour-count')!.textContent!, say: root.querySelector('.sim-tour-say')!.textContent!, tree: root.getAttribute('data-narrating') ?? '' })
    view.playing = { id, piece: from, paused: false }
    if (view.states[id].pieces[from].step === holdStep) await new Promise<void>((r) => (release = r))
    view.playing = null
    return true
  }),
  current: () => view,
  subscribe: () => () => undefined,
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn()
}
vi.mock('../src/renderer/src/lib/lecture', () => fake)

const { mount, parseSim } = await import('../src/renderer/src/lib/sims/runtime')

const TOUR = [
  { at: 'order', say: 'Order 3: a node holds one or two keys.' },
  { at: 'key:150', say: 'Insert 150 and watch where it lands.', do: { insert: 150 } },
  { at: 'key:80', say: 'Now delete 80, which sits in the root.', do: { delete: 80 } }
]
const spec = () => parseSim(JSON.stringify({ kind: 'b-tree', order: 3, keys: [10, 20, 30, 40, 50, 60, 70, 80, 90], tour: TOUR }))!
const btn = (root: Element, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text && !b.hidden)
const until = async (ok: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20))
  expect(ok()).toBe(true)
}

beforeEach(() => {
  ;(window as unknown as { tide: unknown }).tide = { lecture: {} }
  said.length = 0
  holdStep = -1
  release = null
  Object.values(fake).forEach((f) => (typeof f === 'function' && 'mockClear' in f ? (f as ReturnType<typeof vi.fn>).mockClear() : undefined))
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('sims: a narrated tour', () => {
  it('offers Narrate only where the professor can speak', () => {
    delete (window as unknown as { tide?: unknown }).tide
    const sim = mount(spec(), (root) => document.body.append(root))
    expect(btn(sim.root, 'Narrate')).toBeUndefined()
    sim.destroy()
  })

  it('says each step as the simulation shows it, in order, from the top', async () => {
    const sim = mount(spec(), (root) => document.body.append(root))
    // Somewhere in the middle of the tour: Narrate still starts it from the top
    btn(sim.root, 'Next')!.click()
    btn(sim.root, 'Narrate')!.click()
    await until(() => sim.root.getAttribute('data-narrating') === 'idle' && said.length === 3)
    expect(fake.narrate).toHaveBeenCalledWith(TOUR.map((t) => t.say))
    expect(said.map((s) => s.count)).toEqual(['1 / 3', '2 / 3', '3 / 3'])
    expect(said.map((s) => s.say)).toEqual(TOUR.map((t) => t.say))
    expect(said.every((s) => s.tree === 'playing')).toBe(true)
    expect(btn(sim.root, 'Narrate')).toBeTruthy()
    sim.destroy()
  })

  it('pauses and resumes the voice and the simulation together, and goes on from where you move to', async () => {
    holdStep = 1
    const sim = mount(spec(), (root) => document.body.append(root))
    btn(sim.root, 'Narrate')!.click()
    await until(() => said.length === 2)
    btn(sim.root, 'Pause')!.click()
    expect(fake.pause).toHaveBeenCalled()
    expect(sim.root.getAttribute('data-narrating')).toBe('paused')
    expect(btn(sim.root, 'Resume')).toBeTruthy()
    btn(sim.root, 'Resume')!.click()
    expect(fake.resume).toHaveBeenCalled()
    expect(sim.root.getAttribute('data-narrating')).toBe('playing')
    // Next while step 2 is being said: on to step 3 at once
    holdStep = -1
    btn(sim.root, 'Next')!.click()
    release?.()
    await until(() => sim.root.getAttribute('data-narrating') === 'idle')
    expect(said.map((s) => s.count)).toEqual(['1 / 3', '2 / 3', '3 / 3'])
    sim.destroy()
  })

  it('stops when asked, leaving the tour where it is', async () => {
    holdStep = 0
    const sim = mount(spec(), (root) => document.body.append(root))
    btn(sim.root, 'Narrate')!.click()
    await until(() => said.length === 1)
    btn(sim.root, 'Stop')!.click()
    expect(sim.root.getAttribute('data-narrating')).toBe('idle')
    release?.()
    await new Promise((r) => setTimeout(r, 700))
    expect(said).toHaveLength(1)
    sim.destroy()
  })
})
