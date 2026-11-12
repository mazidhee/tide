/**
 * Lesson prep while you're away: when Tide is open but idle, or overnight, a background job gets
 * the next lesson ready (what's due, the best reading, 3 to 5 checked exercises, a custom visual
 * when it helps, a short plan in the lesson map's format, the warm-up and one line on why today),
 * so starting it is instant. Plus a weekly review note.
 *
 * Pure: when to run, the prepared lesson's shape, the prompts, the plan tag, what the Ready card
 * lists, and the weekly review's Markdown. main/lessonPrep does the work.
 */
import type { PlanStep } from './lessonPlan'
import type { ChatScope } from './types'
import type { WarmupSet } from './warmup'
import type { SessionSetup } from './session'

export interface PrepSettings {
  on: boolean
  /** The night window, as hours: from 22 to 7 runs from ten at night to seven in the morning */
  from: number
  to: number
  /** Also while Tide is open and you've been away from the Mac this long */
  whenIdle: boolean
  idleMinutes: number
  /** At most this many Claude calls a night for prep and the weekly review */
  maxCalls: number
}

export const DEFAULT_PREP: PrepSettings = { on: true, from: 22, to: 7, whenIdle: true, idleMinutes: 20, maxCalls: 8 }

export function prepSettings(saved?: Partial<PrepSettings> | null): PrepSettings {
  const s = { ...DEFAULT_PREP, ...(saved ?? {}) }
  const hour = (h: unknown, d: number) => (Number.isInteger(Number(h)) && Number(h) >= 0 && Number(h) <= 23 ? Number(h) : d)
  return {
    on: s.on !== false,
    from: hour(s.from, DEFAULT_PREP.from),
    to: hour(s.to, DEFAULT_PREP.to),
    whenIdle: s.whenIdle !== false,
    idleMinutes: Math.max(5, Math.min(240, Math.round(Number(s.idleMinutes) || DEFAULT_PREP.idleMinutes))),
    maxCalls: Math.max(0, Math.min(40, Math.round(Number(s.maxCalls ?? DEFAULT_PREP.maxCalls))))
  }
}

/** Whether an hour is inside the window (which may run past midnight) */
export function inWindow(hour: number, from: number, to: number): boolean {
  if (from === to) return true
  return from < to ? hour >= from && hour < to : hour >= from || hour < to
}

