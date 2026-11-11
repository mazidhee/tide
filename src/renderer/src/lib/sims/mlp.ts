/**
 * A small multilayer perceptron trained by backpropagation, written out in full: two inputs, a few
 * hidden layers, one sigmoid output, binary cross-entropy loss, mini-batch gradient descent.
 * Everything the view shows (activations, weights, deltas, gradients, loss) is read from here.
 */
import { gaussian, mulberry32 } from './rng'

export type Activation = 'tanh' | 'relu' | 'sigmoid'
export type DatasetName = 'xor' | 'circle' | 'two-moons' | 'spiral' | 'linear'

export interface Dataset {
  name: DatasetName
  n: number
  /** x₁, x₂ pairs, roughly within [-1, 1] */
  x: Float64Array
  /** 0 or 1 */
  y: Uint8Array
}

export function makeDataset(name: DatasetName, n: number, seed: number, noise = 0): Dataset {
  const rand = mulberry32((seed * 2654435761 + 97) >>> 0)
  const x = new Float64Array(n * 2)
  const y = new Uint8Array(n)
  const uniform = (a: number, b: number) => a + (b - a) * rand()
  for (let i = 0; i < n; i++) {
    const label = i % 2
    let px = 0
    let py = 0
    if (name === 'xor') {
      px = uniform(0.08, 1) * (rand() < 0.5 ? -1 : 1)
      py = uniform(0.08, 1) * (rand() < 0.5 ? -1 : 1)
      y[i] = px * py > 0 ? 1 : 0
    } else if (name === 'circle') {
      const r = label ? uniform(0, 0.42) : uniform(0.62, 1)
      const a = uniform(0, 2 * Math.PI)
      px = r * Math.cos(a)
      py = r * Math.sin(a)
      y[i] = label
    } else if (name === 'two-moons') {
      const a = uniform(0, Math.PI)
      px = label ? 0.35 - 0.7 * Math.cos(a) : -0.35 + 0.7 * Math.cos(a)
      py = label ? 0.25 - 0.7 * Math.sin(a) : -0.25 + 0.7 * Math.sin(a)
      px += gaussian(rand) * 0.06
      py += gaussian(rand) * 0.06
      y[i] = label
    } else if (name === 'spiral') {
      const t = Math.floor(i / 2) / Math.ceil(n / 2)
      const r = 0.1 + 0.88 * t
      const a = 1.25 * t * 2 * Math.PI + (label ? Math.PI : 0)
      px = r * Math.sin(a) + gaussian(rand) * 0.02
      py = r * Math.cos(a) + gaussian(rand) * 0.02
      y[i] = label
    } else {
      const c = label ? 0.45 : -0.45
      px = c + gaussian(rand) * 0.22
      py = c + gaussian(rand) * 0.22
      y[i] = label
    }
    x[i * 2] = px + gaussian(rand) * noise
    x[i * 2 + 1] = py + gaussian(rand) * noise
  }
  return { name, n, x, y }
}

export function activate(kind: Activation, z: number): number {
  if (kind === 'tanh') return Math.tanh(z)
  if (kind === 'relu') return z > 0 ? z : 0
  return 1 / (1 + Math.exp(-z))
}

/** Derivative of the activation, given z and a = activate(z) */
export function activatePrime(kind: Activation, z: number, a: number): number {
  if (kind === 'tanh') return 1 - a * a
  if (kind === 'relu') return z > 0 ? 1 : 0
  return a * (1 - a)
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

/** Binary cross-entropy for one prediction, clamped so a confident miss stays finite */
export function bce(p: number, y: number): number {
  const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12)
  return y ? -Math.log(q) : -Math.log(1 - q)
}

export class MLP {
  /** Layer sizes, input first */
  readonly sizes: number[]
  act: Activation
  /** w[l][j * sizes[l] + i]: from neuron i of layer l to neuron j of layer l + 1 */
  readonly w: Float64Array[] = []
  readonly b: Float64Array[] = []
  /** Pre-activations and activations of the last forward pass; a[0] is the input */
  readonly z: Float64Array[] = []
  readonly a: Float64Array[] = []
  /** δ = ∂L/∂z per neuron from the last backward pass (delta[0] is unused) */
  readonly delta: Float64Array[] = []
  /** Gradients summed over a batch */
  readonly gw: Float64Array[] = []
  readonly gb: Float64Array[] = []

  constructor(sizes: number[], act: Activation, seed: number) {
    this.sizes = sizes.slice()
    this.act = act
    const rand = mulberry32((seed * 1597334677 + 11) >>> 0)
    this.a.push(new Float64Array(sizes[0]))
    this.z.push(new Float64Array(sizes[0]))
    this.delta.push(new Float64Array(sizes[0]))
    for (let l = 0; l < sizes.length - 1; l++) {
      const nin = sizes[l]
      const nout = sizes[l + 1]
      const w = new Float64Array(nin * nout)
      // He initialisation for ReLU, Xavier otherwise
      const scale = act === 'relu' ? Math.sqrt(2 / nin) : Math.sqrt(2 / (nin + nout))
      for (let k = 0; k < w.length; k++) w[k] = gaussian(rand) * scale
      const b = new Float64Array(nout)
      // A small positive bias keeps ReLU units alive at the start
      if (act === 'relu' && l < sizes.length - 2) b.fill(0.05)
      this.w.push(w)
      this.b.push(b)
      this.gw.push(new Float64Array(w.length))
      this.gb.push(new Float64Array(nout))
      this.z.push(new Float64Array(nout))
      this.a.push(new Float64Array(nout))
      this.delta.push(new Float64Array(nout))
    }
  }

