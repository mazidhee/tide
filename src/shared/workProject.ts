/**
 * Guided work projects: a real piece of analyst work, redone by the learner on practice data, from a
 * private Markdown file in their notes (Projects/Work/<slug>.md). The file has front matter and
 * these sections:
 *
 *   ## Brief                      the ask, written as a request from a stakeholder
 *   ## What a good answer contains   hidden from the learner
 *   ## Steps                      ### 1. Title, then Task:, Data:, Skill: lines
 *   ## Decisions                  ### D1. Title, then Step:, Ask:, Decided:, Why:, Wrong choices: (a list)
 *   ## Defend it                  a list of questions a manager would ask
 *
 * The learner writes every query and pipeline; the tutor reviews and asks why. At each decision point
 * Tide asks the question first; what was actually decided is shown only after the learner has
 * committed to an answer of their own (the session rules below, kept in main and enforced there).
 * The rubric ("what a good answer contains") opens only once every decision has been answered.
 *
 * Everything in this file is pure.
 */

export interface WorkStep {
  n: number
  title: string
  task: string
  data: string
  skill: string
}

export interface WorkDecision {
  id: string
  title: string
  /** The step it comes up in */
  step: number
  /** The question asked before anything is revealed */
  ask: string
  decided: string
  why: string
  wrong: string[]
}

export interface WorkProject {
  slug: string
  title: string
  order: number
  difficulty?: number
  skills: string[]
  stakeholder?: string
  brief: string
  rubric: string[]
  steps: WorkStep[]
  decisions: WorkDecision[]
  defend: string[]
  /** The finished piece of work this project redoes (front matter `reference:`), e.g. a dashboard's id or address in the company Metabase: its cards are the reference answers, run on the practice data. Never sent to the window */
  reference?: string
}

/** What the window and the tutor may see before anything is answered: no rubric, no decided choices */
export interface WorkProjectPublic {
  slug: string
  title: string
  order: number
  difficulty?: number
  skills: string[]
  stakeholder?: string
  brief: string
  steps: WorkStep[]
  decisions: { id: string; title: string; step: number; ask: string }[]
  defend: string[]
}

export interface WorkCard {
  slug: string
  title: string
  order: number
  difficulty?: number
  steps: number
  decisions: number
  answered: number
  done: boolean
}

const clean = (s: string) => s.replace(/\r/g, '').trim()

/** Front matter (simple key: value lines, and [a, b] lists) and the body */
function frontMatter(md: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md.replace(/\r/g, ''))
  if (!m) return { meta: {}, body: md.replace(/\r/g, '') }
  const meta: Record<string, string | string[]> = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const v = kv[2].trim()
    meta[kv[1].toLowerCase()] = /^\[.*\]$/.test(v)
      ? v
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      : v.replace(/^["']|["']$/g, '')
  }
  return { meta, body: md.replace(/\r/g, '').slice(m[0].length) }
}

/** The body's ## sections, by lower-case heading */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>()
  const parts = body.split(/^## +/m)
  for (const p of parts.slice(1)) {
    const nl = p.indexOf('\n')
    const head = (nl < 0 ? p : p.slice(0, nl)).trim().toLowerCase()
    out.set(head, nl < 0 ? '' : p.slice(nl + 1))
  }
  return out
}

const section = (s: Map<string, string>, ...names: string[]) => {
  for (const [k, v] of s) if (names.some((n) => k.startsWith(n))) return v
  return ''
}

