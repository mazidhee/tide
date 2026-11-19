/**
 * A guided work project as a flight plan (shared/flightPlan): the route across the top, steps as
 * stops, decisions as diamond checkpoints, "Defend it" as the destination. Opening a stop shrinks
 * the map to a strip and opens the workspace: the tutor (the normal session engine), the editor and
 * shell (the lesson Workspace, whose Run runs the pipeline on the practice data), and the result,
 * with the same metric built again in Metabase's query builder. Checkpoints are screens of their own:
 * answer and commit first, then what was decided appears beside your answer. Everything happens here;
 * there is no separate lesson for a work project.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { lanesOf, routeOf, type BuilderComparison, type Lane, type LaneState, type Route, type Stop } from '@shared/flightPlan'
import type { WorkRun, WorkView } from '@shared/workProject'
import type { BuilderGuide } from '@shared/builderMap'
import { useApp } from '../state'
import { Icon } from './Icon'
import { PlaceTag } from './PracticeSettings'
import { LessonWorkspace } from './LessonWorkspace'
import { FlightTutor, type FlightTutorHandle } from './FlightTutor'
import { renderMarkdown } from '../lib/markdown'
import '../styles/flightPlan.css'

const md = (t: string) => renderMarkdown(t, { notePath: '', filesByName: new Map() })
const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Mode = { kind: 'overview' } | { kind: 'step'; n: number } | { kind: 'checkpoint'; id: string } | { kind: 'progress' } | { kind: 'defend' }

const FlagIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3 14V2.5M3 3h8l-1.5 3L11 9H3" />
  </svg>
)
const ChartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2 14h12M4 11V7M8 11V4M12 11V8" />
  </svg>
)

// ---------- The route ----------

function RouteMap({ title, fresh = false, route, big, selected, onStop, onProgress, onOverview, here }: { title: string; fresh?: boolean; route: Route; big: boolean; selected: string; here: number; onStop(s: Stop): void; onProgress(): void; onOverview(): void }) {
  let stepIx = 0
  return (
    <div className={`fp-map ${big ? 'big' : 'small'}`}>
      <div className="fp-top">
        <button className="fp-title" onClick={onOverview}>
          <h1>{title}</h1>
        </button>
        <span>
          {route.stepsDone} of {route.steps} steps · {route.checkpointsDone} of {route.checkpoints} checkpoints
        </span>
        <PlaceTag place="practice" />
        <span className="fp-sp" />
        <button className="btn ghost small" onClick={onProgress}>
          <ChartIcon /> Progress
        </button>
        {!big && (
          <button className="btn ghost small" onClick={onOverview}>
            Zoom out
          </button>
        )}
      </div>
      <div className="fp-route" role="list" aria-label="Route">
        {(() => {
          // Each step, then a stretch to the next stop holding that step's checkpoints: the stops sit evenly spaced however many checkpoints a step has
          const out: ReactElement[] = []
          const stops = route.stops
          let i = 0
          while (i < stops.length) {
            const s = stops[i]
            const sel = selected === s.key ? ' sel' : ''
            if (s.kind === 'step') {
              const up = stepIx++ % 2 === 1
              out.push(
                <div key={s.key} role="listitem" className={`fp-stn ${s.state}${sel}${up ? ' up' : ''}`}>
                  <button className="fp-o" onClick={() => onStop(s)} aria-label={`Step ${s.n}: ${s.label}`} title={s.label}>
                    {s.state === 'done' ? <Icon name="check" size={12} /> : s.n}
                  </button>
                  <span className="fp-lab">
                    {s.label}
                    {s.n === here && <span className="fp-youare">You are here</span>}
                  </span>
                </div>
              )
            } else if (s.kind === 'destination') {
              out.push(
                <div key={s.key} role="listitem" className={`fp-dest ${s.state}${sel}`}>
                  <button className="fp-o" onClick={() => onStop(s)} aria-label="Defend it">
                    <FlagIcon />
                  </button>
                  <span className="fp-lab">{s.label}</span>
                </div>
              )
              break
            }
            // The stretch after this stop: its checkpoints, each between legs
            const parts: ReactElement[] = [<div key={`l${i}`} className={`fp-leg${route.legs[i] ? ' done' : ''}`} />]
            let j = i + 1
            while (j < stops.length && stops[j].kind === 'checkpoint') {
              const c = stops[j] as Extract<Stop, { kind: 'checkpoint' }>
              const csel = selected === c.key ? ' sel' : ''
              parts.push(
                <div key={c.key} role="listitem" className={`fp-cpw ${c.state}${csel}`}>
                  <button className="fp-cp" onClick={() => onStop(c)} aria-label={`Checkpoint ${c.id}: ${c.label}`} title={`${c.id}. ${c.label}`} />
                  {csel && <span className="fp-lab">{c.label}</span>}
                </div>,
                <div key={`l${j}`} className={`fp-leg${route.legs[j] ? ' done' : ''}`} />
              )
              j++
            }
            out.push(
              <div key={`seg${i}`} className="fp-seg-run">
                {parts}
              </div>
            )
            i = j
          }
          return out
        })()}
      </div>
      <div className="fp-legend">
        <span>
          <span className="fp-dot on" /> step done
        </span>
        <span>
          <span className="fp-dia" /> checkpoint: commit before you see {fresh ? 'the usual choice' : 'the real call'}
        </span>
        <span>Click any stop to zoom in</span>
      </div>
    </div>
  )
}

// ---------- Results ----------

const fmt = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })) : typeof v === 'object' ? JSON.stringify(v) : String(v))
const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))

export function ResultTable({ run, flag }: { run: WorkRun | null; flag?: (row: unknown[]) => boolean }) {
  if (!run) return <div className="fp-emptybox">Run your pipeline to see rows here.</div>
  if (run.error) return <div className="fp-emptybox bad">{run.error}</div>
  if (!run.rows.length) return <div className="fp-emptybox">No rows. Is a filter too tight?</div>
  return (
    <table className="fp-res">
      <thead>
        <tr>
          {run.columns.map((c, k) => (
            <th key={k} className={k && isNum(run.rows[0]?.[k]) ? 'n' : ''}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {run.rows.slice(0, 100).map((r, i) => (
          <tr key={i} className={flag?.(r) ? 'flag' : ''}>
            {r.map((c, k) => (
              <td key={k} className={isNum(c) ? 'n' : ''}>
                {fmt(c)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A bar for each row, from the first numeric column: the shape of the result at a glance */
