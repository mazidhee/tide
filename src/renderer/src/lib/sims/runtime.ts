/** The kinds of simulation, and mounting one from a checked spec. Loaded on first use. */
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

export const KINDS: { [K in SimKind]: SimKindDef<Extract<SimSpec, { kind: K }>> } = {
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

export function mount(spec: SimSpec, place: (root: HTMLElement) => void): Mounted {
  return mountSim(spec, KINDS[spec.kind] as unknown as SimKindDef<SimSpec>, place)
}

export { parseSim } from './spec'
