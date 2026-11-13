/**
 * The maths behind the explorables (kinds/explore): numbers in, numbers out, no window, so every
 * picture an explorable draws can be tested against the theory it shows.
 *   calculus     secant slopes and their limit, Riemann sums, one-sided limits
 *   linear maps  where a vector lands, the angle between v and Av (eigen in geometry.ts)
 *   probability  densities and masses of five distributions, sampling, sample means, Bayes
 *   stochastic   random walks, Brownian motion, geometric Brownian motion
 *   statistics   least squares with residuals, confidence intervals over repeated samples
 */
import { apply, type Matrix2, type V2 } from './geometry'
import { gaussian } from './rng'

export type Fn = (x: number) => number

// ---------- Calculus ----------

/** The slope of the secant through (x, f(x)) and (x + h, f(x + h)) */
export const secantSlope = (f: Fn, x: number, h: number) => (h === 0 ? NaN : (f(x + h) - f(x)) / h)

/** The derivative, numerically: a central difference with a step that suits x */
export function derivative(f: Fn, x: number): number {
  const h = 1e-5 * Math.max(1, Math.abs(x))
  return (f(x + h) - f(x - h)) / (2 * h)
}

/** Secant slopes as h is halved, the table a limit is read from */
export function secantTable(f: Fn, x: number, h0: number, rows = 6): { h: number; slope: number }[] {
  return Array.from({ length: rows }, (_, i) => {
    const h = h0 / 2 ** i
    return { h, slope: secantSlope(f, x, h) }
  })
}

export type RiemannRule = 'left' | 'right' | 'mid' | 'trapezoid'

/** The rectangles (or trapezoids) of a Riemann sum over [a, b] in n pieces, and their total */
export function riemann(f: Fn, a: number, b: number, n: number, rule: RiemannRule): { sum: number; pieces: { x0: number; x1: number; h0: number; h1: number }[] } {
  const w = (b - a) / n
  const pieces: { x0: number; x1: number; h0: number; h1: number }[] = []
  let sum = 0
  for (let i = 0; i < n; i++) {
    const x0 = a + i * w
    const x1 = x0 + w
    let h0: number
    let h1: number
    if (rule === 'trapezoid') {
      h0 = f(x0)
      h1 = f(x1)
      sum += ((h0 + h1) / 2) * w
    } else {
      const at = rule === 'left' ? x0 : rule === 'right' ? x1 : x0 + w / 2
      h0 = h1 = f(at)
      sum += h0 * w
    }
    pieces.push({ x0, x1, h0, h1 })
  }
  return { sum, pieces }
}

/** The integral over [a, b], by composite Simpson's rule on many pieces: the "exact" area the sums approach */
export function integral(f: Fn, a: number, b: number, n = 2000): number {
  const m = n % 2 ? n + 1 : n
  const w = (b - a) / m
  let s = f(a) + f(b)
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * f(a + i * w)
  return (s * w) / 3
}

/** f just left and just right of a, at distance d, and whether the two sides agree there */
export function oneSided(f: Fn, a: number, d: number): { left: number; right: number; gap: number } {
  const left = f(a - d)
  const right = f(a + d)
  return { left, right, gap: Math.abs(right - left) }
}

// ---------- Linear maps ----------

/** The angle in degrees from v to Av (0 or 180 when v is an eigenvector) */
export function turnAngle(m: Matrix2, v: V2): number {
  const w = apply(m, v)
  const a = Math.atan2(v[0] * w[1] - v[1] * w[0], v[0] * w[0] + v[1] * w[1])
  return (a * 180) / Math.PI
}

/** Whether v stays on its own line under m (within a tolerance in degrees), and by what factor */
export function staysOnLine(m: Matrix2, v: V2, tol = 2): { on: boolean; factor: number } {
  const w = apply(m, v)
  const a = Math.abs(turnAngle(m, v))
  const len = Math.hypot(v[0], v[1])
  const on = len > 1e-9 && Math.hypot(w[0], w[1]) > 1e-9 ? a <= tol || a >= 180 - tol : Math.hypot(w[0], w[1]) < 1e-9
  const factor = len > 1e-9 ? (Math.sign(v[0] * w[0] + v[1] * w[1]) || 1) * (Math.hypot(w[0], w[1]) / len) : 0
  return { on, factor }
}

// ---------- Probability ----------

export type DistName = 'normal' | 'binomial' | 'poisson' | 'exponential' | 'lognormal' | 'uniform'
export interface DistParams {
  mu: number
  sigma: number
  n: number
  p: number
  lambda: number
  a: number
  b: number
}

export const DEFAULT_DIST: DistParams = { mu: 0, sigma: 1, n: 10, p: 0.5, lambda: 3, a: 0, b: 1 }

export const isDiscrete = (d: DistName) => d === 'binomial' || d === 'poisson'