/** ### sub-sections: heading and text */
function subs(text: string): { head: string; body: string }[] {
  return text
    .split(/^### +/m)
    .slice(1)
    .map((p) => {
      const nl = p.indexOf('\n')
      return { head: (nl < 0 ? p : p.slice(0, nl)).trim(), body: nl < 0 ? '' : p.slice(nl + 1) }
    })
}

const listItems = (text: string) =>
  text
    .split('\n')
    .map((l) => /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(l)?.[1]?.trim() ?? '')
    .filter(Boolean)

/** Key: value fields of a sub-section; a value runs on until the next key */
function fields(body: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  let cur = ''
  const re = new RegExp(`^\\s*(?:\\*\\*)?(${keys.map((k) => k.replace(/ /g, '\\s+')).join('|')})(?:\\*\\*)?\\s*:(?:\\*\\*)?\\s*(.*)$`, 'i')
  for (const line of body.split('\n')) {
    const m = re.exec(line)
    if (m) {
      cur = m[1].toLowerCase().replace(/\s+/g, ' ')
      out[cur] = m[2]
    } else if (cur) out[cur] += `\n${line}`
  }
  for (const k of Object.keys(out)) out[k] = clean(out[k])
  return out
}

export const workSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project'

/** Reads a project file; problems say what's missing */
export function parseWorkProject(md: string, fileSlug = ''): { project: WorkProject | null; problems: string[] } {
  const problems: string[] = []
  const { meta, body } = frontMatter(md)
  const s = sections(body)
  const title = String(meta.title ?? /^# +(.+)$/m.exec(body)?.[1] ?? fileSlug).trim()
  const slug = workSlug(String(meta.slug ?? fileSlug ?? title))
  const brief = clean(section(s, 'brief', 'the brief'))
  if (!brief) problems.push('No "## Brief" section.')
  const rubric = listItems(section(s, 'what a good answer', 'good answer', 'rubric'))
  const steps: WorkStep[] = subs(section(s, 'steps')).map((x, i) => {
    const f = fields(x.body, ['task', 'data', 'skill', 'skills'])
    const n = Number(/^(\d+)/.exec(x.head)?.[1] ?? i + 1)
    return { n, title: x.head.replace(/^\d+[.)]\s*/, ''), task: f.task ?? clean(x.body), data: f.data ?? '', skill: f.skill ?? f.skills ?? '' }
  })
  if (!steps.length) problems.push('No steps ("## Steps" with "### 1. …" under it).')
  const decisions: WorkDecision[] = subs(section(s, 'decision')).map((x, i) => {
    const f = fields(x.body, ['step', 'ask', 'decided', 'why', 'wrong choices', 'wrong'])
    const id = (/^(D\d+)/i.exec(x.head)?.[1] ?? `D${i + 1}`).toUpperCase()
    const wrongText = f['wrong choices'] ?? f.wrong ?? ''
    const wrong = listItems(wrongText)
    return { id, title: x.head.replace(/^D\d+[.):]?\s*/i, ''), step: Number(/\d+/.exec(f.step ?? '')?.[0] ?? 1), ask: f.ask ?? '', decided: f.decided ?? '', why: f.why ?? '', wrong: wrong.length ? wrong : wrongText ? [wrongText] : [] }
  })
  for (const d of decisions) {
    if (!d.ask) problems.push(`${d.id} has no "Ask:" question.`)
    if (!d.decided) problems.push(`${d.id} has no "Decided:" line.`)
  }
  const ids = decisions.map((d) => d.id)
  if (new Set(ids).size !== ids.length) problems.push('Two decisions share an id.')
  const defend = listItems(section(s, 'defend'))
  if (problems.length && !brief && !steps.length) return { project: null, problems }
  const skills = Array.isArray(meta.skills) ? meta.skills : meta.skills ? String(meta.skills).split(',').map((x) => x.trim()) : []
  return {
    project: { slug, title, order: Number(meta.order) || 99, difficulty: Number(meta.difficulty) || undefined, skills, stakeholder: meta.stakeholder ? String(meta.stakeholder) : undefined, brief, rubric, steps, decisions, defend, ...(meta.reference ? { reference: String(meta.reference) } : {}) },
    problems
  }
}

/** The project without anything that would give the answers away */
export function publicView(p: WorkProject): WorkProjectPublic {
  return { slug: p.slug, title: p.title, order: p.order, difficulty: p.difficulty, skills: p.skills, stakeholder: p.stakeholder, brief: p.brief, steps: p.steps, decisions: p.decisions.map(({ id, title, step, ask }) => ({ id, title, step, ask })), defend: p.defend }
}

// ---------- The session's rules ----------

export interface WorkState {
  slug: string
  /** The step they're on (from 1) */
  step: number
  /** Learner messages seen in the project's sessions */
  learnerTurns: number
  /** The learner's last message, in their own words */
  lastSaid: string
  /** Decision id → the learner turn count when the question was put to them */
  asked: Record<string, number>
  /** Decision id → their answer, before anything was revealed */
  committed: Record<string, { answer: string; at: number; via: 'lesson' | 'page' }>
  revealed: string[]
  /** Where the end-of-project summary was written */
  summary?: string
  updatedAt: number
}

