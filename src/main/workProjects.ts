/**
 * Guided work projects, main side (shared/workProject has the format and the rules). The project
 * files are the learner's own, private, in their notes at Projects/Work/<slug>.md; the hidden parts
 * (the rubric and what was decided at each decision point) are read here and never sent to the
 * window until the learner has committed to an answer of their own. The tutor reaches them only
 * through the work_project tool, which enforces the same order.
 *
 * Where things are kept:
 * - Projects/Work/<slug>.md             the project (yours, private)
 * - Code/Work/<slug>/                   your workspace: the queries and pipelines you write
 * - Code/Work/<slug>/Summary.md         the summary written at the end
 * - .tide/work-projects/<slug>.json     where you are: the step, your answers, what was revealed
 */
import { ipcMain } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { askDecision, cardOf, commitDecision, newState, noteLearner, parseWorkProject, progressText, publicView, revealDecision, rubricFor, setStep, summaryMarkdown, workSlug, type WorkCard, type WorkProject, type WorkState, type WorkView } from '@shared/workProject'
import type { McpTool } from './tideMcp'
import { cardIndex, coverFor, lockDefence, noteBuilder, noteCheck, noteRun, setFinding, stepCards, tickCover, type FlightState } from '@shared/flightPlan'
import type { FlightApi, WorkRun } from '@shared/workProject'

export const WORK_DIR = 'Projects/Work'
const STATE_DIR = '.tide/work-projects'

async function vault() {
  return import('./vault')
}

/** Every project file in Projects/Work, read and checked */
export async function allWorkProjects(): Promise<{ project: WorkProject; path: string; problems: string[] }[]> {
  const { absPath } = await vault()
  let names: string[]
  try {
    names = await fs.readdir(absPath(WORK_DIR))
  } catch {
    return []
  }
  const out: { project: WorkProject; path: string; problems: string[] }[] = []
  for (const n of names.filter((x) => x.endsWith('.md') && !x.startsWith('.'))) {
    const rel = `${WORK_DIR}/${n}`
    const md = await fs.readFile(absPath(rel), 'utf8').catch(() => '')
    const { project, problems } = parseWorkProject(md, n.replace(/\.md$/, ''))
    if (project) out.push({ project, path: rel, problems })
  }
  return out.sort((a, b) => a.project.order - b.project.order || a.project.title.localeCompare(b.project.title))
}

export async function workProject(slug: string): Promise<WorkProject | null> {
  return (await allWorkProjects()).find((p) => p.project.slug === workSlug(slug))?.project ?? null
}

async function statePath(slug: string) {
  const { absPath } = await vault()
  return absPath(`${STATE_DIR}/${workSlug(slug)}.json`)
}

export async function readWorkState(slug: string): Promise<WorkState> {
  try {
    return { ...newState(workSlug(slug)), ...(JSON.parse(await fs.readFile(await statePath(slug), 'utf8')) as WorkState) }
  } catch {
    return newState(workSlug(slug), Date.now())
  }
}

async function saveState(s: WorkState) {
  const p = await statePath(s.slug)
  await fs.mkdir(join(p, '..'), { recursive: true })
  await fs.writeFile(p, JSON.stringify(s, null, 2))
}

/** The learner's workspace for a project, made on first open with a README of the brief */
export async function workspaceFor(slug: string): Promise<string> {
  const p = await workProject(slug)
  if (!p) throw new Error('That project isn’t in Projects/Work any more.')
  const { codeRoot } = await import('./ide/workspace')
  const code = codeRoot()
  if (!code) throw new Error('Open your notes folder first.')
  const root = join(code, 'Work', p.slug)
  await fs.mkdir(root, { recursive: true })
  const readme = join(root, 'README.md')
  if (!existsSync(readme)) await fs.writeFile(readme, `# ${p.title}\n\n${p.stakeholder ? `From ${p.stakeholder}:\n\n` : ''}${p.brief}\n\n## Steps\n\n${p.steps.map((s) => `${s.n}. **${s.title}**: ${s.task.replace(/\n+/g, ' ')}`).join('\n')}\n\nWrite each step's pipeline in its own file here (step1.js, step2.js…). Run them on the practice data.\n`)
  return root
}

