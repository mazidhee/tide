/**
 * Market data for the SQL and Python labs.
 *
 * Bundled with Tide (resources/marketdata, notices in THIRD_PARTY_NOTICES.md):
 * - us_treasury_yields.csv: the US Treasury's daily par yield curve, 2020 to 2025 (US government
 *   work, public domain), eight tenors in percent.
 * - ecb_fx_rates.csv: the ECB's euro reference rates against USD, GBP, JPY and CHF, 2020 to 2025
 *   (ECB statistics, free to reuse with the source named).
 *
 * Made here, the same every time (Tide's own, CC0): sample_prices, five years of daily closes for an
 * index and four made-up stocks, with volatility that clusters (GARCH(1,1)) and a crash in the
 * spring of 2020, so VaR, backtests and drawdowns have something real-looking to work on. They are
 * synthetic: say so whenever they are used.
 *
 * Fetched only when asked (fetchPlan): the same two official series, newer, from the Treasury's CSV
 * and the ECB's Data Portal API, both free, without a key, and allowed by their robots.txt.
 */
import { normals } from './quant'

export interface Table {
  name: string
  columns: string[]
  types: ('integer' | 'real' | 'text')[]
  rows: (string | null)[][]
  /** Where it came from, for the tutor and the notices */
  source: string
}

