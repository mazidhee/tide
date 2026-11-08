import { useMemo, useState } from 'react'
import { useApp } from '../state'
import { createDesign, DESIGN_FOLDER } from '../lib/designs'
import { createExampleDesign } from '../lib/examples'
import { Icon } from './Icon'
import { PillSegment, PromptBox } from './PromptBox'

const TOPICS = ['URL shortener', 'Rate limiter', 'Chat app', 'Market data feed', 'Payment system', 'News feed']

/** System design: start a canvas with a lesson or an interview, or pick up a design */
export function DesignPanel() {
  const app = useApp()
  const [topic, setTopic] = useState('')
  const [mode, setMode] = useState<'teach' | 'interview' | 'blank'>('teach')
  const designs = useMemo(
    () => app.files.filter((f) => f.kind === 'canvas' && f.path.startsWith(DESIGN_FOLDER + '/')).sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)),
    [app.files]
  )
  const open = async (start?: 'teach' | 'interview', topic?: string) => {
    const path = await createDesign(app.files, topic ? `${topic}` : undefined)
    await app.refreshTree()
    app.setView({ kind: 'design', path, ...(start ? { start } : {}), ...(topic ? { topic } : {}), nonce: Date.now() })
  }
  const example = async () => {
    const path = await createExampleDesign(app.files)
    await app.refreshTree()
    app.openPath(path)
  }
  return (
    <section className="pv-prompt">
      <h2 className="pv-title">System design</h2>
      <p className="pv-sub">Draw on a canvas; the tutor sees it, draws with you, and reviews it.</p>
      <PromptBox
        value={topic}
        onChange={setTopic}
        onSubmit={() => open(mode === 'blank' ? undefined : mode, topic.trim() || undefined)}
        allowEmpty={mode !== 'teach'}
        placeholder="What do you want to design? e.g. a URL shortener, a payments ledger"
        action={mode === 'teach' ? 'Start the lesson' : mode === 'interview' ? 'Interview me' : 'Open a canvas'}
        tools={
          <PillSegment
            label="How"
            value={mode}
            onChange={(v) => setMode(v as typeof mode)}
            options={[
              { value: 'teach', label: 'Lesson' },
              { value: 'interview', label: 'Interview' },
              { value: 'blank', label: 'Blank canvas' }
            ]}
          />
        }
      />
      <div className="prompt-suggest">
        {TOPICS.map((t) => (
          <button key={t} onClick={() => setTopic(t)}>
            {t}
          </button>
        ))}
      </div>
      <p className="pv-meta">
        {designs.slice(0, 4).map((d) => (
          <button key={d.path} className="link-btn quiet" onClick={() => app.openPath(d.path)}>
            <Icon name="canvas" size={12} />
            {d.name.replace(/\.canvas$/, '')}
          </button>
        ))}
        <button className="link-btn quiet" onClick={example}>
          Open an example
        </button>
      </p>
    </section>
  )
}
