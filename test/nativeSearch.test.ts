import { createHash } from 'crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
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
    expect((await first.search('complement negative'))[0]?.path).toBe('Maths/Binary.md')
    expect((await first.search('complment'))[0]?.path).toBe('Maths/Binary.md')
    // The start of a word matches only in a search box being typed into, never in a finished question
    expect((await first.search('hexa', 20, undefined, true)).some((h) => h.heading === 'Hexadecimal')).toBe(true)
    expect(await first.search('hexa')).toEqual([])
    expect((await first.searchHits('hexa'))[0]?.path).toBe('Maths/Binary.md')
    // Asked to index a file that hasn't changed: nothing is written
    const before = await first.search('complement negative')
    await first.reindexPath('Maths/Binary.md')
    expect(await first.search('complement negative')).toEqual(before)
    expect(await first.search('bits', 5, (p) => p === 'Maths/Primes.md')).toEqual([])
    expect((await first.getChunks('Maths/Binary.md')).map((c) => c.heading)).toEqual(['Binary', 'Hexadecimal'])
    expect((await first.getChunks('Maths/Binary.md', 1)).map((c) => c.heading)).toEqual(['Binary'])

    write('Maths/Primes.md', '# Primes\n\nThe sieve of Eratosthenes crosses out multiples.\n', Date.now() + 5000)
    await first.reindexPath('Maths/Primes.md')
    expect((await first.search('sieve'))[0]?.path).toBe('Maths/Primes.md')
    expect(await first.search('divisors')).toEqual([])

    rmSync(join(vault, 'Maths/Binary.md'))
    await first.reindexPath('Maths/Binary.md')
    expect(await first.search('complement')).toEqual([])
    expect(first.allChunkPaths()).toEqual(['Maths/Primes.md'])
    await new Promise((r) => setTimeout(r, 400))

    // A restart: nothing is read again, and search works straight away
    vi.resetModules()
    const again = await import('../src/main/search')
    expect((await again.search('sieve'))[0]?.path).toBe('Maths/Primes.md')
    const t0 = performance.now()
    await again.buildIndex()
    expect(performance.now() - t0).toBeLessThan(200)
    expect(again.allChunkPaths()).toEqual(['Maths/Primes.md'])
  })

  it('saves off the main thread, groups commits, and a search right after a save sees it', async () => {
    vi.resetModules()
    const s = await import('../src/main/search')
    await s.buildIndex()
    const manifestFile = join(root, 'search', createHash('sha1').update(vault).digest('hex').slice(0, 16), 'manifest.json')
    const saved = () => JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, string>
    write('Maths/Graphs.md', '# Graphs\n\nA spanning tree touches every vertex once.\n')
    await s.reindexPath('Maths/Graphs.md')
    // Not committed yet (that waits up to two seconds), so not yet in the saved list of what's indexed
    await new Promise((r) => setTimeout(r, 400))
    expect(saved()['Maths/Graphs.md']).toBeUndefined()
    // ...but a search straight away commits first, and finds it
    expect((await s.search('spanning vertex'))[0]?.path).toBe('Maths/Graphs.md')
    expect((await s.getChunks('Maths/Graphs.md')).map((c) => c.heading)).toEqual(['Graphs'])
    await new Promise((r) => setTimeout(r, 400))
    expect(saved()['Maths/Graphs.md']).toBeTruthy()
    // An edit and then a search, with no wait between them
    write('Maths/Graphs.md', '# Graphs\n\nDijkstra finds shortest paths.\n', Date.now() + 9000)
    await s.reindexPath('Maths/Graphs.md')
    expect((await s.search('dijkstra'))[0]?.path).toBe('Maths/Graphs.md')
    expect(await s.search('spanning vertex')).toEqual([])
    // Several saves, then one commit for all of them
    write('Maths/Sets.md', '# Sets\n\nA union joins two sets.\n')
    write('Maths/Logic.md', '# Logic\n\nA tautology is always true.\n')
    await Promise.all([s.reindexPath('Maths/Sets.md'), s.reindexPath('Maths/Logic.md')])
    await s.flushIndex()
    expect(saved()['Maths/Sets.md']).toBeUndefined() // the list is written 300 ms later
    expect((await s.search('tautology'))[0]?.path).toBe('Maths/Logic.md')
    expect((await s.search('union'))[0]?.path).toBe('Maths/Sets.md')
  })
})
