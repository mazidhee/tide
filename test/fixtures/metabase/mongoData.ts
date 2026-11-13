/**
 * A payments app's MongoDB, as a mock Metabase serves it (test/helpers/mockMetabase): users,
 * events, payments and merchants, with what real document data has: embedded sub-documents and
 * arrays, optional fields (a referral code the app started writing in March, a refund only on
 * refunded payments, an experiment only on pricing views), type drift (amounts stored as strings
 * until February), and a key whose type doesn't match (payments.merchant_id is a string, merchants
 * have whole-number ids). Deterministic: a seeded generator, no dates from the clock.
 */

export type Doc = Record<string, unknown>

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const hex = (r: () => number, n = 24) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('')
const pick = <T>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)]
const START = Date.UTC(2024, 0, 1)
const DAY = 86_400_000

export function mongoData(): Record<string, Doc[]> {
  const r = rng(42)
  const merchants: Doc[] = [
    { _id: 1, name: 'Northwind Coffee', category: 'food', country: 'GB', onboarded_at: new Date(START - 200 * DAY) },
    { _id: 2, name: 'Atlas Books', category: 'retail', country: 'GB', onboarded_at: new Date(START - 120 * DAY) },
    { _id: 3, name: 'Kite Travel', category: 'travel', country: 'FR', onboarded_at: new Date(START - 40 * DAY) },
    { _id: 4, name: 'Pixel Games', category: 'digital', country: 'DE', onboarded_at: new Date(START + 20 * DAY) },
    { _id: 5, name: 'Green Grocer', category: 'food', country: 'NG', onboarded_at: new Date(START + 60 * DAY) }
  ]
  const users: Doc[] = []
  for (let i = 0; i < 60; i++) {
    const created = new Date(START + Math.floor((i / 60) * 180 * DAY) + Math.floor(r() * DAY))
    const u: Doc = {
      _id: hex(r),
      email: `user${i}@example.com`,
      country: pick(r, ['GB', 'GB', 'FR', 'DE', 'NG', 'US']),
      plan: pick(r, ['free', 'free', 'free', 'pro', 'team']),
      created_at: created,
      profile: { signup_source: pick(r, ['ads', 'organic', 'referral']), age_band: pick(r, ['18-24', '25-34', '35-44']) }
    }
    // The app started asking for a referral code on 1 March: older users never got one
    if (created.getTime() >= Date.UTC(2024, 2, 1) && r() < 0.8) u.referral_code = `R${Math.floor(r() * 9000 + 1000)}`
    if (r() < 0.5) u.tags = [pick(r, ['beta', 'vip', 'churn-risk']), ...(r() < 0.3 ? ['newsletter'] : [])]
    users.push(u)
  }
  const events: Doc[] = []
  const steps = ['signup', 'view_pricing', 'start_checkout', 'pay']
  for (const u of users) {
    let t = (u.created_at as Date).getTime()
    const session = hex(r, 12)
    for (const [k, type] of steps.entries()) {
      if (k > 0 && r() < 0.35) break
      t += Math.floor(r() * 2 * DAY)
      const e: Doc = { _id: hex(r), user_id: u._id, type, ts: new Date(t), session_id: session, props: { device: pick(r, ['ios', 'android', 'web']), page: `/${type.replace('_', '-')}` } }
      // Only pricing views carry the experiment they were in
      if (type === 'view_pricing') e.experiment = pick(r, ['price_a', 'price_b'])
      events.push(e)
    }
    // Later visits
    const visits = Math.floor(r() * 6)
    for (let v = 0; v < visits; v++) {
      t += Math.floor(r() * 9 * DAY)
      events.push({ _id: hex(r), user_id: u._id, type: 'view_pricing', ts: new Date(t), session_id: hex(r, 12), props: { device: pick(r, ['ios', 'web']), page: '/view-pricing' }, experiment: pick(r, ['price_a', 'price_b']) })
    }
  }
  const payments: Doc[] = []
  const payers = events.filter((e) => e.type === 'pay')
  for (const e of payers) {
    const n = 1 + Math.floor(r() * 3)
    for (let k = 0; k < n; k++) {
      const created = new Date((e.ts as Date).getTime() + k * Math.floor(r() * 20 * DAY))
      const items = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ sku: pick(r, ['COF-1', 'BK-7', 'TRV-2', 'GM-9']), qty: 1 + Math.floor(r() * 2), price: pick(r, [3.5, 12, 19.99, 45]) }))
      const amount = Math.round(items.reduce((s, it) => s + (it.qty as number) * (it.price as number), 0) * 100) / 100
      const status = pick(r, ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'failed', 'refunded'])
      const p: Doc = {
        _id: hex(r),
        user_id: e.user_id,
        merchant_id: String(1 + Math.floor(r() * 5)),
        // Amounts were written as strings until the February release
        amount: created.getTime() < Date.UTC(2024, 1, 1) ? amount.toFixed(2) : amount,
        currency: pick(r, ['GBP', 'GBP', 'EUR']),
        status,
        created_at: created,
        updated_at: new Date(created.getTime() + Math.floor(r() * 3 * DAY)),
        card: { brand: pick(r, ['visa', 'mastercard', 'amex']), last4: String(1000 + Math.floor(r() * 9000)) },
        items
      }
      if (status === 'refunded') p.refund = { reason: pick(r, ['duplicate', 'fraud', 'requested_by_customer']), at: new Date(created.getTime() + 2 * DAY) }
      payments.push(p)
    }
  }
  return { users, events, payments, merchants }
}