function ResultChart({ run }: { run: WorkRun | null }) {
  const col = run && !run.error && run.rows.length > 1 ? run.columns.findIndex((_, k) => k > 0 && run.rows.every((r) => r[k] === null || isNum(r[k]))) : -1
  if (!run || col < 0) return <div className="fp-mb"><div className="fp-mb-h">Chart</div><div className="fp-emptybox">{run && !run.error && run.rows.length === 1 ? 'One row: a number card, not a chart.' : 'The chart draws from your result.'}</div></div>
  const rows = run.rows.slice(0, 24)
  const vals = rows.map((r) => Number(r[col] ?? 0))
  const max = Math.max(...vals.map(Math.abs), 1)
  const label = (v: unknown) => {
    const s = fmt(v)
    // A month's first day as the month's name; any other date as its day
    if (/^\d{4}-\d{2}-01(T00:00(:00)?(\.0+)?Z?)?$/.test(s)) return new Date(s.slice(0, 10)).toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(5, 10) : s.slice(0, 12)
  }
  return (
    <div className="fp-mb">
      <div className="fp-mb-h">
        {run.columns[col]}
        <span>by {run.columns[0]}</span>
      </div>
      <div className="fp-bars">
        {vals.map((v, k) => (
          <div key={k} className="fp-bar" title={`${label(rows[k][0])}: ${fmt(rows[k][col])}`}>
            <span className="v">{fmt(rows[k][col])}</span>
            <div className="b" style={{ height: `${Math.max(3, (Math.abs(v) / max) * 82)}%` }} />
          </div>
        ))}
      </div>
      <div className="fp-blabels">
        {rows.map((r, k) => (
          <span key={k}>{label(r[0])}</span>
        ))}
      </div>
    </div>
  )
}

// ---------- The builder ----------

