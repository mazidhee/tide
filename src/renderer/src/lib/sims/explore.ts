/**
 * Explorables: maths you can poke. The spec of the "explore" simulation (kinds/explore draws it):
 * one scene, its starting numbers, the question the tutor asks about it, and an optional
 * prediction to lock in before the answer is shown. Plain data in, plain data out.
 *
 * Scenes, by rung of the maths ladder:
 *   calculus      secant (the derivative as the limit of secants), riemann (sums to the integral), limit
 *   linear maps   matrix (the grid and basis vectors), eigen (vectors that stay on their line)
 *   probability   distribution, clt, lln, bayes
 *   stochastic    random-walk, brownian, gbm
 *   statistics    regression, confidence
 */
import { parseExpr } from './plotExpr'
import { readMatrix, type Matrix2, type V2 } from './geometry'
import { DEFAULT_DIST, type DistName, type DistParams, type Level, type RiemannRule } from './exploreMaths'
import { clamp, int, num, onlyVerbs, pick, text, type Raw, type SimBase } from './specUtil'

export { SCENES, SCENE_LABEL, type Scene } from '@shared/mathsMode'
import { SCENES, type Scene } from '@shared/mathsMode'

/** The scenes that run (Play, Step): each step is a draw, a step of a path, a sample */
export const RUNNING: readonly Scene[] = ['clt', 'lln', 'random-walk', 'brownian', 'gbm', 'confidence']

export const DISTS: readonly DistName[] = ['normal', 'binomial', 'poisson', 'exponential', 'lognormal', 'uniform']

export interface ExploreSpec extends SimBase {
  kind: 'explore'
  scene: Scene
  /** The tutor's question about it, shown above the picture */
  question: string
  /** A prediction to lock in before the answer (the true derivative, the theory curve) is shown */
  predict: string
  /** f(x), for secant, riemann and limit */
  f: string
  x0: number
  h: number
  a: number
  b: number
  n: number
  rule: RiemannRule
  matrix: Matrix2
  vector: V2
  dist: DistName
  params: DistParams
  /** Shaded interval for distribution; null for none */
  range: [number, number] | null
  /** Sample size for clt and confidence */
  size: number
  level: Level
  /** Random walk: chance of a step up */
  p: number
  paths: number
  steps: number
  s0: number
  mu: number
  sigma: number
  T: number
  prevalence: number
  sensitivity: number
  falsePositive: number
  points: V2[]
}

const DEFAULT_F: Partial<Record<Scene, string>> = { secant: 'x^2', riemann: 'x^2', limit: 'sin(x)/x' }

const ALIASES: Record<string, Scene> = {
  derivative: 'secant',
  tangent: 'secant',
  'secant-tangent': 'secant',
  integral: 'riemann',
  'riemann-sum': 'riemann',
  limits: 'limit',
  'linear-map': 'matrix',
  transform: 'matrix',
  eigenvector: 'eigen',
  eigenvectors: 'eigen',
  dist: 'distribution',
  pdf: 'distribution',
  normal: 'distribution',
  binomial: 'distribution',
  poisson: 'distribution',
  exponential: 'distribution',
  lognormal: 'distribution',
  'central-limit': 'clt',
  'central-limit-theorem': 'clt',
  'large-numbers': 'lln',
  'law-of-large-numbers': 'lln',
  'bayes-theorem': 'bayes',
  walk: 'random-walk',
  'wiener-process': 'brownian',
  'brownian-motion': 'brownian',
  'geometric-brownian-motion': 'gbm',
  'stock-price': 'gbm',
  'least-squares': 'regression',
  ols: 'regression',
  'linear-regression': 'regression',
  'confidence-interval': 'confidence',
  'confidence-intervals': 'confidence',
  ci: 'confidence'
}

export const EXPLORE_LIMITS = { points: 24, paths: 12, steps: 400, size: 200, n: 200 }

/** A formula an explorable can draw: the plot simulation's own safe reader, in x only */
export function readFormula(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim().replace(/\*\*/g, '^').replace(/^(f\(x\)|y)\s*=\s*/i, '') : ''
  if (!s) return fallback
  const parsed = parseExpr(s)
  return parsed.ok && parsed.params.length === 0 ? s : fallback
}

const pair = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0] as number, v[1] as number] : null)

function readParams(raw: Raw): DistParams {
  const given = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params) ? (raw.params as Raw) : raw
  const lo = num(given.a ?? given.min, DEFAULT_DIST.a, -50, 50)
  return {
    mu: num(given.mu ?? given.mean, DEFAULT_DIST.mu, -20, 20),
    sigma: num(given.sigma ?? given.sd, DEFAULT_DIST.sigma, 0.05, 10),
    n: int(given.n ?? given.trials, DEFAULT_DIST.n, 1, 100),
    p: num(given.p, DEFAULT_DIST.p, 0, 1),
    lambda: num(given.lambda ?? given.rate, DEFAULT_DIST.lambda, 0.05, 40),
    a: lo,
    b: Math.max(lo + 0.1, num(given.b ?? given.max, DEFAULT_DIST.b, -50, 50))
  }
}

/** A default cloud for least squares: a rough line with noise, the same every time */
const DEFAULT_POINTS: V2[] = [
  [-4, -2.6],
  [-3, -1.2],
  [-2, -1.8],
  [-1, 0.4],
  [0, 0.2],
  [1, 1.6],
  [2, 1.1],
  [3, 2.9],
  [4, 2.4]
]

