/**
 * The finance build: the labs' maths (ledger invariants, settlement and netting, ISO 20022 checks,
 * stablecoin mechanics, VaR, Monte Carlo and Black-Scholes, backtests), the market data, lesson
 * routing to labs, simulations and primary sources, the ready roadmaps and the catalogue.
 */
import { describe, expect, it } from 'vitest'
import { CoreBank, Ledger, LedgerError, credit, dailyInterest, debit, roundHalfEven } from '../src/shared/finance/ledger'
import { bilateralNet, cardPurchase, dnsWithFailure, instant, multilateralNet, nettingSummary, rtgs, type Payment } from '../src/shared/finance/settlement'
import { EXAMPLE_PARTIES, camt053, makeIban, pacs008, pain001, readMessage, reconcile, validBic, validIban, type Transfer } from '../src/shared/finance/iso20022'
import { DEFAULT_PARAMS, depegStats, mint, redeem, redeemArbitrage, simulate } from '../src/shared/finance/stablecoin'
import {
  baselZone,
  blackScholes,
  covariance,
  historicalVar,
  kupiec,
  maxDrawdown,
  mcEuropean,
  monteCarloVar,
  normCdf,
  normInv,
  parametricVar,
  parityGap,
  portfolioVariance,
  quantile,
  returns,
  scaleVar,
  smaCrossover,
  stressTest,
  STRESS_SCENARIOS
} from '../src/shared/finance/quant'
import { bankTables, ecbCsv, fetchPlan, marketTables, parseSimpleCsv, syntheticPrices, treasuryCsv, weekdays } from '../src/shared/finance/marketData'
import { FINANCE_LABS, financeLabNote, financeLabsFor, wantsFinanceTables } from '../src/shared/finance/labs'
import { PRIMARY_PAGES, primaryPagesFor } from '../src/shared/finance/sources'
import { READY_ROADMAPS, readyRoadmapsFor } from '../src/shared/finance/roadmaps'
import { trustedSite } from '../src/shared/trustedSources'
import { simKindsFor, simLesson } from '../src/shared/sims'
import { lessonKit } from '../src/shared/subjects'
import { roadmapTopics } from '../src/shared/curriculum'
import { nextTopics } from '../src/shared/coach'
import { CATALOGUE } from '../src/shared/courseCatalogue'
import { suggestCourses } from '../src/shared/courses'
import TREASURY from '../resources/marketdata/us_treasury_yields.csv?raw'
import ECB from '../resources/marketdata/ecb_fx_rates.csv?raw'

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol)

describe('the normal distribution and Black-Scholes', () => {
  it('has the textbook values', () => {
    close(normCdf(0), 0.5, 1e-15)
    close(normCdf(1.96), 0.9750021048517795, 1e-12)
    close(normCdf(-2.326347874040841), 0.01, 1e-12)
    for (const p of [1e-6, 0.001, 0.01, 0.025, 0.3, 0.5, 0.9, 0.99, 0.999999]) close(normCdf(normInv(p)), p, 1e-12 * Math.max(1, p * 1e3))
    close(normInv(0.975), 1.959963984540054, 1e-9)
  })

  it('prices the textbook call and satisfies put-call parity', () => {
    const o = { s: 100, k: 105, t: 1, r: 0.03, sigma: 0.2 }
    close(blackScholes({ ...o, type: 'call' }).price, 7.1281, 1e-3)
    close(blackScholes({ ...o, type: 'put' }).price, 9.0249, 1e-3)
    close(parityGap(o), 0, 1e-10)
    close(parityGap({ ...o, q: 0.02, t: 2.5 }), 0, 1e-10)
    // Hull's example 15.6: S 42, K 40, r 10%, sigma 20%, 6 months: call 4.76, put 0.81
    close(blackScholes({ s: 42, k: 40, t: 0.5, r: 0.1, sigma: 0.2, type: 'call' }).price, 4.76, 0.005)
    close(blackScholes({ s: 42, k: 40, t: 0.5, r: 0.1, sigma: 0.2, type: 'put' }).price, 0.81, 0.005)
  })

  it('has Greeks that match finite differences', () => {
    const base = { s: 100, k: 95, t: 0.75, r: 0.02, sigma: 0.3, type: 'call' as const }
    const bs = blackScholes(base)
    const h = 1e-3
    close(bs.delta, (blackScholes({ ...base, s: 100 + h }).price - blackScholes({ ...base, s: 100 - h }).price) / (2 * h), 1e-6)
    close(bs.gamma, (blackScholes({ ...base, s: 100 + h }).price - 2 * bs.price + blackScholes({ ...base, s: 100 - h }).price) / (h * h), 1e-4)
    close(bs.vega, (blackScholes({ ...base, sigma: 0.3 + h }).price - blackScholes({ ...base, sigma: 0.3 - h }).price) / (2 * h), 1e-4)
  })
})

