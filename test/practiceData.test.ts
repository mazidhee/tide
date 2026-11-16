import { describe, expect, it } from 'vitest'
import { fromPattern, generate, rng, specProblems, toExtendedJson, type PracticeSpec } from '../src/shared/practiceData'
import { composeFile, PRACTICE_PORTS } from '../src/shared/practiceStack'
import { allowed, isLoopback, practiceAllowed } from '../src/main/metabase'

const SPEC: PracticeSpec = {
  seed: 7,
  from: '2026-01-01T00:00:00Z',
  to: '2026-03-01T00:00:00Z',
  utcOffset: 1,
  collections: [
    { name: 'people', count: 50, time: { field: 'createdAt', spikes: [{ date: '2026-01-10', share: 0.2 }] }, fields: { _id: { gen: 'objectId' }, id: { gen: 'copy', from: '_id', as: 'string' }, createdAt: { gen: 'time' }, level: { gen: 'enum', values: { gold: 1, none: 9 } } } },
    { name: 'kinds', count: 2, fields: { _id: { gen: 'objectId' }, tag: { gen: 'const', value: '' } }, rows: [{ tag: 'a' }, { tag: 'b' }] },
    {
      name: 'orders',
      count: 400,
      time: { field: 'createdAt', afterRef: 'personId', lagMinutes: { median: 60 } },
      fields: {
        _id: { gen: 'objectId' },
        personId: { gen: 'ref', collection: 'people', as: 'string', skew: 3 },
        kind: { gen: 'ref', collection: 'kinds', as: 'objectId', where: { tag: ['b'] } },
        tag: { gen: 'lookup', ref: 'kind', field: 'tag' },
        createdAt: { gen: 'time' },
        amount: { gen: 'number', median: 50000, sigma: 1, min: 100, asDoubleRate: 0.1 },
        note: { gen: 'pattern', pattern: 'Order {AA##}', nullRate: 0.5 },
        state: { gen: 'enum', values: { credit: 1 }, variants: { credit: { values: ['Credit'], rate: 0.5 } } }
      }
    }
  ]
}

describe('practice data', () => {
  it('is the same every time for the same seed, and different for another', () => {
    const a = toExtendedJson(generate(SPEC).get('orders')!)
    expect(toExtendedJson(generate(SPEC).get('orders')!)).toBe(a)
    expect(toExtendedJson(generate({ ...SPEC, seed: 8 }).get('orders')!)).not.toBe(a)
  })

  it('makes references of the type asked, children after their parents, and the quirks', () => {
    const d = generate(SPEC)
    const people = d.get('people')!
    const orders = d.get('orders')!
    const ids = new Set(people.map((p) => String(p.id)))
    expect(orders.every((o) => typeof o.personId === 'string' && ids.has(o.personId as string))).toBe(true)
    const json = JSON.parse(toExtendedJson(orders)) as Record<string, any>[]
    expect(json[0]._id.$oid).toMatch(/^[0-9a-f]{24}$/)
    expect(json[0].kind.$oid).toMatch(/^[0-9a-f]{24}$/)
    expect(orders.every((o) => o.tag === 'b')).toBe(true)
    expect(json.some((o) => o.amount?.$numberDouble)).toBe(true)
    expect(json.some((o) => o.note === null)).toBe(true)
    expect(new Set(json.map((o) => o.state))).toEqual(new Set(['credit', 'Credit']))
    const at = new Map(people.map((p) => [String(p.id), Date.parse((JSON.parse(JSON.stringify(p)) as any).createdAt.$date)]))
    expect(json.every((o) => Date.parse(o.createdAt.$date) >= at.get(o.personId)!)).toBe(true)
    // Skew: the busiest tenth of people have most of the orders
    const per = new Map<string, number>()
    for (const o of orders) per.set(o.personId as string, (per.get(o.personId as string) ?? 0) + 1)
    const top = [...per.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0)
    expect(top / orders.length).toBeGreaterThan(0.4)
    // The spike day holds about a fifth of people (UTC day)
    const spike = people.filter((p) => JSON.stringify(p.createdAt).includes('2026-01-10') || JSON.stringify(p.createdAt).includes('2026-01-09T2')).length
    expect(spike).toBeGreaterThan(5)
    // An ObjectId's time is the document's time
    const p0 = JSON.parse(JSON.stringify(people[0])) as any
    expect(parseInt(p0._id.$oid.slice(0, 8), 16)).toBe(Math.floor(Date.parse(p0.createdAt.$date) / 1000))
  })

  it('fixed rows are laid over generated documents', () => {
    expect(generate(SPEC).get('kinds')!.map((k) => k.tag)).toEqual(['a', 'b'])
  })

  it('says what is wrong with a spec', () => {
    expect(specProblems({})).toEqual(['The spec needs a "collections" list.'])
    expect(specProblems({ collections: [{ name: 'a', count: 1, fields: { x: { gen: 'ref', collection: 'later' } } }] }).join(' ')).toMatch(/isn't made before a/)
    expect(specProblems({ collections: [{ name: 'a', count: 1, fields: { x: { gen: 'nope' } } }] }).join(' ')).toMatch(/unknown generator/)
    expect(specProblems(SPEC)).toEqual([])
  })

  it('patterns draw only inside braces', () => {
    expect(fromPattern('grp_{xxxx}-Plan', rng(1))).toMatch(/^grp_[0-9a-f]{4}-Plan$/)
  })
})

describe('the practice stack and the company Metabase stay apart', () => {
  it('the compose file binds loopback ports only, with named volumes', () => {
    const y = composeFile()
    expect(y).toContain(`"127.0.0.1:${PRACTICE_PORTS.mongo}:27017"`)
    expect(y).toContain(`"127.0.0.1:${PRACTICE_PORTS.metabase}:3000"`)
    expect(y).toMatch(/volumes:\n  mongo:\n  metabase:/)
    expect(y).not.toMatch(/8080/)
  })

  it('the company Metabase stays read-only', () => {
    expect(allowed('POST', '/api/card')).toBe(false)
    expect(allowed('PUT', '/api/card/1')).toBe(false)
    expect(allowed('DELETE', '/api/card/1')).toBe(false)
    expect(allowed('POST', '/api/dashboard')).toBe(false)
  })

  it('the practice one may write, on this Mac only', () => {
    expect(practiceAllowed('POST', '/api/card')).toBe(true)
    expect(practiceAllowed('PUT', '/api/dashboard/3')).toBe(true)
    expect(practiceAllowed('POST', '/api/user')).toBe(false)
    expect(practiceAllowed('DELETE', '/api/database/1')).toBe(false)
    expect(isLoopback('http://127.0.0.1:3047')).toBe(true)
    expect(isLoopback('https://metabase.example.com')).toBe(false)
    expect(isLoopback('http://localhost.evil.com')).toBe(false)
  })
})
