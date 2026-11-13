/**
 * The dated milestone North Star plans with (shared/milestone has the rules). Here: the milestones
 * read from the goal note into .tide/northstar.json, readiness gathered from what Tide already
 * keeps (Sharpness, mocks and company rounds, the learner model, the capstone), a reading a day
 * for the projection, and what the scheduler needs: the milestone's goal and each thread's value.
 */
import { localDate } from '@shared/coach'
import { daysBetween, type Thread } from '@shared/portfolio'
import type { PlanGoal, GoalNeed } from '@shared/goals'
import {
  activeMilestone,
  addReading,
  habitThreads,
  interviewMinutes,
  weekFloors,
  moduleChannels,
  type Channel,
  type ModuleLite,
  type ScopeDef,
  checklistDepths,
  countdown,
  CPP_CHECKLIST,
  CPP_DEPTH,
  MATHS_FLOOR,
  MEDIUM_BAND,
  OS_CHECKLIST,
  OS_DEPTH,
  osGate,
  parkThreads,
  parseMilestones,
  plannedDay,
  projectReadiness,
  readinessOf,
  scopeDef,
  threadValues,
  urgencyOf,
  valueThreads,
  type CheckState,
  type Milestone,
  type Projection,
  type Readiness,
  type ReadingPoint
} from '@shared/milestone'

const today = () => localDate()

/** The interview tags the milestone in force names (shared/modules roleTags); none without one */
export async function milestoneTags(): Promise<string[]> {
  const ms = await currentMilestone().catch(() => null)
  if (!ms) return []
  const { roleTags } = await import('@shared/modules')
  return roleTags(ms.roles)
}

/**
 * With tracks of modules: the modules as the milestone sees them (each under the track that holds
 * it), each scope item's channels from them, and each track's fan-out over the DAG. Null without.
 */
async function moduleSide(): Promise<{ channels: (def: ScopeDef) => Channel[]; fanOut: Map<string, number> } | null> {
  const { getNotebooks } = await import('./learn')
  const tracks = (await getNotebooks().catch(() => [])).filter((n) => n.track)
  if (!tracks.length) return null
  const mm = await import('./modules')
  const cat = await mm.loadCatalogue().catch(() => null)
  if (!cat) return null
  const { dependents, tracksOfModule } = await import('@shared/modules')
  const nbOf = new Map(tracks.map((n) => [n.track!, n.name]))
  const lite: ModuleLite[] = cat.modules.map((m) => ({ id: m.id, title: m.title, track: nbOf.get(tracksOfModule(cat, m.id)[0]?.id ?? '') ?? '', interview: m.interview })).filter((m) => m.track)
  const tags = await milestoneTags()
  const dep = dependents(cat.modules)
  const most = Math.max(1, ...dep.values())
  const gates = await mm.moduleState().catch(() => null)
  const fanOut = new Map<string, number>()
  for (const nb of tracks) {
    const t = cat.tracks.find((x) => x.id === nb.track)
    const open = (t?.modules ?? []).filter((id) => gates?.get(id) && !gates.get(id)!.passed && gates.get(id)!.status !== 'locked')
    // How much later work builds on what's open now, on the old scale (0 to 4 later stages)
    fanOut.set(nb.name.toLowerCase(), open.length ? (open.reduce((n, id) => n + (dep.get(id) ?? 0), 0) / open.length / most) * 4 : 0)
  }
  return { channels: (def) => (tags.length ? moduleChannels(def, lite, tags) : def.channels), fanOut }
}

/** The milestones in the goal note, written to the store when they changed. Called when building, reviewing and viewing */
export async function syncMilestones(): Promise<Milestone[]> {
  const ns = await import('./northStar')
  const store = await ns.loadStore()
  const note = await ns.goalNote()
  const parsed = parseMilestones(note)
  if (!store) return parsed
  if (JSON.stringify(parsed) !== JSON.stringify(store.milestones ?? [])) await ns.update((s) => ({ ...s, milestones: parsed })).catch(() => null)
  return parsed
}

