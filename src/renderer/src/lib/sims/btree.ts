/** STUB: replace this whole file. The model, spec and named parts of the "b-tree" simulation. */
import type { PartInfo } from './parts'
import type { Raw, SimBase } from './specUtil'

export interface BTreeSpec extends SimBase {
  kind: 'b-tree'
}

export function parseBTreeSpec(_raw: Raw, base: SimBase): BTreeSpec | null {
  return { ...base, kind: 'b-tree' }
}

export type BTreePartInfo = PartInfo