  /** Number of weight layers */
  get depth(): number {
    return this.sizes.length - 1
  }

  /** Runs one sample through, filling z and a. Returns the output probability. */
  forward(x1: number, x2: number): number {
    this.a[0][0] = x1
    this.a[0][1] = x2
    const last = this.depth - 1
    for (let l = 0; l <= last; l++) {
      const nin = this.sizes[l]
      const nout = this.sizes[l + 1]
      const w = this.w[l]
      const input = this.a[l]
      const z = this.z[l + 1]
      const a = this.a[l + 1]
      for (let j = 0; j < nout; j++) {
        let s = this.b[l][j]
        for (let i = 0; i < nin; i++) s += w[j * nin + i] * input[i]
        z[j] = s
        a[j] = l === last ? sigmoid(s) : activate(this.act, s)
      }
    }
    return this.a[this.depth][0]
  }

  /**
   * Backpropagates the loss of the last forward pass for target y, filling delta.
   * At the sigmoid output with cross-entropy, δ = ŷ − y; below it, δⱼ = (Σₖ wₖⱼ δₖ) · act′(zⱼ).
   */
  backward(y: number): void {
    const top = this.depth
    this.delta[top][0] = this.a[top][0] - y
    for (let l = top - 1; l >= 1; l--) {
      const n = this.sizes[l]
      const nout = this.sizes[l + 1]
      const w = this.w[l]
      for (let i = 0; i < n; i++) {
        let s = 0
        for (let j = 0; j < nout; j++) s += w[j * n + i] * this.delta[l + 1][j]
        this.delta[l][i] = s * activatePrime(this.act, this.z[l][i], this.a[l][i])
      }
    }
  }

  /** Σₖ wₖⱼ δₖ for neuron j of layer l: what arrives from the layer above before act′ is applied */
  backSum(l: number, j: number): number {
    const n = this.sizes[l]
    let s = 0
    for (let k = 0; k < this.sizes[l + 1]; k++) s += this.w[l][k * n + j] * this.delta[l + 1][k]
    return s
  }

  /** ∂L/∂w for the weight from neuron i of layer l to neuron j of layer l + 1, after backward() */
  weightGrad(l: number, i: number, j: number): number {
    return this.a[l][i] * this.delta[l + 1][j]
  }

  zeroGrad(): void {
    for (let l = 0; l < this.depth; l++) {
      this.gw[l].fill(0)
      this.gb[l].fill(0)
    }
  }

  /** Adds the gradients of the last forward + backward pass to the batch sums */
  accumulate(): void {
    for (let l = 0; l < this.depth; l++) {
      const nin = this.sizes[l]
      const nout = this.sizes[l + 1]
      for (let j = 0; j < nout; j++) {
        const d = this.delta[l + 1][j]
        this.gb[l][j] += d
        for (let i = 0; i < nin; i++) this.gw[l][j * nin + i] += this.a[l][i] * d
      }
    }
  }

  /** w ← w − rate · (summed gradient / count) */
  apply(rate: number, count: number): void {
    const s = rate / count
    for (let l = 0; l < this.depth; l++) {
      const w = this.w[l]
      const gw = this.gw[l]
      for (let k = 0; k < w.length; k++) w[k] -= s * gw[k]
      const b = this.b[l]
      const gb = this.gb[l]
      for (let k = 0; k < b.length; k++) b[k] -= s * gb[k]
    }
  }

  /** Mean loss and accuracy over a dataset */
  evaluate(data: Dataset): { loss: number; accuracy: number } {
    let loss = 0
    let right = 0
    for (let i = 0; i < data.n; i++) {
      const p = this.forward(data.x[i * 2], data.x[i * 2 + 1])
      loss += bce(p, data.y[i])
      if (p >= 0.5 === (data.y[i] === 1)) right++
    }
    return { loss: loss / data.n, accuracy: right / data.n }
  }
}

/** Mini-batch training over a dataset, reshuffled each epoch from the seed */
export class Trainer {
  readonly net: MLP
  readonly data: Dataset
  rate: number
  readonly batch: number
  /** Batches done */
  steps = 0
  epoch = 0
  private order: Uint32Array
  private cursor = 0
  private rand: () => number

  constructor(net: MLP, data: Dataset, rate: number, batch: number, seed: number) {
    this.net = net
    this.data = data
    this.rate = rate
    this.batch = Math.min(batch, data.n)
    this.rand = mulberry32((seed * 40503 + 5) >>> 0)
    this.order = new Uint32Array(data.n)
    for (let i = 0; i < data.n; i++) this.order[i] = i
    this.shuffle()
  }

  private shuffle(): void {
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1))
      const t = this.order[i]
      this.order[i] = this.order[j]
      this.order[j] = t
    }
  }

  /** Trains on one batch. Returns the batch's mean loss before the update. */
  step(): number {
    const { net, data } = this
    net.zeroGrad()
    let loss = 0
    for (let k = 0; k < this.batch; k++) {
      if (this.cursor >= data.n) {
        this.cursor = 0
        this.epoch++
        this.shuffle()
      }
      const i = this.order[this.cursor++]
      const p = net.forward(data.x[i * 2], data.x[i * 2 + 1])
      loss += bce(p, data.y[i])
      net.backward(data.y[i])
      net.accumulate()
    }
    net.apply(this.rate, this.batch)
    this.steps++
    return loss / this.batch
  }
}
