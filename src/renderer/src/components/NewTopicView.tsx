import { reveal } from '../lib/scroll'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStep, OutlineDraftRequest } from '@shared/types'
import { normalizeOutlineDraft, parseOutline, type OutlineLine } from '@shared/outline'
import { addPlanDates, datePhases, planFrontmatter, planLength, readingList, rescalePlan, shortDate, type StudyPlan } from '@shared/plan'
import { PixelScene } from './PixelScene'
import { useApp } from '../state'
import { Icon } from './Icon'
import { PillInput, PillSelect, PillToggle, PromptBox } from './PromptBox'

type Size = OutlineDraftRequest['size'] | 'plan'

const SIZES: { id: Size; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan it for me', hint: 'Sized, phased and dated' },
  { id: 'overview', label: 'Overview', hint: 'About 25 topics' },
  { id: 'course', label: 'Course', hint: 'About 70 topics' },
  { id: 'deep', label: 'Deep', hint: 'About 150 topics' }
]

const BLANK = '## Part 1\n\n### Chapter 1\n\n- [ ] First topic\n'

const today = () => new Date().toISOString().slice(0, 10)

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim()

/** Start learning something new: name it, say why, and get a drafted outline to edit */
export function NewTopicView({ initial, initialGoal, auto }: { initial?: string; initialGoal?: string; auto?: boolean }) {
  const app = useApp()
  const [topic, setTopic] = useState(initial ?? '')
  const [goal, setGoal] = useState(initialGoal ?? '')
  const [size, setSize] = useState<Size>('plan')
  const [hours, setHours] = useState(() => Number(localStorage.getItem('tide.plan.hours')) || 6)
  const [start, setStart] = useState(today)
  const [deadline, setDeadline] = useState('')
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [planSources, setPlanSources] = useState<{ title: string; url: string }[]>([])
  const [planResearch, setPlanResearch] = useState('')
  const [toThings, setToThings] = useState(true)
  const [thingsReady, setThingsReady] = useState(false)
  useEffect(() => {
    window.tide.learn.thingsStatus().then((s) => setThingsReady(s.ready)).catch(() => {})
  }, [])
  const [research, setResearch] = useState(app.settings.ai.webSearch?.provider !== 'off')
  const [phase, setPhase] = useState<'form' | 'drafting' | 'review'>('form')
  const [raw, setRaw] = useState('')
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [ask, setAsk] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const runId = useRef<string | null>(null)
  const topicRef = useRef<HTMLDivElement>(null)
  const focusTopic = () => topicRef.current?.querySelector('textarea')?.focus()

  useEffect(() => focusTopic(), [])
  // Asked for from Chat or Home ("I want to learn …"): plan it straight away
  const autoStarted = useRef(false)
  useEffect(() => {
    if (auto && initial && !autoStarted.current) {
      autoStarted.current = true
      draft()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, initial])

  // Stop a draft that's still streaming if the view goes away
  useEffect(
    () => () => {
      if (runId.current) window.tide.learn.cancelDraft(runId.current)
    },
    []
  )

  useEffect(
    () =>
      window.tide.ai.onEvent((e) => {
        if (e.id !== runId.current) return
        if (e.type === 'delta') setRaw((r) => r + e.text)
        else if (e.type === 'step') setSteps((s) => [...s.filter((x) => x.id !== e.step.id), e.step])
        else if (e.type === 'error') {
          setError(e.message)
          setPhase('form')
          runId.current = null
        } else if (e.type === 'done') {
          runId.current = null
          setPhase('review')
        }
      }),
    []
  )

  const outline = useMemo(() => normalizeOutlineDraft(raw), [raw])
  const lines = useMemo(() => parseOutline(outline).lines, [outline])
  const topicCount = lines.filter((l) => l.kind === 'item' && l.depth === 0).length
  const partCount = lines.filter((l) => l.kind === 'heading' && l.level === 2).length

  const draft = async () => {
    if (!topic.trim()) return focusTopic()
    const id = `draft-${Date.now()}`
    runId.current = id
    setRaw('')
    setSteps([])
    setError('')
    setPlan(null)
    setPhase('drafting')
    try {
      if (size === 'plan') {
        localStorage.setItem('tide.plan.hours', String(hours))
        // First size it (research, scope, phases), then write the roadmap phase by phase
        const sized = await window.tide.learn.sizePlan(id, { topic: topic.trim(), goal, hoursPerWeek: hours, start, ...(deadline ? { deadline } : {}) })
        if (runId.current !== id) return
        setPlan(sized.plan)
        setPlanSources(sized.sources)
        setPlanResearch(sized.research)
        await window.tide.learn.draftOutline({ id, topic: topic.trim(), goal, size: 'course', research: false, plan: sized.plan, notes: sized.research })
      } else await window.tide.learn.draftOutline({ id, topic: topic.trim(), goal, size, research })
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setPhase('form')
      runId.current = null
    }
  }

  const dated = useMemo(() => (plan ? datePhases(plan, start) : []), [plan, start])

  const weeksUntil = (date: string) => Math.max(1, (new Date(date).getTime() - new Date(start).getTime()) / (7 * 86_400_000))

  // Hours and a finish date change the plan at once; the outline (sized by total hours) still fits
  const rescale = (change: { hoursPerWeek?: number; deadline?: string }) => {
    if (!plan) return
    const next = rescalePlan(plan, change.deadline ? { weeks: weeksUntil(change.deadline) } : { hoursPerWeek: change.hoursPerWeek })
    setPlan(next)
    setHours(next.hoursPerWeek)
    if (change.deadline !== undefined) setDeadline(change.deadline)
  }

  // Anything else goes to the planner; if the phases change, the outline is written again for them
  const adjust = async () => {
    if (!plan || !ask.trim() || adjusting) return
    setAdjusting(true)
    setError('')
    try {
      const next = await window.tide.learn.adjustPlan({ topic: topic.trim(), goal, hoursPerWeek: plan.hoursPerWeek, start, ...(deadline ? { deadline } : {}), plan, request: ask })
      const samePhases = next.phases.length === plan.phases.length && next.phases.every((p, i) => p.title === plan.phases[i].title)
      setPlan(next)
      setHours(next.hoursPerWeek)
      setAsk('')
      if (!samePhases) {
        const id = `draft-${Date.now()}`
        runId.current = id
        setRaw('')
        setPhase('drafting')
        await window.tide.learn.draftOutline({ id, topic: topic.trim(), goal, size: 'course', research: false, plan: next, notes: planResearch })
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setAdjusting(false)
    }
  }

  const stop = () => {
    if (runId.current) window.tide.learn.cancelDraft(runId.current)
  }

  const create = async (body: string) => {
    const name = fileSafe(topic)
    if (!name) return focusTopic()
    setCreating(true)
    setError('')
    try {
      const folder = await window.tide.vault.createFolder('', name)
      const taken = new Set(app.files.map((f) => f.path.toLowerCase()))
      let path = `Roadmaps/${name}.md`
      for (let i = 2; taken.has(path.toLowerCase()); i++) path = `Roadmaps/${name} ${i}.md`
      // A sized plan keeps its dates: in the front matter, the phase headings and the exams
      // The books it names under its chapters are checked first: an invented title or author is left out
      const checked = body === BLANK ? body : await window.tide.learn.checkResources(body).catch(() => body)
      const content = plan ? planFrontmatter(plan, start) + addPlanDates(checked, dated) : checked
      await window.tide.vault.write(path, content)
      await window.tide.learn.updateNotebook(folder, { outline: path, ...(goal.trim() || plan?.why ? { description: (goal.trim() || plan!.why).slice(0, 240) } : {}) })
      if (plan && dated.length) {
        // What to read, phase by phase, beside the roadmap
        const readings = await window.tide.learn.planReadings(topic.trim(), plan, planResearch).catch(() => [])
        await window.tide.vault.write(`${folder}/Reading list.md`, readingList(name, content, planSources, readings)).catch(() => {})
        // Programming exercises are also real coding challenges in Practice, drawing on this notebook
        if (plan.coding)
          for (const ex of plan.phases.flatMap((p) => p.practice ?? []).slice(0, 12))
            await window.tide.practice.addChallenge({ title: ex.slice(0, 120), source: { kind: 'folder', path: folder } }).catch(() => {})
        const goals = await window.tide.goals.list()
        await window.tide.goals.save([...goals, { id: Math.random().toString(36).slice(2, 10), name: `Finish ${name}`, notebook: folder, deadline: dated[dated.length - 1].end, createdAt: Date.now() }])
        if (thingsReady && toThings)
          await window.tide.learn
            .planToThings(path, name, folder)
            .then((r) => app.toast(`Added to Things 4: ${r.todos} tasks with dates`))
            .catch((e) => app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' }))
      }
      await app.refreshTree()
      app.setView({ kind: 'notebook', path: folder })
      app.toast(`Created ${name}`)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setCreating(false)
    }
  }

  return (
    <div className="page new-topic">
      <PixelScene place={phase === 'form' ? 'planner' : 'drafting'} rows={40} scale={3} className="page-scene" data={{ count: topicCount, live: phase === 'drafting' }} />
      <div className="page-inner narrow">
        <h1 className="page-title">New topic</h1>

        {phase === 'form' && (
          <div className="nt-form">
            <div ref={topicRef}>
              <PromptBox
                value={topic}
                onChange={(v) => setTopic(v.slice(0, 120))}
                onSubmit={draft}
                label="What do you want to learn?"
                placeholder="What do you want to learn? Payment rails, neural networks, Stoic philosophy…"
                action={size === 'plan' ? 'Plan it' : 'Draft an outline'}
                hint={SIZES.find((x) => x.id === size)?.hint}
                tools={
                  <>
                    <PillSelect label="How deep" icon="list" value={size} onChange={(v) => setSize(v as Size)} options={SIZES.map((x) => ({ value: x.id, label: x.label }))} />
                    {size === 'plan' ? (
                      <>
                        <PillInput type="number" min={1} max={60} width={20} placeholder="6" suffix="h a week" value={String(hours)} onChange={(v) => setHours(Math.max(1, Math.min(60, Number(v) || 1)))} />
                        <PillInput type="date" width={104} prefix="From" placeholder="Start" value={start} onChange={(v) => setStart(v || today())} />
                        <PillInput type="date" width={104} min={start} prefix="Finish by" placeholder="Finish by" value={deadline} onChange={setDeadline} />
                      </>
                    ) : (
                      <PillToggle
                        icon="globe"
                        label="Research syllabi"
                        title="Read real syllabi and roadmaps first: slower, more current"
                        on={research}
                        onChange={setResearch}
                        disabled={app.settings.ai.webSearch?.provider === 'off'}
                      />
                    )}
                  </>
                }
              />
            </div>
            <PromptBox
              value={goal}
              onChange={setGoal}
              multiline
              action="none"
              minRows={2}
              label="Why, and what you know"
              placeholder="Why you want it and what you already know (optional). For a payments role; I know Python and SQL."
            />
            {error && <p className="error-text">{error}</p>}
            <button type="button" className="btn ghost small nt-blank" disabled={!topic.trim() || creating} onClick={() => create(BLANK)}>
              Or start with a blank outline
            </button>
          </div>
        )}

        {phase !== 'form' && (
          <>
            <div className="nt-status">
              <div>
                <p className="nt-topic">{topic}</p>
                <p className="muted small">
                  {phase === 'drafting'
                    ? topicCount
                      ? `Writing… ${topicCount} topics so far`
                      : steps.some((s) => s.status === 'running')
                        ? 'Researching…'
                        : 'Writing…'
                    : `${topicCount} topics in ${partCount} part${partCount === 1 ? '' : 's'}. You can rename, reorder, add and remove anything after you create it.`}
                </p>
              </div>
              <div className="row-gap">
                {phase === 'drafting' ? (
                  <button className="btn" onClick={stop}>
                    <Icon name="stop" size={14} />
                    Stop
                  </button>
                ) : (
                  <>
                    <button className="btn ghost" onClick={() => setPhase('form')}>
                      Change details
                    </button>
                    <button className="btn" onClick={draft}>
                      <Icon name="refresh" size={14} />
                      Draft again
                    </button>
                    <button className="btn primary" onClick={() => create(outline)} disabled={!topicCount || creating}>
                      {creating ? 'Creating…' : 'Create notebook'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {steps.length > 0 && (
              <ul className="nt-steps">
                {steps.map((s) => (
                  <li key={s.id} className={s.status}>
                    {s.status === 'running' ? <span className="spinner" /> : <Icon name={s.status === 'error' ? 'x' : 'check'} size={13} />}
                    <span>{s.label}</span>
                    {s.detail && <span className="muted">{s.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
            {plan && (
              <div className={`nt-plan${adjusting ? ' busy' : ''}`}>
                <p className="nt-plan-head">
                  <strong>{planLength(plan.weeks)}</strong>
                  <span>
                    at {plan.hoursPerWeek} hours a week, {shortDate(dated[0].start)} to {shortDate(dated[dated.length - 1].end)}
                  </span>
                </p>
                {plan.why && <p className="nt-plan-why">{plan.why}</p>}
                <div className="nt-bar" aria-hidden="true">
                  {dated.map((p, i) => (
                    <span key={i} style={{ flexGrow: p.weeks }} />
                  ))}
                </div>
                <ol className="nt-phases">
                  {dated.map((p, i) => (
                    <li key={i}>
                      <span className="nt-phase-num">{i + 1}</span>
                      <span className="nt-phase-name">{p.title}</span>
                      <span className="nt-phase-when">
                        {shortDate(p.start)} to {shortDate(p.end)}
                        <span className="muted"> {planLength(p.weeks)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="nt-plan-includes">
                  {[
                    `${plan.phases.reduce((n, p) => n + (p.practice?.length ?? 0), 0)} practice exercises${plan.coding ? ' (also in Practice)' : ''}`,
                    `${plan.phases.filter((p) => p.project).length} projects`,
                    `an exam per phase`,
                    'a reading list'
                  ].join(', ')}
                </p>
                {phase === 'review' && (
                  <PromptBox
                    value={ask}
                    onChange={setAsk}
                    onSubmit={adjust}
                    busy={adjusting}
                    label="Change the plan"
                    placeholder="Change anything: finish by June, skip the compliance phase, more projects…"
                    tools={
                      <>
                        <PillInput type="number" min={1} max={60} width={20} placeholder="6" suffix="h a week" value={String(plan.hoursPerWeek)} onChange={(v) => Number(v) > 0 && rescale({ hoursPerWeek: Math.min(60, Number(v)) })} />
                        <PillInput type="date" width={104} min={start} prefix="Finish by" placeholder="Finish by" value={deadline} onChange={(v) => (v ? rescale({ deadline: v }) : setDeadline(''))} />
                        {thingsReady && <PillToggle icon="check" label="Add to Things 4" title="Tasks and deadlines go to Things 4 when you create it" on={toThings} onChange={setToThings} />}
                      </>
                    }
                  />
                )}
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            {phase === 'review' && !topicCount && <p className="error-text">No outline came back. Try again, or start blank.</p>}
            <OutlinePreview lines={lines} live={phase === 'drafting'} />
          </>
        )}
      </div>
    </div>
  )
}

function OutlinePreview({ lines, live }: { lines: OutlineLine[]; live: boolean }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (live) reveal(end.current, { block: 'nearest', behavior: 'auto' })
  }, [lines.length, live])
  if (!lines.length) return null
  return (
    <div className="nt-preview" aria-live="off">
      {lines.map((l, i) =>
        l.kind === 'heading' ? (
          <p key={i} className={`nt-h h${l.level}${live ? ' fall' : ''}`}>
            {l.text}
          </p>
        ) : l.kind === 'item' ? (
          <p key={i} className={`nt-item${l.depth ? ' sub' : ''}${l.checked === null ? ' res' : ''}${live ? ' fall' : ''}`}>
            {l.checked !== null && <span className="nt-box" aria-hidden="true" />}
            {l.checked === null ? l.text.replace(/^[_*]+|[_*]+$/g, '') : l.text}
          </p>
        ) : null
      )}
      <div ref={end} />
    </div>
  )
}
