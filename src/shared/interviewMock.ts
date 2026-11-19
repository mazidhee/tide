/**
 * Live mock rounds for an interview target: one full round run like the real call. A persona
 * introduces themselves and asks for a short intro, then plays the round from the target
 * (behavioural, technical with a scenario revealed part by part, or a presentation then assessor
 * Q&A), keeps to the clock, asks "Do you have any questions for me?", and closes. A debrief marks
 * every question and saves an attempt under `mocks[]` in `.tide/interview/<slug>.json`.
 *
 * Pure: the input shape, personas, the round plan and its pacing, the interviewer's prompts and
 * the turn markers, a scripted interviewer for when Claude can't take it, the code marker and
 * the measures every debrief carries (pace, filler words, length). main/interviewMock calls
 * Claude and saves; components/interview/LiveMock* draws it.
 *
 * Generic: nothing here names a person, firm or interview. Everything specific comes from the
 * learner's vault.
 */
import { jsonrepair } from 'jsonrepair'

// ---------- Input ----------

export type RoundKind = 'behavioural' | 'technical' | 'presentation' | 'hirevue' | 'general'

export interface MockRound {
  id: string
  name: string
  kind: RoundKind
  minutes: number
  notes?: string
}

export interface MockQuestion {
  id: string
  text: string
  /** motivation | behavioural | cv | technical | scenario | presentation-qa | market | closing */
  kind: string
  /** The round id it belongs to, when the bank says */
  round?: string
  /** The structure as arrows, e.g. "Context → Action → Result → Lesson" */
  route?: string
  /** The learner's own facts for it */
  outline?: string
}

export interface MockScenario {
  id: string
  title: string
  /** What the interviewer says at each stage */
  parts: string[]
  /** The points a strong answer covers */
  rubric: string[]
}

export interface MockPresentation {
  topic: string
  checklist: string[]
  assessorQuestions: { q: string; point: string }[]
}

export interface MockStory {
  id: string
  title: string
  evidence: string
}

/** Everything a live mock needs from a target, for one round */
export interface MockTargetInput {
  slug: string
  company: string
  role: string
  round: MockRound
  /** The target's free notes (format, advice) */
  notes: string
  questions: MockQuestion[]
  scenarios: MockScenario[]
  presentation?: MockPresentation
  stories: MockStory[]
  askThem: string[]
  firmFacts: string[]
  /** The learner's CV as text, when Tide could read it */
  cv?: string
}

/** What the pre-brief says a round tests */
export function roundTests(kind: RoundKind): string[] {
  switch (kind) {
    case 'behavioural':
      return ['A short introduction, then five or six questions, mostly from your CV, with natural follow-ups.', 'Marked on structure, specifics, what you did yourself and the result, and your pace.']
    case 'technical':
      return ['A few behavioural questions, then a scenario given part by part. Ask clarifying questions as you would on the call.', 'Marked on structure and specifics, and on how well you find the risks, mitigate them and say who you would tell.']
    case 'presentation':
      return ['You present (up to 15 minutes), then the assessor asks questions from your topic and from what you said.', 'Marked on the brief’s checklist, how clearly you answer, and timing.']
    case 'hirevue':
      return ['Recorded-style questions, one after another, with no follow-ups.', 'Marked on structure, specifics and length.']
    default:
      return ['A conversation with an interviewer: an introduction, questions, and your questions at the end.', 'Marked on structure, specifics and pace.']
  }
}

// ---------- Persona ----------

export interface Persona {
  name: string
  title: string
  /** Their area of the firm */
  area: string
  years: number
  /** The Kokoro voice they speak with */
  voice: string
  /** One line on how they come across */
  manner: string
}

/** Kokoro voices an interviewer may use: never the professor's (bm_george) */
export const INTERVIEWER_VOICES = [
  { id: 'bf_emma', gender: 'f' },
  { id: 'am_michael', gender: 'm' },
  { id: 'af_heart', gender: 'f' },
  { id: 'bm_fable', gender: 'm' }
] as const

const FIRST = {
  f: ['Sarah', 'Priya', 'Hannah', 'Laura', 'Mei', 'Claire', 'Amara', 'Sofia'],
  m: ['James', 'Daniel', 'Tom', 'Arjun', 'Marcus', 'Ben', 'Luca', 'Oliver']
}
const LAST = ['Whitfield', 'Okafor', 'Chen', 'Morgan', 'Patel', 'Lindqvist', 'Hughes', 'Romero', 'Adeyemi', 'Brennan', 'Kowalski', 'Hart']
const TITLES = ['Vice President', 'Director', 'Associate', 'Senior Vice President']
const MANNERS = ['friendly and unhurried, lets you finish', 'brisk and precise, asks short follow-ups', 'warm but probing, wants the detail behind claims', 'quiet, writes notes, pauses before the next question']

/** A small seeded random, so a run's persona can be remade from its seed */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length]

/** Areas a round's interviewer could come from, read from the role and notes, else generic */
export function personaAreas(input: Pick<MockTargetInput, 'role' | 'notes' | 'round'>): string[] {
  const text = `${input.role} ${input.round.notes ?? ''} ${input.notes}`.toLowerCase()
  const areas: string[] = []
  const add = (re: RegExp, area: string) => re.test(text) && areas.push(area)
  add(/\bmodel risk\b/, 'Model Risk')
  add(/\bmarket risk\b|\btrading\b/, 'Market Risk')
  add(/\bcredit\b|\blending\b/, 'Credit Risk')
  add(/\boperational\b|\bop risk\b/, 'Operational Risk')
  add(/\bcompliance\b|\bregulat/, 'Compliance')
  add(/\bliquidity\b|\btreasury\b/, 'Liquidity Risk')
  add(/\benterprise risk\b|\brisk\b/, 'Enterprise Risk')
  add(/\bsoftware|engineer|developer\b/, 'Engineering')
  add(/\bdata\b|\banalytics\b/, 'Data and Analytics')
  add(/\bquant/, 'Quantitative Research')
  add(/\bproduct\b/, 'Product')
  return areas.length ? [...new Set(areas)] : ['the team you would join']
}

/** A persona for one run, made in code (Claude may rewrite the manner, never the facts) */
export function makePersona(input: Pick<MockTargetInput, 'role' | 'notes' | 'round'>, seed: number, avoidVoice?: string): Persona {
  const r = rng(seed)
  const voices = INTERVIEWER_VOICES.filter((v) => v.id !== avoidVoice)
  const v = pick(r, voices)
  const name = `${pick(r, FIRST[v.gender])} ${pick(r, LAST)}`
  const area = pick(r, personaAreas(input))
  const title = pick(r, TITLES)
  return {
    name,
    title,
    area,
    years: 3 + Math.floor(r() * 12),
    voice: v.id,
    manner: pick(r, MANNERS)
  }
}

// ---------- Transcript ----------

export type Stage = 'intro' | 'question' | 'scenario' | 'presenting' | 'qa' | 'ask-them' | 'close'

/** What one interviewer line did */
export type Move = 'open' | 'ask' | 'follow-up' | 'clarify' | 'part' | 'qa' | 'ask-them' | 'answer-them' | 'close'

export interface Line {
  who: 'them' | 'you'
  text: string
  /** Since the round started, ms */
  at: number
  /** When they stopped speaking, ms (spoken lines) */
  end?: number
  stage: Stage
  /** The plan item it belongs to: a question id, `scenario:<id>`, `present`, `qa`, `intro`, `ask-them` */
  item: string
  move?: Move
  typed?: boolean
}

// ---------- Plan ----------