function BuilderPanel({ slug, n, file, view, onView, tutor }: { slug: string; n: number; file: string; view: WorkView; onView(v: WorkView): void; tutor: FlightTutorHandle | null }) {
  const app = useApp()
  const [guide, setGuide] = useState<{ guide: BuilderGuide | null; metric: boolean; error?: string } | null>(null)
  const [qs, setQs] = useState<{ id: number; name: string; updated: string; builder: boolean }[] | null>(null)
  const [busy, setBusy] = useState('')
  const [cmp, setCmp] = useState<{ comparison: BuilderComparison; mbql: string; builder: boolean; name: string } | null>(null)
  const marked = view.state.builder?.[String(n)]

  const load = useCallback(() => {
    window.tide.work.guide(slug, n, file).then(setGuide).catch((e) => setGuide({ guide: null, metric: false, error: clean(e) }))
  }, [slug, n, file])
  useEffect(load, [load])
  const list = () => {
    setBusy('list')
    window.tide.work
      .questions()
      .then(setQs)
      .catch((e) => app.toast(clean(e), { tone: 'error' }))
      .finally(() => setBusy(''))
  }
  const compare = async (id: number) => {
    setBusy(`q${id}`)
    try {
      const r = await window.tide.work.compare(slug, n, id, file)
      setCmp({ comparison: r.comparison, mbql: r.mbql, builder: r.builder, name: r.name })
      onView(r.view)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  if (!guide) return <div className="fp-emptybox">Reading your pipeline…</div>
  if (!guide.guide) return <div className="fp-emptybox">Write and run your pipeline first; the builder guide is made from it. {guide.error && <small>({guide.error})</small>}</div>
  const g = guide.guide
  return (
    <div className="fp-builder">
      <div className="fp-bh">
        <h3>Now build it with the Metabase builder</h3>
        <p>The same {guide.metric ? 'metric' : 'result'}, clicked together in the query builder instead of written. Each stage of your pipeline, and what it becomes:</p>
      </div>
      <ol className="fp-map-list">
        {g.steps.map((s, i) => (
          <li key={i} className={s.native ? 'native' : ''}>
            <code>{s.stage}</code>
            <span className={`fp-act${s.native ? ' no' : ''}`}>{s.action ?? 'native only'}</span>
            <span className="fp-how">{s.how}</span>
            {s.native && <span className="fp-why">{s.native}</span>}
          </li>
        ))}
      </ol>
      {g.timezone && (
        <div className="fp-note">
          <b>Time zones.</b> {g.timezone.note}
        </div>
      )}
      {!g.builderOk && (
        <div className="fp-note warn">
          <b>Native only, and here’s why.</b> {g.nativeOnly.join(' ')} {marked?.native ? <em>Marked native only.</em> : (
            <button className="btn small" onClick={() => void window.tide.work.native(slug, n, g.nativeOnly.join('; ')).then(onView)}>
              Mark the builder part native only
            </button>
          )}
        </div>
      )}
      {(g.builderOk || g.steps.some((s) => !s.native)) && (
        <ol className="fp-do">
          <li>
            <span>Open the practice Metabase: New › Question, pick the collection, and build it with the actions above.</span>
            <button className="btn small" onClick={() => void window.tide.work.openMetabase('/question/notebook')}>
              Open the builder
            </button>
          </li>
          <li>
            <span>Save it, then pick it here. Tide runs it and compares it with your pipeline.</span>
            <button className="btn small" onClick={list} disabled={busy === 'list'}>
              {qs ? 'Refresh' : 'My saved questions'}
            </button>
          </li>
        </ol>
      )}
      {qs && (
        <ul className="fp-qs">
          {!qs.length && <li className="muted">No saved questions yet in the practice Metabase.</li>}
          {qs.map((q) => (
            <li key={q.id}>
              <button onClick={() => void compare(q.id)} disabled={!!busy}>
                <span>{q.name}</span>
                <small>{q.builder ? 'builder' : 'native'} · {q.updated.slice(0, 16).replace('T', ' ')}</small>
                {busy === `q${q.id}` ? <small>Running…</small> : <Icon name="chevron" size={12} />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(cmp || marked?.card) && (
        <div className={`fp-cmp ${(cmp?.comparison.match ?? marked?.match) ? 'same' : 'diff'}`}>
          <div className="fp-cmp-h">
            <span className="fp-tag">{(cmp?.comparison.match ?? marked?.match) ? 'Same rows' : 'Differs'}</span>
            <b>“{cmp?.name ?? marked?.name}”</b> against your pipeline
          </div>
          <p>{cmp?.comparison.why ?? marked?.why}</p>
          {cmp?.comparison.hints.map((h) => (
            <p key={h} className="fp-hint">
              {h}
            </p>
          ))}
          {cmp && <DiffTable c={cmp.comparison} left="Your pipeline" right="Builder" />}
          {cmp && (
            <details className="fp-mbql">
              <summary>{cmp.builder ? 'The question’s definition (MBQL)' : 'It’s a native question'}</summary>
              <pre>{cmp.mbql}</pre>
            </details>
          )}
          {tutor && (
            <button className="btn small" onClick={() => tutor.send(`I built step ${n} in Metabase's query builder as “${cmp?.name ?? marked?.name}”. Read its definition and the comparison (work_project builder) and review it with me.`, 'Review my builder question')}>
              Ask the tutor to review it
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Against the finished dashboard's real cards ----------

function DiffTable({ c, left, right }: { c: BuilderComparison; left: string; right: string }) {
  if (!c.rows.length) return null
  return (
    <table className="fp-res fp-diff">
      <thead>
        <tr>
          <th>Row</th>
          <th className="n">{left}</th>
          <th className="n">{right}</th>
        </tr>
      </thead>
      <tbody>
        {c.rows.slice(0, 40).map((r) => (
          <tr key={r.key} className={r.same ? '' : 'flag'}>
            <td>{r.key}</td>
            <td className="n">{r.pipeline ? r.pipeline.slice(1).map(fmt).join(' · ') : '—'}</td>
            <td className="n">{r.builder ? r.builder.slice(1).map(fmt).join(' · ') : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The cards this step builds on the finished dashboard: run the real one on the practice data beside yours */
function RealCards({ slug, n, file, onView, tutor }: { slug: string; n: number; file: string; onView(v: WorkView): void; tutor: FlightTutorHandle | null }) {
  const app = useApp()
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof window.tide.work.refs>> | null>(null)
  const [busy, setBusy] = useState(0)
  const [shown, setShown] = useState<{ num: number; name: string; c: BuilderComparison } | null>(null)
  const load = useCallback(() => void window.tide.work.refs(slug, n).then(setRefs).catch(() => setRefs(null)), [slug, n])
  useEffect(load, [load])
  if (!refs?.cards.length) return null
  const check = async (num: number) => {
    setBusy(num)
    try {
      const r = await window.tide.work.checkRef(slug, n, num, file)
      setShown({ num, name: r.name, c: r.comparison })
      onView(r.view)
      load()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy(0)
    }
  }
  return (
    <div className="fp-real">
      <div className="fp-real-h">
        <b>Against the real dashboard</b>
        <span>Your {file} beside the finished card’s pipeline, both run on the practice data. The real pipeline stays hidden.</span>
      </div>
      <ul className="fp-cards">
        {refs.cards.map((c) => (
          <li key={c.num}>
            <button onClick={() => void check(c.num)} disabled={!c.available || !!busy} title={c.available ? `Compare ${file} with card ${c.num}` : 'Connect your company Metabase once in Settings › Connections, and Tide keeps a copy of the real cards'} className={c.check ? (c.check.match ? 'same' : 'diff') : ''}>
              <span className="fp-cn">{c.num}</span>
              <span className="fp-cname">{c.name}</span>
              <small>{busy === c.num ? 'Running…' : c.check ? (c.check.match ? 'Same rows' : 'Differs') : c.available ? 'Check' : 'Not loaded'}</small>
            </button>
          </li>
        ))}
      </ul>
      {shown && (
        <div className={`fp-cmp ${shown.c.match ? 'same' : 'diff'}`}>
          <div className="fp-cmp-h">
            <span className="fp-tag">{shown.c.match ? 'Same rows' : 'Differs'}</span>
            <b>Card {shown.num}: {shown.name}</b>
          </div>
          <p>{shown.c.match ? 'Your result is the real card’s, row for row, on the practice data.' : shown.c.why}</p>
          {shown.c.hints.map((h) => (
            <p key={h} className="fp-hint">
              {h}
            </p>
          ))}
          {!shown.c.match && <DiffTable c={shown.c} left="Real card" right="Yours" />}
          {!shown.c.match && tutor && (
            <button className="btn small" onClick={() => tutor.send(`My ${file} differs from the real card ${shown.num} (“${shown.name}”). Check it with work_project check_card and help me find why, without showing me the answer.`, `Why does mine differ from card ${shown.num}?`)}>
              Ask the tutor why
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- The step's workspace ----------

function StepWork({ v, n, onView, results, setResult, onCheckpoint, onStep }: { v: WorkView; n: number; onView(v: WorkView): void; results: Record<number, WorkRun>; setResult(n: number, r: WorkRun): void; onCheckpoint(id: string): void; onStep(n: number): void }) {
  const app = useApp()
  const p = v.project
  const st = p.steps.find((x) => x.n === n)!
  const [ws, setWs] = useState<{ root: string; file: string } | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [open, setOpen] = useState('')
  const [termId, setTermId] = useState<string | null>(null)
  const [tab, setTab] = useState<'result' | 'builder'>('result')
  const [running, setRunning] = useState(false)
  const [tutor, setTutor] = useState<FlightTutorHandle | null>(null)
  const [found, setFound] = useState(v.state.findings?.[String(n)] ?? '')
  const run = results[n] ?? null
  const cps = p.decisions.filter((d) => d.step === n)
  const nextCp = cps.find((d) => !v.state.committed[d.id]) ?? cps[0]

  useEffect(() => {
    let live = true
    window.tide.work
      .stepFile(v.project.slug, n)
      .then(async (w) => {
        if (!live) return
        setWs(w)
        setOpen(w.file)
        const list = await window.tide.ide.files(w.root).catch(() => null)
        if (live) setFiles((list?.files ?? [w.file]).filter((f) => !f.includes('/') && /\.(js|md|json)$/.test(f) && f !== 'README.md').sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
      })
      .catch((e) => app.toast(clean(e), { tone: 'error' }))
    return () => {
      live = false
    }
  }, [v.project.slug, n, app])
  useEffect(() => setFound(v.state.findings?.[String(n)] ?? ''), [n, v.state.findings])

  const doRun = async () => {
    setRunning(true)
    try {
      const r = await window.tide.work.run(p.slug, n, open)
      setResult(n, r.run)
      onView(r.view)
      setTab('result')
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setRunning(false)
    }
  }
  const saveFound = async () => {
    if ((v.state.findings?.[String(n)] ?? '') === found.trim()) return
    onView(await window.tide.work.finding(p.slug, n, found))
  }
  const done = n < v.state.step

  return (
    <div className="fp-work">
      {ws ? <FlightTutor slug={p.slug} title={p.title} fresh={!!p.fresh} step={n} stepTitle={st.title} root={ws.root} file={ws.file} terminalId={termId} onReady={setTutor} /> : <section className="fp-col" />}
      <section className="fp-col fp-mid">
        <div className="fp-task">
          <div className="fp-k">
            Step {n} of {p.steps.length}
            {st.skill ? ` · ${st.skill}` : ''}
          </div>
          <h2>{st.title}</h2>
          <div className="fp-taskmd" dangerouslySetInnerHTML={{ __html: md(st.task) }} />
          {st.data && (
            <div className="fp-chips">
              {st.data.split(/,\s*(?![^()]*\))/).map((d) => (
                <span key={d} className="fp-chip">
                  {d.trim()}
                </span>
              ))}
            </div>
          )}
        </div>
        {ws && (
          <LessonWorkspace
            root={ws.root}
            files={files}
            open={open}
            onOpen={setOpen}
            terminalId={termId}
            onTerminal={setTermId}
            onCreated={(f) => (setFiles((x) => [...x, f]), setOpen(f))}
            onRun={/\.js$/.test(open) ? doRun : undefined}
            runLabel={running ? 'Running…' : 'Run on Practice'}
            runTitle="Runs this pipeline on the practice MongoDB through the practice Metabase (⌘↵)"
            empty="Pick a file."
          />
        )}
      </section>
      <section className="fp-col fp-right">
        <div className="fp-hd">
          <div className="fp-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'result'} onClick={() => setTab('result')}>
              Result
            </button>
            <button role="tab" aria-selected={tab === 'builder'} onClick={() => setTab('builder')}>
              In the builder
            </button>
          </div>
          <span className="fp-sp" />
          {nextCp && (run ? !run.error : true) && (
            <button className={`btn small${run && !v.state.committed[nextCp.id] ? ' primary' : ''}`} onClick={() => onCheckpoint(nextCp.id)}>
              <span className="fp-dia sm" /> {cps.every((d) => v.state.committed[d.id]) ? 'Checkpoint passed' : 'Checkpoint ahead'}
            </button>
          )}
          {!nextCp && n < Math.max(...p.steps.map((x) => x.n)) && (
            <button className="btn small" onClick={() => onStep(n + 1)}>
              Next stop
            </button>
          )}
        </div>
        <div className="fp-rbody">
          {tab === 'result' ? (
            <>
              <div className="fp-runline" aria-live="polite">
                {running ? (
                  <span>practice › running {ws?.file}…</span>
                ) : run ? (
                  run.error ? (
                    <span className="bad">practice › {run.error.split('\n')[0].slice(0, 200)}</span>
                  ) : (
                    <span>
                      practice › {run.rows.length}
                      {run.truncated ? '+' : ''} rows in {(run.ms / 1000).toFixed(2)} s{run.collection ? ` from ${run.collection}` : ''}
                    </span>
                  )
                ) : (
                  <span className="muted">Write the pipeline in {ws?.file ?? 'the step’s file'}, then Run on Practice (⌘↵).</span>
                )}
              </div>
              <div className="fp-tbl">
                <ResultTable run={run} />
              </div>
              <ResultChart run={run} />
              <RealCards slug={p.slug} n={n} file={open} onView={onView} tutor={tutor} />
            </>
          ) : (
            <BuilderPanel key={open} slug={p.slug} n={n} file={open} view={v} onView={onView} tutor={tutor} />
          )}
          <div className="fp-found">
            <label htmlFor={`found-${n}`}>What you found, in one line</label>
            <input id={`found-${n}`} value={found} placeholder="e.g. one person carries most of the work; the mean is 6× the median" onChange={(e) => setFound(e.target.value)} onBlur={() => void saveFound()} onKeyDown={(e) => e.key === 'Enter' && void saveFound()} />
            <div className="fp-found-foot">
              {done ? (
                <span className="muted">Step done.</span>
              ) : (
                <button className="btn small" disabled={!run || !!run.error || !found.trim()} title={!run ? 'Run it first' : !found.trim() ? 'Write what you found first' : ''} onClick={() => void saveFound().then(() => window.tide.work.stepDone(p.slug, n).then(onView))}>
                  Step done
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// ---------- Checkpoints ----------

function Checkpoint({ v, id, onView, results, onStep }: { v: WorkView; id: string; onView(v: WorkView): void; results: Record<number, WorkRun>; onStep(n: number): void }) {
  const app = useApp()
  const d = v.project.decisions.find((x) => x.id === id)!
  const mine = v.state.committed[id]
  const shown = v.revealed[id]
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const run = results[d.step] ?? null
  const ranBefore = v.state.runs?.[String(d.step)]
  const commit = async () => {
    setBusy(true)
    try {
      onView(await window.tide.work.answer(v.project.slug, id, draft))
      app.toast(v.project.fresh ? 'Committed. Here’s the usual choice.' : 'Committed. Here’s what was decided.')
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const nextStep = v.project.steps.find((x) => x.n > d.step)
  return (
    <div className="fp-cpview">
      <div>
        <div className="fp-cp-k">
          <span className="fp-dia on" />
          Checkpoint {d.id} · after step {d.step}
        </div>
        <h3 className="fp-q">{d.title}</h3>
        <div className="fp-ctx" dangerouslySetInnerHTML={{ __html: md(d.ask) }} />
        {!mine ? (
          <>
            <textarea className="fp-why" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your answer, and why. One or two sentences you could say to the person who asked." aria-label="Your answer" />
            <div className="fp-foot">
              <button className="btn primary" disabled={busy || draft.trim().length < 2} onClick={() => void commit()}>
                Commit my answer
              </button>
              <span>{v.project.fresh ? 'You can’t change it after. Then you see the usual choice, to check with whoever asked.' : 'You can’t change it after. Then you see what was actually decided.'}</span>
            </div>
          </>
        ) : (
          <div className="fp-reveal">
            <div>
              <h5>You committed</h5>
              <p>{mine.answer}</p>
            </div>
            <div>
              <h5>{v.project.fresh ? 'The usual choice' : 'What was decided'}</h5>
              {shown ? (
                <>
                  <div className="fp-pick fp-md" dangerouslySetInnerHTML={{ __html: md(shown.decided) }} />
                  {shown.why && <div className="fp-md" dangerouslySetInnerHTML={{ __html: md(shown.why) }} />}
                  {shown.wrong.length > 0 && (
                    <>
                      <h5>Common wrong choices</h5>
                      <ul>
                        {shown.wrong.map((w) => (
                          <li key={w} dangerouslySetInnerHTML={{ __html: md(w).replace(/^<p>|<\/p>\s*$/g, '') }} />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : (
                <p className="muted">Revealed in the lesson with the tutor.</p>
              )}
            </div>
            <div className="fp-verdict">
              <p>Compare the two. A different call can still be right if you can defend it: what would have had to be true for yours to be the better one?</p>
            </div>
          </div>
        )}
        <div className="fp-foot nav">
          <button className="btn ghost" onClick={() => onStep(d.step)}>
            ‹ Back to step {d.step}
          </button>
          {mine && nextStep && (
            <button className="btn primary" onClick={() => onStep(nextStep.n)}>
              Fly on to step {nextStep.n}
            </button>
          )}
        </div>
      </div>
      <aside className="fp-evid">
        <h4>Your evidence from step {d.step}</h4>
        {run ? <ResultTable run={run} /> : <div className="fp-emptybox">{ranBefore ? `You ran step ${d.step} (${ranBefore.rows} rows). Run it again in the step to see the rows here.` : `You haven’t run step ${d.step} yet. You can still commit, but it’s a guess.`}</div>}
        {v.state.findings?.[String(d.step)] && <p className="fp-said">You found: {v.state.findings[String(d.step)]}</p>}
      </aside>
    </div>
  )
}

// ---------- Progress ----------

const SEG: { key: keyof Pick<Lane, 'run' | 'finding' | 'call' | 'builder'>; label: string }[] = [
  { key: 'run', label: 'run' },
  { key: 'finding', label: 'finding' },
  { key: 'call', label: 'call' },
  { key: 'builder', label: 'builder' }
]
const segClass = (s: LaneState) => (s === 'on' ? 'on' : s === 'half' ? 'half' : s === 'na' ? 'na' : '')

function Progress({ v, onStep }: { v: WorkView; onStep(n: number): void }) {
  const lanes = lanesOf(v.project, v.state)
  const found = lanes.filter((l) => l.found)
  return (
    <div className="fp-prog">
      <h2>The journey so far</h2>
      <p className="muted">Each lane is a step: run it, write what you found, make the call, build it in the builder. Filled is done.</p>
      {lanes.map((l) => (
        <div key={l.n} className="fp-lane">
          <button className="fp-nm" onClick={() => onStep(l.n)}>
            {l.n}. {l.title}
            {l.skill && <small>{l.skill.split(';')[0]}</small>}
          </button>
          <div className="fp-track">
            {SEG.map((s) => (
              <span key={s.key} className={`fp-seg ${segClass(l[s.key])}`} title={s.key === 'builder' ? l.builderNote : undefined}>
                {s.key === 'call' && l[s.key] === 'na' ? 'no call' : s.key === 'builder' && l[s.key] === 'na' ? 'native' : s.label}
              </span>
            ))}
          </div>
        </div>
      ))}
      <h3 className="fp-found-h">What you found</h3>
      {found.length ? (
        <ol className="fp-findings">
          {found.map((l) => (
            <li key={l.n}>
              <span>Step {l.n}</span>
              <p>{l.found}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Your one-line findings collect here as you write them under each step’s result.</p>
      )}
    </div>
  )
}

// ---------- Defend it ----------

function Defend({ v, onView, onCheckpoint }: { v: WorkView; onView(v: WorkView): void; onCheckpoint(id: string): void }) {
  const app = useApp()
  const qs = v.project.defend
  const [k, setK] = useState(() => Math.min(Object.keys(v.state.defended ?? {}).length, Math.max(0, qs.length - 1)))
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [cover, setCover] = useState<{ cover?: string[]; error?: string } | null>(null)
  const locked = v.state.defended?.[String(k)]
  useEffect(() => {
    setCover(null)
    if (locked) window.tide.work.cover(v.project.slug, k).then(setCover).catch(() => setCover(null))
  }, [k, locked, v.project.slug])
  if (!qs.length) return <div className="fp-def"><p className="muted">This project has no defend-it questions.</p></div>
  const lock = async () => {
    try {
      onView(await window.tide.work.defend(v.project.slug, k, drafts[k] ?? ''))
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
  }
  const ticked = new Set(locked?.ticked ?? [])
  const stepsLeft = v.project.steps.some((s) => s.n >= v.state.step)
  const open = v.project.decisions.filter((d) => !v.state.committed[d.id])
  return (
    <div className="fp-def">
      <div className="fp-mgr">
        <span className="fp-av">{(v.project.stakeholder ?? 'M').trim()[0]}</span>
        <span>
          {stepsLeft ? 'Final stop, opened early. ' : 'You’ve landed. '}
          {v.project.stakeholder ? v.project.stakeholder.split(',')[0] : 'Your manager'} has {qs.length} question{qs.length === 1 ? '' : 's'}.
        </span>
      </div>
      <div className="fp-dsteps">
        {qs.map((_, j) => (
          <i key={j} className={j <= k ? 'on' : ''} />
        ))}
      </div>
      <div className="fp-dq fp-md" dangerouslySetInnerHTML={{ __html: md(qs[k]) }} />
      {locked ? (
        <p className="fp-locked">{locked.answer}</p>
      ) : (
        <>
          <textarea className="fp-why" style={{ minHeight: 110 }} value={drafts[k] ?? ''} onChange={(e) => setDrafts({ ...drafts, [k]: e.target.value })} placeholder="Answer as you would in the meeting." aria-label="Your answer" />
          <div className="fp-foot">
            <button className="btn primary" disabled={(drafts[k] ?? '').trim().length < 8} onClick={() => void lock()}>
              Lock answer and compare
            </button>
            <span>What a strong answer covers shows after you lock it.</span>
          </div>
        </>
      )}
      {locked && cover?.cover && (
        <>
          <div className="fp-cover-h">A strong answer covers; tick what yours did</div>
          <ul className="fp-cover">
            {cover.cover.map((c, j) => (
              <li key={j} className={ticked.has(j) ? 'got' : ''}>
                <button role="checkbox" aria-checked={ticked.has(j)} className="fp-bx" onClick={() => void window.tide.work.tick(v.project.slug, k, ticked.has(j) ? [...ticked].filter((x) => x !== j) : [...ticked, j]).then(onView)} />
                <span dangerouslySetInnerHTML={{ __html: md(c).replace(/^<p>|<\/p>\s*$/g, '') }} />
              </li>
            ))}
          </ul>
        </>
      )}
      {locked && cover?.error && (
        <div className="fp-note">
          {cover.error}{' '}
          {open[0] && (
            <button className="link-btn" onClick={() => onCheckpoint(open[0].id)}>
              Open checkpoint {open[0].id}
            </button>
          )}
        </div>
      )}
      <div className="fp-foot nav">
        {k > 0 && (
          <button className="btn ghost" onClick={() => setK(k - 1)}>
            ‹ Previous
          </button>
        )}
        {k < qs.length - 1 && locked && (
          <button className="btn primary" onClick={() => setK(k + 1)}>
            Next question
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- The page ----------

export function FlightPlan({ slug }: { slug: string }) {
  const app = useApp()
  const [v, setV] = useState<WorkView | null | undefined>(undefined)
  const [mode, setMode] = useState<Mode>({ kind: 'overview' })
  const [sel, setSel] = useState('')
  const [running, setRunning] = useState<boolean | null>(null)
  const results = useRef<Record<number, WorkRun>>({})
  const [, bump] = useState(0)

  useEffect(() => {
    window.tide.work
      .view(slug)
      .then((x) => {
        setV(x)
        setSel(`s${Math.min(x.state.step, Math.max(...x.project.steps.map((s) => s.n)))}`)
      })
      .catch((e) => (app.toast(clean(e), { tone: 'error' }), setV(null)))
    window.tide.practiceData
      .status()
      .then((s) => setRunning(s.running && s.metabase === 'ready' && s.setUp))
      .catch(() => setRunning(false))
  }, [slug, app])

  const route = useMemo(() => (v ? routeOf(v.project, v.state) : null), [v])
  if (v === undefined) return <div className="page" />
  if (!v || !route) return <div className="page"><div className="page-inner"><p className="muted">This project couldn’t be read.</p></div></div>
  const p = v.project
  const big = mode.kind === 'overview' || mode.kind === 'progress'
  const current = Math.min(v.state.step, Math.max(...p.steps.map((s) => s.n)))
  const selected = mode.kind === 'step' ? `s${mode.n}` : mode.kind === 'checkpoint' ? mode.id : mode.kind === 'defend' ? 'defend' : mode.kind === 'overview' ? sel : ''
  const go = (s: Stop) => {
    if (s.kind === 'destination') return setMode({ kind: 'defend' })
    if (s.kind === 'checkpoint') return setMode({ kind: 'checkpoint', id: s.id })
    // On the overview, the first click previews a stop and the second opens it
    if (mode.kind === 'overview' && sel !== s.key) return setSel(s.key)
    setMode({ kind: 'step', n: s.n })
  }
  const setResult = (n: number, r: WorkRun) => {
    results.current[n] = r
    bump((x) => x + 1)
  }
  const peek = route.stops.find((s) => s.key === sel) ?? route.stops[0]

  return (
    <div className="fp" data-mode={mode.kind}>
      <RouteMap title={p.title} fresh={!!p.fresh} route={route} big={big} selected={selected} here={current} onStop={go} onProgress={() => setMode({ kind: 'progress' })} onOverview={() => setMode({ kind: 'overview' })} />
      <div className="fp-body">
        {mode.kind === 'overview' && (
          <div className="fp-ov">
            <div>
              <button className="link-btn fp-back" onClick={() => app.setView({ kind: 'projects' })}>
                <Icon name="back" size={14} /> Projects
              </button>
              <div className="fp-brief">
                {p.stakeholder && <div className="fp-from">From {p.stakeholder}</div>}
                {p.fresh && <div className="fp-newtask">A new task from work. Nobody has decided its checkpoints yet: each shows the usual choice, to check with whoever asked.</div>}
                <div className="fp-brief-text prose" dangerouslySetInnerHTML={{ __html: md(p.brief) }} />
              </div>
              <div className="fp-lede">
                <button className="btn primary" onClick={() => setMode(v.state.step > Math.max(...p.steps.map((s) => s.n)) ? { kind: 'defend' } : { kind: 'step', n: current })}>
                  {v.state.step > Math.max(...p.steps.map((s) => s.n)) ? 'Defend it' : v.state.learnerTurns || v.state.runs ? `Continue step ${current}` : `Start step ${current}`}
                </button>
                {running ? (
                  <span className="fp-place">
                    <i /> Practice MongoDB and Metabase running
                  </span>
                ) : running === false ? (
                  <button className="link-btn" onClick={() => app.setView({ kind: 'settings', section: 'practice' })}>
                    Practice data isn’t running: start it
                  </button>
                ) : null}
              </div>
            </div>
            <div className="fp-peek">
              {peek.kind === 'step' ? (
                (() => {
                  const st = p.steps.find((x) => x.n === peek.n)!
                  const after = p.decisions.filter((d) => d.step === st.n)
                  return (
                    <>
                      <div className="fp-k">
                        Stop {st.n} of {p.steps.length} · {peek.state === 'done' ? 'done' : peek.state === 'now' ? 'you are here' : 'ahead'}
                      </div>
                      <h3>{st.title}</h3>
                      <div className="fp-taskmd" dangerouslySetInnerHTML={{ __html: md(st.task) }} />
                      {v.state.findings?.[String(st.n)] && <p className="fp-said">You found: {v.state.findings[String(st.n)]}</p>}
                      {after.map((d) => (
                        <div key={d.id} className="fp-after">
                          <span className="fp-dia" />
                          Checkpoint after: {d.title}
                        </div>
                      ))}
                      <button className="btn small" onClick={() => setMode({ kind: 'step', n: st.n })}>
                        Zoom into this step
                      </button>
                    </>
                  )
                })()
              ) : null}
            </div>
          </div>
        )}
        {mode.kind === 'step' && <StepWork key={mode.n} v={v} n={mode.n} onView={setV} results={results.current} setResult={setResult} onCheckpoint={(id) => setMode({ kind: 'checkpoint', id })} onStep={(n) => setMode({ kind: 'step', n })} />}
        {mode.kind === 'checkpoint' && <Checkpoint key={mode.id} v={v} id={mode.id} onView={setV} results={results.current} onStep={(n) => setMode({ kind: 'step', n })} />}
        {mode.kind === 'progress' && <Progress v={v} onStep={(n) => setMode({ kind: 'step', n })} />}
        {mode.kind === 'defend' && <Defend v={v} onView={setV} onCheckpoint={(id) => setMode({ kind: 'checkpoint', id })} />}
      </div>
    </div>
  )
}
