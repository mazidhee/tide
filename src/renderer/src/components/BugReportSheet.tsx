import { useEffect, useRef, useState } from 'react'
import { BUG_NOTE, bugDate, bugLine, cleanBugText, type BugSheetInfo } from '@shared/bugNote'
import { useApp } from '../state'
import { viewLabel } from '../lib/bugReport'
import { SECTIONS } from './SettingsView'
import { Icon } from './Icon'

/**
 * Report a bug from anywhere (⌃⌘B, Help › Report a Bug…): one line of what went wrong, where you
 * were, and a picture of the window as it was when you pressed the keys. Sent to the top of
 * "## Open" in Tide/Tide bugs.md, in your own style.
 */
export function BugReportSheet({ onClose }: { onClose(): void }) {
  const app = useApp()
  const [text, setText] = useState('')
  const [where, setWhere] = useState(() => viewLabel(app.view, (id) => SECTIONS.find((s) => s.id === id)?.label))
  const [info, setInfo] = useState<BugSheetInfo | null>(null)
  const [shot, setShot] = useState(true)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    window.tide.bugs
      .info()
      .then(setInfo)
      .catch(() => setInfo({ version: '', thumb: null }))
  }, [])

  const close = () => {
    void window.tide.bugs.discard().catch(() => {})
    onClose()
  }
  const ready = !!cleanBugText(text) && !busy
  const send = async () => {
    if (!ready) return
    setBusy(true)
    try {
      await window.tide.bugs.file({ text, view: where, shot: shot && !!info?.thumb })
      onClose()
      app.toast('Added to Tide bugs', { action: { label: 'Open', run: () => app.openPath(BUG_NOTE) } })
    } catch (e) {
      setBusy(false)
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    }
  }
  const preview = cleanBugText(text) ? bugLine({ text, view: where, at: Date.now() }) : null

  return (
    <div className="modal-backdrop bug-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal bug-sheet" role="dialog" aria-label="Report a bug" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header className="bug-head">
          <span className="bug-mark" aria-hidden="true">
            <Icon name="bug" size={15} />
          </span>
          <h2>Report a bug</h2>
          <kbd className="bug-kbd" title="Report a bug from anywhere">⌃⌘B</kbd>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <input ref={input} className="bug-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="What went wrong, in a line" aria-label="What went wrong" maxLength={600} spellCheck />
          <div className="bug-context">
            <label className="bug-where">
              <span>Where</span>
              <input value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Where you were" spellCheck={false} />
            </label>
            <span className="bug-facts">
              {bugDate(Date.now())}
              {info?.version ? ` · Tide ${info.version}` : ''}
            </span>
          </div>
          {info?.thumb ? (
            <label className={`bug-shot${shot ? '' : ' off'}`}>
              <img src={info.thumb} alt="The window when you pressed the keys" />
              <span className="bug-shot-tick">
                <input type="checkbox" checked={shot} onChange={(e) => setShot(e.target.checked)} />
                Attach this screenshot
              </span>
            </label>
          ) : info ? (
            <p className="bug-noshot">No screenshot could be taken of this window.</p>
          ) : (
            <div className="bug-shot loading" aria-hidden="true" />
          )}
          {preview && <p className="bug-preview" title="The line added to Tide bugs">{preview}{shot && info?.thumb ? ' · with the screenshot' : ''}</p>}
          <footer className="bug-foot">
            <span className="bug-dest">
              Top of <b>Open</b> in Tide bugs
            </span>
            <button type="button" className="btn small" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn small primary" disabled={!ready}>
              {busy ? 'Adding…' : 'Add bug'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
