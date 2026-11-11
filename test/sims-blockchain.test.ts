import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BATCH,
  CHAIN_LIMITS,
  Chain,
  ZERO,
  cleanData,
  describeBlockchainPart,
  fmt,
  expectedTries,
  meets,
  parseBlockchainPart,
  preimage,
  sha256Hex,
  type Block,
  type BlockchainSpec
} from '../src/renderer/src/lib/sims/chain'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

const spec = (o: object = {}) => parseSim(JSON.stringify({ kind: 'blockchain', ...o })) as BlockchainSpec
const ready = async (o: object = {}) => {
  const chain = new Chain(spec(o))
  await chain.mine(0)
  return chain
}
const words = (chain: Chain) => chain.main().map((b) => chain.status(b))
const picture = (chain: Chain) => chain.blocks.map((b) => `${b.height}:${b.miner}:${b.nonce}:${b.hash}:${b.parent}`)
/** Runs rounds until the two miners are on different blocks */
const forked = async (o: object = {}) => {
  const chain = await ready(o)
  expect(await chain.fork()).toBe(true)
  for (let i = 0; i < 5000 && chain.forcing; i++) await chain.round()
  return chain
}

describe('blockchain: hashing', () => {
  it('gives the known SHA-256 vectors', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('π is UTF-8')).toBe(createHash('sha256').update('π is UTF-8', 'utf8').digest('hex'))
  })

  it('hashes exactly height|previous hash|difficulty|miner|data|nonce', async () => {
    expect(preimage({ height: 2, prev: 'ab', difficulty: 2, miner: 'A', data: 'Ada pays Bo 5', nonce: 17 })).toBe('2|ab|2|A|Ada pays Bo 5|17')
    const chain = await ready()
    for (const b of chain.blocks) {
      const source = `${b.height}|${b.prev}|${b.difficulty}|${b.miner}|${b.data}|${b.nonce}`
      expect(preimage(b)).toBe(source)
      // What shasum would print for the same bytes
      expect(b.hash).toBe(createHash('sha256').update(source, 'utf8').digest('hex'))
    }
    expect(chain.blocks[0].prev).toBe(ZERO)
    expect(ZERO).toHaveLength(64)
  })

  it('knows what meeting the difficulty means', () => {
    expect(meets('00ab', 2)).toBe(true)
    expect(meets('0a0b', 2)).toBe(false)
    expect(meets('0a0b', 1)).toBe(true)
    expect([1, 2, 3, 4].map(expectedTries)).toEqual([16, 256, 4096, 65536])
  })
})

