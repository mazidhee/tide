/**
 * The project ladder: projects get longer, harder, more end to end and closer to core
 * infrastructure as you go.
 *
 * 1. Components: one part, done properly (a ledger module, a Merkle tree, a quote book)
 * 2. Services: a few parts behind an interface (an idempotent payments API, an ETL job)
 * 3. Systems: end to end (a payment rail with settlement and reconciliation, a data pipeline)
 * 4. Flagships: long-horizon builds over weeks (a market terminal, payment infrastructure, a data
 *    platform, a blockchain node with a rollup, a stablecoin system)
 *
 * Each step is a starting map built from the templates (a component is a system's first
 * milestones; a flagship is a system with weeks more on top), so every one is already mapped out
 * and has real failing tests for its first milestone. A tier opens in an area when you've finished
 * a project one tier below it there, or when What you know already covers that tier's groundwork.
 * From what you've been studying, Tide suggests the next step; you can always type your own idea.
 * Pure: main/ideaProjects gathers what it needs.
 */
import { keyWords } from './warmup'
import { matchPrereq, validatePlan, type KnownConcept, type PlanMilestone, type ProjectPlan } from './ideaProject'
import { ideaTemplate, type IdeaTemplate } from './ideaTemplates'

export type Tier = 1 | 2 | 3 | 4
export type Area = NonNullable<ProjectPlan['area']>

export const TIERS: { tier: Tier; label: string; about: string }[] = [
  { tier: 1, label: 'Component', about: 'One part, done properly' },
  { tier: 2, label: 'Service', about: 'A few parts behind an interface' },
  { tier: 3, label: 'System', about: 'End to end, as it runs for real' },
  { tier: 4, label: 'Flagship', about: 'Core infrastructure, built over weeks' }
]
export const tierLabel = (t: Tier) => TIERS[t - 1].label

export const AREAS: { id: Area; label: string; words: string }[] = [
  { id: 'software', label: 'Software engineering', words: 'software engineering systems programming data structures algorithms operating system networking concurrency testing design patterns api http database binary memory compiler' },
  { id: 'data', label: 'Data engineering', words: 'data engineering pipeline etl elt warehouse sql orchestration airflow dbt spark streaming kafka data quality schema ingestion analytics machine learning ml model' },
  { id: 'blockchain', label: 'Blockchain engineering', words: 'blockchain bitcoin ethereum merkle hash consensus proof work stake smart contract cryptography signature utxo rollup layer stablecoin defi' },
  { id: 'payments', label: 'Payments', words: 'payment payments rail iso 20022 settlement clearing ledger double entry bookkeeping core banking open banking card scheme swift sepa ach fraud reconciliation idempotency' },
  { id: 'maths', label: 'Maths', words: 'maths mathematics calculus linear algebra matrix numerical analysis probability statistics proof logic theorem differential equation optimisation root finding integration' },
  { id: 'quant', label: 'Quant', words: 'quant quantitative finance market data order book trading risk var stress monte carlo pricing option portfolio backtest returns volatility statistics time series' }
]
export const areaLabel = (a: Area) => AREAS.find((x) => x.id === a)?.label ?? a

/** A step on the ladder: a starting map in one or more areas */
export interface LadderSeed {
  id: string
  title: string
  about: string
  tier: Tier
  areas: Area[]
  /** A template, cut to its first milestones (a component or a service), or whole */
  template: string
  milestones?: number
  /** A flagship's weeks on top of its system */
  more?: { components: { id: string; name: string; about: string; prerequisites: string[] }[]; links: { from: string; to: string; label: string }[]; milestones: Omit<PlanMilestone, 'status' | 'readings' | 'recall'>[] }
}

const ms = (id: string, title: string, build: string, components: string[], lessons: [string, string][], doneWhen: string[], hours: number): Omit<PlanMilestone, 'status' | 'readings' | 'recall'> => ({ id, title, build, components, lessons: lessons.map(([concept, why]) => ({ concept, why })), doneWhen, hours })

