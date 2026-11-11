/**
 * The screens of a guided project (shared/workshop.ts), drawn from data alone so that the design
 * harness (design/prototype/projects) can show them without the app: the list of projects, a
 * project not yet started, and a project in hand (its stages, the brief, the files, the tests and
 * what they said, the hints, the tutor's review, and a question for the tutor).
 */
import { useEffect, useMemo, useState } from 'react'
import { since } from '@shared/editor'
import { AREA_LABEL, LANG_LABEL, ago, firstFailure, tally, type StageView, type WorkshopArea, type WorkshopCard, type WorkshopState } from '@shared/workshop'
import { renderMarkdown } from '../../lib/markdown'
import { Icon, type IconName } from '../Icon'

export type WorkshopBusy = null | 'start' | 'run' | 'hint' | 'review' | 'ask' | 'propose' | 'editor'

const AREA_ICON: Record<WorkshopArea, IconName> = {
  systems: 'subSystems',
  'c-cpp': 'subBraces',
  python: 'subCode',
  distributed: 'subDistributed',
  databases: 'subDatabase',
  data: 'subPipeline',
  ml: 'subLearning',
  algorithms: 'subAlgorithms',
  other: 'subCode'
}

const NO_FILES = new Map<string, string>()
const md = (text: string) => renderMarkdown(text, { notePath: '', filesByName: NO_FILES })
const langs = (c: Pick<WorkshopCard, 'languages'>) => c.languages.map((l) => LANG_LABEL[l]).join(' and ')
const fileName = (p: string) => p.split('/').pop() ?? p
const by = (b: 'cloud' | 'local' | 'none') => (b === 'cloud' ? 'by the cloud model' : b === 'local' ? 'on this Mac' : 'from the tests alone; no model could be asked')

// ---------- The list ----------

export function ProjectList({ cards, onOpen, intro }: { cards: WorkshopCard[]; onOpen(id: string): void; intro?: React.ReactNode }) {
  const inHand = cards.filter((c) => c.progress && !c.progress.finishedAt)
  const rest = cards.filter((c) => !inHand.includes(c))
  const areas = [...new Set(rest.map((c) => c.area))].sort((a, b) => AREA_LABEL[a].localeCompare(AREA_LABEL[b]))
  const row = (c: WorkshopCard) => (
    <li key={c.id}>
      <button className="ws-row" onClick={() => onOpen(c.id)}>
        <Icon name={AREA_ICON[c.area]} size={18} className="ws-row-icon" />
        <span className="ws-row-main">
          <span className="ws-row-title">{c.title}</span>
          <span className="ws-row-outcome">{c.outcome}</span>
        </span>
        <span className="ws-row-meta">
          {langs(c)}, {c.stages} stages
        </span>
        <span className="ws-row-state">
          {c.progress?.finishedAt ? (
            <>
              <span className="ws-dot good" />
              Finished
            </>
          ) : c.progress ? (
            <>
              <span className="ws-dot now" />
              Stage {c.progress.stage + 1} of {c.stages}
            </>
          ) : c.origin === 'generated' ? (
            'Designed for your roadmap'
          ) : (
            'Not started'
          )}
        </span>
      </button>
    </li>
  )
  return (
    <div className="ws-list">
      {intro}
      {inHand.length > 0 && (
        <section className="ws-group">
          <h2 className="ws-group-h">In hand</h2>
          <ul className="ws-rows">{inHand.map(row)}</ul>
        </section>
      )}
      {areas.map((a) => (
        <section key={a} className="ws-group">
          <h2 className="ws-group-h">{AREA_LABEL[a]}</h2>
          <ul className="ws-rows">{rest.filter((c) => c.area === a).map(row)}</ul>
        </section>
      ))}
    </div>
  )
}

// ---------- A project not yet started ----------

