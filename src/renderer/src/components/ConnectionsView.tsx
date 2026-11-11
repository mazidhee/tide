import { useEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABEL, whenUsed, type Connection, type ConnectionKind } from '@shared/connections'
import { useApp } from '../state'
import { Icon } from './Icon'

// ---------- Logos: each service's own mark ----------

const FILES = import.meta.glob('../assets/logos/*.{svg,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const file = (name: string) => FILES[`../assets/logos/${name}`]

/** Which logo each connection wears; brand colours for single-colour marks */
const LOGO: Record<string, { src: string; brand?: string; pad?: boolean; mono?: boolean }> = {
  'local-model': { src: 'gemma.png' },
  'provider:groq': { src: 'groq.png', brand: '#F55036' },
  'provider:generalcompute': { src: 'generalcompute.png', brand: '#7C5CFF' },
  'provider:nvidia': { src: 'nvidia.svg', brand: '#76B900', mono: true },
  'provider:gemini': { src: 'gemini.svg', brand: '#8E75B2', mono: true },
  'provider:openrouter': { src: 'openrouter.svg', brand: '#94A3B8', mono: true },
  'provider:anthropic': { src: 'anthropic.svg', brand: '#D97757', mono: true },
  'provider:deepseek': { src: 'deepseek.png', brand: '#4D6BFE' },
  'provider:qwen': { src: 'qwen.svg', brand: '#FF6A00', mono: true },
  'provider:kilo': { src: 'kilo.png', pad: true },
  'provider:ovh': { src: 'ovh.svg', brand: '#123F6D', mono: true },
  wikipedia: { src: 'wikipedia.svg', mono: true },
  searxng: { src: 'searxng.svg', brand: '#3050FF', mono: true },
  brave: { src: 'brave.svg', brand: '#FB542B', mono: true },
  tavily: { src: 'tavily.png', pad: true },
  you: { src: 'you.png', brand: '#4F6BF5' },
  firecrawl: { src: 'firecrawl.png', brand: '#FA5D19', pad: true },
  arxiv: { src: 'arxiv.svg', brand: '#B31B1B', mono: true },
  openlibrary: { src: 'openlibrary.png' },
  deepgram: { src: 'deepgram.svg', brand: '#13EF93', mono: true },
  flow: { src: 'flow.png', pad: true },
  handy: { src: 'handy.png', mono: true },
  things: { src: 'things.png', brand: '#3A7CF6' },
  metabase: { src: 'metabase.svg', brand: '#509EE3', mono: true },
  maths: { src: 'sympy.png', brand: '#3B5526', pad: true },
  libraries: { src: 'python.svg', brand: '#3776AB', mono: true }
}

/** A brand colour too dark to see on a dark theme: the ink instead */
function inkSafe(c?: string): string | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(c ?? '')
  if (!m) return c
  const n = parseInt(m[1], 16)
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.22 ? 'var(--ink-muted)' : c
}
const brandOf = (c: Connection) => inkSafe(LOGO[c.id]?.brand) ?? (c.runs === 'mac' ? 'var(--accent)' : 'var(--ink-muted)')

function Mark({ c, large }: { c: Pick<Connection, 'id' | 'kind'>; large?: boolean }) {
  const l = LOGO[c.id]
  const src = l && file(l.src)
  if (!src)
    return (
      <span className={`cx2-mark drawn${large ? ' lg' : ''}`} aria-hidden="true">
        <Icon name={c.kind === 'voice' ? 'speaker' : c.kind === 'data' ? 'graph' : 'sparkle'} size={large ? 18 : 15} />
      </span>
    )
  if (l.mono)
    return (
      <span className={`cx2-mark mono${large ? ' lg' : ''}${l.brand ? '' : ' plain'}`} style={{ ['--brand' as string]: l.brand ?? 'var(--ink)', ['--src' as string]: `url("${src}")` }} aria-hidden="true">
        <span />
      </span>
    )
  return (
    <span className={`cx2-mark${large ? ' lg' : ''}${l.pad ? ' pad' : ''}`} aria-hidden="true">
      <img src={src} alt="" />
    </span>
  )
}

