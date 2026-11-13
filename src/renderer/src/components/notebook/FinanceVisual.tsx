/**
 * Finance visuals in a notebook, from tide_nb in the kernel (application/vnd.tide.finance+json):
 * a yield curve to scrub through time, an option's payoff and Greeks with sliders, the efficient
 * frontier with each portfolio's weights, and order-book depth with a market order walking it.
 * Drawn in SVG with Tide's chart rules: marks in --series-1…6 in order, text in the ink tokens,
 * quiet gridlines, the exact value on hover. Prices recompute here (shared/finance/quant), so the
 * sliders move with no round trip to the kernel.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { blackScholes } from '@shared/finance/quant'
import { compact, fullNumber, place, valueScale, type Scale } from '@shared/labChart'

type Pt = [number, number]

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const PAD = { l: 48, r: 16, t: 12, b: 30 }

interface Frame {
  w: number
  h: number
  x: Scale
  y: Scale
  px(v: number): number
  py(v: number): number
}

function frame(w: number, h: number, xs: number[], ys: number[], o: { xZero?: boolean; yZero?: boolean } = {}): Frame {
  const x = valueScale(xs, !!o.xZero, Math.max(3, Math.floor((w - PAD.l - PAD.r) / 80)))
  const y = valueScale(ys, !!o.yZero, 5)
  return { w, h, x, y, px: (v) => PAD.l + place(v, x.min, x.max, w - PAD.l - PAD.r), py: (v) => h - PAD.b - place(v, y.min, y.max, h - PAD.t - PAD.b) }
}

function Axes({ f, xLabel, yLabel, xFmt = compact, yFmt = compact }: { f: Frame; xLabel?: string; yLabel?: string; xFmt?: (v: number) => string; yFmt?: (v: number) => string }) {
  return (
    <g className="fv-axes">
      {f.y.ticks.map((t) => (
        <g key={`y${t}`}>
          <line className="fv-grid" x1={PAD.l} x2={f.w - PAD.r} y1={f.py(t)} y2={f.py(t)} />
          <text className="fv-tick" x={PAD.l - 6} y={f.py(t)} dy="0.32em" textAnchor="end">
            {yFmt(t)}
          </text>
        </g>
      ))}
      {f.x.ticks.map((t) => (
        <text key={`x${t}`} className="fv-tick" x={f.px(t)} y={f.h - PAD.b + 16} textAnchor="middle">
          {xFmt(t)}
        </text>
      ))}
      <line className="fv-axis" x1={PAD.l} x2={f.w - PAD.r} y1={f.h - PAD.b} y2={f.h - PAD.b} />
      {xLabel && (
        <text className="fv-label" x={f.w - PAD.r} y={f.h - 2} textAnchor="end">
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text className="fv-label" x={PAD.l} y={PAD.t - 2}>
          {yLabel}
        </text>
      )}
    </g>
  )
}

const path = (pts: Pt[], f: Frame) =>
  pts
    .filter(([, y]) => Number.isFinite(y))
    .map(([x, y], i) => `${i ? 'L' : 'M'}${f.px(x).toFixed(1)},${f.py(y).toFixed(1)}`)
    .join('')

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange(v: number): void }) {
  return (
    <label className="fv-slider">
      <span className="fv-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="fv-slider-value">{fmt(value)}</span>
    </label>
  )
}

// ---------- The yield curve ----------

interface CurveData {
  title: string
  tenors: number[]
  curves: { label: string; y: (number | null)[] }[]
}

const tenorText = (t: number) => (t < 1 ? `${Math.round(t * 12)}m` : `${fullNumber(t)}y`)

function YieldCurve({ d }: { d: CurveData }) {
  const [ref, w] = useWidth()
  const [i, setI] = useState(d.curves.length - 1)
  const [hover, setHover] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(d.curves.length > 1 ? 0 : null)
  const h = 260
  // Tenors are spaced by the square root of time, so the short end isn't crushed
  const sx = (t: number) => Math.sqrt(t)
  const all = d.curves.flatMap((c) => c.y).filter((v): v is number => v !== null)
  const f = frame(w, h, d.tenors.map(sx), all)
  const cur = d.curves[Math.min(i, d.curves.length - 1)]
  const pts = (c: CurveData['curves'][number]): Pt[] => d.tenors.map((t, k) => [sx(t), c.y[k] ?? NaN])
  const xTicks = d.tenors
  const spread = (c: CurveData['curves'][number]) => {
    const at = (t: number) => c.y[d.tenors.findIndex((x) => Math.abs(x - t) < 1e-6)]
    const a = at(10)
    const b = at(2)
    return a != null && b != null ? a - b : null
  }
  const s = spread(cur)
  return (
    <div ref={ref} className="fv">
      <div className="fv-head">
        <span className="fv-title">{d.title}</span>
        <span className="fv-meta">
          {cur.label}
          {s != null && (
            <span className={s < 0 ? 'fv-flag' : ''}>
              {' '}
              · 10y − 2y {s >= 0 ? '+' : '−'}
              {Math.abs(s).toFixed(2)}
              {s < 0 ? ' inverted' : ''}
            </span>
          )}
        </span>
      </div>
      <svg width={w} height={h} onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
        const x = e.clientX - (e.currentTarget.getBoundingClientRect().left)
        let best = 0
        d.tenors.forEach((t, k) => Math.abs(f.px(sx(t)) - x) < Math.abs(f.px(sx(d.tenors[best])) - x) && (best = k))
        setHover(best)
      }}>
        <g className="fv-axes">
          {f.y.ticks.map((t) => (
            <g key={t}>
              <line className="fv-grid" x1={PAD.l} x2={w - PAD.r} y1={f.py(t)} y2={f.py(t)} />
              <text className="fv-tick" x={PAD.l - 6} y={f.py(t)} dy="0.32em" textAnchor="end">
                {compact(t)}%
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} className="fv-tick" x={f.px(sx(t))} y={h - PAD.b + 16} textAnchor="middle">
              {tenorText(t)}
            </text>
          ))}
          <line className="fv-axis" x1={PAD.l} x2={w - PAD.r} y1={h - PAD.b} y2={h - PAD.b} />
        </g>
        {pinned !== null && pinned !== i && <path className="fv-line s2 dashed" d={path(pts(d.curves[pinned]), f)} />}
        <path className="fv-line s1" d={path(pts(cur), f)} />
        {d.tenors.map((t, k) => cur.y[k] != null && <circle key={t} className="fv-dot s1" cx={f.px(sx(t))} cy={f.py(cur.y[k]!)} r={hover === k ? 4.5 : 2.5} />)}
        {hover !== null && cur.y[hover] != null && (
          <g className="fv-tip" transform={`translate(${Math.min(f.px(sx(d.tenors[hover])) + 8, w - 120)},${PAD.t + 4})`}>
            <rect width="112" height="34" rx="6" />
            <text x="8" y="14">{tenorText(d.tenors[hover])}: {cur.y[hover]!.toFixed(2)}%</text>
            {pinned !== null && d.curves[pinned].y[hover] != null && <text x="8" y="28" className="fv-tip-sub">{d.curves[pinned].label}: {d.curves[pinned].y[hover]!.toFixed(2)}%</text>}
          </g>
        )}
      </svg>
      {d.curves.length > 1 && (
        <div className="fv-controls">
          <Slider label="Date" value={i} min={0} max={d.curves.length - 1} step={1} fmt={(v) => d.curves[v].label} onChange={setI} />
          <div className="fv-legend">
            <span className="fv-key s1" /> {cur.label}
            {pinned !== null && (
              <>
                <span className="fv-key s2 dashed" /> {d.curves[pinned].label}
              </>
            )}
            <button className="fv-link" onClick={() => setPinned(pinned === i ? null : i)}>
              {pinned === i ? 'Unpin' : 'Compare with this date'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- An option's payoff and Greeks ----------

interface OptionData {
  title: string
  spot: number
  t: number
  r: number
  sigma: number
  q: number
  legs: { kind: 'call' | 'put'; strike: number; qty: number }[]
}

type Greek = 'value' | 'delta' | 'gamma' | 'vega' | 'theta'
const GREEKS: { id: Greek; label: string }[] = [
  { id: 'value', label: 'Value' },
  { id: 'delta', label: 'Delta' },
  { id: 'gamma', label: 'Gamma' },
  { id: 'vega', label: 'Vega' },
  { id: 'theta', label: 'Theta' }
]

function OptionVisual({ d }: { d: OptionData }) {
  const [ref, w] = useWidth()
  const [spot, setSpot] = useState(d.spot)
  const [sigma, setSigma] = useState(d.sigma)
  const [t, setT] = useState(d.t)
  const [r, setR] = useState(d.r)
  const [greek, setGreek] = useState<Greek>('value')
  const [hover, setHover] = useState<number | null>(null)
  const h = 250
  const strikes = d.legs.map((l) => l.strike)
  const lo = Math.max(0.01, Math.min(...strikes, d.spot) * 0.5)
  const hi = Math.max(...strikes, d.spot) * 1.5
  const at = (s: number, tt: number) => {
    let v = { value: 0, delta: 0, gamma: 0, vega: 0, theta: 0 }
    for (const l of d.legs) {
      if (tt <= 1e-6) {
        const pay = l.kind === 'call' ? Math.max(s - l.strike, 0) : Math.max(l.strike - s, 0)
        v = { ...v, value: v.value + l.qty * pay }
        continue
      }
      const b = blackScholes({ s, k: l.strike, t: tt, r, sigma, type: l.kind, q: d.q })
      v = { value: v.value + l.qty * b.price, delta: v.delta + l.qty * b.delta, gamma: v.gamma + l.qty * b.gamma, vega: v.vega + l.qty * b.vega, theta: v.theta + l.qty * b.theta }
    }
    return v
  }
  const xs = useMemo(() => Array.from({ length: 121 }, (_, k) => lo + ((hi - lo) * k) / 120), [lo, hi])
  const now = xs.map((s) => at(s, t))
  const expiry = xs.map((s) => at(s, 0).value)
  const ys = greek === 'value' ? [...now.map((v) => v.value), ...expiry] : now.map((v) => v[greek])
  const f = frame(w, h, xs, ys, { yZero: true })
  const cur = at(spot, t)
  const hv = hover !== null ? { s: xs[hover], v: now[hover], e: expiry[hover] } : null
  return (
    <div ref={ref} className="fv">
      <div className="fv-head">
        <span className="fv-title">{d.title}</span>
        <span className="fv-meta">
          value {cur.value.toFixed(2)} · Δ {cur.delta.toFixed(3)} · Γ {cur.gamma.toFixed(4)} · vega {(cur.vega / 100).toFixed(3)} per vol point · θ {(cur.theta / 365).toFixed(3)} a day
        </span>
      </div>
      <div className="fv-tabs" role="tablist">
        {GREEKS.map((g) => (
          <button key={g.id} role="tab" aria-selected={greek === g.id} className={greek === g.id ? 'on' : ''} onClick={() => setGreek(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      <svg width={w} height={h} onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left
        const k = Math.round(((x - PAD.l) / (w - PAD.l - PAD.r)) * 120)
        setHover(k >= 0 && k <= 120 ? k : null)
      }}>
        <Axes f={f} xLabel="spot" />
        {f.y.min < 0 && <line className="fv-zero" x1={PAD.l} x2={w - PAD.r} y1={f.py(0)} y2={f.py(0)} />}
        {greek === 'value' && <path className="fv-line s2 dashed" d={path(xs.map((s, k) => [s, expiry[k]]), f)} />}
        <path className="fv-line s1" d={path(xs.map((s, k) => [s, greek === 'value' ? now[k].value : now[k][greek]]), f)} />
        {strikes.map((k) => (
          <line key={k} className="fv-mark" x1={f.px(k)} x2={f.px(k)} y1={PAD.t} y2={h - PAD.b} />
        ))}
        <circle className="fv-dot s1 big" cx={f.px(spot)} cy={f.py(greek === 'value' ? cur.value : cur[greek])} r={4.5} />
        {hv && (
          <g className="fv-tip" transform={`translate(${Math.min(f.px(hv.s) + 8, w - 150)},${PAD.t + 4})`}>
            <rect width="142" height={greek === 'value' ? 34 : 20} rx="6" />
            <text x="8" y="14">S {hv.s.toFixed(1)}: {(greek === 'value' ? hv.v.value : hv.v[greek]).toFixed(greek === 'gamma' ? 4 : 3)}</text>
            {greek === 'value' && <text x="8" y="28" className="fv-tip-sub">at expiry {hv.e.toFixed(2)}</text>}
          </g>
        )}
      </svg>
      <div className="fv-legend">
        <span className="fv-key s1" /> {greek === 'value' ? 'value today' : GREEKS.find((g) => g.id === greek)!.label.toLowerCase()}
        {greek === 'value' && (
          <>
            <span className="fv-key s2 dashed" /> payoff at expiry
          </>
        )}
        <span className="fv-key mark" /> strike
      </div>
      <div className="fv-controls grid">
        <Slider label="Spot" value={spot} min={lo} max={hi} step={(hi - lo) / 200} fmt={(v) => v.toFixed(1)} onChange={setSpot} />
        <Slider label="Volatility" value={sigma} min={0.01} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={setSigma} />
        <Slider label="Time to expiry" value={t} min={0} max={Math.max(2, d.t * 2)} step={0.01} fmt={(v) => (v < 1 ? `${Math.round(v * 365)} days` : `${v.toFixed(2)} years`)} onChange={setT} />
        <Slider label="Rate" value={r} min={0} max={0.1} step={0.0025} fmt={(v) => `${(v * 100).toFixed(2)}%`} onChange={setR} />
      </div>
    </div>
  )
}

// ---------- The efficient frontier ----------

interface FrontierData {
  title: string
  names: string[]
  points: { ret: number; vol: number; w: number[] }[]
  assets: { name: string; ret: number; vol: number }[]
  rf: number | null
  tangency: number | null
  minVar: number | null
  method: string
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function Frontier({ d }: { d: FrontierData }) {
  const [ref, w] = useWidth()
  const [sel, setSel] = useState<number | null>(d.tangency ?? d.minVar)
  const h = 280
  const f = frame(Math.max(280, w - 200), h, [...d.points.map((p) => p.vol), ...d.assets.map((a) => a.vol), 0], [...d.points.map((p) => p.ret), ...d.assets.map((a) => a.ret), ...(d.rf != null ? [d.rf] : [])], { xZero: true })
  const p = sel !== null ? d.points[sel] : null
  const tan = d.tangency !== null ? d.points[d.tangency] : null
  return (
    <div ref={ref} className="fv">
      <div className="fv-head">
        <span className="fv-title">{d.title}</span>
        <span className="fv-meta">{d.method}</span>
      </div>
      <div className="fv-split">
        <svg width={f.w} height={h} onMouseLeave={() => {}} onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - r.left
          const y = e.clientY - r.top
          let best = -1
          let dist = 30
          d.points.forEach((q, k) => {
            const dd = Math.hypot(f.px(q.vol) - x, f.py(q.ret) - y)
            if (dd < dist) [best, dist] = [k, dd]
          })
          if (best >= 0) setSel(best)
        }}>
          <Axes f={f} xLabel="volatility" yLabel="expected return" xFmt={pct} yFmt={pct} />
          {tan && d.rf != null && tan.vol > 0 && (() => {
            // The capital market line, from the risk-free rate through the tangency portfolio, stopping at the frame
            const slope = (tan.ret - d.rf) / tan.vol
            const end = Math.min(f.x.max, slope > 0 ? (f.y.max - d.rf) / slope : f.x.max)
            return <path className="fv-line s3 dashed" d={`M${f.px(0)},${f.py(d.rf)}L${f.px(end)},${f.py(d.rf + slope * end)}`} />
          })()}
          <path className="fv-line s1" d={path(d.points.map((q) => [q.vol, q.ret]), f)} />
          {d.assets.map((a, k) => (
            <g key={a.name}>
              <circle className="fv-dot s2" cx={f.px(a.vol)} cy={f.py(a.ret)} r={3.5} />
              <text className="fv-point-label" x={f.px(a.vol) + 6} y={f.py(a.ret)} dy="0.32em">
                {a.name}
              </text>
              <title>{`${d.assets[k].name}: ${pct(a.ret)} return, ${pct(a.vol)} volatility`}</title>
            </g>
          ))}
          {d.minVar !== null && <circle className="fv-ring" cx={f.px(d.points[d.minVar].vol)} cy={f.py(d.points[d.minVar].ret)} r={6} />}
          {tan && <rect className="fv-diamond s3" x={f.px(tan.vol) - 4} y={f.py(tan.ret) - 4} width={8} height={8} transform={`rotate(45 ${f.px(tan.vol)} ${f.py(tan.ret)})`} />}
          {p && <circle className="fv-dot s1 big" cx={f.px(p.vol)} cy={f.py(p.ret)} r={5} />}
        </svg>
        <div className="fv-side">
          {p ? (
            <>
              <div className="fv-side-head">
                {sel === d.tangency ? 'Tangency portfolio' : sel === d.minVar ? 'Minimum variance' : 'Portfolio'}
                <span>
                  {pct(p.ret)} return · {pct(p.vol)} vol{d.rf != null && p.vol > 0 ? ` · Sharpe ${((p.ret - d.rf) / p.vol).toFixed(2)}` : ''}
                </span>
              </div>
              {d.names.map((n, k) => (
                <div key={n} className="fv-weight">
                  <span className="fv-weight-name">{n}</span>
                  <span className="fv-weight-bar">
                    <span style={{ width: `${Math.min(100, Math.abs(p.w[k]) * 100)}%` }} className={p.w[k] < 0 ? 'neg' : ''} />
                  </span>
                  <span className="fv-weight-value">{pct(p.w[k])}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="fv-hint">Hover along the frontier to see its weights.</p>
          )}
        </div>
      </div>
      <div className="fv-legend">
        <span className="fv-key s1" /> efficient frontier <span className="fv-key dot s2" /> single assets <span className="fv-key ring" /> minimum variance
        {tan && (
          <>
            <span className="fv-key diamond s3" /> tangency, with the capital market line from {pct(d.rf!)}
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Order-book depth ----------

interface BookData {
  title: string
  bids: Pt[]
  asks: Pt[]
}

/** Walks a market order through the levels: what fills, the average price, and the last price touched */
export function walkBook(levels: Pt[], size: number): { filled: number; avg: number; last: number; cost: number } {
  let left = size
  let cost = 0
  let last = levels[0]?.[0] ?? NaN
  for (const [p, s] of levels) {
    if (left <= 0) break
    const take = Math.min(left, s)
    cost += take * p
    left -= take
    last = p
  }
  const filled = size - left
  return { filled, avg: filled ? cost / filled : NaN, last, cost }
}

