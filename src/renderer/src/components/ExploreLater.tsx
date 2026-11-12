import { useState } from 'react'
import { fromLine, shortDate, type CuriositySetup } from '@shared/explore'
import { useApp } from '../state'
import { openSideLesson, openWhereItCameUp, startSideLesson, useExplore } from '../lib/explore'
import { Icon } from './Icon'

const SHOWN = 5

/**
 * Learn's "To explore": what you kept from lessons to come back to for curiosity (shared/explore).
 * Each says where it came from, starts a short side lesson, or opens the lesson at the message it
 * came up in. Hidden while there is nothing kept.
 */
export function ToExplore() {
  const app = useApp()
  const items = useExplore()
  const [all, setAll] = useState(false)
  if (!items?.length) return null
  const open = items.filter((x) => !x.explored).length
  const shown = all ? items : items.slice(0, SHOWN)
  return (
    <section className="ws-shelf xp-shelf" aria-label="To explore">
      <div className="ws-shelf-head">
        <h2 className="section-title">To explore{open ? <span className="xp-count">{open}</span> : null}</h2>
        {items.length > SHOWN && (
          <button className="tool-btn" onClick={() => setAll((a) => !a)}>
            {all ? 'Show fewer' : `All ${items.length}`}
          </button>
        )}
      </div>
      <ul className="xp-rows">
        {shown.map((x) => (
          <li key={x.id} className={`xp-row${x.explored ? ' done' : ''}`}>
            <span className="xp-mark" aria-hidden="true">
              <Icon name={x.explored ? 'check' : 'compass'} size={14} />
            </span>
            <div className="xp-main">
              <span className="xp-title" title={x.text}>
                {x.title}
              </span>
              <span className="xp-from">{x.explored ? `Explored ${shortDate(x.explored.at)} · ${fromLine(x)}` : fromLine(x)}</span>
            </div>
            <div className="xp-acts">
              {x.explored ? (
                <button className="btn small" onClick={() => void openSideLesson(app, x)}>
                  Open the side lesson
                </button>
              ) : (
                <button className="btn small" onClick={() => startSideLesson(app, x)}>
                  Start a side lesson
                </button>
              )}
              {x.from.lesson && (
                <button className="btn small ghost" onClick={() => void openWhereItCameUp(app, x.from)}>
                  Open where it came up
                </button>
              )}
              <button className="icon-btn small xp-x" onClick={() => void window.tide.explore.remove(x.id)} title="Remove from the list" aria-label={`Remove “${x.title}”`}>
                <Icon name="x" size={13} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A side lesson's line under its title: the lesson it came up in, to go back to */
export function CameUpIn({ curiosity }: { curiosity: CuriositySetup }) {
  const app = useApp()
  return (
    <div className="xp-came-up">
      <Icon name="compass" size={13} />
      <span className="muted">Came up in</span>
      {curiosity.from.lesson ? (
        <button className="s-read-link" onClick={() => void openWhereItCameUp(app, curiosity.from)} title="Open the lesson at the message it came up in">
          {curiosity.from.topic}
        </button>
      ) : (
        <span>{curiosity.from.topic}</span>
      )}
    </div>
  )
}
