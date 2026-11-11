/**
 * One tutor turn as the learner gets it, not as the model server first returns it. The app does
 * not show a raw completion: it reads the stream by the rules in shared/modelText (turnReader),
 * and when Gemma stalls in a thought channel part-way through its answer (seen in a quarter of the
 * first baseline's replies, typically straight after </grade>), it keeps what was written and
 * asks it to carry on; when it loops, it starts over once with more randomness (main/agent:
 * streamTurnContinuing, streamTurnRetrying). This is that policy, over whole completions, with the
 * same reader, the same carry-on message and the same numbers.
 *
 * Offline (a saved result with no model to ask), what the saved completion went on to write
 * after an empty thought block stands in for the carry-on; a reply that never got past its stall
 * is marked unfinished, and only its mark is read.
 */
import { beforeLoop, CARRY_ON, cleanModelText, turnReader, type TurnStop } from '../../../src/shared/modelText'
import type { Message } from './request'

/** A completion read as the app would read its stream: the text kept, why it stopped, and what was never read */
export function readCompletion(raw: string): { text: string; stop?: TurnStop; rest: string } {
  const read = turnReader()
  // Fed in pieces about the size of tokens, markers whole, so a stop lands where it would in a stream
  const pieces = raw.match(/<\|?[a-z_"]*\|?>|[^\s<]+\s*|\s+|</g) ?? []
  let at = 0
  for (const piece of pieces) {
    at += piece.length
    const { stop } = read.push(piece)
    if (stop) return { text: cleanModelText(read.text), stop, rest: raw.slice(at) }
  }
  return { text: cleanModelText(read.text), rest: '' }
}

const join = (written: string, more: string) => (written && more ? `${written}\n\n${more}` : written || more)

export interface Turned {
  /** What the learner is shown */
  reply: string
  /** How many times it stalled and was carried on */
  stalls: number
  /** It looped and was started over */
  looped: boolean
  /** Offline only: it stalled and nothing more of it was saved */
  unfinished?: boolean
}

/** Asks the model: `extra` is added to the temperature, and `retry` is a turn that already looped once (main/sampling) */
export type Ask = (messages: Message[], o: { extra: number; retry: boolean }) => Promise<string>

/** A live turn: carried past stalls (up to four pick-ups), started over once from a loop */
export async function tutorTurn(messages: Message[], ask: Ask): Promise<Turned> {
  let stalls = 0
  const continuing = async (): Promise<{ text: string; loop?: string }> => {
    let written = ''
    for (let i = 0; i < 4; i++) {
      const turn: Message[] = written ? [...messages, { role: 'assistant', content: written }, { role: 'user', content: CARRY_ON }] : messages
      const r = readCompletion(await ask(turn, { extra: i ? 0.15 : 0, retry: false }))
      if (!r.stop) return { text: join(written, r.text.trim()) }
      if (r.stop === 'loop') return { text: written, loop: join(written, r.text) }
      stalls++
      const more = r.text.trim()
      if (!more && i >= 2) return { text: written }
      written = join(written, more)
    }
    return { text: written }
  }
  const first = await continuing()
  if (first.loop === undefined) return { reply: first.text, stalls, looped: false }
  const again = readCompletion(await ask(messages, { extra: 0.35, retry: true }))
  if (!again.stop) return { reply: again.text.trim(), stalls, looped: true }
  // Stuck twice: what was said before it started repeating, rather than nothing
  return { reply: beforeLoop(again.text) || beforeLoop(first.loop), stalls, looped: true }
}

/** A saved completion read the same way, with nothing to ask */
export function savedTurn(raw: string): Turned {
  let rest = raw
  let written = ''
  let stalls = 0
  for (;;) {
    const r = readCompletion(rest)
    if (!r.stop) return { reply: join(written, r.text.trim()), stalls, looped: false }
    if (r.stop === 'loop') return { reply: join(written, beforeLoop(r.text)), stalls, looped: true, unfinished: true }
    stalls++
    written = join(written, r.text.trim())
    // Past the thought markers it stalled on: anything it then wrote is how it carried on
    rest = r.rest.replace(/^(?:\s*(?:<\|channel>|<channel\|>|thought(?=\s|<|$)))+\s*/, '')
    if (!rest.replace(/<\|?channel\|?>|thought/g, '').trim()) return { reply: written, stalls, looped: false, unfinished: true }
  }
}
