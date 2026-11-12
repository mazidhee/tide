/**
 * The other mocks' material: system design prompts (with what a strong answer covers and a
 * reference design for the canvas), quant and finance questions (marked in code where there is
 * a number), and behavioural questions. Fixed and hand-written, so every mode has a version that
 * runs and is marked without Claude; with Claude the interviewer probes further and Opus marks.
 */
import { LEVELS, isRight as mathsRight, rng, type MathsQuestion } from './mentalMaths'

// ---------- System design ----------

export type DesignArea = 'requirements' | 'architecture' | 'scale' | 'consistency' | 'idempotency' | 'failure'

export interface DesignPoint {
  area: DesignArea
  /** What a strong answer says */
  point: string
  /** Words that show it was covered (any one, case-insensitive), searched in the canvas and the candidate's notes and messages */
  cues: string[]
}

export interface DesignPrompt {
  id: string
  title: string
  brief: string
  tags: string[]
  /** What the interviewer asks about, by area */
  probes: { area: DesignArea; question: string }[]
  checklist: DesignPoint[]
  /** A reference design, as canvas operations (shared/canvas applyCanvasOps) */
  reference: Record<string, string>[]
  /** The model answer, in Markdown */
  modelAnswer: string
}

export const DESIGNS: DesignPrompt[] = [
  {
    id: 'payment-processor',
    title: 'A payment processor',
    brief: 'Design the service that lets online merchants take card payments: a merchant calls your API to charge a customer, you talk to the card networks through an acquirer, and you pay merchants out daily.',
    tags: ['payments'],
    probes: [
      { area: 'requirements', question: 'Which payment methods and currencies, and is it authorise-and-capture or a single charge?' },
      { area: 'scale', question: 'What peak payments per second do you design for, and how much data per year?' },
      { area: 'idempotency', question: 'The merchant times out and retries the charge. What stops a double charge?' },
      { area: 'consistency', question: 'Where is the source of truth for money, and how do balances stay right?' },
      { area: 'failure', question: 'The acquirer times out after you sent the authorisation. What state is the payment in, and what do you do?' }
    ],
    checklist: [
      { area: 'requirements', point: 'Separates authorise and capture (and refunds), and states currencies and methods', cues: ['authori', 'capture', 'refund', 'currenc'] },
      { area: 'requirements', point: 'States non-functional needs: availability, latency, PCI scope', cues: ['99.9', 'availability', 'latency', 'pci'] },
      { area: 'architecture', point: 'API gateway, a payments service with a state machine, an acquirer connector', cues: ['state machine', 'acquirer', 'gateway', 'status'] },
      { area: 'architecture', point: 'Card data tokenised in a vault, so most services never see card numbers', cues: ['token', 'vault', 'pan'] },
      { area: 'scale', point: 'Puts a number on peak load (payments per second) and storage', cues: ['per second', 'tps', 'qps', 'rps', '/s'] },
      { area: 'idempotency', point: 'Idempotency keys on the charge API, stored with the result', cues: ['idempoten', 'dedup', 'retry key'] },
      { area: 'consistency', point: 'A double-entry ledger as the source of truth, written in the same transaction as the payment state', cues: ['ledger', 'double-entry', 'double entry', 'journal'] },
      { area: 'consistency', point: 'Outbox or event log so the ledger and events never disagree', cues: ['outbox', 'event log', 'transaction log', 'cdc'] },
      { area: 'failure', point: 'Unknown outcomes after a timeout are resolved by querying the acquirer or reconciliation, not by retrying blindly', cues: ['reconcil', 'unknown', 'pending', 'timeout'] },
      { area: 'failure', point: 'Webhooks to merchants are retried with backoff and can be replayed', cues: ['webhook', 'backoff', 'dead letter', 'dlq'] }
    ],
    reference: [
      { op: 'add', id: 'merchant', label: 'Merchant server', kind: 'client' },
      { op: 'add', id: 'gateway', label: 'API gateway', kind: 'gateway', details: 'auth, rate limits, idempotency keys', near: 'merchant' },
      { op: 'add', id: 'payments', label: 'Payments service', kind: 'service', details: 'payment state machine', near: 'gateway' },
      { op: 'add', id: 'vault', label: 'Card vault', kind: 'database', details: 'tokenised card numbers (PCI)', near: 'payments', side: 'above' },
      { op: 'add', id: 'db', label: 'Payments DB', kind: 'database', details: 'payments + ledger + outbox, one transaction', near: 'payments', side: 'below' },
      { op: 'add', id: 'acquirer', label: 'Acquirer connector', kind: 'service', near: 'payments' },
      { op: 'add', id: 'network', label: 'Card networks', kind: 'external', near: 'acquirer' },
      { op: 'add', id: 'queue', label: 'Event queue', kind: 'queue', near: 'db', side: 'right' },
      { op: 'add', id: 'webhooks', label: 'Webhook worker', kind: 'worker', details: 'retries with backoff', near: 'queue' },
      { op: 'add', id: 'recon', label: 'Reconciliation job', kind: 'worker', details: 'settlement files vs ledger', near: 'queue', side: 'below' },
      { op: 'connect', from: 'merchant', to: 'gateway', label: 'POST /payments' },
      { op: 'connect', from: 'gateway', to: 'payments' },
      { op: 'connect', from: 'payments', to: 'vault', label: 'detokenise' },
      { op: 'connect', from: 'payments', to: 'db' },
      { op: 'connect', from: 'payments', to: 'acquirer', label: 'authorise / capture' },
      { op: 'connect', from: 'acquirer', to: 'network' },
      { op: 'connect', from: 'db', to: 'queue', label: 'outbox' },
      { op: 'connect', from: 'queue', to: 'webhooks' },
      { op: 'connect', from: 'queue', to: 'recon' }
    ],
    modelAnswer: `**Requirements.** Card payments for online merchants: authorise, capture, refund; multi-currency; 99.99% availability on the charge API, p99 under a second, PCI scope kept small.

**Numbers.** Say 2,000 payments/s at peak, 100M payments a month, ~1 KB each: about 1.2 TB a year before the ledger.

**Design.** Merchant → API gateway (auth, rate limits, idempotency keys) → payments service, which runs each payment through a state machine (created → authorised → captured → settled, or failed / refunded). Card numbers live only in a tokenising vault. The payment's new state, its ledger entries and an outbox event are written in **one database transaction**, so money and events never disagree. The acquirer connector talks to the card networks.

**Idempotency.** The merchant sends an Idempotency-Key; the first result is stored against it and returned on retries, so a retry after a timeout never charges twice.

**Failure.** A timeout from the acquirer leaves the payment *unknown*: mark it pending, query the acquirer, and let reconciliation against settlement files settle it. Webhooks go out from the outbox with retries, backoff and a dead-letter queue, and can be replayed.`
  },
  {
    id: 'card-authorisation',
    title: 'A card authorisation flow',
    brief: 'Design the issuer side of a card authorisation: a card is used at a shop, the request arrives from the card network, and within about 100 ms you must approve or decline it, checking balance, limits and fraud.',
    tags: ['payments'],
    probes: [
      { area: 'requirements', question: 'What has to be checked before you can approve, and what is the latency budget?' },
      { area: 'scale', question: 'How many authorisations per second at peak, and how does that shape where balances live?' },
      { area: 'consistency', question: 'Two authorisations on the same card arrive at once. How do you stop both spending the last £50?' },
      { area: 'idempotency', question: 'The network resends the same authorisation. What happens?' },
      { area: 'failure', question: 'Your fraud model is slow or down. Do you approve or decline, and who decides?' }
    ],
    checklist: [
      { area: 'requirements', point: 'Checks card status, available balance, limits and fraud, within a latency budget (~100 ms)', cues: ['ms', 'latency', 'limit', 'balance'] },
      { area: 'architecture', point: 'Holds (pending authorisations) reduce available balance, then clear at capture/settlement', cues: ['hold', 'pending', 'reserve', 'available balance'] },
      { area: 'architecture', point: 'A fraud scoring step with rules and a model', cues: ['fraud', 'score', 'rules'] },
      { area: 'scale', point: 'Puts a number on peak authorisations per second', cues: ['per second', 'tps', 'qps', '/s'] },
      { area: 'consistency', point: 'Per-account serialisation: a row lock, compare-and-set or a single writer per account', cues: ['lock', 'compare-and-set', 'cas', 'single writer', 'serializ', 'serialis', 'atomic'] },
      { area: 'idempotency', point: 'De-duplicates network retries by the network\'s transaction id', cues: ['idempoten', 'dedup', 'duplicate', 'stan', 'transaction id'] },
      { area: 'failure', point: 'Stand-in processing: fallback rules when a dependency is down, with limits', cues: ['stand-in', 'stand in', 'fallback', 'default'] },
      { area: 'failure', point: 'Reversals and expiry of holds that are never captured', cues: ['reversal', 'expire', 'expiry', 'timeout'] }
    ],
    reference: [
      { op: 'add', id: 'network', label: 'Card network', kind: 'external' },
      { op: 'add', id: 'switch', label: 'Auth switch', kind: 'gateway', details: 'ISO 8583 in, dedupe by txn id', near: 'network' },
      { op: 'add', id: 'auth', label: 'Authorisation service', kind: 'service', details: 'card status, limits, holds', near: 'switch' },
      { op: 'add', id: 'fraud', label: 'Fraud scoring', kind: 'service', details: 'rules + model, 20 ms budget', near: 'auth', side: 'above' },
      { op: 'add', id: 'balances', label: 'Balances DB', kind: 'database', details: 'available = ledger - holds; row lock per account', near: 'auth', side: 'below' },
      { op: 'add', id: 'cache', label: 'Card cache', kind: 'cache', near: 'auth' },
      { op: 'add', id: 'ledger', label: 'Ledger', kind: 'database', details: 'clearing posts the hold', near: 'balances' },
      { op: 'add', id: 'clearing', label: 'Clearing worker', kind: 'worker', details: 'settlement files, hold expiry', near: 'ledger' },
      { op: 'connect', from: 'network', to: 'switch', label: 'auth request' },
      { op: 'connect', from: 'switch', to: 'auth' },
      { op: 'connect', from: 'auth', to: 'fraud' },
      { op: 'connect', from: 'auth', to: 'cache' },
      { op: 'connect', from: 'auth', to: 'balances', label: 'place hold' },
      { op: 'connect', from: 'clearing', to: 'ledger' },
      { op: 'connect', from: 'clearing', to: 'balances', label: 'release hold' }
    ],
    modelAnswer: `**Requirements.** Approve or decline within ~100 ms end to end (the network gives the issuer about 1–2 s, but most is spent in transit): card active, not expired, within limits, enough *available* balance, fraud score acceptable.

**Numbers.** Say 5,000 authorisations/s at peak.

**Design.** The auth switch takes ISO 8583 messages from the network and de-duplicates them by the network's transaction id. The authorisation service reads card status from a cache, calls fraud scoring with a strict budget (~20 ms), and places a **hold** that reduces available balance. Clearing (often a day later) turns the hold into a ledger posting; holds that are never captured expire.

**Consistency.** Two concurrent authorisations on one account must not both spend the same money: serialise per account (a row lock or compare-and-set on available balance, or one writer per account partition).

**Failure.** If fraud scoring is down, fall back to stand-in rules with lower limits rather than declining everything; reversals from the network release holds.`
  },
  {
    id: 'ledger-service',
    title: 'A ledger service',
    brief: 'Design an internal double-entry ledger that every product at a fintech posts money movements to: wallets, card spend, transfers, fees. Balances must always be right and auditable.',
    tags: ['payments'],
    probes: [
      { area: 'requirements', question: 'What does a posting look like, and what must always be true of the books?' },
      { area: 'scale', question: 'How many postings per second, and how do you read a balance quickly with years of history?' },
      { area: 'consistency', question: 'How do you make sure a transfer never posts only one side?' },
      { area: 'idempotency', question: 'A product team retries a posting after a network error. What happens?' },
      { area: 'failure', question: 'Someone posted the wrong amount yesterday. How is it fixed?' }
    ],
    checklist: [
      { area: 'requirements', point: 'Every transaction is balanced entries (debits = credits), amounts as integer minor units with a currency', cues: ['debit', 'credit', 'balanced', 'minor unit', 'pence', 'cents', 'integer'] },
      { area: 'requirements', point: 'Append-only and auditable: entries are never updated or deleted', cues: ['append-only', 'append only', 'immutable', 'audit'] },
      { area: 'architecture', point: 'Accounts, transactions and entries as tables; a posting API', cues: ['accounts', 'entries', 'journal', 'posting'] },
      { area: 'scale', point: 'Running balances or snapshots so a balance read is not a full scan', cues: ['snapshot', 'running balance', 'materiali', 'checkpoint'] },
      { area: 'scale', point: 'Hot accounts (a fee account every posting touches) handled with sharding or batching', cues: ['hot account', 'hot', 'shard', 'partition', 'batch'] },
      { area: 'consistency', point: 'Both sides posted in one database transaction', cues: ['transaction', 'atomic', 'acid'] },
      { area: 'idempotency', point: 'Idempotency key per posting, unique constraint', cues: ['idempoten', 'unique constraint', 'dedup'] },
      { area: 'failure', point: 'Corrections are reversing entries, not edits', cues: ['revers', 'compensat', 'correction'] },
      { area: 'failure', point: 'Reconciliation against external statements and a daily trial balance', cues: ['reconcil', 'trial balance', 'sum to zero'] }
    ],
    reference: [
      { op: 'add', id: 'products', label: 'Product services', kind: 'client', details: 'wallets, cards, transfers' },
      { op: 'add', id: 'api', label: 'Posting API', kind: 'gateway', details: 'validates debits = credits, idempotency key', near: 'products' },
      { op: 'add', id: 'ledger', label: 'Ledger service', kind: 'service', near: 'api' },
      { op: 'add', id: 'db', label: 'Ledger DB', kind: 'database', details: 'accounts, transactions, entries (append-only)', near: 'ledger', side: 'below' },
      { op: 'add', id: 'balances', label: 'Balance snapshots', kind: 'cache', details: 'running balance per account', near: 'ledger', side: 'above' },
      { op: 'add', id: 'events', label: 'Ledger events', kind: 'queue', near: 'ledger' },
      { op: 'add', id: 'recon', label: 'Reconciliation', kind: 'worker', details: 'bank statements, trial balance', near: 'events' },
      { op: 'connect', from: 'products', to: 'api', label: 'POST /transactions' },
      { op: 'connect', from: 'api', to: 'ledger' },
      { op: 'connect', from: 'ledger', to: 'db', label: 'one DB transaction' },
      { op: 'connect', from: 'ledger', to: 'balances' },
      { op: 'connect', from: 'ledger', to: 'events' },
      { op: 'connect', from: 'events', to: 'recon' }
    ],
    modelAnswer: `**Model.** Accounts; transactions; entries. Each transaction is two or more entries whose debits equal its credits, in integer minor units with a currency. Entries are **append-only**: a mistake is fixed by a reversing transaction, never an edit, so the history is the audit trail.

**Writes.** A posting API checks the transaction balances and carries an idempotency key with a unique constraint, so a retry returns the first result. All entries of a transaction are written in **one database transaction**.

**Reads.** A running balance (or periodic snapshot plus entries since) per account, so a balance is O(1) rather than a scan of years of entries.

**Scale.** Say 3,000 postings/s. Hot accounts (the fee account every posting touches) are split into sub-accounts or batched.

**Checks.** A daily trial balance (everything sums to zero) and reconciliation against bank statements catch what the code missed.`
  },
  {
    id: 'url-shortener',
    title: 'A URL shortener',
    brief: 'Design a service like bit.ly: create a short link for a long URL, and redirect anyone who opens the short link. Links can be custom and can expire; owners want click counts.',
    tags: ['general'],
    probes: [
      { area: 'requirements', question: 'Read-to-write ratio, custom aliases, expiry, analytics: which matter?' },
      { area: 'scale', question: 'How many redirects per second, and how many links over five years?' },
      { area: 'consistency', question: 'How do you make sure two links never get the same code?' },
      { area: 'idempotency', question: 'If the same long URL is shortened twice, same code or a new one?' },
      { area: 'failure', question: 'The database is slow. What keeps redirects working?' }
    ],
    checklist: [
      { area: 'requirements', point: 'Reads far outnumber writes; redirect latency matters most', cues: ['read-heavy', 'read heavy', 'reads', '100:1', 'ratio'] },
      { area: 'architecture', point: 'Key generation: base62 of a counter or pre-generated keys', cues: ['base62', 'base 62', 'counter', 'key generation', 'hash'] },
      { area: 'architecture', point: 'Cache in front of the store for redirects; CDN or edge', cues: ['cache', 'redis', 'cdn', 'edge'] },
      { area: 'scale', point: 'Puts numbers on redirects per second and storage', cues: ['per second', 'qps', 'rps', 'tb', 'billion'] },
      { area: 'consistency', point: 'Unique codes guaranteed (unique constraint, ranges per server)', cues: ['unique', 'collision', 'range'] },
      { area: 'idempotency', point: 'Decides whether the same URL maps to the same code', cues: ['same code', 'dedup', 'idempoten', 'already exists'] },
      { area: 'failure', point: 'Analytics off the redirect path (async queue)', cues: ['async', 'queue', 'kafka', 'stream'] },
      { area: 'failure', point: '301 vs 302 and what that does to analytics and caching', cues: ['301', '302'] }
    ],
    reference: [
      { op: 'add', id: 'user', label: 'Browser', kind: 'client' },
      { op: 'add', id: 'cdn', label: 'CDN / edge', kind: 'cdn', near: 'user' },
      { op: 'add', id: 'lb', label: 'Load balancer', kind: 'lb', near: 'cdn' },
      { op: 'add', id: 'api', label: 'Redirect service', kind: 'service', near: 'lb' },
      { op: 'add', id: 'cache', label: 'Code cache', kind: 'cache', near: 'api', side: 'above' },
      { op: 'add', id: 'db', label: 'Links DB', kind: 'database', details: 'code → URL, unique code', near: 'api', side: 'below' },
      { op: 'add', id: 'keys', label: 'Key generator', kind: 'service', details: 'base62 ranges per server', near: 'db' },
      { op: 'add', id: 'clicks', label: 'Click events', kind: 'queue', near: 'api' },
      { op: 'add', id: 'analytics', label: 'Analytics store', kind: 'storage', near: 'clicks' },
      { op: 'connect', from: 'user', to: 'cdn' },
      { op: 'connect', from: 'cdn', to: 'lb' },
      { op: 'connect', from: 'lb', to: 'api' },
      { op: 'connect', from: 'api', to: 'cache' },
      { op: 'connect', from: 'api', to: 'db' },
      { op: 'connect', from: 'api', to: 'keys' },
      { op: 'connect', from: 'api', to: 'clicks', label: 'async' },
      { op: 'connect', from: 'clicks', to: 'analytics' }
    ],
    modelAnswer: `**Requirements.** Create (rare) and redirect (very common, ~100:1); custom aliases; expiry; click counts.

**Numbers.** 100M new links a month, ~40 links/s written, ~4,000 redirects/s average and 10× at peak; 6B links over five years at ~500 bytes is ~3 TB.

**Design.** 7 base62 characters give 3.5 trillion codes. A key generator hands each server a range of counter values, so codes are unique without coordination per request (a unique constraint backs it up). Redirects go through a cache (most clicks are on few links) and the store is a key-value database.

**Analytics** go on a queue off the redirect path. A 302 keeps every click visible to you; a 301 lets browsers cache it and hides repeat clicks.

**Failure.** If the store is slow, the cache and CDN keep popular redirects working; creation can degrade first.`
  },
  {
    id: 'rate-limiter',
    title: 'A distributed rate limiter',
    brief: 'Design rate limiting for a public payments API that runs on many servers: each API key gets, say, 100 requests a second, with short bursts allowed, and limits must hold across all servers.',
    tags: ['general', 'payments'],
    probes: [
      { area: 'requirements', question: 'Per key, per IP, per endpoint? Hard or soft limits? What does the client see when limited?' },
      { area: 'scale', question: 'How many keys and requests per second does the limiter itself handle?' },
      { area: 'consistency', question: 'Two servers check the same key at once. How do you avoid letting both through at the limit?' },
      { area: 'idempotency', question: 'Should a retried request (same idempotency key) count against the limit again?' },
      { area: 'failure', question: 'The shared store is down. Fail open or fail closed?' }
    ],
    checklist: [
      { area: 'requirements', point: 'Limit dimension and response: 429 with Retry-After and rate headers', cues: ['429', 'retry-after', 'headers', 'per key'] },
      { area: 'architecture', point: 'An algorithm chosen with a reason: token bucket, sliding window', cues: ['token bucket', 'sliding window', 'leaky bucket', 'fixed window'] },
      { area: 'architecture', point: 'Shared counter store (e.g. Redis) checked at the gateway', cues: ['redis', 'shared', 'central', 'gateway'] },
      { area: 'scale', point: 'Puts numbers on checks per second and memory per key', cues: ['per second', 'qps', 'memory', 'bytes'] },
      { area: 'consistency', point: 'Atomic check-and-decrement (Lua script, INCR with expiry)', cues: ['atomic', 'lua', 'incr', 'race'] },
      { area: 'idempotency', point: 'Retries with the same idempotency key considered', cues: ['idempoten', 'retry', 'retries'] },
      { area: 'failure', point: 'Fail-open vs fail-closed decided, with local fallback limits', cues: ['fail open', 'fail-open', 'fail closed', 'fail-closed', 'local'] }
    ],
    reference: [
      { op: 'add', id: 'client', label: 'API client', kind: 'client' },
      { op: 'add', id: 'lb', label: 'Load balancer', kind: 'lb', near: 'client' },
      { op: 'add', id: 'gw', label: 'API gateway', kind: 'gateway', details: 'token bucket check per key', near: 'lb' },
      { op: 'add', id: 'redis', label: 'Redis cluster', kind: 'cache', details: 'atomic Lua: refill + take', near: 'gw', side: 'below' },
      { op: 'add', id: 'config', label: 'Limits config', kind: 'database', details: 'per key, per plan', near: 'redis' },
      { op: 'add', id: 'api', label: 'Payments API', kind: 'service', near: 'gw' },
      { op: 'connect', from: 'client', to: 'lb' },
      { op: 'connect', from: 'lb', to: 'gw' },
      { op: 'connect', from: 'gw', to: 'redis', label: 'check & take' },
      { op: 'connect', from: 'gw', to: 'config' },
      { op: 'connect', from: 'gw', to: 'api', label: 'allowed' }
    ],
    modelAnswer: `**Requirements.** Per API key (and per IP for unauthenticated calls), 100 req/s with bursts to 200; limited requests get 429 with Retry-After and X-RateLimit headers.

**Algorithm.** A token bucket per key: capacity 200, refill 100/s. It allows bursts and costs two numbers per key.

**Distributed.** The gateway checks a shared Redis cluster with one Lua script that refills and takes a token atomically, so two servers can't both take the last token. Keys are sharded by API key.

**Numbers.** 50k req/s means 50k Redis calls/s: comfortable for a small cluster; ~100 bytes per key.

**Failure.** If Redis is down, fall back to per-server local buckets at limit ÷ servers (fail open, but bounded) rather than rejecting all payments traffic.`
  },
  {
    id: 'stablecoin',
    title: 'Stablecoin mint and redeem',
    brief: 'Design the service behind a fiat-backed stablecoin: customers wire dollars in and receive tokens on chain (mint), or send tokens back and receive dollars (redeem). Reserves must always cover tokens in circulation.',
    tags: ['payments', 'blockchain'],
    probes: [
      { area: 'requirements', question: 'Which checks happen before a mint, and what must always be true of reserves and supply?' },
      { area: 'scale', question: 'How many mints a day, and what is slow: the bank or the chain?' },
      { area: 'consistency', question: 'How do you make sure you never mint without the dollars, or pay out twice for one redemption?' },
      { area: 'idempotency', question: 'Your transaction to mint is stuck in the mempool. You resend. What could go wrong?' },
      { area: 'failure', question: 'A chain reorganisation removes a redemption you already paid out. What now?' }
    ],
    checklist: [
      { area: 'requirements', point: 'KYC/AML on customers; reserves ≥ supply as an invariant', cues: ['kyc', 'aml', 'reserve', 'invariant', 'attest'] },
      { area: 'architecture', point: 'An off-chain ledger of customer balances and a minting service that holds signing keys in an HSM or multisig', cues: ['ledger', 'hsm', 'multisig', 'custody', 'signing'] },
      { area: 'architecture', point: 'A chain watcher (indexer) for incoming redemptions', cues: ['watcher', 'indexer', 'listener', 'node'] },
      { area: 'scale', point: 'Numbers on volume and on the bank and chain latencies', cues: ['per day', 'per second', 'confirmations', 'minutes'] },
      { area: 'consistency', point: 'Mint only after the wire is confirmed; state machine per request', cues: ['state machine', 'confirmed', 'settled', 'pending'] },
      { area: 'idempotency', point: 'Nonce management / one on-chain transaction per request id, so a resend replaces rather than duplicates', cues: ['nonce', 'idempoten', 'request id', 'replace'] },
      { area: 'failure', point: 'Waits for enough confirmations; handles reorgs', cues: ['confirmation', 'reorg', 'finality'] },
      { area: 'failure', point: 'Reconciliation of bank reserves, ledger and on-chain supply', cues: ['reconcil', 'supply', 'proof of reserve'] }
    ],
    reference: [
      { op: 'add', id: 'customer', label: 'Customer', kind: 'client' },
      { op: 'add', id: 'api', label: 'Mint/redeem API', kind: 'gateway', details: 'KYC checked, request ids', near: 'customer' },
      { op: 'add', id: 'orchestrator', label: 'Orchestrator', kind: 'service', details: 'state machine per request', near: 'api' },
      { op: 'add', id: 'bank', label: 'Bank (reserves)', kind: 'external', near: 'orchestrator', side: 'above' },
      { op: 'add', id: 'ledger', label: 'Ledger DB', kind: 'database', near: 'orchestrator', side: 'below' },
      { op: 'add', id: 'signer', label: 'Signer (HSM)', kind: 'service', details: 'nonce manager', near: 'orchestrator' },
      { op: 'add', id: 'chain', label: 'Blockchain', kind: 'external', near: 'signer' },
      { op: 'add', id: 'watcher', label: 'Chain watcher', kind: 'worker', details: 'waits N confirmations, reorgs', near: 'chain', side: 'below' },
      { op: 'add', id: 'recon', label: 'Reserve reconciliation', kind: 'worker', details: 'bank = ledger = supply', near: 'ledger' },
      { op: 'connect', from: 'customer', to: 'api' },
      { op: 'connect', from: 'api', to: 'orchestrator' },
      { op: 'connect', from: 'bank', to: 'orchestrator', label: 'wire confirmed' },
      { op: 'connect', from: 'orchestrator', to: 'ledger' },
      { op: 'connect', from: 'orchestrator', to: 'signer', label: 'mint' },
      { op: 'connect', from: 'signer', to: 'chain' },
      { op: 'connect', from: 'chain', to: 'watcher' },
      { op: 'connect', from: 'watcher', to: 'orchestrator', label: 'redeem seen' },
      { op: 'connect', from: 'recon', to: 'ledger' }
    ],
    modelAnswer: `**Invariant.** Dollars in reserve ≥ tokens in circulation, always; attested regularly.

**Mint.** A KYC'd customer creates a mint request (with a request id). The orchestrator moves it through a state machine: awaiting funds → funds confirmed by the bank → mint submitted → mint confirmed. Only confirmed wires lead to a mint. The signer holds keys in an HSM (or multisig) and manages nonces, so a stuck transaction is *replaced* with the same nonce, never duplicated.

**Redeem.** The chain watcher sees tokens sent to the redemption address, waits for enough confirmations, burns them, and the orchestrator pays out by wire once.

**Failure.** Reorgs: act only after finality. Reconcile bank balance, the ledger and on-chain supply every day; any gap stops minting.`
  }
]

