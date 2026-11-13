/**
 * Source packs: for a topic, the most relevant paragraphs of the free readings found for it
 * (main/readings), read once and kept in .tide/sources for two weeks. Built in the background when
 * readings are found for the week, so a lesson starts with them at once. Nothing is fetched when
 * web search is off.
 */
import { normalizeTitle } from '@shared/outline'
import { excerpt, type SourcePack } from '@shared/sources'
import { readWebpage } from './agent'
import { findReadings, readingsFor } from './readings'
import { pdfText } from './search'
import { getSettings } from './settings'
import { readText, writeText } from './vault'

const DIR = '.tide/sources'
const KEEP_MS = 14 * 86_400_000
const slug = (topic: string) => normalizeTitle(topic).replace(/\s+/g, '-').slice(0, 80) || 'topic'
const fileFor = (topic: string) => `${DIR}/${slug(topic)}.json`

/** The pack kept for a topic, if it's recent */
export async function packFor(topic: string): Promise<SourcePack | null> {
  try {
    const p = JSON.parse(await readText(fileFor(topic))) as SourcePack
    return Date.now() - p.at < KEEP_MS ? p : null
  } catch {
    return null
  }
}

async function textOf(r: { url: string; path?: string }): Promise<string> {
  if (r.path && /\.pdf$/i.test(r.path)) return (await pdfText(r.path)).slice(0, 40).join('\n\n')
  if (r.path) return readText(r.path)
  return (await readWebpage(r.url)).text
}

const building = new Map<string, Promise<SourcePack | null>>()

/** Builds (or rebuilds) a topic's pack from its readings: up to three sources, a few paragraphs each */
export function buildPack(topic: string, where?: string): Promise<SourcePack | null> {
  const key = slug(topic)
  const running = building.get(key)
  if (running) return running
  const run = (async () => {
    // A recent pack is kept as it is: rebuilding it would change a lesson's opening for nothing
    const have = await packFor(topic)
    if (have) return have
    if (getSettings().ai.webSearch?.provider === 'off') return null
    let readings = await readingsFor(topic)
    if (!readings.length) readings = await findReadings({ topic, path: where, notebook: where }).catch(() => [])
    const sources: SourcePack['sources'] = []
    // Specs, papers and docs first: they're what the facts should come from
    const order = { spec: 0, paper: 1, docs: 2, article: 3, encyclopedia: 4, book: 5 } as const
    for (const r of [...readings].sort((a, b) => order[a.kind] - order[b.kind])) {
      if (sources.length >= 3) break
      // A catalogue page for a book you'd have to borrow isn't text to teach from
      if (r.kind === 'book' && !r.path) continue
      const text = excerpt(await textOf(r).catch(() => ''), topic, 1500)
      if (text.length >= 200) sources.push({ n: sources.length + 1, title: r.title, ...(r.url ? { url: r.url } : {}), ...(r.path ? { path: r.path } : {}), text })
    }
    if (!sources.length) return null
    const pack: SourcePack = { topic, at: Date.now(), sources }
    await writeText(fileFor(topic), JSON.stringify(pack))
    return pack
  })().finally(() => building.delete(key))
  building.set(key, run)
  return run
}

/** For a lesson starting now: the pack if there is one; otherwise it's built in the background, for the checks and next time */
export async function lessonPack(topic: string, where?: string): Promise<SourcePack | null> {
  // A kept pack is quick to hand over
  const have = await packFor(topic)
  if (have) return have
  buildPack(topic, where).catch(() => null)
  return null
}
