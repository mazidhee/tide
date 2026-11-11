/**
 * The gold set: tutor replies written by a stronger model, to train the local tutor on. Each is a
 * whole teaching situation in the benchmark's scenario form (setup, history, reply, expectations),
 * so the app's prompt code builds its request and the benchmark's scorer marks its reply.
 *
 * Here: the form of a gold example, the plain-text source the examples are written in
 * (src/<subject>.gold, no escaping, compiled to <subject>.jsonl), the request an example becomes,
 * and its validation. An example is kept only if the scorer passes it against expectations that
 * are stated the way a scenario states its own, plus the rules a scenario cannot state (a score
 * that agrees with its verdict, the learner's words quoted in the mark, British spelling, nothing
 * the builder's scrub would alter).
 */
import { parseChartRequest } from '../../../src/shared/lab'
import { openingNotes, priorLessonsNote, recallDueNote, type LessonDigest, type RecallDue } from '../../../src/shared/lessonMemory'
import { hideWorking, parseBlocks, sessionInstructions, type AskType, type SessionSetup } from '../../../src/shared/session'
import { withInstructions } from '../../../src/shared/tutorPrompt'
import { lessonTurns, learnerText, type Message } from '../../eval/tutor/request'
import { defaultWords, fences, scoreReply } from '../../eval/tutor/score'
import type { Expect, Learner, Turn } from '../../eval/tutor/types'
import { estimateTokens, scrub, trainingSystem } from '../filters'

export const GOLD_SUBJECTS = ['systems', 'c-cpp', 'os', 'networking', 'distributed', 'databases', 'data-eng', 'ml', 'probability', 'linear-algebra', 'discrete', 'algorithms', 'blockchain', 'payments'] as const
export type GoldSubject = (typeof GOLD_SUBJECTS)[number]

export const GOLD_SUBJECT_LABEL: Record<GoldSubject, string> = {
  systems: 'Computer systems and architecture',
  'c-cpp': 'C and C++',
  os: 'Operating systems',
  networking: 'Networking',
  distributed: 'Distributed systems',
  databases: 'Databases and SQL',
  'data-eng': 'Data engineering',
  ml: 'ML and neural networks',
  probability: 'Probability',
  'linear-algebra': 'Linear algebra',
  discrete: 'Discrete maths',
  algorithms: 'Algorithms and data structures',
  blockchain: 'Blockchain basics',
  payments: 'Payments and fintech basics'
}

export const GOLD_SITUATIONS = ['open', 'open-prior', 'open-recall', 'after-correct', 'after-wrong', 'idk', 'show-me', 'mark-error', 'mark-unusual', 'tangent', 'why', 'hands-on', 'summary'] as const
export type GoldSituation = (typeof GOLD_SITUATIONS)[number]

export const GOLD_SITUATION_LABEL: Record<GoldSituation, string> = {
  open: 'Opening a new topic',
  'open-prior': 'Opening with a note about earlier lessons',
  'open-recall': 'Opening with a question due for recall',
  'after-correct': 'Continuing after a correct answer',
  'after-wrong': 'After a wrong answer with a specific misconception',
  idk: 'After "I don\'t know"',
  'show-me': 'A Show me request',
  'mark-error': 'Marking a worked answer with one error',
  'mark-unusual': 'Marking a correct answer reached by an unusual method',
  tangent: 'A tangent',
  why: 'A Why-mode turn',
  'hands-on': 'A hands-on turn (code or SQL)',
  summary: 'Ending a lesson with a summary'
}

/** The day every gold request is dated, as the builder dates them */
export const GOLD_DATE = Date.UTC(2026, 10, 11)

/** An earlier lesson as its author writes it: turned into the record's digest, dated back from GOLD_DATE */
export interface PriorLesson {
  topic: string
  daysAgo: number
  finished?: boolean
  plan?: string[]
  right?: number
  partly?: number
  wrong?: number
  missed?: string[]
  stuck?: string[]
  open?: string
}

/** What the lesson's first message was given about earlier work (main/lessons.earlierLessons) */
export interface Before {
  prior?: PriorLesson[]
  recall?: RecallDue[]
}

export interface GoldExample {
  id: string
  /** The unit of the held-out split: every example on one topic shares it, so a topic is never on both sides */
  group: string
  subject: GoldSubject
  situation: GoldSituation
  /** How the learner writes here: terse, wordy, confused, overconfident, typos, plain */
  voice?: string
  /** How hard the material of this turn is: easy, medium, hard */
  level?: string
  setup: SessionSetup
  before?: Before
  history: Turn[]
  reply: string
  by: string
  expect: Expect
  /** Python that asserts every number, output and result the example states, run by `cli.ts check` */
  verify?: string
  /** Why nothing in it needs a calculation, when there is no verify script */
  noverify?: string
  /** false: the code it shows is not run automatically (a fragment, a deliberate failure); its verify script runs it instead */
  autorun?: boolean
}

