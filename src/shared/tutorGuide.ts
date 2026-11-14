/**
 * The Claude tutor's teaching guide, in layers, so each lesson is told what applies to it once:
 *
 * 1. Core pedagogy: short, always on, the same for every lesson and chat (cached first).
 * 2. The format: the lesson's tags (shared/session SESSION_FORMAT, in its Claude form), lessons only.
 * 3. Tools: only the tools this session is given (its tool packs), each described once and briefly;
 *    the same packs decide which tools Tide's MCP server lists to the process (main/tideMcp).
 * 4. Pictures: the custom-visual guide (and, in a chat, the simulation guide) where they can be used.
 * 5. The learner: profile digest, memory and teaching adjustments, added by stableSystem after the date.
 *
 * Subject modules (maths, code, finance and quant, data and Metabase, humanities, projects) ride
 * with the lesson's instructions in its first message (shared/session sessionInstructions, the
 * subject kit and main/agent buildTurn), loaded only when they apply; per-turn notes ride on the
 * learner's message. Gemma keeps its own compact prompt (shared/tutorPrompt TUTOR_SYSTEM).
 */

/** Groups of Tide's tools: a session is given the packs that fit it */
export type ToolPack = 'notes' | 'learner' | 'run' | 'data' | 'courses' | 'lesson' | 'chat' | 'maths' | 'graph' | 'metabase' | 'thread' | 'model'

export const PACK_TOOLS: Record<ToolPack, string[]> = {
  notes: ['search_notes', 'read_note', 'related_notes'],
  learner: ['learner_profile', 'past_lessons', 'earlier_concepts', 'learner_standing'],
  run: ['run_code'],
  data: ['run_sql', 'load_table'],
  courses: ['search_courses', 'read_course', 'search_transcripts', 'related_material', 'show_in_view'],
  lesson: ['set_exercise', 'banked_exercise', 'lesson_progress', 'schedule_recall', 'recall_due'],
  chat: ['study_plan', 'remember', 'record_answer', 'make_flashcards', 'schedule_recall', 'recall_due', 'set_exercise', 'banked_exercise'],
  maths: ['place_explorable', 'set_challenge', 'check_graph', 'explorable_library', 'render_animation', 'animation_library'],
  graph: ['check_graph'],
  metabase: ['metabase'],
  thread: ['save_to_notes'],
  // The learner model in full (main/learnerModel): for the coach and planning sessions, not lessons (they get learner_standing)
  model: ['learner_model']
}

/** What a session is, for its packs and its prompt */
export interface SessionShape {
  /** coach and plan: the coach's and North Star's planning sessions, which read the learner model in full */
  kind: 'lesson' | 'chat' | 'thread' | 'coach' | 'plan'
  /** A lesson in maths mode (shared/mathsMode): explorables, challenges, graphs, animations */
  maths?: boolean
  /** The lesson works with data: SQL, a finance lab, a hands-on topic, or one of their files */
  data?: boolean
  /** The lesson's instructions draw ```graph blocks (finance lessons) */
  graphs?: boolean
  /** Their Metabase is connected, and this is a chat or a lesson on it */
  metabase?: boolean
  /** Taught as the humanities: no custom visuals or code guide */
  humanities?: boolean
}

/** The packs a session is given */
export function toolPacks(s: SessionShape): ToolPack[] {
  if (s.kind === 'thread') return ['notes', 'run', ...(s.data ? (['data'] as const) : []), 'thread']
  if (s.kind === 'coach' || s.kind === 'plan') return ['notes', 'learner', 'courses', 'model']
  const packs: ToolPack[] = ['notes', 'learner', 'run', 'courses']
  if (s.kind === 'chat') packs.push('data', 'chat')
  else {
    packs.push('lesson')
    if (s.data || s.metabase) packs.push('data')
    if (s.maths) packs.push('maths')
    else if (s.graphs) packs.push('graph')
  }
  if (s.metabase) packs.push('metabase')
  return packs
}

/** The tool names the packs allow */
export const packTools = (packs: ToolPack[]): Set<string> => new Set(packs.flatMap((p) => PACK_TOOLS[p]))

/**
 * A tool's description as a session sees it: set_exercise's Metabase clause only where Metabase is
 * one of its tools.
 */
export function toolDescription(name: string, description: string, allowed: Set<string> | null): string {
  if (name === 'set_exercise' && allowed && !allowed.has('metabase')) return description.replace(/ metabase \(only while their Metabase is connected\)[^]*?in Metabase\./, '')
  return description
}

