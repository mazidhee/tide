import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'tide-native-'))
const vault = join(root, 'vault')
mkdirSync(join(vault, 'Maths'), { recursive: true })
vi.mock('electron', () => ({ app: { getPath: () => root } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const write = (rel: string, text: string, at = Date.now()) => {
  writeFileSync(join(vault, rel), text)
  utimesSync(join(vault, rel), at / 1000, at / 1000)
}

describe('the Rust search index', () => {
  it('finds passages, follows edits and deletions, and is ready at once after a restart', async () => {
    write('Maths/Binary.md', "# Binary\n\nTwo's complement stores a negative number by inverting the bits and adding one.\n\n## Hexadecimal\n\nEach hex digit is four bits.\n")
    write('Maths/Primes.md', '# Primes\n\nA prime has exactly two divisors.\n')
    const first = await import('../src/main/search')
    await first.buildIndex()
    expect(first.searchEngine()).toBe('tantivy')
    expect(first.search('complement negative')[0]?.path).toBe('Maths/Binary.md')
    expect(first.search('complment')[0]?.path).toBe('Maths/Binary.md')
    expect(first.search('hexa').some((h) => h.heading === 'Hexadecimal')).toBe(true)
    expect(first.search('bits', 5, (p) => p === 'Maths/Primes.md')).toEqual([])
    expect(first.getChunks('Maths/Binary.md').map((c) => c.heading)).toEqual(['Binary', 'Hexadecimal'])
    expect(first.getChunks('Maths/Binary.md', 1).map((c) => c.heading)).toEqual(['Binary'])

    write('Maths/Primes.md', '# Primes\n\nThe sieve of Eratosthenes crosses out multiples.\n', Date.now() + 5000)
    await first.reindexPath('Maths/Primes.md')
    expect(first.search('sieve')[0]?.path).toBe('Maths/Primes.md')
    expect(first.search('divisors')).toEqual([])

    rmSync(join(vault, 'Maths/Binary.md'))
    await first.reindexPath('Maths/Binary.md')
    expect(first.search('complement')).toEqual([])
    expect(first.allChunkPaths()).toEqual(['Maths/Primes.md'])
    await new Promise((r) => setTimeout(r, 400))

    // A restart: nothing is read again, and search works straight away
    vi.resetModules()
    const again = await import('../src/main/search')
    expect(again.search('sieve')[0]?.path).toBe('Maths/Primes.md')
    const t0 = performance.now()
    await again.buildIndex()
    expect(performance.now() - t0).toBeLessThan(200)
    expect(again.allChunkPaths()).toEqual(['Maths/Primes.md'])
  })
})
