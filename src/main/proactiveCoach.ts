/**
 * The proactive coach (shared/proactiveCoach has the rules): it runs on its own schedule in the
 * background and acts on the learner model before you ask, toward your North Star.
 *
 * - Daily (the first open after 5 am, or the hourly look): today's plan checked against the model
 *   (fading concepts, transfer gaps, key topics below depth, misconceptions that keep coming back,
 *   tiredness piling up, your best hours). It writes a few lines on today and may schedule up to
 *   two interventions into the plan, each with its reason in Then today.
 * - Weekly: what it noticed in the week's evidence, what it changed, a small tilt of the stage's
 *   track weights, North Star proposals through the usual review flow, and its beliefs about you.
 * - Monthly: a strategy check against North Star (pace against the estimate, depth, the stage
 *   order) and an honest progress report, with external ratings once Sharpness has them.
 *
 * Claude (Opus, at the depth each run needs) reads the model through Tide's MCP tools (the coach
 * packs) rather than being handed it all; near the plan's limits a cheaper model or none, and
 * without Claude the daily look is Tide's own rules and the reviews are written from the numbers.
 * Everything goes into Coach/Coach log.md (newest first) and Coach/What the coach believes about
 * me.md, which you can edit: your version is read back as true.
 */
import { promises as fs } from 'fs'
import { localDate, type WeekPlan } from '@shared/coach'
import type { ClaudeUsage } from './claudeCli'
import {
  addDaysIso,
  applyInterventions,
  BELIEFS_NOTE,
  beliefsMarkdown,
  screenInterventions,
  checkTilt,
  costWords,
  dayFatigue,
  dueRuns,
  emptyBeliefs,
  gateRun,
  heuristicInterventions,
  INTERVENTION_WORD,
  latestEntry,
  linesOf,
  LOG_NOTE,
  mergeBeliefs,
  parseBeliefJson,
  prependLog,
  readEdits,
  type BeliefMemory,
  type Candidate,
  type DayLoad,
  type Dropped,
  type Gate,
  type Intervention,
  type InterventionLog,
  type LogEntry,
  type CoachView,
  type RunKind,
  type RunRecord,
  type RunState,
  type Signals,
  type Tilt
} from '@shared/proactiveCoach'
import type { JobName } from '@shared/gemmaPolicy'
import { absPath, readText, writeText } from './vault'

const STATE = '.tide/coach/proactive.json'
const DAY = 86_400_000


export interface CoachState extends RunState {
  tilt?: { stage: number; tilt: Tilt; at: number }
  interventions: InterventionLog[]
  beliefs: BeliefMemory
  runs: RunRecord[]
}

const EMPTY: CoachState = { interventions: [], beliefs: {}, runs: [] }

export async function loadState(): Promise<CoachState> {
  try {
    const raw = JSON.parse(await readText(STATE)) as Partial<CoachState>
    return { ...EMPTY, ...raw, interventions: raw.interventions ?? [], beliefs: raw.beliefs ?? {}, runs: raw.runs ?? [] }
  } catch {
    return { ...EMPTY }
  }
}

let queue: Promise<unknown> = Promise.resolve()
function updateState(fn: (s: CoachState) => CoachState): Promise<CoachState> {
  const run = queue.then(async () => {
    const next = fn(await loadState())
    await fs.mkdir(absPath('.tide/coach'), { recursive: true })
    await writeText(STATE, JSON.stringify(next, null, 1))
    return next
  })
  queue = run.catch(() => {})
  return run
}

/** The coach's tilt of the current stage's weights (main/northStar schedulerGoal reads it) */
export async function coachTilt(stage: number): Promise<Tilt> {
  const s = await loadState()
  return s.tilt && s.tilt.stage === stage ? s.tilt.tilt : {}
}

// ---------- Asking ----------

export interface AskResult {
  text: string
  by: 'claude' | 'gemma'
  model?: string
  usage?: ClaudeUsage
  ms: number
  tools?: string[]
}

/** How the coach asks a model: Claude with Tide's tools, else (reviews only) Gemma with the facts */
export type CoachAsker = (job: JobName, prompt: string, system: string, gate: Gate) => Promise<AskResult | null>

const realAsk: CoachAsker = async (job, prompt, system, gate) => {
  const { withUsage } = await import('./usageLog')
  if (gate.run === 'claude') {
    const { claudeWithTools } = await import('./claudeEngine')
    const { packsHeader, toolPacks } = await import('@shared/tutorGuide')
    try {
      const r = await withUsage({ job, title: 'Coach' }, () =>
        claudeWithTools(prompt, system, { role: gate.role, effort: gate.effort, maxTurns: gate.maxTurns, packs: packsHeader(toolPacks({ kind: 'coach' })), key: `coach:${job}`, signal: AbortSignal.timeout(job === 'coachDaily' ? 4 * 60_000 : 12 * 60_000) })
      )
      return { text: r.text, by: 'claude', model: r.model, usage: r.usage, ms: r.ms, tools: r.tools }
    } catch (e) {
      console.warn(`[coach] ${job}: ${(e as Error).message}`)
      if (job === 'coachDaily') return null
    }
  }
  // The reviews without Claude: Gemma, if it's set up, from the facts alone (no tools); the daily look never loads it
  if (job === 'coachDaily') return null
  const { jobRoute, completeFor } = await import('./ai')
  const route = await jobRoute(job).catch(() => null)
  if (route?.who !== 'gemma') return null
  const t0 = Date.now()
  const text = await completeFor(job, prompt, system, { priority: 'background', timeoutMs: 5 * 60_000 }).catch(() => null)
  return text ? { text, by: 'gemma', ms: Date.now() - t0 } : null
}
let ask: CoachAsker = realAsk
export const setCoachAsker = (fn: CoachAsker | null) => (ask = fn ?? realAsk)

