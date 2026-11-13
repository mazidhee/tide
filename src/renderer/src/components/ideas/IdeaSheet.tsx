import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEPTHS, IDEA_LANGUAGES, languageLabel, prereqCounts, type ClarifyQuestion, type IdeaDepth, type IdeaLanguage, type IdeaSuggestion, type LadderView, type PlanMilestone, type ProjectPlan } from '@shared/ideaProject'
import { scaffoldFiles, testFilesOf } from '@shared/ideaScaffold'
import { tierLabel } from '@shared/ideaLadder'
import { Icon } from '../Icon'
import { cleanError, PlanMap, PrereqChip, PrereqLegend } from './PlanParts'
import '../../styles/ideas.css'

type Stage = 'idea' | 'ladder' | 'questions' | 'drafting' | 'review' | 'creating' | 'made'
type Tab = 'map' | 'plan' | 'files'
type Made = Awaited<ReturnType<typeof window.tide.ideas.create>>

/** One screen of questions: a question with answers to pick, or the language, or the depth */
interface Step {
  id: string
  question: string
  options: string[]
  /** What each option means, under it */
  about?: string[]
  kind: 'ask' | 'language' | 'depth'
}

const BY: Record<ProjectPlan['by'], string> = { claude: 'Planned by Claude', gemma: 'Planned by Gemma on this Mac', template: 'From a starting map', manual: 'Written by you' }
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const words = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const MAPPING = ['Naming the components', 'Drawing how they connect', 'Checking what you already know', 'Ordering the milestones', 'Writing the first failing tests']

/** A text box that grows with what's written or dictated into it */
function GrowingText({ value, onChange, onSubmit, placeholder, autoFocus, className, label }: { value: string; onChange(v: string): void; onSubmit(): void; placeholder: string; autoFocus?: boolean; className: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  useEffect(() => {
    if (!autoFocus) return
    const el = ref.current
    el?.focus()
    // The caret at the end, so dictation carries on from there
    if (el) el.selectionStart = el.selectionEnd = el.value.length
  }, [autoFocus])
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      rows={1}
      placeholder={placeholder}
      aria-label={label}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          onSubmit()
        }
      }}
    />
  )
}

/**
 * New project from an idea, as a full-screen conversation: one thing at a time. Say what you want
 * to build (type it, or speak it with dictation straight into the box), answer a few questions one
 * by one, and Tide maps it out, plans the milestones and writes the starting files, all shown to
 * read and edit before anything is made (shared/ideaProject, main/ideaProjects).
 */