function logFactorial(k: number): number {
  let s = 0
  for (let i = 2; i <= k; i++) s += Math.log(i)
  return s
}

/** The error function (Abramowitz and Stegun 7.1.26, |error| < 1.5e-7) */
export function erf(x: number): number {
  const s = Math.sign(x)
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return s * y
}

export const normalCdf = (x: number, mu = 0, sigma = 1) => 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)))
export const normalPdf = (x: number, mu = 0, sigma = 1) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI))

/** Density (continuous) or mass (discrete, at whole k) */
export function density(d: DistName, x: number, q: DistParams): number {
  switch (d) {
    case 'normal':
      return normalPdf(x, q.mu, q.sigma)
    case 'exponential':
      return x < 0 ? 0 : q.lambda * Math.exp(-q.lambda * x)
    case 'lognormal':
      return x <= 0 ? 0 : Math.exp(-((Math.log(x) - q.mu) ** 2) / (2 * q.sigma ** 2)) / (x * q.sigma * Math.sqrt(2 * Math.PI))
    case 'uniform':
      return x >= q.a && x <= q.b ? 1 / (q.b - q.a) : 0
    case 'binomial': {
      const k = Math.round(x)
      if (k !== x || k < 0 || k > q.n) return 0
      if (q.p === 0) return k === 0 ? 1 : 0
      if (q.p === 1) return k === q.n ? 1 : 0
      return Math.exp(logFactorial(q.n) - logFactorial(k) - logFactorial(q.n - k) + k * Math.log(q.p) + (q.n - k) * Math.log(1 - q.p))
    }
    case 'poisson': {
      const k = Math.round(x)
      if (k !== x || k < 0) return 0
      return Math.exp(-q.lambda + k * Math.log(q.lambda) - logFactorial(k))
    }
  }
}

/** The mean and standard deviation, from the formulas */
export function moments(d: DistName, q: DistParams): { mean: number; sd: number } {
  switch (d) {
    case 'normal':
      return { mean: q.mu, sd: q.sigma }
    case 'exponential':
      return { mean: 1 / q.lambda, sd: 1 / q.lambda }
    case 'lognormal':
      return { mean: Math.exp(q.mu + q.sigma ** 2 / 2), sd: Math.sqrt((Math.exp(q.sigma ** 2) - 1) * Math.exp(2 * q.mu + q.sigma ** 2)) }
    case 'uniform':
      return { mean: (q.a + q.b) / 2, sd: (q.b - q.a) / Math.sqrt(12) }
    case 'binomial':
      return { mean: q.n * q.p, sd: Math.sqrt(q.n * q.p * (1 - q.p)) }
    case 'poisson':
      return { mean: q.lambda, sd: Math.sqrt(q.lambda) }
  }
}

/** P(lo ≤ X ≤ hi): the area (or the masses) between two values */
export function probBetween(d: DistName, q: DistParams, lo: number, hi: number): number {
  if (hi < lo) return 0
  if (isDiscrete(d)) {
    let s = 0
    const top = d === 'binomial' ? Math.min(q.n, Math.floor(hi)) : Math.floor(Math.min(hi, q.lambda + 12 * Math.sqrt(q.lambda) + 20))
    for (let k = Math.max(0, Math.ceil(lo)); k <= top; k++) s += density(d, k, q)
    return s
  }
  if (d === 'normal') return normalCdf(hi, q.mu, q.sigma) - normalCdf(lo, q.mu, q.sigma)
  if (d === 'exponential') return Math.exp(-q.lambda * Math.max(0, lo)) - Math.exp(-q.lambda * Math.max(0, hi))
  if (d === 'lognormal') return lo <= 0 ? (hi <= 0 ? 0 : normalCdf(Math.log(hi), q.mu, q.sigma)) : normalCdf(Math.log(hi), q.mu, q.sigma) - normalCdf(Math.log(lo), q.mu, q.sigma)
  return Math.max(0, Math.min(hi, q.b) - Math.max(lo, q.a)) / (q.b - q.a)
}

/** One draw */
export function sample(d: DistName, q: DistParams, rand: () => number): number {
  switch (d) {
    case 'normal':
      return q.mu + q.sigma * gaussian(rand)
    case 'exponential':
      return -Math.log(1 - rand()) / q.lambda
    case 'lognormal':
      return Math.exp(q.mu + q.sigma * gaussian(rand))
    case 'uniform':
      return q.a + (q.b - q.a) * rand()
    case 'binomial': {
      let k = 0
      for (let i = 0; i < q.n; i++) if (rand() < q.p) k++
      return k
    }
    case 'poisson': {
      // Knuth: fine for the small rates an explorable uses
      const l = Math.exp(-q.lambda)
      let k = 0
      let p = 1
      do {
        k++
        p *= rand()
      } while (p > l && k < 1000)
      return k - 1
    }
  }
}

