import { useEffect, useMemo, useState } from 'react'
import type { PairMode, TestRun } from '@shared/ide'
import type { WarmupSet } from '@shared/warmup'
import { canFinish, currentMilestone, gateGaps, languageLabel, MEMORY_SECTIONS, milestonePrereqs, progressOf, SESSION_STEPS, type ScoreView, type ProjectMemory, type ProjectPlan, type SessionStep } from '@shared/ideaProject'
import { useApp } from '../../state'
import { renderMarkdown } from '../../lib/markdown'
import { Icon, type IconName } from '../Icon'
import { WarmUp } from '../WarmUp'
import { cleanError, PlanMap, PrereqChip } from './PlanParts'
import { Celebrate } from './Celebrate'
import { areaLabel, tierLabel } from '@shared/ideaLadder'
import type { Celebration } from '@shared/ideaScore'
import '../../styles/ideas.css'

const STEP_ICON: Record<SessionStep, IconName> = { warmup: 'cards', lesson: 'tutor', ready: 'quiz', build: 'compose', tests: 'flask', review: 'diff', bughunt: 'bug', debrief: 'summary' }
const ENV = { notePath: '', filesByName: new Map<string, string>() }

/**
 * A planned project's home in the IDE (shared/ideaProject): the current milestone, a map of the
 * milestones, and its session, worked through step by step with the pieces Tide already has (the
 * warm-up, a lesson, Claude building with you, the tests, a review, a bug hunt, recall). Beside it
 * the project map and the mentor's memory, and a review of the whole project on request.
 */