export const LADDER: LadderSeed[] = [
  // ---------- 1. Components ----------
  { id: 'ledger-module', title: 'Double-entry ledger module', about: 'Accounts and balanced entries in integer minor units', tier: 1, areas: ['payments', 'software'], template: 'payment-rail', milestones: 1 },
  { id: 'merkle', title: 'Blocks and a Merkle tree', about: 'Hash-linked blocks and inclusion proofs', tier: 1, areas: ['blockchain', 'software'], template: 'blockchain', milestones: 2 },
  { id: 'row-validator', title: 'A schema validator', about: 'Typed rows in, bad rows quarantined with a reason', tier: 1, areas: ['data'], template: 'data-pipeline', milestones: 1 },
  { id: 'quote-book', title: 'A quote book', about: 'Best bid and ask, last trade and spread from a tick stream', tier: 1, areas: ['quant', 'software'], template: 'market-terminal', milestones: 1 },
  { id: 'order-book', title: 'An order book', about: 'Limit orders matched by price-time priority', tier: 1, areas: ['quant', 'software'], template: 'exchange', milestones: 1 },
  { id: 'root-finding', title: 'Root finding', about: 'Bisection and Newton’s method, with their failure cases', tier: 1, areas: ['maths'], template: 'numerics', milestones: 1 },
  { id: 'black-scholes', title: 'Black-Scholes from scratch', about: 'The normal CDF, then call and put prices', tier: 1, areas: ['maths', 'quant'], template: 'options-pricer', milestones: 1 },
  { id: 'logic', title: 'Formulas and truth tables', about: 'A parser for propositional logic and a tautology checker', tier: 1, areas: ['maths', 'software'], template: 'proof-checker', milestones: 1 },
  { id: 'vault', title: 'A collateralised vault', about: 'Mint against collateral, keep the ratio', tier: 1, areas: ['blockchain', 'quant'], template: 'stablecoin', milestones: 1 },
  // ---------- 2. Services ----------
  { id: 'payments-api', title: 'An idempotent payments service', about: 'A ledger behind an API that never pays twice, reading ISO 20022', tier: 2, areas: ['payments', 'software'], template: 'payment-rail', milestones: 3 },
  { id: 'etl-job', title: 'An ETL job', about: 'Validate, transform and load idempotently into a warehouse', tier: 2, areas: ['data', 'software'], template: 'data-pipeline', milestones: 3 },
  { id: 'utxo-ledger', title: 'Signed transactions and UTXOs', about: 'Keys, signatures and double-spend checks over a hash chain', tier: 2, areas: ['blockchain'], template: 'blockchain', milestones: 4 },
  { id: 'market-data-service', title: 'A market-data service', about: 'Quotes, bars and a small query language', tier: 2, areas: ['quant', 'data'], template: 'market-terminal', milestones: 3 },
  { id: 'matching-engine', title: 'A matching engine with risk checks', about: 'An order book behind a gateway, with pre-trade risk', tier: 2, areas: ['quant', 'software'], template: 'exchange', milestones: 3 },
  { id: 'greeks-trees', title: 'Greeks and binomial trees', about: 'Black-Scholes, its Greeks checked numerically, and American options on a tree', tier: 2, areas: ['maths', 'quant'], template: 'options-pricer', milestones: 3 },
  { id: 'linear-algebra', title: 'Roots and linear systems', about: 'Root finding, then matrices and LU decomposition', tier: 2, areas: ['maths'], template: 'numerics', milestones: 2 },
  { id: 'deduction', title: 'Natural deduction rules', about: 'Formulas, truth, and rules that check one proof step', tier: 2, areas: ['maths'], template: 'proof-checker', milestones: 2 },
  { id: 'bank-accounts', title: 'Accounts on a general ledger', about: 'Customer accounts, overdrafts and transfers on double entry', tier: 2, areas: ['payments'], template: 'core-banking', milestones: 3 },
  // ---------- 3. Systems ----------
  { id: 'payment-rail', title: 'A payment rail', about: 'Ledger, ISO 20022, idempotent API, fraud checks, settlement and reconciliation', tier: 3, areas: ['payments', 'software'], template: 'payment-rail' },
  { id: 'core-banking', title: 'A core-banking simulation', about: 'Accounts, ledger, interest, limits and the end-of-day batch', tier: 3, areas: ['payments'], template: 'core-banking' },
  { id: 'data-pipeline', title: 'A data pipeline', about: 'Orchestrated ETL into a warehouse, with data-quality checks', tier: 3, areas: ['data'], template: 'data-pipeline' },
  { id: 'ml-project', title: 'An ML project end to end', about: 'Data, a model from scratch, training and honest evaluation', tier: 3, areas: ['data', 'quant'], template: 'ml-project' },
  { id: 'blockchain', title: 'A blockchain from scratch', about: 'Hashing, Merkle trees, signatures, proof of work and a P2P network', tier: 3, areas: ['blockchain', 'software'], template: 'blockchain' },
  { id: 'stablecoin-sim', title: 'A stablecoin simulator', about: 'Vaults, an oracle, liquidations and the peg under shocks', tier: 3, areas: ['blockchain', 'quant'], template: 'stablecoin' },
  { id: 'options-pricer', title: 'An options pricer from first principles', about: 'Black-Scholes, Greeks, trees, Monte Carlo and implied volatility', tier: 3, areas: ['maths', 'quant'], template: 'options-pricer' },
  { id: 'numerical-library', title: 'A numerical library', about: 'Roots, LU, integration and ODEs, with errors measured', tier: 3, areas: ['maths', 'software'], template: 'numerics' },
  { id: 'proof-checker', title: 'A proof checker', about: 'Natural deduction checked line by line, then first-order logic', tier: 3, areas: ['maths', 'software'], template: 'proof-checker' },
  // ---------- 4. Flagships ----------
  { id: 'tokenised-exchange', title: 'An exchange for tokenised assets', about: 'Matching engine and order book, custody, and delivery-versus-payment settlement on chain', tier: 4, areas: ['quant', 'blockchain', 'payments', 'software'], template: 'exchange' },
  {
    id: 'proof-assistant',
    title: 'A proof assistant',
    about: 'The proof checker grown into an assistant: tactics, automation by a SAT solver, and a library of checked theorems',
    tier: 4,
    areas: ['maths', 'software'],
    template: 'proof-checker',
    more: {
      components: [{ id: 'tactics', name: 'Tactics', about: 'Commands that build proof steps for you', prerequisites: ['proof tactics'] }, { id: 'sat', name: 'SAT solver', about: 'Decides propositional goals automatically', prerequisites: ['SAT solving', 'conjunctive normal form'] }, { id: 'library', name: 'Theorem library', about: 'Checked theorems reused by name', prerequisites: ['lemmas and reuse'] }],
      links: [{ from: 'tactics', to: 'checker', label: 'proof steps' }, { from: 'sat', to: 'tactics', label: 'decided goals' }, { from: 'library', to: 'checker', label: 'lemmas' }],
      milestones: [
        ms('w1', 'Tactics', 'Goal-directed proving: tactics that turn a goal into subgoals and emit checked steps.', ['tactics'], [['proof tactics', 'how proof assistants are used']], ['each tactic emits steps the checker accepts', 'a failed tactic leaves the goal unchanged', 'a proof script replays to the same proof'], 14),
        ms('w2', 'A SAT solver', 'DPLL with unit propagation, then clause learning, deciding propositional goals.', ['sat'], [['SAT solving', 'deciding formulas fast'], ['conjunctive normal form', 'the solver’s input']], ['satisfiable formulas get a model that checks', 'unsatisfiable ones are refuted', 'clause learning solves the pigeonhole cases faster'], 16),
        ms('w3', 'A theorem library', 'Name and reuse checked theorems, with dependencies tracked and rechecked on change.', ['library'], [['lemmas and reuse', 'big proofs are built from small ones']], ['a theorem is used by name', 'changing a lemma rechecks what uses it', 'a cycle of dependencies is refused'], 12)
      ]
    }
  },
  {
    id: 'ml-platform',
    title: 'An ML system',
    about: 'A feature store, a training pipeline, model serving and monitoring',
    tier: 4,
    areas: ['data', 'software'],
    template: 'ml-project',
    more: {
      components: [{ id: 'store', name: 'Feature store', about: 'Features computed once, served the same in training and online', prerequisites: ['feature stores', 'training-serving skew'] }, { id: 'serve', name: 'Model serving', about: 'An API that loads a model version and answers fast', prerequisites: ['model serving', 'latency budgets'] }, { id: 'monitor', name: 'Monitoring', about: 'Drift and quality watched in production', prerequisites: ['data drift', 'model monitoring'] }],
      links: [{ from: 'store', to: 'train', label: 'training features' }, { from: 'store', to: 'serve', label: 'online features' }, { from: 'serve', to: 'monitor', label: 'predictions' }],
      milestones: [
        ms('w1', 'A feature store', 'Compute features once, point in time correct, and serve them the same way offline and online.', ['store'], [['feature stores', 'one definition of each feature'], ['training-serving skew', 'the silent killer of models']], ['offline and online features agree', 'point-in-time joins never see the future', 'a feature is versioned'], 12),
        ms('w2', 'Model serving', 'Serve a trained model version behind an API with a latency budget and rollbacks.', ['serve'], [['model serving', 'models earn their keep in production']], ['the API answers within its budget', 'a new version can be rolled back', 'requests and predictions are logged'], 12),
        ms('w3', 'Monitoring', 'Watch input drift and prediction quality, and alert before results go bad.', ['monitor'], [['data drift', 'the world changes under the model']], ['drift is detected on a shifted input', 'quality is tracked when labels arrive', 'an alert fires past its threshold'], 10)
      ]
    }
  },
  { id: 'market-terminal', title: 'Market terminal', about: 'Streaming quotes, charts, news, a query language, a portfolio and a risk view', tier: 4, areas: ['quant', 'data', 'software'], template: 'market-terminal' },
  {
    id: 'payment-infra',
    title: 'Core payment infrastructure',
    about: 'A switch between participants on top of the rail: routing, scheme rules and operations',
    tier: 4,
    areas: ['payments', 'software'],
    template: 'payment-rail',
    more: {
      components: [{ id: 'switch', name: 'Payment switch', about: 'Routes messages between participants and schemes', prerequisites: ['message routing', 'TCP and framing'] }, { id: 'ops', name: 'Operations', about: 'Monitoring, replay and the end-of-day runbook', prerequisites: ['observability', 'runbooks'] }],
      links: [{ from: 'switch', to: 'api', label: 'routed payments' }, { from: 'ops', to: 'switch', label: 'replays' }],
      milestones: [
        ms('w1', 'A payment switch', 'Route messages between participants by their identifiers, over framed TCP, with acknowledgements and timeouts.', ['switch'], [['message routing', 'every payment has to reach the right bank'], ['TCP and framing', 'messages cross a stream']], ['a message reaches the participant it names', 'an unknown participant is rejected with a reason', 'an unacknowledged message is retried, then failed'], 12),
        ms('w2', 'Scheme rules at the edge', 'Validate each message against the scheme’s rules (limits, cut-off times, field formats) before it enters the rail.', ['switch', 'iso'], [['payment scheme rules', 'schemes reject what breaks them']], ['a message after cut-off waits for the next cycle', 'over-limit payments are refused', 'every rejection carries the scheme’s reason code'], 10),
        ms('w3', 'Operations', 'Metrics, a replay of a day’s messages, and the end-of-day runbook, run start to finish.', ['ops', 'settlement', 'recon'], [['observability', 'you can’t run what you can’t see']], ['a day can be replayed and gives the same ledger', 'settlement and reconciliation run from the runbook', 'alerts fire on a stuck queue'], 14)
      ]
    }
  },
  {
    id: 'data-platform',
    title: 'A data platform',
    about: 'Batch and streaming ingestion, a modelled warehouse, lineage and a metrics API',
    tier: 4,
    areas: ['data', 'software'],
    template: 'data-pipeline',
    more: {
      components: [{ id: 'stream', name: 'Streaming ingestion', about: 'Events consumed continuously, exactly once into the warehouse', prerequisites: ['event streams', 'exactly-once processing'] }, { id: 'catalogue', name: 'Catalogue and lineage', about: 'Every table, where it came from and who uses it', prerequisites: ['data lineage'] }, { id: 'serve', name: 'Metrics API', about: 'Defined metrics served from the warehouse', prerequisites: ['dimensional modelling'] }],
      links: [{ from: 'stream', to: 'load', label: 'events' }, { from: 'load', to: 'catalogue', label: 'lineage' }, { from: 'load', to: 'serve', label: 'models' }],
      milestones: [
        ms('w1', 'A modelled warehouse', 'Model the data as facts and dimensions, built from the pipeline’s tables.', ['load', 'serve'], [['dimensional modelling', 'how warehouses stay queryable']], ['facts join their dimensions with no orphans', 'slowly changing dimensions keep history', 'a metric reads the same from any path'], 12),
        ms('w2', 'Streaming ingestion', 'Consume an event stream continuously into the warehouse, exactly once, with late events handled.', ['stream'], [['exactly-once processing', 'duplicates corrupt totals'], ['event time and watermarks', 'late data happens']], ['a replayed stream loads once', 'late events land in the right window', 'the consumer resumes from its offset'], 14),
        ms('w3', 'Lineage and a metrics API', 'Record lineage for every table and serve defined metrics over an API.', ['catalogue', 'serve'], [['data lineage', 'knowing what breaks when a table changes']], ['each table lists its sources', 'a metric definition is versioned', 'the API serves a metric with its freshness'], 12)
      ]
    }
  },
  {
    id: 'node-l2',
    title: 'A blockchain node and a rollup',
    about: 'A full node with a mempool and fee market, then a rollup with fraud proofs',
    tier: 4,
    areas: ['blockchain', 'software'],
    template: 'blockchain',
    more: {
      components: [{ id: 'mempool', name: 'Mempool', about: 'Pending transactions ordered by fee', prerequisites: ['priority queues', 'fee markets'] }, { id: 'rollup', name: 'Rollup', about: 'Batches transactions off-chain and posts state roots', prerequisites: ['rollups', 'state roots'] }],
      links: [{ from: 'mempool', to: 'pow', label: 'transactions to mine' }, { from: 'rollup', to: 'p2p', label: 'batches and roots' }],
      milestones: [
        ms('w1', 'A mempool and fee market', 'Keep pending transactions ordered by fee rate, evict under pressure, and fill blocks from it.', ['mempool'], [['fee markets', 'block space is scarce']], ['blocks take the highest fee rates first', 'a conflicting transaction replaces only with a higher fee', 'the pool evicts the cheapest when full'], 10),
        ms('w2', 'A rollup', 'Batch transactions off-chain, post compressed batches and state roots to the chain.', ['rollup'], [['rollups', 'how layer 2s scale'], ['state roots', 'committing to a whole state']], ['a batch’s state root matches replaying it', 'batches are posted in order', 'a withdrawal waits out its challenge period'], 16),
        ms('w3', 'Fraud proofs', 'Challenge a wrong state root by proving one transaction’s execution on-chain.', ['rollup'], [['fraud proofs', 'optimistic rollups rest on them']], ['a wrong root can be challenged and reverted', 'a correct root survives a challenge', 'the challenger is rewarded and the cheat slashed'], 16)
      ]
    }
  },
  {
    id: 'stablecoin-system',
    title: 'A stablecoin system',
    about: 'The simulator grown into a system: mint and burn ledger, reserves, redemptions and governance',
    tier: 4,
    areas: ['blockchain', 'payments', 'quant'],
    template: 'stablecoin',
    more: {
      components: [{ id: 'ledger', name: 'Mint and burn ledger', about: 'Every coin issued and destroyed, reconciled to reserves', prerequisites: ['double-entry bookkeeping'] }, { id: 'reserves', name: 'Reserves', about: 'What backs the coin, attested', prerequisites: ['reserve attestation'] }, { id: 'gov', name: 'Governance', about: 'Parameter changes with delays and limits', prerequisites: ['governance mechanisms'] }],
      links: [{ from: 'ledger', to: 'reserves', label: 'supply' }, { from: 'gov', to: 'vault', label: 'parameters' }],
      milestones: [
        ms('w1', 'A mint and burn ledger', 'Record every issue and redemption in double entry, with supply always equal to issued less burned.', ['ledger'], [['double-entry bookkeeping', 'supply must reconcile']], ['supply equals mints less burns', 'a burn above balance is refused', 'the ledger reconciles to the vaults'], 10),
        ms('w2', 'Reserves and redemptions', 'Hold reserves, attest them, and queue redemptions when liquidity is short.', ['reserves'], [['reserve attestation', 'trust needs evidence']], ['redemptions are paid in order', 'an attestation matches the reserves', 'a run drains the queue fairly'], 12),
        ms('w3', 'Governance', 'Change parameters through proposals with delays and bounds, and simulate their effect first.', ['gov'], [['governance mechanisms', 'who can change the rules, and how fast']], ['a change waits out its delay', 'out-of-bounds changes are refused', 'a change is simulated before it applies'], 10)
      ]
    }
  }
]