export const BY = 'claude-fable-5-2'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// ---------- the request ----------

const digest = (p: PriorLesson, i: number): LessonDigest => ({
  id: `prior-${i}`,
  topic: p.topic,
  when: GOLD_DATE - p.daysAgo * 86_400_000,
  finished: p.finished !== false,
  plan: p.plan ?? [],
  right: p.right ?? 0,
  partly: p.partly ?? 0,
  wrong: p.wrong ?? 0,
  missed: p.missed ?? [],
  stuck: p.stuck ?? [],
  open: p.open,
  asked: []
})

/** The note the first message carries about earlier work, worded by the app's own code */
export function beforeNote(g: Pick<GoldExample, 'setup' | 'before'>): string {
  if (!g.before) return ''
  return openingNotes(recallDueNote(g.before.recall ?? []), priorLessonsNote(g.setup.topic, (g.before.prior ?? []).map(digest), GOLD_DATE))
}

/**
 * The lesson's turns as the app sends them: the instructions at the head of the first message,
 * and before them (as main/agent's turn context puts it) what earlier lessons show.
 */
export function goldTurns(g: Pick<GoldExample, 'setup' | 'before' | 'history'>): Message[] {
  const turns = withInstructions(lessonTurns(g.setup, g.history), sessionInstructions(g.setup))
  const note = beforeNote(g)
  return note ? turns.map((m, i) => (i === 0 ? { ...m, content: `${note}\n\n---\n\n${m.content}` } : m)) : turns
}

/** The whole training request, without the reply */
export const goldMessages = (g: Pick<GoldExample, 'setup' | 'before' | 'history'>): Message[] => [{ role: 'system', content: trainingSystem(GOLD_DATE) }, ...goldTurns(g)]

// ---------- the source format ----------

/**
 * Parses a subject's source file. One example:
 *
 *   @@@@ tlb-reach-wrong-units
 *   situation: after-wrong
 *   topic: TLB reach and huge pages
 *   options: {"strategy":"maths"}            (optional JSON: the setup's options)
 *   mode: teach                              (optional; teach unless said)
 *   voice: overconfident                     (terse | wordy | confused | overconfident | typos | plain)
 *   level: medium                            (easy | medium | hard)
 *   before: {"recall":[…],"prior":[…]}       (optional JSON)
 *   expect: {"verdict":"wrong","names":["…"]}   (JSON; the situation's defaults are added)
 *   noverify: conceptual, no numbers         (or a @@ verify section)
 *   autorun: off                             (optional: the code shown is run by the verify script, not automatically)
 *   @@ tutor
 *   …
 *   @@ learner answer sure                   (answer [sure|unsure|guessing] | question | idk | showme | goon)
 *   …
 *   @@ reply
 *   …
 *   @@ verify
 *   assert …
 */
