/**
 * Sharpness's fixed bank: problems that work with no model at all. Algorithms reuse the mock
 * interviews' bank (its references pass their hidden tests; test/mocks.test.ts) plus a few harder
 * originals; system design reuses the mock briefs plus new ones from the learner's fields; quant
 * brainteasers, ML and proofs are new. Every number answer is computed independently in
 * test/sharpness.test.ts, and every reference runs against its tests there.
 */
import { BANK, type BankProblem, type BankTag } from './mockBank'
import { DESIGNS } from './mockQuestions'
import type { MethodId } from './sharpMethods'
import { categoryInfo, type SharpProblem } from './sharpness'

const LEVEL_DIFFICULTY = { 1: 1050, 2: 1350, 3: 1700 } as const

const TAG_METHODS: Record<BankTag, MethodId[]> = {
  arrays: ['small-cases', 'edges'],
  hashing: ['analogy', 'simplify'],
  strings: ['small-cases', 'edges'],
  'sliding window': ['invariant', 'small-cases'],
  sorting: ['simplify', 'draw'],
  'binary search': ['invariant', 'edges'],
  graphs: ['draw', 'analogy'],
  dp: ['small-cases', 'backwards'],
  heaps: ['analogy', 'estimate'],
  system: ['understand', 'edges'],
  payments: ['understand', 'edges']
}

const fromMock = (p: BankProblem): SharpProblem => ({
  id: `mock-${p.id}`,
  category: 'algorithms',
  title: p.title,
  difficulty: LEVEL_DIFFICULTY[p.level],
  pattern: p.tags.join(', '),
  methods: [...new Set(p.tags.flatMap((t) => TAG_METHODS[t]))],
  brief: p.prompt,
  minutes: p.level === 3 ? 35 : p.level === 2 ? 25 : 15,
  origin: 'bank',
  code: { starter: p.starter, reference: p.reference, tests: p.tests, examples: p.examples, complexity: `${p.complexity.time} time, ${p.complexity.space} space` },
  solution: `${p.hints[p.hints.length - 1] ?? ''}\n\n\`\`\`python\n${p.reference.trim()}\n\`\`\`\n\nExpected: ${p.complexity.time} time, ${p.complexity.space} space.`,
  hints: p.hints
})

