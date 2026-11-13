/**
 * Checked exercises for the finance labs, written once and shipped with Tide, so every lab has
 * problems ready without Claude (Gemma's lessons draw on them through the problem bank) and Claude
 * has worked examples to vary. Each has its solution and a Python check that works the answer out
 * from scratch and asserts it (plain Python, no SciPy); test/financeExercises.test.ts runs every
 * check, and works each answer out again with the TypeScript labs.
 */
import type { BankProblem, Level } from '../bank'
import { BANK_VERSION } from '../bank'
import { financeLabsFor, type FinanceLabId } from './labs'

export interface FinanceExercise {
  id: string
  lab: FinanceLabId
  level: Level
  text: string
  ask: string
  askType: BankProblem['askType']
  solution: string
  /** Python that recomputes the answer and asserts it */
  check: string
  /** The answer as a number, for the tests */
  answer?: number
  /** code problems: pytest tests */
  tests?: string
}

export const FINANCE_EXERCISES: FinanceExercise[] = [
  // ---------- Ledger and core banking ----------
  {
    id: 'fin-ledger-1',
    lab: 'ledger',
    level: 1,
    text: 'A new bank has no capital. Ada pays in $2,000 in cash. Later that day a $500 payment from another bank arrives for her, settled in central-bank reserves. Then the bank lends her $3,000, paid into her current account.',
    ask: 'What are the bank’s total assets at the end of the day, in dollars?',
    askType: 'problem',
    solution: 'Each step is a balanced entry. Cash +2,000 (asset) against her deposit +2,000 (liability); reserves +500 against her deposit +500; loan +3,000 (asset) against her deposit +3,000. Assets: cash 2,000 + reserves 500 + loan 3,000 = **$5,500**, equal to her deposit of 5,500, so assets = liabilities + equity (0).',
    check: `cash, reserves, loan = 2000, 500, 3000
deposit = 2000 + 500 + 3000
assets = cash + reserves + loan
assert assets == deposit == 5500
print(assets)`,
    answer: 5500
  },
  {
    id: 'fin-ledger-2',
    lab: 'ledger',
    level: 2,
    text: 'A savings account holds $10,000.00 at 3% a year. The core accrues interest every night on an actual/365 basis, rounding each night’s interest to the cent with banker’s rounding (half to even). The balance doesn’t change for 30 nights (interest is accrued, not added).',
    ask: 'How much interest is accrued over the 30 nights, in cents, and how far is that from the unrounded figure?',
    askType: 'problem',
    solution: 'One night: 1,000,000 cents × 0.03 / 365 = 82.19 cents, rounded to 82. Thirty nights: **2,460 cents ($24.60)**. Unrounded: 1,000,000 × 0.03 × 30 / 365 = 2,465.75 cents, so daily rounding loses 5.75 cents. Real cores carry the fraction forward (or accrue at higher precision) to avoid that drift.',
    check: `per_night = round(1_000_000 * 0.03 / 365)
total = per_night * 30
assert per_night == 82 and total == 2460
assert abs(1_000_000 * 0.03 * 30 / 365 - total - 5.75) < 0.01
print(total)`,
    answer: 2460
  },
  {
    id: 'fin-ledger-3',
    lab: 'ledger',
    level: 2,
    text: 'A journal is a list of entries; each entry is a list of legs `(account, amount)` in cents, with debits positive and credits negative. A posting service must refuse any entry whose legs don’t sum to zero, or that has fewer than two legs, or any leg of zero.',
    ask: 'Write `valid_entry(legs)` returning True only for an entry the service may post.',
    askType: 'code',
    solution: '```python\ndef valid_entry(legs):\n    return len(legs) >= 2 and all(a != 0 for _, a in legs) and sum(a for _, a in legs) == 0\n```',
    check: `def valid_entry(legs):
    return len(legs) >= 2 and all(a != 0 for _, a in legs) and sum(a for _, a in legs) == 0
assert valid_entry([("cash", 500), ("deposit", -500)])
assert not valid_entry([("cash", 500), ("deposit", -400)])
assert not valid_entry([("cash", 0), ("deposit", 0)])
print("ok")`,
    tests: `def test_balanced():
    assert valid_entry([("cash", 500), ("deposit:ada", -500)])

def test_three_legs():
    assert valid_entry([("deposit:ada", 1050), ("deposit:bo", -1000), ("fee-income", -50)])

def test_unbalanced():
    assert not valid_entry([("cash", 500), ("deposit:ada", -499)])

def test_one_leg():
    assert not valid_entry([("cash", 0)])

def test_zero_leg():
    assert not valid_entry([("cash", 0), ("deposit:ada", 0)])`
  },
  // ---------- Payments and settlement ----------
  {
    id: 'fin-pay-1',
    lab: 'payments',
    level: 1,
    text: 'Three banks send these payments during the day: A pays B 80, B pays C 120, C pays A 60, A pays C 30 (millions).',
    ask: 'Under multilateral net settlement at the end of the day, how much central-bank money moves in total (the sum of the net debits)?',
    askType: 'problem',
    solution: 'Net positions (received − sent): A = 60 − 80 − 30 = −50; B = 80 − 120 = −40; C = 120 + 30 − 60 = +90. They sum to zero. A pays in 50 and B 40, C receives 90: **90 million** moves, against 290 gross, a saving of about 69%.',
    check: `pays = [("A", "B", 80), ("B", "C", 120), ("C", "A", 60), ("A", "C", 30)]
net = {}
for f, t, a in pays:
    net[f] = net.get(f, 0) - a
    net[t] = net.get(t, 0) + a
assert sum(net.values()) == 0
moved = sum(-v for v in net.values() if v < 0)
assert moved == 90
print(moved)`,
    answer: 90
  },
  {
    id: 'fin-pay-2',
    lab: 'payments',
    level: 2,
    text: 'In an RTGS system, bank A holds 30, B holds 20 and C holds 10 in reserves. Queued are: A pays B 80, B pays C 120, C pays A 60. None can settle alone: the system is gridlocked. The operator runs a liquidity-saving mechanism that settles the queue simultaneously, needing each bank only to cover its net position.',
    ask: 'Which bank cannot cover its net position, and by how much is it short?',
    askType: 'problem',
    solution: 'Net positions: A = 60 − 80 = −20, B = 80 − 120 = −40, C = 120 − 60 = +60. A has 30 ≥ 20, fine. **B has 20 but needs 40: short by 20.** C receives. With 20 more for B (intraday credit, or a payment held back) the whole queue settles at once.',
    check: `res = {"A": 30, "B": 20, "C": 10}
pays = [("A", "B", 80), ("B", "C", 120), ("C", "A", 60)]
net = {b: 0 for b in res}
for f, t, a in pays:
    net[f] -= a
    net[t] += a
short = {b: -(res[b] + net[b]) for b in res if res[b] + net[b] < 0}
assert short == {"B": 20}
print(short)`,
    answer: 20
  },
  {
    id: 'fin-pay-3',
    lab: 'payments',
    level: 1,
    text: 'A shopper pays €80.00 by consumer debit card in the EU. Interchange is capped at 0.2%; the scheme’s fee is 0.05% and the acquirer keeps 0.5% (each rounded to the cent).',
    ask: 'How much does the merchant receive, in euros?',
    askType: 'problem',
    solution: 'In cents: 8,000 × 0.002 = 16 (to the issuer), 8,000 × 0.0005 = 4 (scheme), 8,000 × 0.005 = 40 (acquirer). The merchant service charge is 60 cents, so the merchant gets **€79.40**.',
    check: `amount = 8000
msc = sum(int(amount * x + 0.5) for x in (0.002, 0.0005, 0.005))
assert msc == 60
print((amount - msc) / 100)`,
    answer: 79.4
  },
  // ---------- ISO 20022 ----------
  {
    id: 'fin-iso-1',
    lab: 'iso20022',
    level: 2,
    text: 'An IBAN is the country code, two check digits, then the BBAN. The check digits are found by moving the country code and "00" to the end of the BBAN, turning letters into numbers (A = 10 … Z = 35), and taking 98 minus the remainder mod 97. A UK account has the BBAN NWBK60161331926819.',
    ask: 'What are its two check digits?',
    askType: 'problem',
    solution: 'Rearranged: NWBK60161331926819 GB00 → 23 32 11 20 60161331926819 16 11 00. That number mod 97 is 69, and 98 − 69 = **29**: the IBAN is GB29 NWBK 6016 1331 9268 19. Check: moving GB29 to the end and taking mod 97 gives 1.',
    check: `def num(s):
    return int("".join(c if c.isdigit() else str(ord(c) - 55) for c in s))
check = 98 - num("NWBK60161331926819" + "GB00") % 97
assert check == 29
assert num("NWBK60161331926819" + "GB29") % 97 == 1
print(check)`,
    answer: 29
  },
  {
    id: 'fin-iso-2',
    lab: 'iso20022',
    level: 2,
    text: 'An end-of-day camt.053 statement shows an opening booked balance (OPBD) of 1,250.00 EUR in credit and three booked entries: CRDT 300.00, DBIT 75.25, DBIT 1,500.00.',
    ask: 'What is the closing booked balance (CLBD), with its credit or debit indicator?',
    askType: 'problem',
    solution: '1,250.00 + 300.00 − 75.25 − 1,500.00 = −25.25: the closing balance is **25.25 EUR with CdtDbtInd DBIT** (overdrawn). A statement whose CLBD isn’t opening plus entries is rejected by reconciliation.',
    check: `from decimal import Decimal as D
close = D("1250.00") + D("300.00") - D("75.25") - D("1500.00")
assert close == D("-25.25")
print(close)`,
    answer: -25.25
  },
  // ---------- Stablecoins ----------
  {
    id: 'fin-stable-1',
    lab: 'stablecoin',
    level: 1,
    text: 'A stablecoin trades at $0.97 on an exchange. The issuer redeems any coin for $1.00 less a 0.1% fee, and redemptions are open.',
    ask: 'What is the arbitrage profit on 100,000 coins bought on the exchange and redeemed, in dollars (ignoring other costs)?',
    askType: 'problem',
    solution: 'Per coin: 1 − 0.001 − 0.97 = $0.029. On 100,000 coins: **$2,900**. That buying is what pulls the price back towards $1, as long as redemptions stay open and the reserves are good.',
    check: `profit = round((1 - 0.001 - 0.97) * 100_000, 6)
assert abs(profit - 2900) < 1e-6
print(profit)`,
    answer: 2900
  },
  {
    id: 'fin-stable-2',
    lab: 'stablecoin',
    level: 3,
    text: 'An issuer has 1,000m coins outstanding, backed by 100m in bank deposits and 900m in Treasury bills. In one day 300m coins are redeemed (no fee). Deposits are used first; the rest is raised by selling bills in a hurry at a 5% discount to their value.',
    ask: 'What is the backing per coin left after the day (reserves at value ÷ coins), to three decimal places?',
    askType: 'problem',
    solution: 'Deposits pay 100m. The other 200m needs bills worth 200 / 0.95 = 210.53m. Bills left: 900 − 210.53 = 689.47m; coins left: 700m. Backing: 689.47 / 700 = **0.985**. The run itself made the coin less than fully backed: the fire-sale loss falls on the holders who stay.',
    check: `need = 300 - 100
sold = need / 0.95
backing = (900 - sold) / 700
assert abs(backing - 0.98496) < 1e-4
print(round(backing, 3))`,
    answer: 0.985
  },
  // ---------- Value at Risk ----------
  {
    id: 'fin-var-1',
    lab: 'var',
    level: 1,
    text: 'A $1,000,000 position has daily returns with mean 0 and standard deviation 1.2%, taken as normal. Φ⁻¹(0.01) = −2.3263.',
    ask: 'What is its one-day 99% parametric VaR, to the nearest dollar?',
    askType: 'problem',
    solution: 'VaR = −(μ + σ·Φ⁻¹(0.01)) × value = 2.3263 × 0.012 × 1,000,000 ≈ **$27,916**. Over 10 days, by the square-root-of-time rule, about $88,278 (which assumes independent returns).',
    check: `import math
def norm_cdf(x):
    return 0.5 * math.erfc(-x / math.sqrt(2))
lo, hi = -5.0, 0.0
for _ in range(200):
    mid = (lo + hi) / 2
    lo, hi = (mid, hi) if norm_cdf(mid) < 0.01 else (lo, mid)
var = -lo * 0.012 * 1_000_000
assert abs(var - 27916) < 1
print(round(var))`,
    answer: 27916
  },
  {
    id: 'fin-var-2',
    lab: 'var',
    level: 2,
    text: 'Twenty daily returns, sorted: −3.1%, −2.2%, −1.8%, −1.5%, −1.1%, −0.8%, −0.5%, −0.2%, 0.0%, 0.1%, 0.3%, 0.4%, 0.6%, 0.8%, 1.0%, 1.2%, 1.5%, 1.9%, 2.1%, 2.5%. Use the 10% quantile with linear interpolation between order statistics (NumPy’s default: position (n − 1) × q, counting from 0).',
    ask: 'What is the 90% one-day historical VaR, in percent?',
    askType: 'problem',
    solution: 'Position (20 − 1) × 0.1 = 1.9: between the 2nd and 3rd smallest (indices 1 and 2), −2.2% + 0.9 × (−1.8 − (−2.2))% = −1.84%. VaR is the loss: **1.84%**. The expected shortfall, the average of returns at or below that, is (3.1 + 2.2) / 2 = 2.65%.',
    check: `r = sorted([-3.1, -2.2, -1.8, -1.5, -1.1, -0.8, -0.5, -0.2, 0.0, 0.1, 0.3, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 1.9, 2.1, 2.5])
h = (len(r) - 1) * 0.1
lo = int(h)
q = r[lo] + (h - lo) * (r[lo + 1] - r[lo])
assert abs(-q - 1.84) < 1e-9
print(round(-q, 2))`,
    answer: 1.84
  },
  {
    id: 'fin-var-3',
    lab: 'var',
    level: 3,
    text: 'A bank’s 99% one-day VaR model was exceeded on 8 of the last 250 days. Kupiec’s test compares LR = −2 ln[(1 − p)^(n − x) p^x] + 2 ln[(1 − x/n)^(n − x) (x/n)^x] with 3.841 (χ²(1) at 95%), where p = 0.01.',
    ask: 'What is LR, to two decimal places, and is the model rejected? Which Basel traffic-light zone is it in?',
    askType: 'problem',
    solution: 'n = 250, x = 8, x/n = 0.032. ln L₀ = 242 ln 0.99 + 8 ln 0.01 = −39.274; ln L₁ = 242 ln 0.968 + 8 ln 0.032 = −35.407. LR = −2(−39.274 + 35.407) ≈ **7.73 > 3.841: rejected**. Basel’s zones for 250 days are green 0–4, amber 5–9, red 10+: **amber**, so the capital multiplier is raised.',
    check: `import math
n, x, p = 250, 8, 0.01
ll0 = (n - x) * math.log(1 - p) + x * math.log(p)
ll1 = (n - x) * math.log(1 - x / n) + x * math.log(x / n)
lr = -2 * (ll0 - ll1)
assert abs(lr - 7.73) < 0.01 and lr > 3.841
print(round(lr, 2))`,
    answer: 7.73
  },
  // ---------- Options and Monte Carlo ----------
  {
    id: 'fin-opt-1',
    lab: 'options',
    level: 2,
    text: 'A European call: spot 100, strike 105, one year, risk-free rate 3% (continuous), volatility 20%, no dividends.',
    ask: 'What is its Black-Scholes price, to two decimal places?',
    askType: 'problem',
    solution: 'd₁ = [ln(100/105) + (0.03 + 0.02) × 1] / 0.2 = 0.00605, d₂ = −0.19395. C = 100 Φ(0.00605) − 105 e^(−0.03) Φ(−0.19395) = 100 × 0.50241 − 101.8968 × 0.42311 ≈ **7.13**.',
    check: `import math
N = lambda x: 0.5 * math.erfc(-x / math.sqrt(2))
s, k, t, r, v = 100, 105, 1, 0.03, 0.2
d1 = (math.log(s / k) + (r + v * v / 2) * t) / (v * math.sqrt(t))
d2 = d1 - v * math.sqrt(t)
c = s * N(d1) - k * math.exp(-r * t) * N(d2)
assert abs(c - 7.1281) < 1e-3
print(round(c, 2))`,
    answer: 7.13
  },
  {
    id: 'fin-opt-2',
    lab: 'options',
    level: 2,
    text: 'The call above (spot 100, strike 105, one year, r = 3%, σ = 20%) costs 7.1281.',
    ask: 'Using put-call parity, what is the price of the put with the same strike and expiry, to two decimal places?',
    askType: 'problem',
    solution: 'C − P = S − K e^(−rT), so P = C − S + K e^(−rT) = 7.1281 − 100 + 105 e^(−0.03) = 7.1281 − 100 + 101.8968 = **9.02**.',
    check: `import math
p = 7.1281 - 100 + 105 * math.exp(-0.03)
assert abs(p - 9.0249) < 1e-3
print(round(p, 2))`,
    answer: 9.02
  },
  {
    id: 'fin-opt-3',
    lab: 'options',
    level: 3,
    text: 'A Monte Carlo pricer gives a standard error of 0.14 with 10,000 paths. The standard error of a Monte Carlo mean falls as 1/√n.',
    ask: 'How many paths are needed for a standard error of 0.01?',
    askType: 'problem',
    solution: 'SE ∝ 1/√n, so n = 10,000 × (0.14 / 0.01)² = 10,000 × 196 = **1,960,000** paths. Variance reduction (antithetic draws, control variates) is how real pricers get there with fewer.',
    check: `n = 10_000 * (0.14 / 0.01) ** 2
assert round(n) == 1_960_000
print(round(n))`,
    answer: 1960000
  },
  // ---------- Backtests ----------
  {
    id: 'fin-bt-1',
    lab: 'backtest',
    level: 1,
    text: 'A strategy’s equity starts at 1.00 and earns +10%, then −20%, then +15% over three months.',
    ask: 'What is its maximum drawdown, in percent, and its final equity?',
    askType: 'problem',
    solution: 'Equity: 1.00 → 1.10 → 0.88 → 1.012. The peak before the fall is 1.10, the trough 0.88: drawdown 1 − 0.88/1.10 = **20%**. Final equity **1.012** (+1.2%), though the arithmetic average return is +1.67%: returns compound, they don’t add.',
    check: `eq = [1.0]
for r in (0.10, -0.20, 0.15):
    eq.append(eq[-1] * (1 + r))
peak, dd = 0, 0
for e in eq:
    peak = max(peak, e)
    dd = max(dd, 1 - e / peak)
assert abs(dd - 0.20) < 1e-12 and abs(eq[-1] - 1.012) < 1e-12
print(round(dd * 100, 6), round(eq[-1], 3))`,
    answer: 20
  }
]

/** The built-in exercises for a lesson topic, as problem-bank problems (checked and reviewed when written) */
export function financeBankProblems(topic: string, now = 0): BankProblem[] {
  const labs = new Set(financeLabsFor(topic).map((l) => l.id))
  return FINANCE_EXERCISES.filter((x) => labs.has(x.lab)).map((x) => ({
    id: x.id,
    topic,
    level: x.level,
    text: x.text,
    ask: x.ask,
    askType: x.askType,
    solution: x.solution,
    check: { lang: 'python', code: x.check },
    ...(x.tests ? { lang: 'python', tests: x.tests } : {}),
    checked: true,
    reviewed: true,
    source: 'prep' as const,
    createdAt: now,
    v: BANK_VERSION
  }))
}