function OrderBook({ d }: { d: BookData }) {
  const [ref, w] = useWidth()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const total = (side === 'buy' ? d.asks : d.bids).reduce((a, [, s]) => a + s, 0)
  const [size, setSize] = useState(Math.round(total * 0.3))
  const h = 250
  const cum = (levels: Pt[]): Pt[] => {
    let c = 0
    return levels.map(([p, s]) => [p, (c += s)])
  }
  const bids = cum(d.bids)
  const asks = cum(d.asks)
  const f = frame(w, h, [...d.bids.map((l) => l[0]), ...d.asks.map((l) => l[0])], [0, ...bids.map((b) => b[1]), ...asks.map((a) => a[1])], { yZero: true })
  const step = (pts: Pt[], dir: 1 | -1) => {
    if (!pts.length) return ''
    let s = `M${f.px(pts[0][0])},${f.py(0)}`
    let prev = 0
    for (const [p, c] of pts) {
      s += `L${f.px(p)},${f.py(prev)}L${f.px(p)},${f.py(c)}`
      prev = c
    }
    const end = dir === 1 ? f.x.max : f.x.min
    return `${s}L${f.px(end)},${f.py(prev)}L${f.px(end)},${f.py(0)}Z`
  }
  const best = { bid: d.bids[0]?.[0], ask: d.asks[0]?.[0] }
  const mid = best.bid !== undefined && best.ask !== undefined ? (best.bid + best.ask) / 2 : NaN
  const walk = walkBook(side === 'buy' ? d.asks : d.bids, size)
  const slip = Number.isFinite(walk.avg) && Number.isFinite(mid) ? ((walk.avg - mid) / mid) * (side === 'buy' ? 1 : -1) * 1e4 : NaN
  return (
    <div ref={ref} className="fv">
      <div className="fv-head">
        <span className="fv-title">{d.title}</span>
        <span className="fv-meta">
          bid {fullNumber(best.bid ?? NaN)} · ask {fullNumber(best.ask ?? NaN)} · spread {Number.isFinite(mid) ? fullNumber(best.ask! - best.bid!) : '–'} ({Number.isFinite(mid) ? (((best.ask! - best.bid!) / mid) * 1e4).toFixed(1) : '–'} bp)
        </span>
      </div>
      <svg width={w} height={h}>
        <Axes f={f} xLabel="price" yLabel="cumulative size" xFmt={(v) => fullNumber(v)} />
        <path className="fv-area s3" d={step(bids, -1)} />
        <path className="fv-area s2" d={step(asks, 1)} />
        {Number.isFinite(mid) && <line className="fv-mark" x1={f.px(mid)} x2={f.px(mid)} y1={PAD.t} y2={h - PAD.b} />}
        {Number.isFinite(walk.last) && <line className="fv-walk" x1={f.px(walk.last)} x2={f.px(walk.last)} y1={PAD.t} y2={h - PAD.b} />}
      </svg>
      <div className="fv-legend">
        <span className="fv-key box s3" /> bids <span className="fv-key box s2" /> asks <span className="fv-key mark" /> mid <span className="fv-key walk" /> where the order stops
      </div>
      <div className="fv-controls">
        <div className="fv-tabs" role="tablist">
          {(['buy', 'sell'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={side === s} className={side === s ? 'on' : ''} onClick={() => setSide(s)}>
              Market {s}
            </button>
          ))}
        </div>
        <Slider label="Order size" value={size} min={0} max={Math.max(1, total)} step={Math.max(1, total / 200)} fmt={(v) => fullNumber(Math.round(v))} onChange={setSize} />
        <p className="fv-readout">
          {walk.filled < size ? `Only ${fullNumber(walk.filled)} fills: the book runs out. ` : ''}
          Average price {Number.isFinite(walk.avg) ? fullNumber(walk.avg) : '–'}, {Number.isFinite(slip) ? `${slip.toFixed(1)} bp ${slip >= 0 ? 'worse' : 'better'} than mid` : ''}; the last fill at {fullNumber(walk.last)}.
        </p>
      </div>
    </div>
  )
}

export function FinanceVisual({ data }: { data: Record<string, unknown> }) {
  switch (data.kind) {
    case 'yield-curve':
      return <YieldCurve d={data as unknown as CurveData} />
    case 'option':
      return <OptionVisual d={data as unknown as OptionData} />
    case 'frontier':
      return <Frontier d={data as unknown as FrontierData} />
    case 'order-book':
      return <OrderBook d={data as unknown as BookData} />
    default:
      return <p className="nb-output-note">Tide can’t draw a “{String(data.kind)}” visual.</p>
  }
}
