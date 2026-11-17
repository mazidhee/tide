import { useEffect, useState } from 'react'
import type { WorkCard } from '@shared/workProject'
import { useApp } from '../state'
import { Icon } from './Icon'
import { PlaceTag } from './PracticeSettings'
import '../styles/workProjects.css'

/** Projects › Work: the guided work projects in Projects/Work, in their order */
export function WorkShelf() {
  const app = useApp()
  const [cards, setCards] = useState<WorkCard[] | null>(null)
  useEffect(() => {
    window.tide.work
      .list()
      .then(setCards)
      .catch(() => setCards([]))
  }, [])
  if (!cards?.length) return null
  return (
    <section className="pq-sec wk-shelf" aria-label="Work projects">
      <div className="pq-sec-head">
        <h3>Work projects</h3>
        <span className="pq-n">{cards.length}</span>
        <PlaceTag place="practice" />
      </div>
      <ol className="wk-list">
        {cards.map((c) => (
          <li key={c.slug}>
            <button className="wk-row" onClick={() => app.setView({ kind: 'work', slug: c.slug })}>
              <span className="wk-n">{c.order < 99 ? c.order : '·'}</span>
              <span className="wk-title">{c.title}</span>
              <span className="wk-meta">
                {c.steps} steps · {c.answered} of {c.decisions} decisions
              </span>
              {c.done ? <Icon name="check" size={14} /> : <Icon name="chevron" size={14} />}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
