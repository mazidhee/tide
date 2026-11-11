/**
 * The ```sim block format: one JSON object with a "kind". Everything here is plain data in,
 * plain data out, so it can be tested without a window. Anything out of range is clamped;
 * anything missing gets a safe default; anything that isn't a simulation returns null and the
 * block stays visible as code.
 */
import type { Activation, DatasetName } from './mlp'
import type { OptimiserName, SurfaceName } from './optim'

import type { BlockchainSpec } from './chain'
import type { BTreeSpec } from './btree'
import type { CpuSpec } from './cpu'
import type { HashTableSpec } from './hashTable'
import type { PlotSpec } from './plotExpr'
import type { PhysicsSpec } from './physics'
import type { GeometrySpec } from './geometry'
import type { RegexSpec } from './regex'
import type { ChessSpec } from './chess'
import { parsePhysicsSpec } from './physics'
import { parseGeometrySpec } from './geometry'
import { parseRegexSpec } from './regex'
import { parseChessSpec } from './chess'
import type { RaftSpec } from './raft'
import type { TokeniserSpec } from './bpe'
import { parseBlockchainSpec } from './chain'
import { parseBTreeSpec } from './btree'
import { parseCpuSpec } from './cpu'
import { parseHashTableSpec } from './hashTable'
import { parsePlotSpec } from './plotExpr'
import { parseRaftSpec } from './raft'
import { parseTokeniserSpec } from './bpe'
import { int, num, onlyVerbs, parseBase as base, pick, text, TOUR_LIMITS, type Raw, type SimBase } from './specUtil'
import { SIM_KINDS, type SimKind } from '@shared/sims'

export type { SimKind }
export type { TourAction, TourStep } from './specUtil'

type Base = SimBase

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

export type SimSpec =
  | NeuralNetSpec
  | AttentionSpec
  | GradientDescentSpec
  | SoftmaxSpec
  | RaftSpec
  | BTreeSpec
  | HashTableSpec
  | CpuSpec
  | TokeniserSpec
  | BlockchainSpec
  | PlotSpec
  | PhysicsSpec
  | GeometrySpec
  | RegexSpec
  | ChessSpec

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
  tour: TOUR_LIMITS.steps,
  run: TOUR_LIMITS.run
}

export const RATES = [0.003, 0.01, 0.03, 0.1, 0.3, 1]

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

/** The first four kinds take no tour verbs of their own */
const plain = <S extends SimBase>(spec: S | null): S | null => (spec ? onlyVerbs(spec, []) : null)

const KIND_ALIASES: Record<string, SimKind> = {
  'neural-network': 'neural-net',
  mlp: 'neural-net',
  'self-attention': 'attention',
  btree: 'b-tree',
  'b+tree': 'b-tree',
  hashtable: 'hash-table',
  'hash-map': 'hash-table',
  hashmap: 'hash-table',
  tokenizer: 'tokeniser',
  bpe: 'tokeniser',
  'register-machine': 'cpu',
  chain: 'blockchain',
  'block-chain': 'blockchain',
  function: 'plot',
  graph: 'plot',
  consensus: 'raft',
  mechanics: 'physics',
  'physics-engine': 'physics',
  projectile: 'physics',
  pendulum: 'physics',
  collision: 'physics',
  spring: 'physics',
  incline: 'physics',
  construction: 'geometry',
  'linear-map': 'geometry',
  transform: 'geometry',
  matrix: 'geometry',
  vectors: 'geometry',
  regexp: 'regex',
  'regular-expression': 'regex',
  railroad: 'regex',
  minimax: 'chess',
  'game-tree': 'chess',
  'alpha-beta': 'chess'
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
  const kind = pick(obj.kind, SIM_KINDS, '' as SimKind, KIND_ALIASES)
  switch (kind) {
    case 'neural-net':
      return plain(neuralNet(obj))
    case 'attention':
      return plain(attention(obj))
    case 'gradient-descent':
      return plain(gradientDescent(obj))
    case 'softmax':
      return plain(softmaxSpec(obj))
    case 'raft':
      return parseRaftSpec(obj, base(obj))
    case 'b-tree':
      return parseBTreeSpec(obj, base(obj))
    case 'hash-table':
      return parseHashTableSpec(obj, base(obj))
    case 'cpu':
      return parseCpuSpec(obj, base(obj))
    case 'tokeniser':
      return parseTokeniserSpec(obj, base(obj))
    case 'blockchain':
      return parseBlockchainSpec(obj, base(obj))
    case 'plot':
      return parsePlotSpec(obj, base(obj))
    case 'physics':
      return parsePhysicsSpec({ ...obj, ...(KIND_ALIASES[String(obj.kind).trim().toLowerCase()] === 'physics' && !obj.scene ? { scene: obj.kind } : {}) }, base(obj))
    case 'geometry':
      return parseGeometrySpec(obj, base(obj))
    case 'regex':
      return parseRegexSpec(obj, base(obj))
    case 'chess':
      return parseChessSpec(obj, base(obj))
    default:
      return null
  }
}
