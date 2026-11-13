/**
 * Production incident drills. A page goes off; the learner diagnoses by asking for data (logs,
 * metrics, deploys, traces, a query), stating hypotheses and taking actions, then names the root
 * cause. Each scenario is a small, consistent system: every piece of data it can show is written
 * down here, so a drill runs and is graded the same with or without Claude. With Claude, Opus plays
 * the system (answering free-form requests from this data and the hidden truth) and the on-call
 * partner; the grade is still worked out here, from what was asked and done, and when.
 *
 * Graded on method (data before action, hypotheses stated, the relevant evidence looked at, nothing
 * harmful), speed (to mitigation and to the root cause, against the clock) and correctness (the
 * root cause named, the real fix applied). A blameless post-mortem follows (shared/sharpPostmortem).
 */
import type { MethodId } from './sharpMethods'
import { parseJsonObject } from './sharpness'

export interface IncidentSource {
  id: string
  /** What it is, as offered to the learner ("Checkout API logs") */
  label: string
  /** Words in a request that fetch it (any one, case-insensitive) */
  cues: string[]
  /** What the system shows: log lines, a metric table, a diff */
  data: string
  /** Evidence that points to the root cause */
  relevant: boolean
}

export type ActionEffect = 'mitigates' | 'fixes' | 'harmful' | 'neutral'

export interface IncidentAction {
  id: string
  /** Words in an action that mean this one */
  cues: string[]
  effect: ActionEffect
  /** What happens when it is done */
  reply: string
}

export interface IncidentScenario {
  id: string
  title: string
  difficulty: number
  pattern: string
  methods: MethodId[]
  minutes: number
  /** The page, as it arrives */
  page: string
  /** The system, as the on-call runbook describes it */
  system: string
  sources: IncidentSource[]
  rootCause: { summary: string; cues: string[] }
  actions: IncidentAction[]
  /** The reference post-mortem: timeline, cause, contributing factors, action items */
  postmortem: string
  origin: 'bank' | 'claude'
}

export type PublicIncident = Pick<IncidentScenario, 'id' | 'title' | 'difficulty' | 'minutes' | 'page' | 'system' | 'origin'> & { sources: { id: string; label: string }[] }

export const publicIncident = (s: IncidentScenario): PublicIncident => ({ id: s.id, title: s.title, difficulty: s.difficulty, minutes: s.minutes, page: s.page, system: s.system, origin: s.origin, sources: s.sources.map((x) => ({ id: x.id, label: x.label })) })

// ---------- The drill ----------

export type DrillKind = 'ask' | 'hypothesis' | 'action' | 'resolve'

export interface DrillEntry {
  at: number
  kind: DrillKind
  /** What the learner said */
  text: string
  /** What the system (or the partner) answered */
  reply: string
  source?: string
  effect?: ActionEffect
}

export interface DrillState {
  startedAt: number
  entries: DrillEntry[]
  asked: string[]
  hypotheses: string[]
  mitigatedAt?: number
  fixedAt?: number
  resolved?: { text: string; at: number; right: boolean }
}

export const freshDrill = (now: number): DrillState => ({ startedAt: now, entries: [], asked: [], hypotheses: [] })

const words = (t: string) => t.toLowerCase()
const hits = (text: string, cues: string[]) => cues.filter((c) => words(text).includes(c.toLowerCase())).length

/** The source a request is for: the one with the most cue words in it, or null */
export function matchSource(s: IncidentScenario, request: string): IncidentSource | null {
  let best: IncidentSource | null = null
  let n = 0
  for (const src of s.sources) {
    const k = hits(request, src.cues)
    if (k > n) {
      best = src
      n = k
    }
  }
  return best
}

export function matchAction(s: IncidentScenario, action: string): IncidentAction | null {
  let best: IncidentAction | null = null
  let n = 0
  for (const a of s.actions) {
    const k = hits(action, a.cues)
    if (k > n) {
      best = a
      n = k
    }
  }
  return best
}

const menu = (s: IncidentScenario) => `Nothing comes back for that. You can look at: ${s.sources.map((x) => x.label.toLowerCase()).join('; ')}.`

/** A request for data: what comes back, from the scenario (main may have Claude say it in the system's voice) */
export function askData(s: IncidentScenario, st: DrillState, request: string, now: number, voiced?: string): { state: DrillState; reply: string; source: IncidentSource | null } {
  const src = matchSource(s, request)
  const reply = voiced?.trim() || (src ? `${src.label}\n\n${src.data}` : menu(s))
  const entry: DrillEntry = { at: now - st.startedAt, kind: 'ask', text: request, reply, ...(src ? { source: src.id } : {}) }
  return { state: { ...st, entries: [...st.entries, entry], asked: src && !st.asked.includes(src.id) ? [...st.asked, src.id] : st.asked }, reply, source: src }
}

export function hypothesise(st: DrillState, text: string, now: number, reply = 'Noted.'): DrillState {
  return { ...st, hypotheses: [...st.hypotheses, text], entries: [...st.entries, { at: now - st.startedAt, kind: 'hypothesis', text, reply }] }
}

export function act(s: IncidentScenario, st: DrillState, text: string, now: number, voiced?: string): { state: DrillState; reply: string; effect: ActionEffect } {
  const a = matchAction(s, text)
  const effect: ActionEffect = a?.effect ?? 'neutral'
  const reply = voiced?.trim() || a?.reply || 'Done. Nothing on the dashboards moves.'
  const at = now - st.startedAt
  return {
    state: {
      ...st,
      entries: [...st.entries, { at, kind: 'action', text, reply, effect }],
      ...(effect === 'mitigates' && st.mitigatedAt === undefined ? { mitigatedAt: at } : {}),
      ...(effect === 'fixes' ? { fixedAt: st.fixedAt ?? at, mitigatedAt: st.mitigatedAt ?? at } : {})
    },
    reply,
    effect
  }
}

