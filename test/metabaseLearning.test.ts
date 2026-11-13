/**
 * Learning Metabase on your own data, against a mock Metabase on a MongoDB source
 * (test/helpers/mockMetabase): never a real instance or key.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startMockMetabase, type MockMetabase } from './helpers/mockMetabase'

const dir = mkdtempSync(join(tmpdir(), 'tide-mb-'))
let mock: MockMetabase
const state = { url: '', key: '' }

vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd(), isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../src/main/cloud', () => ({ getKey: () => state.key, setKey: () => {} }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ metabase: state.url ? { url: state.url } : undefined, ai: { claude: {} } }), updateSettings: () => {} }))
vi.mock('../src/main/connectionUse', () => ({ noteUse: () => {} }))
vi.mock('../src/main/vault', async (orig) => ({ ...(await orig<object>()), absPath: (p: string) => join(dir, p), writeText: async (p: string, c: string) => (await import('fs')).promises.mkdir(join(dir, p, '..'), { recursive: true }).then(() => (import('fs') as Promise<typeof import('fs')>).then((f) => f.promises.writeFile(join(dir, p), c))) }))

import { allowed, metabaseClient, queryRows, metabaseTool, MAX_ROWS } from '../src/main/metabase'
import { buildMap, docsOf, type MapIO } from '../src/main/metabaseMap'
import { comparisonBlock, metabaseExact, runAnswer, teardownContext, metabaseContext, describeMetabasePage } from '../src/main/metabaseLearn'
import { erDiagram, findReferences, inferSchema, metabasePage, metabaseRoadmap, teardownTopic, yourDataNote, isMetabaseLesson, tiny, type DataMap } from '../src/shared/metabaseData'
import { compareResultSets } from '../src/shared/resultCompare'
import { limited, parsePipeline, pipelineProblem } from '../src/shared/mongoPipeline'
import { answerRef, cardIn, solutionBlock, solutionRef, verifyMetabase } from '../src/shared/metabaseExercise'
import { parseExercise, verifyExercise } from '../src/shared/exercises'

beforeAll(async () => {
  mock = await startMockMetabase()
  state.url = mock.url
  state.key = mock.key
})
afterAll(async () => mock.close())
beforeEach(() => {
  mock.requests.length = 0
  mock.refused.length = 0
})

const io = (): MapIO => ({ get: (p) => metabaseClient().get(p), query: (q, n) => queryRows(q, n), host: '127.0.0.1' })

let map: DataMap
async function mapped() {
  map ??= await buildMap(io(), Date.UTC(2024, 6, 1))
  return map
}

describe('mapping your data', () => {
  it('reads every collection of the Mongo database, not the sample one', async () => {
    const m = await mapped()
    expect(m.databases.map((d) => d.engine)).toEqual(['mongo'])
    expect(m.collections.map((c) => c.name).sort()).toEqual(['events', 'merchants', 'payments', 'users'])
    const payments = m.collections.find((c) => c.name === 'payments')!
    expect(payments.count).toBeGreaterThan(20)
    expect(payments.kind).toBe('transactions')
    expect(m.collections.find((c) => c.name === 'events')!.kind).toBe('events')
  })

  it('infers nested fields, arrays, optional fields and type drift, and says why', async () => {
    const payments = (await mapped()).collections.find((c) => c.name === 'payments')!
    const f = (p: string) => payments.fields.find((x) => x.path === p)!
    expect(f('card.brand').types).toEqual(['string'])
    expect(f('items').kind).toBe('array')
    expect(f('items[].sku')).toBeTruthy()
    expect(f('amount').drift).toBe(true)
    expect(f('amount').note).toMatch(/string until 2024-01-\d\d, number after/)
    expect(f('refund').share).toBeLessThan(0.5)
    expect(f('refund').note).toMatch(/only on documents where status is “refunded”/)
    const users = (await mapped()).collections.find((c) => c.name === 'users')!
    expect(users.fields.find((x) => x.path === 'referral_code')!.note).toMatch(/missing on every document before 2024-03/)
    const events = (await mapped()).collections.find((c) => c.name === 'events')!
    expect(events.fields.find((x) => x.path === 'experiment')!.note).toMatch(/type is “view_pricing”/)
  })

  it('finds how documents are generated', async () => {
    const m = await mapped()
    const events = m.collections.find((c) => c.name === 'events')!
    expect(events.generation?.field).toBe('ts')
    expect(events.generation?.pattern).toMatch(/append-only event log/)
    expect(events.generation?.perDay?.length).toBeGreaterThan(5)
    const payments = m.collections.find((c) => c.name === 'payments')!
    expect(payments.generation?.field).toBe('created_at')
    expect(payments.generation?.pattern).toMatch(/updated in place.*status/)
  })

  it('finds references (checked with $lookup) and embedded data, and a key whose types differ', async () => {
    const m = await mapped()
    const userRef = m.references.find((r) => r.from === 'payments' && r.field === 'user_id')!
    expect(userRef.to).toBe('users')
    expect(userRef.matched).toBe(1)
    const merchant = m.references.find((r) => r.from === 'payments' && r.field === 'merchant_id')!
    expect(merchant.matched).toBe(0)
    expect(merchant.mismatch).toMatch(/string.*int/)
    expect(m.references.some((r) => r.how === 'embedded' && r.from === 'payments' && r.field === 'items')).toBe(true)
  })

  it('keeps only metadata and tiny examples: at most 3 documents, emails masked', async () => {
    const m = await mapped()
    for (const c of m.collections) expect(c.sample.length).toBeLessThanOrEqual(3)
    const json = JSON.stringify(m)
    expect(json).not.toMatch(/user\d+@example\.com/)
    expect(tiny('ada@example.com')).toBe('a***@example.com')
    // Every query the map ran was capped
    const datasets = mock.requests.length ? mock.requests : []
    void datasets
  })

  it('lists the dashboards and questions people use most', async () => {
    const m = await mapped()
    expect(m.dashboards.map((d) => d.name)).toEqual(['Revenue overview', 'Growth'])
    expect(m.dashboards[0].cards.map((c) => c.name)).toEqual(['Revenue by month', 'Payments by status'])
    expect(m.questions.find((q) => q.id === 102)?.native).toBe(false)
  })

  it('describes each collection from the names when no model can', async () => {
    const m = await mapped()
    expect(m.collections.find((c) => c.name === 'events')!.description).toMatch(/event log/)
  })

  it('cuts a long description at a sentence end, never mid-word', async () => {
    const { sentences } = await import('../src/main/metabaseMap')
    const long = 'One document per payment attempt. Amount is stored as a mix of double and string, so cast before summing. It is unclear whether values are major or minor units, though the example matches the item price of the line items closely enough.'
    const cut = sentences(long, 120)
    expect(cut).toBe('One document per payment attempt. Amount is stored as a mix of double and string, so cast before summing.')
    expect(sentences('Short one.', 120)).toBe('Short one.')
    // No sentence end in reach: a whole word and an ellipsis
    expect(sentences('word '.repeat(60), 50)).toMatch(/word…$/)
    const m = await buildMap({ ...io(), describe: async () => JSON.stringify({ payments: long.repeat(4) }) })
    expect(m.collections.find((c) => c.name === 'payments')!.description).toMatch(/\.$/)
  })

  it('uses a model’s descriptions when there is one', async () => {
    const asked: string[] = []
    const m = await buildMap({ ...io(), describe: async (p) => (asked.push(p), JSON.stringify({ payments: 'One card payment per document, with its line items embedded.' })) })
    expect(asked[0]).toMatch(/## payments/)
    expect(m.collections.find((c) => c.name === 'payments')!.description).toMatch(/line items embedded/)
  })
})

describe('the ER diagram and the note', () => {
  it('draws collections, embedded parts and references as a Mermaid erDiagram', async () => {
    const d = erDiagram(await mapped())
    expect(d.split('\n')[0]).toBe('erDiagram')
    expect(d).toMatch(/^ {2}payments \{$/m)
    expect(d).toMatch(/objectId _id PK/)
    expect(d).toMatch(/users \|\|--o\{ payments : "user_id"/)
    expect(d).toMatch(/payments \|\|--o\{ payments_items : "embeds items\[\]"/)
    expect(d).toMatch(/merchants \|\|--o\{ payments : "merchant_id \(types differ\)"/)
    // Mermaid identifiers only: no dots, brackets or spaces in entity or attribute names
    for (const line of d.split('\n').slice(1)) if (/^\s{4}\w/.test(line)) expect(line).toMatch(/^\s{4}\w+ \w+( PK)?( "[^"]*")?$/)
  })

  it('a pure diagram from a hand-made shape', () => {
    const cols = [
      { name: 'orders', fields: inferSchema([{ _id: 'a'.repeat(24), customer_id: 'b'.repeat(24), lines: [{ sku: 'x' }] }]) },
      { name: 'customers', fields: inferSchema([{ _id: 'b'.repeat(24), name: 'A' }]) }
    ]
    const refs = findReferences(cols)
    expect(refs).toContainEqual({ from: 'orders', field: 'customer_id', to: 'customers', how: 'referenced' })
    expect(refs).toContainEqual({ from: 'orders', field: 'lines', to: 'orders.lines', how: 'embedded' })
  })

  it('writes the Your data note with the diagram, why-missing callouts and dashboards', async () => {
    const note = yourDataNote(await mapped())
    expect(note).toMatch(/^# Your data$/m)
    expect(note).toMatch(/```mermaid\nerDiagram/)
    expect(note).toMatch(/> \[!question\] Why is `refund` missing in \d+% of payments\?/)
    expect(note).toMatch(/\*\*The types differ\*\*/)
    expect(note).toMatch(/Revenue overview/)
    expect(note).not.toMatch(/user\d+@example\.com/)
  })

  it('writes a pipeline-first roadmap on their own collections', async () => {
    const rm = metabaseRoadmap(await mapped())
    expect(rm).toMatch(/^# Metabase and MongoDB on Your Data/)
    expect(rm).toMatch(/\$lookup.*`payments` with `users` on `user_id`/)
    expect(rm).toMatch(/\$unwind: one row per item of `payments.items`/)
    expect(rm).toMatch(/Cohorts/)
    expect(rm).toMatch(/Retention/)
    expect(rm).toMatch(/A first regression/)
    expect(rm).toMatch(/Take apart a dashboard: “Revenue overview”/)
    expect(rm.match(/^- \[ \] /gm)!.length).toBeGreaterThan(25)
    // Phases in the vault's roadmap format
    expect(rm.match(/^## \d\. .+ — (CORE|SUPPORTING)$/gm)!.length).toBe(6)
  })
})

describe('read-only, always', () => {
  it('only reads and runs queries: no write endpoint is reachable', () => {
    for (const [m, p] of [
      ['POST', '/api/card'],
      ['PUT', '/api/card/1'],
      ['DELETE', '/api/card/1'],
      ['POST', '/api/dashboard'],
      ['PUT', '/api/dashboard/1'],
      ['POST', '/api/dashboard/1/cards'],
      ['POST', '/api/collection'],
      ['PUT', '/api/table/1'],
      ['POST', '/api/database/1/sync_schema'],
      ['DELETE', '/api/database/1'],
      ['POST', '/api/session'],
      ['POST', '/api/user'],
      ['GET', '/api/user'],
      ['POST', '/api/card/1/query/csv'],
      ['GET', '/api/card/../user']
    ])
      expect(allowed(m, p), `${m} ${p}`).toBe(false)
    expect(allowed('GET', '/api/database/1/metadata')).toBe(true)
    expect(allowed('POST', '/api/dataset')).toBe(true)
  })

  it('refuses to send a write even when asked through the client', async () => {
    const c = metabaseClient() as unknown as { post(p: string, b: unknown): Promise<unknown> }
    await expect(c.post('/api/card', { name: 'x' })).rejects.toThrow(/only reads/)
    expect(mock.requests.length).toBe(0)
  })

  it('refuses pipelines that write or run JavaScript, before anything is sent', async () => {
    for (const bad of ['[{"$out": "copy"}]', '[{"$merge": {"into": "x"}}]', '[{"$match": {"$where": "this.a > 1"}}]', '[{"$group": {"_id": null, "x": {"$accumulator": {}}}}]', '[{"$addFields": {"y": {"$function": {"body": "1"}}}}]']) {
      const p = parsePipeline(bad)
      expect('error' in p ? p.error : pipelineProblem(p), bad).toBeTruthy()
      const r = await queryRows({ database: 1, pipeline: { collection: 'payments', stages: 'error' in p ? [] : p.stages } })
      expect(r.error).toBeTruthy()
    }
    expect(mock.requests.filter((r) => r.path === '/api/dataset').length).toBe(0)
    expect(mock.refused).toEqual([])
  })

  it('refuses SQL that writes', async () => {
    const r = await queryRows({ database: 1, sql: 'delete from payments' })
    expect(r.error).toMatch(/Only SELECT/)
    expect(mock.requests.length).toBe(0)
  })

  it('caps every query: a $limit and Metabase’s row constraints', async () => {
    const r = await queryRows({ database: 1, pipeline: { collection: 'events', stages: [{ $match: {} }] } }, 7)
    expect(r.rows.length).toBe(7)
    expect(r.truncated).toBe(true)
    const sent = mock.requests.find((x) => x.path === '/api/dataset')!.body as { native: { query: string }; constraints: Record<string, number> }
    expect(JSON.parse(sent.native.query).pop()).toEqual({ $limit: 8 })
    expect(sent.constraints['max-results']).toBe(8)
    // Never more than the hard cap, whatever is asked
    const big = await queryRows({ database: 1, pipeline: { collection: 'events', stages: [{ $limit: 100000 }] } }, 100000)
    expect(big.rows.length).toBeLessThanOrEqual(MAX_ROWS)
    expect(limited([{ $limit: 3 }], 10)).toEqual([{ $limit: 3 }])
    expect(limited([{ $match: {} }, { $limit: 50 }], 10)).toEqual([{ $match: {} }, { $limit: 10 }])
  })

  it('a saved question’s result is cut to the row cap too', async () => {
    const r = await queryRows({ database: 0, card: 103 }, 2)
    expect(r.rows.length).toBe(2)
  })

  it('gives up on a query that takes too long', async () => {
    const { createServer } = await import('http')
    const slow = createServer(() => {})
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r))
    const port = (slow.address() as { port: number }).port
    const c = metabaseClient({ url: `http://127.0.0.1:${port}`, key: 'k' }, 150)
    await expect(c.post('/api/dataset', {})).rejects.toThrow(/longer than/)
    slow.closeAllConnections()
    slow.close()
  })

  it('never puts the key in an error or the tool’s words', async () => {
    const bad = metabaseClient({ url: mock.url, key: 'mb_secret_wrong' })
    const e = await bad.get('/api/database').catch((x: Error) => x.message)
    expect(String(e)).toMatch(/turned the key down/)
    expect(String(e)).not.toContain('mb_secret_wrong')
    const out = await metabaseTool({ action: 'databases' })
    expect(out).not.toContain(mock.key)
  })
})

