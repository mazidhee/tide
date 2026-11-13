/**
 * What the knowledge map says about a lesson's topic, for the difficulty policy
 * (shared/difficulty.ts): the concept's estimate and those of what it builds on. Read once when
 * the lesson opens.
 */
import type { Known } from '@shared/difficulty'

export async function knownFor(topic: string): Promise<Known> {
  const empty: Known = { concept: null, prerequisites: [] }
  if (!topic.trim()) return empty
  try {
    const picture = await (await import('./knowledge')).conceptPicture(topic)
    if (!picture) return empty
    return { concept: picture.topic && picture.topic.seen > 0 ? picture.topic.estimate : null, prerequisites: picture.prerequisites.map((p) => ({ name: p.name, estimate: p.estimate })) }
  } catch {
    return empty
  }
}