/** Metabase's metadata for the collections: ids, and fields as its sync names them (nested ones with nfc_path) */
export const TABLE_IDS: Record<string, number> = { users: 11, events: 12, payments: 13, merchants: 14 }

/** The saved questions: native pipelines and one built in the query builder */
export const CARDS = [
  {
    id: 101,
    name: 'Revenue by month',
    display: 'line',
    description: 'Succeeded payments, summed per month.',
    view_count: 140,
    dataset_query: { type: 'native', database: 1, native: { collection: 'payments', query: JSON.stringify([{ $match: { status: 'succeeded' } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$created_at' } }, revenue: { $sum: { $toDouble: '$amount' } } } }, { $sort: { _id: 1 } }]) } }
  },
  {
    id: 102,
    name: 'Payments by status',
    display: 'bar',
    description: null,
    view_count: 90,
    dataset_query: { type: 'query', database: 1, query: { 'source-table': 13, aggregation: [['count']], breakout: [['field', 'status', null]] } }
  },
  {
    id: 103,
    name: 'Checkout funnel',
    display: 'funnel',
    description: 'Users reaching each step.',
    view_count: 75,
    dataset_query: { type: 'native', database: 1, native: { collection: 'events', query: JSON.stringify([{ $match: { type: { $in: ['signup', 'view_pricing', 'start_checkout', 'pay'] } } }, { $group: { _id: { type: '$type', user: '$user_id' } } }, { $group: { _id: '$_id.type', users: { $sum: 1 } } }, { $sort: { users: -1 } }]) } }
  },
  {
    id: 104,
    name: 'New users per week',
    display: 'bar',
    description: null,
    view_count: 30,
    dataset_query: { type: 'native', database: 1, native: { collection: 'users', query: JSON.stringify([{ $group: { _id: { year: { $year: '$created_at' }, week: { $week: '$created_at' } }, users: { $sum: 1 } } }, { $sort: { '_id.year': 1, '_id.week': 1 } }]) } }
  }
]

export const DASHBOARDS = [
  { id: 1, name: 'Revenue overview', description: 'Money in, by month and by outcome.', view_count: 320, parameters: [{ name: 'Date' }], cards: [101, 102] },
  { id: 2, name: 'Growth', description: 'Sign-ups and the checkout funnel.', view_count: 110, parameters: [], cards: [103, 104] }
]