export const ladderSeed = (id: string | null | undefined) => LADDER.find((s) => s.id === id) ?? null

/** A seed's starting map: its template cut to size, or with a flagship's weeks on top */
export function seedPlan(seed: LadderSeed, idea: string, now: number, isPrivate: boolean): ProjectPlan {
  const t: IdeaTemplate | null = ideaTemplate(seed.template)
  if (!t) throw new Error(`No template ${seed.template}`)
  const base = JSON.parse(JSON.stringify(t.plan)) as IdeaTemplate['plan']
  let milestones = base.milestones
  let components = base.components
  let links = base.links
  if (seed.milestones) {
    milestones = milestones.slice(0, seed.milestones)
    const used = new Set(milestones.flatMap((m) => m.components))
    components = components.filter((c) => used.has(c.id))
    links = links.filter((l) => used.has(l.from) && used.has(l.to))
  }
  if (seed.more) {
    const have = new Set(components.map((c) => c.id))
    components = [...components, ...seed.more.components.filter((c) => !have.has(c.id)).map((c) => ({ ...c, prerequisites: c.prerequisites.map((name) => ({ name, status: 'new' as const })) }))]
    links = [...links, ...seed.more.links]
    milestones = [...milestones, ...seed.more.milestones.map((m) => ({ ...m, readings: [], recall: [], status: 'todo' as const }))]
  }
  const raw = { ...base, name: seed.title, slug: seed.id, summary: seed.milestones ? `${seed.about}. ${base.summary.split('. ')[0]}.` : base.summary + (seed.more ? ` ${seed.about}.` : ''), components, links, milestones, idea: idea.trim() || seed.about, template: t.id, seed: seed.id, tier: seed.tier, area: seed.areas[0], private: isPrivate, by: 'template', createdAt: now }
  return validatePlan(raw, { by: 'template', private: isPrivate, tier: seed.tier, area: seed.areas[0], seed: seed.id, template: t.id, createdAt: now }).plan!
}

