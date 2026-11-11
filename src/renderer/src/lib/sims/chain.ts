/**
 * A short blockchain with real proof of work: every hash is SHA-256 from the Web Crypto API
 * (crypto.subtle.digest), never a stand-in. Two miners try nonces on their candidate blocks; a
 * block is found when its hash starts with enough zero hex digits. The model keeps a tree of
 * blocks, follows the chain with the most work (first seen on a tie), lets a block be tampered
 * with and re-mined in turn, and can hold back news of a block so that a fork forms.
 *
 * Hashing is asynchronous, so the model's operations are too; they are queued and run one at a
 * time, and results are read in order of nonce, so the same spec always gives the same chain.
 *   parts: block:N, hash:N, nonce:N, link:N, orphan:N, difficulty, tip, fork, miner:a, miner:b
 */
import type { PartInfo } from './parts'
import { mulberry32 } from './rng'
import { int, onlyVerbs, text, type Raw, type SimBase } from './specUtil'

// ---------- Hashing ----------

/** The previous hash of the first block: nothing comes before it */
export const ZERO = '0'.repeat(64)

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))
const encoder = new TextEncoder()

/** SHA-256 of a text's UTF-8 bytes, as 64 hex digits */
export async function sha256Hex(source: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('no-crypto')
  const bytes = new Uint8Array(await subtle.digest('SHA-256', encoder.encode(source)))
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]]
  return out
}

export interface Header {
  height: number
  prev: string
  difficulty: number
  miner: string
  data: string
  nonce: number
}

/** Exactly what is hashed for a block: its fields joined by "|", as UTF-8 text */
export const preimage = (b: Header) => `${b.height}|${b.prev}|${b.difficulty}|${b.miner}|${b.data}|${b.nonce}`

export const PREIMAGE_FORMAT = 'height|previous hash|difficulty|miner|data|nonce'

/** Whether a hash starts with d zero hex digits */
export const meets = (hash: string, d: number) => hash.startsWith('0'.repeat(d))

/** Each try succeeds with chance 1 in 16^d, so that many tries are needed on average */
export const expectedTries = (d: number) => Math.pow(16, d)

export const shortHash = (hash: string, n = 10) => `${hash.slice(0, n)}…`

// ---------- Spec ----------

export interface BlockchainSpec extends SimBase {
  kind: 'blockchain'
  /** Leading zero hex digits a hash needs, 1 to 4 */
  difficulty: number
  /** The data of the starting blocks, first block first */
  blocks: string[]
  miners: [string, string]
  autoplay: boolean
}

export const CHAIN_LIMITS = { difficulty: [1, 4] as const, start: 5, data: 32, name: 8, height: 12, mine: 8 }
/** Nonces each miner tries in one step, by difficulty: about 16, 32, 64 and 128 steps a block for one miner */
export const BATCH = [1, 1, 8, 64, 512]
/** Nonces tried at a time while the starting blocks are mined */
export const START_BATCH = 256
const VERBS = ['mine', 'tamper', 'repair', 'fork', 'difficulty'] as const
const DEFAULT_BLOCKS = ['Genesis', 'Ada pays Bo 5', 'Bo pays Cy 2']
const PEOPLE = ['Ada', 'Bo', 'Cy', 'Di', 'Eve', 'Fay']

