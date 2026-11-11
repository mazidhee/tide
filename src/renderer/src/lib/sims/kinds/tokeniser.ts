/** STUB: replace this whole file. The view of the "tokeniser" simulation. */
import { h } from '../dom'
import type { TokeniserSpec } from '../bpe'
import type { SimKindDef } from '../shell'

export const tokeniserKind: SimKindDef<TokeniserSpec> = {
  label: 'Byte-pair tokeniser',
  transport: true,
  autoplay: () => false,
  create: () => ({ el: h('div'), step() {}, reset() {}, draw() {}, describe: () => null, highlight() {} })
}
