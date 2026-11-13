import { useEffect, useMemo, useRef, useState } from 'react'
import { DEPTHS, IDEA_LANGUAGES, languageLabel, prereqCounts, type ClarifyQuestion, type IdeaDepth, type IdeaLanguage, type IdeaSuggestion, type IdeaTemplateCard, type LadderView, type PlanMilestone, type ProjectPlan } from '@shared/ideaProject'
import { tierLabel } from '@shared/ideaLadder'
import { scaffoldFiles, testFilesOf } from '@shared/ideaScaffold'
import { Icon } from '../Icon'
import { cleanError, PlanMap, PrereqChip, PrereqLegend } from './PlanParts'
import '../../styles/ideas.css'

type Stage = 'idea' | 'questions' | 'drafting' | 'review' | 'creating' | 'made'
type Tab = 'map' | 'plan' | 'files'
type Made = Awaited<ReturnType<typeof window.tide.ideas.create>>

const BY: Record<ProjectPlan['by'], string> = { claude: 'Planned by Claude', gemma: 'Planned by Gemma on this Mac', template: 'From a starting map', manual: 'Written by you' }
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const words = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

/**
 * New project from an idea: say what you want to build, answer two or three questions, and Tide
 * maps it out, plans the milestones and writes the starting files. Everything is shown here to
 * read and edit before anything is made (shared/ideaProject, main/ideaProjects).
 */
