/** STUB: replace this whole file. The view of the "cpu" simulation. */
import { h } from '../dom'
import type { CpuSpec } from '../cpu'
import type { SimKindDef } from '../shell'

export const cpuKind: SimKindDef<CpuSpec> = {
  label: 'Register machine',
  transport: true,
  autoplay: () => false,
  create: () => ({ el: h('div'), step() {}, reset() {}, draw() {}, describe: () => null, highlight() {} })
}
