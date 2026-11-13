/**
 * The quant lab's maths: seeded random numbers, the normal distribution, Black-Scholes, Monte Carlo
 * pricing, Value at Risk (historical, parametric, Monte Carlo), expected shortfall, stress tests,
 * a moving-average backtest and the Kupiec test of a VaR model. Plain numbers in, plain numbers
 * out, with no library underneath, so the risk simulation, the Python helpers' tests and the
 * maths ladder all agree on one implementation. Nothing here needs SciPy.
 */

// ---------- Random numbers ----------

/** mulberry32: uniform in [0, 1), repeatable from its seed */
export function uniform(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal draws (Box–Muller, both values used) */
export function normals(seed: number): () => number {
  const u = uniform(seed)
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const s = spare
      spare = null
      return s
    }
    const r = Math.sqrt(-2 * Math.log(Math.max(u(), 1e-300)))
    const t = 2 * Math.PI * u()
    spare = r * Math.sin(t)
    return r * Math.cos(t)
  }
}

// ---------- The normal distribution ----------

/** Φ(x), the standard normal CDF (Cody's erfc, accurate to about 1e-15) */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2)
}

export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)

function erfc(x: number): number {
  // W. J. Cody's rational approximations (as in many libms), three ranges
  const z = Math.abs(x)
  let r: number
  if (z < 0.5) {
    const t = z * z
    const top = (((0.185777706184603153 * t + 3.16112374387056560) * t + 113.864154151050156) * t + 377.485237685302021) * t + 3209.37758913846947
    const bot = (((t + 23.6012909523441209) * t + 244.024637934444173) * t + 1282.61652607737228) * t + 2844.23683343917062
    r = 1 - (z * top) / bot
  } else if (z < 4) {
    const top = (((((((5.64188496988670089e-1 * z + 8.88314979438837594) * z + 66.1191906371416295) * z + 298.635138197400131) * z + 881.95222124176909) * z + 1712.04761263407058) * z + 2051.07837782607147) * z + 1230.33935479799725)
    const bot = (((((((z + 15.7449261107098347) * z + 117.693950891312499) * z + 537.181101862009858) * z + 1621.38957456669019) * z + 3290.79923573345963) * z + 4362.61909014324716) * z + 3439.36767414372164) * z + 1230.33935480374942
    r = (Math.exp(-z * z) * top) / bot
  } else {
    const t = 1 / (z * z)
    const top = (((2.23192459734184686e-2 * t + 2.78661308609647788e-1) * t + 2.26956593539686930e-1) * t + 4.94730910623250734e-2) * t + 2.99610707703542174e-3
    const bot = (((t + 1.98733201817135256) * t + 1.05167510706793207) * t + 1.91308926107829841e-1) * t + 1.06209230528467918e-2
    r = (Math.exp(-z * z) / z) * (0.564189583547756287 - (t * top) / bot)
  }
  return x < 0 ? 2 - r : r
}

/** Φ⁻¹(p), the standard normal quantile (Acklam's approximation, refined by one Halley step) */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  let x: number
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= 1 - lo) {
    const q = p - 0.5
    const r = q * q
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const e = normCdf(x) - p
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2)
  return x - u / (1 + (x * u) / 2)
}

// ---------- Statistics ----------

export const mean = (xs: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < xs.length; i++) s += xs[i]
  return xs.length ? s / xs.length : NaN
}

/** Sample standard deviation (n − 1) */
export function stdev(xs: ArrayLike<number>): number {
  const m = mean(xs)
  let s = 0
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2
  return xs.length > 1 ? Math.sqrt(s / (xs.length - 1)) : NaN
}

/**
 * The q-quantile of a sample by linear interpolation between order statistics (NumPy's default,
 * "linear", type 7), so the Python helpers and this agree to the last digit.
 */
export function quantile(xs: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(xs as ArrayLike<number>).sort()
  if (!s.length) return NaN
  const h = (s.length - 1) * Math.min(1, Math.max(0, q))
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return s[lo] + (h - lo) * (s[hi] - s[lo])
}

/** Simple returns from prices: r_t = P_t / P_{t-1} − 1 */
export function returns(prices: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 1; i < prices.length; i++) out.push(prices[i] / prices[i - 1] - 1)
  return out
}

export function logReturns(prices: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 1; i < prices.length; i++) out.push(Math.log(prices[i] / prices[i - 1]))
  return out
}

