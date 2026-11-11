import { describe, expect, it, vi } from 'vitest'

// The real Rust lab (native/tide-core/tide-core.node), as in lab.test.ts
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { labQuery } from '../src/main/lab'
import { holdAsks, settleSqlProblem, sqlExact } from '../src/main/sqlCheck'
import { compareResults, needsOrder, sqlIn, sqlProblem, unanswerable } from '../src/shared/sqlCheck'
import { exactNote, overruled } from '../src/shared/answerCheck'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

// Seen live in the rehearsal: category and amount are never on the same events row, so the only group is NULL
const ILL_POSED = `To practise this we will use the \`events\` table.

<ask type="code" lang="sql">
Write a query that returns the \`category\` and the total \`amount\` for each category in the \`events\` table, but only for categories where the total amount is greater than 1000.
</ask>

<solution>SELECT category, SUM(amount)
FROM events
GROUP BY category
HAVING SUM(amount) > 1000;</solution>`

const GOOD = `**Problem 1**

<ask type="code" lang="sql">Write a query that returns each customer country and how many customers it has.</ask>

<solution>1. Group customers by country.
2. The final query is: \`SELECT country, COUNT(*) AS n FROM customers GROUP BY country\`</solution>`

const req = (prev: string, answer: string): ChatRequest =>
  ({ id: 't', scope: { kind: 'none' }, session: true, topic: 'GROUP BY and HAVING in SQL', labId: 'sqlcheck-test', messages: [{ role: 'user', content: 'start' }, { role: 'assistant', content: prev }, { role: 'user', content: answer }] }) as unknown as ChatRequest

describe('a SQL problem the lab’s data cannot answer', () => {
  it('finds the reference query in a solution, written as a block, in backticks or bare', () => {
    expect(sqlIn('SELECT a FROM t;')).toBe('SELECT a FROM t')
    expect(sqlIn('Steps.\n5. The final query is: `SELECT category, SUM(amount) FROM events GROUP BY category;`')).toBe('SELECT category, SUM(amount) FROM events GROUP BY category;')
    expect(sqlIn('```sql\nSELECT 1\n```')).toBe('SELECT 1')
    expect(sqlIn('No query here.')).toBeNull()
    expect(sqlIn('```sql\nDROP TABLE orders\n```')).toBeNull()
  })

  it('is caught: a column NULL in every row, no rows, only NULLs or an error', () => {
    const p = sqlProblem(ILL_POSED, ILL_POSED.split('<solution>')[1].split('</solution>')[0])!
    expect(p.sql).toMatch(/^SELECT category/)
    expect(unanswerable(labQuery('sqlcheck-test', p.sql!))).toMatch(/"category" column is NULL in every row/)
    expect(unanswerable(labQuery('sqlcheck-test', "SELECT * FROM customers WHERE country = 'Atlantis'"))).toMatch(/no rows/)
    expect(unanswerable(labQuery('sqlcheck-test', 'SELECT NULL, NULL'))).toMatch(/only NULLs/)
    expect(unanswerable(labQuery('sqlcheck-test', 'SELECT category FROM orders'))).toMatch(/fails.*no such column/)
    expect(unanswerable(labQuery('sqlcheck-test', 'SELECT country, COUNT(*) FROM customers GROUP BY country'))).toBeNull()
  })

  const io = (over: Partial<Parameters<typeof settleSqlProblem>[2]> = {}) => ({
    lab: 'sqlcheck-test',
    signal: new AbortController().signal,
    ask: async () => '',
    rewrite: async () => '',
    banked: async () => [],
    step: () => {},
    ...over
  })

  it('is replaced before it is shown: by the tutor’s new problem when that one checks out', async () => {
    const r = await settleSqlProblem(ILL_POSED, ILL_POSED.slice(ILL_POSED.indexOf('<ask')), io({ rewrite: async () => GOOD }))
    expect(r.replaced).toMatch(/NULL in every row/)
    expect(r.text).toContain('each customer country')
    expect(r.text).not.toContain('greater than 1000')
  })

  it('falls back to the bank, then to holding it back with a note, never showing it', async () => {
    const bad = await settleSqlProblem(ILL_POSED, ILL_POSED.slice(ILL_POSED.indexOf('<ask')), io({ rewrite: async () => ILL_POSED, banked: async () => [ILL_POSED, GOOD] }))
    expect(bad.text).toContain('each customer country')
    const retired: string[] = []
    const none = await settleSqlProblem(ILL_POSED, ILL_POSED.slice(ILL_POSED.indexOf('<ask')), io({ retire: (q) => retired.push(q) }))
    // Never brought back by recall either
    expect(retired[0]).toMatch(/^Write a query that returns the `category`/)
    expect(none.text).not.toContain('<ask')
    expect(none.text).toMatch(/held back/)
    expect(none.text).toContain('<continue/>')
  })

  it('keeps a good problem as written, and adds a reference query when the tutor wrote none', async () => {
    const good = await settleSqlProblem(GOOD, GOOD, io())
    expect(good).toEqual({ text: GOOD })
    const unsolved = '<ask type="code" lang="sql">Write a query listing each product category and its number of products.</ask>'
    const r = await settleSqlProblem(unsolved, unsolved, io({ ask: async () => '```sql\nSELECT category, COUNT(*) FROM products GROUP BY category\n```' }))
    expect(r.text).toContain('<solution>')
    expect(r.text).toContain('SELECT category, COUNT(*) FROM products')
  })

  it('holds the question back while the reply streams, with the paragraph that states it, split anywhere', () => {
    const seen: string[] = []
    const g = holdAsks((e: ChatEvent) => e.type === 'delta' && seen.push(e.text))
    const pieces = ['Here is the idea.\n\nWrite a query that ret', 'urns each country.\n\n**Pro', 'blem 1**\n\n<as', 'k type="code" lang="sql">Write…</ask>']
    for (const piece of pieces) g.tap({ id: 't', type: 'delta', text: piece })
    const r = g.finish()
    expect(seen.join('')).toBe('Here is the idea.\n\n')
    expect(r.held.startsWith('Write a query that returns each country.')).toBe(true)
    expect(r.sent + r.held).toBe(pieces.join(''))
    const plain: string[] = []
    const g2 = holdAsks((e: ChatEvent) => e.type === 'delta' && plain.push(e.text))
    g2.tap({ id: 't', type: 'delta', text: 'One.\n\nTwo, still coming' })
    expect(g2.finish()).toEqual({ sent: 'One.\n\n', held: 'Two, still coming' })
  })
})

