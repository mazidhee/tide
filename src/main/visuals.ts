/**
 * Claude's visuals (shared/visuals), the parts that need main: whether a lesson may show them, one
 * repair by Claude when a visual fails its check, a mermaid or table fallback when the repair
 * fails too, and each lesson's kept visuals in its record, so reopening it needs no new call.
 */
import { VISUAL_FALLBACK_SYSTEM, VISUAL_REPAIR_SYSTEM, cleanRecord, extractVisual, fallbackPrompt, looksComplete, repairPrompt, MAX_SCENE, MAX_VISUAL, type VisualRecord } from '@shared/visuals'
import { SCENE_REPAIR_NOTE } from '@shared/sceneCache'

export interface VisualPolicy {
  /** Visuals may run here */
  show: boolean
  /** Claude may be asked to repair one (it teaches and it's ready) */
  repair: boolean
  why?: string
}

export async function visualPolicy(): Promise<VisualPolicy> {
  const { claudeTeaches } = await import('./claudeEngine')
  const repair = await claudeTeaches().catch(() => false)
  return { show: true, repair }
}

/** Errors as the visual reported them, bounded */
const cleanErrors = (errors: unknown): string[] => (Array.isArray(errors) ? errors.filter((e): e is string => typeof e === 'string').slice(0, 8).map((e) => e.slice(0, 400)) : [])

/**
 * One repair: the visual and what went wrong go back to Claude (the teaching model), and the
 * fixed visual comes back, or null when Claude can't or didn't give one.
 */
export async function repairVisual(req: { code: string; errors: string[]; scope: unknown; scene?: boolean }, signal?: AbortSignal): Promise<{ code: string } | null> {
  const scene = req.scene === true
  const code = typeof req.code === 'string' ? req.code.slice(0, scene ? MAX_SCENE : MAX_VISUAL) : ''
  if (!code.trim()) return null
  const policy = await visualPolicy()
  if (!policy.repair) return null
  const { claudeOnce } = await import('./claudeEngine')
  const errors = cleanErrors(req.errors)
  try {
    // A kept visual or a scene is repaired by the model that writes them; a lesson's own by the lesson's
    const r = await claudeOnce(repairPrompt(code, errors.length ? errors : ['It did not finish loading.']), scene ? `${VISUAL_REPAIR_SYSTEM}\n${SCENE_REPAIR_NOTE}` : VISUAL_REPAIR_SYSTEM, scene ? 'visual' : 'teach', signal)
    const fixed = extractVisual(r.text)
    return fixed && looksComplete(fixed) ? { code: fixed } : null
  } catch {
    // Claude can't (unavailable, at its limit) or failed: the window falls back
    return null
  }
}

/** Something Tide always draws (a mermaid block or a table), for a visual that couldn't be repaired: Markdown, or null */
export async function visualFallback(req: { code: string; title: string; scope: unknown }, signal?: AbortSignal): Promise<string | null> {
  const policy = await visualPolicy()
  if (!policy.repair) return null
  const { claudeOnce } = await import('./claudeEngine')
  try {
    const r = await claudeOnce(fallbackPrompt(String(req.code ?? ''), String(req.title ?? '').slice(0, 120)), VISUAL_FALLBACK_SYSTEM, 'background', signal)
    const text = r.text.trim()
    // Only what Tide draws itself: a mermaid block or a table, never another visual
    if (/```(visual|html)/i.test(text) || !(/```mermaid/i.test(text) || /^\s*\|.+\|\s*$/m.test(text))) return null
    return text.slice(0, 20_000)
  } catch {
    return null
  }
}

// ---------- Kept with the lesson ----------

export async function lessonVisuals(lessonId: string): Promise<Record<string, VisualRecord>> {
  if (typeof lessonId !== 'string' || !lessonId) return {}
  const { getLesson } = await import('./lessons')
  return (await getLesson(lessonId))?.visuals ?? {}
}

export async function rememberVisual(lessonId: string, key: string, record: unknown, source?: unknown): Promise<boolean> {
  if (typeof lessonId !== 'string' || !lessonId || typeof key !== 'string' || !/^v[a-z0-9]{4,32}$/.test(key)) return false
  const clean = cleanRecord(record)
  if (!clean) return false
  const { keepLessonVisual, getLesson } = await import('./lessons')
  // A working explorable in a maths lesson joins the library (main/explorables), as it finally ran
  if (clean.status === 'ok') {
    const code = clean.code ?? (typeof source === 'string' ? source : '')
    const topic = (await getLesson(lessonId).catch(() => null))?.topic ?? ''
    if (code && topic) await (await import('./explorables')).keepExplorable(code, topic).catch(() => false)
  }
  return keepLessonVisual(lessonId, key, clean)
}

