import { useEffect, useMemo, useState } from 'react'
import { compareRuns, curve, experimentFor, lowerIsBetter, type TrainingRun } from '@shared/runs'
import { Icon } from '../Icon'

/**
 * The notebook's Runs tab: training runs logged with tide_runs, compared. Learning first: the
 * settings that changed between the picked runs come first (the ones that stayed the same are
 * folded into a line), then one metric's curves on one axis, then what the change did. Colours
 * are --series-1…6 in fixed order, by the run's place in the list, so a run keeps its colour
 * while others are ticked on and off.
 */
const MAX = 6
const W = 340
const H = 170
const PAD = { l: 46, r: 10, t: 10, b: 22 }

const fmt = (n: number) => (Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0) ? n.toExponential(2).replace('e+', 'e') : String(Number(n.toPrecision(3))))
/** A tick on a log axis: 1e15, 0.1 */
const powerText = (n: number) => (n >= 1000 || n < 0.01 ? `1e${Math.round(Math.log10(n))}` : String(n))

function preferredMetric(keys: string[]): string {
  return keys.find((k) => /^val.*loss$/i.test(k)) ?? keys.find((k) => /loss/i.test(k)) ?? keys[0] ?? ''
}

export function RunsPane({ notebook, kernel }: { notebook: string; kernel: string }) {
  const experiment = experimentFor(notebook)
  const [runs, setRuns] = useState<TrainingRun[] | null>(null)
  const [picked, setPicked] = useState<string[] | null>(null)
  const [metric, setMetric] = useState('')
  const [hover, setHover] = useState<number | null>(null)

  const load = () => window.tide.packs.runs(experiment).then(setRuns, () => setRuns([]))
  useEffect(() => {
    void load()
    // A cell that finished may have logged a run
  }, [experiment, kernel]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // While a cell runs, its run's curve grows
    if (kernel !== 'busy') return
    const t = setInterval(() => void load(), 1500)
    return () => clearInterval(t)
  }, [kernel, experiment]) // eslint-disable-line react-hooks/exhaustive-deps

  const all = runs ?? []
  const chosen = picked ?? all.slice(-3).map((r) => r.id)
  const shown = all.filter((r) => chosen.includes(r.id))
  const colourOf = (id: string) => `var(--series-${(all.findIndex((r) => r.id === id) % MAX) + 1})`
  const c = useMemo(() => compareRuns(shown), [shown.map((r) => `${r.id}:${Object.values(r.metrics).reduce((n, p) => n + p.length, 0)}:${r.status}`).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const metricKeys = [...new Set(shown.flatMap((r) => Object.keys(r.metrics)))]
  const m = metricKeys.includes(metric) ? metric : preferredMetric(metricKeys)

  if (runs === null) return <p className="nb-muted nb-pad">Reading runs…</p>
  if (!all.length)
    return (
      <div className="nb-runs-empty nb-pad">
        <p>No training runs yet. Log one from a cell and it shows here, ready to compare with the next:</p>
        <pre className="nb-runs-code">{`import tide_runs\n\nwith tide_runs.run("lr 0.1", params={"lr": 0.1}) as r:\n    for epoch in range(20):\n        ...\n        r.log(epoch, loss=loss, val_loss=val)`}</pre>
        <p className="nb-muted">Change one setting between runs, then tick them both to see what it did.</p>
      </div>
    )

  // The chart: the picked runs' curves of one metric, on one axis
  const lines = shown.map((r) => ({ id: r.id, name: r.name, pts: curve(r.metrics[m]) })).filter((l) => l.pts.length)
  const xs = lines.flatMap((l) => l.pts.map((p) => p[0]))
  const ys = lines.flatMap((l) => l.pts.map((p) => p[1]))
  const x0 = Math.min(...xs, 0)
  const x1 = Math.max(...xs, 1)
  let y0 = Math.min(...ys)
  let y1 = Math.max(...ys)
  if (!ys.length) [y0, y1] = [0, 1]
  if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1]
  // A run that blew up would flatten the others: past a thousandfold range, the axis is logarithmic
  const log = ys.length > 0 && y0 > 0 && y1 / y0 > 1000
  const ty = (y: number) => (log ? Math.log10(y) : y)
  let t0 = ty(y0)
  let t1 = ty(y1)
  const pad = (t1 - t0) * 0.06
  t0 -= pad
  t1 += pad
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r)
  const sy = (y: number) => PAD.t + (1 - (ty(y) - t0) / (t1 - t0)) * (H - PAD.t - PAD.b)
  const ticks = (log ? [t0 + pad, (t0 + t1) / 2, t1 - pad].map((t) => 10 ** Math.round(t)) : [t0 + pad, (t0 + t1) / 2, t1 - pad]).filter((t, i, a) => a.indexOf(t) === i)
  const atHover = hover === null ? [] : lines.map((l) => ({ ...l, p: l.pts.reduce((best, p) => (Math.abs(p[0] - hover) < Math.abs(best[0] - hover) ? p : best), l.pts[0]) }))
  const metricRow = c.metrics.find((x) => x.key === m)

  return (
    <div className="nb-runs">
      <div className="nb-runs-head">
        <span className="nb-muted">Runs in {experiment}</span>
        <button className="icon-btn" title="Read the runs again" onClick={() => void load()}>
          <Icon name="refresh" size={13} />
        </button>
      </div>
      <ul className="nb-run-list" aria-label="Training runs">
        {[...all].reverse().map((r) => {
          const on = chosen.includes(r.id)
          const diverged = Object.values(r.metrics).some((p) => p.some((x) => !Number.isFinite(x.value)))
          return (
            <li key={r.id} className={on ? 'on' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && chosen.length >= MAX}
                  onChange={() => setPicked(on ? chosen.filter((x) => x !== r.id) : [...chosen, r.id])}
                />
                <span className="nb-run-swatch" style={{ background: on ? colourOf(r.id) : 'transparent', borderColor: colourOf(r.id) }} aria-hidden="true" />
                <span className="nb-run-name">{r.name}</span>
                <span className="nb-run-state">{diverged ? 'diverged' : r.status === 'running' ? 'running' : r.status === 'finished' ? `${Math.max(0, ...Object.values(r.metrics).map((p) => p.length))} steps` : r.status}</span>
              </label>
              <button className="icon-btn nb-run-del" title="Forget this run" onClick={() => void window.tide.packs.deleteRun(experiment, r.id).then(load)}>
                <Icon name="x" size={11} />
              </button>
            </li>
          )
        })}
      </ul>

      {shown.length > 0 && (
        <>
          <section className="nb-runs-section" aria-label="What changed">
            <h4>What changed</h4>
            {c.changed.length ? (
              <table className="nb-runs-table">
                <thead>
                  <tr>
                    <th scope="col">Setting</th>
                    {shown.map((r) => (
                      <th key={r.id} scope="col">
                        <span className="nb-run-swatch small" style={{ background: colourOf(r.id), borderColor: colourOf(r.id) }} aria-hidden="true" />
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.changed.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.key}</th>
                      {row.values.map((v, i) => (
                        <td key={i}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="nb-muted">{shown.length > 1 ? 'Nothing: these runs used the same settings.' : 'Tick a second run to compare.'}</p>
            )}
            {c.same.length > 0 && <p className="nb-muted nb-runs-same">Same in each: {c.same.map((s) => `${s.key} ${s.value}`).join(' · ')}</p>}
          </section>

          {metricKeys.length > 0 && (
            <section className="nb-runs-section" aria-label="Curves">
              <div className="nb-runs-chart-head">
                <h4>
                  {m}
                  {log && <span className="nb-muted"> · log scale</span>}
                </h4>
                {metricKeys.length > 1 && (
                  <select className="nb-runs-metric" value={m} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">
                    {metricKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <svg
                className="nb-runs-chart"
                viewBox={`0 0 ${W} ${H}`}
                role="img"
                aria-label={`${m} by step for ${lines.map((l) => l.name).join(', ')}`}
                onMouseMove={(e) => {
                  const box = e.currentTarget.getBoundingClientRect()
                  const x = x0 + (((e.clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r) * (x1 - x0)
                  setHover(Math.max(x0, Math.min(x1, x)))
                }}
                onMouseLeave={() => setHover(null)}
              >
                {ticks.map((t, i) => (
                  <g key={i}>
                    <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} className="nb-runs-grid" />
                    <text x={PAD.l - 6} y={sy(t) + 3} className="nb-runs-tick" textAnchor="end">
                      {log ? powerText(t) : fmt(t)}
                    </text>
                  </g>
                ))}
                <text x={PAD.l} y={H - 6} className="nb-runs-tick">
                  {fmt(x0)}
                </text>
                <text x={W - PAD.r} y={H - 6} className="nb-runs-tick" textAnchor="end">
                  step {fmt(x1)}
                </text>
                {lines.map((l) => (
                  <polyline key={l.id} points={l.pts.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} fill="none" stroke={colourOf(l.id)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {hover !== null && (
                  <>
                    <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={H - PAD.b} className="nb-runs-cross" />
                    {atHover.map((l) => (
                      <circle key={l.id} cx={sx(l.p[0])} cy={sy(l.p[1])} r={4} fill={colourOf(l.id)} stroke="var(--bg-sidebar)" strokeWidth={2} />
                    ))}
                  </>
                )}
              </svg>
              <div className="nb-runs-readout" aria-live="polite">
                {(hover !== null ? atHover : lines.map((l) => ({ ...l, p: l.pts[l.pts.length - 1] }))).map((l) => (
                  <span key={l.id}>
                    <span className="nb-run-swatch small" style={{ background: colourOf(l.id), borderColor: colourOf(l.id) }} aria-hidden="true" />
                    {l.name} <b>{fmt(l.p[1])}</b>
                    {hover !== null && <span className="nb-muted"> at step {fmt(l.p[0])}</span>}
                  </span>
                ))}
              </div>
              {metricRow && metricRow.winner !== null && shown.length > 1 && (
                <p className="nb-runs-best">
                  Best final {m}: <b>{shown[metricRow.winner].name}</b> ({lowerIsBetter(m) ? 'lower is better' : 'higher is better'})
                </p>
              )}
            </section>
          )}

          {c.findings.length > 0 && (
            <section className="nb-runs-section" aria-label="What the change did">
              <h4>What the change did</h4>
              <ul className="nb-runs-findings">
                {c.findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
