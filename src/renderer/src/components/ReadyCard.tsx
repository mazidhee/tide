import { preparedParts, type PreparedLesson } from '@shared/lessonPrep'
import { preparedWhen } from '../lib/prep'
import { Icon } from './Icon'
import { Professor } from './Professor'

/**
 * "Ready for you": a lesson prepared while you were away (main/lessonPrep), with what was got
 * ready for it. Starting it opens at once. On Home it is the page's one action block; on Learn, a
 * card above the topic box.
 */
export function ReadyCard({ prep, variant, onStart, onElse }: { prep: PreparedLesson; variant: 'home' | 'learn'; onStart(): void; onElse?(): void }) {
  const parts = preparedParts(prep)
  const when = `${preparedWhen(prep.at)}${prep.by === 'claude' ? ' with Claude' : ''}`
  const steps = prep.plan?.steps ?? []
  if (variant === 'learn')
    return (
      <section className="ready-card" aria-label="Ready for you">
        <div className="ready-card-main">
          <span className="ready-kicker">
            <Icon name="sparkle" size={13} />
            Ready for you
          </span>
          <h2 className="ready-title">{prep.topic}</h2>
          <p className="ready-why">{prep.why}</p>
          {parts.length > 0 && <p className="ready-inline">{parts.join(' · ')}</p>}
        </div>
        <div className="ready-card-go">
          <button className="btn primary" onClick={onStart}>
            <Icon name="play" size={12} />
            Start
          </button>
          <span className="ready-when">{when}</span>
        </div>
      </section>
    )
  return (
    <section className="td-now ready-now" aria-label="Ready for you">
      <div className="td-now-text">
        <span className="ready-kicker">
          <Icon name="sparkle" size={13} />
          Ready for you
        </span>
        <h2>{prep.topic}</h2>
        <p>{prep.why}</p>
        {steps.length > 0 && (
          <ol className="ready-steps" aria-label="The plan">
            {steps.map((s, i) => (
              <li key={i}>
                <span className="ready-step-n">{i + 1}</span>
                <span className="ready-step-title">{s.title}</span>
                {s.minutes ? <span className="ready-step-min">{s.minutes} min</span> : null}
              </li>
            ))}
          </ol>
        )}
        {parts.length > 0 && (
          <ul className="ready-parts" aria-label="What’s prepared">
            {parts.filter((p) => !/-step plan/.test(p) || !steps.length).map((p) => (
              <li key={p}>
                <Icon name="check" size={12} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="td-now-acts">
          <button className="btn primary" onClick={onStart}>
            <Icon name="play" size={13} />
            Start
          </button>
          {onElse && (
            <button className="btn" onClick={onElse}>
              Choose something else
            </button>
          )}
          <span className="td-meta td-now-key">{when}. It stays ready if you do something else.</span>
        </div>
      </div>
      <div className="td-now-side">
        <Professor state="happy" size={56} />
      </div>
    </section>
  )
}