describe('Monte Carlo', () => {
  const o = { s: 100, k: 105, t: 1, r: 0.03, sigma: 0.2, type: 'call' as const }
  const exact = blackScholes(o).price

  it('converges on Black-Scholes, inside its standard error, which falls as 1/√n', () => {
    const small = mcEuropean(o, 10_000, 7)
    const big = mcEuropean(o, 160_000, 7)
    for (const m of [small, big]) expect(Math.abs(m.price - exact)).toBeLessThan(3 * m.se)
    // 16 times the paths: a quarter of the error
    close(big.se / small.se, 0.25, 0.03)
    // The running estimate ends where the final one is
    expect(big.path[big.path.length - 1].n).toBe(160_000)
  })

  it('is repeatable from its seed, and antithetic draws cut the error', () => {
    expect(mcEuropean(o, 5000, 3).price).toBe(mcEuropean(o, 5000, 3).price)
    const plain = mcEuropean(o, 50_000, 11)
    const anti = mcEuropean(o, 50_000, 11, { antithetic: true })
    expect(anti.se).toBeLessThan(plain.se)
    expect(Math.abs(anti.price - exact)).toBeLessThan(3 * anti.se)
  })
})

describe('Value at Risk', () => {
  it('takes the historical quantile as NumPy does', () => {
    const r = [-3.1, -2.2, -1.8, -1.5, -1.1, -0.8, -0.5, -0.2, 0, 0.1, 0.3, 0.4, 0.6, 0.8, 1, 1.2, 1.5, 1.9, 2.1, 2.5]
    close(historicalVar(r, 0.9).var, 1.84, 1e-12)
    close(historicalVar(r, 0.9).es, 2.65, 1e-12)
    close(quantile([1, 2, 3, 4], 0.5), 2.5, 0)
  })

  it('parametric VaR and ES follow the normal formulae; Monte Carlo converges on them', () => {
    const p = parametricVar(0, 0.012, 0.99)
    close(p.var * 1e6, 27916, 1)
    // ES at 97.5% is close to VaR at 99% for a normal (Basel's switch)
    close(parametricVar(0, 1, 0.975).es, 2.3378, 1e-3)
    const mc = monteCarloVar(0, 0.012, 0.99, 200_000, 5)
    close(mc.var, p.var, 0.0005)
    close(mc.es, p.es, 0.0006)
    close(scaleVar(p.var, 10), p.var * Math.sqrt(10), 1e-15)
  })

  it('on the synthetic prices, fat tails put the historical 99% VaR beyond the normal one', () => {
    const tidx = syntheticPrices().filter((x) => x.ticker === 'TIDX').map((x) => x.close)
    const r = returns(tidx)
    const m = r.reduce((a, b) => a + b, 0) / r.length
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1))
    expect(historicalVar(r, 0.99).var).toBeGreaterThan(parametricVar(m, sd, 0.99).var)
    expect(historicalVar(r, 0.99).es).toBeGreaterThan(historicalVar(r, 0.99).var)
  })

  it('diversifies: a two-asset portfolio’s volatility is below the weighted sum', () => {
    const a = returns(syntheticPrices().filter((x) => x.ticker === 'PAYX').map((x) => x.close))
    const b = returns(syntheticPrices().filter((x) => x.ticker === 'UTIL').map((x) => x.close))
    const cov = covariance([a, b])
    const sp = Math.sqrt(portfolioVariance([0.5, 0.5], cov))
    expect(sp).toBeLessThan(0.5 * Math.sqrt(cov[0][0]) + 0.5 * Math.sqrt(cov[1][1]))
    close(cov[0][1], cov[1][0], 1e-18)
  })

  it('backtests with Kupiec and Basel’s zones; stress tests add up', () => {
    close(kupiec(8, 250, 0.99).lr, 7.7336, 0.001)
    expect(kupiec(8, 250).reject).toBe(true)
    expect(kupiec(2, 250).reject).toBe(false)
    close(kupiec(0, 250).lr, -2 * 250 * Math.log(0.99), 1e-9)
    expect([0, 4, 5, 9, 10].map(baselZone)).toEqual(['green', 'green', 'amber', 'amber', 'red'])
    const [crash] = stressTest({ equity: 1_000_000, crypto: 100_000 }, STRESS_SCENARIOS)
    close(crash.pnl, -400_000 - 60_000, 1e-6)
    expect(crash.worst).toBe('equity')
  })
})