/** Block data as one short line; quotes and backslashes go, so the shown shell command stays right */
export const cleanData = (v: unknown) => text(typeof v === 'number' ? String(v) : typeof v === 'string' ? v.replace(/['\\`]/g, '') : '', 200).slice(0, CHAIN_LIMITS.data).trim()

const cleanName = (v: unknown) => text(v, 40).replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, CHAIN_LIMITS.name)

export function parseBlockchainSpec(raw: Raw, base: SimBase): BlockchainSpec | null {
  const given = raw.blocks ?? raw.data ?? raw.chain ?? raw.start
  let blocks: string[] = []
  if (Array.isArray(given)) blocks = given.map((item) => cleanData(item && typeof item === 'object' ? (item as Raw).data : item)).filter(Boolean)
  else if (typeof given === 'number') blocks = DEFAULT_BLOCKS.concat(['Cy pays Di 1', 'Di pays Ada 4']).slice(0, int(given, 3, 1, CHAIN_LIMITS.start))
  if (!blocks.length) blocks = [...DEFAULT_BLOCKS]
  const names = Array.isArray(raw.miners) ? raw.miners.map(cleanName) : []
  const a = names[0] || 'A'
  const b = names[1] && names[1].toLowerCase() !== a.toLowerCase() ? names[1] : a === 'B' ? 'A' : 'B'
  const spec: BlockchainSpec = {
    ...base,
    kind: 'blockchain',
    difficulty: int(raw.difficulty ?? raw.zeros ?? raw.d, 2, ...CHAIN_LIMITS.difficulty),
    blocks: blocks.slice(0, CHAIN_LIMITS.start),
    miners: [a, b],
    autoplay: raw.autoplay === true
  }
  return onlyVerbs(spec, VERBS)
}

// ---------- The model ----------

export interface Block extends Header {
  id: number
  /** The block this one was built on (by id), or null for the first */
  parent: number | null
  hash: string
  /** Nonces tried to find the current nonce */
  tries: number
  /** Order in which the simulation first saw it */
  seen: number
  /** Work in the chain up to and including this block: the sum of 16^difficulty */
  work: number
  /** Its data was changed after it was mined */
  edited: boolean
  /** Times it has been mined again */
  remined: number
}

export interface Candidate extends Header {
  parent: number | null
  /** The next nonce to try */
  next: number
  tries: number
  /** The first and last nonce of the latest batch, and what the last one gave */
  first: number
  last: number
  lastHash: string
  lastMet: boolean
}

export interface Miner {
  name: string
  /** The block it builds on: the best it has heard of, first seen on a tie */
  tip: number
  cand: Candidate | null
  /** A block it has found that the other miner has not heard of yet (forced fork) */
  held: number | null
  mined: number
}

/** valid; invalid: its hash misses its target; unlinked: its previous hash is not its parent's hash; unsupported: sound itself, but built on a broken block */
export type BlockStatus = 'valid' | 'invalid' | 'unlinked' | 'unsupported'
export type BlockPlace = 'main' | 'competing' | 'orphaned'

export const STATUS_WORD: Record<BlockStatus, string> = { valid: 'valid', invalid: 'invalid', unlinked: 'broken link', unsupported: 'parent broken' }

const NO_CRYPTO = 'This window has no Web Crypto (crypto.subtle), so nothing can be hashed here.'
const RULE = 'The rule: follow the valid chain with the most work, which at equal difficulty is the longest.'
const zeros = (d: number) => '0'.repeat(d)
/** A count as written in a sentence: 4,096 */
export const fmt = (n: number) => n.toLocaleString('en-GB')
const odds = (d: number) => fmt(expectedTries(d))
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`
const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items.join(''))
const tries = (n: number) => plural(n, 'try', 'tries')
const nonces = (c: { first: number; last: number }) => (c.first === c.last ? `nonce ${c.last}` : `nonces ${c.first}–${c.last}`)

export class Chain {
  readonly spec: BlockchainSpec
  difficulty: number
  blocks: Block[] = []
  miners: [Miner, Miner]
  /** The starting block being mined, until the chain is ready */
  starting: Candidate | null = null
  /** The broken block being mined again */
  repair: Candidate | null = null
  /** News of found blocks is being held back until each miner has one */
  forcing = false
  /** Hashes computed while mining, in total and while re-mining broken blocks */
  totalTries = 0
  rewriteTries = 0
  /** Steps of work done */
  rounds = 0
  /** What just happened and why */
  says = 'Mining the starting blocks…'
  /** The events so far (blocks found, forks, tampering, repairs), newest first */
  events: string[] = []
  error: string | null = null
  private tail: Promise<unknown> = Promise.resolve()

  constructor(spec: BlockchainSpec) {
    this.spec = spec
    this.difficulty = spec.difficulty
    this.miners = [
      { name: spec.miners[0], tip: -1, cand: null, held: null, mined: 0 },
      { name: spec.miners[1], tip: -1, cand: null, held: null, mined: 0 }
    ]
  }

  // ----- Reading the state -----

  get ready(): boolean {
    return this.blocks.length >= this.spec.blocks.length
  }

  /** The tip of the chain with the most work; on a tie, the one seen first */
  bestTip(): Block | null {
    let best: Block | null = null
    for (const b of this.blocks) if (!best || b.work > best.work || (b.work === best.work && b.seen < best.seen)) best = b
    return best
  }

  /** From a block back to the first, first block first */
  chainTo(tip: Block | null): Block[] {
    const out: Block[] = []
    for (let b = tip; b; b = b.parent === null ? null : this.blocks[b.parent]) out.push(b)
    return out.reverse()
  }

  main(): Block[] {
    return this.chainTo(this.bestTip())
  }

  /** Blocks off the main chain, in the order they were seen */
  side(): Block[] {
    const on = new Set(this.main().map((b) => b.id))
    return this.blocks.filter((b) => !on.has(b.id))
  }

  get height(): number {
    return this.bestTip()?.height ?? 0
  }

  sealOk(b: Block): boolean {
    return meets(b.hash, b.difficulty)
  }

  linkOk(b: Block): boolean {
    return b.prev === (b.parent === null ? ZERO : this.blocks[b.parent].hash)
  }

  status(b: Block): BlockStatus {
    if (!this.sealOk(b)) return 'invalid'
    if (!this.linkOk(b)) return 'unlinked'
    return b.parent === null || this.status(this.blocks[b.parent]) === 'valid' ? 'valid' : 'unsupported'
  }

  place(b: Block): BlockPlace {
    if (this.main().some((m) => m.id === b.id)) return 'main'
    const live = this.miners.some((m) => m.tip >= 0 && this.chainTo(this.blocks[m.tip]).some((x) => x.id === b.id))
    return live ? 'competing' : 'orphaned'
  }

  /** The earliest block on the main chain that is not valid */
  firstBroken(): Block | null {
    return this.main().find((b) => !this.sealOk(b) || !this.linkOk(b)) ?? null
  }

  /** Two miners building on different blocks, each having heard of the other's */
  get forkOpen(): boolean {
    return this.ready && !this.forcing && this.miners[0].tip !== this.miners[1].tip
  }

  /** Whether a block has been found but not yet announced */
  isHeld(b: Block): boolean {
    return this.miners.some((m) => m.held === b.id)
  }

  /** Nothing more to mine: the chain is as long as the picture allows */
  get full(): boolean {
    return this.ready && this.height >= CHAIN_LIMITS.height && !this.forcing && !this.forkOpen && !this.firstBroken()
  }

  // ----- Operations: queued, one at a time -----

  private run<T>(job: () => Promise<T>, fallback: T): Promise<T> {
    const next = this.tail.then(async () => {
      if (this.error) return fallback
      try {
        return await job()
      } catch (err) {
        this.error = err instanceof Error && err.message === 'no-crypto' ? NO_CRYPTO : `Hashing failed: ${err instanceof Error ? err.message : String(err)}`
        this.says = this.error
        return fallback
      }
    })
    this.tail = next
    return next
  }

  /** One step of work: the next batch of nonces for whatever is being mined */
  round(): Promise<void> {
    return this.run(async () => {
      if (!this.ready) await this.startRound()
      else if (this.firstBroken()) await this.repairRound()
      else await this.minersRound()
    }, undefined)
  }

  /** Changes a block's data (to `to`, or by altering the amount) and recomputes its hash. False if nothing changed. */
  tamper(height: number, to?: string): Promise<boolean> {
    return this.run(async () => {
      if (!this.ready) return false
      if (this.forcing || this.forkOpen) return this.refuse('Tampering waits until the fork is settled: keep mining until one branch is longer.')
      const chain = this.main()
      const b = chain[height - 1]
      if (!b) return false
      const data = to === undefined ? tamperedText(b.data) : cleanData(to)
      if (!data) return this.refuse('A block needs some data: the change was not made.')
      if (data === b.data) return false
      const before = b.hash
      b.data = data
      b.hash = await sha256Hex(preimage(b))
      b.edited = true
      this.repair = null
      const later = chain.length - height
      if (!this.firstBroken()) this.note(`Block ${height}'s data is back to what was mined, so its hash is ${shortHash(b.hash)} again and every block is valid.`)
      else if (this.sealOk(b))
        this.note(
          `Block ${height}'s data changed, so its hash changed from ${shortHash(before)} to ${shortHash(b.hash)}; by chance (1 in ${odds(b.difficulty)}) the new hash still starts with ${zeros(b.difficulty)}${later ? `, but block ${height + 1} records the old hash, so its link is broken` : ''}.`
        )
      else
        this.note(
          `Block ${height}'s data changed, so its hash changed from ${shortHash(before)} to ${shortHash(b.hash)}, which does not start with ${zeros(b.difficulty)}: the block is invalid.` +
            (later ? ` Block ${height + 1} records the old hash, so its link is broken${later > 1 ? `, and ${later === 2 ? `block ${height + 2} rests` : `blocks ${height + 2} to ${chain.length} rest`} on it` : ''}: changing one block breaks every block after it.` : '')
        )
      return true
    }, false)
  }

  /** Holds back news of the next block each miner finds, so both find one on the same parent */
  fork(): Promise<boolean> {
    return this.run(async () => {
      if (!this.ready || this.forcing) return false
      if (this.firstBroken()) return this.refuse('Miners build only on a valid chain: repair the broken blocks before forking.')
      if (this.forkOpen) return this.refuse('There is already a fork: keep mining until one branch is longer.')
      if (this.height >= CHAIN_LIMITS.height) return this.refuse(`The chain has reached ${CHAIN_LIMITS.height} blocks: reset to start again.`)
      this.forcing = true
      const [a, b] = this.miners
      this.note(`A fork is forced: ${a.name} and ${b.name} both mine block ${this.height + 1}, and neither hears of the other's block until each has found one.`)
      return true
    }, false)
  }

  setDifficulty(d: number): Promise<boolean> {
    return this.run(async () => {
      const to = int(d, this.difficulty, ...CHAIN_LIMITS.difficulty)
      if (to === this.difficulty) return false
      this.difficulty = to
      this.note(
        `Difficulty ${to}: a new block's hash must start with ${zeros(to)}, 1 chance in ${odds(to)} per try. Blocks already mined keep the difficulty they were mined at${this.ready ? '; the miners start their current block again' : ''}.`
      )
      return true
    }, false)
  }

  /** Rounds until n more blocks are on the main chain (for tests and scripts; the view paces its own) */
  async mine(n: number, maxRounds = 100000): Promise<void> {
    while (!this.ready && !this.error) await this.round()
    const target = Math.min(CHAIN_LIMITS.height, this.height + n)
    for (let i = 0; i < maxRounds && !this.error && (this.height < target || this.firstBroken() || this.forcing); i++) await this.round()
  }

  /** Mines broken blocks again, earliest first, until block `height` is valid */
  async mend(height: number, maxRounds = 100000): Promise<void> {
    for (let i = 0; i < maxRounds && !this.error; i++) {
      const f = this.firstBroken()
      if (!this.ready || !f || f.height > height) return
      await this.round()
    }
  }

  // ----- The work -----

  private note(sentence: string): void {
    this.says = sentence
    this.events.unshift(sentence)
    if (this.events.length > 40) this.events.length = 40
  }

  private refuse(sentence: string): false {
    this.says = sentence
    return false
  }

  /** Counts a batch against a candidate: n nonces tried, the last giving `hash` */
  private spend(c: Candidate, n: number, hash: string, met: boolean): void {
    c.first = c.next
    c.next += n
    c.tries += n
    c.last = c.next - 1
    c.lastHash = hash
    c.lastMet = met
    this.totalTries += n
  }

  private batch(c: Candidate, n: number): Promise<string>[] {
    return Array.from({ length: n }, (_, i) => sha256Hex(preimage({ ...c, nonce: c.next + i })))
  }

  private add(c: Candidate, nonce: number, hash: string): Block {
    const parent = c.parent === null ? null : this.blocks[c.parent]
    const block: Block = {
      id: this.blocks.length,
      height: c.height,
      parent: c.parent,
      prev: c.prev,
      difficulty: c.difficulty,
      miner: c.miner,
      data: c.data,
      nonce,
      hash,
      tries: c.tries,
      seen: this.blocks.length,
      work: (parent?.work ?? 0) + expectedTries(c.difficulty),
      edited: false,
      remined: 0
    }
    this.blocks.push(block)
    return block
  }

  private fresh(header: Omit<Header, 'nonce'>, parent: number | null): Candidate {
    return { ...header, nonce: 0, parent, next: 0, tries: 0, first: 0, last: -1, lastHash: '', lastMet: false }
  }

  /** The data a new block at this height carries: a made-up payment, the same whoever mines it */
  dataFor(height: number): string {
    const rand = mulberry32(this.spec.seed * 7919 + height)
    const from = Math.floor(rand() * PEOPLE.length)
    const to = (from + 1 + Math.floor(rand() * (PEOPLE.length - 1))) % PEOPLE.length
    return `${PEOPLE[from]} pays ${PEOPLE[to]} ${1 + Math.floor(rand() * 9)}`
  }

  private async startRound(): Promise<void> {
    const i = this.blocks.length
    const parent = i ? this.blocks[i - 1] : null
    if (!this.starting || this.starting.height !== i + 1 || this.starting.difficulty !== this.difficulty)
      this.starting = this.fresh({ height: i + 1, prev: parent?.hash ?? ZERO, difficulty: this.difficulty, miner: this.spec.miners[i % 2], data: this.spec.blocks[i] }, parent?.id ?? null)
    const c = this.starting
    const hashes = await Promise.all(this.batch(c, START_BATCH))
    this.rounds++
    const hit = hashes.findIndex((hash) => meets(hash, c.difficulty))
    const n = hit < 0 ? hashes.length : hit + 1
    this.spend(c, n, hashes[n - 1], hit >= 0)
    if (hit < 0) {
      this.says = `Mining the starting blocks: block ${c.height}, ${tries(c.tries)} so far (about ${odds(c.difficulty)} expected).`
      return
    }
    const block = this.add(c, c.last, c.lastHash)
    this.starting = null
    if (!this.ready) {
      this.says = `Mining the starting blocks: block ${block.height} found after ${tries(block.tries)}.`
      return
    }
    for (const m of this.miners) m.tip = block.id
    const all = this.blocks
    this.note(
      `The chain is ready: ${plural(all.length, 'block')}, ${all.length > 1 ? 'each' : 'its'} hash starting with ${zeros(this.difficulty)}, found in ${listed(all.map((b) => fmt(b.tries)))} tries (about ${odds(this.difficulty)} expected each). ${this.miners[0].name} and ${this.miners[1].name} now both work on block ${all.length + 1}.`
    )
  }

  private async repairRound(): Promise<void> {
    const f = this.firstBroken()
    if (!f) return
    const prev = f.parent === null ? ZERO : this.blocks[f.parent].hash
    if (!this.repair || this.repair.height !== f.height || this.repair.prev !== prev || this.repair.data !== f.data)
      this.repair = this.fresh({ height: f.height, prev, difficulty: f.difficulty, miner: f.miner, data: f.data }, f.parent)
    const c = this.repair
    const hashes = await Promise.all(this.batch(c, BATCH[c.difficulty]))
    this.rounds++
    const hit = hashes.findIndex((hash) => meets(hash, c.difficulty))
    const n = hit < 0 ? hashes.length : hit + 1
    this.spend(c, n, hashes[n - 1], hit >= 0)
    this.rewriteTries += n
    if (hit < 0) {
      this.says = `Mining block ${f.height} again${f.prev !== prev ? `, now recording block ${f.height - 1}'s new hash` : ''}: ${nonces(c)} tried, the last giving ${shortHash(c.lastHash)}, which does not start with ${zeros(c.difficulty)}. ${tries(c.tries)} so far, about ${odds(c.difficulty)} expected.`
      return
    }
    f.prev = prev
    f.nonce = c.last
    f.hash = c.lastHash
    f.tries = c.tries
    f.remined++
    this.repair = null
    const next = this.firstBroken()
    this.note(
      `Block ${f.height} is repaired after ${tries(c.tries)}: with nonce ${f.nonce} its hash is ${shortHash(f.hash)}, which starts with ${zeros(f.difficulty)}. ` +
        (next
          ? `But block ${next.height} still records the old hash of block ${f.height}, so its link is broken and it must be mined again too.`
          : `Every block is valid again. Rewriting history cost ${plural(this.rewriteTries, 'hash', 'hashes')}, and an honest network would have kept adding blocks meanwhile.`)
    )
  }

  /** Makes sure a miner has a candidate on its tip at the current difficulty */
  private candidate(m: Miner): Candidate {
    const tip = this.blocks[m.tip]
    if (!m.cand || m.cand.parent !== tip.id || m.cand.prev !== tip.hash || m.cand.difficulty !== this.difficulty)
      m.cand = this.fresh({ height: tip.height + 1, prev: tip.hash, difficulty: this.difficulty, miner: m.name, data: this.dataFor(tip.height + 1) }, tip.id)
    return m.cand
  }

  private async minersRound(): Promise<void> {
    if (this.full) {
      this.says = `The chain has reached ${CHAIN_LIMITS.height} blocks: reset to start again.`
      return
    }
    const d = this.difficulty
    const size = BATCH[d]
    const active = this.miners.filter((m) => !(this.forcing && m.held !== null))
    const cands = active.map((m) => this.candidate(m))
    const hashes = await Promise.all(cands.flatMap((c) => this.batch(c, size)))
    this.rounds++
    const at = (k: number, i: number) => hashes[k * size + i]
    const found: Miner[] = []
    if (this.forcing) {
      // Neither hears of the other: each goes on until it finds a block of its own
      cands.forEach((c, k) => {
        let hit = -1
        for (let i = 0; i < size && hit < 0; i++) if (meets(at(k, i), d)) hit = i
        const n = hit < 0 ? size : hit + 1
        this.spend(c, n, at(k, n - 1), hit >= 0)
        if (hit >= 0) found.push(active[k])
      })
    } else {
      // Both try their nth nonce at the same moment; the first success is heard at once and ends the round
      let stop = -1
      for (let i = 0; i < size && stop < 0; i++) if (cands.some((_, k) => meets(at(k, i), d))) stop = i
      const n = stop < 0 ? size : stop + 1
      cands.forEach((c, k) => {
        const met = stop >= 0 && meets(at(k, stop), d)
        this.spend(c, n, at(k, n - 1), met)
        if (met) found.push(active[k])
      })
    }
    if (!found.length) {
      const tried = active.map((m, k) => `${m.name} tried ${nonces(cands[k])}`).join(' and ')
      this.says = `${tried}: no hash starts with ${zeros(d)}, so no block yet. Each try has 1 chance in ${odds(d)}.`
      return
    }
    const wasOpen = this.forkOpen
    const blocks = found.map((m) => {
      const c = cands[active.indexOf(m)]
      const block = this.add(c, c.last, c.lastHash)
      m.tip = block.id
      m.cand = null
      m.mined++
      return block
    })
    const how = (b: Block) => `nonce ${b.nonce} gives ${shortHash(b.hash)} after ${tries(b.tries)} (about ${odds(b.difficulty)} expected)`
    if (this.forcing) {
      found.forEach((m, k) => (m.held = blocks[k].id))
      const waiting = this.miners.find((m) => m.held === null)
      if (waiting) {
        this.note(`${found[0].name} found block ${blocks[0].height}: ${how(blocks[0])}. In this forced fork ${waiting.name} has not heard of it and keeps mining at the same height.`)
        return
      }
      this.forcing = false
      for (const m of this.miners) m.held = null
      const [a, b] = this.miners
      const last = blocks[blocks.length - 1]
      this.note(
        `${found.length === 2 ? `${a.name} and ${b.name} each found` : `Now ${found[0].name} has found`} a block ${last.height} too: ${how(last)}. Two valid blocks share one parent, so the chain has forked. Each miner builds on the block it saw first; the tie stands until one branch is longer.`
      )
      return
    }
    if (found.length === 2) {
      const [a, b] = found
      this.note(
        wasOpen
          ? `${a.name} and ${b.name} each found the next block on their own branch at the same try, so the branches are still level and the fork stands.`
          : `${a.name} and ${b.name} each found block ${blocks[0].height} at the same try (nonce ${blocks[0].nonce} and nonce ${blocks[1].nonce}): two valid blocks share one parent, so the chain has forked by chance. Each builds on its own; the tie stands until one branch is longer.`
      )
      return
    }
    const [winner] = found
    const [block] = blocks
    const other = this.miners.find((m) => m !== winner)
    if (!other) return
    const otherTip = this.blocks[other.tip]
    if (block.work <= otherTip.work) {
      this.note(`${winner.name} found block ${block.height}: ${how(block)}. ${other.name} keeps its own branch, which still has as much work.`)
      return
    }
    const dropped = block.parent === otherTip.id ? [] : this.chainTo(otherTip).filter((b) => !this.chainTo(block).some((x) => x.id === b.id))
    other.tip = block.id
    other.cand = null
    this.note(
      dropped.length
        ? `${winner.name} found block ${block.height} on its branch: ${how(block)}. That branch is now longer (${block.height} blocks against ${otherTip.height}), so ${other.name} adopts it and drops its own block${dropped.length > 1 ? 's' : ''} ${dropped.map((b) => b.height).join(', ')}: orphaned, though the work in ${dropped.length > 1 ? 'them' : 'it'} was real. ${RULE}`
        : `${winner.name} found block ${block.height}: ${how(block)}. ${other.name} hears of it at once, gives up its own try and starts on block ${block.height + 1}.`
    )
  }
}

