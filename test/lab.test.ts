import { describe, expect, it, vi } from 'vitest'

// The real Rust module (native/tide-core/tide-core.node), found beside the source as in development
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { labCount, labQuery, labReset, labSchema, runSqlTool as runSql, sweepLabs } from '../src/main/lab'
import { parseChartRequest, resultSummary, resultText, schemaText } from '../src/shared/lab'

// On a turn that isn't about a private project
const runSqlTool = (id: string, sql: string) => runSql(id, sql, false)

describe('the data lab in the main process', () => {
  it('seeds both datasets on first use and answers a query with columns, types and rows', () => {
    const r = labQuery('chat-a', 'SELECT country, count(*) AS customers FROM customers GROUP BY 1 ORDER BY 2 DESC, 1')
    expect(r.error ?? null).toBeNull()
    expect(r.columns).toEqual(['country', 'customers'])
    expect(r.types).toEqual(['text', 'integer'])
    expect(r.rowCount).toBe(10)
    expect(r.rows[0][0]).toBe('United Kingdom')
    expect(r.rows.reduce((n, row) => n + (row[1] as number), 0)).toBe(300)
    expect(r.truncated).toBe(false)
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(labSchema('chat-a').map((t) => t.name)).toEqual(['customers', 'products', 'orders', 'order_items', 'users', 'events'])
    expect(labQuery('chat-a', "SELECT count(*) FROM events WHERE event = 'purchase'").rows[0][0]).toBeGreaterThan(200)
  })

  it('gives the same data to every lab, and keeps each lab’s changes to itself', () => {
    const total = 'SELECT round(sum(quantity * unit_price), 2) FROM order_items'
    expect(labQuery('chat-a', total).rows).toEqual(labQuery('chat-b', total).rows)
    const made = labQuery('chat-a', 'CREATE TABLE mine (n INTEGER); INSERT INTO mine VALUES (1), (2); SELECT count(*) AS n FROM mine')
    expect(made.rows).toEqual([[2]])
    expect(labQuery('chat-b', 'SELECT * FROM mine').error).toBe('no such table: mine')
    expect(labQuery('chat-a', 'DELETE FROM mine').changes).toBe(2)
  })

  it('returns a mistake as SQLite’s own words, and refuses what could reach outside the lab', () => {
    expect(labQuery('chat-a', 'SELECT nme FROM customers').error).toBe('no such column: nme')
    expect(labQuery('chat-a', '   ').error).toBe('There is no query to run.')
    expect(labQuery('chat-a', "ATTACH DATABASE '/tmp/tide-lab-test.db' AS other").error).toBeTruthy()
    expect(labQuery('chat-a', 'PRAGMA journal_mode = WAL').error).toMatch(/not authorized/)
  })

  it('caps what the renderer is sent and says how much there was', () => {
    const r = labQuery('chat-a', 'SELECT * FROM events')
    expect(r.rows.length).toBe(1000)
    expect(r.rowCount).toBeGreaterThan(27_000)
    expect(r.truncated).toBe(true)
  })

  it('puts the sample data back on reset', () => {
    labQuery('chat-c', 'DELETE FROM order_items; DROP TABLE events; CREATE TABLE scratch (a)')
    expect(labQuery('chat-c', 'SELECT count(*) FROM order_items').rows).toEqual([[0]])
    labReset('chat-c')
    expect(labQuery('chat-c', 'SELECT count(*) FROM order_items').rows[0][0]).toBeGreaterThan(5000)
    expect(labSchema('chat-c').map((t) => t.name)).toEqual(['customers', 'products', 'orders', 'order_items', 'users', 'events'])
  })

  it('drops a lab nobody has used for an hour', () => {
    labQuery('chat-old', 'SELECT 1')
    expect(labCount()).toBeGreaterThanOrEqual(1)
    sweepLabs(Date.now() + 59 * 60_000)
    expect(labCount()).toBeGreaterThanOrEqual(1)
    sweepLabs(Date.now() + 61 * 60_000)
    expect(labCount()).toBe(0)
    // Used again, it starts fresh
    expect(labQuery('chat-a', 'SELECT * FROM mine').error).toBe('no such table: mine')
  })
})

