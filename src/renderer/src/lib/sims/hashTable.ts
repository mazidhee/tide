/** STUB: replace this whole file. The model, spec and named parts of the "hash-table" simulation. */
import type { PartInfo } from './parts'
import type { Raw, SimBase } from './specUtil'

export interface HashTableSpec extends SimBase {
  kind: 'hash-table'
}

export function parseHashTableSpec(_raw: Raw, base: SimBase): HashTableSpec | null {
  return { ...base, kind: 'hash-table' }
}

export type HashTablePartInfo = PartInfo
