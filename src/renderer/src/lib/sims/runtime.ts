/**
 * The kinds of simulation, and mounting one from a checked spec. Loaded on first use. The kinds
 * built on a larger open-source library (planck.js, Mafs, regexp-tree, chess.js) are loaded only
 * when a block of that kind is first shown: see load().
 */
import { attention } from './kinds/attention'
import { gradientDescent } from './kinds/gradientDescent'
import { neuralNet } from './kinds/neuralNet'
import { softmaxKind } from './kinds/softmax'
import { raftKind } from './kinds/raft'
import { bTreeKind } from './kinds/bTree'
import { hashTableKind } from './kinds/hashTable'
import { cpuKind } from './kinds/cpu'
import { tokeniserKind } from './kinds/tokeniser'
import { blockchainKind } from './kinds/blockchain'
import { plotKind } from './kinds/plot'
import { mountSim, type Mounted, type SimKindDef } from './shell'
import type { SimKind, SimSpec } from './spec'

/** The kinds whose library is loaded on first use */
export const LAZY_KINDS = ['physics', 'geometry', 'regex', 'chess'] as const
type LazyKind = (typeof LAZY_KINDS)[number]
type EagerKind = Exclude<SimKind, LazyKind>
type Def<K extends SimKind> = SimKindDef<Extract<SimSpec, { kind: K }>>

export const KINDS: { [K in EagerKind]: Def<K> } = {
  'neural-net': neuralNet,
  attention,
  'gradient-descent': gradientDescent,
  softmax: softmaxKind,
  raft: raftKind,
  'b-tree': bTreeKind,
  'hash-table': hashTableKind,
  cpu: cpuKind,
  tokeniser: tokeniserKind,
  blockchain: blockchainKind,
  plot: plotKind
}

const LAZY: { [K in LazyKind]: () => Promise<Def<K>> } = {
  physics: () => import('./kinds/physics').then((m) => m.physicsKind),
  geometry: () => import('./kinds/geometry').then((m) => m.geometryKind),
  regex: () => import('./kinds/regex').then((m) => m.regexKind),
  chess: () => import('./kinds/chess').then((m) => m.chessKind)
}
const loaded = new Map<SimKind, SimKindDef<SimSpec>>()

const isLazy = (kind: SimKind): kind is LazyKind => (LAZY_KINDS as readonly string[]).includes(kind)

/** A kind's definition, loading its library the first time it is needed */
export async function load(kind: SimKind): Promise<SimKindDef<SimSpec>> {
  if (!isLazy(kind)) return KINDS[kind] as unknown as SimKindDef<SimSpec>
  let def = loaded.get(kind)
  if (!def) {
    def = (await LAZY[kind]()) as unknown as SimKindDef<SimSpec>
    loaded.set(kind, def)
  }
  return def
}

/** Mounts a spec whose kind is ready (always, for the kinds in KINDS; after load() for the rest) */
export function mount(spec: SimSpec, place: (root: HTMLElement) => void): Mounted {
  const def = isLazy(spec.kind) ? loaded.get(spec.kind) : (KINDS[spec.kind] as unknown as SimKindDef<SimSpec>)
  if (!def) throw new Error(`The ${spec.kind} simulation has not been loaded`)
  return mountSim(spec, def, place)
}

export { parseSim } from './spec'