describe('the run_sql tool', () => {
  it('returns a compact table with the count and the time, and the schema on first use only', () => {
    const first = runSqlTool('tool-1', 'SELECT category, count(*) AS products, round(avg(price), 2) AS avg_price FROM products GROUP BY 1 ORDER BY 1')
    const lines = first.text.split('\n')
    expect(lines[0]).toBe('category | products | avg_price')
    expect(lines[1]).toMatch(/^Audio \| 8 \| \d+(\.\d+)?$/)
    expect(lines[6]).toMatch(/^5 rows · (under )?[\d.]+ ms$/)
    expect(first.ok).toBe(true)
    expect(first.detail).toBe('5 rows')
    // One paragraph on what the tables are
    const schema = first.text.split('\n\n')[1]
    expect(schema).toContain('customers (300 rows): customer_id integer key, name, email, country, segment, signup_date date')
    expect(schema).toContain('customer_id integer → customers.customer_id')
    expect(schema).toContain('signup, view_item, add_to_cart, checkout_started or purchase')
    expect(schema).not.toContain('\n')
    const second = runSqlTool('tool-1', 'SELECT 1 AS one')
    expect(second.text).toMatch(/^one\n1\n1 row · /)
    expect(second.text).not.toContain('The lab’s tables')
    expect(second.text).not.toContain('customers (')
  })

  it('shows at most 30 rows and clips wide cells', () => {
    const r = runSqlTool('tool-2', "SELECT order_id, printf('%.*c', 500, 'x') AS wide, NULL AS gap FROM orders ORDER BY order_id").text.split('\n\n')[0].split('\n')
    expect(r.length).toBe(32)
    expect(r[1]).toBe(`1 | ${'x'.repeat(39)}… | NULL`)
    expect(r[31]).toMatch(/^2,\d{3} rows · .* ms \(the first 30 shown\)$/)
  })

  it('returns an error as text, and a write as a count', () => {
    const bad = runSqlTool('tool-3', 'SELECT * FROM order')
    expect(bad.ok).toBe(false)
    expect(bad.text.split('\n')[0]).toMatch(/^Error: near "order": syntax error/)
    expect(runSqlTool('tool-3', "UPDATE products SET price = price + 1 WHERE category = 'Audio'").text).toMatch(/^8 rows changed · /)
    expect(runSqlTool('tool-3', 'CREATE TABLE t (a)').text).toMatch(/^Done · /)
  })
})

describe('lab text helpers', () => {
  it('summarises a result', () => {
    const base = { columns: ['a'], types: ['integer'], rows: [[1]], truncated: false, elapsedMs: 1.234 }
    expect(resultSummary({ ...base, rowCount: 1 })).toBe('1 row · 1.2 ms')
    expect(resultSummary({ ...base, rowCount: 2495, elapsedMs: 31.6 })).toBe('2,495 rows · 32 ms')
    expect(resultSummary({ ...base, columns: [], rowCount: 0, changes: 3, elapsedMs: 0.01 })).toBe('3 rows changed · under 0.1 ms')
    expect(resultText({ ...base, rowCount: 0, error: 'no such table: x' })).toBe('Error: no such table: x')
    expect(schemaText([])).toBe('The lab is empty: no tables yet.')
  })

  it('reads a chart block, and says what is wrong with one it can’t use', () => {
    expect(parseChartRequest('{"sql": "SELECT 1", "type": "line", "x": "month", "y": ["a", "b"], "title": "T"}')).toEqual({ sql: 'SELECT 1', type: 'line', x: 'month', y: ['a', 'b'], title: 'T' })
    expect(parseChartRequest('{"sql": "SELECT 1", "type": "pie", "y": "a"}')).toEqual({ sql: 'SELECT 1', type: undefined, x: undefined, y: ['a'], title: undefined })
    expect(parseChartRequest('{"sql": ')).toMatchObject({ error: expect.stringContaining('isn\'t valid JSON') })
    expect(parseChartRequest('{"type": "bar"}')).toMatchObject({ error: expect.stringContaining('"sql"') })
    expect(parseChartRequest('[1]')).toHaveProperty('error')
  })
})
