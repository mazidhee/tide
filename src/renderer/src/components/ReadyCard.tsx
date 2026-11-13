import type { PreparedLesson } from '@shared/lessonPrep'
import { preparedWhen } from '../lib/prep'
import { Icon } from './Icon'
import { Professor } from './Professor'

type Count = { key: string; n?: number; label: string; title?: string }

/** What was got ready, as counts: "3 warm-up · 15 recall · 4 exercises · Reading"; names go in the tooltip */
function readyCounts(prep: PreparedLesson): Count[] {
  const out: Count[] = []
  if (prep.warmup?.cards.length) out.push({ key: 'warm', n: prep.warmup.cards.length, label: 'warm-up' })
  const fading = prep.due.onTopic.length + prep.due.fading.length
  if (prep.due.recall) out.push({ key: 'recall', n: prep.due.recall, label: 'recall' })
  else if (fading) out.push({ key: 'fading', n: fading, label: 'fading' })
  if (prep.exercises.length) out.push({ key: 'ex', n: prep.exercises.length, label: prep.exercises.length === 1 ? 'exercise' : 'exercises', title: 'Checked in the sandbox' })
  if (prep.visual) out.push({ key: 'visual', label: 'Visual', title: prep.visual.title })
  const anims = prep.animations?.length ?? 0
  if (anims) out.push({ key: 'anim', n: anims, label: anims === 1 ? 'animation' : 'animations' })
  if (prep.reading) out.push({ key: 'read', label: 'Reading', title: prep.reading.title })
  return out
}

function Counts({ prep }: { prep: PreparedLesson }) {
  const counts = readyCounts(prep)
  if (!counts.length) return null
  return (
    <ul className="ready-counts" aria-label="What’s prepared">
      {counts.map((c) => (
        <li key={c.key} title={c.title}>
          {c.n !== undefined && <b>{c.n}</b>}
          {c.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * "Ready for you": a lesson prepared while you were away (main/lessonPrep), with what was got
 * ready for it as counts. Starting it opens at once. On Home it is the page's one action block;
 * on Learn, a card above the topic box.
 */
export function ReadyCard({ prep, variant, onStart, onElse }: { prep: PreparedLesson; variant: 'home' | 'learn'; onStart(): void; onElse?(): void }) {
  const when = `${preparedWhen(prep.at)}${prep.by === 'claude' ? ' with Claude' : ''}`
  const steps = prep.plan?.steps ?? []
  if (variant === 'learn')
    return (
      <section className="ready-card" aria-label="Ready for you">
        <div className="ready-card-main">
          <h2 className="ready-title">
            <Icon name="sparkle" size={14} />
            <span>{prep.topic}</span>
          </h2>
          <p className="ready-why" title={prep.why}>
            {prep.why}
          </p>
          <Counts prep={prep} />
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
        <h2 className="ready-title-home">
          <Icon name="sparkle" size={15} />
          <span>{prep.topic}</span>
        </h2>
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
        <Counts prep={prep} />
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
          <span className="td-meta td-now-key" title="It stays ready if you do something else">
            {when}
          </span>
        </div>
      </div>
      <div className="td-now-side">
        <Professor state="happy" size={56} />
      </div>
    </section>
  )
}
