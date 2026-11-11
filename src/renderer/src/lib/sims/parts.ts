/**
 * The named parts of each simulation: what a tour step can point at, and what the learner can
 * select and ask about. Items are counted from 1; network layers from 0 (the input layer).
 *   neural-net        input, layer:L, neuron:L:J, edge:L:I:J, output, surface, loss
 *   attention         token:I, row:I, scores, weights, mix
 *   gradient-descent  point, gradient, path, minimum
 *   softmax           logit:I, probabilities, temperature
 * The later kinds keep their parts beside their models (parse…Part and describe…Part in each):
 *   raft (raft.ts)          node:N, log:N, entry:N:I, timer:N, message:ID, leader, term, commit, messages, network, clock
 *   b-tree (btree.ts)       root, node:L:I, key:K, path, height, fill, order, step
 *   hash-table (hashTable.ts)  bucket:I (from 0, as the arithmetic counts), key:K, load, probe, hash, collisions, strategy
 *   cpu (cpu.ts)            pc, ir, phase, program, memory, flags, register:N, flag:Z, memory:A, line:N
 *   tokeniser (bpe.ts)      text, pairs, pair:N, merges, merge:N, vocabulary, sentence, token:N, length
 *   blockchain (chain.ts)   block:N, hash:N, nonce:N, link:N, orphan:N, difficulty, tip, fork, miner:a
 *   plot (plotExpr.ts)      function:N, point, tangent, param:NAME, axes
 * Each description is a plain phrase with the current numbers, ready to drop into a question.
 */
import type { AttentionModel, AttentionResult } from './attention'
import type { MLP } from './mlp'
import type { Surface } from './optim'
import type { SimKind } from './spec'

export interface PartInfo {
  label: string
  values: Record<string, number | string>
}

export interface AskDetail extends PartInfo {
  kind: SimKind
  part: string
}

export const ASK_EVENT = 'tide:ask-about'

const r4 = (v: number) => Math.round(v * 10000) / 10000
const f2 = (v: number) => (Object.is(Math.round(v * 100) / 100, -0) ? 0 : v).toFixed(2)

/** "edge:0:1:2" → ['edge', 0, 1, 2]; null when a number isn't a whole number ≥ 0 */
function split(name: string): [string, ...number[]] | null {
  const [head, ...rest] = name.trim().toLowerCase().split(':')
  const nums = rest.map(Number)
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null
  return [head, ...nums]
}

// ---------- Neural network ----------

export type NetPart =
  | { type: 'input' | 'output' | 'surface' | 'loss' }
  | { type: 'layer'; l: number }
  | { type: 'neuron'; l: number; j: number }
  | { type: 'edge'; l: number; i: number; j: number }

export function parseNetPart(name: string, sizes: readonly number[]): NetPart | null {
  const p = split(name)
  if (!p) return null
  const [head, a, b, c] = p
  const top = sizes.length - 1
  if (p.length === 1 && (head === 'input' || head === 'output' || head === 'surface' || head === 'loss')) return { type: head }
  if (head === 'layer' && p.length === 2 && a <= top) return a === 0 ? { type: 'input' } : a === top ? { type: 'output' } : { type: 'layer', l: a }
  if (head === 'neuron' && p.length === 3 && a <= top && b >= 1 && b <= sizes[a]) return { type: 'neuron', l: a, j: b }
  if (head === 'edge' && p.length === 4 && a < top && b >= 1 && b <= sizes[a] && c >= 1 && c <= sizes[a + 1]) return { type: 'edge', l: a, i: b, j: c }
  return null
}

export function neuronName(sizes: readonly number[], l: number, j: number): string {
  if (l === 0) return `input ${j}`
  if (l === sizes.length - 1) return 'the output neuron'
  return sizes.length === 3 ? `hidden neuron ${j}` : `hidden layer ${l} neuron ${j}`
}

export interface NetContext {
  /** Selected sample, from 1 */
  sample: number
  target: number
  loss: number
  accuracy: number
  steps: number
}

