import { describe, expect, it, vi } from 'vitest'
import { capabilityGaps, capabilityNote, type CapabilityStatus } from '../src/shared/capability'
import { profileSubject } from '../src/shared/subjects'
import { resolveProfile, type ResolveDeps, type StoredProfile } from '../src/main/subjectResolve'

const lang = (id: string, name: string, ready: boolean, install = '') => ({ id, name, ready, install })
const ALL_HERE: CapabilityStatus = {
  languages: [lang('python', 'Python', true), lang('c', 'C', true), lang('rust', 'Rust', true), lang('go', 'Go', true), lang('swift', 'Swift', true), lang('java', 'Java', true), lang('ruby', 'Ruby', true)],
  maths: true,
  labPack: true,
  web: true
}
const gaps = (topic: string, s: CapabilityStatus = ALL_HERE) => capabilityGaps(topic, profileSubject(topic), s).map((g) => g.need)

describe('capability honesty', () => {
  it('says nothing when Tide can do it all', () => {
    for (const t of ['Projectile motion', 'Pointers in C', 'Stoicism', 'The Cold War', 'Clearing and settlement', 'Music theory: cadences', 'Organic chemistry: SN1 and SN2 reactions']) expect(gaps(t), t).toEqual([])
    expect(capabilityNote('Stoicism', profileSubject('Stoicism'), ALL_HERE)).toBe('')
  })

  it('names a lab practical, and offers data, the numbers in Python and the method instead', () => {
    const [g] = capabilityGaps('Acid-base titration practical', profileSubject('Acid-base titration practical'), ALL_HERE)
    expect(g.need).toBe('wet-lab')
    expect(g.line).toMatch(/can't run a wet-lab experiment/)
    expect(g.line).toMatch(/published data|simulation|method/)
    expect(gaps('Measuring g with a pendulum experiment')).toEqual(['wet-lab'])
  })

  it('names a physical skill and offers a practice plan', () => {
    const [g] = capabilityGaps('Learn the piano', profileSubject('Learn the piano'), ALL_HERE)
    expect(g.need).toBe('body')
    expect(g.line).toMatch(/practice plan/)
    expect(gaps('Marathon training')).toEqual(['body'])
    expect(gaps('Learn the piano')).toEqual(['body'])
  })

  it('names a language whose toolchain is missing, with what to install', () => {
    const noRust: CapabilityStatus = { ...ALL_HERE, languages: [lang('python', 'Python', true), lang('rust', 'Rust', false, 'Rust. Install it from https://rustup.rs')] }
    const [g] = capabilityGaps('Rust ownership and borrowing', profileSubject('Rust ownership and borrowing'), noRust)
    expect(g.need).toBe('lang:rust')
    expect(g.line).toMatch(/Rust isn't installed on this Mac/)
    expect(g.line).toMatch(/rustup\.rs/)
    expect(gaps('Rust ownership and borrowing')).toEqual([])
    expect(gaps('Haskell type classes')).toEqual(['lang:haskell'])
    // SWIFT the network is not Swift the language
    expect(gaps('SWIFT messages', { ...ALL_HERE, languages: [lang('swift', 'Swift', false)] })).toEqual([])
    expect(gaps('JavaScript closures', { ...ALL_HERE, languages: [lang('java', 'Java', false)] })).toEqual([])
  })

  it('names live market data and offers a dataset in the lab', () => {
    const [g] = capabilityGaps('Day trading with live prices', profileSubject('Day trading with live prices'), ALL_HERE)
    expect(g.need).toBe('live-data')
    expect(g.line).toMatch(/historical dataset .*SQL lab/)
    expect(gaps('Corporate finance: NPV and IRR')).toEqual([])
  })

  it('names an engine, a GPU or hardware only when the topic needs it', () => {
    expect(gaps('Game development with Godot')).toEqual(['engine'])
    expect(gaps('Game loop')).toEqual([])
    expect(gaps('CUDA kernels')).toEqual(['gpu'])
    expect(gaps('Arduino and microcontrollers')).toEqual(['hardware'])
  })

  it('names what is not set up: the maths checker for a calculation subject, the lab pack for PyTorch', () => {
    expect(gaps('Projectile motion', { ...ALL_HERE, maths: false })).toEqual(['maths'])
    expect(gaps('Stoicism', { ...ALL_HERE, maths: false })).toEqual([])
    expect(gaps('Training loops in PyTorch', { ...ALL_HERE, labPack: false })).toEqual(['lab-pack'])
  })

  it('is one line each, to say once', () => {
    const note = capabilityNote('Learn the piano', profileSubject('Learn the piano'), ALL_HERE)
    expect(note).toMatch(/^What Tide can't do for this topic\. Say it once/)
    expect(note.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1)
  })
})

describe('deciding a profile once', () => {
  const store = () => {
    let kept: Record<string, StoredProfile> = {}
    const ask = vi.fn(async () => '{"kinds":["domain","quant"],"lab":true,"needs":[]}')
    const deps: ResolveDeps = { ask, load: async () => ({ ...kept }), save: async (all) => void (kept = all) }
    return { deps, ask, kept: () => kept }
  }

  it('uses the map without asking the model', async () => {
    const s = store()
    expect((await resolveProfile('Projectile motion', s.deps)).kinds).toEqual(['quant'])
    expect(s.ask).not.toHaveBeenCalled()
  })

  it('asks the model once for a topic the map cannot place, keeps the answer, and reads it back', async () => {
    const s = store()
    const first = await resolveProfile('Zorblax fundamentals', s.deps)
    expect(first).toMatchObject({ kinds: ['domain', 'quant'], from: 'model', lab: true })
    expect(s.kept()['zorblax-fundamentals'].kinds).toBe('domain, quant')
    const again = await resolveProfile('Zorblax fundamentals', s.deps)
    expect(again.kinds).toEqual(['domain', 'quant'])
    expect(s.ask).toHaveBeenCalledTimes(1)
    expect(s.ask.mock.calls[0][0]).toMatch(/JSON schema/)
  })

  it('finds a kept profile by its roadmap', async () => {
    const s = store()
    await resolveProfile('Zorblax', s.deps)
    expect((await resolveProfile('Week 2: setup', { ...s.deps }, { notebook: 'Learning/Zorblax' })).kinds).toEqual(['domain', 'quant'])
    expect(s.ask).toHaveBeenCalledTimes(1)
  })

  it('asks the model about any topic (no private gate), and stays unclear on a bad, failed or slow answer', async () => {
    const s = store()
    await resolveProfile('Zorblax', s.deps, { private: true } as never)
    expect(s.ask).toHaveBeenCalledTimes(1)
    const bad: ResolveDeps = { ...s.deps, ask: async () => '{"kinds":["wizardry"]}' }
    expect((await resolveProfile('Quuxing', bad)).from).toBe('unclear')
    const down: ResolveDeps = { ...s.deps, ask: async () => Promise.reject(new Error('no cloud')) }
    expect((await resolveProfile('Quuxing', down)).from).toBe('unclear')
    const slow: ResolveDeps = { ...s.deps, ask: (_s, _p, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')))) }
    expect((await resolveProfile('Quuxing', slow, { timeoutMs: 20 })).from).toBe('unclear')
    expect(s.kept()['quuxing']).toBeUndefined()
  })
})
