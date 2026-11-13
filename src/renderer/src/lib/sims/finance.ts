/**
 * The finance simulations' specs (ledger, payments, stablecoin, risk): loose JSON in, checked
 * specs out, everything clamped. The models themselves live in src/shared/finance, so the lab's
 * Python helper, the exercises and these pictures share one implementation.
 */
import { DEFAULT_PARAMS, type Scenario } from '@shared/finance/stablecoin'
import { SYNTHETIC_ASSETS } from '@shared/finance/marketData'
import { int, num, onlyVerbs, pick, text, type Raw, type SimBase } from './specUtil'

const cents = (v: unknown, fallback = 0) => Math.round(num(v, fallback, 0, 1e9) * 100)
const nameOf = (v: unknown) => text(v, 16)

// ---------- Ledger ----------

export type LedgerOp =
  | { op: 'deposit' | 'withdraw' | 'fee' | 'payout' | 'payin' | 'repay'; who: string; amount: number }
  | { op: 'transfer'; from: string; to: string; amount: number }
  | { op: 'loan'; who: string; amount: number; rate: number }
  | { op: 'eod'; days: number }
  | { op: 'broken' }

export interface LedgerSpec extends SimBase {
  kind: 'ledger'
  /** Minor units */
  capital: number
  customers: string[]
  ops: LedgerOp[]
}

export const LEDGER_VERBS = ['deposit', 'withdraw', 'transfer', 'loan', 'repay', 'fee', 'payout', 'payin', 'eod', 'broken'] as const

/** One operation from its JSON form ({"deposit":["Ada",100]}), or null */
export function ledgerOp(raw: Record<string, unknown>): LedgerOp | null {
  for (const verb of LEDGER_VERBS) {
    if (!(verb in raw)) continue
    const v = raw[verb]
    const a = Array.isArray(v) ? v : [v]
    switch (verb) {
      case 'transfer':
        return a.length >= 3 ? { op: 'transfer', from: nameOf(a[0]), to: nameOf(a[1]), amount: cents(a[2]) } : null
      case 'loan':
        return a.length >= 2 ? { op: 'loan', who: nameOf(a[0]), amount: cents(a[1]), rate: num(a[2], 0.05, 0, 1) } : null
      case 'eod':
        return { op: 'eod', days: int(a[0], 1, 1, 30) }
      case 'broken':
        return { op: 'broken' }
      default:
        return a.length >= 2 ? { op: verb, who: nameOf(a[0]), amount: cents(a[1]) } : null
    }
  }
  return null
}

export function parseLedgerSpec(raw: Raw, base: SimBase): LedgerSpec {
  const customers = (Array.isArray(raw.customers) ? raw.customers : ['Ada', 'Bo']).map(nameOf).filter(Boolean).slice(0, 4)
  const ops = (Array.isArray(raw.ops) ? raw.ops : []).flatMap((o) => (o && typeof o === 'object' && !Array.isArray(o) ? [ledgerOp(o as Raw)] : [])).filter((o): o is LedgerOp => !!o).slice(0, 24)
  return onlyVerbs({ ...base, kind: 'ledger', capital: cents(raw.capital, 5000), customers: customers.length ? customers : ['Ada', 'Bo'], ops }, LEDGER_VERBS)
}

// ---------- Payments ----------

export type PaymentsMode = 'rtgs' | 'net' | 'instant' | 'card' | 'iso20022'
export type IsoBreak = 'none' | 'iban' | 'bic' | 'sum' | 'decimals' | 'count'

export interface PaymentsSpec extends SimBase {
  kind: 'payments'
  mode: PaymentsMode
  /** Opening reserves (or prefunded positions), whole units */
  banks: Record<string, number>
  payments: [string, string, number][]
  limit: number
  /** card: the purchase, minor units */
  amount: number
  break: IsoBreak
}

export const PAYMENTS_VERBS = ['pay', 'fund', 'mode', 'settle', 'break'] as const
export const MODES: PaymentsMode[] = ['rtgs', 'net', 'instant', 'card', 'iso20022']
export const BREAKS: IsoBreak[] = ['none', 'iban', 'bic', 'sum', 'decimals', 'count']

