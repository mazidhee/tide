import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts. SQL here: each stage's setup and tests run in the data lab's SQLite.

/** The CSV export as it was loaded: every column text, as messy as real exports are */
const DATA = String.raw`CREATE TABLE raw_orders (order_id TEXT, order_date TEXT, customer TEXT, product TEXT, quantity TEXT, unit_price TEXT, country TEXT);
INSERT INTO raw_orders VALUES
 ('1001', '2024-01-05', ' Ada Lovelace ', 'Notebook', '2', '4.50', 'UK'),
 ('1002', '07/01/2024', 'Alan Turing', 'Pen', '10', '£1.20', 'uk '),
 ('1002', '07/01/2024', 'Alan Turing', 'Pen', '10', '£1.20', 'uk '),
 ('1003', '2024-01-20', 'Grace Hopper', ' Laptop', '1', '£1,200.00', 'United States'),
 ('', '', '', '', '', '', ''),
 ('1004', '2024-02-02', 'Ada Lovelace', 'Pen', ' 5', '1.2', 'GB'),
 ('1005', '2024-02-14', 'Edsger Dijkstra', 'Notebook', '3', '4.5', 'Netherlands'),
 ('1006', '2024-02-30', 'Barbara Liskov', 'Pen', '1', '1.20', 'US'),
 ('1007', '2024-02-18', 'Ken Thompson', 'Laptop', 'two', '999', 'US'),
 ('1008', '2024-03-01', 'Grace Hopper', 'Notebook', '4', '4.50', 'USA'),
 ('1009', '03/03/2024', 'Alan Turing', 'Laptop', '1', '£1,150.00', 'GB'),
 ('1010', '2024-03-09', 'Margaret Hamilton', 'Pen', '20', '1.10', 'Mars'),
 ('1011', '2024-03-15', 'Edsger Dijkstra', 'Pen', '6', '1.20', 'NL'),
 ('1012', '2024-03-28', 'Ada Lovelace', 'Laptop', '1', '1,099.99', 'uk'),
 ('1013', '2024-03-30', 'Barbara Liskov', 'Notebook', '0', '4.50', 'US'),
 ('1014', '2024-01-31', 'Grace Hopper', 'Pen', '3', '-1.20', 'US');
CREATE TABLE country_names (name TEXT PRIMARY KEY, code TEXT);
INSERT INTO country_names VALUES ('uk', 'GB'), ('gb', 'GB'), ('united kingdom', 'GB'), ('us', 'US'), ('usa', 'US'), ('united states', 'US'), ('nl', 'NL'), ('netherlands', 'NL'), ('fr', 'FR'), ('france', 'FR');
CREATE TABLE _want_clean (order_id INTEGER, order_date TEXT, customer TEXT, product TEXT, quantity INTEGER, unit_price REAL, country TEXT);
INSERT INTO _want_clean VALUES
 (1001, '2024-01-05', 'Ada Lovelace', 'Notebook', 2, 4.5, 'GB'),
 (1002, '2024-01-07', 'Alan Turing', 'Pen', 10, 1.2, 'GB'),
 (1003, '2024-01-20', 'Grace Hopper', 'Laptop', 1, 1200.0, 'US'),
 (1004, '2024-02-02', 'Ada Lovelace', 'Pen', 5, 1.2, 'GB'),
 (1005, '2024-02-14', 'Edsger Dijkstra', 'Notebook', 3, 4.5, 'NL'),
 (1008, '2024-03-01', 'Grace Hopper', 'Notebook', 4, 4.5, 'US'),
 (1009, '2024-03-03', 'Alan Turing', 'Laptop', 1, 1150.0, 'GB'),
 (1011, '2024-03-15', 'Edsger Dijkstra', 'Pen', 6, 1.2, 'NL'),
 (1012, '2024-03-28', 'Ada Lovelace', 'Laptop', 1, 1099.99, 'GB');`

const CLEAN_STARTER = `-- Stage 1: one row per real order, typed and tidied. See STAGE-1.md.
-- The raw export is in raw_orders (every column TEXT); country_names maps names to codes.

-- CREATE VIEW clean_orders AS
-- SELECT ...
`

const REJECTS_STARTER = `-- Stage 2: the lines that could not be read, and why. See STAGE-2.md.

-- CREATE VIEW rejected_orders AS
-- SELECT ...
`

