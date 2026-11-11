import { promises as fs } from 'fs'
import { detectTools, flowsIn, markdownHeadings, type FlowStep, type ProjectInfo, type ProjectMap } from '@shared/project'
import type { ChatEvent } from '@shared/types'
import { complete, extractJsonArray, extractJsonObject, friendlyError, streamDraft } from './ai'
import { bookChapters } from './book'
import { directionLine } from './coach'
import { filedUnder, getNotebooks, updateNotebook } from './learn'
import { getChunks, pdfText, reindexPath } from './search'
import { absPath, joinRel, readText, writeText } from './vault'

/**
 * Projects, main side: a notebook's project record, its documents, the map of what the system is
 * made of, and the brief for something you'll build. See shared/project.ts for the idea.
 */

const mapFile = (notebook: string) => joinRel('.tide', 'projects', `${notebook.replace(/[^\w-]+/g, '_')}.json`)

export async function projectOf(notebook: string): Promise<ProjectInfo | null> {
  return (await getNotebooks()).find((n) => n.path === notebook)?.project ?? null
}

export async function setProject(notebook: string, info: ProjectInfo | null): Promise<void> {
  await updateNotebook(notebook, { project: info ?? undefined })
}

/** A project's documents: the ones attached to it, and anything filed under its name */
export async function projectDocs(notebook: string, info?: ProjectInfo | null): Promise<string[]> {
  const p = info ?? (await projectOf(notebook))
  const filed = await filedUnder(notebook.split('/').pop() ?? notebook).catch(() => [] as string[])
  return [...new Set([...(p?.docs ?? []), ...(p?.brief ? [p.brief] : []), ...filed])].filter((d) => /\.(md|pdf)$/i.test(d))
}

/** Whether a vault path belongs to a private project (so it must stay on this Mac) */
export async function privatePath(path: string): Promise<boolean> {
  if (!path) return false
  for (const nb of await getNotebooks()) {
    if (!nb.project?.private) continue
    if (path === nb.path || path.startsWith(`${nb.path}/`) || nb.project.docs.includes(path)) return true
    if ((await filedUnder(nb.name).catch(() => [] as string[])).includes(path)) return true
  }
  return false
}

const versionKey = async (docs: string[]) =>
  (await Promise.all(docs.map(async (d) => `${d}@${(await fs.stat(absPath(d)).catch(() => null))?.mtimeMs ?? 0}`))).join('|')

export async function projectMap(notebook: string): Promise<ProjectMap | null> {
  const saved = await readText(mapFile(notebook))
    .then((t) => JSON.parse(t) as ProjectMap)
    .catch(() => null)
  return saved
}

/**
 * Maps a project's documents: headings by code (Markdown headings, a PDF's bookmarks or contents),
 * tools by a lexicon over the indexed text, flows from flow-like headings, and one short model
 * call over the headings for the components and an overview. Rebuilt only when a document changes.
 */
export async function mapProject(notebook: string, force = false): Promise<ProjectMap | null> {
  const info = await projectOf(notebook)
  const docs = await projectDocs(notebook, info)
  if (!docs.length) return null
  const key = await versionKey(docs)
  const saved = await projectMap(notebook)
  if (!force && saved?.key === key) return saved

  const headings: string[] = []
  const texts: string[] = []
  for (const d of docs) {
    if (/\.md$/i.test(d)) {
      const md = await readText(d).catch(() => '')
      headings.push(...markdownHeadings(md))
      texts.push(md)
    } else {
      const { chapters } = await bookChapters(d, true).catch(() => ({ chapters: [] as { title: string }[] }))
      headings.push(...chapters.map((c) => c.title))
      await reindexPath(d).catch(() => {})
      const chunks = await getChunks(d)
      texts.push(chunks.length ? chunks.map((c) => c.text).join('\n') : (await pdfText(d).catch(() => [] as string[])).join('\n'))
    }
  }
  const tools = detectTools(texts).slice(0, 14)
  const flows = flowsIn(headings)
  const name = notebook.split('/').pop() ?? notebook
  // The one model call: from the headings alone, what the system's parts are and what it is
  const raw = await complete(
    `These are the section headings of the documents for a project called "${name}"${tools.length ? `, which uses ${tools.map((t) => t.name).join(', ')}` : ''}:\n${headings.slice(0, 160).map((h) => `- ${h}`).join('\n')}\n\nReturn ONLY JSON: {"overview": "2 or 3 plain sentences: what this system does and how it's put together", "components": [{"name": "a part of the system, as the documents name it", "about": "what it does, in one line"}]} with 3 to 10 components.`,
    'You read technical documents carefully and describe systems plainly. Reply with JSON only.'
  ).catch(() => '')
  let parsed: { overview?: string; components?: { name?: string; about?: string }[] } = {}
  try {
    parsed = extractJsonObject(raw)
  } catch {
    // Still useful without it: the headings, flows and tools come from code
  }
  const map: ProjectMap = {
    builtAt: Date.now(),
    key,
    overview: String(parsed.overview ?? '').trim().slice(0, 600),
    // Parts, not the flows or the data model, which have their own places
    components: (parsed.components ?? []).filter((c) => c?.name && !flows.some((f) => f.toLowerCase() === String(c.name).toLowerCase()) && !/\b(flow|process|data model|overview)\b/i.test(String(c.name))).slice(0, 10).map((c) => ({ name: String(c.name).slice(0, 80), about: String(c.about ?? '').slice(0, 200) })),
    flows,
    tools,
    headings: headings.slice(0, 300)
  }
  await writeText(mapFile(notebook), JSON.stringify(map, null, 1))
  return map
}