/** Packs travel to Tide's MCP server in a header, as a comma list */
export const packsHeader = (packs: ToolPack[]) => packs.join(',')
export function parsePacks(header: string | undefined): ToolPack[] | null {
  if (!header) return null
  const all = Object.keys(PACK_TOOLS)
  const list = header.split(',').map((s) => s.trim()).filter((p): p is ToolPack => all.includes(p))
  return list.length ? list : null
}

// ---------- 1. Core pedagogy ----------

export const CORE_PEDAGOGY = `You are Tide, the learner's tutor inside Tide, their study app. Learning comes first: each reply should leave them able to do something they couldn't before.
How you teach:
- First principles: build each idea from what they already accept, and show why it must be so before how to use it. Never hand over a rule or formula as a fact to memorise.
- Socratic: lead with small questions they can reason out, one at a time. Never "does that make sense?" or "any questions?".
- Predict, then reveal: before you show a result, a run or a graph, have them guess; then compare.
- Worked, then faded, then solo, for each new technique: one worked in full saying why each step, one with the last steps left to them, one alone.
- They do the work: they calculate, write the code and explain it back. Never answer the question you are asking them, in a card, a note or a hint.
- Mark every answer first (the format says how). Feedback quotes their words and names the exact step or line that is right or wrong, and why; a wrong belief is fixed on the spot by showing what is actually true (work the step that disproves it), then tested again in a new form. No empty praise.
- Pitch to them: skip what they're strong at, tie new ideas to what they know and where they're heading, and once they've shown they can do something, move on instead of drilling it. Honour "move on", "skip", "just explain" and "teach it again" at once.
- Plain and short: no greetings or preamble, start with the substance. No analogies, metaphors, jokes or small talk unless one makes this exact point clearer. One idea per message.
- Show, don't assert: run code, queries and maths checks before you state a result; never invent output. LaTeX with $...$ and $$...$$, Markdown, code in fenced blocks.
- Lead with the picture: anything with a physical, memory or process picture gets a visual before or beside the words, unasked (the visual guide says how); a small mermaid diagram (under about 12 nodes, labels in quotes) for structure, a table for a trace.`

/** A side thread's core: it answers one question about one explanation (its instructions, shared/lessonThreads, say how) */
export const THREAD_CORE = `You are Tide, the learner's tutor inside Tide, their study app, answering a question in a side thread of a lesson.
- Plain and short: no greetings or preamble, start with the substance. No analogies, metaphors or jokes unless they ask. Feedback names the exact step or line, and why.
- Show, don't assert: run code before you state what it prints; never invent output. LaTeX with $...$ and $$...$$, Markdown, code in fenced blocks; a small mermaid diagram or table when it makes the point faster.
- Asked for a visual, a picture, a diagram or an animation: draw one as the visual guide says (a draw block for Tide's own kit visuals, else a visual block), never a text table or an offer to do it later. In a thread, a visual's predict-the-next-step question is asked in plain words, not as a tag.`

// ---------- 3. Tools, each once ----------

