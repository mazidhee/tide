import { useEffect, useState } from 'react'
import type { ReferenceStatus } from '@shared/reference'
import { Group, Row } from './SettingsView'
import { useApp } from '../state'

const errorText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  if (n > 0) return `${Math.max(1, Math.round(n / 1e3))} KB`
  return '0 MB'
}

const count = (n: number) => n.toLocaleString('en-GB')
const when = (t?: number) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0
  return (
    <span className="usage-meter ref-meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </span>
  )
}

/** Settings › Reference & data: what's on this Mac for the tutor to quote, the datasets, and the meaning index */
export function ReferenceSettings() {
  const app = useApp()
  const [s, setS] = useState<ReferenceStatus | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    window.tide.reference
      .status()
      .then(setS)
      .catch((e) => setFailed(errorText(e)))
    return window.tide.reference.onProgress(setS)
  }, [])

  const building = !!s && (s.sources.some((x) => x.building) || !!s.semantic.building)
  const rebuild = async () => {
    try {
      await window.tide.reference.rebuild()
      setS(await window.tide.reference.status())
    } catch (e) {
      app.toast(errorText(e), { tone: 'error' })
    }
  }
  const open = (which: 'reference' | 'datasets') => void window.tide.reference.openFolder(which).catch((e) => app.toast(errorText(e), { tone: 'error' }))

  if (!s) return <Group title="Reference"><Row label={failed ? <span className="set-error">Couldn’t read the reference</span> : 'Looking…'} hint={failed || undefined} /></Group>

  const sem = s.semantic
  return (
    <>
      <Group title="Reference">
        <Row label="On this Mac" hint={<code className="path">{s.root.replace(/^\/Users\/[^/]+/, "~")}</code>}>
          <span className="set-inline">
            <button className="btn small" onClick={() => open('reference')}>
              Open folder
            </button>
            <button className="btn small primary" onClick={() => void rebuild()} disabled={building}>
              {building ? 'Indexing…' : 'Rebuild index'}
            </button>
          </span>
        </Row>
        {s.sources.map((x) => (
          <Row
            key={x.id}
            label={x.label}
            hint={
              x.error ? (
                <span className="set-error">{x.error}</span>
              ) : !x.exists ? (
                'Not downloaded'
              ) : (
                <>
                  {formatBytes(x.bytes)} · {count(x.files)} files · {count(x.passages)} passages
                  {x.building && <Progress done={x.building.done} total={x.building.total} />}
                </>
              )
            }
          >
            <span className="muted small ref-when">{x.building ? `${count(x.building.done)} of ${count(x.building.total)}` : x.indexedAt ? `Indexed ${when(x.indexedAt)}` : 'Not indexed'}</span>
          </Row>
        ))}
      </Group>

      <Group title="Datasets" note={s.pythonParquet === false ? <>Your python3 can’t read Parquet yet: <code>python3 -m pip install pyarrow</code></> : undefined}>
        <Row label="On this Mac" hint={<code className="path">{s.datasetsRoot.replace(/^\/Users\/[^/]+/, "~")}</code>}>
          <button className="btn small" onClick={() => open('datasets')}>
            Open folder
          </button>
        </Row>
        {s.datasets.map((d) => (
          <Row
            key={d.id}
            label={d.label}
            hint={
              !d.exists
                ? 'Not downloaded'
                : d.tables.length
                  ? d.tables.map((t) => (t.rows != null ? `${t.name} ${count(t.rows)} rows` : t.name)).join(' · ')
                  : 'No tables yet'
            }
          >
            {d.exists && <span className="muted small ref-when">{formatBytes(d.bytes)}</span>}
          </Row>
        ))}
      </Group>

      <Group title="Search by meaning">
        <Row
          label={sem.model}
          hint={
            sem.error ? (
              <span className="set-error">{sem.error}</span>
            ) : (
              <>
                {count(sem.items)} items · {count(sem.vectors)} vectors{sem.bytes ? ` · ${formatBytes(sem.bytes)}` : ''}
                {sem.building && <Progress done={sem.building.done} total={sem.building.total} />}
              </>
            )
          }
        >
          <span className="muted small ref-when">
            {sem.building ? `${count(sem.building.done)} of ${count(sem.building.total)}` : sem.loaded ? 'Loaded' : sem.indexedAt ? `Idle · indexed ${when(sem.indexedAt)}` : 'Idle'}
          </span>
        </Row>
      </Group>
    </>
  )
}
