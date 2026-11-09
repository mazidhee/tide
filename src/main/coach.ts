import { promises as fs } from 'fs'
import { aimOf, thingsTitle, DEFAULT_COACH, localDate, moveUnfinished, nextStudyDay, nextTopics, planCompletion, validateWeek, weekMarkdown, type AgendaItem, type CoachSettings, type DayStats, type JournalEntry, type TopicCandidate, type WeekReview, type WeekPlan } from '@shared/coach'
import { companyTrend } from '@shared/interviews'
import { buildLink } from '@shared/deeplink'
import { complete, extractJsonObject } from './ai'
import { focusLog, getGoals, getMastery, getNotebooks, listDrills, listInterviews, studyEvents } from './learn'
import { listMemories } from './memory'
import { listMistakes } from './mistakes'
import { getCards } from './study'
import { addProject, ensureArea, getProject, searchTasks, thingsAvailable, TIDE_TAG, updateTask } from './things'
import { absPath, joinRel, readText, writeText } from './vault'
import { planReadings } from './planner'
import { pagesToRead } from './books'
import { readingLabel } from '@shared/books'

/**
 * The coach plans your week towards your goal and keeps a short learner profile.
 *
 * Context stays small on purpose: the model never sees your whole history. Code gathers the
 * facts that matter (next topics in each focus roadmap, weak spots, what's due) into a page of
 * text, and the profile is a short note rewritten from your data each week. That note is all the
 * tutor carries into every chat, so prompts stay short and the local model stays quick.
 */

const SETTINGS = joinRel('.tide', 'coach.json')
const WEEKS = joinRel('.tide', 'coach')
export const COACH_FOLDER = 'Coach'
export const PROFILE_NOTE = `${COACH_FOLDER}/Learner profile.md`
export const WEEK_NOTE = `${COACH_FOLDER}/This week.md`

const today = () => localDate()

export async function getCoach(): Promise<CoachSettings> {
  try {
    return { ...DEFAULT_COACH, ...JSON.parse(await readText(SETTINGS)) }
  } catch {
    return { ...DEFAULT_COACH }
  }
}

export async function saveCoach(s: CoachSettings): Promise<CoachSettings> {
  const clean: CoachSettings = {
    goal: String(s.goal ?? '').trim().slice(0, 500),
    focus: (Array.isArray(s.focus) ? s.focus : []).map(String).filter(Boolean).slice(0, 6),
    hoursPerWeek: Math.max(1, Math.min(60, Math.round(Number(s.hoursPerWeek) || 10))),
    days: (Array.isArray(s.days) ? s.days : DEFAULT_COACH.days).map(Number).filter((d) => d >= 0 && d <= 6),
    ...(s.direction ? { direction: String(s.direction).trim().slice(0, 500), directionAt: Number(s.directionAt) || Date.now() } : {})
  }
  if (!clean.days.length) clean.days = DEFAULT_COACH.days
  await writeText(SETTINGS, JSON.stringify(clean, null, 2))
  return clean
}

const weekFile = (start: string) => joinRel(WEEKS, `week-${start}.json`)

