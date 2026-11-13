import { useMemo } from 'react'
import { mapMermaid, PREREQ_LABEL, type Prereq, type ProjectPlan } from '@shared/ideaProject'
import { renderMarkdown } from '../../lib/markdown'

const ENV = { notePath: '', filesByName: new Map<string, string>() }

/** The project map, drawn by Mermaid (lib/mermaid renders the block wherever it appears) */
export function PlanMap({ plan, highlight = [] }: { plan: Pick<ProjectPlan, 'components' | 'links'>; highlight?: string[] }) {
  const html = useMemo(() => renderMarkdown('```mermaid\n' + mapMermaid(plan, highlight) + '\n```', ENV), [plan, highlight])
  return <div className="ip-map prose" dangerouslySetInnerHTML={{ __html: html }} />
}

/** A prerequisite with where it stands: known (the accent), fading (outlined), new (plain) */
export function PrereqChip({ p }: { p: Prereq }) {
  return (
    <span className={`ip-prereq ${p.status}`} title={`${PREREQ_LABEL[p.status]}${p.matched ? `: “${p.matched}” in What you know` : p.status === 'new' ? ': not in What you know yet' : ''}`}>
      <span className="ip-prereq-dot" aria-hidden="true" />
      {p.name}
      <span className="sr-only"> ({PREREQ_LABEL[p.status]})</span>
    </span>
  )
}

export function PrereqLegend({ counts }: { counts: Record<'known' | 'fading' | 'new', number> }) {
  return (
    <span className="ip-legend">
      <span className="ip-prereq known">
        <span className="ip-prereq-dot" aria-hidden="true" />
        {counts.known} known
      </span>
      <span className="ip-prereq fading">
        <span className="ip-prereq-dot" aria-hidden="true" />
        {counts.fading} fading
      </span>
      <span className="ip-prereq new">
        <span className="ip-prereq-dot" aria-hidden="true" />
        {counts.new} new
      </span>
    </span>
  )
}

export const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
