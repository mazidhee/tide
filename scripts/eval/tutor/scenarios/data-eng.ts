/**
 * Data engineering: one scenario for each kind of situation. Tutor turns in a history are written
 * the way the lesson's rules ask (tags, hidden <solution>), since they are what the model saw.
 * String.raw keeps backslashes as typed.
 */
import type { Scenario } from '../types'

const r = String.raw

export const DATA_ENG: Scenario[] = [
  {
    id: 'data-eng-open-batch-vs-stream',
    subject: 'data-eng',
    situation: 'open',
    setup: { mode: 'teach', topic: 'Batch versus stream processing' },
    history: [],
    expect: { ends: 'ask', askTypes: ['short', 'predict', 'choice', 'explain'], heading: 'Why this matters', forbid: ['grade', 'summary', 'solution'] },
    good: r`**Why this matters**

Every pipeline answers one question before any other: is the data processed in bounded chunks on a schedule, or record by record as it arrives. Batch is what nightly warehouse loads and Spark jobs do; streaming is what Kafka consumers, Flink jobs and fraud checks do. The choice sets how fresh the results are, what the pipeline costs to run, how a failed run is retried and how late data is handled. Windowing, watermarks and exactly-once processing all follow from it.

<ask type="short">A dashboard shows yesterday's revenue per country and is refreshed each morning at 06:00. Would you compute it with a batch job or a streaming job, and which property of the requirement decides it?</ask>`,
    bad: [
      {
        reply: r`Hi! Let's dive in to batch and stream processing, two key ideas in data engineering.

Have you used Spark or Kafka before? What do you think the difference between batch and streaming is?`,
        fails: ['no-preamble', 'heading'],
        repaired: ['ask']
      }
    ],
    judge: 'The opening names real batch and streaming systems and what the choice decides, and its question probes what the learner knows rather than teaching.'
  },
  {
    id: 'data-eng-after-correct-kafka-key-ordering',
    subject: 'data-eng',
    situation: 'after-correct',
    setup: { mode: 'teach', topic: 'Kafka partitions, keys and ordering', options: { difficulty: 'hard' } },
    history: [
      {
        tutor: r`<plan>
- Keys, partitions and ordering
- Consumer groups and throughput
</plan>

Kafka orders records only within a partition. The default partitioner sends a keyed record to partition hash(key) mod N, where N is the topic's partition count, so every record with one key lands in one partition for as long as N stays the same.

**Problem 1 · hard**

A topic has 6 partitions and every event is keyed by order_id. Order 77 produces three events in this order: created, paid, shipped. Assume producer retries cannot reorder records. (a) Is a consumer guaranteed to read those three in order? (b) Order 77's created event is produced before order 78's created event. Is a consumer guaranteed to read them in that order? (c) The team raises the topic to 8 partitions after paid and before shipped. What can go wrong for order 77?

<solution>(a) Yes: one key, one partition, and a partition is read in offset order. (b) No: 77 and 78 may hash to different partitions, and Kafka gives no order across partitions. (c) hash(77) mod 8 can differ from hash(77) mod 6, so shipped may land in a different partition from created and paid. Nothing orders the two partitions, so a consumer can process shipped before paid, for instance when the old partition is lagging.</solution>

<ask type="problem">Answer (a), (b) and (c), with the reason for each.</ask>`
      },
      {
        learner: {
          answer:
            '(a) Yes. The same key always hashes to the same partition while there are 6, and inside a partition records are read in offset order. (b) No. 77 and 78 can land in different partitions, and there is no ordering between partitions, so either may be read first. (c) The partition is hash mod N, so with N = 8 the shipped event can go to a different partition from the one holding created and paid. Those two partitions are consumed independently, so shipped can be processed before paid if the old partition is behind.',
          confidence: 'sure'
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true, askTypes: ['problem', 'error', 'explain'] },
    good: r`<grade verdict="correct" score="1">All three hold, with the right reasons: "inside a partition records are read in offset order", "there is no ordering between partitions", and for (c) "with N = 8 the shipped event can go to a different partition", which is exactly how per-key order is lost.</grade>

**Problem 2 · harder**

A topic has 12 partitions and receives 9,000 records per second, spread evenly across the partitions. Each consumer in the group can process at most 2,000 records per second, and the group assigns partitions to consumers as evenly as it can. What is the smallest number of consumers for which no consumer's lag grows?

<solution>Each partition carries 9,000 / 12 = 750 records per second. Five consumers look enough (5 × 2,000 = 10,000), but 12 partitions over 5 consumers is 3, 3, 2, 2, 2, and a consumer with 3 partitions receives 2,250 per second, more than 2,000, so its lag grows. Six consumers get 2 partitions each: 1,500 per second, within capacity. The answer is 6.</solution>

<ask type="problem">The number of consumers, with the load on the busiest consumer.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">Mostly there, but ordering in Kafka is more subtle than that.</grade>

**Problem 2 · harder**

A topic has 12 partitions and 9,000 records per second. Each consumer handles 2,000 per second. How many consumers are needed?

<ask type="problem">Your answer.</ask>`,
        fails: ['verdict'],
        repaired: ['solution']
      }
    ],
    judge: 'The answer is complete on all three parts; the reply should mark it correct by quoting it and move to a harder problem without re-teaching.'
  },
  {
    id: 'data-eng-after-wrong-exactly-once-consumer',
    subject: 'data-eng',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'At-least-once and exactly-once delivery', options: { strategy: 'dialogue' } },
    history: [
      {
        tutor: r`A consumer reads payment events from a Kafka topic. For each event it inserts one row into a ledger table in Postgres, and only then commits its offset to Kafka. The producer has enable.idempotence=true.

<ask type="explain">The consumer process crashes after the insert for one payment and before the offset commit. After it restarts, what does the ledger hold for that payment, and what would you change, if anything?</ask>`
      },
      {
        learner: {
          answer:
            'One row, so nothing needs to change. With idempotence enabled Kafka gives exactly-once delivery, which means the broker will never hand the consumer the same message twice. The restart just carries on with the next payment.',
          confidence: 'sure'
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: ['offset', 'again|second|duplicate|re-?read|re-?process|redeliver|replay|two rows'], need: ['card'], must: ['at[- ]least[- ]once|duplicate|two rows'] },
    good: r`<grade verdict="wrong" score="0">"the broker will never hand the consumer the same message twice" is the step that fails. enable.idempotence is a producer setting: it stops a producer's retries from writing one record into the log more than once. It does not limit how often a consumer reads that record.</grade>

A consumer's position is its committed offset. The crash came after the insert and before the commit, so the restarted consumer resumes from the last committed offset, reads the same payment again and inserts a second row. That is at-least-once delivery, and the ledger now holds a duplicate. The effect is exactly-once only if the sink copes with the repeat: either the insert is idempotent, or the offset is stored in the same database transaction as the row.

<card>A consumer crashes after writing to a database but before committing its offset. What happens on restart? :: It resumes from the last committed offset and processes the record again (at-least-once). The write must be idempotent, or the offset must be committed in the same transaction as the write.</card>

<ask type="short">The ledger insert has to be safe to run a second time for the same payment event. What would you add to the table or to the statement to make it so?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, with idempotence on Kafka gives exactly-once, so the ledger has one row for the payment.</grade>

<ask type="short">Which setting turns idempotence on?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The learner is sure that producer idempotence stops a consumer seeing a record twice. The reply must name that belief and replace it with the committed offset and the repeat after a crash.'
  },
  {
    id: 'data-eng-idk-watermarks',
    subject: 'data-eng',
    situation: 'idk',
    setup: { mode: 'teach', topic: 'Event time, processing time and watermarks', options: { why: true } },
    history: [
      {
        tutor: r`**Why this matters**

Stream jobs in Flink, Spark Structured Streaming and Kafka Streams group events into windows by the time they happened, not the time they arrived. Phones go offline and networks stall, so events arrive out of order, and every result a stream job publishes depends on how it decides that a window is complete.

<ask type="predict">A job counts clicks per one-minute window by event time. Events can turn up seconds or minutes late, and the job cannot wait for ever before publishing the 12:00 to 12:01 count. What could it use to decide that the window is finished?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', must: ['watermark'], forbid: ['grade'], words: { max: 240 } },
    good: r`The wall clock cannot settle it, because it says when events arrive, not when they happened. The only evidence of how far event time has advanced is the timestamps of the events already seen. So the job keeps a running estimate called a watermark: a claim that no event with an event time before T is still expected. A common rule is T = the largest event time seen so far, minus a fixed allowance for lateness, say 30 seconds. When the watermark passes the end of a window, the job treats the window as complete and publishes its count. The allowance is a trade: a larger one catches more late events and delays every result.

<note>Watermark: the job's estimate of event-time progress, "no event before T is still expected". Often T = largest event time seen − allowed lateness. A window closes when the watermark passes its end.</note>

<ask type="predict">The rule is: watermark = largest event time seen, minus 30 seconds. The largest event time seen so far is 12:01:20. Has the 12:00 to 12:01 window closed yet, and why?</ask>`,
    bad: [
      {
        reply: r`No problem. Think about it this way: how would the job know what time it is in the stream?

What do you think happens when an event arrives late?`,
        fails: ['plain-question', 'must'],
        repaired: ['ask']
      }
    ],
    judge: 'It derives the watermark from the problem (event time can only be estimated from events seen) rather than stating a definition, then asks something easier.'
  },
  {
    id: 'data-eng-show-me-cdc-pipeline',
    subject: 'data-eng',
    situation: 'show-me',
    setup: { mode: 'teach', topic: 'Change data capture' },
    history: [
      {
        tutor: r`Change data capture (CDC) copies every insert, update and delete from an operational database to the warehouse without querying its tables. The database already records each committed change in its write-ahead log. A CDC connector reads that log and publishes one change event per changed row to a Kafka topic, keyed by the row's primary key. A sink job consumes the topic and writes the events to a staging table, and a MERGE on the primary key folds the staging rows into the warehouse table.

<note>CDC: application → source database → write-ahead log → CDC connector → Kafka topic (keyed by primary key) → sink job → staging table → MERGE into the warehouse table.</note>

<continue/>`
      },
      { learner: { showMe: true } }
    ],
    expect: { ends: 'nothing', visual: { kind: 'mermaid', diagram: ['flowchart'] }, forbid: ['grade'], must: ['log'] },
    good: r`~~~mermaid
flowchart LR
    A["Application"] -->|"insert, update, delete"| B["Source database"]
    B -->|"committed changes"| C["Write-ahead log"]
    C -->|"read by"| D["CDC connector"]
    D -->|"change events, keyed by primary key"| E["Kafka topic"]
    E --> F["Sink job"]
    F -->|"writes events"| G["Staging table"]
    G -->|"MERGE on primary key"| H["Warehouse table"]
~~~

Look at the arrow into the CDC connector: it comes from the write-ahead log, not from the tables, so capturing changes adds no queries to the source database.`.replace(/~~~/g, '```'),
    bad: [
      {
        reply: r`CDC works like this: the database writes changes to its log, a connector reads the log and sends events to Kafka, and a sink job merges them into the warehouse.

<ask type="short">Which component reads the write-ahead log?</ask>`,
        fails: ['ends', 'visual']
      }
    ]
  },
  {
    id: 'data-eng-mark-planted-error-tumbling-window-boundary',
    subject: 'data-eng',
    situation: 'mark-planted-error',
    setup: { mode: 'teach', topic: 'Tumbling windows on event time' },
    history: [
      {
        tutor: r`**Problem 2 · same level**

A job counts events in 5-minute tumbling windows by event time. Windows are aligned to the hour and half-open, [start, end). Six events arrive in this order:

| Event | Event time | Arrival time |
|---|---|---|
| a | 12:01:10 | 12:01:12 |
| b | 12:06:15 | 12:06:16 |
| c | 12:04:59 | 12:06:40 |
| d | 12:07:30 | 12:07:31 |
| e | 12:10:00 | 12:10:02 |
| f | 12:13:20 | 12:13:21 |

No event is dropped as late. How many events does each window count?

<solution>By event time: [12:00, 12:05) holds a and c, count 2. [12:05, 12:10) holds b and d, count 2. [12:10, 12:15) holds e and f, count 2. c arrives at 12:06:40 but its event time 12:04:59 puts it in the first window. e at exactly 12:10:00 starts the third window, because a window's end is exclusive.</solution>

<ask type="problem">The count for each window, saying which events fall in it.</ask>`
      },
      {
        learner: {
          answer:
            'I used event time, not arrival time. Window 12:00 to 12:05: a (12:01:10) and c (12:04:59; it arrived at 12:06:40 but its event time is before 12:05), so 2. Window 12:05 to 12:10: b (12:06:15), d (12:07:30) and e (12:10:00, which is the last instant of this window), so 3. Window 12:10 to 12:15: f (12:13:20) only, so 1. Counts: 2, 3, 1.',
          confidence: 'sure'
        }
      }
    ],
    expect: {
      ends: 'ask',
      verdict: 'partial',
      accept: ['wrong'],
      names: ['12:10', r`exclusive|half-open|excluded|not (part|included|inside|in the)|third|\[12:10|12:10 to 12:15|starts?|opens?|begins?`]
    },
    good: r`<grade verdict="partial" score="0.6">Using event time and placing c in the first window is right. The slip is "e (12:10:00, which is the last instant of this window)": the windows are half-open, so [12:05, 12:10) stops just short of 12:10:00 and e belongs to the third window, [12:10, 12:15). The counts are 2, 2, 2.</grade>

<card>With tumbling windows [start, end), which window gets an event stamped exactly on a boundary? :: The window that starts there. The end is exclusive, so 12:10:00 belongs to [12:10, 12:15), not [12:05, 12:10).</card>

**Problem 3 · same level**

The same job now uses 10-minute tumbling windows aligned to the hour. Five events have event times 09:09:59, 09:10:00, 09:19:59, 09:20:00 and 09:20:01. How many events does each window count?

<solution>[09:00, 09:10) holds 09:09:59, count 1. [09:10, 09:20) holds 09:10:00 and 09:19:59, count 2. [09:20, 09:30) holds 09:20:00 and 09:20:01, count 2.</solution>

<ask type="problem">The count for each window, with the events in it.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">"I used event time, not arrival time" is the key idea, and putting c in the first window shows you have it. Counts 2, 3, 1.</grade>

<ask type="short">What would the counts be by arrival time?</ask>`,
        fails: ['verdict', 'names']
      }
    ],
    judge: 'Everything is right except event e on the 12:10:00 boundary; the reply must point at that one step and give the half-open rule, not re-teach event time.'
  },
  {
    id: 'data-eng-mark-unusual-correct-dedup-max-join',
    subject: 'data-eng',
    situation: 'mark-unusual-correct',
    setup: { mode: 'teach', topic: 'Deduplicating to the latest row per key' },
    history: [
      {
        tutor: r`**Problem 1 · warm-up**

A staging table raw_users(user_id, email, updated_at) holds every version of each user the pipeline has received, so one user can appear many times. No two rows for the same user share an updated_at. Write a query that returns exactly one row per user: the latest version.

<solution>SELECT user_id, email, updated_at FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC) AS rn FROM raw_users) AS ranked WHERE rn = 1; number each user's rows newest first and keep number 1.</solution>

<ask type="problem">The query, and one line on why it returns one row per user.</ask>`
      },
      {
        learner: {
          answer: r`~~~sql
SELECT r.user_id, r.email, r.updated_at
FROM raw_users r
JOIN (
  SELECT user_id, MAX(updated_at) AS latest
  FROM raw_users
  GROUP BY user_id
) m ON m.user_id = r.user_id AND m.latest = r.updated_at;
~~~

The subquery finds each user's newest updated_at. No two rows for a user share an updated_at, so the join matches exactly one row per user.`.replace(/~~~/g, '```')
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'correct', mustNot: ['(should|must|need to|have to) use ROW_NUMBER'] },
    good: r`<grade verdict="correct" score="1">Joining back on "m.latest = r.updated_at" keeps each user's newest row, and your reason is the one that matters: "No two rows for a user share an updated_at, so the join matches exactly one row per user". It returns the same rows as the window-function form.</grade>

<ask type="explain">Suppose the guarantee is dropped and two rows for one user can carry the same updated_at. What does your join return for that user, and what does a ROW_NUMBER() ... = 1 filter return instead?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">This can work, but to deduplicate you should use ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC) and keep the first row.</grade>

<ask type="short">Rewrite it with ROW_NUMBER.</ask>`,
        fails: ['verdict', 'must-not']
      }
    ],
    judge: 'A GROUP BY and MAX join is a correct dedup under the stated uniqueness guarantee; the reply must mark it correct rather than insist on ROW_NUMBER.'
  },
  {
    id: 'data-eng-tangent-avro-vs-parquet',
    subject: 'data-eng',
    situation: 'tangent',
    setup: { mode: 'teach', topic: 'Columnar storage and Parquet' },
    history: [
      {
        tutor: r`**Why this matters**

Parquet is the usual file format of data lakes and of engines such as Spark, Trino and DuckDB. How it lays data out decides how much of a file a query has to read, and that is most of the cost of an analytical query.

<ask type="predict">A table has 100 columns and a billion rows, and a query computes the average of one column. Why can a columnar file answer it while reading far less data than a row-oriented file?</ask>`
      },
      { learner: { question: 'Quick one before I answer: is Avro columnar too?' } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: [r`row[- ](oriented|based|wise|format|by)|by row|whole records?|record by record`], words: { max: 170 } },
    good: r`No. Avro is row-oriented: each record is written whole, one after another, with the schema stored once in the file header. That suits producing and consuming complete records one at a time, which is why Avro is common for Kafka messages and for landing raw data, while Parquet is used for the tables that analytical queries scan.

<note>Avro is row-oriented (whole records in sequence, schema in the header): good for messages and record-at-a-time writes. Parquet is columnar: good for analytical scans.</note>

Back to the query, which turns on exactly that difference in layout.

<ask type="predict">A table has 100 columns and a billion rows, and a query averages one column. What can the reader of a columnar file leave unread that the reader of a row-oriented file cannot?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="wrong" score="0">You have not answered the question yet.</grade>

Avro is a data serialisation format from the Hadoop ecosystem with rich schema evolution support.

<ask type="short">What is schema evolution?</ask>`,
        fails: ['must'],
        repaired: ['grade']
      }
    ],
    judge: 'It says plainly that Avro is row-oriented and what that suits, then returns to the pending columnar question without answering it for the learner.'
  },
  {
    id: 'data-eng-recall-open-scd-types',
    subject: 'data-eng',
    situation: 'recall-open',
    setup: { mode: 'recall', topic: 'Slowly changing dimensions: type 1 and type 2' },
    history: [],
    expect: { ends: 'ask', askTypes: ['explain'], forbid: ['grade', 'summary', 'card'], mustNot: ['overwrit', 'valid[_ -]?(from|to)|effective|is_current|current flag', 'new row|keeps? (the )?history|surrogate'], words: { max: 60 } },
    good: r`<ask type="explain">Explain slowly changing dimensions, type 1 and type 2, from memory, as fully as you can.</ask>`,
    bad: [
      {
        reply: r`Type 1 overwrites the old value, and type 2 adds a new row with valid_from and valid_to dates.

<ask type="short">Which one keeps history?</ask>`,
        fails: ['ask-type', 'must-not']
      }
    ]
  },
  {
    id: 'data-eng-code-bug-high-water-mark',
    subject: 'data-eng',
    situation: 'code-bug',
    setup: { mode: 'teach', topic: 'Incremental loads and high-water marks', options: { strategy: 'code' } },
    history: [
      {
        tutor: r`An incremental load copies only the rows the target has not seen yet. It remembers a high-water mark, the largest id already loaded, and each run takes only the rows beyond it.

<note>Incremental load: keep a high-water mark (the largest key already loaded); each run loads only rows beyond it, then advances the mark. Re-running with no new rows must change nothing.</note>

<ask type="code" lang="python">Write load_new(source, target, hwm). source and target are lists of dicts, and every row has a unique integer "id" that only grows. hwm is the largest id already in target (0 at the start). Append the rows not yet loaded to target and return the new high-water mark. Calling it again with no new source rows must leave target unchanged.</ask>

<solution>def load_new(source, target, hwm): new_rows = [row for row in source if row["id"] > hwm]; target.extend(new_rows); return max((row["id"] for row in new_rows), default=hwm). With ids 1, 2, 3 and hwm 0 it loads three rows and returns 3; a second call with hwm 3 loads nothing and returns 3.</solution>`
      },
      {
        learner: {
          answer: r`~~~python
def load_new(source, target, hwm):
    new_rows = [row for row in source if row["id"] >= hwm]
    target.extend(new_rows)
    return max((row["id"] for row in new_rows), default=hwm)
~~~`.replace(/~~~/g, '```')
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: ['>=', 'again|twice|second time|duplicate|re-?load|every run|each run'], need: ['card'] },
    good: r`<grade verdict="partial" score="0.4">The structure is right, and the mark is advanced correctly. The bug is the comparison in "row["id"] >= hwm": hwm is the largest id already loaded, so >= selects that row again. With ids 1, 2, 3 the first call returns 3 and loads three rows; a second call with hwm 3 appends row 3 again, and target holds 1, 2, 3, 3. The filter has to be strict: row["id"] > hwm.</grade>

<card>An incremental load filters on the high-water mark. Should the comparison be > or >=, when the mark is the largest id already loaded? :: Strictly greater (>). With >= the boundary row is loaded again on every run.</card>

<ask type="code" lang="python">Fix load_new, then prove it: load ids 1, 2, 3 from hwm 0, call it a second time with the returned mark, and assert that target still holds exactly three rows.</ask>

<solution>Change the filter to row["id"] > hwm. Test: target = []; source = [{"id": 1}, {"id": 2}, {"id": 3}]; h = load_new(source, target, 0); h = load_new(source, target, h); assert h == 3 and [row["id"] for row in target] == [1, 2, 3].</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your function filters the new rows, appends them and returns the largest id, which is what an incremental load does.</grade>

<ask type="short">What is a high-water mark?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The only bug is >= where > is needed, which reloads the boundary row on every run; the reply must point at that comparison and its effect.'
  }
]