/** The plan's usage, for the gate: Claude's state and the windows as last reported (Settings › Usage) */
async function usageFacts() {
  const now = Date.now()
  const { claudeReady, claudeStatus } = await import('./claudeEngine')
  const { readUsageLines } = await import('./usageLog')
  const { windowViews } = await import('@shared/usage')
  const ready = await claudeReady().catch(() => ({ ready: false }))
  const st = await claudeStatus().catch(() => null)
  const teaches = await import('./claudeEngine').then((m) => m.claudeTeaches()).catch(() => false)
  const views = windowViews(readUsageLines(now - 9 * DAY), now)
  return { ready: ready.ready && teaches, ...(st?.limitedUntil ? { limitedUntil: st.limitedUntil } : {}), windows: views.map((v) => ({ window: v.window, utilization: v.utilization, projected: v.projected, stale: v.stale })), now }
}
let usageOf: () => Promise<Parameters<typeof gateRun>[1]> = usageFacts
export const setCoachUsage = (fn: (() => Promise<Parameters<typeof gateRun>[1]>) | null) => (usageOf = fn ?? usageFacts)

// ---------- What the coach sees ----------

const cand = (n: { id: string; name: string; area?: string; depth?: number; target?: number; retention?: number }): Candidate => ({
  id: n.id,
  name: n.name,
  ...(n.area ? { area: n.area } : {}),
  ...(n.depth !== undefined ? { depth: n.depth } : {}),
  ...(n.target !== undefined ? { target: n.target } : {}),
  ...(n.retention !== undefined ? { retention: Math.round(n.retention * 100) / 100 } : {})
})

/** Days of study, answers and late nights, oldest first, for tiredness across days */
async function dayLoads(date: string, n = 10): Promise<DayLoad[]> {
  const { focusLog } = await import('./learn')
  const { readEvents } = await import('./learningLog')
  const since = Date.parse(addDaysIso(date, -(n - 1)) + 'T00:00:00')
  const log = await focusLog(since).catch(() => [])
  const events = readEvents({ since, kinds: ['answered', 'transfer', 'recalled'] })
  const days: DayLoad[] = Array.from({ length: n }, (_, i) => ({ date: addDaysIso(date, -(n - 1) + i), minutes: 0, answers: 0, right: 0, hinted: 0, late: 0 }))
  const at = (ms: number) => days.find((d) => d.date === localDate(new Date(ms)))
  for (const e of log) {
    const d = at(e.start)
    if (!d) continue
    d.minutes += e.minutes
    const h = new Date(e.start).getHours()
    if (h >= 23 || h < 4) d.late += e.minutes
  }
  for (const e of events) {
    const d = at(e.at)
    if (!d || !e.outcome) continue
    d.answers++
    if (e.outcome === 'correct') d.right++
    if ((e.hints ?? 0) > 0) d.hinted++
  }
  for (const d of days) d.minutes = Math.round(d.minutes)
  return days
}

/** Misconceptions seen at least twice in three weeks and not resolved since */
async function recurring(model: import('@shared/learnerModel').LearnerModel): Promise<Candidate[]> {
  const { readEvents } = await import('./learningLog')
  const since = Date.now() - 21 * DAY
  const ev = readEvents({ since, kinds: ['misconception_seen', 'misconception_resolved'] })
  const by = new Map<string, { seen: number; last: number; resolved: number; note: string; name: string }>()
  for (const e of ev) {
    const node = (e.concepts[0] ? model.nodes.get(e.concepts[0]) : null) ?? (e.topic ? model.resolve(e.topic) : null)
    const id = node?.id ?? (e.topic ? `topic:${e.topic.toLowerCase()}` : '')
    if (!id) continue
    const r = by.get(id) ?? { seen: 0, last: 0, resolved: 0, note: '', name: node?.name ?? e.topic ?? id }
    if (e.kind === 'misconception_seen') {
      r.seen++
      if (e.at >= r.last) (r.last = e.at), (r.note = e.note ?? r.note)
    } else r.resolved = Math.max(r.resolved, e.at)
    by.set(id, r)
  }
  return [...by]
    .filter(([, r]) => r.seen >= 2 && r.resolved < r.last)
    .sort((a, b) => b[1].seen - a[1].seen || b[1].last - a[1].last)
    .slice(0, 5)
    .map(([id, r]) => ({ id, name: r.name, text: r.note.slice(0, 160), seen: r.seen, ...(model.nodes.get(id)?.area ? { area: model.nodes.get(id)!.area } : {}) }))
}