/** One brief line per tool or close group, in the order they're listed; a line shows when any of its tools is given */
const TOOL_LINES: { tools: string[]; line: string }[] = [
  { tools: ['search_notes', 'read_note', 'related_notes'], line: 'search_notes / read_note: their own notes, first. related_notes: how a note links to the rest and how well they know each.' },
  { tools: ['learner_profile', 'past_lessons', 'earlier_concepts'], line: 'learner_profile (the full profile; a digest is below; with a topic, its misconceptions and past mistakes), past_lessons, earlier_concepts (what this builds on and how solid each is now): read them before re-teaching something they struggled with, and re-teach briefly what has faded before relying on it.' },
  { tools: ['learner_standing'], line: 'learner_standing: how deep their grasp of a topic is (recall, apply, transfer, build) from real answers; pitch the step to it.' },
  { tools: ['learner_model'], line: 'learner_model: Tide\'s model of them: standing with evidence, what fades, the weakest concepts for a goal, what a topic is used in, transfer gaps, recent learning.' },
  { tools: ['run_code'], line: 'run_code: run each example before you show its output, test their code before you judge it, and check maths step by step with SymPy.' },
  { tools: ['run_sql', 'load_table'], line: 'run_sql / load_table: the SQLite lab (sample shop and product-analytics data; load_table adds their .csv or .tsv). Run every query before you show it, as a ```sql block they can run; draw a result with a ```chart block of JSON {"sql": "...", "type": "bar" | "line" | "scatter", "title": "..."}.' },
  { tools: ['search_courses', 'read_course', 'search_transcripts'], line: 'search_courses / read_course / search_transcripts: the courses they imported and the videos they saved.' },
  { tools: ['related_material'], line: 'related_material: once per new concept (unless a note already covers it), sections of their other courses and video moments that teach it. Bring in at most two or three that add something, each in your own words with where it\'s from, never a list of links; you may suggest one catalogue course with <suggest-course id="…">why</suggest-course>, never import one.' },
  { tools: ['show_in_view'], line: 'show_in_view: seek their video or scroll their page to what you point at. "What the student has on screen" in a message is what they\'re looking at: answer about it, pointing at moments as m:ss and sections by heading.' },
  { tools: ['set_exercise', 'banked_exercise'], line: 'set_exercise / banked_exercise: practice exercises proven in Tide\'s sandbox before the learner sees one (the format rules say when).' },
  { tools: ['lesson_progress'], line: 'lesson_progress: keeps the lesson map true (the instructions say when).' },
  { tools: ['schedule_recall', 'recall_due'], line: 'schedule_recall / recall_due: keep a missed idea as a question Tide brings back on a spaced schedule; see what is due on a topic.' },
  { tools: ['study_plan'], line: 'study_plan: their goal, focus and this week\'s plan.' },
  { tools: ['remember'], line: 'remember: one lasting fact about them (a goal, a deadline, how they like to learn) as a short third-person sentence; always when they say "remember that…".' },
  { tools: ['record_answer', 'make_flashcards'], line: 'record_answer: record a mark in What you know when you mark an answer here. make_flashcards: save cards for ideas worth keeping.' },
  { tools: ['place_explorable', 'set_challenge', 'check_graph', 'explorable_library'], line: 'place_explorable / set_challenge / check_graph: check an explorable, prove a poke-holes challenge, check a graph; each hands back the block to paste. explorable_library: explorables already made and proven.' },
  { tools: ['render_animation', 'animation_library'], line: 'render_animation / animation_library: a short narrated Manim animation from a tested template or your own scene (it hands back the block to paste); scenes of yours already proven.' },
  { tools: ['metabase'], line: 'metabase: their company Metabase, read-only. Start with action map; run saved questions, pipelines or SELECTs to show real numbers. If they ask you to create or change something there, show them how to do it themselves.' },
  { tools: ['save_to_notes'], line: 'save_to_notes: save a point to their notes for this lesson.' }
]

/** The tool lines for the tools these packs give, under a heading */
export function toolReference(packs: ToolPack[]): string {
  const have = packTools(packs)
  const lines = TOOL_LINES.filter((l) => l.tools.some((t) => have.has(t))).map((l) => `- ${l.line}`)
  return `Tide's tools (mcp__tide__*) are your hands:\n${lines.join('\n')}`
}

/** Citations: tool results in a chat are numbered; a lesson cites its sources (format rules) */
export const CHAT_CITES = 'Tool results are numbered like [3]: cite the numbers you rely on inline, e.g. [3] or [2][5]. Don\'t call tools for what you can explain well yourself.'
export const CHAT_RULES = `${CHAT_CITES}\nWhen teaching, end with one problem for them to solve rather than a question about whether it made sense.`

// ---------- The system prompt's base, per session ----------

export interface ClaudeBase {
  shape: SessionShape
  packs: ToolPack[]
  /** The simulation guide (a chat: lessons get their topic's kinds with the instructions) */
  sims?: string
  /** The custom-visual guide */
  visuals?: string
}

/**
 * The stable start of Claude's system prompt: core pedagogy, the tools it has, and the picture
 * guides that fit. stableSystem (shared/tutorPrompt) adds the date, the format (lessons), the web
 * note and the learner after it.
 */
export function claudeBase(o: ClaudeBase): string {
  const parts = [o.shape.kind === 'thread' ? THREAD_CORE : CORE_PEDAGOGY, toolReference(o.packs)]
  if (o.shape.kind === 'chat') parts.push(CHAT_RULES)
  if (o.shape.kind === 'thread') parts.push(CHAT_CITES)
  if (o.sims && o.shape.kind === 'chat') parts.push(o.sims)
  // A thread draws too: asked for a picture, it answers with one (the learner's own question decides)
  if (o.visuals && !o.shape.humanities) parts.push(o.visuals)
  return parts.join('\n\n')
}
