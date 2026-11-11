import { describe, expect, it } from 'vitest'
import { attend, buildAttention } from '../src/renderer/src/lib/sims/attention'
import { MLP, Trainer, bce, makeDataset, type Activation } from '../src/renderer/src/lib/sims/mlp'
import { ADAM_BETA2, ADAM_EPS, SURFACES, newOptimState, optimStep, peekStep, type SurfaceName } from '../src/renderer/src/lib/sims/optim'
import {
  ASK_EVENT,
  askDetail,
  askQuestion,
  describeAttentionPart,
  describeDescentPart,
  describeNetPart,
  describeSoftmaxPart,
  dispatchAsk,
  parseAttentionPart,
  parseDescentPart,
  parseNetPart,
  parseSoftmaxPart,
  type AskDetail
} from '../src/renderer/src/lib/sims/parts'
import { entropyBits, softmax } from '../src/renderer/src/lib/sims/softmax'
import { parseSim, type AttentionSpec, type GradientDescentSpec, type NeuralNetSpec, type SoftmaxSpec } from '../src/renderer/src/lib/sims/spec'

describe('neural net', () => {
  it('learns XOR to a low loss from a fixed seed', () => {
    const data = makeDataset('xor', 160, 1)
    const net = new MLP([2, 4, 4, 1], 'tanh', 1)
    const trainer = new Trainer(net, data, 0.3, 16, 1)
    const before = net.evaluate(data)
    for (let i = 0; i < 3000; i++) trainer.step()
    const after = net.evaluate(data)
    expect(before.loss).toBeGreaterThan(0.5)
    expect(after.loss).toBeLessThan(0.1)
    expect(after.accuracy).toBeGreaterThan(0.97)
    expect(trainer.epoch).toBe(Math.floor((3000 * 16 - 1) / 160))
  })

  it('is deterministic: the same seed gives the same weights', () => {
    const run = () => {
      const data = makeDataset('circle', 80, 7)
      const net = new MLP([2, 3, 1], 'relu', 7)
      const trainer = new Trainer(net, data, 0.1, 8, 7)
      for (let i = 0; i < 50; i++) trainer.step()
      return Array.from(net.w[0])
    }
    expect(run()).toEqual(run())
  })

  it.each(['tanh', 'sigmoid', 'relu'] as Activation[])('backpropagation matches numerical differentiation (%s)', (act) => {
    const net = new MLP([2, 3, 4, 1], act, 5)
    const [x1, x2, y] = [0.37, -0.81, 1]
    net.forward(x1, x2)
    net.backward(y)
    const h = 1e-6
    for (let l = 0; l < net.depth; l++) {
      const nin = net.sizes[l]
      for (let k = 0; k < net.w[l].length; k++) {
        const keep = net.w[l][k]
        net.w[l][k] = keep + h
        const up = bce(net.forward(x1, x2), y)
        net.w[l][k] = keep - h
        const down = bce(net.forward(x1, x2), y)
        net.w[l][k] = keep
        net.forward(x1, x2)
        const analytic = net.weightGrad(l, k % nin, Math.floor(k / nin))
        expect(analytic).toBeCloseTo((up - down) / (2 * h), 6)
      }
      for (let j = 0; j < net.b[l].length; j++) {
        const keep = net.b[l][j]
        net.b[l][j] = keep + h
        const up = bce(net.forward(x1, x2), y)
        net.b[l][j] = keep - h
        const down = bce(net.forward(x1, x2), y)
        net.b[l][j] = keep
        net.forward(x1, x2)
        expect(net.delta[l + 1][j]).toBeCloseTo((up - down) / (2 * h), 6)
      }
    }
  })

  it('one batch moves every weight by rate × mean gradient', () => {
    const data = makeDataset('linear', 40, 2)
    const net = new MLP([2, 2, 1], 'tanh', 2)
    const before = Array.from(net.w[1])
    // A batch of the whole set, so the order doesn't matter
    const sum = [0, 0]
    for (let i = 0; i < data.n; i++) {
      net.forward(data.x[i * 2], data.x[i * 2 + 1])
      net.backward(data.y[i])
      sum[0] += net.weightGrad(1, 0, 0)
      sum[1] += net.weightGrad(1, 1, 0)
    }
    new Trainer(net, data, 0.5, 40, 2).step()
    expect(net.w[1][0]).toBeCloseTo(before[0] - (0.5 * sum[0]) / 40, 12)
    expect(net.w[1][1]).toBeCloseTo(before[1] - (0.5 * sum[1]) / 40, 12)
  })

  it('makes balanced, seeded datasets inside the plotted square', () => {
    for (const name of ['xor', 'circle', 'two-moons', 'spiral', 'linear'] as const) {
      const a = makeDataset(name, 120, 3)
      const b = makeDataset(name, 120, 3)
      expect(Array.from(a.x)).toEqual(Array.from(b.x))
      expect(Array.from(makeDataset(name, 120, 4).x)).not.toEqual(Array.from(a.x))
      const ones = a.y.reduce((s, v) => s + v, 0)
      expect(ones).toBeGreaterThan(40)
      expect(ones).toBeLessThan(80)
      expect(Math.max(...Array.from(a.x, Math.abs))).toBeLessThan(1.25)
    }
  })
})