/** The milestone in force, from the store (the note when the store has none yet) */
export async function currentMilestone(): Promise<Milestone | null> {
  const ns = await import('./northStar')
  const store = await ns.loadStore()
  const list = store?.milestones ?? (store ? await syncMilestones() : [])
  return activeMilestone(list, today())
}

export interface MilestoneState {
  milestone: Milestone
  days: number
  daysToReady: number
  readiness: Readiness
  projection: Projection
  urgency: number
  /** The OS and concurrency gate passed */
  osGate: boolean
  cpp: CheckState[]
  os: CheckState[]
  history: ReadingPoint[]
  /** Hours a day: planned, bonus, what makes a full day (minutes) */
  hours: ReturnType<typeof plannedDay>
  /** The daily interview habit, and the extra the date adds when readiness is behind (minutes a day) */
  habit: { habit: number; extra: number }
}

let cache: { at: number; state: MilestoneState | null } | null = null
export const resetMilestone = () => (cache = null)

/** Readiness now, with its projection to the ready-by date; records today's reading */
export async function milestoneState(fresh = false): Promise<MilestoneState | null> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.state
  const ms = await currentMilestone()
  if (!ms) {
    cache = { at: Date.now(), state: null }
    return null
  }
  const now = Date.now()
  const t = today()
  const [prefs, attempts, mocks, interviews, model] = await Promise.all([
    import('./sharpness').then((m) => m.sharpPrefs()).catch(() => null),
    import('./sharpness').then((m) => m.sharpAttempts()).catch(() => []),
    import('./mocks').then((m) => m.mockHistory()).catch(() => []),
    import('./learn').then((m) => m.listInterviews()).catch(() => []),
    // Never held up by a slow model build: without it, depth reads as none yet
    Promise.race([import('./learnerModel').then((m) => m.learnerModel()), new Promise<null>((r) => setTimeout(() => r(null), 20_000))]).catch(() => null)
  ])
  const rt = prefs?.ratings.algorithms ?? { r: 1000, n: 0 }
  const { ratingBand } = await import('@shared/sharpness')
  // Unseen mediums: rated first attempts at medium difficulty (not drills, not retries)
  const mediums = attempts.filter((a) => a.category === 'algorithms' && a.origin !== 'mock' && a.difficulty >= MEDIUM_BAND[0] && a.difficulty <= MEDIUM_BAND[1]).map((a) => ({ solved: a.solved, at: a.at }))
  const concepts = model ? [...model.model.nodes.values()].filter((n) => n.kind === 'concept').map((n) => ({ name: n.name, area: n.area, depth: n.depth ?? 0 })) : []
  const cpp = checklistDepths(CPP_CHECKLIST, concepts, CPP_DEPTH, /c\+\+|cpp/i)
  const os = checklistDepths(OS_CHECKLIST, concepts, OS_DEPTH, /software eng|operating|linux|c\+\+|systems/i)
  const ns = await import('./northStar')
  const store = await ns.loadStore()
  const star = await ns.activeNorthStar()
  const capstone = star ? await ns.capstoneState(store, star.current).catch(() => 'none' as const) : 'none'
  const readiness = readinessOf({
    now,
    algo: { rating: rt.r, band: ratingBand(rt, now), attempts: rt.n, mediums },
    mocks: [...mocks.filter((m) => m.mode !== 'exam').map((m) => ({ kind: m.mode, score: m.overall, at: m.at })), ...interviews.map((r) => ({ kind: r.round, score: r.score, at: r.at }))],
    cpp,
    os,
    capstone
  })
  let history = store?.readings ?? []
  if (store) {
    const next = addReading(history, { date: t, value: readiness.value })
    if (JSON.stringify(next) !== JSON.stringify(history)) {
      history = next
      await ns.update((s) => ({ ...s, readings: next })).catch(() => null)
    }
  }
  const projection = projectReadiness(history, t, ms.readyBy, ms.bar)
  const coach = await import('./coach').then((m) => m.getCoach()).catch(() => null)
  const setting = coach ? (coach.weekdayMinutes ?? Math.round((coach.hoursPerWeek * 60) / Math.max(1, coach.days.length))) : 270
  const state: MilestoneState = {
    milestone: ms,
    days: countdown(t, ms.date).days,
    daysToReady: countdown(t, ms.readyBy).days,
    readiness,
    projection,
    urgency: urgencyOf(projection, ms.bar),
    osGate: osGate(os),
    cpp,
    os,
    history: history.slice(-90),
    hours: plannedDay(setting, ms.hours),
    habit: interviewMinutes(projection, ms.bar)
  }
  cache = { at: Date.now(), state }
  return state
}