describe('a SQL answer, marked by running it beside the reference', () => {
  it('compares rows in any order, numbers to 6 significant figures, and column names never matter', () => {
    const want = labQuery('sqlcheck-test', 'SELECT country, COUNT(*) FROM customers GROUP BY country')
    expect(compareResults(labQuery('sqlcheck-test', 'SELECT country AS c, COUNT(customer_id) AS n FROM customers GROUP BY 1 ORDER BY 2 DESC'), want, false).match).toBe(true)
    expect(compareResults(labQuery('sqlcheck-test', "SELECT country, COUNT(*) FROM customers WHERE country <> 'France' GROUP BY country"), want, false).match).toBe(false)
    const avg = labQuery('sqlcheck-test', 'SELECT AVG(unit_price) FROM order_items')
    expect(compareResults(labQuery('sqlcheck-test', 'SELECT SUM(unit_price) * 1.0 / COUNT(*) FROM order_items'), avg, false).match).toBe(true)
  })

  it('needs the order only when the question asks for one', () => {
    expect(needsOrder('List the top 3 countries by customers', 'SELECT … ORDER BY n DESC LIMIT 3')).toBe(true)
    expect(needsOrder('Count customers per country', 'SELECT … ORDER BY country')).toBe(false)
    const ordered = labQuery('sqlcheck-test', 'SELECT country, COUNT(*) n FROM customers GROUP BY country ORDER BY n DESC, country')
    const reversed = labQuery('sqlcheck-test', 'SELECT country, COUNT(*) n FROM customers GROUP BY country ORDER BY n ASC, country DESC')
    expect(compareResults(reversed, ordered, true)).toMatchObject({ match: false, why: expect.stringMatching(/order/) })
    expect(compareResults(reversed, ordered, false).match).toBe(true)
  })

  it('overrules a NULL result marked correct, as the exact maths check does', () => {
    const asked = GOOD
    const wrong = sqlExact(req(asked, "Answer: ```sql\nSELECT country, COUNT(*) FROM customers WHERE country LIKE 'U%' GROUP BY country\n```\n\nWhen I ran it:\n```\n…\n```"))!
    expect(wrong).toMatchObject({ kind: 'sql', result: 'mismatch' })
    expect(exactNote(wrong)).toMatch(/can't be marked correct/)
    expect(overruled(wrong, 'correct', 'Well done')).toMatchObject({ verdict: 'wrong' })
    const right = sqlExact(req(asked, 'Answer: ```sql\nSELECT country, count(customer_id) FROM customers GROUP BY 1\n```'))!
    expect(right).toMatchObject({ kind: 'sql', result: 'match' })
    expect(overruled(right, 'wrong', 'You should have used COUNT(*)')).toMatchObject({ verdict: 'partial' })
    expect(overruled(right, 'correct', '')).toBeUndefined()
    // The rehearsal's problem: its reference is unanswerable, so it is never compared against
    expect(sqlExact(req(ILL_POSED, 'Answer: ```sql\nSELECT category, SUM(amount) AS total FROM events GROUP BY category HAVING SUM(amount) > 1000;\n```'))).toBeNull()
  })
})

describe('the lab in a SQL lesson', () => {
  it('tells the tutor the lab and the learner’s files are there, through its tools', async () => {
    const { labSchemaNote, loadHint } = await import('../src/main/lab')
    const note = labSchemaNote('sqlcheck-note', false, ['Data/orders.csv'])
    expect(note).toMatch(/run_sql/)
    expect(note).toMatch(/load_table/)
    expect(note).toMatch(/Never say you can't see their data or files/)
    expect(note).toContain('Data/orders.csv')
    expect(note).toMatch(/Before you set a SQL problem, run its reference query/)
    expect(loadHint('load my orders.csv', ['Data/orders.csv'])).toMatch(/load_table now with path "Data\/orders.csv"/)
    expect(loadHint('load sales.csv please', ['Data/orders.csv'])).toMatch(/isn't in their notes folder/)
    expect(loadHint('what is a GROUP BY?', ['Data/orders.csv'])).toBe('')
  })
})

describe('a lesson’s tools', () => {
  it('include run_sql and load_table, with web on or off', async () => {
    vi.doMock('../src/main/settings', () => ({ getSettings: () => ({ ai: { webSearch: { provider: 'off' } } }) }))
    const { toolSet } = await import('../src/main/agent')
    for (const web of [false, true]) {
      const names = (toolSet({ top: false, web, focused: true, things: false }) as { function: { name: string } }[]).map((t) => t.function.name)
      expect(names).toContain('run_sql')
      expect(names).toContain('load_table')
    }
  })
})

describe('the tutor’s run_sql calls', () => {
  it('read the query even when Gemma sticks a special token to the key', async () => {
    const { toolArgs } = await import('../src/shared/modelText')
    expect(toolArgs('{"sql<|channel>": "SELECT 1"}')).toEqual({ sql: 'SELECT 1' })
    expect(toolArgs('{"code": "print(1)", "language": "python"}')).toEqual({ code: 'print(1)', language: 'python' })
    expect(toolArgs('')).toEqual({})
    expect(() => toolArgs('{oops')).toThrow()
  })

  it('come first in a SQL lesson’s turn, except for a question in passing, a hint or the end', async () => {
    const { looksAtLabFirst } = await import('../src/shared/sqlCheck')
    expect(looksAtLabFirst('I want to learn GROUP BY and HAVING in SQL deeply.')).toBe(true)
    expect(looksAtLabFirst('Answer: ```sql\nSELECT 1\n```')).toBe(true)
    expect(looksAtLabFirst('My question: what is HAVING?')).toBe(false)
    expect(looksAtLabFirst('[hint] (a nudge please)')).toBe(false)
    expect(looksAtLabFirst("Let's stop here for today.")).toBe(false)
  })
})
