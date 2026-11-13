import { useEffect, useMemo, useState } from 'react'
import { MOCK_MODES, modeInfo, trendPoints, trendSummary, type MockMode, type MockRecord } from '@shared/mocks'
import type { MockStatus } from '../../../../main/mocks'
import { useApp } from '../../state'
import { Icon, type IconName } from '../Icon'
import { PillSegment } from '../PromptBox'
import { MockTrend } from './MockTrend'

export const MODE_ICON: Record<MockMode, IconName> = { coding: 'subCode', design: 'canvas', quant: 'subStatistics', behavioural: 'chat', exam: 'quiz' }

const pct = (v: number) => `${Math.round(v * 100)}%`
const when = (t: number) => {
  const d = Math.round((Date.now() - t) / 86_400_000)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Practice › Mock: the five kinds, whether Claude is there to interview, and the history */
export function MockPanel() {
  const app = useApp()
  const [status, setStatus] = useState<MockStatus | null>(null)
  const [filter, setFilter] = useState<MockMode | 'all'>('all')
  useEffect(() => {
    window.tide.mocks
      .status()
      .then(setStatus)
      .catch(() => setStatus({ claude: false, why: 'unavailable', level: 2, history: [] }))
  }, [])
  // Sharpness's weakest category that a mock covers, to suggest it (main/sharpness weakMockModes)
  const [weak, setWeak] = useState<{ mode: MockMode; rating: number } | null>(null)
  useEffect(() => {
    window.tide.sharp
      .weakModes()
      .then((w) => setWeak(w.length >= 2 ? w[0] : null))
      .catch(() => {})
  }, [])
  const history: MockRecord[] = useMemo(() => status?.history ?? [], [status])
  const points = trendPoints(history, filter)
  const summary = trendSummary(history, filter)
  const recent = [...history].filter((r) => filter === 'all' || r.mode === filter).sort((a, b) => b.at - a.at).slice(0, 8)
  const open = (mode: MockMode) => app.setView({ kind: 'mock', mode, nonce: Date.now() })

  return (
    <section className="pv-prompt wide mk-panel">
      <h2 className="pv-title">Mock interviews and exams</h2>
      <p className="pv-sub">Timed, with no breaks, marked against a rubric, then a debrief with what to practise next.</p>
      <p className="mk-who" role="status">
        <Icon name="claude" size={13} />
        {status === null ? 'Checking for Claude…' : status.claude ? 'Claude interviews (Sonnet) and marks (Opus).' : `Claude isn’t ready${status.why ? ` (${status.why})` : ''}: mocks run without an interviewer and are marked in code.`}
      </p>

      {weak && (
        <p className="mk-who mk-weak">
          <Icon name="gauge" size={13} />
          <span>
            Sharpness has <strong>{modeInfo(weak.mode).short}</strong> as your weakest of these (rating {weak.rating}).{' '}
            <button className="link-btn" onClick={() => open(weak.mode)}>
              Take a {modeInfo(weak.mode).short} mock
            </button>
          </span>
        </p>
      )}

      <ul className="mk-modes">
        {MOCK_MODES.map((m) => {
          const s = trendSummary(history, m.id)
          return (
            <li key={m.id}>
              <button className="mk-mode" onClick={() => open(m.id)}>
                <span className="mk-mode-icon" aria-hidden="true">
                  <Icon name={MODE_ICON[m.id]} size={17} />
                </span>
                <span className="mk-mode-main">
                  <span className="mk-mode-name">{m.label}</span>
                  <span className="mk-mode-blurb">{m.blurb}</span>
                </span>
                <span className="mk-mode-meta tabular">
                  {s.count ? (
                    <>
                      <strong>{pct(s.last!)}</strong>
                      <span>
                        latest · {s.count} mock{s.count === 1 ? '' : 's'}
                      </span>
                    </>
                  ) : (
                    <span>{m.minutesDefault} min</span>
                  )}
                </span>
                <Icon name="chevron" size={13} className="mk-mode-go" />
              </button>
            </li>
          )
        })}
      </ul>

      {history.length > 0 && (
        <div className="mk-history">
          <div className="mk-history-head">
            <h3>History</h3>
            <PillSegment
              label="Show"
              value={filter}
              onChange={(v) => setFilter(v as MockMode | 'all')}
              options={[{ value: 'all', label: 'All' }, ...MOCK_MODES.filter((m) => history.some((r) => r.mode === m.id)).map((m) => ({ value: m.id, label: m.short }))]}
            />
          </div>
          {summary.count > 0 && (
            <p className="know-chart-say">
              {summary.count} mock{summary.count === 1 ? '' : 's'}; latest <strong>{pct(summary.last!)}</strong>, best <strong>{pct(summary.best!)}</strong>
              {summary.change !== null && summary.change !== 0 ? (
                <>
                  , {summary.change > 0 ? 'up' : 'down'} <strong>{Math.abs(Math.round(summary.change * 100))} points</strong> on the one before
                </>
              ) : null}
              .
            </p>
          )}
          <MockTrend points={points} />
          <ul className="mk-recent">
            {recent.map((r) => (
              <li key={r.id}>
                <button className="mk-recent-row" onClick={() => app.setView({ kind: 'mock', mode: r.mode, review: r.id, nonce: Date.now() })}>
                  <Icon name={MODE_ICON[r.mode]} size={14} />
                  <span className="mk-recent-title">{r.title}</span>
                  <span className="mk-recent-kind">{modeInfo(r.mode).short}</span>
                  <span className="mk-recent-when">{when(r.at)}</span>
                  <span className="mk-recent-score tabular">{pct(r.overall)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