// ---------- A lesson on a project ----------

/** Which project each lesson is on (its lab id), set each turn by main/claudeEngine */
const lessons = new Map<string, string>()
export const bindWorkLesson = (labId: string, slug: string) => lessons.set(labId, workSlug(slug))
export const workLessonOf = (labId: string | undefined) => (labId ? (lessons.get(labId) ?? null) : null)

/** A learner message in a lesson on this project: their next answer to an open decision */
export async function noteLearnerTurn(slug: string, said: string): Promise<void> {
  const s = await readWorkState(slug)
  await saveState(noteLearner(s, said, Date.now()))
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })

export const WORK_TOOL: McpTool = {
  name: 'work_project',
  description:
    'The guided work project this lesson is on. Actions: progress (brief, steps, decision points and where they are), ask_decision (id: before putting a decision question to them; then stop and wait), commit_decision (id: after they answer; records their own last message), reveal_decision (id: what was actually decided, why, and common wrong choices; only after commit), step_done (step: when a step is finished), rubric (what a good answer contains; only once every decision is answered, never pasted to them), builder (step: how their step’s pipeline maps onto Metabase’s query builder, what is native only and why, and the question they built there: its definition and how its result compared with their pipeline’s), check_card (step, card, file: their result against the finished dashboard’s real card, both run on the practice data: the same rows or which differ; the reference pipeline is never shown), write_summary (text: a short summary in their words at the end, saved in their notes).',
  inputSchema: obj(
    {
      action: { type: 'string', enum: ['progress', 'ask_decision', 'commit_decision', 'reveal_decision', 'step_done', 'rubric', 'builder', 'check_card', 'write_summary'] },
      card: { type: 'number', description: 'check_card: the card number in the project’s card reference' },
      file: { type: 'string', description: 'check_card: their file, e.g. step2.js' },
      id: { type: 'string', description: 'A decision id, e.g. D1' },
      step: { type: 'number' },
      text: { type: 'string' }
    },
    ['action']
  ),
  async run(args, ctx) {
    const slug = workLessonOf(ctx.labId)
    if (!slug) return 'This lesson isn’t on a guided work project.'
    const p = await workProject(slug)
    if (!p) return 'The project file is gone from Projects/Work.'
    let s = await readWorkState(slug)
    const now = Date.now()
    const id = String(args.id ?? '')
    const say = (label: string) => ctx.step({ kind: 'helper', label, status: 'done', depth: 0 })
    switch (args.action) {
      case 'progress':
        return progressText(p, s)
      case 'ask_decision': {
        const r = askDecision(p, s, id, now)
        if (r.error) return r.error
        await saveState(r.state)
        say(`Decision point: ${id.toUpperCase()}`)
        return `Put this to them in your own words, then stop and wait for their answer (no hints at the choice): ${r.ask}`
      }
      case 'commit_decision': {
        const r = commitDecision(p, s, id, now)
        if (r.error) return r.error
        await saveState(r.state)
        say(`Your answer to ${id.toUpperCase()} is kept`)
        return `Recorded their answer: “${r.state.committed[id.toUpperCase()]?.answer}”. Now call reveal_decision.`
      }
      case 'reveal_decision': {
        const r = revealDecision(p, s, id, now)
        if (r.error) return r.error
        await saveState(r.state)
        say(`Revealed what was decided for ${id.toUpperCase()}`)
        return r.text!
      }
      case 'step_done': {
        s = setStep(p, s, (Number(args.step) || s.step) + 1, now)
        await saveState(s)
        say(`Step ${Number(args.step) || s.step - 1} done`)
        return progressText(p, s)
      }
      case 'rubric': {
        const r = rubricFor(p, s)
        return r.error ?? r.text!
      }
      case 'builder':
        return builderReport(p.slug, Number(args.step) || s.step)
      case 'check_card': {
        const r = await checkReference(p.slug, Number(args.step) || s.step, Number(args.card), args.file ? String(args.file) : undefined).catch((e: Error) => ({ error: e.message }))
        if ('error' in r) return r.error
        say(`Checked against the real card ${Number(args.card)}`)
        return `Their result against the real card ${Number(args.card)} (“${r.name}”), both run on the practice data: ${r.comparison.match ? 'the same rows.' : `differs. ${r.comparison.why}`}${r.comparison.hints.length ? `\n${r.comparison.hints.join('\n')}` : ''}\nNever show them the reference pipeline; ask about the difference.`
      }
      case 'write_summary': {
        const text = String(args.text ?? '').trim()
        if (text.length < 40) return 'Write a real summary: what they built, their decisions and why, what to revisit.'
        const r = rubricFor(p, s)
        if (r.error) return r.error.replace('the rubric opens', 'the summary is written')
        const root = await workspaceFor(slug)
        const file = join(root, 'Summary.md')
        await fs.writeFile(file, summaryMarkdown(p, s, text, now))
        const { toRel } = await vault()
        s = { ...s, summary: toRel(file), updatedAt: now }
        await saveState(s)
        say('Wrote the summary in your notes')
        return `Saved to ${s.summary}.`
      }
      default:
        return 'Unknown action.'
    }
  }
}

