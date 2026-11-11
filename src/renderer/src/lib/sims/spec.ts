/**
 * The ```sim block format: one JSON object with a "kind". Everything here is plain data in,
 * plain data out, so it can be tested without a window. Anything out of range is clamped;
 * anything missing gets a safe default; anything that isn't a simulation returns null and the
 * block stays visible as code.
 */
import type { Activation, DatasetName } from './mlp'
import type { OptimiserName, SurfaceName } from './optim'

export type SimKind = 'neural-net' | 'attention' | 'gradient-descent' | 'softmax'

/** What a tour step may do to the simulation so the picture matches the words */
export interface TourAction {
  /** Advance this many steps (training batches, optimiser steps) */
  run?: number
  /** true pauses, false plays */
  pause?: boolean
  /** Select sample or token n, counted from 1 */
  sample?: number
}

export interface TourStep {
  /** The named part to point at; '' or an unknown name shows the caption alone */
  at: string
  say: string
  do?: TourAction
}

interface Base {
  title: string
  seed: number
  tour: TourStep[]
}

export interface NeuralNetSpec extends Base {
  kind: 'neural-net'
  /** Input (always 2), hidden layers, output (always 1) */
  layers: number[]
  data: DatasetName
  activation: Activation
  rate: number
  batch: number
  points: number
  noise: number
  mode: 'train' | 'forward' | 'backward'
  /** Batches trained before it is shown, so a forward or backward pass has something to say */
  pretrain: number
  autoplay: boolean
}

export interface AttentionSpec extends Base {
  kind: 'attention'
  tokens: string[]
  heads: number
  temperature: number
  causal: boolean
  /** Selected token, from 0 */
  select: number
}

export interface GradientDescentSpec extends Base {
  kind: 'gradient-descent'
  surface: SurfaceName
  optimiser: OptimiserName
  rate: number
  momentum: number
  start: [number, number] | null
  autoplay: boolean
}

export interface SoftmaxSpec extends Base {
  kind: 'softmax'
  logits: number[]
  labels: string[]
  temperature: number
}

export type SimSpec = NeuralNetSpec | AttentionSpec | GradientDescentSpec | SoftmaxSpec

export const LIMITS = {
  hiddenLayers: 3,
  neurons: 8,
  rate: [0.0001, 3] as const,
  batch: [1, 64] as const,
  points: [40, 400] as const,
  tokens: 12,
  heads: 4,
  temperature: [0.1, 5] as const,
  logits: 8,
  logit: 8,
  tour: 12,
  run: 5000
}

export const RATES = [0.003, 0.01, 0.03, 0.1, 0.3, 1]

type Raw = Record<string, unknown>

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

const int = (v: unknown, fallback: number, lo: number, hi: number) => Math.round(num(v, fallback, lo, hi))

