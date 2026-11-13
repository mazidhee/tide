import type { AgentStep, ChatEvent } from '@shared/types'
import { normalizePlan, phasesForTasks, planRequestNumbers, readPlan, setFrontmatterValue, shortDate, type StudyPlan } from '@shared/plan'
import { applyResourceChecks, outlineResources, parseOutline, serializeOutline, topicTitle } from '@shared/outline'
import { readText, writeText } from './vault'
import { addProject, getProject, thingsAvailable } from './things'
import { buildLink } from '@shared/deeplink'
import { complete as completeHere, extractJsonObject, friendlyError, streamDraft } from './ai'
import { planOnClaude } from './claudeEngine'

/** Plans are Claude's (the "hard" model, Opus by default) when Claude teaches; otherwise as before */
const complete: typeof completeHere = async (prompt, system, signal, priority, task, routine, schema) =>
  (task === 'planning' ? await planOnClaude(prompt, system, signal) : null) ?? completeHere(prompt, system, signal, priority, task, routine, schema)
import { readWebpage, webSearch } from './agent'
import { getSettings } from './settings'
import { directionLine } from './coach'
import { noteUse } from './connectionUse'
import { subjectProfile } from './subjects'
import { roadmapGuidance } from '@shared/subjects'
import { ADJUSTED_PLAN_SCHEMA, PLAN_SCHEMA, READINGS_SCHEMA } from './replySchemas'
import { officialDocs, sameTitle } from '@shared/readings'

/**
 * Sizes a learning goal before any outline is written: research how people actually learn it and
 * how long it takes, then a plan of phases scaled to the subject, the learner and their hours.
 */

const safeJson = (text: string): Partial<StudyPlan> | null => {
  try {
    return extractJsonObject<Partial<StudyPlan>>(text)
  } catch {
    return null
  }
}

export interface PlanRequest {
  topic: string
  goal?: string
  hoursPerWeek: number
  /** A date to finish by, if the learner has one */
  deadline?: string
  start: string
}

const SKIP = /youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com|quora\.com/i

/** How far the learner wants to go, not what the subject is: never enough to call a page relevant */
const LEVEL_WORDS = new Set('beginning beginner beginners basic basics advanced level levels intermediate expert mastery master scratch zero complete full guide learn learning how long take does best books courses roadmap'.split(' '))

/** A page whose title or address names the subject itself ("Python" for "Python from the beginning to an advanced level") */
export function aboutSubject(topic: string, text: string): boolean {
  const want = [...words(topic)].filter((w) => !LEVEL_WORDS.has(w))
  if (!want.length) return true
  const have = words(text.replace(/[/_.-]+/g, ' '))
  return want.some((w) => have.has(w))
}

const CALIBRATION = `Calibrate the size to the subject, the learner and their hours (at about 6 hours a week):
- A single tool or product (Metabase, Docker, MongoDB, Git, Tableau, Airflow basics): 1 to 4 weeks, 2 to 3 phases.
- A practical skill or language (SQL to an advanced level, Python for data work, Kubernetes, React): 1 to 4 months.
- A discipline (distributed systems, machine learning, financial markets, stablecoins and payments infrastructure, philosophy of mind): 6 to 18 months.
- A career-level expertise (software engineering from scratch, building core banking systems, quant research): 2 to 4 years.
Shrink it for what the learner already knows; stretch it for fewer hours a week; fit it to their deadline if they give one, and say plainly in "why" if the deadline is unrealistic. Never pad: a tool must not get a multi-month plan.`

