import { useEffect, useState } from 'react'
import { languageLabel, SESSION_STEPS, type IdeaProjectCard, type LadderView, type ScoreView } from '@shared/ideaProject'
import { tierLabel } from '@shared/ideaLadder'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { IdeaSheet } from './IdeaSheet'
import '../../styles/ideas.css'

/**
 * On the Projects page: the projects you're building from an idea, to carry on with, and a new one. Each opens
 * at its home in the Code view (components/ideas/ProjectHome).
 */
export function ProjectsShelf() {
  const app = useApp()
  const [cards, setCards] = useState<IdeaProjectCard[]>([])
  const [sheet, setSheet] = useState<false | { seed: string | null }>(false)
  const [ladder, setLadder] = useState<LadderView | null>(null)
  const [score, setScore] = useState<ScoreView | null>(null)
  useEffect(() => {
    window.tide.ideas
      .list()
      .then(setCards)
      .catch(() => {})
    window.tide.ideas
      .ladder()
      .then(setLadder)
      .catch(() => {})
    window.tide.ideas
      .score()
      .then(setScore)
      .catch(() => {})
  }, [])
  const next = ladder?.suggestions[0]
  const open = (root: string) => app.setView({ kind: 'code', root, home: true, nonce: Date.now() })
  const going = cards.filter((c) => c.progress.done < c.progress.total)
  return (
    <section className="ip-shelf">
      <div className="ip-shelf-head">
        <h2 className="section-title">{going.length ? 'Continue building' : 'Your projects'}</h2>
        {score && score.points > 0 && (
          <span className="ip-score" title={score.next ? `${score.next.at - score.points} points to ${score.next.title}` : ''}>
            <b>{score.title}</b>
            <span className="ip-level-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(score.progress * 100)}%` }} />
            </span>
            {score.points} points{score.streak ? ` · ${score.streak}-day streak` : ''}
          </span>
        )}
        <span className="ip-gap" />
        <button className="tool-btn" onClick={() => setSheet({ seed: null })}>
          <Icon name="compass" size={13} />
          New project from an idea
        </button>
      </div>
      {cards.length ? (
        <ul className="ip-shelf-rows">
          {cards.slice(0, 4).map((c) => (
            <li key={c.notebook}>
              <button className="ip-shelf-row" onClick={() => open(c.root)}>
                <span>
                  <span className="ip-shelf-title">{c.name}</span>
                  <span className="ip-shelf-sub">
                    {c.current ? `Milestone ${c.progress.index + 1} of ${c.progress.total}: ${c.current}` : 'Every milestone done'}
                    {c.step && c.step !== 'finished' ? ` · ${SESSION_STEPS.find((s) => s.id === c.step)?.label ?? ''} next` : ''}
                    {` · ${languageLabel(c.language)}`}
                  </span>
                </span>
                <span className="ip-shelf-bar" aria-label={`${c.progress.done} of ${c.progress.total} milestones done`}>
                  {Array.from({ length: c.progress.total }, (_, i) => (
                    <span key={i} className={i < c.progress.done ? 'done' : i === c.progress.index ? 'active' : ''} />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Say what you want to build, a payment rail, a blockchain, an ML model, and Tide maps it, plans the milestones and sets up the project, then works through it beside you.</p>
      )}
      {next && (
        <button className="ip-shelf-row ip-shelf-next" onClick={() => setSheet({ seed: next.seed })} title={next.why}>
          <span>
            <span className="ip-shelf-title">Next: {next.title}</span>
            <span className="ip-shelf-sub">
              Tier {next.tier} · {tierLabel(next.tier)}, already mapped out · {next.why}
            </span>
          </span>
          <span className="ip-chip">Plan it</span>
        </button>
      )}
      {sheet && <IdeaSheet initialSeed={sheet.seed} onClose={() => setSheet(false)} onNotebook={(nb) => (setSheet(false), app.setView({ kind: 'notebook', path: nb }))} onOpen={(made) => (setSheet(false), open(made.root))} />}
    </section>
  )
}
