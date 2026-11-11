/**
 * The knowledge map: one picture of what you know. Concepts are your roadmap topics, the topics
 * of lessons that aren't on a roadmap, and the steps of a lesson's plan; the evidence on each is
 * what Tide already records (taught, answered, couldn't answer, recalled). No model is asked:
 * everything here is read from roadmaps and lesson records, so it is free and says nothing that
 * didn't happen. The estimates and the store are Tide's Rust module (native/tide-core/src/knowledge.rs).
 */
import type { RoadmapTopic } from './curriculum'
import type { LessonRecord } from './lessonLog'
import { closeness, type LessonDigest } from './lessonMemory'

export type ConceptStatus = 'new' | 'learning' | 'solid' | 'fading'
export type EvidenceKind = 'taught' | 'right' | 'partly' | 'wrong' | 'stuck' | 'recalled-right' | 'recalled-wrong'

export interface ConceptIn {
  id: string
  name: string
  /** The notebook it belongs to; empty when it belongs to none */
  area: string
  section?: string
  /** For a step of a lesson's plan: the topic it is part of */
  parent?: string
  origin: 'roadmap' | 'lesson' | 'step'
  order: number
  prerequisites: string[]
  /** Ticked on the roadmap */
  done?: boolean
  private?: boolean
}

export interface EvidenceIn {
  concept: string
  /** Where it came from, and its place there: the two together are kept once */
  source: string
  pos: string
  kind: EvidenceKind
  at: number
  weight: number
  private?: boolean
  /** The source#pos of evidence this stands in place of */
  supersedes?: string
}

export interface ConceptState {
  id: string
  name: string
  area: string
  section?: string
  parent?: string
  origin: 'roadmap' | 'lesson' | 'step'
  order: number
  prerequisites: string[]
  done: boolean
  private: boolean
  /** How solid it is now, 0 to 1 */
  estimate: number
  /** How well it was known at the last evidence, before any forgetting */
  level: number
  /** Days for the estimate to halve when unused */
  halfLife: number
  status: ConceptStatus
  lastSeen?: number
  lastRight?: number
  seen: number
  right: number
  partly: number
  /** Wrong, or couldn't answer */
  wrong: number
  /** For a solid concept: days until it stops being solid if it isn't used */
  fadesIn?: number
}

export interface Picture {
  topic?: ConceptState
  solid: ConceptState[]
  shaky: ConceptState[]
  prerequisites: ConceptState[]
}

export interface WeekPoint {
  /** The Monday the week starts on */
  start: number
  /** Questions that came back that week */
  asked: number
  /** How many were right (partly right counts half) */
  right: number
}

/** What the "What you know" page is given */
export interface KnowledgeView {
  at: number
  /** Notebooks with a folder to start a lesson in, by area name */
  areas: { name: string; path: string }[]
  concepts: ConceptState[]
  /** Ids, in the order to show them */
  ready: string[]
  /** Solid now, soonest to fade first */
  fading: string[]
  weeks: WeekPoint[]
}

/** The estimate at or above which a concept counts as solid (the same line the Rust module draws) */
export const SOLID = 0.6

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const NEEDS = /\s*\((?:needs|requires|after)\b:?\s*([^)]*)\)\s*$/i

/**
 * A roadmap line may say what it builds on: "Raft (needs: Consensus, Logical clocks)", or
 * "(needs: nothing)". Without it, a topic builds on the one before it in its section.
 */
export function needsOf(title: string): { name: string; needs: string[] | null } {
  const m = title.match(NEEDS)
  if (!m) return { name: title, needs: null }
  const list = m[1].split(/[,;]/).map((s) => s.trim()).filter((s) => s && !/^(nothing|none)$/i.test(s))
  return { name: title.slice(0, m.index).trim() || title, needs: list }
}

/** A lesson's topic as its concept is named: without a "(needs: …)" note */
export const conceptName = (topic: string) => needsOf(topic.replace(/\*\*/g, '')).name

/**
 * A roadmap's topics as concepts, in its order. Each builds on the topic before it in its section
 * unless its line says otherwise; projects aren't taught, so they are neither concepts nor links.
 */
export function roadmapConcepts(topics: RoadmapTopic[], isPrivate = false): ConceptIn[] {
  const taught = topics.filter((t) => !t.project)
  const named = taught.map((t) => needsOf(t.title.replace(/\*\*/g, '')))
  const byName = new Map<string, string>()
  taught.forEach((t, i) => {
    if (!byName.has(norm(named[i].name))) byName.set(norm(named[i].name), t.id)
  })
  const last = new Map<string, string>()
  return taught.map((t, i) => {
    const before = last.get(t.sectionId)
    last.set(t.sectionId, t.id)
    const needs = named[i].needs
    const prerequisites = needs ? needs.map((n) => byName.get(norm(n))).filter((id): id is string => !!id && id !== t.id) : before ? [before] : []
    return {
      id: t.id,
      name: named[i].name,
      area: t.notebook,
      ...(t.section ? { section: t.section } : {}),
      origin: 'roadmap' as const,
      order: i,
      prerequisites: [...new Set(prerequisites)],
      ...(t.checked ? { done: true } : {}),
      ...(isPrivate ? { private: true } : {})
    }
  })
}