// ---------- Black-Scholes ----------

export type OptionType = 'call' | 'put'

export interface OptionInput {
  /** Spot price */
  s: number
  /** Strike */
  k: number
  /** Years to expiry */
  t: number
  /** Continuously compounded risk-free rate */
  r: number
  /** Volatility, annual */
  sigma: number
  type: OptionType
  /** Continuous dividend yield */
  q?: number
}

/** The Black-Scholes(-Merton) price and its Greeks */
export function blackScholes(o: OptionInput): { price: number; delta: number; gamma: number; vega: number; theta: number; d1: number; d2: number } {
  const q = o.q ?? 0
  if (o.t <= 0 || o.sigma <= 0) {
    const fwd = o.s * Math.exp(-q * Math.max(o.t, 0)) - o.k * Math.exp(-o.r * Math.max(o.t, 0))
    const price = o.type === 'call' ? Math.max(fwd, 0) : Math.max(-fwd, 0)
    const itm = o.type === 'call' ? fwd > 0 : fwd < 0
    return { price, delta: itm ? (o.type === 'call' ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0, d1: NaN, d2: NaN }
  }
  const sq = o.sigma * Math.sqrt(o.t)
  const d1 = (Math.log(o.s / o.k) + (o.r - q + (o.sigma * o.sigma) / 2) * o.t) / sq
  const d2 = d1 - sq
  const dq = Math.exp(-q * o.t)
  const dr = Math.exp(-o.r * o.t)
  const call = o.type === 'call'
  const price = call ? o.s * dq * normCdf(d1) - o.k * dr * normCdf(d2) : o.k * dr * normCdf(-d2) - o.s * dq * normCdf(-d1)
  const delta = call ? dq * normCdf(d1) : dq * (normCdf(d1) - 1)
  const gamma = (dq * normPdf(d1)) / (o.s * sq)
  const vega = o.s * dq * normPdf(d1) * Math.sqrt(o.t)
  const theta = call
    ? (-o.s * dq * normPdf(d1) * o.sigma) / (2 * Math.sqrt(o.t)) - o.r * o.k * dr * normCdf(d2) + q * o.s * dq * normCdf(d1)
    : (-o.s * dq * normPdf(d1) * o.sigma) / (2 * Math.sqrt(o.t)) + o.r * o.k * dr * normCdf(-d2) - q * o.s * dq * normCdf(-d1)
  return { price, delta, gamma, vega, theta, d1, d2 }
}

/** Put-call parity: C − P = S·e^(−qT) − K·e^(−rT) */
export const parityGap = (o: Omit<OptionInput, 'type'>) =>
  blackScholes({ ...o, type: 'call' }).price - blackScholes({ ...o, type: 'put' }).price - (o.s * Math.exp(-(o.q ?? 0) * o.t) - o.k * Math.exp(-o.r * o.t))

export interface McPrice {
  price: number
  /** Standard error of the estimate */
  se: number
  paths: number
  /** The running estimate after each batch, for a convergence plot */
  path: { n: number; price: number; se: number }[]
}

/**
 * A European option priced by Monte Carlo under geometric Brownian motion (one step to expiry,
 * exact), with antithetic draws when asked. The standard error shrinks as 1/√n.
 */
export function mcEuropean(o: OptionInput, n: number, seed = 1, opts: { antithetic?: boolean; batches?: number } = {}): McPrice {
  const z = normals(seed)
  const q = o.q ?? 0
  const drift = (o.r - q - (o.sigma * o.sigma) / 2) * o.t
  const vol = o.sigma * Math.sqrt(o.t)
  const disc = Math.exp(-o.r * o.t)
  const pay = (st: number) => (o.type === 'call' ? Math.max(st - o.k, 0) : Math.max(o.k - st, 0))
  const batches = Math.max(1, opts.batches ?? 20)
  const every = Math.max(1, Math.floor(n / batches))
  let sum = 0
  let sum2 = 0
  let count = 0
  const path: McPrice['path'] = []
  for (let i = 0; i < n; i++) {
    const e = z()
    let x = pay(o.s * Math.exp(drift + vol * e))
    if (opts.antithetic) x = (x + pay(o.s * Math.exp(drift - vol * e))) / 2
    sum += x
    sum2 += x * x
    count++
    if (count % every === 0 || count === n) {
      const m = sum / count
      const v = count > 1 ? (sum2 - count * m * m) / (count - 1) : 0
      path.push({ n: count, price: disc * m, se: disc * Math.sqrt(Math.max(v, 0) / count) })
    }
  }
  const last = path[path.length - 1]
  return { price: last.price, se: last.se, paths: n, path }
}

/** Paths of geometric Brownian motion, `steps` steps over `years` (each path starts at s0) */
export function gbmPaths(s0: number, mu: number, sigma: number, years: number, steps: number, paths: number, seed = 1): number[][] {
  const z = normals(seed)
  const dt = years / steps
  const drift = (mu - (sigma * sigma) / 2) * dt
  const vol = sigma * Math.sqrt(dt)
  const out: number[][] = []
  for (let p = 0; p < paths; p++) {
    const row = [s0]
    for (let i = 0; i < steps; i++) row.push(row[i] * Math.exp(drift + vol * z()))
    out.push(row)
  }
  return out
}

// ---------- Value at Risk ----------

/**
 * Value at Risk and expected shortfall are reported as positive losses, as a fraction of the
 * position (multiply by its value for money): VaR is the loss not exceeded with probability
 * `level`, ES the average loss beyond it.
 */
export interface RiskNumbers {
  var: number
  es: number
}

/** From a sample of returns: the (1 − level) quantile of the return, negated, and the mean of the returns at or below it */
export function historicalVar(rets: ArrayLike<number>, level = 0.99): RiskNumbers {
  const cut = quantile(rets, 1 - level)
  let s = 0
  let n = 0
  for (let i = 0; i < rets.length; i++)
    if (rets[i] <= cut) {
      s += rets[i]
      n++
    }
  return { var: -cut, es: n ? -s / n : -cut }
}

/** Variance-covariance (normal) VaR for a mean and volatility over the horizon: −(μ + σ·Φ⁻¹(1 − level)); ES = −μ + σ·φ(z)/(1 − level) */
export function parametricVar(mu: number, sigma: number, level = 0.99): RiskNumbers {
  const z = normInv(1 - level)
  return { var: -(mu + sigma * z), es: -mu + (sigma * normPdf(z)) / (1 - level) }
}

/** Square-root-of-time scaling of a one-day VaR (assumes independent returns with zero mean) */
export const scaleVar = (oneDay: number, days: number) => oneDay * Math.sqrt(days)

/** Monte Carlo VaR: simulate normal returns with that mean and volatility, then read the sample's quantile */
export function monteCarloVar(mu: number, sigma: number, level = 0.99, n = 10_000, seed = 1): RiskNumbers & { sample: number[] } {
  const z = normals(seed)
  const sample: number[] = []
  for (let i = 0; i < n; i++) sample.push(mu + sigma * z())
  return { ...historicalVar(sample, level), sample }
}

/** A portfolio's variance from weights and a covariance matrix: wᵀΣw */
export function portfolioVariance(w: number[], cov: number[][]): number {
  let v = 0
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) v += w[i] * w[j] * cov[i][j]
  return v
}