/** Everything the daily look needs, from the model, the plan and the logs (no model calls) */
export async function signals(date = localDate()): Promise<Signals & { plan: WeekPlan | null; rhythm?: string }> {
  const { getWeek, getCoach } = await import('./coach')
  const { studyDays } = await import('./goals')
  const { learnerModel } = await import('./learnerModel')
  const { fading, transferGaps } = await import('@shared/learnerModel')
  const plan = await getWeek(date).catch(() => null)
  const coach = await getCoach().catch(() => null)
  const dayMinutes = (coach ? studyDays(date, coach, 1).find((d) => d.date === date)?.minutes : undefined) ?? 60
  const items = plan?.days.find((d) => d.date === date)?.items ?? []
  const { model } = await learnerModel()
  const begun = (n: import('@shared/learnerModel').ModelNode) => (n.measures?.events ?? 0) > 0 || !!n.corrected
  const below = [...model.nodes.values()]
    .filter((n) => n.kind === 'concept' && n.targetBy === 'northstar' && n.target !== undefined && (n.depth ?? 0) < n.target && begun(n))
    .sort((a, b) => (b.target ?? 0) - (b.depth ?? 0) - ((a.target ?? 0) - (a.depth ?? 0)) || (a.order ?? 1e9) - (b.order ?? 1e9))
    .slice(0, 6)
  const carried = (plan?.days ?? []).filter((d) => d.date >= addDaysIso(date, -3) && d.date <= date).flatMap((d) => d.items).filter((it) => it.carried && !it.done).length
  const glance = await import('./northStar').then((m) => m.glance()).catch(() => null)
  const rhythm = await import('./learnerProfile').then((m) => m.rhythmNow()).catch(() => undefined)
  return {
    date,
    dayMinutes,
    // An earlier look's unstarted interventions are replaced by this one: not counted as planned
    planned: items.filter((it) => !it.coach || it.done).map((it) => ({ title: it.title, kind: it.kind, minutes: it.minutes, ...(it.topic ? { topic: it.topic } : {}), ...(it.done ? { done: true } : {}), ...(it.coach ? { coach: true } : {}) })),
    fading: fading(model, 6).map(cand),
    transferGaps: transferGaps(model, 6).map(cand),
    belowDepth: below.map((n) => ({ ...cand(n), key: 'North Star' })),
    misconceptions: await recurring(model).catch(() => []),
    fatigue: dayFatigue(await dayLoads(date).catch(() => []), { carried }),
    ...(glance ? { stage: { n: glance.stage, title: glance.title, step: glance.step, tracks: glance.tracks } } : {}),
    plan,
    ...(rhythm && (rhythm.learnedFrom ?? 0) >= 4 && rhythm.goodHours?.length ? { rhythm: `best hours ${rhythm.goodHours.join(', ')}:00` } : {})
  }
}

const candLine = (c: Candidate) =>
  `- ${c.id} | ${c.name}${c.area ? ` (${c.area})` : ''}${c.depth !== undefined ? ` | depth ${c.depth}${c.target !== undefined ? `/${c.target}` : ''}` : ''}${c.retention !== undefined ? ` | retention ${Math.round(c.retention * 100)}%` : ''}${c.seen ? ` | seen ${c.seen}×: ${c.text}` : ''}`

function signalsText(s: Signals & { rhythm?: string }): string {
  const list = (title: string, xs: Candidate[]) => `${title}:\n${xs.length ? xs.map(candLine).join('\n') : '- none'}`
  return [
    `Today is ${s.date}. Study time today: about ${s.dayMinutes} min.${s.rhythm ? ` Rhythm: ${s.rhythm}.` : ''}`,
    s.stage ? `North Star: stage ${s.stage.n} (${s.stage.title}), step ${s.stage.step}; tracks ${s.stage.tracks.map((t) => `${t.track} ${t.weight}%`).join(', ')}.` : 'No North Star yet.',
    `Planned today:\n${s.planned.length ? s.planned.map((p) => `- ${p.title} (${p.kind}, ${p.minutes} min${p.done ? ', done' : ''}${p.coach ? ', set by you yesterday' : ''})`).join('\n') : '- nothing'}`,
    list('Fading (id | name | depth/target | retention)', s.fading),
    list('Transfer gaps: applied, not yet shown on unseen problems', s.transferGaps),
    list('Key topics of the North Star below their depth (begun)', s.belowDepth),
    list('Misconceptions that keep coming back', s.misconceptions),
    `Tiredness across days: ${s.fatigue.score}${s.fatigue.reasons.length ? ` (${s.fatigue.reasons.join('; ')})` : ' (nothing piling up)'}. A lighter day is allowed only at 0.5 or more.`
  ].join('\n\n')
}

// ---------- Prompts ----------

export const COACH_SYSTEM = `You are the learner's coach inside Tide, their study app. Their goal: a cracked ML engineer with deep infrastructure and backend knowledge, working across quantitative finance and blockchain, at research depth; learning fast and deep without wasting years. Claude authors; they audit.
You act on Tide's model of them (learner_model tool: standing, fading, weakest, used_in, transfer_gaps, recent, digest) and their notes. Be exact and plain: no greetings, no analogies, no praise, no filler. Every claim names its evidence (a number from the model, a concept, an event). Learning comes first: depth and transfer over coverage. You answer with one JSON object only, no prose around it.`

async function goalLine(): Promise<string> {
  const g = await import('./northStar').then((m) => m.goalNote()).catch(() => '')
  return g ? `Their own goal note (authoritative):\n${g.slice(0, 1800)}` : ''
}

