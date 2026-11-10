/**
 * Free readings for the topics you're about to learn, found in the background: a few real,
 * legal readings per topic (suggested by the planning model, then checked to exist: Open Library,
 * arXiv, the web), Wikipedia's article, and the source your roadmap names. Small PDFs from open
 * archives (arXiv, RFCs, course and project sites) are saved into the Library and filed under the
 * notebook, so lessons on it can use them. Private projects are skipped.
 */
import { aimOf, todayItems, type AgendaItem, type WeekPlan } from '@shared/coach'
import { normalizeTitle } from '@shared/outline'
import { isBlocked, parseReadings, pdfFor, pdfHostAllowed, readingsPrompt, wikipediaPick, READINGS_SYSTEM, type Reading } from '@shared/readings'
import { extractJsonObject } from './ai'
import { getCoach } from './coach'
import { ask } from './curriculum'
import { getNotebooks, getLibraryTopics, setLibraryTopics } from './learn'
import { downloadPdf } from './library'
import { verifyItems } from './planner'
import { privatePath } from './projects'
import { reindexPath } from './search'
import { getSettings } from './settings'
import { aboutMetabase } from '@shared/metabase'
import { metabaseHost, metabaseReady } from './metabase'
import { readText, writeText } from './vault'
import { noteUse } from './connectionUse'

const STORE = '.tide/readings.json'
const MAX_PDF = 15_000_000
const PER_TOPIC_PDFS = 2
const WEEK_BYTES = 100_000_000

interface Store {
  /** By normalised topic title */
  topics: Record<string, { at: number; notebook: string; items: Reading[] }>
  /** Downloads so far, to skip a file already saved and keep within the week's allowance */
  saved: Record<string, { path: string; at: number; bytes: number }>
}

async function load(): Promise<Store> {
  try {
    const s = JSON.parse(await readText(STORE)) as Store
    return { topics: s.topics ?? {}, saved: s.saved ?? {} }
  } catch {
    return { topics: {}, saved: {} }
  }
}

let writing: Promise<unknown> = Promise.resolve()
/** One change at a time, so two topics finishing together don't lose each other's readings */
function update(fn: (s: Store) => void): Promise<void> {
  const run = writing.then(async () => {
    const s = await load()
    fn(s)
    await writeText(STORE, JSON.stringify(s))
  })
  writing = run.catch(() => {})
  return run
}

const keyOf = (topic: string) => normalizeTitle(topic)

/** What's been found for a topic (nothing yet: an empty list) */
export async function readingsFor(topic: string): Promise<Reading[]> {
  return (await load()).topics[keyOf(topic)]?.items ?? []
}

const findingNow = new Set<string>()

/** A lookup that found nothing is tried again after a day (the web may have been down) */
const RETRY_EMPTY = 86_400_000

/**
 * Finds readings for one topic, unless it has them (or is being looked up) already. `path` is the
 * note or folder the lesson is about: anything in a private project, or about your Metabase, is
 * never looked up.
 */
export async function findReadings(it: { topic: string; notebook?: string; path?: string; source?: string; section?: string }): Promise<Reading[]> {
  const key = keyOf(it.topic)
  const have = (await load()).topics[key]
  const fresh = have && (have.items.length > 0 || Date.now() - have.at < RETRY_EMPTY)
  if (fresh || findingNow.has(key) || !key) return have?.items ?? []
  if (getSettings().ai.webSearch?.provider === 'off') return []
  const notebooks = await getNotebooks()
  const nb = notebooks.find((n) => n.name === it.notebook || n.path === it.notebook) ?? (it.path ? notebooks.find((n) => it.path === n.path || it.path!.startsWith(`${n.path}/`)) : undefined)
  // A private project's topics stay on this Mac: nothing is looked up for them
  for (const p of [nb?.path, it.path]) if (p && (await privatePath(p).catch(() => true))) return []
  if (metabaseReady() && aboutMetabase(it.topic, metabaseHost())) return []
  findingNow.add(key)
  try {
    const items = await gather({ ...it, notebook: nb?.name ?? it.notebook })
    await update((s) => (s.topics[key] = { at: Date.now(), notebook: nb?.name ?? it.notebook ?? '', items }))
    return items
  } finally {
    findingNow.delete(key)
  }
}