/** The plan covering a date: the newest one whose seven days include it */
export async function getWeek(date = today()): Promise<WeekPlan | null> {
  const names = await fs.readdir(absPath(WEEKS)).catch(() => [] as string[])
  const plans: WeekPlan[] = []
  for (const n of names.filter((x) => /^week-\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    const start = n.slice(5, 15)
    const end = new Date(start + 'T12:00:00Z')
    end.setUTCDate(end.getUTCDate() + 6)
    if (start <= date && date <= end.toISOString().slice(0, 10)) {
      const p = await readText(joinRel(WEEKS, n)).then((t) => JSON.parse(t) as WeekPlan).catch(() => null)
      if (p) plans.push(p)
    }
  }
  return plans.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

/** The newest plan of all, whatever dates it covers */
async function latestPlan(): Promise<WeekPlan | null> {
  const names = (await fs.readdir(absPath(WEEKS)).catch(() => [] as string[])).filter((x) => /^week-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()
  const n = names.pop()
  return n ? readText(joinRel(WEEKS, n)).then((t) => JSON.parse(t) as WeekPlan).catch(() => null) : null
}

async function savePlan(plan: WeekPlan) {
  await fs.mkdir(absPath(WEEKS), { recursive: true })
  await writeText(weekFile(plan.weekStart), JSON.stringify(plan, null, 2))
  await writeText(WEEK_NOTE, weekMarkdown(plan))
}

/** The facts the coach plans from, as compact text (never the whole history) */
async function gather(settings: CoachSettings): Promise<{ text: string; candidates: TopicCandidate[] }> {
  const notebooks = await getNotebooks()
  const candidates: TopicCandidate[] = []
  const parts: string[] = []
  for (const name of settings.focus) {
    const nb = notebooks.find((n) => n.name === name || n.path === name)
    if (!nb?.outline) {
      parts.push(`${name}: no roadmap yet.`)
      continue
    }
    const md = await readText(nb.outline).catch(() => '')
    const next = nextTopics(nb.name, md, 14)
    const all = (md.match(/^\s*- \[[ xX]\] /gm) ?? []).length
    const done = (md.match(/^\s*- \[[xX]\] /gm) ?? []).length
    candidates.push(...next)
    parts.push(`${nb.name} roadmap: ${done} of ${all} topics done. Next, in order:\n${next.map((c) => `  - ${c.topic} (in ${c.section})`).join('\n')}`)
  }
  const mastery = await getMastery().catch(() => ({}) as Record<string, { level: string }>)
  const weak = Object.entries(mastery)
    .filter(([, m]) => m.level === 'weak' || m.level === 'shaky')
    .slice(0, 8)
    .map(([p, m]) => `${p.split('/').pop()?.replace(/\.md$/, '')} (${m.level})`)
  if (weak.length) parts.push(`Weak or shaky topics to revisit: ${weak.join(', ')}`)
  const cards = await getCards({ kind: 'vault' }).catch(() => [])
  const due = cards.filter((c) => c.schedule && c.schedule.due <= Date.now()).length
  if (due) parts.push(`Flashcards due: ${due}`)
  if (await thingsAvailable()) {
    const open = await searchTasks({ tag: TIDE_TAG, status: 'open', limit: 40 }).catch(() => [])
    const overdue = open.filter((t) => t.deadline && t.deadline < today())
    if (overdue.length) parts.push(`Overdue tasks: ${overdue.map((t) => `${t.title} (due ${t.deadline})`).join('; ')}`)
    if (open.length) parts.push(`Open tasks: ${open.length}`)
  }
  const interviews = await listInterviews().catch(() => [])
  const companies = [...new Set(interviews.map((i) => i.company))]
  for (const c of companies.slice(0, 3)) {
    const t = companyTrend(interviews, c)
    if (t.length) parts.push(`${c} mock interviews: ${t.map((r) => `${r.round} ${Math.round(r.last * 100)}%`).join(', ')}`)
  }
  const drills = await listDrills().catch(() => [])
  if (drills.length) parts.push(`Arithmetic sprint best: ${Math.max(...drills.filter((d) => d.kind === 'zetamac').map((d) => d.correct), 0)}`)
  // Deadlines you've set: the plan should keep each on pace, and catch up the ones behind
  const goals = await getGoals().catch(() => [])
  for (const g of goals) {
    const nb = notebooks.find((n) => n.path === g.notebook)
    const md = nb?.outline ? await readText(nb.outline).catch(() => '') : ''
    const left = (md.match(/^\s*- \[ \] /gm) ?? []).length
    const days = Math.ceil((Date.parse(g.deadline) - Date.now()) / 86_400_000)
    parts.push(`Goal "${g.name}" (${g.notebook}): ${left} topics left, deadline ${g.deadline} (${days >= 0 ? `${days} days away` : 'passed'}). Give it time this week in proportion to how tight that is.`)
  }
  const mistakes = (await listMistakes()).filter((m) => m.status === 'open')
  if (mistakes.length) parts.push(`Mistakes waiting to be retested: ${mistakes.length}, in ${[...new Set(mistakes.map((m) => m.topic))].slice(0, 5).join(', ')}. Plan a short "review" to retest them.`)
  // How the last plan went, and what it left undone, so the next one is the right size
  const last = await getWeek(today()).then((p) => p ?? latestPlan()).catch(() => null)
  if (last) {
    const { planned, done } = planCompletion(last, today())
    if (planned) parts.push(`Last plan so far: ${done} of ${planned} items done.${done / planned < 0.6 ? ' That plan was too much: plan less.' : ''}`)
    const undone = [...(last.carry ?? []), ...last.days.filter((d) => d.date < today()).flatMap((d) => d.items.filter((it) => !it.done))]
    if (undone.length) parts.push(`Unfinished from before (fit the important ones in first): ${undone.slice(0, 8).map((it) => it.topic ?? it.title).join('; ')}`)
  }
  const review = await latestReview()
  if (review) parts.push(`Their weekly review: went well: ${review.wentWell || '-'}; got in the way: ${review.inTheWay || '-'}; change: ${review.change || '-'}`)
  return { text: parts.join('\n'), candidates }
}

const DAY = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })

/**
 * Plans the week: what comes first and why, then each study day's agenda. Readings are looked up
 * (and checked) for the topics to learn. Saved as data and as a note you can edit.
 */
export async function planWeek(date = today(), background = false): Promise<WeekPlan> {
  const ask = (prompt: string, system: string) => complete(prompt, system, undefined, background ? 'background' : 'interactive')
  const settings = await getCoach()
  if (!settings.focus.length) throw new Error('Pick what to focus on first.')
  // The next seven days from today, so planning on a Sunday plans the coming week, not one day
  const start = date
  const { text, candidates } = await gather(settings)
  if (!candidates.length) throw new Error('Your focus notebooks have no roadmap topics left to plan from.')
  const studyDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  }).filter((d) => settings.days.includes(new Date(d + 'T12:00:00Z').getUTCDay()))
  const prompt = `You are coaching a learner towards this goal: ${aimOf(settings) || 'becoming strong in their focus subjects'}.
Focus, most important first: ${settings.focus.join(', ')}. They study about ${settings.hoursPerWeek} hours a week, on these days: ${studyDays.map((d) => `${DAY(d)} ${d}`).join(', ')}.

What you know about where they are:
${text}

Plan their week. First decide what comes first and why: weigh which topics unlock the others (prerequisites), what their goal needs most, weak spots that will hold them back, and anything overdue. Don't spread them thin: two subjects at most in a day, and keep each topic's order from its roadmap.
Each study day gets 2 to 5 items, about ${Math.round((settings.hoursPerWeek * 60) / Math.max(1, studyDays.length))} minutes in all:
- "learn": a roadmap topic, using its exact name from the lists above
- "practice": problems or coding on what they learned that week
- "quiz": a short quiz on something learned earlier in the week (spaced retrieval)
- "review": weak topics or due flashcards
- "take-home": one harder problem to think through, at most two a week
- "test": a short test on the week's topics, on the last study day
Return ONLY JSON:
{"summary": "2-4 sentences: the priorities this week and why, as you'd tell the learner", "priorities": [{"notebook": "...", "share": 60, "reason": "..."}], "days": [{"date": "yyyy-mm-dd", "items": [{"kind": "learn", "title": "...", "topic": "exact roadmap topic or omit", "notebook": "...", "minutes": 45, "why": "one line"}]}]}`
  const system = 'You are a thoughtful study coach. You plan realistic weeks that build towards a goal, and you explain your priorities plainly.'
  const read = (t: string) => {
    try {
      return validateWeek(extractJsonObject<Partial<WeekPlan>>(t), start, candidates, settings)
    } catch {
      return null
    }
  }
  let plan = read(await ask(prompt, system))
  if (!plan) plan = read(await ask(`${prompt}\n\nReply with the JSON object only. Every "learn" item must name a topic from the lists exactly.`, system))
  if (!plan) throw new Error("The coach couldn't put a week together. Try again.")
  // A subject the plan says matters (a fifth or more of the week) must actually get time
  const missing = plan.priorities.filter((p) => p.share >= 20 && !plan!.days.some((d) => d.items.some((i) => i.notebook === p.notebook)))
  if (missing.length) {
    const again = read(
      await ask(
        `${prompt}\n\nYour last plan gave ${missing.map((m) => `${m.notebook} ${m.share}%`).join(' and ')} of the week but scheduled nothing from ${missing.length > 1 ? 'them' : 'it'}. Plan again so each subject gets roughly its share of the minutes, using topics from its list.`,
        system
      )
    )
    if (again && !again.priorities.filter((p) => p.share >= 20).some((p) => !again.days.some((d) => d.items.some((i) => i.notebook === p.notebook)))) plan = again
  }
  // What to read for each topic this week (looked up and checked, so links are real)
  const learn = plan.days.flatMap((d) => d.items.filter((i) => i.kind === 'learn' && i.topic)).slice(0, 10)
  if (learn.length) {
    const readings = await planReadings(
      `${settings.focus.join(' and ')}`,
      { scope: 'skill', weeks: 1, hoursPerWeek: settings.hoursPerWeek, why: '', phases: learn.map((i) => ({ title: i.topic!, weeks: 1, outcome: `understand ${i.topic}` })) },
      ''
    ).catch(() => [])
    for (const [i, it] of learn.entries()) {
      // The pages in books you own come first, then what the web suggests
      const own = await pagesToRead(it.topic!, 1).catch(() => [])
      const web = readings[i]?.items.slice(0, own.length ? 1 : 2) ?? []
      const all = [...own.map((r) => ({ title: readingLabel(r), path: r.path, page: r.from })), ...web.map((x) => ({ title: x.title, ...(x.by ? { by: x.by } : {}), ...(x.url ? { url: x.url } : {}) }))]
      if (all.length) it.readings = all
    }
  }
  await fs.mkdir(absPath(WEEKS), { recursive: true })
  await writeText(weekFile(start), JSON.stringify(plan, null, 2))
  await writeText(WEEK_NOTE, weekMarkdown(plan))
  return plan
}