/** The concepts a seed teaches: its milestones' lessons */
export function seedConcepts(seed: LadderSeed): string[] {
  try {
    return seedPlan(seed, '', 0, false).milestones.flatMap((m) => m.lessons.map((l) => l.concept))
  } catch {
    return []
  }
}

export interface ProjectRecord {
  seed?: string
  area?: Area
  tier?: Tier
  finished: boolean
}

/** How much of a set of concepts What you know already has (known or fading) */
export function coverage(concepts: string[], known: KnownConcept[]): number {
  if (!concepts.length) return 0
  return concepts.filter((c) => matchPrereq(c, known).status !== 'new').length / concepts.length
}

export const COVERAGE_TO_UNLOCK = 0.6

/**
 * The highest tier open in an area: tier 1 always; each next one when a project one tier below
 * is finished in that area, or What you know covers the groundwork of that tier's steps there.
 */
export function unlockedTier(area: Area, projects: ProjectRecord[], known: KnownConcept[]): { tier: Tier; why: string } {
  let tier: Tier = 1
  let why = 'Components are always open.'
  for (const t of [2, 3, 4] as Tier[]) {
    const below = (t - 1) as Tier
    const done = projects.find((p) => p.finished && p.area === area && (p.tier ?? 0) >= below)
    const seeds = LADDER.filter((s) => s.tier === below && s.areas.includes(area))
    const cov = coverage([...new Set(seeds.flatMap(seedConcepts))], known)
    if (done) why = `Open because you finished a ${tierLabel(below).toLowerCase()} in ${areaLabel(area).toLowerCase()}.`
    else if (cov >= COVERAGE_TO_UNLOCK) why = `Open because What you know covers ${Math.round(cov * 100)}% of the ${tierLabel(below).toLowerCase()} groundwork.`
    else break
    tier = t
  }
  return { tier, why }
}

