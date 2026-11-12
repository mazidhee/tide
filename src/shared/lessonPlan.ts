/**
 * The lesson map's raw material: the tutor's plan with what each step covers, how it ends and
 * rough minutes, and the progress it reports as it teaches. Both are short tags in the reply (so
 * Gemma can write them), and Claude reports the same progress through Tide's lesson_progress tool,
 * which Tide turns into the same tag (main/tideMcpTools). Nothing here imports the session code,
 * so the session parser and the marking code can both use it.
 */

export interface PlanStep {
  title: string
  /** One line on what the step covers */
  about?: string
  /** How the student shows they have it: "Done when you convert one number to hex, unaided" */
  doneWhen?: string
  /** The tutor's rough minutes for it */
  minutes?: number
}

export interface PlanDetail {
  /** "By the end you can …" */
  goal?: string
  /** When the lesson ends, in the tutor's words, if it said */
  ends?: string
  steps: PlanStep[]
}

/** What the tutor reported in one <progress/> tag (or one lesson_progress call). Steps are 1-based, as the student sees them */
export interface ProgressReport {
  /** A step started */
  step?: number
  /** A step passed, with what the student showed */
  passed?: number
  note?: string
  /** A step closed without its check, at the student's request: it goes to their reviews */
  skipped?: number
  /** A step added, after this one */
  add?: PlanStep
  after?: number
  /** The question in this reply: what it checks, and the checks left in its step (this one included) */
  checking?: string
  left?: number
}

const clean = (s: string | undefined) => s?.replace(/\s+/g, ' ').trim() || undefined
const MINUTES = /^(?:about|~|≈)?\s*(\d{1,3})\s*(?:-\s*\d{1,3}\s*)?(?:min(?:ute)?s?|m)\b\.?$/i

/**
 * One plan line: "Title | what it covers | Done when … | 6 min", the parts in any order after the
 * title. A line with only a title ("Decimal to binary"), the plans written before the map, or
 * "Title: what it covers" works too.
 */
export function parseStep(line: string): PlanStep | null {
  const text = line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s*)/, '').replace(/^\*\*(.+?)\*\*/, '$1').replace(/^step\s+\d+\s*[:.–—-]\s*/i, '').trim()
  if (!text) return null
  const parts = text.split(/\s+\|\s+|\s*\|\s*/).map((p) => p.trim()).filter(Boolean)
  let title = parts.shift() ?? ''
  const step: PlanStep = { title }
  for (const p of parts) {
    const min = p.match(MINUTES)
    if (min) step.minutes = Number(min[1])
    else if (/^done when\b/i.test(p)) step.doneWhen = clean(p.replace(/^done when\s*:?\s*/i, 'Done when '))
    else if (!step.about) step.about = clean(p)
    else if (!step.doneWhen) step.doneWhen = clean(p)
  }
  // "Title: what it covers" (no pipes): split at the first colon when the title would be long
  if (!parts.length) {
    const colon = title.match(/^([^:]{3,48}):\s+(.{8,})$/)
    if (colon) {
      title = colon[1]
      step.about = clean(colon[2])
    }
    const mins = (step.about ?? title).match(/\s*\((?:about |~)?(\d{1,3})\s*min(?:ute)?s?\)\s*$/i)
    if (mins) {
      step.minutes = Number(mins[1])
      if (step.about) step.about = clean(step.about.slice(0, mins.index))
      else title = title.slice(0, mins.index)
    }
  }
  step.title = title.replace(/[.:;]+$/, '').trim()
  if (step.minutes !== undefined && !(step.minutes > 0 && step.minutes <= 90)) delete step.minutes
  return step.title ? step : null
}

/** The body of a <plan> tag: an optional "Goal:" and "Ends:" line, then one line per step */
export function parsePlanBody(body: string): PlanDetail {
  const out: PlanDetail = { steps: [] }
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const goal = line.match(/^(?:[-*]\s*)?\**(?:goal|aim|by the end)\**\s*[:—–-]\s*(.+)$/i)
    if (goal) {
      out.goal = clean(goal[1].replace(/^by the end,?\s*/i, 'By the end '))
      if (out.goal && !/^by the end/i.test(out.goal)) out.goal = `By the end you can ${out.goal.replace(/^you can\s+/i, '').replace(/^./, (c) => c.toLowerCase())}`
      continue
    }
    const ends = line.match(/^(?:[-*]\s*)?\**(?:ends?|when it ends|finish(?:es)?)\**\s*[:—–-]\s*(.+)$/i)
    if (ends) {
      out.ends = clean(ends[1])
      continue
    }
    const step = parseStep(line)
    if (step) out.steps.push(step)
  }
  return out
}

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'))?.[1] ?? attrs.match(new RegExp(`\\b${name}\\s*=\\s*([\\w.-]+)`, 'i'))?.[1]
const num = (s: string | undefined) => {
  const n = s === undefined ? NaN : parseInt(s, 10)
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : undefined
}