/**
 * Rewrites the learner profile: a short note in your vault (goal, focus, where you are, strengths,
 * weak spots, how you like to learn) that the tutor carries into every conversation instead of
 * your whole history. You can read and correct it like any note.
 */
export async function updateProfile(): Promise<string> {
  const settings = await getCoach()
  const { text } = await gather(settings)
  const previous = await readText(PROFILE_NOTE).catch(() => '')
  const prompt = `Write a learner profile a tutor will read before every conversation. Under 1000 characters, Markdown, these headings only: ## Goal, ## Focus, ## Where they are, ## Strengths, ## Weak spots, ## How they learn best.
Facts:
Goal: ${aimOf(settings) || 'not set'}
Focus: ${settings.focus.join(', ') || 'not set'}; ${settings.hoursPerWeek} hours a week
${text}
${previous ? `Their previous profile (keep what still holds, especially "How they learn best", which they may have edited):\n${previous.slice(0, 1500)}` : ''}
Only state what the facts support. Return the Markdown only.`
  const out = (await complete(prompt, 'You write short, precise learner profiles.')).replace(/^```(?:markdown)?\s*|\s*```$/g, '').trim()
  const note = `# Learner profile\n\n_Tide rewrites this each week from your progress. Edit anything that's wrong; your edits are kept._\n\n${out.replace(/^#\s+Learner profile\s*/i, '')}\n`
  await writeText(PROFILE_NOTE, note)
  return note
}

