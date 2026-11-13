/**
 * Deciding a subject's profile once and keeping it: the map first (shared/subjects), then what was
 * kept for this topic or roadmap before, and only when both are silent, one question to the
 * stronger model, held to PROFILE_SCHEMA, whose answer is kept so it is never asked again.
 *
 * Everything that touches the world is passed in (main/subjects wires the real ones), so this can
 * be tested with the model stubbed.
 */
import { isUnclear, kindsFrom, parseModelProfile, profileKey, profilePrompt, profileSubject, PROFILE_SYSTEM, type SubjectProfile } from '@shared/subjects'

export interface ResolveDeps {
  /** The stronger model's whole answer; throws when none can take it */
  ask(system: string, prompt: string, signal: AbortSignal): Promise<string>
  /** The kept profiles, by key */
  load(): Promise<Record<string, StoredProfile>>
  save(all: Record<string, StoredProfile>): Promise<void>
}

export interface StoredProfile {
  kinds: string
  lab?: boolean
  needs?: string[]
  /** When it was decided, YYYY-MM-DD */
  at: string
}

export interface ResolveOptions {
  notebook?: string
  /** How long the model may take before the lesson goes on without it */
  timeoutMs?: number
}

const fromStored = (s: StoredProfile): SubjectProfile | null => {
  const kinds = kindsFrom(s.kinds)
  if (!kinds.length) return null
  return { kinds, subjects: [], from: 'model', ...(s.lab ? { lab: true } : {}), ...(kinds.includes('build') ? { hands: true } : {}), ...(s.needs?.length ? { needs: s.needs as SubjectProfile['needs'] } : {}) }
}

/** A subject's profile: the map's, a kept one, or the model's (then kept); unclear when none can say */
export async function resolveProfile(topic: string, deps: ResolveDeps, o: ResolveOptions = {}): Promise<SubjectProfile> {
  const mapped = profileSubject(topic, o.notebook)
  if (!isUnclear(mapped)) return mapped
  const keys = [profileKey(topic), ...(o.notebook ? [profileKey(o.notebook.split('/').pop() ?? o.notebook)] : [])].filter(Boolean)
  const all = await deps.load().catch(() => ({}) as Record<string, StoredProfile>)
  for (const k of keys) {
    const kept = all[k] && fromStored(all[k])
    if (kept) return kept
  }
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), o.timeoutMs ?? 8000)
  try {
    const text = await deps.ask(PROFILE_SYSTEM, profilePrompt(topic, o.notebook), stop.signal)
    const p = parseModelProfile(text)
    if (!p) return mapped
    all[keys[0]] = { kinds: p.kinds.join(', '), ...(p.lab ? { lab: true } : {}), ...(p.needs?.length ? { needs: p.needs } : {}), at: new Date().toISOString().slice(0, 10) }
    await deps.save(all).catch(() => {})
    return p
  } catch {
    return mapped
  } finally {
    clearTimeout(timer)
  }
}
