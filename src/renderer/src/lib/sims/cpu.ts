/** STUB: replace this whole file. The model, spec and named parts of the "cpu" simulation. */
import type { PartInfo } from './parts'
import type { Raw, SimBase } from './specUtil'

export interface CpuSpec extends SimBase {
  kind: 'cpu'
}

export function parseCpuSpec(_raw: Raw, base: SimBase): CpuSpec | null {
  return { ...base, kind: 'cpu' }
}

export type CpuPartInfo = PartInfo