// ---------- For the scheduler ----------

export const MILESTONE_GOAL = 'milestone'

const PRACTICE_LABEL: Record<string, string> = { algorithms: 'Algorithms practice', quant: 'Probability and brainteasers', design: 'System design practice' }

/**
 * The milestone as a goal: one need per channel of its scope that Tide has (a roadmap in the vault,
 * with the headings the bar wants; Sharpness practice; mocks near the date). No date of its own:
 * the scheduler's value rule weighs it (shared/milestone threadValues), not the old date floor.
 */
export async function milestoneGoal(): Promise<(PlanGoal & { maxGap: number }) | null> {
  const ms = await currentMilestone()
  if (!ms) return null
  const ns = await import('./northStar')
  const cat = await ns.catalogue().catch(() => [])
  const weeks = daysBetween(today(), ms.readyBy) / 7
  const needs: GoalNeed[] = []
  const seen = new Set<string>()
  const mods = await moduleSide().catch(() => null)
  for (const s of ms.scope) {
    const def = scopeDef(s.id)
    if (!def || (def.within && weeks > def.within)) continue
    for (const c of mods ? mods.channels(def) : def.channels) {
      if (c.kind === 'roadmap') {
        const track = cat.find((t) => c.track.test(t.name) && (t.outline || t.modules?.length))
        if (!track) continue
        const headings = track.phases.flatMap((p) => [p.title, ...p.sections.map((x) => x.title)]).filter((h) => c.headings.test(h))
        const key = `roadmap:${track.name}`
        const had = needs.find((n) => n.kind === 'roadmap' && n.ref === track.name)
        if (had) had.sections = [...new Set([...(had.sections ?? []), ...headings])]
        else needs.push({ id: `ms:${track.name}`, kind: 'roadmap', ref: track.name, label: track.name, hours: 10, sections: headings, why: `${ms.title}: ${def.label}` })
        seen.add(key)
      } else {
        const key = `${c.kind}:${c.ref}`
        if (seen.has(key)) continue
        seen.add(key)
        needs.push({ id: `ms:${key}`, kind: c.kind, ref: c.ref, label: c.kind === 'practice' ? PRACTICE_LABEL[c.ref] : `${c.ref[0].toUpperCase()}${c.ref.slice(1)} mocks`, hours: 10, why: `${ms.title}: ${def.label}` })
      }
    }
  }
  if (!needs.length) return null
  return { id: MILESTONE_GOAL, title: ms.title, weight: 'main', needs, createdAt: Date.now(), by: 'tide', maxGap: 7 }
}

/** Each roadmap's headings the milestone wants planned now, even before its North Star stage (main/northStar trackScope) */
let sectionsCache: { at: number; map: Map<string, string[]> } | null = null
export async function milestoneSections(track: string): Promise<string[]> {
  if (!sectionsCache || Date.now() - sectionsCache.at > 5 * 60_000) {
    const goal = await milestoneGoal().catch(() => null)
    const map = new Map<string, string[]>()
    for (const n of goal?.needs ?? []) if (n.kind === 'roadmap' && n.sections?.length) map.set(n.ref.toLowerCase(), n.sections)
    sectionsCache = { at: Date.now(), map }
  }
  return sectionsCache.map.get(track.toLowerCase()) ?? []
}