export const designPrompt = (id: string) => DESIGNS.find((d) => d.id === id)

// ---------- Quant and finance ----------

export type QuantKind = 'mental' | 'probability' | 'ev' | 'sizing' | 'finance'

export interface QuantQuestion {
  id: string
  kind: QuantKind
  prompt: string
  /** A number to check against, when there is one */
  answer?: number
  /** Absolute tolerance */
  tolerance?: number
  /** Relative tolerance (an estimate within 10%: 0.1) */
  within?: number
  /** Market sizing: any answer within this factor of the reference counts as reasonable */
  factor?: number
  /** Finance concepts: the points a good answer makes, each with the words that show it */
  points?: { point: string; cues: string[] }[]
  /** The worked answer, shown at the debrief */
  solution: string
  /** Seconds a strong candidate takes */
  target: number
}

export const QUANT_BANK: QuantQuestion[] = [
  { id: 'dice-sum-7', kind: 'probability', prompt: 'Two fair dice are rolled. What is the probability the total is 7?', answer: 1 / 6, tolerance: 0.002, solution: '6 of the 36 equally likely outcomes sum to 7: (1,6), (2,5) … (6,1). So 6/36 = 1/6.', target: 30 },
  { id: 'at-least-one-six', kind: 'probability', prompt: 'You roll a fair die 4 times. What is the probability of at least one six? (To 3 decimal places.)', answer: 1 - (5 / 6) ** 4, tolerance: 0.002, solution: 'Complement: no six in 4 rolls is (5/6)⁴ = 625/1296 ≈ 0.482, so at least one six ≈ 0.518.', target: 60 },
  { id: 'two-children', kind: 'probability', prompt: 'A family has two children and at least one is a girl. What is the probability both are girls?', answer: 1 / 3, tolerance: 0.002, solution: 'Equally likely families: GG, GB, BG (BB is ruled out). Both girls in 1 of 3: 1/3.', target: 45 },
  { id: 'false-positive', kind: 'probability', prompt: '1% of transactions are fraud. A model flags 90% of fraud and 5% of genuine transactions. A transaction is flagged: what is the probability it is fraud? (To 3 decimal places.)', answer: 0.009 / (0.009 + 0.0495), tolerance: 0.003, solution: 'Bayes: P(fraud | flag) = 0.01×0.9 / (0.01×0.9 + 0.99×0.05) = 0.009 / 0.0585 ≈ 0.154. Most flags are false alarms because fraud is rare.', target: 90 },
  { id: 'ev-die-reroll', kind: 'ev', prompt: 'You roll a die and are paid its value in pounds. Once, you may re-roll and take the second result instead. With the best strategy, what is the game worth?', answer: 4.25, tolerance: 0.01, solution: 'A re-roll is worth 3.5, so keep 4, 5 or 6 and re-roll 1–3. Value = (1/2)(5) + (1/2)(3.5) = 4.25.', target: 90 },
  { id: 'ev-coin-until-heads', kind: 'ev', prompt: 'You toss a fair coin until the first head. What is the expected number of tosses?', answer: 2, tolerance: 0.001, solution: 'Geometric with p = 1/2: E = 1/p = 2. Or E = 1 + (1/2)E, so E = 2.', target: 45 },
  { id: 'ev-max-two-dice', kind: 'ev', prompt: 'What is the expected value of the larger of two fair dice? (To 2 decimal places.)', answer: 161 / 36, tolerance: 0.01, solution: 'P(max ≤ k) = (k/6)², so P(max = k) = (2k − 1)/36. E = Σ k(2k − 1)/36 = 161/36 ≈ 4.47.', target: 120 },
  { id: 'ev-card-game', kind: 'ev', prompt: 'A game costs £1. You draw one card from a standard deck: an ace pays £10, a picture card (J, Q, K) pays £2, anything else pays nothing. What is your expected profit per game, in pounds? (To 2 decimal places.)', answer: (4 * 10 + 12 * 2) / 52 - 1, tolerance: 0.01, solution: 'Expected payout = (4×10 + 12×2)/52 = 64/52 ≈ £1.23, minus the £1 stake: about +£0.23.', target: 75 },
  { id: 'sizing-uk-card-payments', kind: 'sizing', prompt: 'Roughly how many card payments are made in the UK in a year? Give a number and say how you got it.', answer: 2.3e10, factor: 3, solution: 'About 50M adults × ~1.3 card payments a day × 365 ≈ 24 billion. (UK Finance reports around 23 billion debit and credit card payments a year.)', target: 180 },
  { id: 'sizing-coffee-london', kind: 'sizing', prompt: 'Estimate the number of cups of coffee sold in London cafés per day.', answer: 2.5e6, factor: 3, solution: '9M people; ~50% drink coffee; perhaps 1 in 3 of them buys one from a café on a given day, plus commuters and tourists: about 9M × 0.5 × 0.4 ≈ 1.8M, rounding up for visitors to ~2–3M.', target: 180 },
  { id: 'sizing-interchange', kind: 'sizing', prompt: 'A UK issuer has 5 million active debit cards. Estimate its yearly interchange income from them.', answer: 5e6 * 300 * 25 * 0.002, factor: 3, solution: 'Each card ~25 payments a month (300 a year) averaging ~£25 = £7,500 a year. UK debit interchange is capped at 0.2%: £15 per card. × 5M cards ≈ £75M a year.', target: 180 },
  {
    id: 'finance-settlement',
    kind: 'finance',
    prompt: 'Explain the difference between authorisation, clearing and settlement in a card payment.',
    points: [
      { point: 'Authorisation: the issuer approves and places a hold, in real time', cues: ['hold', 'approve', 'real time', 'real-time', 'issuer'] },
      { point: 'Clearing: transaction details are exchanged and the amount is confirmed, later (often in batches)', cues: ['clearing', 'batch', 'exchange', 'details'] },
      { point: 'Settlement: money actually moves between issuer and acquirer through the scheme, net of fees', cues: ['settle', 'money moves', 'funds', 'net', 'interchange'] }
    ],
    solution: 'Authorisation checks the card and funds and places a hold in real time. Clearing (usually end of day, in batches) sends the final transaction details so the amount can be posted. Settlement is when funds actually move from issuer to acquirer through the scheme, net of interchange and scheme fees, typically a day or two later.',
    target: 120
  },
  {
    id: 'finance-rails',
    kind: 'finance',
    prompt: 'A UK fintech wants to pay out to customers instantly. Compare Faster Payments, Bacs and CHAPS for that.',
    points: [
      { point: 'Faster Payments: near-instant, 24/7, per-transaction limits (up to £1M scheme limit; banks set lower)', cues: ['instant', 'seconds', '24/7', 'limit'] },
      { point: 'Bacs: cheap batch, three working days, good for payroll and direct debits', cues: ['three day', '3 day', '3-day', 'batch', 'cheap', 'payroll', 'direct debit'] },
      { point: 'CHAPS: same-day, high value, expensive, business hours', cues: ['same day', 'same-day', 'high value', 'high-value', 'expensive', 'rtgs'] },
      { point: 'Irrevocability and fraud risk (APP fraud) matter for instant payouts', cues: ['irrevocab', 'app fraud', 'fraud', 'final'] }
    ],
    solution: 'Faster Payments settles in seconds, 24/7, with per-payment limits, so it suits instant payouts; payments are final, so fraud controls (confirmation of payee, APP fraud reimbursement) matter. Bacs is a cheap three-day batch scheme for payroll and direct debits. CHAPS is same-day real-time gross settlement for high values, costly and only in business hours.',
    target: 150
  },
  {
    id: 'finance-var',
    kind: 'finance',
    prompt: 'What does a one-day 99% Value at Risk of £2M mean, and what does it not tell you?',
    points: [
      { point: 'On 99% of days the loss should not exceed £2M (1 day in 100 it is expected to)', cues: ['99%', '1 in 100', 'one in 100', '1%', 'exceed'] },
      { point: 'It says nothing about how big losses are beyond it (tail risk); expected shortfall does', cues: ['tail', 'beyond', 'expected shortfall', 'cvar', 'how bad'] },
      { point: 'It depends on assumptions: history window, normality, liquidity', cues: ['assum', 'normal', 'historical', 'liquidity', 'model'] }
    ],
    solution: 'There is a 1% chance of losing more than £2M over one day (about 2–3 days a year). It does not say how much more: a tail measure like expected shortfall does. It also rests on assumptions (the history used, distribution shape, being able to exit positions in a day).',
    target: 120
  },
  {
    id: 'finance-stablecoin-risk',
    kind: 'finance',
    prompt: 'What are the main risks to a fiat-backed stablecoin holding its peg?',
    points: [
      { point: 'Reserve quality and liquidity (cash and short T-bills vs riskier assets)', cues: ['reserve', 'treasur', 't-bill', 'liquid'] },
      { point: 'A run: many redemptions at once', cues: ['run', 'redemption', 'redeem'] },
      { point: 'Counterparty / bank failure where reserves are held', cues: ['bank', 'counterparty', 'custod', 'svb'] },
      { point: 'Regulatory, operational and smart contract risk', cues: ['regulat', 'operational', 'smart contract', 'freeze', 'hack'] }
    ],
    solution: 'The peg holds while holders believe each token can be redeemed for a dollar. Risks: reserves that are illiquid or lose value; a run of redemptions faster than reserves can be sold; the bank holding reserves failing (USDC and SVB, 2023); and regulatory action, operational failure or contract bugs.',
    target: 150
  }
]

