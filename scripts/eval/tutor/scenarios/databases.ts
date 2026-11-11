/**
 * Databases and SQL: one scenario for each kind of situation. SQL uses the lab's own tables
 * (customers, products, orders, order_items; users, events) and is shown in sql blocks, since the
 * code ask runs only Python, JavaScript, C and C++. Every query behaviour here was run in sqlite3.
 */
import type { Scenario } from '../types'

const r = String.raw

export const DATABASES: Scenario[] = [
  {
    id: 'databases-open-composite-index',
    subject: 'databases',
    situation: 'open',
    setup: { mode: 'teach', topic: 'Composite B-tree indexes and the leftmost prefix' },
    history: [],
    expect: { ends: 'ask', askTypes: ['short', 'predict', 'choice', 'explain'], heading: 'Why this matters', forbid: ['grade', 'summary', 'solution'] },
    good: r`**Why this matters**

A composite index is the usual way to make a filter on several columns fast, and the order of its columns decides which queries it can serve. Postgres, MySQL and SQLite all store it as a B-tree sorted by the first column, then by the second within each value of the first. Getting the order right is the difference between a seek that reads a few pages and a scan of the whole table, and it is most of what index design and reading a query plan come down to. The lab's events table has one: events_user on (user_id, ts).

<ask type="predict">Suppose events_user on (user_id, ts) is the only index on events, and a query filters on ts alone: WHERE ts >= '2025-06-01'. Can the database seek straight to the matching entries in that index? Say yes or no, and why you think so.</ask>`,
    bad: [
      {
        reply: r`Welcome! Composite indexes are a really interesting topic. An index on (a, b) can be used for a filter on a, or on a and b, but not on b alone. This is called the leftmost prefix rule.

Have you used CREATE INDEX before? What do you think happens with a filter on b?`,
        fails: ['no-preamble', 'heading'],
        repaired: ['ask']
      }
    ],
    judge: 'The opening says concretely what column order in a composite index decides, and its question finds out whether the learner already knows the leftmost-prefix rule without stating it.'
  },
  {
    id: 'databases-after-correct-phantom-read',
    subject: 'databases',
    situation: 'after-correct',
    setup: { mode: 'teach', topic: 'Isolation levels and their anomalies', options: { difficulty: 'hard' } },
    history: [
      {
        tutor: r`<plan>
- Read anomalies: dirty read, non-repeatable read, phantom
- Write skew, and what snapshot isolation misses
</plan>

A non-repeatable read is one row read twice in a transaction with different values, because another transaction committed an update in between. A phantom is one query run twice returning a different set of rows, because another transaction committed an insert or delete that matches its predicate.

**Problem 1 · hard**

T1 runs at READ COMMITTED while T2 commits between its two statements:

~~~sql
BEGIN;                                   -- T1
SELECT COUNT(*) FROM orders
WHERE customer_id = 7 AND status = 'processing';   -- returns 2
-- T2 commits: INSERT INTO orders (customer_id, order_date, status)
--             VALUES (7, '2025-06-30', 'processing');
SELECT COUNT(*) FROM orders
WHERE customer_id = 7 AND status = 'processing';   -- returns 3
COMMIT;
~~~

<solution>A phantom read: the same predicate matched a row that T2 inserted and committed between the two reads; no row T1 had already read changed, so it is not a non-repeatable read. In the SQL standard REPEATABLE READ still permits phantoms, so SERIALIZABLE is the lowest level that rules them out.</solution>

<ask type="problem">Name the anomaly T1 saw, and the lowest SQL-standard isolation level that rules it out.</ask>`.replace(/~~~/g, '```')
      },
      { learner: { answer: 'A phantom read. The same predicate query returned an extra row that T2 inserted and committed in between. No row that T1 had already read was changed, so it is not a non-repeatable read. In the standard only SERIALIZABLE forbids phantoms, because REPEATABLE READ still allows them.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true, askTypes: ['problem', 'error', 'explain'] },
    good: r`<grade verdict="correct" score="1">"No row that T1 had already read was changed" is the distinction that makes it a phantom and not a non-repeatable read, and SERIALIZABLE is the lowest standard level that forbids it.</grade>

**Problem 2 · harder**

A table on_call(doctor, on_duty) has two rows, both with on_duty = 1. The rule is that at least one doctor stays on duty. Two transactions run at the same time under snapshot isolation. Each runs SELECT COUNT(*) FROM on_call WHERE on_duty = 1, sees 2, and then sets its own doctor's on_duty to 0. Both commit.

<solution>Write skew. Each transaction read from its own snapshot, in which two doctors were on duty, and the two updated different rows, so first-committer-wins found no write-write conflict and both commits succeeded. The result, nobody on duty, could not come from running the two one after the other. Prevent it with SERIALIZABLE (serialisable snapshot isolation), or by locking the rows read with SELECT ... FOR UPDATE.</solution>

<ask type="problem">Name the anomaly, say why snapshot isolation lets both transactions commit, and give one way to prevent it.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">Nearly: this is closer to a non-repeatable read, since the count changed between two reads.</grade>

**Problem 2 · harder**

Two transactions under snapshot isolation each read the on_call table and then each takes a different doctor off duty.

<ask type="problem">Name the anomaly.</ask>`,
        fails: ['verdict'],
        repaired: ['solution']
      }
    ],
    judge: 'It marks the phantom answer correct without hedging and sets a harder problem (the lesson is at a hard level) with a complete hidden solution.'
  },
  {
    id: 'databases-after-wrong-not-in-null',
    subject: 'databases',
    situation: 'after-wrong',
    setup: { mode: 'quiz', topic: 'NULL and three-valued logic in SQL' },
    history: [
      {
        tutor: r`**Question 3 of 8**

~~~sql
SELECT name FROM products
WHERE product_id NOT IN (SELECT item_id FROM events);
~~~

In the lab, events.item_id is NULL on every signup, checkout_started and purchase event.

<ask type="short">Some products have never appeared in any event. Does this query return them? Say what it returns and why.</ask>`.replace(/~~~/g, '```')
      },
      { learner: { answer: 'Yes, it returns exactly the products that never appear in events. NOT IN checks the product_id against the values in the list, and the NULLs are simply skipped because NULL is not a value.', confidence: 'sure' } }
    ],
    expect: {
      ends: 'ask',
      verdict: 'wrong',
      names: ['unknown|three-valued|neither true nor false|not true', 'no rows|zero rows|0 rows|nothing|empty|no products|never true'],
      need: ['card'],
      must: ['NULL']
    },
    good: r`<grade verdict="wrong" score="0">"the NULLs are simply skipped" is the step that fails: NOT IN does not skip a NULL, it compares against it, and that comparison is neither true nor false.</grade>

x NOT IN (a, b, NULL) means x <> a AND x <> b AND x <> NULL. The last term is unknown for every x, so the condition is false when x matches a value and unknown otherwise. WHERE keeps a row only when its condition is true, so this query returns no rows at all. NOT EXISTS, or WHERE item_id IS NOT NULL inside the subquery, returns the products you expected.

<card>What does x NOT IN (subquery) give when the subquery returns a NULL? :: Never true: false if x matches a value, unknown otherwise, so WHERE drops every row. Use NOT EXISTS, or filter the NULLs out of the subquery.</card>

**Question 4 of 8**

<ask type="short">In SQLite, what does SELECT 3 NOT IN (1, 2, NULL) return, and what does SELECT 1 NOT IN (1, 2, NULL) return?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Right, NOT IN filters out the product ids that appear in the list.</grade>

**Question 4 of 8**

<ask type="short">What is the difference between IN and EXISTS?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The learner is sure that NOT IN skips NULLs. The reply must name that belief, show that the comparison with NULL is unknown so no row passes, and retest it in a new form.'
  },
  {
    id: 'databases-idk-write-ahead-log',
    subject: 'databases',
    situation: 'idk',
    setup: { mode: 'teach', topic: 'Write-ahead logging and durability', options: { why: true } },
    history: [
      {
        tutor: r`**Why this matters**

Every database that promises a committed transaction survives a power cut keeps that promise with a write-ahead log: the WAL in Postgres, the redo log in MySQL's InnoDB, WAL mode in SQLite. Replication and point-in-time recovery are built from the same log, so it is the ground under durability, backups and most questions about write performance.

<ask type="predict">A transaction changes rows on three different pages and commits, and the database writes those three pages to disk one after another. The power fails after the first page is written. What state is the database in when it restarts?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: ['log', 'crash|recover|restart|power'] },
    good: r`Take it one write at a time. A disk does not write three pages as one indivisible step, so a crash can land between them: one page holds the new rows and two still hold the old. After the restart the database has half a transaction and nothing that says which half, so it can neither finish the change nor undo it.

The way out is to write down first, in one place, what the transaction is going to do: one record per change, appended to a log and flushed to disk before any of the data pages. That ordering is the write-ahead rule. After a crash, recovery reads the log, redoes the changes of every transaction that committed and discards those of any that did not.

<ask type="choice" options="When its commit record in the log has been flushed to disk|When all three of its data pages have been flushed to disk|When its changes have been made to the pages in memory|When the next checkpoint has finished">With that rule in place, at what moment does the transaction become durable?</ask>`,
    judge: 'In Why mode, after "I don\'t know", it reasons from the torn three-page write to the need for a log written first, and asks an easier question rather than repeating the first.'
  },
  {
    id: 'databases-show-me-monthly-orders-chart',
    subject: 'databases',
    situation: 'show-me',
    setup: { mode: 'teach', topic: 'GROUP BY: aggregating by month in SQL' },
    history: [
      {
        tutor: r`To count orders per month, turn each order_date into its month and group on that. In SQLite, strftime('%Y-%m', order_date) maps '2024-03-17' to '2024-03', so every order in one month lands in one group.

~~~sql
SELECT strftime('%Y-%m', order_date) AS month, COUNT(*) AS orders
FROM orders
GROUP BY month
ORDER BY month;
~~~

Run it: you get one row per month, with the number of orders placed in it.

<note>Group by month in SQLite: GROUP BY strftime('%Y-%m', order_date). COUNT(*) then counts the rows in each month's group.</note>

<ask type="short">Change the query so it counts only completed orders (status = 'completed'). Which clause do you add, and where does it go?</ask>`.replace(/~~~/g, '```')
      },
      { learner: { question: 'Can you draw monthly order counts as a chart?' } }
    ],
    expect: { ends: 'either', visual: { kind: 'chart' }, forbid: ['grade'], words: { max: 110 } },
    good: r`~~~chart
{"sql": "SELECT strftime('%Y-%m', order_date) AS month, COUNT(*) AS orders FROM orders GROUP BY month ORDER BY month", "type": "line", "title": "Orders per month"}
~~~

Each point is one group from the query above: the month along the bottom, its COUNT(*) as the height.

<ask type="short">Back to the completed-only version: which clause filters the rows to status = 'completed', and does it go before or after GROUP BY?</ask>`.replace(/~~~/g, '```'),
    bad: [
      {
        reply: r`Here is a chart of orders per month:

~~~chart
SELECT strftime('%Y-%m', order_date) AS month, COUNT(*) AS orders FROM orders GROUP BY month ORDER BY month
~~~

Would you like it as a bar chart instead?`.replace(/~~~/g, '```'),
        fails: ['visual'],
        repaired: ['ask']
      }
    ],
    judge: 'It answers with a chart block the app can draw (JSON with the monthly query), one line on how to read it, and returns to the pending question.'
  },
  {
    id: 'databases-mark-planted-error-btree-height',
    subject: 'databases',
    situation: 'mark-planted-error',
    setup: { mode: 'teach', topic: 'B-tree fan-out and height' },
    history: [
      {
        tutor: r`**Problem 2 · same level**

A B+tree index uses 8 KiB pages (8192 bytes). Every entry, in internal pages and in leaves, is an 8-byte key with an 8-byte pointer. Ignore page headers and assume every page is full. The index covers 100 million rows. How many pages does a point lookup read, from the root down to the leaf, with nothing cached?

<solution>An entry is 16 bytes, so a page holds 8192 / 16 = 512 entries. 512^2 = 262,144 is fewer than 100,000,000 and 512^3 = 134,217,728 is enough, so the tree has three levels: root, one internal level, leaves. A lookup reads 3 pages.</solution>

<ask type="problem">The number of page reads, with your working.</ask>`
      },
      { learner: { answer: 'Each entry is 8 + 8 = 16 bytes, so a page holds 8192 / 16 = 256 entries. One level reaches 256 rows, two levels reach 256^2 = 65,536, three levels reach 256^3 = 16,777,216, which is still under 100 million, and four levels reach 256^4, about 4.3 billion. So the tree has four levels and a lookup reads 4 pages.', confidence: 'sure' } }
    ],
    expect: {
      ends: 'ask',
      verdict: 'partial',
      accept: ['wrong'],
      names: ['512'],
      must: [r`\b(3|three) (page|level|read)|(is|reads?|needs|takes|has|gives|in) (3|three)\b`]
    },
    good: r`<grade verdict="partial" score="0.6">The method is right, powers of the fan-out until they cover the rows, but the division fails: "8192 / 16 = 256" should be 512. Then 512^2 = 262,144 is too few and 512^3 = 134,217,728 covers 100 million, so the tree has 3 levels and a lookup reads 3 pages, not 4.</grade>

<card>How many 16-byte entries fit in an 8 KiB page, and how many rows do three B-tree levels of that fan-out reach? :: 8192 / 16 = 512 entries; 512^3 = 134,217,728 rows.</card>

**Problem 3 · same level**

The same index is rebuilt with 4 KiB pages (4096 bytes); entries are still 16 bytes and pages full. It now covers 1 billion rows. How many pages does a point lookup read?

<solution>4096 / 16 = 256 entries per page. 256^3 = 16,777,216 is fewer than 1,000,000,000 and 256^4 = 4,294,967,296 is enough, so four levels: a lookup reads 4 pages.</solution>

<ask type="problem">The number of page reads, with the fan-out you used.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your working is clear: 16-byte entries, 256 per page, and 256^4 is the first power above 100 million, so 4 pages.</grade>

<ask type="short">What would happen to the height with larger keys?</ask>`,
        fails: ['verdict', 'names']
      }
    ],
    judge: 'The only error is the division 8192 / 16 = 256 (it is 512), which turns 3 page reads into 4. The reply must point at that step, not just give the right answer.'
  },
  {
    id: 'databases-mark-unusual-correct-running-total',
    subject: 'databases',
    situation: 'mark-unusual-correct',
    setup: { mode: 'teach', topic: 'Window functions: running totals' },
    history: [
      {
        tutor: r`**Problem 1 · warm-up**

Using the lab's orders table, return one row per order_date with the number of orders placed that day (n) and the running total of orders up to and including that day (running), earliest day first.

<solution>SELECT order_date, COUNT(*) AS n, SUM(COUNT(*)) OVER (ORDER BY order_date) AS running FROM orders GROUP BY order_date ORDER BY order_date; The window sum runs over the grouped rows, so each day's running value is the number of orders dated on or before that day.</solution>

<ask type="problem">Your query, with a line on how it produces the running total.</ask>`
      },
      {
        learner: {
          answer: r`I did not use OVER. For each day I count every order dated on or before it with a subquery:

~~~sql
SELECT d.order_date,
       COUNT(*) AS n,
       (SELECT COUNT(*) FROM orders o2 WHERE o2.order_date <= d.order_date) AS running
FROM orders d
GROUP BY d.order_date
ORDER BY d.order_date;
~~~`.replace(/~~~/g, '```')
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'correct' },
    good: r`<grade verdict="correct" score="1">"count every order dated on or before it" is exactly what a running total is, and your correlated subquery computes it: one row per day, n from the group, running from every order up to that date. It returns the same rows as the window form.</grade>

The cost differs: your subquery is run again for each day, while SUM(COUNT(*)) OVER (ORDER BY order_date) makes one pass over the grouped rows.

<ask type="short">A window SUM with ORDER BY and the default frame gives rows that tie on the sort key the same running value. If you ran your subquery once per order row instead of once per day, would two orders on the same date also share a value? Say why.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">This topic is window functions, so the running total should be written with SUM(...) OVER (ORDER BY order_date). A subquery is not the expected answer.</grade>

<ask type="short">Rewrite it with OVER.</ask>`,
        fails: ['verdict']
      }
    ],
    judge: 'The correlated subquery returns exactly the rows the window function would. It must be marked correct; mentioning the cost is fine, marking it down for not using OVER is not.'
  },
  {
    id: 'databases-tangent-sqlite-row-locks',
    subject: 'databases',
    situation: 'tangent',
    setup: { mode: 'teach', topic: 'Transactions and deadlock' },
    history: [
      {
        tutor: r`**Why this matters**

Any service that updates more than one row per transaction can deadlock, and Postgres and MySQL both resolve it by aborting one of the transactions. Knowing how the cycle forms is what lets you order your writes to avoid it and write retry code that is correct when it happens anyway.

<ask type="predict">T1 runs UPDATE products SET price = price * 1.1 WHERE product_id = 1, and will then do the same for product_id = 2. T2 updates product 2 first and will then update product 1. Each has done its first update and neither has committed. What happens when each tries its second update?</ask>`
      },
      { learner: { question: 'Before I answer: does SQLite even have row locks? The lab runs on SQLite.' } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: ['whole database|entire database|database file|database[- ]level|one writer|single writer|one write transaction'], words: { max: 170 } },
    good: r`No. SQLite locks the whole database file, not rows: any number of readers, but only one writer at a time. A second connection that tries to write while another holds the write lock gets SQLITE_BUSY, after waiting out its busy timeout if one is set; there is no queue on a single row. In WAL mode readers carry on while the one writer works. So the lab cannot reproduce this case row by row. It is how Postgres and MySQL's InnoDB behave, which lock each row an UPDATE touches until the transaction ends.

<ask type="predict">In Postgres, then: T1 has updated product 1 and T2 has updated product 2, and neither has committed. T1 now tries to update product 2 and T2 tries to update product 1. What does each transaction do, and how does it end?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="wrong" score="0">You did not answer the question.</grade>

Yes, SQLite uses row-level locks just like Postgres, so the same thing happens in the lab.

What do you think happens when each tries its second update?`,
        fails: ['forbid:grade', 'must'],
        repaired: ['ask']
      }
    ],
    judge: 'It answers exactly (SQLite has database-level locking with a single writer, not row locks), briefly, then returns to the deadlock question rather than starting a lesson on SQLite.'
  },
  {
    id: 'databases-recall-open-normal-forms',
    subject: 'databases',
    situation: 'recall-open',
    setup: { mode: 'recall', topic: 'Normal forms: 1NF, 2NF and 3NF' },
    history: [],
    expect: { ends: 'ask', askTypes: ['explain'], forbid: ['grade', 'summary', 'card'], mustNot: [r`partial(ly)?[- ]depend`, 'transitive', 'atomic'], words: { max: 60 } },
    good: r`<ask type="explain">Explain first, second and third normal form from memory, as fully as you can: what each one requires of a table.</ask>`,
    bad: [
      {
        reply: r`1NF means atomic values, 2NF removes partial dependencies on a composite key, and 3NF removes transitive dependencies.

<ask type="short">Which normal form does a table with a repeating group break?</ask>`,
        fails: ['ask-type', 'must-not']
      }
    ]
  },
  {
    id: 'databases-code-bug-join-fan-out-count',
    subject: 'databases',
    situation: 'code-bug',
    setup: { mode: 'teach', topic: 'Joins and aggregation: fan-out' },
    history: [
      {
        tutor: r`**Problem 2 · same level**

This query is meant to return, for each customer, how many orders they have placed and their total revenue.

~~~sql
SELECT c.customer_id,
       COUNT(o.order_id) AS orders,
       SUM(oi.quantity * oi.unit_price) AS revenue
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
JOIN order_items oi ON oi.order_id = o.order_id
GROUP BY c.customer_id;
~~~

<solution>The orders figure is wrong. Joining order_items gives one row per item, so each order row repeats once per item and COUNT(o.order_id) counts items: a customer with 2 orders of 3 items each shows 6. Revenue is right, because each order_items row appears exactly once. Fix: COUNT(DISTINCT o.order_id).</solution>

<ask type="error">One of the two figures comes out wrong. Which one, why, and what is the fix?</ask>`.replace(/~~~/g, '```')
      },
      { learner: { answer: 'The revenue is wrong. Joining orders to order_items repeats rows, so SUM adds each amount more than once and the revenue is inflated. The order count is fine because it counts order_id. The fix is to compute the SUM in a subquery before joining.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: ['count', r`DISTINCT|per item|each item|every item|item rows?|line items?|counts? (the )?items|\d+ items|once per`], need: ['card'] },
    good: r`<grade verdict="wrong" score="0.2">"SUM adds each amount more than once" is the step that fails. After the two joins there is one row per order_items row, so each quantity * unit_price is added exactly once and the revenue is right. It is the order row that repeats, once per item, so COUNT(o.order_id) counts items, not orders.</grade>

The fix is COUNT(DISTINCT o.order_id). A customer with 2 orders of 3 items each shows orders = 6 without it and 2 with it.

<card>After joining orders to order_items, which is inflated: COUNT(o.order_id) or SUM(oi.quantity * oi.unit_price)? :: The COUNT: each order row repeats once per item. Each item row appears once, so the SUM is right. Use COUNT(DISTINCT o.order_id).</card>

<ask type="short">Suppose orders had a shipping_fee column and you added SUM(o.shipping_fee) to this query. Would that total be right? Say why.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, the join to order_items repeats rows, so the SUM is inflated and a subquery fixes it.</grade>

<ask type="short">What does a LEFT JOIN do differently here?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The learner saw the fan-out but blamed the wrong aggregate. The reply must say the SUM is right and the COUNT is inflated (one row per item), and give COUNT(DISTINCT o.order_id).'
  }
]