export function parseExploreSpec(raw: Raw, base: SimBase): ExploreSpec | null {
  const sceneWord = raw.scene ?? raw.topic ?? raw.show
  let scene = pick(sceneWord, SCENES, '' as Scene, ALIASES)
  // {"kind":"explore","dist":"poisson"} is a distribution
  if (!scene && typeof raw.dist === 'string') scene = 'distribution'
  if (!scene) return null
  const named = typeof sceneWord === 'string' ? sceneWord.trim().toLowerCase() : ''
  const dist = pick(raw.dist ?? raw.distribution ?? raw.source ?? ((DISTS as readonly string[]).includes(named) ? named : undefined), DISTS, scene === 'clt' ? 'exponential' : scene === 'lln' ? 'binomial' : 'normal', { gaussian: 'normal', bernoulli: 'binomial', coin: 'binomial', exp: 'exponential', 'log-normal': 'lognormal' })
  const params = readParams(raw)
  // A coin for the law of large numbers: one trial
  if (scene === 'lln' && dist === 'binomial' && raw.n === undefined && !(raw.params as Raw | undefined)?.n) params.n = 1
  const range = pair(raw.range ?? raw.interval)
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .map(pair)
    .filter((p): p is [number, number] => !!p)
    .slice(0, EXPLORE_LIMITS.points)
    .map(([x, y]) => [clamp(x, -9, 9), clamp(y, -9, 9)] as V2)
  const levelRaw = num(raw.level ?? raw.confidence, 0.95, 0.5, 0.999)
  const level = ([0.8, 0.9, 0.95, 0.99] as Level[]).reduce((best, l) => (Math.abs(l - levelRaw) < Math.abs(best - levelRaw) ? l : best), 0.95 as Level)
  const v = pair(raw.vector ?? raw.v)
  const spec: ExploreSpec = {
    ...base,
    kind: 'explore',
    scene,
    question: text(raw.question ?? raw.ask, 220),
    predict: text(raw.predict ?? raw.prediction, 160),
    f: readFormula(raw.f ?? raw.function ?? raw.fn, DEFAULT_F[scene] ?? 'x^2'),
    x0: num(raw.x0 ?? raw.x ?? raw.at, scene === 'limit' ? 0 : 1, -10, 10),
    h: num(raw.h, 1, -4, 4) || 1,
    a: num(raw.a ?? raw.from, 0, -10, 10),
    b: num(raw.b ?? raw.to, 2, -10, 10),
    n: int(raw.n ?? raw.rectangles, scene === 'riemann' ? 4 : 10, 1, EXPLORE_LIMITS.n),
    rule: pick(raw.rule ?? raw.method, ['left', 'right', 'mid', 'trapezoid'] as const, 'left', { midpoint: 'mid', middle: 'mid', trapezium: 'trapezoid' }),
    matrix: readMatrix(raw.matrix) ?? (scene === 'eigen' ? [[2, 1], [1, 2]] : [[1, 1], [0, 1]]),
    vector: v ? [clamp(v[0], -5, 5), clamp(v[1], -5, 5)] : [1, 0.5],
    dist,
    params,
    range: range ? [Math.min(...range), Math.max(...range)] : null,
    size: int(raw.size ?? raw.sample ?? raw.sampleSize, scene === 'confidence' ? 10 : 5, 1, EXPLORE_LIMITS.size),
    level,
    p: num(raw.p, 0.5, 0, 1),
    paths: int(raw.paths, scene === 'random-walk' ? 5 : 8, 1, EXPLORE_LIMITS.paths),
    steps: int(raw.steps, scene === 'random-walk' ? 100 : 200, 10, EXPLORE_LIMITS.steps),
    s0: num(raw.s0 ?? raw.S0 ?? raw.price, 100, 1, 10000),
    mu: num(raw.mu ?? raw.drift, scene === 'gbm' ? 0.08 : 0, -1, 1),
    sigma: num(raw.sigma ?? raw.vol ?? raw.volatility, scene === 'gbm' ? 0.3 : 1, 0.01, 2),
    T: num(raw.T ?? raw.t ?? raw.years, 1, 0.1, 10),
    prevalence: num(raw.prevalence ?? raw.prior, 0.01, 0.001, 0.5),
    sensitivity: num(raw.sensitivity ?? raw.tpr, 0.9, 0, 1),
    falsePositive: num(raw.falsePositive ?? raw.fpr ?? raw.false_positive, 0.05, 0, 1),
    points: points.length >= 3 ? points : DEFAULT_POINTS
  }
  if (spec.b <= spec.a) [spec.a, spec.b] = [spec.b, spec.a === spec.b ? spec.a + 1 : spec.a]
  // The GBM scene uses mu and sigma as drift and volatility; the distribution scene as its parameters
  if (scene === 'distribution' && raw.mu === undefined && raw.mean === undefined) spec.mu = params.mu
  return onlyVerbs(spec, ['set', 'h', 'n', 'matrix', 'vector', 'reveal'])
}

/** The parts a tour can point at, and the learner can select, in each scene */
export const SCENE_PARTS: Record<Scene, string[]> = {
  secant: ['curve', 'secant', 'tangent', 'h', 'table'],
  riemann: ['curve', 'rectangles', 'sum', 'integral', 'error'],
  limit: ['curve', 'left', 'right', 'gap'],
  matrix: ['grid', 'basis', 'vector', 'det'],
  eigen: ['vector', 'image', 'eigen', 'angle'],
  distribution: ['density', 'mean', 'interval'],
  clt: ['source', 'histogram', 'theory', 'spread'],
  lln: ['running-mean', 'truth'],
  bayes: ['population', 'positives', 'posterior'],
  'random-walk': ['paths', 'envelope', 'spread'],
  brownian: ['paths', 'envelope', 'variation'],
  gbm: ['paths', 'mean', 'median'],
  regression: ['points', 'line', 'residuals', 'yours'],
  confidence: ['intervals', 'truth', 'coverage']
}