const ALGORITHMS: SharpProblem[] = [
  {
    id: 'sliding-max-latency',
    category: 'algorithms',
    title: 'Worst latency per window',
    difficulty: 1650,
    pattern: 'monotonic deque',
    methods: ['invariant', 'small-cases', 'simplify'],
    brief: 'A service logs its p99 latency once a second. For an alert dashboard, write `sliding_max(nums, k)` that returns the largest value in every window of `k` consecutive seconds, in order. `1 <= k <= len(nums)`. Up to 200,000 readings: an O(n·k) scan is too slow.',
    minutes: 35,
    origin: 'bank',
    code: {
      starter: 'def sliding_max(nums: list[int], k: int) -> list[int]:\n    pass\n',
      reference: `from collections import deque

def sliding_max(nums, k):
    q = deque()
    out = []
    for i, x in enumerate(nums):
        while q and nums[q[-1]] <= x:
            q.pop()
        q.append(i)
        if q[0] <= i - k:
            q.popleft()
        if i >= k - 1:
            out.append(nums[q[0]])
    return out
`,
      tests: `def test_example():
    assert sliding_max([1, 3, -1, -3, 5, 3, 6, 7], 3) == [3, 3, 5, 5, 6, 7]

def test_window_of_one():
    assert sliding_max([4, 2, 7], 1) == [4, 2, 7]

def test_whole_list():
    assert sliding_max([2, 9, 4], 3) == [9]

def test_decreasing():
    assert sliding_max([9, 8, 7, 6, 5], 2) == [9, 8, 7, 6]

def test_duplicates():
    assert sliding_max([5, 5, 5, 1], 2) == [5, 5, 5]

def test_large_increasing():
    n = 200000
    assert sliding_max(list(range(n)), 1000) == list(range(999, n))
`,
      examples: ['sliding_max([1, 3, -1, -3, 5, 3, 6, 7], 3) == [3, 3, 5, 5, 6, 7]'],
      complexity: 'O(n) time, O(k) space'
    },
    solution: 'Keep a deque of indices whose values are **decreasing** (the invariant). A new value pops every smaller value off the back: they can never be a window’s maximum again. The front is the current maximum; drop it once it leaves the window. Each index enters and leaves once, so O(n).',
    hints: ['Which values in the window can never be the maximum again once a bigger value arrives after them?', 'Keep only candidates, in decreasing order, in a deque of indices; the front is the answer for the window.']
  },
  {
    id: 'out-of-order-trades',
    category: 'algorithms',
    title: 'Out-of-order trades',
    difficulty: 1600,
    pattern: 'divide and conquer counting',
    methods: ['simplify', 'generalise', 'analogy'],
    brief: 'A feed should deliver trades in time order, but some arrive late. Given the trades’ timestamps in arrival order, write `count_inversions(ts)` returning how many pairs `i < j` have `ts[i] > ts[j]`. Up to 100,000 timestamps.',
    minutes: 35,
    origin: 'bank',
    code: {
      starter: 'def count_inversions(ts: list[int]) -> int:\n    pass\n',
      reference: `def count_inversions(ts):
    def sort(xs):
        if len(xs) <= 1:
            return xs, 0
        mid = len(xs) // 2
        left, a = sort(xs[:mid])
        right, b = sort(xs[mid:])
        merged, i, j, c = [], 0, 0, a + b
        while i < len(left) and j < len(right):
            if left[i] <= right[j]:
                merged.append(left[i])
                i += 1
            else:
                merged.append(right[j])
                j += 1
                c += len(left) - i
        merged += left[i:] + right[j:]
        return merged, c
    return sort(list(ts))[1]
`,
      tests: `def test_empty():
    assert count_inversions([]) == 0

def test_sorted():
    assert count_inversions([1, 2, 3, 4]) == 0

def test_reversed():
    assert count_inversions([3, 2, 1]) == 3

def test_mixed():
    assert count_inversions([2, 4, 1, 3, 5]) == 3

def test_equal_times_are_not_out_of_order():
    assert count_inversions([2, 2, 2, 1]) == 3

def test_large_reversed():
    n = 100000
    assert count_inversions(list(range(n, 0, -1))) == n * (n - 1) // 2
`,
      examples: ['count_inversions([2, 4, 1, 3, 5]) == 3'],
      complexity: 'O(n log n) time, O(n) space'
    },
    solution: 'Merge sort, counting as you merge: when an element of the right half is placed before the remaining `len(left) - i` elements of the left half, each of those is an inversion with it. The halves’ own inversions come from the recursion. O(n log n). (A Fenwick tree over the timestamps’ ranks also works.)',
    hints: ['If both halves were sorted, could you count the pairs that cross between them quickly?', 'Merge the sorted halves; each time you take from the right, every element still waiting on the left is out of order with it.']
  },
  {
    id: 'trapped-liquidity',
    category: 'algorithms',
    title: 'Water between the columns',
    difficulty: 1700,
    pattern: 'two pointers with running maxima',
    methods: ['invariant', 'draw', 'small-cases'],
    brief: 'Columns of width 1 have the given non-negative heights. After rain, how many units of water sit between them? Write `trap(heights)`. Up to 100,000 columns; O(n) time and O(1) extra space is the target.',
    minutes: 35,
    origin: 'bank',
    code: {
      starter: 'def trap(heights: list[int]) -> int:\n    pass\n',
      reference: `def trap(heights):
    i, j = 0, len(heights) - 1
    lmax = rmax = water = 0
    while i < j:
        if heights[i] < heights[j]:
            lmax = max(lmax, heights[i])
            water += lmax - heights[i]
            i += 1
        else:
            rmax = max(rmax, heights[j])
            water += rmax - heights[j]
            j -= 1
    return water
`,
      tests: `def test_classic():
    assert trap([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]) == 6

def test_second_example():
    assert trap([4, 2, 0, 3, 2, 5]) == 9

def test_empty_and_single():
    assert trap([]) == 0
    assert trap([3]) == 0

def test_rising_holds_nothing():
    assert trap([1, 2, 3]) == 0

def test_one_basin():
    assert trap([5, 0, 5]) == 5

def test_large_basin():
    assert trap([10000] + [0] * 100000 + [10000]) == 10 ** 9
`,
      examples: ['trap([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]) == 6'],
      complexity: 'O(n) time, O(1) space'
    },
    solution: 'Water above column i is min(max left, max right) − height. Two pointers: whichever side has the lower wall is bounded by its own running maximum (the other side is at least as tall), so add that side’s water and move it inward. O(n), O(1).',
    hints: ['Draw it. How much water sits above one column, in terms of the tallest walls to its left and right?', 'With two pointers, the lower side’s running maximum already decides its water: the other side is taller.']
  },
  ...BANK.map(fromMock)
]

