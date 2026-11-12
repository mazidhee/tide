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
    name: 'earlier_concepts',
    description: "What the learner already studied that a topic builds on: related earlier concepts (by prerequisite, name and what their past lessons covered), each with how solid it is now (FSRS), when it was first studied, what its lesson covered and questions kept on it. Use it mid-lesson when you want to tie a new idea to something they learnt before, or to check whether an idea you are about to rely on has faded.",
    inputSchema: obj({ topic: { type: 'string', description: 'The idea you are teaching now, e.g. "How CPUs store integers"' } }, ['topic']),
    async run(args, ctx) {
      const topic = String(args.topic ?? '').trim()
      if (!topic) return 'Give a topic.'
      const id = ctx.step({ kind: 'read_note', label: `Looking at what you learnt before that ${topic} builds on`, status: 'running', depth: 0 })
      const { earlierConcepts } = await import('./warmup')
      const text = await earlierConcepts(topic).catch(() => '')
      ctx.updateStep(id, { status: 'done' })
      return text || 'Nothing the learner studied before looks related.'
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
  },
  {
    name: 'make_flashcards',
    description: "Save flashcards to the learner's notes, where Tide's Review schedules them. Use it for the ideas worth keeping from a session (in a lesson, a <card> tag offers one to the learner instead). Short, one idea per card.",
    inputSchema: obj(
      {
        topic: { type: 'string', description: 'What the cards are about, e.g. "Python virtual environments"' },
        cards: { type: 'array', items: { type: 'object', properties: { front: { type: 'string' }, back: { type: 'string' } }, required: ['front', 'back'] } },
        note: { type: 'string', description: 'Optional: the path of the note they belong to; otherwise they go in Flashcards/<topic>.md' }
      },
      ['topic', 'cards']
    ),
    async run(args, ctx) {
      const topic = String(args.topic ?? '').trim()
      const cards = (Array.isArray(args.cards) ? args.cards : []).map((c: { front?: unknown; back?: unknown }) => ({ front: String(c?.front ?? '').trim(), back: String(c?.back ?? '').trim() })).filter((c) => c.front && c.back).slice(0, 30)
      if (!topic || !cards.length) return 'Give a topic and at least one card with a front and a back.'
      const note = String(args.note ?? '').trim()
      const { privatePath } = await import('./projects')
      if (note && (await privatePath(note).catch(() => true))) return 'That note is in a private project, which never leaves this Mac: cards for it are made there.'
      const id = ctx.step({ kind: 'remember', label: `Making ${cards.length} flashcard${cards.length === 1 ? '' : 's'} on ${topic}`, status: 'running', depth: 0 })
      const [{ saveCards }, { cardsToMarkdown }, { reindexPath }] = await Promise.all([import('./study'), import('@shared/cards'), import('./search')])
      const path = await saveCards(note || `Flashcards/${topic.replace(/[\\/:*?"<>|#^[\]]/g, ' ').slice(0, 60).trim()}.md`, cardsToMarkdown(cards))
      await reindexPath(path).catch(() => {})
      ctx.updateStep(id, { status: 'done', detail: path })
      return `Saved ${cards.length} card${cards.length === 1 ? '' : 's'} to ${path}. They come up in Review.`
    }
  },
  {
    name: 'schedule_recall',
    description: "Keep questions for Tide to bring back later on a spaced schedule (the next lessons on the topic open with one, and Daily practice asks them). Use it for what the learner missed or nearly missed, phrased as a fresh question with its answer.",
    inputSchema: obj(
      {
        topic: { type: 'string' },
        questions: { type: 'array', items: { type: 'string' }, description: 'Each a question with its short answer, e.g. "What does activate change? (Only PATH: .venv/bin goes first.)"' }
      },
      ['topic', 'questions']
    ),
    async run(args, ctx) {
      const topic = String(args.topic ?? '').trim()
      const qs = (Array.isArray(args.questions) ? args.questions : []).map((q) => String(q).trim()).filter(Boolean).slice(0, 10)
      if (!topic || !qs.length) return 'Give a topic and at least one question.'
      const id = ctx.step({ kind: 'remember', label: `Keeping ${qs.length} question${qs.length === 1 ? '' : 's'} on ${topic} for recall`, status: 'running', depth: 0 })
      const { keepForRecall } = await import('./recall')
      await keepForRecall(qs.map((prompt) => ({ prompt, topic, lesson: `claude:${ctx.labId ?? 'chat'}` })))
      ctx.updateStep(id, { status: 'done' })
      return `Kept ${qs.length} for recall on ${topic}.`
    }
  },
  {
    name: 'recall_due',
    description: 'The recall questions due now (or soonest), optionally on one topic: questions the learner missed in earlier lessons, kept for spaced review. Ask one at the start of a session on that topic.',
    inputSchema: obj({ topic: { type: 'string' } }),
    async run(args, ctx) {
      const topic = String(args.topic ?? '').trim().toLowerCase()
      const id = ctx.step({ kind: 'read_note', label: topic ? `Looking at what’s due on ${topic}` : 'Looking at what’s due for recall', status: 'running', depth: 0 })
      const { recallItems } = await import('./recall')
      const now = Date.now()
      const items = recallItems()
        .filter((i) => !topic || i.topic.toLowerCase().includes(topic) || topic.includes(i.topic.toLowerCase()))
        .sort((a, b) => a.due - b.due)
        .slice(0, 8)
      ctx.updateStep(id, { status: 'done', detail: `${items.filter((i) => i.due <= now).length} due` })
      if (!items.length) return 'Nothing kept for recall' + (topic ? ' on this topic.' : '.')
      return items.map((i) => `- [${i.due <= now ? 'due' : `due ${new Date(i.due).toISOString().slice(0, 10)}`}] (${i.topic}) ${i.prompt}`).join('\n')
    }
  },
  {
    name: 'search_courses',
    description: 'Search the open courses the learner imported into Tide (full course text from GitHub: books, lecture notes, exercises). Returns passages with the course and file to read in full with read_course.',
    inputSchema: obj({ query: { type: 'string' } }, ['query']),
    async run(args, ctx) {
      const q = String(args.query ?? '').trim()
      const id = ctx.step({ kind: 'search_notes', label: `Searching your courses for “${q}”`, status: 'running', depth: 0 })
      const { searchCourses } = await import('./courses')
      const hits = await searchCourses(q, 6).catch(() => [])
      ctx.updateStep(id, { status: 'done', detail: `${hits.length} passages` })
      if (!hits.length) return 'Nothing in the imported courses matches.'
      return hits.map((h) => `${h.title}${h.heading ? ` > ${h.heading}` : ''} (course: ${h.course}, path: ${h.path})\n${h.text.slice(0, 900)}`).join('\n\n')
    }
  },
  {
    name: 'read_course',
    description: 'Read one file of an imported course in full, by the course and path search_courses gave.',
    inputSchema: obj({ course: { type: 'string' }, path: { type: 'string' } }, ['course', 'path']),
    async run(args, ctx) {
      const course = String(args.course ?? '').trim()
      const path = String(args.path ?? '').trim()
      const id = ctx.step({ kind: 'read_note', label: `Reading ${path.split('/').pop()}`, status: 'running', depth: 0 })
      const { courseFile } = await import('./courses')
      const text = await courseFile(course, path).catch(() => null)
      ctx.updateStep(id, { status: text ? 'done' : 'error' })
      return text ? text.slice(0, 12_000) : 'No such course file.'
    }
  },
  {
    name: 'search_transcripts',
    description: "Search the transcripts of videos the learner saved to Tide (lectures, talks, tutorials). Returns passages with the video's note path, to read with read_note.",
    inputSchema: obj({ query: { type: 'string' } }, ['query']),
    async run(args, ctx) {
      const q = String(args.query ?? '').trim()
      const id = ctx.step({ kind: 'search_notes', label: `Searching your video transcripts for “${q}”`, status: 'running', depth: 0 })
      const [{ search, indexReady }, { getSettings }, { privatePath }] = await Promise.all([import('./search'), import('./settings'), import('./projects')])
      await indexReady()
      const videos = `${(getSettings().libraryFolder || 'Library').replace(/\/+$/, '')}/Videos/`
      const found = await search(q, 8, (p) => p.startsWith(videos))
      const hits: typeof found = []
      for (const h of found) if (!(await privatePath(h.path).catch(() => true))) hits.push(h)
      ctx.updateStep(id, { status: 'done', detail: `${hits.length} passages` })
      if (!hits.length) return 'No saved video transcript matches.'
      return hits.map((h) => `${h.title}${h.heading ? ` > ${h.heading}` : ''} (path: ${h.path})\n${h.text.slice(0, 900)}`).join('\n\n')
    }
  },
  {
    name: 'related_material',
    description:
      "When you teach a concept: sections of the learner's OTHER imported courses and moments of course or saved videos that teach the same thing, chosen to add something (the code worked through, the why, the theory), at most three, each with how to name it and the tag that shows it in the lesson. Call it once per concept you teach, not for every message. Pass the course being taught as exclude.",
    inputSchema: obj({ concept: { type: 'string', description: 'The concept, e.g. "experiment tracking with MLflow"' }, exclude: { type: 'string', description: 'The course id being taught, if any' } }, ['concept']),
    async run(args, ctx) {
      const concept = String(args.concept ?? '').trim()
      if (!concept) return 'Give the concept.'
      const { lessonInfo } = await import('./exercises')
      const info = lessonInfo(ctx.labId)
      // A private notebook's lesson never reaches Claude; checked here too
      if (info?.private || (info?.path && (await (await import('./projects')).privatePath(info.path).catch(() => true)))) return 'This lesson is private: other courses are not brought in.'
      const id = ctx.step({ kind: 'search_notes', label: `Looking through your other courses and videos for “${concept}”`, status: 'running', depth: 0 })
      const [{ relatedMaterial }, { relatedForPrompt }] = await Promise.all([import('./related'), import('@shared/related')])
      const r = await relatedMaterial(concept, { exclude: String(args.exclude ?? '').trim() || undefined, limit: 3 })
      ctx.updateStep(id, { status: 'done', detail: r.items.length ? `${r.items.length} worth bringing in` : 'nothing to add' })
      return relatedForPrompt(r)
    }
  },
  {
    name: 'save_to_notes',
    description:
      "Save a point to the learner's notes for this lesson, under \"From the lesson\", where they will reread it later. Use it in a lesson's side thread when they ask you to save or note something, or when you have just explained a point worth keeping (a rule, a reason, a definition, a correction). One point per call, 1 to 5 lines of Markdown (up to 12 for notation or a worked example), worded to make sense on its own later. They see it marked \"Added to your notes\".",
    inputSchema: obj({ text: { type: 'string', description: 'The point, in Markdown, as it should read in their notes' } }, ['text']),
    async run(args, ctx) {
      const { cleanNoteText } = await import('@shared/lessonThreads')
      const text = cleanNoteText(String(args.text ?? ''))
      if (!text) return 'Nothing to save: give the point as text.'
      // The lesson on screen adds it to its notes and shows it where it was said (renderer/SessionView)
      ctx.step({ kind: 'save_note', label: 'Added to your notes', detail: text, status: 'done', depth: 0 })
      return 'Saved to their notes for this lesson. Don\'t repeat it in your reply; carry on with what you were saying.'
    }
  },
  {
    name: 'show_in_view',
    description:
      "Move what the learner is looking at in Tide: seek the video on their screen to a moment (seconds or m:ss), or scroll the course page or article they're reading to a section (by its heading). Use it when you point at something on their screen (\"watch from 12:40\", \"see the section on volumes\").",
    inputSchema: obj({ timestamp: { type: 'string', description: 'A moment of the video on screen, e.g. "12:40"' }, section: { type: 'string', description: 'A heading on the page on screen' }, video: { type: 'string', description: 'Optional: the YouTube id, when several are on screen' } }),
    async run(args, ctx) {
      const { parseTime, formatTime } = await import('@shared/video')
      const t = parseTime(String(args.timestamp ?? ''))
      const section = String(args.section ?? '').trim()
      if (t == null && !section) return 'Give a timestamp or a section.'
      const id = ctx.step({ kind: 'helper', label: t != null ? `Moving the video to ${formatTime(t)}` : `Showing “${section}”`, status: 'running', depth: 0 })
      const { BrowserWindow } = await import('electron')
      for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('view:goto', { ...(t != null ? { t } : {}), ...(section ? { section } : {}), ...(args.video ? { video: String(args.video) } : {}) })
      ctx.updateStep(id, { status: 'done' })
      return t != null ? `The video on their screen is now at ${formatTime(t)}.` : `Their page is scrolled to “${section}”.`
    }
  }
]