describe('backtests', () => {
  const prices = syntheticPrices().filter((x) => x.ticker === 'PAYX').map((x) => x.close)

  it('never looks ahead: changing tomorrow’s price changes nothing up to today', () => {
    const a = smaCrossover(prices, 20, 100, 0.001)
    const changed = [...prices]
    changed[900] *= 1.5
    const b = smaCrossover(changed, 20, 100, 0.001)
    expect(b.position.slice(0, 901)).toEqual(a.position.slice(0, 901))
    expect(b.equity.slice(0, 900)).toEqual(a.equity.slice(0, 900))
  })

  it('pays costs on every trade, and measures drawdown', () => {
    expect(smaCrossover(prices, 5, 20, 0.01).totalReturn).toBeLessThan(smaCrossover(prices, 5, 20, 0).totalReturn)
    close(maxDrawdown([1, 1.1, 0.88, 1.012]), 0.2, 1e-12)
    const flat = smaCrossover([1, 1, 1, 1, 1], 2, 3)
    expect(flat.totalReturn).toBe(0)
  })
})

describe('the double-entry ledger and the core bank', () => {
  it('refuses an unbalanced, empty or overdrawing entry and changes nothing', () => {
    const bank = new CoreBank({ capital: 100_000 })
    const ada = bank.openDeposit('Ada')
    bank.depositCash(ada, 5000)
    const before = bank.gl.trialBalance()
    expect(() => bank.gl.post('d', 'x', [debit('cash', 100), credit(ada, 99)])).toThrow(LedgerError)
    expect(() => bank.gl.post('d', 'x', [debit('cash', 100)])).toThrow(LedgerError)
    expect(() => bank.gl.post('d', 'x', [debit('cash', 1.5), credit(ada, 1.5)])).toThrow(/whole/)
    expect(() => bank.withdrawCash(ada, 5001)).toThrow(/Insufficient/)
    expect(bank.gl.trialBalance()).toEqual(before)
    expect(bank.gl.entries).toHaveLength(2)
  })

  it('keeps every invariant through a thousand random operations', () => {
    let seed = 42
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const bank = new CoreBank({ capital: 10_000_000 })
    const people = ['Ada', 'Bo', 'Chen', 'Dara'].map((p) => bank.openDeposit(p, 0.02))
    const loans: string[] = []
    let refused = 0
    for (let i = 0; i < 1000; i++) {
      const who = people[Math.floor(rand() * people.length)]
      const other = people[Math.floor(rand() * people.length)]
      const amt = 1 + Math.floor(rand() * 200_000)
      const op = Math.floor(rand() * 8)
      try {
        if (op === 0) bank.depositCash(who, amt)
        else if (op === 1) bank.withdrawCash(who, amt)
        else if (op === 2 && who !== other) bank.transfer(who, other, amt, 25)
        else if (op === 3) loans.push(bank.disburseLoan(who, amt, 0.07))
        else if (op === 4) bank.payOut(who, amt)
        else if (op === 5) bank.payIn(who, amt)
        else if (op === 6) bank.endOfDay()
        else if (loans.length) bank.repayLoan(who, loans[0], Math.min(amt, bank.gl.balance(loans[0])) || 1)
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerError)
        refused++
      }
      if (i % 50 === 0) {
        const tb = bank.gl.trialBalance()
        expect(tb.debits).toBe(tb.credits)
        expect(bank.gl.equation().holds).toBe(true)
      }
    }
    expect(refused).toBeGreaterThan(0)
    expect(bank.gl.replayMatches()).toBe(true)
    for (const p of people) expect(bank.gl.balance(p)).toBeGreaterThanOrEqual(0)
    for (const e of bank.gl.entries) expect(e.legs.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0)).toBe(e.legs.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0))
  })

  it('creates a deposit when it lends, and accrues interest with banker’s rounding', () => {
    const bank = new CoreBank()
    const bo = bank.openDeposit('Bo')
    const before = bank.deposits()
    const loan = bank.disburseLoan(bo, 300_000, 0.08)
    expect(bank.deposits() - before).toBe(300_000)
    expect(bank.gl.balance(loan)).toBe(300_000)
    expect([roundHalfEven(2.5), roundHalfEven(3.5), roundHalfEven(2.4), roundHalfEven(2.6)]).toEqual([2, 4, 2, 3])
    expect(dailyInterest(1_000_000, 0.03)).toBe(82)
    const r = bank.endOfDay()
    expect(r.accruedReceivable).toBe(dailyInterest(300_000, 0.08))
    expect(bank.date).toBe('2026-01-02')
  })

  it('a bare ledger: debit-normal and credit-normal balances', () => {
    const l = new Ledger()
    l.open({ id: 'a', name: 'Asset', type: 'asset' })
    l.open({ id: 'e', name: 'Equity', type: 'equity' })
    l.post('d', 'in', [debit('a', 500), credit('e', 500)])
    expect([l.balance('a'), l.balance('e')]).toEqual([500, 500])
  })
})