/** Mental arithmetic from the drills' generators (shared/mentalMaths), the kinds a trading interview uses */
export const MENTAL_LEVELS = ['percent', 'finance', 'growth', 'estimate', 'fractions', 'division', 'times-9-11', 'square-5']

export function mentalQuestions(n: number, seed: number): QuantQuestion[] {
  const r = rng(seed)
  const levels = LEVELS.filter((l) => MENTAL_LEVELS.includes(l.id))
  const out: QuantQuestion[] = []
  const seen = new Set<string>()
  for (let i = 0; out.length < n && i < n * 6; i++) {
    const level = levels[(i + seed) % levels.length]
    const q: MathsQuestion = level.make(r)
    if (seen.has(q.prompt) || q.kind !== 'number') continue
    seen.add(q.prompt)
    out.push({ id: `mental-${level.id}-${out.length}`, kind: 'mental', prompt: q.prompt, answer: Number(q.answer), tolerance: q.tolerance, within: q.within, solution: q.how, target: level.target })
  }
  return out
}

/** A quant paper: mental maths first, then probability and expected value, a sizing and a finance question */
export function quantPaper(seed: number, o: { mental?: number; probability?: number; finance?: number } = {}): QuantQuestion[] {
  const pick = <T,>(xs: T[], k: number, s: number) => {
    const a = [...xs]
    const r = rng(s)
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a.slice(0, k)
  }
  const prob = QUANT_BANK.filter((q) => q.kind === 'probability' || q.kind === 'ev')
  return [
    ...mentalQuestions(o.mental ?? 6, seed),
    ...pick(prob, o.probability ?? 4, seed + 1),
    ...pick(QUANT_BANK.filter((q) => q.kind === 'sizing'), 1, seed + 2),
    ...pick(QUANT_BANK.filter((q) => q.kind === 'finance'), o.finance ?? 2, seed + 3)
  ]
}

