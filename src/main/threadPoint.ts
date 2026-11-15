/**
 * "Save to notes" on a side thread's reply: the notes model (Claude's background model, Haiku)
 * distils the reply into one key point for the lesson's notes (shared/lessonThreads POINT_SYSTEM).
 * Only the reply goes to it, never the learner's question. Without Claude it returns null and the
 * renderer keeps the point taken from the reply by code (shared/lessonThreads keyPoint): a saved
 * point is never worth loading Gemma for.
 */
import { POINT_SYSTEM, cleanPoint, pointPrompt } from '@shared/lessonThreads'

export async function threadPoint(reply: string, opts: { quote?: string; topic?: string } = {}): Promise<string | null> {
  const text = reply.trim()
  if (!text) return null
  const [{ jobRoute }, { withUsage }] = await Promise.all([import('./ai'), import('./usageLog')])
  if ((await jobRoute('threadPoint')).who !== 'claude') return null
  const { claudeOnce } = await import('./claudeEngine')
  const r = await withUsage({ job: 'threadPoint' }, () => claudeOnce(pointPrompt(text, opts), POINT_SYSTEM, 'background', AbortSignal.timeout(30_000))).catch(() => null)
  return r ? cleanPoint(r.text) : null
}
