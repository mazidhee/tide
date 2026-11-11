/**
 * What the knowledge map says about a lesson's topic, for the difficulty policy
 * (shared/difficulty.ts): the concept's estimate and those of what it builds on. Read once when
 * the lesson opens. Concepts from a private project are included only when the lesson is itself in
 * a private project (its turns then stay on this Mac), because a prerequisite's name can end up in
 * the hidden note the tutor is sent.
 */
import type { Known } from '@shared/difficulty'

export async function knownFor(topic: string, path?: string): Promise<Known> {
  const empty: Known = { concept: null, prerequisites: [] }
  if (!topic.trim()) return empty
  try {
    const privateOk = path ? await import('./projects').then((m) => m.privatePath(path)).catch(() => false) : false
    const picture = await (await import('./knowledge')).conceptPicture(topic, privateOk)
    if (!picture) return empty
    return { concept: picture.topic && picture.topic.seen > 0 ? picture.topic.estimate : null, prerequisites: picture.prerequisites.map((p) => ({ name: p.name, estimate: p.estimate })) }
  } catch {
    return empty
  }
}
