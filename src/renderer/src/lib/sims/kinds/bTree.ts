/** STUB: replace this whole file. The view of the "b-tree" simulation. */
import { h } from '../dom'
import type { BTreeSpec } from '../btree'
import type { SimKindDef } from '../shell'

export const bTreeKind: SimKindDef<BTreeSpec> = {
  label: 'B-tree',
  transport: true,
  autoplay: () => false,
  create: () => ({ el: h('div'), step() {}, reset() {}, draw() {}, describe: () => null, highlight() {} })
}