export type PlanItem =
  | { type: 'intro'; id: 'intro' }
  | { type: 'question'; id: string; q: MockQuestion; followups: number }
  | { type: 'scenario'; id: string; s: MockScenario; probes: number }
  | { type: 'present'; id: 'present'; limitMs: number }
  | { type: 'qa'; id: 'qa'; pool: { q: string; point: string }[]; ms: number }

export interface Plan {
  items: PlanItem[]
  /** Kept back for "Do you have any questions for me?" and the close */
  reserveMs: number
  totalMs: number
}

const PRESENT_MS = 15 * 60_000

function shuffle<T>(r: () => number, xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Common questions for a thin bank: generic, asked in most rounds of their kind */
export const GENERIC_QUESTIONS: MockQuestion[] = [
  {
    id: 'g-why-role',
    text: 'Why this role, and why here?',
    kind: 'motivation',
    route: 'Role → Firm → You'
  },
  {
    id: 'g-cv-proud',
    text: 'Which thing on your CV are you proudest of, and what did you do yourself?',
    kind: 'cv'
  },
  {
    id: 'g-cv-hard',
    text: 'Pick one project from your CV. What was the hardest part, and how did you get through it?',
    kind: 'cv'
  },
  {
    id: 'g-team',
    text: 'Tell me about a time you worked in a team that wasn’t getting on.',
    kind: 'behavioural'
  },
  {
    id: 'g-priorities',
    text: 'Tell me about a time you had competing priorities. How did you decide?',
    kind: 'behavioural'
  },
  {
    id: 'g-mistake',
    text: 'Tell me about a mistake you made and what you did about it.',
    kind: 'behavioural'
  },
  {
    id: 'g-persuade',
    text: 'Tell me about a time you persuaded someone to change their mind.',
    kind: 'behavioural'
  },
  {
    id: 'g-rules',
    text: 'Tell me about a time you had to follow a rule you didn’t agree with.',
    kind: 'behavioural'
  }
]

const BEHAVIOURAL_KINDS = new Set(['behavioural', 'cv', 'motivation'])

/** Questions meant for this round: the bank's own round tag first, then by kind */
export function roundQuestions(input: MockTargetInput): MockQuestion[] {
  const own = input.questions.filter((q) => q.round === input.round.id)
  const untagged = input.questions.filter((q) => !q.round)
  const kind = input.round.kind
  const fits = (q: MockQuestion) => (kind === 'presentation' ? q.kind === 'presentation-qa' : kind === 'technical' ? BEHAVIOURAL_KINDS.has(q.kind) || q.kind === 'technical' : q.kind !== 'presentation-qa' && q.kind !== 'scenario' && q.kind !== 'closing')
  const rest = untagged.filter(fits)
  return [...own.filter((q) => q.kind !== 'closing'), ...rest]
}

/**
 * The round's plan: what gets asked, in order. Behavioural: five or six questions, CV ones first
 * when there are some. Technical: three or four behavioural, then one scenario. Presentation: the
 * talk, then assessor Q&A. Each kind keeps about four minutes for the learner's questions and the
 * close.
 */
export function planRound(input: MockTargetInput, seed: number): Plan {
  const r = rng(seed * 7 + 3)
  const totalMs = Math.max(5, input.round.minutes || 30) * 60_000
  const reserveMs = Math.min(4 * 60_000, totalMs * 0.15)
  const items: PlanItem[] = [{ type: 'intro', id: 'intro' }]
  const kind = input.round.kind
  const own = roundQuestions(input)
  // A thin bank is topped up with common questions, so a round always has enough to ask
  const pool = own.length >= 6 || kind === 'presentation' ? own : [...own, ...GENERIC_QUESTIONS.filter((g) => !own.some((q) => q.text === g.text))]
  if (kind === 'presentation') {
    items.push({
      type: 'present',
      id: 'present',
      limitMs: Math.min(PRESENT_MS, totalMs * 0.55)
    })
    const bank = input.presentation?.assessorQuestions ?? []
    const extra = pool.map((q) => ({ q: q.text, point: q.outline ?? '' }))
    items.push({
      type: 'qa',
      id: 'qa',
      pool: shuffle(r, [...bank, ...extra]),
      ms: 0
    })
    return { items, reserveMs, totalMs }
  }
  const cvFirst = (qs: MockQuestion[]) => [
    ...shuffle(
      r,
      qs.filter((q) => q.kind === 'cv')
    ),
    ...shuffle(
      r,
      qs.filter((q) => q.kind !== 'cv')
    )
  ]
  if (kind === 'technical') {
    // The technical round opens with behavioural questions (rules, priorities), then CV ones
    const behaviouralFirst = (qs: MockQuestion[]) => [
      ...shuffle(
        r,
        qs.filter((q) => q.kind === 'behavioural')
      ),
      ...shuffle(
        r,
        qs.filter((q) => q.kind !== 'behavioural')
      )
    ]
    const behavioural = [...behaviouralFirst(pool.filter((q) => q.kind !== 'technical' && !q.id.startsWith('g-'))), ...behaviouralFirst(pool.filter((q) => q.id.startsWith('g-')))].slice(0, totalMs >= 40 * 60_000 ? 4 : 3)
    for (const q of behavioural) items.push({ type: 'question', id: q.id, q, followups: 1 })
    const s = input.scenarios.length ? pick(r, input.scenarios) : null
    if (s) items.push({ type: 'scenario', id: `scenario:${s.id}`, s, probes: 2 })
    else for (const q of pool.filter((q) => q.kind === 'technical').slice(0, 2)) items.push({ type: 'question', id: q.id, q, followups: 2 })
    return { items, reserveMs, totalMs }
  }
  const n = kind === 'hirevue' ? Math.min(5, Math.round(totalMs / (3 * 60_000))) : totalMs >= 40 * 60_000 ? 6 : 5
  // CV questions lead, but not all of them: the rest are the bank's behavioural ones
  // The target's own questions before any common ones
  const ordered = [...cvFirst(pool.filter((q) => !q.id.startsWith('g-'))), ...cvFirst(pool.filter((q) => q.id.startsWith('g-')))]
  const cv = ordered.filter((q) => q.kind === 'cv').slice(0, Math.ceil(n * 0.6))
  const other = ordered.filter((q) => q.kind !== 'cv')
  const chosen = [...cv, ...other].slice(0, n)
  for (const q of shuffle(r, chosen))
    items.push({
      type: 'question',
      id: q.id,
      q,
      followups: kind === 'hirevue' ? 0 : 2
    })
  return { items, reserveMs, totalMs }
}

// ---------- Pacing ----------

/** Where the round is: which plan item, which part of a scenario, follow-ups used */
export interface Cursor {
  index: number
  /** Scenario part shown (0-based) */
  part: number
  /** Follow-ups or probes used on this item (this part, for a scenario) */
  used: number
  /** Q&A questions asked */
  qaAsked: number
  /** The learner's questions answered at the end */
  theirQuestions: number
  stage: Stage
  /** When the current item started, ms since the round began */
  itemStart: number
}

export const START: Cursor = {
  index: 0,
  part: 0,
  used: 0,
  qaAsked: 0,
  theirQuestions: 0,
  stage: 'intro',
  itemStart: 0
}

/** Time each remaining item may take: the time left (less the reserve), shared out */
export function itemBudget(plan: Plan, cur: Cursor, elapsedMs: number): number {
  const left = plan.totalMs - plan.reserveMs - elapsedMs
  const remaining = plan.items.slice(cur.index).reduce((n, it) => n + (it.type === 'scenario' ? 2.5 : it.type === 'intro' ? 0.5 : it.type === 'present' || it.type === 'qa' ? 0 : 1), 0)
  if (plan.items[cur.index]?.type === 'qa') return left
  return remaining > 0 ? left / remaining : 0
}

/** What the interviewer does next, decided in code so the round always ends on time */
export type Next =
  | { move: 'open' }
  | {
      move: 'ask'
      item: PlanItem
      text: string
      /** Claude may react to the last answer first */ allowFollowup: boolean
    }
  | {
      move: 'part'
      item: Extract<PlanItem, { type: 'scenario' }>
      part: number
      text: string
      allowProbe: boolean
    }
  | { move: 'present' }
  | { move: 'qa'; text: string; point: string; allowFollowup: boolean }
  | { move: 'ask-them' }
  | { move: 'answer-them'; more: boolean }
  | { move: 'close'; reason: 'done' | 'time' }

/**
 * After the learner's turn: what comes next. `answered` is what they just finished (the cursor's
 * item). Follow-ups are allowed while the item is inside its share of the time and has some left;
 * the turn itself (Claude) decides whether to use one. Under the reserve, it goes to the
 * learner's questions; at the end of the clock, it closes.
 */
export function nextAfter(plan: Plan, cur: Cursor, elapsedMs: number): Next {
  const left = plan.totalMs - elapsedMs
  if (left <= 45_000) return { move: 'close', reason: 'time' }
  if (cur.stage === 'ask-them') return cur.theirQuestions >= 2 || left < 90_000 ? { move: 'close', reason: 'done' } : { move: 'answer-them', more: true }
  if (cur.stage === 'close') return { move: 'close', reason: 'done' }
  const it = plan.items[cur.index]
  const overReserve = left - plan.reserveMs <= 30_000
  if (overReserve && it?.type !== 'present') return { move: 'ask-them' }
  const spent = elapsedMs - cur.itemStart
  const budget = itemBudget(plan, cur, cur.itemStart)
  const inBudget = spent < budget * 0.85
  if (it?.type === 'question' && cur.used < it.followups && inBudget) return askNext(plan, cur.index + 1, true, elapsedMs)
  if (it?.type === 'scenario') {
    const partBudget = budget / Math.max(1, it.s.parts.length)
    const more = cur.part + 1 < it.s.parts.length
    const probe = cur.used < it.probes && spent < partBudget * (cur.part + 1) * 1.1
    if (more)
      return {
        move: 'part',
        item: it,
        part: cur.part + 1,
        text: it.s.parts[cur.part + 1],
        allowProbe: probe
      }
    // The last part: they may still ask a clarifying question, or be probed once more
    return askNext(plan, cur.index + 1, probe || cur.used < it.probes + 1, elapsedMs)
  }
  if (it?.type === 'present') return nextQa(plan, cur, elapsedMs, false)
  if (it?.type === 'qa') return nextQa(plan, cur, elapsedMs, cur.used < 1)
  return askNext(plan, cur.index + 1, false, elapsedMs)
}

function nextQa(plan: Plan, cur: Cursor, elapsedMs: number, allowFollowup: boolean): Next {
  const qa = plan.items.find((i): i is Extract<PlanItem, { type: 'qa' }> => i.type === 'qa')
  const left = plan.totalMs - plan.reserveMs - elapsedMs
  const q = qa?.pool[cur.qaAsked]
  if (!q || left < 60_000) return { move: 'ask-them' }
  return { move: 'qa', text: q.q, point: q.point, allowFollowup }
}

function askNext(plan: Plan, index: number, allowFollowup: boolean, elapsedMs: number): Next {
  const it = plan.items[index]
  if (!it) return { move: 'ask-them' }
  if (it.type === 'question') return { move: 'ask', item: it, text: it.q.text, allowFollowup }
  if (it.type === 'scenario')
    return {
      move: 'ask',
      item: it,
      text: it.s.parts[0] ?? it.s.title,
      allowFollowup
    }
  if (it.type === 'present') return { move: 'present' }
  if (it.type === 'qa') return nextQa(plan, { ...START, index }, elapsedMs, allowFollowup)
  return { move: 'ask-them' }
}

/**
 * The cursor after the interviewer's line. `used` says what the line turned out to be: a
 * follow-up (or a clarifying answer, or a probe) stays on the item; anything else moves on.
 */
export function advance(plan: Plan, cur: Cursor, next: Next, used: TurnMark, elapsedMs: number): Cursor {
  const stay = used === 'follow-up' || used === 'clarify' || used === 'probe'
  switch (next.move) {
    case 'open':
      return { ...cur, stage: 'intro', itemStart: elapsedMs }
    case 'ask': {
      if (stay) return { ...cur, used: cur.used + (used === 'clarify' ? 0 : 1) }
      const index = plan.items.indexOf(next.item)
      return {
        ...cur,
        index,
        part: 0,
        used: 0,
        stage: next.item.type === 'scenario' ? 'scenario' : 'question',
        itemStart: elapsedMs
      }
    }
    case 'part':
      if (stay) return { ...cur, used: cur.used + (used === 'clarify' ? 0 : 1) }
      return { ...cur, part: next.part, used: 0, stage: 'scenario' }
    case 'present':
      return {
        ...cur,
        index: plan.items.findIndex((i) => i.type === 'present'),
        stage: 'presenting',
        itemStart: elapsedMs
      }
    case 'qa': {
      if (stay && cur.stage === 'qa') return { ...cur, used: cur.used + 1 }
      return {
        ...cur,
        index: plan.items.findIndex((i) => i.type === 'qa'),
        stage: 'qa',
        qaAsked: cur.qaAsked + 1,
        used: 0,
        itemStart: cur.stage === 'qa' ? cur.itemStart : elapsedMs
      }
    }
    case 'ask-them':
      return { ...cur, stage: 'ask-them', itemStart: elapsedMs }
    case 'answer-them':
      return { ...cur, theirQuestions: cur.theirQuestions + 1 }
    case 'close':
      return { ...cur, stage: 'close' }
  }
}

/** The plan item id a line belongs to, from the cursor */
export function itemIdOf(plan: Plan, cur: Cursor): string {
  if (cur.stage === 'ask-them' || cur.stage === 'close') return cur.stage
  if (cur.stage === 'qa') return `qa:${cur.qaAsked}`
  const it = plan.items[cur.index]
  if (it?.type === 'scenario') return `${it.id}#${cur.part + 1}`
  return it?.id ?? 'intro'
}

// ---------- The turn's marker ----------

/**
 * Each interviewer line from Claude opens with one marker saying what it did, so the code can keep
 * its place: [follow-up], [probe] (a scenario), [clarify] (an answer to their clarifying question),
 * [next] (moved on as asked), [close]. It's stripped before anything is shown or spoken.
 */
export type TurnMark = 'follow-up' | 'probe' | 'clarify' | 'next' | 'close'

const MARK_RE = /^\s*\[(follow-?up|probe|clarify|next|close)\]\s*/i

/**
 * Reads a streamed reply: the marker (once it's complete) and the spoken text after it. While the
 * opening could still be a marker, nothing is released.
 */
export function readTurn(soFar: string): {
  mark: TurnMark | null
  text: string
  pending: boolean
} {
  const m = soFar.match(MARK_RE)
  if (m)
    return {
      mark: m[1].toLowerCase().replace('followup', 'follow-up') as TurnMark,
      text: soFar.slice(m[0].length),
      pending: false
    }
  const head = soFar.trimStart()
  if (head.startsWith('[') && head.length < 14 && !head.includes(']')) return { mark: null, text: '', pending: true }
  return { mark: null, text: soFar, pending: false }
}

/** Sentences complete so far (each released once): the voice starts on the first */
export function completeSentences(text: string, from: number): { sentences: string[]; upTo: number } {
  const out: string[] = []
  let at = from
  const re = /[.!?…]["')\]]?(\s+|$)/g
  re.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index + m[0].length === text.length && !/\s$/.test(m[0])) break // the reply may still be going
    const s = text.slice(at, m.index + m[0].length).trim()
    // Join a very short piece to the next, so the voice doesn't sound clipped
    if (s.length < 14 && out.length === 0 && at === from) continue
    if (s) out.push(s)
    at = m.index + m[0].length
  }
  return { sentences: out, upTo: at }
}

