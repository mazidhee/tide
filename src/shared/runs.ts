/**
 * Training runs as tide_runs writes them (main/packs/tide_runs.py: one JSON-lines file per run),
 * read back for the notebook's Runs tab, and the comparison it shows: which settings changed
 * between the runs, each metric's curve and where it ended, and which run did best. Learning
 * first: the point is to see what one change did, so the settings that stayed the same are set
 * aside and the ones that differ come first. Pure.
 */

export type RunValue = number | string | boolean | null | RunValue[] | { [k: string]: RunValue }

export interface TrainingRun {
  id: string
  name: string
  experiment: string
  started: number
  ended?: number
  status: 'running' | 'finished' | 'failed' | 'stopped'
  notes: string
  params: Record<string, RunValue>
  /** Each metric's points, in the order logged; NaN and infinities kept as such */
  metrics: Record<string, { step: number; value: number }[]>
  summary: Record<string, RunValue>
}

/** A logged number back from JSON: "NaN" and "Infinity" are what tide_runs writes for them */
export function runNumber(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (v === 'NaN') return NaN
  if (v === 'Infinity') return Infinity
  if (v === '-Infinity') return -Infinity
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

/** One run's file into a run; lines that don't parse are skipped (a run still being written) */
export function parseRun(text: string, id: string, experiment: string): TrainingRun {
  const r: TrainingRun = { id, name: id, experiment, started: 0, status: 'running', notes: '', params: {}, metrics: {}, summary: {} }
  let n = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let rec: Record<string, unknown>
    try {
      rec = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (rec.type === 'start') {
      r.name = typeof rec.name === 'string' && rec.name ? rec.name : id
      r.started = typeof rec.time === 'number' ? rec.time * 1000 : 0
      r.notes = typeof rec.notes === 'string' ? rec.notes : ''
    } else if (rec.type === 'params' && rec.params && typeof rec.params === 'object') Object.assign(r.params, rec.params)
    else if (rec.type === 'metric' && rec.values && typeof rec.values === 'object') {
      const step = runNumber(rec.step) ?? n
      n++
      for (const [k, v] of Object.entries(rec.values as Record<string, unknown>)) {
        const value = runNumber(v)
        if (value === null) continue
        ;(r.metrics[k] ??= []).push({ step, value })
      }
    } else if (rec.type === 'summary' && rec.values && typeof rec.values === 'object') Object.assign(r.summary, rec.values)
    else if (rec.type === 'end') {
      r.status = rec.status === 'failed' || rec.status === 'stopped' ? rec.status : 'finished'
      r.ended = typeof rec.time === 'number' ? rec.time * 1000 : undefined
    }
  }
  return r
}

/** Lower is better for losses and errors, higher for the rest */
export const lowerIsBetter = (metric: string) => /loss|err|mse|mae|rmse|perplexity|nll|cost|regret|drawdown|latency|time/i.test(metric)

const show = (v: RunValue | undefined) => (v === undefined ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)))) : typeof v === 'string' ? v : JSON.stringify(v))

/** A metric's last finite value, or the non-finite one when the run blew up */
export function finalValue(points: { value: number }[] | undefined): number | null {
  if (!points?.length) return null
  const last = points[points.length - 1].value
  return last
}

/** Its best value over the run, and the step it came at */
export function bestPoint(points: { step: number; value: number }[] | undefined, metric: string): { step: number; value: number } | null {
  const ok = (points ?? []).filter((p) => Number.isFinite(p.value))
  if (!ok.length) return null
  return ok.reduce((a, b) => ((lowerIsBetter(metric) ? b.value < a.value : b.value > a.value) ? b : a))
}

export interface RunComparison {
  runs: TrainingRun[]
  /** Settings that differ between the runs, in the order they first appear */
  changed: { key: string; values: string[] }[]
  /** Settings the same in every run */
  same: { key: string; value: string }[]
  /** Each metric: its final and best value per run, and which run did best */
  metrics: { key: string; lowerBetter: boolean; finals: (number | null)[]; best: ({ step: number; value: number } | null)[]; winner: number | null; diverged: boolean[] }[]
  /** One sentence per changed setting saying what it did, where the runs differ only in it */
  findings: string[]
}