/**
 * The threads as the milestone shapes them: parked tracks kept to their reviews, and every thread
 * weighted by long-term value plus deadline value. No language is ordered before another here.
 */
export async function shapeThreads(threads: Thread[], o: { projectTracks?: Record<string, string[]> } = {}): Promise<{ threads: Thread[]; groupFloors: Record<string, number>; state: MilestoneState | null; stageTracks: string[] }> {
  const ns = await import('./northStar')
  const star = await ns.activeNorthStar()
  const state = await milestoneState().catch(() => null)
  const stage = star?.stages.find((s) => s.n === star.current)
  const stageTracks = stage?.tracks.map((t) => t.track) ?? []
  const inStage = (x: string) => stageTracks.some((s) => s.toLowerCase() === x.toLowerCase())
  // A project being built keeps its tracks alive; one outside the stage's tracks is a love interest
  const pt = o.projectTracks ?? {}
  const active = [...new Set(Object.values(pt).flat())]
  const love = new Set<string>()
  for (const [id, tracks] of Object.entries(pt)) if (tracks.length && !tracks.some(inStage)) love.add(id)
  for (const t of threads) if (t.kind === 'roadmap' && active.some((a) => a.toLowerCase() === t.label.toLowerCase()) && !inStage(t.label)) love.add(t.id)
  let out = parkThreads(threads, { milestone: state?.milestone ?? null, today: today(), stageTracks, active })
  if (star) {
    const mods = await moduleSide().catch(() => null)
    const values = threadValues(out, { stages: star.stages, current: star.current, milestone: state?.milestone ?? null, gaps: state?.readiness.gaps ?? {}, urgency: state?.urgency ?? 0, today: today(), ...(mods ? { fanOut: mods.fanOut, channels: mods.channels } : {}) })
    out = valueThreads(out, values)
  }
  out = habitThreads(out, { love })
  const habit = state ? interviewMinutes(state.projection, state.milestone.bar) : null
  const groupFloors = weekFloors(state?.hours.plan ?? 0, out.some((t) => t.group === 'interview') ? habit : null, { projects: out.some((t) => t.group === 'projects'), love: out.some((t) => t.group === 'love') })
  return { threads: out, groupFloors, state, stageTracks }
}

/** For the coach's monthly check and the weekly review: readiness, its projection and whether it's on pace */
export async function milestoneLine(): Promise<string> {
  const s = await milestoneState(true).catch(() => null)
  if (!s) return ''
  const p = s.projection
  const pace = p.status === 'unknown' ? 'too early to say whether it is on pace (fewer than three readings)' : p.status === 'ahead' ? 'ahead of pace' : p.status === 'on' ? 'on pace' : 'behind pace'
  return [
    `${s.milestone.title}: ${s.days} days to the date, ${s.daysToReady} to the ready-by date (${s.milestone.readyBy}).`,
    `Readiness ${s.readiness.value} (${s.readiness.low}–${s.readiness.high}) of a bar of ${s.milestone.bar}; ${s.readiness.parts.map((x) => `${x.label} ${Math.round(x.value * 100)}% (${x.detail})`).join(', ')}.`,
    `Estimate: ${p.projected !== null ? `projected ${p.projected} at the ready-by date at ${p.slope} points a week` : 'no projection yet'}; needs ${p.need} points a week: ${pace}.`,
    `OS and concurrency gate ${s.osGate ? 'passed' : `not yet (${s.os.filter((r) => r.depth >= r.target).length} of ${s.os.length} at depth ${OS_DEPTH})`}; C++ checklist ${s.cpp.filter((r) => r.depth >= r.target).length} of ${s.cpp.length} at depth ${CPP_DEPTH}.`
  ].join('\n')
}