describe('softmax', () => {
  it('sums to 1 and matches a hand-computed case', () => {
    const p = softmax([1, 2, 3])
    expect(p[0] + p[1] + p[2]).toBeCloseTo(1, 12)
    const e = [Math.E, Math.E ** 2, Math.E ** 3]
    expect(p[2]).toBeCloseTo(e[2] / (e[0] + e[1] + e[2]), 12)
  })

  it('temperature sharpens and flattens; huge logits stay finite', () => {
    expect(softmax([2, 1, 0], 0.1)[0]).toBeGreaterThan(0.99)
    expect(softmax([2, 1, 0], 100)[0]).toBeLessThan(0.34)
    const p = softmax([1000, 999, -1000])
    expect(p[0]).toBeCloseTo(1 / (1 + Math.exp(-1)), 12)
    expect(entropyBits(softmax([0, 0, 0, 0]))).toBeCloseTo(2, 12)
    expect(softmax([1, -Infinity, 1])[1]).toBe(0)
  })
})

describe('attention', () => {
  const model = buildAttention(['the', 'cat', 'sat', 'on', 'the', 'mat'], 2, 1)

  it('every row of weights sums to 1, at any temperature and head', () => {
    for (const t of [0.2, 1, 4])
      for (let h = 0; h < 2; h++) {
        const { weights } = attend(model, h, t, false)
        for (let i = 0; i < model.n; i++) {
          let s = 0
          for (let j = 0; j < model.n; j++) s += weights[i * model.n + j]
          expect(s).toBeCloseTo(1, 12)
        }
      }
  })

  it('scores are q·k / √d_k and the output is the weighted mix of values', () => {
    const { n, dk } = model
    const r = attend(model, 1, 1, false)
    let dot = 0
    for (let c = 0; c < dk; c++) dot += model.q[1][2 * dk + c] * model.k[1][4 * dk + c]
    expect(r.raw[2 * n + 4]).toBeCloseTo(dot, 12)
    expect(r.scores[2 * n + 4]).toBeCloseTo(dot / Math.sqrt(dk), 12)
    expect(Array.from(softmax(r.scores.subarray(2 * n, 3 * n)))).toEqual(Array.from(r.weights.subarray(2 * n, 3 * n)))
    let mix = 0
    for (let j = 0; j < n; j++) mix += r.weights[2 * n + j] * model.v[1][j * dk + 3]
    expect(r.out[2 * dk + 3]).toBeCloseTo(mix, 12)
  })

  it('a causal mask gives later tokens exactly zero weight', () => {
    const { weights } = attend(model, 0, 1, true)
    expect(weights[0]).toBe(1)
    expect(weights[1 * model.n + 3]).toBe(0)
    expect(weights[1 * model.n] + weights[1 * model.n + 1]).toBeCloseTo(1, 12)
  })

  it('is seeded: same word, same embedding before position is added; new seed, new weights', () => {
    const again = buildAttention(['the', 'cat', 'sat', 'on', 'the', 'mat'], 2, 1)
    expect(Array.from(again.q[0])).toEqual(Array.from(model.q[0]))
    expect(Array.from(buildAttention(model.tokens, 2, 2).q[0])).not.toEqual(Array.from(model.q[0]))
    // "the" at positions 0 and 4 differ only by the positional encoding
    const pe = (t: number, c: number) => {
      const angle = t / Math.pow(10000, (2 * Math.floor(c / 2)) / model.d)
      return c % 2 === 0 ? Math.sin(angle) : Math.cos(angle)
    }
    for (let c = 0; c < model.d; c++) expect(model.x[c] - pe(0, c)).toBeCloseTo(model.x[4 * model.d + c] - pe(4, c), 12)
  })
})

