import { useCallback, useEffect, useState } from 'react'
import { KIND_LABEL, KEEP_DAYS, KEEP_WEEKS, sizeText, type BackupStatus, type Snapshot } from '@shared/backup'
import { Group, Row } from './SettingsView'
import { useApp } from '../state'
import { Icon } from './Icon'

/** "Today, 02:00", "Yesterday, 18:20", "Mon 10 Nov, 02:00" */
export function whenText(at: number, now = Date.now()): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const day = (t: number) => new Date(t).toDateString()
  if (day(at) === day(now)) return `Today, ${time}`
  if (day(at) === day(now - 86_400_000)) return `Yesterday, ${time}`
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) })
  return `${date}, ${time}`
}

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Settings › Backups: the last backup, Back up now, where they're kept, and Restore */
export function BackupsSettings() {
  const app = useApp()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const load = useCallback(() => {
    window.tide.backups
      .status()
      .then(setStatus)
      .catch(() => {})
  }, [])
  useEffect(load, [load])

  const backUp = async () => {
    setBusy('backup')
    try {
      const r = await window.tide.backups.now()
      setStatus(r.status)
      app.toast(`Backed up: ${sizeText(r.snapshot.bytes)}`)
    } catch (e) {
      app.toast(`Couldn’t back up: ${errorText(e)}`, { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }
  const restore = async (s: Snapshot) => {
    setBusy('restore')
    try {
      await window.tide.backups.restore(s.name)
      app.toast('Restored. Tide is starting again…')
    } catch (e) {
      setBusy(null)
      app.toast(`Couldn’t restore: ${errorText(e)}`, { tone: 'error' })
    }
  }

  const last = status?.last
  const list = status?.snapshots ?? []
  const shown = all ? list : list.slice(0, 8)
  return (
    <>
      <Group
        title="Backups"
        note={`Each night, and when you quit if the last one is over a day old. Kept: the last ${KEEP_DAYS} days, then one a week for ${KEEP_WEEKS} weeks. They hold your lessons, What you know, ratings, workout, reading marks, profile, usage and settings; caches and models are left out, and your notes aren’t copied (they’re yours to back up as you do now).`}
      >
        <Row
          label="Last backup"
          hint={
            status === null ? (
              'Looking…'
            ) : last ? (
              <span className="bk-last">
                {whenText(last.at)} · {sizeText(last.bytes)} · {KIND_LABEL[last.kind]}
              </span>
            ) : (
              'None yet. The first one is made tonight, or now.'
            )
          }
        >
          <button className="btn small primary" onClick={() => void backUp()} disabled={!!busy || !!status?.running}>
            {busy === 'backup' ? 'Backing up…' : 'Back up now'}
          </button>
        </Row>
        <Row label="Kept in" hint={<code className="path">{status?.folder ?? ''}</code>}>
          <span className="set-inline">
            <button className="btn small" onClick={() => void window.tide.backups.reveal()}>
              Show in Finder
            </button>
            <button className="btn small" onClick={() => void window.tide.backups.chooseFolder().then(setStatus)}>
              Change…
            </button>
          </span>
        </Row>
        {status?.custom && (
          <Row label="" hint="A folder you chose. Older snapshots stay where they were.">
            <button className="link-btn" onClick={() => void window.tide.backups.defaultFolder().then(setStatus)}>
              Use the usual folder
            </button>
          </Row>
        )}
        {status?.error && <Row label={<span className="set-error">The last backup failed</span>} hint={status.error} />}
      </Group>

      <Group title="Restore" note="Restoring keeps a safety snapshot of how things are now first, so it can be undone from this list, then Tide starts again.">
        {!list.length ? (
          <div className="set-pad bk-empty">No snapshots in this folder yet.</div>
        ) : (
          <>
            {shown.map((s) => (
              <div key={s.name} className={`bk-row${asking === s.name ? ' asking' : ''}`}>
                <div className="bk-main">
                  <span className="bk-when">{whenText(s.at)}</span>
                  <span className="bk-meta">
                    <span className={`bk-kind ${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                    <span>{sizeText(s.bytes)}</span>
                  </span>
                  {asking === s.name ? (
                    <span className="bk-actions">
                      <button className="btn small" onClick={() => setAsking(null)} disabled={busy === 'restore'}>
                        Cancel
                      </button>
                      <button className="btn small primary" onClick={() => void restore(s)} disabled={busy === 'restore'}>
                        {busy === 'restore' ? 'Restoring…' : 'Restore and restart'}
                      </button>
                    </span>
                  ) : (
                    <span className="bk-actions">
                      <button className="icon-btn small bk-reveal" title="Show in Finder" aria-label={`Show the snapshot from ${whenText(s.at)} in Finder`} onClick={() => void window.tide.backups.reveal(s.name)}>
                        <Icon name="folder" size={14} />
                      </button>
                      <button className="btn small" onClick={() => setAsking(s.name)} disabled={!!busy}>
                        Restore…
                      </button>
                    </span>
                  )}
                </div>
                {asking === s.name && (
                  <p className="bk-confirm">
                    Put back your lessons, What you know, workout, profile, usage and settings as they were on {whenText(s.at).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase())}. Anything since then is kept in a safety snapshot first.
                  </p>
                )}
              </div>
            ))}
            {list.length > shown.length && (
              <div className="set-pad">
                <button className="link-btn" onClick={() => setAll(true)}>
                  Show all {list.length}
                </button>
              </div>
            )}
          </>
        )}
      </Group>
    </>
  )
}