// ---------- The project page ----------

async function viewOf(slug: string): Promise<WorkView> {
  const all = await allWorkProjects()
  const found = all.find((x) => x.project.slug === workSlug(slug))
  if (!found) throw new Error('That project isn’t in Projects/Work any more.')
  const s = await readWorkState(slug)
  const revealed: WorkView['revealed'] = {}
  for (const id of s.revealed) {
    const r = revealDecision(found.project, s, id)
    if (r.reveal) revealed[r.reveal.id] = { decided: r.reveal.decided, why: r.reveal.why, wrong: r.reveal.wrong }
  }
  return { project: publicView(found.project), state: s, revealed, path: found.path, problems: found.problems }
}

export async function listWork(): Promise<WorkCard[]> {
  const out: WorkCard[] = []
  for (const { project } of await allWorkProjects()) out.push(cardOf(project, await readWorkState(project.slug)))
  return out
}

/** The page's own decision box: their typed answer is committed, then the decision is revealed */
export async function answerOnPage(slug: string, id: string, answer: string): Promise<WorkView> {
  const p = await workProject(slug)
  if (!p) throw new Error('That project isn’t in Projects/Work any more.')
  const s = await readWorkState(slug)
  const c = commitDecision(p, s, id, Date.now(), answer)
  if (c.error) throw new Error(c.error)
  const r = revealDecision(p, c.state, id, Date.now())
  await saveState(r.state)
  return viewOf(slug)
}

// ---------- The flight plan (components/FlightPlan) ----------

const stepFileName = (n: number) => `step${Math.max(1, Math.round(n) || 1)}.js`

/** The step's file in their workspace: made with a two-line header if new (never a solution) */
async function stepFile(slug: string, n: number): Promise<{ root: string; file: string; abs: string }> {
  const p = await workProject(slug)
  if (!p) throw new Error('That project isn’t in Projects/Work any more.')
  const root = await workspaceFor(p.slug)
  const file = stepFileName(n)
  const abs = join(root, file)
  if (!existsSync(abs)) {
    const st = p.steps.find((x) => x.n === n)
    await fs.writeFile(abs, `// Step ${n}${st ? `: ${st.title}` : ''}\n// Your pipeline: db.<collection>.aggregate([ ... ])\n\n`)
  }
  return { root, file, abs }
}

async function practice() {
  const { practiceAuth } = await import('./practiceStack')
  const a = practiceAuth()
  if (!a) throw new Error('The practice data isn’t running. Start it in Settings › Practice data.')
  const { practiceClient } = await import('./metabase')
  return { a, c: practiceClient(a) }
}

/** One of their files in the workspace (a plain name ending .js), or the step's own */
async function pickFile(slug: string, n: number, name?: string): Promise<{ abs: string; file: string }> {
  const own = await stepFile(slug, n)
  if (!name || name === own.file) return own
  if (!/^[\w.-]+\.js$/.test(name)) throw new Error('Run a .js file from this project’s folder.')
  return { abs: join(own.root, name), file: name }
}

