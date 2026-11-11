import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-router-'))
vi.mock('electron', () => ({ app: { getPath: () => dir }, safeStorage: { isEncryptionAvailable: () => false } }))
const { noteOutcome, noteReviewed, score } = await import('../src/main/cloud')

const times = (n: number, run: () => void) => Array.from({ length: n }, run)

describe('choosing a cloud model by what it has done', () => {
  it('puts a model that keeps failing behind one it has never tried', () => {
    const failing = { provider: 'nvidia', model: 'always-times-out' }
    times(10, () => noteOutcome(failing, 'maths', false, 250_000))
    // First in line, but it has answered nothing in ten tries, four minutes each
    expect(score(failing, 'maths', 0)).toBeLessThan(score({ provider: 'gemini', model: 'never-tried' }, 'maths', 4) / 5)
  })

  it('prefers the one that answers, then the one that answers sooner', () => {
    const reliable = { provider: 'a', model: 'reliable' }
    const flaky = { provider: 'a', model: 'flaky' }
    const slow = { provider: 'a', model: 'slow' }
    times(20, () => noteOutcome(reliable, 'marking', true, 5_000))
    times(20, () => noteOutcome(slow, 'marking', true, 90_000))
    times(11, () => noteOutcome(flaky, 'marking', true, 5_000))
    times(9, () => noteOutcome(flaky, 'marking', false, 5_000))
    expect(score(reliable, 'marking', 1)).toBeGreaterThan(score(flaky, 'marking', 0))
    expect(score(reliable, 'marking', 1)).toBeGreaterThan(score(slow, 'marking', 0))
  })

  it('counts work that failed review against the model that wrote it', () => {
    const careful = { provider: 'b', model: 'careful' }
    const sloppy = { provider: 'b', model: 'sloppy' }
    for (const m of [careful, sloppy]) times(12, () => noteOutcome(m, 'maths', true, 10_000))
    noteReviewed(careful, 'maths', 11, 12)
    noteReviewed(sloppy, 'maths', 4, 12)
    expect(score(careful, 'maths', 1)).toBeGreaterThan(score(sloppy, 'maths', 0))
  })

  it('keeps your order between models with nothing to tell them apart', () => {
    expect(score({ provider: 'c', model: 'one' }, 'planning', 0)).toBeGreaterThan(score({ provider: 'c', model: 'two' }, 'planning', 1))
  })

  it('judges each job on its own', () => {
    const m = { provider: 'd', model: 'good-at-marking' }
    times(15, () => noteOutcome(m, 'marking', true, 4_000))
    times(15, () => noteOutcome(m, 'maths', false, 60_000))
    expect(score(m, 'marking', 0)).toBeGreaterThan(score(m, 'maths', 0) * 4)
  })
})