/** The attributes of one <progress …/> tag; null when it says nothing the map can use */
export function parseProgress(attrs: string): ProgressReport | null {
  const r: ProgressReport = {}
  const step = num(attr(attrs, 'step'))
  const passed = num(attr(attrs, 'passed'))
  const skipped = num(attr(attrs, 'skipped'))
  if (step) r.step = step
  if (passed) r.passed = passed
  if (skipped) r.skipped = skipped
  const note = clean(attr(attrs, 'note'))
  if (note && passed) r.note = note.slice(0, 120)
  const add = attr(attrs, 'add')
  const added = add ? parseStep(add) : null
  if (added) {
    r.add = added
    const after = num(attr(attrs, 'after'))
    if (after !== undefined) r.after = after
  }
  const checking = clean(attr(attrs, 'checking'))
  if (checking) r.checking = checking.replace(/^checking:?\s*/i, '').slice(0, 120)
  const left = num(attr(attrs, 'left'))
  if (left !== undefined) r.left = left
  return Object.keys(r).length ? r : null
}

const q = (s: string) => s.replace(/"/g, '”')

/** A report written back as the tag the reply would carry (what lesson_progress adds to Claude's reply) */
export function progressTag(r: ProgressReport): string {
  const parts: string[] = []
  if (r.passed) parts.push(`passed="${r.passed}"`)
  if (r.note) parts.push(`note="${q(r.note)}"`)
  if (r.skipped) parts.push(`skipped="${r.skipped}"`)
  if (r.add) parts.push(`add="${q([r.add.title, r.add.about, r.add.doneWhen, r.add.minutes ? `${r.add.minutes} min` : ''].filter(Boolean).join(' | '))}"`)
  if (r.after !== undefined) parts.push(`after="${r.after}"`)
  if (r.step) parts.push(`step="${r.step}"`)
  if (r.checking) parts.push(`checking="${q(r.checking)}"`)
  if (r.left !== undefined) parts.push(`left="${r.left}"`)
  return `<progress ${parts.join(' ')}/>`
}

/**
 * "I've got this, move on" on a question card. A request, never an answer: it starts with "Skip"
 * so every check for an answer passes it by (claudeEngine's isAnswer, lessonRepair's nothingToMark,
 * the lesson's own record of marks), and its hidden note tells the tutor what to do.
 */
export const MOVE_ON_SAID = "Skip ahead: I've got this, let's move on."

export const isMoveOn = (said: string) => said.trim().startsWith(MOVE_ON_SAID)

export function moveOnRequest(step: number | null, total: number): string {
  const what =
    step && step < total
      ? `Close step ${step} with <progress skipped="${step}"/>, start step ${step + 1} with <progress step="${step + 1}"/> and teach it.`
      : step
        ? `Close step ${step} with <progress skipped="${step}"/> and go on to the final mixed problems.`
        : 'Go on to the next part of the lesson.'
  return `${MOVE_ON_SAID}\n\n(Tide: the student pressed "I've got this, move on". This is a request, not an answer: write no <grade> and no <card> for it, and don't ask the question again. Tide has kept the point for their recall reviews. ${what})`
}

/** What the tutor is told about the map (Gemma writes the tags; Claude's version is MAP_RULES_CLAUDE) */
export const MAP_RULES = `   - Hidden tags keep the map true: <progress step="2"/> starting each step, <progress passed="2" note="what they showed"/> passing it, and per question <progress checking="what it checks" left="checks left"/>.`

export const MAP_RULES_CLAUDE = `   - Keep the map true: call lesson_progress when a step starts (the first one too), when they pass a step's check (with a note of what they showed), or to add a step when something doesn't click. With every question, put <progress checking="what it checks" left="checks left in this step, this one included"/> in your reply; the student doesn't see it.`