describe('optimisers', () => {
  const g = [2, -4] as const

  it('SGD: Δ = −η g', () => {
    expect(optimStep('sgd', newOptimState(), g, 0.1, 0.9)).toEqual([-0.2, 0.4])
  })

  it('momentum: v ← βv + g, Δ = −η v', () => {
    const s = newOptimState()
    expect(optimStep('momentum', s, g, 0.1, 0.9)).toEqual([-0.2, 0.4])
    const second = optimStep('momentum', s, [1, 1], 0.1, 0.9)
    // v = 0.9·2 + 1 = 2.8 and 0.9·(−4) + 1 = −2.6
    expect(second[0]).toBeCloseTo(-0.28, 12)
    expect(second[1]).toBeCloseTo(0.26, 12)
  })

  it('Adam: the first step is −η·sign(g); the second matches the formula by hand', () => {
    const s = newOptimState()
    const first = optimStep('adam', s, g, 0.1, 0.9)
    expect(first[0]).toBeCloseTo(-0.1, 6)
    expect(first[1]).toBeCloseTo(0.1, 6)
    const second = optimStep('adam', s, [1, -4], 0.1, 0.9)
    const m = 0.9 * (0.1 * 2) + 0.1 * 1
    const v = ADAM_BETA2 * ((1 - ADAM_BETA2) * 4) + (1 - ADAM_BETA2) * 1
    const expected = (-0.1 * (m / (1 - 0.9 ** 2))) / (Math.sqrt(v / (1 - ADAM_BETA2 ** 2)) + ADAM_EPS)
    expect(second[0]).toBeCloseTo(expected, 12)
    expect(s.t).toBe(2)
  })

  it('peeking at the next step changes nothing', () => {
    const s = newOptimState()
    optimStep('adam', s, g, 0.1, 0.9)
    const copy = JSON.stringify(s)
    const peeked = peekStep('adam', s, g, 0.1, 0.9)
    expect(JSON.stringify(s)).toBe(copy)
    expect(optimStep('adam', s, g, 0.1, 0.9)).toEqual(peeked)
  })

  it('every surface has an exact gradient, and its minima are stationary', () => {
    const h = 1e-6
    for (const name of Object.keys(SURFACES) as SurfaceName[]) {
      const s = SURFACES[name]
      for (const [x, y] of [[0.3, -0.7], [-1.2, 0.9], s.start]) {
        const [gx, gy] = s.grad(x, y)
        expect(gx).toBeCloseTo((s.f(x + h, y) - s.f(x - h, y)) / (2 * h), 5)
        expect(gy).toBeCloseTo((s.f(x, y + h) - s.f(x, y - h)) / (2 * h), 5)
      }
      for (const [x, y] of s.minima) {
        expect(Math.hypot(...s.grad(x, y))).toBeLessThan(1e-9)
        expect(s.f(x + 0.01, y)).toBeGreaterThan(s.f(x, y))
        expect(s.f(x, y + 0.01)).toBeGreaterThan(s.f(x, y))
      }
    }
  })

  it('descends the bowl with SGD and overshoots the ravine when the rate is too high', () => {
    let [x, y] = SURFACES.bowl.start
    const s = newOptimState()
    for (let i = 0; i < 100; i++) {
      const d = optimStep('sgd', s, SURFACES.bowl.grad(x, y), 0.1, 0)
      x += d[0]
      y += d[1]
    }
    expect(SURFACES.bowl.f(x, y)).toBeLessThan(1e-12)
    let ry = 1
    for (let i = 0; i < 20; i++) ry += optimStep('sgd', newOptimState(), SURFACES.ravine.grad(0, ry), 0.6, 0)[1]
    expect(Math.abs(ry)).toBeGreaterThan(100)
  })
})

