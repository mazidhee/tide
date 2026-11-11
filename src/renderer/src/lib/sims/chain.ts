/** STUB: replace this whole file. The model, spec and named parts of the "blockchain" simulation. */
import type { PartInfo } from './parts'
import type { Raw, SimBase } from './specUtil'

export interface BlockchainSpec extends SimBase {
  kind: 'blockchain'
}

export function parseBlockchainSpec(_raw: Raw, base: SimBase): BlockchainSpec | null {
  return { ...base, kind: 'blockchain' }
}

export type BlockchainPartInfo = PartInfo
