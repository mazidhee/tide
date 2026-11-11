import { useEffect, useState } from 'react'
import type { ConceptState, KnowledgeView as KnowledgeData } from '@shared/knowledge'
import type { ChatScope } from '@shared/types'
import { useApp } from '../state'
import { BrainTabs } from './BrainTabs'
import { KnowledgeMap } from './KnowledgeMap'

/**
 * Brain, "What you know": the knowledge map, read from .tide/knowledge.json through Tide's Rust
 * module. A lesson or a quick check on anything in it starts the way it does everywhere else: a
 * session on that topic, in its notebook.
 */
export function KnowledgeView() {
  const app = useApp()
  const [data, setData] = useState<KnowledgeData | null>(null)
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

  return (
    <div className="doc-view know-view">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb current">Brain</span>
          <BrainTabs tab="know" />
        </div>
      </header>
      <div className="know-scroll">
        {data && (
          <KnowledgeMap
            data={data}
            onLesson={(c) => app.setView({ kind: 'session', mode: 'teach', scope: scopeOf(c), topic: c.name, nonce: Date.now() })}
            onCheck={(c) => app.setView({ kind: 'session', mode: 'quiz', scope: scopeOf(c), topic: c.name, options: { length: 5 }, nonce: Date.now() })}
            onNewTopic={() => app.setView({ kind: 'new-topic' })}
          />
        )}
      </div>
    </div>
  )
}
