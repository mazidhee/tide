import type { Proposal } from '@shared/ide'
import { hunks } from '@shared/hunks'
import { ProposalPane } from './ide/DiffPane'
import '../styles/ide.css'
import '../styles/lessoncode.css'

/**
 * The tutor's proposed edit in a coding lesson, as a card in the lesson: the IDE's own diff, with
 * Keep and Undo under each change and Apply to write the kept ones. Sized to the change.
 */
export function LessonProposal({ proposal, current, onResolve, onOpenFile }: { proposal: Proposal; current: string | null; onResolve(text: string | null): void; onOpenFile(): void }) {
  const list = hunks(proposal.original, proposal.proposed)
  // Each change with a few lines around it and its Keep bar; the explanation and the bar above
  const lines = list.reduce((n, h) => n + h.old.length + h.new.length + 6, 0)
  const height = Math.min(480, Math.max(150, lines * 21 + 46))
  const why = proposal.explanation.trim()
  return (
    <div className="lc-proposal" style={{ height: height + (why ? Math.min(140, 20 + 20 * Math.ceil(why.length / 100)) : 0) }}>
      {/* The tutor's reason, with its code spans as code: the pane itself shows it as plain text */}
      {why && <p className="lc-proposal-why" dangerouslySetInnerHTML={{ __html: inlineCode(why) }} />}
      <ProposalPane proposal={{ ...proposal, explanation: '' }} current={current} onResolve={onResolve} onOpenFile={onOpenFile} />
    </div>
  )
}

export default LessonProposal

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** Plain text with `code` spans, safely */
export const inlineCode = (s: string) => escape(s).replace(/`([^`\n]+)`/g, '<code>$1</code>')
