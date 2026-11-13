/**
 * The finance labs' checked exercises and the tide_finance Python helper: every exercise's check
 * runs and passes, every answer is worked out again by the TypeScript labs, and the Python helper
 * gives the same numbers as the simulations. Needs a Python with NumPy and pandas (Tide's own
 * environment, TIDE_TEST_PYTHON, or python3); without one the Python parts are skipped.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { FINANCE_EXERCISES, financeBankProblems } from '../src/shared/finance/exercises'
import { trusted } from '../src/shared/bank'
import { CoreBank } from '../src/shared/finance/ledger'
import { cardPurchase, multilateralNet, nettingSummary } from '../src/shared/finance/settlement'
import { EXAMPLE_PARTIES, camt053, ibanCheckDigits, pacs008, readMessage } from '../src/shared/finance/iso20022'
import { DEFAULT_PARAMS, redeemArbitrage, simulate, type Scenario } from '../src/shared/finance/stablecoin'
import { blackScholes, historicalVar, kupiec, maxDrawdown, parametricVar, returns, smaCrossover } from '../src/shared/finance/quant'
import { syntheticPrices } from '../src/shared/finance/marketData'
import { FINANCE_HELPER, samplePricesCsv } from '../src/main/finance/helper'
import TREASURY from '../resources/marketdata/us_treasury_yields.csv?raw'
import ECB from '../resources/marketdata/ecb_fx_rates.csv?raw'

function findPython(): string | null {
  const candidates = [process.env.TIDE_TEST_PYTHON, join(homedir(), 'Library/Application Support/Tide/python/bin/python'), '/opt/homebrew/bin/python3', 'python3'].filter((x): x is string => !!x)
  for (const py of candidates) {
    try {
      execFileSync(py, ['-I', '-c', 'import numpy, pandas'], { stdio: 'ignore', timeout: 20_000 })
      return py
    } catch {
      // not this one
    }
  }
  return null
}

const PY = findPython()
const run = (code: string, cwd?: string, env: Record<string, string> = {}) => {
  const dir = cwd ?? mkdtempSync(join(tmpdir(), 'tide-fin-'))
  const file = join(dir, `run_${Math.random().toString(36).slice(2)}.py`)
  writeFileSync(file, code)
  return execFileSync(PY!, [file], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...env } })
}

describe('the finance exercises', () => {
  it('has a lab, a level, a question and a check for every exercise', () => {
    expect(new Set(FINANCE_EXERCISES.map((x) => x.id)).size).toBe(FINANCE_EXERCISES.length)
    expect(new Set(FINANCE_EXERCISES.map((x) => x.lab))).toEqual(new Set(['ledger', 'payments', 'iso20022', 'stablecoin', 'var', 'options', 'backtest']))
    for (const x of FINANCE_EXERCISES) {
      expect(x.ask.endsWith('?') || x.askType === 'code', x.id).toBe(true)
      expect(x.check, x.id).toMatch(/assert/)
      if (x.askType === 'code') expect(x.tests, x.id).toMatch(/def test_/)
    }
  })

  it('works every answer out again with the labs', () => {
    const ans = Object.fromEntries(FINANCE_EXERCISES.map((x) => [x.id, x.answer]))
    const bank = new CoreBank()
    const ada = bank.openDeposit('Ada')
    bank.depositCash(ada, 200_000)
    bank.payIn(ada, 50_000)
    bank.disburseLoan(ada, 300_000, 0.05)
    expect(bank.gl.equation().assets / 100).toBe(ans['fin-ledger-1'])
    expect(nettingSummary(['AB80', 'BC120', 'CA60', 'AC30'].map((s, i) => ({ id: String(i), from: s[0], to: s[1], amount: Number(s.slice(2)) }))).multilateral).toBe(ans['fin-pay-1'])
    const net = multilateralNet([{ id: '1', from: 'A', to: 'B', amount: 80 }, { id: '2', from: 'B', to: 'C', amount: 120 }, { id: '3', from: 'C', to: 'A', amount: 60 }])
    expect(-(20 + net.B)).toBe(ans['fin-pay-2'])
    expect(cardPurchase(8000).merchantGets / 100).toBe(ans['fin-pay-3'])
    expect(Number(ibanCheckDigits('GB', 'NWBK60161331926819'))).toBe(ans['fin-iso-1'])
    const st = readMessage(camt053('S', '2026-03-02T23:59:00', { iban: EXAMPLE_PARTIES.bo.iban, currency: 'EUR', owner: 'Bo' }, 125_000, [{ amount: 30_000, side: 'CRDT', bookingDate: 'd' }, { amount: 7_525, side: 'DBIT', bookingDate: 'd' }, { amount: 150_000, side: 'DBIT', bookingDate: 'd' }]))
    expect('statement' in st && st.statement!.closing / 100).toBe(ans['fin-iso-2'])
    expect(Math.round(redeemArbitrage(0.97, 0.001) * 100_000)).toBe(ans['fin-stable-1'])
    expect(Math.round(parametricVar(0, 0.012, 0.99).var * 1e6)).toBe(ans['fin-var-1'])
    expect(historicalVar([-3.1, -2.2, -1.8, -1.5, -1.1, -0.8, -0.5, -0.2, 0, 0.1, 0.3, 0.4, 0.6, 0.8, 1, 1.2, 1.5, 1.9, 2.1, 2.5], 0.9).var).toBeCloseTo(ans['fin-var-2']!, 10)
    expect(Math.round(kupiec(8, 250, 0.99).lr * 100) / 100).toBe(ans['fin-var-3'])
    const call = blackScholes({ s: 100, k: 105, t: 1, r: 0.03, sigma: 0.2, type: 'call' }).price
    expect(Math.round(call * 100) / 100).toBe(ans['fin-opt-1'])
    expect(Math.round(blackScholes({ s: 100, k: 105, t: 1, r: 0.03, sigma: 0.2, type: 'put' }).price * 100) / 100).toBe(ans['fin-opt-2'])
    expect(Math.round(maxDrawdown([1, 1.1, 0.88, 1.012]) * 100)).toBe(ans['fin-bt-1'])
  })

  it('reaches a lesson through the problem bank, checked and trusted, only for its topics', () => {
    const vr = financeBankProblems('Historical value-at-risk and expected shortfall')
    expect(vr.map((p) => p.id)).toEqual(['fin-var-1', 'fin-var-2', 'fin-var-3'])
    for (const p of vr) {
      expect(trusted(p)).toBe(true)
      expect(p.topic).toBe('Historical value-at-risk and expected shortfall')
      expect(p.check?.lang).toBe('python')
    }
    expect(financeBankProblems('Double-entry ledgers').find((p) => p.id === 'fin-ledger-3')?.tests).toMatch(/def test_balanced/)
    expect(financeBankProblems('The French Revolution')).toEqual([])
  })

  it.skipIf(!PY)('passes every Python check, and the code exercise’s reference passes its tests', () => {
    for (const x of FINANCE_EXERCISES) expect(() => run(x.check), x.id).not.toThrow()
    for (const x of FINANCE_EXERCISES.filter((e) => e.tests)) {
      const ref = /```python\n([\s\S]*?)```/.exec(x.solution)![1]
      const out = run(`${ref}\n${x.tests}\nimport sys\nfor name, f in list(globals().items()):\n    if name.startswith("test_"):\n        f()\nprint("passed")`)
      expect(out.trim(), x.id).toBe('passed')
    }
  })
})

describe.skipIf(!PY)('the tide_finance Python helper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tide-fin-helper-'))
  writeFileSync(join(dir, 'tide_finance.py'), FINANCE_HELPER)
  mkdirSync(join(dir, 'tide_market'))
  writeFileSync(join(dir, 'tide_market', 'us_treasury_yields.csv'), TREASURY)
  writeFileSync(join(dir, 'tide_market', 'ecb_fx_rates.csv'), ECB)
  writeFileSync(join(dir, 'tide_market', 'sample_prices.csv'), samplePricesCsv())

  it('gives the same numbers as the labs', () => {
    const tx = { endToEndId: 'E1', amount: 12_550, currency: 'EUR', debtor: EXAMPLE_PARTIES.ada, creditor: EXAMPLE_PARTIES.bo }
    const broken = pacs008('M1', '2026-03-02T09:30:00', '2026-03-02', [tx]).replace('FR14', 'FR15')
    const code = `import json, tide_finance as tf
prices = tf.sample_prices("TIDX")
r = prices.pct_change().dropna()
pays = [("A", "B", 80), ("B", "C", 120), ("C", "A", 60), ("A", "C", 30)]
bank = tf.CoreBank(capital=500000)
a = bank.open_deposit("Ada"); b = bank.open_deposit("Bo", rate=0.02)
bank.deposit_cash(a, 200000); bank.transfer(a, b, 50000); bank.disburse_loan(b, 300000, 0.08)
eod = bank.end_of_day()
print(json.dumps({
  "bs": tf.black_scholes(100, 105, 1, 0.03, 0.2, "call")["price"],
  "put": tf.black_scholes(100, 105, 1, 0.03, 0.2, "put")["price"],
  "pvar": tf.parametric_var(0, 0.012, 0.99),
  "hvar": tf.historical_var(r, 0.99),
  "net": tf.multilateral_net(pays),
  "summary": tf.netting_summary(pays),
  "rtgs": tf.rtgs({"A": 30, "B": 40, "C": 70}, [("A", "B", 80), ("B", "C", 120), ("C", "A", 60)]),
  "card": tf.card_purchase(8000),
  "iban": [tf.valid_iban("DE89370400440532013000"), tf.valid_iban("DE88370400440532013000"), tf.make_iban("GB", "NWBK60161331926819")],
  "problems": tf.read_message(${JSON.stringify(broken)})["problems"],
  "stable": {s: [d["price"] for d in tf.stablecoin(s)] for s in ["calm", "bank-failure", "run", "algorithmic"]},
  "backtest": tf.sma_crossover(tf.sample_prices("PAYX"), 20, 100, 0.001)["total_return"],
  "eod": eod, "balanced": bank.gl.balanced(),
  "curve": float(tf.treasury_yields()["y_10y"].iloc[0]),
  "fx": float(tf.fx_rates()["usd_per_eur"].iloc[0]),
  "mc": tf.mc_european(100, 105, 1, 0.03, 0.2, "call", n=200000),
  "scipy": tf.HAVE_SCIPY
}))`
    const out = JSON.parse(run(code, dir))
    const exact = blackScholes({ s: 100, k: 105, t: 1, r: 0.03, sigma: 0.2, type: 'call' })
    expect(out.bs).toBeCloseTo(exact.price, 10)
    expect(out.put).toBeCloseTo(blackScholes({ s: 100, k: 105, t: 1, r: 0.03, sigma: 0.2, type: 'put' }).price, 10)
    expect(out.pvar.var).toBeCloseTo(parametricVar(0, 0.012, 0.99).var, 10)
    expect(out.pvar.es).toBeCloseTo(parametricVar(0, 0.012, 0.99).es, 10)
    const r = returns(syntheticPrices().filter((x) => x.ticker === 'TIDX').map((x) => x.close))
    expect(out.hvar.var).toBeCloseTo(historicalVar(r, 0.99).var, 10)
    expect(out.hvar.es).toBeCloseTo(historicalVar(r, 0.99).es, 10)
    expect(out.net).toEqual({ A: -50, B: -40, C: 90 })
    expect(out.summary.multilateral).toBe(90)
    expect(out.summary.gross).toBe(290)
    expect(out.rtgs.queued).toEqual([])
    expect(out.rtgs.balances).toEqual({ A: 10, B: 0, C: 130 })
    expect(out.card).toEqual({ msc: 60, merchant_gets: 7940, issuer_gets: 16, scheme_gets: 4, acquirer_gets: 40 })
    expect(out.iban).toEqual([true, false, 'GB29NWBK60161331926819'])
    expect(out.problems.some((p: string) => p.includes('FR15'))).toBe(true)
    for (const s of ['calm', 'bank-failure', 'run', 'algorithmic'] as Scenario[]) {
      const ts = simulate(DEFAULT_PARAMS[s]).map((d) => d.price)
      expect(out.stable[s].length).toBe(ts.length)
      out.stable[s].forEach((v: number, i: number) => expect(v, `${s} day ${i}`).toBeCloseTo(ts[i], 9))
    }
    expect(out.backtest).toBeCloseTo(smaCrossover(syntheticPrices().filter((x) => x.ticker === 'PAYX').map((x) => x.close), 20, 100, 0.001).totalReturn, 9)
    // The core bank: same accruals as the TypeScript one
    const bank = new CoreBank({ capital: 500_000 })
    const a = bank.openDeposit('Ada')
    const b = bank.openDeposit('Bo', 0.02)
    bank.depositCash(a, 200_000)
    bank.transfer(a, b, 50_000)
    bank.disburseLoan(b, 300_000, 0.08)
    const eod = bank.endOfDay()
    expect(out.eod).toEqual({ accrued_payable: eod.accruedPayable, accrued_receivable: eod.accruedReceivable })
    expect(out.balanced).toBe(true)
    expect(out.curve).toBe(1.88)
    expect(out.fx).toBe(1.1193)
    expect(Math.abs(out.mc.price - exact.price)).toBeLessThan(3 * out.mc.se)
    expect(typeof out.scipy).toBe('boolean')
  })

  it('runs every lab’s example code as written', async () => {
    const { FINANCE_LABS } = await import('../src/shared/finance/labs')
    for (const lab of FINANCE_LABS) expect(() => run(lab.python, dir), lab.id).not.toThrow()
  })

  it('says plainly when the data isn’t there', () => {
    const bare = mkdtempSync(join(tmpdir(), 'tide-fin-bare-'))
    writeFileSync(join(bare, 'tide_finance.py'), FINANCE_HELPER)
    expect(existsSync(join(bare, 'tide_market'))).toBe(false)
    expect(run('import tide_finance as tf\ntry:\n    tf.sample_prices()\nexcept FileNotFoundError as e:\n    print("missing:", e)', bare)).toMatch(/missing: sample_prices.csv/)
  })
})