// ---------- Words ----------

const STATE: Record<Connection['state'], { label: string; tone: 'ok' | 'warn' | 'err' | 'idle' }> = {
  connected: { label: 'Connected', tone: 'ok' },
  ready: { label: 'Ready', tone: 'ok' },
  'needs-key': { label: 'Needs a key', tone: 'idle' },
  'not-set-up': { label: 'Not set up', tone: 'idle' },
  off: { label: 'Off', tone: 'idle' },
  resting: { label: 'Resting', tone: 'warn' },
  error: { label: 'Not answering', tone: 'err' }
}
/** Running things say so, and the ones you use right now pulse */
const stateLabel = (c: Connection) => (c.id === 'local-model' && c.state === 'connected' ? 'Running' : c.state === 'ready' && !c.active ? 'Standby' : STATE[c.state].label)

const KIND_ORDER: ConnectionKind[] = ['model', 'search', 'reader', 'voice', 'tasks', 'data', 'tools']
const GROUP_LABEL: Partial<Record<ConnectionKind, string>> = { search: 'Search and reading', reader: 'Search and reading', tasks: 'Tasks and data', data: 'Tasks and data' }
const groupOf = (k: ConnectionKind) => GROUP_LABEL[k] ?? KIND_LABEL[k]

/** Keys entered on this page; a provider's key goes to its own store */
const KEYED_HERE = new Set(['you', 'firecrawl', 'brave', 'tavily'])
const isProvider = (id: string) => id.startsWith('provider:')
const canKey = (id: string) => KEYED_HERE.has(id) || isProvider(id)
/** Worth adding first */
const RECOMMENDED = ['provider:generalcompute', 'firecrawl', 'you', 'provider:openrouter', 'provider:gemini']

const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
/** The last seven days' names, oldest first: worked out when drawn, so they move on at midnight */
function weekDays(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    if (i === 6) return 'Today'
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toLocaleDateString('en-GB', { weekday: 'short' })
  })
}

type Filter = 'all' | 'mac' | 'cloud' | 'attention'

/**
 * Every service Tide works with, as one precise table: what each does, where it runs, today's use
 * against its free allowance, and when it was last used. A row opens into its week, its limits,
 * and what it's allowed to see; what you could add waits below with its free allowance.
 */