/** What opens the next tier, in words */
export function unlockHint(area: Area, tier: Tier): string {
  if (tier >= 4) return ''
  return `Finish a ${tierLabel(tier).toLowerCase()} in ${areaLabel(area).toLowerCase()}, or learn its groundwork, to open ${tierLabel((tier + 1) as Tier).toLowerCase()}s.`
}

export interface StudySignals {
  /** Concepts on the map, with when they were last seen */
  known: (KnownConcept & { lastSeen?: number })[]
  /** Roadmap and notebook names */
  roadmaps: string[]
  /** The weekly coach's subjects */
  focus: string[]
  /** Projects made already */
  projects: ProjectRecord[]
  now: number
}

/** How much each area shows up in what you've been studying lately */
export function areaInterest(s: StudySignals): Record<Area, number> {
  const out = Object.fromEntries(AREAS.map((a) => [a.id, 0])) as Record<Area, number>
  const vocab = new Map(AREAS.map((a) => [a.id, keyWords(a.words)]))
  const hits = (text: string, a: Area) => {
    const w = keyWords(text)
    let n = 0
    for (const x of w) if (vocab.get(a)!.has(x)) n++
    return n ? 1 : 0
  }
  for (const a of AREAS) {
    for (const c of s.known) {
      const recent = c.lastSeen && s.now - c.lastSeen < 30 * 86_400_000 ? 2 : c.status === 'solid' || c.status === 'fading' ? 0.5 : 0
      if (recent) out[a.id] += recent * hits(c.name, a.id)
    }
    for (const r of s.roadmaps) out[a.id] += hits(r, a.id)
    for (const f of s.focus) out[a.id] += 3 * hits(f, a.id)
    for (const p of s.projects) if (p.area === a.id) out[a.id] += p.finished ? 1 : 2
  }
  return out
}