export async function sizePlan(req: PlanRequest, step: (s: AgentStep) => void, signal?: AbortSignal): Promise<{ plan: StudyPlan; research: string; sources: { title: string; url: string }[] }> {
  let research = ''
  const sources: { title: string; url: string }[] = []
  if (getSettings().ai.webSearch?.provider !== 'off') {
    step({ id: 'p1', kind: 'web_search', label: `Researching ${req.topic.replace(/^How to /, 'how to ')}`, status: 'running', depth: 0 })
    const queries = [`${req.topic} learning roadmap`, `how long does it take to learn ${req.topic}`, `${req.topic} best books courses official documentation`]
    const found = (await Promise.all(queries.map((q) => webSearch(q, { when: 'year' }).catch(() => webSearch(q).catch(() => []))))).flat().filter((r) => r.url)
    const seen = new Set<string>()
    const unique = found.filter((r) => !seen.has(r.url) && seen.add(r.url))
    step({ id: 'p1', kind: 'web_search', label: `Researching ${req.topic.replace(/^How to /, 'how to ')}`, status: 'done', detail: `${unique.length} results`, depth: 0 })
    step({ id: 'p2', kind: 'read_webpage', label: 'Reading the best guides', status: 'running', depth: 0 })
    const pages = (
      await Promise.all(
        unique
          .filter((r) => !SKIP.test(r.url) && aboutSubject(req.topic, `${r.title} ${r.url}`))
          .slice(0, 5)
          .map((r) =>
            readWebpage(r.url)
              .then((p) => ({ title: p.title || r.title, url: r.url, text: p.text.slice(0, 3000) }))
              .catch(() => null)
          )
      )
    )
      .filter((p): p is { title: string; url: string; text: string } => !!p && p.text.length > 400)
      .slice(0, 3)
    step({ id: 'p2', kind: 'read_webpage', label: 'Reading the best guides', status: 'done', detail: pages.map((p) => p.title).join(', ') || 'nothing readable', depth: 0 })
    sources.push(...pages.map((p) => ({ title: p.title, url: p.url })))
    const onSubject = unique.filter((r) => aboutSubject(req.topic, `${r.title} ${r.url}`))
    research = [onSubject.length ? `Search results:\n${onSubject.slice(0, 10).map((r) => `- ${r.title}: ${r.snippet}`).join('\n')}` : '', ...pages.map((p) => `Page "${p.title}" (${p.url}):\n${p.text}`)].filter(Boolean).join('\n\n---\n\n')
  }
  if (signal?.aborted) throw new Error('Stopped.')
  step({ id: 'p3', kind: 'helper', label: 'Sizing the plan', status: 'running', depth: 0 })
  const heading = await directionLine().catch(() => '')
  // Subject hook (any-subject, src/shared/subjects.ts): how this kind of subject is practised, phase by phase
  const subject = await subjectProfile(req.topic).catch(() => null)
  const guidance = subject ? roadmapGuidance(subject) : ''
  const prompt = `Plan how a learner gets from where they are to real expertise in: ${req.topic}
${req.goal?.trim() ? `Their goal and what they already know: ${req.goal.trim()}` : 'They did not say what they already know; assume a capable adult new to this subject.'}${heading ? `\n${heading} Pick phases, projects and exercises that serve that direction.` : ''}
They can study about ${req.hoursPerWeek} hours a week, starting ${req.start}.${req.deadline ? ` They want to finish by ${req.deadline}.` : ''}

${CALIBRATION}

Split it into 2 to 8 phases in a sensible order, each ending in something they can do and a project that proves it, with 2 or 3 concrete practice exercises along the way (specific problems to solve, things to build or derive, not "practise X").${guidance ? `\n${guidance}` : ''}
${research ? `Use this research for what the subject covers and how long it really takes:\n\n${research}\n` : ''}
First decide the scope honestly: "tool" for one product or technology (Metabase, MongoDB, Docker, Git, Excel), "skill" for a broader ability or language, "discipline" for a whole field, "career" only for becoming a professional in a large field from scratch.
Return ONLY JSON:
{"scope": "tool|skill|discipline|career", "coding": true, "why": "one or two sentences on why this length, for this learner", "phases": [{"title": "short phase name", "weeks": 2, "outcome": "what they can do at the end", "project": "a concrete project for this phase", "practice": ["a specific exercise", "another"]}]}
"coding" is true only when the exercises are programming.`
  const system = 'You are a senior engineer and teacher who plans realistic, specific learning paths.'
  let out = await complete(prompt, system, signal, 'interactive', 'planning', false, PLAN_SCHEMA)
  // A small model sometimes wraps or breaks the JSON: ask once more, strictly
  if (!normalizePlan(safeJson(out), req.hoursPerWeek)) out = await complete(`${prompt}\n\nYour last reply was not valid JSON. Reply with the JSON object only, nothing before or after it.`, system, signal, 'interactive', 'planning', false, PLAN_SCHEMA)
  const maxWeeks = req.deadline ? Math.max(1, (new Date(req.deadline).getTime() - new Date(req.start).getTime()) / (7 * 86_400_000)) : undefined
  const normal = normalizePlan(safeJson(out), req.hoursPerWeek, maxWeeks)
  const plan = normal && subject?.kinds.length ? { ...normal, subject: subject.kinds } : normal
  if (!plan) {
    step({ id: 'p3', kind: 'helper', label: 'Sizing the plan', status: 'error', depth: 0 })
    throw new Error("The planner didn't return a plan. Try again.")
  }
  step({ id: 'p3', kind: 'helper', label: 'Sizing the plan', status: 'done', detail: `${plan.phases.length} phases, ${plan.weeks} weeks`, depth: 0 })
  return { plan, research, sources }
}

