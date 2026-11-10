import { useEffect, useMemo, useState } from 'react'
import { KIND_LABEL, whenUsed, type Connection, type ConnectionKind } from '@shared/connections'
import { useApp } from '../state'
import { Icon } from './Icon'

const STATE_LABEL: Record<Connection['state'], string> = {
  connected: 'Connected',
  ready: 'Ready',
  'needs-key': 'Needs a key',
  'not-set-up': 'Not set up',
  off: 'Off',
  resting: 'Resting',
  error: 'Not answering'
}

const KIND_ORDER: ConnectionKind[] = ['model', 'search', 'reader', 'voice', 'tasks', 'data', 'tools']

/** Worth adding first, best last (sorted to the front) */
const RECOMMENDED = ['provider:openrouter', 'provider:gemini', 'provider:generalcompute', 'firecrawl', 'you', 'provider:groq']

/** Keys entered right here; everything else is set up in its own section */
const KEYED_HERE = new Set(['you', 'firecrawl'])

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** A small square with the service's initial, tinted by where it runs */
function Mark({ c }: { c: Connection }) {
  const letter = c.name.replace(/^(the )/i, '').charAt(0).toUpperCase()
  return (
    <span className={`cx-mark runs-${c.runs}`} aria-hidden="true">
      {letter}
    </span>
  )
}

function Runs({ c }: { c: Connection }) {
  return <span className={`cx-runs runs-${c.runs}`}>{c.runs === 'mac' ? 'On this Mac' : 'Cloud'}</span>
}

/**
 * Every service Tide uses, at a glance: what's connected, what it's for, where it runs, what it
 * used today and when it was last used; and what you could add, with its free allowance and what
 * it's allowed to see.
 */