/** The mean of n draws */
export function sampleMean(d: DistName, q: DistParams, n: number, rand: () => number): number {
  let s = 0
  for (let i = 0; i < n; i++) s += sample(d, q, rand)
  return s / n
}

export interface Summary {
  n: number
  mean: number
  sd: number
}

/** Mean and sample standard deviation (n − 1) */
export function summary(xs: readonly number[]): Summary {
  const n = xs.length
  if (!n) return { n: 0, mean: NaN, sd: NaN }
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0
  return { n, mean, sd }
}

/** Counts in equal bins over [lo, hi]; values outside go in the end bins */
export function histogram(xs: readonly number[], lo: number, hi: number, bins: number): number[] {
  const out = new Array<number>(bins).fill(0)
  const w = (hi - lo) / bins
  for (const x of xs) out[Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / w)))]++
  return out
}

/** Bayes on a population: who has it, who tests positive, and the chance of having it given a positive */
export function bayes(prevalence: number, sensitivity: number, falsePositive: number, population = 1000) {
  const sick = Math.round(population * prevalence)
  const well = population - sick
  const truePos = Math.round(sick * sensitivity)
  const falsePos = Math.round(well * falsePositive)
  const exact = (prevalence * sensitivity) / (prevalence * sensitivity + (1 - prevalence) * falsePositive)
  return { population, sick, well, truePos, falseNeg: sick - truePos, falsePos, trueNeg: well - falsePos, posterior: truePos + falsePos ? truePos / (truePos + falsePos) : 0, exact: Number.isFinite(exact) ? exact : 0 }
}

// ---------- Stochastic processes ----------

/** A simple random walk: +1 with probability p, else −1 */
export const walkStep = (p: number, rand: () => number) => (rand() < p ? 1 : -1)

/** E[S_n] and Var[S_n] for a walk of n steps */
export const walkTheory = (p: number, n: number) => ({ mean: n * (2 * p - 1), variance: 4 * n * p * (1 - p) })

/** One Brownian increment over dt */
export const brownianStep = (dt: number, rand: () => number) => Math.sqrt(dt) * gaussian(rand)

/** The sum of squared increments of a path: Brownian motion's quadratic variation, which tends to t */
export function quadraticVariation(path: readonly number[]): number {
  let s = 0
  for (let i = 1; i < path.length; i++) s += (path[i] - path[i - 1]) ** 2
  return s
}

/** Geometric Brownian motion, exactly: S(t + dt) = S(t) exp((μ − σ²/2) dt + σ √dt Z) */
export const gbmStep = (s: number, mu: number, sigma: number, dt: number, rand: () => number) => s * Math.exp((mu - (sigma * sigma) / 2) * dt + sigma * Math.sqrt(dt) * gaussian(rand))

/** E[S_t] and the median of S_t: the mean grows at μ, the typical path at μ − σ²/2 */
export const gbmTheory = (s0: number, mu: number, sigma: number, t: number) => ({ mean: s0 * Math.exp(mu * t), median: s0 * Math.exp((mu - (sigma * sigma) / 2) * t), below: normalCdf(-(mu - (sigma * sigma) / 2) * Math.sqrt(t) / sigma) })

// ---------- Statistics ----------

export interface Fit {
  slope: number
  intercept: number
  sse: number
  r2: number
}

/** Ordinary least squares through the points */
export function leastSquares(points: readonly V2[]): Fit {
  const n = points.length
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  }
  const slope = sxx ? sxy / sxx : 0
  const intercept = my - slope * mx
  const sse = sumSquares(points, slope, intercept)
  return { slope, intercept, sse, r2: syy ? 1 - sse / syy : 1 }
}

/** The sum of squared residuals of the line y = slope x + intercept */
export const sumSquares = (points: readonly V2[], slope: number, intercept: number) => points.reduce((s, [x, y]) => s + (y - (slope * x + intercept)) ** 2, 0)

/** Two-sided critical values: z for 80, 90, 95 and 99% */
export const Z = { 0.8: 1.2816, 0.9: 1.6449, 0.95: 1.96, 0.99: 2.5758 } as const
export type Level = keyof typeof Z

/** Student's t critical value, two-sided, by the Cornish-Fisher expansion of z (good to about 1% for df ≥ 3) */
export function tCritical(level: Level, df: number): number {
  const z = Z[level]
  const g1 = (z ** 3 + z) / 4
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3
}

/** A t interval for the mean from one sample */
export function confidenceInterval(xs: readonly number[], level: Level): { lo: number; hi: number; mean: number } {
  const s = summary(xs)
  const half = tCritical(level, Math.max(1, s.n - 1)) * (s.sd / Math.sqrt(s.n))
  return { lo: s.mean - half, hi: s.mean + half, mean: s.mean }
}
