/**
 * Who teaches a turn: Claude (the user's own plan, through Claude Code) or Gemma on this Mac.
 * The lesson's own choice, the notebook's, and the "Who teaches" setting (Claude by default once
 * it is set up). Gemma teaches only when picked or when Claude can't.
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
}

export function chooseTeacher(o: TeacherInput): Teacher {
  const wanted = o.engine === 'claude' ? 'claude' : o.engine === 'local' ? 'gemma' : o.engine === 'cloud' ? 'cloud' : o.notebook === 'claude' || o.notebook === 'gemma' ? o.notebook : o.notebook === 'cloud' ? 'cloud' : (o.setting ?? 'claude')
  if (wanted === 'cloud') return { who: 'cloud' }
  if (wanted === 'gemma') return { who: 'gemma' }
  // Asked for in so many words (here, or the notebook or setting says Claude while Claude Code is
  // installed): when it can't, say why. Never installed and never chosen: Gemma, without a word.
  const explicit = o.engine === 'claude' || o.notebook === 'claude' || o.setting === 'claude' || o.installed
  if (!o.installed) return { who: 'gemma', why: explicit ? 'Claude Code isn’t installed, so Gemma is teaching' : undefined }
  if (!o.ready) return { who: 'gemma', why: `Claude can’t teach right now (${o.notReady ?? 'not ready'}), so Gemma is teaching` }
  return { who: 'claude' }
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
  const notebook = await notebookTutor(req)
  const setting = getSettings().ai.claude?.teacher
  const installed = claudeInstalled()
  // Only ask the CLI when Claude could be the one
  const wantsClaude = chooseTeacher({ engine: req.engine, notebook, setting, installed, ready: true }).who === 'claude'
  const r = wantsClaude ? await claudeReady() : { installed, ready: false, why: undefined }
  return chooseTeacher({ engine: req.engine, notebook, setting, installed, ready: r.ready, notReady: r.why })
}
