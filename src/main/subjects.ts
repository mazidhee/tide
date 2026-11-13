/**
 * The subject layer in the main process: profiles kept in .tide/subjects.json, the stronger model
 * asked only for a topic the map can't place (main/subjectResolve), and what this Mac can run, for
 * capability honesty (shared/capability). Used by a lesson's first turn (agent.ts) and by the
 * roadmap builder (planner.ts, outlineDraft.ts).
 */
import type { ChatScope } from '@shared/types'
import { capabilityNote, type CapabilityStatus } from '@shared/capability'
import type { TrackPackId } from '@shared/trackPacks'
import { isUnclear, toolkitText, type SubjectProfile } from '@shared/subjects'
import { HUMANITIES_RULES } from '@shared/humanities'
import { askCloud } from './ai'
import { languageStates } from './languages'
import { labStatus, mathStatus } from './runner'
import { resolveProfile, type ResolveDeps, type StoredProfile } from './subjectResolve'
import { readText, writeText } from './vault'

const FILE = '.tide/subjects.json'

const deps: ResolveDeps = {
  ask: (system, prompt, signal) => askCloud(prompt, system, 'planning', signal, true, 300),
  load: async () => JSON.parse(await readText(FILE)) as Record<string, StoredProfile>,
  save: (all) => writeText(FILE, JSON.stringify(all, null, 2))
}

/** A topic's profile, decided once: the map's, a kept one, or the stronger model's */
export const subjectProfile = (topic: string, o: { notebook?: string; timeoutMs?: number } = {}) => resolveProfile(topic, deps, o)

// What runs here changes rarely (an install), and asking costs a few process starts: kept for ten minutes
let status: { at: number; value: Promise<Omit<CapabilityStatus, 'web'>> } | null = null
function runnable(): Promise<Omit<CapabilityStatus, 'web'>> {
  if (!status || Date.now() - status.at > 10 * 60_000) {
    status = {
      at: Date.now(),
      value: Promise.all([languageStates().catch(() => []), mathStatus().catch(() => ({ ready: false })), labStatus().catch(() => ({ ready: false })), packsInstalled().catch(() => ({}))]).then(([languages, maths, lab, packs]) => ({ languages, maths: maths.ready, labPack: lab.ready, packs }))
    }
  }
  return status.value
}

/** Which track packs are installed (the run tracker is built in, so it is never missing) */
async function packsInstalled(): Promise<Partial<Record<TrackPackId, boolean>>> {
  const { statusOf } = await import('./packs')
  const ids: TrackPackId[] = ['cpp', 'foundry', 'bigdata', 'postgres']
  const all = await Promise.all(ids.map((id) => statusOf(id).then((s) => s.ready, () => false)))
  return Object.fromEntries(ids.map((id, i) => [id, all[i]]))
}

/** After a pack is installed, the next lesson asks again */
export const forgetRunnable = () => {
  status = null
}

const notebookOf = (scope: ChatScope) => (scope.kind === 'folder' ? scope.path : scope.kind === 'note' || scope.kind === 'pages' ? scope.path.split('/').slice(0, -1).join('/') || undefined : undefined)

/** A lesson that teaches (not a quiz or an interview), from its instructions */
const teaches = (instructions: string) => /You are running a TEACH session|REFRESHER/.test(instructions)

/**
 * What a lesson's first turn adds for its subject: the toolkit when the topic's own words didn't
 * decide it (the roadmap or the model did), and one line for each thing Tide can't do for it,
 * with the substitute. '' for most lessons.
 */
export async function subjectContext(req: { topic: string; scope: ChatScope; instructions: string; web: boolean }): Promise<string> {
  if (!teaches(req.instructions)) return ''
  const p: SubjectProfile = await subjectProfile(req.topic, { notebook: notebookOf(req.scope), timeoutMs: 6000 })
  if (isUnclear(p)) return ''
  // The lesson screen composes the toolkit from the topic's words; only a profile found otherwise needs adding
  // The humanities' rules may be there already, from the topic's own words (shared/humanities), so they aren't added twice
  const kit = req.instructions.includes('How to teach this subject (') ? '' : toolkitText(req.topic, p, { humanities: !req.instructions.includes(HUMANITIES_RULES) })
  const can = capabilityNote(req.topic, p, { ...(await runnable()), web: req.web })
  return [kit, can].filter(Boolean).join('\n\n')
}