export function parsePaymentsSpec(raw: Raw, base: SimBase): PaymentsSpec {
  const banksRaw = raw.banks && typeof raw.banks === 'object' && !Array.isArray(raw.banks) ? (raw.banks as Raw) : { A: 30, B: 20, C: 10 }
  const banks: Record<string, number> = {}
  for (const [k, v] of Object.entries(banksRaw).slice(0, 5)) if (nameOf(k)) banks[nameOf(k)] = num(v, 0, 0, 1e6)
  if (Object.keys(banks).length < 2) Object.assign(banks, { A: 30, B: 20, C: 10 })
  const payments = (Array.isArray(raw.payments) ? raw.payments : [])
    .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 3)
    .map((p) => [nameOf(p[0]), nameOf(p[1]), num(p[2], 0, 0, 1e6)] as [string, string, number])
    .filter(([f, t, a]) => f && t && f !== t && a > 0)
    .slice(0, 16)
  for (const [f, t] of payments) for (const b of [f, t]) banks[b] ??= 0
  return onlyVerbs(
    {
      ...base,
      kind: 'payments',
      mode: pick(raw.mode, MODES, 'rtgs', { gross: 'rtgs', netting: 'net', dns: 'net', iso: 'iso20022', 'iso-20022': 'iso20022', cards: 'card' }),
      banks,
      payments: payments.length ? payments : [['A', 'B', 80], ['B', 'C', 120], ['C', 'A', 60]],
      limit: num(raw.limit, Infinity, 1, 1e9),
      amount: cents(raw.amount, 80),
      break: pick(raw.break, BREAKS, 'none')
    },
    PAYMENTS_VERBS
  )
}

// ---------- Stablecoin ----------

export interface StablecoinSpec extends SimBase {
  kind: 'stablecoin'
  scenario: Scenario
  panic: number
  capacity: number
  cashShare: number
  fee: number
  days: number
}

export const STABLECOIN_VERBS = ['scenario', 'mint', 'redeem', 'set'] as const
export const SCENARIOS: Scenario[] = ['calm', 'bank-failure', 'run', 'algorithmic']

export function parseStablecoinSpec(raw: Raw, base: SimBase): StablecoinSpec {
  const scenario = pick(raw.scenario, SCENARIOS, 'bank-failure', { svb: 'bank-failure', 'bank-run': 'run', terra: 'algorithmic', ust: 'algorithmic' })
  const d = DEFAULT_PARAMS[scenario]
  return onlyVerbs(
    {
      ...base,
      kind: 'stablecoin',
      scenario,
      panic: num(raw.panic, d.panic, 0, 3),
      capacity: num(raw.capacity, d.capacity, 0.01, 0.5),
      cashShare: num(raw.cashShare ?? raw.cash, d.cashShare, 0, 1),
      fee: num(raw.fee, d.fee, 0, 0.02),
      days: int(raw.days, d.days, 5, 60)
    },
    STABLECOIN_VERBS
  )
}

// ---------- Risk ----------

export type RiskMode = 'var' | 'option' | 'backtest'
export type VarMethod = 'historical' | 'parametric' | 'monte-carlo'

export interface RiskSpec extends SimBase {
  kind: 'risk'
  mode: RiskMode
  method: VarMethod
  level: number
  ticker: string
  spot: number
  strike: number
  years: number
  rate: number
  vol: number
  type: 'call' | 'put'
  antithetic: boolean
  fast: number
  slow: number
  cost: number
}

export const RISK_VERBS = ['method', 'level', 'paths', 'set', 'mode'] as const
export const TICKERS = SYNTHETIC_ASSETS.map((a) => a.ticker)

export function parseRiskSpec(raw: Raw, base: SimBase): RiskSpec {
  const ticker = typeof raw.ticker === 'string' && TICKERS.includes(raw.ticker.toUpperCase()) ? raw.ticker.toUpperCase() : 'TIDX'
  const fast = int(raw.fast, 20, 2, 120)
  return onlyVerbs(
    {
      ...base,
      kind: 'risk',
      mode: pick(raw.mode, ['var', 'option', 'backtest'] as const, 'var', { 'value-at-risk': 'var', options: 'option', 'monte-carlo': 'option', pricing: 'option', strategy: 'backtest' }),
      method: pick(raw.method, ['historical', 'parametric', 'monte-carlo'] as const, 'historical', { normal: 'parametric', 'variance-covariance': 'parametric', mc: 'monte-carlo', montecarlo: 'monte-carlo' }),
      level: num(raw.level, 0.99, 0.9, 0.999),
      ticker,
      spot: num(raw.spot ?? raw.s, 100, 1, 10000),
      strike: num(raw.strike ?? raw.k, 105, 1, 10000),
      years: num(raw.years ?? raw.t, 1, 0.02, 10),
      rate: num(raw.rate ?? raw.r, 0.03, -0.05, 0.3),
      vol: num(raw.vol ?? raw.sigma, 0.2, 0.01, 2),
      type: pick(raw.type, ['call', 'put'] as const, 'call'),
      antithetic: raw.antithetic === true,
      fast,
      slow: Math.max(fast + 1, int(raw.slow, 100, 3, 250)),
      cost: num(raw.cost, 0.001, 0, 0.05)
    },
    RISK_VERBS
  )
}
