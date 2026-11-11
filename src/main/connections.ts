/**
 * The state of every connection, for the Connections page: model providers (from shared/providers)
 * and the other services (shared/connections), each checked quickly and in parallel, with today's
 * use and when it was last used. Checks that start a process or reach the network give up after a
 * few seconds; the whole list is kept for twenty seconds.
 */
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { SERVICES, type Connection, type ConnectionInfo, type ConnectionState } from '@shared/connections'
import { PROVIDERS, providerInfo } from '@shared/providers'
import { cloudSettings, coolingDown, dayShare, getKey, hasKeys, readUsage } from './cloud'
import { useOf, weekOf } from './connectionUse'
import { metabaseReady } from './metabase'
import { getSettings } from './settings'
import { studyApiStatus } from './studyApi'

const within = <T,>(ms: number, p: Promise<T>, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

const startOfDay = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Services with a credit or monthly allowance rather than a daily one: what Tide counts against it */
const CREDITS: Record<string, { limit: number; lifetime?: boolean; label: (used: number) => string }> = {
  you: { limit: 18_000, lifetime: true, label: (n) => `${n.toLocaleString('en-GB')} of about 18,000 searches the credit allows` },
  firecrawl: { limit: 950, label: (n) => `${n.toLocaleString('en-GB')} of 950 pages this month` }
}

let cache: { at: number; list: Promise<Connection[]> } | null = null

export function listConnections(fresh = false): Promise<Connection[]> {
  if (!fresh && cache && Date.now() - cache.at < 20_000) return cache.list
  const list = build().catch(() => [] as Connection[])
  cache = { at: Date.now(), list }
  return list
}

async function build(): Promise<Connection[]> {
  const s = getSettings()
  const cloud = cloudSettings()
  const keys = hasKeys()
  const month = readUsage(Date.now() - 31 * 86_400_000)
  const today = month.filter((r) => r.at >= startOfDay())
  const lastOf = (pred: (r: (typeof month)[number]) => boolean) => month.filter(pred).reduce((n, r) => Math.max(n, r.at), 0) || undefined
  // Requests on each of the last seven days, oldest first
  // Calendar days, so a clock change doesn't skip or repeat one
  const dayStart = (i: number) => {
    const d = new Date(startOfDay())
    d.setDate(d.getDate() - i)
    return d.getTime()
  }
  const weekBy = (pred: (r: (typeof month)[number]) => boolean) =>
    Array.from({ length: 7 }, (_, i) => month.filter((r) => r.at >= dayStart(6 - i) && r.at < dayStart(5 - i) && pred(r)).length)
  const fmt = (n: number) => n.toLocaleString('en-GB')

  // Model providers: each that has a key or needs none, and the ones you could add
  const providerIds = [...new Set([...PROVIDERS.map((p) => p.id), ...Object.keys(cloud.providers ?? {})])]
  const providers: Connection[] = providerIds.map((id) => {
    const p = providerInfo(id, cloud)
    const keyed = !!keys[id] || !!p.keyless
    const used = today.filter((r) => r.kind === 'cloud' && r.provider === id)
    const models = [...new Set(used.map((r) => r.model))]
    const share = models.length ? Math.max(...models.map((model) => dayShare({ provider: id, model }))) : 0
    const resting = keyed && models.length > 0 && models.every((model) => coolingDown({ provider: id, model }))
    const state: ConnectionState = !keyed ? 'needs-key' : cloud.mode === 'off' ? 'off' : resting ? 'resting' : 'ready'
    const info: ConnectionInfo = {
      id: `provider:${id}`,
      name: p.name,
      kind: 'model',
      runs: 'cloud',
      usedFor: id === cloud.provider ? ['Hard maths', 'Marking', 'Planning', 'Checks'] : ['Backup when the main one is busy'],
      free: p.freeTier,
      keyUrl: p.keyUrl,
      privacy: 'Never sees a private project or your Metabase.',
      section: 'models'
    }
    return {
      ...info,
      state,
      active: keyed && cloud.mode !== 'off',
      detail: !keyed ? 'Add a key to use it' : cloud.mode === 'off' ? 'The cloud helper is off' : resting ? 'Resting: it hit a limit, back shortly' : id === cloud.provider ? `Main cloud model: ${cloud.model}` : p.keyless ? 'No key needed: a backup' : 'Ready as a backup',
      lastUsed: lastOf((r) => r.kind === 'cloud' && r.provider === id),
      today: { requests: used.length, tokens: used.reduce((n, r) => n + r.input + r.output, 0) },
      ...(share || p.perDay ? { dayShare: share } : {}),
      week: weekBy((r) => r.kind === 'cloud' && r.provider === id),
      model: id === cloud.provider ? cloud.model : (p.jobs?.maths ?? p.models[0]?.id),
      limits: [
        ...(p.perDay?.requests ? [['Free each day', `${fmt(p.perDay.requests)} requests`] as [string, string]] : []),
        ...(p.perDay?.tokens ? [['Free tokens', `${fmt(p.perDay.tokens)} a day`] as [string, string]] : []),
        ...(p.perMinute ? [['Per minute', `${p.perMinute} requests`] as [string, string]] : []),
        ['Used today', `${fmt(used.length)} requests, ${fmt(used.reduce((n, r) => n + r.input + r.output, 0))} tokens`] as [string, string],
        ...(!p.perDay && p.summary ? [['Plan', p.summary] as [string, string]] : [])
      ]
    }
  })

  const search = s.ai.webSearch?.provider ?? 'wikipedia'
  const dictation = s.voice?.dictation ?? 'tide'
  const home = homedir()
  const services = await Promise.all(
    SERVICES.map(async (info): Promise<Connection> => {
      const use = useOf(info.id)
      const credit = CREDITS[info.id]
      const base = {
        ...info,
        lastUsed: use.last,
        today: use.today ? { requests: use.today } : undefined,
        week: weekOf(info.id),
        limits: info.free ? ([['Free', info.free]] as [string, string][]) : [],
        ...(credit ? { credit: { share: Math.min(1, (credit.lifetime ? use.total : use.thisMonth) / credit.limit), label: credit.label(credit.lifetime ? use.total : use.thisMonth) } } : {})
      }
      const as = (state: ConnectionState, detail: string, active = state === 'connected' || state === 'ready'): Connection => ({ ...base, state, detail, active })
      switch (info.id) {
        case 'local-model': {
          const r = await within(2500, fetch(`${s.ai.baseUrl.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(2500) }).then((x) => x.json() as Promise<{ data?: { id: string; loaded?: boolean }[] }>), null)
          const loaded = r?.data?.find((m) => m.loaded) ?? r?.data?.find((m) => m.id === s.ai.model)
          const local = month.filter((x) => x.kind === 'local')
          return { ...base, state: r ? 'connected' : 'error', active: !!r, detail: r ? `Running: ${(loaded?.id ?? s.ai.model ?? 'a model').split('/').pop()}` : `Not answering at ${s.ai.baseUrl}`, lastUsed: lastOf((x) => x.kind === 'local'), today: { requests: today.filter((x) => x.kind === 'local').length, tokens: local.filter((x) => x.at >= startOfDay()).reduce((n, x) => n + x.input + x.output, 0) }, week: weekBy((x) => x.kind === 'local'), limits: [['Cost', 'Free: runs on your Mac'], ['Server', s.ai.baseUrl]] }
        }
        case 'wikipedia':
          return as('ready', search === 'wikipedia' ? 'Your web search: free, no key' : 'Used for readings, and when search is down')
        case 'searxng': {
          const { searchStatus } = await import('./websearch')
          const st = await within(4000, searchStatus(), { ready: false, detail: 'Didn’t answer in time' })
          return as(st.ready ? 'connected' : 'not-set-up', search === 'searxng' ? st.detail : !st.ready ? st.detail : search === 'auto' ? 'Used for private lessons, and when You.com can’t answer' : 'Set up, not your search now', st.ready && (search === 'searxng' || search === 'auto'))
        }
        case 'brave':
        case 'tavily': {
          // The same places the search reads its key from: the Keychain, or settings from an older version
          const chosen = search === info.id
          const key = !!getKey(info.id) || (chosen && !!s.ai.webSearch?.apiKey)
          return as(key ? 'connected' : 'needs-key', !key ? 'Add a key to use it' : chosen ? 'Your web search' : 'Key saved, not your search now', key && chosen)
        }
        case 'you':
        case 'firecrawl': {
          const key = !!getKey(info.id)
          if (info.id === 'firecrawl') return as(key ? 'connected' : 'needs-key', key ? 'Reads pages the plain reader can’t' : 'Add a key to use it')
          return as(key ? 'connected' : 'needs-key', !key ? 'Add a key to use it' : search === 'you' ? 'Your web search' : search === 'auto' ? 'Your web search, while its credit lasts' : 'Key saved: choose it as your search in Tools', key && (search === 'you' || search === 'auto'))
        }
        case 'arxiv':
        case 'openlibrary':
          return as('ready', 'Free, no key')
        case 'voice': {
          const { voiceStatus } = await import('./voice')
          const st = await within(5000, voiceStatus(), { ready: false, detail: 'Didn’t answer in time' })
          return as(st.ready ? 'connected' : 'not-set-up', st.detail)
        }
        case 'deepgram': {
          const key = !!getKey('deepgram')
          return as(key ? 'connected' : 'needs-key', key ? (dictation === 'deepgram' ? 'Your dictation' : 'Key saved, not your dictation now') : 'Add a key to use it', key && dictation === 'deepgram')
        }
        case 'flow': {
          const installed = existsSync('/Applications/Wispr Flow.app')
          return as(installed ? 'connected' : 'not-set-up', installed ? (dictation === 'flow' ? 'Your dictation' : 'Installed, not your dictation now') : 'Not installed', installed && dictation === 'flow')
        }
        case 'handy': {
          const installed = existsSync(join(home, 'Library', 'Application Support', 'com.pais.handy', 'settings_store.json'))
          return as(installed ? 'connected' : 'not-set-up', installed ? (dictation === 'handy' ? 'Your dictation' : 'Installed, not your dictation now') : 'Not installed', installed && dictation === 'handy')
        }
        case 'things': {
          const { thingsStatus } = await import('./things')
          const st = await within(3000, thingsStatus(), { ready: false, detail: 'Didn’t answer in time' })
          return as(st.ready ? 'connected' : 'not-set-up', st.detail)
        }
        case 'metabase':
          return metabaseReady() ? as('connected', 'Connected, read-only') : as('not-set-up', 'Not connected', false)
        case 'study-api': {
          const st = studyApiStatus()
          return st.running ? as('connected', `Serving at ${st.url}`) : as('off', 'Off', false)
        }
        case 'maths':
        case 'libraries':
        case 'lab': {
          const { mathStatus, librariesStatus, labStatus } = await import('./runner')
          const st = await within(5000, info.id === 'maths' ? mathStatus() : info.id === 'lab' ? labStatus() : librariesStatus(), { ready: false, detail: 'Didn’t answer in time' })
          return as(st.ready ? 'connected' : 'not-set-up', st.detail)
        }
        default:
          return as('not-set-up', '')
      }
    })
  )
  return [...services.slice(0, 1), ...providers, ...services.slice(1)]
}
