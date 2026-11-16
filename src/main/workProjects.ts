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
    'The guided work project this lesson is on. Actions: progress (brief, steps, decision points and where they are), ask_decision (id: before putting a decision question to them; then stop and wait), commit_decision (id: after they answer; records their own last message), reveal_decision (id: what was actually decided, why, and common wrong choices; only after commit), step_done (step: when a step is finished), rubric (what a good answer contains; only once every decision is answered, never pasted to them), write_summary (text: a short summary in their words at the end, saved in their notes).',
  inputSchema: obj(
    {
      action: { type: 'string', enum: ['progress', 'ask_decision', 'commit_decision', 'reveal_decision', 'step_done', 'rubric', 'write_summary'] },
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

export function registerWork(): void {
  ipcMain.handle('work:list', () => listWork())
  ipcMain.handle('work:view', (_e, slug: string) => viewOf(String(slug ?? '')))
  ipcMain.handle('work:answer', (_e, slug: string, id: string, answer: string) => answerOnPage(String(slug ?? ''), String(id ?? ''), String(answer ?? '')))
  ipcMain.handle('work:prepare', async (_e, slug: string) => {
    const p = await workProject(String(slug ?? ''))
    if (!p) throw new Error('That project isn’t in Projects/Work any more.')
    return { root: await workspaceFor(p.slug), title: p.title, slug: p.slug }
  })
}