async function beliefsText(): Promise<{ text: string; edited: boolean }> {
  const text = await readText(BELIEFS_NOTE).catch(() => '')
  const st = await loadState()
  return { text, edited: readEdits(text, st.beliefs).edited }
}

function dailyPrompt(facts: string, beliefs: { text: string; edited: boolean }): string {
  return `${facts}

${beliefs.text ? `What you believe about them (their edits are authoritative${beliefs.edited ? '; they edited it since you last wrote it' : ''}):\n${beliefs.text.slice(0, 2500)}\n` : ''}
Review today's plan against the model. Use learner_model at most twice, only if a candidate needs checking (standing on one topic, or recent).
Then decide at most two interventions for today, only where the evidence is clear, chosen from the candidates above by their id:
- "firm-up": a short recall for a fading concept
- "transfer": an unseen problem for a transfer gap
- "deeper": a lesson taking a key topic deeper
- "post-mortem": a drill on a misconception that keeps coming back
- "lighter": a lighter day, only when tiredness is 0.5 or more (moves today's heavy sessions on)
Nothing is also a valid answer. Each reason is one line under 120 characters, naming the evidence. Never say a planned lesson will cover something it wasn't planned to: if it's worth doing today, schedule it.

Answer with JSON only:
{"today": ["first: a headline for the day, under 70 characters", "then at most 3 lines, each under 90 characters: why today is shaped this way, and what you chose not to add. Don't say what you added: Tide lists each intervention its checks accept"], "interventions": [{"kind": "firm-up", "id": "<candidate id, exactly as listed>", "minutes": 10, "reason": "…"}]}`
}

// ---------- Writing ----------

async function writeLog(e: LogEntry): Promise<void> {
  const md = await readText(LOG_NOTE).catch(() => '')
  await fs.mkdir(absPath('Coach'), { recursive: true })
  await writeText(LOG_NOTE, prependLog(md, e))
}

async function profileLines(): Promise<string[]> {
  const { parseProfile } = await import('@shared/learnerProfile')
  const { LEARNER_NOTE } = await import('./learnerProfile')
  const p = parseProfile(await readText(LEARNER_NOTE).catch(() => ''))
  return Object.values(p.sections).flat().map((x) => x.text)
}

/** The belief note rewritten: your lines kept as you left them, the coach's new ones beside them */
async function writeBeliefs(raw: unknown, date: string): Promise<{ added: number; kept: number }> {
  const proposed = parseBeliefJson(raw)
  if (!Object.values(proposed).some((x) => x.length)) return { added: 0, kept: 0 }
  const current = await readText(BELIEFS_NOTE).catch(() => '')
  const st = await loadState()
  const { beliefs, memory } = mergeBeliefs(current, proposed, st.beliefs, await profileLines().catch(() => []))
  const md = beliefsMarkdown(beliefs, date)
  await fs.mkdir(absPath('Coach'), { recursive: true })
  await writeText(BELIEFS_NOTE, md)
  await updateState((s) => ({ ...s, beliefs: { ...memory, written: md } }))
  const kept = memory.own?.length ?? 0
  return { added: Object.values(beliefs).flat().length - kept, kept }
}

const modelWord = (m?: string) => (!m ? '' : /opus/i.test(m) ? 'Opus' : /sonnet/i.test(m) ? 'Sonnet' : /haiku/i.test(m) ? 'Haiku' : /fable/i.test(m) ? 'Fable' : m)
const tokensOf = (u?: ClaudeUsage) => (u ? u.input + u.output + u.cacheRead + u.cacheWrite : undefined)

function byLine(r: AskResult | null, gate: Gate): string {
  if (!r) return gate.run === 'claude' ? 'Tide’s own rules (Claude didn’t answer)' : `Tide’s own rules (${gate.why})`
  if (r.by === 'gemma') return 'Gemma'
  return [modelWord(r.model), gate.run === 'claude' && gate.why ? gate.why.replace(/^Near your plan’s limit: \w+$/, 'near the limit') : ''].filter(Boolean).join(', ')
}

async function record(kind: RunKind, date: string, r: AskResult | null, gate: Gate, interventions = 0): Promise<RunRecord> {
  const rec: RunRecord = {
    kind,
    at: Date.now(),
    date,
    by: r?.by ?? 'tide',
    ms: r?.ms ?? 0,
    ...(r?.model ? { model: r.model } : {}),
    ...(r?.usage ? { usd: Math.round(r.usage.costUsd * 10_000) / 10_000, tokens: tokensOf(r.usage) } : {}),
    ...(r?.tools?.length ? { tools: r.tools } : {}),
    ...(gate.run !== 'claude' ? { why: gate.why } : gate.why ? { why: gate.why } : {}),
    interventions
  }
  await updateState((s) => ({ ...s, [kind]: { date, at: rec.at }, heldUntil: { ...s.heldUntil, [kind]: 0 }, firstAt: s.firstAt ?? rec.at, runs: [...s.runs, rec].slice(-120) }))
  return rec
}

async function parseJson(text: string): Promise<Record<string, unknown> | null> {
  const { extractJsonObject } = await import('./ai')
  try {
    const j = extractJsonObject<Record<string, unknown>>(text)
    return j && typeof j === 'object' ? j : null
  } catch {
    return null
  }
}