export function parseSource(text: string, subject: GoldSubject): { examples: GoldExample[]; problems: string[] } {
  const problems: string[] = []
  const examples: GoldExample[] = []
  const chunks = text.split(/^@@@@[ \t]+/m).slice(1)
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n')
    const name = chunk.slice(0, nl < 0 ? undefined : nl).trim()
    const say = (m: string) => problems.push(`${subject}-${name}: ${m}`)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      say('the name must be lower-case words joined by hyphens')
      continue
    }
    const parts = chunk.slice(nl + 1).split(/^@@[ \t]+/m)
    const head: Record<string, string> = {}
    for (const line of parts[0].split('\n')) {
      if (!line.trim()) continue
      const m = line.match(/^([a-z]+):\s*(.*)$/)
      if (!m) say(`not a header line: ${line.slice(0, 60)}`)
      else head[m[1]] = m[2].trim()
    }
    const json = <T>(key: string): T | undefined => {
      if (!head[key]) return undefined
      try {
        return JSON.parse(head[key]) as T
      } catch (e) {
        say(`${key} is not valid JSON: ${(e as Error).message}`)
        return undefined
      }
    }
    const history: Turn[] = []
    let reply = ''
    let verify: string | undefined
    for (const part of parts.slice(1)) {
      const end = part.indexOf('\n')
      const label = part.slice(0, end < 0 ? undefined : end).trim()
      const body = end < 0 ? '' : part.slice(end + 1).trim()
      const [who, kind, extra] = label.split(/\s+/)
      if (who === 'tutor') history.push({ tutor: body })
      else if (who === 'reply') reply = body
      else if (who === 'verify') verify = body
      else if (who === 'learner') {
        let l: Learner | null = null
        if (kind === 'answer') l = extra ? { answer: body, confidence: extra as 'sure' } : { answer: body }
        else if (kind === 'question') l = { question: body }
        else if (kind === 'idk') l = { idk: true }
        else if (kind === 'showme') l = { showMe: true }
        else if (kind === 'goon') l = { goOn: true }
        if (!l) say(`unknown learner turn: ${label}`)
        else if (extra && !['sure', 'unsure', 'guessing'].includes(extra)) say(`unknown confidence: ${extra}`)
        else history.push({ learner: l })
      } else say(`unknown section: ${label}`)
    }
    const situation = head.situation as GoldSituation
    const topic = head.topic ?? ''
    const options = json<SessionSetup['options']>('options')
    const setup: SessionSetup = { mode: (head.mode as SessionSetup['mode']) ?? 'teach', topic, ...(options ? { options } : {}) }
    const before = json<Before>('before')
    const given = json<Partial<Expect>>('expect') ?? {}
    const known = ['situation', 'topic', 'options', 'mode', 'voice', 'level', 'before', 'expect', 'noverify', 'autorun']
    for (const k of Object.keys(head)) if (!known.includes(k)) say(`unknown header: ${k}`)
    const g: GoldExample = {
      id: `${subject}-${name}`,
      // By topic alone: two subjects that both teach a topic still keep it on one side of the split
      group: slug(topic),
      subject,
      situation,
      ...(head.voice ? { voice: head.voice } : {}),
      ...(head.level ? { level: head.level } : {}),
      setup,
      ...(before ? { before } : {}),
      history,
      reply,
      by: BY,
      expect: fullExpect({ situation, setup, history }, given),
      ...(verify ? { verify } : {}),
      ...(head.noverify ? { noverify: head.noverify } : {}),
      ...(head.autorun === 'off' ? { autorun: false } : {})
    }
    examples.push(g)
  }
  return { examples, problems }
}

// ---------- expectations ----------

const lastLearner = (history: Turn[]): Learner | null => {
  const last = history[history.length - 1]
  return last && 'learner' in last ? last.learner : null
}

const PROBE_ASKS: AskType[] = ['short', 'predict', 'choice', 'explain']

/** The longest a reply may run in each situation: the scorer's own bounds, and never more */
export function wordBounds(s: Pick<GoldExample, 'situation' | 'setup' | 'history'>): { min: number; max: number } {
  if (s.situation === 'show-me') return defaultWords({ situation: 'show-me', setup: s.setup })
  if (s.situation === 'open' || s.situation === 'open-prior') return defaultWords({ situation: 'open', setup: s.setup })
  if (s.situation === 'open-recall') return defaultWords({ situation: 'recall-open', setup: s.setup })
  return defaultWords({ situation: 'after-correct', setup: s.setup })
}

/**
 * An example's expectations, stated the way a benchmark scenario states its own for the same
 * situation: what the author gives (the truth of the mark, what the feedback must name, the exact
 * values), with what the situation always requires added. Written out in full in the JSONL, so
 * the builder's scorer holds the reply to the same bounds.
 */
export function fullExpect(s: Pick<GoldExample, 'situation' | 'setup' | 'history'>, given: Partial<Expect>): Expect {
  const teach = s.setup.mode === 'teach'
  const said = lastLearner(s.history)
  const bounds = wordBounds(s)
  const e: Expect = { ends: 'ask', ...given }
  const forbid = new Set(given.forbid ?? [])
  const need = new Set(given.need ?? [])
  switch (s.situation) {
    case 'open':
    case 'open-prior':
      for (const t of ['grade', 'summary'] as const) forbid.add(t)
      if (teach && !s.setup.options?.refresh) {
        e.heading ??= 'Why this matters'
        // A lesson opens by finding out what they know: a problem with its solution comes later
        e.askTypes ??= PROBE_ASKS
        forbid.add('solution')
      }
      break
    case 'open-recall':
      for (const t of ['grade', 'summary', 'card'] as const) forbid.add(t)
      break
    case 'idk':
      forbid.add('grade')
      break
    case 'show-me':
      forbid.add('grade')
      // The Show me button asks for the picture and nothing after it; asked for in their own words, a question may follow
      e.ends = said && 'showMe' in said ? 'nothing' : (given.ends ?? 'either')
      break
    case 'tangent':
      forbid.add('grade')
      break
    case 'summary':
      e.ends = 'nothing'
      need.add('summary')
      break
    default:
      break
  }
  // Anything not right is kept as a flashcard (the format rules), whatever the situation
  if (e.verdict && e.verdict !== 'correct') need.add('card')
  if (forbid.size) e.forbid = [...forbid]
  if (need.size) e.need = [...need]
  const max = Math.min(given.words?.max ?? bounds.max, s.situation === 'show-me' ? 170 : bounds.max)
  e.words = { min: given.words?.min ?? bounds.min, max }
  return e
}

