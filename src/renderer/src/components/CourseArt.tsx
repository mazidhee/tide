/**
 * A course cover's artwork: a small generative drawing of the subject's own process, seeded by the
 * course so each cover is its own and always the same. Machine learning descends a loss surface;
 * quant walks prices; payments move between ledgers; a chain links blocks; economics finds where
 * curves meet; data flows and merges; data science fits a curve to a cloud; CS branches; maths
 * traces a curve. Drawn in the ink at low strength with one line in the accent, so it suits every
 * theme and stays calm.
 */
import { memo, type ReactElement } from 'react'
import type { SubjectId } from '@shared/courseShelf'

const W = 200
const H = 140

/** mulberry32, seeded from the course id */
function rng(seed: string) {
  let a = 0
  for (const ch of seed) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 0x9e3779b9) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = (n: number) => n.toFixed(1)
const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')
/** A smooth line through points (Catmull-Rom as cubic Béziers) */
function smooth(pts: [number, number][]) {
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const [p1, p2] = [pts[i], pts[i + 1]]
    const p3 = pts[i + 2] ?? p2
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d
}

type Draw = (r: () => number) => ReactElement

const ink = (o: number) => ({ stroke: 'currentColor', strokeOpacity: o, fill: 'none' })
const accent = { stroke: 'var(--accent)', fill: 'none' }

const ART: Record<SubjectId, Draw> = {
  // Gradient descent down a loss surface, or a small network passing a signal forward
  ml: (r) => (r() < 0.5 ? descent(r) : network(r)),
  quant: (r) => (r() < 0.6 ? prices(r) : smile(r)),
  payments: (r) => settle(r),
  blockchain: (r) => chain(r),
  econ: (r) => market(r),
  data: (r) => streams(r),
  datasci: (r) => fitted(r),
  cs: (r) => tree(r),
  other: (r) => lissajous(r)
}

/** Contours of a loss surface and the path down to its minimum */
const descent: Draw = (r) => {
  const cx = 120 + r() * 40
  const cy = 70 + (r() - 0.5) * 30
  const tilt = (r() - 0.5) * 40
  const rings = Array.from({ length: 7 }, (_, i) => (i + 1) * (11 + r() * 3))
  const steps: [number, number][] = []
  let x = 18 + r() * 20
  let y = 20 + r() * 100
  for (let i = 0; i < 9; i++) {
    steps.push([x, y])
    x += (cx - x) * (0.32 + r() * 0.1) + (r() - 0.5) * 8
    y += (cy - y) * (0.32 + r() * 0.1) + (r() - 0.5) * 12
  }
  return (
    <>
      <g transform={`rotate(${f(tilt)} ${f(cx)} ${f(cy)})`}>
        {rings.map((rr, i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rr * 1.5} ry={rr} {...ink(0.08 + i * 0.012)} strokeWidth={1} />
        ))}
      </g>
      <path d={path(steps)} {...accent} strokeWidth={1.4} strokeOpacity={0.85} />
      {steps.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r={i === steps.length - 1 ? 3 : 1.6} fill="var(--accent)" fillOpacity={0.4 + (i / steps.length) * 0.6} />
      ))}
    </>
  )
}

/** Random walks: many paths a price could take, one of them lit */
const prices: Draw = (r) => {
  const walks = Array.from({ length: 9 }, () => {
    let y = 70 + (r() - 0.5) * 10
    const vol = 3 + r() * 5
    const drift = (r() - 0.5) * 0.8
    return Array.from({ length: 41 }, (_, i) => {
      if (i) y += drift + (r() - 0.5) * vol
      return [i * 5, Math.max(8, Math.min(132, y))] as [number, number]
    })
  })
  return (
    <>
      <line x1={0} x2={W} y1={70} y2={70} {...ink(0.08)} strokeDasharray="2 4" />
      {walks.slice(1).map((w, i) => (
        <path key={i} d={path(w)} {...ink(0.14)} strokeWidth={1} />
      ))}
      <path d={path(walks[0])} {...accent} strokeWidth={1.5} strokeOpacity={0.9} />
    </>
  )
}

/** Money moving: two ledgers and the payments that settle between them */
const settle: Draw = (r) => {
  const left = Array.from({ length: 6 }, (_, i) => 22 + i * 19)
  const right = Array.from({ length: 6 }, (_, i) => 22 + i * 19)
  const flows = Array.from({ length: 7 }, () => [left[Math.floor(r() * 6)], right[Math.floor(r() * 6)]] as const)
  return (
    <>
      {left.map((y, i) => (
        <line key={`l${i}`} x1={18} x2={52} y1={y} y2={y} {...ink(0.18)} strokeWidth={1} />
      ))}
      {right.map((y, i) => (
        <line key={`r${i}`} x1={148} x2={182} y1={y} y2={y} {...ink(0.18)} strokeWidth={1} />
      ))}
      {flows.map(([a, b], i) => (
        <path key={i} d={`M52 ${a}C100 ${a} 100 ${b} 148 ${b}`} {...(i === 0 ? accent : ink(0.16))} strokeWidth={i === 0 ? 1.5 : 1} strokeOpacity={i === 0 ? 0.9 : undefined} />
      ))}
      <circle cx={148} cy={flows[0][1]} r={2.6} fill="var(--accent)" />
    </>
  )
}

