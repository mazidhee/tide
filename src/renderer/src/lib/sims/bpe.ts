/** STUB: replace this whole file. The model, spec and named parts of the "tokeniser" simulation. */
import type { PartInfo } from './parts'
import type { Raw, SimBase } from './specUtil'

export interface TokeniserSpec extends SimBase {
  kind: 'tokeniser'
}

export function parseTokeniserSpec(_raw: Raw, base: SimBase): TokeniserSpec | null {
  return { ...base, kind: 'tokeniser' }
}

export type TokeniserPartInfo = PartInfo