describe('sim spec', () => {
  const nn = (src: string) => parseSim(src) as NeuralNetSpec

  it('reads the documented example', () => {
    const s = nn('{"kind":"neural-net","layers":[2,4,4,1],"data":"xor","activation":"tanh","rate":0.1,"title":"XOR"}')
    expect(s).toMatchObject({ kind: 'neural-net', layers: [2, 4, 4, 1], data: 'xor', activation: 'tanh', rate: 0.1, title: 'XOR', mode: 'train', tour: [] })
  })

  it('leaves bad JSON, half-written blocks and unknown kinds alone', () => {
    expect(parseSim('{"kind":"neural-net","layers":[2,4')).toBeNull()
    expect(parseSim('')).toBeNull()
    expect(parseSim('not json')).toBeNull()
    expect(parseSim('[1,2]')).toBeNull()
    expect(parseSim('"neural-net"')).toBeNull()
    expect(parseSim('{"kind":"quantum-foam"}')).toBeNull()
    expect(parseSim('{"layers":[2,4,1]}')).toBeNull()
    expect(parseSim('{"kind":"attention","tokens":["one"]}')).toBeNull()
  })

  it('clamps sizes and ranges and falls back to safe defaults', () => {
    const s = nn('{"kind":"neural-net","layers":[2,64,0,3,9,9,1],"data":"mnist","activation":"gelu","rate":50,"batch":9999,"points":5,"seed":-4}')
    expect(s.layers).toEqual([2, 8, 1, 3, 1])
    expect(s).toMatchObject({ data: 'xor', activation: 'tanh', rate: 3, batch: 64, points: 40, seed: 0 })
    expect(nn('{"kind":"neural-net"}').layers).toEqual([2, 4, 4, 1])
    expect(nn('{"kind":"neural-net","layers":[5,5]}').layers).toEqual([2, 5, 5, 1])
    expect(nn('{"kind":"neural-net","layers":[2,1]}').layers).toEqual([2, 4, 1])
    expect(nn('{"kind":"Neural Network","lr":"0.03","dataset":"moons"}')).toMatchObject({ rate: 0.03, data: 'two-moons' })
  })

  it('checks the other kinds', () => {
    const a = parseSim(JSON.stringify({ kind: 'attention', tokens: Array.from({ length: 20 }, (_, i) => `t${i}`), heads: 9, temperature: 0, select: 99 })) as AttentionSpec
    expect(a.tokens).toHaveLength(12)
    expect(a).toMatchObject({ heads: 4, temperature: 0.1, select: 11, causal: false })
    expect((parseSim('{"kind":"attention","text":"the cat sat"}') as AttentionSpec).tokens).toEqual(['the', 'cat', 'sat'])

    const g = parseSim('{"kind":"gradient-descent","surface":"Two Minima","optimizer":"Adam","rate":9,"momentum":2,"start":[9,"x"]}') as GradientDescentSpec
    expect(g).toMatchObject({ surface: 'two-minima', optimiser: 'adam', rate: 1.2, momentum: 0.99, start: [3, 0] })
    expect((parseSim('{"kind":"gradient-descent","surface":"volcano"}') as GradientDescentSpec).surface).toBe('bowl')

    const m = parseSim('{"kind":"softmax","logits":[100,"1",null,-100],"labels":["cat"],"temperature":99}') as SoftmaxSpec
    expect(m.logits).toEqual([8, 1, 0, -8])
    expect(m.labels).toEqual(['cat', 'Class 2', 'Class 3', 'Class 4'])
    expect(m.temperature).toBe(5)
    expect((parseSim('{"kind":"softmax","logits":[1]}') as SoftmaxSpec).logits).toEqual([2, 1, 0.1])
  })

  it('validates a tour: keeps good steps, a small "do" vocabulary, bounded sizes', () => {
    const s = nn(
      JSON.stringify({
        kind: 'neural-net',
        tour: [
          { at: 'Neuron:1:2', say: '  This neuron   splits the plane. ' },
          { at: 'loss', say: 'Watch it fall.', do: { run: 99999, pause: 'yes', sample: 3, explode: true } },
          { at: 'surface' },
          'nonsense',
          { say: 'No part named.', do: { pause: true } },
          { at: 'loss', say: 'Nothing to do.', do: { launch: 1 } },
          ...Array.from({ length: 20 }, () => ({ at: 'loss', say: 'more' }))
        ]
      })
    )
    expect(s.tour).toHaveLength(12)
    expect(s.tour[0]).toEqual({ at: 'neuron:1:2', say: 'This neuron splits the plane.' })
    expect(s.tour[1]).toEqual({ at: 'loss', say: 'Watch it fall.', do: { run: 5000, sample: 3 } })
    expect(s.tour[2]).toEqual({ at: '', say: 'No part named.', do: { pause: true } })
    expect(s.tour[3]).toEqual({ at: 'loss', say: 'Nothing to do.' })
    expect(nn('{"kind":"neural-net","tour":"walk me through"}').tour).toEqual([])
  })
})