/** A chain: blocks, each holding the one before it */
const chain: Draw = (r) => {
  const n = 5
  const ys = Array.from({ length: n }, () => 50 + (r() - 0.5) * 40)
  return (
    <>
      {ys.map((y, i) => {
        const x = 14 + i * 38
        return (
          <g key={i}>
            <rect x={x} y={y - 14} width={26} height={28} rx={4} {...(i === n - 1 ? accent : ink(0.22))} strokeWidth={1.2} />
            {[0, 1, 2].map((k) => (
              <line key={k} x1={x + 5} x2={x + 5 + 8 + r() * 10} y1={y - 6 + k * 6} y2={y - 6 + k * 6} {...ink(0.16)} />
            ))}
            {i < n - 1 && <path d={`M${x + 26} ${f(y)}C${x + 32} ${f(y)} ${x + 32} ${f(ys[i + 1])} ${x + 38} ${f(ys[i + 1])}`} {...ink(0.24)} />}
          </g>
        )
      })}
      {Array.from({ length: 40 }, (_, i) => (
        <circle key={i} cx={r() * W} cy={95 + r() * 40} r={0.9} fill="currentColor" fillOpacity={0.12} />
      ))}
    </>
  )
}

/** Supply meets demand: two families of curves, and where they cross */
const market: Draw = (r) => {
  const k = 0.6 + r() * 0.6
  const demand = (s: number) => Array.from({ length: 21 }, (_, i) => [10 + i * 9, 18 + s + (i * 9) ** 1.08 * 0.55 * k] as [number, number])
  const supply = (s: number) => Array.from({ length: 21 }, (_, i) => [10 + i * 9, 128 - s - (i * 9) ** 1.04 * 0.5 * k] as [number, number])
  const shifts = [0, 10, 20, 30]
  const d0 = demand(8 + r() * 10)
  const s0 = supply(6 + r() * 10)
  let cross = d0[10]
  let best = Infinity
  d0.forEach((p, i) => {
    const g = Math.abs(p[1] - s0[i][1])
    if (g < best) (best = g), (cross = [p[0], (p[1] + s0[i][1]) / 2])
  })
  return (
    <>
      {shifts.map((s, i) => (
        <path key={`d${i}`} d={smooth(demand(s + 20))} {...ink(0.1)} />
      ))}
      {shifts.map((s, i) => (
        <path key={`s${i}`} d={smooth(supply(s + 20))} {...ink(0.1)} />
      ))}
      <path d={smooth(d0)} {...ink(0.35)} strokeWidth={1.2} />
      <path d={smooth(s0)} {...accent} strokeWidth={1.4} strokeOpacity={0.85} />
      <line x1={cross[0]} x2={cross[0]} y1={cross[1]} y2={H} {...ink(0.14)} strokeDasharray="2 3" />
      <circle cx={cross[0]} cy={cross[1]} r={3} fill="var(--accent)" />
    </>
  )
}

/** Pipelines: streams that flow in and merge into one */
const streams: Draw = (r) => {
  const outY = 70 + (r() - 0.5) * 60
  const n = 4 + Math.floor(r() * 5)
  const ins = Array.from({ length: n }, (_, i) => 14 + (i * 112) / (n - 1) + (r() - 0.5) * 8)
  const mx = 115 + r() * 50
  return (
    <>
      {ins.map((y, i) => (
        <path key={i} d={`M0 ${f(y)}C${70 + r() * 20} ${f(y)} ${mx - 50 + r() * 20} ${f(outY)} ${f(mx)} ${f(outY)}`} {...ink(0.16)} strokeWidth={1} />
      ))}
      <path d={`M${f(mx)} ${f(outY)}L${W} ${f(outY)}`} {...accent} strokeWidth={2} strokeOpacity={0.85} />
      <circle cx={mx} cy={outY} r={3} fill="var(--accent)" />
      {ins.map((y, i) => (
        <circle key={`d${i}`} cx={8 + r() * 40} cy={y} r={1.4} fill="currentColor" fillOpacity={0.3} />
      ))}
    </>
  )
}

/** A model fitted to data: a cloud of points and the curve through it */
const fitted: Draw = (r) => {
  const a = (r() - 0.5) * 0.6
  const b = 0.004 + r() * 0.004
  const fit = (x: number) => 110 - a * x - b * (x - 30) ** 2 * 0.6
  const pts = Array.from({ length: 70 }, () => {
    const x = 10 + r() * 180
    const n = (r() + r() + r() - 1.5) * 26
    return [x, Math.max(6, Math.min(134, fit(x) + n))] as [number, number]
  })
  const curve = Array.from({ length: 21 }, (_, i) => [10 + i * 9, fit(10 + i * 9)] as [number, number])
  return (
    <>
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.5} fill="currentColor" fillOpacity={0.22} />
      ))}
      <path d={smooth(curve)} {...accent} strokeWidth={1.6} strokeOpacity={0.9} />
    </>
  )
}

