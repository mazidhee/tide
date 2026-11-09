import { randomBytes, timingSafeEqual } from 'crypto'
import { app } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import { summarize, toSessions, ACTIVITIES, type AnswerRow, type FocusRow, type ReviewRow } from '@shared/studyData'
import { getKey, setKey } from './cloud'
import { readJsonl } from './learn'
import { getSettings, updateSettings } from './settings'
import { currentStudy } from './tray'
import { joinRel } from './vault'

/**
 * Tide's study data API: your study time and how it went, for a dashboard or another app (Plain,
 * a widget, a spreadsheet). Read-only and off until you turn it on in Settings › Tools. It answers
 * on this Mac only, or on your network if you allow it, and every request but /v1/health needs
 * the token (kept in the Keychain), as `Authorization: Bearer <token>` or `?token=`.
 *
 *   GET /v1/health                      is Tide there (no token)
 *   GET /v1/today                       minutes today and this week, the streak, what's being studied now
 *   GET /v1/summary?days=30             totals, each day, each kind of studying, notebooks, topics, hours,
 *                                       flashcards and answers
 *   GET /v1/sessions?from=&to=&activity=&notebook=
 *                                       every logged session (dates as YYYY-MM-DD, default the last 30 days)
 */

export const STUDY_API_PORT = 47820
const KEY = 'study-api'

let server: Server | null = null
let listening: { port: number; lan: boolean } | null = null
let problem = ''

export interface StudyApiStatus {
  enabled: boolean
  running: boolean
  port: number
  lan: boolean
  url: string
  /** The address other devices on your network use, when allowed */
  lanUrl?: string
  token: string
  problem?: string
}

const config = () => {
  const s = getSettings().studyApi
  return { enabled: !!s?.enabled, port: s?.port || STUDY_API_PORT, lan: !!s?.lan }
}

function token(): string {
  let t = getKey(KEY)
  if (!t) {
    t = randomBytes(24).toString('base64url')
    setKey(KEY, t)
  }
  return t
}

const lanAddress = () =>
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address

export function studyApiStatus(): StudyApiStatus {
  const c = config()
  const lan = c.lan ? lanAddress() : undefined
  return {
    ...c,
    running: !!listening,
    url: `http://127.0.0.1:${c.port}/v1`,
    ...(lan ? { lanUrl: `http://${lan}:${c.port}/v1` } : {}),
    token: c.enabled ? token() : '',
    ...(problem ? { problem } : {})
  }
}

export async function setStudyApi(patch: { enabled?: boolean; lan?: boolean }): Promise<StudyApiStatus> {
  const c = config()
  updateSettings({ studyApi: { ...c, ...patch } })
  await startStudyApi()
  return studyApiStatus()
}

/** A new token: anything using the old one stops working */
export function newStudyApiToken(): StudyApiStatus {
  setKey(KEY, randomBytes(24).toString('base64url'))
  return studyApiStatus()
}

export function stopStudyApi(): Promise<void> {
  const s = server
  server = null
  listening = null
  return new Promise((done) => (s ? s.close(() => done()) : done()))
}

/** Starts, restarts or stops the server to match the settings */
export async function startStudyApi(): Promise<void> {
  const c = config()
  if (listening && c.enabled && listening.port === c.port && listening.lan === c.lan) return
  await stopStudyApi()
  problem = ''
  if (!c.enabled) return
  token()
  const s = createServer((req, res) => {
    handle(req, res).catch((e: Error) => send(res, 500, { error: e.message }))
  })
  await new Promise<void>((done) => {
    s.once('error', (e: NodeJS.ErrnoException) => {
      problem = e.code === 'EADDRINUSE' ? `Port ${c.port} is in use by another app.` : e.message
      done()
    })
    s.listen(c.port, c.lan ? '0.0.0.0' : '127.0.0.1', () => {
      server = s
      listening = { port: c.port, lan: c.lan }
      done()
    })
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // Dashboards in a browser can call it; the token still guards everything
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  })
  res.end(status === 204 ? undefined : JSON.stringify(body, null, 2))
}

function authorized(req: IncomingMessage, url: URL): boolean {
  const given = (req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('token') ?? '').trim()
  const want = getKey(KEY)
  if (!given || !want) return false
  const a = Buffer.from(given)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

const ENDPOINTS = {
  '/v1/health': 'Is Tide there (no token needed)',
  '/v1/today': 'Minutes today and this week, the streak, and what is being studied now',
  '/v1/summary?days=30': 'Totals, each day, each kind of studying, notebooks, topics, hours of the day, flashcards and answers',
  '/v1/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD&activity=&notebook=': 'Every logged study session'
}

async function load() {
  const [focus, reviews, answers] = await Promise.all([
    readJsonl<FocusRow>(joinRel('.tide', 'focus.jsonl')),
    readJsonl<ReviewRow>(joinRel('.tide', 'reviews.jsonl')),
    readJsonl<AnswerRow>(joinRel('.tide', 'attempts.jsonl'))
  ])
  return { sessions: toSessions(focus), reviews, answers }
}

const localDay = (s: string | null, end = false) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime()
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') return send(res, 204, null)
  if (req.method !== 'GET') return send(res, 405, { error: 'Read-only: only GET is allowed.' })
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (path === '/v1/health') return send(res, 200, { ok: true, app: 'Tide', version: app.getVersion() })
  if (!authorized(req, url)) return send(res, 401, { error: 'Send the token from Tide › Settings › Tools as "Authorization: Bearer <token>".' })
  if (!getSettings().vaultPath) return send(res, 503, { error: 'Tide has no notes folder yet.' })

  if (path === '/v1' || path === '/') return send(res, 200, { endpoints: ENDPOINTS, activities: ACTIVITIES })

  const now = Date.now()
  if (path === '/v1/summary' || path === '/v1/today') {
    const days = Math.max(1, Math.min(366, Number(url.searchParams.get('days')) || 30))
    const summary = summarize({ ...(await load()), now, days: path === '/v1/today' ? 7 : days, current: currentStudy() })
    if (path === '/v1/summary') return send(res, 200, summary)
    return send(res, 200, {
      date: summary.range.to,
      minutes: summary.totals.today,
      thisWeek: summary.totals.thisWeek,
      streak: summary.totals.streak,
      sessions: summary.days.at(-1)?.sessions ?? 0,
      cards: summary.days.at(-1)?.cards ?? 0,
      ...(summary.now ? { now: summary.now } : {})
    })
  }

  if (path === '/v1/sessions') {
    const from = localDay(url.searchParams.get('from')) ?? now - 30 * 86_400_000
    const to = localDay(url.searchParams.get('to'), true) ?? now
    const activity = url.searchParams.get('activity')
    const notebook = url.searchParams.get('notebook')?.toLowerCase()
    const sessions = (await load()).sessions.filter((s) => {
      const t = Date.parse(s.start)
      return t >= from && t <= to && (!activity || s.activity === activity) && (!notebook || s.notebook?.toLowerCase() === notebook)
    })
    return send(res, 200, { from: new Date(from).toISOString(), to: new Date(to).toISOString(), count: sessions.length, minutes: sessions.reduce((n, s) => n + s.minutes, 0), sessions: sessions.slice(-5000) })
  }

  send(res, 404, { error: `No such endpoint. Try ${Object.keys(ENDPOINTS).join(', ')}.` })
}
