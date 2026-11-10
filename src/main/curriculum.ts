/**
 * Sorting your roadmaps against your aims, in the background: what each section is for and how
 * much each aim needs it (the model, except where your own heading tags already say), and which
 * topics are history or background for weekend primers. Kept in .tide/curriculum and redone only
 * for what changed: new sections, new topics, or different aims. Private projects stay on Gemma.
 */
import { aimsKey, aimsOf } from '@shared/coach'
import {
  classOf,
  enrichPrompt,
  isSorted,
  parseEnrich,
  parseSort,
  roadmapTopics,
  sectionsOf,
  sectionValue,
  sortPrompt,
  ENRICH_SYSTEM,
  SORT_SYSTEM,
  type CurriculumView,
  type Overrides,
  type SectionClass,
  type SortedRoadmap
} from '@shared/curriculum'
import { askCloud, complete, extractJsonObject, NoCloud } from './ai'
import { getCoach } from './coach'
import { getNotebooks } from './learn'
import { privatePath } from './projects'
import { readText, writeText } from './vault'

const DIR = '.tide/curriculum'
const OVERRIDES = `${DIR}/overrides.json`
const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'notebook'
const fileFor = (notebook: string) => `${DIR}/${slug(notebook)}.json`

const SECTION_BATCH = 40
const TOPIC_BATCH = 120

export async function loadSorted(notebook: string): Promise<SortedRoadmap | null> {
  try {
    const s = JSON.parse(await readText(fileFor(notebook))) as SortedRoadmap
    return s.version === 1 && s.notebook === notebook ? s : null
  } catch {
    return null
  }
}

export async function getOverrides(): Promise<Overrides> {
  try {
    return JSON.parse(await readText(OVERRIDES)) as Overrides
  } catch {
    return {}
  }
}

const CLASSES: SectionClass[] = ['core', 'supporting', 'elective', 'enrichment', 'skip']

/** Your choice for a topic or a section; null puts it back to what Tide worked out */
export async function setOverride(id: string, cls: SectionClass | null): Promise<Overrides> {
  const all = await getOverrides()
  if (cls && CLASSES.includes(cls)) all[id] = cls
  else delete all[id]
  await writeText(OVERRIDES, JSON.stringify(all, null, 2))
  return all
}

/** One model answer: the cloud planning model when it may see this, else Gemma in the background lane */
export async function ask(system: string, prompt: string, onMac: boolean, signal: AbortSignal): Promise<{ text: string; model: string }> {
  if (!onMac) {
    try {
      let model = 'cloud'
      const text = await askCloud(prompt, system, 'planning', signal, true, 3000, (t) => (model = t.model))
      return { text, model }
    } catch (e) {
      if (!(e instanceof NoCloud)) throw e
    }
  }
  return { text: await complete(prompt, system, signal, 'background', 'background'), model: 'gemma' }
}

export interface SortStatus {
  notebook: string
  sorted: boolean
  sections: number
  done: number
}

let running: Promise<SortStatus[]> | null = null
let lastError = ''

/** Sorts whatever isn't sorted yet; one run at a time */
export function sortRoadmaps(): Promise<SortStatus[]> {
  running ??= sortAll().finally(() => (running = null))
  return running
}

async function sortAll(): Promise<SortStatus[]> {
  const aims = aimsOf(await getCoach())
  if (!aims.length) return curriculumStatus()
  const key = aimsKey(aims)
  const signal = new AbortController().signal
  lastError = ''
  for (const nb of await getNotebooks()) {
    if (!nb.outline) continue
    try {
      await sortOne(nb.name, nb.outline, await privatePath(nb.path).catch(() => true), aims, key, signal)
    } catch (e) {
      // A run that fails part-way keeps what it saved; the next run carries on from there
      lastError = (e as Error).message
    }
  }
  return curriculumStatus()
}

