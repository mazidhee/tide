import { describe, expect, it } from 'vitest'
import { generate, specProblems, toExtendedJson, type PracticeSpec } from '../src/shared/practiceData'
import { fieldTree, listedCollections, widenSpec, type Inventory } from '../src/shared/practiceReplica'
import { loadScript } from '../src/shared/practiceStack'

const BASE: PracticeSpec = {
  seed: 3,
  from: '2026-01-01T00:00:00Z',
  to: '2026-03-01T00:00:00Z',
  collections: [{ name: 'users', count: 30, time: { field: 'createdAt' }, fields: { _id: { gen: 'objectId' }, createdAt: { gen: 'time' }, tier: { gen: 'enum', values: { gold: 1, none: 3 } } } }]
}

const INV: Inventory = {
  collections: [
    { name: 'users', fields: [{ path: '_id', types: ['objectId'] }, { path: 'tier', types: ['string'] }, { path: 'phone', types: ['string'] }, { path: 'roleId', types: ['objectId'] }] },
    { name: 'roles', fields: [{ path: '_id', types: ['objectId'] }, { path: 'name', types: ['string'] }] },
    // Listed before the collection it refers to: it must still be made after it
    {
      name: 'payments',
      fields: [
        { path: '_id', types: ['objectId'] },
        { path: 'createdAt', types: ['date'] },
        { path: 'userId', types: ['string'] },
        { path: 'walletId', types: ['objectId'] },
        { path: 'amount', types: ['int', 'double'] },
        { path: 'meta.channel', types: ['string', 'null'] },
        { path: 'items.[].sku', types: ['string'] },
        { path: 'tags', types: ['array'] },
        { path: 'paidAt', types: ['date', 'null'] }
      ]
    },
    { name: 'wallets', fields: [{ path: '_id', types: ['objectId'] }, { path: 'userId', types: ['objectId'] }, { path: 'createdAt', types: ['date'] }] },
    { name: 'archived_things', fields: [] },
    { name: 'events', fields: [{ path: '_id', types: ['objectId'] }, { path: 'createdAt', types: ['date'] }, { path: 'kind', types: ['string'] }] },
    { name: 'system.buckets.events', fields: [] },
    { name: 'system.views', fields: [] },
    { name: 'system.profile', fields: [] }
  ],
  joins: [
    { source: 'users', path: 'roleId', target: 'roles', as: 'objectId' },
    { source: 'payments', path: 'userId', target: 'users', as: 'string' },
    { source: 'payments', path: 'walletId', target: 'wallets', as: 'objectId' },
    { source: 'wallets', path: 'userId', target: 'users', as: 'objectId' },
    // To a collection with no documents: not kept as a reference
    { source: 'wallets', path: 'thingId', target: 'archived_things', as: 'objectId' }
  ]
}

