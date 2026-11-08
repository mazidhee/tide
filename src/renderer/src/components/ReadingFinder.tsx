import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state'
import { Icon } from './Icon'

interface Suggestion {
  title: string
  url: string
  host: string
  why: string
}

/** Asks the tutor to find good reading on the web about what you're studying, to save into the library */
export function ReadingFinder({ onClose }: { onClose(): void }) {
  const app = useApp()
  const [topics, setTopics] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'none' | 'error' | Suggestion[]>('idle')
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  // Start from what you studied last
  useEffect(() => {
    window.tide.learn
      .brief()
      .then((b) => b.last && setTopics((t) => t || b.last!.topics.map((x) => x.title).join(', ')))
      .catch(() => {})
    inputRef.current?.focus()
  }, [])

  const find = async () => {
    const list = topics
      .split(/[,;\n]/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (!list.length) return inputRef.current?.focus()
    setState('loading')
    try {
      const res = await window.tide.learn.suggestReading(list)
      setState(res.length ? res : 'none')
    } catch {
      setState('error')
    }
  }

  const save = async (s: Suggestion) => {
    setSaved((x) => new Set(x).add(s.url))
    try {
      const res = await window.tide.library.saveUrl(s.url)
      await app.refreshTree()
      app.toast(`Saved “${res.title}”`, { action: { label: 'Open', run: () => app.openPath(res.path) } })
    } catch (e) {
      setSaved((x) => {
        const n = new Set(x)
        n.delete(s.url)
        return n
      })
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    }
  }

  return (
    <section className="reading-finder" aria-label="Find reading">
      <div className="rf-head">
        <p>Find in-depth reading on</p>
        <button className="icon-btn small" onClick={onClose} title="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
      <form
        className="rf-form"
        onSubmit={(e) => {
          e.preventDefault()
          find()
        }}
      >
        <input ref={inputRef} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="Topics, separated by commas" aria-label="Topics" />
        <button className="btn primary small" disabled={state === 'loading' || !topics.trim()}>
          {state === 'loading' ? 'Searching…' : 'Find'}
        </button>
      </form>
      {state === 'loading' && (
        <p className="muted small rf-status">
          <span className="spinner" /> Searching the web and picking the best pages…
        </p>
      )}
      {state === 'none' && <p className="muted small rf-status">Nothing worth recommending turned up. Try other words.</p>}
      {state === 'error' && <p className="muted small rf-status">Couldn't search the web. Check web search in Settings.</p>}
      {Array.isArray(state) && (
        <ul className="brief-list">
          {state.map((s) => (
            <li key={s.url}>
              <div className="brief-item">
                <button className="brief-title" onClick={() => window.tide.app.openExternal(s.url)} title={s.url}>
                  {s.title}
                </button>
                <span className="brief-why">
                  <span className="brief-host">{s.host}</span>
                  {s.why}
                </span>
              </div>
              <button className="btn small" disabled={saved.has(s.url)} onClick={() => save(s)}>
                {saved.has(s.url) ? (
                  <>
                    <Icon name="check" size={13} /> Saved
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