describe('settlement', () => {
  const pays = (xs: [string, string, number][]): Payment[] => xs.map(([from, to, amount], i) => ({ id: `p${i + 1}`, from, to, amount }))

  it('nets multilaterally to positions that sum to zero', () => {
    const p = pays([['A', 'B', 80], ['B', 'C', 120], ['C', 'A', 60], ['A', 'C', 30]])
    const net = multilateralNet(p)
    expect(net).toEqual({ A: -50, B: -40, C: 90 })
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0)
    const s = nettingSummary(p)
    expect(s.gross).toBe(290)
    expect(s.multilateral).toBe(90)
    expect(s.bilateral).toBe(bilateralNet(p).reduce((a, x) => a + Math.abs(x.net), 0))
    expect(s.multilateral).toBeLessThanOrEqual(s.bilateral)
    expect(s.bilateral).toBeLessThanOrEqual(s.gross)
  })

  it('gridlocks under RTGS, and settles once a bank is funded', () => {
    const p = pays([['A', 'B', 80], ['B', 'C', 120], ['C', 'A', 60]])
    const stuck = rtgs({ A: 30, B: 20, C: 10 }, p)
    expect(stuck.settled).toEqual([])
    expect(stuck.queued).toEqual(['p1', 'p2', 'p3'])
    // Netting would need only 20 more for B; gross settlement needs C funded enough to start the circle, and B to finish it
    expect(rtgs({ A: 30, B: 40, C: 10 }, p).settled).toEqual([])
    const funded = rtgs({ A: 30, B: 40, C: 70 }, p)
    expect(funded.queued).toEqual([])
    expect(funded.settled.map((s) => s.id)).toEqual(['p3', 'p1', 'p2'])
    // Money is neither made nor lost
    expect(Object.values(funded.balances).reduce((a, b) => a + b, 0)).toBe(140)
    expect(funded.balances).toEqual({ A: 10, B: 0, C: 130 })
  })

  it('unwinds a failed bank under deferred net settlement, and the unwind can take down another', () => {
    const p = pays([['A', 'B', 80], ['B', 'C', 120], ['C', 'A', 60]])
    // B can't cover its net debit of 40; without B's payments C owes 60 net and has 10: it fails too
    const r = dnsWithFailure({ A: 30, B: 20, C: 10 }, p)
    expect(r.failed).toEqual(['B', 'C'])
    expect(r.unwound.sort()).toEqual(['p1', 'p2', 'p3'])
    const fine = dnsWithFailure({ A: 30, B: 40, C: 10 }, p)
    expect(fine.failed).toEqual([])
    expect(fine.net).toEqual({ A: -20, B: -40, C: 60 })
  })

  it('rejects instant payments it can’t settle at once', () => {
    const r = instant({ A: 100, B: 0 }, pays([['A', 'B', 60], ['A', 'B', 60], ['B', 'A', 50], ['A', 'B', 5000]]), 1000)
    expect(r.accepted).toEqual(['p1', 'p3'])
    expect(r.rejected.map((x) => x.id)).toEqual(['p2', 'p4'])
    expect(r.positions).toEqual({ A: 90, B: 10 })
  })

  it('splits a card purchase so every cent is accounted for', () => {
    const c = cardPurchase(8000)
    expect([c.issuerGets, c.schemeGets, c.acquirerGets, c.msc, c.merchantGets]).toEqual([16, 4, 40, 60, 7940])
    expect(c.merchantGets + c.issuerGets + c.schemeGets + c.acquirerGets).toBe(8000)
  })
})

