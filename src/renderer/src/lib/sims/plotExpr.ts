/** STUB: replace this whole file. The model, spec and named parts of the "plot" simulation. */
import type { PartInfo } from './parts'
import type { Raw, SimBase } from './specUtil'

export interface PlotSpec extends SimBase {
  kind: 'plot'
}

export function parsePlotSpec(_raw: Raw, base: SimBase): PlotSpec | null {
  return { ...base, kind: 'plot' }
}

export type PlotPartInfo = PartInfo