const DAY_MS = 86_400_000

/**
 * Where the learner is heading, worked out rather than asked: from what their notebooks and
 * roadmaps are about, their deadlines, what they've told the tutor to remember, what they've been
 * studying and how it's going. Also orders their focus when they haven't picked one. Redone at
 * most every few days, in the background.
 */
export async function inferDirection(force = false): Promise<CoachSettings> {
  const settings = await getCoach()
  if (!force && settings.direction && Date.now() - (settings.directionAt ?? 0) < 3 * DAY_MS) return settings
  const [notebooks, goals, memories, log, mastery, profile] = await Promise.all([
    getNotebooks().catch(() => []),
    getGoals().catch(() => []),
    listMemories().catch(() => []),
    focusLog(Date.now() - 30 * DAY_MS).catch(() => []),
    getMastery().catch(() => ({}) as Record<string, { level: string; path: string }>),
    readText(PROFILE_NOTE).catch(() => '')
  ])
  const books = notebooks.filter((n) => n.path !== COACH_FOLDER && !n.path.startsWith('.'))
  if (!books.length && !memories.length) return settings
  // Minutes on each notebook over the last month: what they actually spend time on
  const minutes = new Map<string, number>()
  for (const e of log) {
    const nb = books.find((b) => e.path && (e.path === b.path || e.path.startsWith(`${b.path}/`)))
    if (nb) minutes.set(nb.name, (minutes.get(nb.name) ?? 0) + e.minutes)
  }
  const strong = Object.values(mastery).filter((m) => m.level === 'solid' || m.level === 'mastered').length
  const weak = Object.values(mastery).filter((m) => m.level === 'weak' || m.level === 'shaky').length
  const facts = [
    `Notebooks: ${books.map((b) => `${b.name}${b.description ? ` (${b.description.slice(0, 140)})` : ''}${b.outline ? ', has a roadmap' : ''}${minutes.get(b.name) ? `, ${Math.round(minutes.get(b.name)! / 60)} h this month` : ''}`).join('; ')}`,
    goals.length ? `Deadlines: ${goals.map((g) => `${g.name} by ${g.deadline}`).join('; ')}` : '',
    memories.length ? `What they've told the tutor:\n${memories.slice(0, 30).map((m) => `- ${m.text}`).join('\n')}` : '',
    `Recent study topics: ${[...new Set(log.map((e) => e.label).filter(Boolean))].slice(0, 15).join('; ') || 'none logged'}`,
    `Answers so far: ${strong} topics solid, ${weak} weak or shaky`,
    settings.goal ? `What they wrote about their goal: ${settings.goal}` : '',
    profile ? `Their learner profile:\n${profile.slice(0, 1200)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
  const prompt = `From these facts about a self-directed learner, work out where they are heading.
${facts}

Return ONLY JSON: {"direction": "one or two plain sentences in the second person: the kind of engineer or expert they're becoming, the areas it spans, and what they're strong at (e.g. 'You're heading towards low-level software engineering for payments and data systems, with blockchain on the side; your maths and problem solving are your strengths.')", "focus": ["notebook names from the list, most important first, at most 4"]}
Only state what the facts support.`
  const out = await complete(prompt, 'You read a learner\'s situation accurately and say it plainly.', undefined, 'background').catch(() => '')
  let parsed: { direction?: string; focus?: string[] } = {}
  try {
    parsed = extractJsonObject(out)
  } catch {
    return settings
  }
  if (!parsed.direction?.trim()) return settings
  const names = new Set(books.map((b) => b.name))
  const focus = settings.focus.length ? settings.focus : (parsed.focus ?? []).filter((f) => names.has(f) && books.find((b) => b.name === f)?.outline)
  return saveCoach({ ...settings, direction: parsed.direction.trim(), directionAt: Date.now(), focus })
}

/**
 * Plans the week by itself when there's no plan for today (a new week, or the last one ran out),
 * once it knows what to focus on. Quietly does nothing otherwise; Plan again is always there.
 */
export async function autoPlanWeek(): Promise<WeekPlan | null> {
  const date = today()
  if (await getWeek(date)) return null
  let settings = await getCoach()
  if (!settings.focus.length) settings = await inferDirection()
  if (!settings.focus.length) return null
  const plan = await planWeek(date, true).catch(() => null)
  // The profile follows a new week, as when you plan it yourself
  if (plan) await updateProfile().catch(() => {})
  return plan
}

/** One line on where the learner is heading, for prompts that shape what to teach and how */
export async function directionLine(): Promise<string> {
  const aim = aimOf(await getCoach())
  return aim ? `Where this learner is heading: ${aim} Shape examples, projects and emphasis towards that, and skip what their strengths already cover.` : ''
}

/** The profile for the tutor's prompt: short, or nothing */
export async function profilePrompt(): Promise<string> {
  const note = await readText(PROFILE_NOTE).catch(() => '')
  const body = note.replace(/^# Learner profile\s*/i, '').replace(/^_[^\n]*_\s*/m, '').trim()
  const aim = aimOf(await getCoach())
  if (!body && !aim) return ''
  return `The learner's profile (use it to pitch and connect what you teach; don't recite it):\n${aim ? `Where they're heading: ${aim}\n` : ''}${body.slice(0, 1400)}`
}

const LINK_LABEL: Partial<Record<AgendaItem['kind'], string>> = { learn: 'Learn it in Tide', quiz: 'Quiz me in Tide', review: 'Review in Tide', test: 'Sit it in Tide', 'take-home': 'Open in Tide', practice: 'Open Practice in Tide' }

/** The week as one Things 4 project: a heading per day, each item a dated to-do with a brief and a link */
export async function weekToThings(date = today()): Promise<{ project: string; todos: number }> {
  const plan = await getWeek(date)
  if (!plan) throw new Error('Plan the week first.')
  if (plan.thingsProject) throw new Error('This week is already in Things 4.')
  await ensureArea()
  const sections = plan.days.map((d) => ({
    heading: new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }),
    todos: d.items.map((it) => {
      const scope = it.notebook ? `folder:${it.notebook}` : undefined
      const url =
        it.kind === 'learn' || it.kind === 'review'
          ? buildLink({ to: 'session', mode: 'teach', topic: it.topic ?? it.title, scope })
          : it.kind === 'quiz'
            ? buildLink({ to: 'session', mode: 'quiz', topic: it.topic ?? it.title, scope })
            : it.kind === 'test' || it.kind === 'take-home'
              ? buildLink({ to: 'exam', topic: it.title, scope, style: it.kind === 'take-home' ? 'problems' : 'university', questions: it.kind === 'take-home' ? 1 : 4, minutes: it.minutes })
              : buildLink({ to: 'practice' })
      const reading = it.readings?.length ? `\n\n**Read:**\n${it.readings.map((r) => `- ${r.url ? `[${r.title}](${r.url})` : r.title}${r.by ? `, ${r.by}` : ''}`).join('\n')}` : ''
      return {
        title: `${it.kind === 'learn' ? '' : `${it.kind[0].toUpperCase()}${it.kind.slice(1)}: `}${it.title}`.slice(0, 250),
        when: d.date,
        deadline: d.date,
        tags: [it.kind],
        notes: `${it.why ? `${it.why}\n\n` : ''}About ${it.minutes} minutes.${reading}\n\n[${LINK_LABEL[it.kind] ?? 'Open in Tide'}](${url})`
      }
    })
  }))
  const end = plan.days[plan.days.length - 1].date
  const project = await addProject({ title: `This week: ${plan.weekStart}`, notes: plan.summary, deadline: end, sections })
  plan.thingsProject = project.id
  await writeText(weekFile(plan.weekStart), JSON.stringify(plan, null, 2))
  return { project: project.id, todos: sections.reduce((n, s) => n + s.todos.length, 0) }
}

// ---------- The day: ticking things off, wrapping up, the journal ----------

/** Ticks an item off (or back on), and does the same to its to-do in Things 4 */
export async function setItemDone(date: string, index: number, done: boolean): Promise<WeekPlan | null> {
  const plan = await getWeek(date)
  const item = plan?.days.find((d) => d.date === date)?.items[index]
  if (!plan || !item) return plan
  item.done = done
  await savePlan(plan)
  const todo = await thingsTodo(plan, item).catch(() => null)
  if (todo) await updateTask(todo, { completed: done }).catch(() => {})
  return plan
}

/** The Things to-do made for a planned item, found by its title in the week's project */
async function thingsTodo(plan: WeekPlan, item: AgendaItem): Promise<string | null> {
  if (!plan.thingsProject || !(await thingsAvailable())) return null
  const project = await getProject(plan.thingsProject)
  return project?.['to-dos']?.find((t) => t.type === 'to-do' && t.title === thingsTitle(item))?.id ?? null
}

/** Items you ticked off in Things 4 count as done here too */
export async function syncDone(date = today()): Promise<WeekPlan | null> {
  const plan = await getWeek(date)
  if (!plan?.thingsProject || !(await thingsAvailable())) return plan
  const project = await getProject(plan.thingsProject).catch(() => null)
  const completed = new Set((project?.['to-dos'] ?? []).filter((t) => t.status === 'completed').map((t) => t.title))
  let changed = false
  for (const d of plan.days) for (const it of d.items) if (!it.done && completed.has(thingsTitle(it))) changed = it.done = true
  if (changed) await savePlan(plan)
  return plan
}

/** Moves what's left of a day to the next study day, here and in Things 4 */
export async function rollOver(date = today()): Promise<{ moved: number; to: string }> {
  const plan = await getWeek(date)
  if (!plan) return { moved: 0, to: date }
  const settings = await getCoach()
  const to = nextStudyDay(date, settings.days)
  const { plan: next, moved } = moveUnfinished(plan, date, to)
  if (!moved.length) return { moved: 0, to }
  await savePlan(next)
  if (plan.thingsProject && (await thingsAvailable())) {
    const project = await getProject(plan.thingsProject).catch(() => null)
    for (const it of moved) {
      const id = project?.['to-dos']?.find((t) => t.type === 'to-do' && t.title === thingsTitle(it) && t.status === 'open')?.id
      if (id) await updateTask(id, { when: to, deadline: to }).catch(() => {})
    }
  }
  return { moved: moved.length, to }
}

const notebookOf = (path?: string) => (path && path.includes('/') && !path.includes(':') ? path.split('/')[0] : undefined)

/** What a day held, from what you actually did (no model involved) */
export async function dayStats(date = today()): Promise<DayStats> {
  const events = (await studyEvents().catch(() => [])).filter((e) => localDate(new Date(e.at)) === date)
  const answers = events.filter((e) => e.kind === 'answer' || e.kind === 'problem')
  const plan = await getWeek(date)
  const items = plan?.days.find((d) => d.date === date)?.items ?? []
  const mistakes = (await listMistakes()).filter((m) => localDate(new Date(m.at)) === date).length
  const topics = [...new Set([...answers.map((e) => e.title), ...items.filter((it) => it.done && it.topic).map((it) => it.topic!)])].filter(Boolean).slice(0, 8)
  return {
    date,
    minutes: Math.round(events.filter((e) => e.kind === 'focus').reduce((n, e) => n + (e.minutes ?? 0), 0)),
    answers: answers.length,
    right: answers.filter((e) => (e.score ?? 0) >= 0.7).length,
    cards: events.filter((e) => e.kind === 'review').length,
    notes: [...new Set(events.filter((e) => e.kind === 'note').map((e) => e.title))].slice(0, 8),
    topics,
    mistakes,
    planned: items.length,
    done: items.filter((it) => it.done).length
  }
}

const JOURNAL = joinRel(WEEKS, 'journal.jsonl')
export const JOURNAL_NOTE = `${COACH_FOLDER}/Journal.md`


export async function journal(): Promise<JournalEntry[]> {
  const raw = await readText(JOURNAL).catch(() => '')
  const byDate = new Map<string, JournalEntry>()
  for (const l of raw.split('\n').filter(Boolean)) {
    try {
      const e = JSON.parse(l) as JournalEntry
      byDate.set(e.date, e)
    } catch {
      // A torn line: skip it
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const statLine = (s: DayStats) =>
  [s.minutes ? `${s.minutes} min focused` : '', s.answers ? `${s.right} of ${s.answers} answers right` : '', s.cards ? `${s.cards} cards` : '', s.planned ? `${s.done} of ${s.planned} planned done` : '']
    .filter(Boolean)
    .join(', ') || 'A quiet day'

/** Saves the day's line in the journal (one entry a day; writing again replaces it) */
export async function writeJournal(date: string, text: string): Promise<JournalEntry> {
  const entry: JournalEntry = { date, text: text.trim().slice(0, 2000), stats: await dayStats(date) }
  await fs.mkdir(absPath(WEEKS), { recursive: true })
  await fs.appendFile(absPath(JOURNAL), JSON.stringify(entry) + '\n')
  const all = await journal()
  const md = ['# Journal', '', '_One entry a day, from your evening wrap-up. Newest first._', '']
  for (const e of [...all].reverse()) {
    md.push(`## ${new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`, '', `_${statLine(e.stats)}_`, '')
    if (e.text) md.push(e.text, '')
  }
  await writeText(JOURNAL_NOTE, md.join('\n'))
  return entry
}

