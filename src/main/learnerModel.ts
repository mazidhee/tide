/**
 * The learner model, served: built from the learning event log (main/learningLog), the knowledge
 * map, your goals (and goals North Star registers), your courses and projects; asked by the tutor,
 * the coach and North Star through the query functions here and Tide's MCP tools; shown in What
 * you know › Your model, where you can correct a judgement. shared/learnerModel has the rules.
 *
 * Claude (Haiku, in the background) proposes "used in" links and skill tags where the map has
 * none; they are kept, and the name heuristics stand in without Claude. docs/learner-model.md is
 * the API for whoever builds on it.
 */
import type { Depth, EventIn, LearningEvent } from '@shared/learningEvents'
import {
  buildModel,
  depthCounts,
  eventLine,
  fading,
  findGoal,
  measuresLine,
  modelDigest,
  recentEvents,
  SKILLS,
  skillId,
  standing,
  standingText,
  transferGaps,
  usedIn,
  weakestFor,
  type LearnerModel,
  type ModelEdge,
  type ModelGoal,
  type ModelNode
} from '@shared/learnerModel'
import { DEPTH_LABEL } from '@shared/learningEvents'
import type { ModelView, ModelNodeView, ModelNodeDetail } from '@shared/learnerModelView'
import type { McpTool } from './tideMcp'
import { learningEvent, onLogChange, readEvents, readGoals, readLinks, readTargets, saveLinks, setGoals, setMeta, getMeta, setTargets } from './learningLog'

// ---------- Building, cached ----------

let cached: { model: LearnerModel; events: LearningEvent[]; at: number } | null = null
let building: Promise<{ model: LearnerModel; events: LearningEvent[] }> | null = null
const FRESH_MS = 60_000
onLogChange(() => (cached = null))

/** Your goals as the model takes them: each roadmap, project and topic it needs, plus goals registered from elsewhere */
async function goalsIn(): Promise<ModelGoal[]> {
  const out: ModelGoal[] = []
  try {
    const [{ snapshot }, { getNotebooks }] = await Promise.all([import('./goals'), import('./learn')])
    const s = await snapshot()
    const notebooks = await getNotebooks().catch(() => [])
    const nameOf = (ref: string) => notebooks.find((n) => n.path === ref || n.name === ref)?.name ?? ref.split('/').pop() ?? ref
    for (const g of s.goals) {
      if (g.off) continue
      const live = g.needs.filter((n) => !n.dropped)
      out.push({
        id: g.id,
        title: g.title,
        source: 'goals',
        weight: g.weight,
        ...(g.date ? { date: g.date } : {}),
        areas: live.filter((n) => n.kind === 'roadmap').map((n) => nameOf(n.ref)),
        concepts: live.filter((n) => n.kind === 'topic').map((n) => n.ref || n.label),
        projects: live.filter((n) => n.kind === 'project').map((n) => n.ref)
      })
    }
  } catch (e) {
    console.warn('[learner model] goals', (e as Error).message)
  }
  return [...out, ...readGoals()]
}

async function gather(): Promise<{ model: LearnerModel; events: LearningEvent[] }> {
  const { backfillOnce } = await import('./learningBackfill')
  await backfillOnce().catch((e) => console.warn('[learner model] reading in earlier records', (e as Error).message))
  const [{ allConcepts }] = await Promise.all([import('./knowledge')])
  const concepts = await allConcepts().catch(() => [])
  const events = readEvents()
  const goals = await goalsIn()
  const courses = await import('./courses')
    .then((c) => c.listCourses())
    .then((list) => list.filter((c) => c.imported).map((c) => ({ id: c.id, title: c.title })))
    .catch(() => [])
  const projects = await import('./ideaProjects')
    .then((p) => p.allPlans())
    .then((plans) => plans.map((p) => ({ id: p.notebook ?? p.slug, name: p.name, concepts: p.milestones.flatMap((m) => m.lessons.map((l) => l.concept)) })))
    .catch(() => [])
  const model = buildModel({ now: Date.now(), concepts, events, goals, courses, projects, links: readLinks(), targets: readTargets() })
  return { model, events }
}

/** The model as it stands (built at most once a minute, and again after anything is logged) */
export async function learnerModel(fresh = false): Promise<{ model: LearnerModel; events: LearningEvent[] }> {
  if (!fresh && cached && Date.now() - cached.at < FRESH_MS) return cached
  if (!building) {
    building = gather()
      .then((r) => {
        cached = { ...r, at: Date.now() }
        // Links where there are none: Haiku in the background, never waited on
        void proposeLinks(r.model).catch(() => {})
        return r
      })
      .finally(() => {
        building = null
      })
  }
  return building
}

