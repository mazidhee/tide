/**
 * Visuals written once and kept (shared/sceneCache): a concept's visual for a ```draw block, and
 * each module part's big picture, a 3D scene. Where one comes from, in order:
 * - a kept one in the vault that passed Tide's check and wasn't thumbed down (instant);
 * - Tide's own kit visual for the concept (shared/kitVisuals: no model, so it is there without Claude);
 * - the visual model (Fable by default, Settings › Claude › Visuals and 3D scenes) writing it now,
 *   kept unchecked until the window's check passes (keepVisual), dropped if it fails (dropVisual).
 * "Redraw" skips the first two; "Was this clear?" is kept with the file.
 */
import { promises as fs } from 'fs'
import { kitVisualFor, type KitVisual } from '@shared/kitVisuals'
import { CONCEPT_VISUAL_SYSTEM, PART_SCENE_SYSTEM, conceptFile, conceptVisualPrompt, keptText, partBrief, partFile, partKey, partScenePrompt, readKept, topicText, usable, type KeptVisual } from '@shared/sceneCache'
import { extractVisual, looksComplete, visualTitle, MAX_SCENE } from '@shared/visuals'
import { absPath, readText, writeText } from './vault'

export type VisualKind = 'concept' | 'part'

export interface ResolvedVisual {
  code?: string
  /** Where it came from */
  source?: 'kept' | 'kit' | 'model'
  model?: string
  at?: string
  /** The file it is kept in, for keepVisual, dropVisual and feedback */
  key?: string
  feedback?: 'up' | 'down'
  /** It must pass the window's check before it is kept as checked */
  unchecked?: boolean
  title?: string
  error?: string
}

const fileOf = (kind: VisualKind, key: string) => (kind === 'part' ? partFile(key) : conceptFile(key))

async function readFile(kind: VisualKind, key: string): Promise<KeptVisual | null> {
  return readKept(await readText(fileOf(kind, key)).catch(() => ''))
}

const today = () => new Date().toISOString().slice(0, 10)

/** One call at a time per file: a second ask waits for the first */
const writing = new Map<string, Promise<ResolvedVisual>>()

/** Asks the visual model for a visual; the code, or an error */
export async function writeWithModel(system: string, prompt: string, max: number): Promise<{ code?: string; model?: string; error?: string }> {
  const { claudeTeaches, claudeOnce } = await import('./claudeEngine')
  if (!(await claudeTeaches().catch(() => false))) return { error: 'Claude is not set up to teach, so Tide can only show its own visuals.' }
  try {
    const r = await claudeOnce(prompt, system, 'visual', undefined, undefined, [], 'visual')
    const code = extractVisual(r.text)
    if (!code || !looksComplete(code)) return { error: 'The visual model did not give a complete visual.' }
    if (code.length > max) return { error: `The visual came out too long (${code.length} characters).` }
    return { code, model: r.model }
  } catch (e) {
    return { error: `The visual model could not write it: ${(e as Error).message}`.slice(0, 300) }
  }
}

const fromKit = (v: KitVisual, key: string): ResolvedVisual => ({ code: v.code, source: 'kit', key, title: v.title })

// ---------- A concept (```draw) ----------

export async function visualForConcept(req: { concept?: unknown; show?: unknown; topic?: unknown; redraw?: unknown }): Promise<ResolvedVisual> {
  const concept = String(req.concept ?? '').trim().slice(0, 120)
  const show = String(req.show ?? '').trim().slice(0, 400)
  const topic = String(req.topic ?? '').trim().slice(0, 200)
  if (!concept) return { error: 'No concept to draw.' }
  const key = concept
  const redraw = req.redraw === true
  const kept = await readFile('concept', key)
  if (!redraw && usable(kept)) return { code: kept.code, source: 'kept', model: kept.meta.model, at: kept.meta.at, key, feedback: kept.meta.feedback, title: kept.meta.title }
  const kit = kitVisualFor(`${concept} ${show}`)
  // A thumbed-down kept visual falls to the kit's, if there is one, before asking the model again
  if (!redraw && kit && !(kept && kept.meta.feedback === 'down' && kept.meta.model === 'tide')) return fromKit(kit, key)
  const id = `concept:${conceptFile(key)}`
  let p = writing.get(id)
  if (!p) {
    p = (async () => {
      const r = await writeWithModel(CONCEPT_VISUAL_SYSTEM, conceptVisualPrompt({ concept, show, topic }), MAX_SCENE)
      if (!r.code) return kit ? { ...fromKit(kit, key), error: r.error } : { error: r.error }
      await writeText(conceptFile(key), keptText({ code: r.code, meta: { model: r.model ?? 'unknown', at: today(), checked: false, title: visualTitle(r.code) || concept, show } }))
      return { code: r.code, source: 'model' as const, model: r.model, at: today(), key, unchecked: true, title: visualTitle(r.code) || concept }
    })().finally(() => writing.delete(id))
    writing.set(id, p)
  }
  return p
}

// ---------- A module part's big picture ----------

export interface PartInfo {
  module: string
  moduleTitle: string
  part: number
  title: string
  topics: string[]
  depthGoal?: string
  others: string[]
}

/** A module part, by module id and part number (from 1) */
export async function partInfo(module: string, part: number): Promise<PartInfo | null> {
  const { loadCatalogue } = await import('./modules')
  const cat = await loadCatalogue().catch(() => null)
  const m = cat?.modules.find((x) => x.id === module)
  return m ? partBrief(m, part) : null
}