/**
 * Changes a sized plan the way the learner asks ("finish by June", "I can do 10 hours", "skip the
 * compliance phase", "more projects"): the current plan goes back to the planner with the request,
 * and the answer is held to the same limits as a new plan, with any deadline they name enforced.
 */
export async function adjustPlan(req: PlanRequest & { plan: StudyPlan; request: string }, signal?: AbortSignal): Promise<StudyPlan> {
  const heading = await directionLine().catch(() => '')
  const prompt = `This is a learner's study plan for: ${req.topic}
${req.goal?.trim() ? `Their goal and what they know: ${req.goal.trim()}\n` : ''}${heading ? `${heading}\n` : ''}It starts ${req.start}, at ${req.plan.hoursPerWeek} hours a week, ${req.plan.weeks} weeks in all:
${JSON.stringify({ scope: req.plan.scope, coding: !!req.plan.coding, why: req.plan.why, phases: req.plan.phases })}

They ask: "${req.request.trim()}"

Change the plan to do what they ask, and keep everything they didn't ask to change. If they want to finish sooner, first cut, merge or shorten what matters least, and raise the hours a week only if they offered more time; if it then isn't realistic, keep it as close as you can and say so in "why". Put the hours a week you plan for in "hoursPerWeek". In "why", say in one or two sentences what changed.
Return ONLY JSON in the same shape: {"scope": "...", "coding": true, "hoursPerWeek": 6, "why": "...", "phases": [{"title": "...", "weeks": 2, "outcome": "...", "project": "...", "practice": ["..."]}]}`
  const system = 'You are a senior engineer and teacher who plans realistic, specific learning paths.'
  let out = await complete(prompt, system, signal, 'interactive', 'planning', false, ADJUSTED_PLAN_SCHEMA)
  let raw = safeJson(out) as (Partial<StudyPlan> & { hoursPerWeek?: number }) | null
  if (!raw?.phases) {
    out = await complete(`${prompt}\n\nYour last reply was not valid JSON. Reply with the JSON object only.`, system, signal, 'interactive', 'planning', false, ADJUSTED_PLAN_SCHEMA)
    raw = safeJson(out) as typeof raw
  }
  const asked = planRequestNumbers(req.request)
  const hours = asked.hoursPerWeek ?? Math.max(1, Math.min(60, Number(raw?.hoursPerWeek) || req.hoursPerWeek))
  const maxWeeks = req.deadline ? Math.max(1, (new Date(req.deadline).getTime() - new Date(req.start).getTime()) / (7 * 86_400_000)) : undefined
  const plan = normalizePlan(raw, hours, maxWeeks, asked.weeks)
  if (!plan) throw new Error("The planner couldn't change the plan that way. Try saying it differently.")
  return req.plan.subject ? { ...plan, subject: req.plan.subject } : plan
}