// ---------- The API ----------

/** Where the learner stands on a concept, skill or goal, with the evidence */
export async function whereIStand(topic: string, compact = false): Promise<string> {
  const { model } = await learnerModel()
  const s = standing(model, topic)
  if (!s) return `Nothing on the map called “${topic}”.`
  return standingText(s, compact)
}

export async function whatsFading(limit = 10): Promise<ModelNode[]> {
  return fading((await learnerModel()).model, limit)
}

export async function weakestForGoal(goal: string, limit = 8) {
  return weakestFor((await learnerModel()).model, goal, limit)
}

export async function whatUses(topic: string) {
  return usedIn((await learnerModel()).model, topic)
}

export async function transferGapList(limit = 10): Promise<ModelNode[]> {
  return transferGaps((await learnerModel()).model, limit)
}

export async function recent(o: { node?: string; limit?: number; since?: number } = {}): Promise<LearningEvent[]> {
  const { model, events } = await learnerModel()
  return recentEvents(model, events, o)
}

/** A few lines for a prompt: each goal's standing, what fades, the transfer gaps, the skills */
export async function learnerDigest(goal?: string): Promise<string> {
  return modelDigest((await learnerModel()).model, { goal })
}

/**
 * How deep something should go. North Star (and you) set these; a goal's default (apply) stands
 * where nothing is set. Node is a concept id or name, or a skill id ("skill:proof" or "proof").
 */
export function setTarget(node: string, depth: Depth | null, o: { goal?: string; by?: string } = {}): number {
  return setTargets([{ node: normaliseNode(node), depth, ...(o.goal ? { goal: o.goal } : {}), by: o.by ?? 'you' }])
}

export function setTargetsFrom(by: string, list: { node: string; depth: Depth | null; goal?: string }[]): number {
  return setTargets(list.map((t) => ({ ...t, node: normaliseNode(t.node), by })))
}

/** Goals from elsewhere (North Star): replaces that source's goals */
export const registerGoals = (source: string, goals: Omit<ModelGoal, 'source'>[]) => setGoals(source, goals)

/** Links from elsewhere (North Star, you): "used in" between concepts, or a concept exercising a skill */
export const addLinks = (list: { from: string; to: string; kind: 'used_in' | 'exercises'; origin?: ModelEdge['origin'] }[]) => saveLinks(list.map((l) => ({ from: l.from, to: l.kind === 'exercises' ? normaliseNode(l.to) : l.to, kind: l.kind, origin: l.origin ?? 'northstar' })))

const normaliseNode = (node: string) => {
  const n = String(node ?? '').trim()
  if (n.startsWith('skill:')) return n
  const s = SKILLS.find((x) => x.id === n.toLowerCase() || x.name.toLowerCase() === n.toLowerCase())
  return s ? skillId(s.id) : n
}

/**
 * You correct a judgement: "I actually know this" (or "I don't, really"). Kept as an event, so the
 * depth is what you said until evidence after it moves it on, and the evidence before stays visible.
 */
export async function correctJudgement(nodeId: string, depth: Depth, note?: string): Promise<ModelNodeDetail | null> {
  const { model } = await learnerModel()
  const node = model.nodes.get(nodeId) ?? model.resolve(nodeId)
  if (!node || (node.kind !== 'concept' && node.kind !== 'skill')) return null
  const at = Date.now()
  learningEvent({
    key: `you:${node.id}#${at}`,
    at,
    kind: 'corrected',
    source: 'you',
    ...(node.kind === 'concept' ? { concepts: [node.id] } : {}),
    level: depth,
    note: note?.trim() || (depth > (node.depth ?? 0) ? 'I actually know this' : 'I don’t know this as well as that'),
    data: { node: node.id, depth, was: node.depth ?? 0 }
  })
  return nodeDetail(node.id, true)
}

/** A learning act from the window (an explorable's "Tell the tutor", a correction) */
export function eventFromWindow(e: EventIn): void {
  const allowed = new Set(['explained', 'studied', 'read', 'skipped', 'moved_on', 'answered', 'transfer'])
  if (!e || !allowed.has(e.kind)) return
  learningEvent({ ...e, source: String(e.source || 'window').slice(0, 40) })
}

// ---------- For the page ----------

const nodeView = (n: ModelNode): ModelNodeView => ({
  id: n.id,
  name: n.name,
  ...(n.area ? { area: n.area } : {}),
  depth: n.depth ?? 0,
  ...(n.target !== undefined ? { target: n.target } : {}),
  ...(n.retention !== undefined ? { retention: n.retention } : {}),
  ...(n.status ? { status: n.status } : {}),
  ...(n.corrected ? { corrected: true } : {}),
  events: n.measures?.events ?? 0
})