describe('ISO 20022', () => {
  const tx: Transfer = { endToEndId: 'E2E-1', amount: 12_550, currency: 'EUR', debtor: EXAMPLE_PARTIES.ada, creditor: EXAMPLE_PARTIES.bo, remittance: 'Invoice <77> & co' }

  it('checks IBANs and BICs', () => {
    expect(EXAMPLE_PARTIES.ada.iban).toBe('DE89370400440532013000')
    expect(EXAMPLE_PARTIES.bo.iban).toBe('FR1420041010050500013M02606')
    expect(makeIban('GB', 'NWBK60161331926819')).toBe('GB29NWBK60161331926819')
    expect(validIban('GB29 NWBK 6016 1331 9268 19')).toBe(true)
    expect(validIban('GB28NWBK60161331926819')).toBe(false)
    expect(validBic('COBADEFFXXX')).toBe(true)
    expect(validBic('COBADEFF')).toBe(true)
    expect(validBic('BNP-FR-PP')).toBe(false)
  })

  it('builds pain.001, pacs.008 and camt.053 that read back clean', () => {
    for (const xml of [pain001('M1', '2026-03-02T09:30:00', [tx, { ...tx, endToEndId: 'E2E-2', amount: 50 }]), pacs008('M2', '2026-03-02T09:31:00', '2026-03-02', [tx])]) {
      const r = readMessage(xml)
      if ('error' in r) throw new Error(r.error)
      expect(r.problems).toEqual([])
      expect(r.transfers[0]).toEqual(tx)
    }
    const st = camt053('S1', '2026-03-02T23:59:00', { iban: EXAMPLE_PARTIES.bo.iban, currency: 'EUR', owner: 'Bo' }, 125_000, [
      { amount: 30_000, side: 'CRDT', bookingDate: '2026-03-02', endToEndId: 'E2E-1' },
      { amount: 7_525, side: 'DBIT', bookingDate: '2026-03-02' },
      { amount: 150_000, side: 'DBIT', bookingDate: '2026-03-02' }
    ])
    const r = readMessage(st)
    if ('error' in r) throw new Error(r.error)
    expect(r.problems).toEqual([])
    expect(r.statement!.closing).toBe(-2525)
    expect(st).toContain('<Amt Ccy="EUR">25.25</Amt><CdtDbtInd>DBIT</CdtDbtInd>')
  })

  it('finds what a gateway would reject', () => {
    const good = pacs008('M2', '2026-03-02T09:31:00', '2026-03-02', [tx])
    const find = (xml: string) => {
      const r = readMessage(xml)
      return 'error' in r ? [r.error] : r.problems.map((p) => p.at)
    }
    expect(find(good.replace('<NbOfTxs>1<', '<NbOfTxs>2<'))).toContain('GrpHdr/NbOfTxs')
    expect(find(good.replace('>125.50</TtlIntrBkSttlmAmt>', '>135.50</TtlIntrBkSttlmAmt>'))).toContain('GrpHdr/TtlIntrBkSttlmAmt')
    expect(find(good.replace('FR14', 'FR15')).some((a) => a.endsWith('Cdtr/Acct/IBAN') || a.endsWith('CdtrAcct/IBAN'))).toBe(true)
    expect(find(good.replace('>125.50</IntrBkSttlmAmt>', '>125.500</IntrBkSttlmAmt>')).some((a) => a.includes('/Amt'))).toBe(true)
    expect(find(good.replace('<MsgId>M2</MsgId>', `<MsgId>${'X'.repeat(36)}</MsgId>`))).toContain('GrpHdr/MsgId')
    expect(find('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"/>')[0]).toMatch(/Not a pain/)
  })

  it('reconciles a statement by end-to-end id, then by amount', () => {
    const r = reconcile(
      [{ endToEndId: 'A', amount: 100 }, { endToEndId: 'B', amount: 250 }, { endToEndId: 'C', amount: 75 }],
      [
        { amount: 100, side: 'CRDT', bookingDate: 'd', endToEndId: 'A' },
        { amount: 250, side: 'CRDT', bookingDate: 'd' },
        { amount: 999, side: 'CRDT', bookingDate: 'd', endToEndId: 'Z' }
      ]
    )
    expect(r.matched).toEqual(['A', 'B'])
    expect(r.missing).toEqual(['C'])
    expect(r.unexpected.map((e) => e.amount)).toEqual([999])
  })
})

