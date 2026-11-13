/** What What you know › Your model shows (main/learnerModel modelView and nodeDetail) */
import type { Depth } from './learningEvents'

export interface ModelNodeView {
  id: string
  name: string
  area?: string
  depth: Depth
  target?: Depth
  retention?: number
  status?: string
  corrected?: boolean
  events: number
}

export interface ModelGoalView {
  id: string
  name: string
  date?: string
  weight?: string
  total: number
  atTarget: number
  begun: number
  /** Furthest below target first */
  concepts: ModelNodeView[]
}

export interface ModelView {
  at: number
  events: number
  /** Events no concept could be found for */
  loose: number
  /** Concepts studied, by depth */
  counts: Record<Depth, number>
  goals: ModelGoalView[]
  /** Concepts studied that serve no goal */
  other: ModelNodeView[]
  skills: ModelNodeView[]
  fading: ModelNodeView[]
  gaps: ModelNodeView[]
}

export interface ModelNodeDetail {
  node: ModelNodeView
  kind: string
  corrected?: { at: number; depth: Depth; note?: string }
  targetBy?: string
  targetGoal?: string
  measures: string
  levels: { level: Depth; label: string; reached: boolean; credit: number; tried: number; recent: number | null; needs: string }[]
  recent: { key: string; at: number; kind: string; source: string; line: string }[]
  needs: ModelNodeView[]
  usedIn: ModelNodeView[]
  serves: { id: string; name: string }[]
}