describe('blockchain: proof of work', () => {
  it('mines starting blocks whose nonce is the first that meets the target, and counts the tries', async () => {
    for (const difficulty of [1, 2]) {
      const chain = await ready({ difficulty, blocks: ['Genesis', 'Ada pays Bo 5', 'Bo pays Cy 2', 'Cy pays Di 1'] })
      expect(chain.ready).toBe(true)
      expect(chain.blocks).toHaveLength(4)
      let total = 0
      for (const b of chain.blocks) {
        expect(meets(b.hash, difficulty)).toBe(true)
        expect(b.tries).toBe(b.nonce + 1)
        for (let n = 0; n < b.nonce; n++) expect(meets(await sha256Hex(preimage({ ...b, nonce: n })), difficulty)).toBe(false)
        total += b.tries
      }
      expect(chain.totalTries).toBe(total)
      expect(chain.main().map((b) => b.height)).toEqual([1, 2, 3, 4])
      expect(chain.blocks.map((b) => b.miner)).toEqual(['A', 'B', 'A', 'B'])
      expect(words(chain)).toEqual(['valid', 'valid', 'valid', 'valid'])
      expect(chain.firstBroken()).toBeNull()
      for (const b of chain.blocks.slice(1)) expect(b.prev).toBe(chain.blocks[b.id - 1].hash)
      expect(chain.says).toBe(`The chain is ready: 4 blocks, each hash starting with ${'0'.repeat(difficulty)}, found in ${chain.blocks.slice(0, 3).map((b) => fmt(b.tries)).join(', ')} and ${fmt(chain.blocks[3].tries)} tries (about ${fmt(16 ** difficulty)} expected each). A and B now both work on block 5.`)
    }
  })

  it('two miners race: the first success in order of tries wins, and both move on', async () => {
    const chain = await ready({ difficulty: 2 })
    const [a, b] = chain.miners
    const before = chain.totalTries
    let rounds = 0
    while (chain.height < 4) {
      await chain.round()
      rounds++
      if (chain.height < 4) {
        // A round without a block spends the whole batch for each miner
        expect(a.cand!.tries).toBe(rounds * BATCH[2])
        expect(b.cand!.tries).toBe(rounds * BATCH[2])
        expect(a.cand!.last).toBe(rounds * BATCH[2] - 1)
        expect(chain.says).toMatch(/no hash starts with 00, so no block yet/)
      }
    }
    const block = chain.main()[3]
    expect(block.height).toBe(4)
    expect(block.parent).toBe(2)
    expect(meets(block.hash, 2)).toBe(true)
    expect(block.hash).toBe(await sha256Hex(preimage(block)))
    // The winner's earlier nonces all failed, and so did the loser's up to the same try
    const loser = block.miner === 'A' ? 'B' : 'A'
    for (let n = 0; n < block.nonce; n++) expect(meets(await sha256Hex(preimage({ ...block, nonce: n })), 2)).toBe(false)
    for (let n = 0; n < block.nonce; n++) expect(meets(await sha256Hex(preimage({ ...block, miner: loser, nonce: n })), 2)).toBe(false)
    expect(block.tries).toBe(block.nonce + 1)
    expect(chain.totalTries).toBe(before + 2 * block.tries)
    expect(a.tip).toBe(block.id)
    expect(b.tip).toBe(block.id)
    expect(chain.forkOpen).toBe(false)
    expect(chain.says).toContain(`${block.miner} found block 4: nonce ${block.nonce}`)
  })

  it('is the same chain every time from the same spec, whatever else is going on', async () => {
    const run = async () => {
      const chain = new Chain(spec({ difficulty: 2, seed: 4 }))
      // Overlapping calls are queued, not interleaved
      await Promise.all([chain.round(), chain.round(), chain.mine(3), chain.round()])
      await chain.tamper(2)
      await chain.mend(9)
      await chain.fork()
      await chain.mine(2)
      return chain
    }
    const [one, two] = await Promise.all([run(), run()])
    expect(picture(one)).toEqual(picture(two))
    expect(one.events).toEqual(two.events)
    expect(one.totalTries).toBe(two.totalTries)
    // The seed only chooses the data of new blocks
    const plain = new Chain(spec({ difficulty: 2, seed: 4 }))
    const other = new Chain(spec({ difficulty: 2, seed: 5 }))
    await Promise.all([plain.mine(3), other.mine(3)])
    expect(picture(other).slice(0, 3)).toEqual(picture(plain).slice(0, 3))
    expect(other.main().slice(3).map((b) => b.data)).not.toEqual(plain.main().slice(3).map((b) => b.data))
  })

  it('applies a new difficulty to new blocks only', async () => {
    const chain = await ready({ difficulty: 1 })
    expect(await chain.setDifficulty(2)).toBe(true)
    expect(await chain.setDifficulty(2)).toBe(false)
    expect(await chain.setDifficulty(9)).toBe(true)
    expect(chain.difficulty).toBe(4)
    await chain.setDifficulty(2)
    await chain.mine(1)
    expect(chain.main().map((b) => b.difficulty)).toEqual([1, 1, 1, 2])
    expect(words(chain)).toEqual(['valid', 'valid', 'valid', 'valid'])
    expect(chain.main()[3].work).toBe(16 * 3 + 256)
  })
})