export function ProjectHome({
  plan,
  claude,
  onPlan,
  onPair,
  onHunt,
  onOpenFile,
  onRunTests,
  onEditor
}: {
  plan: ProjectPlan
  /** Claude can pair on this project (it is ready) */
  claude: boolean
  onPlan(p: ProjectPlan): void
  onPair(mode: PairMode, text: string): void
  onHunt(): void
  onOpenFile(path: string): void
  onRunTests(): Promise<TestRun | null>
  onEditor(): void
}) {
  const app = useApp()
  const nb = plan.notebook!
  const prog = progressOf(plan)
  const current = currentMilestone(plan)
  const [sel, setSel] = useState<string | null>(current?.id ?? null)
  const m = plan.milestones.find((x) => x.id === sel) ?? current ?? plan.milestones[plan.milestones.length - 1]
  const index = plan.milestones.indexOf(m)
  const [memory, setMemory] = useState<{ path: string; memory: ProjectMemory } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tests, setTests] = useState<{ passed: number; total: number; failing: string[] } | null>(null)
  const [warm, setWarm] = useState<WarmupSet | null>(null)
  const [review, setReview] = useState<string | null>(null)
  const [score, setScore] = useState<ScoreView | null>(null)
  const [party, setParty] = useState<Celebration | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [debrief, setDebrief] = useState<string | null>(null)
  useEffect(() => {
    window.tide.ideas
      .score()
      .then(setScore)
      .catch(() => {})
  }, [plan])
  useEffect(() => {
    setAnswers(m.gate?.answers ?? {})
    setDebrief(null)
    if (m.debrief)
      window.tide.vault
        .read(m.debrief)
        .then(setDebrief)
        .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, m.debrief])

  useEffect(() => setSel(current?.id ?? null), [current?.id])
  const loadMemory = () =>
    window.tide.ideas
      .memory(nb)
      .then(setMemory)
      .catch(() => {})
  useEffect(() => {
    void loadMemory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nb, plan])

  const toast = (e: unknown) => app.toast(cleanError(e), { tone: 'error' })
  const act = async (label: string, fn: () => Promise<ProjectPlan | void>) => {
    setBusy(label)
    try {
      const next = await fn()
      if (next) onPlan(next)
    } catch (e) {
      toast(e)
    } finally {
      setBusy(null)
    }
  }
  const step = (s: SessionStep, outcome: 'done' | 'skipped' = 'done', t?: { passed: number; total: number }) => act(s, () => window.tide.ideas.step(nb, m.id, s, outcome, t))

  const prereqs = useMemo(() => milestonePrereqs(plan, m), [plan, m])
  const highlight = useMemo(() => m.components, [m])
  const session = m.session
  const doneWhen = m.doneWhen.join('; ')

  const runTests = async () => {
    setBusy('tests')
    try {
      const r = await onRunTests()
      if (!r) return
      const failing = r.outcomes.filter((o) => o.status === 'fail' || o.status === 'error').map((o) => o.id)
      const t = { passed: r.outcomes.length - failing.length, total: r.outcomes.length, failing }
      setTests(t)
      if (r.error && !r.outcomes.length) app.toast(r.error, { tone: 'error' })
      else if (t.total && !failing.length) onPlan(await window.tide.ideas.step(nb, m.id, 'tests', 'done', { passed: t.passed, total: t.total }))
    } catch (e) {
      toast(e)
    } finally {
      setBusy(null)
    }
  }

  const warmUp = async () => {
    setBusy('warmup')
    try {
      const topic = [...m.lessons.map((l) => l.concept), ...prereqs.map((p) => p.name)].join(', ') || m.title
      const set = await window.tide.warmup.for(topic, nb)
      if (set.cards.length) setWarm(set)
      else {
        app.toast('Nothing you’ve learned before leads into this one: no warm-up needed.')
        onPlan(await window.tide.ideas.step(nb, m.id, 'warmup', 'done'))
      }
    } catch (e) {
      toast(e)
    } finally {
      setBusy(null)
    }
  }

  const lesson = (concept: string, warmedUp = true) => {
    app.setView({ kind: 'session', mode: 'teach', scope: { kind: 'folder', path: nb }, topic: concept, options: { length: 6, project: { name: plan.name, kind: 'build', milestone: m.title, warmedUp }, ...(plan.root ? { codeRoot: plan.root } : {}) }, nonce: Date.now() })
  }

  const mentorReview = async (end = false) => {
    const what = end ? `This is the end of milestone ${index + 1} (${m.title}).` : ''
    if (claude) return onPair('mentor', `Review the whole project like a senior engineer. ${what} Run the tests, comment on the lines that need it, propose fixes as diffs where a fix teaches little, and update the project memory.`.replace(/\s+/g, ' ').trim())
    setBusy('review')
    try {
      const r = await window.tide.ideas.reviewLocal(nb)
      setReview(r.review)
      void loadMemory()
    } catch (e) {
      toast(e)
    } finally {
      setBusy(null)
    }
  }

  const stepAction = (s: SessionStep): { label: string; run(): void; secondary?: { label: string; run(): void } } | null => {
    switch (s) {
      case 'warmup':
        return { label: 'Warm up', run: () => void warmUp() }
      case 'lesson':
        return m.lessons.length ? { label: `Lesson: ${m.lessons[0].concept}`, run: () => void step('lesson').then(() => lesson(m.lessons[0].concept)) } : null
      case 'ready':
        return null
      case 'build':
        return claude
          ? { label: plan.claudeWrites ? 'Build with Claude' : 'Write it, with Claude tutoring', run: () => onPair(plan.claudeWrites ? 'build' : 'tutor', `I'm starting milestone ${index + 1}: ${m.title}. ${m.build} It's done when: ${doneWhen}. ${plan.claudeWrites ? '' : 'I write the code; ask me how I plan to start.'}`), secondary: { label: 'Open the editor', run: onEditor } }
          : { label: 'Open the editor', run: onEditor }
      case 'tests':
        return { label: busy === 'tests' ? 'Running…' : 'Run the tests', run: () => void runTests() }
      case 'review':
        return claude ? { label: 'Review my changes', run: () => onPair('review', `Review my changes for milestone ${index + 1} (${m.title}). It's done when: ${doneWhen}.`) } : { label: 'Review on this Mac', run: () => void mentorReview() }
      case 'bughunt':
        return claude ? { label: 'Plant a bug', run: onHunt } : null
      case 'debrief':
        return {
          label: busy === 'debrief' ? 'Writing…' : 'Write the debrief',
          run: () =>
            void act('debrief', async () => {
              const r = await window.tide.ideas.debrief(nb, m.id)
              setDebrief(r.text)
              if (r.celebrate) setParty(r.celebrate)
              return r.plan
            })
        }
    }
  }

  return (
    <div className="ip-home">
      <div className="ip-home-inner">
        <header className="ip-home-head">
          <div>
            <h1>{plan.name}</h1>
            <p className="ip-meta">
              {plan.tier ? `${tierLabel(plan.tier)}${plan.area ? ` in ${areaLabel(plan.area).toLowerCase()}` : ''} · ` : ''}
              {languageLabel(plan.language)} · {prog.done} of {prog.total} milestones · about {prog.hoursLeft} hours left
            </p>
            {score && (
              <p className="ip-score" title={score.next ? `${score.next.at - score.points} points to ${score.next.title}` : 'The top level'}>
                <b>{score.title}</b>
                <span className="ip-level-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(score.progress * 100)}%` }} />
                </span>
                {score.points} points{score.streak ? ` · ${score.streak}-day streak` : ''}
              </p>
            )}
          </div>
          <span className="ip-gap" />
          <button className="btn small ghost" onClick={() => app.openPath(`${nb}/${plan.name} plan.md`)}>
            <Icon name="note" size={13} /> Plan
          </button>
          <button className="btn small ghost" onClick={onEditor}>
            <Icon name="files" size={13} /> Editor
          </button>
          <button className="btn small" onClick={() => void mentorReview()} disabled={busy === 'review'} title={claude ? 'Claude reviews the whole project in the inspector' : 'Gemma reviews the code and the tests on this Mac'}>
            <Icon name={claude ? 'claude' : 'laptop'} size={13} /> {busy === 'review' ? 'Reviewing…' : 'Mentor review'}
          </button>
        </header>

        <ol className="ip-track" aria-label="Milestones">
          {plan.milestones.map((x, i) => (
            <li key={x.id} className={`${x.status}${x.id === m.id ? ' sel' : ''}`}>
              <button onClick={() => setSel(x.id)} title={x.title} aria-current={x.status === 'active' ? 'step' : undefined}>
                <span className="ip-track-dot">{x.status === 'done' ? <Icon name="check" size={10} /> : i + 1}</span>
                <span className="ip-track-label">{x.title}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="ip-home-cols">
          <section className="ip-home-main" aria-label="Milestone">
            {m.status === 'active' && (
              <div className="ip-card ip-session">
                <div className="ip-session-head">
                  <h3>Session</h3>
                  <span className="ip-gap" />
                  {!session && (
                    <button className="btn small primary" onClick={() => void act('start', () => window.tide.ideas.startSession(nb, m.id))} disabled={!!busy}>
                      <Icon name="play" size={12} /> Start session
                    </button>
                  )}
                </div>
                {!session ? (
                  <p className="ip-hint">A warm-up on what this builds on, a short lesson, a ready check that unlocks the tests, building it yourself{claude ? ' with Claude tutoring' : ''}, the tests turning green, a review of your diff, {claude ? 'a bug hunt in your own code if you like, ' : ''}and a debrief with recall cards.</p>
                ) : warm ? (
                  <WarmUp
                    set={warm}
                    onDone={() => {
                      setWarm(null)
                      void step('warmup')
                    }}
                  />
                ) : (
                  <ol className="ip-steps">
                    {SESSION_STEPS.map((s) => {
                      const done = session.done.includes(s.id)
                      const skipped = session.skipped.includes(s.id)
                      const now = session.step === s.id
                      const a = now ? stepAction(s.id) : null
                      return (
                        <li key={s.id} className={`${done ? 'done' : skipped ? 'skipped' : now ? 'now' : ''}`}>
                          <span className="ip-step-mark" aria-hidden="true">
                            {done ? <Icon name="check" size={10} /> : <Icon name={STEP_ICON[s.id]} size={11} />}
                          </span>
                          <div className="ip-step-text">
                            <span className="ip-step-label">
                              {s.label}
                              {s.optional && <span className="ip-hint"> · optional</span>}
                              {skipped && <span className="ip-hint"> · skipped</span>}
                            </span>
                            {now && (
                              <span className="ip-hint">
                                {s.id === 'tests' && tests ? (tests.failing.length ? `${tests.passed} of ${tests.total} pass. Failing: ${tests.failing.slice(0, 3).map((f) => f.split('::').pop()).join(', ')}${tests.failing.length > 3 ? '…' : ''}` : `All ${tests.total} pass.`) : s.about}
                              </span>
                            )}
                          </div>
                          {now && (
                            <div className="ip-step-actions">
                              {a && (
                                <button className="btn small primary" onClick={a.run} disabled={!!busy}>
                                  {busy === s.id ? 'Working…' : a.label}
                                </button>
                              )}
                              {a?.secondary && (
                                <button className="btn small ghost" onClick={a.secondary.run}>
                                  {a.secondary.label}
                                </button>
                              )}
                              {s.id !== 'tests' && s.id !== 'ready' && s.id !== 'debrief' && s.id !== 'warmup' && (
                                <button className="btn small ghost" onClick={() => void step(s.id)} disabled={!!busy}>
                                  Done
                                </button>
                              )}
                              {s.id !== 'tests' && s.id !== 'ready' && s.id !== 'debrief' && (
                                <button className="link-btn small" onClick={() => void step(s.id, 'skipped')} disabled={!!busy}>
                                  Skip
                                </button>
                              )}
                            </div>
                          )}
                          {now && s.id === 'ready' && (
                            <div className="ip-ready" style={{ gridColumn: '2 / -1' }}>
                              <ReadyCheck
                                plan={plan}
                                mIndex={index}
                                answers={answers}
                                setAnswers={setAnswers}
                                busy={busy}
                                onLoad={() => void act('ready', () => window.tide.ideas.readyQuestions(nb, m.id))}
                                onMark={() =>
                                  void act('ready', async () => {
                                    const r = await window.tide.ideas.markReady(nb, m.id, answers)
                                    if (r.celebrate) setParty(r.celebrate)
                                    else if (r.plan.milestones[index].gate?.ready) app.toast('Ready. The milestone’s tests are in the project now.')
                                    return r.plan
                                  })
                                }
                                onLesson={(c) => lesson(c, false)}
                              />
                            </div>
                          )}
                          {done && s.id === 'debrief' && debrief && (
                            <div className="ip-debrief prose compact" style={{ gridColumn: '2 / -1' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(debrief.replace(/^# .*\n/, ''), ENV) }} />
                          )}
                          {!now && skipped && (
                            <button className="link-btn small" onClick={() => void step(s.id)} title="Do it now">
                              Do it
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {claude && (
                  <label className="ip-check" style={{ marginTop: 10 }} title="Off: you write the code, and Claude asks, checks and hints. On: Claude may write code for you.">
                    <input type="checkbox" checked={!!plan.claudeWrites} onChange={(e) => void act('writes', () => window.tide.ideas.save({ ...plan, claudeWrites: e.target.checked }))} />
                    <span>Let Claude write code in this project (off: you write it, Claude tutors)</span>
                  </label>
                )}
                {canFinish(session ?? undefined) && (
                  <div className="ip-finish">
                    <span>Every step is done and the tests pass.</span>
                    <span className="ip-gap" />
                    <button
                      className="btn small primary"
                      onClick={() =>
                        void act('finish', async () => {
                          const r = await window.tide.ideas.finishWith(nb, m.id)
                          if (r.celebrate) setParty(r.celebrate)
                          app.toast(`Milestone ${index + 1} done.${claude ? ' Your mentor can review the whole project now.' : ''}`, claude ? { action: { label: 'Review it', run: () => void mentorReview(true) } } : undefined)
                          return r.plan
                        })
                      }
                    >
                      Mark milestone done
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="ip-card">
              <p className="ip-eyebrow">
                Milestone {index + 1}
                {m.status === 'active' ? ' · Now' : m.status === 'done' ? ` · Done${m.doneAt ? ` ${new Date(m.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}` : ' · Later'} · about {m.hours} h
                {m.gate && m.gate.results.length > 0 && (
                  <span className={`ip-chip${m.gate.ready ? ' on' : ''}`} style={{ marginLeft: 8 }}>
                    Ready check: {m.gate.passed} of {m.gate.total} passed
                  </span>
                )}
                {m.status !== 'done' && !m.testsUnlocked && <span className="ip-chip" style={{ marginLeft: 6 }}>Tests unlock after the ready check</span>}
                {!!m.hints && <span className="ip-chip" style={{ marginLeft: 6 }}>{m.hints} hint{m.hints === 1 ? '' : 's'} as code</span>}
              </p>
              <h2>{m.title}</h2>
              <p className="ip-build">{m.build}</p>

              {prereqs.length > 0 && (
                <div className="ip-row">
                  <span className="ip-label">Builds on</span>
                  <div className="ip-prereqs">
                    {prereqs.map((p) => (
                      <PrereqChip key={p.name} p={p} />
                    ))}
                  </div>
                </div>
              )}
              {m.lessons.length > 0 && (
                <div className="ip-row">
                  <span className="ip-label">Learn first</span>
                  <ul className="ip-lessons">
                    {m.lessons.map((l) => (
                      <li key={l.concept}>
                        <button className="ip-lesson" onClick={() => lesson(l.concept, false)} title="A short lesson, in this project’s terms">
                          <Icon name="tutor" size={12} />
                          <span>{l.concept}</span>
                        </button>
                        {l.why && <span className="ip-hint">{l.why}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="ip-row">
                <span className="ip-label">Done when</span>
                <ul className="ip-done-when">
                  {m.doneWhen.map((d) => (
                    <li key={d} className={m.status === 'done' || session?.done.includes('tests') ? 'pass' : ''}>
                      <span className="ip-tick" aria-hidden="true">{m.status === 'done' || session?.done.includes('tests') ? <Icon name="check" size={10} /> : null}</span>
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
              {m.readings.length > 0 && (
                <div className="ip-row">
                  <span className="ip-label">Read</span>
                  <ul className="ip-readings plain">
                    {m.readings.map((r, k) => (
                      <li key={k}>
                        <button
                          className="ip-reading"
                          onClick={() => (r.courseId ? app.setView({ kind: 'courses', id: r.courseId, ...(r.lessonPath ? { lesson: r.lessonPath } : {}) }) : r.url ? window.open(r.url, '_blank') : undefined)}
                          disabled={!r.courseId && !r.url}
                        >
                          <Icon name={r.kind === 'course' || r.kind === 'lesson' ? 'course' : r.url ? 'globe' : 'book'} size={12} />
                          <span>{r.title}</span>
                        </button>
                        {r.why && <span className="ip-hint">{r.why}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {m.status === 'done' && (
              <div className="ip-card ip-quiet">
                <span>Done. </span>
                <button className="link-btn" onClick={() => void act('reopen', () => window.tide.ideas.reopen(nb, m.id))}>
                  Open it again
                </button>
              </div>
            )}

            {review && (
              <div className="ip-card ip-review">
                <div className="ip-session-head">
                  <h3>Mentor review</h3>
                  <span className="ip-hint">On this Mac</span>
                  <span className="ip-gap" />
                  <button className="icon-btn small" onClick={() => setReview(null)} aria-label="Close the review">
                    <Icon name="x" size={11} />
                  </button>
                </div>
                <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(review, ENV) }} />
              </div>
            )}
          </section>

          <aside className="ip-home-side" aria-label="The project">
            <div className="ip-card ip-side-card">
              <h3>Map</h3>
              <PlanMap plan={plan} highlight={highlight} />
            </div>
            <div className="ip-card ip-side-card">
              <div className="ip-session-head">
                <h3>Memory</h3>
                <span className="ip-gap" />
                {memory && (
                  <button className="link-btn small" onClick={() => app.openPath(memory.path)}>
                    Open the note
                  </button>
                )}
              </div>
              {memory ? (
                MEMORY_SECTIONS.filter((s) => s !== 'Reviews' || memory.memory.Reviews.length).map((s) => (
                  <div key={s} className="ip-memory">
                    <span className="ip-label">{s}</span>
                    {memory.memory[s].length ? (
                      <ul>
                        {memory.memory[s].slice(-4).map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ip-hint">Nothing yet</p>
                    )}
                  </div>
                ))
              ) : (
                <p className="ip-hint">Reading…</p>
              )}
            </div>
          </aside>
        </div>
      </div>
      {party && <Celebrate c={party} onClose={() => setParty(null)} />}
    </div>
  )
}

/** The ready check: what to read and learn first, then the questions; passing unlocks the tests */
function ReadyCheck({ plan, mIndex, answers, setAnswers, busy, onLoad, onMark, onLesson }: { plan: ProjectPlan; mIndex: number; answers: Record<string, string>; setAnswers(a: Record<string, string>): void; busy: string | null; onLoad(): void; onMark(): void; onLesson(concept: string): void }) {
  const m = plan.milestones[mIndex]
  const g = m.gate
  const result = (id: string) => g?.results.find((r) => r.id === id)
  const gaps = g && g.results.length && !g.ready ? gateGaps(g) : []
  return (
    <>
      <div className="ip-ready-before">
        <span className="ip-label">Before you build, read and learn</span>
        {m.lessons.map((l) => (
          <span key={l.concept} className="ip-hint">
            Lesson: {l.concept}
          </span>
        ))}
        {m.readings.map((r) => (
          <span key={r.title} className="ip-hint">
            Read: {r.title}
          </span>
        ))}
        {!m.lessons.length && !m.readings.length && <span className="ip-hint">The milestone’s brief above.</span>}
      </div>
      {!g?.questions.length ? (
        <div className="ip-ready-foot">
          <span className="ip-hint">Five questions on the design of what you’re about to build, and a few on the reading. Pass three in four to unlock the tests.</span>
          <span className="ip-gap" />
          <button className="btn small primary" onClick={onLoad} disabled={!!busy}>
            {busy === 'ready' ? 'Writing the questions…' : 'Start the ready check'}
          </button>
        </div>
      ) : (
        <>
          {g.questions.map((q) => {
            const r = result(q.id)
            return (
              <div key={q.id} className={`ip-ready-q${r ? (r.pass ? ' pass' : ' miss') : ''}`}>
                <span>
                  <span className="ip-ready-kind">{q.kind === 'design' ? 'Design' : 'Reading'}</span>
                  <span>{q.question}</span>
                </span>
                <textarea rows={2} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} disabled={g.ready} aria-label={q.question} />
                {r && <span className="ip-ready-feedback">{r.feedback}</span>}
              </div>
            )
          })}
          <div className="ip-ready-foot">
            {g.results.length > 0 && (
              <span className={`ip-chip${g.ready ? ' on' : ''}`}>
                Ready check: {g.passed} of {g.total} passed
              </span>
            )}
            {gaps.map((x) => (
              <button key={x.revisit} className="link-btn small" onClick={() => (x.kind === 'reading' && m.readings.some((r) => r.title === x.revisit) ? undefined : onLesson(x.revisit))}>
                {x.kind === 'reading' ? 'Re-read' : 'Learn'}: {x.revisit}
              </button>
            ))}
            <span className="ip-gap" />
            <span className="ip-hint">{g.by === 'claude' ? 'Marked by Claude Opus' : 'Marked by what a good answer mentions'}</span>
            {!g.ready && (
              <button className="btn small primary" onClick={onMark} disabled={!!busy || !Object.values(answers).some((a) => a.trim())}>
                {busy === 'ready' ? 'Marking…' : g.results.length ? 'Try again' : 'Mark my answers'}
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}