// ---------- The runs ----------

export interface RunOutcome {
  kind: RunKind
  ran: boolean
  why?: string
  lines: string[]
  interventions?: Intervention[]
  /** Proposals the checks turned down, and why */
  dropped?: Dropped[]
  record?: RunRecord
}

/** The daily look: today's plan against the model, a few lines, and at most two interventions */
export async function runDaily(date = localDate()): Promise<RunOutcome> {
  const s = await signals(date)
  const st = await loadState()
  const gate = gateRun('daily', await usageOf())
  let r: AskResult | null = null
  let json: Record<string, unknown> | null = null
  if (gate.run === 'claude') {
    r = await ask('coachDaily', [await goalLine(), dailyPrompt(signalsText(s), await beliefsText())].filter(Boolean).join('\n\n'), COACH_SYSTEM, gate)
    json = r ? await parseJson(r.text) : null
  }
  const fromModel = !!json
  const screened = fromModel ? screenInterventions(json!.interventions, s, st.interventions) : { kept: heuristicInterventions(s, st.interventions), dropped: [] }
  const ivs = screened.kept
  // What was added is said by code from what was really scheduled: a model's own "added …" line is left out
  let lines = fromModel ? linesOf(json!.today, 4, 160).filter((l) => !/^(added|scheduled|i added|i scheduled)\b/i.test(l)) : []
  if (!lines.length) lines = heuristicToday(s, ivs)
  // What was added, said in the log whatever wrote the lines
  const added = ivs.map((iv) => `${INTERVENTION_WORD[iv.kind]}${iv.topic ? `: ${iv.topic}` : ''} (${iv.minutes} min). ${iv.reason}`)
  if (s.plan || ivs.length) await scheduleInterventions(date, ivs).catch((e) => console.warn(`[coach] scheduling: ${(e as Error).message}`))
  // A Claude answer that couldn't be read still cost something: it is recorded, and the rules wrote the day
  const rec = await record('daily', date, r, gate, ivs.length)
  const turnedDown = screened.dropped.map((d) => `Not scheduled: ${INTERVENTION_WORD[d.kind as keyof typeof INTERVENTION_WORD] ?? d.kind}${d.topic ? ` (${d.topic})` : ''}: ${d.why}.`)
  await writeLog({ kind: 'daily', date, lines: [...lines, ...added.map((a) => `Scheduled: ${a}`), ...turnedDown], by: fromModel ? byLine(r, gate) : r ? 'Tide’s own rules (Claude’s answer couldn’t be read)' : byLine(null, gate), cost: r?.usage ? costWords(rec.usd, rec.tokens) : undefined })
  return { kind: 'daily', ran: true, lines, interventions: ivs, dropped: screened.dropped, record: rec }
}

/** Without Claude: today's lines from the facts, plainly */
function heuristicToday(s: Signals, ivs: Intervention[]): string[] {
  const open = s.planned.filter((p) => !p.done && !p.coach)
  const mins = open.reduce((n, p) => n + p.minutes, 0)
  const out = [open.length ? `${open.length} session${open.length === 1 ? '' : 's'}, about ${mins} min: ${open[0].title} first` : 'Nothing planned today yet']
  if (s.stage) out.push(`North Star stage ${s.stage.n} (${s.stage.title}): ${s.stage.step === 'learn' ? 'covering the stage’s topics' : s.stage.step === 'deepen' ? 'taking key topics deeper' : s.stage.step === 'capstone' ? 'the capstone' : 'passed'}.`)
  if (s.fading.length) out.push(`${s.fading.length} concept${s.fading.length === 1 ? '' : 's'} fading, lowest ${s.fading[0].name} at ${Math.round((s.fading[0].retention ?? 0) * 100)}%.`)
  if (s.fatigue.reasons.length) out.push(`Tiredness: ${s.fatigue.reasons.slice(0, 2).join('; ')}.`)
  if (!ivs.length) out.push('Nothing added: the plan stands as it is.')
  return out.slice(0, 5)
}

/** Interventions into today's plan (yesterday's unstarted ones replaced), then the rest of the week reshuffled */
async function scheduleInterventions(date: string, ivs: Intervention[]): Promise<void> {
  const { getWeek, saveWeekPlan } = await import('./coach')
  const plan = await getWeek(date)
  if (!plan) return
  const at = Date.now()
  const { plan: next } = applyInterventions(plan, date, ivs, at)
  await saveWeekPlan(next)
  await updateState((s) => ({ ...s, interventions: [...s.interventions.filter((h) => h.date !== date), ...ivs.map((iv) => ({ date, kind: iv.kind, ...(iv.id ? { id: iv.id } : {}), ...(iv.topic ? { topic: iv.topic } : {}) }))].slice(-200) }))
  // Things gets the new ones as to-dos (never in a test copy: its API is pointed nowhere there)
  const { toThings, replanNow } = await import('./goals')
  const added = next.days.find((d) => d.date === date)?.items.filter((it) => it.coach && it.coach.at === at) ?? []
  await toThings(next, added.map((item) => ({ kind: 'add' as const, item, date }))).catch(() => 0)
  if (next.mix) await replanNow(date).catch(() => null)
}

