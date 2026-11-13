# Payment Infrastructure Roadmap

Building and running the systems payments run on: switches, ledgers, gateways and the controls around them. Assumes the Payments and Payment Rails roadmap's first phase.

## 1. The system's shape — CORE

### Components of a payment platform

- [ ] Gateway, switch, ledger, settlement engine, reconciliation
- [ ] Payment state machines: created, authorised, captured, settled, returned
- [ ] Idempotency keys and exactly-once effects over at-least-once delivery
- [ ] Message queues and the outbox pattern
- [ ] Clock, cut-offs and business days
    - _Designing Data-Intensive Applications — Martin Kleppmann_
    - _Payment intents and their lifecycle — Stripe documentation_

### Ledgers at scale

- [ ] Double-entry as the data model: accounts, transfers, balances
- [ ] Immutable journals and derived balances
- [ ] Two-phase (pending then posted) transfers
- [ ] Balance limits and overdraft checks under concurrency
- [ ] Multi-currency ledgers and FX accounts
    - _TigerBeetle documentation — TigerBeetle_

### Practice

- [ ] Practice: Case study, post a day of transfers through Tide's ledger lab and prove the trial balance at every step

## 2. Messaging and connectivity — CORE

### Message standards

- [ ] ISO 8583 for cards: MTIs, bitmaps, data elements
- [ ] ISO 20022 for account-to-account payments
- [ ] Translating between MT and MX: what is lost and gained
- [ ] Validation: schema, business rules, sanctions
    - _Harmonised ISO 20022 data requirements — CPMI (BIS)_

### Connecting to schemes

- [ ] Direct and indirect participation in a scheme
- [ ] Settlement accounts at the central bank
- [ ] File-based versus real-time APIs
- [ ] Certification and testing with a scheme
    - _FedNow Service — Federal Reserve Board_

### Practice

- [ ] Practice: Case study, design the flow of an instant payment from API call to settlement confirmation as a sequence diagram

## 3. Reliability and control — CORE

### Correctness under failure

- [ ] Timeouts and unknown outcomes: the payment you can't see
- [ ] Retries with idempotency, and duplicate detection
- [ ] Sagas and compensating entries, never deletes
- [ ] Reconciliation: internal, scheme and bank statements
- [ ] Breaks, suspense accounts and investigations (camt.056, camt.029)
    - _Principles for financial market infrastructures — CPMI and IOSCO_

### Security

- [ ] HSMs, PIN blocks and key management
- [ ] PCI DSS scope and tokenisation
- [ ] Message signing and mutual TLS
    - _Payment tokenisation — EMVCo_

### Operations

- [ ] Liquidity monitoring and intraday positions
- [ ] Observability: latency, success rates, settlement lag
- [ ] Incident response and business continuity for a systemic system
    - _Principles for financial market infrastructures — CPMI and IOSCO_

**Capstone Projects**

- [ ] Project: An idempotent payments API over a double-entry ledger with two-phase transfers, a reconciliation job against camt.053 files, and failure tests