// ---------- Things 4 ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Sends a dated roadmap to Things 4: one project, a heading per phase, a to-do per chapter (its
 * topics as the checklist, starting on the phase's first day, due on its last), then the phase's
 * project and exam. The project's id is kept in the roadmap so progress can come back.
 */
export async function planToThings(outlinePath: string, name: string, notebook?: string): Promise<{ project: string; todos: number }> {
  const md = await readText(outlinePath)
  const stored = readPlan(md)
  if (!stored) throw new Error('This roadmap has no dates yet. Plan it with New topic to schedule it.')
  if (stored.thingsProject && (await getProject(stored.thingsProject))) throw new Error('This plan is already in Things 4.')
  const phases = phasesForTasks(md, stored, (t) => topicTitle(t))
  const study = notebook ? `\n\n[Study it in Tide](${buildLink({ to: 'notebook', path: notebook })})` : ''
  const sections = phases.map((p) => ({
    heading: `${p.heading.replace(/\s+[—–]\s+\d.*$/, '')} (${shortDate(p.start)} to ${shortDate(p.end)})`,
    todos: [
      ...p.chapters
        .filter((c) => c.topics.length)
        .map((c) => ({ title: c.title, checklist: c.topics.slice(0, 50), when: p.start, deadline: p.end, notes: `Part of **${p.heading.replace(/\s+[—–]\s+\d.*$/, '')}** in your ${name} roadmap. Tick each topic as you learn it; Tide ticks it in your roadmap too.${study}` })),
      ...p.practice.map((x) => ({ title: `Practice: ${x}`.slice(0, 250), when: p.start, deadline: p.end, tags: ['practice'], notes: `An exercise for this phase. Work it through, then ask the tutor in Tide to check it.\n\n[Open Practice in Tide](${buildLink({ to: 'practice' })})` })),
      ...(p.project ? [{ title: `Project: ${p.project}`.slice(0, 250), when: p.start, deadline: p.end, tags: ['project'], notes: `The project that proves this phase. Build it, write a short README, and ask the tutor in Tide to review it.${study}` }] : []),
      {
        title: p.exam ?? `Exam: ${p.heading}`,
        when: p.end,
        deadline: p.end,
        tags: ['exam'],
        notes: `The end-of-phase exam, written from your notes and marked part by part.\n\n[Sit it in Tide](${buildLink({ to: 'exam', topic: p.heading.replace(/^Phase \d+:\s*/i, '').replace(/\s+[—–]\s+\d.*$/, ''), ...(notebook ? { scope: `folder:${notebook}` } : {}), style: 'university', questions: 5, minutes: 45 })})`
      }
    ]
  }))
  const end = phases[phases.length - 1]?.end
  const project = await addProject({ title: `Learn ${name}`, notes: `Planned in Tide. Roadmap: ${outlinePath}`, deadline: end, sections })
  await writeText(outlinePath, setFrontmatterValue(await readText(outlinePath), 'things_project', project.id))
  return { project: project.id, todos: sections.reduce((n, s) => n + s.todos.length, 0) }
}

/**
 * Brings progress back from Things 4: a ticked checklist step ticks its topic, a finished chapter
 * to-do ticks all its topics, and a finished project or exam ticks that line. Only ever ticks.
 */