describe('stablecoins', () => {
  it('mints and redeems one for one, and arbitrage pays below the peg', () => {
    const s = { supply: 1000, cash: 1000 }
    const m = mint(s, 100, 0.001)
    close(m.supply, 1099.9, 1e-9)
    expect(m.cash).toBe(1100)
    const r = redeem(m, 99.9)
    close(r.supply, 1000, 1e-9)
    close(r.cash, 1000.1, 1e-9)
    expect(() => redeem({ supply: 10, cash: 1 }, 5)).toThrow(/cash/)
    close(redeemArbitrage(0.97, 0.001), 0.029, 1e-12)
    expect(redeemArbitrage(1, 0.001)).toBeLessThan(0)
  })

  it('holds the peg when calm, depegs and recovers when a reserve bank fails, and spirals when algorithmic', () => {
    const calm = depegStats(simulate(DEFAULT_PARAMS.calm))
    expect(calm.low).toBeGreaterThanOrEqual(0.995)
    const svb = simulate(DEFAULT_PARAMS['bank-failure'])
    const s = depegStats(svb)
    expect(s.low).toBeLessThan(0.97)
    expect(svb.filter((d) => !d.open).map((d) => d.day)).toEqual([2, 3, 4])
    expect(s.recovered).not.toBeNull()
    const run = simulate(DEFAULT_PARAMS.run)
    expect(run[run.length - 1].backing).toBeLessThan(0.99)
    const algo = depegStats(simulate(DEFAULT_PARAMS.algorithmic))
    expect(algo.low).toBeLessThan(0.1)
    expect(algo.recovered).toBeNull()
  })

  it('conserves reserves: what leaves is what was redeemed, less the fee and fire-sale losses', () => {
    const days = simulate({ ...DEFAULT_PARAMS.run, fireSale: 0 })
    for (let i = 1; i < days.length; i++) {
      const [a, b] = [days[i - 1], days[i]]
      close(a.cash + a.bills - (b.cash + b.bills), b.redeemed * (1 - DEFAULT_PARAMS.run.fee), 1e-6)
      close(a.supply - b.supply, b.redeemed, 1e-9)
    }
  })
})