// ---------- Prompts ----------

/** The plain-writing rules every line and every debrief follows */
export const PLAIN_WORDS = `Write the way a person talks: plain words, sentences of different lengths, contractions. Never use: "delve", "leverage", "robust", "seamless", "pivotal", "crucial", "showcase", "foster", "navigate", "landscape", "tapestry", "testament", "journey", "elevate", "game-changer". No "not only … but also", no lists of three for rhythm, no em-dash chains, no upbeat sign-offs ("Great job!", "Keep it up!", "You've got this"). No praise filler ("Great answer", "Excellent").`

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s)

/** The interviewer's standing instructions for the whole round */
export function interviewerSystem(input: MockTargetInput, persona: Persona): string {
  const kind = input.round.kind
  const style =
    kind === 'technical'
      ? 'This is the technical round: a few behavioural questions, then a scenario you give part by part. When the candidate asks a clarifying question about the scenario, answer it in role with a reasonable, specific detail (invent plausible figures if the scenario leaves them open), then let them carry on. Probe risk identification: if they miss an obvious risk, ask about the area it sits in without naming it.'
      : kind === 'presentation'
        ? 'This is the presentation round. The candidate presents first; you only listen. Then you ask assessor questions: about their topic, and about things they actually said (quote their words back briefly). Push on weak claims politely.'
        : 'This is the behavioural round: a conversation, mostly about their CV and experience. Follow up naturally on what they actually said: what they did themselves, the result, what they would change. Do not lead them to an answer.'
  return [
    `You are ${persona.name}, ${persona.title} in ${persona.area} at ${input.company || 'the firm'}, ${persona.years} years at the firm. You are interviewing a candidate for ${input.role || 'a role'} on a video call. Manner: ${persona.manner}.`,
    `Round: ${input.round.name} (${input.round.minutes} minutes).${input.round.notes ? ` What this round is like: ${input.round.notes}` : ''}`,
    style,
    'You speak out loud: everything you write is read aloud by a voice, so write only what you would say. No stage directions, no headings, no lists, no Markdown. Keep each turn short: one to three sentences, under 60 words, except when delivering a scenario part (read it out in full, in your own words, keeping every fact). Ask one question at a time. Don’t praise answers; at most a brief neutral acknowledgement ("Okay.", "Thanks, that’s helpful.") before the next question. Never coach, never mark, never tell them what a good answer would be.',
    'Start every reply with exactly one marker on its own, which is not read out: [follow-up] if you ask a follow-up on their last answer, [probe] if you probe their scenario answer, [clarify] if you answer their clarifying question, [next] if you move on to what you were told to ask next, [close] if you are closing the call.',
    PLAIN_WORDS,
    input.firmFacts.length
      ? `Facts about the firm you may use when they ask you something (use only these; if you don’t know, say so as a real interviewer would, briefly):\n${input.firmFacts
          .slice(0, 30)
          .map((f) => `- ${clip(f, 240)}`)
          .join('\n')}`
      : '',
    input.cv ? `The candidate’s CV (for questions about it; never invent facts about them):\n${clip(input.cv, 6000)}` : '',
    input.stories.length
      ? `What the candidate has told Tide about their experience (to understand their answers, not to quote):\n${input.stories
          .slice(0, 12)
          .map((s) => `- ${s.title}: ${clip(s.evidence, 200)}`)
          .join('\n')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

const say = (l: Line) => `${l.who === 'them' ? 'You' : 'Candidate'}: ${l.text}`

/** The conversation so far, newest last, cut from the front to stay small */
export function transcriptText(lines: Line[], maxChars = 9000): string {
  const all = lines.map(say)
  const out: string[] = []
  let n = 0
  for (let i = all.length - 1; i >= 0; i--) {
    n += all[i].length + 1
    if (n > maxChars) {
      out.unshift('[earlier conversation left out]')
      break
    }
    out.unshift(all[i])
  }
  return out.join('\n')
}

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000))

/** What the interviewer is to say now */
export function turnPrompt(
  next: Next,
  lines: Line[],
  o: {
    persona: Persona
    elapsedMs: number
    totalMs: number
    presentation?: MockPresentation
    scenario?: MockScenario
  }
): string {
  const t = `Time: ${mins(o.elapsedMs)} of ${mins(o.totalMs)} minutes used.`
  const convo = lines.length ? `The call so far:\n${transcriptText(lines)}\n\n` : ''
  const lastYou = [...lines].reverse().find((l) => l.who === 'you')
  const asked = lastYou && /\?\s*$/.test(lastYou.text.trim())
  let task: string
  switch (next.move) {
    case 'open':
      task = `Open the call: greet them, introduce yourself (name, role, area, how long you’ve been at the firm) in two or three sentences, say briefly how the next ${mins(o.totalMs)} minutes will go, then ask them to introduce themselves briefly. Marker: [next].`
      break
    case 'ask':
      task = next.allowFollowup
        ? `Either ask ONE natural follow-up on their last answer (only if it left something real unexplored: what they personally did, the result, a claim without detail), marked [follow-up]${o.scenario ? ', or if they asked a clarifying question answer it in role, marked [clarify]' : ''}; or move on, marked [next], and ask this, in your own words but keeping its meaning: "${next.text}"`
        : `Move on, marked [next]: briefly acknowledge (a few words at most) and ask this, in your own words but keeping its meaning: "${next.text}"${next.item.type === 'scenario' ? ' (this opens a scenario: say you’d like to move to a scenario, then read this first part in full)' : ''}`
      break
    case 'part':
      task = `${asked ? 'They may have asked a clarifying question: if so, answer it in role with a specific, plausible detail, marked [clarify], and stop there. Otherwise, ' : ''}${next.allowProbe ? 'if their answer to this part missed something important (a risk, who they would escalate to, how they would mitigate it), probe it once without naming the answer, marked [probe]; or ' : ''}give the next part of the scenario, marked [next]. The next part, to read out in full in your own words, keeping every fact: "${next.text}"`
      break
    case 'qa':
      task = next.allowFollowup
        ? `Assessor Q&A. Either follow up on their last answer, or on something they said in their presentation (quote a few of their words), marked [follow-up]; or ask this, marked [next]: "${next.text}"`
        : `They have finished presenting. Thank them in a few words and start the questions with this, marked [next]: "${next.text}"`
      break
    case 'ask-them':
      task = `Wrap up the questions${o.elapsedMs > o.totalMs - 4 * 60_000 ? ' (you are near time)' : ''} and ask whether they have any questions for you. Marker: [next].`
      break
    case 'answer-them':
      task = `${asked || lastYou ? 'Answer their question in character, honestly, from your own role and the firm facts you were given. If they asked something you already covered earlier in the call, answer briefly anyway, as a real interviewer would. Two to four sentences. Then ask if there’s anything else.' : 'Ask if there’s anything else they’d like to know.'} Marker: [next].`
      break
    case 'close':
      task = `Close the call${next.reason === 'time' ? ': you are at time' : ''}. ${lastYou && /\?/.test(lastYou.text) ? 'Answer their last question in a sentence first, then ' : ''}thank them, say what happens next in one sentence, and say goodbye. Marker: [close].`
      break
    case 'present':
      task = 'Hand over to them to present: one or two sentences, mention they have up to fifteen minutes. Marker: [next].'
      break
  }
  const scen = o.scenario ? `\nThe scenario you are running: "${o.scenario.title}". What a strong answer covers (never say these): ${o.scenario.rubric.join('; ')}` : ''
  return `${convo}${t}${scen}\n\nNow: ${task}`
}

// ---------- The scripted interviewer (without Claude) ----------

const ACKS = ['Okay.', 'Thanks.', 'Right, thank you.', 'Okay, thanks for that.', 'Got it.']

/**
 * A line from the scripted interviewer: the same moves, from the bank and templates. Follow-ups are
 * chosen by what the answer is missing (a result, their own part, a lesson).
 */
export function scriptedTurn(
  next: Next,
  lines: Line[],
  o: {
    persona: Persona
    input: MockTargetInput
    seed: number
    totalMs: number
  }
): { mark: TurnMark; text: string } {
  const r = rng(o.seed + lines.length * 31)
  const lastYou = [...lines].reverse().find((l) => l.who === 'you')?.text ?? ''
  const p = o.persona
  switch (next.move) {
    case 'open':
      return {
        mark: 'next',
        text: `Hi, thanks for joining. I’m ${p.name}, ${p.title} in ${p.area}, and I’ve been at ${o.input.company || 'the firm'} for ${p.years} years. We’ve got about ${mins(o.totalMs)} minutes. I’ll ask you some questions, and there’ll be time for yours at the end. To start, could you briefly introduce yourself?`
      }
    case 'ask': {
      if (next.allowFollowup) {
        const f = scriptedFollowup(lastYou, r)
        if (f) return { mark: 'follow-up', text: f }
      }
      const lead = next.item.type === 'scenario' ? 'Let’s move to a scenario. ' : pick(r, ACKS) + ' '
      return { mark: 'next', text: lead + next.text }
    }
    case 'part':
      if (/\?\s*$/.test(lastYou.trim()))
        return {
          mark: 'clarify',
          text: 'Fair question. Make a reasonable assumption, tell me what it is, and carry on.'
        }
      if (next.allowProbe && wordCount(lastYou) < 60)
        return {
          mark: 'probe',
          text: 'What else could go wrong there? And who would you tell?'
        }
      return { mark: 'next', text: `Okay. Here’s the next part. ${next.text}` }
    case 'qa':
      if (next.allowFollowup && wordCount(lastYou) < 40)
        return {
          mark: 'follow-up',
          text: 'Could you say a bit more about that? What’s the evidence?'
        }
      return {
        mark: 'next',
        text: next.allowFollowup ? `${pick(r, ACKS)} ${next.text}` : `Thank you, that was clear. I’ve got some questions. ${next.text}`
      }
    case 'present':
      return {
        mark: 'next',
        text: 'Whenever you’re ready, go ahead. You’ve got up to fifteen minutes.'
      }
    case 'ask-them':
      return {
        mark: 'next',
        text: 'That’s all from me. Do you have any questions for me?'
      }
    case 'answer-them': {
      const fact = o.input.firmFacts.length ? ` One thing I’d point to: ${pick(r, o.input.firmFacts).replace(/\s*\(.*?\)\s*$/, '')}.` : ''
      return {
        mark: 'next',
        text: `Good question. From where I sit in ${p.area}, it’s varied work and you learn fast.${fact} Anything else?`
      }
    }
    case 'close':
      return {
        mark: 'close',
        text: `${next.reason === 'time' ? 'We’re at time, so I’ll stop us there. ' : ''}Thanks for your time today. You’ll hear from the recruiting team about next steps. Take care.`
      }
  }
}

function scriptedFollowup(answer: string, r: () => number): string | null {
  const m = measureAnswer(answer)
  if (m.words < 25) return 'Could you take me through that in a bit more detail?'
  if (!m.hasResult) return 'How did it turn out? Is there a number you could put on it?'
  if (m.ownership < 0.4) return 'What did you do yourself, as opposed to the team?'
  return r() < 0.5 ? 'Looking back, what would you do differently?' : null
}

// ---------- Measures ----------

export const wordCount = (s: string) => (s.match(/[A-Za-z0-9’']+/g) ?? []).length

/** Filler words and phrases counted in a transcript */
export const FILLERS = ['um', 'uh', 'er', 'erm', 'uhm', 'like', 'you know', 'sort of', 'kind of', 'basically', 'actually', 'i mean', 'literally', 'right so']

/** Filler words in what was said: "like" only where it's a filler (after a comma or before one) */
export function countFillers(text: string): {
  total: number
  by: Record<string, number>
} {
  const t = ` ${text.toLowerCase().replace(/[’]/g, "'")} `
  const by: Record<string, number> = {}
  const count = (word: string, re: RegExp) => {
    const n = (t.match(re) ?? []).length
    if (n) by[word] = n
  }
  for (const f of ['um', 'uh', 'er', 'erm', 'uhm']) count(f, new RegExp(`\\b${f}\\b`, 'g'))
  count('like', /(,\s*like\b|\blike,)/g)
  for (const f of ['you know', 'sort of', 'kind of', 'basically', 'actually', 'i mean', 'literally']) count(f, new RegExp(`\\b${f}\\b`, 'g'))
  return { total: Object.values(by).reduce((a, b) => a + b, 0), by }
}

/** Surface measures of one answer, for the code marker and the follow-up choice */
export function measureAnswer(text: string): {
  words: number
  hasResult: boolean
  ownership: number
  numbers: number
} {
  const t = text.toLowerCase()
  const i = (t.match(/\b(i|i'm|i've|i'd|my|me)\b/g) ?? []).length
  const we = (t.match(/\b(we|we're|we've|our|us|the team)\b/g) ?? []).length
  const numbers = (text.match(/\b\d[\d,.]*\s*(%|percent|k|m|bn|million|billion|thousand|hours?|days?|weeks?|months?|x)?/gi) ?? []).length
  const hasResult = numbers > 0 || /\b(result|outcome|as a result|which meant|ended up|so that|reduced|increased|cut|saved|won|delivered|launched|shipped|improved|grew)\b/.test(t)
  return {
    words: wordCount(text),
    hasResult,
    ownership: i + we ? i / (i + we) : 0.5,
    numbers
  }
}

/** Words per minute over spoken time */
export const wpm = (words: number, ms: number) => (ms > 3000 ? Math.round((words / ms) * 60_000) : 0)

// ---------- Marks and the debrief ----------

export type RubricId = 'structure' | 'specifics' | 'ownership' | 'risk' | 'pace' | 'clarity'

export const RUBRIC_LABEL: Record<RubricId, string> = {
  structure: 'Structure',
  specifics: 'Specifics',
  ownership: 'Ownership and result',
  risk: 'Risk identification',
  pace: 'Length and pace',
  clarity: 'Clarity'
}

export interface ItemMark {
  /** The plan item id (scenario parts are marked as one item) */
  item: string
  question: string
  kind: 'intro' | 'question' | 'scenario' | 'presentation' | 'qa' | 'ask-them'
  /** 0–4 per rubric item that applies */
  scores: Partial<Record<RubricId, number>>
  seconds: number
  words: number
  wpm: number
  fillers: number
  /** What was good and what was missing, in a sentence or two */
  note: string
  /** Short quotes from the answer that were weak (highlighted in the transcript) */
  weak: string[]
}

export interface Debrief {
  /** Recruiter-style feedback, plain prose */
  summary: string
  items: ItemMark[]
  /** Three things to fix next time */
  fixes: string[]
  askThem?: { asked: string[]; repeated: boolean; note: string }
  /** 0–4 */
  overall: number
  by: 'claude' | 'code'
  fillers: { total: number; top: [string, number][] }
  /** Presentation: how long they spoke, and the brief's checklist as met or not */
  presentation?: {
    seconds: number
    checklist: { item: string; met: boolean | null }[]
  }
}

export interface MockAttempt {
  id: string
  round: string
  roundName: string
  kind: RoundKind
  /** ISO */
  date: string
  persona: Pick<Persona, 'name' | 'title' | 'area'>
  overall: number
  /** The mean 0–4 per rubric item over the round */
  scores: Partial<Record<RubricId, number>>
  durations: {
    totalSec: number
    speakingSec: number
    items: Record<string, number>
  }
  transcript: Line[]
  debrief: Debrief
  by: 'claude' | 'code'
}

/** The learner's answer to each item, in order: its lines and the question it answered */
export function answersByItem(lines: Line[]): { item: string; question: string; answer: Line[]; asked: Line[] }[] {
  const out = new Map<string, { item: string; question: string; answer: Line[]; asked: Line[] }>()
  for (const l of lines) {
    const key = l.item.replace(/#\d+$/, '').replace(/^qa:\d+$/, (m) => m)
    let e = out.get(key)
    if (!e) out.set(key, (e = { item: key, question: '', answer: [], asked: [] }))
    if (l.who === 'them') {
      e.asked.push(l)
      if (!e.question && l.move !== 'follow-up' && l.move !== 'clarify') e.question = l.text
    } else e.answer.push(l)
  }
  return [...out.values()].filter((e) => e.answer.length && e.item !== 'close')
}

const kindOfItem = (id: string): ItemMark['kind'] => (id === 'intro' ? 'intro' : id.startsWith('scenario:') ? 'scenario' : id === 'present' ? 'presentation' : id.startsWith('qa') ? 'qa' : id === 'ask-them' ? 'ask-them' : 'question')

const spokenMs = (ls: Line[]) => ls.reduce((n, l) => n + Math.max(0, (l.end ?? l.at) - l.at), 0)

/** Length and pace on 0–4: behavioural answers want about 1–2.5 minutes at 120–170 words a minute */
export function paceScore(kind: ItemMark['kind'], seconds: number, rate: number): number {
  const [lo, hi] = kind === 'intro' ? [40, 120] : kind === 'scenario' ? [120, 600] : kind === 'presentation' ? [480, 960] : kind === 'qa' ? [30, 150] : [60, 150]
  let s = 4
  if (seconds < lo) s -= seconds < lo / 2 ? 2 : 1
  if (seconds > hi) s -= seconds > hi * 1.5 ? 2 : 1
  if (rate && (rate < 110 || rate > 185)) s -= 1
  return Math.max(0, s)
}

/** The route's steps as cue words, for marking structure in code */
const STEP_CUES: [RegExp, RegExp][] = [
  [/context|situation|background/i, /\b(when|while|at|during|last (year|summer)|in my|we were|i was)\b/i],
  [/task|goal|problem/i, /\b(needed to|had to|goal|task|asked to|problem|challenge)\b/i],
  [/action/i, /\b(i (decided|built|wrote|spoke|set up|asked|led|made|took|proposed|started|organised|organized|created|analysed|analyzed|changed))\b/i],
  [/result|outcome|impact/i, /\b(result|as a result|outcome|in the end|ended up|which meant|\d+\s*%|percent)\b/i],
  [/lesson|learn|reflect/i, /\b(learn(ed|t)|lesson|next time|would do differently|taught me|looking back)\b/i]
]

/** Steps of a route hit in an answer: e.g. "Context → Action → Result" */
export function routeCoverage(route: string | undefined, answer: string): { steps: string[]; hit: string[] } {
  const steps = (route ?? 'Context → Action → Result → Lesson')
    .split(/→|->|>|,/)
    .map((s) => s.trim())
    .filter(Boolean)
  const hit = steps.filter((s) => {
    const cue = STEP_CUES.find(([name]) => name.test(s))
    return cue ? cue[1].test(answer) : answer.toLowerCase().includes(s.toLowerCase())
  })
  return { steps, hit }
}

const STOP = new Set(
  'the and for that with this from into have will your about their they them what when which would could should there been were than then also more most such only over very just because while where these those other being does make made using used'.split(' ')
)
const keyWords = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w)))

/** How many rubric points an answer touches: a point counts when half its key words (at least one) appear */
export function rubricCoverage(rubric: string[], answer: string): { point: string; hit: boolean }[] {
  const said = keyWords(answer)
  return rubric.map((point) => {
    const ws = [...keyWords(point)]
    const n = ws.filter((w) => said.has(w) || [...said].some((s) => s.length > 5 && w.length > 5 && s.slice(0, 6) === w.slice(0, 6))).length
    return {
      point,
      hit: ws.length > 0 && n >= Math.max(1, Math.ceil(ws.length / 2))
    }
  })
}

const clamp4 = (n: number) => Math.max(0, Math.min(4, Math.round(n)))

/** The measures every debrief carries, whoever marks: time, words, pace and fillers per item */
export function measures(lines: Line[]): Map<string, Pick<ItemMark, 'item' | 'question' | 'kind' | 'seconds' | 'words' | 'wpm' | 'fillers'> & { text: string }> {
  const out = new Map()
  for (const a of answersByItem(lines)) {
    const text = a.answer.map((l) => l.text).join(' ')
    const ms = spokenMs(a.answer)
    const words = wordCount(text)
    const typed = a.answer.every((l) => l.typed)
    out.set(a.item, {
      item: a.item,
      question: a.question,
      kind: kindOfItem(a.item),
      // Typed answers are timed as if said at 150 words a minute
      seconds: typed ? Math.round((words / 150) * 60) : Math.round(ms / 1000),
      words,
      wpm: typed ? 0 : wpm(words, ms),
      fillers: countFillers(text).total,
      text
    })
  }
  return out
}

/** Marks a round in code: length, the route's steps, rubric coverage, ownership and a result */
export function markInCode(input: MockTargetInput, plan: Plan, lines: Line[]): Debrief {
  const items: ItemMark[] = []
  for (const m of measures(lines).values()) {
    if (m.kind === 'ask-them') continue
    const planned = plan.items.find((i) => i.id === m.item)
    const q = planned?.type === 'question' ? planned.q : undefined
    const meas = measureAnswer(m.text)
    const scores: ItemMark['scores'] = {}
    const notes: string[] = []
    const weak: string[] = []
    scores.pace = paceScore(m.kind, m.seconds || Math.round((m.words / 150) * 60), m.wpm)
    if (m.kind === 'scenario' && planned?.type === 'scenario') {
      const cov = rubricCoverage(planned.s.rubric, m.text)
      const got = cov.filter((c) => c.hit).length
      scores.risk = clamp4((got / Math.max(1, cov.length)) * 4)
      scores.structure = clamp4(m.words > 250 ? 3 : m.words > 120 ? 2 : 1)
      scores.specifics = clamp4(1 + Math.min(3, meas.numbers))
      const missed = cov.filter((c) => !c.hit).map((c) => c.point)
      notes.push(`Covered ${got} of ${cov.length} rubric points.${missed.length ? ` Not heard: ${missed.slice(0, 3).join('; ')}.` : ''}`)
    } else if (m.kind === 'presentation') {
      scores.structure = clamp4(m.words > 1200 ? 3 : m.words > 600 ? 2 : 1)
      scores.specifics = clamp4(1 + Math.min(3, meas.numbers / 2))
      notes.push(`${Math.round(m.seconds / 60)} minutes, ${m.words} words.`)
    } else {
      const route = routeCoverage(q?.route, m.text)
      scores.structure = clamp4((route.hit.length / Math.max(1, route.steps.length)) * 4)
      const outline = q?.outline
        ? rubricCoverage(
            q.outline
              .split(/\n|;|\. /)
              .map((s) => s.replace(/^[-*]\s*/, '').trim())
              .filter((s) => s.length > 8),
            m.text
          )
        : []
      const outlineHit = outline.length ? outline.filter((o) => o.hit).length / outline.length : 0
      scores.specifics = clamp4(Math.min(4, meas.numbers) * 0.7 + outlineHit * 2 + (m.words > 120 ? 1 : 0))
      scores.ownership = clamp4(meas.ownership * 3 + (meas.hasResult ? 1 : 0))
      const missing = route.steps.filter((s) => !route.hit.includes(s))
      if (missing.length) notes.push(`Missing from the route: ${missing.join(', ')}.`)
      if (!meas.hasResult) notes.push('No clear result.')
      if (meas.ownership < 0.4) notes.push('Mostly "we": say what you did.')
      if (m.kind !== 'intro' && m.words < 60) weak.push(m.text.slice(0, 120))
    }
    if (m.fillers >= 4) notes.push(`${m.fillers} filler words.`)
    items.push({
      ...m,
      // The bank's own wording, not the interviewer's spoken version with its "Okay, thanks."
      question: q?.text ?? (planned?.type === 'scenario' ? `Scenario: ${planned.s.title}` : m.question),
      scores,
      note: notes.join(' ') || 'Covered the basics.',
      weak
    })
  }
  const overall = mean(items.flatMap((i) => Object.values(i.scores) as number[]))
  const askThem = askThemCheck(lines)
  const f = countFillers(
    lines
      .filter((l) => l.who === 'you')
      .map((l) => l.text)
      .join(' ')
  )
  const worst = (Object.keys(RUBRIC_LABEL) as RubricId[])
    .map((k) => ({
      k,
      v: mean(items.map((i) => i.scores[k]).filter((x): x is number => x !== undefined))
    }))
    .filter((x) => !Number.isNaN(x.v) && items.some((i) => i.scores[x.k] !== undefined))
    .sort((a, b) => a.v - b.v)
  const fixes = worst.slice(0, 3).map(({ k }) => FIX_FOR[k])
  while (fixes.length < 3)
    fixes.push(['Keep the intro under a minute: who you are, what you’ve done, why this role.', 'End every answer on the result, with a number if you have one.', 'Prepare two questions that only this interviewer can answer.'][fixes.length])
  const presentation = input.round.kind === 'presentation' ? presentationCheck(input, lines) : undefined
  return {
    summary: codeSummary(items, overall, f.total, askThem),
    items,
    fixes,
    askThem,
    overall: Math.round(overall * 10) / 10,
    by: 'code',
    fillers: {
      total: f.total,
      top: Object.entries(f.by)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
    },
    presentation
  }
}

const FIX_FOR: Record<RubricId, string> = {
  structure: 'Follow the route for each answer: set the scene in a sentence, then what you did, then the result and what you learned.',
  specifics: 'Bring the facts: names of tools, sizes, dates and numbers. One real figure beats three adjectives.',
  ownership: 'Say "I" for what you did and finish on the result. If it was a team effort, say which part was yours.',
  risk: 'In the scenario, name the risks one by one before solving any: who could be hurt, what could fail, and who you would tell.',
  pace: 'Watch the length: aim for about a minute and a half per answer, and stop once you’ve given the result.',
  clarity: 'Lead with your answer in one sentence, then explain it.'
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}

function codeSummary(items: ItemMark[], overall: number, fillers: number, ask?: Debrief['askThem']): string {
  if (!items.length) return 'There wasn’t enough said to mark. Run it again and answer each question aloud.'
  const best = [...items].sort((a, b) => avg(b) - avg(a))[0]
  const worst = [...items].sort((a, b) => avg(a) - avg(b))[0]
  const parts = [
    `Marked in code, so this looks at length, structure and coverage rather than how convincing you sounded. Overall ${Number.isNaN(overall) ? '–' : overall.toFixed(1)} out of 4.`,
    best && best !== worst ? `Your strongest answer was to "${clip(best.question, 70)}".` : '',
    worst ? `The weakest was "${clip(worst.question, 70)}": ${worst.note}` : '',
    fillers >= 8 ? `You used ${fillers} filler words; slow down and pause instead.` : '',
    ask?.repeated ? 'One of your questions at the end asked about something already covered.' : ''
  ]
  return parts.filter(Boolean).join(' ')
}

const avg = (i: ItemMark) => mean(Object.values(i.scores) as number[])

/** The learner's questions at the end, and whether one repeats what was already said */
export function askThemCheck(lines: Line[]): Debrief['askThem'] {
  const theirs = lines.filter((l) => l.who === 'you' && l.stage === 'ask-them' && /\?|\b(what|how|why|could you|can you|do you|is there)\b/i.test(l.text))
  if (!theirs.length)
    return lines.some((l) => l.stage === 'ask-them')
      ? {
          asked: [],
          repeated: false,
          note: 'You didn’t ask anything. Always have two questions ready.'
        }
      : undefined
  const before = lines
    .filter((l) => l.who === 'them' && l.stage !== 'ask-them')
    .map((l) => l.text)
    .join(' ')
  const known = keyWords(before)
  const repeated = theirs.some((l) => {
    const ws = [...keyWords(l.text)].filter((w) => !['question', 'questions', 'think', 'like', 'know', 'want', 'role', 'team', 'work'].includes(w))
    return ws.length >= 2 && ws.filter((w) => known.has(w)).length / ws.length >= 0.75
  })
  return {
    asked: theirs.map((l) => l.text),
    repeated,
    note: repeated ? 'At least one question went over ground the interviewer had already covered.' : 'Your questions were new ground.'
  }
}

/** The brief's checklist, ticked where the talk's words cover it (code), or left for Claude */
export function presentationCheck(input: MockTargetInput, lines: Line[]): Debrief['presentation'] {
  const talk = lines.filter((l) => l.who === 'you' && l.stage === 'presenting')
  const text = talk.map((l) => l.text).join(' ')
  const cov = rubricCoverage(input.presentation?.checklist ?? [], text)
  return {
    seconds: Math.round(spokenMs(talk) / 1000),
    checklist: cov.map((c) => ({ item: c.point, met: c.hit }))
  }
}

// ---------- Claude's marking ----------

export function markSystem(): string {
  return `You are an experienced graduate recruiter and interviewer giving a candidate feedback after a mock interview, the way a good recruiter does on the phone: direct, kind, specific, in plain spoken English. ${PLAIN_WORDS} Never invent anything the candidate didn't say. Reply with JSON only.`
}

export function markPrompt(input: MockTargetInput, plan: Plan, lines: Line[]): string {
  const m = [...measures(lines).values()]
  const scenario = plan.items.find((i): i is Extract<PlanItem, { type: 'scenario' }> => i.type === 'scenario')
  const stamp = (l: Line) => `[${Math.floor(l.at / 60_000)}:${String(Math.floor((l.at % 60_000) / 1000)).padStart(2, '0')}] ${l.who === 'them' ? 'Interviewer' : 'Candidate'} (${l.item}${l.typed ? ', typed' : ''}): ${l.text}`
  return [
    `Round: ${input.round.name} (${input.round.kind}, ${input.round.minutes} minutes) for ${input.role || 'the role'}.`,
    input.round.notes ? `What the real round is like: ${input.round.notes}` : '',
    scenario ? `Scenario rubric (what a strong answer covers): ${scenario.s.rubric.join('; ')}` : '',
    input.presentation ? `Presentation brief checklist: ${input.presentation.checklist.join('; ')}` : '',
    `Measured per item (seconds spoken, words, words a minute, filler words): ${m.map((x) => `${x.item}: ${x.seconds}s, ${x.words}w, ${x.wpm || '–'}wpm, ${x.fillers} fillers`).join(' | ')}`,
    `Transcript:\n${lines.map(stamp).join('\n')}`,
    `Mark every item the candidate answered (use the item ids above; scenario parts "scenario:x#2" are one item "scenario:x"; skip "ask-them" and "close"). Scores 0–4: structure (a clear route, in order), specifics (real detail, numbers), ownership (what they did and the result), risk (only for scenario, technical and risk-related answers: did they find the risks, mitigate, escalate), clarity (presentation and Q&A only). 2 is acceptable, 3 good, 4 what gets an offer.`,
    `JSON shape: {"summary": "4–7 sentences of recruiter feedback, second person, plain words, what went well and what would cost them the offer", "items": [{"item": "id", "scores": {"structure": 0-4, "specifics": 0-4, "ownership": 0-4, "risk": 0-4 or omit, "clarity": 0-4 or omit}, "note": "one or two sentences", "weak": ["exact short quotes (5–15 words) from the candidate's answer that were the weakest moments"]}], "fixes": ["three things to fix next time, each one sentence, concrete"], "askThem": {"repeated": true/false, "note": "one sentence on their questions at the end; repeated means a question asked about something the interviewer had already covered"}${input.presentation ? ', "checklist": [{"item": "checklist item", "met": true/false}]' : ''}}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Reads Claude's marks and folds them over the code measures (time, pace and fillers stay measured) */
export function readMarks(raw: string, base: Debrief): Debrief | null {
  let j: {
    summary?: string
    items?: {
      item?: string
      scores?: Record<string, number>
      note?: string
      weak?: string[]
    }[]
    fixes?: string[]
    askThem?: { repeated?: boolean; note?: string }
    checklist?: { item?: string; met?: boolean }[]
  }
  try {
    const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
    j = JSON.parse(jsonrepair(body))
  } catch {
    return null
  }
  if (!j || typeof j.summary !== 'string' || !Array.isArray(j.items)) return null
  const items = base.items.map((b) => {
    const c = j.items!.find((x) => x.item === b.item || x.item?.replace(/#\d+$/, '') === b.item)
    if (!c) return b
    const scores: ItemMark['scores'] = { pace: b.scores.pace }
    for (const k of ['structure', 'specifics', 'ownership', 'risk', 'clarity'] as const) {
      const v = c.scores?.[k]
      if (typeof v === 'number' && Number.isFinite(v)) scores[k] = clamp4(v)
    }
    return {
      ...b,
      scores,
      note: c.note?.trim() || b.note,
      weak: (c.weak ?? []).filter((w) => typeof w === 'string' && w.trim()).slice(0, 3)
    }
  })
  const overall = mean(items.flatMap((i) => Object.values(i.scores) as number[]))
  const fixes = (j.fixes ?? []).filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
  return {
    ...base,
    summary: j.summary.trim(),
    items,
    fixes: fixes.length === 3 ? fixes : [...fixes, ...base.fixes].slice(0, 3),
    askThem: base.askThem
      ? {
          ...base.askThem,
          repeated: j.askThem?.repeated ?? base.askThem.repeated,
          note: j.askThem?.note?.trim() || base.askThem.note
        }
      : base.askThem,
    overall: Number.isNaN(overall) ? base.overall : Math.round(overall * 10) / 10,
    by: 'claude',
    presentation:
      base.presentation && j.checklist?.length
        ? {
            ...base.presentation,
            checklist: base.presentation.checklist.map((c) => ({
              ...c,
              met: j.checklist!.find((x) => x.item === c.item)?.met ?? c.met
            }))
          }
        : base.presentation
  }
}

/** The saved attempt for a finished round */
export function attemptOf(input: MockTargetInput, persona: Persona, lines: Line[], debrief: Debrief, totalMs: number, at = new Date()): MockAttempt {
  const scores: MockAttempt['scores'] = {}
  for (const k of Object.keys(RUBRIC_LABEL) as RubricId[]) {
    const xs = debrief.items.map((i) => i.scores[k]).filter((x): x is number => typeof x === 'number')
    if (xs.length) scores[k] = Math.round(mean(xs) * 10) / 10
  }
  const items: Record<string, number> = {}
  for (const i of debrief.items) items[i.item] = i.seconds
  return {
    id: `${input.round.id}-${at.getTime().toString(36)}`,
    round: input.round.id,
    roundName: input.round.name,
    kind: input.round.kind,
    date: at.toISOString(),
    persona: { name: persona.name, title: persona.title, area: persona.area },
    overall: debrief.overall,
    scores,
    durations: {
      totalSec: Math.round(totalMs / 1000),
      speakingSec: debrief.items.reduce((n, i) => n + i.seconds, 0),
      items
    },
    transcript: lines,
    debrief,
    by: debrief.by
  }
}

/** The change since the last mock of the same round (0–4 scale), per rubric item and overall */
export function deltas(history: MockAttempt[], now: MockAttempt): { overall: number | null; by: Partial<Record<RubricId, number>> } {
  const prev = [...history].filter((h) => h.round === now.round && h.id !== now.id).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!prev) return { overall: null, by: {} }
  const by: Partial<Record<RubricId, number>> = {}
  for (const k of Object.keys(now.scores) as RubricId[]) if (prev.scores[k] !== undefined) by[k] = Math.round((now.scores[k]! - prev.scores[k]!) * 10) / 10
  return { overall: Math.round((now.overall - prev.overall) * 10) / 10, by }
}

/** Folder names and target slugs: "My Target" → "my-target" */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// ---------- IPC ----------

export interface MockTargetSummary {
  slug: string
  name: string
  company: string
  role: string
  rounds: MockRound[]
}

export interface MockLoaded {
  input: MockTargetInput
  history: MockAttempt[]
  /** Claude can run the interviewer and the marking */
  claude: boolean
  /** Tide's natural voice is set up */
  voice: boolean
  /** The tutor's voice, which the interviewer must not use */
  tutorVoice?: string
}

export interface MockTurnRequest {
  /** The stream's id: deltas arrive on interviewMock:delta with it */
  id: string
  slug: string
  round: string
  next: Next
  lines: Line[]
  persona: Persona
  elapsedMs: number
  seed: number
  /** Use the scripted interviewer even when Claude is there */
  scripted?: boolean
}

export type MockDelta =
  | { id: string; text: string }
  | {
      id: string
      done: true
      mark: TurnMark
      text: string
      by: 'claude' | 'script'
      firstMs?: number
      error?: string
    }

export interface MockMarkRequest {
  slug: string
  round: string
  seed: number
  persona: Persona
  lines: Line[]
  totalMs: number
  scripted?: boolean
}

export interface InterviewMockApi {
  targets(): Promise<MockTargetSummary[]>
  load(slug: string, round: string): Promise<MockLoaded>
  persona(slug: string, round: string, seed: number, avoidVoice?: string): Promise<Persona>
  turn(req: MockTurnRequest): Promise<void>
  cancel(id: string): Promise<void>
  mark(req: MockMarkRequest): Promise<{ attempt: MockAttempt; delta: ReturnType<typeof deltas> }>
  history(slug: string): Promise<MockAttempt[]>
  slides(path: string): Promise<{ name: string; pages: string[]; image?: string } | { error: string }>
  onDelta(cb: (d: MockDelta) => void): () => void
}