export async function syncFromThings(outlinePath: string): Promise<number> {
  const md = await readText(outlinePath)
  const stored = readPlan(md)
  if (!stored?.thingsProject || !(await thingsAvailable())) return 0
  const project = await getProject(stored.thingsProject)
  if (!project) return 0
  const done = new Set<string>()
  const finishedChapters = new Set<string>()
  for (const t of project['to-dos'] ?? []) {
    if (t.status === 'completed') {
      if (/^(Project|Exam):/i.test(t.title)) done.add(norm(t.title))
      else finishedChapters.add(norm(t.title))
    }
    for (const c of t.checklist ?? []) if (c.completed || t.status === 'completed') done.add(norm(c.title))
  }
  const outline = parseOutline(md)
  let chapter = ''
  let ticked = 0
  outline.lines = outline.lines.map((l) => {
    if (l.kind === 'heading' && l.level >= 3) chapter = norm(l.text)
    if (l.kind !== 'item' || l.checked !== false) return l
    const key = norm(topicTitle(l.text))
    const exact = norm(l.text.replace(/\s*\(by [^)]*\)\s*$/, ''))
    if (done.has(key) || done.has(exact) || [...done].some((d) => d.startsWith(exact) && exact.length > 12) || finishedChapters.has(chapter)) {
      ticked++
      return { ...l, checked: true }
    }
    return l
  })
  if (ticked) await writeText(outlinePath, serializeOutline(outline))
  return ticked
}

// ---------- Auditing a roadmap ----------

/** The roadmap's shape in a few hundred words: sections, chapters, topic counts and progress */
export function roadmapSummary(md: string): { text: string; topics: number; done: number } {
  const { lines } = parseOutline(md)
  let topics = 0
  let done = 0
  const parts: { title: string; chapters: string[]; topics: number; done: number; samples: string[] }[] = []
  for (const l of lines) {
    if (l.kind === 'heading' && l.level <= 2) parts.push({ title: l.text, chapters: [], topics: 0, done: 0, samples: [] })
    else if (l.kind === 'heading' && parts.length) parts[parts.length - 1].chapters.push(l.text)
    else if (l.kind === 'item' && l.checked !== null) {
      topics++
      if (l.checked) done++
      const p = parts[parts.length - 1]
      if (p) {
        p.topics++
        if (l.checked) p.done++
        if (p.samples.length < 4) p.samples.push(topicTitle(l.text))
      }
    }
  }
  const text = parts
    .filter((p) => p.topics || p.chapters.length)
    .map((p) => `## ${p.title} (${p.done}/${p.topics} done)\n   chapters: ${p.chapters.slice(0, 14).join('; ')}${p.chapters.length > 14 ? `; …${p.chapters.length - 14} more` : ''}\n   e.g. ${p.samples.join('; ')}`)
    .join('\n')
  return { text, topics, done }
}

/** Streams a frank review of a roadmap: how long it really is, order, gaps, what to cut, what next */
export async function auditRoadmap(id: string, outlinePath: string, hoursPerWeek: number, emit: (e: ChatEvent) => void) {
  try {
    const md = await readText(outlinePath)
    const { text, topics, done } = roadmapSummary(md)
    const hours = Math.round((topics - done) * 2.5)
    const prompt = `Audit this learning roadmap like a demanding senior engineer and teacher. The learner studies about ${hoursPerWeek} hours a week. It has ${topics} topics (${done} done); at about 2.5 hours a topic that's roughly ${hours} hours, or ${Math.round(hours / Math.max(1, hoursPerWeek))} weeks, left.

${text}

Write the audit in Markdown with these sections, specific to this roadmap (name sections and topics):
## Verdict
Two or three sentences: is it realistic at their pace, and is it the right size for the goal?
## Order
Prerequisites that come too late, or sections that should run in parallel.
## Gaps
Important topics, projects or practice that are missing for the goal this roadmap implies.
## Cut or defer
What to drop or move to "later" so the core path gets done.
## Next four weeks
A concrete plan: which sections and topics, and one project.`
    const system = 'You review learning plans frankly and specifically. No filler.'
    const signal = new AbortController().signal
    const { draftWithClaude } = await import('./claudeEngine')
    for await (const t of draftWithClaude(system, prompt, 'background', signal, () => streamDraft([{ role: 'system', content: system }, { role: 'user', content: prompt }], signal, 2000, 'planning'), 'planAudit')) {
      emit({ id, type: 'delta', text: t })
    }
    emit({ id, type: 'done' })
  } catch (e) {
    emit({ id, type: 'error', message: friendlyError(e) })
  }
}