const REPORT_STARTER = `-- Stage 3: revenue by month and country, and the products ranked. See STAGE-3.md.

-- CREATE VIEW monthly_revenue AS ...
-- CREATE VIEW top_products AS ...
`

const CUSTOMERS_STARTER = `-- Stage 4: one row per customer, ranked within their country. See STAGE-4.md.

-- CREATE VIEW customer_summary AS ...
`

const CLEAN = String.raw`-- One row per distinct, non-blank line of the export, with its fields tidied and every problem named.
CREATE VIEW parsed_orders AS
SELECT
  trim(r.order_id) AS raw_id,
  CASE
    WHEN trim(r.order_date) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN trim(r.order_date)
    WHEN trim(r.order_date) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]'
      THEN substr(trim(r.order_date), 7, 4) || '-' || substr(trim(r.order_date), 4, 2) || '-' || substr(trim(r.order_date), 1, 2)
  END AS iso_date,
  trim(r.customer) AS customer,
  trim(r.product) AS product,
  trim(r.quantity) AS qty_text,
  replace(replace(trim(r.unit_price), '£', ''), ',', '') AS price_text,
  (SELECT c.code FROM country_names AS c WHERE c.name = lower(trim(r.country))) AS country
FROM (SELECT DISTINCT * FROM raw_orders) AS r
WHERE trim(r.order_id) <> '';

CREATE VIEW checked_orders AS
SELECT p.*,
  CASE
    WHEN p.iso_date IS NULL OR date(p.iso_date) IS NOT p.iso_date THEN 'bad date'
    WHEN p.qty_text = '' OR p.qty_text GLOB '*[^0-9]*' OR CAST(p.qty_text AS INTEGER) <= 0 THEN 'bad quantity'
    WHEN p.price_text = '' OR p.price_text GLOB '*[^0-9.]*' OR p.price_text GLOB '*.*.*' OR CAST(p.price_text AS REAL) <= 0 THEN 'bad price'
    WHEN p.country IS NULL THEN 'unknown country'
  END AS problem
FROM parsed_orders AS p;

CREATE VIEW clean_orders AS
SELECT CAST(raw_id AS INTEGER) AS order_id, iso_date AS order_date, customer, product,
       CAST(qty_text AS INTEGER) AS quantity, round(CAST(price_text AS REAL), 2) AS unit_price, country
FROM checked_orders
WHERE problem IS NULL;
`

const REJECTS = String.raw`CREATE VIEW rejected_orders AS
SELECT raw_id AS order_id, problem AS reason
FROM checked_orders
WHERE problem IS NOT NULL;
`

const REPORT = String.raw`CREATE VIEW monthly_revenue AS
SELECT substr(order_date, 1, 7) AS month, country,
       count(DISTINCT order_id) AS orders,
       round(sum(quantity * unit_price), 2) AS revenue
FROM clean_orders
GROUP BY 1, 2;

CREATE VIEW top_products AS
SELECT product, revenue, RANK() OVER (ORDER BY revenue DESC) AS rank
FROM (SELECT product, round(sum(quantity * unit_price), 2) AS revenue FROM clean_orders GROUP BY product);
`

const CUSTOMERS = String.raw`CREATE VIEW customer_summary AS
SELECT customer, country,
       min(order_date) AS first_order,
       max(order_date) AS last_order,
       count(DISTINCT order_id) AS orders,
       round(sum(quantity * unit_price), 2) AS revenue,
       RANK() OVER (PARTITION BY country ORDER BY round(sum(quantity * unit_price), 2) DESC) AS rank_in_country
FROM clean_orders
GROUP BY customer, country;
`

/** Compares one column of clean_orders with what it should be, order by order */
const column = (col: string) =>
  `SELECT 'order ' || w.order_id || ': ${col} should be ' || quote(w.${col}) || ', got ' || quote(c.${col}) || ' (' || typeof(c.${col}) || ')' FROM _want_clean AS w JOIN clean_orders AS c ON c.order_id = w.order_id WHERE c.${col} IS NOT w.${col} OR typeof(c.${col}) IS NOT typeof(w.${col})`