export async function modelView(fresh = false): Promise<ModelView> {
  const { model, events } = await learnerModel(fresh)
  const all = [...model.nodes.values()]
  const concepts = all.filter((n) => n.kind === 'concept')
  const studied = concepts.filter((n) => (n.measures?.events ?? 0) > 0 || n.corrected)
  const goals = all
    .filter((n) => n.kind === 'goal')
    .map((g) => {
      const serving = model.edges.filter((e) => e.kind === 'serves' && e.to === g.id).map((e) => model.nodes.get(e.from)!).filter((n) => n?.kind === 'concept')
      // What you've begun, furthest below target first; then what's next, in the roadmap's order
      const begun = (n: ModelNode) => (n.measures?.events ?? 0) > 0 || !!n.corrected
      const gap = (n: ModelNode) => (n.target ?? 3) - (n.depth ?? 0)
      const rows = serving.sort((a, b) => Number(begun(b)) - Number(begun(a)) || (begun(a) ? (b.depth ?? 0) - (a.depth ?? 0) || (b.measures?.events ?? 0) - (a.measures?.events ?? 0) || gap(b) - gap(a) : (a.order ?? 1e9) - (b.order ?? 1e9)) || a.name.localeCompare(b.name))
      return { id: g.id, name: g.name, ...(g.date ? { date: g.date } : {}), ...(g.weight ? { weight: g.weight } : {}), total: rows.length, atTarget: rows.filter((n) => (n.depth ?? 0) >= (n.target ?? 3)).length, begun: rows.filter(begun).length, concepts: rows.map(nodeView) }
    })
    .filter((g) => g.total)
  const inGoal = new Set(model.edges.filter((e) => e.kind === 'serves').map((e) => e.from))
  return {
    at: model.at,
    events: events.length,
    loose: model.loose,
    counts: depthCounts(studied),
    goals,
    other: studied.filter((n) => !inGoal.has(n.id)).sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0) || (b.measures?.events ?? 0) - (a.measures?.events ?? 0)).map(nodeView),
    skills: all.filter((n) => n.kind === 'skill').map(nodeView),
    fading: fading(model, 6).map(nodeView),
    gaps: transferGaps(model, 6).map(nodeView)
  }
}

export async function nodeDetail(id: string, fresh = false): Promise<ModelNodeDetail | null> {
  const { model } = await learnerModel(fresh)
  const s = standing(model, id, 400)
  if (!s) return null
  const n = s.node
  const counts = (e: LearningEvent) => e.outcome !== undefined || e.quality !== undefined || !!e.tests || e.kind === 'corrected'
  const counted = s.recent.filter(counts).slice(0, 10)
  const rest = s.recent.filter((e) => !counts(e))
  return {
    node: nodeView(n),
    kind: n.kind,
    ...(n.corrected ? { corrected: n.corrected } : {}),
    ...(n.targetBy ? { targetBy: n.targetBy } : {}),
    ...(n.targetGoal ? { targetGoal: model.nodes.get(`goal:${n.targetGoal}`)?.name ?? n.targetGoal } : {}),
    measures: measuresLine(n).replace(/^./, (c) => c.toUpperCase()),
    levels: s.levels.map((l) => ({ level: l.level, label: DEPTH_LABEL[l.level], reached: l.reached, credit: l.credit, tried: l.tried, recent: l.recent, needs: l.needs })),
    // What counts first (marked answers, builds, explanations, your corrections), then a little of the rest
    recent: [...counted, ...rest.slice(0, Math.max(2, 10 - counted.length))].sort((a, b) => b.at - a.at).map((e) => ({ key: e.key, at: e.at, kind: e.kind, source: e.source, line: eventLine(e) })),
    needs: s.needs.map(nodeView),
    usedIn: s.usedIn.map(nodeView),
    serves: s.serves.map((g) => ({ id: g.id, name: g.name }))
  }
}

// ---------- Claude's links, in the background ----------

const LINKS_EVERY_MS = 6 * 3_600_000
const ASKED = 'links.asked'
const LINKS_AT = 'links.at'
export const LINKS_SYSTEM =
  'You map how ideas a learner studies connect. Given concept names, say which are used in which (an application link: probability is used in value at risk, logistic regression and Bayesian inference) and which thinking skills each exercises. Only use names from the lists given. Reply with JSON only: {"used_in": [["from", "to"], ...], "skills": {"concept": ["skill-id", ...]}}.'

