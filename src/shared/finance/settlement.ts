/**
 * How payments between banks settle. Each payment moves central-bank money (reserves) from the
 * payer's bank to the payee's. Three ways to do it:
 *
 * - RTGS (real-time gross settlement: Fedwire, CHAPS, T2): every payment settles alone, at once, if
 *   the paying bank has the reserves; otherwise it waits in a queue. Final at once, needs liquidity.
 * - DNS (deferred net settlement: ACH, Bacs, card schemes): payments are collected through the day
 *   and only each bank's net position moves at the end. Far less liquidity, but a bank that fails
 *   before settlement leaves the others exposed.
 * - Prefunded instant (FedNow and TIPS settle in central-bank money at once; RT1 and Faster
 *   Payments run on prefunded positions): instant to the customer, with liquidity set aside first.
 *
 * Plus the card flow: authorisation now, clearing and settlement a day later, with interchange
 * and scheme fees taken out on the way to the merchant. Amounts are whole minor units.
 */

export interface Payment {
  id: string
  from: string
  to: string
  amount: number
}

export interface Settled {
  id: string
  at: number
}

export interface RtgsResult {
  /** Order and step at which each payment settled */
  settled: Settled[]
  /** Payments still queued for lack of reserves */
  queued: string[]
  balances: Record<string, number>
  /** The most reserves each bank needed at once */
  peakOutflow: Record<string, number>
}

/**
 * RTGS with a FIFO queue: each payment settles if its bank has the reserves, else it queues; after
 * every settlement the queue is retried in order (a payment received can release one waiting).
 */
export function rtgs(opening: Record<string, number>, payments: Payment[]): RtgsResult {
  const bal = { ...opening }
  for (const p of payments) {
    bal[p.from] ??= 0
    bal[p.to] ??= 0
  }
  const settled: Settled[] = []
  const queue: Payment[] = []
  let step = 0
  const tryOne = (p: Payment) => {
    if (bal[p.from] < p.amount) return false
    bal[p.from] -= p.amount
    bal[p.to] += p.amount
    settled.push({ id: p.id, at: ++step })
    return true
  }
  const drain = () => {
    let moved = true
    while (moved) {
      moved = false
      for (let i = 0; i < queue.length; i++)
        if (tryOne(queue[i])) {
          queue.splice(i, 1)
          moved = true
          break
        }
    }
  }
  for (const p of payments) {
    if (queue.some((q) => q.from === p.from) || !tryOne(p)) queue.push(p)
    else drain()
  }
  const peakOutflow: Record<string, number> = {}
  for (const b of Object.keys(bal)) peakOutflow[b] = payments.filter((p) => p.from === b).reduce((s, p) => s + p.amount, 0)
  return { settled, queued: queue.map((q) => q.id), balances: bal, peakOutflow }
}

/** Gross: what each bank owes each other bank, summed by pair */
export function bilateral(payments: Payment[]): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {}
  for (const p of payments) {
    m[p.from] ??= {}
    m[p.from][p.to] = (m[p.from][p.to] ?? 0) + p.amount
  }
  return m
}

/** Each bank's multilateral net position: received minus sent. The positions always sum to zero. */
export function multilateralNet(payments: Payment[]): Record<string, number> {
  const net: Record<string, number> = {}
  for (const p of payments) {
    net[p.from] = (net[p.from] ?? 0) - p.amount
    net[p.to] = (net[p.to] ?? 0) + p.amount
  }
  return net
}

/** Each pair's bilateral net: for banks a < b, what a owes b once their payments to each other cancel (negative: b owes a) */
export function bilateralNet(payments: Payment[]): { a: string; b: string; net: number }[] {
  const g = bilateral(payments)
  const banks = [...new Set(payments.flatMap((p) => [p.from, p.to]))].sort()
  const out: { a: string; b: string; net: number }[] = []
  for (let i = 0; i < banks.length; i++)
    for (let j = i + 1; j < banks.length; j++) {
      const [a, b] = [banks[i], banks[j]]
      const net = (g[a]?.[b] ?? 0) - (g[b]?.[a] ?? 0)
      if (net) out.push({ a, b, net })
    }
  return out
}

export interface NettingSummary {
  gross: number
  bilateral: number
  multilateral: number
  /** How much less moves than gross settlement, multilaterally, as a fraction */
  saving: number
}

/** Liquidity needed under each method: gross total, sum of bilateral nets, sum of net debits */
export function nettingSummary(payments: Payment[]): NettingSummary {
  const gross = payments.reduce((s, p) => s + p.amount, 0)
  const bi = bilateralNet(payments).reduce((s, x) => s + Math.abs(x.net), 0)
  const multi = Object.values(multilateralNet(payments)).reduce((s, v) => s + (v < 0 ? -v : 0), 0)
  return { gross, bilateral: bi, multilateral: multi, saving: gross ? 1 - multi / gross : 0 }
}

