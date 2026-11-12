/**
 * Who teaches a turn: Claude (the user's own plan, through Claude Code) or Gemma on this Mac.
 * The hard rule first: a private project or anything about the user's Metabase is always Gemma's,
 * whatever was chosen. Then the lesson's own choice, the notebook's, and the "Who teaches" setting
 * (Claude by default once it is set up).
 */
import type { ChatRequest, ClaudeSettings } from '@shared/types'

export type Teacher = { who: 'claude' } | { who: 'gemma'; /** Said in a step when Claude was wanted but can't teach this */ why?: string } | { who: 'cloud' }

export interface TeacherInput {
  engine?: ChatRequest['engine']
  /** The notebook's "Who teaches" */
  notebook?: 'auto' | 'cloud' | 'claude' | 'gemma'
  setting?: ClaudeSettings['teacher']
  /** Claude Code is installed */
  installed: boolean
  /** ...and logged in to a plan, and not at its limit */
  ready: boolean
  /** Why it isn't ready, in a few words */
  notReady?: string
  /** A private project or Metabase */
  private: boolean
}

export function chooseTeacher(o: TeacherInput): Teacher {
  const wanted = o.engine === 'claude' ? 'claude' : o.engine === 'local' ? 'gemma' : o.engine === 'cloud' ? 'cloud' : o.notebook === 'claude' || o.notebook === 'gemma' ? o.notebook : o.notebook === 'cloud' ? 'cloud' : (o.setting ?? 'claude')
  if (wanted === 'cloud') return { who: 'cloud' }
  if (wanted === 'gemma') return { who: 'gemma' }
  // Asked for in so many words (here, or the notebook or setting says Claude while Claude Code is
  // installed): when it can't, say why. Never installed and never chosen: Gemma, without a word.
  const explicit = o.engine === 'claude' || o.notebook === 'claude' || o.setting === 'claude' || o.installed
  if (o.private) return { who: 'gemma', why: explicit ? 'Private: this stays on your Mac, so Gemma is teaching' : undefined }
  if (!o.installed) return { who: 'gemma', why: explicit ? 'Claude Code isn’t installed, so Gemma is teaching' : undefined }
  if (!o.ready) return { who: 'gemma', why: `Claude can’t teach right now (${o.notReady ?? 'not ready'}), so Gemma is teaching` }
  return { who: 'claude' }
}

/** A private project's documents, or anything about the user's Metabase: never sent off this Mac */
export async function isPrivateTurn(req: Pick<ChatRequest, 'scope' | 'messages'>): Promise<boolean> {
  const { metabaseHost, metabaseReady } = await import('./metabase')
  const { aboutMetabase } = await import('@shared/metabase')
  if (metabaseReady() && req.messages.some((m) => aboutMetabase(m.content, metabaseHost()))) return true
  // Lessons that talk about Metabase by name are kept on the Mac even before it's connected
  if (req.messages.some((m) => typeof m.content === 'string' && /\bmetabase\b/i.test(m.content))) return true
  if (req.scope.kind === 'none' || req.scope.kind === 'vault') return false
  const { privatePath } = await import('./projects')
  // Unsure counts as private
  return privatePath(req.scope.path).catch(() => true)
}

/** The notebook a lesson or chat is in, for its "Who teaches" */
export async function notebookTutor(req: Pick<ChatRequest, 'scope'>): Promise<TeacherInput['notebook']> {
  if (req.scope.kind === 'none' || req.scope.kind === 'vault') return undefined
  const where = req.scope.path
  const { getNotebooks } = await import('./learn')
  const nbs = await getNotebooks().catch(() => [])
  return nbs.find((n) => where === n.path || where.startsWith(`${n.path}/`))?.tutor
}

/** Who teaches this turn, with everything looked up */
export async function teacherFor(req: ChatRequest): Promise<Teacher> {
  const { getSettings } = await import('./settings')
  const { claudeInstalled, claudeReady } = await import('./claudeEngine')
  const [priv, notebook] = await Promise.all([isPrivateTurn(req), notebookTutor(req)])
  const setting = getSettings().ai.claude?.teacher
  const installed = claudeInstalled()
  // Only ask the CLI when Claude could be the one
  const wantsClaude = chooseTeacher({ engine: req.engine, notebook, setting, installed, ready: true, private: false }).who === 'claude'
  const r = wantsClaude && !priv ? await claudeReady() : { installed, ready: false, why: undefined }
  return chooseTeacher({ engine: req.engine, notebook, setting, installed, ready: r.ready, notReady: r.why, private: priv })
}