describe('fuller practice replica', () => {
  it('reads observed paths as a tree of objects and array elements', () => {
    const t = fieldTree([{ path: 'a.b', types: ['int'] }, { path: 'xs.[].y', types: ['string'] }])
    expect([...t.get('a')!.types]).toEqual(['object'])
    expect([...t.get('a')!.children.get('b')!.types]).toEqual(['int'])
    expect([...t.get('xs')!.types]).toEqual(['array'])
    expect([...t.get('xs')!.element!.children.keys()]).toEqual(['y'])
  })

  it('keeps the hand-made collections, adds every other one in an order that works, and says what it did', () => {
    const { spec, report } = widenSpec(BASE, INV, { count: 40 })
    expect(specProblems(JSON.parse(JSON.stringify(spec)))).toEqual([])
    const names = spec.collections.map((c) => c.name)
    const users = spec.collections.find((c) => c.name === 'users')!
    expect(users.fields.tier).toEqual(BASE.collections[0].fields.tier)
    expect(users.count).toBe(30)
    // Lookups first, so a hand-made collection can refer to them; the rest after
    expect(names.indexOf('events')).toBeLessThan(names.indexOf('users'))
    expect(names.indexOf('users')).toBeLessThan(names.indexOf('wallets'))
    expect(report.grown).toEqual([{ name: 'users', fields: ['phone', 'roleId'] }])
    expect(users.fields.roleId).toEqual({ gen: 'ref', collection: 'roles', as: 'objectId' })
    expect(names.indexOf('wallets')).toBeLessThan(names.indexOf('payments'))
    expect(names).not.toContain('system.buckets.events')
    expect(report.empty).toEqual(expect.arrayContaining(['archived_things', 'system.views']))
    expect(report.timeSeries).toEqual(['events'])
    // Every listed entry exists once loaded, the time series' buckets included
    expect(new Set(listedCollections(spec))).toEqual(new Set(INV.collections.map((c) => c.name)))
    expect(report.collections).toBe(spec.collections.length)
  })

  it('makes documents with the observed shape: references, nested fields, mixed types and nulls', () => {
    const { spec } = widenSpec(BASE, INV, { count: 200 })
    const d = generate(spec)
    const users = new Set(d.get('users')!.map((u) => JSON.parse(JSON.stringify(u))._id.$oid))
    const wallets = new Set(d.get('wallets')!.map((w) => JSON.parse(JSON.stringify(w))._id.$oid))
    const pays = JSON.parse(toExtendedJson(d.get('payments')!)) as Record<string, any>[]
    expect(pays).toHaveLength(200)
    expect(pays.every((p) => typeof p.userId === 'string' && users.has(p.userId))).toBe(true)
    expect(pays.every((p) => wallets.has(p.walletId.$oid))).toBe(true)
    expect(pays.every((p) => typeof p.createdAt.$date === 'string')).toBe(true)
    expect(pays.some((p) => p.meta.channel === null)).toBe(true)
    expect(pays.some((p) => typeof p.meta.channel === 'string')).toBe(true)
    expect(pays.every((p) => Array.isArray(p.items) && p.items.every((i: any) => typeof i.sku === 'string'))).toBe(true)
    // Seen as int and double: both kinds of number
    expect(pays.some((p) => Number.isInteger(p.amount))).toBe(true)
    expect(pays.some((p) => !Number.isInteger(p.amount))).toBe(true)
    // A date after the document's time
    expect(pays.filter((p) => p.paidAt).every((p) => Date.parse(p.paidAt.$date) >= Date.parse(p.createdAt.$date))).toBe(true)
    expect(d.get('archived_things')).toEqual([])
    expect(spec.collections.find((c) => c.name === 'events')!.create).toEqual({ timeseries: { timeField: 'createdAt' } })
    expect(spec.collections.find((c) => c.name === 'system.profile')!.create).toMatchObject({ capped: true })
  })

  it('drops a reference it can’t make and is the same every time', () => {
    const a = widenSpec(BASE, INV)
    expect(a.report.droppedRefs).toEqual([])
    const cyc: Inventory = {
      collections: [
        { name: 'a', fields: [{ path: '_id', types: ['objectId'] }, { path: 'bId', types: ['objectId'] }] },
        { name: 'b', fields: [{ path: '_id', types: ['objectId'] }, { path: 'aId', types: ['objectId'] }] }
      ],
      joins: [
        { source: 'a', path: 'bId', target: 'b', as: 'objectId' },
        { source: 'b', path: 'aId', target: 'a', as: 'objectId' }
      ]
    }
    const { spec, report } = widenSpec(BASE, cyc)
    expect(report.droppedRefs).toHaveLength(1)
    expect(specProblems(JSON.parse(JSON.stringify(spec)))).toEqual([])
    expect(JSON.stringify(widenSpec(BASE, INV).spec)).toBe(JSON.stringify(a.spec))
  })

  it('wants a time series to be timed by its time field', () => {
    const bad: PracticeSpec = { collections: [{ name: 'e', count: 1, fields: { at: { gen: 'time' } }, time: { field: 'at' }, create: { timeseries: { timeField: 'createdAt' } } }] }
    expect(specProblems(bad).join(' ')).toMatch(/time series/)
  })

  it('loads every collection in one script, keeping the ones made with options, and refuses an odd name', () => {
    const sh = loadScript([{ name: 'users', drop: true }, { name: 'events', drop: false }])
    expect(sh.split('\n')).toHaveLength(2)
    expect(sh).toContain("--collection 'users' --drop --jsonArray --file '/tmp/seed/users.json'")
    expect(sh).toMatch(/--collection 'events' --jsonArray/)
    expect(sh).toContain('Loading events failed')
    expect(() => loadScript([{ name: "x'; rm -rf /", drop: true }])).toThrow(/plain/)
  })
})