const fmt = (n: number | null) => (n === null ? '—' : !Number.isFinite(n) ? (Number.isNaN(n) ? 'NaN' : n > 0 ? '∞' : '−∞') : n !== 0 && (Math.abs(n) >= 1e6 || Math.abs(n) < 1e-3) ? n.toExponential(2) : String(Number(n.toPrecision(4))))

/** The runs side by side: what changed, and what it did to each metric */
export function compareRuns(runs: TrainingRun[]): RunComparison {
  const keys: string[] = []
  for (const r of runs) for (const k of Object.keys(r.params)) if (!keys.includes(k)) keys.push(k)
  const changed: RunComparison['changed'] = []
  const same: RunComparison['same'] = []
  for (const k of keys) {
    const values = runs.map((r) => show(r.params[k]))
    if (new Set(values).size > 1) changed.push({ key: k, values })
    else same.push({ key: k, value: values[0] })
  }
  const metricKeys: string[] = []
  for (const r of runs) for (const k of [...Object.keys(r.metrics), ...Object.keys(r.summary)]) if (!metricKeys.includes(k)) metricKeys.push(k)
  const metrics = metricKeys.map((key) => {
    const lowerBetter = lowerIsBetter(key)
    const finals = runs.map((r) => (key in r.summary ? runNumber(r.summary[key]) : finalValue(r.metrics[key])))
    const best = runs.map((r) => bestPoint(r.metrics[key], key))
    // Diverged: a value that isn't finite, or a loss that ended ten times above where it began
    const diverged = runs.map((r, i) => {
      const pts = r.metrics[key] ?? []
      if (pts.some((p) => !Number.isFinite(p.value)) || (finals[i] !== null && !Number.isFinite(finals[i]!))) return true
      return lowerBetter && pts.length > 2 && pts[0].value > 0 && pts[pts.length - 1].value > 10 * pts[0].value
    })
    let winner: number | null = null
    finals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return
      if (winner === null || (lowerBetter ? v < finals[winner]! : v > finals[winner]!)) winner = i
    })
    return { key, lowerBetter, finals, best, winner, diverged }
  })
  const findings: string[] = []
  // A finding needs two runs that differ in exactly one setting: then the change is what did it
  if (runs.length >= 2 && changed.length) {
    for (let a = 0; a < runs.length; a++)
      for (let b = a + 1; b < runs.length; b++) {
        const diff = keys.filter((k) => show(runs[a].params[k]) !== show(runs[b].params[k]))
        if (diff.length !== 1) continue
        const k = diff[0]
        const both = (m: (typeof metrics)[number]) => m.finals[a] !== null && m.finals[b] !== null
        // Held-out loss says most about a change; then training loss; then whatever was logged
        const main = metrics.find((m) => /^val.*loss$/i.test(m.key) && both(m)) ?? metrics.find((m) => /loss/i.test(m.key) && both(m)) ?? metrics.find(both)
        if (!main) continue
        const va = main.finals[a]!
        const vb = main.finals[b]!
        const what = main.diverged[b] && !main.diverged[a] ? `${main.key} blew up (${fmt(vb)})` : main.diverged[a] && !main.diverged[b] ? `${main.key} came back to ${fmt(vb)} from ${fmt(va)}` : `${main.key} ended at ${fmt(vb)} instead of ${fmt(va)} (${(main.lowerBetter ? vb < va : vb > va) ? 'better' : vb === va ? 'the same' : 'worse'})`
        findings.push(`${k} ${show(runs[a].params[k])} → ${show(runs[b].params[k])}: ${what}.`)
      }
  }
  return { runs, changed, same, metrics, findings: findings.slice(0, 6) }
}

/** The steps and values of a metric for drawing, non-finite points dropped (the line stops where it blew up) */
export function curve(points: { step: number; value: number }[] | undefined): [number, number][] {
  return (points ?? []).filter((p) => Number.isFinite(p.value)).map((p) => [p.step, p.value])
}

/** The experiment a notebook's runs are kept under: its file name without .ipynb */
export const experimentFor = (notebookPath: string) => (notebookPath.split('/').pop() ?? 'default').replace(/\.ipynb$/i, '') || 'default'

/** As tide_runs names an experiment's folder */
export const safeExperiment = (name: string) => name.replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'default'
