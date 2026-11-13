/**
 * Your Metabase beside a lesson on it, in Tide's web view (main/webView, in a session of its own
 * that keeps your sign-in). The tutor sees the page with each message: which question or dashboard
 * is open, what it is (read from the API) and the text it shows (main/metabaseLearn). The pane
 * says what the tutor sees, and that it is read-only for Tide: anything you change in Metabase
 * there, you change yourself.
 */
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { WebFrame } from './LinkViewer'

export function MetabasePane({ url, onClose }: { url: string; onClose(): void }) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      // After the page settles: a question renders its result a moment after the address changes
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void window.tide.metabase
          .screen()
          .then((s) => live && setLabel(s?.label ?? ''))
          .catch(() => {})
      }, 600)
    }
    read()
    const off = window.tide.web.onState(read)
    return () => {
      live = false
      if (timer) clearTimeout(timer)
      off()
    }
  }, [])
  return (
    <div className="mb-pane">
      <div className="mb-pane-head">
        <span className="mb-pane-title">
          <Icon name="subDatabase" size={13} /> Metabase
        </span>
        {label && (
          <span className="mb-pane-sees" title="The tutor sees this page with your next message">
            <Icon name="eye" size={12} /> Tutor sees <b>{label}</b>
          </span>
        )}
        <span className="mb-pane-gap" />
        <button className="icon-btn small" onClick={onClose} title="Close Metabase" aria-label="Close Metabase">
          <Icon name="x" size={13} />
        </button>
      </div>
      <WebFrame url={url} />
      <p className="mb-pane-foot">Read-only for Tide and the tutor. Sign in once; Tide keeps that sign-in in its own session and never reads it.</p>
    </div>
  )
}