export function linksPrompt(ask: string[], others: string[]): string {
  return [
    `Concepts to link (up to 4 "used in" links each, both ways, where a real application exists; none is fine):\n${ask.map((n) => `- ${n}`).join('\n')}`,
    others.length ? `Other concepts on the map they may be used in:\n${others.map((n) => `- ${n}`).join('\n')}` : '',
    `Skill ids: ${SKILLS.map((s) => `${s.id} (${s.name})`).join(', ')}. Tag a concept only with skills it clearly exercises.`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The reply as links between nodes on the map; anything not on it is dropped */
export function parseLinks(text: string, model: LearnerModel): ModelEdge[] {
  let j: { used_in?: unknown; skills?: unknown }
  try {
    j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '')
  } catch {
    return []
  }
  const out: ModelEdge[] = []
  const id = (name: unknown) => (typeof name === 'string' ? model.resolve(name) : null)
  for (const pair of Array.isArray(j.used_in) ? j.used_in.slice(0, 200) : []) {
    if (!Array.isArray(pair)) continue
    const a = id(pair[0])
    const b = id(pair[1])
    if (a?.kind === 'concept' && b?.kind === 'concept' && a.id !== b.id) out.push({ from: a.id, to: b.id, kind: 'used_in', origin: 'claude' })
  }
  if (j.skills && typeof j.skills === 'object')
    for (const [name, list] of Object.entries(j.skills as Record<string, unknown>)) {
      const c = id(name)
      if (c?.kind !== 'concept' || !Array.isArray(list)) continue
      for (const s of list) if (SKILLS.some((x) => x.id === s)) out.push({ from: c.id, to: skillId(String(s)), kind: 'exercises', origin: 'claude' })
    }
  return out
}

/** The concepts worth asking about: studied, or serving a goal, with no links of Claude's yet and not asked before */
export function linkCandidates(model: LearnerModel, asked: Set<string>, limit = 40): ModelNode[] {
  const fromClaude = new Set(model.edges.filter((e) => e.origin === 'claude').flatMap((e) => [e.from, e.to]))
  const serving = new Set(model.edges.filter((e) => e.kind === 'serves').map((e) => e.from))
  return [...model.nodes.values()]
    .filter((n) => n.kind === 'concept' && !asked.has(n.id) && !fromClaude.has(n.id) && ((n.measures?.events ?? 0) > 0 || serving.has(n.id)))
    .sort((a, b) => (b.measures?.events ?? 0) - (a.measures?.events ?? 0))
    .slice(0, limit)
}

let asker: ((prompt: string, system: string) => Promise<string | null>) | null = null
/** For the tests: who answers instead of Haiku */
export const setLinkAsker = (fn: typeof asker) => (asker = fn)

async function askHaiku(prompt: string, system: string): Promise<string | null> {
  if (asker) return asker(prompt, system)
  const { jobRoute, completeFor } = await import('./ai')
  // Claude only: Gemma is never loaded for this, and without Claude the heuristics stand
  if ((await jobRoute('modelLinks')).who !== 'claude') return null
  return completeFor('modelLinks', prompt, system, { priority: 'background', noFallback: true }).catch(() => null)
}

let linking = false
export async function proposeLinks(model: LearnerModel, force = false): Promise<number> {
  if (linking) return 0
  if (!force && Date.now() - Number(getMeta(LINKS_AT) ?? 0) < LINKS_EVERY_MS) return 0
  const asked = new Set<string>(JSON.parse(getMeta(ASKED) ?? '[]') as string[])
  const ask = linkCandidates(model, asked)
  if (!ask.length) return 0
  linking = true
  try {
    setMeta(LINKS_AT, String(Date.now()))
    const areas = new Set(ask.map((n) => n.area))
    const others = [...model.nodes.values()].filter((n) => n.kind === 'concept' && !ask.includes(n) && areas.has(n.area)).slice(0, 150).map((n) => n.name)
    const text = await askHaiku(linksPrompt(ask.map((n) => n.name), others), LINKS_SYSTEM)
    if (text === null) return 0
    const links = parseLinks(text, model)
    saveLinks(links)
    for (const n of ask) asked.add(n.id)
    setMeta(ASKED, JSON.stringify([...asked].slice(-5000)))
    return links.length
  } finally {
    linking = false
  }
}

// ---------- Tools for Claude ----------

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })
const pctOf = (x?: number) => (x === undefined ? '' : ` ${Math.round(x * 100)}%`)
const listLine = (n: ModelNode) => `- ${n.name}${n.area ? ` (${n.area})` : ''}: depth ${n.depth ?? 0}${n.target !== undefined ? `/${n.target}` : ''}${n.retention !== undefined ? `, retention${pctOf(n.retention)}` : ''}`

