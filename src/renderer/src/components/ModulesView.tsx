import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ModuleRow, TrackModulesView } from '@shared/modules'
import type { Mastery, NoteMeta } from '@shared/types'
import { useApp } from '../state'
import { Icon } from './Icon'
import { OutlineView } from './OutlineView'
import { TrackView } from './TrackView'
import '../styles/modules.css'

/**
 * A track's page (shared/modules): its modules as a compact list in plan order, or as a map of
 * the requires DAG. Each row: where it stands, how much is solid, the hours left, what it waits
 * on. A row opens its detail (depth goal, gate, parts, requires); "Outline" opens the module
 * page, its outline as any roadmap's. The current part's gate sits on top; projects below.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const STATUS_WORD: Record<ModuleRow['status'], string> = { passed: 'Passed', active: 'In progress', open: 'Ready to start', locked: 'Waiting' }
const fmtH = (h: number) => (h >= 1000 ? `${(h / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(h)))

/** Where a module stands, drawn: a ring to start, half-filled in progress, filled when passed, faint when waiting */
function StatusMark({ status }: { status: ModuleRow['status'] }) {
  return (
    <svg className={`md-mark is-${status}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {status === 'locked' && <circle cx="7" cy="7" r="5.25" fill="none" strokeWidth="1.5" strokeDasharray="2 2.2" />}
      {status === 'open' && <circle cx="7" cy="7" r="5.25" fill="none" strokeWidth="1.5" />}
      {status === 'active' && (
        <>
          <circle cx="7" cy="7" r="5.25" fill="none" strokeWidth="1.5" />
          <path d="M7 3.25 A3.75 3.75 0 0 1 7 10.75 Z" className="md-mark-fill" />
        </>
      )}
      {status === 'passed' && (
        <>
          <circle cx="7" cy="7" r="6" className="md-mark-fill" />
          <path d="M4.4 7.2 6.2 9 9.7 5.3" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="md-mark-tick" />
        </>
      )}
    </svg>
  )
}

/** Solid and shaky out of all, as one thin bar */
function Bar({ solid, shaky, total }: { solid: number; shaky: number; total: number }) {
  const t = Math.max(1, total)
  return (
    <span className="md-bar" role="img" aria-label={`${solid} of ${total} solid, ${shaky} shaky`}>
      <span className="md-bar-solid" style={{ width: `${(solid / t) * 100}%` }} />
      <span className="md-bar-shaky" style={{ left: `${(solid / t) * 100}%`, width: `${(shaky / t) * 100}%` }} />
    </span>
  )
}

export function ModulesView({ notebook, path, notes, mastery }: { notebook: string; path: string; notes: Map<string, NoteMeta>; mastery: Record<string, Mastery> }) {
  const app = useApp()
  const [data, setData] = useState<TrackModulesView | null | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)
  const [page, setPage] = useState<ModuleRow | null>(null)
  const [mode, setMode] = useState<'list' | 'map'>(() => {
    try {
      return localStorage.getItem('tide.modules.mode') === 'map' ? 'map' : 'list'
    } catch {
      return 'list'
    }
  })
  const [busy, setBusy] = useState('')
  const load = useCallback(() => window.tide.modules.track(notebook).then(setData).catch(() => setData(null)), [notebook])
  useEffect(() => {
    void load()
  }, [load, app.files])
  const pickMode = (m: 'list' | 'map') => {
    setMode(m)
    try {
      localStorage.setItem('tide.modules.mode', m)
    } catch {
      // Not kept
    }
  }

  if (data === undefined) return null
  if (data === null) return <p className="muted">This track’s modules can’t be read just now.</p>

  // The module page: its outline, as any roadmap's
  if (page) {
    const row = data.modules.find((m) => m.id === page.id) ?? page
    return (
      <section className="md-page" aria-label={row.title}>
        <div className="md-page-head">
          <button className="link-btn md-back" onClick={() => setPage(null)}>
            <Icon name="back" size={13} />
            {data.track.title}
          </button>
          <div className="md-page-title">
            <StatusMark status={row.status} />
            <h2>{row.title}</h2>
          </div>
          <ModuleFacts row={row} pace={data.pace} />
        </div>
        <OutlineView notebook={path} outlinePath={row.path} notes={notes} mastery={mastery} onSetOutline={async () => {}} />
      </section>
    )
  }

  const t = data.totals
  const hoursByStatus = (s: ModuleRow['status']) => data.modules.filter((m) => m.status === s).reduce((n, m) => n + Math.max(1, m.hours), 0)
  const allHours = Math.max(1, data.modules.reduce((n, m) => n + Math.max(1, m.hours), 0))
  const there = async (id: string, on: boolean) => {
    setBusy(id)
    try {
      await window.tide.modules.there(id, on)
      await load()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="md" aria-label={`${data.track.title}: modules`}>
      <header className="md-head">
        <div className="md-meter" role="img" aria-label={`${t.passed} passed, ${t.open} open, ${t.locked} waiting, of ${t.modules} modules`}>
          {(['passed', 'active', 'open', 'locked'] as const).map((s) => (
            <span key={s} className={`md-meter-seg is-${s}`} style={{ flexGrow: hoursByStatus(s) / allHours }} />
          ))}
        </div>
        <dl className="md-figures">
          <div>
            <dt>Passed</dt>
            <dd>
              {t.passed}
              <small>/{t.modules}</small>
            </dd>
          </div>
          <div>
            <dt>Open</dt>
            <dd>{t.open}</dd>
          </div>
          <div>
            <dt>Waiting</dt>
            <dd>{t.locked}</dd>
          </div>
          <div title={data.pace.measured ? `Rough sizes, scaled ×${data.pace.factor} to your pace over the last ${data.pace.weeks} weeks` : 'Rough relative sizes. After a few weeks Tide scales them to your own pace.'}>
            <dt>Left</dt>
            <dd>
              {fmtH(t.hoursLeft)}
              <small> h{data.pace.measured ? '' : ' ≈'}</small>
            </dd>
          </div>
        </dl>
        <div className="segmented text md-mode" role="tablist" aria-label="Show as">
          <button role="tab" aria-selected={mode === 'list'} className={mode === 'list' ? 'on' : ''} onClick={() => pickMode('list')}>
            List
          </button>
          <button role="tab" aria-selected={mode === 'map'} className={mode === 'map' ? 'on' : ''} onClick={() => pickMode('map')}>
            Map
          </button>
        </div>
      </header>

      {data.issues.length > 0 && (
        <p className="md-issue" title={data.issues.map((i) => (i.kind === 'missing' ? `${i.module} ${i.via} ${i.ref}, which no file has` : i.kind === 'cycle' ? `A loop: ${i.modules.join(' → ')}` : i.kind === 'duplicate-topic' ? `“${i.topic}” is in ${i.modules.join(' and ')}` : `${i.module} twice`)).join('\n')}>
          {data.issues.length} {data.issues.length === 1 ? 'problem' : 'problems'} in the module files
        </p>
      )}

      <TrackView notebook={notebook} path={path} modular />

      {mode === 'list' ? (
        <ol className="md-list">
          {data.modules.map((m) => (
            <li key={m.id} className={`md-row is-${m.status}${open === m.id ? ' is-open' : ''}`} id={`md-${m.id}`}>
              <button className="md-row-main" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                <StatusMark status={m.status} />
                <span className="md-title">
                  <span className="md-name">{m.title}</span>
                  {m.status === 'locked' && m.requires.some((r) => !r.passed) ? (
                    <span className="md-sub">Needs {m.requires.filter((r) => !r.passed).map((r) => r.title).join(', ')}</span>
                  ) : m.now && m.status !== 'passed' ? (
                    <span className="md-sub">{m.now.replace(/^\d+\.\s*/, '')}</span>
                  ) : null}
                </span>
                {m.shared.length > 0 && (
                  <span className="md-shared" title={`Also in ${m.shared.join(', ')}: learned once, one progress`}>
                    <Icon name="link" size={11} />
                    {m.shared.length}
                  </span>
                )}
                {m.level !== 'core' && <span className="md-level">{m.level}</span>}
                <Bar solid={m.solid} shaky={m.shaky} total={m.total} />
                <span className="md-num" title={`${m.solid} of ${m.total} topics solid`}>
                  {m.solid}
                  <small>/{m.total}</small>
                </span>
                <span className="md-num md-hours" title={data.pace.measured ? `About ${m.hoursLeft} h left at your pace (stated size ${m.hours} h)` : `About ${m.hoursLeft} h left; a rough size, scaled to your pace once Tide has a few weeks of it`}>
                  {m.status === 'passed' ? '' : `${fmtH(m.hoursLeft)} h`}
                </span>
              </button>
              {open === m.id && <ModuleDetail m={m} busy={busy === m.id} onOutline={() => setPage(m)} onThere={(on) => there(m.id, on)} onJump={(id) => setOpen(id)} />}
            </li>
          ))}
        </ol>
      ) : (
        <ModuleMap modules={data.modules} onPick={(id) => (pickMode('list'), setOpen(id), requestAnimationFrame(() => document.getElementById(`md-${id}`)?.scrollIntoView({ block: 'nearest' })))} />
      )}

      {data.projects.length > 0 && <Projects projects={data.projects} onChange={load} />}
    </section>
  )
}

function ModuleFacts({ row, pace }: { row: ModuleRow; pace: TrackModulesView['pace'] }) {
  return (
    <dl className="md-facts">
      <div>
        <dt>Solid</dt>
        <dd>
          {row.solid}
          <small>/{row.total}</small>
        </dd>
      </div>
      <div>
        <dt>Parts</dt>
        <dd>
          {row.parts.passed}
          <small>/{row.parts.of}</small>
        </dd>
      </div>
      <div title={pace.measured ? `Scaled ×${pace.factor} to your pace (stated ${row.hours} h)` : 'A rough relative size; scaled to your pace after a few weeks'}>
        <dt>Left</dt>
        <dd>
          {row.hoursLeft}
          <small> h</small>
        </dd>
      </div>
      {row.interview.length > 0 && (
        <div title="Interview bars it serves">
          <dt>Bars</dt>
          <dd className="md-dd-words">{row.interview.join(' · ')}</dd>
        </div>
      )}
    </dl>
  )
}

function ModuleDetail({ m, busy, onOutline, onThere, onJump }: { m: ModuleRow; busy: boolean; onOutline: () => void; onThere: (on: boolean) => void; onJump: (id: string) => void }) {
  const [gate, setGate] = useState(false)
  return (
    <div className="md-detail">
      {m.depthGoal && <p className="md-goal">{m.depthGoal}</p>}
      <div className="md-detail-row">
        <span className="md-label">{STATUS_WORD[m.status]}</span>
        {m.requires.length > 0 && (
          <span className="md-reqs">
            {m.requires.map((r) => (
              <button key={r.id} className={`md-req${r.passed ? ' is-passed' : ''}${r.missing ? ' is-missing' : ''}`} onClick={() => !r.missing && onJump(r.id)} title={r.missing ? 'No module file has this id' : r.passed ? 'Passed' : 'Not passed yet'} disabled={r.missing}>
                {r.passed && <Icon name="check" size={10} />}
                {r.title}
              </button>
            ))}
          </span>
        )}
        {m.fanOut > 0 && <span className="md-meta" title="Modules that build on this one, directly or further on">{m.fanOut} build on it</span>}
      </div>
      <div className="md-actions">
        <button className="btn" onClick={onOutline}>
          <Icon name="outline" size={13} />
          Outline
        </button>
        {m.gate && (
          <button className="link-btn" onClick={() => setGate((g) => !g)} aria-expanded={gate}>
            Gate
          </button>
        )}
        {m.status !== 'passed' && !m.there && (
          <button className="link-btn md-there" onClick={() => onThere(true)} disabled={busy} title="You already know this to its gate: what requires it opens. Recorded, and yours to take back.">
            I’m there
          </button>
        )}
        {m.there && (
          <button className="link-btn" onClick={() => onThere(false)} disabled={busy}>
            Take back “I’m there”
          </button>
        )}
      </div>
      {gate && m.gate && <p className="md-gate">{m.gate}</p>}
    </div>
  )
}

/** The requires DAG as columns: each module one step right of the latest thing it needs in this track */
function ModuleMap({ modules, onPick }: { modules: ModuleRow[]; onPick: (id: string) => void }) {
  const W = 176
  const H = 30
  const GX = 44
  const GY = 10
  const layout = useMemo(() => {
    const ids = new Set(modules.map((m) => m.id))
    const level = new Map<string, number>()
    const lv = (id: string, seen = new Set<string>()): number => {
      if (level.has(id)) return level.get(id)!
      if (seen.has(id)) return 0
      seen.add(id)
      const m = modules.find((x) => x.id === id)
      const reqs = (m?.requires ?? []).filter((r) => ids.has(r.id))
      const v = reqs.length ? 1 + Math.max(...reqs.map((r) => lv(r.id, seen))) : 0
      level.set(id, v)
      return v
    }
    modules.forEach((m) => lv(m.id))
    const cols = new Map<number, string[]>()
    for (const m of modules) cols.set(level.get(m.id)!, [...(cols.get(level.get(m.id)!) ?? []), m.id])
    const pos = new Map<string, { x: number; y: number }>()
    for (const [c, list] of cols) list.forEach((id, i) => pos.set(id, { x: c * (W + GX), y: i * (H + GY) }))
    const width = (Math.max(0, ...cols.keys()) + 1) * (W + GX) - GX
    const height = Math.max(...[...cols.values()].map((l) => l.length)) * (H + GY) - GY
    return { pos, width, height, ids }
  }, [modules])
  return (
    <div className="md-map" role="group" aria-label="Modules by what they require">
      <div className="md-map-canvas" style={{ width: layout.width, height: layout.height }}>
        <svg className="md-map-edges" width={layout.width} height={layout.height} aria-hidden="true">
          {modules.flatMap((m) =>
            m.requires
              .filter((r) => layout.ids.has(r.id))
              .map((r) => {
                const a = layout.pos.get(r.id)!
                const b = layout.pos.get(m.id)!
                const x1 = a.x + W
                const y1 = a.y + H / 2
                const x2 = b.x
                const y2 = b.y + H / 2
                const mx = (x1 + x2) / 2
                return <path key={`${r.id}-${m.id}`} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} className={r.passed ? 'is-passed' : ''} />
              })
          )}
        </svg>
        {modules.map((m) => {
          const p = layout.pos.get(m.id)!
          return (
            <button key={m.id} className={`md-node is-${m.status}`} style={{ left: p.x, top: p.y, width: W, height: H }} onClick={() => onPick(m.id)} title={`${m.title}: ${STATUS_WORD[m.status].toLowerCase()}, ${m.solid}/${m.total} solid, about ${m.hoursLeft} h`}>
              <StatusMark status={m.status} />
              <span className="md-node-name">{m.title}</span>
              <span className="md-node-fill" style={{ width: `${m.total ? (m.solid / m.total) * 100 : 0}%` }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Projects({ projects, onChange }: { projects: TrackModulesView['projects']; onChange: () => void }) {
  const app = useApp()
  const [busy, setBusy] = useState('')
  const start = async (id: string, notebook?: string) => {
    if (notebook) return app.setView({ kind: 'notebook', path: notebook, tab: 'project' })
    setBusy(id)
    try {
      const made = await window.tide.modules.startProject(id)
      onChange()
      app.setView({ kind: 'notebook', path: made.notebook, tab: 'project' })
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }
  return (
    <section className="md-projects" aria-label="Projects">
      <h3 className="md-h">Projects</h3>
      <ul>
        {projects.map((p) => (
          <li key={p.id} className="md-project">
            <span className="md-project-name">{p.title}</span>
            <span className="md-steps" role="img" aria-label={`${p.done} of ${p.of} milestones built`}>
              {p.milestones.map((m) => (
                <span key={m.id} className={`md-step is-${m.status}`} title={`${m.title}: ${m.status === 'done' ? 'built' : m.status === 'open' ? 'ready to build' : `needs ${m.waiting.join(', ')}`}`} />
              ))}
            </span>
            <span className="md-project-next">{p.next ? p.next.title : p.done === p.of ? 'Built' : 'Waits on its modules'}</span>
            {(p.next || p.notebook) && (
              <button className="btn md-project-go" onClick={() => start(p.id, p.notebook)} disabled={busy === p.id}>
                {p.notebook ? 'Open' : busy === p.id ? 'Setting up…' : 'Set it up'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
