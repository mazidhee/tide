import { useDailyCount } from '../lib/daily'
import { useEffect, useState } from 'react'
import { formatMinutes, listTopics, type StudyDay } from '@shared/brief'
import { useApp } from '../state'
import { Icon } from './Icon'

/**
 * The top of Home: one sentence about your last study day, a quiz on it, and what's due. It stays
 * out of the way: nothing renders when there's nothing to say. (Reading suggestions live in the
 * Library, behind a button, so Home never fills up with recommendations.)
 */
export function DailyBrief({ dueCards }: { dueCards: number }) {
  const app = useApp()
  const daily = useDailyCount()
  const [last, setLast] = useState<StudyDay | null>(null)
  const [recall, setRecall] = useState(0)
  const [problems, setProblems] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    window.tide.learn
      .brief()
      .then((b) => {
        if (!live) return
        setLast(b.last)
        setRecall(b.recall)
        setProblems(b.problems)
      })
      .catch(() => {})
      .finally(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [app.files])

  const due = [
    dueCards > 0 && { label: `${dueCards} flashcard${dueCards === 1 ? '' : 's'}`, run: () => app.setView({ kind: 'study', scope: { kind: 'vault' } }) },
    recall > 0 && { label: `${recall} to explain from memory`, run: () => app.setView({ kind: 'study', scope: { kind: 'vault' } }) },
    problems > 0 && { label: `${problems} problem${problems === 1 ? '' : 's'} to retry`, run: () => app.setView({ kind: 'practice' }) }
  ].filter(Boolean) as { label: string; run(): void }[]

  if (!ready || ((!last || (!last.topics.length && !last.focus)) && !due.length && !daily?.items)) return null

  const quiz = () => {
    if (!last) return
    const single = last.topics.length === 1 && last.topics[0].path
    app.setView({
      kind: 'session',
      mode: 'quiz',
      scope: single ? { kind: 'note', path: last.topics[0].path! } : { kind: 'vault' },
      topic: single ? last.topics[0].title : `What I studied ${last.when}: ${last.topics.map((t) => t.title).join('; ')}`,
      options: { length: 6 },
      nonce: Date.now()
    })
  }

  const did = last
    ? [last.answers ? `got ${last.correct} of ${last.answers} answers right` : '', last.reviews ? `reviewed ${last.reviews} card${last.reviews === 1 ? '' : 's'}` : ''].filter(Boolean)
    : []

  const When = last ? last.when[0].toUpperCase() + last.when.slice(1) + ',' : ''
  const line = !last ? null : last.topics.length ? (
    <>
      {When} you {last.focus ? `focused for ${formatMinutes(last.focus)} and ` : ''}worked on <strong>{listTopics(last.topics)}</strong>
      {did.length ? `, and ${did.join(' and ')}` : ''}.
    </>
  ) : last.focus ? (
    <>
      {When} you focused for <strong>{formatMinutes(last.focus)}</strong>.
    </>
  ) : null

  // What today's practice holds, in words: "5 flashcards, 1 past mistake"
  const parts = daily
    ? [
        daily.parts.card && `${daily.parts.card} flashcard${daily.parts.card === 1 ? '' : 's'}`,
        daily.parts.mistake && `${daily.parts.mistake} past mistake${daily.parts.mistake === 1 ? '' : 's'}`,
        daily.parts.recall && `${daily.parts.recall} to explain from memory`,
        daily.parts.preview && 'a look at what’s next'
      ].filter(Boolean)
    : []
  const startDaily = () => app.setView({ kind: 'daily', nonce: Date.now() })

  return (
    <section className="brief" aria-label="Today">
      {line && (
        <p className="brief-line">
          {line}
          {last && last.topics.length > 0 && (
            <>
              {' '}
              <button className="brief-link" onClick={quiz}>
                Quiz me on it
              </button>
            </>
          )}
        </p>
      )}
      {daily && daily.items > 0 && (
        <div className="up-next" role="button" tabIndex={0} onClick={startDaily} onKeyDown={(e) => e.key === 'Enter' && startDaily()}>
          <span className="up-next-icon" aria-hidden="true">
            <Icon name="cards" size={18} />
          </span>
          <span className="up-next-text">
            <strong>Daily practice</strong>
            <span>
              {parts.join(', ')}, about {daily.minutes} min
            </span>
          </span>
          <span className="up-next-go">
            Start
            <Icon name="chevron" size={11} />
          </span>
        </div>
      )}
      {problems > 0 && (
        <p className="brief-more">
          <button className="brief-link" onClick={() => app.setView({ kind: 'practice' })}>
            {problems} problem{problems === 1 ? '' : 's'} to retry in Practice
          </button>
        </p>
      )}
    </section>
  )
}