/** Weekdays from start to end inclusive (no holiday calendar: a synthetic market trades every weekday) */
export function weekdays(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T12:00:00Z`)
  const stop = new Date(`${end}T12:00:00Z`)
  while (d <= stop) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export interface SyntheticAsset {
  ticker: string
  name: string
  sector: string
  start: number
  /** Annual drift and long-run annual volatility */
  mu: number
  vol: number
  /** Exposure to the market factor */
  beta: number
}

export const SYNTHETIC_ASSETS: SyntheticAsset[] = [
  { ticker: 'TIDX', name: 'Tide Index (synthetic)', sector: 'Index', start: 1000, mu: 0.08, vol: 0.18, beta: 1 },
  { ticker: 'PAYX', name: 'Payrail Networks (synthetic)', sector: 'Payments', start: 120, mu: 0.12, vol: 0.28, beta: 1.2 },
  { ticker: 'LEDG', name: 'Ledgerline Bank (synthetic)', sector: 'Banks', start: 45, mu: 0.05, vol: 0.3, beta: 1.3 },
  { ticker: 'STBL', name: 'Stableworks (synthetic)', sector: 'Crypto infrastructure', start: 20, mu: 0.15, vol: 0.65, beta: 1.6 },
  { ticker: 'UTIL', name: 'Gridpower Utilities (synthetic)', sector: 'Utilities', start: 60, mu: 0.04, vol: 0.15, beta: 0.5 }
]

/**
 * The synthetic prices: a market factor whose variance follows GARCH(1,1) (σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁),
 * with a shock in late February and March 2020, and each stock as beta times the market plus its
 * own noise. Rounded to cents.
 */
export function syntheticPrices(seed = 20260101, start = '2020-01-01', end = '2025-12-31'): { date: string; ticker: string; close: number }[] {
  const days = weekdays(start, end)
  const z = normals(seed)
  const daily = 0.18 / Math.sqrt(252)
  const alpha = 0.09
  const beta = 0.89
  const omega = daily * daily * (1 - alpha - beta)
  let s2 = daily * daily
  let eps = 0
  const market: number[] = []
  for (const d of days) {
    s2 = omega + alpha * eps * eps + beta * s2
    const crash = d >= '2020-02-24' && d <= '2020-03-20' ? -0.025 : d >= '2020-03-24' && d <= '2020-04-30' ? 0.008 : 0
    eps = Math.sqrt(s2) * z() + crash
    market.push(eps)
  }
  const out: { date: string; ticker: string; close: number }[] = []
  for (const a of SYNTHETIC_ASSETS) {
    let p = a.start
    const own = Math.sqrt(Math.max(0, (a.vol * a.vol) / 252 - a.beta * a.beta * daily * daily))
    days.forEach((d, i) => {
      const r = a.mu / 252 + a.beta * market[i] + (a.ticker === 'TIDX' ? 0 : own * z())
      p *= Math.exp(r)
      out.push({ date: d, ticker: a.ticker, close: Math.round(p * 100) / 100 })
    })
  }
  return out
}

/** A CSV with a header row (no quoted commas: the bundled files have none) as rows of cells; '' becomes null */
export function parseSimpleCsv(text: string): { columns: string[]; rows: (string | null)[][] } {
  const lines = text.trim().split(/\r?\n/)
  const columns = (lines.shift() ?? '').split(',').map((c) => c.replace(/^"|"$/g, '').trim())
  return { columns, rows: lines.map((l) => l.split(',').map((c) => (c.trim() === '' ? null : c.trim()))) }
}

/** The lab's market tables, from the bundled CSVs' text and the generator */
export function marketTables(treasuryCsv: string, fxCsv: string): Table[] {
  const t = parseSimpleCsv(treasuryCsv)
  const f = parseSimpleCsv(fxCsv)
  const prices = syntheticPrices()
  return [
    { name: 'assets', columns: ['ticker', 'name', 'sector'], types: ['text', 'text', 'text'], rows: SYNTHETIC_ASSETS.map((a) => [a.ticker, a.name, a.sector]), source: 'Synthetic, made by Tide (CC0)' },
    { name: 'prices', columns: ['date', 'ticker', 'close'], types: ['text', 'text', 'real'], rows: prices.map((p) => [p.date, p.ticker, String(p.close)]), source: 'Synthetic daily closes made by Tide (CC0): not real market data' },
    { name: 'treasury_yields', columns: t.columns, types: t.columns.map((c) => (c === 'date' ? 'text' : 'real')), rows: t.rows, source: 'US Treasury daily par yield curve rates, percent (US government work, public domain)' },
    { name: 'fx_rates', columns: f.columns, types: f.columns.map((c) => (c === 'date' ? 'text' : 'real')), rows: f.rows, source: 'ECB euro foreign exchange reference rates (source: ECB Data Portal)' }
  ]
}

/** A small core-banking dataset for SQL: customers, accounts, a balanced journal of postings */
export function bankTables(seed = 7): Table[] {
  const u = normals(seed)
  const names = ['Ada Okafor', 'Bo Lindqvist', 'Chen Wei', 'Dara Murphy', 'Esi Mensah', 'Farah Haddad', 'Gus Romero', 'Hana Sato', 'Ife Adeyemi', 'Jon Berg']
  const customers = names.map((n, i) => [String(i + 1), n, ['GB', 'DE', 'NG', 'IE', 'GH', 'FR', 'ES', 'JP', 'NG', 'SE'][i]])
  const accounts: (string | null)[][] = [
    ['1000', 'Reserves at the central bank', 'asset', null],
    ['1100', 'Cash in the vault', 'asset', null],
    ['1200', 'Loans to customers', 'asset', null],
    ['2100', 'Interest payable', 'liability', null],
    ['3000', 'Share capital', 'equity', null],
    ['4000', 'Interest income', 'income', null],
    ['4100', 'Fee income', 'income', null],
    ['5000', 'Interest expense', 'expense', null],
    ...names.map((_, i) => [String(2001 + i), `Current account ${i + 1}`, 'liability', String(i + 1)])
  ]
  // Journal: capital, then customer deposits, transfers, fees and payments out, each one balanced
  const postings: (string | null)[][] = []
  let entry = 0
  let line = 0
  const post = (date: string, memo: string, legs: [string, number][]) => {
    entry++
    for (const [acct, amt] of legs) postings.push([String(++line), String(entry), date, acct, String(amt), memo])
  }
  post('2026-01-02', 'Capital paid in', [['1000', 5_000_000], ['3000', -5_000_000]])
  const day = (n: number) => {
    const d = new Date(Date.UTC(2026, 0, 2 + n))
    return d.toISOString().slice(0, 10)
  }
  const bal = names.map(() => 0)
  for (let i = 0; i < names.length; i++) {
    const amt = Math.round(100_000 + Math.abs(u()) * 400_000)
    post(day(1), 'Cash deposit', [['1100', amt], [String(2001 + i), -amt]])
    bal[i] += amt
  }
  for (let n = 2; n < 60; n++) {
    const a = Math.floor(Math.abs(u() * 7919) % names.length)
    const b = (a + 1 + Math.floor(Math.abs(u() * 104729) % (names.length - 1))) % names.length
    const amt = Math.min(bal[a] - 500, Math.round(5_000 + Math.abs(u()) * 40_000))
    if (amt <= 0) continue
    if (n % 7 === 0) {
      post(day(n), 'Payment to another bank', [[String(2001 + a), amt], ['1000', -amt]])
      bal[a] -= amt
    } else if (n % 11 === 0) {
      post(day(n), 'Monthly fee', [[String(2001 + a), 500], ['4100', -500]])
      bal[a] -= 500
    } else {
      post(day(n), 'Transfer', [[String(2001 + a), amt], [String(2001 + b), -amt]])
      bal[a] -= amt
      bal[b] += amt
    }
  }
  return [
    { name: 'bank_customers', columns: ['customer_id', 'name', 'country'], types: ['integer', 'text', 'text'], rows: customers, source: 'Synthetic, made by Tide (CC0)' },
    { name: 'gl_accounts', columns: ['account_id', 'name', 'type', 'customer_id'], types: ['integer', 'text', 'text', 'integer'], rows: accounts, source: 'Synthetic, made by Tide (CC0)' },
    {
      name: 'postings',
      columns: ['posting_id', 'entry_id', 'date', 'account_id', 'amount_minor', 'memo'],
      types: ['integer', 'integer', 'text', 'integer', 'integer', 'text'],
      rows: postings,
      source: 'Synthetic journal made by Tide (CC0): debits positive, credits negative, in cents; every entry sums to zero'
    }
  ]
}

/** What the tutor is told about the finance tables, one paragraph */
export const FINANCE_TABLES_NOTE =
  'Finance tables: prices(date, ticker, close) holds synthetic daily closes made by Tide for TIDX (an index), PAYX, LEDG, STBL and UTIL, 2020 to 2025 (not real market data: say so); assets(ticker, name, sector); treasury_yields(date, y_1m … y_30y) is the US Treasury par yield curve in percent; fx_rates(date, usd_per_eur, gbp_per_eur, jpy_per_eur, chf_per_eur) is the ECB reference rates. The core-banking tables: bank_customers, gl_accounts(account_id, name, type, customer_id) and postings(posting_id, entry_id, date, account_id, amount_minor, memo), a journal in cents where debits are positive and credits negative, so every entry_id sums to zero. Returns need window functions: close / LAG(close) OVER (PARTITION BY ticker ORDER BY date) - 1.'

// ---------- Fetching fresher data, when asked ----------

export interface FetchPlan {
  id: 'treasury' | 'ecb-fx'
  title: string
  /** The address of each request, in order */
  urls: string[]
  terms: string
}

/** What a fetch of the official series asks for: the Treasury's yearly CSVs and one ECB request per currency */
export function fetchPlan(fromYear: number, toYear: number): FetchPlan[] {
  const years: number[] = []
  for (let y = fromYear; y <= toYear; y++) years.push(y)
  return [
    {
      id: 'treasury',
      title: 'US Treasury daily par yield curve',
      urls: years.map((y) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`),
      terms: 'US government work, public domain'
    },
    {
      id: 'ecb-fx',
      title: 'ECB euro reference exchange rates',
      urls: ['USD', 'GBP', 'JPY', 'CHF'].map((c) => `https://data-api.ecb.europa.eu/service/data/EXR/D.${c}.EUR.SP00.A?format=csvdata&startPeriod=${fromYear}-01-01&endPeriod=${toYear}-12-31`),
      terms: 'ECB statistics may be reused free of charge with the source named (ECB Data Portal)'
    }
  ]
}