/**
 * For something you'll build yourself: a brief written with you, saved as a note in the project.
 * Goal and scope, how it's put together, the milestones as a checklist, and for each what you need
 * to learn first. It plans the work; it doesn't do it.
 */
export async function draftBrief(req: { id: string; notebook: string; idea: string; background?: string }, emit: (e: ChatEvent) => void): Promise<void> {
  const heading = await directionLine().catch(() => '')
  const name = req.notebook.split('/').pop() ?? req.notebook
  const user = [
    `The learner wants to build this themselves, to learn by building it: ${req.idea.trim()}`,
    req.background?.trim() ? `What they already know: ${req.background.trim()}` : '',
    heading,
    `Write the project brief in Markdown with exactly these sections:
# ${name}
## Goal (what it does when it's done, and what building it will teach them)
## Scope (in, and deliberately out, for a first version)
## How it's put together (the components and how data or control flows between them; add a small mermaid diagram)
## Milestones (6 to 10, each a "- [ ]" checklist line: a small working thing they can run or test, in build order)
## Learn first (for each milestone in order, the concepts and tools it needs, as short bullets; mark what they likely know already)
## Risks and hard parts (what tends to go wrong, and how they'll know)
## References (real books, docs or specs worth reading for it)
Be concrete and specific to this project. Don't write the code: they will.`
  ]
    .filter(Boolean)
    .join('\n\n')
  try {
    let out = ''
    for await (const text of streamDraft(
      [
        { role: 'system', content: 'You are a senior engineer who mentors people building real systems themselves. You plan carefully, sequence the work so each milestone runs, and you never do the work for them.' },
        { role: 'user', content: user }
      ],
      new AbortController().signal,
      4000,
      // A private project's brief is written on this Mac only
      (await projectOf(req.notebook))?.private ? 'other' : 'planning'
    )) {
      out += text
      emit({ id: req.id, type: 'delta', text })
    }
    const path = joinRel(req.notebook, `${name} brief.md`)
    await writeText(path, out.trim() + '\n')
    const info = await projectOf(req.notebook)
    if (info) await setProject(req.notebook, { ...info, brief: path })
    emit({ id: req.id, type: 'done' })
  } catch (e) {
    emit({ id: req.id, type: 'error', message: friendlyError(e) })
  }
}

/**
 * A flow's steps, in order, from the part of the documents that describes it: one short model call
 * (the flow's section and the known part names in, a small JSON list out), cached with the map.
 * The lesson follows these steps, and the app draws each on the canvas as the lesson reaches it.
 */
export async function flowSteps(notebook: string, flow: string): Promise<FlowStep[]> {
  const map = await projectMap(notebook)
  const cached = (map as ProjectMap & { flowSteps?: Record<string, FlowStep[]> } | null)?.flowSteps?.[flow]
  if (cached?.length) return cached
  const docs = await projectDocs(notebook)
  // The flow's own section: the text under its heading in a Markdown doc, else the passages about it
  let section = ''
  for (const d of docs.filter((x) => /\.md$/i.test(x))) {
    const md = await readText(d).catch(() => '')
    const at = md.search(new RegExp(`^#{1,4}\\s+(?:[\\d.]+\\s+)?${flow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im'))
    if (at >= 0) {
      const rest = md.slice(at)
      const end = rest.slice(1).search(/^#{1,4}\s/m)
      section = rest.slice(0, end < 0 ? 3000 : end + 1).slice(0, 3000)
      break
    }
  }
  if (!section) {
    const { search } = await import('./search')
    section = (await search(flow, 6, (p) => docs.includes(p)))
      .map((c) => c.text)
      .join('\n\n')
      .slice(0, 3000)
  }
  const parts = [...(map?.components.map((c) => c.name) ?? []), ...(map?.tools.map((t) => t.name) ?? [])]
  const raw = await complete(
    `A system's "${flow}", as its design document describes it:\n${section}\n\nThe system's parts: ${parts.join(', ')}.\nList the flow as ordered steps, each something passing from one part to another. Use the part names exactly as listed where they fit; outside parties (the bank, a customer) may be named as they are in the text.\nReturn ONLY a JSON array of 3 to 8 steps: [{"from": "...", "to": "...", "label": "what passes, in 2 to 5 words"}]`,
    'You trace how systems work, step by step. Reply with JSON only.'
  ).catch(() => '')
  const steps = ((extractJsonArray(raw) as Partial<FlowStep>[] | null) ?? [])
    .filter((s) => s?.from && s?.to && String(s.from) !== String(s.to))
    .slice(0, 8)
    .map((s) => ({ from: String(s.from).slice(0, 60), to: String(s.to).slice(0, 60), label: String(s.label ?? '').slice(0, 40) }))
  if (steps.length && map) await writeText(mapFile(notebook), JSON.stringify({ ...map, flowSteps: { ...((map as { flowSteps?: object }).flowSteps ?? {}), [flow]: steps } }, null, 1)).catch(() => {})
  return steps
}
