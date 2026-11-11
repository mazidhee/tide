import { replay, type Scenario } from './vectorClock'

/**
 * Wrong facts a small tutor was seen teaching, caught by rule and shown wrong by running something,
 * so no model has to be trusted to notice (with no cloud key, the claim check never ran at all):
 * - "a float is a precise decimal": 0.1 + 0.2 == 0.3 is run, and is False;
 * - a variable as a box that holds its value, in Python: two names are shown sharing one list;
 * - "receiving a message never increments a vector clock" (a flashcard): the textbook rules are
 *   replayed on a send and its receipt, and the receiver's own entry goes up.
 * Each finding names the sentence and says what is right, with what running it showed.
 */

export type FactId = 'float-exact' | 'variable-box' | 'vc-receive' | 'vc-send'

export interface FactFinding {
  id: FactId
  quote: string
  /** What to run in the sandbox to show it (Python), when running shows it */
  demo?: string
}

const sentences = (text: string) =>
  text
    .replace(/<card>([\s\S]*?)<\/card>/gi, (_, c: string) => `\n${c.replace(/::/, ' — ')}.\n`)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`]/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)

const NEGATED = /\b(not|n['’]t|never|no longer|imprecise|inexact|approximat\w*|rounding|round-?off|binary fraction|can['’]t represent|cannot represent)\b/i

/** The sentences of a reply (its prose, flashcards and notes) that state one of the known wrong facts */
export function wrongFacts(reply: string, topic = ''): FactFinding[] {
  const out: FactFinding[] = []
  const all = sentences(reply)
  const python = /\bpython\b/i.test(`${topic} ${reply}`)
  const seen = new Set<FactId>()
  const add = (f: FactFinding) => {
    if (seen.has(f.id)) return
    seen.add(f.id)
    out.push(f)
  }
  for (const s of all) {
    // A float described as precise or exact (and not in a sentence that says it isn't)
    if (/\bfloat(s|ing[- ]point)?\b/i.test(s) && /\b(precise|exact(ly)?|accurate)\b/i.test(s) && !NEGATED.test(s) && !/\b(decimal\.Decimal|Decimal\b|integer cents)/.test(s.replace(/\bprecise decimal\b/i, '')))
      add({ id: 'float-exact', quote: s, demo: 'print(0.1 + 0.2 == 0.3, repr(0.1 + 0.2))' })
    // Python: a variable is a box that holds its value
    if (python && /\bvariables?\b[^.]{0,80}\b(box|boxes|container|bucket)\b/i.test(s) && !/\b(not|isn['’]t|rather than|instead of|unlike)\b[^.]{0,30}\b(box|container|bucket)/i.test(s) && !/\b(name|label|tag|refer\w*|bound|binding|points? (to|at))\b/i.test(s))
      add({ id: 'variable-box', quote: s, demo: 'a = [1]\nb = a\nb.append(2)\nprint(a, a is b)' })
    // Vector clocks: a receipt (or a send) said never to increment the clock
    const denies = /\b(never|not|n['’]t|no)\b[^.]{0,50}\bincrement|\bwithout increment|\bonly\b[^.]{0,40}\b(internal|local)\b[^.]{0,40}\bincrement/i
    if (/\bvector clocks?\b|\bvector\b/i.test(`${topic} ${s}`) && /\breceiv\w*|\breceipt\b/i.test(s) && denies.test(s) && !/\bsend\w*\b[^.]{0,40}\bnot\b/i.test(s)) add({ id: 'vc-receive', quote: s })
    else if (/\bvector clocks?\b|\bvector\b/i.test(`${topic} ${s}`) && /\bsend\w*\b/i.test(s) && !/\breceiv/i.test(s) && denies.test(s)) add({ id: 'vc-send', quote: s })
  }
  return out
}

/** A send and its receipt between two processes, replayed under the textbook rules (each counts as an event) */
export function sendReceiveReplay(): { sender: number[]; receiver: number[]; merged: number[] } {
  const s: Scenario = { n: 2, init: [[0, 0], [0, 0]], events: [{ kind: 'send', p: 1, to: 2 }, { kind: 'receive', p: 2, from: 1 }] }
  const counted = replay(s, true, true)!
  const mergedOnly = replay(s, true, false)!
  return { sender: counted[0], receiver: counted[1], merged: mergedOnly[1] }
}

const v = (x: number[]) => `[${x.join(', ')}]`

/** What is right, for a finding, with what running it showed (`ran`: the demo's output, when it ran) */
export function factFix(f: FactFinding, ran?: string): string {
  const out = ran?.trim()
  switch (f.id) {
    case 'float-exact':
      return `A float is binary floating point, not an exact decimal: most decimals (0.1, 0.2) can't be stored exactly. Run here, \`print(0.1 + 0.2 == 0.3, repr(0.1 + 0.2))\` gives \`${out || 'False 0.30000000000000004'}\`. For money, use \`decimal.Decimal\` or whole cents in an int.`
    case 'variable-box':
      return `In Python a variable is a name bound to an object, not a box holding a copy: after \`b = a\` both names refer to the same object. Run here, \`a = [1]; b = a; b.append(2); print(a, a is b)\` gives \`${out || '[1, 2] True'}\`.`
    case 'vc-receive': {
      const r = sendReceiveReplay()
      return `In the vector clock algorithm a receipt is an event: the receiver takes the element-wise maximum with the message's vector and then increments its own entry. Replayed: P1 sends ${v(r.sender)} to P2 at [0, 0]; on receipt P2 takes the maximum, ${v(r.merged)}, then increments its own entry to ${v(r.receiver)}.`
    }
    case 'vc-send': {
      const r = sendReceiveReplay()
      return `In the vector clock algorithm a send is an event: the sender increments its own entry before the message leaves, and the message carries that vector. Replayed: P1 at [0, 0] sends, so it becomes ${v(r.sender)} and the message carries ${v(r.sender)}.`
    }
  }
}

/** Kept to what can be checked against the sources: an error a model flags from the lesson's reading stands only when its evidence is quoted from that reading */
export function supportedBy(sources: string, evidence: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const e = norm(evidence)
  return e.split(' ').length >= 4 && norm(sources).includes(e)
}

export const READING_CLAIMS_SYSTEM = 'You check a tutor’s explanation and flashcards against the lesson’s reading. You flag only what the reading itself contradicts, and you quote the reading exactly.'

/** Asked of the local model when no cloud model may check: only what the reading contradicts, each with the reading's own words as evidence */
export const readingClaimsPrompt = (topic: string, taught: string, reading: string) => `Topic: ${topic}
The lesson's reading:
"""
${reading.slice(0, 5000)}
"""
What the tutor taught (explanation and flashcards):
"""
${taught.slice(0, 4000)}
"""
List only statements in what the tutor taught that the reading directly contradicts. For each, quote the tutor's words, say what is right, and copy the sentence of the reading that shows it, word for word.
Reply with JSON only: {"ok": true} when the reading contradicts nothing, or {"ok": false, "errors": [{"quote": "the tutor's words", "fix": "what's right, in one sentence", "evidence": "the reading's words, copied exactly"}]}.`
