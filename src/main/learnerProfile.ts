/**
 * A tutor that remembers you: the learner profile note (shared/learnerProfile has the format and
 * the rules), kept up after each lesson and tidied each week, and read as a short digest by every
 * lesson and chat, Claude's and Gemma's alike.
 *
 * - After a lesson: code rewrites the measured lines (pace, calibration, hints) from the records,
 *   and the background model (Haiku) proposes a few small changes from the lesson's transcript,
 *   marks, skips and threads, which code applies. A private or Metabase lesson's content never
 *   goes to Claude: those lessons count towards the measurements only.
 * - Each week: the planning model (Opus) tidies it (merges, resolves, drops), in the same small
 *   steps.
 * - The learner's own edits stay: what they wrote or changed isn't reworded or removed, and what
 *   they deleted isn't added back (shared/learnerProfile learnerEdits).
 * Every change is logged (.tide/learner/changes.jsonl) so the profile view can list them.
 */
import { promises as fs } from 'fs'
import type { LessonRecord } from '@shared/lessonLog'
import {
  applyOps,
  changeLine,
  confidenceLine,
  digest,
  emptyProfile,
  focusPace,
  hintsLine,
  isCodeLine,
  learnerEdits,
  lessonText,
  measure,
  mergeOwnership,
  noteDate,
  norm,
  paceLine,
  parseOps,
  parseProfile,
  PROFILE_HEAD,
  PROFILE_UPDATE_SYSTEM,
  PROFILE_WEEKLY_SYSTEM,
  profileUpdatePrompt,
  profileWeeklyPrompt,
  renderProfile,
  SECTIONS,
  sectionTitle,
  setMeasured,
  similarity,
  worthReading,
  type Change,
  type Ownership,
  type Profile,
  type ProfileOp,
  type RhythmFacts,
  type SectionId,
  type LearnerView
} from '@shared/learnerProfile'
import { absPath, readText, writeText } from './vault'

export const LEARNER_NOTE = 'Coach/About me as a learner.md'
const OLD_PROFILE = 'Coach/Learner profile.md'
const DIR = '.tide/learner'
const STATE = `${DIR}/state.json`
const LOG = `${DIR}/changes.jsonl`

interface State {
  /** The note as Tide last wrote it: what the learner changed since is theirs */
  written: string
  ownership: Ownership
  /** Lessons read already, with how far: a lesson is read again only when it has grown or finished */
  lessons: Record<string, { turns: number; finished: boolean }>
  weeklyAt?: number
  rhythm?: RhythmFacts
}

export interface LoggedChange extends Change {
  at: number
  /** Where it came from: a lesson's topic, "weekly tidy", "you", "measured" */
  from: string
  by?: 'claude' | 'gemma' | 'code' | 'you'
}

async function readState(): Promise<State> {
  try {
    const s = JSON.parse(await readText(STATE)) as Partial<State>
    return { written: s.written ?? '', ownership: s.ownership ?? { locked: [], suppressed: [] }, lessons: s.lessons ?? {}, ...(s.weeklyAt ? { weeklyAt: s.weeklyAt } : {}), ...(s.rhythm ? { rhythm: s.rhythm } : {}) }
  } catch {
    return { written: '', ownership: { locked: [], suppressed: [] }, lessons: {} }
  }
}

const saveState = async (s: State) => {
  await fs.mkdir(absPath(DIR), { recursive: true })
  await writeText(STATE, JSON.stringify(s))
}

async function logChanges(changes: Change[], from: string, by: LoggedChange['by']) {
  if (!changes.length) return
  await fs.mkdir(absPath(DIR), { recursive: true })
  const at = Date.now()
  await fs.appendFile(absPath(LOG), changes.map((c) => JSON.stringify({ ...c, at, from, by })).join('\n') + '\n')
}

