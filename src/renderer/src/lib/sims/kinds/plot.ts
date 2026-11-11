/** STUB: replace this whole file. The view of the "plot" simulation. */
import { h } from '../dom'
import type { PlotSpec } from '../plotExpr'
import type { SimKindDef } from '../shell'

export const plotKind: SimKindDef<PlotSpec> = {
  label: 'Function plot',
  transport: true,
  autoplay: () => false,
  create: () => ({ el: h('div'), step() {}, reset() {}, draw() {}, describe: () => null, highlight() {} })
}