export function ProjectPreview({ card, onStart, busy, from }: { card: WorkshopCard; onStart(): void; busy: WorkshopBusy; from?: string }) {
  const stages = card.outline
  return (
    <div className="ws-preview">
      <p className="ws-kicker">
        <Icon name={AREA_ICON[card.area]} size={15} /> {AREA_LABEL[card.area]}
      </p>
      <h1 className="ws-title">{card.title}</h1>
      <p className="ws-lede">{card.outcome}</p>
      <p className="ws-meta">
        In {langs(card)}, in {card.stages} stages.{card.prerequisites.length ? ` It builds on ${card.prerequisites.join(', ')}.` : ''}
        {from ? ` Started from your roadmap’s “${from}”.` : ''}
      </p>
      {stages && (
        <ol className="ws-outline">
          {stages.map((s, i) => (
            <li key={i}>
              <span className="ws-n">{i + 1}</span>
              <span>
                <strong>{s.title}</strong> {s.goal}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="ws-meta">Tide makes a folder for it under Code in your notes folder: plain files, yours to edit in any editor. The tests run here, in the sandbox; you see each test’s name and what it reported.</p>
      <button className="btn primary" onClick={onStart} disabled={busy === 'start'}>
        <Icon name="play" size={14} />
        {busy === 'start' ? 'Making the folder…' : 'Start the project'}
      </button>
    </div>
  )
}

// ---------- A project in hand ----------

export interface ProjectScreenProps {
  state: WorkshopState
  /** The stage shown: the current one unless another was picked */
  selected: number
  onSelect(i: number): void
  busy: WorkshopBusy
  answer?: { question: string; text: string; by: 'cloud' | 'local' | 'none' } | null
  error?: string | null
  now: number
  onRun(): void
  onHint(): void
  onReview(): void
  onAsk(question: string): void
  onOpenFile(path: string): void
  onLearn(concept: string): void
  /** The editor the folder opens in (Settings › Tools), when one is installed */
  editor?: { name: string } | null
  onOpenEditor?(): void
  /** The folder is watched: a save runs the tests */
  watching?: boolean
  /** A run started by a save is going */
  saveRunning?: boolean
}

/** "12 s ago", ticking on its own so the rest of the screen is not drawn again every second */
function LiveSince({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      timer = setTimeout(tick, Date.now() - at < 60_000 ? 1000 : 30_000)
    }
    timer = setTimeout(tick, 1000)
    return () => clearTimeout(timer)
  }, [at])
  return <>{since(at, now)}</>
}

export function ProjectScreen(p: ProjectScreenProps) {
  const { state } = p
  const stage = state.stages[p.selected] ?? state.stages[state.current]
  const done = state.stages.filter((s) => s.status === 'done').length
  const finished = !!state.card.progress?.finishedAt
  const stageFiles = useMemo(() => new Set((stage.files ?? []).map(fileName)), [stage])
  return (
    <div className="ws-project">
      <header className="ws-head">
        <p className="ws-kicker">
          <Icon name={AREA_ICON[state.card.area]} size={15} /> {AREA_LABEL[state.card.area]}, in {langs(state.card)}
        </p>
        <h1 className="ws-title">{state.card.title}</h1>
        <div className="ws-track" role="img" aria-label={`${done} of ${state.stages.length} stages passed`}>
          {state.stages.map((s, i) => (
            <span key={s.id} className={`ws-track-seg ${s.status}${i === p.selected ? ' shown' : ''}`} />
          ))}
          <span className="ws-track-label">
            {finished ? `All ${state.stages.length} stages pass` : `${done} of ${state.stages.length} stages pass`}
          </span>
        </div>
      </header>

      {state.recap.lines.length > 0 && (
        <section className="ws-recap" aria-label="Where you left off">
          <h2 className="ws-recap-h">{finished ? 'Finished' : 'Where you left off'}</h2>
          <p className="ws-recap-head">{state.recap.headline}</p>
          <ul>
            {state.recap.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="ws-body">
        <main className="ws-main">
          <StageBody {...p} stage={stage} index={state.stages.indexOf(stage)} total={state.stages.length} />
        </main>
        <aside className="ws-rail">
          <section>
            <h2 className="td-rail-h">Stages</h2>
            <ol className="ws-stages">
              {state.stages.map((s, i) => (
                <li key={s.id}>
                  <button className={`ws-stage ${s.status}${i === p.selected ? ' shown' : ''}`} onClick={() => s.status !== 'locked' && p.onSelect(i)} disabled={s.status === 'locked'} aria-current={i === p.selected ? 'step' : undefined}>
                    <span className="ws-n">{s.status === 'done' ? <Icon name="check" size={11} /> : i + 1}</span>
                    <span className="ws-stage-text">
                      <span className="ws-stage-title">{s.title}</span>
                      {s.status === 'current' && <span className="ws-stage-goal">{s.goal}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="td-rail-h">
              Your files <span className="td-meta">{state.files.length}</span>
            </h2>
            <ul className="ws-files">
              {state.files.map((f) => (
                <li key={f}>
                  <button className={`ws-file${stageFiles.has(fileName(f)) ? ' this-stage' : ''}`} onClick={() => p.onOpenFile(f)} title={`Open ${f}`}>
                    <Icon name={/\.md$/i.test(f) ? 'note' : 'subCode'} size={14} />
                    <span>{f.slice(state.folder.length + 1) || fileName(f)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="ws-rail-note">In {state.folder}. Edit them here or in any editor; a run reads them as they are.</p>
          </section>
          {state.private && <p className="ws-rail-note">This project belongs to a private notebook: reviews and questions stay on this Mac.</p>}
        </aside>
      </div>
    </div>
  )
}

function StageBody(p: ProjectScreenProps & { stage: StageView; index: number; total: number }) {
  const { stage } = p
  const run = stage.run
  const [question, setQuestion] = useState('')
  const counts = run ? tally(run) : null
  const first = run ? firstFailure(run) : undefined
  const isCurrent = stage.status === 'current'
  const hintsLeft = 3 - (stage.hints?.length ?? 0)
  // Once there is a run, what it said comes first and the brief, read already, follows
  const brief = stage.brief ? (
    <section className={run ? 'ws-brief-after' : undefined} aria-label="The brief">
      {run && <h3 className="ws-brief-h">The brief</h3>}
      <div className="ws-brief prose" dangerouslySetInnerHTML={{ __html: md(stage.brief) }} />
    </section>
  ) : null
  return (
    <>
      <p className="ws-stage-kicker">
        Stage {p.index + 1} of {p.total}
        {stage.status === 'done' && (
          <span className="ws-state good">
            <span className="ws-dot good" /> Passed
          </span>
        )}
      </p>
      <h2 className="ws-stage-h">{stage.title}</h2>
      <p className="ws-goal">{stage.goal}</p>
      {stage.read && (stage.read.concept || stage.read.source) && (
        <p className="ws-read">
          <Icon name="book" size={14} />
          <span>
            Read first:{' '}
            {stage.read.concept && (
              <button className="ws-link" onClick={() => p.onLearn(stage.read!.concept!)} title={`A lesson on ${stage.read.concept}`}>
                {stage.read.concept}
              </button>
            )}
            {stage.read.concept && stage.read.source ? '. ' : ''}
            {stage.read.source && <span className="ws-source">{stage.read.source}</span>}
          </span>
        </p>
      )}
      {!run && brief}

      <section className="ws-tests" aria-label="Tests">
        <div className="ws-tests-head">
          <h3>Tests</h3>
          <span className="ws-tests-meta">
            {p.saveRunning && isCurrent ? (
              'Running on your save…'
            ) : run && counts ? (
              run.error ? (
                <>
                  Last run: nothing ran, {p.now - run.at < 86_400_000 ? <LiveSince at={run.at} /> : ago(run.at, p.now)}
                </>
              ) : (
                <>
                  Last run {p.now - run.at < 86_400_000 ? <LiveSince at={run.at} /> : ago(run.at, p.now)}: {counts.passed} of {counts.total} pass, {(run.durationMs / 1000).toFixed(1)} s
                </>
              )
            ) : (
              'Not run yet'
            )}
          </span>
        </div>
        {run?.error && (
          <div className="ws-nothing">
            <p>Nothing ran. The compiler or interpreter said:</p>
            <pre>{run.error}</pre>
          </div>
        )}
        <ul className="ws-test-list">
          {(run ? run.tests.filter((t) => t.stage === stage.id) : (stage.tests ?? []).map((name) => ({ name, status: 'not-run' as const, message: undefined, stage: stage.id }))).map((t) => (
            <li key={t.name} className={`ws-test ${t.status}`}>
              <span className={`ws-mark ${t.status}`} aria-hidden />
              <span className="ws-test-name">{t.name}</span>
              <span className="ws-test-word">{t.status === 'pass' ? 'Passes' : t.status === 'fail' ? 'Fails' : 'Not run'}</span>
              {t.status === 'fail' && t.message && <code className="ws-test-msg">{t.message}</code>}
            </li>
          ))}
        </ul>
        {run && run.tests.some((t) => t.stage !== stage.id && t.status === 'fail') && (
          <p className="ws-regress">
            An earlier stage’s test fails now:{' '}
            {run.tests
              .filter((t) => t.stage !== stage.id && t.status === 'fail')
              .map((t) => `“${t.name}”`)
              .join(', ')}
            . Every earlier test runs again on each run.
          </p>
        )}
        {run?.output && (
          <details className="ws-output">
            <summary>What your code printed</summary>
            <pre>{run.output}</pre>
          </details>
        )}
        {(isCurrent || (stage.status === 'done' && run)) && (
          <div className="ws-actions">
            {isCurrent && (
              <button className="btn primary" onClick={p.onRun} disabled={p.busy === 'run'}>
                <Icon name="play" size={14} />
                {p.busy === 'run' ? 'Running the tests…' : 'Run the tests'}
              </button>
            )}
            {isCurrent && p.editor && p.onOpenEditor && (
              <button className="btn" onClick={p.onOpenEditor} title="Opens the project's folder; Tide keeps running the tests here">
                <Icon name="external" size={14} />
                Open in {p.editor.name}
              </button>
            )}
            <button className="btn" onClick={p.onReview} disabled={!run || p.busy === 'review'} title={run ? 'The tutor reads your code and the run' : 'Run the tests first'}>
              <Icon name="tutor" size={14} />
              {p.busy === 'review' ? 'Reading your code…' : 'Review my code'}
            </button>
            {isCurrent && (
              <button className="btn ghost" onClick={p.onHint} disabled={hintsLeft <= 0 || p.busy === 'hint'}>
                {hintsLeft === 3 ? 'A hint' : hintsLeft > 0 ? `A stronger hint (${hintsLeft} left)` : 'No hints left'}
              </button>
            )}
          </div>
        )}
        {isCurrent && p.watching && (
          <p className="ws-on-save">
            <span className={`ws-dot${p.saveRunning ? ' now' : ''}`} />
            The tests run again each time you save a file{p.editor ? ` in ${p.editor.name} or anywhere else` : ''}.
          </p>
        )}
        {p.error && <p className="ws-error">{p.error}</p>}
      </section>

      {stage.hints && stage.hints.length > 0 && (
        <section className="ws-hints" aria-label="Hints">
          <h3>Hints</h3>
          <ol>
            {stage.hints.map((h, i) => (
              <li key={i}>
                <span className="ws-hint-kind">{['A nudge', 'A pointer', 'An outline'][i]}</span>
                {h}
              </li>
            ))}
          </ol>
        </section>
      )}

      {stage.review && (
        <section className="ws-review" aria-label="The tutor’s review">
          <div className="ws-review-head">
            <h3>The tutor’s review</h3>
            <span className="ws-tests-meta">
              Of the run with {stage.review.passed} of {stage.review.total} passing, {by(stage.review.by)}
            </span>
          </div>
          {stage.review.failure && (
            <div className="ws-review-part">
              <h4>{run?.error ? 'Why nothing ran' : first && counts && counts.passed === stage.review.passed && counts.total === stage.review.total ? `Why “${first.name}” fails` : 'The first failure'}</h4>
              <div className="prose" dangerouslySetInnerHTML={{ __html: md(stage.review.failure) }} />
            </div>
          )}
          {stage.review.question && (
            <div className="ws-review-part ws-question">
              <h4>A question about your design</h4>
              <p>{stage.review.question}</p>
            </div>
          )}
          {stage.review.praise && (
            <div className="ws-review-part">
              <h4>What works</h4>
              <p>{stage.review.praise}</p>
            </div>
          )}
          {stage.review.by === 'none' && <p className="ws-meta">No model was free to read your code; the counts above are what the tests said.</p>}
        </section>
      )}

      {run && brief}

      {stage.status !== 'locked' && (
        <section className="ws-ask" aria-label="Ask the tutor">
          {p.answer && (
            <div className="ws-answer">
              <p className="ws-answer-q">{p.answer.question}</p>
              {p.answer.text ? <div className="prose" dangerouslySetInnerHTML={{ __html: md(p.answer.text) }} /> : <p className="ws-meta">No model could answer just now.</p>}
              <p className="ws-meta">Answered {by(p.answer.by)}.</p>
            </div>
          )}
          <form
            className="ws-ask-bar"
            onSubmit={(e) => {
              e.preventDefault()
              if (!question.trim()) return
              p.onAsk(question.trim())
              setQuestion('')
            }}
          >
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Ask the tutor about ${stage.title.toLowerCase()}`} aria-label="Ask the tutor" />
            <button className="btn" type="submit" disabled={!question.trim() || p.busy === 'ask'}>
              {p.busy === 'ask' ? 'Asking…' : 'Ask'}
            </button>
          </form>
        </section>
      )}
    </>
  )
}