/** Runs the pipeline in the step's file (or another of theirs) on the practice data */
async function runStep(slug: string, n: number, name?: string): Promise<WorkRun> {
  const { abs, file } = await pickFile(slug, n, name)
  const text = await fs.readFile(abs, 'utf8')
  const { parsePipeline } = await import('@shared/mongoPipeline')
  const parsed = parsePipeline(text.replace(/^\s*\/\/.*$/gm, ''))
  if ('error' in parsed) return { columns: [], rows: [], error: parsed.error, ms: 0, file }
  if (!parsed.collection) return { columns: [], rows: [], error: 'Name the collection: db.<collection>.aggregate([...])', ms: 0, file }
  const { a, c } = await practice()
  const { queryRows } = await import('./metabase')
  const r = await queryRows({ database: a.databaseId, pipeline: { collection: parsed.collection, stages: parsed.stages } }, 200, c)
  return { ...r, file, collection: parsed.collection }
}

async function stepStages(slug: string, n: number, name?: string): Promise<{ stages: Record<string, unknown>[] } | { error: string }> {
  const { abs } = await pickFile(slug, n, name)
  const { parsePipeline } = await import('@shared/mongoPipeline')
  const parsed = parsePipeline((await fs.readFile(abs, 'utf8')).replace(/^\s*\/\/.*$/gm, ''))
  return 'error' in parsed ? { error: parsed.error } : { stages: parsed.stages }
}

async function cardOfPractice(id: number) {
  const { a, c } = await practice()
  const q = await c.get<{ id: number; name: string; database_id?: number; dataset_query?: unknown }>(`/api/card/${Math.round(id)}`)
  if (q.database_id !== undefined && q.database_id !== a.databaseId) throw new Error('That question isn’t on the practice data.')
  return q
}

/** For the tutor: the builder mapping of their step, and the question they built and how it compared */
async function builderReport(slug: string, n: number): Promise<string> {
  const { builderGuide, guideText, producesMetric } = await import('@shared/builderMap')
  const { mbqlText } = await import('@shared/flightPlan')
  const st = await stepStages(slug, n).catch((e: Error) => ({ error: e.message }))
  if ('error' in st) return `Their step ${n} file isn’t a pipeline yet: ${st.error}`
  const lines = [`Step ${n}: their pipeline in Metabase's query builder${producesMetric(st.stages) ? '' : ' (this step returns documents, not a metric)'}:`, guideText(builderGuide(st.stages))]
  const b = ((await readWorkState(slug)) as FlightState).builder?.[String(n)]
  if (b?.native) lines.push(`They marked the builder part native only: ${b.native}`)
  if (b?.card) {
    lines.push(`Their builder question: “${b.name}” (${b.match ? 'its result matches their pipeline' : `differs: ${b.why ?? ''}`}).`)
    const q = await cardOfPractice(b.card).catch(() => null)
    if (q) lines.push(`Its definition (MBQL):\n${mbqlText(q.dataset_query)}`)
    lines.push('Review it with them: explain the differences (the report time zone against $dateTrunc’s timezone, empty values kept as their own group, filters on relative dates) and ask why each one happens.')
  }
  return lines.join('\n\n')
}

// ---------- The real piece of work, as the reference ----------

type RefCard = { id: number; name: string; collection: string; stages: Record<string, unknown>[] }
const refCache = async (slug: string) => (await vault()).absPath(`.tide/work-references/${workSlug(slug)}.json`)

/**
 * The reference cards: the finished dashboard's native MongoDB questions (front matter `reference:`,
 * a dashboard id or address in your company Metabase, read once through its read-only client and
 * kept beside the project's state). Only names ever reach the window; the pipelines are run on the
 * practice data and compared, never shown.
 */
