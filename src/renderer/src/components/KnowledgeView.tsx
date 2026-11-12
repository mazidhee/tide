import { useEffect, useState } from 'react'
import type { ConceptState, KnowledgeView as KnowledgeData, MissedQuestion } from '@shared/knowledge'
import { checkLength, FROM_MEMORY, type ReviewItem } from '@shared/review'
import type { ChatScope } from '@shared/types'
import { useApp } from '../state'
import { BrainTabs } from './BrainTabs'
import { Icon } from './Icon'
import { KnowledgeMap } from './KnowledgeMap'
import { useTideDesign } from '../lib/design'
import { useAreaClass } from '../lib/areas'

/**
 * Brain, "What you know": the knowledge map, read from .tide/knowledge.json through Tide's Rust
 * module. A lesson on anything in it starts the way it does everywhere else: a session on that
 * topic, in its notebook. Review now asks its kept questions that are due; Quick check is a short
 * fresh diagnostic (shared/review.ts).
 */
export function KnowledgeView() {
  const app = useApp()
  const [data, setData] = useState<KnowledgeData | null>(null)
  const tide = useTideDesign()
  const areaClass = useAreaClass()
  useEffect(() => {
    let live = true
    const load = () =>
      window.tide.knowledge
        .view()
        .then((d) => live && setData(d))
        .catch(() => live && setData({ at: Date.now(), areas: [], concepts: [], ready: [], fading: [], weeks: [] }))
    load()
    // An answer marked while this is open (a lesson in another window, a retest) shows up without a reload
    const off = window.tideEvents.onBrainEvent((e) => e.kind === 'attempt' && load())
    return () => {
      live = false
      off()
    }
  }, [])

  const scopeOf = (c: ConceptState): ChatScope => {
    const area = data?.areas.find((a) => a.name === c.area)
    return area ? { kind: 'folder', path: area.path } : { kind: 'vault' }
  }

  // Quick check: a few fresh questions across the topic's parts, none it has already been asked
  const quickCheck = (c: ConceptState) => {
    const parts = (data?.concepts ?? []).filter((p) => p.parent === c.id).sort((a, b) => a.order - b.order).map((p) => p.name)
    const avoid = (data?.missed?.[c.id] ?? []).map((m) => m.prompt)
    app.setView({ kind: 'session', mode: 'quiz', scope: scopeOf(c), topic: c.name, options: { length: checkLength(parts.length), check: { concept: c.id, parts, avoid } }, nonce: Date.now() })
  }
  // Review now: the questions kept on it that are due, each scheduled again by how it goes
  const reviewNow = async (c: ConceptState, only?: ReviewItem[]) => {
    const review = only ? { concept: c.id, items: only } : await window.tide.knowledge.review(c.id).catch(() => ({ concept: c.id, items: [] }))
    app.setView({ kind: 'session', mode: 'quiz', scope: scopeOf(c), topic: c.name, options: { length: review.items.length || FROM_MEMORY, review }, nonce: Date.now() })
  }
  // A missed question: the lesson it came from, at that question; else the question itself, asked again
  const openMissed = (c: ConceptState, m: MissedQuestion, ask = false) => {
    if (m.page && !ask) return app.setView({ kind: 'file', path: m.page, anchor: m.prompt, nonce: Date.now() })
    void reviewNow(c, [{ kind: 'recall', id: m.id, topic: c.name, question: m.prompt, due: m.due }])
  }

  return (
    <div className="doc-view know-view">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb current">{tide ? 'What you know' : 'Brain'}</span>
          <BrainTabs tab="know" />
        </div>
        <div className="doc-actions no-drag">
          <button className="tool-btn" onClick={() => app.setView({ kind: 'learner' })} title="Your learner profile: what the tutor reads before each lesson; correct or delete anything">
            <Icon name="tutor" size={15} />
            <span>What the tutor knows about you</span>
          </button>
        </div>
      </header>
      <div className="know-scroll">
        {data && (
          <KnowledgeMap
            data={data}
            tide={tide}
            areaClass={areaClass}
            onLesson={(c) => app.setView({ kind: 'session', mode: 'teach', scope: scopeOf(c), topic: c.name, nonce: Date.now() })}
            onCheck={quickCheck}
            onReview={reviewNow}
            onMissed={openMissed}
            onNewTopic={() => app.setView({ kind: 'new-topic' })}
          />
        )}
      </div>
    </div>
  )
}