/**
 * A typed number as a value: 0.25, 1/6, 16.7%, £1.2m, 2.3e10, 24 billion, 1,200. Null when there
 * is no number. The last number in the text wins ("6/36 = 1/6" is 1/6).
 */
export function parseNumber(text: string): number | null {
  const t = text.toLowerCase().replace(/,(?=\d{3}\b)/g, '').replace(/[£$€]/g, '')
  const re = /(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*(%|percent|k\b|thousand|m\b|mn\b|million|bn\b|b\b|billion|tn\b|trillion)?/g
  let last: number | null = null
  for (const m of t.matchAll(re)) {
    let v = Number(m[1])
    if (m[2]) v = v / Number(m[2])
    const unit = m[3]
    if (unit === '%' || unit === 'percent') v /= 100
    else if (unit === 'k' || unit === 'thousand') v *= 1e3
    else if (unit === 'm' || unit === 'mn' || unit === 'million') v *= 1e6
    else if (unit === 'b' || unit === 'bn' || unit === 'billion') v *= 1e9
    else if (unit === 'tn' || unit === 'trillion') v *= 1e12
    if (Number.isFinite(v)) last = v
  }
  return last
}

export type QuantVerdict = 'right' | 'close' | 'wrong' | 'open'

/** Marks one quant answer in code: numbers against the answer, sizing within a factor, concepts by the points they cover */
export function markQuant(q: QuantQuestion, typed: string): { verdict: QuantVerdict; score: number; covered?: string[] } {
  const text = typed.trim()
  if (!text) return { verdict: 'wrong', score: 0 }
  if (q.kind === 'mental' && q.answer !== undefined) {
    const ok = mathsRight({ answer: q.answer, kind: 'number', tolerance: q.tolerance, within: q.within }, text.replace(/[£$,%]/g, ''))
    return { verdict: ok ? 'right' : 'wrong', score: ok ? 1 : 0 }
  }
  if (q.kind === 'sizing' && q.answer !== undefined) {
    const v = parseNumber(text)
    if (v === null || v <= 0) return { verdict: 'wrong', score: 0 }
    const ratio = Math.max(v / q.answer, q.answer / v)
    const reasoned = text.split(/\s+/).length >= 12 || /[×x*]/.test(text)
    if (ratio <= (q.factor ?? 3)) return { verdict: 'right', score: reasoned ? 1 : 0.75 }
    if (ratio <= (q.factor ?? 3) ** 2) return { verdict: 'close', score: reasoned ? 0.5 : 0.35 }
    return { verdict: 'wrong', score: reasoned ? 0.2 : 0 }
  }
  if (q.kind === 'finance' && q.points) {
    const low = text.toLowerCase()
    const covered = q.points.filter((p) => p.cues.some((c) => low.includes(c.toLowerCase()))).map((p) => p.point)
    const score = covered.length / q.points.length
    return { verdict: score >= 0.75 ? 'right' : score >= 0.4 ? 'close' : 'wrong', score, covered }
  }
  if (q.answer !== undefined) {
    const v = parseNumber(text)
    if (v === null) return { verdict: 'wrong', score: 0 }
    const tol = q.tolerance ?? (q.within ? Math.abs(q.answer) * q.within : 1e-6)
    if (Math.abs(v - q.answer) <= tol) return { verdict: 'right', score: 1 }
    if (Math.abs(v - q.answer) <= tol * 5) return { verdict: 'close', score: 0.5 }
    return { verdict: 'wrong', score: 0 }
  }
  return { verdict: 'open', score: 0 }
}

// ---------- Behavioural ----------

export interface BehaviouralQuestion {
  id: string
  prompt: string
  /** What the interviewer is listening for */
  probes: string
  followUp: string
}

export const BEHAVIOURAL: BehaviouralQuestion[] = [
  { id: 'hard-bug', prompt: 'Tell me about the hardest technical problem you have solved.', probes: 'Depth, how they broke it down, what they personally did.', followUp: 'What would you do differently now?' },
  { id: 'disagree', prompt: 'Tell me about a time you disagreed with someone about how to build something. What happened?', probes: 'Respect, evidence over opinion, the outcome.', followUp: 'Looking back, were you right?' },
  { id: 'failure', prompt: 'Tell me about something you got wrong. How did you find out, and what did you do?', probes: 'Owning it, learning, changing how they work.', followUp: 'How do you make sure it does not happen again?' },
  { id: 'learn-fast', prompt: 'Tell me about a time you had to learn something new quickly to get something done.', probes: 'How they learn, resourcefulness, the result.', followUp: 'How do you know you understood it, not just got it working?' },
  { id: 'ownership', prompt: 'Tell me about something you built or improved without being asked to.', probes: 'Initiative, judgement about what mattered, impact.', followUp: 'How did you measure that it helped?' },
  { id: 'pressure', prompt: 'Tell me about a time something went wrong with real money or real users depending on it.', probes: 'Calm, priorities (stop the bleeding first), communication.', followUp: 'What did you tell people while it was happening?' },
  { id: 'why-payments', prompt: 'Why do you want to work in payments and fintech, rather than any software job?', probes: 'Genuine interest, specific knowledge, fit with their career story.', followUp: 'What is a payments product you think is badly built, and why?' },
  { id: 'tradeoff', prompt: 'Tell me about a time you had to choose between doing it fast and doing it right.', probes: 'Judgement, explicit trade-offs, owning the cost.', followUp: 'What did the shortcut cost later?' }
]

export const behaviouralQuestion = (id: string) => BEHAVIOURAL.find((q) => q.id === id)

/** STAR in a told story, found by the words people use for each part */
export function starParts(answer: string): { situation: boolean; task: boolean; action: boolean; result: boolean } {
  const t = answer.toLowerCase()
  return {
    situation: /\b(when i was|at (my|the) (job|company|team|work)|we were|the team|project|context|background|last year|in \d{4})\b/.test(t),
    task: /\b(i (had|needed|was asked|was responsible) to|my (job|task|goal|role) was|the goal|needed to|had to)\b/.test(t),
    action: /\b(i (built|wrote|decided|started|changed|proposed|set up|talked|spoke|asked|fixed|found|traced|tested|measured|led|created|designed|refactored|investigated))\b/.test(t),
    result: /\b(as a result|in the end|the result|it (cut|reduced|saved|improved|meant)|we (shipped|launched|cut|saved|reduced)|\d+\s?%|went from|now)\b/.test(t)
  }
}