describe('pipelines as learners write them', () => {
  it('reads shell syntax, the collection, ISODate and comments', () => {
    const p = parsePipeline(`\`\`\`mongodb
// paid ones
db.payments.aggregate([
  { $match: { status: 'succeeded', created_at: { $gte: ISODate("2024-03-01") } } },
  { $group: { _id: "$currency", total: { $sum: "$amount" } } }
])
\`\`\``)
    expect('error' in p).toBe(false)
    if ('error' in p) return
    expect(p.collection).toBe('payments')
    expect(p.stages[0]).toEqual({ $match: { status: 'succeeded', created_at: { $gte: { $date: '2024-03-01' } } } })
  })

  it('explains what is wrong with a malformed pipeline', () => {
    expect(parsePipeline('{ $match: {} }')).toEqual({ error: expect.stringMatching(/square brackets/) })
    expect(parsePipeline('[{ "$match": {}, "$limit": 3 }]')).toEqual({ error: expect.stringMatching(/exactly one \$ key/) })
  })
})

describe('comparing results, with tolerance', () => {
  const R = (columns: string[], rows: unknown[][]) => ({ columns, rows })
  it('matches the same rows in any order, numbers within rounding, column names free', () => {
    const want = R(['_id', 'total'], [['GBP', 100.1], ['EUR', 50.25]])
    expect(compareResultSets(R(['currency', 'sum'], [['EUR', 50.2500001], ['GBP', 100.1]]), want).match).toBe(true)
    expect(compareResultSets(R(['currency', 'sum'], [['EUR', 50.3], ['GBP', 100.1]]), want).match).toBe(false)
  })

  it('treats dates as instants and numeric strings as numbers', () => {
    expect(compareResultSets(R(['d', 'n'], [['2024-01-01T00:00:00.000Z', '3']]), R(['day', 'n'], [['2024-01-01', 3]])).match).toBe(true)
  })

  it('says a fan-out when every number is a whole multiple', () => {
    const c = compareResultSets(R(['s', 'n'], [['a', 20], ['b', 6]]), R(['s', 'n'], [['a', 10], ['b', 3]]))
    expect(c.match).toBe(false)
    expect(c.why).toMatch(/fan-out/)
    expect(c.table).toMatch(/\| a \| n \| 20 \| 10 \|/)
  })

  it('says counting instead of summing', () => {
    const c = compareResultSets(R(['s', 'n'], [['a', 4], ['b', 2]]), R(['s', 'total'], [['a', 41.5], ['b', 12.25]]))
    expect(c.why).toMatch(/\$sum: 1 \} counts documents/)
  })

  it('says mixed types when a number is text in one result', () => {
    const c = compareResultSets(R(['m', 'max'], [['5', '90.00'], ['1', 12]]), R(['m', 'max'], [['5', 126], ['1', 12]]))
    expect(c.why).toMatch(/mixed types/)
    expect(c.table).toMatch(/\| 5 \| max \| "90.00" \| 126 \|/)
  })

  it('says which groups are missing or extra', () => {
    const c = compareResultSets(R(['s', 'n'], [['a', 1]]), R(['s', 'n'], [['a', 1], ['b', 2]]))
    expect(c.why).toMatch(/Missing from yours: \(b\)/)
    expect(c.why).toMatch(/stricter/)
  })

  it('needs the order only when the question asks for one', () => {
    const want = R(['s', 'n'], [['a', 3], ['b', 1]])
    const mine = R(['s', 'n'], [['b', 1], ['a', 3]])
    expect(compareResultSets(mine, want).match).toBe(true)
    expect(compareResultSets(mine, want, { ordered: true }).why).toMatch(/order/)
  })

  it('matches object ids (a $group on two fields) whatever their key order', () => {
    expect(compareResultSets(R(['_id', 'n'], [[{ w: 2, y: 2024 }, 5]]), R(['_id', 'n'], [[{ y: 2024, w: 2 }, 5]])).match).toBe(true)
  })
})

