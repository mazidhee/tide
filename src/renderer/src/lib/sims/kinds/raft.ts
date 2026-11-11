/** STUB: replace this whole file. The view of the "raft" simulation. */
import { h } from '../dom'
import type { RaftSpec } from '../raft'
import type { SimKindDef } from '../shell'

export const raftKind: SimKindDef<RaftSpec> = {
  label: 'Raft consensus',
  transport: true,
  autoplay: () => false,
  create: () => ({ el: h('div'), step() {}, reset() {}, draw() {}, describe: () => null, highlight() {} })
}