async function references(p: WorkProject): Promise<{ cards: RefCard[]; source: string } | null> {
  const file = await refCache(p.slug)
  const cached = await fs.readFile(file, 'utf8').then((t) => JSON.parse(t) as { cards: RefCard[]; source: string }).catch(() => null)
  if (cached?.cards?.length) return cached
  const id = /(?:dashboard\/)?(\d+)\s*$/.exec(p.reference ?? '')?.[1]
  if (!id) return null
  const { metabaseReady, readClient } = await import('./metabase')
  if (!metabaseReady()) return null
  const d = await readClient().get<{ name: string; dashcards?: { card?: { id: number; name: string; dataset_query?: unknown } }[] }>(`/api/dashboard/${id}`)
  const { nativeOf } = await import('@shared/flightPlan')
  const cards: RefCard[] = []
  for (const dc of d.dashcards ?? []) {
    const n = dc.card ? nativeOf(dc.card.dataset_query) : null
    if (!dc.card || !n?.collection || !n.query) continue
    try {
      cards.push({ id: dc.card.id, name: dc.card.name, collection: n.collection, stages: JSON.parse(n.query) as Record<string, unknown>[] })
    } catch {
      // a query Tide can't read as a pipeline: left out
    }
  }
  const out = { cards, source: `dashboard ${id}` }
  await fs.mkdir(join(file, '..'), { recursive: true })
  await fs.writeFile(file, JSON.stringify(out, null, 2))
  return out
}

/** Their result against the real card's pipeline, both run on the practice data */
async function checkReference(slug: string, n: number, num: number, file?: string) {
  const p = await workProject(slug)
  if (!p) throw new Error('That project isn’t in Projects/Work any more.')
  const name = cardIndex(p.rubric)[num]
  if (!name) throw new Error(`There’s no card ${num} in this project’s reference.`)
  const r = await references(p)
  const { matchCard, compareBuilder } = await import('@shared/flightPlan')
  const card = r ? matchCard(name, r.cards, Object.values(cardIndex(p.rubric))) : null
  if (!card) throw new Error(p.reference ? 'The real card couldn’t be read: connect your company Metabase in Settings › Connections once, and Tide keeps a copy.' : 'This project names no finished dashboard to check against (reference: in its front matter).')
  const { a, c } = await practice()
  const { queryRows } = await import('./metabase')
  const [mine, real] = await Promise.all([runStep(slug, n, file), queryRows({ database: a.databaseId, pipeline: { collection: card.collection, stages: card.stages } }, 200, c)])
  const comparison = compareBuilder(real, mine)
  await saveState(noteCheck((await readWorkState(slug)) as FlightState, num, n, { match: comparison.match, why: comparison.why }, Date.now()))
  return { comparison, name }
}