/** The root cause named: right when it carries at least two of the cause's cue words (or Opus said so) */
export function rootCauseRight(s: IncidentScenario, text: string): boolean {
  const need = Math.min(2, s.rootCause.cues.length)
  return hits(text, s.rootCause.cues) >= need
}

export function resolve(s: IncidentScenario, st: DrillState, text: string, now: number, judged?: boolean): DrillState {
  const right = judged ?? rootCauseRight(s, text)
  const at = now - st.startedAt
  return { ...st, resolved: { text, at, right }, entries: [...st.entries, { at, kind: 'resolve', text, reply: right ? 'That matches what happened.' : 'That isn’t what happened.' }] }
}

export interface DrillScore {
  method: number
  speed: number
  correctness: number
  overall: number
  notes: string[]
}

/** The drill's grade, from what was asked and done and when */
export function scoreDrill(s: IncidentScenario, st: DrillState): DrillScore {
  const notes: string[] = []
  const firstAction = st.entries.find((e) => e.kind === 'action')
  const before = (k: DrillKind) => st.entries.some((e) => e.kind === k && (!firstAction || e.at <= firstAction.at))
  const relevant = s.sources.filter((x) => x.relevant)
  const seen = relevant.filter((x) => st.asked.includes(x.id)).length
  const harmful = st.entries.filter((e) => e.effect === 'harmful').length
  let method = 0
  if (before('ask')) method += 0.25
  else notes.push('You acted before looking at any data.')
  if (before('hypothesis') || (st.hypotheses.length && !firstAction)) method += 0.25
  else notes.push('Say a hypothesis out loud before you act: it makes the next check obvious.')
  method += 0.35 * (relevant.length ? seen / relevant.length : 1)
  if (relevant.length && seen < relevant.length) notes.push(`You looked at ${seen} of the ${relevant.length} pieces of evidence that pointed at the cause.`)
  method += harmful ? 0 : 0.15
  if (harmful) notes.push(`${harmful} action${harmful === 1 ? '' : 's'} made things worse.`)

  const limit = s.minutes * 60_000
  const fade = (ms: number | undefined) => (ms === undefined ? 0 : ms <= limit * 0.5 ? 1 : ms <= limit * 1.5 ? 1 - ((ms - limit * 0.5) / limit) * 0.7 : 0.3)
  const speed = Math.round((0.5 * fade(st.mitigatedAt) + 0.5 * fade(st.resolved?.at)) * 100) / 100
  if (st.mitigatedAt === undefined) notes.push('Users were never protected: mitigate first (roll back, fail over, shed load), then dig.')

  const correctness = (st.resolved?.right ? 0.7 : 0) + (st.fixedAt !== undefined ? 0.3 : 0)
  if (!st.resolved?.right) notes.push(`The root cause: ${s.rootCause.summary}`)
  else if (st.fixedAt === undefined) notes.push('You named the cause but didn’t apply the lasting fix.')

  const overall = Math.round((0.4 * Math.min(1, method) + 0.2 * speed + 0.4 * correctness) * 100) / 100
  return { method: Math.round(Math.min(1, method) * 100) / 100, speed, correctness: Math.round(correctness * 100) / 100, overall, notes }
}

// ---------- With Claude: Opus plays the system ----------

export const SYSTEM_PLAYER =
  'You play a production system during an incident drill, and the learner’s on-call partner. Answer only from the scenario’s truth and its data: invent nothing that contradicts them, never name the root cause, never suggest the fix. Format system output as it would really look (log lines, a metric table, command output), as plain text with no Markdown fences. When the learner asks for data or acts, you are only the system: show the output and nothing else, no commentary, no questions, no pointers to what matters. Only when they state a hypothesis do you speak, as the partner. Plain and short.'