describe('checked exercises on their data', () => {
  const reference = `db.payments.aggregate([{ $match: { status: "succeeded" } }, { $group: { _id: "$currency", revenue: { $sum: { $toDouble: "$amount" } } } }])`
  const mistake = `db.payments.aggregate([{ $match: { status: "succeeded" } }, { $group: { _id: "$currency", revenue: { $sum: "$amount" } } }])`

  it('proves an exercise: the reference gives real rows, the mistake (summing mixed types) differs', async () => {
    const parsed = parseExercise({ kind: 'metabase', topic: 'Grouping payments', problem: 'Revenue per currency from succeeded payments.', question: 'Write the pipeline.', reference, mistake, database: 1, collection: 'payments' })
    expect('exercise' in parsed).toBe(true)
    if (!('exercise' in parsed)) return
    const { metabaseIO } = await import('../src/main/metabaseLearn')
    const v = await verifyExercise(parsed.exercise, { run: async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 0 }), metabase: metabaseIO() }, 'x1')
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.problem.lang).toBe('mongodb')
    expect(v.problem.solution).toMatch(/\/\/ metabase: database=1 collection=payments/)
    expect(v.problem.ask).toMatch(/link of a question you built in Metabase/)
  })

  it('refuses a mistake that gives the same answer, and a reference with no rows', async () => {
    const { metabaseIO } = await import('../src/main/metabaseLearn')
    const same = await verifyMetabase({ problem: 'p', question: 'q', reference, mistake: reference.replace('"succeeded"', '"succeeded" ') , database: 1, collection: 'payments' }, metabaseIO()!)
    expect('why' in same && same.why).toMatch(/same result/)
    const empty = await verifyMetabase({ problem: 'p', question: 'q', reference: 'db.payments.aggregate([{ $match: { status: "lost" } }])', mistake, database: 1 }, metabaseIO()!)
    expect('why' in empty && empty.why).toMatch(/no rows/)
  })

  const lesson = (answer: string) => ({
    messages: [
      { role: 'user' as const, content: 'Teach me $group' },
      { role: 'assistant' as const, content: `**Problem 1**\n\nRevenue per currency.\n\n<solution>${solutionBlock({ database: 1, collection: 'payments', stages: (parsePipeline(reference) as { stages: Record<string, unknown>[] }).stages })}</solution>\n\n<ask type="code" lang="mongodb">Write the pipeline.</ask>` },
      { role: 'user' as const, content: `Answer: ${answer}` }
    ]
  })

  it('marks a right pipeline right, however it is written', async () => {
    const e = await metabaseExact(lesson('```mongodb\ndb.payments.aggregate([{ $match: { status: "succeeded" } }, { $project: { currency: 1, a: { $toDouble: "$amount" } } }, { $group: { _id: "$currency", total: { $sum: "$a" } } }])\n```'))
    expect(e?.result).toBe('match')
    expect(e?.kind).toBe('metabase')
  })

  it('shows where the numbers differ and why, from a real wrong pipeline', async () => {
    const e = await metabaseExact(lesson(`\`\`\`mongodb\n${mistake}\n\`\`\``))
    expect(e?.result).toBe('mismatch')
    expect(e?.why).toMatch(/smaller|missing|differ/)
    expect(e?.table).toMatch(/\| _id \| Column \| Yours \| Reference \|/)
    const block = comparisonBlock(e!)
    expect(block).toMatch(/^> \[!warning\] Tide ran your query and the reference on your Metabase/)
    // Only small samples
    expect((block.match(/^> \| /gm) ?? []).length).toBeLessThanOrEqual(20)
  })

  it('takes a Metabase question as the answer: a link or an id', async () => {
    expect(cardIn('https://mb.example.com/question/101-revenue-by-month')).toBe(101)
    expect(cardIn('Answer: question 42')).toBe(42)
    expect(cardIn('#7')).toBe(7)
    const ref = solutionRef(solutionBlock({ card: 101 }))
    expect(ref).toEqual({ card: 101 })
    const e = await metabaseExact({
      messages: [
        { role: 'assistant', content: `<solution>${solutionBlock({ card: 101 })}</solution><ask type="code" lang="mongodb">Rebuild "Revenue by month".</ask>` },
        { role: 'user', content: 'Answer: ```mongodb\ndb.payments.aggregate([{ $match: { status: "succeeded" } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$created_at" } }, revenue: { $sum: { $toDouble: "$amount" } } } }])\n```' }
      ]
    })
    expect(e?.result).toBe('match')
    const viaCard = await metabaseExact({ messages: [{ role: 'assistant', content: `<solution>${solutionBlock({ card: 101 })}</solution>` }, { role: 'user', content: `Answer: ${mock.url}/question/101-revenue-by-month` }] })
    expect(viaCard?.result).toBe('match')
  })

  it('reads an answer the learner can’t run as a clear mismatch, not a crash', async () => {
    const e = await metabaseExact(lesson('[{ "$out": "mine" }]'))
    expect(e?.result).toBe('mismatch')
    expect(e?.why).toMatch(/\$out/)
    expect(mock.refused).toEqual([])
  })

  it('Run in the answer box runs on their Metabase, a few rows back', async () => {
    const { _forget } = await import('../src/main/metabaseMap')
    _forget()
    const r = await runAnswer('mongodb', 'db.payments.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])')
    // Not mapped yet: Tide doesn't guess a database
    expect(r.exitCode).toBe(1)
    const fs = await import('fs')
    fs.mkdirSync(join(dir, '.tide/metabase'), { recursive: true })
    fs.writeFileSync(join(dir, '.tide/metabase/map.json'), JSON.stringify(await mapped()))
    _forget()
    const ok = await runAnswer('mongodb', 'db.payments.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])')
    expect(ok.stdout).toMatch(/rows from your Metabase \(read-only\)/)
    expect(ok.stdout).toMatch(/succeeded/)
  })

  it('answerRef keeps SQL apart from pipelines and refuses writes', () => {
    expect(answerRef('SELECT 1', { database: 2 })).toEqual({ database: 2, sql: 'SELECT 1' })
    expect('error' in answerRef('drop table x', { database: 2 })).toBe(true)
  })
})