// ---------- validation ----------

const AMERICAN: [RegExp, string][] = [
  [/\b(color|colors|colored)\b/i, 'colour'],
  [/\bbehaviors?\b/i, 'behaviour'],
  [/\b(favor|favors|favored)\b/i, 'favour'],
  [/\bneighbors?\b/i, 'neighbour'],
  [/\b(center|centers|centered)\b/i, 'centre'],
  [/\b(analyze|analyzed|analyzing)\b/i, 'analyse'],
  [/\b(optimi|normali|initiali|organi|recogni|summari|minimi|maximi|generali|emphasi|reali|visuali|memori|synchroni|seriali|tokeni|randomi|regulari|parameteri|finali|standardi|categori|prioriti|utili|speciali|characteri|linear[i]|factori|diagonali|orthogonali|vectori|quanti|authori|capitali|centrali|materiali|penali|stabili)z(e|es|ed|ing|ation|ations|er|ers)\b/i, '-ise / -isation'],
  [/\b(modeling|modeled|labeled|labeling|canceled|canceling|traveled|signaling|signaled)\b/i, 'double the l'],
  [/\b(defense|offense)\b/i, '-ence'],
  [/\bmath\b/i, 'maths'],
  [/\b(fulfill|enroll)\b/i, 'single l'],
  [/\bcatalog\b/i, 'catalogue'],
  [/\b(meter|meters|liter|liters)\b/i, '-re']
]