describe('blockchain: tampering', () => {
  it('invalidates the block, breaks the next link and leaves every later block unsupported', async () => {
    for (const k of [1, 2, 3, 4]) {
      const chain = await ready({ difficulty: 2, blocks: ['a', 'b', 'c', 'd', 'e'] })
      const before = chain.main().map((b) => b.hash)
      expect(await chain.tamper(k, 'changed')).toBe(true)
      const main = chain.main()
      const b = main[k - 1]
      expect(b.data).toBe('changed')
      expect(b.hash).toBe(await sha256Hex(preimage(b)))
      expect(b.hash).not.toBe(before[k - 1])
      // Hashes of the other blocks are untouched: it is their standing that changed
      main.forEach((x, i) => i !== k - 1 && expect(x.hash).toBe(before[i]))
      const lucky = meets(b.hash, 2)
      expect(words(chain)).toEqual(main.map((_, i) => (i < k - 1 ? 'valid' : i === k - 1 ? (lucky ? 'valid' : 'invalid') : i === k ? 'unlinked' : 'unsupported')))
      expect(chain.linkOk(main[k])).toBe(false)
      for (const x of main.slice(k + 1)) expect(chain.linkOk(x) && chain.sealOk(x)).toBe(true)
      expect(chain.firstBroken()?.height).toBe(lucky ? k + 1 : k)
      expect(chain.says).toContain(`Block ${k}'s data changed`)
    }
  })

  it('is undone by putting the data back', async () => {
    const chain = await ready()
    const was = chain.main()[1].data
    await chain.tamper(2)
    expect(chain.main()[1].data).toBe('Ada pays Bo 500')
    expect(chain.firstBroken()).not.toBeNull()
    expect(await chain.tamper(2, was)).toBe(true)
    expect(chain.firstBroken()).toBeNull()
    expect(await chain.tamper(2, was)).toBe(false)
    expect(await chain.tamper(2, '   ')).toBe(false)
    expect(await chain.tamper(9)).toBe(false)
    expect(chain.main()[1].data).toBe(was)
  })

  it('is repaired one block at a time, each repair breaking the next link, with the cost counted', async () => {
    const chain = await ready({ difficulty: 2, blocks: ['a', 'b', 'c', 'd'] })
    const minedFor = chain.totalTries
    await chain.tamper(2, 'changed')
    if (chain.sealOk(chain.main()[1])) return
    expect(words(chain)).toEqual(['valid', 'invalid', 'unlinked', 'unsupported'])
    // Steps now go into the broken block, not into new ones
    await chain.round()
    expect(chain.height).toBe(4)
    expect(chain.repair?.height ?? 2).toBe(2)
    expect(chain.says).toMatch(/^(Mining block 2 again|Block 2 is repaired)/)

    await chain.mend(2)
    expect(words(chain)).toEqual(['valid', 'valid', 'unlinked', 'unsupported'])
    const second = chain.main()[1]
    expect(second.remined).toBe(1)
    expect(second.tries).toBe(second.nonce + 1)
    for (let n = 0; n < second.nonce; n++) expect(meets(await sha256Hex(preimage({ ...second, nonce: n })), 2)).toBe(false)
    expect(chain.rewriteTries).toBe(second.tries)
    expect(chain.says).toContain('But block 3 still records the old hash of block 2')

    await chain.mend(3)
    expect(words(chain)).toEqual(['valid', 'valid', 'valid', 'unlinked'])
    expect(chain.main()[2].prev).toBe(second.hash)
    await chain.mend(4)
    expect(words(chain)).toEqual(['valid', 'valid', 'valid', 'valid'])
    expect(chain.firstBroken()).toBeNull()
    const main = chain.main()
    expect(chain.rewriteTries).toBe(main[1].tries + main[2].tries + main[3].tries)
    expect(chain.totalTries).toBe(minedFor + chain.rewriteTries)
    expect(chain.says).toContain(`Every block is valid again. Rewriting history cost ${fmt(chain.rewriteTries)} hashes`)
    for (const b of main) expect(b.hash).toBe(await sha256Hex(preimage(b)))
    // The miners pick up on the repaired tip
    await chain.mine(1)
    expect(chain.main()[4].prev).toBe(main[3].hash)
    expect(words(chain)).toEqual(['valid', 'valid', 'valid', 'valid', 'valid'])
  })

  it('mends everything up to the block asked for, in turn', async () => {
    const chain = await ready({ difficulty: 1, blocks: ['a', 'b', 'c', 'd', 'e'] })
    await chain.tamper(1, 'z')
    await chain.tamper(3, 'y')
    await chain.mend(5)
    expect(words(chain)).toEqual(['valid', 'valid', 'valid', 'valid', 'valid'])
    expect(chain.main().map((b) => b.data)).toEqual(['z', 'b', 'y', 'd', 'e'])
  })
})