/** The full model for the coach and planning sessions */
export const MODEL_TOOLS: McpTool[] = [
  {
    name: 'learner_model',
    description:
      "Tide's model of the learner: depth on each concept and skill (1 recall, 2 explain, 3 apply, 4 transfer, 5 build or teach, 6 research) from their real learning events, against targets from their goals. ask: standing (on a topic, skill or goal, with evidence), fading, weakest (for a goal), used_in (what a topic is used in), transfer_gaps, recent (events), digest (one paragraph per goal).",
    inputSchema: obj(
      {
        ask: { type: 'string', enum: ['standing', 'fading', 'weakest', 'used_in', 'transfer_gaps', 'recent', 'digest'] },
        topic: { type: 'string', description: 'standing, used_in, recent: a concept, skill or goal' },
        goal: { type: 'string', description: 'weakest, digest: a goal by name' },
        limit: { type: 'number' }
      },
      ['ask']
    ),
    async run(args, ctx) {
      const ask = String(args.ask ?? '')
      const topic = String(args.topic ?? '').trim()
      const goal = String(args.goal ?? '').trim()
      const limit = Math.max(1, Math.min(30, Number(args.limit) || 8))
      const id = ctx.step({ kind: 'read_note', label: 'Looking at Tide’s model of you', status: 'running', depth: 0 })
      const { model, events } = await learnerModel()
      let out: string
      switch (ask) {
        case 'standing': {
          const s = topic ? standing(model, topic) : null
          out = s ? standingText(s) : topic ? `Nothing on the map called “${topic}”.` : 'Give a topic.'
          break
        }
        case 'fading': {
          const f = fading(model, limit)
          out = f.length ? f.map(listLine).join('\n') : 'Nothing studied is fading.'
          break
        }
        case 'weakest': {
          const w = goal ? weakestFor(model, goal, limit) : null
          out = !goal ? 'Give a goal.' : !w ? `No goal called “${goal}”. Goals: ${[...model.nodes.values()].filter((n) => n.kind === 'goal').map((n) => n.name).join('; ') || 'none'}.` : w.weakest.length ? `${w.goal.name}:\n${w.weakest.map(listLine).join('\n')}` : `${w.goal.name}: every concept is at its target.`
          break
        }
        case 'used_in': {
          const u = topic ? usedIn(model, topic) : null
          out = !u ? `Nothing on the map called “${topic}”.` : `${u.node.name} is used in: ${u.usedIn.map((n) => n.name).join(', ') || 'nothing linked yet'}.${u.uses.length ? ` It uses: ${u.uses.map((n) => n.name).join(', ')}.` : ''}`
          break
        }
        case 'transfer_gaps': {
          const t = transferGaps(model, limit)
          out = t.length ? `Applied, not yet shown on unseen problems:\n${t.map(listLine).join('\n')}` : 'No transfer gaps: nothing sits at apply without unseen problems tried.'
          break
        }
        case 'recent': {
          const r = recentEvents(model, events, { node: topic || undefined, limit })
          out = r.length ? r.map((e) => `- ${eventLine(e)}`).join('\n') : 'No learning events yet.'
          break
        }
        case 'digest':
          out = modelDigest(model, { goal: goal || undefined }) || 'Not enough evidence yet for a picture.'
          break
        default:
          out = 'ask is one of standing, fading, weakest, used_in, transfer_gaps, recent, digest.'
      }
      ctx.updateStep(id, { status: 'done' })
      return out
    }
  }
]

/** The compact form for a lesson's tutor: one topic's standing */
export const STANDING_TOOL: McpTool = {
  name: 'learner_standing',
  description: "How deep the learner's grasp of a topic is (recall, explain, apply, transfer, build), from their real answers, with what it builds on that is weak and what it is used in. Use it before deciding how hard to pitch a step.",
  inputSchema: obj({ topic: { type: 'string' } }, ['topic']),
  async run(args, ctx) {
    const topic = String(args.topic ?? '').trim()
    if (!topic) return 'Give a topic.'
    const id = ctx.step({ kind: 'read_note', label: `Looking at where you stand on ${topic}`, status: 'running', depth: 0 })
    const text = await whereIStand(topic, true)
    ctx.updateStep(id, { status: 'done' })
    return text
  }
}

export const LEARNER_MODEL_TOOLS: McpTool[] = [...MODEL_TOOLS, STANDING_TOOL]

/** For the tests */
export const _resetModel = () => {
  cached = null
  building = null
}
export { findGoal }