function tamperedText(data: string): string {
  const withAmount = data.replace(/(\d+)(?!.*\d)/, (n) => `${n}00`)
  return cleanData(withAmount !== data && withAmount.length <= CHAIN_LIMITS.data ? withAmount : `${data.slice(0, CHAIN_LIMITS.data - 9)} (edited)`)
}

// ---------- Parts ----------

export type BlockchainPart =
  | { type: 'block' | 'hash' | 'nonce' | 'link'; n: number }
  | { type: 'orphan'; n: number }
  | { type: 'difficulty' | 'tip' | 'fork' }
  | { type: 'miner'; i: 0 | 1 }

export function parseBlockchainPart(name: string, chain: Chain): BlockchainPart | null {
  const [head, arg, ...more] = name.trim().toLowerCase().split(':')
  if (more.length) return null
  if (arg === undefined) return head === 'difficulty' || head === 'tip' || head === 'fork' ? { type: head } : null
  if (head === 'miner') {
    const i = arg === 'a' || arg === '1' ? 0 : arg === 'b' || arg === '2' ? 1 : chain.miners.findIndex((m) => m.name.toLowerCase() === arg)
    return i === 0 || i === 1 ? { type: 'miner', i } : null
  }
  const n = Number(arg)
  if (!Number.isInteger(n) || n < 1) return null
  if (head === 'block' || head === 'hash' || head === 'nonce' || head === 'link') return n <= chain.height ? { type: head, n } : null
  if (head === 'orphan' || head === 'side') return n <= chain.side().length ? { type: 'orphan', n } : null
  return null
}

