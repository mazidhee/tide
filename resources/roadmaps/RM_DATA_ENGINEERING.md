# Data Engineering Roadmap

Moving, storing and modelling data reliably, with payments and market data as the running examples.

## 1. Storage and SQL — CORE

### SQL in depth

- [ ] Joins, aggregates and window functions
- [ ] Query plans and indexes
- [ ] Transactions and isolation levels
    - _Use The Index, Luke — Markus Winand_
    - _PostgreSQL documentation — PostgreSQL_

### Data modelling

- [ ] Normalisation
- [ ] Dimensional modelling: facts and dimensions
- [ ] Slowly changing dimensions
- [ ] Modelling a ledger and its balances
    - _The Data Warehouse Toolkit — Ralph Kimball and Margy Ross_

### Practice

- [ ] Practice: Problem set, query the lab's journal tables for balances, running totals and reconciliation breaks with window functions

## 2. Pipelines — CORE

### Batch

- [ ] Extract, load, transform
- [ ] Orchestration with schedules and dependencies
- [ ] Idempotent, re-runnable jobs
- [ ] Data quality checks
    - _Fundamentals of Data Engineering — Joe Reis and Matt Housley_

### Streaming

- [ ] Logs, topics and partitions (Kafka)
- [ ] Exactly-once processing and its limits
- [ ] Event time, watermarks and late data
    - _Designing Data-Intensive Applications — Martin Kleppmann_
    - _Apache Kafka documentation — Apache Software Foundation_

### Practice

- [ ] Practice: Case study, design a pipeline that loads daily ISO 20022 statements, reconciles them and alerts on breaks

## 3. Platforms — SUPPORTING

### Warehouses and lakes

- [ ] Columnar storage and Parquet
- [ ] Warehouses (DuckDB, BigQuery, Snowflake)
- [ ] Table formats: Iceberg and Delta
    - _DuckDB documentation — DuckDB_

### Governance

- [ ] Lineage, catalogues and contracts
- [ ] PII, retention and access control
    - _Fundamentals of Data Engineering — Joe Reis and Matt Housley_

**Capstone Projects**

- [ ] Project: A pipeline that ingests market data and payment statements daily into a dimensional model, with tests, quality checks and a dashboard