// ---------- The week in review ----------


const REVIEWS = `${COACH_FOLDER}/Reviews`
const reviewFile = (end: string) => joinRel(WEEKS, `review-${end}.json`)

/** The last seven days in numbers, for the weekly review */
export async function weekReview(end = today()): Promise<WeekReview> {
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(end + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 6 + i)
    return d.toISOString().slice(0, 10)
  })
  const days = await Promise.all(dates.map((d) => dayStats(d)))
  const events = (await studyEvents().catch(() => [])).filter((e) => dates.includes(localDate(new Date(e.at))))
  const by = new Map<string, { minutes: number; answers: number; right: number; notes: number }>()
  for (const e of events) {
    const nb = notebookOf(e.path)
    if (!nb || nb === COACH_FOLDER || nb === 'Exams') continue
    const row = by.get(nb) ?? { minutes: 0, answers: 0, right: 0, notes: 0 }
    if (e.kind === 'focus') row.minutes += e.minutes ?? 0
    if (e.kind === 'note') row.notes++
    if (e.kind === 'answer' || e.kind === 'problem') {
      row.answers++
      if ((e.score ?? 0) >= 0.7) row.right++
    }
    by.set(nb, row)
  }
  const mistakes = await listMistakes()
  const inWeek = (ms: number) => dates.includes(localDate(new Date(ms)))
  const saved = await readText(reviewFile(end)).then((t) => JSON.parse(t) as Partial<WeekReview>).catch(() => ({}) as Partial<WeekReview>)
  return {
    end,
    days,
    minutes: days.reduce((n, d) => n + d.minutes, 0),
    byNotebook: [...by.entries()].map(([notebook, r]) => ({ notebook, ...r, minutes: Math.round(r.minutes) })).sort((a, b) => b.minutes - a.minutes || b.answers - a.answers || b.notes - a.notes),
    planned: days.reduce((n, d) => n + d.planned, 0),
    done: days.reduce((n, d) => n + d.done, 0),
    mistakesAdded: mistakes.filter((m) => inWeek(m.at)).length,
    mistakesFixed: mistakes.filter((m) => m.status === 'fixed' && m.lastTried && dates.includes(m.lastTried)).length,
    journal: (await journal()).filter((j) => dates.includes(j.date)),
    wentWell: saved.wentWell,
    inTheWay: saved.inTheWay,
    change: saved.change
  }
}

