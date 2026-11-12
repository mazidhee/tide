import type { PairStatus } from '@shared/ide'

/** Claude as a pair programmer (filled in with the Claude coding tools) */
export function PairPanel({ status }: { status: PairStatus | null }) {
  return (
    <div className="ix-pair">
      <p className="ix-empty-note">{status?.ready ? 'Claude is ready.' : `Claude isn’t available${status?.why ? `: ${status.why}` : ''}.`}</p>
    </div>
  )
}