/** The night a moment belongs to, as the date it started: 2am on the 13th counts towards the 12th's night */
export function nightOf(now: number, s: Pick<PrepSettings, 'from' | 'to'>): string {
  const d = new Date(now)
  if (s.from > s.to && d.getHours() < s.to) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Claude calls one full prep takes: the plan, the exercises, the opening (the checks are Haiku's, small) */
export const PREP_CALLS = 3
/** The weekly review and the profile's weekly tidy */
export const WEEKLY_CALLS = 2
/** Above this share of the plan's window, prep leaves Claude alone */
export const NEAR_LIMIT = 0.8

export interface PrepInput {
  now: number
  settings: PrepSettings
  /** Seconds since the Mac was last used (Electron powerMonitor) */
  idleSeconds: number
  /** A lesson or chat is running right now */
  busy: boolean
  claude: {
    ready: boolean
    /** At the plan's limit until then (ms) */
    limitedUntil?: number
    /** How full the plan's window is, 0 to 1, when the plan says */
    utilization?: number
    /** The plan's last word: "allowed_warning" means close */
    status?: string
  }
  /** Claude calls prep made this night */
  usedTonight: number
  /** A prepared lesson is waiting for the next thing to learn already */
  ready: boolean
  /** There is a next lesson to prepare */
  target: boolean
  /** When prep last tried (ms) */
  lastTry?: number
}

export type PrepDecision = { run: false; why: string } | { run: true; claude: boolean; why: string }

const RETRY_MS = 45 * 60_000

/**
 * Whether to prepare now, and whether Claude may take part. Runs when Tide is open and either the
 * night window has come or the Mac has been idle a while; never during a lesson. Claude is left
 * out when it's at or near its plan's limit or tonight's allowance is spent: then prep gathers
 * what needs no model (what's due, the warm-up, readings and exercises found before).
 */
export function shouldPrep(i: PrepInput): PrepDecision {
  const s = i.settings
  if (!s.on) return { run: false, why: 'Lesson prep is off' }
  if (i.busy) return { run: false, why: 'You’re in a lesson' }
  const night = inWindow(new Date(i.now).getHours(), s.from, s.to)
  const idle = s.whenIdle && i.idleSeconds >= s.idleMinutes * 60
  if (!night && !idle) return { run: false, why: 'Waiting for the night, or for you to be away' }
  if (!i.target) return { run: false, why: 'Nothing planned to prepare' }
  if (i.ready) return { run: false, why: 'Your next lesson is ready' }
  if (i.lastTry && i.now - i.lastTry < RETRY_MS) return { run: false, why: 'Tried a little while ago' }
  const why = claudeWhy(i)
  return { run: true, claude: !why, why: why || (night ? 'Overnight' : 'While you were away') }
}

/** Why Claude sits this one out, or '' when it may take part */
export function claudeWhy(i: Pick<PrepInput, 'now' | 'claude' | 'usedTonight' | 'settings'>, calls = PREP_CALLS): string {
  if (!i.claude.ready) return 'Claude isn’t available'
  if (i.claude.limitedUntil && i.claude.limitedUntil > i.now) return 'Claude is at your plan’s limit'
  if ((i.claude.utilization ?? 0) >= NEAR_LIMIT || i.claude.status === 'allowed_warning') return 'Claude is near your plan’s limit'
  if (i.usedTonight + calls > i.settings.maxCalls) return 'Tonight’s Claude allowance for prep is used'
  return ''
}

// ---------- The prepared lesson ----------

export interface PreparedExercise {
  id: string
  kind: 'code' | 'sql' | 'maths' | 'concept'
  level: 1 | 2 | 3
  question: string
}

export interface PreparedLesson {
  id: string
  /** When it was prepared */
  at: number
  status: 'ready' | 'used'
  usedAt?: number
  topic: string
  notebook?: string
  topicId?: string
  /** The week plan's item it is, so finishing it ticks the item */
  agenda?: { date: string; index: number }
  /** The day it was prepared for */
  forDate: string
  scope: ChatScope
  options?: SessionSetup['options']
  /** One line: why this today */
  why: string
  plan?: { goal?: string; steps: PlanStep[] }
  due: { recall: number; fading: string[]; onTopic: string[] }
  warmup?: WarmupSet
  reading?: { title: string; by?: string; url?: string; path?: string; page?: number }
  exercises: PreparedExercise[]
  /** A custom visual in the opening, by its title */
  visual?: { title: string }
  /** The lesson's first exchange, ready: the opening message and the tutor's first reply */
  opening?: { message: string; reply: string }
  /** Who prepared it: Claude, or code alone (no opening, plan or new exercises) */
  by: 'claude' | 'local'
  /** Claude calls it took */
  calls: number
  /** Why Claude didn't take part, when it didn't */
  note?: string
}

/** What the Ready card lists, in order, each a few words */
export function preparedParts(p: Pick<PreparedLesson, 'plan' | 'due' | 'warmup' | 'reading' | 'exercises' | 'visual' | 'opening'>): string[] {
  const parts: string[] = []
  if (p.plan?.steps.length) {
    const min = p.plan.steps.reduce((n, s) => n + (s.minutes ?? 0), 0)
    parts.push(`A ${p.plan.steps.length}-step plan${min ? `, about ${min} min` : ''}`)
  }
  if (p.warmup?.cards.length) parts.push(`${p.warmup.cards.length} warm-up question${p.warmup.cards.length === 1 ? '' : 's'}`)
  const due = p.due.onTopic.length + p.due.fading.length
  if (p.due.recall || due) parts.push(p.due.recall ? `${p.due.recall} recall question${p.due.recall === 1 ? '' : 's'} due` : `${due} fading idea${due === 1 ? '' : 's'} to touch on`)
  if (p.exercises.length) parts.push(`${p.exercises.length} checked exercise${p.exercises.length === 1 ? '' : 's'}`)
  if (p.visual) parts.push('A custom visual')
  if (p.reading) parts.push(`Reading: ${p.reading.title}`)
  return parts
}

/** The plan as the lesson's <plan> tag, in the lesson map's format (shared/lessonPlan parseStep reads it back) */
export function planTag(plan: { goal?: string; steps: PlanStep[] }): string {
  const lines = plan.steps.map((s) => [s.title, s.about, s.doneWhen ? (/^done when/i.test(s.doneWhen) ? s.doneWhen : `Done when ${s.doneWhen}`) : '', s.minutes ? `${s.minutes} min` : ''].filter(Boolean).join(' | '))
  return `<plan>\n${plan.goal ? `Goal: ${plan.goal}\n` : ''}${lines.join('\n')}\n</plan>`
}

/** What the tutor is told in the opening of a prepared lesson: why today, and the exercises it can set */
export function prepNote(p: Pick<PreparedLesson, 'why' | 'exercises' | 'reading' | 'due'>): string {
  const level = ['easy', 'medium', 'hard']
  const parts = [
    `(Tide: this lesson was prepared ahead. Why today: ${p.why}`,
    p.exercises.length
      ? `Checked exercises are ready for it, verified in Tide's sandbox: set each one when the lesson reaches it by ending your reply with <exercise id="…"/> (each once, roughly in this order, at most one per reply):\n${p.exercises.map((x) => `- ${x.id}: ${level[x.level - 1]} ${x.kind}, "${x.question.slice(0, 140)}"`).join('\n')}`
      : '',
    p.reading ? `The reading to point them to: ${p.reading.title}${p.reading.by ? ` (${p.reading.by})` : ''}${p.reading.url ? ` ${p.reading.url}` : ''}.` : '',
    p.due.onTopic.length ? `Recall questions due on this topic (ask one early): ${p.due.onTopic.slice(0, 3).join(' / ')}` : '',
    p.due.fading.length ? `Earlier ideas fading that this builds on: ${p.due.fading.slice(0, 4).join(', ')}.` : ''
  ].filter(Boolean)
  return `${parts.join('\n')})`
}

// ---------- Prompts ----------

export const PREP_PLAN_SYSTEM = 'You plan one lesson for a self-taught learner, carefully and concretely. Hands-on, plain language, no analogies or jokes by default. Reply with JSON only.'

export function prepPlanPrompt(o: { topic: string; notebook?: string; section?: string; agendaWhy?: string; roadmap?: string; profile?: string; earlier?: string; due?: string; reading?: string; minutes?: number }): string {
  return `Plan the learner's next lesson: ${o.topic}${o.notebook ? ` (roadmap: ${o.notebook}${o.section ? `, section ${o.section}` : ''})` : ''}.
${o.agendaWhy ? `Their week plan says: ${o.agendaWhy}\n` : ''}${o.roadmap ? `Where they are: ${o.roadmap}\n` : ''}${o.profile ? `\n${o.profile}\n` : ''}${o.earlier ? `\nWhat earlier lessons show:\n${o.earlier.slice(0, 2500)}\n` : ''}${o.due ? `\nDue or fading: ${o.due}\n` : ''}${o.reading ? `\nThe reading found for it: ${o.reading}\n` : ''}
Return JSON only:
{"why": "one plain sentence to the learner, under 30 words, on why this lesson today (what it builds on, what it unlocks)",
 "goal": "By the end you can … (under 25 words)",
 "steps": [{"title": "short, under 8 words", "about": "what it covers, under 15 words", "done_when": "Done when you … (the check that shows you have it, under 15 words)", "minutes": 6}],
 "visual": {"brief": "what a small interactive explainer should show, with exact numbers"} or null}
3 to 5 steps, ${o.minutes ? `about ${o.minutes} minutes in all` : '25 to 45 minutes in all'}; start from what they already know and skip what they've shown. A visual only when the idea is a process or has moving parts.`
}

export const PREP_EXERCISES_SYSTEM = 'You write practice exercises with their proofs, for Tide to check in its sandbox before a learner sees them. Reply with JSON only.'

export function prepExercisesPrompt(o: { topic: string; plan: string; n: number; avoid?: string[] }): string {
  return `Write ${o.n} practice exercises for a lesson on ${o.topic}, following this plan:
${o.plan}

Mix levels (easy, medium, hard) along the plan's steps. Each exercise is an object with the fields of Tide's set_exercise tool:
{"kind": "code" | "sql" | "maths" | "concept", "level": "easy" | "medium" | "hard", "problem": "the problem in Markdown, everything needed", "question": "the one question in the answer box",
 code: "lang", "tests" (Python: 3+ pytest test_ functions calling the function by name, no import), "reference" (passes every test);
 sql: "reference" (a query on Tide's sample shop and analytics lab);
 maths: "solution" (worked), "answer" (a SymPy expression), "check" (Python with SymPy that computes it from scratch and prints it last);
 concept: "solution" (the model answer and what full marks needs);
 every kind: "mistake" (a common wrong answer, wrong code or wrong query, which the check must catch) and "mistake_note"}
Prefer code and maths where the topic allows: they are checked exactly.${o.avoid?.length ? `\nNot these, set before: ${o.avoid.slice(0, 6).join(' / ')}` : ''}
Reply with JSON only: {"exercises": [...]}`
}

export function prepOpeningPrompt(o: { plan: string; visual?: string }): string {
  return `Write the opening reply of this lesson now, as you would in the lesson itself:
1. The plan, exactly as below (the same steps and wording), as the first thing in your reply:
${o.plan}
2. <progress step="1"/> and then teach step 1's first idea briefly, with one concrete worked example (exact numbers).${o.visual ? `\n3. One custom visual for it, in a fenced block whose language is visual: ${o.visual}. Then one sentence on what to look at.` : ''}
${o.visual ? '4' : '3'}. End with ONE question in an <ask> tag that finds out what they already know of step 1. No greeting, no exercise yet.`
}

/** The JSON of a plan reply, cleaned; null when there's no usable plan */
export function parsePrepPlan(raw: unknown): { why: string; goal?: string; steps: PlanStep[]; visual?: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // Cut long text at a sentence, else a word, never mid-word
  const str = (v: unknown, n = 200) => {
    const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
    if (t.length <= n) return t
    const cut = t.slice(0, n)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
    return end > n * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`
  }
  const steps = (Array.isArray(r.steps) ? r.steps : [])
    .map((s: Record<string, unknown>) => {
      const title = str(s?.title, 70)
      if (!title) return null
      const minutes = Math.round(Number(s.minutes))
      const done = str(s.done_when ?? s.doneWhen, 160)
      const step: PlanStep = { title, ...(str(s.about, 160) ? { about: str(s.about, 160) } : {}), ...(done ? { doneWhen: /^done when/i.test(done) ? done : `Done when ${done.replace(/^./, (c) => c.toLowerCase())}` } : {}), ...(minutes > 0 && minutes <= 60 ? { minutes } : {}) }
      return step
    })
    .filter((s): s is PlanStep => !!s)
    .slice(0, 6)
  if (!steps.length) return null
  const visual = r.visual && typeof r.visual === 'object' ? str((r.visual as Record<string, unknown>).brief, 400) : typeof r.visual === 'string' ? str(r.visual, 400) : ''
  const goal = str(r.goal, 200)
  return { why: str(r.why, 240), ...(goal ? { goal } : {}), steps, ...(visual ? { visual } : {}) }
}

/** The plan given to the exercise writer: one line a step */
export const planText = (plan: { goal?: string; steps: PlanStep[] }) => [plan.goal ? `Goal: ${plan.goal}` : '', ...plan.steps.map((s, i) => `${i + 1}. ${s.title}${s.about ? `: ${s.about}` : ''}${s.doneWhen ? ` (${s.doneWhen})` : ''}`)].filter(Boolean).join('\n')

// ---------- The weekly review ----------

export interface WeekFacts {
  /** The last day of the week, yyyy-mm-dd */
  end: string
  minutes: number
  /** Minutes by day, Monday first as the week ran */
  days: { date: string; minutes: number }[]
  lessons: { topic: string; finished: boolean; right: number; asked: number }[]
  /** Concepts that moved to solid this week */
  learned: string[]
  /** Fading: held once, slipping now; with how solid they are (0 to 1) */
  fading: { name: string; estimate: number }[]
  misconceptions: { resolved: string[]; open: string[] }
  maths: { sessions: number; accuracy?: number; avgSeconds?: number; before?: { accuracy?: number; avgSeconds?: number }; level?: string }
  /** The roadmaps' next topics, for the suggestion when no model writes it */
  next: string[]
}

export interface ReviewProse {
  learned?: string
  focus?: string
  /** Up to three topics or areas for next week, which the weekly coach weighs when it plans */
  focusTopics?: string[]
}

export const WEEKLY_REVIEW_SYSTEM = 'You write a learner’s weekly review: plain, specific, second person, no praise padding, no analogies or jokes. Reply with JSON only.'

export function weeklyReviewPrompt(f: WeekFacts, profile: string): string {
  return `The learner's week, from Tide's records:
${factsText(f)}
${profile ? `\n${profile}\n` : ''}
Return JSON only:
{"learned": "2 to 4 sentences: the ideas and skills they worked on this week and which they now handle, concretely; don't restate the scores or hours (Tide shows those beside it)",
 "focus": "2 or 3 sentences: what next week should focus on and why, from what's fading, what's still open and where their roadmap goes next",
 "focus_topics": ["up to 3 topics or areas for next week"]}`
}

const pct = (x?: number) => (x === undefined ? '' : `${Math.round(x * 100)}%`)

export function factsText(f: WeekFacts): string {
  return [
    `Time studied: ${hm(f.minutes)}.`,
    f.lessons.length ? `Lessons: ${f.lessons.map((l) => `${l.topic} (${l.right} of ${l.asked} right${l.finished ? '' : ', unfinished'})`).join('; ')}.` : 'No lessons.',
    f.learned.length ? `Now solid: ${f.learned.join(', ')}.` : '',
    f.fading.length ? `Fading: ${f.fading.map((c) => `${c.name} (${pct(c.estimate)})`).join(', ')}.` : '',
    f.misconceptions.resolved.length ? `Misconceptions resolved: ${f.misconceptions.resolved.join('; ')}.` : '',
    f.misconceptions.open.length ? `Misconceptions still open: ${f.misconceptions.open.join('; ')}.` : '',
    f.maths.sessions ? `Mental maths: ${f.maths.sessions} sessions${f.maths.accuracy !== undefined ? `, ${pct(f.maths.accuracy)} right` : ''}${f.maths.avgSeconds !== undefined ? `, ${f.maths.avgSeconds.toFixed(1)} s a question` : ''}.` : '',
    f.next.length ? `Next on the roadmap: ${f.next.join(', ')}.` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function parseReviewProse(raw: unknown): ReviewProse {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 900) : '')
  const topics = (Array.isArray(r.focus_topics) ? r.focus_topics : Array.isArray(r.focusTopics) ? r.focusTopics : []).map((t) => s(t).slice(0, 80)).filter(Boolean).slice(0, 3)
  return { ...(s(r.learned) ? { learned: s(r.learned) } : {}), ...(s(r.focus) ? { focus: s(r.focus) } : {}), ...(topics.length ? { focusTopics: topics } : {}) }
}

export const hm = (minutes: number) => {
  const m = Math.round(minutes)
  return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m / 60} h`
}

const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** What next week should focus on when no model writes it: fading first, then what's open, then the roadmap */
export function fallbackFocus(f: WeekFacts): ReviewProse {
  const topics = [...f.fading.slice(0, 2).map((c) => c.name), ...f.next.slice(0, 2)].slice(0, 3)
  const bits = [f.fading.length ? `refresh ${f.fading.slice(0, 2).map((c) => c.name).join(' and ')} before ${f.fading.length === 1 ? 'it slips' : 'they slip'} further` : '', f.misconceptions.open.length ? `check the ${f.misconceptions.open.length === 1 ? 'misconception' : `${f.misconceptions.open.length} misconceptions`} still open` : '', f.next.length ? `move on to ${f.next.slice(0, 2).join(' and ')}` : '']
    .filter(Boolean)
  return { focus: bits.length ? `Next week: ${bits.join(', then ')}.` : 'Keep the same pace next week.', ...(topics.length ? { focusTopics: topics } : {}) }
}

/** The weekly review as a note: numbers by code, the two paragraphs by the model when it could */
export function weeklyReviewMarkdown(f: WeekFacts, prose: ReviewProse, by: 'claude' | 'local'): string {
  const max = Math.max(30, ...f.days.map((d) => d.minutes))
  const bar = (m: number) => '█'.repeat(Math.round((m / max) * 12)) || '·'
  const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  const m = f.maths
  const trend = (now?: number, before?: number, lowerIsBetter = false) => (now === undefined || before === undefined ? '' : Math.abs(now - before) < 0.005 ? ' (same as the week before)' : (now < before) === lowerIsBetter ? ' (better than the week before)' : ' (down on the week before)')
  const out = [
    `# Week to ${longDate(f.end)}`,
    '',
    `_Tide’s weekly review${by === 'claude' ? ', written by Claude from your records' : ', from your records'}. The suggested focus goes to the weekly coach when it plans your next week._`,
    '',
    '## What you learned',
    '',
    prose.learned || (f.lessons.length ? `Lessons on ${f.lessons.map((l) => l.topic).join(', ')}.` : 'No lessons this week.'),
    '',
    ...(f.learned.length ? [`Now solid: ${f.learned.join(', ')}.`, ''] : []),
    ...(f.lessons.length ? ['| Lesson | Right | Finished |', '| --- | --- | --- |', ...f.lessons.map((l) => `| ${l.topic.replace(/\|/g, '/')} | ${l.right} of ${l.asked} | ${l.finished ? 'yes' : 'no'} |`), ''] : []),
    '## What’s fading',
    '',
    ...(f.fading.length ? f.fading.map((c) => `- ${c.name}: ${pct(c.estimate)} likely to recall today`) : ['_Nothing is fading._']),
    '',
    '## Misconceptions',
    '',
    ...(f.misconceptions.resolved.length ? f.misconceptions.resolved.map((x) => `- Resolved: ${x}`) : []),
    ...(f.misconceptions.open.length ? f.misconceptions.open.map((x) => `- Still open: ${x}`) : []),
    ...(!f.misconceptions.resolved.length && !f.misconceptions.open.length ? ['_None seen this week._'] : []),
    '',
    '## Time studied',
    '',
    `${hm(f.minutes)} in all.`,
    '',
    '```',
    ...f.days.map((d) => `${day(d.date)}  ${bar(d.minutes)} ${d.minutes ? hm(d.minutes) : ''}`.trimEnd()),
    '```',
    '',
    '## Mental maths',
    '',
    m.sessions
      ? `${m.sessions} session${m.sessions === 1 ? '' : 's'}${m.level ? ` at ${m.level}` : ''}: ${m.accuracy !== undefined ? `${pct(m.accuracy)} right${trend(m.accuracy, m.before?.accuracy)}` : ''}${m.avgSeconds !== undefined ? `, ${m.avgSeconds.toFixed(1)} s a question${trend(m.avgSeconds, m.before?.avgSeconds, true)}` : ''}.`
      : '_No mental maths this week._',
    '',
    '## Next week’s focus',
    '',
    prose.focus || fallbackFocus(f).focus!,
    ...(prose.focusTopics?.length ? ['', ...prose.focusTopics.map((t) => `- ${t}`)] : []),
    ''
  ]
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Prep's state, for Settings and the Ready card */
export interface PrepStatus {
  settings: PrepSettings
  ready: PreparedLesson | null
  waiting: number
  usedTonight: number
  last?: { at: number; decision: PrepDecision }
  lastWeekly?: number
  preparing: boolean
}
