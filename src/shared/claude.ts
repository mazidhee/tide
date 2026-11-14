import type { ClaudeModel, ClaudeRole, ClaudeSettings } from './types'

/**
 * Which Claude model does what. Ordinary lesson and chat turns on Sonnet; Opus where being right
 * matters most (marking, maths and proofs, lesson plans and roadmaps, explanations asked to go
 * deep); Haiku for background jobs; Fable for visuals and 3D scenes, which are written once and
 * kept (main/conceptVisuals). Fable is offered for the hardest material too. Older Opus
 * versions are not offered: they cost three to four times as much per call.
 */
export const CLAUDE_DEFAULTS: Record<ClaudeRole, ClaudeModel> = { teach: 'sonnet', mark: 'opus', hard: 'opus', background: 'haiku', visual: 'claude-fable-5-1' }

export const CLAUDE_MODELS: { id: ClaudeModel; label: string; note: string }[] = [
  { id: 'sonnet', label: 'Sonnet', note: 'Fast, for most turns' },
  { id: 'opus', label: 'Opus', note: 'Marking, maths, plans' },
  { id: 'claude-fable-5-1', label: 'Fable', note: 'The hardest material' },
  { id: 'haiku', label: 'Haiku', note: 'Background work' }
]

export const claudeLabel = (m: string) => CLAUDE_MODELS.find((x) => x.id === m)?.label ?? (/fable/i.test(m) ? 'Fable' : /opus/i.test(m) ? 'Opus' : /sonnet/i.test(m) ? 'Sonnet' : /haiku/i.test(m) ? 'Haiku' : m)

/** Stronger first: a role whose model is at least the marker's needs no separate marking call */
const RANK: Record<string, number> = { haiku: 0, sonnet: 1, opus: 2, 'claude-fable-5-1': 3 }
export const rank = (m: string) => RANK[m] ?? (/fable/i.test(m) ? 3 : /opus/i.test(m) ? 2 : /sonnet/i.test(m) ? 1 : 0)

export function claudeModel(role: ClaudeRole, s?: ClaudeSettings, lesson?: ClaudeModel): ClaudeModel {
  if (role === 'teach' && lesson) return lesson
  return s?.models?.[role] ?? CLAUDE_DEFAULTS[role]
}

/** The student asks for depth in so many words: that turn goes to the "hard" model */
export const asksForDepth = (said: string) => /\b(in (more )?depth|rigorous(ly)?|go deeper|deep dive|properly prove|prove (it|this|that)|full derivation|derive (it|this))\b/i.test(said)