/** Expects the net to hold a forward and backward pass of the selected sample */
export function describeNetPart(net: MLP, part: NetPart, ctx: NetContext): PartInfo {
  const { sizes } = net
  const top = sizes.length - 1
  switch (part.type) {
    case 'input':
      return {
        label: `the input layer (x1 = ${f2(net.a[0][0])}, x2 = ${f2(net.a[0][1])} for sample ${ctx.sample})`,
        values: { x1: r4(net.a[0][0]), x2: r4(net.a[0][1]), sample: ctx.sample }
      }
    case 'output':
      return {
        label: `the output neuron (prediction ${f2(net.a[top][0])}, target ${ctx.target})`,
        values: { z: r4(net.z[top][0]), prediction: r4(net.a[top][0]), target: ctx.target, delta: r4(net.delta[top][0]) }
      }
    case 'surface':
      return {
        label: `the decision surface (${Math.round(ctx.accuracy * 100)}% of points on the right side)`,
        values: { accuracy: r4(ctx.accuracy), loss: r4(ctx.loss) }
      }
    case 'loss':
      return {
        label: `the loss curve (loss ${ctx.loss.toFixed(3)} after ${ctx.steps} batches)`,
        values: { loss: r4(ctx.loss), batches: ctx.steps }
      }
    case 'layer':
      return {
        label: `hidden layer ${part.l} (${sizes[part.l]} neurons, ${net.act})`,
        values: Object.fromEntries(Array.from(net.a[part.l], (a, j) => [`a${j + 1}`, r4(a)]))
      }
    case 'neuron': {
      const { l, j } = part
      if (l === 0) return { label: `input ${j} (x${j} = ${f2(net.a[0][j - 1])} for sample ${ctx.sample})`, values: { value: r4(net.a[0][j - 1]) } }
      if (l === top) return describeNetPart(net, { type: 'output' }, ctx)
      return {
        label: `${neuronName(sizes, l, j)} (activation ${f2(net.a[l][j - 1])} for sample ${ctx.sample})`,
        values: { z: r4(net.z[l][j - 1]), activation: r4(net.a[l][j - 1]), bias: r4(net.b[l - 1][j - 1]), delta: r4(net.delta[l][j - 1]) }
      }
    }
    case 'edge': {
      const { l, i, j } = part
      const w = net.w[l][(j - 1) * sizes[l] + (i - 1)]
      return {
        label: `the weight from ${neuronName(sizes, l, i)} to ${neuronName(sizes, l + 1, j)} (currently ${f2(w)})`,
        values: { weight: r4(w), gradient: r4(net.weightGrad(l, i - 1, j - 1)) }
      }
    }
  }
}

// ---------- Attention ----------

export type AttentionPart = { type: 'token' | 'row'; i: number } | { type: 'scores' | 'weights' | 'mix' }

export function parseAttentionPart(name: string, n: number): AttentionPart | null {
  const p = split(name)
  if (!p) return null
  const [head, a] = p
  if ((head === 'token' || head === 'row') && p.length === 2 && a >= 1 && a <= n) return { type: head, i: a }
  if (p.length === 1 && (head === 'scores' || head === 'weights' || head === 'mix')) return { type: head }
  return null
}

export interface AttentionContext {
  /** Selected (query) token, from 0 */
  selected: number
  head: number
  temperature: number
}

export function describeAttentionPart(model: AttentionModel, result: AttentionResult, part: AttentionPart, ctx: AttentionContext): PartInfo {
  const { n, tokens } = model
  const q = part.type === 'token' || part.type === 'row' ? part.i - 1 : ctx.selected
  const word = `"${tokens[q]}"`
  const row = Array.from(result.weights.subarray(q * n, q * n + n))
  let best = 0
  for (let j = 1; j < n; j++) if (row[j] > row[best]) best = j
  const weights = Object.fromEntries(row.map((w, j) => [`${j + 1} ${tokens[j]}`, r4(w)]))
  switch (part.type) {
    case 'token':
      return { label: `the token ${word} at position ${q + 1} (attends most to "${tokens[best]}", weight ${f2(row[best])})`, values: weights }
    case 'row':
      return { label: `the attention weights for ${word} (row ${q + 1}; they sum to 1)`, values: weights }
    case 'scores':
      return {
        label: `the scores for ${word} before softmax (q·k divided by √${model.dk})`,
        values: Object.fromEntries(tokens.map((t, j) => [`${j + 1} ${t}`, r4(result.scores[q * n + j])]))
      }
    case 'weights':
      return { label: `the attention weights of head ${ctx.head + 1} (each row sums to 1, temperature ${ctx.temperature})`, values: { head: ctx.head + 1, temperature: ctx.temperature } }
    case 'mix':
      return { label: `the output for ${word}: the value vectors mixed by its attention weights (most from "${tokens[best]}", ${f2(row[best])})`, values: weights }
  }
}

