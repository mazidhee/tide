/* Sample knowledge for the pathways prototype. Everything here is invented; nothing is read from the Mac.
 * The model follows native/tide-core/src/knowledge.rs: an estimate decays from the last level with a
 * half-life, status is new / learning / solid (estimate >= 0.6) / fading (level reached 0.6, estimate
 * has fallen below), and "ready next" is anything not solid and not fading whose prerequisites are all solid. */
(function () {
  'use strict'
  const SOLID = 0.6
  const DAY = 86400000
  const SEED = 364

  // Areas in the order their bands sit, top to bottom. Colours are the design's area tokens;
  // a6 is new for this prototype (the app has five areas).
  const AREAS = [
    { id: 'phil', name: 'Philosophy', token: '--a6', reach: 3 },
    { id: 'ml', name: 'Machine learning', token: '--a3', reach: 6 },
    { id: 'maths', name: 'Mathematics', token: '--a4', reach: 7 },
    { id: 'fin', name: 'Finance', token: '--a5', reach: 4 },
    { id: 'dist', name: 'Distributed systems', token: '--a2', reach: 7 },
    { id: 'cs', name: 'Computer systems', token: '--a1', reach: 14 },
  ]

  // "Name < prerequisite; prerequisite". Prerequisites may be in any area.
  const SOURCE = {
    cs: `Bits and binary
Boolean logic < Bits and binary
Two's complement < Bits and binary
Floating point < Two's complement
Hash functions < Bits and binary
Logic gates < Boolean logic
Adders and ALUs < Logic gates; Two's complement
Memory cells and registers < Logic gates
Instruction set architecture < Adders and ALUs; Memory cells and registers
x86-64 assembly < Instruction set architecture
Calling conventions < x86-64 assembly
The stack and calls < Calling conventions
Pipelining < Instruction set architecture
Branch prediction < Pipelining
Out-of-order execution < Pipelining
SIMD < Instruction set architecture
Caches and locality < Memory cells and registers
Cache coherence < Caches and locality
Memory ordering < Cache coherence; Out-of-order execution
Atomic operations < Memory ordering
Compilation pipeline < x86-64 assembly
Linking and loading < Compilation pipeline
ELF format < Linking and loading
Processes < The stack and calls
System calls < Processes
Signals < System calls
File descriptors < System calls
Virtual memory < Processes; Caches and locality
Page tables < Virtual memory
TLB misses and page walks < Page tables
Memory allocators < Virtual memory
Garbage collection < Memory allocators
Threads < Processes
Mutexes and locks < Threads; Atomic operations
Condition variables < Mutexes and locks
Deadlock < Mutexes and locks
Lock-free queues < Atomic operations; Memory ordering
Scheduling < Threads
Context switches < Scheduling; System calls
File systems < File descriptors
Inodes and directories < File systems
Journaling < File systems
Page cache < File systems; Virtual memory
fsync and durability < Page cache; Journaling
Block devices and SSDs < File systems
B-trees < Block devices and SSDs
Sockets < File descriptors
TCP < Sockets
UDP < Sockets
Async I/O and epoll < Sockets; Threads
io_uring < Async I/O and epoll
Zero-copy I/O < Page cache; Sockets
NUMA < Caches and locality; Scheduling
Containers and namespaces < Processes; File systems
eBPF < System calls; Compilation pipeline`,
    dist: `Network models < TCP
Failure models < Network models
RPC < TCP
Serialisation formats < RPC
Idempotency < RPC
Timeouts and retries < RPC; Failure models
Physical clocks < Network models
Logical clocks < Physical clocks
Happens-before < Logical clocks
Vector clocks < Happens-before
Leaders and followers < Failure models
Sync and async replication < Leaders and followers
Replication lag < Sync and async replication
Multi-leader replication < Replication lag
Leaderless replication < Replication lag
Quorums < Leaderless replication
Read repair < Quorums
Merkle trees and anti-entropy < Read repair; Hash functions
Partitioning < Leaders and followers
Consistent hashing < Partitioning; Hash functions
Rebalancing < Consistent hashing
Secondary indexes < Partitioning; B-trees
Failure detectors < Timeouts and retries
Gossip protocols < Failure detectors
Service discovery < Gossip protocols
Consensus problem < Failure models
FLP impossibility < Consensus problem
Paxos < Consensus problem; Quorums
Multi-Paxos < Paxos
Raft < Consensus problem; Leaders and followers
Raft log compaction < Raft
Leader leases < Raft; Physical clocks
Linearisability < Happens-before; Quorums
Write-ahead logging < fsync and durability
Log-structured merge trees < Write-ahead logging; B-trees
Transactions and ACID < Write-ahead logging
Isolation levels < Transactions and ACID
MVCC < Transactions and ACID
Snapshot isolation < Isolation levels; MVCC
Serialisability < Isolation levels
Two-phase commit < Transactions and ACID; Failure models
Three-phase commit < Two-phase commit
Sagas < Two-phase commit; Idempotency
CAP theorem < Linearisability; Partitioning
PACELC < CAP theorem
Eventual consistency < Leaderless replication
Causal consistency < Vector clocks; Eventual consistency
CRDTs < Eventual consistency; Vector clocks; Lattices and orders
Spanner and TrueTime < Leader leases; Two-phase commit; Linearisability
Byzantine faults < Failure models
PBFT < Byzantine faults; Quorums
Blockchain consensus < Byzantine faults; Hash functions; Digital signatures
Kafka log < Partitioning; Write-ahead logging
Exactly-once delivery < Idempotency; Kafka log
Stream processing < Kafka log
Backpressure < Stream processing
Distributed tracing < RPC`,
    maths: `Sets and functions
Logic and proof
Proof by induction < Logic and proof
Combinatorics < Sets and functions
Modular arithmetic < Proof by induction
Primes and the Euclidean algorithm < Modular arithmetic
Groups < Modular arithmetic; Sets and functions
Fields and finite fields < Groups
Elliptic curves < Fields and finite fields
Digital signatures < Elliptic curves; Hash functions
Lattices and orders < Sets and functions
Graph theory < Sets and functions
Limits < Sets and functions
Asymptotic notation < Limits
Recurrences < Proof by induction; Asymptotic notation
Derivatives < Limits
Chain rule < Derivatives
Integrals < Derivatives
Taylor series < Integrals
Partial derivatives < Chain rule
Vectors < Sets and functions
Matrices < Vectors
Matrix multiplication < Matrices
Linear maps < Matrix multiplication
Determinants < Linear maps
Eigenvalues and eigenvectors < Determinants
Orthogonality < Linear maps
Singular value decomposition < Eigenvalues and eigenvectors; Orthogonality
Gradients < Partial derivatives; Vectors
Jacobians < Partial derivatives; Linear maps
Convexity < Derivatives; Vectors
Lagrange multipliers < Gradients; Convexity
Probability axioms < Sets and functions; Combinatorics
Conditional probability < Probability axioms
Bayes' theorem < Conditional probability
Random variables < Probability axioms
Expectation and variance < Random variables; Integrals
Common distributions < Random variables
Normal distribution < Common distributions
Law of large numbers < Expectation and variance
Central limit theorem < Law of large numbers; Normal distribution
Maximum likelihood < Expectation and variance; Derivatives
Hypothesis testing < Central limit theorem
Confidence intervals < Central limit theorem
Markov chains < Conditional probability; Matrices
Information and entropy < Expectation and variance
KL divergence < Information and entropy
Stochastic processes < Markov chains
Brownian motion < Stochastic processes; Normal distribution
Itô's lemma < Brownian motion; Taylor series
Fourier series < Integrals; Orthogonality
Ordinary differential equations < Integrals
Numerical stability < Floating point; Derivatives
Monte Carlo methods < Law of large numbers`,
    ml: `Supervised learning < Random variables
Linear regression < Matrices; Supervised learning
Least squares < Linear regression; Orthogonality
Loss functions < Supervised learning
Gradient descent < Gradients; Loss functions
Stochastic gradient descent < Gradient descent; Expectation and variance
Momentum and Adam < Stochastic gradient descent
Learning rate schedules < Momentum and Adam
Logistic regression < Linear regression; Maximum likelihood
Cross-entropy < Logistic regression; Information and entropy
Softmax < Cross-entropy
Overfitting and generalisation < Supervised learning
Bias–variance trade-off < Overfitting and generalisation; Expectation and variance
Regularisation < Overfitting and generalisation
Cross-validation < Overfitting and generalisation
Decision trees < Supervised learning; Information and entropy
Gradient-boosted trees < Decision trees; Gradient descent
k-means < Vectors
PCA < Singular value decomposition
Perceptron < Linear regression
Multilayer perceptrons < Perceptron; Softmax
Activation functions < Multilayer perceptrons
Backpropagation < Multilayer perceptrons; Chain rule; Jacobians
Automatic differentiation < Backpropagation
Weight initialisation < Backpropagation; Normal distribution
Batch normalisation < Backpropagation
Dropout < Regularisation; Multilayer perceptrons
Convolutional networks < Multilayer perceptrons
Residual connections < Convolutional networks; Backpropagation
Recurrent networks < Backpropagation
LSTMs < Recurrent networks
Embeddings < Multilayer perceptrons
Tokenisation < Embeddings
Attention < Embeddings; Softmax
Self-attention < Attention
Positional encodings < Self-attention
Layer normalisation < Batch normalisation
Transformers < Self-attention; Positional encodings; Layer normalisation; Residual connections
Language model pre-training < Transformers; Cross-entropy
KV cache < Transformers
Quantisation < Transformers; Floating point
Mixed precision < Floating point; Backpropagation
Fine-tuning < Language model pre-training
Markov decision processes < Markov chains
Value functions < Markov decision processes
Q-learning < Value functions
Policy gradients < Value functions; Gradient descent
LoRA < Fine-tuning; Singular value decomposition
RLHF < Fine-tuning; Policy gradients
Variational autoencoders < KL divergence; Backpropagation
Diffusion models < Variational autoencoders; Stochastic processes
Retrieval-augmented generation < Embeddings; Language model pre-training
Speculative decoding < KV cache
Data parallelism < Stochastic gradient descent; RPC
Model parallelism < Data parallelism; Transformers`,
    fin: `Time value of money
Compound interest < Time value of money
Present value < Compound interest
Bonds < Present value
Yield curves < Bonds
Duration and convexity < Bonds; Derivatives
Inflation and real rates < Yield curves
Central bank policy < Inflation and real rates
Double-entry bookkeeping
Balance sheets < Double-entry bookkeeping
Income statements < Double-entry bookkeeping
Cash flow statements < Balance sheets; Income statements
Ledgers and journals < Double-entry bookkeeping
Reconciliation < Ledgers and journals
Equity and shares < Balance sheets
Discounted cash flow < Present value; Cash flow statements
Risk and return < Expectation and variance
Diversification < Risk and return
Portfolio theory < Diversification; Lagrange multipliers
CAPM < Portfolio theory
Efficient markets < CAPM
Order books < Equity and shares
Bid–ask spread < Order books
Market making < Order books
Market microstructure < Market making; Bid–ask spread
Forwards and futures < Present value
Options < Forwards and futures
Put–call parity < Options
Binomial option pricing < Options; Common distributions
Black–Scholes < Binomial option pricing; Itô's lemma
The Greeks < Black–Scholes; Partial derivatives
Volatility smiles < Black–Scholes
Value at risk < Normal distribution; Risk and return
Monte Carlo pricing < Monte Carlo methods; Options
Payment rails < Ledgers and journals
Card networks < Payment rails
ACH and bank transfers < Payment rails
Real-time payments < ACH and bank transfers
Payment idempotency < Payment rails; Idempotency
Clearing and settlement < Payment rails; Reconciliation
Chargebacks and disputes < Card networks
Foreign exchange < Time value of money
Stablecoins < Foreign exchange; Blockchain consensus
Smart contracts < Blockchain consensus
Automated market makers < Smart contracts; Market making
Credit risk < Bonds; Conditional probability
Credit scoring < Credit risk; Logistic regression
Fraud detection < Gradient-boosted trees; Card networks
Anti-money laundering < Clearing and settlement
Ledger databases < Ledgers and journals; Transactions and ACID
Event-sourced ledgers < Ledger databases; Kafka log`,
    phil: `Arguments and validity
Deduction and induction < Arguments and validity
Fallacies < Arguments and validity
Propositional logic < Arguments and validity; Logic and proof
Predicate logic < Propositional logic
Modal logic < Predicate logic
Gödel's incompleteness < Predicate logic; Proof by induction
Turing machines < Predicate logic
Halting problem < Turing machines
Church–Turing thesis < Turing machines
Computational complexity < Turing machines; Asymptotic notation
P versus NP < Computational complexity
Knowledge as justified true belief < Arguments and validity
Gettier problems < Knowledge as justified true belief
Scepticism < Knowledge as justified true belief
Rationalism and empiricism < Knowledge as justified true belief
Hume's problem of induction < Deduction and induction; Rationalism and empiricism
Bayesian epistemology < Hume's problem of induction; Bayes' theorem
Falsifiability < Hume's problem of induction
Kuhn and paradigm shifts < Falsifiability
Scientific realism < Kuhn and paradigm shifts
Philosophy of mathematics < Gödel's incompleteness; Rationalism and empiricism
Mind–body problem < Rationalism and empiricism
Functionalism < Mind–body problem; Turing machines
The Chinese room < Functionalism
Consciousness and qualia < Mind–body problem
Personal identity < Mind–body problem
Free will and determinism < Mind–body problem
Existentialism < Free will and determinism
Consequentialism < Arguments and validity
Utilitarianism < Consequentialism
Deontology < Arguments and validity
Kant's categorical imperative < Deontology
Virtue ethics < Arguments and validity
Stoicism < Virtue ethics
Moral realism < Utilitarianism; Deontology
Social contract < Deontology
Rawls and justice as fairness < Social contract
Philosophy of language < Predicate logic
Meaning and reference < Philosophy of language
Wittgenstein's language games < Meaning and reference
Speech acts < Meaning and reference
Decision theory < Expectation and variance; Consequentialism
Game theory < Decision theory
Prisoner's dilemma < Game theory
Mechanism design < Game theory
Ethics of AI < Utilitarianism; Language model pre-training
AI alignment < Ethics of AI; RLHF`,
  }

  // The parts a topic is broken into when the map is filled out to 2,000 concepts
  const ASPECTS = ['definitions', 'worked examples', 'edge cases', 'proof sketch', 'in practice', 'failure modes', 'trade-offs', 'exercises', 'implementation', 'history']

  function rng(seed) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

  function build(target, seed = SEED) {
    const r = rng(seed)
    const now = Date.UTC(2026, 10, 11, 9, 0)
    const concepts = []
    const byName = new Map()
    for (const a of AREAS) {
      SOURCE[a.id].trim().split('\n').forEach((line, order) => {
        const [name, needs] = line.split(' < ')
        const c = { id: slug(name), name: name.trim(), area: a.id, order, needsNames: needs ? needs.split(';').map((s) => s.trim()) : [], parent: null }
        concepts.push(c)
        byName.set(c.name, c)
      })
    }
    for (const c of concepts) {
      c.prereq = c.needsNames.map((n) => {
        const p = byName.get(n)
        if (!p) console.warn('unknown prerequisite', n, 'for', c.name)
        return p
      }).filter(Boolean)
    }
    // Fill out to the target size with the parts of each topic, as a lesson's plan would
    const base = concepts.slice()
    if (target > base.length) {
      const need = target - base.length
      const per = need / base.length
      const ks = base.map(() => Math.min(ASPECTS.length, Math.floor(per) + (r() < per - Math.floor(per) ? 1 : 0)))
      let sum = ks.reduce((a, b) => a + b, 0)
      while (sum !== need) { const j = Math.floor(r() * ks.length); if (sum < need && ks[j] < ASPECTS.length) { ks[j]++; sum++ } else if (sum > need && ks[j] > 0) { ks[j]--; sum-- } }
      base.forEach((b, bi) => {
        const k = ks[bi]
        const start = Math.floor(r() * ASPECTS.length)
        let prev = b
        for (let i = 0; i < k; i++) {
          const name = `${b.name}: ${ASPECTS[(start + i) % ASPECTS.length]}`
          const c = { id: slug(name), name, area: b.area, order: b.order + (i + 1) / 20, prereq: [prev], parent: b }
          // Some parts lean on a part of something the topic rests on
          if (i > 0 && b.prereq.length && r() < 0.35) {
            const q = b.prereq[Math.floor(r() * b.prereq.length)]
            if (q.parts && q.parts.length) c.prereq.push(q.parts[Math.floor(r() * q.parts.length)])
          }
          c.part = i; c.of = k
          ;(b.parts ||= []).push(c)
          concepts.push(c)
          prev = c
        }
      })
    }
    const n = concepts.length
    concepts.forEach((c, i) => { c.i = i; c.next = [] })
    for (const c of concepts) for (const p of c.prereq) p.next.push(c)

    // Topological order and depth (the longest chain back to a fundamental)
    const order = []
    const state = new Uint8Array(n)
    const visit = (c) => {
      if (state[c.i] === 2) return
      if (state[c.i] === 1) throw new Error('cycle at ' + c.name)
      state[c.i] = 1
      for (const p of c.prereq) visit(p)
      state[c.i] = 2
      order.push(c)
    }
    concepts.forEach(visit)
    for (const c of order) c.depth = c.prereq.length ? Math.max(...c.prereq.map((p) => p.depth)) + 1 : 0
    // Depth within its own area, for how far along the learner is there
    for (const c of order) c.localDepth = Math.max(0, ...c.prereq.filter((p) => p.area === c.area).map((p) => p.localDepth + 1))

    // Importance: how many concepts rest on it, directly or not
    const mark = new Int32Array(n).fill(-1)
    for (const c of concepts) {
      let count = 0
      const stack = [...c.next]
      while (stack.length) {
        const d = stack.pop()
        if (mark[d.i] === c.i) continue
        mark[d.i] = c.i
        count++
        for (const e of d.next) if (mark[e.i] !== c.i) stack.push(e)
      }
      c.importance = count
    }

    // Evidence, simulated: what was studied, how well, how long ago
    // Its own generator, so the 320 topics have the same evidence whether or not the parts are added
    const REACH = Object.fromEntries(AREAS.map((a) => [a.id, a.reach]))
    const r2 = rng(seed * 7 + 1)
    for (const c of order) {
      const r = r2
      const known = c.prereq.length ? c.prereq.filter((p) => p.seen > 0).length / c.prereq.length : 1
      const solidPre = c.prereq.length ? c.prereq.filter((p) => p.level >= SOLID).length / c.prereq.length : 1
      const reach = REACH[c.area]
      let p = (known === 1 ? 1 : known >= 0.5 ? 0.35 : 0.04) * (c.localDepth <= reach ? 0.96 - 0.012 * c.localDepth : c.localDepth === reach + 1 ? 0.4 : 0.07)
      if (c.parent) p = c.parent.seen > 0 ? 0.7 * known + 0.05 : 0.01
      if (r() < p) {
        c.level = c.parent && c.parent.level ? Math.min(1, Math.max(0.3, c.parent.level + (r() - 0.5) * 0.4)) : 0.42 + 0.58 * Math.pow(r(), 0.55)
        c.halfLife = 10 + 170 * Math.pow(r(), 1.2)
        const days = 50 * Math.pow(r(), 2.6)
        c.lastSeen = now - days * DAY
        c.firstSeen = c.lastSeen - (10 + 160 * r()) * DAY
        c.seen = 1 + Math.floor(r() * 3 + c.level * 10 * r())
        c.right = Math.round(c.seen * c.level * (0.7 + 0.3 * r()))
        c.partly = Math.min(c.seen - c.right, Math.round(r() * 2))
        c.wrong = Math.max(0, c.seen - c.right - c.partly)
        c.estimate = c.level * Math.pow(0.5, days / c.halfLife)
      } else {
        c.level = 0; c.halfLife = 1; c.seen = 0; c.right = 0; c.partly = 0; c.wrong = 0; c.estimate = 0; c.lastSeen = null; c.firstSeen = null
      }
      c.status = c.seen === 0 ? 'new' : c.estimate >= SOLID ? 'solid' : c.level >= SOLID ? 'fading' : 'learning'
      // Days until a solid concept falls to the line; for a fading one, how long ago it did
      if (c.seen) {
        const since = (now - c.lastSeen) / DAY
        c.fadesIn = c.level >= SOLID ? c.halfLife * Math.log2(c.level / SOLID) - since : null
      } else c.fadesIn = null
    }
    // The frontier: not solid, not fading, and everything it rests on is solid
    // (the parts of a topic are steps of a lesson's plan, which Tide never offers on their own)
    for (const c of concepts) c.ready = !c.parent && (c.status === 'new' || c.status === 'learning') && c.prereq.every((p) => p.status === 'solid')
    // Ready next, in the order Tide offers it: begun first, then what carries a chain on, then roadmap order
    const readyNext = concepts.filter((c) => c.ready && !c.parent).sort((a, b) =>
      (a.seen === 0) - (b.seen === 0) || (a.prereq.length === 0) - (b.prereq.length === 0) || b.importance - a.importance || a.order - b.order)
    readyNext.forEach((c, k) => (c.readyRank = k))
    const fading = concepts.filter((c) => c.status === 'fading' && !c.parent).sort((a, b) => (b.level - b.estimate) * Math.log2(b.importance + 2) - (a.level - a.estimate) * Math.log2(a.importance + 2))
    const dueSoon = concepts.filter((c) => c.status === 'solid' && !c.parent && c.fadesIn != null).sort((a, b) => a.fadesIn - b.fadesIn)

    // Pathways: a link is travelled when both ends have been studied; more sittings, thicker line
    const links = []
    for (const c of concepts) for (const p of c.prereq) links.push({ from: p, to: c, travelled: p.seen > 0 && c.seen > 0 ? Math.min(p.seen, c.seen) : 0, cross: p.area !== c.area })
    const maxT = Math.max(1, ...links.map((l) => l.travelled))
    for (const l of links) l.w = l.travelled / maxT

    const count = (s) => concepts.filter((c) => c.status === s).length
    return {
      now, areas: AREAS, concepts, links, byId: new Map(concepts.map((c) => [c.id, c])),
      readyNext, fading, dueSoon,
      counts: { all: n, solid: count('solid'), fading: count('fading'), learning: count('learning'), new: count('new'), ready: concepts.filter((c) => c.ready).length, cross: links.filter((l) => l.cross).length },
    }
  }

  /** Ancestors (what it rests on, back to fundamentals) and descendants (what it unlocks) */
  function chain(c) {
    const up = new Set(), down = new Set()
    const walk = (x, key, set) => { for (const y of x[key]) if (!set.has(y)) { set.add(y); walk(y, key, set) } }
    walk(c, 'prereq', up)
    walk(c, 'next', down)
    return { up, down }
  }

  window.Pathways = { build, chain, SOLID, DAY }
})()