/**
 * Deferred net settlement with a failure: when a bank can't cover its net debit, its payments are
 * taken out (unwound) and the rest are netted again: the others' positions change under them,
 * which is the systemic risk DNS carries (and why CPMI's principles ask for a default plan).
 */
export function dnsWithFailure(opening: Record<string, number>, payments: Payment[]): { failed: string[]; net: Record<string, number>; unwound: string[] } {
  let live = [...payments]
  const failed: string[] = []
  for (;;) {
    const net = multilateralNet(live)
    const short = Object.entries(net).find(([b, v]) => v < 0 && (opening[b] ?? 0) + v < 0 && !failed.includes(b))
    if (!short) return { failed, net, unwound: payments.filter((p) => !live.includes(p)).map((p) => p.id) }
    failed.push(short[0])
    live = live.filter((p) => p.from !== short[0] && p.to !== short[0])
  }
}

// ---------- Instant payments ----------

export interface InstantResult {
  accepted: string[]
  /** Refused at once (the payee's bank answers within seconds either way) */
  rejected: { id: string; why: string }[]
  positions: Record<string, number>
}

/**
 * Instant payments on prefunded positions: each payment is checked against the payer bank's
 * position and either settles at once or is rejected (never queued), as SCT Inst and FedNow do.
 */
export function instant(prefund: Record<string, number>, payments: Payment[], limit = Infinity): InstantResult {
  const pos = { ...prefund }
  const accepted: string[] = []
  const rejected: { id: string; why: string }[] = []
  for (const p of payments) {
    pos[p.from] ??= 0
    pos[p.to] ??= 0
    if (p.amount > limit) rejected.push({ id: p.id, why: `over the scheme's limit of ${limit}` })
    else if (pos[p.from] < p.amount) rejected.push({ id: p.id, why: 'the sending bank’s prefunded position is too low' })
    else {
      pos[p.from] -= p.amount
      pos[p.to] += p.amount
      accepted.push(p.id)
    }
  }
  return { accepted, rejected, positions: pos }
}

// ---------- Card payments ----------

export interface CardFees {
  /** Interchange, paid by the acquirer to the issuer, as a fraction of the amount (EU consumer debit: 0.2%, credit: 0.3%) */
  interchange: number
  /** The scheme's fee, a fraction */
  scheme: number
  /** The acquirer's own margin, a fraction */
  acquirer: number
}

export const EU_DEBIT: CardFees = { interchange: 0.002, scheme: 0.0005, acquirer: 0.005 }

export interface CardFlow {
  steps: { at: string; from: string; to: string; what: string; amount?: number }[]
  /** The merchant service charge: everything taken from the merchant */
  msc: number
  merchantGets: number
  issuerGets: number
  schemeGets: number
  acquirerGets: number
}

/** A card purchase from authorisation to the merchant's payout, with each party's share (minor units, rounded half up per fee) */
export function cardPurchase(amount: number, fees: CardFees = EU_DEBIT): CardFlow {
  const ic = Math.round(amount * fees.interchange)
  const sc = Math.round(amount * fees.scheme)
  const aq = Math.round(amount * fees.acquirer)
  const msc = ic + sc + aq
  return {
    steps: [
      { at: 'T+0 authorisation', from: 'Merchant', to: 'Acquirer', what: 'Authorisation request (ISO 8583 0100)' },
      { at: 'T+0 authorisation', from: 'Acquirer', to: 'Scheme', what: 'Routes it by the card number' },
      { at: 'T+0 authorisation', from: 'Scheme', to: 'Issuer', what: 'Is the card good and are funds there? Funds are held' },
      { at: 'T+0 authorisation', from: 'Issuer', to: 'Merchant', what: 'Approved (response code 00), back the same way' },
      { at: 'T+1 clearing', from: 'Acquirer', to: 'Scheme', what: 'The day’s captured transactions, for clearing', amount },
      { at: 'T+1 clearing', from: 'Scheme', to: 'Issuer', what: 'Presentment: the issuer posts it to the cardholder', amount },
      { at: 'T+1 settlement', from: 'Issuer', to: 'Acquirer', what: 'Net settlement through the scheme’s settlement bank, interchange kept back', amount: amount - ic },
      { at: 'T+1 settlement', from: 'Acquirer', to: 'Scheme', what: 'Scheme fee', amount: sc },
      { at: 'T+1 to T+2 payout', from: 'Acquirer', to: 'Merchant', what: 'The amount less the merchant service charge', amount: amount - msc }
    ],
    msc,
    merchantGets: amount - msc,
    issuerGets: ic,
    schemeGets: sc,
    acquirerGets: aq
  }
}