describe('market data', () => {
  it('bundles the Treasury and ECB series for 2020 to 2025', () => {
    const t = parseSimpleCsv(TREASURY)
    expect(t.columns).toEqual(['date', 'y_1m', 'y_3m', 'y_6m', 'y_1y', 'y_2y', 'y_5y', 'y_10y', 'y_30y'])
    expect(t.rows.length).toBeGreaterThan(1450)
    expect(t.rows[0][0]).toBe('2020-01-02')
    expect(t.rows[t.rows.length - 1][0]).toBe('2025-12-31')
    const f = parseSimpleCsv(ECB)
    expect(f.columns[1]).toBe('usd_per_eur')
    expect(Number(f.rows[0][1])).toBeCloseTo(1.1193, 4)
    const tables = marketTables(TREASURY, ECB)
    expect(tables.map((x) => x.name)).toEqual(['assets', 'prices', 'treasury_yields', 'fx_rates'])
    for (const x of tables) for (const r of x.rows.slice(0, 50)) expect(r.length).toBe(x.columns.length)
  })

  it('makes the same synthetic prices every time, with a spring 2020 crash', () => {
    const a = syntheticPrices()
    expect(syntheticPrices()).toEqual(a)
    const tidx = a.filter((x) => x.ticker === 'TIDX')
    expect(tidx).toHaveLength(weekdays('2020-01-01', '2025-12-31').length)
    const at = (d: string) => tidx.find((x) => x.date === d)!.close
    expect(at('2020-03-20')).toBeLessThan(at('2020-02-21') * 0.8)
  })

  it('keeps the core bank’s journal balanced, entry by entry', () => {
    const [, accounts, postings] = bankTables()
    const sums = new Map<string, number>()
    for (const r of postings.rows) sums.set(r[1]!, (sums.get(r[1]!) ?? 0) + Number(r[4]))
    expect(sums.size).toBeGreaterThan(30)
    for (const v of sums.values()) expect(v).toBe(0)
    const known = new Set(accounts.rows.map((r) => r[0]))
    for (const r of postings.rows) expect(known.has(r[3])).toBe(true)
  })

  it('turns the official services’ answers into the bundled shape', () => {
    const plan = fetchPlan(2025, 2026)
    expect(plan[0].urls).toHaveLength(2)
    expect(plan[1].urls[0]).toContain('EXR/D.USD.EUR.SP00.A')
    expect(treasuryCsv(['Date,"1 Mo","1.5 Month","3 Mo","10 Yr"\n01/03/2026,4.1,4.0,4.2,4.5\n01/02/2026,4.0,4.0,4.1,4.4\n'])).toBe('date,y_1m,y_3m,y_6m,y_1y,y_2y,y_5y,y_10y,y_30y\n2026-01-02,4.0,4.1,,,,,4.4,\n2026-01-03,4.1,4.2,,,,,4.5,\n')
    const ecb = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,TITLE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-01-02,1.05,"US dollar, Euro"\n'
    expect(ecbCsv([{ currency: 'USD', text: ecb }])).toBe('date,usd_per_eur\n2026-01-02,1.05\n')
  })
})

describe('routing a lesson to its lab, simulation and sources', () => {
  it('finds the lab a topic names', () => {
    const ids = (t: string) => financeLabsFor(t).map((l) => l.id)
    expect(ids('Double-entry bookkeeping and the trial balance')).toEqual(['ledger'])
    expect(ids('Netting versus RTGS settlement')).toContain('payments')
    expect(ids('pacs.008 and camt.053 messages')).toContain('iso20022')
    expect(ids('Why USDC depegged in March 2023')).toEqual(['stablecoin'])
    expect(ids('Historical value-at-risk and expected shortfall')).toContain('var')
    expect(ids('Black-Scholes and Monte Carlo pricing')).toContain('options')
    expect(ids('Backtesting a momentum strategy')).toContain('backtest')
    for (const plain of ['Integer promotion in C', 'Variance of sums of random variables', 'let versus var in JavaScript']) expect(ids(plain), plain).toEqual([])
    expect(wantsFinanceTables('Historical value-at-risk')).toBe(true)
    expect(wantsFinanceTables('Why USDC depegged')).toBe(false)
    expect(new Set(FINANCE_LABS.map((l) => l.id)).size).toBe(FINANCE_LABS.length)
  })

  it('tells a finance lesson about its lab, its simulation and its tables, and other lessons nothing', () => {
    const kit = lessonKit('Historical value-at-risk and expected shortfall')
    expect(kit.toolkit).toContain('import tide_finance as tf')
    expect(kit.toolkit).toContain('The SQL lab holds prices')
    expect(kit.sims).toContain('- risk, on synthetic prices')
    expect(simKindsFor('Double-entry ledgers')).toEqual(['ledger'])
    expect(simKindsFor('Stablecoin depegs')).toEqual(['stablecoin'])
    expect(simLesson('ISO 20022 pacs.008')).toContain('"kind":"payments"')
    expect(lessonKit('Integer promotion in C').toolkit).not.toContain('tide_finance')
    expect(financeLabNote('The French Revolution')).toBe('')
  })

  it('reads primary texts for finance topics, every one of them trusted', () => {
    const urls = (t: string) => primaryPagesFor(t).map((x) => x.url)
    expect(urls('Stablecoin runs and depegs').some((u) => u.includes('bis.org') || u.includes('federalreserve.gov') || u.includes('newyorkfed.org'))).toBe(true)
    expect(urls('ISO 20022 pacs.008')).toContain('https://www.bis.org/cpmi/publ/d218.htm')
    expect(urls('Monte Carlo option pricing')[0]).toContain('raw.githubusercontent.com/QuantEcon')
    expect(urls('Open banking APIs').some((u) => u.includes('openbanking.org.uk'))).toBe(true)
    expect(urls('Bitcoin proof of work')).toContain('https://bitcoin.org/bitcoin.pdf')
    expect(urls('RTGS settlement').some((u) => u.includes('federalreserve.gov') || u.includes('ecb.europa.eu'))).toBe(true)
    expect(urls('Expected shortfall').some((u) => u.includes('bis.org'))).toBe(true)
    expect(urls('Stoic philosophy')).toEqual([])
    for (const p of PRIMARY_PAGES) expect(trustedSite(p.url), p.url).not.toBeNull()
    expect(trustedSite('https://raw.githubusercontent.com/QuantEcon/lecture-python-intro/main/lectures/monte_carlo.md')?.licence).toBe('CC BY-SA 4.0')
    expect(trustedSite('https://raw.githubusercontent.com/someone/else/main/x.md')).toBeNull()
  })
})