export function playerPrompt(s: IncidentScenario, st: DrillState, kind: 'ask' | 'action' | 'hypothesis', text: string, src: IncidentSource | null, effect?: ActionEffect): string {
  const history = st.entries.slice(-8).map((e) => `[${e.kind}] ${e.text}`).join('\n')
  return [
    `Scenario: ${s.title}. The page: ${s.page}`,
    `The system: ${s.system}`,
    `Hidden truth (never say it): ${s.rootCause.summary}`,
    `All the data the system has:\n${s.sources.map((x) => `## ${x.label}\n${x.data}`).join('\n\n')}`,
    history ? `What happened so far:\n${history}` : '',
    kind === 'ask'
      ? `The learner asks for: "${text}". ${src ? `This is the "${src.label}" data: show it as the system would, adding nothing that isn't consistent with it.` : 'No source matches: answer as the system would if it can be answered from the data above; otherwise say what isn’t available and list what is.'}`
      : kind === 'action'
        ? `The learner does: "${text}". Its effect is ${effect ?? 'neutral'}: describe what the dashboards and logs show in the next minutes.`
        : `The learner's hypothesis: "${text}". As the on-call partner, reply in one or two sentences: a question that helps them test it (which data would confirm or refute it). Don't say if it is right.`
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ---------- Claude writes a scenario; Tide checks it ----------

export function incidentWriterPrompt(o: { difficulty: number; avoid: string[]; fields: string }): string {
  return [
    `Write one original production incident drill at about rating ${o.difficulty} (1250 a routine page, 1650 a senior on-call incident, 2000 a novel multi-system outage), set in ${o.fields}.`,
    o.avoid.length ? `Not any of these: ${o.avoid.join('; ')}.` : '',
    'JSON shape: {"title": str, "pattern": str, "methods": [method ids from: understand, simplify, small-cases, invariant, backwards, generalise, analogy, draw, edges, estimate], "page": "the alert as it arrives", "system": "the system in 3 to 5 sentences", "sources": [{"id": str, "label": str, "cues": [request words], "data": "realistic log lines, metric tables, diffs or command output", "relevant": bool}] (6 to 9 sources, 3 or more relevant, at least 2 red herrings), "rootCause": {"summary": str, "cues": [3 to 6 words a correct diagnosis would use]}, "actions": [{"id": str, "cues": [str], "effect": "mitigates"|"fixes"|"harmful"|"neutral", "reply": "what happens"}] (5 to 8, at least one of each of mitigates, fixes and harmful), "postmortem": "a blameless reference post-mortem in Markdown"}',
    'The evidence must lead to the cause by reasoning: no source states the cause outright. The title and the page name the symptom only, never the cause.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** A written scenario, checked: enough sources and evidence, every kind of action, and no source that gives the cause away */
export function draftIncident(raw: Record<string, unknown> | null, id: string, difficulty: number): IncidentScenario | { error: string } {
  if (!raw) return { error: 'not JSON' }
  const str = (x: unknown, n = 6000) => (typeof x === 'string' ? x.slice(0, n) : '')
  const arr = (x: unknown) => (Array.isArray(x) ? x : [])
  const strs = (x: unknown) => arr(x).filter((v): v is string => typeof v === 'string' && v.trim().length >= 2).map((v) => v.toLowerCase().slice(0, 60))
  const sources: IncidentSource[] = arr(raw.sources).flatMap((x, i) => {
    const o = x as Record<string, unknown>
    const data = str(o?.data, 4000)
    const cues = strs(o?.cues)
    return o && data.length >= 40 && cues.length ? [{ id: str(o.id, 40) || `s${i}`, label: str(o.label, 80) || `Source ${i + 1}`, cues, data, relevant: o.relevant === true }] : []
  })
  const rc = (raw.rootCause ?? {}) as Record<string, unknown>
  const rootCause = { summary: str(rc.summary, 600), cues: strs(rc.cues) }
  const actions: IncidentAction[] = arr(raw.actions).flatMap((x, i) => {
    const o = x as Record<string, unknown>
    const effect = o?.effect
    return o && (effect === 'mitigates' || effect === 'fixes' || effect === 'harmful' || effect === 'neutral') && strs(o.cues).length ? [{ id: str(o.id, 40) || `a${i}`, cues: strs(o.cues), effect, reply: str(o.reply, 600) || 'Done.' }] : []
  })
  const page = str(raw.page, 1000)
  const title = str(raw.title, 120)
  if (!title || page.length < 20) return { error: 'missing a title or the page' }
  if (sources.length < 5) return { error: `only ${sources.length} usable sources; at least 5 are needed` }
  if (sources.filter((x) => x.relevant).length < 2) return { error: 'fewer than 2 relevant sources' }
  if (rootCause.cues.length < 2 || !rootCause.summary) return { error: 'the root cause needs a summary and at least 2 cue words' }
  for (const e of ['mitigates', 'fixes', 'harmful'] as const) if (!actions.some((a) => a.effect === e)) return { error: `no action that ${e === 'harmful' ? 'makes it worse' : e}` }
  const told = rootCause.cues.filter((c) => c.length >= 4 && (words(title).includes(c) || words(page).includes(c)))
  if (told.length >= 2) return { error: `the title or page gives the cause away (${told.join(', ')}); name the symptom only` }
  const giveaway = sources.find((x) => words(x.data).includes(words(rootCause.summary).slice(0, 60)))
  if (giveaway) return { error: `the source "${giveaway.label}" states the root cause outright` }
  return {
    id,
    title,
    difficulty,
    pattern: str(raw.pattern, 80) || title,
    methods: strs(raw.methods).filter((m): m is MethodId => ['understand', 'simplify', 'small-cases', 'invariant', 'backwards', 'generalise', 'analogy', 'draw', 'edges', 'estimate'].includes(m)),
    minutes: 30,
    page,
    system: str(raw.system, 1500),
    sources,
    rootCause,
    actions,
    postmortem: str(raw.postmortem, 6000) || rootCause.summary,
    origin: 'claude'
  }
}

export const parseIncident = (text: string, id: string, difficulty: number) => draftIncident(parseJsonObject(text), id, difficulty)

// ---------- The bank ----------

export const INCIDENTS: IncidentScenario[] = [
  {
    id: 'latency-3am',
    title: 'Latency spike at 3 a.m.',
    difficulty: 1350,
    pattern: 'a scheduled job starves a shared pool',
    methods: ['draw', 'understand'],
    minutes: 30,
    page: '03:04 PAGE: checkout-api p99 latency 4.8 s (SLO 800 ms) for 5 minutes. Error rate 2.1% (timeouts).',
    system: 'checkout-api (12 pods, Go) serves the store’s checkout. It reads and writes a Postgres primary through a connection pool of 40 per pod, and calls payments-api over HTTP. Nightly jobs run from a cron runner against the same database.',
    sources: [
      { id: 'api-logs', label: 'checkout-api logs', cues: ['log', 'checkout-api', 'api log', 'errors'], relevant: true, data: '03:01:12 WARN  db: acquire conn waited 2.91s (pool=40 in_use=40 idle=0)\n03:01:13 ERROR POST /checkout 504 after 5000ms: context deadline exceeded (acquiring db conn)\n03:02:40 WARN  db: acquire conn waited 3.40s (pool=40 in_use=40 idle=0)\n03:03:02 INFO  payments-api call ok 182ms' },
      { id: 'db-metrics', label: 'Postgres metrics', cues: ['postgres', 'database', 'db metric', 'db', 'cpu', 'connections'], relevant: true, data: 'time   cpu   active_conns  waiting_locks  slow_queries/min\n02:55  31%   210           0              2\n03:00  88%   478           3              41\n03:04  91%   480 (max 500) 5              57' },
      { id: 'slow-queries', label: 'Slow query log', cues: ['slow query', 'pg_stat', 'query log', 'slow queries', 'pg_stat_activity'], relevant: true, data: 'pid 81231 app=report-runner 03:00:02 running 4m01s: SELECT o.*, li.* FROM orders o JOIN line_items li ... WHERE o.created_at > now() - interval \'90 days\' ORDER BY ...\npid 81232 app=report-runner (parallel worker) same query\napp=checkout-api 50+ queries: SELECT ... FROM carts WHERE id=$1 (waiting for conn)' },
      { id: 'cron', label: 'Cron runner schedule', cues: ['cron', 'schedule', 'job', 'batch', 'nightly'], relevant: true, data: '0 3 * * *  report-runner  finance_90d_export  (added 2 days ago, PR #4412)\n30 2 * * * vacuum-analyze  (unchanged)\n0 4 * * *  backups          (unchanged)' },
      { id: 'deploys', label: 'Deploy history', cues: ['deploy', 'release', 'rollout', 'change'], relevant: false, data: 'checkout-api v2.41.0  yesterday 16:20  (copy change on receipt email)\npayments-api v8.3.2   3 days ago\nNo deploys in the last 10 hours.' },
      { id: 'payments', label: 'payments-api dashboard', cues: ['payment', 'payments-api', 'downstream', 'dependency'], relevant: false, data: 'payments-api p99 190 ms, error rate 0.02%, normal for the hour.' },
      { id: 'pods', label: 'Pod health', cues: ['pod', 'kubectl', 'memory', 'restart', 'k8s', 'kubernetes'], relevant: false, data: 'checkout-api: 12/12 Ready, 0 restarts, CPU 22%, memory 41%.' }
    ],
    rootCause: { summary: 'A new 3 a.m. report job (finance_90d_export) runs a heavy 90-day join on the primary, saturating its CPU and connections, so checkout-api waits for database connections and times out.', cues: ['report', 'cron', 'job', 'export', 'primary', 'connection', 'pool', 'saturat'] },
    actions: [
      { id: 'kill-job', cues: ['kill', 'cancel', 'terminate', 'pg_cancel', 'stop the job', 'stop the report'], effect: 'mitigates', reply: 'pg_terminate_backend(81231, 81232). Within a minute DB CPU falls to 35%, connection waits disappear, checkout p99 back to 420 ms.' },
      { id: 'replica', cues: ['replica', 'read replica', 'move the job', 'warehouse', 'reschedule'], effect: 'fixes', reply: 'The job is pointed at the read replica with a statement timeout, and moved to the warehouse export next sprint. Tomorrow at 03:00 checkout stays at 400 ms.' },
      { id: 'restart-pods', cues: ['restart', 'bounce', 'rollout restart'], effect: 'harmful', reply: 'Pods restart and all reconnect at once: 480 → 500 connections, "too many clients" errors, error rate 9% for three minutes.' },
      { id: 'scale-pods', cues: ['scale', 'more pods', 'replicas up', 'hpa'], effect: 'harmful', reply: 'More pods open more connections to a database that is already full: waits get longer.' },
      { id: 'rollback', cues: ['roll back', 'rollback', 'revert'], effect: 'neutral', reply: 'checkout-api rolled back to v2.40.3. No change: p99 still 4.6 s.' },
      { id: 'pool', cues: ['pool size', 'increase pool', 'bigger pool', 'max connections'], effect: 'neutral', reply: 'The pool can’t grow: Postgres is at 480 of 500 connections.' }
    ],
    postmortem: '**Summary.** For 22 minutes from 03:00, checkout p99 was 4–5 s and 2% of checkouts timed out.\n\n**Cause.** A finance export added two days earlier ran a 90-day join on the primary at 03:00, taking CPU to 90% and connections near the limit; checkout requests waited for pool connections.\n\n**Contributing factors.** Batch work allowed on the primary; no statement timeout for batch roles; the new cron entry wasn’t reviewed for load.\n\n**Action items.** Batch roles on the replica only, with statement timeouts; a per-application connection limit; alert on pool wait time, not only latency.',
    origin: 'bank'
  },
  {
    id: 'memory-leak',
    title: 'Pods restarting every few hours',
    difficulty: 1450,
    pattern: 'unbounded in-process cache',
    methods: ['estimate', 'draw'],
    minutes: 30,
    page: '14:12 PAGE: pricing-svc OOMKilled 9 times in 6 hours; 1.5% of quote requests failing during restarts.',
    system: 'pricing-svc (Python, 8 pods, 2 GiB memory limit) returns quotes. It keeps an in-process cache of FX rates and per-customer price lists, and reads from Redis and Postgres.',
    sources: [
      { id: 'mem', label: 'Memory per pod', cues: ['memory', 'rss', 'heap', 'oom', 'graph'], relevant: true, data: 'Each pod: RSS climbs linearly from 300 MiB at start, about 280 MiB/hour, until 2 GiB → OOMKilled. Started this pattern on Tuesday; before Tuesday flat at 450 MiB.' },
      { id: 'deploys', label: 'Deploy history', cues: ['deploy', 'release', 'what changed', 'history'], relevant: true, data: 'Tuesday 10:02 pricing-svc v5.0.0: "per-customer quote cache for faster repeat quotes" (PR #918)\nMonday: Redis client upgrade 4.5 → 4.6' },
      { id: 'diff', label: 'PR #918 diff', cues: ['#918', 'pr 918', 'diff', 'code', 'source'], relevant: true, data: '+ _quote_cache: dict[tuple, Quote] = {}\n+ def quote(customer_id, sku, qty, ts):\n+     key = (customer_id, sku, qty, ts)\n+     if key in _quote_cache: return _quote_cache[key]\n+     q = compute_quote(...)\n+     _quote_cache[key] = q\n+     return q' },
      { id: 'heap', label: 'Heap profile (tracemalloc top)', cues: ['profile', 'tracemalloc', 'heap dump', 'allocation', 'objects'], relevant: true, data: 'pricing/quotes.py:41  size=1.31 GiB  count=4,912,330  (Quote objects in _quote_cache)\nfx/rates.py:12       size=3.2 MiB\nredis/connection.py  size=1.1 MiB' },
      { id: 'redis', label: 'Redis metrics', cues: ['redis'], relevant: false, data: 'Redis memory 3.1 GiB of 8, hit rate 97%, latency p99 1.2 ms. Normal.' },
      { id: 'traffic', label: 'Traffic', cues: ['traffic', 'requests', 'rps', 'qps', 'load'], relevant: false, data: 'Quote requests 1,400/s, same as last week.' },
      { id: 'logs', label: 'pricing-svc logs', cues: ['log', 'errors', 'stderr'], relevant: false, data: '14:01:07 INFO quote ok 23ms\n14:01:08 WARN redis retry (1/3) connection reset\n14:01:08 INFO quote ok 31ms\n(no errors before each OOMKill)' }
    ],
    rootCause: { summary: 'PR #918 added an unbounded in-process quote cache keyed by timestamp, so every request adds an entry that is never reused or evicted: memory grows until the pod is OOMKilled.', cues: ['cache', 'unbounded', 'evict', 'timestamp', 'never', 'quote_cache', '#918', 'ttl', 'lru'] },
    actions: [
      { id: 'rollback', cues: ['roll back', 'rollback', 'revert', 'v4'], effect: 'mitigates', reply: 'Rolled back to v4.9.3. Memory flat at 450 MiB for the next hour; no more OOMKills.' },
      { id: 'bound', cues: ['lru', 'bound', 'maxsize', 'ttl', 'drop the timestamp', 'evict'], effect: 'fixes', reply: 'Cache keyed without the timestamp and bounded (LRU, 50k entries, 60 s TTL). Memory steady at 520 MiB; repeat quotes still fast.' },
      { id: 'raise-limit', cues: ['raise the limit', 'more memory', 'increase memory', '4 gib', 'limit'], effect: 'neutral', reply: 'Limit raised to 4 GiB: pods now die every 13 hours instead of 6.' },
      { id: 'restart-cron', cues: ['restart', 'cron restart', 'periodic restart'], effect: 'neutral', reply: 'A nightly restart hides it until traffic grows.' },
      { id: 'redis-rollback', cues: ['redis client', 'downgrade redis'], effect: 'neutral', reply: 'Redis client downgraded: memory climbs exactly as before.' },
      { id: 'flush-redis', cues: ['flush', 'flushall'], effect: 'harmful', reply: 'Redis flushed: every quote misses the cache, Postgres load triples, p99 quote latency 900 ms.' }
    ],
    postmortem: '**Summary.** Over three days pricing-svc pods were OOMKilled every 5–7 hours; 1.5% of quotes failed during restarts.\n\n**Cause.** A per-customer quote cache (v5.0.0) used the request timestamp in its key and had no bound, so it never hit and never evicted.\n\n**Contributing factors.** No memory-growth alert, only OOM events; no load test long enough to show slow growth; the cache had no hit-rate metric.\n\n**Action items.** Bounded caches only (lint rule); hit-rate and size metrics on every cache; alert on memory slope.',
    origin: 'bank'
  },
  {
    id: 'double-charge',
    title: 'Customers charged twice',
    difficulty: 1650,
    pattern: 'retries without idempotency',
    methods: ['backwards', 'edges'],
    minutes: 30,
    page: '11:40 Support escalation: 37 customers report two identical card charges this morning. Finance confirms duplicate captures at the acquirer.',
    system: 'checkout calls payments-svc POST /charges; payments-svc calls the acquirer’s capture API with a 3 s client timeout and writes the payment to its database. A service mesh sits between services.',
    sources: [
      { id: 'dupes', label: 'Duplicate charges query', cues: ['duplicate', 'query', 'sql', 'charges table', 'select'], relevant: true, data: 'SELECT order_id, count(*) FROM charges WHERE created_at > today GROUP BY 1 HAVING count(*) > 1;\n→ 41 rows. Every pair: same order, created 3.0–3.1 s apart, different charge ids, both status=captured.' },
      { id: 'mesh', label: 'Service mesh config changes', cues: ['mesh', 'istio', 'envoy', 'retry policy', 'virtualservice', 'config'], relevant: true, data: '09:58 VirtualService payments-svc: retries: { attempts: 2, perTryTimeout: 3s, retryOn: "5xx,reset,gateway-error" }  (platform team, "standard retry policy for all services")' },
      { id: 'acq-latency', label: 'Acquirer latency', cues: ['acquirer', 'latency', 'capture api', 'external'], relevant: true, data: 'Acquirer capture p50 900 ms, p99 3.4 s since 10:00 (their status page: "elevated latency").' },
      { id: 'api-code', label: 'payments-svc charge handler', cues: ['handler', 'code', 'idempotency', 'source', 'charge handler'], relevant: true, data: 'def create_charge(req):\n    charge = Charge.new(order_id=req.order_id, amount=req.amount)  # new id every call\n    acquirer.capture(charge.id, ...)\n    db.save(charge)\n# no Idempotency-Key read; acquirer is sent charge.id as its idempotency key' },
      { id: 'deploys', label: 'Deploy history', cues: ['deploy', 'release', 'rollout'], relevant: false, data: 'payments-svc: no deploy since last Thursday. checkout-web: 10:15 button colour change.' },
      { id: 'payments-logs', label: 'payments-svc logs', cues: ['log', 'payments-svc', 'errors'], relevant: true, data: '10:22:01.004 POST /charges order=8812 → capture ch_a1…\n10:22:04.010 POST /charges order=8812 → capture ch_b7…   (x-envoy-attempt-count: 2)\n10:22:04.300 ch_a1 captured\n10:22:05.120 ch_b7 captured' },
      { id: 'db', label: 'Database health', cues: ['database', 'db health', 'postgres', 'replication'], relevant: false, data: 'Primary healthy; replication lag 40 ms; no failovers.' }
    ],
    rootCause: { summary: 'A mesh-wide retry policy added at 09:58 retries POST /charges after a 3 s per-try timeout; with the acquirer slow, the first capture still succeeds, and payments-svc creates a new charge id on every call, so the retry is a second, distinct capture. The charge API isn’t idempotent.', cues: ['retry', 'mesh', 'idempoten', 'timeout', 'new charge id', 'envoy', 'istio'] },
    actions: [
      { id: 'disable-retries', cues: ['disable retries', 'remove the retry', 'turn off retries', 'revert the mesh', 'revert the retry', 'retries: 0', 'no retries'], effect: 'mitigates', reply: 'Retries removed for payments-svc POSTs. No new duplicates after 11:52.' },
      { id: 'idempotency', cues: ['idempotency key', 'idempotent', 'order_id as key', 'dedup', 'unique constraint'], effect: 'fixes', reply: 'Charges keyed by an Idempotency-Key (the order’s attempt id) with a unique constraint; a retry returns the first charge, and the same key goes to the acquirer. A replayed retry in staging captures once.' },
      { id: 'refunds', cues: ['refund', 'reverse', 'void'], effect: 'neutral', reply: 'The 41 duplicates are refunded and customers emailed. (Necessary, but new duplicates keep arriving until the cause is stopped.)' },
      { id: 'raise-timeout', cues: ['raise the timeout', 'longer timeout', 'increase timeout', 'pertrytimeout'], effect: 'neutral', reply: 'Per-try timeout to 10 s: fewer duplicates, but any slow capture still gets retried.' },
      { id: 'switch-acquirer', cues: ['failover', 'switch acquirer', 'backup acquirer'], effect: 'harmful', reply: 'Failing over mid-incident sends retries to the second acquirer as well: duplicates across two acquirers, harder to reconcile.' },
      { id: 'rollback-web', cues: ['roll back checkout', 'rollback checkout', 'revert checkout-web'], effect: 'neutral', reply: 'checkout-web rolled back. Duplicates continue.' }
    ],
    postmortem: '**Summary.** From 10:00 to 11:52, 41 orders were captured twice.\n\n**Cause.** A mesh retry policy (09:58) retried POST /charges after 3 s; the acquirer was slow, so the first capture also succeeded. payments-svc made a new charge id per call, so the retry was a new charge.\n\n**Contributing factors.** Non-idempotent money-moving endpoint; retry policy applied to non-idempotent methods; no alert on duplicate captures.\n\n**Action items.** Idempotency keys on every money-moving API; mesh retries only for idempotent methods; a duplicate-capture monitor; refunds done.',
    origin: 'bank'
  },
  {
    id: 'kafka-lag',
    title: 'Consumer lag climbing',
    difficulty: 1600,
    pattern: 'rebalance storm from slow processing',
    methods: ['estimate', 'invariant'],
    minutes: 30,
    page: '16:05 PAGE: ledger-consumer lag on topic payments.events is 2.4M messages and rising; settlement emails delayed 40+ minutes.',
    system: 'ledger-consumer (6 instances, consumer group "ledger") reads payments.events (24 partitions) and writes ledger entries to Postgres, committing offsets after each batch of up to 500 records. max.poll.interval.ms = 300000.',
    sources: [
      { id: 'lag', label: 'Lag per partition', cues: ['lag', 'partition', 'offset', 'kafka-consumer-groups'], relevant: true, data: 'All 24 partitions lag, 80k–120k each and rising. Committed offsets jump forward in bursts, then stall for ~5 min.' },
      { id: 'rebalances', label: 'Consumer group events', cues: ['rebalance', 'group', 'coordinator', 'membership', 'join'], relevant: true, data: '15:31 member ledger-3 left (poll interval exceeded); rebalance (generation 812)\n15:36 member ledger-5 left (poll interval exceeded); rebalance (generation 813)\n15:41 member ledger-1 left (poll interval exceeded); rebalance\n… 7 rebalances since 15:30' },
      { id: 'batch-time', label: 'Batch processing time', cues: ['processing time', 'batch time', 'duration', 'consumer metrics', 'slow'], relevant: true, data: 'batch_duration p50 40 s (was 3 s at 15:00), p99 330 s. records_per_batch 500.' },
      { id: 'db', label: 'Postgres write latency', cues: ['postgres', 'database', 'db', 'insert', 'write latency', 'lock'], relevant: true, data: 'INSERT INTO ledger_entries p99 640 ms (was 6 ms). Since 15:24: index build "CREATE INDEX ledger_entries_meta_idx" running (not CONCURRENTLY) — holds a SHARE lock blocking writes in waves.' },
      { id: 'producer', label: 'Producer rate', cues: ['producer', 'traffic', 'incoming', 'throughput', 'rate'], relevant: false, data: 'payments.events produce rate 1,900 msg/s, normal for the hour.' },
      { id: 'brokers', label: 'Broker health', cues: ['broker', 'isr', 'disk', 'cluster'], relevant: false, data: 'All brokers up, ISR full, disk 41%.' },
      { id: 'deploys', label: 'Deploy history', cues: ['deploy', 'release', 'migration', 'change'], relevant: true, data: 'ledger-consumer: none today. Database: 15:24 migration 0193_add_meta_index applied by the data team.' }
    ],
    rootCause: { summary: 'A migration at 15:24 built an index without CONCURRENTLY, blocking inserts in waves; batches of 500 then took longer than max.poll.interval.ms, so consumers were kicked from the group, causing repeated rebalances and reprocessing, and lag grew.', cues: ['index', 'migration', 'lock', 'rebalance', 'poll', 'concurrently', 'max.poll'] },
    actions: [
      { id: 'cancel-index', cues: ['cancel the index', 'stop the migration', 'cancel migration', 'kill the index', 'drop the index', 'pg_cancel'], effect: 'mitigates', reply: 'Index build cancelled. Insert p99 back to 6 ms, batches 3 s, no more rebalances; lag starts falling (~6k msg/s drain).' },
      { id: 'concurrently', cues: ['concurrently', 'rebuild concurrently', 'index concurrently'], effect: 'fixes', reply: 'Index rebuilt with CREATE INDEX CONCURRENTLY at 18:00; writes unaffected. The consumer’s batch size is lowered to 100 and max.poll.interval.ms checked against p99 batch time.' },
      { id: 'scale', cues: ['scale', 'more consumers', 'add instances', 'more instances'], effect: 'harmful', reply: 'More consumers join: another rebalance, and each slow batch still blocks. Lag rises faster.' },
      { id: 'raise-interval', cues: ['max.poll.interval', 'poll interval', 'increase the interval'], effect: 'neutral', reply: 'Rebalances stop, but batches still take 40 s: lag keeps growing, more slowly.' },
      { id: 'skip', cues: ['skip', 'reset offsets', 'to latest'], effect: 'harmful', reply: 'Offsets reset to latest: 2.4M payment events never reach the ledger. Finance will have to reconcile by hand.' },
      { id: 'restart', cues: ['restart', 'bounce'], effect: 'neutral', reply: 'Consumers restart: one more rebalance; nothing changes.' }
    ],
    postmortem: '**Summary.** From 15:24 to 16:30 ledger postings fell up to 45 minutes behind.\n\n**Cause.** An index built without CONCURRENTLY blocked inserts; batch time rose past max.poll.interval.ms; consumers were evicted and rebalanced repeatedly.\n\n**Contributing factors.** Migrations not reviewed for locking; batch size sized for normal latency only; no alert on rebalance rate.\n\n**Action items.** Lint migrations for non-concurrent index builds; smaller batches with a time budget; alert on rebalances and batch p99.',
    origin: 'bank'
  },
  {
    id: 'model-drift',
    title: 'A drift alert on the fraud model',
    difficulty: 1500,
    pattern: 'upstream schema change, not drift',
    methods: ['estimate', 'understand'],
    minutes: 30,
    page: '09:20 ALERT: fraud-model PSI on feature merchant_category = 0.62 (threshold 0.2). Block rate 0.4% → 3.1% since 07:00; card declines up.',
    system: 'fraud-model (gradient boosting) scores each card transaction in real time from features built by a streaming pipeline that reads the card network’s authorisation messages. Transactions above a 0.8 score are blocked.',
    sources: [
      { id: 'feature-dist', label: 'Feature distributions', cues: ['distribution', 'psi', 'feature', 'histogram', 'merchant_category'], relevant: true, data: 'merchant_category: yesterday 312 distinct values, top "5411 grocery" 14%. Today since 07:00: 1 value "UNKNOWN" 71%, others 29%. Other features: PSI < 0.05.' },
      { id: 'pipeline', label: 'Feature pipeline logs', cues: ['pipeline', 'stream', 'flink', 'parser', 'feature logs', 'log'], relevant: true, data: '07:00:03 WARN mcc_lookup: field "merchant.mcc" not found, defaulting to UNKNOWN (x 1,812,330)\n07:00:03 INFO schema registry: card-auth-v4 registered' },
      { id: 'network', label: 'Card network release notes', cues: ['network', 'release note', 'schema', 'message format', 'upstream', 'v4'], relevant: true, data: 'Auth message v4 (live today 07:00 UTC): "merchant.mcc" moved to "merchant.category.code". v3 fields removed.' },
      { id: 'importance', label: 'Model feature importance', cues: ['importance', 'shap', 'model'], relevant: true, data: 'Top features: amount_zscore 0.21, merchant_category 0.18, device_age 0.12… For category UNKNOWN the model’s fraud rate in training was 11% (rare, mostly test merchants).' },
      { id: 'fraud-reports', label: 'Confirmed fraud reports', cues: ['fraud reports', 'chargebacks', 'confirmed', 'labels'], relevant: false, data: 'Confirmed fraud this morning in line with the last 30 days.' },
      { id: 'deploys', label: 'Deploy history', cues: ['deploy', 'release', 'rollout', 'model version'], relevant: false, data: 'fraud-model v31 deployed 6 days ago; no deploys today.' }
    ],
    rootCause: { summary: 'The card network’s v4 message format moved the merchant category field; the feature pipeline didn’t find it and defaulted to UNKNOWN, which the model associates with high fraud: a schema change upstream, not real drift.', cues: ['schema', 'field', 'mcc', 'unknown', 'v4', 'upstream', 'moved', 'renamed'] },
    actions: [
      { id: 'fallback', cues: ['fallback', 'rules', 'previous', 'raise the threshold', 'disable the feature', 'shadow'], effect: 'mitigates', reply: 'Blocking falls back to the rules engine (or the threshold is raised for UNKNOWN). Block rate back to 0.5% within minutes.' },
      { id: 'map-field', cues: ['map the field', 'parse category.code', 'update the parser', 'fix the pipeline', 'new field', 'category.code'], effect: 'fixes', reply: 'The parser reads merchant.category.code (v4) and merchant.mcc (v3). UNKNOWN drops to 0.3%, PSI 0.03, block rate normal.' },
      { id: 'retrain', cues: ['retrain', 'train on today'], effect: 'harmful', reply: 'Retraining on today’s data teaches the model that UNKNOWN is normal; when the field is fixed the model is miscalibrated.' },
      { id: 'mute', cues: ['mute', 'silence', 'raise the psi threshold', 'ignore'], effect: 'harmful', reply: 'Alert muted. Customers keep being declined: 3.1% blocked.' },
      { id: 'rollback-model', cues: ['roll back the model', 'v30', 'rollback'], effect: 'neutral', reply: 'v30 behaves the same: it also learnt UNKNOWN as high-risk.' }
    ],
    postmortem: '**Summary.** From 07:00 to 09:50, 3% of card transactions were blocked instead of 0.4%.\n\n**Cause.** The card network moved the merchant category field in its v4 message. The feature pipeline defaulted the missing field to UNKNOWN, a value the model ties to fraud.\n\n**Contributing factors.** Missing fields defaulted silently; no alert on default rates; upstream release notes not tracked.\n\n**Action items.** Fail loud (or fall back) on missing required fields; alert on UNKNOWN rate per feature; subscribe to network schema changes; a rules fallback switch.',
    origin: 'bank'
  },
  {
    id: 'failed-migration',
    title: 'A migration that failed halfway',
    difficulty: 1750,
    pattern: 'non-transactional migration and mixed-version code',
    methods: ['backwards', 'edges'],
    minutes: 30,
    page: '22:15 PAGE: accounts-api 500 rate 18% since 22:02. Deploy pipeline reports migration step FAILED (timeout).',
    system: 'accounts-api (Rails, MySQL 8) deploys by running migrations, then rolling out new pods. Tonight’s release renames column users.phone to users.phone_e164 and backfills it. MySQL DDL is not transactional.',
    sources: [
      { id: 'migration-log', label: 'Migration log', cues: ['migration', 'migrate', 'deploy log', 'pipeline'], relevant: true, data: '22:00:10 == 20261113_rename_phone: migrating\n22:00:11 -- add_column(:users, :phone_e164)  ✓\n22:00:12 -- backfill phone_e164 in batches… (3.1M of 9.8M)\n22:02:12 ERROR: step timeout after 120s. Process killed.\n(no rollback: remove_column never ran; old column still there)' },
      { id: 'pods', label: 'Pod versions', cues: ['pod', 'version', 'rollout', 'kubectl', 'image'], relevant: true, data: 'accounts-api: 7 pods v311 (new), 5 pods v310 (old). Rollout paused at 58%.' },
      { id: 'errors', label: 'accounts-api errors', cues: ['error', 'log', '500', 'exception', 'stack'], relevant: true, data: 'v311: NoMethodError: undefined method `format` for nil (user.phone_e164) — users not yet backfilled (6.7M rows)\nv310: none' },
      { id: 'schema', label: 'Current users schema', cues: ['schema', 'columns', 'describe', 'show create', 'table'], relevant: true, data: 'users: id, email, phone (varchar), phone_e164 (varchar, NULL for 6.7M rows), created_at…' },
      { id: 'db', label: 'MySQL health', cues: ['mysql', 'database health', 'replication', 'cpu'], relevant: false, data: 'Primary CPU 35%, replica lag 0.4 s, no locks waiting.' },
      { id: 'traffic', label: 'Traffic', cues: ['traffic', 'rps', 'requests', 'load'], relevant: false, data: '2,100 req/s, normal for a Thursday night.' }
    ],
    rootCause: { summary: 'The migration added phone_e164 and timed out partway through the backfill; MySQL DDL isn’t transactional, so the schema stayed half-migrated while the rollout continued, and new v311 pods read phone_e164, which is NULL for 6.7M users.', cues: ['backfill', 'timeout', 'null', 'half', 'partial', 'phone_e164', 'not transactional', 'v311'] },
    actions: [
      { id: 'rollback-pods', cues: ['roll back', 'rollback', 'v310', 'undo the rollout', 'pause'], effect: 'mitigates', reply: 'Rollout reverted to v310 on all pods (the old column is still there). 500 rate back to 0.1%.' },
      { id: 'expand-contract', cues: ['expand', 'contract', 'finish the backfill', 'background job', 'read both', 'fallback to phone', 'dual'], effect: 'fixes', reply: 'Backfill finished as a background job outside the deploy step; v312 reads phone_e164 and falls back to phone; the old column is dropped a release later. Deployed cleanly.' },
      { id: 'drop-column', cues: ['drop phone', 'remove the old column', 'drop the column'], effect: 'harmful', reply: 'Old column dropped: v310 pods now fail too. 500 rate 100% on accounts-api.' },
      { id: 'rerun', cues: ['rerun the migration', 'retry the migration', 'run it again'], effect: 'neutral', reply: 'The migration fails at once: column phone_e164 already exists.' },
      { id: 'restore', cues: ['restore', 'backup', 'point-in-time recovery'], effect: 'harmful', reply: 'Restoring a backup would lose 20 minutes of sign-ups and logins, for a problem the schema can live with.' }
    ],
    postmortem: '**Summary.** From 22:02 to 22:31, 18% of accounts-api requests failed.\n\n**Cause.** A rename-and-backfill migration timed out mid-backfill. MySQL DDL isn’t transactional, so the new column existed but was mostly NULL, and the rollout continued with code that required it.\n\n**Contributing factors.** Backfill inside the deploy step; rollout not gated on migration success; a rename done in one release instead of expand/contract.\n\n**Action items.** Expand/contract for renames; backfills as background jobs; gate rollouts on migration status; code that tolerates both schemas.',
    origin: 'bank'
  }
]

export const incidentScenario = (id: string) => INCIDENTS.find((s) => s.id === id)

export function pickIncident(o: { difficulty: number; recent: string[]; seed: number }, bank: IncidentScenario[] = INCIDENTS): IncidentScenario {
  const fresh = bank.filter((s) => !o.recent.includes(s.id))
  const from = fresh.length ? fresh : bank
  const ranked = [...from].sort((a, b) => Math.abs(a.difficulty - o.difficulty) - Math.abs(b.difficulty - o.difficulty))
  const near = ranked.filter((s) => Math.abs(s.difficulty - o.difficulty) <= Math.abs(ranked[0].difficulty - o.difficulty) + 100)
  return near[o.seed % near.length]
}
