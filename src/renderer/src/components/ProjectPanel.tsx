import { useEffect, useMemo, useState } from 'react'
import { briefMilestones, seedCanvas, type ProjectInfo, type ProjectKind, type ProjectMap } from '@shared/project'
import { serializeCanvas } from '@shared/canvas'
import { lessonCanvasPath, type SessionSetup } from '@shared/session'
import { useApp } from '../state'
import { Icon } from './Icon'
import { PromptBox } from './PromptBox'
import { renderMarkdown } from '../lib/markdown'
import { startingIdea } from '../lib/projects'

type Lesson = NonNullable<SessionSetup['options']>

/**
 * A notebook as a project: what it's for, its documents, and the ways in. For a system you need to
 * understand: what it is, its parts, its flows and its tools, each a lesson in the system's own
 * terms. For something you'll build: the brief drafted with you, its milestones worked through
 * with a mentor, and what to learn first.
 */
export function ProjectPanel({ notebook, name, info, onChange }: { notebook: string; name: string; info: ProjectInfo | null; onChange(): void }) {
  const app = useApp()
  const [map, setMap] = useState<ProjectMap | null>(null)
  const [mapping, setMapping] = useState(false)
  const [docs, setDocs] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [brief, setBrief] = useState('')
  const [ask, setAsk] = useState('')

  useEffect(() => {
    if (!info) return
    window.tide.projects.docs(notebook).then(setDocs).catch(() => {})
    window.tide.projects.map(notebook).then(setMap).catch(() => {})
  }, [notebook, info, app.files])
  useEffect(() => {
    if (info?.brief) window.tide.vault.read(info.brief).then(setBrief).catch(() => setBrief(''))
  }, [info?.brief, app.files])

  const save = async (next: ProjectInfo | null) => {
    await window.tide.projects.set(notebook, next)
    onChange()
  }

  /** Attaching a document files it under the project in the Library: every lesson then reads it */
  const attach = async (path: string) => {
    const all = await window.tide.library.topics()
    await window.tide.library.setTopics(path, [...(all[path] ?? []), name])
    if (info) await save({ ...info, docs: [...new Set([...info.docs, path])] })
    setPicking(false)
  }
  const detach = async (path: string) => {
    const all = await window.tide.library.topics()
    await window.tide.library.setTopics(path, (all[path] ?? []).filter((t) => t.toLowerCase() !== name.toLowerCase()))
    if (info) await save({ ...info, docs: info.docs.filter((d) => d !== path) })
  }

  const remap = async () => {
    setMapping(true)
    try {
      setMap(await window.tide.projects.map(notebook, true))
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    } finally {
      setMapping(false)
    }
  }

  const lesson = (topic: string, options: Lesson = {}) =>
    app.setView({ kind: 'session', mode: 'teach', scope: { kind: 'folder', path: notebook }, topic, options: { ...options, project: { name, kind: info?.kind ?? 'understand', ...(options.project?.milestone ? { milestone: options.project.milestone } : {}) } }, nonce: Date.now() })
  /** A flow, walked through on a canvas that starts with the project's parts already laid out */
  const [preparing, setPreparing] = useState('')
  const walk = async (flow: string) => {
    const topic = `Walk me through ${flow} in ${name}`
    setPreparing(flow)
    // Its steps from the docs (once; cached), and a canvas with the parts laid out, nothing joined yet
    const steps = await window.tide.projects.flowSteps(notebook, flow).catch(() => [])
    if (map) await window.tide.vault.write(lessonCanvasPath({ kind: 'folder', path: notebook }, topic), serializeCanvas(seedCanvas(map))).catch(() => {})
    setPreparing('')
    lesson(topic, { strategy: 'walkthrough', ...(steps.length ? { flow: steps } : {}) })
  }
  const deeper = (tool: string) =>
    app.setView({ kind: 'new-topic', topic: tool, goal: `I've been learning ${tool} as it's used in my project "${name}". Now I want to understand it properly, beyond the project: skip what the project already taught me and go deeper.`, nonce: Date.now() })

  if (!info) return <ProjectSetup name={name} onCreate={save} />

  const milestones = briefMilestones(brief)
  const toggleMilestone = async (i: number) => {
    if (!info.brief) return
    let n = -1
    const next = brief.replace(/^(\s*[-*] \[)([ xX])(\]\s+.+)$/gm, (line, a: string, mark: string, b: string) => {
      // Only the checklist under Milestones counts
      n++
      return n === i + offsetOf(brief) ? `${a}${mark === ' ' ? 'x' : ' '}${b}` : line
    })
    setBrief(next)
    await window.tide.vault.write(info.brief, next)
  }

  return (
    <div className="project">
      <div className="project-head">
        <span className="project-kind">{info.kind === 'build' ? 'Building it yourself' : 'Understanding a system'}</span>
        <button className="link-btn" onClick={() => save(null)}>
          Not a project
        </button>
      </div>

      <section className="project-section">
        <h3>Documents</h3>
        <ul className="project-docs">
          {docs.map((d) => (
            <li key={d}>
              <button className="project-doc" onClick={() => app.openPath(d)}>
                <Icon name={/\.pdf$/i.test(d) ? 'pdf' : 'note'} size={13} />
                {d.split('/').pop()}
              </button>
              {info.docs.includes(d) && (
                <button className="icon-btn small" onClick={() => detach(d)} title="Remove from the project">
                  <Icon name="x" size={11} />
                </button>
              )}
            </li>
          ))}
          <li>
            <button className="link-btn" onClick={() => setPicking((p) => !p)}>
              <Icon name="plus" size={12} /> Add a document
            </button>
          </li>
        </ul>
        {picking && <DocPicker exclude={docs} onPick={attach} onClose={() => setPicking(false)} />}
        {!docs.length && <p className="muted small">{info.kind === 'build' ? 'Draft the brief below; specs and references you add here are read too.' : 'Add the design doc or spec (PDF or Markdown). Anything you file under “' + name + '” in the Library counts too.'}</p>}
      </section>

      {info.kind === 'build' && <BuildSection notebook={notebook} name={name} info={info} brief={brief} milestones={milestones} onMilestone={toggleMilestone} onWork={(m) => lesson(m, { project: { name, kind: 'build', milestone: m } })} onLearnFirst={() => app.setView({ kind: 'new-topic', topic: `the foundations for building ${name}`, goal: learnFirst(brief), nonce: Date.now() })} onDrafted={onChange} />}

      {docs.length > 0 && (
        <section className="project-section">
          <div className="project-section-head">
            <h3>{info.kind === 'build' ? 'What it involves' : 'The system'}</h3>
            <button className="link-btn" onClick={remap} disabled={mapping}>
              {mapping ? 'Reading the headings…' : map ? 'Map again' : 'Map it'}
            </button>
          </div>
          {!map && !mapping && <p className="muted small">Tide reads the documents' structure (headings and contents, not every page) to find the parts, the flows and the tools, in a few seconds.</p>}
          {map?.overview && <p className="project-overview">{map.overview}</p>}

          {!!map?.components.length && (
            <>
              <h4>Parts</h4>
              <ul className="project-rows">
                {map.components.map((c) => (
                  <li key={c.name}>
                    <span className="project-row-text">
                      <strong>{c.name}</strong>
                      {c.about && <span className="muted">{c.about}</span>}
                    </span>
                    <button className="btn small" onClick={() => lesson(`${c.name} in ${name}`)}>
                      Teach me
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!!map?.flows.length && (
            <>
              <h4>Flows</h4>
              <div className="project-chips">
                {map.flows.map((f) => (
                  <button key={f} className="chip" onClick={() => walk(f)} disabled={!!preparing} title="Traced step by step, drawn on a canvas as it goes">
                    {preparing === f ? <span className="spinner" /> : <Icon name="canvas" size={12} />}
                    {preparing === f ? `Preparing ${f}…` : f}
                  </button>
                ))}
              </div>
            </>
          )}

          {!!map?.tools.length && (
            <>
              <h4>Tools it uses</h4>
              <ul className="project-rows">
                {map.tools.slice(0, 8).map((t) => (
                  <li key={t.name}>
                    <span className="project-row-text">
                      <strong>{t.name}</strong>
                      <span className="muted small">{t.mentions} mentions</span>
                    </span>
                    <button className="btn small" onClick={() => lesson(`${t.name} as it's used in ${name}`)} title="Just what this project needs, with its own data and code as the examples">
                      Learn it for this
                    </button>
                    <button className="btn small ghost" onClick={() => deeper(t.name)} title="A full roadmap, building on what the project taught you">
                      Go deeper
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="project-section">
        <PromptBox
          value={ask}
          onChange={setAsk}
          onSubmit={() => {
            if (!ask.trim()) return
            app.ask(ask.trim(), { scope: { kind: 'folder', path: notebook } })
            setAsk('')
          }}
          placeholder={info.kind === 'build' ? `Ask about building ${name}…` : `Ask how ${name} works…`}
          label="Ask about this project"
        />
      </section>
    </div>
  )
}

/** Where the Milestones checklist starts among all of a note's checkboxes */
function offsetOf(md: string): number {
  const at = md.search(/^#{2,3}\s+milestones\b/im)
  return at < 0 ? 0 : (md.slice(0, at).match(/^\s*[-*] \[[ xX]\]\s+.+$/gm) ?? []).length
}

/** The brief's "Learn first" section, to start a roadmap from */
function learnFirst(md: string): string {
  const m = md.match(/^#{2,3}\s+learn first[^\n]*\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im)
  return `I'm building this myself and need the foundations first. ${m ? `What it needs:\n${m[1].trim().slice(0, 1200)}` : ''}`.trim()
}

function ProjectSetup({ name, onCreate }: { name: string; onCreate(info: ProjectInfo): void }) {
  const [kind, setKind] = useState<ProjectKind>('understand')
  return (
    <div className="project project-setup">
      <p className="project-lead">Make {name} a project: Tide teaches it in the project's own terms, from its documents, as you need it.</p>
      <div className="project-kinds" role="radiogroup" aria-label="What kind of project">
        <button role="radio" aria-checked={kind === 'understand'} className={kind === 'understand' ? 'on' : ''} onClick={() => setKind('understand')}>
          <strong>Understand a system</strong>
          <span>It exists, with a design doc or spec. Learn its parts, its flows and the tools it uses, on the fly or in depth.</span>
        </button>
        <button role="radio" aria-checked={kind === 'build'} className={kind === 'build' ? 'on' : ''} onClick={() => setKind('build')}>
          <strong>Build it myself</strong>
          <span>Something new you'll build to learn. Tide drafts the brief with you, maps what to learn first, and mentors each milestone without writing it for you.</span>
        </button>
      </div>
      <button className="btn primary" onClick={() => onCreate({ kind, docs: [] })}>
        Make it a project
      </button>
    </div>
  )
}

function BuildSection({ notebook, name, info, brief, milestones, onMilestone, onWork, onLearnFirst, onDrafted }: { notebook: string; name: string; info: ProjectInfo; brief: string; milestones: { text: string; done: boolean }[]; onMilestone(i: number): void; onWork(m: string): void; onLearnFirst(): void; onDrafted(): void }) {
  const app = useApp()
  const [idea, setIdea] = useState(() => startingIdea(notebook))
  const [background, setBackground] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useMemo(() => `brief:${Date.now()}`, [])

  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        if (e.id !== id) return
        if (e.type === 'delta') setDraft((d) => d + e.text)
        if (e.type === 'done') {
          setBusy(false)
          onDrafted()
        }
        if (e.type === 'error') {
          setBusy(false)
          app.toast(e.message, { tone: 'error' })
        }
      }),
    [id, app, onDrafted]
  )

  if (!info.brief || busy) {
    return (
      <section className="project-section">
        <h3>The brief</h3>
        {busy ? (
          <div className="project-draft prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft || '_Drafting…_', { notePath: '', filesByName: app.filesByName }) }} />
        ) : (
          <>
            <PromptBox value={idea} onChange={setIdea} multiline minRows={3} action="none" placeholder={`What do you want ${name} to do? e.g. "A tiny Unix shell in C: pipes, redirection, job control"`} label="What you want to build" />
            <PromptBox value={background} onChange={setBackground} action="none" placeholder="What you already know (optional), e.g. some C, never used fork" label="What you already know" />
            <button
              className="btn primary"
              disabled={!idea.trim()}
              onClick={() => {
                setBusy(true)
                setDraft('')
                window.tide.projects.draftBrief({ id, notebook, idea, background }).catch(() => setBusy(false))
              }}
            >
              Draft the brief with me
            </button>
          </>
        )}
      </section>
    )
  }
  return (
    <section className="project-section">
      <div className="project-section-head">
        <h3>Milestones</h3>
        <span className="project-actions">
          <button className="link-btn" onClick={() => app.openPath(info.brief!)}>
            Open the brief
          </button>
          <button className="link-btn" onClick={onLearnFirst}>
            What to learn first
          </button>
        </span>
      </div>
      {milestones.length ? (
        <ul className="project-rows">
          {milestones.map((m, i) => (
            <li key={i} className={m.done ? 'is-done' : ''}>
              <button className="today-check" role="checkbox" aria-checked={m.done} onClick={() => onMilestone(i)} aria-label={m.done ? 'Mark not done' : 'Mark done'}>
                {m.done && <Icon name="check" size={12} />}
              </button>
              <span className="project-row-text">
                <strong>{m.text}</strong>
              </span>
              {!m.done && (
                <button className="btn small" onClick={() => onWork(m.text)} title="Work through it with a mentor: it won't write it for you">
                  Work on it
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">The brief has no Milestones checklist yet. Add one under a “## Milestones” heading.</p>
      )}
    </section>
  )
}

/** Pick a PDF or Markdown file from the vault */
function DocPicker({ exclude, onPick, onClose }: { exclude: string[]; onPick(path: string): void; onClose(): void }) {
  const app = useApp()
  const [q, setQ] = useState('')
  const files = app.files.filter((f) => /\.(md|pdf)$/i.test(f.path) && !exclude.includes(f.path) && !f.path.startsWith('.') && f.path.toLowerCase().includes(q.toLowerCase())).slice(0, 12)
  return (
    <div className="project-picker">
      <input className="filter-input" autoFocus placeholder="Find a PDF or note" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} aria-label="Find a document" />
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <button onClick={() => onPick(f.path)}>
              <Icon name={/\.pdf$/i.test(f.path) ? 'pdf' : 'note'} size={13} />
              <span>{f.path}</span>
            </button>
          </li>
        ))}
        {!files.length && <li className="muted small">Nothing matches. Add it to the vault or Library first.</li>}
      </ul>
    </div>
  )
}