/** Saves your reflections with the week's numbers, as data for the next plan and as a note */
export async function saveReview(end: string, r: { wentWell: string; inTheWay: string; change: string }): Promise<string> {
  const review = await weekReview(end)
  const clean = { wentWell: r.wentWell.trim().slice(0, 1500), inTheWay: r.inTheWay.trim().slice(0, 1500), change: r.change.trim().slice(0, 1500) }
  await fs.mkdir(absPath(WEEKS), { recursive: true })
  await writeText(reviewFile(end), JSON.stringify({ end, at: Date.now(), ...clean }, null, 1))
  const path = `${REVIEWS}/Week to ${end}.md`
  const md = [
    `# Week to ${new Date(end + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
    '',
    `${review.minutes ? `${Math.round(review.minutes / 6) / 10} hours focused. ` : ''}${review.days.reduce((n, d) => n + d.answers, 0)} answers, ${review.days.reduce((n, d) => n + d.cards, 0)} cards reviewed. ${review.done} of ${review.planned} planned items done. ${review.mistakesAdded} mistakes logged, ${review.mistakesFixed} put right.`,
    '',
    ...(review.byNotebook.length ? ['## By notebook', '', ...review.byNotebook.map((b) => `- **${b.notebook}**: ${[b.minutes ? `${b.minutes} min` : '', b.answers ? `${b.right} of ${b.answers} answers right` : '', b.notes ? `${b.notes} note${b.notes === 1 ? '' : 's'} written` : ''].filter(Boolean).join(', ')}`), ''] : []),
    '## What went well',
    '',
    clean.wentWell || '_Nothing written._',
    '',
    '## What got in the way',
    '',
    clean.inTheWay || '_Nothing written._',
    '',
    '## What to change',
    '',
    clean.change || '_Nothing written._',
    ''
  ]
  await writeText(path, md.join('\n'))
  return path
}

/** The newest review from the last eight days, for planning */
async function latestReview(): Promise<{ wentWell?: string; inTheWay?: string; change?: string } | null> {
  const names = (await fs.readdir(absPath(WEEKS)).catch(() => [] as string[])).filter((x) => /^review-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()
  const n = names.pop()
  if (!n) return null
  const end = n.slice(7, 17)
  if ((Date.parse(today()) - Date.parse(end)) / 86_400_000 > 8) return null
  return readText(joinRel(WEEKS, n)).then((t) => JSON.parse(t)).catch(() => null)
}