function pick<T extends string>(v: unknown, options: readonly T[], fallback: T, aliases: Record<string, T> = {}): T {
  if (typeof v !== 'string') return fallback
  const key = v.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if ((options as readonly string[]).includes(key)) return key as T
  return aliases[key] ?? fallback
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

function parseTour(v: unknown): TourStep[] {
  if (!Array.isArray(v)) return []
  const steps: TourStep[] = []
  for (const item of v) {
    if (steps.length >= LIMITS.tour) break
    if (!item || typeof item !== 'object') continue
    const raw = item as Raw
    const say = text(raw.say, 280)
    if (!say) continue
    const step: TourStep = { at: text(raw.at, 40).toLowerCase().replace(/\s+/g, ''), say }
    if (raw.do && typeof raw.do === 'object' && !Array.isArray(raw.do)) {
      const d = raw.do as Raw
      const action: TourAction = {}
      if (d.run !== undefined) action.run = int(d.run, 0, 0, LIMITS.run)
      if (typeof d.pause === 'boolean') action.pause = d.pause
      if (d.sample !== undefined) action.sample = int(d.sample, 1, 1, 400)
      if (Object.keys(action).length) step.do = action
    }
    steps.push(step)
  }
  return steps
}

function base(raw: Raw): Base {
  return { title: text(raw.title, 120), seed: int(raw.seed, 1, 0, 999999), tour: parseTour(raw.tour) }
}

function neuralNet(raw: Raw): NeuralNetSpec {
  // Accepts the full list [2, 4, 4, 1] or just the hidden layers
  const given = Array.isArray(raw.layers) ? raw.layers : Array.isArray(raw.hidden) ? [2, ...raw.hidden, 1] : [2, 4, 4, 1]
  const full = given.length >= 2 && Number(given[0]) === 2 && Number(given[given.length - 1]) === 1
  const hidden = (full ? given.slice(1, -1) : given)
    .slice(0, LIMITS.hiddenLayers)
    .map((n) => int(n, 4, 1, LIMITS.neurons))
  if (!hidden.length) hidden.push(4)
  const mode = pick(raw.mode, ['train', 'forward', 'backward'] as const, 'train')
  return {
    ...base(raw),
    kind: 'neural-net',
    layers: [2, ...hidden, 1],
    data: pick(raw.data ?? raw.dataset, ['xor', 'circle', 'two-moons', 'spiral', 'linear'] as const, 'xor', { moons: 'two-moons', circles: 'circle' }),
    activation: pick(raw.activation, ['tanh', 'relu', 'sigmoid'] as const, 'tanh'),
    rate: num(raw.rate ?? raw.lr ?? raw.learningRate, 0.3, ...LIMITS.rate),
    batch: int(raw.batch, 16, ...LIMITS.batch),
    points: int(raw.points, 160, ...LIMITS.points),
    noise: num(raw.noise, 0, 0, 0.5),
    mode,
    pretrain: int(raw.pretrain, mode === 'train' ? 0 : 1500, 0, LIMITS.run),
    autoplay: raw.autoplay !== false
  }
}

function attention(raw: Raw): AttentionSpec | null {
  const source = Array.isArray(raw.tokens) ? raw.tokens : typeof raw.text === 'string' ? raw.text.split(/\s+/) : []
  const tokens = source
    .map((t) => (typeof t === 'string' || typeof t === 'number' ? String(t).trim().slice(0, 24) : ''))
    .filter(Boolean)
    .slice(0, LIMITS.tokens)
  if (tokens.length < 2) return null
  return {
    ...base(raw),
    kind: 'attention',
    tokens,
    heads: int(raw.heads, 1, 1, LIMITS.heads),
    temperature: num(raw.temperature, 1, ...LIMITS.temperature),
    causal: raw.causal === true,
    select: int(raw.select, 1, 1, tokens.length) - 1
  }
}

function gradientDescent(raw: Raw): GradientDescentSpec {
  const start = Array.isArray(raw.start) && raw.start.length === 2 ? ([num(raw.start[0], 0, -3, 3), num(raw.start[1], 0, -3, 3)] as [number, number]) : null
  return {
    ...base(raw),
    kind: 'gradient-descent',
    surface: pick(raw.surface, ['bowl', 'ravine', 'saddle', 'two-minima'] as const, 'bowl', { 'two-minimums': 'two-minima', valley: 'ravine' }),
    optimiser: pick(raw.optimiser ?? raw.optimizer, ['sgd', 'momentum', 'adam'] as const, 'sgd'),
    rate: num(raw.rate ?? raw.lr ?? raw.learningRate, 0.1, 0.001, 1.2),
    momentum: num(raw.momentum ?? raw.beta, 0.9, 0, 0.99),
    start,
    autoplay: raw.autoplay !== false
  }
}

function softmaxSpec(raw: Raw): SoftmaxSpec {
  const given = Array.isArray(raw.logits) ? raw.logits.slice(0, LIMITS.logits).map((v) => num(v, 0, -LIMITS.logit, LIMITS.logit)) : []
  const logits = given.length >= 2 ? given : [2, 1, 0.1]
  const names = Array.isArray(raw.labels) ? raw.labels : []
  return {
    ...base(raw),
    kind: 'softmax',
    logits,
    labels: logits.map((_, i) => text(names[i], 24) || `Class ${i + 1}`),
    temperature: num(raw.temperature, 1, ...LIMITS.temperature)
  }
}

/** Turns the body of a ```sim block into a checked spec, or null when it isn't one (yet) */
export function parseSim(source: string): SimSpec | null {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Raw
  const kind = pick(obj.kind, ['neural-net', 'attention', 'gradient-descent', 'softmax'] as const, '' as SimKind, {
    'neural-network': 'neural-net',
    mlp: 'neural-net',
    'self-attention': 'attention'
  })
  if (kind === 'neural-net') return neuralNet(obj)
  if (kind === 'attention') return attention(obj)
  if (kind === 'gradient-descent') return gradientDescent(obj)
  if (kind === 'softmax') return softmaxSpec(obj)
  return null
}