const flight: { [K in keyof FlightApi]: (...args: Parameters<FlightApi[K]>) => ReturnType<FlightApi[K]> } = {
  async finding(slug, n, text) {
    await saveState(setFinding((await readWorkState(slug)) as FlightState, n, String(text ?? ''), Date.now()))
    return viewOf(slug)
  },
  async stepDone(slug, n) {
    const p = await workProject(slug)
    if (!p) throw new Error('That project isn’t in Projects/Work any more.')
    const s = await readWorkState(slug)
    if (n >= s.step) await saveState(setStep(p, s, n + 1, Date.now()))
    return viewOf(slug)
  },
  async run(slug, n, file) {
    const run = await runStep(slug, n, file)
    await saveState(noteRun((await readWorkState(slug)) as FlightState, n, { rows: run.rows.length, ok: !run.error, file: run.file }, Date.now()))
    return { run, view: await viewOf(slug) }
  },
  async stepFile(slug, n) {
    const { root, file } = await stepFile(slug, n)
    return { root, file }
  },
  async guide(slug, n, file) {
    const { builderGuide, producesMetric } = await import('@shared/builderMap')
    const st = await stepStages(slug, n, file)
    if ('error' in st) return { guide: null, metric: false, error: st.error }
    return { guide: builderGuide(st.stages), metric: producesMetric(st.stages) }
  },
  async questions() {
    const { a, c } = await practice()
    const { nativeOf } = await import('@shared/flightPlan')
    const all = await c.get<{ id: number; name: string; database_id?: number; updated_at?: string; dataset_query?: unknown }[]>('/api/card?f=all')
    return all
      .filter((q) => q.database_id === a.databaseId)
      .sort((x, y) => String(y.updated_at ?? '').localeCompare(String(x.updated_at ?? '')))
      .slice(0, 8)
      .map((q) => ({ id: q.id, name: q.name, updated: String(q.updated_at ?? ''), builder: !nativeOf(q.dataset_query) }))
  },
  async compare(slug, n, card, file) {
    const { a, c } = await practice()
    const { queryRows } = await import('./metabase')
    const { compareBuilder, mbqlText } = await import('@shared/flightPlan')
    const q = await cardOfPractice(card)
    const [pipeline, mine] = await Promise.all([runStep(slug, n, file), queryRows({ database: a.databaseId, card: q.id }, 200, c)])
    const comparison = compareBuilder(pipeline, mine, { theirs: 'the builder’s', reference: 'your pipeline' })
    const builder = !(await import('@shared/flightPlan')).nativeOf(q.dataset_query)
    await saveState(noteBuilder((await readWorkState(slug)) as FlightState, n, { card: q.id, name: q.name, match: comparison.match, why: comparison.why }, Date.now()))
    return { comparison, mbql: mbqlText(q.dataset_query), builder, name: q.name, pipeline, question: { ...mine, file: `question ${q.id}` }, view: await viewOf(slug) }
  },
  async native(slug, n, why) {
    await saveState(noteBuilder((await readWorkState(slug)) as FlightState, n, { native: String(why ?? '').slice(0, 600) || 'The builder can’t express this step.' }, Date.now()))
    return viewOf(slug)
  },
  async defend(slug, k, answer) {
    const r = lockDefence((await readWorkState(slug)) as FlightState, k, String(answer ?? ''), Date.now())
    if (r.error) throw new Error(r.error)
    await saveState(r.state)
    return viewOf(slug)
  },
  async cover(slug, k) {
    const p = await workProject(slug)
    if (!p) throw new Error('That project isn’t in Projects/Work any more.')
    return coverFor(p, (await readWorkState(slug)) as FlightState, k)
  },
  async tick(slug, k, ticked) {
    await saveState(tickCover((await readWorkState(slug)) as FlightState, k, Array.isArray(ticked) ? ticked.map(Number).filter(Number.isInteger) : [], Date.now()))
    return viewOf(slug)
  },
  async refs(slug, n) {
    const p = await workProject(slug)
    if (!p) throw new Error('That project isn’t in Projects/Work any more.')
    const r = await references(p).catch(() => null)
    const st = p.steps.find((x) => x.n === n)
    const idx = cardIndex(p.rubric)
    const s = (await readWorkState(slug)) as FlightState
    const { matchCard } = await import('@shared/flightPlan')
    const names = Object.values(idx)
    const list = (st ? stepCards(st.task) : []).filter((num) => idx[num]).map((num) => ({ num, name: idx[num], available: !!(r && matchCard(idx[num], r.cards, names)), ...(s.checks?.[String(num)] ? { check: s.checks[String(num)] } : {}) }))
    return { cards: list, source: r ? r.source : p.reference ? 'unreachable' : 'none' }
  },
  async checkRef(slug, n, num, file) {
    const r = await checkReference(slug, n, num, file)
    return { comparison: r.comparison, name: r.name, view: await viewOf(slug) }
  },
  async openMetabase(path) {
    const { PRACTICE_URL } = await import('@shared/practiceStack')
    const clean = /^\/[\w/#?=&.-]*$/.test(String(path ?? '')) ? String(path) : '/'
    const { shell } = await import('electron')
    await shell.openExternal(`${PRACTICE_URL}${clean}`)
  }
}

export function registerWork(): void {
  for (const [name, fn] of Object.entries(flight)) ipcMain.handle(`work:${name}`, (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args))
  ipcMain.handle('work:list', () => listWork())
  ipcMain.handle('work:view', (_e, slug: string) => viewOf(String(slug ?? '')))
  ipcMain.handle('work:answer', (_e, slug: string, id: string, answer: string) => answerOnPage(String(slug ?? ''), String(id ?? ''), String(answer ?? '')))
  ipcMain.handle('work:prepare', async (_e, slug: string) => {
    const p = await workProject(String(slug ?? ''))
    if (!p) throw new Error('That project isn’t in Projects/Work any more.')
    return { root: await workspaceFor(p.slug), title: p.title, slug: p.slug }
  })
}