export function describeBlockchainPart(chain: Chain, part: BlockchainPart): PartInfo {
  const main = chain.main()
  const target = (b: { difficulty: number }) => `the ${plural(b.difficulty, 'zero')} its target asks for`
  switch (part.type) {
    case 'block': {
      const b = main[part.n - 1]
      const status = chain.status(b)
      return {
        label: `block ${b.height} on the main chain (data "${b.data}", mined by ${b.miner} with nonce ${b.nonce}; ${STATUS_WORD[status]})`,
        values: { height: b.height, nonce: b.nonce, tries: b.tries, status: STATUS_WORD[status], hash: shortHash(b.hash), miner: b.miner }
      }
    }
    case 'hash': {
      const b = main[part.n - 1]
      return {
        label: `the hash of block ${b.height} (${shortHash(b.hash)}, which ${chain.sealOk(b) ? `starts with ${target(b)}` : `does not start with ${target(b)}, so the block is invalid`})`,
        values: { hash: shortHash(b.hash, 16), difficulty: b.difficulty, meets: chain.sealOk(b) ? 'yes' : 'no' }
      }
    }
    case 'nonce': {
      const b = main[part.n - 1]
      return {
        label: `the nonce of block ${b.height} (${b.nonce}, found after ${tries(b.tries)} when about ${odds(b.difficulty)} were expected${chain.sealOk(b) ? '' : '; it no longer gives a hash that meets the target'})`,
        values: { nonce: b.nonce, tries: b.tries, expected: expectedTries(b.difficulty), remined: b.remined }
      }
    }
    case 'link': {
      const b = main[part.n - 1]
      if (b.parent === null) return { label: 'the link into block 1 (the first block records 64 zeros as its previous hash, because nothing comes before it)', values: { previous: shortHash(b.prev, 16), matches: chain.linkOk(b) ? 'yes' : 'no' } }
      const parent = chain.blocks[b.parent]
      return {
        label: `the link into block ${b.height} (it records ${shortHash(b.prev)} as the previous hash, which ${chain.linkOk(b) ? `is the hash of block ${parent.height}` : `is no longer the hash of block ${parent.height}, now ${shortHash(parent.hash)}`})`,
        values: { recorded: shortHash(b.prev, 16), parent: shortHash(parent.hash, 16), matches: chain.linkOk(b) ? 'yes' : 'no' }
      }
    }
    case 'orphan': {
      const b = chain.side()[part.n - 1]
      const place = chain.place(b)
      return {
        label:
          place === 'competing'
            ? `the competing block at height ${b.height} mined by ${b.miner} (valid work on the same parent as the main chain's block ${b.height}; the fork is not settled yet)`
            : `the orphaned block at height ${b.height} mined by ${b.miner} (its proof of work is real, but it is not on the chain with the most work)`,
        values: { height: b.height, miner: b.miner, nonce: b.nonce, tries: b.tries, hash: shortHash(b.hash) }
      }
    }
    case 'difficulty': {
      const d = chain.difficulty
      return {
        label: `the difficulty (${d}: a hash must start with ${plural(d, 'zero')} in hexadecimal, 1 chance in ${odds(d)} per try)`,
        values: { difficulty: d, expected: expectedTries(d), tried: chain.totalTries, rewriting: chain.rewriteTries }
      }
    }
    case 'tip': {
      const b = main[main.length - 1]
      if (!b) return { label: 'the tip of the chain (still being mined)', values: { height: 0 } }
      return { label: `the tip of the main chain (block ${b.height}, mined by ${b.miner}, hash ${shortHash(b.hash)})`, values: { height: b.height, miner: b.miner, hash: shortHash(b.hash), work: b.work } }
    }
    case 'fork': {
      const [a, b] = chain.miners
      const orphans = chain.side().filter((x) => chain.place(x) === 'orphaned').length
      const values = { open: chain.forkOpen ? 'yes' : 'no', orphaned: orphans, height: chain.height }
      if (chain.forcing) {
        const waiting = chain.miners.find((m) => m.held === null) ?? a
        return { label: `the forced fork (${a.name} and ${b.name} both mine block ${chain.blocks[waiting.tip].height + 1}${a.held !== null || b.held !== null ? ', and one has found a block the other has not heard of' : ''})`, values }
      }
      if (chain.forkOpen) {
        const ta = chain.blocks[a.tip]
        const tb = chain.blocks[b.tip]
        return { label: `the fork at height ${Math.min(ta.height, tb.height)} (${a.name} builds on ${shortHash(ta.hash)} and ${b.name} on ${shortHash(tb.hash)}; both are valid, and the first branch to get longer wins)`, values }
      }
      return { label: orphans ? `the fork, now settled (${plural(orphans, 'orphaned block')} left off the chain with the most work)` : `the fork (there is none: both miners are building on block ${chain.height})`, values }
    }
    case 'miner': {
      const m = chain.miners[part.i]
      const c = m.cand
      const values = { blocks: m.mined, tries: c?.tries ?? 0, expected: expectedTries(chain.difficulty), nonce: c && c.last >= 0 ? c.last : '–' }
      if (m.held !== null) return { label: `miner ${m.name} (it has found block ${chain.blocks[m.held].height} and waits; the other miner has not heard of it)`, values }
      if (!chain.ready || m.tip < 0) return { label: `miner ${m.name} (waiting for the starting blocks)`, values }
      const tip = chain.blocks[m.tip]
      return { label: `miner ${m.name} (trying block ${tip.height + 1} on top of block ${tip.height}: ${tries(c?.tries ?? 0)} so far, about ${odds(chain.difficulty)} expected)`, values }
    }
  }
}
