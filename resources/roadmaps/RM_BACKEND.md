# Backend Engineering Roadmap

Building services that stay correct under load and failure: HTTP APIs, Postgres in depth, caching and queues, auth, observability and deployment. Practise against the SQL lab and your own projects. With the Postgres pack (Settings › Tools) the lab runs real PostgreSQL beside SQLite: indexes, EXPLAIN ANALYZE, transactions, and a second session to watch isolation levels and locks.

## 1. HTTP and APIs — CORE

### HTTP

- [ ] HTTP methods, status codes, headers and caching semantics
- [ ] TLS and what HTTPS protects
- [ ] REST resource design and versioning
- [ ] Pagination, filtering and partial responses
- [ ] Idempotency keys and safe retries
- [ ] gRPC and Protocol Buffers
    - _RFC 9110: HTTP Semantics — IETF_
    - _API Design Patterns — JJ Geewax_

### Building a service

- [ ] Request validation and error responses (problem details)
- [ ] A framework's request lifecycle: routing, middleware and handlers
- [ ] Configuration and secrets
- [ ] Testing an API: unit, integration and contract tests
    - _Architecture Patterns with Python — Harry Percival and Bob Gregory_

### Practice

- [ ] Practice: Problem set, design and build a small REST API with idempotent POSTs and tests

**Capstone**

- [ ] Project: An idempotent payments service (project: payments-api)

## 2. Databases and Postgres — CORE

Courses: CMU 15-445 lectures (yt-cmu-15-445); Let’s Build a Simple Database (db-tutorial)

### Relational modelling

- [ ] Schema design and normalisation
- [ ] Constraints: keys, foreign keys and checks
- [ ] Migrations without downtime
    - _Designing Data-Intensive Applications — Martin Kleppmann_

### Postgres in depth

- [ ] Indexes: B-tree, hash and GIN, and when the planner uses them
- [ ] Reading EXPLAIN ANALYZE
- [ ] Postgres isolation levels and the anomalies each allows
- [ ] MVCC, vacuum and bloat
- [ ] Locks and deadlocks
- [ ] Connection pooling
- [ ] Replication and failover
    - _PostgreSQL documentation — PostgreSQL Global Development Group_

### Beyond relational

- [ ] Key-value and document stores, and when to choose them
- [ ] Full-text search

### Practice

- [ ] Practice: Case study, find and fix three slow queries in the SQL lab with EXPLAIN

**Capstone**

- [ ] Project: Accounts on a general ledger, with isolation tested under concurrency (project: bank-accounts)

## 3. Caching, queues and async work — CORE

Courses: The System Design Primer (system-design-primer)

### Caching

- [ ] Cache-aside, write-through and write-behind
- [ ] Invalidation and TTLs
- [ ] Redis data structures
- [ ] Cache stampedes and how to prevent them
- [ ] CDNs and HTTP caching
    - _Redis documentation — Redis_

### Queues and events

- [ ] Message queues and logs: RabbitMQ and Kafka
- [ ] At-least-once delivery and idempotent consumers
- [ ] The transactional outbox
- [ ] Dead-letter queues and retries with backoff
- [ ] Background jobs and scheduling
- [ ] Rate limiting: token bucket and sliding window
    - _Enterprise Integration Patterns — Gregor Hohpe and Bobby Woolf_

### Practice

- [ ] Practice: Problem set, add a cache and an outbox to a payments API and show nothing is lost or sent twice

**Capstone**

- [ ] Project: A payment rail with settlement and reconciliation (project: payment-rail)

## 4. Auth and security — CORE

### Identity

- [ ] Password storage: bcrypt and Argon2
- [ ] Sessions and tokens, and the pitfalls of JWTs
- [ ] Logging users in with OAuth 2.0 and OpenID Connect
- [ ] Authorisation: roles, scopes and row-level security
    - _OAuth 2.0 Security Best Current Practice (RFC 9700) — IETF_

### Defending a service

- [ ] The OWASP API Security Top 10
- [ ] Injection, SSRF and mass assignment
- [ ] Secrets management and key rotation
- [ ] Audit logs
    - _OWASP API Security Top 10 — OWASP Foundation_

### Practice

- [ ] Practice: Case study, attack your own API with the OWASP list and fix what breaks

**Capstone**

- [ ] Project: OAuth login and scoped API keys for a service, with an audit log and security tests

## 5. Observability and reliability — CORE

### Seeing the system

- [ ] Structured logging and correlation IDs
- [ ] Metrics: RED and USE, histograms and percentiles
- [ ] Distributed tracing with OpenTelemetry
- [ ] SLIs, SLOs and error budgets
- [ ] Alerting on symptoms, not causes
    - _Site Reliability Engineering — Betsy Beyer, Chris Jones, Jennifer Petoff and Niall Richard Murphy_
    - _OpenTelemetry documentation — OpenTelemetry_

### Failing well

- [ ] Timeouts, retries and circuit breakers
- [ ] Graceful degradation and load shedding
- [ ] Load testing
- [ ] Incident response and postmortems
    - _Release It! (2nd edition) — Michael T. Nygard_

### Practice

- [ ] Practice: Case study, trace one slow request across services and set an SLO with an alert

**Capstone**

- [ ] Project: Instrument a service with logs, metrics and traces, load-test it, and write its SLOs and runbook

## 6. Deployment and operations — SUPPORTING

Courses: The Missing Semester of Your CS Education (missing-semester)

### Shipping

- [ ] Containers: images, layers and Dockerfiles
- [ ] CI/CD pipelines
- [ ] Twelve-factor configuration
- [ ] Blue-green and canary releases, feature flags
- [ ] Database migrations in a deploy
    - _The Twelve-Factor App — Adam Wiggins_

### Running

- [ ] Kubernetes basics: pods, deployments and services
- [ ] Infrastructure as code with Terraform
- [ ] Scaling out: statelessness and autoscaling
    - _Kubernetes documentation — The Kubernetes Authors_

**Capstone**

- [ ] Project: Core payment infrastructure, deployed with CI, canary releases and a runbook (project: payment-infra)
