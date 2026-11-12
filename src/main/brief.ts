import { lastStudyDay, type StudyDay } from '@shared/brief'
import { completeFor, extractJsonArray } from './ai'
import { webSearch } from './agent'
import { getRecallQueue, studyEvents } from './learn'
import { listProblems } from './practice'
import { allNotes } from './vault'

export interface Brief {
  last: StudyDay | null
  /** Notes due to be explained from memory today */
  recall: number
  /** Practice problems ready to try again */
  problems: number
}

export async function getBrief(): Promise<Brief> {
  const now = Date.now()
  const [events, recall, problems] = await Promise.all([studyEvents(), getRecallQueue().catch(() => []), listProblems().catch(() => [])])
  return { last: lastStudyDay(events, now), recall: recall.filter((r) => r.due <= now).length, problems: problems.filter((p) => p.status === 'redo').length }
}

export interface Suggestion {
  title: string
  url: string
  host: string
  why: string
}

const cache = new Map<string, Suggestion[]>()

/** Reading that would take these topics further: real pages from a web search, picked by the model */
export async function suggestReading(topics: string[]): Promise<Suggestion[]> {
  const clean = [...new Set(topics.map((t) => t.trim()).filter(Boolean))].slice(0, 3)
  if (!clean.length) return []
  const key = `${new Date().toDateString()}|${clean.join('|').toLowerCase()}`
  const hit = cache.get(key)
  if (hit) return hit

  // Skip what's already in the library
  const saved = new Set((await allNotes()).flatMap((n) => (n.sourceUrl ? [n.sourceUrl.replace(/\/+$/, '')] : [])))
  const results = (
    await Promise.all(clean.map((t) => webSearch(`${t} explained in depth guide`, { when: 'year' }).catch(() => webSearch(t).catch(() => []))))
  )
    .flat()
    .filter((r) => r.url && !saved.has(r.url.replace(/\/+$/, '')) && !/youtube\.com|youtu\.be|reddit\.com|quora\.com|x\.com|twitter\.com|facebook\.com|tiktok\.com|instagram\.com|pinterest\./i.test(r.url))
  const seen = new Set<string>()
  const pool = results.filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, 12)
  if (!pool.length) return []

  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '')
    } catch {
      return u
    }
  }
  let picks: { i?: unknown; why?: unknown }[] = []
  try {
    const raw = await completeFor(
      'readingPicks',
      `A student studied: ${clean.join('; ')}.\n\nPick the 3 results that would teach them the most next: in-depth articles, guides, documentation, lecture notes or papers. Avoid shallow listicles, ads and product pages.\n\n${pool.map((r, i) => `${i}. ${r.title} (${host(r.url)})\n${r.snippet.slice(0, 200)}`).join('\n\n')}\n\nReply with JSON only: [{"i": 0, "why": "one short sentence on what they'd learn"}]`,
      'You recommend reading for a student. Reply with JSON only.',
      { text: clean.join('\n') }
    )
    picks = extractJsonArray(raw)
  } catch {
    // the model is busy or offline: fall back to the search order
  }
  const chosen = picks
    .map((p) => ({ r: pool[Number(p.i)], why: typeof p.why === 'string' ? p.why : '' }))
    .filter((x): x is { r: (typeof pool)[number]; why: string } => !!x.r)
  const out = (chosen.length ? chosen : pool.slice(0, 3).map((r) => ({ r, why: '' })))
    .filter((x, i, all) => all.findIndex((y) => y.r.url === x.r.url) === i)
    .slice(0, 3)
    .map(({ r, why }) => ({ title: r.title, url: r.url, host: host(r.url), why: why || r.snippet.slice(0, 140) }))
  cache.set(key, out)
  return out
}
