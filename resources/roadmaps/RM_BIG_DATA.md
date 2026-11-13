# Big Data Engineering Roadmap

Data at a scale one machine can't handle: distributed batch and stream processing, Spark and Kafka in depth, lakehouse tables, orchestration and data quality. Builds on the Data Engineering roadmap (SQL, modelling and first pipelines). The big data pack (Settings › Tools) runs real Spark jobs in lessons on a portable Java, and gives any run that names Kafka a broker of its own to produce to and consume from.

## 1. Distributed data foundations — CORE

Courses: Data Engineer Handbook (de-handbook)

### Why scale is hard

- [ ] Partitioning and sharding data
- [ ] Replication and consistency trade-offs
- [ ] Batch and streaming: latency, completeness and cost
- [ ] The Lambda and Kappa architectures
- [ ] Columnar storage: Parquet and ORC
- [ ] Compression and encodings
    - _Designing Data-Intensive Applications — Martin Kleppmann_
    - _The Dataflow Model — Tyler Akidau et al._

### Practice

- [ ] Practice: Problem set, the same aggregation as a batch job and a streaming job, compared on late data

**Capstone**

- [ ] Project: A schema validator that quarantines bad rows with a reason (project: row-validator)

## 2. Spark — CORE

Courses: Data Engineering Zoomcamp (de-zoomcamp)

### The engine

- [ ] RDDs, DataFrames and lazy evaluation
- [ ] The DAG, stages and tasks
- [ ] Narrow and wide transformations, and the shuffle
- [ ] Partitioning, skew and salting
- [ ] Joins: broadcast, sort-merge and shuffle hash
- [ ] Catalyst and adaptive query execution
- [ ] Caching and memory management
    - _Spark: The Definitive Guide — Bill Chambers and Matei Zaharia_
    - _Learning Spark (2nd edition) — Jules Damji, Brooke Wenig, Tathagata Das and Denny Lee_

### Practice

- [ ] Practice: Case study, read a Spark UI, find the skewed stage and fix it

**Capstone**

- [ ] Project: An ETL job that validates, transforms and loads idempotently (project: etl-job)

## 3. Kafka and stream processing — CORE

Courses: Data Engineering Zoomcamp (de-zoomcamp)

### Kafka

- [ ] Topics, partitions and offsets
- [ ] Producers: acks, batching and idempotence
- [ ] Consumer groups and rebalancing
- [ ] Retention, compaction and replay
- [ ] Exactly-once semantics and transactions
- [ ] Schemas and the schema registry
    - _Kafka: The Definitive Guide (2nd edition) — Gwen Shapira, Todd Palino, Rajini Sivaram and Krit Petty_

### Stream processing

- [ ] Event time, processing time and watermarks
- [ ] Windows: tumbling, sliding and session
- [ ] Stateful processing and checkpoints
- [ ] Stream-table joins
- [ ] Spark Structured Streaming and Flink compared
    - _Streaming Systems — Tyler Akidau, Slava Chernyak and Reuven Lax_

### Practice

- [ ] Practice: Problem set, count events per window with late arrivals and show the watermark at work

**Capstone**

- [ ] Project: A data pipeline with orchestration and data-quality checks (project: data-pipeline)

## 4. The lakehouse — CORE

Courses: Data Engineer Handbook (de-handbook)

### Table formats

- [ ] Data lakes and how they fail
- [ ] Open table formats: Iceberg, Delta Lake and Hudi
- [ ] ACID on object storage: snapshots and the metadata tree
- [ ] Time travel and schema evolution
- [ ] Partition evolution and hidden partitioning
- [ ] Compaction and the small-files problem
    - _Apache Iceberg documentation — Apache Software Foundation_
    - _Lakehouse: A New Generation of Open Platforms — Michael Armbrust, Ali Ghodsi, Reynold Xin and Matei Zaharia_

### Serving

- [ ] Query engines over the lake: Trino and DuckDB
- [ ] Medallion layers: bronze, silver and gold

### Practice

- [ ] Practice: Problem set, evolve a table's schema and partitioning without rewriting it, then time-travel to before

**Capstone**

- [ ] Project: A small lakehouse: raw events into Iceberg tables with compaction, queried from DuckDB

## 5. Orchestration and data quality — CORE

Courses: Data Engineering Zoomcamp (de-zoomcamp); The Data Engineering Cookbook (de-cookbook)

### Orchestration

- [ ] DAGs, schedules and backfills
- [ ] Airflow: operators, sensors and the scheduler
- [ ] Asset-based orchestration with Dagster
- [ ] Idempotent, re-runnable tasks
    - _Apache Airflow documentation — Apache Software Foundation_

### Data quality

- [ ] Data contracts
- [ ] Tests on data: freshness, volume, schema and distribution
- [ ] Great Expectations and dbt tests
- [ ] Lineage and impact analysis
- [ ] Data observability and incident handling
    - _Data Quality Fundamentals — Barr Moses, Lior Gavish and Molly Vorwerck_

### Practice

- [ ] Practice: Case study, a backfill that double-counted revenue: find why and make it idempotent

**Capstone**

- [ ] Project: A data platform with batch and streaming ingestion, lineage and a metrics API (project: data-platform)