export const newState = (slug: string, now = 0): WorkState => ({ slug, step: 1, learnerTurns: 0, lastSaid: '', asked: {}, committed: {}, revealed: [], updatedAt: now })

/** A learner message arrived in a session on this project */
export function noteLearner(s: WorkState, said: string, now = 0): WorkState {
  return { ...s, learnerTurns: s.learnerTurns + 1, lastSaid: said.trim().slice(0, 4000), updatedAt: now }
}

const findDecision = (p: WorkProject, id: string) => p.decisions.find((d) => d.id.toUpperCase() === String(id ?? '').trim().toUpperCase())

/** The tutor is about to put a decision's question: the learner's next message is their answer */
export function askDecision(p: WorkProject, s: WorkState, id: string, now = 0): { state: WorkState; ask?: string; error?: string } {
  const d = findDecision(p, id)
  if (!d) return { state: s, error: `No decision ${id}. The decisions are ${p.decisions.map((x) => x.id).join(', ') || 'none'}.` }
  if (s.committed[d.id]) return { state: s, ask: d.ask, error: `They already answered ${d.id}: “${s.committed[d.id].answer}”.` }
  return { state: { ...s, asked: { ...s.asked, [d.id]: s.learnerTurns }, updatedAt: now }, ask: d.ask }
}

/**
 * The learner's answer to a decision, from a lesson: their own last message, and only one sent after
 * the question was put. From the project page: the words they typed into the decision's box.
 */
export function commitDecision(p: WorkProject, s: WorkState, id: string, now = 0, typed?: string): { state: WorkState; error?: string } {
  const d = findDecision(p, id)
  if (!d) return { state: s, error: `No decision ${id}.` }
  if (s.committed[d.id]) return { state: s }
  if (typed !== undefined) {
    const answer = typed.trim()
    if (answer.length < 2) return { state: s, error: 'Write your answer first.' }
    return { state: { ...s, committed: { ...s.committed, [d.id]: { answer: answer.slice(0, 4000), at: now, via: 'page' } }, updatedAt: now } }
  }
  const askedAt = s.asked[d.id]
  if (askedAt === undefined) return { state: s, error: `Ask ${d.id} first (action ask_decision), put the question to them, and wait for their answer.` }
  if (s.learnerTurns <= askedAt || !s.lastSaid) return { state: s, error: `They haven't answered ${d.id} yet. Stop and wait for their reply; don't hint at the choice.` }
  return { state: { ...s, committed: { ...s.committed, [d.id]: { answer: s.lastSaid, at: now, via: 'lesson' } }, updatedAt: now } }
}

/** What was actually decided, and why: only once the learner has committed to their own answer */
export function revealDecision(p: WorkProject, s: WorkState, id: string, now = 0): { state: WorkState; text?: string; reveal?: Pick<WorkDecision, 'id' | 'decided' | 'why' | 'wrong'> & { answer: string }; error?: string } {
  const d = findDecision(p, id)
  if (!d) return { state: s, error: `No decision ${id}.` }
  const c = s.committed[d.id]
  if (!c) return { state: s, error: `Not yet: ${d.id} is revealed only after the learner has committed to an answer of their own.` }
  const text = [`${d.id}: ${d.title}`, `Their answer: ${c.answer}`, `What was actually decided: ${d.decided}`, d.why ? `Why: ${d.why}` : '', d.wrong.length ? `Common wrong choices:\n${d.wrong.map((w) => `- ${w}`).join('\n')}` : '', 'Compare their answer with this. A different choice can still be right if they defend it well: ask them to.'].filter(Boolean).join('\n')
  return { state: s.revealed.includes(d.id) ? s : { ...s, revealed: [...s.revealed, d.id], updatedAt: now }, text, reveal: { id: d.id, decided: d.decided, why: d.why, wrong: d.wrong, answer: c.answer } }
}

export const allAnswered = (p: WorkProject, s: WorkState) => p.decisions.every((d) => !!s.committed[d.id])

