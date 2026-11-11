import type { ChatEvent, OutlineDraftRequest } from '@shared/types'
import { friendlyError, streamDraft } from './ai'
import { readWebpage, webSearch } from './agent'
import { getSettings } from './settings'
import { directionLine } from './coach'
import { phaseWorkLine, projectKind, roadmapGuidance, profileSubject, type SubjectProfile } from '@shared/subjects'

/**
 * Drafts a study outline for a new topic. Research happens first and in code, not by the model:
 * a couple of searches for real syllabi and roadmaps, the best two pages read, then one streamed
 * generation that has those pages in front of it. That keeps a small local model on format.
 */

const SIZE = {
  overview: 'about 25 topics in 3 to 4 parts',
  course: 'about 60 to 80 topics in 4 to 6 parts',
  deep: 'about 150 topics in 6 to 9 parts'
} as const

const running = new Map<string, AbortController>()

/** Topics a phase can hold: about one per 2.5 study hours, at least 3 */
const topicBudget = (weeks: number, hoursPerWeek: number) => Math.max(3, Math.round((weeks * hoursPerWeek) / 2.5))

export function cancelDraft(id: string) {
  running.get(id)?.abort()
  running.delete(id)
}

const SYSTEM = `You design study outlines for a self-taught learner. Output ONLY the outline in this exact Markdown format, no introduction and no closing remarks:

## Part name
### Chapter name
- [ ] Topic
- [ ] Topic
    - _Book or course title — Author_

Rules:
- Order topics so each one only needs what came before it. Start from the foundations the learner is missing.
- A topic is one teachable idea, 2 to 9 words, specific ("Idempotent consumers", not "Advanced concepts").
- Group 4 to 10 topics under each chapter. Use ## for parts and ### for chapters, nothing deeper.
- After a chapter's last topic you may add ONE indented resource line in italics, only for a real, well-known book, course or official documentation. Never invent resources.
- Include a final part for applying it: projects, case studies or practice that fit the learner's goal.
- Prefer what is current as of today over outdated practice.`

export async function draftOutline(req: OutlineDraftRequest, emit: (e: ChatEvent) => void) {
  const controller = new AbortController()
  running.set(req.id, controller)
  const step = (n: number, label: string, status: 'running' | 'done' | 'error', detail?: string) =>
    emit({ id: req.id, type: 'step', step: { id: `d${n}`, kind: n === 2 ? 'read_webpage' : 'web_search', label, status, detail, depth: 0 } })
  try {
    let research = req.notes ?? ''
    const searchOn = !research && req.research && getSettings().ai.webSearch?.provider !== 'off'
    if (searchOn) {
      step(1, `Looking for syllabi and roadmaps for ${req.topic}`, 'running')
      const queries = [`${req.topic} syllabus curriculum`, `${req.topic} learning roadmap topics`]
      const found = (await Promise.all(queries.map((q) => webSearch(q).catch(() => [])))).flat().filter((r) => r.url)
      const seen = new Set<string>()
      const unique = found.filter((r) => !seen.has(r.url) && seen.add(r.url))
      step(1, `Looking for syllabi and roadmaps for ${req.topic}`, 'done', `${unique.length} results`)
      // Pages that are mostly video or discussion don't list topics well
      const readable = unique.filter((r) => !/youtube\.com|youtu\.be|reddit\.com|quora\.com|x\.com|twitter\.com|facebook\.com/i.test(r.url)).slice(0, 4)
      step(2, 'Reading the best ones', 'running')
      const pages = (
        await Promise.all(
          readable.map((r) =>
            readWebpage(r.url)
              .then((p) => ({ title: p.title, url: r.url, text: p.text.slice(0, 3500) }))
              .catch(() => null)
          )
        )
      )
        .filter((p): p is { title: string; url: string; text: string } => !!p && p.text.length > 400)
        .slice(0, 2)
      step(2, 'Reading the best ones', 'done', pages.map((p) => p.title).join(', ') || 'nothing readable')
      research = [
        unique.length ? `Search results:\n${unique.slice(0, 8).map((r) => `- ${r.title}: ${r.snippet}`).join('\n')}` : '',
        ...pages.map((p) => `Page "${p.title}" (${p.url}):\n${p.text}`)
      ]
        .filter(Boolean)
        .join('\n\n---\n\n')
    }
    if (controller.signal.aborted) return
    const plan = req.plan
    const heading = await directionLine().catch(() => '')
    // Subject hook (any-subject, src/shared/subjects.ts): the plan's kinds when it was sized, else read off the topic
    const subject: SubjectProfile = plan?.subject?.length ? { kinds: plan.subject, subjects: [], from: 'model' } : profileSubject(req.topic)
    const work = phaseWorkLine(subject)
    const guidance = roadmapGuidance(subject)
    const user = [
      `Topic: ${req.topic}`,
      req.goal?.trim() ? `What the learner wants from it, and what they already know: ${req.goal.trim()}` : '',
      heading ? `${heading} Choose topics, examples and projects with that in mind (an LLM from scratch for a systems engineer leans on memory, kernels and performance, for instance), but keep the subject complete.` : '',
      plan
        ? `This is a ${plan.weeks}-week plan at ${plan.hoursPerWeek} hours a week (${Math.round(plan.weeks * plan.hoursPerWeek)} study hours in all). Write exactly these phases as the ## parts, in this order, titled "Phase N: name", with NO MORE topics than the number given (one topic is about 2 to 3 hours of study, so a short plan must stay short):
${plan.phases.map((p, i) => `${i + 1}. ${p.title}: ${p.weeks} weeks, at most ${topicBudget(p.weeks, plan.hoursPerWeek)} topics. By the end they can ${p.outcome}${p.project ? `. Project: ${p.project}` : ''}`).join('\n')}
Inside each phase use ### chapters of 2 to 6 topics. After each chapter's topics, add ONE indented resource line with the best real book, course or official docs for it. End every phase with these ${work ? 'three' : 'two'} lines, in this order:
${work ? `${work}\n` : ''}- [ ] Project: the phase's project, specific to the learner's goal${projectKind(subject) ? ` (${projectKind(subject)})` : ''}
- [ ] Exam: the phase name`
        : `Size: ${SIZE[req.size]}.`,
      guidance,
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      research ? `Use this research to decide what belongs in the outline (don't copy its wording, and leave out anything off-topic):\n\n${research}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    for await (const text of streamDraft(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user }
      ],
      controller.signal,
      // A long plan needs room: about 25 tokens a topic with its resources
      req.plan ? Math.min(8000, 1500 + Math.round((req.plan.hoursPerWeek * req.plan.weeks) / 2.5) * 30) : req.size === 'deep' ? 6000 : 3500
    , 'planning')) {
      emit({ id: req.id, type: 'delta', text })
    }
    emit({ id: req.id, type: 'done' })
  } catch (e) {
    if (controller.signal.aborted) emit({ id: req.id, type: 'done' })
    else emit({ id: req.id, type: 'error', message: friendlyError(e) })
  } finally {
    running.delete(req.id)
  }
}