describe('blockchain: forks and the longest chain', () => {
  it('a forced fork gives two valid blocks at one height on one parent', async () => {
    const chain = new Chain(spec({ difficulty: 2 }))
    await chain.mine(0)
    expect(await chain.fork()).toBe(true)
    expect(await chain.fork()).toBe(false)
    let sawHeld = false
    for (let i = 0; i < 5000 && chain.forcing; i++) {
      await chain.round()
      if (chain.forcing && chain.blocks.length === 4) {
        // One has a block; the other has not heard and is still on the parent
        sawHeld = true
        const holder = chain.miners.find((m) => m.held !== null)!
        const waiting = chain.miners.find((m) => m.held === null)!
        expect(chain.isHeld(chain.blocks[3])).toBe(true)
        expect(holder.tip).toBe(3)
        expect(waiting.tip).toBe(2)
        expect(waiting.cand!.height).toBe(4)
        expect(chain.says).toContain(`${waiting.name} has not heard of it`)
      }
    }
    expect(sawHeld || chain.blocks.length === 5).toBe(true)
    expect(chain.blocks).toHaveLength(5)
    const [x, y] = chain.blocks.slice(3)
    expect([x.height, y.height]).toEqual([4, 4])
    expect([x.parent, y.parent]).toEqual([2, 2])
    expect(new Set([x.miner, y.miner])).toEqual(new Set(['A', 'B']))
    expect(x.hash).not.toBe(y.hash)
    for (const b of [x, y]) {
      expect(chain.status(b)).toBe('valid')
      expect(b.hash).toBe(await sha256Hex(preimage(b)))
      expect(b.prev).toBe(chain.blocks[2].hash)
      for (let n = 0; n < b.nonce; n++) expect(meets(await sha256Hex(preimage({ ...b, nonce: n })), 2)).toBe(false)
    }
    // A tie keeps the first seen, for the observer and for each miner
    expect(chain.forkOpen).toBe(true)
    expect(chain.bestTip()?.id).toBe(x.id)
    expect(chain.place(x)).toBe('main')
    expect(chain.place(y)).toBe('competing')
    expect(chain.miners.find((m) => m.name === x.miner)?.tip).toBe(x.id)
    expect(chain.miners.find((m) => m.name === y.miner)?.tip).toBe(y.id)
    expect(chain.says).toContain('Two valid blocks share one parent')
    // Nothing is tampered with while the fork stands
    expect(await chain.tamper(2)).toBe(false)
    expect(await chain.fork()).toBe(false)
  })

  it('the longer branch wins and the other block is orphaned', async () => {
    let orphanedFirstSeen = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const chain = await forked({ difficulty: 1, seed, blocks: ['Genesis', `seed ${seed}`] })
      const [x, y] = chain.blocks.slice(2)
      for (let i = 0; i < 5000 && chain.forkOpen; i++) await chain.round()
      expect(chain.forkOpen).toBe(false)
      const tip = chain.bestTip()!
      const main = chain.main()
      // Level branches may both grow for a while; one is strictly longer in the end
      const lost = chain.side()
      expect(lost.length).toBeGreaterThanOrEqual(1)
      expect(tip.height).toBe(3 + lost.length)
      expect(main.map((b) => b.height)).toEqual(main.map((_, i) => i + 1))
      const winner = main[2]
      const loser = winner.id === x.id ? y : x
      expect(lost[0].id).toBe(loser.id)
      for (const b of lost) {
        expect(chain.place(b)).toBe('orphaned')
        expect(chain.status(b)).toBe('valid')
        expect(b.work).toBeLessThan(tip.work)
      }
      expect(chain.miners.map((m) => m.tip)).toEqual([tip.id, tip.id])
      expect(chain.says).toContain('orphaned')
      expect(chain.says).toContain('follow the valid chain with the most work')
      if (loser.id === x.id) orphanedFirstSeen++
      // Mining goes on from the winning tip
      await chain.mine(1)
      expect(chain.bestTip()?.parent).toBe(tip.id)
    }
    // Being seen first is no protection: over these seeds it loses at least once
    expect(orphanedFirstSeen).toBeGreaterThan(0)
  })

  it('two blocks found at the same try fork the chain without being forced', async () => {
    // At difficulty 1 about one block in thirty is found by both miners at once: look for one
    for (let variant = 0; variant < 200; variant++) {
      const chain = await ready({ difficulty: 1, blocks: [`variant ${variant}`] })
      for (let i = 0; i < 400 && !chain.full && !chain.forkOpen; i++) await chain.round()
      if (!chain.forkOpen) continue
      const [x, y] = chain.blocks.slice(-2)
      expect(x.height).toBe(y.height)
      expect(x.parent).toBe(y.parent)
      expect(x.nonce).toBe(y.nonce)
      expect([x.miner, y.miner]).toEqual(['A', 'B'])
      expect(chain.status(x)).toBe('valid')
      expect(chain.status(y)).toBe('valid')
      expect(chain.bestTip()?.id).toBe(x.id)
      expect(chain.miners.map((m) => m.tip)).toEqual([x.id, y.id])
      expect(chain.says).toContain('forked by chance')
      for (let i = 0; i < 5000 && chain.forkOpen; i++) await chain.round()
      expect(chain.side().every((b) => chain.place(b) === 'orphaned')).toBe(true)
      return
    }
    throw new Error('no natural fork in 200 chains')
  })

  it('work, not block count, decides when difficulties differ', () => {
    const chain = new Chain(spec())
    const block = (id: number, parent: number | null, height: number, difficulty: number, work: number): Block => ({ id, parent, height, difficulty, work, seen: id, prev: '', miner: 'A', data: '', nonce: 0, hash: `${id}`, tries: 1, edited: false, remined: 0 })
    chain.blocks = [block(0, null, 1, 1, 16), block(1, 0, 2, 1, 32), block(2, 1, 3, 1, 48), block(3, 0, 2, 2, 272)]
    expect(chain.bestTip()?.id).toBe(3)
    expect(chain.main().map((b) => b.id)).toEqual([0, 3])
    expect(chain.side().map((b) => b.id)).toEqual([1, 2])
    chain.blocks.push(block(4, 0, 2, 2, 272))
    expect(chain.bestTip()?.id).toBe(3)
  })

  it('stops at the height the picture allows', async () => {
    const chain = await ready({ difficulty: 1, blocks: ['a'] })
    await chain.mine(50)
    expect(chain.height).toBe(CHAIN_LIMITS.height)
    expect(chain.full).toBe(true)
    const count = chain.blocks.length
    await chain.round()
    expect(chain.blocks).toHaveLength(count)
    expect(chain.says).toMatch(/reached 12 blocks/)
    expect(await chain.fork()).toBe(false)
  })
})

