/** STUB: replace this whole file. The model, spec and named parts of the "raft" simulation. */
import type { PartInfo } from './parts'
import type { Raw, SimBase } from './specUtil'

export interface RaftSpec extends SimBase {
  kind: 'raft'
}

export function parseRaftSpec(_raw: Raw, base: SimBase): RaftSpec | null {
  return { ...base, kind: 'raft' }
}

export type RaftPartInfo = PartInfo