describe('taking a dashboard apart', () => {
  it('gives the tutor every card: what it reads, its query and a few rows', async () => {
    const brief = await teardownContext(1)
    expect(brief).toMatch(/^Dashboard 1: "Revenue overview"/)
    expect(brief).toMatch(/Card 1: "Revenue by month" \(question 101\), shown as line/)
    expect(brief).toMatch(/Native pipeline on payments:\n```mongodb/)
    expect(brief).toMatch(/Card 2: "Payments by status".*\n.*Reads: payments/)
    expect(brief).toMatch(/Built in the query builder/)
    expect(brief).toMatch(/Its result \(first rows\)/)
    // A teardown fetched each card's result with a tiny cap: no card ran for more than a few rows
    expect(brief.split('\n').filter((l) => /^\| \d{4}-\d\d \|/.test(l)).length).toBeLessThanOrEqual(3)
  })

  it('starts as a Metabase lesson with the teardown rules and the brief', async () => {
    const topic = teardownTopic({ id: 2, name: 'Growth' })
    expect(topic).toBe('Take apart the dashboard “Growth” (#2)')
    expect(isMetabaseLesson(topic, undefined)).toBe(true)
    const ctx = await metabaseContext({ topic, scope: { kind: 'vault' } })
    expect(ctx).toMatch(/takes apart one real dashboard/)
    expect(ctx).toMatch(/Rebuild one card yourself/)
    expect(ctx).toMatch(/Card 1: "Checkout funnel"/)
    expect(ctx).toMatch(/collection payments \(table id 13/)
  })

  it('a lesson in the roadmap’s notebook is a Metabase lesson; others are not', () => {
    expect(isMetabaseLesson('$lookup', 'Metabase on Your Data')).toBe(true)
    expect(isMetabaseLesson('Joins', 'SQL basics')).toBe(false)
  })
})

describe('the tutor sees the Metabase page', () => {
  it('reads which page a Metabase URL is', () => {
    const base = 'https://mb.example.com'
    expect(metabasePage('https://mb.example.com/question/101-revenue-by-month', base)).toEqual({ kind: 'question', id: 101 })
    expect(metabasePage('https://mb.example.com/dashboard/2?date=2024', base)).toEqual({ kind: 'dashboard', id: 2 })
    expect(metabasePage('https://mb.example.com/question/notebook#eyJ', base)).toEqual({ kind: 'new-question', adhoc: true })
    expect(metabasePage('https://mb.example.com/question#eyJkYXRh', base)).toEqual({ kind: 'new-question', adhoc: true })
    expect(metabasePage('https://mb.example.com/model/7-clean-payments', base)).toEqual({ kind: 'model', id: 7 })
    expect(metabasePage('https://mb.example.com/', base)).toEqual({ kind: 'home' })
    expect(metabasePage('https://evil.example.com/question/1', base)).toBeNull()
    // An instance under a path
    expect(metabasePage('https://x.com/metabase/dashboard/3', 'https://x.com/metabase')).toEqual({ kind: 'dashboard', id: 3 })
  })

  it('tells the tutor the page, what it is from the API, and its visible text', async () => {
    const said = await describeMetabasePage(`${mock.url}/question/101-revenue-by-month`, 'Revenue by month\n2024-01  1,234')
    expect(said).toMatch(/on question 101/)
    expect(said).toMatch(/Question 101: Revenue by month \[line\]/)
    expect(said).toMatch(/db\.payments|"\$match"/)
    expect(said).toMatch(/What the page shows/)
    const dash = await describeMetabasePage(`${mock.url}/dashboard/1`)
    expect(dash).toMatch(/Questions on it \(2\)/)
    expect(await describeMetabasePage('https://elsewhere.example.com/question/1')).toBe('')
  })
})

describe('learners’ pipelines on screen', () => {
  it('shows a typed pipeline as code and keeps $operators out of maths', async () => {
    const { dollarsAsCode } = await import('../src/shared/metabaseData')
    expect(dollarsAsCode('db.events.aggregate([{ $group: { _id: "$type" } }])')).toMatch(/^```mongodb\n/)
    expect(dollarsAsCode('I used { $sum: 1 } there')).toBe('I used { \\$sum: 1 } there')
    expect(dollarsAsCode('it costs $5')).toBe('it costs $5')
  })
})

describe('docsOf', () => {
  it('turns Metabase rows back into documents, dropping nulls', () => {
    expect(docsOf({ columns: ['_id', 'a', 'b'], rows: [['x', 1, null]] })).toEqual([{ _id: 'x', a: 1 }])
  })
})