describe('blockchain: spec', () => {
  it('defaults to a short ready chain at a low difficulty', () => {
    const s = spec()
    expect(s).toMatchObject({ kind: 'blockchain', difficulty: 2, blocks: ['Genesis', 'Ada pays Bo 5', 'Bo pays Cy 2'], miners: ['A', 'B'], autoplay: false })
  })

  it('clamps, cleans and accepts aliases', () => {
    expect(spec({ difficulty: 9 }).difficulty).toBe(4)
    expect(spec({ difficulty: 0 }).difficulty).toBe(1)
    expect(spec({ zeros: '3' }).difficulty).toBe(3)
    expect(spec({ difficulty: 'hard' }).difficulty).toBe(2)
    expect(spec({ blocks: ['a', '', null, { data: 'b' }, 7, "it's \\ `x`", 'x'.repeat(99)] }).blocks).toEqual(['a', 'b', '7', 'its x', 'x'.repeat(32)])
    expect(spec({ data: ['1', '2', '3', '4', '5', '6', '7'] }).blocks).toEqual(['1', '2', '3', '4', '5'])
    expect(spec({ blocks: 4 }).blocks).toHaveLength(4)
    expect(spec({ blocks: 99 }).blocks).toHaveLength(5)
    expect(spec({ blocks: 'none' }).blocks).toHaveLength(3)
    expect(spec({ blocks: [] }).blocks).toHaveLength(3)
    expect(spec({ miners: ['Ada', 'Bo'] }).miners).toEqual(['Ada', 'Bo'])
    expect(spec({ miners: ['Ada', 'ada'] }).miners).toEqual(['Ada', 'B'])
    expect(spec({ miners: ['B'] }).miners).toEqual(['B', 'A'])
    expect(spec({ miners: ['a|b c', 'a-very-long-name'] }).miners).toEqual(['abc', 'a-very-l'])
    expect(spec({ miners: 'both' }).miners).toEqual(['A', 'B'])
    expect(spec({ autoplay: true }).autoplay).toBe(true)
    expect(parseSim('{"kind":"chain"}')?.kind).toBe('blockchain')
    expect(cleanData('  two   spaces\n')).toBe('two spaces')
  })

  it('keeps its own tour verbs and drops the rest', () => {
    const s = spec({ tour: [{ at: 'Block:2', say: 'Change it.', do: { tamper: 2, repair: 2, fork: true, mine: 2, difficulty: 1, run: 20, insert: 4 } }] })
    expect(s.tour[0].at).toBe('block:2')
    expect(s.tour[0].do).toEqual({ tamper: 2, repair: 2, fork: true, mine: 2, difficulty: 1, run: 20 })
  })
})