/** The rubric: only once every decision has its own answer (the defend-it round and the summary) */
export function rubricFor(p: WorkProject, s: WorkState): { text?: string; error?: string } {
  if (!allAnswered(p, s)) {
    const left = p.decisions.filter((d) => !s.committed[d.id]).map((d) => d.id)
    return { error: `Not yet: the rubric opens once every decision has the learner's own answer (still open: ${left.join(', ')}).` }
  }
  return { text: p.rubric.length ? `What a good answer contains (for you; never paste it to them, ask about the gaps instead):\n${p.rubric.map((r) => `- ${r}`).join('\n')}` : 'This project has no rubric.' }
}

export function setStep(p: WorkProject, s: WorkState, n: number, now = 0): WorkState {
  const max = Math.max(1, ...p.steps.map((x) => x.n))
  return { ...s, step: Math.max(1, Math.min(max + 1, Math.round(n) || 1)), updatedAt: now }
}

export const projectDone = (p: WorkProject, s: WorkState) => allAnswered(p, s) && !!s.summary

/** The tutor's view of where things are: the brief, the steps, each decision's question and state */
export function progressText(p: WorkProject, s: WorkState): string {
  const step = p.steps.find((x) => x.n === s.step)
  const lines = [
    `# ${p.title}`,
    p.stakeholder ? `From: ${p.stakeholder}` : '',
    `Brief:\n${p.brief}`,
    `Steps:\n${p.steps.map((x) => `${x.n === s.step ? '→' : x.n < s.step ? '✓' : ' '} ${x.n}. ${x.title}: ${x.task.replace(/\n+/g, ' ')}${x.data ? ` [data: ${x.data}]` : ''}${x.skill ? ` [skill: ${x.skill}]` : ''}`).join('\n')}`,
    step ? `Now on step ${step.n}: ${step.title}.` : 'Every step is done: the defend-it round is next.',
    p.decisions.length ? `Decision points (ask before revealing):\n${p.decisions.map((d) => `- ${d.id} (step ${d.step}): ${d.ask} — ${s.committed[d.id] ? (s.revealed.includes(d.id) ? 'answered and revealed' : 'answered, not yet revealed') : s.asked[d.id] !== undefined ? 'asked, waiting for their answer' : 'not asked yet'}`).join('\n')}` : '',
    p.defend.length ? `Defend-it round (at the end, one at a time):\n${p.defend.map((q) => `- ${q}`).join('\n')}` : '',
    findingsText(s)
  ]
  return lines.filter(Boolean).join('\n\n')
}

/** Their one-line findings, written on the flight plan (shared/flightPlan) */
function findingsText(s: WorkState): string {
  const f = (s as WorkState & { findings?: Record<string, string> }).findings ?? {}
  const lines = Object.entries(f).map(([n, t]) => `- step ${n}: ${t}`)
  return lines.length ? `What they found, in their words:\n${lines.join('\n')}` : ''
}

export function cardOf(p: WorkProject, s: WorkState | null): WorkCard {
  return { slug: p.slug, title: p.title, order: p.order, difficulty: p.difficulty, steps: p.steps.length, decisions: p.decisions.length, answered: s ? p.decisions.filter((d) => s.committed[d.id]).length : 0, done: !!s && projectDone(p, s) }
}

/** The summary note written at the end: their decisions in their words, beside what was decided */
export function summaryMarkdown(p: WorkProject, s: WorkState, text: string, at: number): string {
  const day = new Date(at).toISOString().slice(0, 10)
  return [
    `---\nproject: ${p.slug}\ndate: ${day}\n---`,
    `# ${p.title}: summary`,
    text.trim(),
    '## Decisions',
    ...p.decisions.map((d) => `- **${d.title}** — you said: ${s.committed[d.id]?.answer.replace(/\n+/g, ' ') ?? '(not answered)'}${s.revealed.includes(d.id) ? `\n  - decided at the time: ${d.decided}` : ''}`)
  ].join('\n\n')
}

// ---------- The tutor's layer (only these sessions get it) ----------

/** Marks a session's instructions as a guided work project (main/claudeEngine sessionShape reads it) */
export const WORK_MARK = 'GUIDED WORK PROJECT'

