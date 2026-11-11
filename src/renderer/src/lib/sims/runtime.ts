/** The kinds of simulation, and mounting one from a checked spec. Loaded on first use. */
import { attention } from './kinds/attention'
import { gradientDescent } from './kinds/gradientDescent'
import { neuralNet } from './kinds/neuralNet'
import { softmaxKind } from './kinds/softmax'
import { mountSim, type Mounted, type SimKindDef } from './shell'
import type { SimKind, SimSpec } from './spec'

export const KINDS: { [K in SimKind]: SimKindDef<Extract<SimSpec, { kind: K }>> } = {
  'neural-net': neuralNet,
  attention,
  'gradient-descent': gradientDescent,
  softmax: softmaxKind
}

export function mount(spec: SimSpec, place: (root: HTMLElement) => void): Mounted {
  return mountSim(spec, KINDS[spec.kind] as unknown as SimKindDef<SimSpec>, place)
}

export { parseSim } from './spec'