// ---------- Gradient descent ----------

export type DescentPart = { type: 'point' | 'gradient' | 'path' | 'minimum' }

export function parseDescentPart(name: string): DescentPart | null {
  const key = name.trim().toLowerCase()
  return key === 'point' || key === 'gradient' || key === 'path' || key === 'minimum' ? { type: key } : null
}

export interface DescentContext {
  surface: Surface
  x: number
  y: number
  steps: number
  startLoss: number
}

export function describeDescentPart(part: DescentPart, ctx: DescentContext): PartInfo {
  const { surface, x, y } = ctx
  const f = surface.f(x, y)
  const [gx, gy] = surface.grad(x, y)
  switch (part.type) {
    case 'point':
      return { label: `the current point at (${f2(x)}, ${f2(y)}), where the loss is ${f.toFixed(3)}`, values: { x: r4(x), y: r4(y), loss: r4(f), step: ctx.steps } }
    case 'gradient':
      return { label: `the gradient at the current point, (${f2(gx)}, ${f2(gy)})`, values: { gx: r4(gx), gy: r4(gy), size: r4(Math.hypot(gx, gy)) } }
    case 'path':
      return { label: `the path so far (${ctx.steps} steps, loss from ${ctx.startLoss.toFixed(3)} to ${f.toFixed(3)})`, values: { steps: ctx.steps, startLoss: r4(ctx.startLoss), loss: r4(f) } }
    case 'minimum': {
      let best = surface.minima[0]
      for (const m of surface.minima) if (Math.hypot(m[0] - x, m[1] - y) < Math.hypot(best[0] - x, best[1] - y)) best = m
      const many = surface.minima.length > 1
      return {
        label: `the ${many ? 'nearest ' : ''}minimum of the ${surface.label.toLowerCase()} surface at (${f2(best[0])}, ${f2(best[1])})`,
        values: { x: r4(best[0]), y: r4(best[1]), loss: r4(surface.f(best[0], best[1])), distance: r4(Math.hypot(best[0] - x, best[1] - y)) }
      }
    }
  }
}

// ---------- Softmax ----------

export type SoftmaxPart = { type: 'logit'; i: number } | { type: 'probabilities' | 'temperature' }

export function parseSoftmaxPart(name: string, n: number): SoftmaxPart | null {
  const p = split(name)
  if (!p) return null
  const [head, a] = p
  if (head === 'logit' && p.length === 2 && a >= 1 && a <= n) return { type: 'logit', i: a }
  if (p.length === 1 && (head === 'probabilities' || head === 'temperature')) return { type: head }
  return null
}

export interface SoftmaxContext {
  logits: ArrayLike<number>
  labels: string[]
  p: ArrayLike<number>
  temperature: number
}

export function describeSoftmaxPart(part: SoftmaxPart, ctx: SoftmaxContext): PartInfo {
  const probs = Object.fromEntries(ctx.labels.map((l, i) => [l, r4(ctx.p[i])]))
  switch (part.type) {
    case 'logit': {
      const i = part.i - 1
      return {
        label: `the logit for "${ctx.labels[i]}" (${f2(ctx.logits[i])}, which gives probability ${f2(ctx.p[i])})`,
        values: { logit: r4(ctx.logits[i]), probability: r4(ctx.p[i]), temperature: ctx.temperature }
      }
    }
    case 'probabilities':
      return { label: `the probabilities after softmax at temperature ${ctx.temperature}`, values: probs }
    case 'temperature':
      return { label: `the temperature (currently ${ctx.temperature})`, values: { temperature: ctx.temperature, ...probs } }
  }
}

// ---------- Asking ----------

export function askDetail(kind: SimKind, part: string, info: PartInfo): AskDetail {
  return { kind, part, label: info.label, values: info.values }
}

/** Sends "tide:ask-about" up from the simulation's root. Returns the event, for tests. */
export function dispatchAsk(root: EventTarget, detail: AskDetail): CustomEvent<AskDetail> {
  const event = new CustomEvent(ASK_EVENT, { bubbles: true, cancelable: true, detail })
  root.dispatchEvent(event)
  return event
}

/** The question a composer is filled with when nothing else handles the event */
export const askQuestion = (detail: AskDetail) => `In the simulation, explain ${detail.label}.`
