/**
 * The library of explorables Claude has made on the fly: a custom visual in a maths lesson that
 * worked (it passed Tide's checks, repaired or not) is kept here, by what it shows and the lesson
 * topic, so a later lesson reuses a proven one (explorable_library, an MCP tool) rather than
 * writing it again: faster, and already checked. .tide/explorables.json; the most used and most
 * recent are kept when it is full.
 */
import { mathsMode } from '@shared/mathsMode'
import { visualKey, visualTitle, MAX_VISUAL } from '@shared/visuals'
import type { McpTool } from './tideMcp'
import { readText, writeText } from './vault'

const FILE = '.tide/explorables.json'
export const LIBRARY_MAX = 150

export interface Explorable {
  id: string
  title: string
  topic: string
  code: string
  uses: number
  at: number
}

/** Whether a working visual is an explorable worth keeping: interactive maths, built with Tide's helpers or reporting what the learner does */
export const isExplorable = (code: string, topic: string) => mathsMode(topic).on && /TideMath\.|visual\.(report|predict|goal)\(/.test(code) && /<input|TideMath\.(slider|plane)|drag|addEventListener/.test(code)

async function read(): Promise<Explorable[]> {
  try {
    const v = JSON.parse(await readText(FILE)) as unknown
    return Array.isArray(v) ? (v as Explorable[]).filter((e) => e && typeof e.code === 'string' && typeof e.id === 'string') : []
  } catch {
    return []
  }
}

/** Keeps (or counts again) a working explorable; returns whether it is in the library */
export async function keepExplorable(code: string, topic: string, now = Date.now()): Promise<boolean> {
  if (!code || code.length > MAX_VISUAL || !isExplorable(code, topic)) return false
  const all = await read()
  const id = visualKey(code.trim())
  const had = all.find((e) => e.id === id)
  if (had) {
    had.uses++
    had.at = now
  } else all.push({ id, title: visualTitle(code) || topic, topic, code: code.trim(), uses: 1, at: now })
  all.sort((a, b) => b.uses - a.uses || b.at - a.at)
  await writeText(FILE, JSON.stringify(all.slice(0, LIBRARY_MAX), null, 1))
  return true
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])

/** The kept explorables that best match a query, best first */
export async function findExplorables(query: string, limit = 5): Promise<Explorable[]> {
  const q = words(query)
  if (!q.size) return []
  return (await read())
    .map((e) => {
      const w = words(`${e.title} ${e.topic}`)
      let hit = 0
      for (const x of q) if (w.has(x)) hit++
      return { e, score: hit / q.size + Math.min(e.uses, 10) * 0.01 }
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e)
}

export const explorableLibraryTool: McpTool = {
  name: 'explorable_library',
  description:
    "Custom explorables made in earlier maths lessons that worked: look here before writing a new ```visual explorable. With query: the closest ones (id, title, topic, times used). With id: its full code, to paste as a ```visual block as it is or adapted to this lesson's numbers.",
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What it should show, e.g. "Taylor series terms" or "Markov chain"' }, id: { type: 'string' } }, required: [] },
  async run(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : ''
    if (id) {
      const e = (await read()).find((x) => x.id === id)
      return e ? `"${e.title}" (from a lesson on ${e.topic}, used ${e.uses} time${e.uses === 1 ? '' : 's'}):\n\`\`\`visual\n${e.code}\n\`\`\`` : `No explorable ${id} in the library.`
    }
    const found = await findExplorables(String(args.query ?? ''))
    if (!found.length) return 'Nothing in the library matches: write a new one (it is kept once it works).'
    return found.map((e) => `- ${e.id}: "${e.title}" (topic: ${e.topic}; used ${e.uses}×)`).join('\n') + '\nCall again with id to get one.'
  }
}