export function IdeaSheet({ onClose, onOpen, onNotebook, initialIdea = '', initialSeed = null }: { onClose(): void; onOpen(made: Made): void; onNotebook?(notebook: string): void; initialIdea?: string; initialSeed?: string | null }) {
  const [stage, setStage] = useState<Stage>('idea')
  const [idea, setIdea] = useState(initialIdea)
  const [matched, setMatched] = useState<string | null>(null)
  const [seed, setSeed] = useState<string | null>(initialSeed)
  const [ladder, setLadder] = useState<LadderView | null>(null)
  const [claudeIdeas, setClaudeIdeas] = useState<IdeaSuggestion[]>([])
  const [area, setArea] = useState<string | null>(null)
  const [route, setRoute] = useState<{ who: 'claude' | 'gemma' | 'none'; label: string } | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [qi, setQi] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [language, setLanguage] = useState<IdeaLanguage>('python')
  const [depth, setDepth] = useState<IdeaDepth>('solid')
  const [plan, setPlan] = useState<ProjectPlan | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<Tab>('map')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<Made | null>(null)
  const [started, setStarted] = useState(0)
  const [, tick] = useState(0)

  useEffect(() => {
    window.tide.ideas
      .ladder()
      .then((l) => {
        setLadder(l)
        const s0 = initialSeed && l.steps.find((x) => x.id === initialSeed)
        if (s0) setIdea((v) => v || `${s0.title}: ${s0.about.charAt(0).toLowerCase()}${s0.about.slice(1)}`)
        setArea(l.suggestions[0]?.area ?? l.areas[0]?.id ?? null)
      })
      .catch(() => {})
    window.tide.ideas
      .ideas()
      .then(setClaudeIdeas)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    window.tide.ideas.route().then(setRoute).catch(() => setRoute({ who: 'none', label: 'No model' }))
  }, [])
  useEffect(() => {
    const t = setTimeout(() => window.tide.ideas.matchTemplate(idea).then(setMatched).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [idea])
  useEffect(() => {
    if (stage !== 'drafting' && stage !== 'creating') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [stage])
  const working = stage === 'drafting' || stage === 'creating'
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working) {
        e.preventDefault()
        if (stage === 'ladder') setStage('idea')
        else onClose()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [stage, working, onClose])

  const fail = (e: unknown) => setError(cleanError(e))
  const tpl = seed ?? matched

  const pickSeed = (id: string) => {
    const x = ladder?.steps.find((y) => y.id === id)
    setSeed(id)
    if (x) setIdea(`${x.title}: ${x.about.charAt(0).toLowerCase()}${x.about.slice(1)}`)
    setStage('idea')
  }

  /** The questions, one per screen: Claude's (or the plain ones), then the language and the depth */
  const ask = async () => {
    if (!idea.trim()) return
    setError('')
    setBusy(true)
    try {
      const r = await window.tide.ideas.questions(idea)
      const own = r.questions.filter((q) => !/\blanguage\b|\bdeep\b|\bdepth\b/i.test(q.question))
      const langQ = r.questions.find((q) => /\blanguage\b/i.test(q.question))
      const guess = IDEA_LANGUAGES.find((l) => langQ?.options[0]?.toLowerCase().includes(l.label.toLowerCase()))?.id
      if (guess) setLanguage(guess)
      setSteps([
        ...own.map((q: ClarifyQuestion) => ({ id: q.id, question: q.question, options: q.options, kind: 'ask' as const })),
        { id: 'language', question: 'Which language will you build it in?', options: IDEA_LANGUAGES.map((l) => l.label), kind: 'language' },
        { id: 'depth', question: 'How deep should it go?', options: DEPTHS.map((d) => d.label), about: DEPTHS.map((d) => d.about), kind: 'depth' }
      ])
      setQi(0)
      setStage('questions')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const draft = async (source: 'model' | 'template' | 'blank', template?: string | null, fromSeed: string | null = seed) => {
    setError('')
    setStage('drafting')
    setStarted(Date.now())
    try {
      const list = steps.filter((q) => q.kind === 'ask' && answers[q.id]?.trim()).map((q) => ({ question: q.question, answer: answers[q.id].trim() }))
      const r = await window.tide.ideas.draft({ idea: idea.trim(), answers: [...list, { question: 'Language?', answer: languageLabel(language) }, { question: 'How deep?', answer: DEPTHS.find((d) => d.id === depth)!.label }], language, depth, template: template ?? null, seed: source === 'blank' ? null : fromSeed, source })
      setPlan(r.plan)
      setProblems(r.problems)
      setNote(r.note ?? '')
      setTab('map')
      setStage('review')
    } catch (e) {
      fail(e)
      setStage(steps.length ? 'questions' : 'idea')
    }
  }

  const check = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const r = await window.tide.ideas.check(plan)
      setPlan(r.plan)
      setProblems(r.problems)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!plan) return
    setError('')
    setStage('creating')
    setStarted(Date.now())
    try {
      const checked = await window.tide.ideas.check(plan)
      setMade(await window.tide.ideas.create(checked.plan))
      setStage('made')
    } catch (e) {
      fail(e)
      setStage('review')
    }
  }

  const answer = (st: Step, value: string) => {
    if (st.kind === 'language') setLanguage(IDEA_LANGUAGES.find((l) => l.label === value)?.id ?? language)
    else if (st.kind === 'depth') setDepth(DEPTHS.find((d) => d.label === value)?.id ?? depth)
    else setAnswers((a) => ({ ...a, [st.id]: value }))
  }
  const chosen = (st: Step) => (st.kind === 'language' ? languageLabel(language) : st.kind === 'depth' ? DEPTHS.find((d) => d.id === depth)!.label : (answers[st.id] ?? ''))
  const next = () => (qi + 1 < steps.length ? setQi(qi + 1) : void draft('model', seed ? null : tpl))

  // Numbers pick an answer on a question's screen, when not typing
  const live = useRef({ stage, qi, steps, answer, next })
  live.current = { stage, qi, steps, answer, next }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const { stage: s, qi: i, steps: st } = live.current
      const t = e.target as HTMLElement | null
      if (s !== 'questions' || e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT'))) return
      const n = Number(e.key)
      const q = st[i]
      if (q && n >= 1 && n <= q.options.length) {
        e.preventDefault()
        live.current.answer(q, q.options[n - 1])
      } else if (e.key === 'Enter') {
        e.preventDefault()
        live.current.next()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const edit = (patch: Partial<ProjectPlan>) => setPlan((p) => (p ? { ...p, ...patch } : p))
  const editMilestone = (i: number, patch: Partial<PlanMilestone>) => setPlan((p) => (p ? { ...p, milestones: p.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) } : p))
  const moveMilestone = (i: number, by: -1 | 1) =>
    setPlan((p) => {
      if (!p) return p
      const ms = [...p.milestones]
      const j = i + by
      if (j < 0 || j >= ms.length) return p
      ;[ms[i], ms[j]] = [ms[j], ms[i]]
      const first = ms.findIndex((m) => m.status !== 'done')
      return { ...p, milestones: ms.map((m, k) => (m.status === 'done' ? m : { ...m, status: k === first ? 'active' : 'todo' })) }
    })

  const elapsed = Math.round((Date.now() - started) / 1000)
  const counts = plan ? prereqCounts(plan) : null
  const files = useMemo(() => (plan ? scaffoldFiles(plan) : []), [plan])
  const testFiles = useMemo(() => testFilesOf(files), [files])
  const hours = plan?.milestones.reduce((n, m) => n + m.hours, 0) ?? 0
  const quick = [...(ladder?.suggestions.slice(0, 2).map((x) => ({ key: x.seed, label: x.title, why: `Tier ${x.tier} · ${tierLabel(x.tier)}, already mapped out. ${x.why}`, run: () => pickSeed(x.seed) })) ?? []), ...claudeIdeas.slice(0, ladder?.suggestions.length ? 1 : 3).map((x) => ({ key: x.title, label: x.title, why: `Claude’s idea, tier ${x.tier}. ${x.why}`, run: () => (setIdea(x.idea), setSeed(null)) }))]
  const dots = ['idea', 'questions', 'review', 'made'] as const
  const at = { idea: 0, ladder: 0, questions: 1, drafting: 2, review: 2, creating: 2, made: 3 }[stage]
  const step = steps[qi]

  return (
    <div className="ipf no-drag" role="dialog" aria-modal="true" aria-label="New project from an idea">
      <header className="ipf-top">
        <span className="ipf-brand">New project</span>
        <ol className="ipf-dots" aria-label="Steps">
          {dots.map((d, i) => (
            <li key={d} className={i === at ? 'on' : i < at ? 'done' : ''} aria-current={i === at ? 'step' : undefined}>
              <span className="sr-only">{d}</span>
            </li>
          ))}
        </ol>
        <button className="ipf-close" onClick={onClose} disabled={working} aria-label="Close (Esc)" title="Close (Esc)">
          <Icon name="x" size={14} />
        </button>
      </header>

      {stage === 'idea' && (
        <main className="ipf-stage ipf-prompt" key="idea">
          <h1 className="ipf-title">What do you want to build?</h1>
          <p className="ipf-sub">Type it or say it, a sentence or a whole ramble. Tide maps it out, plans it, and sets it up for you to build.</p>
          <GrowingText className="ipf-input" value={idea} onChange={(v) => (setIdea(v), seed && !v.startsWith(ladder?.steps.find((x) => x.id === seed)?.title ?? '\u0000') && setSeed(null))} onSubmit={() => void ask()} placeholder="A payment rail with a double-entry ledger, ISO 20022 messages and settlement…" autoFocus label="What you want to build" />
          {quick.length > 0 && (
            <p className="ipf-quick">
              <span>Or start from</span>
              {quick.map((q, i) => (
                <span key={q.key}>
                  {i > 0 && <span className="ipf-sep">·</span>}
                  <button className="ipf-link" onClick={q.run} title={q.why}>
                    {q.label}
                  </button>
                </span>
              ))}
              <span className="ipf-sep">·</span>
              <button className="ipf-link quiet" onClick={() => setStage('ladder')}>
                All projects, by level
              </button>
            </p>
          )}
          {error && <p className="ip-error">{error}</p>}
          <footer className="ipf-foot">
            <span className="ipf-route">
              <Icon name={route?.who === 'claude' ? 'claude' : 'laptop'} size={12} />
              {route ? (route.who === 'claude' ? `${route.label} plans it` : `${route.label}`) : ''}
            </span>
            <span className="ip-gap" />
            {tpl && (
              <button className="ipf-link quiet" onClick={() => void draft('template', seed ? null : tpl)} title="The starting map as it is, with no model">
                Skip the questions
              </button>
            )}
            <button className="btn primary ipf-go" onClick={() => void ask()} disabled={busy || !idea.trim()}>
              {busy ? 'Thinking…' : 'Continue'}
              <kbd>⌘↩</kbd>
            </button>
          </footer>
        </main>
      )}

      {stage === 'ladder' && ladder && (
        <main className="ipf-stage ipf-ladder" key="ladder">
          <h1 className="ipf-title small">Projects, by level</h1>
          <p className="ipf-sub">Each level is longer, harder and closer to core infrastructure: components, services, whole systems, then flagships that run over weeks. Levels open as you finish projects and learn their groundwork.</p>
          <nav className="ipf-areas" role="tablist">
            {ladder.areas.map((a) => (
              <button key={a.id} role="tab" aria-selected={area === a.id} className={area === a.id ? 'on' : ''} onClick={() => setArea(a.id)}>
                {a.label}
              </button>
            ))}
          </nav>
          <div className="ipf-levels">
            {([1, 2, 3, 4] as const).map((t) => {
              const list = ladder.steps.filter((x) => x.tier === t && area && x.areas.includes(area))
              const open = (ladder.areas.find((a) => a.id === area)?.tier ?? 1) >= t
              return list.length ? (
                <section key={t} className={`ipf-level${open ? '' : ' locked'}`}>
                  <h2>
                    <span>{tierLabel(t)}s</span>
                    {!open && <span className="ipf-locked">Opens later</span>}
                  </h2>
                  <ul>
                    {list.map((x) => (
                      <li key={x.id}>
                        <button onClick={() => pickSeed(x.id)}>
                          <strong>{x.title}</strong>
                          <span>{x.about}</span>
                          {x.started && <em>Started</em>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null
            })}
          </div>
          <p className="ipf-sub small">{ladder.areas.find((a) => a.id === area)?.next}</p>
          <footer className="ipf-foot">
            <button className="ipf-link quiet" onClick={() => setStage('idea')}>
              Back
            </button>
          </footer>
        </main>
      )}

      {stage === 'questions' && step && (
        <main className="ipf-stage ipf-prompt" key={`q${qi}`}>
          <p className="ipf-count">
            {qi + 1} of {steps.length}
          </p>
          <h1 className="ipf-title">{step.question}</h1>
          <div className="ipf-options" role="radiogroup" aria-label={step.question}>
            {step.options.map((o, i) => (
              <button key={o} role="radio" aria-checked={chosen(step) === o} className={`ipf-option${chosen(step) === o ? ' on' : ''}`} onClick={() => answer(step, o)} onDoubleClick={() => (answer(step, o), next())}>
                <kbd>{i + 1}</kbd>
                <span>
                  {o}
                  {step.about?.[i] && <small>{step.about[i]}</small>}
                </span>
              </button>
            ))}
          </div>
          {step.kind === 'ask' && (
            <GrowingText key={step.id} className="ipf-input small" value={step.options.includes(answers[step.id] ?? '') ? '' : (answers[step.id] ?? '')} onChange={(v) => setAnswers((a) => ({ ...a, [step.id]: v }))} onSubmit={next} placeholder="Or say it in your own words…" label={`Your own answer: ${step.question}`} />
          )}
          {error && <p className="ip-error">{error}</p>}
          <footer className="ipf-foot">
            <button className="ipf-link quiet" onClick={() => (qi ? setQi(qi - 1) : setStage('idea'))}>
              Back
            </button>
            <span className="ip-gap" />
            <span className="ipf-route">{qi + 1 === steps.length ? (route?.who === 'claude' ? `${route.label} writes the plan next` : 'Gemma writes a simpler plan on this Mac') : ''}</span>
            <button className="btn primary ipf-go" onClick={next}>
              {qi + 1 === steps.length ? 'Plan it' : 'Next'}
              <kbd>↩</kbd>
            </button>
          </footer>
        </main>
      )}

      {working && !(stage === 'creating' && plan) && (
        <main className="ipf-stage ipf-working" key="working">
          <span className="ipf-pulse" aria-hidden="true" />
          <h1 className="ipf-title small">{route?.who === 'claude' ? 'Mapping your project' : 'Planning your project'}</h1>
          <ul className="ipf-mapping">
            {MAPPING.map((m, i) => {
              const now = Math.min(MAPPING.length - 1, Math.floor(elapsed / 25))
              return (
                <li key={m} className={i < now ? 'done' : i === now ? 'now' : ''}>
                  {m}
                </li>
              )
            })}
          </ul>
          <p className="ipf-sub small">{route?.who === 'claude' ? 'A minute or two.' : ''} {elapsed > 2 ? `${elapsed} s` : ''}</p>
        </main>
      )}

      {(stage === 'review' || (stage === 'creating' && plan)) && plan && counts && (
        <main className="ipf-stage ipf-review" key="review">
          <div className="ipf-review-head">
            <p className="ipf-meta">
              {plan.tier ? `${tierLabel(plan.tier)} · ` : ''}
              {languageLabel(plan.language)} · {plan.milestones.length} milestone{plan.milestones.length === 1 ? '' : 's'} · about {hours} hours · {BY[plan.by]}
            </p>
            <input className="ipf-name" value={plan.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Project name" spellCheck={false} />
            <GrowingText className="ipf-summary" value={plan.summary} onChange={(v) => edit({ summary: v })} onSubmit={() => {}} placeholder="What it is, and what building it teaches" label="Summary" />
            {note && <p className="ip-note">{note}</p>}
          </div>
          <nav className="ipf-tabs" role="tablist">
            {(
              [
                ['map', 'The map'],
                ['plan', 'Milestones'],
                ['files', 'Starting files']
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
            <span className="ip-gap" />
            {tab === 'map' && <PrereqLegend counts={counts} />}
          </nav>
          <div className="ipf-review-body">
            {tab === 'map' && <MapTab plan={plan} onChange={setPlan} />}
            {tab === 'plan' && <MilestonesTab plan={plan} onEdit={editMilestone} onMove={moveMilestone} onChange={setPlan} />}
            {tab === 'files' && <FilesTab files={files} tests={testFiles} plan={plan} />}
          </div>
          {(problems.length > 0 || error) && (
            <p className="ipf-problems">
              {[...problems, error].filter(Boolean).join(' ')}
            </p>
          )}
          <footer className="ipf-foot">
            <button className="ipf-link quiet" onClick={() => setStage(steps.length ? 'questions' : 'idea')} disabled={stage === 'creating'}>
              Back
            </button>
            <button className="ipf-link quiet" onClick={() => void check()} disabled={busy || stage === 'creating'} title="Mark the prerequisites again and find readings, after editing">
              {busy ? 'Checking…' : 'Check again'}
            </button>
            <span className="ip-gap" />
            <span className="ipf-route">Makes a notebook, the project folder with git, its roadmap and a place on your weekly coach</span>
            <button className="btn primary ipf-go" onClick={() => void create()} disabled={stage === 'creating' || !plan.name.trim()}>
              {stage === 'creating' ? 'Making it…' : 'Create project'}
            </button>
          </footer>
        </main>
      )}

      {stage === 'made' && made && plan && (
        <main className="ipf-stage ipf-prompt ipf-made" key="made">
          <span className="ipf-check" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <h1 className="ipf-title">Ready to build</h1>
          <p className="ipf-sub center">{plan.name}</p>
          <ul className="ipf-made-list">
            <li>
              The project folder, <code>{made.root.split('/').slice(-2).join('/')}</code>, with git and its first commit
            </li>
            <li>{made.tests?.held ? `Milestone 1’s failing tests unlock when you pass its ready check; then you make them pass` : `The first milestone’s tests are in ${testFiles.join(', ')}`}</li>
            <li>The plan, its roadmap and the mentor’s memory, in the notebook “{made.notebook}”</li>
            <li>{made.coach === 'full' ? 'Your weekly coach already has six subjects: add this one from the Coach when there’s room' : 'On your weekly coach, and in What you know as you learn it'}</li>
          </ul>
          <footer className="ipf-foot center">
            {onNotebook && (
              <button className="ipf-link quiet" onClick={() => onNotebook(made.notebook)}>
                Open the notebook
              </button>
            )}
            <button className="btn primary ipf-go" autoFocus onClick={() => onOpen(made)}>
              Open the project
            </button>
          </footer>
        </main>
      )}
    </div>
  )
}

function MapTab({ plan, onChange }: { plan: ProjectPlan; onChange(p: ProjectPlan): void }) {
  const set = (i: number, patch: Partial<ProjectPlan['components'][number]>) =>
    onChange({
      ...plan,
      components: plan.components.map((c, j) => (j === i ? { ...c, ...patch } : c))
    })
  return (
    <div className="ip-maptab">
      <PlanMap plan={plan} />
      <ul className="ip-components">
        {plan.components.map((c, i) => (
          <li key={c.id}>
            <div className="ip-comp-text">
              <input className="ip-inline strong" value={c.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Component name" spellCheck={false} />
              <input className="ip-inline muted" value={c.about} onChange={(e) => set(i, { about: e.target.value })} aria-label="What it does" placeholder="What it does" />
            </div>
            <div className="ip-prereqs">
              {c.prerequisites.map((p) => (
                <PrereqChip key={p.name} p={p} />
              ))}
            </div>
            <button
              className="icon-btn small"
              onClick={() =>
                onChange({
                  ...plan,
                  components: plan.components.filter((_, j) => j !== i),
                  links: plan.links.filter((l) => l.from !== c.id && l.to !== c.id),
                  milestones: plan.milestones.map((m) => ({
                    ...m,
                    components: m.components.filter((x) => x !== c.id)
                  }))
                })
              }
              aria-label={`Remove ${c.name}`}
              title="Remove"
            >
              <Icon name="x" size={11} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MilestonesTab({ plan, onEdit, onMove, onChange }: { plan: ProjectPlan; onEdit(i: number, patch: Partial<PlanMilestone>): void; onMove(i: number, by: -1 | 1): void; onChange(p: ProjectPlan): void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const comp = (id: string) => plan.components.find((c) => c.id === id)?.name ?? id
  return (
    <ol className="ipm">
      {plan.milestones.map((m, i) => {
        const open = editing === m.id
        return (
          <li key={m.id} className={`ipm-item${open ? ' editing' : ''}`}>
            <span className="ipm-n">{i + 1}</span>
            <div className="ipm-body">
              <div className="ipm-head">
                {open ? <input className="ipm-title-input" value={m.title} onChange={(e) => onEdit(i, { title: e.target.value })} aria-label="Milestone title" autoFocus spellCheck={false} /> : <h3>{m.title}</h3>}
                <span className="ipm-hours">
                  {open ? <input type="number" min={1} max={60} value={m.hours} onChange={(e) => onEdit(i, { hours: Math.max(1, Number(e.target.value) || 1) })} aria-label="Hours" /> : m.hours}
                  {' h'}
                </span>
                <span className="ipm-tools">
                  <button onClick={() => setEditing(open ? null : m.id)}>{open ? 'Done' : 'Edit'}</button>
                  <button onClick={() => onMove(i, -1)} disabled={i === 0} aria-label="Earlier" title="Earlier">
                    <Icon name="arrowUp" size={11} />
                  </button>
                  <button onClick={() => onMove(i, 1)} disabled={i === plan.milestones.length - 1} aria-label="Later" title="Later">
                    <Icon name="arrowDown" size={11} />
                  </button>
                  <button onClick={() => onChange({ ...plan, milestones: plan.milestones.filter((_, j) => j !== i) })} disabled={plan.milestones.length <= 1} aria-label="Remove" title="Remove">
                    <Icon name="x" size={11} />
                  </button>
                </span>
              </div>
              {open ? (
                <GrowingText className="ipm-area" value={m.build} onChange={(v) => onEdit(i, { build: v })} onSubmit={() => setEditing(null)} placeholder="What you’ll build" label="What you’ll build" />
              ) : (
                <p className="ipm-build">{m.build}</p>
              )}
              <dl className="ipm-facts">
                {m.components.length > 0 && (
                  <>
                    <dt>Builds</dt>
                    <dd>{m.components.map(comp).join(', ')}</dd>
                  </>
                )}
                <dt>Learn first</dt>
                <dd>{open ? <input className="ipm-line" value={m.lessons.map((l) => l.concept).join(', ')} onChange={(e) => onEdit(i, { lessons: words(e.target.value).map((concept) => m.lessons.find((l) => l.concept === concept) ?? { concept, why: '' }) })} placeholder="Concepts, separated by commas" /> : m.lessons.map((l) => l.concept).join(' · ') || '—'}</dd>
                <dt>Done when</dt>
                <dd>
                  {open ? (
                    <GrowingText className="ipm-area" value={m.doneWhen.join('\n')} onChange={(v) => onEdit(i, { doneWhen: lines(v) })} onSubmit={() => setEditing(null)} placeholder="One test a line" label="Done when" />
                  ) : (
                    <ul>
                      {m.doneWhen.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </dd>
                {m.readings.length > 0 && (
                  <>
                    <dt>Read</dt>
                    <dd>
                      <ul>
                        {m.readings.map((r, k) => (
                          <li key={k} className="ipm-reading">
                            {r.title}
                            {open && (
                              <button onClick={() => onEdit(i, { readings: m.readings.filter((_, j) => j !== k) })} aria-label="Remove the reading">
                                <Icon name="x" size={10} />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </li>
        )
      })}
      <li className="ipm-add">
        <button
          className="ipf-link quiet"
          onClick={() => {
            const id = `m${Date.now().toString(36)}`
            onChange({ ...plan, milestones: [...plan.milestones, { id, title: 'Another milestone', build: '', components: [], lessons: [], doneWhen: ['it works on one example'], readings: [], hours: 4, recall: [], status: 'todo' }] })
            setEditing(id)
          }}
        >
          + Add a milestone
        </button>
      </li>
    </ol>
  )
}

function FilesTab({ files, tests, plan }: { files: { path: string; content: string }[]; tests: string[]; plan: ProjectPlan }) {
  const [sel, setSel] = useState(tests[0] ?? files[0]?.path ?? '')
  const file = files.find((f) => f.path === sel)
  return (
    <div className="ip-files">
      <ul className="ip-file-list">
        {files.map((f) => (
          <li key={f.path}>
            <button className={f.path === sel ? 'on' : ''} onClick={() => setSel(f.path)}>
              <Icon name={tests.includes(f.path) ? 'flask' : 'note'} size={12} />
              <span>{f.path}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="ip-file-view">
        <p className="ip-hint">
          {tests.includes(sel)
            ? `Fails until you build milestone 1: ${plan.milestones[0]?.title ?? ''}.`
            : sel === 'README.md'
              ? 'The plan, kept in the project.'
              : plan.by === 'gemma' || plan.by === 'manual'
                ? 'A starting point: no code is written for you.'
                : 'Structure and signatures; the bodies are yours to write.'}
        </p>
        <pre className="ip-code">{file?.content || ' '}</pre>
      </div>
    </div>
  )
}