describe('the ready roadmaps', async () => {
  const { ROADMAP_TEXT } = await import('../src/main/finance/roadmaps')

  it('has one file for each, in the vault’s roadmap format, with topics, sources and a capstone', () => {
    expect(Object.keys(ROADMAP_TEXT).sort()).toEqual(READY_ROADMAPS.map((r) => r.file).sort())
    for (const r of READY_ROADMAPS) {
      const md = ROADMAP_TEXT[r.file]
      expect(r.file).toMatch(/^RM_[A-Z_]+\.md$/)
      const topics = roadmapTopics(r.title, md)
      expect(topics.length, r.id).toBeGreaterThan(20)
      expect(topics.some((t) => t.project), r.id).toBe(true)
      expect(topics.filter((t) => t.tagged === 'core').length, r.id).toBeGreaterThan(5)
      expect(md, r.id).toMatch(/^ {4}- _.+ — .+_$/m)
      const next = nextTopics(r.title, md, 50)
      expect(next.length, r.id).toBeGreaterThan(10)
      expect(next.every((t) => !/^(Practice|Project):/.test(t.topic)), r.id).toBe(true)
      // Unique ids, so ticking one off ticks only that one
      expect(new Set(topics.map((t) => t.id)).size, r.id).toBe(topics.length)
    }
  })

  it('offers the one a typed subject names, the most specific first', () => {
    expect(readyRoadmapsFor('payment infrastructure')[0].id).toBe('payment-infrastructure')
    expect(readyRoadmapsFor('Payment rails for a payments role')[0].id).toBe('payments')
    expect(readyRoadmapsFor('Open banking')[0].id).toBe('open-banking')
    expect(readyRoadmapsFor('stablecoins')[0].id).toBe('stablecoins')
    expect(readyRoadmapsFor('Stoic philosophy')).toEqual([])
    expect(readyRoadmapsFor('')).toEqual([])
  })
})

describe('the catalogue', () => {
  it('has a course for every focus subject, open banking included', () => {
    for (const id of ['open-banking-standards', 'iso20022-operators', 'banks-and-money', 'stablecoin-research', 'basel-market-risk']) expect(CATALOGUE.some((c) => c.id === id), id).toBe(true)
    const has = (q: string, id: string) => expect(suggestCourses(q, 5).map((c) => c.id), q).toContain(id)
    has('open banking', 'open-banking-standards')
    has('stablecoins', 'stablecoin-research')
    has('expected shortfall', 'basel-market-risk')
    has('money creation', 'banks-and-money')
    for (const q of ['payment rails', 'core banking', 'quantitative finance', 'value at risk', 'bitcoin', 'ethereum', 'data engineering', 'machine learning', 'economics', 'data science']) expect(suggestCourses(q, 3).length, q).toBeGreaterThan(0)
  })
})
