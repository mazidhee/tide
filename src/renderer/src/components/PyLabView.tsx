import { useEffect, useRef, useState } from 'react'
import { LAB_STARTERS, starterFor } from '@shared/pyLab'
import { pyLabBlock } from '../lib/pyLab'

/**
 * The Python lab on a page of its own: the starter programs on Python's internals down the side,
 * and the lab (lib/pyLab) with the chosen one open to edit and step through. A lesson's topic or
 * a program of its own can open it on the right one.
 */
export function PyLabView({ starter, code, topic }: { starter?: string; code?: string; topic?: string }) {
  const [pick, setPick] = useState(() => (code ? '' : (LAB_STARTERS.find((s) => s.id === starter) ?? starterFor(topic ?? '')).id))
  const host = useRef<HTMLDivElement>(null)
  const chosen = LAB_STARTERS.find((s) => s.id === pick)

  useEffect(() => {
    const box = host.current
    if (!box) return
    const block = pyLabBlock(chosen?.code ?? code ?? '', { watch: chosen?.watch })
    box.replaceChildren(block.root)
    return () => {
      block.destroy()
      box.replaceChildren()
    }
  }, [pick, chosen, code])

  return (
    <div className="page pylab-page">
      <div className="page-inner">
        <header className="pylab-page-head">
          <h1 className="page-title">Python lab</h1>
          <p className="pylab-page-sub">Step through a program a line or one bytecode instruction at a time, and watch the call stack and every object in memory change. It runs once, sandboxed, on your Mac’s Python; going back is free.</p>
        </header>
        <div className="pylab-page-grid">
          <nav className="pylab-starters" aria-label="Starter programs">
            <div className="pylab-pane-title">Python internals</div>
            {LAB_STARTERS.map((s) => (
              <button key={s.id} type="button" className={`pylab-starter${s.id === pick ? ' on' : ''}`} aria-current={s.id === pick} onClick={() => setPick(s.id)}>
                <span className="pylab-starter-title">{s.title}</span>
              </button>
            ))}
            {code && (
              <button type="button" className={`pylab-starter${!pick ? ' on' : ''}`} aria-current={!pick} onClick={() => setPick('')}>
                <span className="pylab-starter-title">The program you opened</span>
              </button>
            )}
          </nav>
          <div ref={host} className="pylab-page-lab" />
        </div>
      </div>
    </div>
  )
}