/** The id of a lesson topic that isn't on a roadmap */
export const lessonConceptId = (area: string, topic: string) => `lesson::${norm(area)}::${norm(conceptName(topic))}`

const KIND: Record<NonNullable<LessonDigest['asked'][number]['mark']>, EvidenceKind> = { correct: 'right', partial: 'partly', wrong: 'wrong', stuck: 'stuck' }
const RECALLED: Record<EvidenceKind, EvidenceKind> = { taught: 'taught', right: 'recalled-right', partly: 'partly', wrong: 'recalled-wrong', stuck: 'recalled-wrong', 'recalled-right': 'recalled-right', 'recalled-wrong': 'recalled-wrong' }

/** An answer's kind when the question was one coming back (a recall, a retest) rather than a first asking */
export const recalled = (kind: EvidenceKind) => RECALLED[kind]
export const kindOfMark = (mark: keyof typeof KIND) => KIND[mark]

/**
 * What one lesson record shows, as evidence on its topic's concept: that it was taught, and every
 * question that got a mark or couldn't be answered. The steps of its plan become parts of the
 * topic; a question counts on the step whose words it shares, and a step counts as taught once
 * the lesson has finished or a question on it or a later step has been answered.
 */
export function lessonEvidence(record: Pick<LessonRecord, 'id' | 'mode' | 'started' | 'updated' | 'finished'>, d: LessonDigest, concept: Pick<ConceptIn, 'id' | 'area'>, isPrivate = false): { steps: ConceptIn[]; events: EvidenceIn[] } {
  const source = `lesson:${record.id}`
  const shared = isPrivate ? { private: true } : {}
  const events: EvidenceIn[] = []
  const teach = record.mode === 'teach'
  if (teach) events.push({ concept: concept.id, source, pos: 'taught', kind: 'taught', at: record.started, weight: record.finished ? 1 : 0.6, ...shared })
  const marked = d.asked.map((a, i) => ({ ...a, i })).filter((a): a is typeof a & { mark: keyof typeof KIND } => !!a.mark)
  for (const a of marked) events.push({ concept: concept.id, source, pos: `q${a.i}`, kind: KIND[a.mark], at: record.updated, weight: 1, ...shared })

  // The step a question is about: the one sharing most of its words, when at least half of the step's are there
  const stepOf = (prompt: string) => {
    let best = -1
    let score = 0.5
    d.plan.forEach((s, j) => {
      const c = closeness(s, prompt)
      if (c > score || (c === score && best < 0)) [best, score] = [j, c]
    })
    return best
  }
  const onStep = marked.map((a) => ({ a, j: stepOf(a.prompt) })).filter((x) => x.j >= 0)
  const reached = record.finished ? d.plan.length - 1 : Math.max(-1, ...onStep.map((x) => x.j))
  const steps: ConceptIn[] = []
  const seen = new Set<string>()
  d.plan.forEach((name, j) => {
    const id = `${concept.id}##${norm(name)}`
    if (j > reached || seen.has(id) || !norm(name)) return
    seen.add(id)
    steps.push({ id, name, area: concept.area, parent: concept.id, origin: 'step', order: j, prerequisites: [], ...shared })
    if (teach) events.push({ concept: id, source, pos: `s${j}.taught`, kind: 'taught', at: record.started, weight: 1, ...shared })
    for (const x of onStep.filter((x) => x.j === j)) events.push({ concept: id, source, pos: `s${j}.q${x.a.i}`, kind: KIND[x.a.mark], at: record.updated, weight: 1, ...shared })
  })
  return { steps, events }
}

// ---------- The note a lesson's tutor opens with ----------