/** A tree: a program, a search, a structure branching out */
const tree: Draw = (r) => {
  const nodes: { x: number; y: number; d: number; p?: number }[] = [{ x: 100, y: 16, d: 0 }]
  for (let d = 1; d < 5; d++) {
    const parents = nodes.filter((n) => n.d === d - 1)
    for (const [pi, p] of parents.entries()) {
      const kids = d < 2 ? 2 : r() < 0.75 ? 2 : 1
      for (let k = 0; k < kids; k++) {
        const span = 90 / 2 ** (d - 1)
        nodes.push({ x: p.x + (kids === 1 ? 0 : (k ? 1 : -1) * span * 0.5) + (r() - 0.5) * 4, y: 16 + d * 28, d, p: nodes.indexOf(parents[pi]) })
      }
    }
  }
  // One path from the root lit in the accent
  const lit = new Set<number>()
  let at = nodes.length - 1 - Math.floor(r() * 4)
  while (at >= 0 && nodes[at]) {
    lit.add(at)
    at = nodes[at].p ?? -1
  }
  return (
    <>
      {nodes.map((n, i) =>
        n.p === undefined ? null : <line key={`e${i}`} x1={nodes[n.p].x} y1={nodes[n.p].y} x2={n.x} y2={n.y} {...(lit.has(i) ? accent : ink(0.2))} strokeWidth={lit.has(i) ? 1.4 : 1} />
      )}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={lit.has(i) ? 3 : 2.2} fill={lit.has(i) ? 'var(--accent)' : 'currentColor'} fillOpacity={lit.has(i) ? 1 : 0.3} />
      ))}
    </>
  )
}

/** A curve traced out: a Lissajous figure, its own for each course */
const lissajous: Draw = (r) => {
  const a = 1 + Math.floor(r() * 4)
  const b = a + 1 + Math.floor(r() * 2)
  const ph = r() * Math.PI
  const at = (t: number, s: number) => [100 + 80 * s * Math.sin(a * t + ph), 70 + 56 * s * Math.sin(b * t)] as [number, number]
  const trace = (s: number) => path(Array.from({ length: 241 }, (_, i) => at((i / 240) * Math.PI * 2, s)))
  return (
    <>
      {[0.55, 0.7, 0.85].map((s) => (
        <path key={s} d={trace(s)} {...ink(0.08)} />
      ))}
      <path d={trace(1)} {...accent} strokeWidth={1.2} strokeOpacity={0.8} />
    </>
  )
}

/** Layers of a small network, one signal lit on its way through */
const network: Draw = (r) => {
  const layers = [3 + Math.floor(r() * 2), 5, 5 + Math.floor(r() * 2), 3, 1 + Math.floor(r() * 2)]
  const xs = layers.map((_, i) => 24 + i * 38)
  const nodes = layers.map((n, i) => Array.from({ length: n }, (_, k) => [xs[i], 70 + (k - (n - 1) / 2) * 22] as [number, number]))
  const lit = nodes.map((l) => l[Math.floor(r() * l.length)])
  return (
    <>
      {nodes.slice(0, -1).flatMap((l, i) => l.flatMap((a, j) => nodes[i + 1].map((b, k) => <line key={`${i}-${j}-${k}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} {...ink(0.06 + r() * 0.08)} />)))}
      <path d={smooth(lit)} {...accent} strokeWidth={1.5} strokeOpacity={0.9} />
      {nodes.flat().map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.4} fill="currentColor" fillOpacity={0.3} />
      ))}
      {lit.map(([x, y], i) => (
        <circle key={`l${i}`} cx={x} cy={y} r={3} fill="var(--accent)" />
      ))}
    </>
  )
}

/** A volatility smile, drawn for several expiries */
const smile: Draw = (r) => {
  const curves = Array.from({ length: 6 }, (_, j) => {
    const depth = 0.012 + j * 0.004 + r() * 0.003
    const skew = (r() - 0.3) * 0.25
    const base = 40 + j * 14
    return Array.from({ length: 21 }, (_, i) => {
      const x = 10 + i * 9
      return [x, base + depth * (x - 100) ** 2 * 0.25 * -1 + skew * (x - 100) * -0.2 + 30] as [number, number]
    })
  })
  return (
    <>
      {curves.slice(1).map((c, i) => (
        <path key={i} d={smooth(c)} {...ink(0.12 + i * 0.03)} />
      ))}
      <path d={smooth(curves[0])} {...accent} strokeWidth={1.5} strokeOpacity={0.9} />
    </>
  )
}

export const CourseArt = memo(function CourseArt({ id, subject }: { id: string; subject: SubjectId }) {
  const r = rng(`${subject}:${id}`)
  return (
    <svg className="crh-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {ART[subject](r)}
    </svg>
  )
})