export interface Suggestion {
  seed: LadderSeed
  area: Area
  tier: Tier
  why: string
}

/**
 * The next project for each of the areas you've been studying most: the highest open tier there
 * that you haven't started, already mapped out. At most `max`, one per area.
 */
export function suggestNext(s: StudySignals, max = 3): Suggestion[] {
  const interest = areaInterest(s)
  const started = new Set(s.projects.map((p) => p.seed).filter(Boolean))
  const ranked = AREAS.map((a) => a.id)
    .filter((a) => interest[a] > 0)
    .sort((a, b) => interest[b] - interest[a])
  const out: Suggestion[] = []
  const used = new Set<string>()
  for (const area of ranked) {
    const open = unlockedTier(area, s.projects, s.known)
    for (let t = open.tier; t >= 1 && out.length < max; t--) {
      const seed = LADDER.find((x) => x.tier === t && x.areas.includes(area) && !started.has(x.id) && !used.has(x.id))
      if (!seed) continue
      const studied = s.known.filter((c) => c.lastSeen && s.now - c.lastSeen < 30 * 86_400_000 && seedConcepts(seed).some((x) => matchPrereq(x, [c]).status !== 'new')).map((c) => c.name)
      const lead = studied.length ? `You’ve been studying ${studied.slice(0, 2).join(' and ')}.` : `${areaLabel(area)} is among what you’ve been studying.`
      out.push({ seed, area, tier: t as Tier, why: `${lead} ${t === open.tier ? open.why : `The next step up is ${tierLabel(open.tier).toLowerCase()}s.`}` })
      used.add(seed.id)
      break
    }
    if (out.length >= max) break
  }
  return out
}