async function gather(it: { topic: string; notebook?: string; source?: string; section?: string }): Promise<Reading[]> {
  const aims = aimOf(await getCoach())
  const signal = new AbortController().signal
  // Suggested by the planning model (the topic and section only leave the Mac), then checked
  const { text } = await ask(READINGS_SYSTEM, readingsPrompt(it.topic, it.section ?? '', it.notebook ?? '', aims), false, signal)
  const suggested: { title: string; by?: string; why?: string; kind: Reading['kind']; url?: string; unverified?: boolean }[] = parseReadings(extractJsonObject(text))
  // The source your roadmap names, if it isn't already there
  if (it.source && !suggested.some((s) => normalizeTitle(s.title) === normalizeTitle(it.source!))) suggested.push({ title: it.source, kind: 'book', why: 'Named in your roadmap' })
  await verifyItems(suggested)
  const out: Reading[] = suggested.filter((s) => s.url && !s.unverified && !isBlocked(s.url)).map((s) => ({ title: s.title, ...(s.by ? { by: s.by } : {}), ...(s.why ? { why: s.why } : {}), url: s.url!, kind: s.kind }))
  const wiki = await wikipedia(it.topic).catch(() => null)
  if (wiki && !out.some((r) => r.url === wiki.url)) out.push({ title: `${wiki.title} (Wikipedia)`, url: wiki.url, kind: 'encyclopedia', why: 'An overview with links onward' })
  await savePdfs(out, it.notebook)
  return out
}

async function wikipedia(topic: string): Promise<{ title: string; url: string } | null> {
  noteUse('wikipedia')
  const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: topic, srlimit: '3', format: 'json', origin: '*' })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${q}`, { headers: { 'User-Agent': 'Tide/0.1 (local study app)' }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) return null
  const data = (await res.json()) as { query?: { search?: { title: string }[] } }
  return wikipediaPick(topic, data.query?.search ?? [])
}

/** Small PDFs from open archives into the Library, filed under the notebook */
async function savePdfs(readings: Reading[], notebook?: string) {
  let taken = 0
  for (const r of readings) {
    const pdf = pdfFor(r.url)
    if (!pdf || taken >= PER_TOPIC_PDFS) continue
    const store = await load()
    const already = store.saved[pdf]
    if (already) {
      r.path = already.path
      continue
    }
    const week = Object.values(store.saved).filter((x) => x.at > Date.now() - 7 * 86_400_000).reduce((n, x) => n + x.bytes, 0)
    if (week >= WEEK_BYTES) return
    try {
      const saved = await downloadPdf(pdf, { title: r.title, max: Math.min(MAX_PDF, WEEK_BYTES - week), timeoutMs: 45_000, allow: pdfHostAllowed })
      r.path = saved.path
      taken++
      const bytes = await sizeOf(saved.path)
      await update((s) => (s.saved[pdf] = { path: saved.path, at: Date.now(), bytes }))
      if (notebook) {
        const topics = (await getLibraryTopics())[saved.path] ?? []
        await setLibraryTopics(saved.path, [...topics, notebook])
      }
      await reindexPath(saved.path).catch(() => {})
    } catch {
      // Too big, not a PDF, or the site didn't answer: it stays a link
    }
  }
}

async function sizeOf(path: string): Promise<number> {
  const { promises: fs } = await import('fs')
  const { absPath } = await import('./vault')
  return (await fs.stat(absPath(path)).catch(() => ({ size: 0 }))).size
}

/** Readings for the week's lessons (up to twelve), found in the background and added to the plan */
export async function readingsForWeek(getWeek: (date: string) => Promise<WeekPlan | null>, save: (plan: WeekPlan) => Promise<void>, date: string): Promise<void> {
  const plan = await getWeek(date)
  if (!plan) return
  const lessons = plan.days.flatMap((d) => todayItems(plan, d.date)).filter((i): i is AgendaItem & { topic: string } => i.kind === 'learn' && !!i.topic).slice(0, 12)
  for (const it of lessons) {
    await findReadings({ topic: it.topic, notebook: it.notebook }).catch(() => [])
    // And the passages a lesson on it will be taught from
    await import('./sources').then((m) => m.buildPack(it.topic, it.notebook)).catch(() => null)
  }
  // The plan may have changed meanwhile (items ticked): add to the latest version
  const latest = await getWeek(date)
  if (!latest) return
  const store = await load()
  let changed = false
  for (const d of latest.days)
    for (const it of d.items) {
      const found = it.kind === 'learn' && it.topic ? store.topics[keyOf(it.topic)]?.items : undefined
      if (!found?.length) continue
      const have = new Set((it.readings ?? []).map((r) => r.url ?? r.path ?? r.title))
      const add = found.filter((r) => !have.has(r.url) && !(r.path && have.has(r.path))).map((r) => (r.path ? { title: r.title, by: r.by, path: r.path, url: r.url } : { title: r.title, by: r.by, url: r.url }))
      if (add.length) {
        it.readings = [...(it.readings ?? []), ...add].slice(0, 5)
        changed = true
      }
    }
  if (changed) await save(latest)
}
