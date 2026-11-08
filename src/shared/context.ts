/**
 * Keeping conversations inside a local model's context. Token counts are estimated from
 * characters (about 3.6 per token for English prose and code), which is close enough to budget with
 * and needs no tokenizer.
 */

export const estimateTokens = (text: string) => Math.ceil(text.length / 3.6)

export interface Msg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Fits a history into a token budget. The newest messages are kept whole; when a conversation
 * opens with a setup message (a session's instructions) that one is kept too, and whatever is
 * dropped from the middle is marked so the model knows something is missing. The last message
 * is always kept, clipped if it alone is over budget.
 */
export function fitHistory<T extends Msg>(messages: T[], budget: number, keepFirst = false): T[] {
  if (!messages.length) return messages
  const cost = (m: T) => estimateTokens(m.content) + 4
  const total = messages.reduce((n, m) => n + cost(m), 0)
  if (total <= budget) return messages
  const first = keepFirst && messages.length > 1 ? messages[0] : null
  let used = first ? cost(first) : 0
  const kept: T[] = []
  for (let i = messages.length - 1; i >= (first ? 1 : 0); i--) {
    const c = cost(messages[i])
    if (kept.length && used + c > budget) break
    if (!kept.length && used + c > budget) {
      // Even the newest message is too big: keep its end, which is usually the question
      const room = Math.max(200, Math.floor((budget - used) * 3.6))
      kept.unshift({ ...messages[i], content: '…' + messages[i].content.slice(-room) })
      used = budget
      break
    }
    kept.unshift(messages[i])
    used += c
  }
  const dropped = messages.length - kept.length - (first ? 1 : 0)
  if (!dropped) return first ? [first, ...kept] : kept
  const marker = { role: 'user', content: `[${dropped} earlier message${dropped === 1 ? '' : 's'} left out to save space]` } as T
  // Keep roles alternating: the marker stands in for what was dropped
  return first ? [first, marker, ...kept] : [marker, ...kept]
}

/** Where to cut for compaction: everything before the last `keep` messages, if that's worth summarizing */
export function compactionCut(count: number, summarizedUpTo: number, keep = 4): number | null {
  const cut = count - keep
  return cut - summarizedUpTo >= 4 ? cut : null
}