/** Sample covariance matrix of columns of returns (each series the same length) */
export function covariance(series: number[][]): number[][] {
  const ms = series.map(mean)
  const n = series[0]?.length ?? 0
  return series.map((a, i) =>
    series.map((b, j) => {
      let s = 0
      for (let t = 0; t < n; t++) s += (a[t] - ms[i]) * (b[t] - ms[j])
      return n > 1 ? s / (n - 1) : 0
    })
  )
}

export interface StressScenario {
  name: string
  /** Shock to each risk factor, as a return (−0.2 is a 20% fall) */
  shocks: Record<string, number>
}

/** A stress test: the portfolio's profit or loss in money under each scenario (positions are money exposures per factor) */
export function stressTest(positions: Record<string, number>, scenarios: StressScenario[]): { name: string; pnl: number; worst: string }[] {
  return scenarios.map((s) => {
    let pnl = 0
    let worst = ''
    let worstPnl = 0
    for (const [factor, exposure] of Object.entries(positions)) {
      const p = exposure * (s.shocks[factor] ?? 0)
      pnl += p
      if (p < worstPnl) [worst, worstPnl] = [factor, p]
    }
    return { name: s.name, pnl, worst }
  })
}

/** Historical-style scenarios, as round illustrative shocks (not exact historical moves) */
export const STRESS_SCENARIOS: StressScenario[] = [
  { name: 'Equity crash (2008-style)', shocks: { equity: -0.4, credit: -0.15, rates: 0.03, fx: -0.1, crypto: -0.6 } },
  { name: 'Rate shock (+200 bp, 2022-style)', shocks: { equity: -0.2, credit: -0.08, rates: -0.12, fx: 0.05, crypto: -0.5 } },
  { name: 'Pandemic week (March 2020-style)', shocks: { equity: -0.3, credit: -0.1, rates: 0.02, fx: -0.05, crypto: -0.45 } },
  { name: 'Stablecoin depeg (2023-style)', shocks: { equity: -0.02, credit: -0.01, rates: 0, fx: 0, crypto: -0.12 } }
]

