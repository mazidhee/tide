/**
 * Loss surfaces with exact gradients, and the three optimisers' update rules. The view shows
 * exactly the numbers these return.
 */
export type SurfaceName = 'bowl' | 'ravine' | 'saddle' | 'two-minima'
export type OptimiserName = 'sgd' | 'momentum' | 'adam'

export interface Surface {
  name: SurfaceName
  label: string
  formula: string
  f: (x: number, y: number) => number
  grad: (x: number, y: number) => [number, number]
  /** xmin, xmax, ymin, ymax */
  domain: [number, number, number, number]
  start: [number, number]
  minima: [number, number][]
}

/** The two roots of 4x³ − 4x + 0.3 = 0 that are minima of the tilted double well */
function wellMinimum(guess: number): number {
  let x = guess
  for (let i = 0; i < 30; i++) x -= (4 * x * x * x - 4 * x + 0.3) / (12 * x * x - 4)
  return x
}

export const SURFACES: Record<SurfaceName, Surface> = {
  bowl: {
    name: 'bowl',
    label: 'Bowl',
    formula: 'f = x² + y²',
    f: (x, y) => x * x + y * y,
    grad: (x, y) => [2 * x, 2 * y],
    domain: [-2, 2, -2, 2],
    start: [-1.6, 1.3],
    minima: [[0, 0]]
  },
  ravine: {
    name: 'ravine',
    label: 'Ravine',
    formula: 'f = 0.1x² + 2y²',
    f: (x, y) => 0.1 * x * x + 2 * y * y,
    grad: (x, y) => [0.2 * x, 4 * y],
    domain: [-3, 3, -2, 2],
    start: [-2.6, 1.4],
    minima: [[0, 0]]
  },
  saddle: {
    name: 'saddle',
    label: 'Saddle',
    formula: 'f = x² − y² + 0.1y⁴',
    f: (x, y) => x * x - y * y + 0.1 * y * y * y * y,
    grad: (x, y) => [2 * x, -2 * y + 0.4 * y * y * y],
    domain: [-3, 3, -3, 3],
    start: [-2.4, 0.02],
    minima: [
      [0, Math.sqrt(5)],
      [0, -Math.sqrt(5)]
    ]
  },
  'two-minima': {
    name: 'two-minima',
    label: 'Two minima',
    formula: 'f = (x² − 1)² + 0.3x + y²',
    f: (x, y) => (x * x - 1) * (x * x - 1) + 0.3 * x + y * y,
    grad: (x, y) => [4 * x * (x * x - 1) + 0.3, 2 * y],
    domain: [-2, 2, -1.5, 1.5],
    start: [0.25, 1.2],
    minima: [
      [wellMinimum(-1), 0],
      [wellMinimum(1), 0]
    ]
  }
}

export interface OptimState {
  /** Steps taken */
  t: number
  /** Velocity (momentum) or first moment (Adam) */
  m: [number, number]
  /** Second moment (Adam) */
  v: [number, number]
}

export const newOptimState = (): OptimState => ({ t: 0, m: [0, 0], v: [0, 0] })

export const ADAM_BETA2 = 0.999
export const ADAM_EPS = 1e-8

/**
 * One update. Returns the change to add to the position, and advances the state.
 *   SGD       Δ = −η g
 *   Momentum  v ← βv + g;  Δ = −η v
 *   Adam      m ← β₁m + (1−β₁)g;  v ← β₂v + (1−β₂)g²;  Δ = −η m̂ / (√v̂ + ε), with bias-corrected m̂, v̂
 */
export function optimStep(kind: OptimiserName, state: OptimState, g: readonly [number, number], rate: number, beta: number): [number, number] {
  state.t += 1
  const d: [number, number] = [0, 0]
  for (let i = 0; i < 2; i++) {
    if (kind === 'sgd') {
      d[i] = -rate * g[i]
    } else if (kind === 'momentum') {
      state.m[i] = beta * state.m[i] + g[i]
      d[i] = -rate * state.m[i]
    } else {
      state.m[i] = beta * state.m[i] + (1 - beta) * g[i]
      state.v[i] = ADAM_BETA2 * state.v[i] + (1 - ADAM_BETA2) * g[i] * g[i]
      const mHat = state.m[i] / (1 - Math.pow(beta, state.t))
      const vHat = state.v[i] / (1 - Math.pow(ADAM_BETA2, state.t))
      d[i] = (-rate * mHat) / (Math.sqrt(vHat) + ADAM_EPS)
    }
  }
  return d
}

/** The update the next step would make, without advancing anything */
export function peekStep(kind: OptimiserName, state: OptimState, g: readonly [number, number], rate: number, beta: number): [number, number] {
  return optimStep(kind, { t: state.t, m: [state.m[0], state.m[1]], v: [state.v[0], state.v[1]] }, g, rate, beta)
}