const DESIGN: SharpProblem[] = [
  ...DESIGNS.map(
    (d): SharpProblem => ({
      id: `mock-${d.id}`,
      category: 'design',
      title: d.title,
      difficulty: ({ 'url-shortener': 1200, 'rate-limiter': 1300, 'ledger-service': 1500, 'payment-processor': 1550, 'card-authorisation': 1600, stablecoin: 1650 } as Record<string, number>)[d.id] ?? 1500,
      pattern: d.tags.join(', ') || 'system design',
      methods: ['understand', 'estimate', 'edges'],
      brief: d.brief,
      minutes: categoryInfo('design').minutes,
      origin: 'bank',
      checklist: d.checklist.map((c) => ({ point: c.point, cues: c.cues })),
      solution: d.modelAnswer,
      hints: d.probes.map((p) => p.question)
    })
  ),
  {
    id: 'feature-store',
    category: 'design',
    title: 'A feature store',
    difficulty: 1650,
    pattern: 'online/offline consistency',
    methods: ['understand', 'estimate', 'edges'],
    brief: 'Design a feature store for an ML platform. Training needs point-in-time-correct features from two years of history; online inference needs the same features at p99 under 10 ms for 50,000 requests per second. Features come from both a Kafka stream and nightly batch jobs.',
    minutes: 40,
    origin: 'bank',
    checklist: [
      { point: 'Point-in-time (as-of) joins for training, so no feature leaks from after the label', cues: ['point-in-time', 'point in time', 'as-of', 'as of', 'leak', 'time travel'] },
      { point: 'An offline store (columnar, warehouse or lake) and an online key-value store', cues: ['offline store', 'online store', 'parquet', 'warehouse', 'redis', 'dynamo', 'key-value', 'cassandra'] },
      { point: 'One feature definition used by both paths, to avoid training/serving skew', cues: ['skew', 'single definition', 'same definition', 'same transformation', 'feature definition'] },
      { point: 'Streaming materialisation from Kafka (Flink or similar) into the online store', cues: ['flink', 'kafka', 'stream', 'materiali'] },
      { point: 'Backfills that recompute history when a definition changes', cues: ['backfill', 'recompute'] },
      { point: 'Numbers: 50k QPS, p99 10 ms, entity count and storage sized', cues: ['qps', 'p99', 'per second', 'gb', 'tb'] },
      { point: 'Freshness and TTLs per feature, with staleness monitored', cues: ['ttl', 'fresh', 'stale'] },
      { point: 'A registry with versions, owners and lineage', cues: ['registry', 'version', 'lineage', 'catalog'] },
      { point: 'Idempotent, ordered writes (upserts keyed by entity and event time)', cues: ['idempot', 'upsert', 'event time', 'exactly-once', 'exactly once'] },
      { point: 'A fallback when the online store is slow or missing a key: defaults, and the model degrades', cues: ['fallback', 'default', 'degrade', 'timeout'] }
    ],
    solution: `**Two stores, one definition.** Features are defined once (a registry with versions and owners). Batch jobs and a Flink job on Kafka materialise them into an **offline store** (Parquet/Iceberg, partitioned by date) and an **online store** (a key-value store keyed by entity, e.g. Redis or DynamoDB).

**Training.** Point-in-time joins: for each label row, take each feature's latest value with event time ≤ the label's time. That is what prevents leakage.

**Serving.** 50k QPS × ~20 features: batch reads per entity, p99 < 10 ms from memory-backed KV in the same region. TTLs per feature; a stale or missing value falls back to a default and is logged.

**Correctness.** Upserts keyed by (entity, feature, event time) are idempotent, so replays and backfills are safe. Skew is monitored by logging served features and comparing with offline recomputation.`,
    hints: ['How do you build a training row without using any value that only existed after the label?', 'What runs the same transformation for training and serving?']
  },
  {
    id: 'chain-indexer',
    category: 'design',
    title: 'A blockchain indexer',
    difficulty: 1700,
    pattern: 'reorg-safe ingestion',
    methods: ['edges', 'draw', 'understand'],
    brief: 'Design an indexer for an EVM chain: ingest every block, decode events for 5,000 contracts, and serve queries like "all token transfers for address X, newest first" in under 200 ms. The chain makes a block every 2 seconds and can reorganise up to 64 blocks deep.',
    minutes: 40,
    origin: 'bank',
    checklist: [
      { point: 'Reorgs: track block hashes and parents, roll back orphaned blocks, mark data final after N confirmations', cues: ['reorg', 'orphan', 'canonical', 'finality', 'confirmation', 'parent hash'] },
      { point: 'Idempotent ingestion keyed by block hash and log index, so replays are safe', cues: ['idempot', 'upsert', 'log index', 'block hash'] },
      { point: 'Backfill of history separate from the live tail', cues: ['backfill', 'historical', 'archive'] },
      { point: 'More than one RPC provider, with health checks and failover', cues: ['provider', 'rpc', 'failover', 'node'] },
      { point: 'ABI decoding of logs by topic, per contract', cues: ['abi', 'topic', 'decode'] },
      { point: 'Storage indexed by address and block number for the transfer query', cues: ['index', 'address', 'partition', 'composite'] },
      { point: 'A checkpoint or cursor of the last processed block', cues: ['checkpoint', 'cursor', 'last processed', 'high-water', 'watermark'] },
      { point: 'Numbers: blocks per day, logs per block, storage growth', cues: ['per day', 'per block', 'per second', 'tb', 'gb'] },
      { point: 'Gaps and failures: retries, detecting missing blocks, a dead-letter path for undecodable logs', cues: ['gap', 'retry', 'dead letter', 'dlq', 'missing block'] },
      { point: 'Pagination by cursor for the API, with caching of hot addresses', cues: ['pagination', 'paginate', 'cache'] }
    ],
    solution: `**Ingest.** A tail worker follows the head through two or more RPC providers; a separate backfill fleet walks history in block ranges. Each block is stored with its hash and parent hash; a **checkpoint** records the last processed block.

**Reorgs.** On a new block whose parent hash doesn't match, walk back to the common ancestor (at most 64 blocks), delete the orphaned blocks' rows and replay the canonical ones. Rows carry a \`final\` flag set after 64 confirmations; the API can ask for final-only data.

**Decode.** Logs are decoded with each contract's ABI by topic; undecodable logs go to a dead-letter table.

**Store and serve.** Transfers in a table keyed by (address, block_number desc, log_index), partitioned by block range; cursor pagination; hot addresses cached. Upserts keyed by (block_hash, log_index) make replays idempotent.

**Numbers.** 43,200 blocks a day; at ~200 logs per block, ~9M rows a day, a few GB a day with indexes.`,
    hints: ['What happens to rows you wrote for block N when block N is replaced?', 'What key makes writing the same log twice harmless?']
  },
  {
    id: 'ledger-at-scale',
    category: 'design',
    title: 'A ledger at 50,000 postings a second',
    difficulty: 1850,
    pattern: 'hot accounts and invariants',
    methods: ['invariant', 'estimate', 'edges'],
    brief: 'Design the double-entry ledger for a payments company at 50,000 postings per second. A few merchant settlement accounts receive 30% of all postings; customer wallet balances must never go negative; finance needs an immutable audit trail and a daily trial balance.',
    minutes: 45,
    origin: 'bank',
    checklist: [
      { point: 'Double-entry invariant: every transaction’s entries sum to zero, in integer minor units', cues: ['double-entry', 'double entry', 'sum to zero', 'balanced', 'debits equal', 'minor unit'] },
      { point: 'Append-only entries; corrections by reversal', cues: ['append-only', 'append only', 'immutable', 'revers'] },
      { point: 'Hot accounts split into sub-accounts (buckets) or credits batched, and summed on read', cues: ['hot account', 'sub-account', 'sub account', 'bucket', 'batch'] },
      { point: 'No negative wallets: a conditional write or row lock on the debited account only', cues: ['conditional', 'compare-and-set', 'lock', 'optimistic', 'serializ', 'check balance'] },
      { point: 'Idempotency keys with a unique constraint', cues: ['idempot', 'unique', 'dedup'] },
      { point: 'Partitioning by account, with cross-partition transactions handled (two-phase or saga with pending entries)', cues: ['partition', 'shard', 'two-phase', '2pc', 'saga', 'pending'] },
      { point: 'Numbers: 50k/s, entries per posting, storage per year', cues: ['50,000', '50k', 'per second', 'tb', 'per year'] },
      { point: 'Ledger events through an outbox or CDC', cues: ['outbox', 'cdc', 'change data'] },
      { point: 'Daily trial balance and reconciliation with banks', cues: ['trial balance', 'reconcil'] },
      { point: 'Tamper-evident audit: hash chain or signed batches', cues: ['hash chain', 'merkle', 'tamper', 'audit'] }
    ],
    solution: `**Invariant.** Every transaction is entries that sum to zero, integer minor units. Entries are append-only; a mistake is a reversing transaction.

**Throughput.** 50k postings/s × ~2.5 entries = ~125k rows/s; partition by account id. **Hot accounts:** the settlement accounts get 32–64 sub-accounts each; a credit picks one at random; the balance is the sum over buckets (credits never need a lock, so they can be spread). **Debits** from wallets take a conditional update (\`balance - amt >= 0\`) on the one row; that is the only contended write.

**Cross-partition.** A transfer between partitions writes a pending debit, then the credit, then settles; a sweeper resolves stuck pendings (a saga with the invariant held by the pending account).

**Idempotency, events, audit.** Unique (client, key); an outbox in the same transaction feeds Kafka; each partition's entries are hash-chained per batch. A daily trial balance (all accounts sum to zero) and bank reconciliation close the loop.`,
    hints: ['Which writes truly need to see the current balance, and which do not?', 'How could one account’s credits be spread so they never contend?']
  }
]

