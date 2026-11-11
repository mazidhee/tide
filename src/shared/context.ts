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
 *
 * Where the history is cut moves in steps of half the budget, not by a message every turn. The
 * local model can only continue from a saved prompt that the new one starts with exactly: a cut
 * that slid along with each turn changed the start of every prompt once a lesson was long, so
 * every turn was read from the setup message on (5,000-7,000 tokens, 25-35 seconds). In steps,
 * the start stays the same for several turns at a time.
 */
export function fitHistory<T extends Msg>(messages: T[], budget: number, keepFirst = false): T[] {
  if (!messages.length) return messages
  const cost = (m: T) => estimateTokens(m.content) + 4
  const total = messages.reduce((n, m) => n + cost(m), 0)
  if (total <= budget) return messages
  const first = keepFirst && messages.length > 1 ? messages[0] : null
  const start = first ? 1 : 0
  const room = budget - (first ? cost(first) : 0)
  // The newest messages that fit
  let used = 0
  let cut = messages.length
  for (let i = messages.length - 1; i >= start; i--) {
    const c = cost(messages[i])
    if (cut < messages.length && used + c > room) break
    if (cut === messages.length && used + c > room) {
      // Even the newest message is too big: keep its end, which is usually the question
      const keep = Math.max(200, Math.floor(room * 3.6))
      const kept = [{ ...messages[i], content: '…' + messages[i].content.slice(-keep) }]
      return withMarker(first, messages.length - 1 - start, kept)
    }
    cut = i
    used += c
  }
  if (cut === start) return messages
  // The cut moves on to the next fixed place: where the running cost from the start of the
  // conversation passes a multiple of half the room
  const step = Math.max(1, Math.floor(room / 2))
  let acc = 0
  for (let i = start; i < messages.length - 1; i++) {
    const before = Math.floor(acc / step)
    acc += cost(messages[i])
    if (i + 1 >= cut && Math.floor(acc / step) > before) {
      cut = i + 1
      break
    }
  }
  return withMarker(first, cut - start, messages.slice(cut))
}

function withMarker<T extends Msg>(first: T | null, dropped: number, kept: T[]): T[] {
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