export const salesReport: WorkshopProject = {
  id: 'sales-report',
  title: 'A CSV-to-report pipeline in SQL',
  outcome: 'A small data pipeline in SQLite, layer on layer as a dbt project is built: a messy CSV export typed and cleaned, every unreadable line set aside with its reason, revenue by month and country, products ranked with window functions, and a customer summary, all as views that stay right when new rows arrive.',
  area: 'data',
  prerequisites: ['SQL SELECT and GROUP BY', 'Joins'],
  languages: ['sql'],
  stages: [
    {
      id: 'clean',
      title: 'From text to typed rows',
      goal: 'Turn the raw text export into one typed, tidy row per real order.',
      brief: `The table \`raw_orders\` is a CSV export loaded as it came: every column is \`TEXT\`. In \`clean.sql\`, create the view \`clean_orders\`. Tide runs your file after loading the data; your views must read \`raw_orders\` (never a copy of its rows), because the tests add rows of their own.

| column | from the raw text |
|---|---|
| \`order_id\` | \`INTEGER\` |
| \`order_date\` | \`TEXT\`, an ISO date \`YYYY-MM-DD\`. The export mixes \`YYYY-MM-DD\` and \`DD/MM/YYYY\`. |
| \`customer\`, \`product\` | \`TEXT\` with leading and trailing spaces removed |
| \`quantity\` | \`INTEGER\` |
| \`unit_price\` | \`REAL\`, rounded to 2 places; the text may have a \`£\` and thousands commas (\`£1,200.00\`) |
| \`country\` | the two-letter code from \`country_names(name, code)\`, looked up by the country text trimmed and in lower case |

Leave out:
- blank lines (an empty or blank \`order_id\`), and lines exported twice (identical in every column count once);
- any line that cannot be read: a date that is in neither format or does not exist (\`2024-02-30\`), a quantity that is not a whole number above 0, a price that is not a number above 0, or a country not in \`country_names\`.

SQLite tip: \`date('2024-02-30')\` is \`'2024-03-01'\`, not NULL.`,
      read: { concept: 'Data cleaning in SQL', source: 'SQLite documentation: “Datatypes In SQLite” (type affinity, CAST), “Date And Time Functions”, and the GLOB operator' },
      files: [{ path: 'clean.sql', content: CLEAN_STARTER }],
      lang: 'sql',
      setup: DATA,
      tests: [
        {
          name: 'one row per real order',
          code: `SELECT 'clean_orders should have 9 rows (16 lines, less a blank one, a duplicate and 5 that cannot be read), got ' || count(*) FROM clean_orders HAVING count(*) <> 9`
        },
        {
          name: 'every expected order is there, and nothing else',
          code: `SELECT 'order ' || order_id || ' is missing from clean_orders' FROM _want_clean WHERE order_id NOT IN (SELECT order_id FROM clean_orders)
UNION ALL SELECT 'order ' || quote(order_id) || ' should not be in clean_orders' FROM clean_orders WHERE order_id NOT IN (SELECT order_id FROM _want_clean)`
        },
        {
          name: 'ids, quantities and prices are numbers, not text',
          code: `${column('order_id')}
UNION ALL ${column('quantity')}
UNION ALL ${column('unit_price')}`
        },
        {
          name: 'both date formats become ISO dates',
          code: column('order_date')
        },
        {
          name: 'names are trimmed and countries are codes',
          code: `${column('customer')}
UNION ALL ${column('product')}
UNION ALL ${column('country')}`
        },
        {
          name: 'a line exported twice counts once',
          code: `SELECT 'order 1002 appears ' || count(*) || ' times in clean_orders; the export has it twice, identical, so it should appear once' FROM clean_orders WHERE order_id = 1002 HAVING count(*) <> 1`
        },
        {
          name: 'the view follows new rows in raw_orders',
          code: `INSERT INTO raw_orders VALUES ('2001', '15/04/2024', ' Ada Lovelace', 'Pen', '1', '£2.00', ' France');
SELECT 'a line added to raw_orders for order 2001 should appear in clean_orders as 2024-04-15, FR, 2.0; got ' || coalesce((SELECT order_date || ', ' || country || ', ' || unit_price FROM clean_orders WHERE order_id = 2001), 'no row') WHERE NOT EXISTS (SELECT 1 FROM clean_orders WHERE order_id = 2001 AND order_date = '2024-04-15' AND country = 'FR' AND unit_price = 2.0)`
        }
      ],
      hints: [
        'Work column by column in a SELECT over raw_orders before you make it a view. Two columns need a CASE, one needs a lookup, and the duplicates and blanks are a matter of what you select FROM and WHERE.',
        'SELECT DISTINCT * FROM raw_orders removes the exact duplicates before anything else. For the date, test the shape with GLOB and rebuild DD/MM/YYYY with substr; a date is real only when date(x) gives x back. For the price, replace the £ and the commas before CAST. A correlated subquery or a LEFT JOIN on lower(trim(country)) finds the code.',
        'Build it in two layers. A first view over the distinct, non-blank rows computes the trimmed text of each field, the ISO date (NULL when neither GLOB matches), the price text without £ and commas, and the country code. A second SELECT over it keeps only rows where date(iso) IS iso, the quantity text is non-empty with no non-digit (NOT GLOB \'*[^0-9]*\') and is above 0, the price text is a positive number, and the code is not NULL; it casts quantity to INTEGER and the price to REAL rounded to 2.'
      ],
      teaches: ['Data cleaning in SQL', 'Type affinity in SQLite'],
      recall: 'Why does a cleaning view read the raw table on every query instead of copying cleaned rows into a new table once?'
    },
    {
      id: 'rejects',
      title: 'Nothing silently dropped',
      goal: 'List every line that could not be read, with the first reason it failed.',
      brief: `A pipeline that drops bad lines without saying so loses data quietly. In \`rejects.sql\`, create the view \`rejected_orders(order_id, reason)\`: one row for each distinct, non-blank line of \`raw_orders\` that is not in \`clean_orders\`.

- \`order_id\` is the raw id, trimmed (\`TEXT\`).
- \`reason\` is the **first** of these that applies, checked in this order: \`'bad date'\`, \`'bad quantity'\`, \`'bad price'\`, \`'unknown country'\`. The rules are exactly the ones \`clean_orders\` uses.
- Blank lines are neither orders nor rejections; a line exported twice is rejected once.

Together the two views must account for every distinct non-blank line: the number of rows in \`clean_orders\` plus those in \`rejected_orders\` is the number of distinct non-blank lines in \`raw_orders\`. The cleanest way to keep the two in step is one shared view that works out each line's problem, which both read.`,
      read: { concept: 'Data quality and dead-letter tables', source: 'Kleppmann, Designing Data-Intensive Applications, ch. 11 (handling faults in stream processing); dbt documentation, “Tests” (not_null, accepted_values)' },
      files: [{ path: 'rejects.sql', content: REJECTS_STARTER }],
      lang: 'sql',
      setup: String.raw`CREATE TABLE _want_rejected (order_id TEXT, reason TEXT);
INSERT INTO _want_rejected VALUES ('1006', 'bad date'), ('1007', 'bad quantity'), ('1010', 'unknown country'), ('1013', 'bad quantity'), ('1014', 'bad price');`,
      tests: [
        {
          name: 'each unreadable line is listed with its reason',
          code: `SELECT 'order ' || w.order_id || ' should be rejected for ' || quote(w.reason) || ', got ' || coalesce((SELECT quote(r.reason) FROM rejected_orders AS r WHERE r.order_id = w.order_id), 'no row') FROM _want_rejected AS w WHERE NOT EXISTS (SELECT 1 FROM rejected_orders AS r WHERE r.order_id = w.order_id AND r.reason = w.reason)
UNION ALL SELECT 'order ' || quote(order_id) || ' should not be in rejected_orders' FROM rejected_orders WHERE order_id NOT IN (SELECT order_id FROM _want_rejected)`
        },
        {
          name: 'every distinct non-blank line is either clean or rejected',
          code: `SELECT 'raw_orders has ' || r || ' distinct non-blank lines, but clean_orders (' || c || ') and rejected_orders (' || j || ') add up to ' || (c + j)
FROM (SELECT (SELECT count(*) FROM (SELECT DISTINCT * FROM raw_orders WHERE trim(order_id) <> '')) AS r, (SELECT count(*) FROM clean_orders) AS c, (SELECT count(*) FROM rejected_orders) AS j)
WHERE r <> c + j`
        },
        {
          name: 'the first problem is the reason given',
          code: `INSERT INTO raw_orders VALUES ('3001', '31/04/2024', 'Ken Thompson', 'Pen', 'many', 'free', 'Mars'), ('3002', '2024-04-02', 'Ken Thompson', 'Pen', '1.5', '1', 'US'), ('3003', '2024-04-02', 'Ken Thompson', 'Pen', '1', '1.2.3', 'US');
SELECT 'order ' || id || ' should be rejected for ' || quote(want) || ', got ' || coalesce((SELECT quote(reason) FROM rejected_orders WHERE order_id = id), 'no row')
FROM (SELECT '3001' AS id, 'bad date' AS want UNION ALL SELECT '3002', 'bad quantity' UNION ALL SELECT '3003', 'bad price')
WHERE NOT EXISTS (SELECT 1 FROM rejected_orders WHERE order_id = id AND reason = want)`
        },
        {
          name: 'blank lines and duplicates are not rejections',
          code: `INSERT INTO raw_orders VALUES ('   ', '', '', '', '', '', ''), ('1007', '2024-02-18', 'Ken Thompson', 'Laptop', 'two', '999', 'US');
SELECT 'rejected_orders should have 5 rows (a blank line is not a rejection, and a line exported twice is rejected once), got ' || count(*) FROM rejected_orders HAVING count(*) <> 5`
        }
      ],
      hints: [
        'The rules already exist in clean_orders. The question is how to say them once so the two views can never disagree.',
        'Move the work into a view that keeps every distinct non-blank line and adds a column naming its problem (NULL when there is none), with a CASE whose branches are in the order the brief gives. clean_orders then keeps the rows where it is NULL, rejected_orders the rest.',
        'Turn the conditions of your stage 1 WHERE into a CASE: WHEN the date is not real THEN \'bad date\' WHEN the quantity fails THEN \'bad quantity\' WHEN the price fails THEN \'bad price\' WHEN the code is NULL THEN \'unknown country\' END AS problem. Rewrite clean_orders as SELECT … FROM that view WHERE problem IS NULL, and rejected_orders as SELECT raw_id AS order_id, problem AS reason FROM it WHERE problem IS NOT NULL. Put the shared view in clean.sql so it exists before both.'
      ],
      teaches: ['Data quality and dead-letter tables', 'CASE expressions'],
      recall: 'Why should a pipeline keep rejected rows with a reason instead of filtering them out with a WHERE clause?'
    },
    {
      id: 'report',
      title: 'Revenue by month, products ranked',
      goal: 'Aggregate revenue by month and country, and rank products with a window function.',
      brief: `In \`report.sql\`, create two views over \`clean_orders\`. Revenue is \`quantity × unit_price\`.

**\`monthly_revenue(month, country, orders, revenue)\`**: one row per month and country that had orders. \`month\` is \`'YYYY-MM'\`; \`orders\` is the number of distinct orders; \`revenue\` is the total, rounded to 2 places.

**\`top_products(product, revenue, rank)\`**: one row per product, \`revenue\` its total rounded to 2 places, and \`rank\` its position by revenue, highest first. Products with the same rounded revenue share a rank, and the next rank skips accordingly (1, 2, 2, 4), as SQL's \`RANK()\` does.`,
      read: { concept: 'Window functions', source: 'SQLite documentation, “Window Functions” (RANK, DENSE_RANK, PARTITION BY); Use The Index, Luke: “Window functions”' },
      files: [{ path: 'report.sql', content: REPORT_STARTER }],
      lang: 'sql',
      setup: String.raw`CREATE TABLE _want_monthly (month TEXT, country TEXT, orders INTEGER, revenue REAL);
INSERT INTO _want_monthly VALUES ('2024-01', 'GB', 2, 21.0), ('2024-01', 'US', 1, 1200.0), ('2024-02', 'GB', 1, 6.0), ('2024-02', 'NL', 1, 13.5), ('2024-03', 'GB', 2, 2249.99), ('2024-03', 'NL', 1, 7.2), ('2024-03', 'US', 1, 18.0);`,
      tests: [
        {
          name: 'revenue and orders for each month and country',
          code: `SELECT e.month || ' ' || e.country || ' should have ' || e.orders || ' orders and revenue ' || e.revenue || '; got ' || coalesce((SELECT m.orders || ' orders and revenue ' || m.revenue FROM monthly_revenue AS m WHERE m.month = e.month AND m.country = e.country), 'no row')
FROM _want_monthly AS e WHERE NOT EXISTS (SELECT 1 FROM monthly_revenue AS m WHERE m.month = e.month AND m.country = e.country AND m.orders = e.orders AND m.revenue = e.revenue)
UNION ALL SELECT 'monthly_revenue has a row for ' || quote(m.month) || ' ' || quote(m.country) || ' that should not be there' FROM monthly_revenue AS m WHERE NOT EXISTS (SELECT 1 FROM _want_monthly AS e WHERE e.month = m.month AND e.country = m.country)`
        },
        {
          name: 'revenue is rounded to two places',
          code: `SELECT 'revenue for ' || month || ' ' || country || ' is ' || revenue || '; it should be rounded to 2 places' FROM monthly_revenue WHERE revenue <> round(revenue, 2)`
        },
        {
          name: 'products ranked by revenue',
          code: `SELECT 'top_products should be Laptop 3449.99 rank 1, Notebook 40.5 rank 2, Pen 25.2 rank 3; got ' || coalesce((SELECT group_concat(product || ' ' || revenue || ' rank ' || rank, ', ') FROM (SELECT * FROM top_products ORDER BY rank, product)), 'nothing')
WHERE (SELECT group_concat(product || ' ' || revenue || ' rank ' || rank, ', ') FROM (SELECT * FROM top_products ORDER BY rank, product)) IS NOT 'Laptop 3449.99 rank 1, Notebook 40.5 rank 2, Pen 25.2 rank 3'`
        },
        {
          name: 'products with equal revenue share a rank',
          code: `INSERT INTO raw_orders VALUES ('4001', '2024-03-31', 'Alan Turing', 'Pen', '9', '1.70', 'GB'), ('4002', '2024-03-31', 'Alan Turing', 'Stapler', '1', '1.00', 'GB');
SELECT 'with Pen raised to 40.5, equal to Notebook, the ranks should be Laptop 1, Notebook 2, Pen 2, Stapler 4; got ' || coalesce((SELECT group_concat(product || ' ' || rank, ', ') FROM (SELECT * FROM top_products ORDER BY rank, product)), 'nothing')
WHERE (SELECT group_concat(product || ' ' || rank, ', ') FROM (SELECT * FROM top_products ORDER BY rank, product)) IS NOT 'Laptop 1, Notebook 2, Pen 2, Stapler 4'`
        }
      ],
      hints: [
        'monthly_revenue is a GROUP BY over two expressions. top_products needs a total per product first and a rank over those totals second: two levels.',
        'substr(order_date, 1, 7) is the month. Count orders with count(DISTINCT order_id). For the ranking, compute each product’s rounded total in a subquery, then apply RANK() OVER (ORDER BY revenue DESC) to its rows; ranking the rounded totals is what makes equal revenues tie.',
        'monthly_revenue: SELECT substr(order_date, 1, 7) AS month, country, count(DISTINCT order_id) AS orders, round(sum(quantity * unit_price), 2) AS revenue FROM clean_orders GROUP BY 1, 2. top_products: SELECT product, revenue, RANK() OVER (ORDER BY revenue DESC) AS rank FROM (SELECT product, round(sum(quantity * unit_price), 2) AS revenue FROM clean_orders GROUP BY product).'
      ],
      teaches: ['Window functions', 'Aggregation with GROUP BY'],
      recall: 'What is the difference between RANK and DENSE_RANK when two rows tie, and why can’t a plain GROUP BY produce either?'
    },
    {
      id: 'customers',
      title: 'Customers, ranked in their country',
      goal: 'Summarise each customer and rank them within their country with a partitioned window.',
      brief: `In \`customers.sql\`, create the view \`customer_summary\`, one row per customer and country, over \`clean_orders\`:

| column | |
|---|---|
| \`customer\`, \`country\` | |
| \`first_order\`, \`last_order\` | the earliest and latest \`order_date\` |
| \`orders\` | the number of distinct orders |
| \`revenue\` | total \`quantity × unit_price\`, rounded to 2 places |
| \`rank_in_country\` | position by revenue within the customer's country, highest first; ties share a rank, as \`RANK()\` gives |`,
      read: { concept: 'Partitioned window functions', source: 'SQLite documentation, “Window Functions”, section 2: the PARTITION BY clause; Markus Winand, “Modern SQL”: window functions' },
      files: [{ path: 'customers.sql', content: CUSTOMERS_STARTER }],
      lang: 'sql',
      setup: String.raw`CREATE TABLE _want_customers (customer TEXT, country TEXT, first_order TEXT, last_order TEXT, orders INTEGER, revenue REAL, rank_in_country INTEGER);
INSERT INTO _want_customers VALUES
 ('Ada Lovelace', 'GB', '2024-01-05', '2024-03-28', 3, 1114.99, 2),
 ('Alan Turing', 'GB', '2024-01-07', '2024-03-03', 2, 1162.0, 1),
 ('Grace Hopper', 'US', '2024-01-20', '2024-03-01', 2, 1218.0, 1),
 ('Edsger Dijkstra', 'NL', '2024-02-14', '2024-03-15', 2, 20.7, 1);`,
      tests: [
        {
          name: 'one row per customer with their dates, orders and revenue',
          code: `SELECT w.customer || ' should be ' || w.country || ', ' || w.first_order || ' to ' || w.last_order || ', ' || w.orders || ' orders, revenue ' || w.revenue || '; got ' || coalesce((SELECT s.country || ', ' || s.first_order || ' to ' || s.last_order || ', ' || s.orders || ' orders, revenue ' || s.revenue FROM customer_summary AS s WHERE s.customer = w.customer), 'no row')
FROM _want_customers AS w WHERE NOT EXISTS (SELECT 1 FROM customer_summary AS s WHERE s.customer = w.customer AND s.country = w.country AND s.first_order = w.first_order AND s.last_order = w.last_order AND s.orders = w.orders AND s.revenue = w.revenue)
UNION ALL SELECT 'customer_summary should have 4 rows, got ' || count(*) FROM customer_summary HAVING count(*) <> 4`
        },
        {
          name: 'customers are ranked within their own country',
          code: `SELECT w.customer || ' should rank ' || w.rank_in_country || ' in ' || w.country || ', got ' || coalesce((SELECT s.rank_in_country FROM customer_summary AS s WHERE s.customer = w.customer), 'no row') FROM _want_customers AS w WHERE NOT EXISTS (SELECT 1 FROM customer_summary AS s WHERE s.customer = w.customer AND s.rank_in_country = w.rank_in_country)`
        },
        {
          name: 'customers with equal revenue share a rank',
          code: `INSERT INTO raw_orders VALUES ('5001', '2024-03-30', 'Ada Lovelace', 'Pen', '1', '47.01', 'GB');
SELECT 'with Ada Lovelace raised to 1162.0, equal to Alan Turing, both should rank 1 in GB; got ' || group_concat(customer || ' ' || rank_in_country, ', ') FROM customer_summary WHERE country = 'GB' HAVING sum(rank_in_country) <> 2`
        }
      ],
      hints: [
        'This is the same two-level shape as top_products, with the ranking restarted for each country.',
        'Group clean_orders by customer and country for min, max, count(DISTINCT …) and the rounded sum. A window function may be applied to the grouped rows in the same SELECT: RANK() OVER (PARTITION BY country ORDER BY …).',
        'SELECT customer, country, min(order_date) AS first_order, max(order_date) AS last_order, count(DISTINCT order_id) AS orders, round(sum(quantity * unit_price), 2) AS revenue, RANK() OVER (PARTITION BY country ORDER BY round(sum(quantity * unit_price), 2) DESC) AS rank_in_country FROM clean_orders GROUP BY customer, country.'
      ],
      teaches: ['Partitioned window functions', 'Aggregation with GROUP BY'],
      recall: 'In a query with GROUP BY and a window function, which runs first, and why can the window function use an aggregate in its ORDER BY?'
    }
  ],
  solution: [
    { path: 'clean.sql', content: CLEAN },
    { path: 'rejects.sql', content: REJECTS },
    { path: 'report.sql', content: REPORT },
    { path: 'customers.sql', content: CUSTOMERS }
  ]
}
