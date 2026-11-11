/** STUB: replace this whole file. The view of the "hash-table" simulation. */
import { h } from '../dom'
import type { HashTableSpec } from '../hashTable'
import type { SimKindDef } from '../shell'

export const hashTableKind: SimKindDef<HashTableSpec> = {
  label: 'Hash table',
  transport: true,
  autoplay: () => false,
  create: () => ({ el: h('div'), step() {}, reset() {}, draw() {}, describe: () => null, highlight() {} })
}
