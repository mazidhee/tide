// Runs the harness's queries on the real lab (native/tide-core) and writes what came back to
// fixtures.json, so the harness page shows real results without Electron.
//   node design/prototype/lab/fixtures.mjs
import { createRequire } from 'module'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const { Lab } = createRequire(import.meta.url)(join(here, '../../../native/tide-core/tide-core.node'))
const lab = new Lab()
lab.seed('shop')
lab.seed('events')

const sql = (s) => s.trim().replace(/\n {4}/g, '\n')
const chart = (o) => JSON.stringify(o, null, 2)

// Each block: the fenced language and body as the tutor would write it; `then` is what the harness clicks after it has run
export const blocks = [
  { set: 'table', name: 'A joined result, 2,495 rows', lang: 'sql', body: sql(`
    SELECT o.order_id, c.name AS customer, c.country, o.order_date, o.status,
           round(sum(i.quantity * i.unit_price), 2) AS total
    FROM orders o
    JOIN customers c USING (customer_id)
    JOIN order_items i USING (order_id)
    GROUP BY o.order_id
    ORDER BY o.order_date DESC, total DESC`) },
  { set: 'table', name: 'Nulls and a wide text column', lang: 'sql', body: sql(`
    SELECT event_id, user_id, event, ts, item_id, category, amount
    FROM events
    WHERE user_id = 12
    LIMIT 9`) },
  { set: 'table', name: 'A mistake', lang: 'sql', body: 'SELECT nme, country\nFROM customers\nWHERE segment = \'enterprise\'' },
  { set: 'table', name: 'A write', lang: 'sql', body: "UPDATE orders SET status = 'completed' WHERE status = 'processing'" },
  { set: 'table', name: 'One number', lang: 'sql', then: ['Chart'], body: sql(`
    SELECT round(sum(quantity * unit_price), 2) AS revenue
    FROM order_items`) },

  { set: 'bars', name: 'Few categories, one measure: horizontal bars', lang: 'chart', body: chart({ title: 'Revenue by category', sql: 'SELECT p.category, round(sum(i.quantity * i.unit_price)) AS revenue FROM order_items i JOIN products p USING (product_id) GROUP BY 1 ORDER BY 2 DESC' }) },
  { set: 'bars', name: 'One row of numbers: a funnel', lang: 'chart', body: chart({ title: 'Users reaching each step', sql: "SELECT count(DISTINCT CASE WHEN event = 'signup' THEN user_id END) AS signed_up, count(DISTINCT CASE WHEN event = 'view_item' THEN user_id END) AS viewed, count(DISTINCT CASE WHEN event = 'add_to_cart' THEN user_id END) AS added_to_cart, count(DISTINCT CASE WHEN event = 'checkout_started' THEN user_id END) AS started_checkout, count(DISTINCT CASE WHEN event = 'purchase' THEN user_id END) AS purchased FROM events" }) },
  { set: 'bars', name: 'Columns: 18 months, asked for as bars', lang: 'chart', body: chart({ title: 'Orders per month', type: 'bar', sql: "SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders FROM orders GROUP BY 1 ORDER BY 1" }) },
  { set: 'bars', name: 'Grouped columns: two measures', lang: 'chart', body: chart({ title: 'Customers and orders by country', type: 'bar', sql: 'SELECT c.country, count(DISTINCT c.customer_id) AS customers, count(DISTINCT o.order_id) / 10 AS orders_in_tens FROM customers c LEFT JOIN orders o USING (customer_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 8' }) },
  { set: 'bars', name: 'Thirty of forty products', lang: 'sql', then: ['Chart'], body: sql(`
    SELECT p.name, sum(i.quantity) AS units
    FROM order_items i JOIN products p USING (product_id)
    GROUP BY 1 ORDER BY 2 DESC`) },

  { set: 'lines', name: 'A date and a measure: a line', lang: 'chart', body: chart({ title: 'Revenue per week', sql: "SELECT date(o.order_date, 'weekday 0', '-6 days') AS week, round(sum(i.quantity * i.unit_price)) AS revenue FROM orders o JOIN order_items i USING (order_id) GROUP BY 1 ORDER BY 1" }) },
  { set: 'lines', name: 'Long form: one series per platform', lang: 'chart', body: chart({ title: 'Purchases per month by platform', sql: "SELECT strftime('%Y-%m', ts) AS month, platform, count(*) AS purchases FROM events WHERE event = 'purchase' GROUP BY 1, 2 ORDER BY 1, 2" }) },
  { set: 'lines', name: 'A run of whole numbers: weekly retention', lang: 'chart', body: chart({ title: 'Share of users active, by week since signup', sql: "WITH active AS (SELECT DISTINCT e.user_id, CAST((julianday(date(e.ts)) - julianday(u.signup_date)) / 7 AS INTEGER) AS week FROM events e JOIN users u USING (user_id)), sized AS (SELECT w.week, (SELECT count(*) FROM users WHERE julianday('2025-07-14') - julianday(signup_date) >= (w.week + 1) * 7) AS cohort FROM (SELECT DISTINCT week FROM active) w) SELECT a.week, round(100.0 * count(*) / s.cohort, 1) AS percent_active FROM active a JOIN sized s USING (week) JOIN users u USING (user_id) WHERE julianday('2025-07-14') - julianday(u.signup_date) >= (a.week + 1) * 7 AND a.week <= 12 GROUP BY a.week ORDER BY a.week" }) },
  { set: 'lines', name: 'Two numeric columns: a scatter', lang: 'chart', body: chart({ title: 'Price against units sold', sql: 'SELECT p.name, p.price, sum(i.quantity) AS units FROM order_items i JOIN products p USING (product_id) GROUP BY p.product_id' }) },

  { set: 'edge', name: 'A chart block that is not JSON', lang: 'chart', body: '{ "sql": "SELECT country, count(*) FROM customers GROUP BY 1", title: Customers }' },
  { set: 'edge', name: 'A chart block whose query fails', lang: 'chart', body: chart({ title: 'Signups per week', sql: "SELECT strftime('%Y-%W', signup_date) AS week, count(*) AS signups FROM user GROUP BY 1" }) },
  { set: 'edge', name: 'Nothing to draw', lang: 'sql', then: ['Chart'], body: 'SELECT name, country, segment FROM customers LIMIT 4' },
  { set: 'edge', name: 'The line of the months, switched to a table', lang: 'chart', then: ['Table'], body: chart({ title: 'Orders per month', sql: "SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders, count(DISTINCT customer_id) AS customers FROM orders GROUP BY 1 ORDER BY 1" }) }
]

const results = {}
for (const b of blocks) {
  let q = b.body
  if (b.lang === 'chart') {
    try {
      q = JSON.parse(b.body).sql
    } catch {
      continue
    }
  }
  results[q.trim()] = lab.query(q, 1000)
}
writeFileSync(join(here, 'fixtures.json'), JSON.stringify({ blocks, results }))
console.log(`${blocks.length} blocks, ${Object.keys(results).length} results`)