const QUANT: SharpProblem[] = (
  [
    ['all-six-faces', 'Every face of a die', 1300, 'coupon collector', ['simplify', 'small-cases'], 'You roll a fair six-sided die until every face has appeared at least once. What is the expected number of rolls? (Two decimal places.)', 14.7, 0.01, 'After k distinct faces, a new one comes with probability (6−k)/6, so it takes 6/(6−k) rolls on average. Sum: 6(1 + 1/2 + … + 1/6) = 6 × 2.45 = **14.7**.'],
    ['two-heads-in-a-row', 'Two heads in a row', 1350, 'first-step analysis', ['draw', 'backwards'], 'You flip a fair coin until you get two heads in a row. What is the expected number of flips?', 6, 0.001, 'States: start (S), one head (H). E_S = 1 + ½E_H + ½E_S; E_H = 1 + ½·0 + ½E_S. Solving: E_S = **6**.'],
    ['broken-stick', 'A stick broken twice', 1500, 'geometric probability', ['draw', 'simplify'], 'A stick is broken at two points chosen uniformly and independently along its length. What is the probability the three pieces form a triangle?', 0.25, 0.001, 'Each piece must be under half the length. In the unit square of the two break points, the region where all three pieces are < ½ is two triangles of area ⅛ each: **¼**.'],
    ['max-of-two-dice', 'The larger of two dice', 1150, 'distribution of a maximum', ['small-cases'], 'Two fair dice are rolled. What is the expected value of the larger of the two? (Three decimal places.)', 161 / 36, 0.001, 'P(max = k) = (2k−1)/36. E = Σ k(2k−1)/36 = 161/36 ≈ **4.472**.'],
    ['one-reroll', 'One reroll', 1350, 'optimal stopping by backward induction', ['backwards'], 'You roll a fair die and are paid its face in pounds. Once, you may reroll and take the new face instead. Playing optimally, what is the game worth?', 4.25, 0.001, 'The reroll is worth 3.5, so keep 4, 5, 6 and reroll 1–3: ½ × 5 + ½ × 3.5 = **4.25**.'],
    ['two-rerolls', 'Two rerolls', 1500, 'optimal stopping by backward induction', ['backwards', 'generalise'], 'As before, but you may reroll up to twice (taking the last face you roll). Playing optimally, what is the game worth? (Three decimal places.)', 14 / 3, 0.001, 'With one reroll left the game is worth 4.25, so on the first roll keep 5 or 6: ⅓ × 5.5 + ⅔ × 4.25 = 14/3 ≈ **4.667**.'],
    ['ant-on-a-cube', 'An ant on a cube', 1650, 'symmetry and first-step analysis', ['draw', 'invariant'], 'An ant walks on the edges of a cube, moving each step to one of the three neighbouring corners at random. What is the expected number of steps to reach the corner opposite where it starts?', 10, 0.001, 'Group corners by distance 0–3 from the target. E3 = 1 + E2; E2 = 1 + ⅓E3 + ⅔E1; E1 = 1 + ⅔E2. Solving: E3 = **10**.'],
    ['gamblers-ruin', 'Ruin at ten', 1400, 'martingale', ['invariant'], 'You have £3 and bet £1 at a time on fair coin flips, stopping when you reach £10 or £0. What is the probability you reach £10?', 0.3, 0.001, 'Your wealth is a fair game (a martingale), so its expected value at the end equals the start: 10p = 3, p = **0.3**.'],
    ['birthday-23', 'Twenty-three people', 1250, 'complement counting', ['estimate', 'simplify'], 'What is the probability that at least two of 23 people share a birthday (365 equally likely days, no leap years)? (Three decimal places.)', 1 - Array.from({ length: 23 }, (_, i) => (365 - i) / 365).reduce((a, b) => a * b, 1), 0.001, 'Complement: all different is 365·364·…·343 / 365²³ ≈ 0.493, so a shared birthday ≈ **0.507**.'],
    ['fixed-points', 'Cards in their place', 1300, 'linearity of expectation (indicators)', ['generalise', 'small-cases'], 'A deck of 52 cards numbered 1 to 52 is shuffled. What is the expected number of cards that end up in their own numbered position?', 1, 0.001, 'Each card is in its place with probability 1/52; by linearity the expected count is 52 × 1/52 = **1**, whatever the deck size.'],
    ['first-ace', 'The first ace', 1650, 'symmetry of gaps', ['invariant', 'analogy'], 'A standard 52-card deck is shuffled. What is the expected position of the first ace (the top card is position 1)?', 10.6, 0.001, 'The 4 aces cut the 48 other cards into 5 gaps of equal expected size 48/5 = 9.6. The first ace comes after the first gap: 9.6 + 1 = **10.6**.'],
    ['kelly-fraction', 'How much to bet', 1450, 'Kelly criterion', ['estimate', 'generalise'], 'A bet at even odds wins with probability 0.6. Repeatedly betting a fixed fraction of your wealth, which fraction maximises long-run growth?', 0.2, 0.001, 'Maximise p log(1+f) + q log(1−f): f* = p − q = **0.2** (20%).'],
    ['no-two-heads', 'No two heads together', 1550, 'recursion (Fibonacci)', ['small-cases', 'backwards'], 'A fair coin is flipped 10 times. What is the probability that no two heads are consecutive? (Four decimal places.)', 144 / 1024, 0.0001, 'Strings of length n with no HH: a(n) = a(n−1) + a(n−2), a(1) = 2, a(2) = 3, so a(10) = 144. Probability 144/1024 ≈ **0.1406**.']
  ] as [string, string, number, string, MethodId[], string, number, number, string][]
).map(([id, title, difficulty, pattern, methods, brief, value, tolerance, solution]) => ({
  id,
  category: 'quant' as const,
  title,
  difficulty,
  pattern,
  methods,
  brief,
  minutes: difficulty >= 1500 ? 12 : 8,
  origin: 'bank' as const,
  answer: { value, tolerance },
  solution,
  hints: []
}))