describe('blockchain: parts', () => {
  it('parses names against the chain as it stands', async () => {
    const chain = await forked({ difficulty: 1, miners: ['Ada', 'Bo'] })
    expect(parseBlockchainPart('block:1', chain)).toEqual({ type: 'block', n: 1 })
    expect(parseBlockchainPart('Block:4', chain)).toEqual({ type: 'block', n: 4 })
    expect(parseBlockchainPart('block:5', chain)).toBeNull()
    expect(parseBlockchainPart('block:0', chain)).toBeNull()
    expect(parseBlockchainPart('hash:2', chain)).toEqual({ type: 'hash', n: 2 })
    expect(parseBlockchainPart('nonce:3', chain)).toEqual({ type: 'nonce', n: 3 })
    expect(parseBlockchainPart('link:3', chain)).toEqual({ type: 'link', n: 3 })
    expect(parseBlockchainPart('orphan:1', chain)).toEqual({ type: 'orphan', n: 1 })
    expect(parseBlockchainPart('orphan:2', chain)).toBeNull()
    expect(parseBlockchainPart('miner:a', chain)).toEqual({ type: 'miner', i: 0 })
    expect(parseBlockchainPart('miner:b', chain)).toEqual({ type: 'miner', i: 1 })
    expect(parseBlockchainPart('miner:bo', chain)).toEqual({ type: 'miner', i: 1 })
    expect(parseBlockchainPart('miner:c', chain)).toBeNull()
    for (const name of ['difficulty', 'tip', 'fork']) expect(parseBlockchainPart(name, chain)).toEqual({ type: name })
    for (const name of ['', 'block', 'block:x', 'block:1:2', 'tip:1', 'chain']) expect(parseBlockchainPart(name, chain)).toBeNull()
  })

  it('describes each part with its numbers', async () => {
    const chain = await ready({ difficulty: 2 })
    const [, b2, b3] = chain.main()
    const short = (hash: string) => `${hash.slice(0, 10)}…`
    expect(describeBlockchainPart(chain, { type: 'block', n: 2 }).label).toBe(`block 2 on the main chain (data "Ada pays Bo 5", mined by B with nonce ${b2.nonce}; valid)`)
    expect(describeBlockchainPart(chain, { type: 'hash', n: 2 }).label).toBe(`the hash of block 2 (${short(b2.hash)}, which starts with the 2 zeros its target asks for)`)
    expect(describeBlockchainPart(chain, { type: 'nonce', n: 2 })).toEqual({
      label: `the nonce of block 2 (${b2.nonce}, found after ${fmt(b2.tries)} tries when about 256 were expected)`,
      values: { nonce: b2.nonce, tries: b2.tries, expected: 256, remined: 0 }
    })
    expect(describeBlockchainPart(chain, { type: 'link', n: 3 }).label).toBe(`the link into block 3 (it records ${short(b3.prev)} as the previous hash, which is the hash of block 2)`)
    expect(describeBlockchainPart(chain, { type: 'link', n: 1 }).label).toMatch(/records 64 zeros/)
    expect(describeBlockchainPart(chain, { type: 'difficulty' }).label).toBe('the difficulty (2: a hash must start with 2 zeros in hexadecimal, 1 chance in 256 per try)')
    expect(describeBlockchainPart(chain, { type: 'tip' }).label).toBe(`the tip of the main chain (block 3, mined by A, hash ${short(b3.hash)})`)
    expect(describeBlockchainPart(chain, { type: 'fork' }).label).toBe('the fork (there is none: both miners are building on block 3)')
    expect(describeBlockchainPart(chain, { type: 'miner', i: 0 }).label).toBe('miner A (trying block 4 on top of block 3: 0 tries so far, about 256 expected)')

    const was = b2.hash
    await chain.tamper(2)
    if (!chain.sealOk(b2)) {
      expect(describeBlockchainPart(chain, { type: 'block', n: 2 }).label).toMatch(/data "Ada pays Bo 500".*; invalid\)$/)
      expect(describeBlockchainPart(chain, { type: 'hash', n: 2 }).label).toMatch(/does not start with the 2 zeros its target asks for, so the block is invalid/)
    }
    expect(describeBlockchainPart(chain, { type: 'link', n: 3 }).label).toBe(`the link into block 3 (it records ${short(was)} as the previous hash, which is no longer the hash of block 2, now ${short(b2.hash)})`)
    expect(describeBlockchainPart(chain, { type: 'block', n: 3 }).values.status).toBe('broken link')

    const split = await forked({ difficulty: 1 })
    expect(describeBlockchainPart(split, { type: 'fork' }).label).toMatch(/^the fork at height 4 \(A builds on .* and B on .*; both are valid/)
    expect(describeBlockchainPart(split, { type: 'orphan', n: 1 }).label).toMatch(/^the competing block at height 4 mined by [AB]/)
    for (let i = 0; i < 5000 && split.forkOpen; i++) await split.round()
    expect(describeBlockchainPart(split, { type: 'orphan', n: 1 }).label).toMatch(/^the orphaned block at height 4 mined by [AB] \(its proof of work is real/)
    expect(describeBlockchainPart(split, { type: 'fork' }).label).toMatch(/^the fork, now settled \(\d orphaned blocks? left off/)
  })
})