const TREASURY_COLS: Record<string, string> = { '1 Mo': 'y_1m', '3 Mo': 'y_3m', '6 Mo': 'y_6m', '1 Yr': 'y_1y', '2 Yr': 'y_2y', '5 Yr': 'y_5y', '10 Yr': 'y_10y', '30 Yr': 'y_30y' }

/** The Treasury's yearly CSVs (MM/DD/YYYY, quoted headers, tenors that come and go) as one file in the bundled shape */
export function treasuryCsv(files: string[]): string {
  const rows: string[][] = []
  for (const f of files) {
    const { columns, rows: body } = parseSimpleCsv(f)
    const at = (name: string) => columns.indexOf(name)
    for (const r of body) {
      const [m, d, y] = (r[0] ?? '').split('/')
      if (!y) continue
      rows.push([`${y}-${m}-${d}`, ...Object.keys(TREASURY_COLS).map((k) => (at(k) >= 0 ? (r[at(k)] ?? '') : ''))])
    }
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]))
  return [['date', ...Object.values(TREASURY_COLS)].join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n'
}

/** The ECB's csvdata answers (one per currency) as one file: date and a column per currency */
export function ecbCsv(files: { currency: string; text: string }[]): string {
  const by = new Map<string, Record<string, string>>()
  for (const f of files) {
    const { columns, rows } = parseSimpleCsv(f.text)
    const [ti, vi] = [columns.indexOf('TIME_PERIOD'), columns.indexOf('OBS_VALUE')]
    if (ti < 0 || vi < 0) continue
    for (const r of rows) if (r[ti] && r[vi]) (by.get(r[ti]!) ?? by.set(r[ti]!, {}).get(r[ti]!)!)[f.currency] = r[vi]!
  }
  const ccys = files.map((f) => f.currency)
  return [['date', ...ccys.map((c) => `${c.toLowerCase()}_per_eur`)].join(','), ...[...by.keys()].sort().map((d) => [d, ...ccys.map((c) => by.get(d)![c] ?? '')].join(','))].join('\n') + '\n'
}