/** The week's evidence for the weekly review, from the event log and the plan (no model) */
async function weekEvidence(date: string): Promise<string> {
  const { readEvents } = await import('./learningLog')
  const since = Date.parse(addDaysIso(date, -6) + 'T00:00:00')
  const ev = readEvents({ since })
  const kinds = new Map<string, number>()
  for (const e of ev) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
  const answered = ev.filter((e) => e.outcome)
  const right = answered.filter((e) => e.outcome === 'correct').length
  const loads = await dayLoads(date, 7).catch(() => [])
  const st = await loadState()
  const ivs = st.interventions.filter((h) => h.date >= addDaysIso(date, -6))
  const { getWeek } = await import('./coach')
  const plan = await getWeek(date).catch(() => null)
  const items = (plan?.days ?? []).filter((d) => d.date <= date).flatMap((d) => d.items)
  const coachItems = items.filter((it) => it.coach)
  return [
    `Week to ${date}. Minutes by day: ${loads.map((d) => `${d.date.slice(5)} ${d.minutes}`).join(', ')}.`,
    `Events: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}. Marked answers: ${answered.length}, ${answered.length ? Math.round((100 * right) / answered.length) : 0}% right.`,
    `Planned items so far: ${items.length}, done ${items.filter((it) => it.done).length}.`,
    `Your interventions this week: ${ivs.length ? ivs.map((h) => `${h.date.slice(5)} ${h.kind}${h.topic ? ` ${h.topic}` : ''}`).join('; ') : 'none'}${coachItems.length ? `; done ${coachItems.filter((it) => it.done).length} of ${coachItems.length} still in the plan` : ''}.`
  ].join('\n')
}

async function northStarText(): Promise<{ text: string; tracks: { track: string; weight: number }[]; stage?: number }> {
  const v = await import('./northStar').then((m) => m.view()).catch(() => null)
  if (!v) return { text: 'No North Star yet.', tracks: [] }
  const cur = v.ns.stages.find((s) => s.n === v.ns.current)!
  const p = v.progress
  const text = [
    `North Star: stage ${cur.n} of ${v.ns.stages.length} (${cur.title}); step ${p.step}; ${p.solid}/${p.total} topics solid; about ${p.hoursLeft} h left; whole map ${v.estimate} at ${v.pace.hours} h a week${v.pace.measured ? ' (measured)' : ' (planned, not yet measured)'}.`,
    `Tracks this stage: ${cur.tracks.map((t) => `${t.track} ${t.weight}% (${Math.round(v.minutes[t.track] ?? 0)} min in 14 days)`).join('; ')}.`,
    `Key topics: ${p.deep.map((d) => `${d.topic} ${d.reached}/${d.target}`).join('; ') || 'none'}. Capstone: ${p.capstone}.`,
    `Stages: ${v.stages.map((s) => `${s.n} ${s.title}${s.estimate ? ` (${s.estimate})` : ''}${s.state === 'current' ? ' ← now' : ''}`).join('; ')}.`,
    v.proposals.length ? `Proposals waiting for them: ${v.proposals.map((x) => x.text).join('; ')}.` : ''
  ]
    .filter(Boolean)
    .join('\n')
  return { text, tracks: cur.tracks.map((t) => ({ track: t.track, weight: t.weight })), stage: cur.n }
}

const BELIEFS_ASK = `"beliefs": {"strengths": [{"text": "…", "evidence": "numbers or [[note]] links"}], "gaps": [], "pace": [], "works": []} (at most 4 a section; keep their edits, never restate a line from About me as a learner: link [[About me as a learner]] instead)`

