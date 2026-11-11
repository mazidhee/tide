import type { AppraiseRow } from '@shared/humanities'

/**
 * A reading or an argument appraised against the rubric (shared/humanities): each criterion with
 * where it stands and why. No verdict and no score: there is no single right answer to mark.
 */

const LEVEL_LABEL: Record<AppraiseRow['level'], string> = { strong: 'Strong', developing: 'Developing', missing: 'Missing', 'n/a': 'Not needed' }

export function AppraiseCard({ rows, text, render }: { rows: AppraiseRow[]; text: string; render: (md: string) => string }) {
  if (!rows.length) return <div className="s-appraise prose compact" dangerouslySetInnerHTML={{ __html: render(text) }} />
  return (
    <div className="s-appraise" role="group" aria-label="How your reading stands">
      <div className="s-appraise-head">How your reading stands</div>
      <ul>
        {rows.map((r) => (
          <li key={r.criterion} className={`lv-${r.level === 'n/a' ? 'na' : r.level}`}>
            <span className="s-appraise-crit">{r.criterion}</span>
            <span className="s-appraise-level">{LEVEL_LABEL[r.level]}</span>
            {r.note && <span className="s-appraise-note" dangerouslySetInnerHTML={{ __html: render(r.note).replace(/^<p>|<\/p>\s*$/g, '') }} />}
          </li>
        ))}
      </ul>
    </div>
  )
}