export function ConnectionsView() {
  const app = useApp()
  const [list, setList] = useState<Connection[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [fresh, setFresh] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState(Date.now())
  const searchRef = useRef<HTMLInputElement>(null)

  const load = (again = false) =>
    window.tide.connections
      .list(again)
      .then((l) => {
        setList(l)
        setCheckedAt(Date.now())
      })
      .catch(() => setList((cur) => cur ?? []))
  useEffect(() => {
    load()
    const t = setInterval(() => load(), 30_000)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement)?.closest?.('input, textarea')) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => (clearInterval(t), window.removeEventListener('keydown', onKey))
  }, [])

  const inUse = useMemo(() => (list ?? []).filter((c) => c.state !== 'needs-key' && c.state !== 'not-set-up'), [list])
  const toAdd = useMemo(() => (list ?? []).filter((c) => c.state === 'needs-key' || c.state === 'not-set-up').sort((a, b) => rank(a) - rank(b)), [list])
  const attention = (c: Connection) => c.state === 'error' || c.state === 'resting' || (c.dayShare ?? 0) > 0.85 || (c.credit?.share ?? 0) > 0.85
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inUse.filter((c) => (filter === 'all' || (filter === 'mac' ? c.runs === 'mac' : filter === 'cloud' ? c.runs === 'cloud' : attention(c))) && (!q || `${c.name} ${c.detail} ${c.usedFor.join(' ')}`.toLowerCase().includes(q)))
  }, [inUse, filter, query])

  if (list === null)
    return (
      <div className="cx2-loading">
        <span className="spinner" /> Checking every connection…
      </div>
    )

  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const added = (next: Connection[], id: string) => {
    setList(next)
    setFresh(id)
    setOpen(new Set([id]))
    setFilter('all')
    setTimeout(() => document.querySelector(`[data-cx="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  // Today: where the calls went
  const busy = inUse.filter((c) => (c.today?.requests ?? 0) > 0).sort((a, b) => (b.today!.requests - a.today!.requests))
  const total = busy.reduce((n, c) => n + c.today!.requests, 0)
  const mac = inUse.filter((c) => c.runs === 'mac' && c.active).length
  const cloud = inUse.filter((c) => c.runs === 'cloud' && c.active).length
  const hottest = inUse.filter((c) => c.dayShare !== undefined).sort((a, b) => (b.dayShare ?? 0) - (a.dayShare ?? 0))[0]
  const groups = [...new Set(KIND_ORDER.map(groupOf))].map((g) => ({ g, rows: shown.filter((c) => groupOf(c.kind) === g) })).filter((x) => x.rows.length)
  const counts: Record<Filter, number> = { all: inUse.length, mac: inUse.filter((c) => c.runs === 'mac').length, cloud: inUse.filter((c) => c.runs === 'cloud').length, attention: inUse.filter(attention).length }

  return (
    <div className="cx2">
      <section className="cx2-today" aria-label="Today">
        <div className="cx2-today-top">
          <p className="cx2-sentence">
            <b className="num">{total.toLocaleString('en-GB')}</b> {total === 1 ? 'call' : 'calls'} today. <b>{mac}</b> {mac === 1 ? 'service' : 'services'} working on your Mac, <b>{cloud}</b> in the cloud.
            {hottest && (hottest.dayShare ?? 0) > 0 ? (
              <>
                {' '}
                The busiest free allowance is {hottest.name}’s, at <b className="num">{Math.round((hottest.dayShare ?? 0) * 100)}%</b>.
              </>
            ) : (
              ' Every free allowance is untouched.'
            )}
          </p>
          <button className="cx2-checked" onClick={() => load(true)} title="Check every connection again now">
            <span className="cx2-pulse" />
            Checked {whenUsed(checkedAt).toLowerCase()}
          </button>
        </div>
        <div className="cx2-flow" role="img" aria-label="Today's calls by service">
          {busy.length ? busy.map((c, i) => <span key={c.id} title={`${c.name}: ${c.today!.requests}`} style={{ flexGrow: c.today!.requests, background: brandOf(c), animationDelay: `${i * 50}ms` }} />) : <span className="empty" />}
        </div>
        {busy.length > 0 && (
          <div className="cx2-legend">
            {busy.slice(0, 8).map((c) => (
              <button key={c.id} onClick={() => (setOpen(new Set([c.id])), setFilter('all'), setTimeout(() => document.querySelector(`[data-cx="${CSS.escape(c.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40))}>
                <i style={{ background: brandOf(c) }} />
                {c.name} <span className="num">{c.today!.requests}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="cx2-bar">
        <div className="cx2-seg" role="tablist" aria-label="Show">
          {(
            [
              ['all', 'All'],
              ['mac', 'On your Mac'],
              ['cloud', 'In the cloud'],
              ['attention', 'Needs attention']
            ] as [Filter, string][]
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {l}
              <span className="num">{counts[k]}</span>
            </button>
          ))}
        </div>
        <label className="cx2-search">
          <Icon name="search" size={13} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a service" aria-label="Find a service" />
          <kbd>/</kbd>
        </label>
      </div>

      <section className="cx2-table" aria-label="Connections">
        <div className="cx2-cols" aria-hidden="true">
          <span>Service</span>
          <span>Status</span>
          <span className="runs-col">Runs</span>
          <span className="uses-col">Used for</span>
          <span className="r">Today</span>
          <span className="r">Free</span>
          <span className="when-col">Last used</span>
          <span />
        </div>
        {groups.length ? (
          groups.map(({ g, rows }) => (
            <div key={g} className="cx2-group">
              <div className="cx2-group-h">
                {g}
                <span className="num">{rows.length}</span>
              </div>
              {rows.map((c) => (
                <Row key={c.id} c={c} open={open.has(c.id)} fresh={fresh === c.id} onToggle={() => toggle(c.id)} onChange={(next) => (setList(next), setCheckedAt(Date.now()))} />
              ))}
            </div>
          ))
        ) : (
          <p className="cx2-empty">{query ? `Nothing matches “${query}”.` : 'Nothing needs your attention.'}</p>
        )}
      </section>

      {toAdd.length > 0 && (
        <section className="cx2-add" aria-label="Add a connection">
          <div className="cx2-add-head">
            <h2>Add a connection</h2>
            <p>Free to start. Each says what it may see before you connect it.</p>
          </div>
          <div className="cx2-gallery">
            {toAdd.map((c) => (
              <AddCard key={c.id} c={c} recommended={RECOMMENDED.includes(c.id)} onAdded={(next) => added(next, c.id)} onSetUp={() => app.setView({ kind: 'settings', section: c.section as never })} />
            ))}
          </div>
        </section>
      )}
      <p className="cx2-more">
        <Icon name="plus" size={14} />
        Want Tide to use another service? Ask for it, and it joins this list with its own status, limits and privacy rules.
      </p>
    </div>
  )
}

const rank = (c: Connection) => {
  const i = RECOMMENDED.indexOf(c.id)
  return i < 0 ? 99 : i
}

function Allowance({ c }: { c: Connection }) {
  const share = c.credit?.share ?? c.dayShare
  if (share === undefined) return <span className="cx2-dash">—</span>
  const filled = share > 0 ? Math.max(1, Math.round(share * 10)) : 0
  return (
    <div className="cx2-allow" title={c.credit?.label ?? `${Math.round(share * 100)}% of today’s free allowance used`}>
      <div className={`cx2-cells${share > 0.85 ? ' full' : share > 0.65 ? ' hot' : ''}`}>
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < filled ? 'f' : ''} />
        ))}
      </div>
      <span className="num">{c.credit ? `${Math.round((1 - share) * 100)}% left this month` : `${Math.round((1 - share) * 100)}% left`}</span>
    </div>
  )
}