export async function recentChanges(n = 30): Promise<LoggedChange[]> {
  const raw = await readText(LOG).catch(() => '')
  const out: LoggedChange[] = []
  for (const l of raw.split('\n').filter(Boolean)) {
    try {
      out.push(JSON.parse(l))
    } catch {
      // A torn line
    }
  }
  return out.slice(-n).reverse()
}

// One change to the note at a time
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => undefined).then(fn)
  queue = run.catch(() => undefined)
  return run
}

/** A first profile: the plan's goals, and the strengths and ways of learning the older profile note had */
async function seed(): Promise<Profile> {
  const p = emptyProfile()
  const old = await readText(OLD_PROFILE).catch(() => '')
  if (old) {
    const take = (heading: RegExp) =>
      (old.split(/^## /m).find((s) => heading.test(s.split('\n')[0])) ?? '')
        .split('\n')
        .slice(1)
        .map((l) => l.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
        .filter((x): x is string => !!x)
        .slice(0, 5)
    p.sections.strengths = take(/strength/i).map((text) => ({ text }))
    p.sections.clicks = take(/learn best|how they learn/i).map((text) => ({ text }))
  }
  return p
}

/**
 * Changes the note: reads it as it is now, takes what the learner did since Tide last wrote it,
 * applies `fn`, and writes it back with the changes logged. The note is created on first use.
 */
function change(from: string, by: LoggedChange['by'], fn: (p: Profile, own: Ownership, st: State) => Promise<{ profile: Profile; changes: Change[] }>): Promise<Change[]> {
  return inTurn(async () => {
    const st = await readState()
    const current = await readText(LEARNER_NOTE).catch(() => '')
    const ownership = mergeOwnership(st.ownership, learnerEdits(st.written, current))
    const before = current ? parseProfile(current) : await seed()
    const { profile, changes } = await fn(before, ownership, st)
    const md = renderProfile(profile)
    if (md !== current) await writeText(LEARNER_NOTE, md)
    await saveState({ ...st, written: md, ownership })
    await logChanges(changes, from, by)
    return changes
  })
}

// ---------- What code works out ----------

const DAY = 86_400_000

/** The last 60 days of lessons, as records */
async function recentRecords(days = 60): Promise<LessonRecord[]> {
  const names = await fs.readdir(absPath('.tide/lessons')).catch(() => [] as string[])
  const since = Date.now() - days * DAY
  const out: LessonRecord[] = []
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      const r = JSON.parse(await readText(`.tide/lessons/${n}`)) as LessonRecord
      if (r.updated >= since) out.push(r)
    } catch {
      // unreadable: skip
    }
  }
  return out
}

/** Goals and roadmap position, from the coach's settings and the focus roadmaps */
async function planLines(): Promise<{ heading: string; roadmap: string }> {
  try {
    const [{ getCoach }, { aimOf }, { getNotebooks }, { nextTopics }] = await Promise.all([import('./coach'), import('@shared/coach'), import('./learn'), import('@shared/coach')])
    const settings = await getCoach()
    const heading = (settings.direction?.trim() || aimOf(settings)).slice(0, 220)
    const notebooks = await getNotebooks().catch(() => [])
    const parts: string[] = []
    for (const name of settings.focus.slice(0, 2)) {
      const nb = notebooks.find((n) => n.name === name || n.path === name)
      if (!nb?.outline) continue
      const md = await readText(nb.outline).catch(() => '')
      const all = (md.match(/^\s*- \[[ xX]\] /gm) ?? []).length
      const done = (md.match(/^\s*- \[[xX]\] /gm) ?? []).length
      const next = nextTopics(nb.name, md, 1)[0]
      if (all) parts.push(`${nb.name}, ${done} of ${all} topics done${next ? `, next: ${next.topic}` : ''}`)
    }
    return { heading, roadmap: parts.join('; ') }
  } catch {
    return { heading: '', roadmap: '' }
  }
}

async function plannedMinutes(): Promise<{ weekday?: number; weekend?: number }> {
  try {
    const s = await (await import('./coach')).getCoach()
    return { ...(s.weekdayMinutes !== undefined ? { weekday: s.weekdayMinutes } : {}), ...(s.weekendMinutes !== undefined ? { weekend: s.weekendMinutes } : {}) }
  } catch {
    return {}
  }
}

/** The lines code keeps: goals and position from the plan, and the measurements */
async function codeLines(p: Profile, st: State): Promise<{ profile: Profile; changes: Change[] }> {
  const m = measure(await recentRecords(30))
  const plan = await planLines()
  const changes: Change[] = []
  let profile = p
  const set = (section: SectionId, text: string, prefix?: string) => {
    const r = setMeasured(profile, section, text, prefix)
    profile = r.profile
    if (r.change) changes.push(r.change)
  }
  set('goals', plan.heading, 'Heading towards:')
  set('goals', plan.roadmap, 'Roadmap:')
  const log = await import('./learn').then((l) => l.focusLog(Date.now() - 30 * DAY)).catch(() => [])
  set('pace', paceLine(m, st.rhythm, await plannedMinutes(), focusPace(log)))
  set('confidence', confidenceLine(m))
  set('hints', hintsLine(m))
  return { profile, changes }
}

/** Rewrites the measured lines now (the profile view asks, so it opens up to date) */
export const refreshMeasures = () => change('measured', 'code', (p, _o, st) => codeLines(p, st))

/** The rhythm as last saved: your best hours, for putting hard work in them (main/goals) */
export const rhythmNow = async (): Promise<RhythmFacts | undefined> => (await readState()).rhythm

/** The break planner's rhythm, from the window (it keeps the logs): used for the pace line */
export async function setRhythm(r: RhythmFacts): Promise<void> {
  await inTurn(async () => {
    const st = await readState()
    await saveState({ ...st, rhythm: { fadesAt: r.fadesAt ?? null, goodHours: Array.isArray(r.goodHours) ? r.goodHours.slice(0, 24) : [], learnedFrom: Number(r.learnedFrom) || 0 } })
  })
}

// ---------- After a lesson ----------

/** Whether a lesson's content must stay on this Mac: a private project, or about Metabase */
export async function lessonIsPrivate(r: LessonRecord): Promise<boolean> {
  const path = 'path' in r.scope ? r.scope.path : ''
  const { jobRoute } = await import('./ai')
  const route = await jobRoute('profileUpdate', `${r.topic}\n${r.turns.map((t) => t.content).join('\n').slice(0, 20_000)}`, { path: path || undefined, text: r.topic })
  return route.who === 'gemma' && (route.reason === 'private' || route.reason === 'metabase')
}

export interface UpdateDeps {
  /** Asks the background model; null when it can't (Claude unavailable and Gemma not loaded) */
  ask?: (prompt: string, system: string, isPrivate: boolean) => Promise<{ text: string; by: 'claude' | 'gemma' } | null>
}

/** The background model, as the job's route says: Claude's Haiku; Gemma only when it is loaded already */
async function askModel(prompt: string, system: string, isPrivate: boolean): Promise<{ text: string; by: 'claude' | 'gemma' } | null> {
  const { jobRoute, completeFor } = await import('./ai')
  const route = await jobRoute('profileUpdate', prompt, { private: isPrivate })
  if (route.who === 'claude') {
    const text = await completeFor('profileUpdate', prompt, system, { priority: 'background', private: isPrivate, noFallback: true }).catch(() => null)
    if (text !== null) return { text, by: 'claude' }
  }
  // Gemma only if it's in memory anyway: the profile never loads 10 GB on its own
  const { loaded } = await import('./modelIdle')
  if (!(await loaded().catch(() => false))) return null
  const { complete } = await import('./ai')
  const text = await complete(prompt, system, undefined, 'background').catch(() => null)
  return text ? { text, by: 'gemma' } : null
}

/**
 * Updates the profile from one lesson: the measured lines always; the model's few changes when the
 * lesson may go to it. A private or Metabase lesson's content never leaves the Mac: it is skipped
 * for the model (its marks still count in the measurements).
 */
export async function updateFromLesson(r: LessonRecord, deps: UpdateDeps = {}): Promise<Change[]> {
  const isPrivate = await lessonIsPrivate(r).catch(() => true)
  const ask = deps.ask ?? askModel
  return change(r.topic, 'code', async (p, ownership, st) => {
    const measured = await codeLines(p, st)
    let profile = measured.profile
    const changes = [...measured.changes]
    st.lessons[r.id] = { turns: r.turns.length, finished: !!r.finished }
    // Keep the record of lessons read small
    const ids = Object.keys(st.lessons)
    for (const k of ids.slice(0, Math.max(0, ids.length - 400))) delete st.lessons[k]
    if (isPrivate || !worthReading(r)) return { profile, changes }
    const reply = await ask(profileUpdatePrompt(renderProfile(profile), lessonText(r)), PROFILE_UPDATE_SYSTEM, false).catch(() => null)
    if (!reply) return { profile, changes }
    const ops = parseOps(reply.text)
    const applied = applyOps(profile, ops, { date: noteDate(), ownership, maxOps: 4, sections: ['clicks', 'missed', 'misconceptions', 'preferences', 'strengths', 'goals'] })
    profile = applied.profile
    // Logged as the model's, the measured ones as code's
    void logChanges(applied.changes, r.topic, reply.by).catch(() => {})
    return { profile, changes }
  })
}

const waiting = new Map<string, ReturnType<typeof setTimeout>>()
/** After the last save of a lesson, wait this long before reading it (a lesson saves every turn) */
export const SETTLE_MS = 90_000

/**
 * A lesson was saved: once it settles, read it into the profile if it finished or has grown by
 * a few turns since it was last read. Never for a lesson with nothing answered.
 */
export function noteLessonForProfile(r: LessonRecord): void {
  if (process.env.VITEST || !worthReading(r)) return
  const prev = waiting.get(r.id)
  if (prev) clearTimeout(prev)
  waiting.set(
    r.id,
    setTimeout(async () => {
      waiting.delete(r.id)
      const st = await readState()
      const seen = st.lessons[r.id]
      if (seen && (seen.finished || (!r.finished && r.turns.length - seen.turns < 6))) return
      const { getLesson } = await import('./lessons')
      const fresh = (await getLesson(r.id).catch(() => null)) ?? r
      await updateFromLesson(fresh).catch((e) => console.warn(`[learner] ${(e as Error).message}`))
    }, SETTLE_MS)
  )
}

// ---------- Each week ----------

/** The week's facts for the tidy: lessons with their marks, and what was missed */
async function weekFacts(): Promise<string> {
  const records = (await recentRecords(7)).sort((a, b) => a.updated - b.updated)
  const lines: string[] = []
  for (const r of records) {
    if (await lessonIsPrivate(r).catch(() => true)) continue
    const m = measure([r])
    lines.push(`${new Date(r.updated).toISOString().slice(0, 10)} ${r.topic}: ${m.answered} marked, ${m.hinted} with hints${r.finished ? ', finished' : ''}`)
    const t = lessonText(r, 900).split('\n').filter((l) => /^ {2}Marked (wrong|partial)|^Learner (said|asked)/.test(l))
    lines.push(...t.slice(0, 6).map((l) => `  ${l.trim()}`))
  }
  return lines.join('\n') || 'No lessons this week.'
}

/** Opus's weekly tidy of the profile, in small steps; Gemma (if loaded) or nothing when Claude can't */
export async function weeklyTidy(deps: { ask?: (prompt: string, system: string) => Promise<string | null> } = {}): Promise<Change[]> {
  const facts = await weekFacts()
  const ask =
    deps.ask ??
    (async (prompt: string, system: string) => {
      const { completeFor } = await import('./ai')
      return completeFor('profileWeekly', prompt, system, { priority: 'background', noFallback: true }).catch(() => null)
    })
  return change('weekly tidy', 'claude', async (p, ownership, st) => {
    const measured = await codeLines(p, st)
    st.weeklyAt = Date.now()
    const out = await ask(profileWeeklyPrompt(renderProfile(measured.profile), facts), PROFILE_WEEKLY_SYSTEM)
    if (!out) return measured
    const applied = applyOps(measured.profile, parseOps(out), { date: noteDate(), ownership, maxOps: 10, allowRemove: true })
    return { profile: applied.profile, changes: [...measured.changes, ...applied.changes] }
  })
}

export async function lastWeeklyTidy(): Promise<number> {
  return (await readState()).weeklyAt ?? 0
}

// ---------- What the tutor gets ----------

/** The digest for the tutor's prompt (300 words at most); empty when there's no profile yet */
export async function profileDigest(): Promise<string> {
  const md = await readText(LEARNER_NOTE).catch(() => '')
  return md ? digest(parseProfile(md)) : ''
}

/**
 * The full profile and the past mistakes on a topic, for the tutor's learner_profile tool:
 * misconceptions and missed questions that touch it, open first.
 */
export async function pastOnTopic(topic: string): Promise<string> {
  const md = await readText(LEARNER_NOTE).catch(() => '')
  const p = md ? parseProfile(md) : null
  const t = topic.trim()
  const parts: string[] = []
  if (p && t) {
    const mis = p.sections.misconceptions.filter((it) => similarity(it.text, t) >= 0.34 || norm(it.text).includes(norm(t)))
    if (mis.length) parts.push(`Misconceptions seen near "${t}":\n${mis.map((it) => `- ${it.text}${it.resolved ? ` (resolved ${it.resolved})` : it.seen?.length ? ` (seen ${it.seen.join(', ')}; still open)` : ''}`).join('\n')}`)
  }
  if (t) {
    const { listMistakes } = await import('./mistakes')
    const { privatePath } = await import('./projects')
    const all = await listMistakes().catch(() => [] as Awaited<ReturnType<typeof listMistakes>>)
    const near: typeof all = []
    for (const m of all) {
      if (similarity(m.topic, t) < 0.5 && !norm(m.topic).includes(norm(t)) && !norm(t).includes(norm(m.topic))) continue
      if (m.path && (await privatePath(m.path).catch(() => true))) continue
      near.push(m)
    }
    if (near.length)
      parts.push(
        `Past mistakes on it:\n${near
          .sort((a, b) => (a.status === 'open' ? -1 : 1) - (b.status === 'open' ? -1 : 1) || b.at - a.at)
          .slice(0, 8)
          .map((m) => `- ${m.question.slice(0, 160)}${m.answer ? ` (they answered: ${m.answer.slice(0, 100)})` : ''}; fix: ${m.fix.slice(0, 140)}${m.status === 'open' ? '' : ' (put right since)'}`)
          .join('\n')}`
      )
  }
  const full = md
    .replace(/^# .*\n+/, '')
    .replace(/^_[^\n]*_\n+/, '')
    .trim()
  return [full ? `The learner's profile (${LEARNER_NOTE}):\n${full}` : 'No learner profile yet.', ...parts].join('\n\n')
}

// ---------- The profile view ----------

export async function learnerView(): Promise<LearnerView> {
  const md = await readText(LEARNER_NOTE).catch(() => '')
  const st = await readState()
  const own = mergeOwnership(st.ownership, learnerEdits(st.written, md))
  const p = md ? parseProfile(md) : emptyProfile()
  const d = md ? digest(p) : ''
  return {
    path: LEARNER_NOTE,
    exists: !!md,
    sections: SECTIONS.map((s) => ({ id: s.id, title: s.title, items: p.sections[s.id].map((it) => ({ text: it.text, ...(it.seen ? { seen: it.seen } : {}), ...(it.resolved ? { resolved: it.resolved } : {}), code: isCodeLine(it.text), yours: own.locked.includes(norm(it.text)) })) })),
    changes: (await recentChanges(20)).map((c) => ({ at: c.at, line: changeLine(c), from: c.from, ...(c.by ? { by: c.by } : {}) })),
    digest: d,
    digestWords: d.split(/\s+/).filter(Boolean).length,
    ...(st.weeklyAt ? { weeklyAt: st.weeklyAt } : {})
  }
}

/**
 * A correction from the profile view: a line reworded (it becomes the learner's), deleted (never
 * added back), or a misconception marked resolved or open again.
 */
export async function correctItem(section: SectionId, text: string, next: { text?: string; remove?: boolean; resolved?: boolean }): Promise<LearnerView> {
  await change('you', 'you', async (p, ownership) => {
    const items = p.sections[section]
    const i = items.findIndex((it) => it.text === text)
    if (i < 0) return { profile: p, changes: [] }
    const before = `- ${items[i].text}`
    const copy = items.slice()
    const changes: Change[] = []
    if (next.remove) {
      copy.splice(i, 1)
      ownership.suppressed = [...new Set([...ownership.suppressed, norm(text)])]
      changes.push({ section, kind: 'removed', before })
    } else if (next.text !== undefined && next.text.trim() && next.text.trim() !== text) {
      const t = next.text.replace(/\s+/g, ' ').trim().slice(0, 240)
      copy[i] = { ...copy[i], text: t }
      ownership.locked = [...new Set([...ownership.locked, norm(t)])]
      // The old wording shouldn't come back either
      ownership.suppressed = [...new Set([...ownership.suppressed, norm(text)])]
      changes.push({ section, kind: 'updated', before, after: `- ${t}` })
    } else if (next.resolved !== undefined && section === 'misconceptions') {
      copy[i] = next.resolved ? { ...copy[i], resolved: noteDate() } : { ...copy[i], resolved: undefined }
      if (!next.resolved) delete copy[i].resolved
      changes.push({ section, kind: next.resolved ? 'resolved' : 'seen', before, after: `- ${copy[i].text}` })
    }
    return { profile: { ...p, sections: { ...p.sections, [section]: copy } }, changes }
  })
  return learnerView()
}

/** Adds a line of the learner's own from the profile view */
export async function addOwnItem(section: SectionId, text: string): Promise<LearnerView> {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (!t) return learnerView()
  await change('you', 'you', async (p, ownership) => {
    const items = [...p.sections[section], section === 'misconceptions' ? { text: t, seen: [noteDate()] } : { text: t }]
    ownership.locked = [...new Set([...ownership.locked, norm(t)])]
    ownership.suppressed = ownership.suppressed.filter((s) => s !== norm(t))
    return { profile: { ...p, sections: { ...p.sections, [section]: items } }, changes: [{ section, kind: 'added', after: `- ${t}` }] }
  })
  return learnerView()
}

/**
 * A mock interview's debrief (main/mocks): a few small changes worked out by code from its rubric
 * scores (shared/mocks profileOps), applied like any update, so the learner's own lines stay
 * theirs. Works without Claude.
 */
export function noteMock(ops: ProfileOp[], from: string): Promise<Change[]> {
  if (!ops.length) return Promise.resolve([])
  return change(from, 'code', async (p, ownership) => applyOps(p, ops, { date: noteDate(), ownership, maxOps: 3, sections: ['strengths', 'missed', 'hints'] }))
}

/** A finished project milestone's debrief, told to the profile (a few lines, as a lesson's update is) */
export function noteFromProject(ops: ProfileOp[], from: string, by: 'claude' | 'gemma' | 'code'): Promise<Change[]> {
  return change(from, by, async (p, ownership) => applyOps(p, ops, { date: noteDate(), ownership, maxOps: 3, sections: ['missed', 'strengths', 'hints'] }))
}

/** Makes the note now if there isn't one (the profile view's first open), with what code knows */
export async function ensureProfile(): Promise<void> {
  const md = await readText(LEARNER_NOTE).catch(() => '')
  if (md && md.includes('## ')) return
  await refreshMeasures()
}

export { PROFILE_HEAD, sectionTitle }
export type { ProfileOp }