const PADDING = /\b(great (job|work|answer|question|start)|good (job|work|question)|well done|nice (work|job|one)|excellent|awesome|fantastic|perfect[!.]|spot on|you('ve| have) got it|exactly right[!.]|does that make sense|make sense\?|let'?s dive|i hope this helps|happy to help|feel free)\b/i

/** Prose only: no fenced code, inline code, maths or hidden working */
const proseOf = (text: string) =>
  hideWorking(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/<ask\b[^>]*>/gi, ' ')

const squash = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const SIM_PARTS: Record<string, RegExp> = {
  'neural-net': /^(input|layer:\d|neuron:\d:\d|edge:\d:\d:\d|output|loss)$/,
  attention: /^(token:\d+|row:\d+|scores|weights|mix)$/,
  'gradient-descent': /^(point|gradient|path|minimum|surface|loss)$/,
  softmax: /^(logit:\d|probabilities|temperature)$/
}

/** A sim block held to what the system prompt documents, not the parser's forgiving defaults */
export function simProblems(body: string): string[] {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(body) as Record<string, unknown>
  } catch (e) {
    return [`sim block is not valid JSON: ${(e as Error).message}`]
  }
  const out: string[] = []
  const kind = String(o.kind)
  const one = (key: string, allowed: unknown[]) => {
    if (o[key] !== undefined && !allowed.includes(o[key])) out.push(`sim ${key} "${String(o[key])}" is not one of ${allowed.join(', ')}`)
  }
  const keys = (allowed: string[]) => {
    for (const k of Object.keys(o)) if (!['kind', 'title', 'tour', ...allowed].includes(k)) out.push(`sim key "${k}" is not documented for ${kind}`)
  }
  if (kind === 'neural-net') {
    keys(['layers', 'data', 'activation', 'rate', 'mode'])
    one('data', ['xor', 'circle', 'two-moons', 'spiral', 'linear'])
    one('activation', ['tanh', 'relu', 'sigmoid'])
    one('mode', ['forward', 'backward'])
    const l = o.layers as number[] | undefined
    if (l && !(Array.isArray(l) && l[0] === 2 && l[l.length - 1] === 1 && l.length >= 3 && l.length <= 5 && l.slice(1, -1).every((n) => Number.isInteger(n) && n >= 1 && n <= 8))) out.push('sim layers must be [2, up to 3 hidden layers of 1 to 8, 1]')
    if (o.data === 'spiral' && !(o.activation === 'relu' && JSON.stringify(l) === '[2,8,8,8,1]')) out.push('spiral needs relu and [2,8,8,8,1]')
    if (typeof o.rate === 'number' && !(o.rate >= 0.0001 && o.rate <= 3)) out.push('sim rate out of range')
  } else if (kind === 'attention') {
    keys(['tokens', 'heads', 'temperature', 'causal'])
    const t = o.tokens as unknown[]
    if (!Array.isArray(t) || t.length < 2 || t.length > 12 || !t.every((x) => typeof x === 'string')) out.push('sim tokens must be 2 to 12 strings')
    if (o.heads !== undefined && !(Number.isInteger(o.heads) && (o.heads as number) >= 1 && (o.heads as number) <= 4)) out.push('sim heads must be 1 to 4')
  } else if (kind === 'gradient-descent') {
    keys(['surface', 'optimiser', 'rate', 'momentum'])
    one('surface', ['bowl', 'ravine', 'saddle', 'two-minima'])
    one('optimiser', ['sgd', 'momentum', 'adam'])
    if (typeof o.rate === 'number' && !(o.rate >= 0.001 && o.rate <= 1.2)) out.push('sim rate out of range')
    if (typeof o.momentum === 'number' && !(o.momentum >= 0 && o.momentum <= 0.99)) out.push('sim momentum out of range')
  } else if (kind === 'softmax') {
    keys(['logits', 'labels', 'temperature'])
    const l = o.logits as unknown[]
    if (!Array.isArray(l) || l.length < 2 || l.length > 8 || !l.every((x) => typeof x === 'number' && Math.abs(x) <= 8)) out.push('sim logits must be 2 to 8 numbers within ±8')
    if (o.labels !== undefined && !(Array.isArray(o.labels) && Array.isArray(l) && o.labels.length === l.length)) out.push('sim labels must match the logits in number')
  } else return [`sim kind "${kind}" does not exist`]
  if (typeof o.temperature === 'number' && !(o.temperature >= 0.1 && o.temperature <= 5)) out.push('sim temperature out of range')
  if (o.tour !== undefined) {
    const tour = o.tour as { at?: unknown; say?: unknown; do?: Record<string, unknown> }[]
    if (!Array.isArray(tour) || tour.length > 12) out.push('sim tour must be at most 12 steps')
    else
      for (const step of tour) {
        if (typeof step.say !== 'string' || !step.say.trim() || step.say.length > 280) out.push('a tour step needs "say" of at most 280 characters')
        if (typeof step.at !== 'string' || !SIM_PARTS[kind].test(step.at)) out.push(`tour part "${String(step.at)}" is not a part of ${kind}`)
        if (step.do && !Object.keys(step.do).every((k) => ['run', 'pause', 'sample'].includes(k))) out.push('a tour step\'s "do" takes run, pause or sample')
      }
  }
  return out
}

const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v)

/** The protocol checks a tutor turn in a history must pass: it is what the model is shown as its own earlier reply */
const CONTEXT_CHECKS = ['tags-closed', 'clean', 'one-ask', 'ask-attrs', 'ends', 'plain-question', 'no-leak', 'solution', 'no-preamble']

const gradeOf = (reply: string) => {
  const m = reply.match(/<grade\b([^>]*)>([\s\S]*?)<\/grade>/i)
  if (!m) return null
  const verdict = m[1].match(/verdict\s*=\s*["']([^"']*)["']/i)?.[1]?.toLowerCase() ?? ''
  const score = m[1].match(/score\s*=\s*["']([^"']*)["']/i)?.[1]
  return { verdict, score: score === undefined ? null : Number(score), body: m[2] }
}

