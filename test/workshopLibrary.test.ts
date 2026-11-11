import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { STAGE_RANGE, validateProject } from '../src/shared/workshop'

// The app's own sandbox runner and data lab, as in development
const userData = mkdtempSync(join(tmpdir(), 'tide-ud-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, getAppPath: () => process.cwd(), isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: userData, libraryFolder: 'Library', ai: {} }) }))

const { LIBRARY } = await import('../src/main/workshopLibrary')
const { proveProject } = await import('../src/main/workshop')

const only = process.env.WORKSHOP_ONLY
const projects = only ? LIBRARY.filter((p) => only.split(',').includes(p.id)) : LIBRARY

describe('the library of guided projects', () => {
  it.skipIf(!!only)('has at least twelve projects across the areas, each with its own id', () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(12)
    expect(new Set(LIBRARY.map((p) => p.id)).size).toBe(LIBRARY.length)
    for (const area of ['systems', 'c-cpp', 'python', 'distributed', 'databases', 'data', 'ml', 'algorithms']) expect(LIBRARY.some((p) => p.area === area), area).toBe(true)
    for (const lang of ['python', 'javascript', 'c', 'cpp', 'sql']) expect(LIBRARY.some((p) => p.languages.includes(lang as never)), lang).toBe(true)
  })

  for (const p of projects) {
    describe(`${p.id} (${p.languages.join(', ')}, ${p.stages.length} stages)`, () => {
      it('is well formed', () => {
        expect(validateProject(p)).toEqual([])
        expect(p.stages.length).toBeGreaterThanOrEqual(STAGE_RANGE.min)
        expect(p.stages.length).toBeLessThanOrEqual(STAGE_RANGE.max)
        for (const s of p.stages) {
          expect(s.recall, `${s.id} has a question to bring back`).toBeTruthy()
          // The contract is the brief: every starting file a stage names is one its brief mentions
          for (const f of s.files) expect(s.brief + p.stages[0].brief, `${s.id} brief names ${f.path}`).toContain(f.path.split('/').pop()!)
        }
      })

      const needsClang = p.languages.some((l) => l === 'c' || l === 'cpp')
      it.skipIf(needsClang && !existsSync('/usr/bin/clang'))(
        'its reference solution passes every test, and its starting files fail in every stage',
        async () => {
          const proof = await proveProject(p)
          expect(proof.problems).toEqual([])
          expect(proof.ok).toBe(true)
          const total = p.stages.reduce((n, s) => n + s.tests.length, 0)
          expect(proof.solution!.tests).toHaveLength(total)
          expect(proof.solution!.tests.every((t) => t.status === 'pass')).toBe(true)
          // Every failure a learner would meet first comes with words, not a bare "failed"
          for (const t of proof.starter!.tests) if (t.status === 'fail') expect((t.message ?? '').length, `${t.name} says why`).toBeGreaterThan(10)
          console.log(`  proved ${p.id}: ${total}/${total} tests pass with the reference solution in ${proof.solution!.durationMs} ms; starting files: ${proof.starter!.error ? 'do not build' : `${proof.starter!.tests.filter((t) => t.status === 'pass').length}/${total} pass`}`)
        },
        120_000
      )
    })
  }
})