// ---------- Backtesting ----------

export interface Backtest {
  /** Strategy equity, starting at 1 */
  equity: number[]
  /** Buy and hold, starting at 1 */
  hold: number[]
  /** 1 long, 0 flat, per day (decided on the day before: no look-ahead) */
  position: number[]
  trades: number
  totalReturn: number
  holdReturn: number
  /** Annualised (252 days) Sharpe ratio of daily strategy returns, rate 0 */
  sharpe: number
  maxDrawdown: number
}

/** Simple moving average of the last n values (NaN until there are n) */
export function sma(xs: ArrayLike<number>, n: number): number[] {
  const out: number[] = []
  let s = 0
  for (let i = 0; i < xs.length; i++) {
    s += xs[i]
    if (i >= n) s -= xs[i - n]
    out.push(i >= n - 1 ? s / n : NaN)
  }
  return out
}

export function maxDrawdown(equity: ArrayLike<number>): number {
  let peak = -Infinity
  let worst = 0
  for (let i = 0; i < equity.length; i++) {
    peak = Math.max(peak, equity[i])
    worst = Math.max(worst, 1 - equity[i] / peak)
  }
  return worst
}

/**
 * A moving-average crossover: long when the fast average is above the slow one at yesterday's
 * close, flat otherwise, paying `cost` (a fraction) on every change of position. The signal uses
 * only prices up to the day before the return it earns.
 */
export function smaCrossover(prices: number[], fast: number, slow: number, cost = 0): Backtest {
  const f = sma(prices, fast)
  const s = sma(prices, slow)
  const equity = [1]
  const hold = [1]
  const position = [0]
  let trades = 0
  const daily: number[] = []
  for (let t = 1; t < prices.length; t++) {
    const pos = Number.isFinite(f[t - 1]) && Number.isFinite(s[t - 1]) && f[t - 1] > s[t - 1] ? 1 : 0
    const r = prices[t] / prices[t - 1] - 1
    const changed = pos !== position[t - 1]
    if (changed) trades++
    const net = pos * r - (changed ? cost : 0)
    daily.push(net)
    equity.push(equity[t - 1] * (1 + net))
    hold.push(prices[t] / prices[0])
    position.push(pos)
  }
  const sd = stdev(daily)
  return {
    equity,
    hold,
    position,
    trades,
    totalReturn: equity[equity.length - 1] - 1,
    holdReturn: hold[hold.length - 1] - 1,
    sharpe: sd > 0 ? (mean(daily) / sd) * Math.sqrt(252) : 0,
    maxDrawdown: maxDrawdown(equity)
  }
}

/**
 * Kupiec's proportion-of-failures test of a VaR model: with x exceptions in n days at a VaR level
 * p, the likelihood ratio LR = −2 ln[(1−p)^(n−x) p^x] + 2 ln[(1−x/n)^(n−x) (x/n)^x] is χ²(1) under
 * a correct model; rejected at 95% when LR > 3.841.
 */
export function kupiec(exceptions: number, days: number, level = 0.99): { lr: number; reject: boolean; expected: number } {
  const p = 1 - level
  const x = exceptions
  const n = days
  const ll = (q: number) => (n - x) * Math.log(1 - q) + (x > 0 ? x * Math.log(q) : 0)
  const phat = x / n
  const lr = -2 * (ll(p) - (x === 0 ? n * Math.log(1) : x === n ? n * Math.log(1) : ll(phat)))
  return { lr, reject: lr > 3.841, expected: n * p }
}

/** Basel's traffic light for 250 days of 99% VaR exceptions: green 0–4, amber 5–9, red 10 or more */
export const baselZone = (exceptions: number) => (exceptions <= 4 ? 'green' : exceptions <= 9 ? 'amber' : 'red')
