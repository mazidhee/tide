import { useApp } from '../state'

export type BrainTab = 'know' | 'graph'
const KEY = 'tide.brain.tab'

/** The side of Brain last looked at; "What you know" until the graph has been chosen */
export function lastBrainTab(): BrainTab {
  try {
    return localStorage.getItem(KEY) === 'graph' ? 'graph' : 'know'
  } catch {
    return 'know'
  }
}

/** Brain has two sides: what you know, topic by topic, and the graph of everything Tide holds about you */
export function BrainTabs({ tab }: { tab: BrainTab }) {
  const app = useApp()
  const go = (to: BrainTab) => {
    try {
      localStorage.setItem(KEY, to)
    } catch {
      // Kept for this session only
    }
    if (to !== tab) app.setView({ kind: 'graph', tab: to })
  }
  return (
    <div className="segmented text brain-tabs" role="tablist" aria-label="Brain">
      <button role="tab" aria-selected={tab === 'know'} className={tab === 'know' ? 'on' : ''} onClick={() => go('know')}>
        What you know
      </button>
      <button role="tab" aria-selected={tab === 'graph'} className={tab === 'graph' ? 'on' : ''} onClick={() => go('graph')}>
        Graph
      </button>
    </div>
  )
}