export function ConnectionsView() {
  const app = useApp()
  const [list, setList] = useState<Connection[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  const load = (fresh = false) => {
    setRefreshing(true)
    window.tide.connections
      .list(fresh)
      .then(setList)
      .catch(() => setList([]))
      .finally(() => setRefreshing(false))
  }
  useEffect(() => {
    load()
    const t = setInterval(() => load(), 30_000)
    return () => clearInterval(t)
  }, [])

  const inUse = useMemo(() => (list ?? []).filter((c) => c.state !== 'needs-key' && c.state !== 'not-set-up'), [list])
  // What you could add: the ones worth adding first, then the rest
  const toAdd = useMemo(() => (list ?? []).filter((c) => c.state === 'needs-key' || c.state === 'not-set-up').sort((a, b) => RECOMMENDED.indexOf(b.id) - RECOMMENDED.indexOf(a.id)), [list])
  const mac = inUse.filter((c) => c.runs === 'mac' && c.active).length
  const cloud = inUse.filter((c) => c.runs === 'cloud' && c.active).length
  const today = inUse.filter((c) => c.runs === 'cloud').reduce((n, c) => n + (c.today?.requests ?? 0), 0)
  const attention = inUse.filter((c) => c.state === 'error' || c.state === 'resting')

  const manage = (c: Connection) => (KEYED_HERE.has(c.id) ? setAdding(c.id) : app.setView({ kind: 'settings', section: c.section as never }))

  if (list === null)
    return (
      <p className="muted cx-loading">
        <span className="spinner" /> Checking your connections…
      </p>
    )

  return (
    <div className="cx">
      <div className="cx-summary">
        <div className="cx-tile">
          <span className="cx-tile-n">{mac}</span>
          <span className="cx-tile-label">running on this Mac</span>
        </div>
        <div className="cx-tile">
          <span className="cx-tile-n">{cloud}</span>
          <span className="cx-tile-label">connected in the cloud</span>
        </div>
        <div className="cx-tile">
          <span className="cx-tile-n">{today}</span>
          <span className="cx-tile-label">cloud requests today</span>
        </div>
        <div className={`cx-tile${attention.length ? ' warn' : ''}`}>
          <span className="cx-tile-n">{attention.length}</span>
          <span className="cx-tile-label">{attention.length === 1 ? 'needs attention' : 'need attention'}</span>
        </div>
        <button className="icon-btn cx-refresh" title="Check again now" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
        </button>
      </div>

      {KIND_ORDER.map((kind) => {
        const rows = inUse.filter((c) => c.kind === kind)
        if (!rows.length) return null
        return (
          <section key={kind} className="cx-group">
            <h2 className="cx-group-title">{KIND_LABEL[kind]}</h2>
            <ul className="cx-list">
              {rows.map((c) => (
                <li key={c.id} className={`cx-row${c.active ? '' : ' idle'}`}>
                  <Mark c={c} />
                  <div className="cx-main">
                    <div className="cx-name-line">
                      <span className="cx-name">{c.name}</span>
                      <Runs c={c} />
                    </div>
                    <span className="cx-detail">{c.detail}</span>
                    <div className="cx-uses">
                      {c.usedFor.slice(0, 4).map((u) => (
                        <span key={u} className="cx-use">
                          {u}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="cx-numbers">
                    {c.today?.requests ? (
                      <span className="cx-today">
                        {c.today.requests} today{c.today.tokens ? <span className="muted">, {tokens(c.today.tokens)} tokens</span> : null}
                      </span>
                    ) : (
                      <span className="cx-today muted">None today</span>
                    )}
                    {c.dayShare !== undefined && (
                      <span className="cx-meter" title={`${Math.round(c.dayShare * 100)}% of today’s free allowance used`}>
                        <span style={{ width: `${Math.min(100, Math.round(c.dayShare * 100))}%` }} className={c.dayShare > 0.8 ? 'high' : ''} />
                      </span>
                    )}
                    <span className="cx-last">{whenUsed(c.lastUsed)}</span>
                  </div>
                  <span className={`cx-state s-${c.state}`}>
                    <i />
                    {STATE_LABEL[c.state]}
                  </span>
                  <button className="btn small ghost cx-manage" onClick={() => manage(c)}>
                    Manage
                  </button>
                  {adding === c.id && <KeyForm c={c} onDone={(next) => (setAdding(null), next && setList(next))} />}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {toAdd.length > 0 && (
        <section className="cx-group">
          <h2 className="cx-group-title">Add a connection</h2>
          <div className="cx-cards">
            {toAdd.map((c) => (
              <article key={c.id} className="cx-card">
                <header>
                  <Mark c={c} />
                  <div>
                    <span className="cx-name">{c.name}</span>
                    <Runs c={c} />
                  </div>
                </header>
                <p className="cx-card-for">{c.usedFor.join(', ')}</p>
                {c.free && (
                  <p className="cx-card-free" title={c.free}>
                    {c.free}
                  </p>
                )}
                {c.privacy && <p className="cx-card-privacy">{c.privacy}</p>}
                {adding === c.id ? (
                  <KeyForm c={c} onDone={(next) => (setAdding(null), next && setList(next))} />
                ) : (
                  <div className="cx-card-actions">
                    <button className="btn small primary" onClick={() => manage(c)}>
                      {c.state === 'needs-key' ? 'Add a key' : 'Set up'}
                    </button>
                    {c.keyUrl && (
                      <button className="btn small ghost" onClick={() => window.tide.app.openExternal(c.keyUrl!)}>
                        Get a key
                        <Icon name="external" size={11} />
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="cx-more muted small">Want Tide to use another service? Ask for it, and it joins this list with its own status, limits and privacy rules.</p>
    </div>
  )
}

/** A key for a service added here: saved to your Keychain, never shown again */
function KeyForm({ c, onDone }: { c: Connection; onDone(next?: Connection[]): void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (value: string | null) => {
    setBusy(true)
    setError('')
    try {
      onDone(await window.tide.connections.setKey(c.id, value))
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <div className="cx-key">
      <input className="set-input wide" type="password" autoFocus placeholder={`${c.name} key`} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' && key.trim() ? save(key.trim()) : e.key === 'Escape' && onDone())} aria-label={`${c.name} key`} />
      <button className="btn small primary" disabled={!key.trim() || busy} onClick={() => save(key.trim())}>
        Save
      </button>
      {c.state !== 'needs-key' && (
        <button className="btn small ghost" disabled={busy} onClick={() => save(null)}>
          Remove key
        </button>
      )}
      <button className="btn small ghost" onClick={() => onDone()}>
        Cancel
      </button>
      {error ? <span className="set-error">{error}</span> : <span className="muted small">Kept in your Keychain. {c.privacy}</span>}
    </div>
  )
}
