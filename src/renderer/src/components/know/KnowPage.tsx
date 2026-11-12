import { useMemo, useState } from 'react'
import type { KnowledgeView } from '@shared/knowledge'
import { KnowSubjects, type Actions } from './KnowSubjects'
import { KnowTimeline } from './KnowTimeline'
import { KnowTeaching } from './KnowTeaching'

/**
 * What you know, in the new design: one sentence carrying the numbers, then either view, by
 * subject (each roadmap as a syllabus being filled in) or over time (weeks, with what fades and
 * each aim's forecast). The choice is remembered on this Mac.
 */
type Mode = 'subject' | 'time' | 'teaching'
const KEY = 'tide.know.view'

const remembered = (): Mode => {
  try {
    const m = localStorage.getItem(KEY)
    return m === 'time' || m === 'teaching' ? m : 'subject'
  } catch {
    return 'subject'
  }
}

const plural = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString('en-GB')} ${x === 1 ? one : many}`

export function KnowPage({ data, areaClass, actions }: { data: KnowledgeView; areaClass(area: string): string; actions: Actions }) {
  const [mode, setMode] = useState<Mode>(remembered)
  const choose = (m: Mode) => {
    setMode(m)
    try {
      localStorage.setItem(KEY, m)
    } catch {
      // Remembered for this visit only
    }
  }
  const ready = useMemo(() => new Set(data.ready), [data])
  const topics = useMemo(() => data.concepts.filter((c) => !c.parent), [data])
  const count = (s: string) => topics.filter((c) => c.status === s).length
  const solid = count('solid')
  const fading = count('fading')
  const learning = count('learning')
  const readyNew = topics.filter((c) => c.status === 'new' && ready.has(c.id)).length
  const begun = solid + fading + learning
  const notebooks = new Set(topics.map((c) => c.area)).size

  return (
    <div className="know td-know kp">
      <header className="kp-head">
        <div className="kp-title">
          <h1 className="page-title">What you know</h1>
          <div className="segmented text kp-switch" role="group" aria-label="View">
            {(
              [
                ['subject', 'By subject'],
                ['time', 'Over time'],
                ['teaching', 'How Tide is teaching you']
              ] as const
            ).map(([m, label]) => (
              <button key={m} aria-pressed={mode === m} className={mode === m ? 'on' : ''} onClick={() => choose(m)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {mode !== 'teaching' && (
          <p className="kp-say">
            {begun === 0 ? (
              <>
                {plural(topics.length, 'topic')} across {plural(notebooks, 'notebook')}, none studied here yet. Each lesson and answer fills this in.
              </>
            ) : (
              <>
                <b>{solid.toLocaleString('en-GB')}</b> of {plural(topics.length, 'topic')} {solid === 1 ? 'is' : 'are'} solid
                {fading > 0 && (
                  <>
                    , <b>{fading}</b> {fading === 1 ? 'is' : 'are'} fading
                  </>
                )}
                {learning > 0 && (
                  <>
                    {fading > 0 ? ' and ' : ', '}
                    <b>{learning}</b> {learning === 1 ? 'is' : 'are'} being learnt
                  </>
                )}
                .{' '}
                {readyNew > 0 && (
                  <>
                    <b>{readyNew.toLocaleString('en-GB')}</b> {readyNew === 1 ? 'is' : 'are'} ready to start.
                  </>
                )}
              </>
            )}
          </p>
        )}
      </header>
      {mode === 'teaching' ? <KnowTeaching /> : mode === 'subject' ? <KnowSubjects data={data} ready={ready} areaClass={areaClass} actions={actions} /> : <KnowTimeline data={data} areaClass={areaClass} actions={actions} />}
      {mode !== 'teaching' && (
        <p className="know-foot">
          An estimate, not a mark: the chance you would remember a topic today, by the same model as your reviews (FSRS). Each answer is a review: a right one after a gap makes it last much longer, a wrong one makes it harder to keep, and it fades
          with the time since. Solid means your last answer was right and the chance is still 85% or more; fading means it has dropped below.
        </p>
      )}
    </div>
  )
}