const ML: SharpProblem[] = [
  {
    id: 'auc-too-good',
    category: 'ml',
    title: 'An AUC too good to be true',
    difficulty: 1400,
    pattern: 'leakage',
    methods: ['understand', 'edges'],
    brief: 'A fraud model scored 0.991 AUC on validation; a week in production it is at 0.63. Features include `chargeback_count_30d` and `account_age_days`. The training table was built from a snapshot taken last month and split randomly by row. What are the likely causes, how would you confirm each, and what do you change?',
    minutes: 25,
    origin: 'bank',
    checklist: [
      { point: 'Leakage: chargeback_count_30d from a snapshot includes chargebacks after the transaction (future information)', cues: ['leak', 'future', 'after the transaction', 'point-in-time', 'point in time', 'as-of'] },
      { point: 'A random row split lets the same accounts and time periods into train and validation; use an out-of-time split', cues: ['time-based', 'out-of-time', 'out of time', 'temporal', 'split by time', 'time split'] },
      { point: 'Group leakage: the same account on both sides; split by account', cues: ['same account', 'group', 'by account', 'by user', 'grouped'] },
      { point: 'Training/serving skew: online features computed differently from the snapshot', cues: ['skew', 'serving', 'online feature', 'pipeline'] },
      { point: 'Confirm by ablation or importance: drop the suspect feature and re-validate out of time', cues: ['ablation', 'drop the feature', 'importance', 'shap', 'remove the feature'] },
      { point: 'Rebuild training data with point-in-time joins and monitor production performance', cues: ['rebuild', 'monitor', 'retrain'] }
    ],
    solution: 'The giveaway is a near-perfect offline score. `chargeback_count_30d` taken from a **snapshot** counts chargebacks that happened *after* each transaction, including the transaction’s own: label leakage. A **random row split** compounds it (the same accounts and weeks on both sides). Confirm with an out-of-time split grouped by account and an ablation of the suspect features; check served features against the training table for skew. Fix: point-in-time joins (each feature as of the transaction time), an out-of-time validation set, and production monitoring of the score distribution and delayed labels.',
    hints: ['What did the snapshot know that the model would not know at decision time?', 'Which split would mimic production?']
  },
  {
    id: 'ab-sample-size',
    category: 'ml',
    title: 'How many users per arm',
    difficulty: 1350,
    pattern: 'power analysis',
    methods: ['estimate', 'understand'],
    brief: 'Checkout conversion is 4.0%. You want to detect an absolute lift to 4.4% with a two-sided test at α = 0.05 and 80% power. About how many users do you need in each arm? (A whole number; within 5% counts.)',
    minutes: 15,
    origin: 'bank',
    answer: { value: 39_473, tolerance: 2_000 },
    solution: 'n = (z₀.₉₇₅ + z₀.₈)² × (p₁(1−p₁) + p₂(1−p₂)) / (p₂ − p₁)² = (1.960 + 0.842)² × (0.0384 + 0.04206) / 0.004² ≈ 7.85 × 0.08046 / 0.000016 ≈ **39,500 per arm**. Sanity check: detecting a 10% relative lift on a 4% base rate always needs tens of thousands per arm.',
    hints: ['Which formula links the effect size, the variance of a proportion, α and power?']
  },
  {
    id: 'loss-goes-nan',
    category: 'ml',
    title: 'Loss goes to NaN at step 2,000',
    difficulty: 1450,
    pattern: 'training instability',
    methods: ['simplify', 'edges'],
    brief: 'You are training a 300M-parameter transformer in fp16 mixed precision, learning rate 3e-4 with no warm-up, batch 512. The loss falls normally for about 2,000 steps, then becomes NaN. Gradient norms spike to around 1e4 just before. Diagnose and fix, most likely cause first, and say how you would confirm each.',
    minutes: 25,
    origin: 'bank',
    checklist: [
      { point: 'Too high a learning rate for the start of training: add warm-up (and maybe lower the peak)', cues: ['warmup', 'warm-up', 'warm up', 'learning rate', 'lr'] },
      { point: 'Clip the gradient norm', cues: ['clip'] },
      { point: 'fp16 overflow: dynamic loss scaling, or train in bf16', cues: ['loss scal', 'bf16', 'overflow', 'bfloat'] },
      { point: 'A bad batch (inf, NaN or extreme values): log and skip it', cues: ['bad batch', 'inf', 'nan in', 'outlier', 'data'] },
      { point: 'Numerics of layer norm or softmax: epsilon, attention logits', cues: ['epsilon', 'eps', 'layernorm', 'layer norm', 'logit'] },
      { point: 'Confirm by resuming from a checkpoint before the spike with one change at a time', cues: ['checkpoint', 'resume', 'one change', 'reproduce', 'bisect'] }
    ],
    solution: 'Most likely: **no warm-up** with Adam at 3e-4: early updates are large while second-moment estimates are poor, the gradient norm explodes, and **fp16 overflows** to inf then NaN. Fixes: linear warm-up (~2k steps), **gradient clipping** at 1.0, dynamic loss scaling or **bf16**. Also check for a **bad batch** (log the batch at the spike) and epsilons in layer norm. Confirm by resuming from a checkpoint before the spike and changing one thing at a time.',
    hints: ['What is unusual about the first few thousand steps of Adam with a fixed learning rate?']
  },
  {
    id: 'mape-overnight',
    category: 'ml',
    title: 'Error tripled overnight',
    difficulty: 1250,
    pattern: 'data bugs before drift',
    methods: ['estimate', 'understand'],
    brief: 'A demand-forecast model’s MAPE went from 8% to 31% overnight. Nothing was deployed. The input feature `price` had a mean of 23.4 yesterday and 2,340 today. What happened, what do you do right now, and what stops it happening again?',
    minutes: 15,
    origin: 'bank',
    checklist: [
      { point: 'A unit change upstream (dollars to cents, ×100), not concept drift', cues: ['cents', 'unit', '100', 'x100', '×100'] },
      { point: 'It is a data bug, not drift: the world did not change overnight', cues: ['not drift', 'data bug', 'data quality', 'bug', 'not concept drift'] },
      { point: 'Mitigate now: fall back to the last good model or input, or rescale', cues: ['fallback', 'fall back', 'rollback', 'roll back', 'rescale', 'divide by 100'] },
      { point: 'Talk to the upstream owner; a data contract on schema and units', cues: ['upstream', 'contract', 'owner', 'schema'] },
      { point: 'Validation on inputs: ranges and distribution checks that alert or block', cues: ['validation', 'range check', 'expectation', 'alert', 'guard'] },
      { point: 'Backfill or recompute the bad day’s forecasts', cues: ['backfill', 'recompute', 'rerun'] }
    ],
    solution: 'A ×100 jump in a mean overnight with no deploy is a **unit change upstream** (dollars to cents), a data bug, not drift. Now: fall back to the last good inputs or model (or divide by 100 if confirmed) and rerun today’s forecasts. Then: a data contract with the owner, and input validation (ranges, distribution checks) that blocks the pipeline before the model sees bad data.',
    hints: ['Estimate first: what is 2,340 ÷ 23.4?']
  },
  {
    id: 'offline-up-online-down',
    category: 'ml',
    title: 'Better offline, worse online',
    difficulty: 1600,
    pattern: 'offline–online gap',
    methods: ['analogy', 'understand'],
    brief: 'A new ranking model improves NDCG@10 by 3% offline, but the online A/B test shows click-through down 0.5% after a week. Give the most likely explanations and design the next experiment.',
    minutes: 25,
    origin: 'bank',
    checklist: [
      { point: 'The offline metric is a proxy, misaligned with clicks (labels from the old ranker)', cues: ['proxy', 'misalign', 'offline metric', 'label'] },
      { point: 'Position bias and feedback loops: logged data reflects the old policy; use counterfactual methods (IPS) or interleaving', cues: ['position bias', 'feedback loop', 'counterfactual', 'ips', 'interleav', 'logged'] },
      { point: 'Novelty or primacy effects: run longer, look at the trend by day', cues: ['novelty', 'primacy', 'longer', 'by day'] },
      { point: 'Check the experiment is healthy: sample ratio mismatch, A/A test', cues: ['sample ratio', 'srm', 'a/a', 'aa test'] },
      { point: 'Latency or serving differences that cost clicks', cues: ['latency', 'serving', 'timeout'] },
      { point: 'Segment the result (new versus returning, device, query type)', cues: ['segment', 'cohort', 'heterogen', 'device'] }
    ],
    solution: 'Offline NDCG is measured on labels **logged under the old ranker**: position bias and the feedback loop reward agreeing with it. The online drop may also be **latency**, a **novelty/primacy** effect, or a broken experiment (**sample ratio mismatch**). Next: check SRM and latency; segment by user type and device; run **interleaving** (more sensitive, removes position bias) and evaluate offline with inverse propensity weighting; run long enough to see the trend settle.',
    hints: ['Whose ranking produced the clicks you used as labels offline?']
  },
  {
    id: 'alerts-per-day',
    category: 'ml',
    title: 'Alerts per day',
    difficulty: 1150,
    pattern: 'base rates',
    methods: ['estimate'],
    brief: 'A fraud classifier scores 1,000,000 transactions a day; 0.2% are fraud. At the chosen threshold, recall is 80% and the false-positive rate is 1%. How many alerts does the team get each day?',
    minutes: 8,
    origin: 'bank',
    answer: { value: 11_580, tolerance: 1 },
    solution: 'Fraud: 2,000 × 0.8 = 1,600 caught. Genuine: 998,000 × 0.01 = 9,980 false alarms. **11,580** alerts a day, and only 14% of them fraud: the base rate rules.',
    hints: []
  }
]