// ---------- Readings ----------

/**
 * The books and docs a drafted roadmap names under its chapters, checked before it is saved: a
 * real one keeps its line (with its real author), one that can't be found is left out. A small
 * model invents plausible titles and co-authors; a roadmap must not pass them on as fact.
 */
export async function checkOutlineResources(md: string): Promise<string> {
  const found = outlineResources(md)
  if (!found.length) return md
  const items = found.map((f) => ({ ...f }) as { line: number; title: string; by?: string; url?: string; unverified?: boolean })
  await verifyItems(items)
  return applyResourceChecks(md, items.map((x) => ({ line: x.line, title: x.title, ...(x.by ? { by: x.by } : {}), ok: !!x.url && !x.unverified })))
}

export interface PhaseReadings {
  phase: string
  items: { title: string; by?: string; why?: string; url?: string; unverified?: boolean }[]
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3))

/** Most of the title's words appear in the result (and, for a short result title, most of its words are the title's) */
const matches = (want: Set<string>, text: string, strict = false) => {
  const got = words(text)
  const shared = [...want].filter((w) => got.has(w)).length
  return want.size > 0 && shared / want.size >= 0.6 && (!strict || shared / Math.max(1, got.size) >= 0.6)
}

/** A paper on arXiv by its exact title */
async function findPaper(title: string): Promise<{ title: string; url: string }[]> {
  noteUse('arxiv')
  const q = encodeURIComponent(`ti:"${title.replace(/["]/g, '')}"`)
  const res = await fetch(`https://export.arxiv.org/api/query?search_query=${q}&max_results=3`, { headers: { 'User-Agent': 'Tide/0.1 (local study app)' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`arXiv answered ${res.status}`)
  const xml = await res.text()
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    title: (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s+/g, ' ').trim(),
    url: (e.match(/<id>([^<]+)<\/id>/)?.[1] ?? '').replace(/^http:/, 'https:')
  }))
}

/** arXiv asks for about one request every three seconds */
let arxivGate: Promise<unknown> = Promise.resolve()
const politeArxiv = (q: string) => {
  const run = arxivGate.then(() => findPaper(q))
  arxivGate = run.catch(() => null).then(() => new Promise((r) => setTimeout(r, 3100)))
  return run
}
const looksLikePaper = (item: { title: string; by?: string; why?: string }) => /\bet al\b|paper|arxiv/i.test(`${item.by ?? ''} ${item.why ?? ''}`)