const clipName = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** How long ago, in words: "3 days ago", "5 weeks ago" */
export const since = (ms: number | undefined, now: number) => {
  if (!ms) return ''
  const days = Math.floor((now - ms) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 14 ? `${days} days ago` : days < 70 ? `${Math.round(days / 7)} weeks ago` : `${Math.round(days / 30)} months ago`
}

/** Why a concept is shaky, in a few words the tutor can act on */
function why(c: ConceptState, now: number): string {
  const answers = c.right + c.partly + c.wrong
  if (c.status === 'fading') return `fading, last right ${since(c.lastRight ?? c.lastSeen, now)}`
  if (!answers) return 'taught, never checked'
  return `${c.right} of ${answers} right`
}

/**
 * What the knowledge map shows around a topic, for the tutor as a lesson opens: what is solid
 * (don't re-teach), what is shaky or fading (check first), and what it builds on that isn't solid
 * yet. Facts only, and short: the local model reads it on every lesson. Empty when there is nothing to say.
 */
export function knowledgeNote(p: Picture, now = Date.now()): string {
  const own = p.topic && p.topic.seen > 0 ? p.topic : undefined
  const write = (n: number) => {
    const list = (cs: ConceptState[], detail?: (c: ConceptState) => string) => cs.slice(0, n).map((c) => `"${clipName(c.name)}"${detail ? ` (${detail(c)})` : ''}`).join('; ')
    const lines = [
      own ? `This topic itself: ${own.status === 'solid' ? `solid (${own.right} right, last ${since(own.lastRight, now)}); go further, don't start again` : why(own, now)}.` : '',
      p.solid.length ? `Solid, don't re-teach: ${list(p.solid)}.` : '',
      p.shaky.length ? `Shaky or fading, check first with one short question: ${list(p.shaky, (c) => why(c, now))}.` : '',
      p.prerequisites.length ? `Builds on these, not yet solid; teach or check them first: ${list(p.prerequisites, (c) => (c.seen ? why(c, now) : 'not studied here'))}.` : ''
    ].filter(Boolean)
    return lines.length ? ['From Tide’s record of this student’s answers and the time since (facts, not your memory):', ...lines].join('\n') : ''
  }
  // Three of each when they fit; fewer rather than a long note
  for (const n of [3, 2]) {
    const note = write(n)
    if (note.split(/\s+/).length <= NOTE_WORDS) return note
  }
  return write(1)
}

/** The most the note may run to */
export const NOTE_WORDS = 120

// ---------- For the page ----------

/** A concept the learner ticked themselves and Tide has never asked about */
export const tickedOnly = (c: ConceptState) => c.done && c.status === 'new'

/** A week's share right, 0 to 1; null when nothing came back that week */
export const shareRight = (w: WeekPoint) => (w.asked ? w.right / w.asked : null)

export const STATUS_LABEL: Record<ConceptStatus, string> = { solid: 'Solid', fading: 'Fading', learning: 'In progress', new: 'Not started' }

const inDays = (days: number) => (days < 1 ? 'by tomorrow' : days < 14 ? `in ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}` : days < 70 ? `in ${Math.round(days / 7)} weeks` : `in ${Math.round(days / 30)} months`)

/** One concept's standing in a few words: the status, and the fact behind it */
export function standing(c: ConceptState, now: number): { label: string; detail: string } {
  const answers = c.right + c.partly + c.wrong
  if (c.status === 'solid') return { label: 'Solid', detail: c.fadesIn !== undefined ? `fades ${inDays(c.fadesIn)} if unused` : '' }
  if (c.status === 'fading') return { label: 'Fading', detail: `last right ${since(c.lastRight ?? c.lastSeen, now)}` }
  if (c.status === 'learning') return { label: 'In progress', detail: answers ? `${c.right} of ${answers} right` : 'taught, not checked yet' }
  return c.done ? { label: 'Ticked', detail: 'not checked by Tide' } : { label: 'Not started', detail: '' }
}

/** A solid concept this close to the line is worth a look before it crosses */
const SOON_DAYS = 2

/**
 * What to go back to, most worth it first: what has just faded (the least work to get back), what
 * is about to, then what has been answered but not yet right and can't simply be carried on (a
 * topic in progress that is ready is under "Ready next", not here too). Topics only, not their plan steps.
 */
export function revisitList(concepts: ConceptState[], ready: ReadonlySet<string> = new Set()): ConceptState[] {
  const top = concepts.filter((c) => !c.parent)
  const fading = top.filter((c) => c.status === 'fading').sort((a, b) => b.estimate - a.estimate)
  const soon = top.filter((c) => c.status === 'solid' && c.fadesIn !== undefined && c.fadesIn <= SOON_DAYS).sort((a, b) => a.fadesIn! - b.fadesIn!)
  const shaky = top.filter((c) => c.status === 'learning' && c.wrong + c.partly > 0 && !ready.has(c.id)).sort((a, b) => a.estimate - b.estimate)
  return [...fading, ...soon, ...shaky]
}

/** The first few ready topics for the top of the page: one from each area in turn, so no roadmap crowds out the rest */
export function readyAcross(ready: ConceptState[], n: number): ConceptState[] {
  const byArea = new Map<string, ConceptState[]>()
  for (const c of ready) byArea.set(c.area, [...(byArea.get(c.area) ?? []), c])
  const out: ConceptState[] = []
  for (let i = 0; out.length < n && [...byArea.values()].some((l) => l.length > i); i++) for (const l of byArea.values()) if (l[i] && out.length < n) out.push(l[i])
  return out
}