/** The rules for a work project session: in its instructions, never in the stable lesson prompt */
export function workRules(title: string): string {
  return `${WORK_MARK}: ${title}. The learner is the analyst; the brief is a stakeholder's request. You tutor; you are never the author.
- Start: call work_project (action progress) and read the brief and steps. Ask them how they would approach the brief before step 1.
- They write every query and pipeline themselves, in files in their workspace. Never write their solution or a partial pipeline; give hints in words, from vague to specific.
- Review what they wrote (read_file), run it on the practice data with practice_metabase (action pipeline) before you judge a number, and ask why for each choice (filters, grain, units, dates).
- Decision points: when a step reaches one, call work_project ask_decision, put its question to them in your own words, and stop. No hints at the choice. When they reply, call commit_decision, then reveal_decision, and compare: what was decided and why, and the common wrong choices. A different choice can be right if they defend it.
- After each step call work_project step_done. When all steps are done: the defend-it round, one question at a time, marking each answer; then work_project rubric to find gaps; then write_summary with a short summary in their words (what they built, decisions, what to revisit).
- This is practice data: yours to break. Their company's data is never used here.`
}

export const WORK_TOOL_LINE = 'work_project: the guided project (brief, steps, decision points asked before anything is revealed, the rubric at the end, the summary). practice_metabase: the practice Metabase and its MongoDB (yours to break): list collections and fields, run their pipelines, read or save their questions.'

// ---------- The window's API ----------

export interface WorkView {
  project: WorkProjectPublic
  state: WorkState & import('./flightPlan').FlightExtras
  /** What was decided, for the decisions they've answered */
  revealed: Record<string, { decided: string; why: string; wrong: string[] }>
  path: string
  problems: string[]
}

export interface WorkApi extends FlightApi {
  list(): Promise<WorkCard[]>
  view(slug: string): Promise<WorkView>
  answer(slug: string, id: string, answer: string): Promise<WorkView>
  prepare(slug: string): Promise<{ root: string; title: string; slug: string }>
}

/** A run of their step's pipeline on the practice data */
export type WorkRun = import('./resultCompare').ResultSet & { ms: number; file: string; collection?: string }

/** The flight plan's calls (components/FlightPlan, main/workProjects) */
export interface FlightApi {
  /** Their one-line finding for a step */
  finding(slug: string, step: number, text: string): Promise<WorkView>
  /** The step is finished: the plan moves on */
  stepDone(slug: string, step: number): Promise<WorkView>
  /** Runs the step's file (step<n>.js in their workspace) on the practice data; made empty if new */
  run(slug: string, step: number, file?: string): Promise<{ run: WorkRun; view: WorkView }>
  /** The step's file name, made with a two-line header if it isn't there yet */
  stepFile(slug: string, step: number): Promise<{ root: string; file: string }>
  /** How the step's pipeline maps onto Metabase's query builder */
  guide(slug: string, step: number, file?: string): Promise<{ guide: import('./builderMap').BuilderGuide | null; metric: boolean; error?: string }>
  /** Their most recently saved questions in the practice Metabase */
  questions(): Promise<{ id: number; name: string; updated: string; builder: boolean }[]>
  /** Runs their saved question and their pipeline, and compares the two */
  compare(slug: string, step: number, card: number, file?: string): Promise<{ comparison: import('./flightPlan').BuilderComparison; mbql: string; builder: boolean; name: string; pipeline: WorkRun; question: WorkRun; view: WorkView }>
  /** The builder can't do this step: native only, with the reason */
  native(slug: string, step: number, why: string): Promise<WorkView>
  /** A defend-it answer, locked */
  defend(slug: string, k: number, answer: string): Promise<WorkView>
  /** What a strong answer covers, once locked and the rubric is open */
  cover(slug: string, k: number): Promise<{ cover?: string[]; error?: string }>
  tick(slug: string, k: number, ticked: number[]): Promise<WorkView>
  /** The real cards this step builds (from the finished dashboard), by number and name, and the last check of each */
  refs(slug: string, step: number): Promise<{ cards: { num: number; name: string; available: boolean; check?: { match: boolean; why: string; at: number } }[]; source: string }>
  /** Their result against a real card, both run on the practice data */
  checkRef(slug: string, step: number, num: number, file?: string): Promise<{ comparison: import('./flightPlan').BuilderComparison; name: string; view: WorkView }>
  /** Opens the practice Metabase in the browser at a path (a new question: /question/notebook) */
  openMetabase(path: string): Promise<void>
}