const PROOFS: SharpProblem[] = [
  {
    id: 'odd-numbers-square',
    category: 'proofs',
    title: 'Odd numbers make squares',
    difficulty: 1050,
    pattern: 'induction',
    methods: ['small-cases', 'generalise'],
    brief: 'Prove that 1 + 3 + 5 + … + (2n − 1) = n² for every positive integer n.',
    minutes: 12,
    origin: 'bank',
    checklist: [
      { point: 'Base case n = 1', cues: ['base case', 'n = 1', 'n=1'] },
      { point: 'Inductive hypothesis: assume it for k', cues: ['assume', 'hypothesis', 'suppose'] },
      { point: 'Inductive step adds the next odd number, 2k + 1', cues: ['2k+1', '2k + 1', '2(k+1)-1', '2(k + 1) - 1', '2(k+1) − 1'] },
      { point: 'k² + 2k + 1 = (k + 1)², so it holds for k + 1', cues: ['(k+1)^2', '(k + 1)^2', '(k+1)²', '(k + 1)²', 'k^2 + 2k + 1', 'k² + 2k + 1'] }
    ],
    solution: 'Base: 1 = 1². Step: if 1 + … + (2k − 1) = k², adding the next odd number 2k + 1 gives k² + 2k + 1 = (k + 1)². By induction it holds for all n. (Or: draw it. Each odd number is an L-shaped layer around a square.)',
    hints: ['What do you add to go from the sum for k to the sum for k + 1?']
  },
  {
    id: 'root-two',
    category: 'proofs',
    title: '√2 is irrational',
    difficulty: 1150,
    pattern: 'contradiction via parity',
    methods: ['backwards', 'invariant'],
    brief: 'Prove that √2 is not a rational number.',
    minutes: 12,
    origin: 'bank',
    checklist: [
      { point: 'Suppose √2 = p/q in lowest terms', cues: ['lowest terms', 'coprime', 'gcd', 'no common factor'] },
      { point: 'Then p² = 2q², so p² and hence p is even', cues: ['p is even', 'p even', 'p^2 = 2q^2', 'p² = 2q²', 'p^2 is even', 'p² is even'] },
      { point: 'Write p = 2m: then q² = 2m², so q is even', cues: ['q is even', 'q even', 'q^2 = 2m^2', 'q² = 2m²'] },
      { point: 'Both even contradicts lowest terms', cues: ['contradiction', 'contradicts'] }
    ],
    solution: 'Suppose √2 = p/q with p, q coprime. Then p² = 2q², so p² is even and so p is even (odd² is odd). Write p = 2m: 4m² = 2q², so q² = 2m² and q is even too. Then 2 divides both: a contradiction. So √2 is irrational.',
    hints: ['Suppose it were p/q in lowest terms. What does p² = 2q² tell you about p?']
  },
  {
    id: 'checkerboard-dominoes',
    category: 'proofs',
    title: 'The mutilated chessboard',
    difficulty: 1250,
    pattern: 'colouring invariant',
    methods: ['invariant', 'draw'],
    brief: 'Two diagonally opposite corner squares are removed from an 8×8 chessboard. Prove that the remaining 62 squares cannot be covered by 31 dominoes (each covering two adjacent squares).',
    minutes: 15,
    origin: 'bank',
    checklist: [
      { point: 'Colour the board in the usual black and white pattern', cues: ['colour', 'color', 'black and white', 'white and black'] },
      { point: 'Opposite corners are the same colour', cues: ['same colour', 'same color', 'both white', 'both black'] },
      { point: 'Every domino covers one square of each colour', cues: ['one black and one white', 'one white and one black', 'one of each', 'each colour'] },
      { point: 'The counts are 30 and 32, so 31 dominoes (31 of each) cannot fit', cues: ['30', '32', 'unequal', 'not equal'] }
    ],
    solution: 'Colour the board as a chessboard. Opposite corners have the same colour, so after removing them there are 30 squares of one colour and 32 of the other. Each domino covers one black and one white square, so 31 dominoes cover 31 of each. 30 ≠ 31: no tiling exists.',
    hints: ['Is there something every domino does, wherever it is placed?']
  },
  {
    id: 'handshakes',
    category: 'proofs',
    title: 'Odd degrees come in pairs',
    difficulty: 1100,
    pattern: 'double counting',
    methods: ['invariant', 'small-cases'],
    brief: 'Prove that every finite graph has an even number of vertices of odd degree.',
    minutes: 12,
    origin: 'bank',
    checklist: [
      { point: 'The sum of all degrees is twice the number of edges (each edge counted at both ends)', cues: ['2e', '2|e|', 'twice the number of edges', 'each edge', 'sum of degrees', 'handshak', 'sum of the degrees'] },
      { point: 'So the degree sum is even', cues: ['even'] },
      { point: 'Split it into even-degree and odd-degree vertices; the even part is even', cues: ['odd degree', 'odd-degree', 'odd vertices'] },
      { point: 'A sum of odd numbers is even only if there is an even count of them', cues: ['parity', 'even number of odd', 'must be even'] }
    ],
    solution: 'Each edge adds 1 to the degree of each of its two ends, so Σ deg(v) = 2|E|, which is even. The even-degree vertices contribute an even amount, so the odd-degree vertices’ degrees also sum to an even number. A sum of odd numbers is even only when there is an even number of terms.',
    hints: ['Count the edge-ends two ways.']
  },
  {
    id: 'equal-subset-sums',
    category: 'proofs',
    title: 'Two subsets with equal sums',
    difficulty: 1650,
    pattern: 'pigeonhole on sums',
    methods: ['estimate', 'analogy'],
    brief: 'Prove that any 10 distinct integers chosen from 1 to 100 contain two disjoint non-empty subsets with the same sum.',
    minutes: 25,
    origin: 'bank',
    checklist: [
      { point: 'There are 2¹⁰ − 1 = 1023 non-empty subsets', cues: ['1023', '1024', '2^10', '2¹⁰'] },
      { point: 'Every subset sum is at most 91 + … + 100 = 955', cues: ['955', 'at most'] },
      { point: 'Pigeonhole: two different subsets have the same sum', cues: ['pigeonhole'] },
      { point: 'Remove their common elements to make them disjoint (and still equal, still non-empty)', cues: ['disjoint', 'common element', 'intersection', 'remove'] }
    ],
    solution: 'There are 1023 non-empty subsets, and every sum lies between 1 and 91 + 92 + … + 100 = 955. With 1023 subsets and at most 955 sums, two different subsets A ≠ B share a sum (pigeonhole). Remove A ∩ B from both: the sums stay equal, the sets become disjoint, and neither is empty (if one were, the other would have sum 0, impossible for positive integers, unless A = B).',
    hints: ['Estimate first: how many subsets are there, and how many possible sums?']
  },
  {
    id: 'primes-3-mod-4',
    category: 'proofs',
    title: 'Infinitely many primes of the form 4k + 3',
    difficulty: 1750,
    pattern: 'Euclid-style construction',
    methods: ['analogy', 'invariant'],
    brief: 'Prove that there are infinitely many primes of the form 4k + 3.',
    minutes: 30,
    origin: 'bank',
    checklist: [
      { point: 'Suppose there are finitely many, p₁, …, pₙ', cues: ['finitely many', 'suppose', 'assume'] },
      { point: 'Build N = 4p₁⋯pₙ − 1 (≡ 3 mod 4)', cues: ['4p', '4 p', '- 1', '−1', '-1', '4·', '4*'] },
      { point: 'A product of primes all ≡ 1 mod 4 is ≡ 1 mod 4, so N has a prime factor ≡ 3 mod 4', cues: ['1 mod 4', '4k+1', '4k + 1', '≡ 1', 'product'] },
      { point: 'That factor is none of the pᵢ (each leaves remainder −1), a contradiction', cues: ['not in the list', 'none of', 'not among', 'divides', 'contradiction'] }
    ],
    solution: 'Suppose p₁, …, pₙ are all the primes ≡ 3 (mod 4). Let N = 4p₁⋯pₙ − 1, so N ≡ 3 (mod 4) and N is odd. If every prime factor of N were ≡ 1 (mod 4), so would N be (products of 1 mod 4 numbers are 1 mod 4). So some prime q ≡ 3 (mod 4) divides N. But each pᵢ leaves remainder −1 on dividing N, so q is not in the list: a contradiction.',
    hints: ['You know Euclid’s proof for all primes. What should the new number be congruent to?']
  }
]

