/**
 * Work through a new task: a request pasted from work (an email, a Slack message, a ticket) turned
 * into a guided work project (shared/workProject) that opens in the flight plan. The model drafts
 * the project file; this file has its instructions, the prompt, and the check and finishing of what
 * comes back. The file is marked `kind: new-task`: nobody has decided its decision points yet, so
 * what a checkpoint reveals is the usual choice, to confirm with the person who asked.
 *
 * Everything in this file is pure.
 */
import { parseWorkProject, workSlug, type WorkProject } from './workProject'

/** Front matter value that marks a project drafted from a new request (WorkProject.fresh) */
export const NEW_TASK_KIND = 'new-task'

/** The shortest request worth drafting from, and the most of one sent to the model */
export const REQUEST_MIN = 30
export const REQUEST_MAX = 12_000

export interface WorkTaskRequest {
  /** The request as it arrived: pasted text */
  text: string
  /** Who asked, if the learner says (e.g. "Ada, Head of Growth") */
  from?: string
}

export const WORK_TASK_SYSTEM = `You turn a real request from a learner's job into a guided project they work through themselves with a tutor. The learner is a data analyst; they do the work, the tutor never does it for them. Output ONLY the project file in Markdown, exactly in this shape, no introduction and no closing remarks:

---
title: A short title for the task, 3 to 8 words
stakeholder: Who asked and their role, as given (omit the line if unknown)
skills: [skill, skill]
---

## Brief
The request restated clearly as the stakeholder's ask, in their voice: what they want, by when if said, and what it's for. Keep their facts; invent none.

## What a good answer contains
- 4 to 8 checks a reviewer would make of the finished work (grain, filters, definitions, time zone, caveats, how it's presented)

## Steps

### 1. Step title
Task: What to do in this step, concretely, in 1 to 3 sentences. Never the solution itself.
Data: The data it needs (a practice collection when one fits, else what to look for)
Skill: The main skill or operator it exercises

(3 to 6 steps, in the order the work is done: clarify and find the data, build it up, check it, present it)

## Decisions

### D1. A judgment call, as a short title
Step: the step number it comes up in
Ask: The question put to the learner before anything is revealed, open, no hint at the answer
Decided: What an experienced analyst would usually choose here, and what in the request supports it
Why: Why, in one or two sentences, including when the other choice would be right
Wrong choices:
- A common wrong choice and what it would cost

(2 to 4 decisions: the real judgment calls in this request, such as definitions, filters, time windows and grain, edge cases, how to present it)

## Defend it
- 3 to 5 questions the stakeholder or a manager would ask about the finished work

Rules:
- Be specific to this request. Use its own names for metrics, teams, products and dates.
- Where the request is ambiguous, make clarifying it a decision point or part of step 1; never guess silently.
- Never ask for or include real customer data, credentials or anything secret. The learner rehearses on practice data, then does it for real at work.`

/** The model's prompt: the request, who asked, and the practice data they'll rehearse on */
export function workTaskPrompt(req: WorkTaskRequest, practice: { name: string; fields?: string[] }[] = [], today = ''): string {
  return [
    today ? `Today is ${today}.` : '',
    req.from?.trim() ? `Who asked: ${req.from.trim()}` : '',
    `The request, as it arrived:\n\n"""\n${req.text.trim().slice(0, REQUEST_MAX)}\n"""`,
    practice.length
      ? `The practice data they rehearse on (MongoDB collections; name them in Data: lines where they fit, and say what's missing where they don't):\n${practice.map((c) => `- ${c.name}${c.fields?.length ? `: ${c.fields.slice(0, 30).join(', ')}` : ''}`).join('\n')}`
      : 'No practice data is set up: in Data: lines, say what data each step needs.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The model's reply without a code fence around it or anything before the front matter */
function unwrap(reply: string): string {
  let t = reply.replace(/\r/g, '').trim()
  const fence = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(t)
  if (fence) t = fence[1].trim()
  const fm = t.indexOf('---\n')
  if (fm > 0 && !/^## /m.test(t.slice(0, fm))) t = t.slice(fm)
  return t
}

/** Sets (or adds) one front matter line */
function setMeta(md: string, key: string, value: string): string {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md)
  if (!m) return `---\n${key}: ${value}\n---\n\n${md}`
  const lines = m[1].split('\n').filter((l) => !new RegExp(`^${key}\\s*:`, 'i').test(l))
  return `---\n${[...lines, `${key}: ${value}`].join('\n')}\n---\n${md.slice(m[0].length)}`
}

/**
 * The project file from the model's draft: checked with the work project parser, marked as a new
 * task, with who asked, and the request kept as it arrived (a section the parser leaves alone).
 * Problems that leave it unusable come back instead.
 */
export function finishWorkTask(reply: string, req: WorkTaskRequest, at = 0): { md: string; project: WorkProject } | { error: string } {
  let md = unwrap(reply)
  const first = parseWorkProject(md)
  if (!first.project) return { error: `The draft wasn't a project: ${first.problems.join(' ')}` }
  if (!first.project.steps.length) return { error: 'The draft had no steps.' }
  md = setMeta(md, 'kind', NEW_TASK_KIND)
  if (req.from?.trim() && !first.project.stakeholder) md = setMeta(md, 'stakeholder', req.from.trim().replace(/\n+/g, ' ').slice(0, 120))
  if (at) md = setMeta(md, 'started', new Date(at).toISOString().slice(0, 10))
  if (!first.project.title || first.project.title === 'project') md = setMeta(md, 'title', titleOf(req.text))
  md = `${md.trimEnd()}\n\n## The request as it arrived\n\n${quote(req.text)}\n`
  const { project } = parseWorkProject(md)
  return project ? { md, project } : { error: 'The draft couldn’t be read back.' }
}

const quote = (t: string) =>
  t
    .replace(/\r/g, '')
    .trim()
    .slice(0, REQUEST_MAX)
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n')

/** A title from the request's first words, when the draft has none */
export function titleOf(text: string): string {
  const line = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).find((l) => l.length > 3 && !/^(hi|hello|hey|dear)\b/i.test(l)) ?? 'New task'
  const words = line.replace(/[^\w\s'’-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 7).join(' ')
  return words ? words[0].toUpperCase() + words.slice(1) : 'New task'
}

/** A slug that isn't taken yet: the title's, then -2, -3… */
export function freeSlug(title: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = workSlug(title)
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`
}

/** Checks the pasted text before anything is sent */
export function checkRequest(req: WorkTaskRequest): string | null {
  const t = String(req.text ?? '').trim()
  if (t.length < REQUEST_MIN) return 'Paste the whole request: what they asked for, and any detail they gave.'
  return null
}