/** The weekly review: what it noticed and changed, the stage's weights, North Star proposals, beliefs */
export async function runWeekly(date = localDate(), o: { overdueDays?: number } = {}): Promise<RunOutcome> {
  const gate = gateRun('weekly', await usageOf(), o.overdueDays ?? 0)
  if (gate.run === 'later') {
    await updateState((s) => ({ ...s, heldUntil: { ...s.heldUntil, weekly: Date.now() + gate.retryMs } }))
    return { kind: 'weekly', ran: false, why: gate.why, lines: [] }
  }
  const ns = await northStarText()
  const st = await loadState()
  const beliefs = await beliefsText()
  const prompt = [
    await goalLine(),
    await weekEvidence(date),
    ns.text,
    st.tilt?.stage === ns.stage && Object.keys(st.tilt?.tilt ?? {}).length ? `Your current tilt of the stage's weights: ${JSON.stringify(st.tilt!.tilt)}.` : '',
    beliefs.text ? `What you believe about them (their edits are authoritative${beliefs.edited ? '; they edited it since you last wrote it' : ''}):\n${beliefs.text.slice(0, 3000)}` : 'You have no belief note yet: write one from the evidence.',
    `Review the week. Use learner_model (recent, digest, fading, transfer_gaps, standing) for the evidence: at most five calls.
Then answer with JSON only:
{"noticed": ["at most 3 lines, each under 100 characters: what the evidence shows, with numbers"], "changed": ["at most 3 lines, each under 100 characters: what you change and why; 'nothing' is fine"], "tilt": {"<track>": <points, -10..10, summing to 0>}, "summary": "one sentence for the North Star page", "proposals": [North Star changes in its review format: {"kind": "weights"|"depth"|"scope"|"advance"|"capstone"|"synergy", "stage": n, ..., "why": "…"}, at most 2, only when the evidence justifies changing the map itself], ${BELIEFS_ASK}}`
  ]
    .filter(Boolean)
    .join('\n\n')
  const r = await ask('coachWeekly', prompt, COACH_SYSTEM, gate)
  const json = r ? await parseJson(r.text) : null
  const noticed = json ? linesOf(json.noticed, 4) : []
  const changed = json ? linesOf(json.changed, 4) : []
  let tiltLine = ''
  if (json && ns.stage !== undefined) {
    const tilt = checkTilt(json.tilt, ns.tracks)
    if (Object.keys(tilt).length) {
      await updateState((s) => ({ ...s, tilt: { stage: ns.stage!, tilt, at: Date.now() } }))
      tiltLine = `Weights within the stage: ${Object.entries(tilt).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')} points.`
    }
  }
  let proposalLine = ''
  if (json && Array.isArray(json.proposals) && json.proposals.length) {
    const fresh = await import('./northStar').then((m) => m.coachProposals(json.proposals, String(json.summary ?? ''), r!.by)).catch(() => [])
    if (fresh.length) proposalLine = `Proposed for your North Star (waiting for you): ${fresh.map((p) => p.text).join('; ')}.`
  }
  const b = json?.beliefs ? await writeBeliefs(json.beliefs, date).catch(() => ({ added: 0, kept: 0 })) : { added: 0, kept: 0 }
  const lines = json
    ? [...noticed.map((l) => `Noticed: ${l}`), ...changed.map((l) => `Changed: ${l}`), tiltLine, proposalLine, b.added || b.kept ? `Beliefs updated: ${b.added} from the evidence, ${b.kept} of yours kept as you wrote them.` : ''].filter(Boolean)
    : await heuristicWeek(date)
  const rec = await record('weekly', date, r, gate)
  await writeLog({ kind: 'weekly', date, lines, by: json ? byLine(r, gate) : byLine(null, gate), cost: r?.usage ? costWords(rec.usd, rec.tokens) : undefined })
  return { kind: 'weekly', ran: true, lines, record: rec }
}

/** Without a model: the week said from the numbers */
async function heuristicWeek(date: string): Promise<string[]> {
  const ev = (await weekEvidence(date)).split('\n')
  return [`Noticed: ${ev[0]}`, `Noticed: ${ev[1]}`, 'Changed: nothing; the week was written from the numbers, without a model.']
}

/** External ratings, once Sharpness keeps them (.tide/sharpness.json): read only, if they're there */
async function benchmarks(): Promise<string> {
  try {
    const j = JSON.parse(await readText('.tide/sharpness.json')) as { ratings?: Record<string, { r?: number; n?: number }> }
    const rows = Object.entries(j.ratings ?? {}).filter(([, v]) => typeof v?.r === 'number' && (v.n ?? 0) > 0)
    return rows.length ? `Sharpness ratings (external benchmark): ${rows.map(([k, v]) => `${k} ${Math.round(v.r!)} after ${v.n} attempts`).join('; ')}.` : ''
  } catch {
    return ''
  }
}