export function IdeaSheet({ onClose, onOpen, onNotebook, initialIdea = '', initialSeed = null }: { onClose(): void; onOpen(made: Made): void; onNotebook?(notebook: string): void; initialIdea?: string; initialSeed?: string | null }) {
  const [stage, setStage] = useState<Stage>('idea')
  const [idea, setIdea] = useState(initialIdea)
  const [secret, setSecret] = useState(false)
  const [templates, setTemplates] = useState<IdeaTemplateCard[]>([])
  const [matched, setMatched] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [seed, setSeed] = useState<string | null>(initialSeed)
  const [ladder, setLadder] = useState<LadderView | null>(null)
  const [claudeIdeas, setClaudeIdeas] = useState<IdeaSuggestion[]>([])
  const [area, setArea] = useState<string | null>(null)
  const [route, setRoute] = useState<{ who: 'claude' | 'gemma' | 'none'; label: string } | null>(null)
  const [questions, setQuestions] = useState<ClarifyQuestion[]>([])
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
  const ideaBox = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    window.tide.ideas.templates().then(setTemplates).catch(() => {})
    window.tide.ideas
      .ladder()
      .then((l) => {
        setLadder(l)
        const s0 = initialSeed && l.steps.find((x) => x.id === initialSeed)
        if (s0) setIdea((v) => v || `I want to build ${s0.title.charAt(0).toLowerCase()}${s0.title.slice(1)}: ${s0.about.charAt(0).toLowerCase()}${s0.about.slice(1)}`)
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
    window.tide.ideas.route(secret).then(setRoute).catch(() => setRoute({ who: 'none', label: 'No model' }))
  }, [secret])
  useEffect(() => {
    const t = setTimeout(() => window.tide.ideas.matchTemplate(idea).then(setMatched).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [idea])
  // The drafting clock
  useEffect(() => {
    if (stage !== 'drafting' && stage !== 'creating') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [stage])

  const fail = (e: unknown) => setError(cleanError(e))

  const ask = async () => {
    if (!idea.trim()) return ideaBox.current?.focus()
    setError('')
    setBusy(true)
    try {
      const r = await window.tide.ideas.questions(idea, secret)
      // The language and depth questions have their own controls
      const own = r.questions.filter((q) => !/\blanguage\b|\bdeep\b|\bdepth\b/i.test(q.question))
      setQuestions(own.length ? own : r.questions.slice(0, 1))
      const langQ = r.questions.find((q) => /\blanguage\b/i.test(q.question))
      const guess = IDEA_LANGUAGES.find((l) => langQ?.options[0]?.toLowerCase().includes(l.label.toLowerCase()))?.id
      if (guess) setLanguage(guess)
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
      const list = questions.filter((q) => answers[q.id]?.trim()).map((q) => ({ question: q.question, answer: answers[q.id].trim() }))
      const r = await window.tide.ideas.draft({ idea: idea.trim() || (templates.find((t) => t.id === template)?.about ?? ''), answers: [...list, { question: 'Language?', answer: languageLabel(language) }, { question: 'How deep?', answer: DEPTHS.find((d) => d.id === depth)!.label }], language, depth, private: secret, template: template ?? null, seed: source === 'blank' ? null : fromSeed, source })
      setPlan(r.plan)
      setProblems(r.problems)
      setNote(r.note ?? '')
      setTab('map')
      setStage('review')
    } catch (e) {
      fail(e)
      setStage(questions.length ? 'questions' : 'idea')
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
      const r = await window.tide.ideas.create(checked.plan)
      setMade(r)
      setStage('made')
    } catch (e) {
      fail(e)
      setStage('review')
    }
  }

  const edit = (patch: Partial<ProjectPlan>) => setPlan((p) => (p ? { ...p, ...patch } : p))
  const editMilestone = (i: number, patch: Partial<PlanMilestone>) => setPlan((p) => (p ? { ...p, milestones: p.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) } : p))
  const moveMilestone = (i: number, by: -1 | 1) =>
    setPlan((p) => {
      if (!p) return p
      const ms = [...p.milestones]
      const j = i + by
      if (j < 0 || j >= ms.length) return p
      ;[ms[i], ms[j]] = [ms[j], ms[i]]
      // The first not done is the active one
      const first = ms.findIndex((m) => m.status !== 'done')
      return { ...p, milestones: ms.map((m, k) => (m.status === 'done' ? m : { ...m, status: k === first ? 'active' : 'todo' })) }
    })

  const tpl = seed ?? picked ?? matched
  const pickSeed = (id: string) => {
    if (seed === id) return setSeed(null)
    const x = ladder?.steps.find((y) => y.id === id)
    setSeed(id)
    setPicked(null)
    if (x && (!idea.trim() || ladder?.steps.some((y) => idea.includes(y.title.toLowerCase().slice(1, 12))))) setIdea(`I want to build ${x.title.charAt(0).toLowerCase()}${x.title.slice(1)}: ${x.about.charAt(0).toLowerCase()}${x.about.slice(1)}`)
  }
  const elapsed = Math.round((Date.now() - started) / 1000)
  const counts = plan ? prereqCounts(plan) : null
  const files = useMemo(() => (plan ? scaffoldFiles(plan) : []), [plan])
  const testFiles = useMemo(() => testFilesOf(files), [files])
  const hours = plan?.milestones.reduce((n, m) => n + m.hours, 0) ?? 0
  const wide = stage === 'review' || stage === 'creating'

  return (
    <div className="ip-scrim no-drag" onMouseDown={() => stage !== 'drafting' && stage !== 'creating' && onClose()}>
      <div className={`ip-sheet${wide ? ' wide' : ''}`} role="dialog" aria-label="New project from an idea" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && stage !== 'drafting' && stage !== 'creating' && onClose()}>
        <div className="ip-sheet-head">
          <p className="ip-sheet-title">{stage === 'made' ? 'Ready to build' : 'New project from an idea'}</p>
          <ol className="ip-stages" aria-label="Steps">
            {(['Idea', 'Questions', 'Plan', 'Made'] as const).map((s, i) => {
              const at = { idea: 0, questions: 1, drafting: 2, review: 2, creating: 2, made: 3 }[stage]
              return (
                <li key={s} className={i === at ? 'on' : i < at ? 'done' : ''}>
                  {s}
                </li>
              )
            })}
          </ol>
          <button className="icon-btn small" onClick={onClose} disabled={stage === 'drafting' || stage === 'creating'} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>

        {stage === 'idea' && (
          <>
            <label className="ip-field">
              <span>What do you want to build?</span>
              <textarea
                ref={ideaBox}
                autoFocus
                rows={3}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void ask()}
                placeholder="e.g. A payment rail: a ledger, ISO 20022 messages, idempotent payments and settlement"
              />
            </label>
            {(ladder?.suggestions.length || claudeIdeas.length) ? (
              <div className="ip-suggest">
                <span className="ip-label">Suggested next, from what you’ve been studying</span>
                <div className="ip-suggest-list">
                  {ladder?.suggestions.map((x) => (
                    <button key={x.seed} className={`ip-start${seed === x.seed ? ' on' : ''}`} onClick={() => pickSeed(x.seed)} aria-pressed={seed === x.seed} title={x.why}>
                      <span className="ip-tierline">
                        Tier {x.tier} · {tierLabel(x.tier)} · mapped out
                      </span>
                      <strong>{x.title}</strong>
                      <span>{x.why}</span>
                    </button>
                  ))}
                  {claudeIdeas.map((x) => (
                    <button key={x.title} className="ip-start" onClick={() => (setIdea(x.idea), setSeed(null), setPicked(null))} title={x.why}>
                      <span className="ip-tierline">
                        Tier {x.tier} · {tierLabel(x.tier)} · Claude’s idea
                      </span>
                      <strong>{x.title}</strong>
                      <span>{x.why}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {ladder && (
              <div className="ip-starts">
                <span className="ip-label">Or climb the ladder: components, services, systems, then flagships over weeks</span>
                <div className="ip-areas" role="tablist">
                  {ladder.areas.map((a) => (
                    <button key={a.id} role="tab" aria-selected={area === a.id} className={area === a.id ? 'on' : ''} onClick={() => setArea(a.id)} title={a.why}>
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="ip-tiers">
                  {([1, 2, 3, 4] as const).map((t) => {
                    const steps = ladder.steps.filter((x) => x.tier === t && area && x.areas.includes(area))
                    const open = (ladder.areas.find((a) => a.id === area)?.tier ?? 1) >= t
                    return steps.length ? (
                      <div key={t} className="ip-tier-row">
                        <span className="ip-label">
                          {tierLabel(t)}s{open ? '' : ' · locked'}
                        </span>
                        <div className="ip-start-list">
                          {steps.map((x) => (
                            <button key={x.id} className={`ip-start${seed === x.id ? ' on' : ''}${open ? '' : ' locked'}`} onClick={() => pickSeed(x.id)} aria-pressed={seed === x.id} title={open ? x.about : `${x.about}. ${ladder.areas.find((a) => a.id === area)?.next ?? ''}`}>
                              <strong>
                                {x.title}
                                {x.started ? ' · started' : ''}
                              </strong>
                              <span>{x.about}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null
                  })}
                </div>
                {area && <span className="ip-hint">{ladder.areas.find((a) => a.id === area)?.why} {ladder.areas.find((a) => a.id === area)?.next}</span>}
              </div>
            )}
            <label className="ip-check">
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
              <span>
                Private: planned and mentored by Gemma on this Mac; Claude never sees it
              </span>
            </label>
            {error && <p className="ip-error">{error}</p>}
            <div className="ip-actions">
              <span className="ip-route">
                <Icon name={route?.who === 'claude' ? 'claude' : 'laptop'} size={12} />
                {route ? (route.who === 'claude' ? `${route.label} asks and plans` : `${route.label}: a simpler plan, no starting code`) : '…'}
              </span>
              <span className="ip-gap" />
              <button className="btn small ghost" onClick={() => void draft('blank')} disabled={!idea.trim()} title="Write the plan yourself, with no model">
                Blank plan
              </button>
              {tpl && (
                <button className="btn small" onClick={() => void draft('template', seed ? null : tpl)} title="The starting map as it is, with no model">
                  Use the map as it is
                </button>
              )}
              <button className="btn small primary" onClick={() => void ask()} disabled={busy || !idea.trim()}>
                {busy ? 'Thinking…' : 'Continue'}
              </button>
            </div>
          </>
        )}

        {stage === 'questions' && (
          <>
            <p className="ip-idea-quote">{idea}</p>
            <div className="ip-questions">
              {questions.map((q) => (
                <div key={q.id} className="ip-question">
                  <span className="ip-label">{q.question}</span>
                  <div className="ip-options">
                    {q.options.map((o) => (
                      <button key={o} className={`ip-option${answers[q.id] === o ? ' on' : ''}`} onClick={() => setAnswers((a) => ({ ...a, [q.id]: a[q.id] === o ? '' : o }))} aria-pressed={answers[q.id] === o}>
                        {o}
                      </button>
                    ))}
                    <input className="ip-option-own" value={q.options.includes(answers[q.id] ?? '') ? '' : (answers[q.id] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder="Or say…" aria-label={`Your own answer: ${q.question}`} />
                  </div>
                </div>
              ))}
              <div className="ip-question">
                <span className="ip-label">Language</span>
                <div className="ip-seg">
                  {IDEA_LANGUAGES.map((l) => (
                    <button key={l.id} className={language === l.id ? 'on' : ''} onClick={() => setLanguage(l.id)}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ip-question">
                <span className="ip-label">How deep</span>
                <div className="ip-seg">
                  {DEPTHS.map((d) => (
                    <button key={d.id} className={depth === d.id ? 'on' : ''} onClick={() => setDepth(d.id)} title={d.about}>
                      {d.label}
                    </button>
                  ))}
                </div>
                <span className="ip-hint">{DEPTHS.find((d) => d.id === depth)!.about}</span>
              </div>
            </div>
            {error && <p className="ip-error">{error}</p>}
            <div className="ip-actions">
              <button className="btn small ghost" onClick={() => setStage('idea')}>
                Back
              </button>
              <span className="ip-gap" />
              <span className="ip-route">{route?.who === 'claude' ? `${route.label} writes the plan, in a minute or two` : 'Gemma writes a simpler plan on this Mac'}</span>
              <button className="btn small primary" onClick={() => void draft('model', seed ? null : tpl)}>
                Draft the plan
              </button>
            </div>
          </>
        )}

        {(stage === 'drafting' || stage === 'creating') && !plan && (
          <div className="ip-working">
            <span className="spinner" />
            <div>
              <p className="ip-working-title">{route?.who === 'claude' ? `${route.label} is mapping the project` : 'Planning the project'}</p>
              <p className="ip-hint">The components and how they connect, what each needs you to know, the milestones in build order, and failing tests for the first one. {elapsed > 2 ? `${elapsed} s` : ''}</p>
            </div>
          </div>
        )}

        {(stage === 'review' || (stage === 'creating' && plan)) && plan && counts && (
          <>
            <div className="ip-review-head">
              <input className="ip-name" value={plan.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Project name" spellCheck={false} />
              <p className="ip-meta">
                {languageLabel(plan.language)} · {DEPTHS.find((d) => d.id === plan.depth)?.label} · {plan.milestones.length} milestones · about {hours} hours · {BY[plan.by]}
                {plan.private && ' · Private'}
              </p>
              <textarea className="ip-summary" rows={3} value={plan.summary} onChange={(e) => edit({ summary: e.target.value })} placeholder="What it is, and what building it teaches" aria-label="Summary" />
              {note && <p className="ip-note">{note}</p>}
            </div>
            <div className="ip-tabs" role="tablist">
              {(
                [
                  ['map', 'Map'],
                  ['plan', `Milestones (${plan.milestones.length})`],
                  ['files', `Starting files (${files.length})`]
                ] as const
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
              <span className="ip-gap" />
              <PrereqLegend counts={counts} />
            </div>
            <div className="ip-review-body">
              {tab === 'map' && <MapTab plan={plan} onChange={setPlan} />}
              {tab === 'plan' && <MilestonesTab plan={plan} onEdit={editMilestone} onMove={moveMilestone} onChange={setPlan} />}
              {tab === 'files' && <FilesTab files={files} tests={testFiles} plan={plan} />}
            </div>
            {problems.length > 0 && (
              <ul className="ip-problems">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {error && <p className="ip-error">{error}</p>}
            <div className="ip-actions">
              <button className="btn small ghost" onClick={() => setStage(questions.length ? 'questions' : 'idea')} disabled={stage === 'creating'}>
                Back
              </button>
              <button className="btn small ghost" onClick={() => void check()} disabled={busy || stage === 'creating'} title="Mark the prerequisites again and find readings, after editing">
                {busy ? 'Checking…' : 'Check again'}
              </button>
              <span className="ip-gap" />
              <span className="ip-route">A notebook, the project folder in Code with git, the roadmap and the coach</span>
              <button className="btn small primary" onClick={() => void create()} disabled={stage === 'creating' || !plan.name.trim()}>
                {stage === 'creating' ? 'Making it…' : 'Create project'}
              </button>
            </div>
          </>
        )}

        {stage === 'made' && made && plan && (
          <>
            <ul className="ip-made">
              <li>
                <Icon name="check" size={13} />
                <span>
                  The project folder <code>{made.root.split('/').slice(-2).join('/')}</code>, a git repository with its first commit
                </span>
              </li>
              <li>
                <Icon name="check" size={13} />
                <span>
                  {made.tests?.held
                    ? `Milestone 1’s failing tests (${testFiles.join(', ')}) unlock when you pass its ready check: then you make them pass`
                    : `The tests for milestone 1 are in ${testFiles.join(', ')}`}
                </span>
              </li>
              <li>
                <Icon name="check" size={13} />
                <span>The plan, its roadmap and the mentor’s memory, in the notebook “{made.notebook}”</span>
              </li>
              <li className={made.coach === 'full' ? 'warn' : ''}>
                <Icon name={made.coach === 'full' ? 'dot' : 'check'} size={13} />
                <span>{made.coach === 'full' ? 'Your weekly coach already has six subjects; add this one from the Coach when there’s room' : 'On your weekly coach, and in What you know as its milestones are learned'}</span>
              </li>
            </ul>
            <div className="ip-actions">
              {onNotebook && (
                <button className="btn small ghost" onClick={() => onNotebook(made.notebook)}>
                  Open the notebook
                </button>
              )}
              <span className="ip-gap" />
              <button className="btn small primary" autoFocus onClick={() => onOpen(made)}>
                Open the project
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MapTab({ plan, onChange }: { plan: ProjectPlan; onChange(p: ProjectPlan): void }) {
  const set = (i: number, patch: Partial<ProjectPlan['components'][number]>) => onChange({ ...plan, components: plan.components.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
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
            <button className="icon-btn small" onClick={() => onChange({ ...plan, components: plan.components.filter((_, j) => j !== i), links: plan.links.filter((l) => l.from !== c.id && l.to !== c.id), milestones: plan.milestones.map((m) => ({ ...m, components: m.components.filter((x) => x !== c.id) })) })} aria-label={`Remove ${c.name}`} title="Remove">
              <Icon name="x" size={11} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MilestonesTab({ plan, onEdit, onMove, onChange }: { plan: ProjectPlan; onEdit(i: number, patch: Partial<PlanMilestone>): void; onMove(i: number, by: -1 | 1): void; onChange(p: ProjectPlan): void }) {
  const comp = (id: string) => plan.components.find((c) => c.id === id)?.name ?? id
  return (
    <ol className="ip-milestones">
      {plan.milestones.map((m, i) => (
        <li key={m.id} className="ip-ms">
          <div className="ip-ms-head">
            <span className="ip-ms-n">{i + 1}</span>
            <input className="ip-inline strong" value={m.title} onChange={(e) => onEdit(i, { title: e.target.value })} aria-label="Milestone title" spellCheck={false} />
            <label className="ip-hours" title="Estimate">
              <input type="number" min={1} max={60} value={m.hours} onChange={(e) => onEdit(i, { hours: Math.max(1, Number(e.target.value) || 1) })} aria-label="Hours" />h
            </label>
            <button className="icon-btn small" onClick={() => onMove(i, -1)} disabled={i === 0} aria-label="Earlier" title="Earlier">
              <Icon name="arrowUp" size={11} />
            </button>
            <button className="icon-btn small" onClick={() => onMove(i, 1)} disabled={i === plan.milestones.length - 1} aria-label="Later" title="Later">
              <Icon name="arrowDown" size={11} />
            </button>
            <button className="icon-btn small" onClick={() => onChange({ ...plan, milestones: plan.milestones.filter((_, j) => j !== i) })} disabled={plan.milestones.length <= 2} aria-label="Remove" title="Remove">
              <Icon name="x" size={11} />
            </button>
          </div>
          <textarea className="ip-inline-area" rows={2} value={m.build} onChange={(e) => onEdit(i, { build: e.target.value })} placeholder="What you’ll build" aria-label="What you’ll build" />
          {m.components.length > 0 && <p className="ip-ms-comps">Builds {m.components.map(comp).join(', ')}</p>}
          <div className="ip-ms-grid">
            <label>
              <span className="ip-label">Learn first</span>
              <input className="ip-inline" value={m.lessons.map((l) => l.concept).join(', ')} onChange={(e) => onEdit(i, { lessons: words(e.target.value).map((concept) => m.lessons.find((l) => l.concept === concept) ?? { concept, why: '' }) })} placeholder="Concepts, separated by commas" />
            </label>
            <label>
              <span className="ip-label">Done when (one test a line)</span>
              <textarea className="ip-inline-area" rows={Math.max(2, m.doneWhen.length)} value={m.doneWhen.join('\n')} onChange={(e) => onEdit(i, { doneWhen: lines(e.target.value) })} />
            </label>
          </div>
          {m.readings.length > 0 && (
            <ul className="ip-readings">
              {m.readings.map((r, k) => (
                <li key={k}>
                  <Icon name={r.kind === 'course' || r.kind === 'lesson' ? 'course' : r.kind === 'web' || r.kind === 'spec' ? 'globe' : 'book'} size={12} />
                  <span className="ip-reading-title">{r.title}</span>
                  {r.why && <span className="ip-hint">{r.why}</span>}
                  <button className="icon-btn small" onClick={() => onEdit(i, { readings: m.readings.filter((_, j) => j !== k) })} aria-label="Remove the reading">
                    <Icon name="x" size={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
      <li>
        <button className="link-btn" onClick={() => onChange({ ...plan, milestones: [...plan.milestones, { id: `m${Date.now().toString(36)}`, title: 'Another milestone', build: '', components: [], lessons: [], doneWhen: ['it works on one example'], readings: [], hours: 4, recall: [], status: 'todo' }] })}>
          <Icon name="plus" size={12} /> Add a milestone
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