describe('named parts', () => {
  const sizes = [2, 4, 3, 1]

  it('names the parts of a network and rejects what is not there', () => {
    expect(parseNetPart('input', sizes)).toEqual({ type: 'input' })
    expect(parseNetPart('layer:1', sizes)).toEqual({ type: 'layer', l: 1 })
    expect(parseNetPart('layer:0', sizes)).toEqual({ type: 'input' })
    expect(parseNetPart('layer:3', sizes)).toEqual({ type: 'output' })
    expect(parseNetPart('neuron:1:2', sizes)).toEqual({ type: 'neuron', l: 1, j: 2 })
    expect(parseNetPart('edge:0:1:2', sizes)).toEqual({ type: 'edge', l: 0, i: 1, j: 2 })
    expect(parseNetPart('Surface', sizes)).toEqual({ type: 'surface' })
    for (const bad of ['neuron:1:5', 'neuron:1:0', 'neuron:9:1', 'edge:0:3:1', 'edge:3:1:1', 'edge:0:1', 'layer:4', 'layer:x', 'neuron:1:1.5', 'weights', ''])
      expect(parseNetPart(bad, sizes)).toBeNull()
  })

  it('names the parts of the other kinds', () => {
    expect(parseAttentionPart('token:3', 5)).toEqual({ type: 'token', i: 3 })
    expect(parseAttentionPart('row:5', 5)).toEqual({ type: 'row', i: 5 })
    expect(parseAttentionPart('mix', 5)).toEqual({ type: 'mix' })
    expect(parseAttentionPart('token:6', 5)).toBeNull()
    expect(parseAttentionPart('token:0', 5)).toBeNull()
    expect(parseDescentPart('minimum')).toEqual({ type: 'minimum' })
    expect(parseDescentPart('valley')).toBeNull()
    expect(parseSoftmaxPart('logit:2', 3)).toEqual({ type: 'logit', i: 2 })
    expect(parseSoftmaxPart('logit:4', 3)).toBeNull()
    expect(parseSoftmaxPart('temperature', 3)).toEqual({ type: 'temperature' })
  })

  it('describes a weight in plain words with its current value', () => {
    const net = new MLP([2, 3, 1], 'tanh', 1)
    net.w[0][1 * 2 + 0] = -0.83
    net.forward(0.5, -0.25)
    net.backward(1)
    const ctx = { sample: 3, target: 1, loss: 0.7, accuracy: 0.5, steps: 0 }
    const edge = describeNetPart(net, parseNetPart('edge:0:1:2', net.sizes)!, ctx)
    expect(edge.label).toBe('the weight from input 1 to hidden neuron 2 (currently -0.83)')
    expect(edge.values.weight).toBe(-0.83)
    expect(edge.values.gradient).toBeCloseTo(net.weightGrad(0, 0, 1), 4)
    expect(describeNetPart(net, parseNetPart('neuron:1:2', net.sizes)!, ctx).label).toMatch(/^hidden neuron 2 \(activation -?\d\.\d\d for sample 3\)$/)
    expect(describeNetPart(net, parseNetPart('output', net.sizes)!, ctx).values.prediction).toBeCloseTo(net.a[2][0], 4)
    const deep = new MLP([2, 3, 3, 1], 'relu', 1)
    deep.forward(0.1, 0.2)
    deep.backward(0)
    expect(describeNetPart(deep, parseNetPart('edge:1:3:1', deep.sizes)!, ctx).label).toMatch(/^the weight from hidden layer 1 neuron 3 to hidden layer 2 neuron 1 \(currently /)
    expect(describeNetPart(deep, parseNetPart('edge:2:2:1', deep.sizes)!, ctx).label).toMatch(/to the output neuron \(currently /)
  })

  it('describes parts of the other kinds from their real numbers', () => {
    const model = buildAttention(['the', 'cat', 'sat'], 1, 1)
    const result = attend(model, 0, 1, false)
    const token = describeAttentionPart(model, result, { type: 'token', i: 2 }, { selected: 0, head: 0, temperature: 1 })
    expect(token.label).toMatch(/^the token "cat" at position 2 \(attends most to "(the|cat|sat)", weight 0\.\d\d\)$/)
    expect(Object.values(token.values).reduce((s: number, v) => s + Number(v), 0)).toBeCloseTo(1, 3)

    const point = describeDescentPart({ type: 'point' }, { surface: SURFACES.bowl, x: 1, y: -2, steps: 4, startLoss: 9 })
    expect(point.label).toBe('the current point at (1.00, -2.00), where the loss is 5.000')
    expect(describeDescentPart({ type: 'gradient' }, { surface: SURFACES.bowl, x: 1, y: -2, steps: 4, startLoss: 9 }).values).toMatchObject({ gx: 2, gy: -4 })
    expect(describeDescentPart({ type: 'minimum' }, { surface: SURFACES.saddle, x: 0, y: -1, steps: 0, startLoss: 0 }).values.y).toBeCloseTo(-Math.sqrt(5), 3)

    const p = softmax([2, 1, 0])
    const logit = describeSoftmaxPart({ type: 'logit', i: 1 }, { logits: [2, 1, 0], labels: ['cat', 'dog', 'eel'], p, temperature: 1 })
    expect(logit.label).toBe('the logit for "cat" (2.00, which gives probability 0.67)')
  })

  it('"Ask about this" sends a bubbling tide:ask-about event with kind, part, label and values', () => {
    const info = { label: 'the weight from input 1 to hidden neuron 2 (currently -0.83)', values: { weight: -0.83, gradient: 0.0123 } }
    const detail = askDetail('neural-net', 'edge:0:1:2', info)
    expect(detail).toEqual({ kind: 'neural-net', part: 'edge:0:1:2', ...info })
    const target = new EventTarget()
    let heard: AskDetail | null = null
    target.addEventListener(ASK_EVENT, (e) => (heard = (e as CustomEvent<AskDetail>).detail))
    const event = dispatchAsk(target, detail)
    expect(ASK_EVENT).toBe('tide:ask-about')
    expect(event.bubbles).toBe(true)
    expect(heard).toEqual(detail)
    expect(askQuestion(detail)).toBe('In the simulation, explain the weight from input 1 to hidden neuron 2 (currently -0.83).')
  })
})
