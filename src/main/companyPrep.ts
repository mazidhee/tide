import type { ChatEvent, CompanyPrepRequest } from '@shared/types'
import { friendlyError, streamDraft } from './ai'
import { readWebpage, webSearch } from './agent'
import { getSettings } from './settings'
import { filedUnder } from './learn'
import { search } from './search'

/**
 * Drafts an interview prep plan for one company and role. Like new-topic outlines, research is
 * done in code first (recent interview reports, the company's own careers pages), then one
 * streamed generation writes the plan with that research in front of it, so the plan reflects
 * how this company actually interviews rather than generic advice.
 */

const running = new Map<string, AbortController>()

export function cancelCompanyPrep(id: string) {
  running.get(id)?.abort()
  running.delete(id)
}

const SYSTEM = `You write interview prep plans for one company and role. Output ONLY Markdown in this exact shape, no introduction and no closing remarks:

## The loop
2 to 5 short bullet points: each round, what it tests, how long. Only what the research supports; if a detail is uncertain, say "reportedly".

## Coding
- [ ] Topic or pattern they ask about, 2 to 7 words
## System design
- [ ] Topic
## Behavioural
- [ ] Theme or value they probe, with one example question in italics after a dash
## Role and domain
- [ ] Domain knowledge that comes up for this company and role
## Practice problems
- [ ] Well-known problem title — pattern
## Questions to ask them
- A thoughtful question for the interviewer

Rules:
- Be specific to this company and role. Prefer what the research says over general knowledge, and leave out sections that don't apply to the role (for example System design for a junior role, if the research says it isn't asked).
- 5 to 12 items per checklist. Practice problems are real, well-known problems (LeetCode-style titles), 8 to 15 of them, matching the patterns above.
- Never invent statistics, quotes or links.`

const SKIP = /youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com/i

export async function draftCompanyPrep(req: CompanyPrepRequest, emit: (e: ChatEvent) => void) {
  const controller = new AbortController()
  running.set(req.id, controller)
  const who = `${req.company} ${req.role}`.trim()
  const step = (n: number, label: string, status: 'running' | 'done' | 'error', detail?: string) =>
    emit({ id: req.id, type: 'step', step: { id: `c${n}`, kind: n === 2 ? 'read_webpage' : 'web_search', label, status, detail, depth: 0 } })
  try {
    const sources: { title: string; url: string }[] = []
    let research = ''
    if (getSettings().ai.webSearch?.provider !== 'off') {
      step(1, `Researching how ${req.company} interviews`, 'running')
      const queries = [`${who} interview process rounds`, `${who} interview questions experience`, `${req.company} interview coding questions leetcode`]
      const found = (await Promise.all(queries.map((q) => webSearch(q, { when: 'year' }).catch(() => webSearch(q).catch(() => []))))).flat().filter((r) => r.url)
      const seen = new Set<string>()
      const unique = found.filter((r) => !seen.has(r.url) && seen.add(r.url))
      step(1, `Researching how ${req.company} interviews`, 'done', `${unique.length} results`)
      step(2, 'Reading interview reports', 'running')
      const pages = (
        await Promise.all(
          unique
            .filter((r) => !SKIP.test(r.url))
            .slice(0, 5)
            .map((r) =>
              readWebpage(r.url)
                .then((p) => ({ title: p.title || r.title, url: r.url, text: p.text.slice(0, 3500) }))
                .catch(() => null)
            )
        )
      )
        .filter((p): p is { title: string; url: string; text: string } => !!p && p.text.length > 400)
        .slice(0, 3)
      step(2, 'Reading interview reports', 'done', pages.map((p) => p.title).join(', ') || 'nothing readable')
      sources.push(...pages.map((p) => ({ title: p.title, url: p.url })))
      research = [
        unique.length ? `Search results:\n${unique.slice(0, 10).map((r) => `- ${r.title}: ${r.snippet}`).join('\n')}` : '',
        ...pages.map((p) => `Page "${p.title}" (${p.url}):\n${p.text}`)
      ]
        .filter(Boolean)
        .join('\n\n---\n\n')
    }
    if (controller.signal.aborted) return
    // What you've filed under the company in the Library (a job spec, articles, notes from a call)
    // shapes the plan more than anything found online
    const filed = await filedUnder(req.company).catch(() => [] as string[])
    const own = filed.length
      ? search(`${req.company} ${req.role} interview`, 12, (p) => filed.includes(p))
          .slice(0, 5)
          .map((c) => `From "${c.title}"${c.heading ? ` (${c.heading})` : ''}:\n${c.text.slice(0, 1200)}`)
          .join('\n\n---\n\n')
      : ''
    if (own) step(3, `Reading ${filed.length} source${filed.length === 1 ? '' : 's'} you filed under ${req.company}`, 'done')
    const user = [
      `Company: ${req.company}`,
      `Role: ${req.role || 'Software engineer'}`,
      req.notes?.trim() ? `About the candidate and their timeline: ${req.notes.trim()}` : '',
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      own ? `What the candidate saved about ${req.company} (trust this over web reports; build questions on it):\n\n${own}` : '',
      research ? `Research (use it to decide what goes in; don't copy its wording):\n\n${research}` : 'No web research was available, so rely on what is widely known and say "reportedly" for anything uncertain.'
    ]
      .filter(Boolean)
      .join('\n\n')
    for await (const text of streamDraft(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user }
      ],
      controller.signal,
      3500
    , 'planning')) {
      emit({ id: req.id, type: 'delta', text })
    }
    // The pages it was written from, so the plan can be checked
    if (sources.length) emit({ id: req.id, type: 'delta', text: `\n\n## Sources\n${sources.map((s) => `- [${s.title.replace(/[[\]]/g, '')}](${s.url})`).join('\n')}\n` })
    emit({ id: req.id, type: 'done' })
  } catch (e) {
    if (controller.signal.aborted) emit({ id: req.id, type: 'done' })
    else emit({ id: req.id, type: 'error', message: friendlyError(e) })
  } finally {
    running.delete(req.id)
  }
}