export const SHARP_BANK: SharpProblem[] = [...ALGORITHMS, ...DESIGN, ...QUANT, ...ML, ...PROOFS]

export const sharpProblem = (id: string) => SHARP_BANK.find((p) => p.id === id)

/**
 * A bank problem for a category near a difficulty: not one tried lately, the method to train
 * preferred, a pattern asked for preferred over everything; nearest difficulty wins, ties by seed.
 */
export function pickFromBank(o: { category: SharpProblem['category']; difficulty: number; recent: string[]; method?: MethodId; pattern?: string; seed: number }, bank: SharpProblem[] = SHARP_BANK): SharpProblem {
  const pool = bank.filter((p) => p.category === o.category)
  const fresh = pool.filter((p) => !o.recent.includes(p.id))
  const from = fresh.length ? fresh : pool
  const score = (p: SharpProblem) => Math.abs(p.difficulty - o.difficulty) - (o.method && p.methods.includes(o.method) ? 150 : 0) - (o.pattern && p.pattern.toLowerCase().includes(o.pattern.toLowerCase()) ? 400 : 0)
  const ranked = [...from].sort((a, b) => score(a) - score(b))
  const best = ranked.filter((p) => score(p) <= score(ranked[0]) + 60)
  return best[o.seed % best.length]
}