/** The monthly strategy check: pace against the estimate, depth, the stage order, an honest report */
export async function runMonthly(date = localDate(), o: { overdueDays?: number } = {}): Promise<RunOutcome> {
  const gate = gateRun('monthly', await usageOf(), o.overdueDays ?? 0)
  if (gate.run === 'later') {
    await updateState((s) => ({ ...s, heldUntil: { ...s.heldUntil, monthly: Date.now() + gate.retryMs } }))
    return { kind: 'monthly', ran: false, why: gate.why, lines: [] }
  }
  const ns = await northStarText()
  const bench = await benchmarks()
  // The dated milestone: readiness now, projected to the date (an estimate), and whether it's on pace
  const milestone = await import('./milestone').then((m) => m.milestoneLine()).catch(() => '')
  const log = await readText(LOG_NOTE).catch(() => '')
  const weeks = log.split(/^(?=## )/m).filter((x) => /· The week/.test(x)).slice(0, 4).join('\n').slice(0, 3000)
  const prompt = [
    await goalLine(),
    ns.text,
    bench || 'No external ratings yet (Sharpness keeps them once its problems are rated): say so plainly, don\'t invent any.',
    milestone ? `The dated milestone (numbers from code, an estimate; quote them, don't recompute):\n${milestone}` : '',
    weeks ? `Your last weekly entries:\n${weeks}` : '',
    `This is the monthly strategy check against North Star. Use learner_model (digest, weakest for "North Star", fading, transfer_gaps) for the evidence: at most six calls. Be honest: if the pace is behind the estimate or depth is thin, say it with numbers.
Answer with JSON only:
{"report": ["4 to 6 lines, each under 110 characters: pace against the estimate, depth progress on key topics, whether the stage order still fits, external benchmarks (or that there are none yet), the one thing to change"], "summary": "one sentence", "proposals": [at most 2 North Star changes, as in the weekly review, only if the evidence justifies them], ${BELIEFS_ASK}}`
  ]
    .filter(Boolean)
    .join('\n\n')
  const r = await ask('coachMonthly', prompt, COACH_SYSTEM, gate)
  const json = r ? await parseJson(r.text) : null
  let lines = json ? linesOf(json.report, 6) : []
  // The milestone's projection always leads, in code's own numbers
  const pace = milestonePace(milestone)
  if (pace) lines = [pace, ...lines.filter((l) => l !== pace)].slice(0, 7)
  if (json && Array.isArray(json.proposals) && json.proposals.length) {
    const fresh = await import('./northStar').then((m) => m.coachProposals(json.proposals, String(json.summary ?? ''), r!.by)).catch(() => [])
    if (fresh.length) lines.push(`Proposed for your North Star (waiting for you): ${fresh.map((p) => p.text).join('; ')}.`)
  }
  if (json?.beliefs) await writeBeliefs(json.beliefs, date).catch(() => null)
  if (!lines.length || (pace && lines.length === 1)) lines = [...(pace ? [pace] : []), ns.text.split('\n')[0], bench || 'No external ratings yet.', 'Written from the numbers, without a model.']
  const rec = await record('monthly', date, r, gate)
  await writeLog({ kind: 'monthly', date, lines, by: json ? byLine(r, gate) : byLine(null, gate), cost: r?.usage ? costWords(rec.usd, rec.tokens) : undefined })
  return { kind: 'monthly', ran: true, lines, record: rec }
}

// ---------- When ----------

let running: Promise<RunOutcome[]> | null = null

/** Runs whatever is due, one after another (never two coach runs at once) */
export function tick(now = Date.now()): Promise<RunOutcome[]> {
  if (running) return running
  running = (async () => {
    const st = await loadState()
    const d = new Date(now)
    const coach = await import('./coach').then((m) => m.getCoach()).catch(() => null)
    const weekStartDay = coach?.days.length ? [...coach.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))[0] : 1
    const due = dueRuns(st, now, { today: localDate(d), hour: d.getHours(), weekday: d.getDay(), weekStartDay })
    const out: RunOutcome[] = []
    for (const kind of due) {
      const overdue = (at?: number) => (at ? Math.max(0, Math.floor((now - at) / DAY) - 7) : 0)
      const r = await (kind === 'daily' ? runDaily(localDate(d)) : kind === 'weekly' ? runWeekly(localDate(d), { overdueDays: overdue(st.weekly?.at) }) : runMonthly(localDate(d), { overdueDays: overdue(st.monthly?.at) - 21 })).catch((e) => {
        console.warn(`[coach] ${kind}: ${(e as Error).message}`)
        return { kind, ran: false, why: (e as Error).message, lines: [] } as RunOutcome
      })
      out.push(r)
    }
    return out
  })().finally(() => (running = null))
  return running
}

/** Run one now, from the app (Your week's "Run now", or tests) */
export function runNow(kind: RunKind): Promise<RunOutcome> {
  return kind === 'daily' ? runDaily() : kind === 'weekly' ? runWeekly(undefined, { overdueDays: 3 }) : runMonthly(undefined, { overdueDays: 3 })
}

let timer: ReturnType<typeof setInterval> | null = null

/** Soon after Tide opens (the first open of the day runs the daily look), then every hour */
export function startCoach(): void {
  if (timer || process.env.VITEST) return
  setTimeout(() => void tick().catch(() => {}), 45_000)
  timer = setInterval(() => void tick().catch(() => {}), 3_600_000)
  void import('electron').then(({ powerMonitor }) => powerMonitor?.on?.('resume', () => setTimeout(() => void tick().catch(() => {}), 60_000))).catch(() => {})
}

// ---------- For the app ----------


export async function coachView(): Promise<CoachView> {
  const md = await readText(LOG_NOTE).catch(() => '')
  const date = localDate()
  const plan = await import('./coach').then((m) => m.getWeek(date)).catch(() => null)
  const scheduled = (plan?.days.find((d) => d.date === date)?.items ?? []).filter((it) => it.coach).map((it) => ({ kind: it.coach!.kind, title: it.title, reason: it.coach!.reason, minutes: it.minutes, done: !!it.done }))
  const st = await loadState()
  const hasBeliefs = await fs
    .access(absPath(BELIEFS_NOTE))
    .then(() => true)
    .catch(() => false)
  return { today: latestEntry(md, 'daily'), week: latestEntry(md, 'weekly'), month: latestEntry(md, 'monthly'), scheduled, logPath: LOG_NOTE, beliefsPath: BELIEFS_NOTE, hasBeliefs, running: !!running, runs: [...st.runs].reverse().slice(0, 10) }
}

/** For the tests */
export const _reset = () => {
  running = null
  queue = Promise.resolve()
}
export { emptyBeliefs }

/** The milestone's pace line for the monthly report, from main/milestone milestoneLine: "Interview-ready …: readiness 31 (24–38), projected 70 by 2027-07-14 (estimate): behind pace" */
export function milestonePace(text: string): string {
  if (!text) return ''
  const [head, ready, est] = text.split('\n')
  const title = head.split(':')[0]
  const r = ready?.match(/^Readiness (\d+) \((\d+)–(\d+)\)/)
  const p = est?.match(/projected (\d+)/)
  const status = est?.match(/: (ahead of pace|on pace|behind pace|too early to say[^.]*)\.?$/)?.[1] ?? ''
  return `${title}: readiness ${r ? `${r[1]} (${r[2]}–${r[3]})` : '?'}${p ? `, projected ${p[1]} by the ready-by date (estimate)` : ''}${status ? `: ${status}` : ''}.`
}