/** Why an example may not be kept; empty when it may. Everything here is deterministic and needs no interpreter */
export function validateGold(g: GoldExample): string[] {
  const problems: string[] = []
  const say = (m: string) => problems.push(m)
  const { setup, history, expect: e, reply } = g
  if (!GOLD_SUBJECTS.includes(g.subject)) say(`unknown subject ${g.subject}`)
  if (!GOLD_SITUATIONS.includes(g.situation)) return [`unknown situation ${g.situation}`]
  if (!setup.topic) say('no topic')
  if (!['terse', 'wordy', 'confused', 'overconfident', 'typos', 'plain'].includes(g.voice ?? '')) say('voice must be one of terse, wordy, confused, overconfident, typos, plain')
  if (!['easy', 'medium', 'hard'].includes(g.level ?? '')) say('level must be one of easy, medium, hard')
  // An explain-from-memory check is marked against a note the request would have to carry, and its opening is the app's own sentence
  if (!['teach', 'quiz', 'probe'].includes(setup.mode)) say(`mode ${setup.mode} is not part of the set`)
  if (![undefined, 'problems', 'dialogue', 'maths', 'code'].includes(setup.options?.strategy)) say(`strategy ${setup.options?.strategy} needs tools a written example cannot have`)
  if (setup.options?.project || setup.options?.placement || setup.options?.retest) say('project, placement and retest lessons are not part of the set')
  if (!reply.trim()) return [...problems, 'no reply']
  if (!g.verify && !g.noverify) say('needs a verify script, or noverify with the reason nothing in it is computed')

  // --- the conversation ---
  const opening = g.situation === 'open' || g.situation === 'open-prior' || g.situation === 'open-recall'
  if (opening !== (history.length === 0)) say(opening ? 'an opening has no history' : 'needs the conversation so far')
  history.forEach((t, i) => {
    if (('tutor' in t) !== (i % 2 === 0)) say(`turn ${i + 1} is out of order: the tutor speaks first, then they alternate`)
    if ('tutor' in t && !t.tutor.trim()) say(`turn ${i + 1} is empty`)
    if ('learner' in t && 'answer' in t.learner && !t.learner.answer.trim()) say(`turn ${i + 1} is an empty answer`)
  })
  const said = lastLearner(history)
  if (history.length && !said) say('the conversation must end with the learner')
  const answered = !!said && 'answer' in said
  if (problems.length) return problems

  // --- the situation, as the benchmark's validator states each kind ---
  const sit = g.situation
  if (answered && !e.verdict) say('ends with an answer, so the true verdict must be given')
  if (!answered && e.verdict) say('a verdict where nothing is being marked')
  if (e.verdict && e.verdict !== 'correct' && e.accept?.includes('correct')) say('"correct" can never be accepted for an answer that is not right')
  if ((sit === 'after-correct' || sit === 'mark-unusual') && e.verdict !== 'correct') say(`${sit} needs verdict correct`)
  if ((sit === 'after-wrong' || sit === 'mark-error') && (!e.verdict || e.verdict === 'correct')) say(`${sit}: the answer is not right, so the verdict is partial or wrong`)
  if ((sit === 'after-wrong' || sit === 'mark-error') && !e.names?.length) say(`${sit} needs "names": what the feedback must point at (the misconception, the first wrong step)`)
  if (sit === 'idk' && !(said && 'idk' in said)) say('ends with something other than "I don\'t know"')
  if (sit === 'idk' && !e.askMustNot?.length && !e.must?.length) say('idk needs "must" (the idea taught) or "askMustNot" (the answer the question must not hold)')
  if (sit === 'show-me' && !(said && ('showMe' in said || 'question' in said))) say('ends with something other than Show me or a request to see it')
  if (sit === 'show-me' && !e.visual) say('a request to see something expects a visual')
  if (sit === 'tangent' && !(said && 'question' in said)) say("a tangent ends with the learner's own question")
  if (sit === 'tangent' && !e.must?.length) say('a tangent needs "must": the fact its answer turns on')
  if (sit === 'why' && !setup.options?.why) say('a Why-mode turn needs options.why')
  if (sit === 'open-prior' && !g.before?.prior?.length) say('open-prior needs before.prior')
  if (sit === 'open-recall' && !g.before?.recall?.length) say('open-recall needs before.recall')
  if (sit === 'open' && g.before) say('a plain opening has no note about earlier work')
  if (g.before?.prior?.length && !priorLessonsNote(setup.topic, g.before.prior.map(digest), GOLD_DATE)) say('the earlier lessons are not close enough to this topic for the app to mention them (lessonMemory.closeness < 0.5), or are older than 180 days')
  if (g.before?.prior?.length && priorLessonsNote(setup.topic, g.before.prior.map(digest), GOLD_DATE).split('\n').length - 2 !== g.before.prior.length) say('not every earlier lesson given would be mentioned by the app (at most 3, each close to this topic)')
  for (const r of g.before?.recall ?? []) if (r.prompt.length > 150 || /\n/.test(r.prompt)) say('a recall question is kept in at most 150 characters on one line')
  if ((g.before?.recall?.length ?? 0) > 2) say('at most two questions are due at once')
  const fenced = fences(reply)
  if (sit === 'hands-on' && !fenced.some((f) => ['python', 'c', 'cpp', 'sql', 'javascript', 'chart'].includes(f.lang)) && !/<ask\b[^>]*type\s*=\s*["']code["']/i.test(reply)) say('a hands-on turn shows a runnable snippet or sets a code task')
  const allText = [reply, ...history.map((t) => ('tutor' in t ? t.tutor : learnerText(t.learner)))].join('\n')
  if (!g.verify && (/```(python|c|cpp|sql|javascript|chart)\b/.test(allText) || /<check\b/i.test(allText))) say('code is involved: it needs a verify script that runs it, not noverify')
  if (JSON.stringify(sorted(fullExpect(g, e))) !== JSON.stringify(sorted(e))) say('its expectations are not the full set its situation requires (run them through fullExpect)')

  // --- the request, and the hidden notes that bind this turn ---
  let messages: Message[] = []
  try {
    messages = goldMessages(g)
  } catch (err) {
    return [...problems, `request could not be built: ${(err as Error).message}`]
  }
  const lastMessage = messages[messages.length - 1]
  if (lastMessage.role !== 'user') say('the request does not end with the learner')
  if (messages.some((m, k) => k > 0 && m.role === messages[k - 1].role)) say('turns out of order')
  if (!messages[1].content.includes('How to tutor me here:')) say('the lesson instructions are missing from the first message')
  const note = lastMessage.content
  const showMeButton = !!said && 'showMe' in said
  if (/End your reply with a <note>|add it in a <note>/.test(note) && !showMeButton && !/<note\b/i.test(reply)) say('Tide asks for a <note> on this turn (a hidden nudge rides on the learner\'s message): the reply must carry one')
  if (/ask nothing, and end with <continue\/>/.test(note) && e.ends !== 'continue') say('Tide asks for <continue/> on this turn: expect.ends must be "continue"')
  if (/Check their understanding now with one question/.test(note) && e.ends !== 'ask') say('Tide asks for a question on this turn: expect.ends must be "ask"')
  const tokens = estimateTokens([...messages, { role: 'assistant', content: reply }])
  if (tokens > 7500) say(`too long for the training window: about ${tokens} tokens, 7500 allowed`)
  for (const m of [...messages.slice(1), { role: 'assistant' as const, content: reply }]) {
    // The builder replaces anything that looks like a personal detail: an example it would alter is not what was written
    const s = scrub(m.content, { names: [] })
    if (s.replaced) {
      const at = s.text.match(/.{0,30}\[(email|phone|key|local address)\].{0,30}|.{0,30}\/Users\/learner.{0,30}/s)?.[0] ?? ''
      say(`the builder's scrub would alter it (an email, a path, a local address, or digits grouped like a phone number): …${at.replace(/\s+/g, ' ')}…`)
      break
    }
  }
  // The explain-from-memory opening is the app's own sentence; with it set aside, a learner's message never needs the word
  if (/metabase/i.test(allText)) say('nothing about Metabase belongs in the set')

  // --- the scorer, exactly as the builder will run it ---
  const score = scoreReply({ expect: e, situation: 'after-correct', setup }, reply)
  for (const f of score.failed) {
    const check = score.protocol.checks.find((c) => c.id === f)
    const why = f === 'pace' ? `${score.pace.words} words, allowed ${score.pace.min} to ${score.pace.max}` : f === 'visual' ? score.visual?.why : f === 'verdict' ? `marked ${score.marking?.got}, the truth is ${score.marking?.expected}` : check?.why
    say(`scorer: ${f}${why ? ` (${why})` : ''}`)
  }

  // --- what a scenario cannot state ---
  const grade = gradeOf(reply)
  if (grade && e.verdict) {
    const sc = grade.score
    if (sc === null) say('the grade has no score')
    else if (grade.verdict === 'correct' && sc < 1) say('a correct answer scores 1')
    else if (grade.verdict === 'partial' && (sc < 0.3 || sc > 0.8)) say('a partial answer scores between 0.3 and 0.8')
    else if (grade.verdict === 'wrong' && sc > 0.3) say('a wrong answer scores at most 0.3')
    // "quote the words of their answer that earned the verdict"
    const answer = squash(said && 'answer' in said ? said.answer : '')
    const quotes = [...grade.body.matchAll(/"([^"]{2,})"|“([^”]{2,})”|`([^`]{1,})`/g)].map((m) => squash(m[1] ?? m[2] ?? m[3]))
    if (!quotes.some((q) => q && answer.includes(q))) say('the grade does not quote the learner\'s own words (in double quotes or backticks, exactly as they wrote them)')
  }
  if (!grade && e.verdict) say('no grade')
  if (grade && !e.verdict) say('a grade where nothing was answered')
  if (sit === 'open-recall') {
    const asked = parseBlocks(reply).find((b) => b.kind === 'ask')
    const due = g.before?.recall?.[0]?.prompt ?? ''
    if (!asked || asked.kind !== 'ask' || squash(asked.prompt) !== squash(due)) say('the opening question must be the first question due for recall, in its own words')
  }
  if (setup.mode === 'quiz' && /<ask\b/i.test(reply) && !new RegExp(`Question \\d+ of ${setup.options?.length ?? 8}\\b`).test(reply)) say(`a quiz numbers its questions: "Question n of ${setup.options?.length ?? 8}"`)
  const prose = proseOf(reply)
  for (const [re, hint] of AMERICAN) {
    const m = prose.match(re)
    if (m) say(`American spelling in the prose: "${m[0]}" (${hint})`)
  }
  const pad = prose.match(PADDING)
  if (pad) say(`praise or padding: "${pad[0]}"`)
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(reply.replace(/[→←↔⇒✓✗×]/g, ''))) say('an emoji')
  if (/!\s*($|\n)/.test(prose.replace(/!=/g, ''))) say('an exclamation mark ends a sentence: the voice is plain')
  for (const f of fenced) {
    if (f.lang === 'sim') for (const p of simProblems(f.body)) say(p)
    if (f.lang === 'chart') {
      const c = parseChartRequest(f.body)
      if ('error' in c) say(`chart: ${c.error}`)
    }
    if (f.lang === '' && /^\s*(flowchart|graph|sequenceDiagram|stateDiagram|mindmap)\b/.test(f.body)) say('a mermaid diagram in a fence with no language')
  }
  if (fenced.filter((f) => f.lang === 'sim').length > 1) say('one simulation per answer')
  if (/<check\b/i.test(allText) && /sympy/i.test(allText.match(/<check\b[\s\S]*?<\/check>/gi)?.join('\n') ?? '')) say('a <check> here may use only the standard library or numpy, so it can be run when the set is verified')

  // --- the turns before: what the model is shown as its own ---
  history.forEach((t, i) => {
    if (!('tutor' in t)) return
    const wraps = /<summary\b/i.test(t.tutor)
    const p = scoreReply({ expect: { ends: wraps ? 'nothing' : 'either' }, situation: 'after-correct', setup }, t.tutor)
    const broken = p.protocol.checks.filter((c) => !c.ok && CONTEXT_CHECKS.includes(c.id))
    for (const c of broken) say(`turn ${i + 1} (the tutor's earlier reply) breaks the protocol: ${c.id}${c.why ? ` (${c.why})` : ''}`)
    const next = history[i + 1]
    const asked = /<ask\b/i.test(t.tutor)
    if (next && 'learner' in next && ('answer' in next.learner || 'idk' in next.learner) && !asked) say(`turn ${i + 2} answers a question turn ${i + 1} never asked`)
    if (next && 'learner' in next && 'goOn' in next.learner && asked) say(`turn ${i + 2} is "Go on" after a question`)
    for (const f of fences(t.tutor)) if (f.lang === 'sim') for (const sp of simProblems(f.body)) say(`turn ${i + 1}: ${sp}`)
  })
  return problems
}

/** One JSON line for the builder: the example with its expectations in full */
export const goldLine = (g: GoldExample) => JSON.stringify(g)

export function readGoldLines(text: string): GoldExample[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldExample)
}

/** Examples that say nearly the same thing as an earlier one in the list: a set of near-copies teaches one reply many times */
export function nearCopies(all: GoldExample[], share = 0.4): { id: string; of: string; share: number }[] {
  const runs = (t: string) => {
    const w = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')
    const set = new Set<string>()
    for (let i = 0; i + 3 < w.length; i++) set.add(w.slice(i, i + 4).join(' '))
    return set
  }
  const seen: { id: string; runs: Set<string> }[] = []
  const out: { id: string; of: string; share: number }[] = []
  for (const g of all) {
    const mine = runs(g.reply)
    if (mine.size >= 12)
      for (const other of seen) {
        if (other.runs.size < 12) continue
        const [small, large] = mine.size <= other.runs.size ? [mine, other.runs] : [other.runs, mine]
        let same = 0
        for (const r of small) if (large.has(r)) same++
        if (same / small.size >= share) {
          out.push({ id: g.id, of: other.id, share: same / small.size })
          break
        }
      }
    seen.push({ id: g.id, runs: mine })
  }
  return out
}