/** The module part a lesson's topic belongs to, or null */
export async function partOfTopic(topic: unknown): Promise<PartInfo | null> {
  const t = String(topic ?? '').trim().toLowerCase()
  if (!t) return null
  const { loadCatalogue } = await import('./modules')
  const { moduleParts } = await import('@shared/modules')
  const cat = await loadCatalogue().catch(() => null)
  if (!cat) return null
  const clean = (s: string) => topicText(s).toLowerCase()
  for (const m of cat.modules) {
    const parts = moduleParts(m)
    const i = parts.findIndex((p) => p.topics.some((x) => clean(x.title) === t || x.id === topic))
    if (i >= 0) return partInfo(m.id, i + 1)
  }
  return null
}

/** A module's parts, and which have a kept scene */
export async function partsOfModule(module: unknown): Promise<{ part: number; title: string; kept: boolean }[]> {
  const { loadCatalogue } = await import('./modules')
  const { moduleParts } = await import('@shared/modules')
  const cat = await loadCatalogue().catch(() => null)
  const m = cat?.modules.find((x) => x.id === String(module ?? ''))
  if (!m) return []
  const parts = moduleParts(m)
  return Promise.all(parts.map(async (p, i) => ({ part: i + 1, title: p.title, kept: usable(await readFile('part', partKey(m.id, i + 1))) })))
}

/** The kit visual that best stands in for a part's scene (its topics, in order), or null */
export const partFallback = (info: Pick<PartInfo, 'title' | 'topics'>): KitVisual | null => {
  for (const t of [...info.topics, info.title]) {
    const v = kitVisualFor(t)
    if (v) return v
  }
  return null
}

export async function partScene(req: { module?: unknown; part?: unknown; redraw?: unknown }): Promise<ResolvedVisual & { info?: PartInfo; fallback?: string }> {
  const info = await partInfo(String(req.module ?? ''), Number(req.part) || 1)
  if (!info) return { error: 'No such part.' }
  const key = partKey(info.module, info.part)
  const kept = await readFile('part', key)
  const kit = partFallback(info)
  const fallback = kit?.code
  if (req.redraw !== true && usable(kept)) return { code: kept.code, source: 'kept', model: kept.meta.model, at: kept.meta.at, key, feedback: kept.meta.feedback, title: kept.meta.title, info, fallback }
  const id = `part:${key}`
  let p = writing.get(id)
  if (!p) {
    p = (async () => {
      const r = await writeWithModel(PART_SCENE_SYSTEM, partScenePrompt({ module: info.moduleTitle, part: info.title, depthGoal: info.depthGoal, topics: info.topics, others: info.others }), MAX_SCENE)
      if (!r.code) return kit ? { ...fromKit(kit, key), error: r.error } : { error: r.error }
      await writeText(partFile(key), keptText({ code: r.code, meta: { model: r.model ?? 'unknown', at: today(), checked: false, title: visualTitle(r.code) || info.title } }))
      return { code: r.code, source: 'model' as const, model: r.model, at: today(), key, unchecked: true, title: visualTitle(r.code) || info.title }
    })().finally(() => writing.delete(id))
    writing.set(id, p)
  }
  return { ...(await p), info, fallback }
}

// ---------- After the window's check ----------

/** The visual passed the check (repaired or not): kept as checked, with the code that ran */
export async function keepVisual(kind: unknown, key: unknown, code: unknown, repaired?: unknown): Promise<boolean> {
  const k: VisualKind = kind === 'part' ? 'part' : 'concept'
  if (typeof key !== 'string' || !key || typeof code !== 'string' || !code.trim() || code.length > MAX_SCENE) return false
  const was = await readFile(k, key)
  if (!was) return false
  await writeText(fileOf(k, key), keptText({ code: repaired === true ? code : was.code, meta: { ...was.meta, checked: true, ...(repaired === true ? { repaired: true } : {}) } }))
  return true
}

/** It failed the check and its repair: not kept, so the next time asks again */
export async function dropVisual(kind: unknown, key: unknown): Promise<boolean> {
  const k: VisualKind = kind === 'part' ? 'part' : 'concept'
  if (typeof key !== 'string' || !key) return false
  const was = await readFile(k, key)
  if (!was || was.meta.checked) return false
  await fs.rm(absPath(fileOf(k, key)), { force: true }).catch(() => {})
  return true
}

/** "Was this clear?": kept with the visual; a thumbs-down redraws it next time */
export async function visualFeedback(kind: unknown, key: unknown, feedback: unknown): Promise<boolean> {
  const k: VisualKind = kind === 'part' ? 'part' : 'concept'
  if (typeof key !== 'string' || !key || (feedback !== 'up' && feedback !== 'down')) return false
  const was = await readFile(k, key)
  if (was) {
    await writeText(fileOf(k, key), keptText({ code: was.code, meta: { ...was.meta, feedback } }))
    return true
  }
  // A kit visual thumbed down: kept as a note, so the model draws it next time
  if (k === 'concept' && feedback === 'down') {
    const kit = kitVisualFor(key)
    if (kit) await writeText(conceptFile(key), keptText({ code: kit.code, meta: { model: 'tide', at: today(), checked: true, feedback } }))
    return !!kit
  }
  return false
}