function Row({ c, open, fresh, onToggle, onChange }: { c: Connection; open: boolean; fresh: boolean; onToggle(): void; onChange(next: Connection[]): void }) {
  const app = useApp()
  const tone = STATE[c.state].tone
  const live = c.active && (c.id === 'local-model' || c.id === 'voice' || c.id === 'flow')
  return (
    <div className={`cx2-item${open ? ' open' : ''}${fresh ? ' fresh' : ''}`} data-cx={c.id}>
      <div className="cx2-row" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}>
        <div className="cx2-svc">
          <Mark c={c} />
          <div className="cx2-svc-text">
            <span className="cx2-name">{c.name}</span>
            <span className="cx2-sub">{c.detail}</span>
          </div>
        </div>
        <span className={`cx2-state t-${tone}${live ? ' live' : ''}`}>
          <i />
          {stateLabel(c)}
        </span>
        <span className={`cx2-runs ${c.runs}`}>
          <Icon name={c.runs === 'mac' ? 'laptop' : 'cloud'} size={14} />
          {c.runs === 'mac' ? 'This Mac' : 'Cloud'}
        </span>
        <div className="cx2-uses">
          {c.usedFor.slice(0, 2).map((u) => (
            <span key={u} className="cx2-chip">
              {u}
            </span>
          ))}
        </div>
        <span className="cx2-today-n num r">
          {c.today?.requests ? c.today.requests.toLocaleString('en-GB') : <span className="cx2-dash">0</span>}
          {c.today?.tokens ? <small>{tokens(c.today.tokens)} tok</small> : null}
        </span>
        <span className="r">
          <Allowance c={c} />
        </span>
        <span className="cx2-when">{whenUsed(c.lastUsed)}</span>
        <Icon name="chevron" size={14} className="cx2-chev" />
      </div>
      <div className="cx2-detail" aria-hidden={!open}>
        <div>
          <div className="cx2-detail-in">
            <Week c={c} />
            <div className="cx2-pane">
              <h4>Limits and cost</h4>
              {c.limits?.length ? (
                <dl className="cx2-kv">
                  {c.limits.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd className="num">{v}</dd>
                    </div>
                  ))}
                  {c.credit && (
                    <div>
                      <dt>This month</dt>
                      <dd className="num">{c.credit.label}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="cx2-quiet">No limits Tide needs to watch.</p>
              )}
            </div>
            <Access c={c} onChange={onChange} goTo={() => app.setView({ kind: 'settings', section: c.section as never })} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Week({ c }: { c: Connection }) {
  const days = weekDays()
  const week = c.week ?? []
  const max = Math.max(1, ...week)
  const sum = week.reduce((a, b) => a + b, 0)
  return (
    <div className="cx2-pane">
      <h4>
        Last 7 days <span className="num">{sum ? `${sum.toLocaleString('en-GB')} ${sum === 1 ? 'use' : 'uses'}` : 'Not used'}</span>
      </h4>
      <div className="cx2-chart" style={{ ['--brand' as string]: brandOf(c) }}>
        {week.map((v, i) => (
          <div key={i} className="cx2-col">
            <span className="cx2-tip num">
              {v} {v === 1 ? 'use' : 'uses'}
            </span>
            <b style={{ height: `${Math.max(3, (v / max) * 68)}px`, animationDelay: `${i * 40}ms` }} />
            <span className="cx2-day">{days[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Access({ c, onChange, goTo }: { c: Connection; onChange(next: Connection[]): void; goTo(): void }) {
  const app = useApp()
  const [test, setTest] = useState<{ busy?: boolean; ok?: boolean; message?: string }>({})
  const [replacing, setReplacing] = useState(false)
  const provider = isProvider(c.id) ? c.id.slice('provider:'.length) : null
  const keyed = canKey(c.id) && c.state !== 'needs-key'
  const main = provider && app.settings.cloud?.provider === provider
  const runTest = async () => {
    setTest({ busy: true })
    try {
      const t0 = Date.now()
      const r = provider ? await window.tide.cloud.test(provider, c.model ?? '') : await window.tide.ai.test()
      setTest({ ok: r.ok, message: r.ok ? `Answered in ${((Date.now() - t0) / 1000).toFixed(1)} s` : r.message })
    } catch (e) {
      setTest({ ok: false, message: errorText(e) })
    }
  }
  const forget = async () => {
    try {
      if (provider) await window.tide.cloud.setKey(provider, null)
      else await window.tide.connections.setKey(c.id, null)
      onChange(await window.tide.connections.list(true))
    } catch (e) {
      setTest({ ok: false, message: `Couldn’t remove the key: ${errorText(e)}` })
    }
  }
  return (
    <div className="cx2-pane">
      <h4>Privacy and access</h4>
      {(c.privacy || c.runs === 'mac') && (
        <p className="cx2-priv">
          <Icon name="check" size={13} />
          <span>{c.privacy ?? 'Runs on this Mac: nothing it handles leaves it.'}</span>
        </p>
      )}
      {keyed && !replacing && (
        <div className="cx2-key">
          <Icon name="settings" size={12} />
          <span>Key kept in your Keychain</span>
          <button className="btn small ghost" onClick={() => setReplacing(true)}>
            Replace
          </button>
        </div>
      )}
      {replacing && <KeyForm c={c} onDone={(next) => (setReplacing(false), next && onChange(next))} />}
      <div className="cx2-actions">
        {(provider || c.id === 'local-model') && c.state !== 'needs-key' && (
          <button className="btn small" onClick={runTest} disabled={test.busy}>
            {test.busy ? <span className="spinner" /> : <Icon name="play" size={12} />}
            {test.busy ? 'Testing…' : 'Test'}
          </button>
        )}
        {provider && keyed && !main && app.settings.cloud && (
          <button className="btn small" onClick={() => app.updateSettings({ cloud: { ...app.settings.cloud!, provider, model: c.model ?? app.settings.cloud!.model } })}>
            Make main
          </button>
        )}
        {!provider && !KEYED_HERE.has(c.id) && (
          <button className="btn small ghost" onClick={goTo}>
            Settings
          </button>
        )}
        {keyed && (
          <button className="btn small ghost" onClick={forget}>
            Remove key
          </button>
        )}
      </div>
      {test.message && <p className={`cx2-test ${test.ok ? 'ok' : 'bad'}`}>{test.message}</p>}
    </div>
  )
}

function AddCard({ c, recommended, onAdded, onSetUp }: { c: Connection; recommended: boolean; onAdded(next: Connection[]): void; onSetUp(): void }) {
  const [adding, setAdding] = useState(false)
  const [leaving, setLeaving] = useState(false)
  return (
    <article className={`cx2-card${leaving ? ' joined' : ''}`}>
      {recommended && <span className="cx2-rec">Recommended</span>}
      <div className="cx2-card-top">
        <Mark c={c} large />
        <div>
          <span className="cx2-card-name">{c.name}</span>
          <span className="cx2-card-runs">
            <Icon name={c.runs === 'mac' ? 'laptop' : 'cloud'} size={12} />
            {c.runs === 'mac' ? 'Runs on your Mac' : 'Cloud'}
          </span>
        </div>
      </div>
      <p>{c.usedFor.join(', ')}</p>
      {c.free && (
        <p className="cx2-free" title={c.free}>
          {c.free}
        </p>
      )}
      {c.privacy && <p className="cx2-quiet">{c.privacy}</p>}
      {adding ? (
        <KeyForm
          c={c}
          onDone={(next) => {
            setAdding(false)
            if (!next) return
            setLeaving(true)
            setTimeout(() => onAdded(next), 520)
          }}
        />
      ) : (
        <div className="cx2-card-foot">
          {canKey(c.id) ? (
            <button className="btn small primary" onClick={() => setAdding(true)}>
              Add key
            </button>
          ) : (
            <button className="btn small primary" onClick={onSetUp}>
              Set up
            </button>
          )}
          {c.keyUrl && (
            <button className="btn small ghost" onClick={() => window.tide.app.openExternal(c.keyUrl!)}>
              Get a key
              <Icon name="external" size={11} />
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/** A key, straight to your Keychain: a provider's through its own store, the rest through Connections */
function KeyForm({ c, onDone }: { c: Connection; onDone(next?: Connection[]): void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (!key.trim()) return
    setBusy(true)
    setError('')
    try {
      if (isProvider(c.id)) {
        await window.tide.cloud.setKey(c.id.slice('provider:'.length), key.trim())
        onDone(await window.tide.connections.list(true))
      } else onDone(await window.tide.connections.setKey(c.id, key.trim()))
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <form
      className="cx2-keyform"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <input type="password" autoFocus placeholder={`Paste your ${c.name} key`} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onDone()} aria-label={`${c.name} key`} />
      <button className="btn small primary" disabled={!key.trim() || busy}>
        {busy ? 'Saving…' : 'Connect'}
      </button>
      {error && <span className="set-error">{error}</span>}
    </form>
  )
}
