import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

interface Item { id: string; must: string[]; mustNot: string[] }
const items = JSON.parse(readFileSync(new URL('../scripts/eval/claims.json', import.meta.url), 'utf8')) as Item[]
const grade = (it: Item, a: string) => it.must.every((p) => new RegExp(p, 'i').test(a)) && !it.mustNot.some((p) => new RegExp(p, 'i').test(a))

// A correct answer for each, in the plain way a tutor would put it
const right: Record<string, string> = {
  'raft-majority': 'A majority: 3 of the 5 servers must store it before it is committed.',
  'raft-election': 'If a follower hears no heartbeat before its election timeout, it becomes a candidate and starts an election.',
  'raft-term': 'No. Each server votes for at most one candidate per term and a leader needs a majority, so there is only one leader per term.',
  'paxos-roles': 'Proposers, acceptors and learners.',
  flp: 'In an asynchronous system, no deterministic consensus protocol can guarantee termination if even one process may crash.',
  'bft-bound': 'It needs at least 3f + 1 nodes.',
  'crash-bound': 'It needs 2f + 1 replicas, so a majority survives.',
  cap: 'During a partition a system must choose between consistency and availability.',
  lamport: 'If a happened before b then L(a) < L(b). The converse does not hold: a smaller timestamp does not mean it happened before.',
  vector: 'Vector clocks can tell when two events are concurrent, which Lamport clocks cannot.',
  quorum: 'When R + W > N, every read quorum overlaps the latest write quorum.',
  '2pc-block': 'Participants that voted yes block, holding locks, until the coordinator recovers.',
  linearizable: 'Linearizability is much stronger than eventual consistency.',
  'consistent-hash': 'With hash mod N, changing N remaps almost every key; consistent hashing moves only a small fraction of keys when a server joins or leaves.',
  lsm: 'LSM trees are optimised for writes: they turn random writes into sequential ones, at some cost to reads.',
  'kafka-order': 'Order is guaranteed only within a partition, not across the whole topic.',
  'btc-block': 'About 10 minutes.',
  'btc-retarget': 'Every 2016 blocks, about every two weeks.',
  'btc-utxo': 'Bitcoin uses the UTXO model: balances are unspent transaction outputs.',
  'btc-hash': 'Double SHA-256.',
  'btc-curve': 'Both use secp256k1 with ECDSA (Bitcoin also uses Schnorr on the same curve).',
  'eth-pos': 'Proof of stake, since the Merge in September 2022.',
  'eth-slot': 'A slot is 12 seconds and an epoch has 32 slots.',
  'eth-hash': 'Keccak-256.',
  'eth-1559': 'The base fee is burned; only the priority tip goes to the validator.',
  'eth-gas': 'Gas measures the computational work an operation takes in the EVM.',
  'sol-poh': 'Proof of History is a cryptographic clock that orders and timestamps events; consensus itself is proof of stake (Tower BFT).',
  merkle: 'It lets a light client verify that a transaction is included in a block, with a proof of about log2(n) hashes.',
  optimistic: 'Optimistic rollups assume transitions are valid and allow a fraud proof during a challenge period; ZK rollups post a validity proof (a zero-knowledge proof) with every batch.',
  finality: 'Probabilistic: a block becomes harder to reverse with each confirmation.',
  'nonce-pow': 'They vary the nonce (and the extra nonce in the coinbase).',
  'sha-pre': 'Preimage resistance: given a hash, it is hard to find an input that hashes to it. Collision resistance: it is hard to find any two different inputs with the same hash.',
  'ecdsa-nonce': 'Anyone can compute the private key from the two signatures.',
  aes: 'AES is symmetric, with a 128-bit block size.',
  tls13: 'TLS 1.3 requires (EC)DHE, Diffie-Hellman key exchange, and dropped RSA key transport.',
  idempotency: 'So that a retried request does not charge the customer twice: the server recognises the duplicate key.',
  'double-entry': 'Total debits must equal total credits.',
  iso8583: 'It is the message standard for card transactions between terminals, acquirers and issuers.',
  iso20022: 'A financial messaging standard, usually in XML.',
  'auth-capture': 'Authorisation checks and puts a hold on the funds; capture actually takes the money and settles it.'
}

const wrong: Record<string, string> = {
  'raft-majority': 'All 5 servers must have it.',
  'btc-block': 'About 1 minute.',
  'eth-pos': 'Ethereum still uses proof of work.',
  'eth-1559': 'The base fee goes to the miner.',
  'kafka-order': 'Kafka keeps order across the whole topic.',
  'bft-bound': 'It needs 2f + 1 nodes.'
}

describe('the technical facts eval marks fairly', () => {
  it('has a reference answer for every question', () => {
    expect(items.map((i) => i.id).sort()).toEqual(Object.keys(right).sort())
  })
  for (const q of items) it(`accepts a right answer: ${q.id}`, () => expect(grade(q, right[q.id])).toBe(true))
  for (const [id, a] of Object.entries(wrong)) it(`rejects a wrong answer: ${id}`, () => expect(grade(items.find((i) => i.id === id)!, a)).toBe(false))
})
