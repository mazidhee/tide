/** STUB: replace this whole file. The view of the "blockchain" simulation. */
import { h } from '../dom'
import type { BlockchainSpec } from '../chain'
import type { SimKindDef } from '../shell'

export const blockchainKind: SimKindDef<BlockchainSpec> = {
  label: 'Blockchain',
  transport: true,
  autoplay: () => false,
  create: () => ({ el: h('div'), step() {}, reset() {}, draw() {}, describe: () => null, highlight() {} })
}