async function sortOne(notebook: string, outline: string, onMac: boolean, aims: ReturnType<typeof aimsOf>, key: string, signal: AbortSignal) {
  const topics = roadmapTopics(notebook, await readText(outline))
  const sections = sectionsOf(topics)
  const prev = await loadSorted(notebook)
  // What the sections are for depends on the aims; which topics are history doesn't
  const sorted: SortedRoadmap = {
    version: 1,
    notebook,
    aimsKey: key,
    model: prev?.model ?? '',
    at: prev?.at ?? 0,
    sections: prev?.aimsKey === key ? prev.sections : {},
    enrichment: prev?.enrichment ?? [],
    looked: prev?.looked ?? []
  }
  // Forget what's no longer in the roadmap
  const sectionIds = new Set(sections.map((s) => s.id))
  const topicIds = new Set(topics.map((t) => t.id))
  sorted.sections = Object.fromEntries(Object.entries(sorted.sections).filter(([id]) => sectionIds.has(id)))
  sorted.enrichment = sorted.enrichment.filter((id) => topicIds.has(id))
  sorted.looked = sorted.looked.filter((id) => topicIds.has(id))
  const save = async (model: string) => {
    sorted.model = model
    sorted.at = Date.now()
    await writeText(fileFor(notebook), JSON.stringify(sorted))
  }

  const todo = sections.filter((s) => !sorted.sections[s.id] || (!s.tagged && !sorted.sections[s.id].class))
  for (let i = 0; i < todo.length; i += SECTION_BATCH) {
    const batch = todo.slice(i, i + SECTION_BATCH)
    const { text, model } = await ask(SORT_SYSTEM, sortPrompt(aims, notebook, batch), onMac, signal)
    Object.assign(sorted.sections, parseSort(extractJsonObject(text), aims, batch))
    await save(model)
  }

  // History and background, for weekend primers: only where it would otherwise be taught on a weekday
  const looked = new Set(sorted.looked)
  const toLook = topics.filter((t) => !t.project && !looked.has(t.id) && !['elective', 'skip'].includes(classOf(t, sorted, {}, aims) ?? ''))
  for (let i = 0; i < toLook.length; i += TOPIC_BATCH) {
    const batch = toLook.slice(i, i + TOPIC_BATCH)
    const { text, model } = await ask(ENRICH_SYSTEM, enrichPrompt(batch), onMac, signal)
    const found = parseEnrich(extractJsonObject(text), batch)
    sorted.enrichment = [...new Set([...sorted.enrichment, ...found])]
    sorted.looked = [...sorted.looked, ...batch.map((t) => t.id)]
    await save(model)
  }
  if (!todo.length && !toLook.length && prev?.aimsKey !== key) await save(sorted.model)
}

/** How far each roadmap is sorted for the current aims */
export async function curriculumStatus(): Promise<SortStatus[]> {
  const key = aimsKey(aimsOf(await getCoach()))
  const out: SortStatus[] = []
  for (const nb of await getNotebooks()) {
    if (!nb.outline) continue
    const sections = sectionsOf(roadmapTopics(nb.name, await readText(nb.outline).catch(() => '')))
    const sorted = await loadSorted(nb.name)
    const done = sorted?.aimsKey === key ? sections.filter((s) => sorted.sections[s.id]).length : 0
    out.push({ notebook: nb.name, sorted: isSorted(sorted, sections, key), sections: sections.length, done })
  }
  return out
}

export const sortError = () => lastError

/** What the roadmap page shows next to each topic */
export async function curriculumView(notebook: string): Promise<CurriculumView> {
  const nb = (await getNotebooks()).find((n) => n.name === notebook || n.path === notebook)
  if (!nb?.outline) return { sorted: false, topics: {} }
  const aims = aimsOf(await getCoach())
  const key = aimsKey(aims)
  const topics = roadmapTopics(nb.name, await readText(nb.outline))
  const [sorted, overrides] = await Promise.all([loadSorted(nb.name), getOverrides()])
  // History found for other aims still holds; what sections are for doesn't
  const live = sorted && (sorted.aimsKey === key ? sorted : { ...sorted, sections: {} })
  const out: CurriculumView['topics'] = {}
  for (const t of topics) out[t.id] = { class: classOf(t, live, overrides, aims), own: !!(overrides[t.id] ?? overrides[t.sectionId]), value: sectionValue(live?.sections[t.sectionId], aims) }
  return { sorted: isSorted(live, sectionsOf(topics), key), topics: out }
}