/** Books in Open Library's free catalogue (with their real authors): null if it couldn't be asked */
async function findBook(title: string, by?: string): Promise<{ url: string; authors: string[] } | false | null> {
  noteUse('openlibrary')
  const lookup = async (author?: string) => {
    const q = new URLSearchParams({ title, limit: '5', fields: 'key,title,author_name' })
    if (author) q.set('author', author)
    const res = await fetch(`https://openlibrary.org/search.json?${q}`, { headers: { 'User-Agent': 'Tide/0.1 (local study app)' }, signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (!res?.ok) return null
    const data = (await res.json().catch(() => null)) as { docs?: { key: string; title: string; author_name?: string[] }[] } | null
    if (!data) return null
    const hit = data.docs?.find((d) => matches(words(title), d.title))
    return hit ? { url: `https://openlibrary.org${hit.key}`, authors: hit.author_name ?? [] } : false
  }
  const author = by?.split(/,| and |&/)[0].replace(/\bet al\.?/i, '').trim()
  const first = await lookup(author || undefined)
  // A real book with the wrong author named: found by its title alone, and credited to its real author
  if (first === false && author) return lookup()
  return first
}

/** The named author shares a surname with one of the book's real authors */
const sameAuthor = (by: string, authors: string[]) => {
  const named = words(by)
  return authors.some((a) => [...words(a)].some((w) => named.has(w)))
}

/**
 * Looks each resource up: books in Open Library, papers on arXiv, anything else on the web. A
 * real one gets a link; one is marked unverified only when the lookups answered and none matched,
 * never because a search engine was down.
 */
async function verifyReadings(phases: PhaseReadings[]): Promise<PhaseReadings[]> {
  await verifyItems(phases.flatMap((p) => p.items))
  return phases
}

/** Gives each real resource its link (in place); `unverified` when the web answered and nothing matched */
export async function verifyItems<T extends { title: string; by?: string; why?: string; url?: string; unverified?: boolean }>(items: T[]): Promise<T[]> {
  const webOn = getSettings().ai.webSearch?.provider !== 'off'
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      const want = words(item.title)
      // A paper on arXiv, a book in Open Library, then the web. Only the web can say "not found":
      // the others only know their own kind of thing
      // The makers' own documentation goes to the documentation itself
      const docs = officialDocs(item as { title: string; by?: string; kind?: string })
      if (docs) {
        item.url = docs.url
        item.by = docs.by
        continue
      }
      const book = await findBook(item.title, item.by).catch(() => null)
      if (book) {
        item.url = book.url
        if (book.authors.length && (!item.by || !sameAuthor(item.by, book.authors))) item.by = book.authors.slice(0, 2).join(' and ')
        continue
      }
      if (looksLikePaper(item)) {
        const paper = (await politeArxiv(item.title).catch(() => null))?.find((r) => r.url && matches(want, r.title, true))
        if (paper) {
          item.url = paper.url
          continue
        }
      }
      if (!webOn) continue
      // The page that is this reading, by its title: a page that only mentions its words is not it
      const results = await webSearch(`${item.title} ${item.by ?? ''}`.trim()).catch(() => null)
      const hit = results?.find((r) => r.url && sameTitle(item.title, r.title))
      if (hit) item.url = hit.url
      else if (results && results.length >= 3) item.unverified = true
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return items
}

/**
 * What to read in each phase: a dedicated step, so a reading list never depends on the outline
 * writer remembering its resource lines. Only well-known, real resources; research pages help.
 */
export async function planReadings(topic: string, plan: StudyPlan, research: string): Promise<PhaseReadings[]> {
  const prompt = `A learner is following this plan to learn: ${topic}
${plan.phases.map((p, i) => `${i + 1}. ${p.title}: ${p.outcome}`).join('\n')}

For each phase, name 2 to 4 of the best real resources to read or work through: well-known books (with authors), courses, official documentation, landmark papers or widely used tutorials. Never invent a title; if unsure, prefer official docs.
${research ? `Research that may help:\n${research.slice(0, 6000)}\n` : ''}
Return ONLY JSON: {"phases": [{"phase": 1, "items": [{"title": "...", "by": "author or publisher", "why": "what it's for, in a few words"}]}]}`
  const read = (text: string) => {
    try {
      return extractJsonObject<{ phases?: { phase?: number; items?: { title?: string; by?: string; why?: string }[] }[] }>(text).phases ?? []
    } catch {
      return []
    }
  }
  let phases = read(await complete(prompt, 'You recommend real, well-known learning resources. You never make up titles.', undefined, 'interactive', 'planning', false, READINGS_SCHEMA))
  if (!phases.length) phases = read(await complete(`${prompt}\n\nReply with the JSON object only.`, undefined, undefined, 'interactive', 'planning', false, READINGS_SCHEMA))
  return verifyReadings(plan.phases.map((p, i) => ({
    phase: p.title,
    items: (phases.find((x) => Number(x.phase) === i + 1)?.items ?? phases[i]?.items ?? [])
      .filter((x) => x && typeof x.title === 'string' && x.title.trim())
      .slice(0, 5)
      .map((x) => ({ title: String(x.title).trim().slice(0, 160), ...(x.by ? { by: String(x.by).trim().slice(0, 100) } : {}), ...(x.why ? { why: String(x.why).trim().slice(0, 160) } : {}) }))
  })))
}
