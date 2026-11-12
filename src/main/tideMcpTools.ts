/**
 * Tools Tide serves to Claude that Gemma's loop has no need of (it gets the same text in its
 * prompt): the learner's profile, plan and what's due, past lessons on a topic, and recording a
 * marked answer into What you know. Private projects are left out of everything here.
 */
import type { McpTool } from './tideMcp'

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })

export const EXTRA_TOOLS: McpTool[] = [
  {
    name: 'learner_profile',
    description: "Who the learner is: their profile and aims, what you remember about them, this week's plan, how many recall questions are due, and their most recent lessons. Read it at the start of a conversation that isn't a lesson (a lesson already has this in its prompt).",
    inputSchema: obj({}),
    async run(_args, ctx) {
      const id = ctx.step({ kind: 'read_note', label: 'Looking at what Tide knows about you', status: 'running', depth: 0 })
      const [{ profilePrompt }, { memoryPrompt }, { recallStats }, { listLessons }, { privatePath }, agent] = await Promise.all([import('./coach'), import('./memory'), import('./recall'), import('./lessons'), import('./projects'), import('./agent')])
      const plan = await agent.runTideTool('study_plan', {}, { ...ctx, step: () => '', updateStep: () => {} }).catch(() => '')
      const lessons = (await listLessons().catch(() => [])).slice(0, 30)
      const open: string[] = []
      for (const l of lessons) {
        const path = 'path' in l.scope ? l.scope.path : ''
        if (path && (await privatePath(path).catch(() => true))) continue
        open.push(`- ${new Date(l.updated).toISOString().slice(0, 10)} ${l.mode}: ${l.topic} (${l.answers} answers${l.finished ? ', finished' : ''})`)
        if (open.length >= 12) break
      }
      const r = recallStats()
      ctx.updateStep(id, { status: 'done' })
      return [
        (await profilePrompt().catch(() => '')) || 'No learner profile yet.',
        await memoryPrompt().catch(() => ''),
        `Plan:\n${plan}`,
        `Recall: ${r.due} questions due of ${r.total} kept (${r.settled} settled).`,
        open.length ? `Recent lessons:\n${open.join('\n')}` : 'No lessons yet.'
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  },
  {
    name: 'past_lessons',
    description: 'What earlier lessons on a topic (or close to it) showed: what the learner got right and wrong, recall questions due on it, and what around it is solid or shaky. Use it before teaching a topic again.',
    inputSchema: obj({ topic: { type: 'string' } }, ['topic']),
    async run(args, ctx) {
      const topic = String(args.topic ?? '').trim()
      const id = ctx.step({ kind: 'read_note', label: `Looking at your earlier lessons on ${topic}`, status: 'running', depth: 0 })
      const { earlierLessons } = await import('./lessons')
      const text = await earlierLessons(topic, false).catch(() => '')
      ctx.updateStep(id, { status: 'done' })
      return text || 'No earlier lessons on this topic.'
    }
  },
  {
    name: 'record_answer',
    description: "Record a marked answer in What you know, Tide's map of what the learner knows, when you marked it outside a Tide lesson (in a lesson, the <grade> tag records it: don't call this there). One call per answer.",
    inputSchema: obj(
      {
        topic: { type: 'string', description: 'The idea the answer tested, as a short topic name, e.g. "Python list comprehensions"' },
        verdict: { type: 'string', enum: ['correct', 'partial', 'wrong'] },
        question: { type: 'string', description: 'The question, briefly' }
      },
      ['topic', 'verdict']
    ),
    async run(args, ctx) {
      const topic = String(args.topic ?? '').trim()
      const verdict = String(args.verdict ?? '')
      if (!topic || !['correct', 'partial', 'wrong'].includes(verdict)) return 'Give a topic and a verdict of correct, partial or wrong.'
      const id = ctx.step({ kind: 'remember', label: `Recording your answer on ${topic} in What you know`, status: 'running', depth: 0 })
      const { noteEvidence } = await import('./knowledge')
      const at = Date.now()
      await noteEvidence({ topic, kind: verdict === 'correct' ? 'right' : verdict === 'partial' ? 'partly' : 'wrong', source: `claude:${at}`, pos: '0', at })
      ctx.updateStep(id, { status: 'done', detail: verdict })
      return `Recorded: ${verdict} on ${topic}.`
    }
  }
]
