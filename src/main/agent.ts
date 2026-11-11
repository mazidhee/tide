import { characterById, recentOpenings, splitSay, voiceRules } from '@shared/characters'
import { isMlxVlm } from './modelServer'
import { thingsIntent } from '@shared/learnIntent'
import { graphCached, relatedNotes } from './learn'
import { readTerminal, runInTerminal, terminalInfo } from './terminal'
import { afterBackground, asInteractive, inBackground } from './modelQueue'
import { memoize } from './memo'
import { getCoach, getWeek, profilePrompt } from './coach'
import { todayItems } from '@shared/coach'
import { aboutMetabase } from '@shared/metabase'
import { metabaseHost, metabaseReady, metabaseTool } from './metabase'
import { loadImages, type NoteImage } from './noteImages'
import { pagesToRead } from './books'
import { privatePath } from './projects'
import { requestSent, timeTurn, toolRan } from './speed'
import { readingLabel } from '@shared/books'
import { imageMarkdown } from '@shared/noteImages'
import { addTask, describeTasks, feedbackOnTask, findTask, searchTasks, thingsAvailable, TIDE_TAG } from './things'
import { buildLink, type DeepLink } from '@shared/deeplink'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import type { ChatEvent, ChatMessage, ChatRequest, ContextSource, AgentStep } from '@shared/types'
import { getSettings } from './settings'
import { localSampling } from './sampling'
import { getChunks, indexReady, search } from './search'
import { canTake, CLOUD_REPLY_TOKENS, CloudUnavailable, cloudError, estimateTokens, headersFor, noteLimits, noteSent, recordUsage, routeFor, secondsUntilReset, type CloudTarget } from './cloud'
import { escalationFor, providerInfo, type CloudTask, type RequestKind } from '@shared/providers'
import { SESSION_FORMAT, ownWords } from '@shared/session'
import { findImages } from './images'
import { readText, writeText } from './vault'
import { applyCanvasOps, describeCanvas, parseCanvas, serializeCanvas } from '@shared/canvas'
import { retrieve } from './ai'
import { runCode } from './runner'
import { addMemory, forgetMatching, memoryPrompt } from './memory'
import { fitHistory } from '@shared/context'
import { historyBudget } from './chats'
import { asksForWeb, cleanModelText, createStreamFilter, isLooping, recoverToolCalls, streamWatch } from '@shared/modelText'
import { noteUse, useOf } from './connectionUse'
import { getKey } from './cloud'

/**
 * Tutor harness: an OpenAI-style tool loop the model drives itself. It can search and read
 * the user's notes, search and read the web, and hand sub-questions to parallel helper agents.
 */

const MAX_STEPS = 6
const HELPER_STEPS = 4
const MAX_HELPERS = 3
const TOOL_TEXT_LIMIT = 6000
const UA = 'Tide/0.1 (local study app)'

const SYSTEM = `You are Tide, a patient tutor helping a student learn from their own notes and, when needed, the web.
You can call tools. Use them when they help:
- search_notes / read_note: look things up in the student's own notes first.
- study_plan: the student's goal, focus and this week's plan, including today's agenda. Check it when they ask what to study or what's next, so your advice follows their plan.
- related_notes: how a note connects to the rest of their notes (links, backlinks, notes two steps away), each with how well they know it. Use it to find weak prerequisites, to tie a new idea to what they already know, and to suggest what to study next.
- web_search / read_webpage: for facts, explanations or examples their notes don't cover. Search, then read the best page before relying on it. Your training data is out of date: for anything that changes (prices, rates, laws and regulation, product versions, companies, markets, crypto, news, recent research), search with when set to "year" or "month" instead of answering from memory.
- search_papers: research papers on arXiv, for machine learning, statistics, economics, finance and computer science. Read a paper with read_webpage on its link.
- run_code: run Python or JavaScript in a sandbox. Use it to test the student's code on real cases (including edge cases) before you judge it, and to check maths: with Python and SymPy (from sympy import *) verify each algebra or calculus step before you call it right or wrong, and name the exact line that fails.
- remember: when the student tells you something lasting about themselves (a goal or deadline, their background, what they find hard, how they like to learn), save it as one short sentence in the third person ("Is preparing for Bloomberg interviews in spring 2027"). Don't save facts from their notes, passing questions, or things already in what you remember. When they say "remember that…", always save it.
- forget: when they ask you to forget something, or tell you it's no longer true.
- things_assign / things_tasks / things_feedback (only when connected): the student's to-do app, Things 4, which renders Markdown. Set real work between sessions: a quick task, an assignment, a test (an exam in Tide) or a take-home problem to think through. Write a proper brief (## Goal, ## What to do, ## Deliverable, ## How it will be checked, ## Read) specific to what you've been teaching, give steps and a due date, and point "open" at the right place in Tide (an exam or quiz on their notebook, the note to read, a drill). Ask before setting more than two at once. Use things_tasks (with_notes to read answers they wrote in a task) to see what's done or overdue and adapt; mark their work with things_feedback.
- metabase (only when connected): the student's company Metabase, read-only, to help them learn it. Search it, open dashboards, questions (saved queries) and tables to explain what each measures and how it's built, and run a saved question or a SELECT to show real numbers. It can never change anything.
- find_image: a real diagram, figure or photo from Wikimedia Commons. It returns Markdown image lines; put the one that fits in your answer, exactly as given.
- delegate (only offered when a cloud model answers): for big questions with separate parts (e.g. "compare X and Y", "build me a study plan for Z"), give each part to a helper; they research in parallel and report back.
Rules:
- Every tool result is numbered like [3]. Cite the numbers you rely on inline, e.g. [3] or [2][5].
- Don't call tools for things you can explain well yourself, like simple definitions.
- Then teach: clear explanations, a worked example where it helps, Markdown, LaTeX with $...$ and $$...$$.
- Be the tutor who already knows their plans: when they start something new or ask what to learn, connect it to where they're heading (from their profile) and say what you'd do next and why, without waiting to be asked. Pitch to their level: skip what they're strong at.
- When teaching, end with one problem for them to solve rather than a question about whether it made sense.
- Keep it plain and on topic: no analogies, metaphors, jokes, asides or small talk unless one genuinely makes this exact point clearer; most answers need none.
- Teach visually too, so they can see it as well as read it. When there is structure, a process or a relationship (a tree, a graph, a pipeline, a protocol, a state machine, a timeline, a hierarchy), draw it as a small mermaid diagram (under about 12 nodes, short labels in quotes). When the thing exists physically or has a classic textbook figure (anatomy, a circuit, a map, a molecule, a famous chart), show a real one with find_image. A step-by-step trace can be a small table. One good visual beats three.`

const HELPER_SYSTEM = `You are a research helper for a tutor. Investigate only the task you were given using the tools, then reply with a compact summary of what you found (under 200 words) that cites the numbered results you used, like [4]. No greetings.`

// ---------- Tool definitions ----------

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function' as const,
  function: { name, description, parameters: { type: 'object', properties, required } }
})

const NOTE_TOOLS = [
  tool('search_notes', "Search the student's notes. Returns matching passages.", { query: { type: 'string' } }, ['query']),
  tool('read_note', "Read one of the student's notes in full, by its path from search_notes.", { path: { type: 'string' } }, ['path']),
  tool('related_notes', "How one of the student's notes connects to their other notes, with how well they know each. Takes the note's path or title.", { note: { type: 'string' } }, ['note'])
]

/** Real pictures to teach with; the model drops the line it returns straight into its answer */
const IMAGE_TOOL = tool(
  'find_image',
  'Find a real diagram, figure or photo to show the student (from Wikimedia Commons). Use it when seeing something helps: anatomy, a circuit, a map, a historical figure, a labelled diagram of a structure or process. For abstract flows, trees and graphs, draw a mermaid diagram instead. Returns ready-to-use Markdown image lines: copy the one that fits exactly into your answer.',
  { query: { type: 'string', description: 'What the picture shows, in a few English words, e.g. "binary search tree", "mitochondrion diagram"' } },
  ['query']
)

const WEB_TOOLS = [
  tool(
    'web_search',
    'Search the web. Use it for anything that may have changed since you were trained (versions, releases, news, prices, current events) instead of answering from memory. Returns titles, links, dates and snippets.',
    {
      query: { type: 'string' },
      when: { type: 'string', enum: ['any', 'year', 'month', 'week', 'day'], description: 'Only results from this recent period' },
      news: { type: 'boolean', description: 'Search news sites instead of the whole web' }
    },
    ['query']
  ),
  tool('read_webpage', 'Read the main text of a web page or an online PDF. When the student gives you a link, read it with this (never search for it instead).', { url: { type: 'string' } }, ['url']),
  tool('search_papers', 'Search research papers on arXiv. Returns titles, authors, dates, abstracts and links.', { query: { type: 'string' } }, ['query'])
]

const MEMORY_TOOLS = [
  tool('remember', 'Save one lasting fact about the student for future conversations. Call it whenever they tell you something to keep: "remember that…", a preference, a goal, a deadline, how they like to learn.', { fact: { type: 'string', description: 'One short sentence, third person' } }, ['fact']),
  tool('forget', 'Remove something you remember about the student. Call it when they ask you to forget or correct something you remember.', { about: { type: 'string', description: 'What to forget, in a few words' } }, ['about'])
]

const CANVAS_READ = tool('canvas_read', "Read the student's system design canvas: every component with its id and kind, and every connection.", {}, [])
const CANVAS_EDIT = tool(
  'canvas_edit',
  "Draw on the student's system design canvas. Operations run in order; refer to components by id or by name. Kinds: client, lb (load balancer), gateway, service, worker, database, cache, queue, storage, cdn, external, note.",
  {
    ops: {
      type: 'array',
      description: 'For example [{"op":"add","label":"Quote service","kind":"service","near":"Load balancer"},{"op":"connect","from":"Load balancer","to":"Quote service","label":"HTTP"}]',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['add', 'connect', 'update', 'remove', 'disconnect'] },
          label: { type: 'string', description: 'add/update: the component name' },
          kind: { type: 'string' },
          details: { type: 'string', description: 'add/update: a short second line, e.g. "Postgres, read replicas"' },
          id: { type: 'string', description: 'update/remove: which component' },
          near: { type: 'string', description: 'add: place it beside this component' },
          side: { type: 'string', enum: ['right', 'below', 'left', 'above'] },
          from: { type: 'string' },
          to: { type: 'string' }
        },
        required: ['op']
      }
    }
  },
  ['ops']
)
const STUDY_PLAN = tool(
  'study_plan',
  "The student's goal, focus and this week's plan: today's agenda, the rest of the week, and the priorities with reasons. Use it when they ask what to study, what's next, or how they're doing against the plan.",
  {},
  []
)
const THINGS_ADD = tool(
  'things_assign',
  "Set the student work in Things 4, their to-do app: a task, an assignment, a test or a take-home problem, with a full brief and a link that opens the right place in Tide.",
  {
    kind: { type: 'string', enum: ['task', 'assignment', 'test', 'take-home'], description: 'task: small and quick. assignment: a piece of work to hand in. test: an exam in Tide. take-home: one hard problem to think through.' },
    title: { type: 'string', description: 'Short and concrete, e.g. "Derive backprop for a 2-layer MLP"' },
    brief: { type: 'string', description: 'Markdown: ## Goal, ## What to do, ## Deliverable, ## How it will be checked, ## Read. Specific to what you have been teaching.' },
    steps: { type: 'array', items: { type: 'string' }, description: 'The steps, as a checklist' },
    start: { type: 'string', description: 'When to start: today, tomorrow, a weekday, or yyyy-mm-dd' },
    due: { type: 'string', description: 'yyyy-mm-dd' },
    open: {
      type: 'object',
      description: 'Where the task opens in Tide. exam/quiz/teach need a topic; scope is "folder:<notebook>" or "note:<path.md>" to draw on their notes; note needs a path.',
      properties: {
        type: { type: 'string', enum: ['exam', 'quiz', 'teach', 'note', 'drill', 'practice'] },
        topic: { type: 'string' },
        scope: { type: 'string' },
        path: { type: 'string' },
        difficulty: { type: 'string', enum: ['gentle', 'normal', 'hard', 'olympiad'] },
        minutes: { type: 'number' }
      }
    }
  },
  ['kind', 'title', 'brief']
)
const THINGS_TASKS = tool(
  'things_tasks',
  "See the work Tide set in Things 4: open tasks with their deadlines, or what the student finished, including any answers they wrote in a task's notes.",
  {
    status: { type: 'string', enum: ['open', 'completed', 'all'] },
    completed_since: { type: 'string', description: 'yyyy-mm-dd, for finished tasks' },
    search: { type: 'string', description: 'Words in the title' },
    with_notes: { type: 'boolean', description: "Include each task's notes (to read the student's answers)" }
  },
  []
)
const THINGS_FEEDBACK = tool(
  'things_feedback',
  "Write feedback into a Things 4 task's notes (under what the student wrote), and optionally mark it done. Use after reviewing their answer.",
  {
    task: { type: 'string', description: 'The task id or its exact title' },
    feedback: { type: 'string', description: 'Final marking in Markdown: **Verdict:** (with n/10), **What you got right:**, **What to fix:**, **Answer:**, **Next:**. No thinking aloud.' },
    complete: { type: 'boolean' }
  },
  ['task', 'feedback']
)
const METABASE = tool(
  'metabase',
  "Read the student's Metabase (read-only): search it, open a dashboard, question or table, list databases, run a saved question, or run a SELECT.",
  {
    action: { type: 'string', enum: ['search', 'databases', 'dashboard', 'question', 'table', 'run_question', 'sql'] },
    q: { type: 'string', description: 'search: words to look for' },
    id: { type: 'number', description: 'Needed for dashboard, question, table and run_question: the id from a search' },
    database: { type: 'number', description: 'sql: the database id' },
    sql: { type: 'string', description: 'sql: one SELECT; add a LIMIT' }
  },
  ['action']
)
const TERMINAL_READ = tool('terminal_read', "Read what the student's terminal shows now: recent commands and output.", { lines: { type: 'number', description: 'How many recent lines, default 60' } }, [])
const TERMINAL_RUN = tool(
  'terminal_run',
  "Type a command into the student's Linux lab terminal (a disposable Ubuntu container) and return its output. Use it to set up exercises or demonstrate; let the student type the commands they're learning.",
  { command: { type: 'string' } },
  ['command']
)

const CODE_TOOL = tool(
  'run_code',
  'Run Python or JavaScript in a sandbox (no network, no files). Use it for any exact calculation (large numbers, sequences, probabilities, algebra) rather than working it out in your head. Returns stdout, stderr and the exit code. Python has SymPy.',
  { language: { type: 'string', enum: ['python', 'javascript'] }, code: { type: 'string' }, stdin: { type: 'string' } },
  ['language', 'code']
)

const DELEGATE_TOOL = tool(
  'delegate',
  'Hand separate sub-questions to helpers that research them in parallel, in the notes and on the web. Use it when asked to research or compare something in depth from several sources.',
  {
    tasks: {
      type: 'array',
      description: `Up to ${MAX_HELPERS} self-contained research tasks`,
      items: { type: 'string' }
    }
  },
  ['tasks']
)

// ---------- Web search providers ----------

interface WebResult {
  title: string
  url: string
  snippet: string
  /** Publication date when the source gives one, YYYY-MM-DD */
  date?: string
}

export interface SearchOptions {
  when?: 'any' | 'year' | 'month' | 'week' | 'day'
  news?: boolean
}

const isoDay = (d: unknown) => {
  if (typeof d !== 'string' || !d) return undefined
  const t = Date.parse(d)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10)
}

async function wikipediaSearch(query: string): Promise<WebResult[]> {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=6&srsearch=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) }
  )
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`)
  const json = (await res.json()) as { query?: { search?: { title: string; snippet: string; timestamp?: string }[] } }
  return (json.query?.search ?? []).map((r) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: stripTags(r.snippet)
  }))
}

/** De-duplicates by address (ignoring tracking bits and trailing slashes) */
function uniqueResults(results: WebResult[], limit: number): WebResult[] {
  const seen = new Set<string>()
  const out: WebResult[] = []
  for (const r of results) {
    let key = r.url
    try {
      const u = new URL(r.url)
      key = (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase()
    } catch {
      // keep the raw address as the key
    }
    if (!r.url || seen.has(key)) continue
    seen.add(key)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

/** arXiv's public API (Atom). No key; asks callers to keep to about one request every few seconds. */
async function searchPapersNow(query: string): Promise<WebResult[]> {
  const terms = query
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
  if (!terms.length) return []
  const q = terms.map((t) => `all:${t}`).join('+AND+')
  const res = await fetch(`https://export.arxiv.org/api/query?search_query=${q}&max_results=6&sortBy=relevance`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`arXiv answered ${res.status}`)
  const xml = await res.text()
  const field = (entry: string, tag: string) => entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const authors = [...e.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1].trim())
    const id = field(e, 'id').replace(/^http:/, 'https:')
    return {
      title: stripTags(field(e, 'title')),
      url: id,
      date: isoDay(field(e, 'published')),
      snippet: `${authors.slice(0, 4).join(', ')}${authors.length > 4 ? ' et al.' : ''}. ${stripTags(field(e, 'summary')).slice(0, 500)}`
    }
  })
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")

async function webSearchNow(query: string, opts: SearchOptions = {}): Promise<WebResult[]> {
  const { webSearch: cfg } = getSettings().ai
  const provider = cfg?.provider ?? 'wikipedia'
  if (provider === 'off') throw new Error('Web search is turned off in Settings.')
  // Keys live in the Keychain now; one typed into an older version is still read from settings
  const key = provider === 'you' ? getKey('you') || '' : provider === 'brave' || provider === 'tavily' ? getKey(provider) || cfg?.apiKey || '' : ''

  if (provider === 'you') {
    // A one-time credit, not a monthly one: stop well before it's gone (about $5 per 1,000 searches)
    if (!key) throw new Error('Add a You.com key in Settings › Connections to search the web.')
    const used = useOf('you')
    if (used.thisMonth >= YOU_MONTHLY || used.total >= YOU_TOTAL) return wikipediaSearch(query)
    noteUse('you')
    const params = new URLSearchParams({ query, count: '8' })
    if (opts.when && opts.when !== 'any') params.set('freshness', opts.when)
    const res = await fetch(`https://ydc-index.io/v1/search?${params}`, { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    // Out of credit, a bad key or too many at once: Wikipedia answers instead
    if (!res.ok) return wikipediaSearch(query)
    type YouHit = { title?: string; url?: string; description?: string; snippets?: string[]; page_age?: string }
    const json = (await res.json()) as { results?: { web?: YouHit[]; news?: YouHit[] } | YouHit[]; hits?: YouHit[] }
    const hits = Array.isArray(json.results) ? json.results : [...((opts.news ? json.results?.news : json.results?.web) ?? []), ...(json.hits ?? [])]
    return uniqueResults(hits.filter((h) => h.url).map((h) => ({ title: h.title ?? h.url!, url: h.url!, snippet: stripTags(h.description || h.snippets?.[0] || '').slice(0, 300), date: isoDay(h.page_age) })), 8)
  }
  noteUse(provider)

  if (provider === 'brave') {
    if (!key) throw new Error('Add a Brave Search API key in Settings to search the web.')
    const freshness = { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[opts.when ?? 'any' as string] as string | undefined
    const res = await fetch(
      `https://api.search.brave.com/res/v1/${opts.news ? 'news' : 'web'}/search?count=8&q=${encodeURIComponent(query)}${freshness ? `&freshness=${freshness}` : ''}`,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal: AbortSignal.timeout(15_000) }
    )
    if (!res.ok) throw new Error(`Brave Search answered ${res.status}`)
    type BraveHit = { title: string; url: string; description: string; page_age?: string; age?: string }
    const json = (await res.json()) as { web?: { results?: BraveHit[] }; results?: BraveHit[] }
    return uniqueResults(
      (json.web?.results ?? json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: stripTags(r.description ?? ''), date: isoDay(r.page_age) })),
      8
    )
  }

  if (provider === 'tavily') {
    if (!key) throw new Error('Add a Tavily API key in Settings to search the web.')
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 8, topic: opts.news ? 'news' : 'general', ...(opts.when && opts.when !== 'any' ? { time_range: opts.when } : {}) }),
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) throw new Error(`Tavily answered ${res.status}`)
    const json = (await res.json()) as { results?: { title: string; url: string; content: string; published_date?: string }[] }
    return uniqueResults((json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 300) ?? '', date: isoDay(r.published_date) })), 8)
  }

  if (provider === 'searxng') {
    if (!cfg?.url) throw new Error('Add your SearXNG address in Settings to search the web.')
    const params = new URLSearchParams({ format: 'json', q: query, language: 'en' })
    if (opts.news) params.set('categories', 'news')
    if (opts.when && opts.when !== 'any') params.set('time_range', opts.when)
    try {
      const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/search?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`SearXNG answered ${res.status}`)
      const json = (await res.json()) as { results?: { title: string; url: string; content?: string; publishedDate?: string | null }[] }
      const results = uniqueResults((json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: stripTags(r.content ?? ''), date: isoDay(r.publishedDate) })), 8)
      if (results.length || !opts.when) return results
      // Nothing that recent: widen rather than come back empty
      return webSearch(query, { ...opts, when: 'any' })
    } catch (e) {
      // The local engine is down (Docker closed, laptop just woke): keep teaching with Wikipedia
      const wiki = await wikipediaSearch(query).catch(() => [])
      if (!wiki.length) throw e
      return [{ title: 'Note', url: '', snippet: `Web search is offline (${(e as Error).message}); these are Wikipedia results only.` }, ...wiki]
    }
  }

  // Default: Wikipedia's public API, no key needed
  return wikipediaSearch(query)
}

const MAX_PDF = 40 * 1024 * 1024

/** Text of an online PDF, first pages only: enough to teach from without reading a whole book */
async function pdfFromResponse(res: Response, url: string): Promise<{ title: string; text: string }> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_PDF) throw new Error('That PDF is too large to read here. Save it to the library instead.')
  const data = new Uint8Array(await res.arrayBuffer())
  if (data.byteLength > MAX_PDF) throw new Error('That PDF is too large to read here. Save it to the library instead.')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= Math.min(doc.numPages, 25); i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+/g, ' ').trim())
    }
    const meta = (await doc.getMetadata().catch(() => null))?.info as { Title?: string } | undefined
    const title = meta?.Title?.trim() || decodeURIComponent(new URL(url).pathname.split('/').pop() || url)
    return { title, text: pages.join('\n\n') }
  } finally {
    await doc.destroy()
  }
}

async function readWebpageNow(url: string, cloudOk = true): Promise<{ title: string; text: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be read.')
  // arXiv abstract pages are thin; the PDF has the content
  const arxiv = url.match(/^https?:\/\/(?:www\.)?arxiv\.org\/abs\/([\w.\/-]+?)(?:v\d+)?$/)
  if (arxiv) url = `https://arxiv.org/pdf/${arxiv[1]}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) }).catch((e: Error) => e)
  // Blocked, or built by JavaScript: Firecrawl reads it, when it's set up
  if (res instanceof Error || !res.ok) {
    const viaFirecrawl = cloudOk ? await firecrawl(url).catch(() => null) : null
    if (viaFirecrawl) return viaFirecrawl
    throw res instanceof Error ? res : new Error(`The page answered ${res.status}`)
  }
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/pdf') || /\.pdf($|\?)/i.test(res.url || url)) return pdfFromResponse(res, res.url || url)
  if (!type.includes('html') && !type.includes('text')) throw new Error(`Can't read ${type || 'this kind of file'} pages yet.`)
  const dom = new JSDOM(await res.text(), { url: res.url || url })
  const article = new Readability(dom.window.document).parse()
  const text = (article?.textContent ?? dom.window.document.body?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
  const title = article?.title || dom.window.document.title || url
  if (text.length < 600 && cloudOk) {
    const viaFirecrawl = await firecrawl(url).catch(() => null)
    if (viaFirecrawl && viaFirecrawl.text.length > text.length) return viaFirecrawl
  }
  return { title, text }
}

/** You.com's credit is one-time (about $5 per 1,000 searches): Tide stops at $90 of it, and paces it at 1,500 a month */
const YOU_TOTAL = 18_000
const YOU_MONTHLY = 1500
/** Firecrawl's free pages a month, kept a little short of the 1,000 */
const FIRECRAWL_MONTHLY = 950

/** Only an ordinary public address goes to Firecrawl: never your Metabase, this Mac or your network,
 *  a link with a login in it, or a signed link whose query is a key */
export function publicUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const mb = metabaseHost()
  if (mb && (host === mb || host.endsWith(`.${mb}`))) return false
  if (u.username || u.password) return false
  if (!host.includes('.') || /\.(local|internal|lan|home|corp|localhost)$/.test(host)) return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host === '::1' || /^f[cd]|^fe80/.test(host)) return false
  if (/(^|[?&])(token|key|sig|signature|auth|access_token|api_key|x-amz-[a-z-]+|jwt|secret)=/i.test(u.search)) return false
  return true
}

/** A public page read by Firecrawl as clean Markdown: only when the plain reader got little or nothing */
async function firecrawl(url: string): Promise<{ title: string; text: string } | null> {
  const key = getKey('firecrawl')
  if (!key || !publicUrl(url) || useOf('firecrawl').thisMonth >= FIRECRAWL_MONTHLY) return null
  noteUse('firecrawl')
  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    signal: AbortSignal.timeout(45_000)
  })
  if (!res.ok) return null
  const j = (await res.json()) as { data?: { markdown?: string; metadata?: { title?: string } } }
  const text = j.data?.markdown?.trim() ?? ''
  return text ? { title: j.data?.metadata?.title || url, text } : null
}

// ---------- Streaming completion with tool calls ----------

interface ToolCall {
  id: string
  name: string
  arguments: string
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** A list of parts when a message carries images (vision models) */
  content: string | ContentPart[] | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

/** Some local models (Gemma) leak their native tool-call syntax into text; never show it */
const LEAKED_TOOL_CALL = /<\|tool_call>[\s\S]*?(<tool_call\|>|$)/g

async function resolveModel() {
  const { model } = getSettings().ai
  if (model) return model
  const { listModels } = await import('./ai')
  return (await listModels().catch(() => []))[0] ?? 'default'
}

/** Streams one model turn, forwarding text as it arrives and collecting any tool calls. */
/** Gemma opened a fresh thought channel in the middle of its answer (it stalls there, repeating it) */
class StallError extends Error {
  constructor(public partial: string) {
    super('The model stalled mid-reply')
  }
}

class LoopingError extends Error {
  /** What was written before it started repeating, to keep if the retry loops too */
  constructor(
    message: string,
    public partial = ''
  ) {
    super(message)
  }
}

/** Tells the window to clear the reply it's showing (a retry is starting over) */
export const RESET = '\u0000reset'

/** The text before a run of repetition, ended at its last full sentence */
function beforeLoop(text: string): string {
  const m = text.match(/(\b[\w'’-]{1,24}\b)(?:\s+\1){10,}\s*$/) ?? text.match(/(.{2,60}\n)\1{8,}$/)
  let kept = m ? text.slice(0, m.index) : text
  // Also drop a sentence repeated three or more times at the end
  const sentences = kept.match(/[^.!?\n]+[.!?]+\s*/g) ?? []
  while (sentences.length > 2 && sentences[sentences.length - 1].trim() === sentences[sentences.length - 2].trim()) sentences.pop()
  if (sentences.length) kept = kept.slice(0, kept.lastIndexOf(sentences[sentences.length - 1]) + sentences[sentences.length - 1].length)
  return kept.trim()
}

/**
 * mlx-vlm saves the conversation's state where request-only context begins, so the next turn
 * (which starts with exactly that conversation) continues from there instead of reading it all
 * again. Without it, the save lands after the reply's opening marker, which the next turn renders
 * differently, and only an older checkpoint matches. The note itself is small and useful: the time.
 */
function transientContext(): { transient_context?: string } {
  if (!isMlxVlm()) return {}
  const now = new Date().toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return { transient_context: `(Context from the app, not the student: it is ${now}.)` }
}

/** Retries a turn once with more randomness when the model gets stuck repeating itself */
async function streamTurn(messages: ApiMessage[], tools: unknown[], signal: AbortSignal, onText: (t: string) => void, ctx?: LoopContext) {
  const cloud = ctx?.cloud
  if (cloud && !cloud.fellBack) {
    let wrote = false
    try {
      // Don't send what the provider's per-minute allowance can't take: Gemma answers at once instead
      const needed = estimateTokens(JSON.stringify(messages).length + JSON.stringify(tools).length) + CLOUD_REPLY_TOKENS
      if (!canTake(needed, cloud.target)) throw new CloudUnavailable(`The cloud model’s per-minute limit is used up for about ${secondsUntilReset(cloud.target)}s`)
      return await streamTurnOnce(messages, tools, signal, (t) => ((wrote = true), onText(t)), 0, cloud.target, cloud.task)
    } catch (e) {
      if (signal.aborted || !(e instanceof CloudUnavailable || e instanceof TypeError)) throw e
      // The cloud can't take it right now: Gemma answers, and the step says why
      cloud.fellBack = true
      ctx!.updateStep(cloud.stepId, { status: 'error', detail: `${(e as Error).message}. Gemma answered instead.` })
      if (wrote) onText(RESET)
    }
  }
  return asInteractive(() => streamTurnRetrying(messages, tools, signal, onText))
}

async function streamTurnRetrying(messages: ApiMessage[], tools: unknown[], signal: AbortSignal, onText: (t: string) => void) {
  try {
    return await streamTurnContinuing(messages, tools, signal, onText)
  } catch (e) {
    if (!(e instanceof LoopingError)) throw e
    // Start over, with more randomness; the window clears what it had shown
    onText(RESET)
    try {
      return await streamTurnOnce(messages, tools, signal, onText, 0.35)
    } catch (again) {
      if (!(again instanceof LoopingError)) throw again
      // Stuck twice: keep what was said before it started repeating, rather than nothing
      const kept = beforeLoop(again.partial) || beforeLoop(e.partial)
      if (!kept) throw again
      onText(RESET)
      onText(kept)
      return { text: kept, calls: [] }
    }
  }
}

async function streamTurnOnce(
  messages: ApiMessage[],
  tools: unknown[],
  outerSignal: AbortSignal,
  onText: (t: string) => void,
  extraTemperature: number,
  target?: CloudTarget | null,
  task: RequestKind = 'tutor'
): Promise<{ text: string; calls: ToolCall[] }> {
  const { baseUrl, apiKey, temperature } = getSettings().ai
  const controller = new AbortController()
  const abort = () => controller.abort()
  outerSignal.addEventListener('abort', abort)
  const signal = controller.signal
  const filter = createStreamFilter()
  const model = target ? target.model : await resolveModel()
  // A cloud model gets a plain OpenAI request: none of the local server's fields, but its real token counts back
  const payload = target
    ? { model, messages, temperature: Math.min(1, temperature + extraTemperature), stream: true, max_tokens: CLOUD_REPLY_TOKENS, stream_options: { include_usage: true }, ...(tools.length ? { tools } : {}), ...target.extra }
    : {
        model,
        messages,
        temperature: Math.min(1.2, temperature + extraTemperature),
        ...localSampling(model, extraTemperature > 0),
        stream: true,
        // The real token counts back (prompt, cached, written), for Usage and Settings › Speed
        stream_options: { include_usage: true },
        max_tokens: 3000,
        ...(tools.length ? { tools } : {}),
        ...transientContext()
      }
  // Dev only: keep the last request so model behaviour can be replayed outside the app
  if (process.env.TIDE_DEBUG_AI) {
    const { writeFileSync } = await import('fs')
    writeFileSync(process.env.TIDE_DEBUG_AI, JSON.stringify(payload, null, 1))
  }
  if (target) noteSent(target.provider)
  const startAt = performance.now()
  const timed = requestSent()
  const res = await fetch(target ? `${target.baseUrl}/chat/completions` : `${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: target ? headersFor(target) : { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(payload),
    signal
  }).catch((e) => {
    outerSignal.removeEventListener('abort', abort)
    if (target && !outerSignal.aborted) throw new CloudUnavailable(`Couldn't reach the cloud model: ${(e as Error).message}`)
    throw e
  })
  if (target && (!res.ok || !res.body)) {
    outerSignal.removeEventListener('abort', abort)
    throw await cloudError(res, target)
  }
  if (target) noteLimits(res.headers, target)
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI server answered ${res.status}: ${detail.slice(0, 300) || res.statusText}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const t0 = Date.now()
  let firstAt = 0
  let buffer = ''
  let text = ''
  let raw = ''
  // How many thought-channel openings there were when the answer began; another one after that is a stall
  let channelsAtStart = -1
  const watch = streamWatch()
  let usage: { input: number; output: number; cached?: number } | null = null
  const calls = new Map<number, ToolCall>()
  let firstTokenAt = 0
  // Tide's own time on the stream: from each piece arriving to asking for the next
  let tideMs = 0
  let tokens = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const got = performance.now()
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, '')
      if (!data || data === '[DONE]' || !line.trim().startsWith('data:')) continue
      try {
        const chunk = JSON.parse(data)
        const u = chunk.usage ?? chunk.x_groq?.usage
        if (u) usage = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens }
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content || delta?.tool_calls) {
          firstAt ||= Date.now()
          firstTokenAt ||= performance.now()
          tokens++
        }
        if (delta?.content) {
          raw += delta.content
          const visible = filter(delta.content)
          text += visible
          watch.raw(raw)
          watch.text(text)
          // Watch the raw stream too: repeated hidden reasoning blocks never show up in the text
          // Code inside a tool call written as text can repeat lines legitimately: don't judge it
          const inCall = watch.inCall
          const channels = watch.channels
          if (channelsAtStart < 0 && text.trim()) channelsAtStart = channels
          if (!inCall && channelsAtStart >= 0 && channels > channelsAtStart) {
            controller.abort()
            outerSignal.removeEventListener('abort', abort)
            throw new StallError(cleanModelText(text))
          }
          if (!inCall && (isLooping(text) || isLooping(raw) || channels >= 3)) {
            controller.abort()
            outerSignal.removeEventListener('abort', abort)
            throw new LoopingError('The model got stuck repeating itself', cleanModelText(text))
          }
          // Never show a tool call the server passed through as text: judge by the raw stream, since
          // the filter strips the special tokens that mark it, and hold back a bare "call:name{" too
          if (visible && !inCall && !watch.bareCall) onText(visible)
        }
        for (const tc of delta?.tool_calls ?? []) {
          const i = tc.index ?? 0
          const current = calls.get(i) ?? { id: tc.id ?? `call_${i}`, name: '', arguments: '' }
          if (tc.id) current.id = tc.id
          if (tc.function?.name) current.name += tc.function.name
          if (tc.function?.arguments) current.arguments += tc.function.arguments
          calls.set(i, current)
        }
      } catch (e) {
        // A partial line is skipped; a stuck model must reach the retry, not vanish here
        if (e instanceof LoopingError || e instanceof StallError) throw e
      }
    }
    tideMs += performance.now() - got
  }
  outerSignal.removeEventListener('abort', abort)
  timed({ engine: target ? 'cloud' : 'local', model, startAt, firstTokenAt, endAt: performance.now(), tokens: usage?.output ?? tokens, promptTokens: usage?.input, cachedTokens: usage?.cached, tideMs })
  const promptChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length), 0)
  recordUsage({
    kind: target ? 'cloud' : 'local',
    provider: target ? target.provider : 'local',
    model,
    task,
    ...(usage ?? { input: estimateTokens(promptChars + JSON.stringify(tools).length), output: estimateTokens(raw.length) }),
    estimated: !usage
  })
  let found = [...calls.values()].filter((c) => c.name)
  // The server sometimes hands a call back as text (Gemma stuttered its opening tag): run it anyway
  if (!found.length && raw.includes('<|tool_call')) found = recoverToolCalls(raw).map((c, i) => ({ id: `recovered_${Date.now()}_${i}`, name: c.name, arguments: c.arguments }))
  // Dev only: where the time went in each model turn
  if (process.env.TIDE_DEBUG_AI) {
    const promptChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length), 0)
    ;(await import('fs')).appendFileSync(
      `${process.env.TIDE_DEBUG_AI}.timing`,
      JSON.stringify({ at: new Date().toISOString(), promptChars, tools: tools.length, firstTokenMs: firstAt ? firstAt - t0 : null, totalMs: Date.now() - t0, outChars: raw.length, calls: found.map((c) => c.name) }) + '\n'
    )
  }
  return { text: cleanModelText(text.replace(LEAKED_TOOL_CALL, '')).trim(), calls: found }
}

// ---------- The loop ----------

interface LoopContext {
  signal: AbortSignal
  sources: ContextSource[]
  emitSources(): void
  step(step: Omit<AgentStep, 'id'>): string
  updateStep(id: string, patch: Partial<AgentStep>): void
  web: boolean
  /** Conversation being answered, so memories can point back to it */
  chatId?: string
  /** Terminal attached to this conversation */
  terminalId?: string
  /** System design canvas (a vault path) the tutor can read and draw on */
  canvasPath?: string
  /** A lesson, quiz or interview: only the tools teaching needs, so the prompt stays short */
  focused?: boolean
  /** About a private project or your Metabase: nothing from it may go to a cloud service */
  private?: boolean
  /** This turn goes to the cloud model (Gemma takes over if it can't) */
  cloud?: { target: CloudTarget; task: RequestKind; stepId: string; fellBack?: boolean }
}

// Searches and pages are cached for a while: the model often repeats a query or rereads a page
// within one conversation. News and past-day searches go stale fastest.
const normalQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ')
export const webSearch = memoize<[query: string, opts?: SearchOptions], WebResult[]>(webSearchNow, {
  ttlMs: (_q, opts) => (opts?.news || opts?.when === 'day' ? 5 * 60_000 : 30 * 60_000),
  key: (q, opts) => JSON.stringify([getSettings().ai.webSearch?.provider ?? 'wikipedia', normalQuery(q), opts?.when ?? 'any', !!opts?.news])
})
export const searchPapers = memoize(searchPapersNow, { ttlMs: 60 * 60_000, key: (q) => normalQuery(q) })
export const readWebpage = memoize(readWebpageNow, { ttlMs: 60 * 60_000, max: 40, key: (url, cloudOk = true) => `${cloudOk ? 'c' : 'l'}${url.trim()}` })

/** A chat request as main builds it: a stored conversation adds its running summary */
export type TurnRequest = ChatRequest & { summary?: string; /** Only read the opening into the server's cache */ warmOnly?: boolean }

/** The part of the system prompt that stays the same from turn to turn, so a local server can reuse its cache */
export async function stablePrompt(base: string, req: TurnRequest, web: boolean, session = false): Promise<string> {
  const memory = await memoryPrompt().catch(() => '')
  const profile = await profilePrompt().catch(() => '')
  return (
    base +
    `\nToday is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` +
    (web
      ? ''
      : '\nWeb search is switched off for this conversation, so you cannot look anything up online. If the student asks you to search or asks about something recent, say that you can if they switch on "Web" under the message box (or in the session toolbar), then answer from what you know, saying it may be out of date.') +
    // A session's tag rules are the same for every lesson, so they sit here, cached with the prompt
    (session ? `\n\n${SESSION_FORMAT}` : '') +
    (profile ? `\n\n${profile}` : '') +
    (memory ? `\n\n${memory}` : '')
  )
}

/**
 * A long conversation's running summary, at the head of its first remaining message. Not in the
 * system prompt: each new summary would change the start of the prompt, and the server would
 * read the whole system prompt and tool list again instead of reusing them.
 */
export function withSummary<T extends { role: string; content: string | unknown }>(messages: T[], summary?: string): T[] {
  if (!summary) return messages
  const first = messages.findIndex((m) => m.role === 'user')
  if (first < 0) return messages
  return messages.map((m, i) => (i === first ? { ...m, content: `Summary of our conversation so far (the transcript picks up after it):\n${summary}\n\n---\n\n${String(m.content)}` } : m))
}

/** A session's instructions, at the head of its first message (the same text every turn) */
export function withInstructions<T extends { role: string; content: string | unknown }>(messages: T[], instructions?: string): T[] {
  if (!instructions) return messages
  const first = messages.findIndex((m) => m.role === 'user')
  if (first < 0) return messages
  return messages.map((m, i) => (i === first ? { ...m, content: `How to tutor me here:\n${instructions}\n\n---\n\n${String(m.content)}` } : m))
}

/**
 * Puts this turn's passages and selection into the newest user message rather than the system
 * prompt, so everything before it is identical to the previous request.
 */
export function withTurnContext<T extends { role: string; content: string | unknown }>(messages: T[], context: string): T[] {
  if (!context) return messages
  const last = messages.length - 1
  if (last < 0 || messages[last].role !== 'user') return messages
  return messages.map((m, i) => (i === last ? { ...m, content: `${context}\n\n---\n\n${String(m.content)}` } : m))
}

/**
 * The context each message was first sent with, so later turns resend it word for word. The local
 * server can only reuse a cached prompt that the new prompt starts with exactly (Gemma 4's sliding
 * window rules out partial reuse), so a conversation must only ever grow at the end: if an earlier
 * message lost its context, every turn would be read from scratch (20 seconds before a word).
 */
const sentContext = new Map<string, string>()
const SENT_MAX = 400

const fnv = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** Earlier messages get back the context they were sent with; the last gets this turn's, remembered */
export function withStableContext<T extends { role: string; content: string | unknown }>(messages: T[], context: string): T[] {
  // A conversation is known by its first message; a message by its place and words
  const first = String(messages.find((m) => m.role === 'user')?.content ?? '')
  const key = (i: number, content: string) => `${fnv(first)}:${i}:${fnv(content)}`
  const last = messages.length - 1
  const out = messages.map((m, i) => {
    if (m.role !== 'user' || i === last) return m
    const ctx = sentContext.get(key(i, String(m.content)))
    return ctx ? { ...m, content: `${ctx}\n\n---\n\n${String(m.content)}` } : m
  })
  if (context && last >= 0 && messages[last].role === 'user') {
    const k = key(last, String(messages[last].content))
    sentContext.delete(k)
    sentContext.set(k, context)
    while (sentContext.size > SENT_MAX) sentContext.delete(sentContext.keys().next().value!)
  }
  return withTurnContext(out, context)
}

const clip = (s: string, n = TOOL_TEXT_LIMIT) => (s.length > n ? s.slice(0, n) + '\n…' : s)

function addSource(ctx: LoopContext, s: Omit<ContextSource, 'index'>): number {
  const existing = ctx.sources.find((x) => x.path === s.path && x.heading === s.heading && x.url === s.url)
  if (existing) return existing.index
  const index = ctx.sources.length + 1
  ctx.sources.push({ ...s, index })
  ctx.emitSources()
  return index
}

async function runTool(call: ToolCall, ctx: LoopContext, depth: number): Promise<string> {
  const t0 = performance.now()
  try {
    return await runToolNow(call, ctx, depth)
  } finally {
    toolRan(call.name, performance.now() - t0)
  }
}

async function runToolNow(call: ToolCall, ctx: LoopContext, depth: number): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    // Dev only: keep the tool calls next to the last request, to see what the model actually sent
    if (process.env.TIDE_DEBUG_AI) (await import('fs')).appendFileSync(`${process.env.TIDE_DEBUG_AI}.tools`, JSON.stringify({ name: call.name, arguments: call.arguments }) + '\n')
    args = JSON.parse(call.arguments || '{}')
  } catch {
    return 'The tool arguments were not valid JSON.'
  }
  const str = (k: string) => String(args[k] ?? '').trim()

  if (call.name === 'search_notes') {
    const q = str('query')
    const id = ctx.step({ kind: 'search_notes', label: `Searching your notes for “${q}”`, status: 'running', depth })
    await indexReady()
    const hits = search(q, 6)
    ctx.updateStep(id, { status: 'done', detail: `${hits.length} passages` })
    if (!hits.length) return 'No matching passages in the notes.'
    return hits
      .map((h) => {
        const n = addSource(ctx, { path: h.path, title: h.title, heading: h.heading || undefined, text: h.text })
        return `[${n}] ${h.title}${h.heading ? ` > ${h.heading}` : ''} (path: ${h.path})\n${clip(h.text, 900)}`
      })
      .join('\n\n')
  }

  if (call.name === 'read_note') {
    const path = str('path')
    const id = ctx.step({ kind: 'read_note', label: `Reading ${path.split('/').pop()?.replace(/\.md$/, '')}`, status: 'running', depth })
    try {
      const chunks = getChunks(path)
      const text = chunks.length ? chunks.map((c) => (c.heading ? `## ${c.heading}\n` : '') + c.text).join('\n\n') : await readText(path)
      const n = addSource(ctx, { path, title: chunks[0]?.title ?? path.split('/').pop()!, text: clip(text, 1500) })
      ctx.updateStep(id, { status: 'done' })
      return `[${n}] ${path}\n${clip(text)}`
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not read that note: ${(e as Error).message}`
    }
  }

  if (call.name === 'remember') {
    const fact = str('fact')
    const id = ctx.step({ kind: 'remember', label: `Remembering: ${fact.slice(0, 90)}`, status: 'running', depth })
    try {
      const { duplicate } = await addMemory(fact, ctx.chatId)
      ctx.updateStep(id, { status: 'done', detail: duplicate ? 'already known' : 'saved' })
      return duplicate ? 'You already remember that.' : 'Saved. You will remember this in future conversations.'
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not save that: ${(e as Error).message}`
    }
  }

  if (call.name === 'forget') {
    const about = str('about')
    const id = ctx.step({ kind: 'remember', label: `Forgetting: ${about.slice(0, 90)}`, status: 'running', depth })
    const removed = await forgetMatching(about).catch(() => null)
    ctx.updateStep(id, { status: removed ? 'done' : 'error', detail: removed ? 'forgotten' : 'nothing matched' })
    return removed ? `Forgotten: "${removed.text}"` : 'Nothing you remember matches that.'
  }

  if (call.name === 'web_search' || call.name === 'search_papers') {
    const q = str('query')
    const papers = call.name === 'search_papers'
    const when = (['year', 'month', 'week', 'day'] as const).find((w) => w === args.when)
    const news = args.news === true || args.news === 'true'
    const label = papers ? `Searching papers for “${q}”` : `Searching ${news ? 'the news' : 'the web'} for “${q}”${when ? ` (past ${when})` : ''}`
    const id = ctx.step({ kind: 'web_search', label, status: 'running', depth })
    try {
      const results = papers ? await searchPapers(q) : await webSearch(q, { when, news })
      const real = results.filter((r) => r.url)
      ctx.updateStep(id, { status: 'done', detail: `${real.length} result${real.length === 1 ? '' : 's'}` })
      if (!results.length) return 'No results. Try different words.'
      return results
        .map((r) => {
          if (!r.url) return r.snippet
          const n = addSource(ctx, { path: r.url, url: r.url, title: r.title, text: r.snippet })
          return `[${n}] ${r.title}${r.date ? ` (${r.date})` : ''}\n${r.url}\n${r.snippet}`
        })
        .join('\n\n')
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Search failed: ${(e as Error).message}`
    }
  }

  if (call.name === 'find_image') {
    const q = str('query')
    const id = ctx.step({ kind: 'web_search', label: `Finding a picture of “${q}”`, status: 'running', depth })
    try {
      const found = await findImages(q)
      ctx.updateStep(id, { status: 'done', detail: `${found.length} picture${found.length === 1 ? '' : 's'}` })
      if (!found.length) return 'No good pictures for that. Try simpler words, or draw it with mermaid instead.'
      return found.map((f) => `${f.description || f.file}${f.license ? ` (${f.license}${f.credit ? `, ${f.credit}` : ''})` : ''}\n![${(f.description || f.file.replace(/\.\w+$/, '')).replace(/[[\]]/g, '').slice(0, 90)}](${f.url})`).join('\n\n')
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not search for pictures: ${(e as Error).message}`
    }
  }

  if (call.name === 'read_webpage') {
    const url = str('url')
    let host = url
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      // keep the raw text
    }
    const id = ctx.step({ kind: 'read_webpage', label: `Reading ${host}`, status: 'running', depth })
    try {
      const page = await readWebpage(url, !ctx.private)
      const n = addSource(ctx, { path: url, url, title: page.title, text: clip(page.text, 1500) })
      ctx.updateStep(id, { status: 'done', detail: page.title })
      return `[${n}] ${page.title}\n${url}\n${clip(page.text)}`
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not read that page: ${(e as Error).message}`
    }
  }

  if (call.name === 'related_notes') {
    const want = str('note').trim()
    const id = ctx.step({ kind: 'search_notes', label: `Following links from ${want.split('/').pop()?.replace(/\.md$/, '')}`, status: 'running', depth })
    const graph = await graphCached()
    const lower = want.toLowerCase().replace(/\.md$/, '')
    const node =
      graph.nodes.find((n) => n.path === want) ??
      graph.nodes.find((n) => n.title.toLowerCase() === lower || n.path.toLowerCase().replace(/\.md$/, '').endsWith('/' + lower)) ??
      graph.nodes.find((n) => n.title.toLowerCase().includes(lower))
    const r = node ? await relatedNotes(node.path) : null
    if (!r) {
      ctx.updateStep(id, { status: 'error', detail: 'no such note' })
      return 'No note by that name. Use search_notes to find its path.'
    }
    const line = (xs: { path: string; title: string; level: string }[]) => (xs.length ? xs.map((x) => `${x.title} [${x.level}] (${x.path})`).join('; ') : 'none')
    ctx.updateStep(id, { status: 'done', detail: `${r.linksTo.length + r.linkedFrom.length} linked notes` })
    return [
      `${r.note.title} [${r.note.level}] (${r.note.path})`,
      `Links to: ${line(r.linksTo)}`,
      `Linked from: ${line(r.linkedFrom)}`,
      `Two links away: ${line(r.twoSteps)}`,
      `Shares tags with: ${line(r.sameTags)}`,
      'Levels: new = never tested, weak/shaky = needs work, solid/mastered = known.'
    ].join('\n')
  }

  if (call.name === 'canvas_read' || call.name === 'canvas_edit') {
    if (!ctx.canvasPath) return 'No canvas is open.'
    const current = parseCanvas(await readText(ctx.canvasPath).catch(() => ''))
    if (call.name === 'canvas_read') {
      const id = ctx.step({ kind: 'canvas', label: 'Looking at your design', status: 'running', depth })
      ctx.updateStep(id, { status: 'done', detail: `${current.nodes.length} components` })
      return describeCanvas(current)
    }
    // The model may send the list under another name, or a single operation on its own
    let ops = (args.ops ?? args.operations ?? args.actions ?? (args.op || args.action ? [args] : undefined)) as unknown
    if (typeof ops === 'string') {
      try {
        ops = JSON.parse(ops)
      } catch {
        return 'ops must be a JSON array of operations.'
      }
    }
    if (!Array.isArray(ops) || !ops.length) return 'Give ops as an array, e.g. [{"op":"add","label":"Cache","kind":"cache"}].'
    const id = ctx.step({ kind: 'canvas', label: 'Drawing on your canvas', status: 'running', depth })
    const { canvas, log } = applyCanvasOps(current, ops.slice(0, 40))
    if (canvas === current) {
      ctx.updateStep(id, { status: 'error', detail: 'nothing changed' })
      return `Nothing was drawn:\n${log.join('\n') || '- no operations'}\nUse ops like [{"op":"add","label":"API server","kind":"service"},{"op":"connect","from":"Client","to":"API server","label":"HTTPS"}].`
    }
    try {
      await writeText(ctx.canvasPath, serializeCanvas(canvas))
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not save the canvas: ${(e as Error).message}`
    }
    ctx.updateStep(id, { status: 'done', detail: log.slice(0, 3).join(', ') + (log.length > 3 ? '…' : '') })
    return `${log.join('\n')}\n\nThe canvas now:\n${describeCanvas(canvas)}`
  }

  if (call.name === 'study_plan') {
    const id = ctx.step({ kind: 'read_note', label: 'Looking at your plan', status: 'running', depth })
    const [settings, week] = await Promise.all([getCoach(), getWeek()])
    ctx.updateStep(id, { status: 'done', detail: week ? 'this week' : 'no plan yet' })
    if (!settings.focus.length) return 'No focus set yet. Suggest they set their goal and focus on the Coach page (Home → Your week).'
    const today = new Date().toISOString().slice(0, 10)
    const fmt = (items: ReturnType<typeof todayItems>) => items.map((i) => `- ${i.kind}: ${i.topic ?? i.title} (${i.minutes} min)${i.why ? ` — ${i.why}` : ''}`).join('\n') || '- nothing planned'
    return [
      `Goal: ${settings.goal || 'not set'}. Focus: ${settings.focus.join(', ')}, ${settings.hoursPerWeek} h/week.`,
      week ? `This week's priorities: ${week.summary}` : 'No plan for this week yet: offer to plan it (Coach page, "Plan my week").',
      week ? `Today (${today}):\n${fmt(todayItems(week, today))}` : '',
      week ? `Rest of the week:\n${week.days.filter((d) => d.date > today).map((d) => `${d.date}: ${d.items.map((i) => i.topic ?? i.title).join('; ')}`).join('\n')}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  if (call.name === 'things_assign') {
    const title = str('title')
    const brief = str('brief')
    if (!title || !brief) return 'An assignment needs a title and a brief.'
    const kind = (['task', 'assignment', 'test', 'take-home'] as const).find((k) => k === args.kind) ?? 'task'
    const id = ctx.step({ kind: 'remember', label: `Setting in Things: ${title.slice(0, 80)}`, status: 'running', depth })
    try {
      const steps = Array.isArray(args.steps) ? (args.steps as unknown[]).map(String).filter(Boolean) : typeof args.steps === 'string' ? String(args.steps).split('\n').filter(Boolean) : undefined
      // Tests and take-homes always open as a marked paper in Tide, even if the model gave no link
      const open = (args.open ?? null) as Record<string, unknown> | null
      const link = taskLink(open && typeof open === 'object' && open.type ? open : kind === 'test' || kind === 'take-home' ? { type: 'exam', topic: title } : open, kind, title)
      const label = { task: '', assignment: 'Assignment: ', test: 'Test: ', 'take-home': 'Take-home: ' }[kind]
      const checked = /##\s*How it will be checked/i.test(brief) || kind === 'task' ? '' : "\n\n## How it will be checked\nWrite your answer in this task's notes and ask the tutor in Tide to mark it (it writes its feedback here), or sit it in Tide with the link below."
      const notes = `${brief.trim()}${checked}${link ? `\n\n---\n[${link.label}](${link.url})` : ''}`
      const t = await addTask({ title: `${label}${title}`, notes, when: str('start') || undefined, deadline: str('due') || undefined, checklist: steps, tags: [kind === 'take-home' ? 'take-home' : kind] })
      ctx.updateStep(id, { status: 'done', detail: t.deadline ? `due ${t.deadline}` : 'set' })
      return `Set in Things 4: "${t.title}"${t.deadline ? `, due ${t.deadline}` : ''}${link ? `, opening ${link.label.toLowerCase()}` : ''}. Its id is ${t.id}.`
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not set it: ${(e as Error).message}`
    }
  }

  if (call.name === 'things_feedback') {
    const id = ctx.step({ kind: 'remember', label: 'Writing feedback in Things', status: 'running', depth })
    try {
      const task = await findTask(str('task'))
      if (!task) {
        ctx.updateStep(id, { status: 'error', detail: 'no such task' })
        return 'No Tide task matches that. Use things_tasks to find it.'
      }
      const done = args.complete === true || args.complete === 'true'
      await feedbackOnTask(task.id, str('feedback'), done)
      ctx.updateStep(id, { status: 'done', detail: task.title.slice(0, 60) })
      return `Feedback added to "${task.title}"${done ? ', and marked done' : ''}.`
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not write it: ${(e as Error).message}`
    }
  }

  if (call.name === 'metabase') {
    const action = str('action')
    const label = action === 'sql' || action === 'run_question' ? 'Running a query in Metabase' : action === 'search' ? `Searching Metabase for “${clip(str('q'), 40)}”` : `Reading Metabase: ${action} ${str('id')}`.trim()
    const id = ctx.step({ kind: 'metabase', label, status: 'running', depth })
    try {
      const out = await metabaseTool(args)
      ctx.updateStep(id, { status: 'done' })
      return clip(out, TOOL_TEXT_LIMIT)
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Metabase: ${(e as Error).message}`
    }
  }

  if (call.name === 'things_tasks') {
    const id = ctx.step({ kind: 'search_notes', label: 'Checking your Things tasks', status: 'running', depth })
    try {
      const status = (['open', 'completed', 'all'] as const).find((x) => x === args.status) ?? (str('completed_since') ? 'completed' : 'open')
      const items = await searchTasks({ tag: TIDE_TAG, status, completedSince: str('completed_since') || undefined, text: str('search') || undefined })
      ctx.updateStep(id, { status: 'done', detail: `${items.length} tasks` })
      // A handful of tasks come with their notes: that's where the student writes their answers
      const withNotes = args.with_notes === true || args.with_notes === 'true' || items.length <= 3
      return withNotes ? items.map((t) => `${describeTasks([t])} [id ${t.id}]\n${clip(t.notes ?? '', 1500)}`).join('\n\n') : describeTasks(items)
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not read Things: ${(e as Error).message}`
    }
  }

  if (call.name === 'terminal_read') {
    if (!ctx.terminalId) return 'No terminal is open.'
    const lines = Math.min(200, Math.max(5, Number(args.lines) || 60))
    const id = ctx.step({ kind: 'terminal', label: 'Looking at your terminal', status: 'running', depth })
    const text = readTerminal(ctx.terminalId, 12_000).split('\n').slice(-lines).join('\n')
    ctx.updateStep(id, { status: 'done' })
    return text.trim() ? `Terminal (most recent at the bottom):\n${text}` : 'The terminal is empty so far.'
  }

  if (call.name === 'terminal_run') {
    if (!ctx.terminalId) return 'No terminal is open.'
    const command = String(args.command ?? '')
    const id = ctx.step({ kind: 'terminal', label: `Running in the lab: ${command.split('\n')[0].slice(0, 80)}`, status: 'running', depth })
    try {
      const r = await runInTerminal(ctx.terminalId, command)
      ctx.updateStep(id, { status: 'done', detail: r.timedOut ? 'stopped after 20 s' : undefined })
      return `${r.timedOut ? '(still running after 20 s, so it was interrupted with Ctrl-C)\n' : ''}${clip(r.output, 5000) || '(no output)'}`
    } catch (e) {
      ctx.updateStep(id, { status: 'error', detail: (e as Error).message })
      return `Could not run it: ${(e as Error).message}`
    }
  }

  if (call.name === 'run_code') {
    const language = str('language') || 'python'
    const code = String(args.code ?? '')
    const firstLine = code.split('\n').find((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('import') && !l.trim().startsWith('from'))?.trim() ?? ''
    const id = ctx.step({ kind: 'run_code', label: `Running ${language}${firstLine ? `: ${firstLine.slice(0, 60)}` : ''}`, status: 'running', depth })
    const r = await runCode(language, code, String(args.stdin ?? ''))
    ctx.updateStep(id, { status: r.exitCode === 0 && !r.timedOut ? 'done' : 'error', detail: r.timedOut ? 'timed out' : r.exitCode === 0 ? `${r.durationMs} ms` : `exit ${r.exitCode}` })
    return `exit code: ${r.exitCode}${r.timedOut ? ' (timed out after 10 s)' : ''}\nstdout:\n${clip(r.stdout, 4000) || '(empty)'}\nstderr:\n${clip(r.stderr, 2000) || '(empty)'}`
  }

  if (call.name === 'delegate' && depth === 0) {
    const tasks = (Array.isArray(args.tasks) ? args.tasks : []).map(String).filter(Boolean).slice(0, MAX_HELPERS)
    if (!tasks.length) return 'No tasks were given.'
    const id = ctx.step({ kind: 'delegate', label: `Asking ${tasks.length} helper${tasks.length === 1 ? '' : 's'} to research in parallel`, status: 'running', depth })
    const reports = await Promise.all(
      tasks.map(async (task, i) => {
        const helperId = ctx.step({ kind: 'helper', label: task, status: 'running', depth: 1 })
        try {
          const report = await loop(
            [
              { role: 'system', content: `${HELPER_SYSTEM}\nToday is ${new Date().toISOString().slice(0, 10)}.` },
              { role: 'user', content: task }
            ],
            ctx,
            1,
            () => {}
          )
          ctx.updateStep(helperId, { status: 'done' })
          return `Helper ${i + 1} (${task}):\n${report.trim()}`
        } catch (e) {
          ctx.updateStep(helperId, { status: 'error', detail: (e as Error).message })
          return `Helper ${i + 1} (${task}) failed: ${(e as Error).message}`
        }
      })
    )
    ctx.updateStep(id, { status: 'done' })
    return reports.join('\n\n')
  }

  return `Unknown tool ${call.name}.`
}

/**
 * The tools a turn offers, in a fixed order. The warm-ups build theirs here too: the tools are part
 * of the prompt's start, so if a warm-up's list differs by one tool, nothing it cached is ever reused.
 */
function toolSet(o: { top: boolean; web: boolean; focused: boolean; things: boolean; metabase?: boolean; helpers?: boolean; terminal?: unknown[]; canvas?: unknown[]; lean?: boolean }): unknown[] {
  if (o.lean) return [CODE_TOOL]
  const images = (o.web || o.focused) && getSettings().ai.webSearch?.provider !== 'off'
  return [
    ...NOTE_TOOLS,
    CODE_TOOL,
    ...(images ? [IMAGE_TOOL] : []),
    ...(o.top ? [STUDY_PLAN] : []),
    ...(o.terminal ?? []),
    ...(o.canvas ?? []),
    ...(o.things ? [THINGS_ADD, THINGS_TASKS, THINGS_FEEDBACK] : []),
    ...(o.metabase ? [METABASE] : []),
    ...(o.web ? WEB_TOOLS : []),
    // Helpers only help in parallel on a cloud model; on this Mac they'd run one after another
    ...(o.top ? [...MEMORY_TOOLS, ...(o.helpers ? [DELEGATE_TOOL] : [])] : [])
  ]
}

/** The tools a turn offers. A warm-up must send exactly these: they open the prompt, so one tool
 *  more or fewer and nothing after them is found in the server's cache. */
async function turnTools(ctx: LoopContext, depth: number): Promise<unknown[]> {
  const term = ctx.terminalId ? terminalInfo(ctx.terminalId) : null
  const terminalTools = term && !term.exited ? (term.kind === 'lab' ? [TERMINAL_READ, TERMINAL_RUN] : [TERMINAL_READ]) : []
  const canvasTools = ctx.canvasPath ? [CANVAS_READ, CANVAS_EDIT] : []
  const top = depth === 0 && !ctx.focused
  // Checking maths or finding a mistake in the cloud needs only the code tool (SymPy), which keeps the request small
  const lean = !!ctx.cloud && !ctx.cloud.fellBack && (ctx.cloud.task === 'maths' || ctx.cloud.task === 'errors' || ctx.cloud.task === 'marking')
  return toolSet({ top, web: ctx.web, focused: !!ctx.focused, things: top && (await thingsAvailable()), metabase: top && !ctx.cloud && metabaseReady(), helpers: !!ctx.cloud && !ctx.cloud.fellBack, terminal: terminalTools, canvas: canvasTools, lean })
}

async function loop(messages: ApiMessage[], ctx: LoopContext, depth: number, onText: (t: string) => void): Promise<string> {
  const tools = await turnTools(ctx, depth)
  const maxSteps = depth === 0 ? MAX_STEPS : HELPER_STEPS
  const seen = new Set<string>()
  let nudged = false
  for (let step = 0; step < maxSteps; step++) {
    // Last round: answer with what it found. The tools stay in the request (dropping them changes the
    // start of the prompt, and the server would read it all again); any call it still makes is ignored
    const final = step === maxSteps - 1
    if (final) messages.push({ role: 'user', content: 'Now answer using what you found. Do not call any more tools.' })
    const turn = await streamTurn(messages, tools, ctx.signal, onText, ctx)
    const text = turn.text
    const calls = final ? [] : turn.calls
    if (final && turn.calls.length && !text.trim()) return answerWithoutTools(messages, ctx, onText, depth)
    if (!calls.length) {
      if (text) return text
      // An empty reply: the model often meant to call another tool. Nudge it once with tools still
      // there, then once without, and never leave the student with a blank answer
      if (!final && !nudged) {
        nudged = true
        messages.push({ role: 'user', content: 'Continue: call the next tool you need, or answer now using the results above.' })
        continue
      }
      if (!final) messages.push({ role: 'user', content: 'Answer the question now using the results above. Do not call any more tools.' })
      let last = text
      if (!final) {
        const again = await streamTurn(messages, tools, ctx.signal, onText, ctx)
        last = again.text.trim() || !again.calls.length ? again.text : await answerWithoutTools(messages, ctx, onText, depth)
      }
      if (!last.trim() && depth === 0) {
        const sorry = "I lost my train of thought there. Ask me again, or say what you'd like me to do next."
        onText(sorry)
        return sorry
      }
      return last
    }
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
    })
    for (const call of calls) {
      const key = `${call.name}:${call.arguments.replace(/\s+/g, '')}`
      const content = seen.has(key)
        ? 'You already ran exactly this call; its results are above. Use them, try a different query, or answer.'
        : (await runTool(call, ctx, depth)) + '\n\n(When you use any of these, cite their numbers like [3].)'
      seen.add(key)
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content })
    }
  }
  return ''
}

/**
 * A pointer to the right tool when a message plainly needs one. A 12B model often answers from
 * memory instead; one line saying which tool fits makes it reach for it (measured: remember,
 * forget, a link, recent facts and the study plan were each skipped without it).
 */
export function toolHint(question: string, web: boolean): string {
  const q = question.trim()
  if (/https?:\/\/\S+/i.test(q)) return 'The student gave a link: read it with read_webpage first.'
  if (/\bforget\b/i.test(q) && !/\bdon'?t forget\b/i.test(q)) return 'They are asking you to forget something: use forget.'
  if (/\b(remember (that|this|my|i)|keep in mind|note that i|from now on)\b/i.test(q) && !/\bdo you remember\b/i.test(q)) return 'They are telling you something to keep: save it with remember, then reply.'
  if (/\b(connect|connects|relate|relates|link|links)\b.{0,40}\b(note|notes|studied)\b|\bnote\b.{0,40}\b(connect|relate|link)/i.test(q)) return 'Use related_notes on that note to see how it links to the rest.'
  if (/\bwhat (should|do) i (study|learn|do|work on)\b|\bwhat'?s next\b|\b(my|the) (plan|week|agenda)\b|\bon track\b/i.test(q)) return 'Check their plan with study_plan before answering.'
  if (web && asksForWeb(q)) return 'This needs up-to-date information: search the web (web_search) before answering, rather than relying on memory.'
  if (/\b(show me|picture|image|photo|diagram of|what does .{2,40} look like|draw)\b/i.test(q)) return 'They want to see it: draw a mermaid diagram, or use find_image for a real picture or figure.'
  if (/\b(compare|research|in depth|deep dive)\b/i.test(q) && /\b(notes?|web|sources?)\b/i.test(q)) return 'Research it: use delegate to look in their notes and on the web in parallel.'
  return ''
}

/**
 * One turn, carried past stalls: when Gemma stops mid-answer to open a thought channel (typically
 * right after a closing tag like </say> or </grade>), what it wrote so far is kept and it's asked to
 * carry on from there. The conversation so far is a cached prefix, so each pick-up is quick.
 */
async function streamTurnContinuing(messages: ApiMessage[], tools: unknown[], signal: AbortSignal, onText: (t: string) => void) {
  let written = ''
  for (let i = 0; i < 4; i++) {
    const turn: ApiMessage[] = written
      ? [...messages, { role: 'assistant', content: written }, { role: 'user', content: '(Carry on with your reply exactly where it stopped. Do not repeat anything already written, and no <say> this time.)' }]
      : messages
    try {
      const out = await streamTurnOnce(turn, tools, signal, onText, i ? 0.15 : 0)
      return { text: written ? `${written}\n\n${out.text}` : out.text, calls: out.calls }
    } catch (e) {
      if (!(e instanceof StallError)) {
        if (e instanceof LoopingError && written) e.partial = `${written}\n\n${e.partial}`
        throw e
      }
      const more = e.partial.trim()
      if (!more && i >= 2) return { text: written, calls: [] }
      written = written ? `${written}\n\n${more}` : more
      onText('\n\n')
    }
  }
  return { text: written, calls: [] }
}

// Words that say how to study, not what: they match every note, so they can't pick passages
const STUDY_WORDS = new Set('want learn deeply start finding already know quiz questions question teach explain about what with from that this have help understand mock interview review writing test thinking memory session practice mixed interleaving across switch topic every never same tell show give make some more into does when where which their there them they your mine please could would should really just like then than also been being able out the and for you how why can are was not any all its one two get use way new now too did has had our who may let see off'.split(' '))

/** Whether a passage is really about the question: it must contain most of the question's key words */
export function onTopic(question: string, passage: string): boolean {
  const words = [...new Set(question.toLowerCase().match(/[a-z][a-z0-9+#-]{2,}/g) ?? [])].filter((w) => !STUDY_WORDS.has(w))
  if (!words.length) return false
  const text = passage.toLowerCase()
  const found = words.filter((w) => new RegExp(`\\b${w.replace(/[+#-]/g, '\\$&')}`).test(text)).length
  return found >= Math.max(1, Math.ceil(words.length * 0.5))
}

/** The last resort: the same request with no tools at all, so it can only answer */
async function answerWithoutTools(messages: ApiMessage[], ctx: LoopContext, onText: (t: string) => void, depth: number): Promise<string> {
  const { text } = await streamTurn(messages, [], ctx.signal, onText, ctx)
  if (text.trim() || depth > 0) return text
  const sorry = "I lost my train of thought there. Ask me again, or say what you'd like me to do next."
  onText(sorry)
  return sorry
}

/**
 * One-shot harness call for background work (writing exam papers, marking answers): the model may use
 * run_code to check maths, nothing is streamed to the UI, and the final text is returned.
 */
export async function agentComplete(messages: ApiMessage[], system: string, allowCode: boolean, task?: CloudTask): Promise<string> {
  const controller = new AbortController()
  const ctx: LoopContext = {
    signal: controller.signal,
    sources: [],
    web: false,
    emitSources: () => {},
    step: () => `s${++stepCounter}`,
    updateStep: () => {}
  }
  const target = task ? routeFor(task, 'auto', false) : null
  if (target && task) ctx.cloud = { target, task, stepId: '' }
  const all: ApiMessage[] = [{ role: 'system', content: system }, ...messages]
  if (!allowCode) return (await streamTurn(all, [], controller.signal, () => {}, ctx)).text
  // Only the code tool: marking needs maths checks, not note or web lookups
  for (let step = 0; step < 4; step++) {
    const final = step === 3
    const { text, calls } = await streamTurn(all, final ? [] : [CODE_TOOL], controller.signal, () => {}, ctx)
    if (!calls.length) return text
    all.push({ role: 'assistant', content: text || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) })
    for (const call of calls) all.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: await runTool(call, ctx, 1) })
    if (step === 2) all.push({ role: 'user', content: 'Now give the final JSON only.' })
  }
  return ''
}

let stepCounter = 0

/** Runs the tutor with tools. Falls back to plain retrieval chat when the server has no tool support. */
/**
 * Sends the opening of an ordinary chat (system prompt and tools) once, in the background, so a
 * server with prefix caching already holds it when you ask your first question.
 */
/** Sends the system prompt and lesson tools once, so a lesson's first reply finds them cached */
let prewarming: AbortController | null = null

/**
 * Reads a lesson's opening into the server's cache before the lesson starts: Learn calls this as
 * you settle on a topic. The messages and tools are built by the same code as the real turn, so
 * when you press start the model only has to write, not read (about 10 seconds saved).
 */
// What was warmed lately: the same opening again within a few minutes is already in the cache
const warmed = new Map<string, number>()
const WARM_FOR_MS = 5 * 60_000

export async function prewarmLesson(req: Omit<ChatRequest, 'id'>): Promise<void> {
  if (!isMlxVlm()) return
  const key = JSON.stringify([req.messages, req.instructions, req.scope, req.voice, req.web])
  const at = warmed.get(key)
  if (at && Date.now() - at < WARM_FOR_MS) return
  warmed.set(key, Date.now())
  if (warmed.size > 40) warmed.delete(warmed.keys().next().value!)
  prewarming?.abort()
  const controller = new AbortController()
  prewarming = controller
  await agentChat({ ...req, id: 'prewarm', warmOnly: true }, () => {}, controller.signal).catch(() => {})
}

/** Sends a turn's prompt with a one-token reply, in the background lane, so the server caches it */
async function warmTurn(messages: ApiMessage[], tools: unknown[], signal: AbortSignal): Promise<void> {
  const { baseUrl, apiKey } = getSettings().ai
  const model = await resolveModel()
  await inBackground(async (s) => {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages, tools, max_tokens: 1, stream: false, ...localSampling(model), ...transientContext() }),
      signal: s
    })
    const body = await res.text()
    // Dev only: what was read ahead, to compare with the turn that follows
    if (process.env.TIDE_DEBUG_AI) (await import('fs')).writeFileSync(`${process.env.TIDE_DEBUG_AI}.warm`, JSON.stringify({ at: Date.now(), messages, tools, reply: body.slice(0, 600) }, null, 1))
  }, signal).catch(() => {})
}

// ---------- Read-back: the model keeps its place in the conversation you're in ----------
//
// The local server can only continue from a saved place that the next prompt starts with exactly,
// and it saves places while reading a prompt, never while writing. So after an answer the model has
// no saved place that includes it: your next message would wait while it read its own last answer
// again (and, if other work pushed the conversation out of its cache, the whole lesson: 20 to 40
// seconds). Instead, as soon as an answer is finished, the conversation as the next turn will send
// it is read in the background, while you read; and after any other job has used the model, it is
// touched again so it stays the most recently used thing there.

let live: { req: TurnRequest; reply: string; at: number } | null = null
let readingBack: AbortController | null = null
let touchQueued = false
/** A conversation left alone this long is no longer kept warm */
const LIVE_FOR_MS = 20 * 60_000

async function readLive(): Promise<void> {
  const now = live
  if (!now || !isMlxVlm() || Date.now() - now.at > LIVE_FOR_MS) return
  readingBack?.abort()
  const controller = new AbortController()
  readingBack = controller
  // Built by the same code as the real next turn, so it is word for word what that turn starts with
  await agentChatNow({ ...now.req, id: 'readback', warmOnly: true, attachment: undefined, messages: [...now.req.messages, { role: 'assistant', content: now.reply }] }, () => {}, controller.signal).catch(() => {})
  if (readingBack === controller) readingBack = null
}

/** An answer on this Mac just finished: have the model read it, ready for what you say next */
export function readBack(req: TurnRequest, reply: string): void {
  if (!reply.trim() || req.warmOnly) return
  live = { req, reply, at: Date.now() }
  void readLive()
}

/** You moved to another conversation, or this one is being answered now */
export function forgetLive(): void {
  live = null
  readingBack?.abort()
}

// Other work used the model: put the live conversation back on top of its cache
afterBackground(() => {
  if (!live || readingBack || touchQueued) return
  touchQueued = true
  setTimeout(() => {
    touchQueued = false
    void readLive()
  }, 50)
})

export async function warmLessons(): Promise<void> {
  const { baseUrl, apiKey } = getSettings().ai
  const model = await resolveModel()
  // Exactly the tools a lesson with web on offers (see toolSet)
  const tools = toolSet({ top: false, web: true, focused: true, things: false })
  await inBackground(async (signal) => {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      // Only the system prompt as conversation, "Hi" as request-only context: mlx-vlm then keeps a
      // snapshot right where the system prompt ends, which every lesson's prompt starts with
      body: JSON.stringify({ model, messages: [{ role: 'system', content: await stablePrompt(SYSTEM, {} as TurnRequest, true, true) }], transient_context: 'Hi', tools, max_tokens: 1, stream: false }),
      signal
    })
    await res.text()
  })
}

export async function warmChat(): Promise<void> {
  const { baseUrl, apiKey } = getSettings().ai
  // Exactly the tools an ordinary chat offers (see toolSet), so the cached prefix matches
  const tools = toolSet({ top: true, web: true, focused: false, things: await thingsAvailable(), metabase: metabaseReady() })
  const model = await resolveModel()
  await inBackground(async (signal) => {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: await stablePrompt(SYSTEM, {} as TurnRequest, true) }],
        transient_context: 'Hi',
        tools,
        max_tokens: 1,
        stream: false
      }),
      signal
    })
    await res.text()
  })
}

const VISUAL = /\b(picture|image|screenshot|diagram|figure|chart|graph|plot|photo|page|shown?|see|look|draw(n|ing)?|label(led)?|this one)\b/i

/**
 * The pictures this turn should look at: any the student put in their message, and a note's own
 * when it's the subject (at the start of a chat or lesson on it, or when they ask about something
 * visual). Each later turn without a reason to look skips them, so it stays quick.
 */
async function turnImages(req: TurnRequest, question: string): Promise<NoteImage[]> {
  const notePath = req.scope.kind === 'note' && /\.md$/i.test(req.scope.path) ? req.scope.path : ''
  const fromMessage = await loadImages(question, notePath || 'chat.md')
  if (fromMessage.length || !notePath) return fromMessage
  const firstTurn = req.messages.filter((m) => m.role === 'user').length <= 1
  if (!firstTurn && !VISUAL.test(question)) return []
  return loadImages(await readText(notePath).catch(() => ''), notePath)
}

export function agentChat(req: TurnRequest, emit: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  if (req.warmOnly) return agentChatNow(req, emit, signal)
  return timeTurn(req.id, req.instructions ? 'lesson' : 'chat', () => agentChatNow(req, emit, signal))
}

async function agentChatNow(req: TurnRequest, emit: (e: ChatEvent) => void, signal: AbortSignal) {
  const sources: ContextSource[] = []
  const ctx: LoopContext = {
    signal,
    sources,
    web: req.web !== false,
    chatId: req.chatId,
    terminalId: req.terminalId,
    canvasPath: req.canvasPath,
    focused: !!req.instructions,
    emitSources: () => emit({ id: req.id, type: 'sources', sources: [...sources] }),
    step: (s) => {
      const id = `s${++stepCounter}`
      emit({ id: req.id, type: 'step', step: { ...s, id } })
      return id
    },
    updateStep: (id, patch) => emit({ id: req.id, type: 'step', step: { id, ...patch } as AgentStep })
  }

  // Start with what the user is looking at, so simple questions about a note need no tool calls
  // The student's own words: Tide's notes to the tutor (hidden, with their = signs and tags) mustn't
  // make an answer look like worked maths, or steer the search
  const question = ownWords(String([...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''))
  // The cloud model takes this turn if you picked it, or if it's a job set to escalate (worked maths, finding a mistake)
  const job = escalationFor(question, req.askType)
  // Anything about your Metabase stays on this Mac: its data never goes to a cloud model
  const mine = metabaseReady() && req.messages.some((m) => aboutMetabase(m.content, metabaseHost()))
  const images = req.warmOnly ? [] : await turnImages(req, question)
  // Pictures need a model that can see them: Gemma
  // A private project's documents never leave this Mac
  const secret = req.scope.kind !== 'none' && req.scope.kind !== 'vault' && (await privatePath(req.scope.path).catch(() => false))
  ctx.private = mine || secret
  const target = req.warmOnly || mine || secret || images.length ? null : routeFor(req.engine === 'cloud' ? null : job, req.engine ?? 'auto', false)
  if (target) {
    const name = providerInfo(target.provider).models.find((m) => m.id === target.model)?.label ?? target.model
    const why = job === 'maths' ? 'checking the maths' : job === 'errors' ? 'finding the mistake' : 'answering'
    ctx.cloud = { target, task: job ?? (req.instructions ? 'tutor' : 'chat'), stepId: ctx.step({ kind: 'helper', label: `${name} is ${why}`, status: 'running', depth: 0 }) }
  }
  // All notes: only the few passages that really match (the tutor searches for more if it needs
  // them); a note, notebook or pages: what retrieval picks for that scope
  const initial =
    req.scope.kind === 'none'
      ? []
      : req.scope.kind === 'vault'
        ? search(question, 3)
            .filter((h) => onTopic(question, `${h.title} ${h.heading ?? ''} ${h.text}`))
            .map((h) => ({ path: h.path, title: h.title, heading: h.heading || undefined, text: h.text }))
        : await retrieve(req.scope, question)
  // A lesson starts from a few passages (it can search for more); a chat gets a wider look
  for (const s of initial.slice(0, req.instructions ? 4 : 8)) addSource(ctx, { path: s.path, title: s.title, heading: s.heading, text: s.text })
  // Notes this one links to often hold what it builds on: add the best-matching passage from a few
  if (req.scope.kind === 'note' && /\.md$/i.test(req.scope.path)) {
    const graph = await graphCached().catch(() => null)
    const linked = graph ? [...new Set(graph.edges.filter((e) => e.source === (req.scope as { path: string }).path).map((e) => e.target))].slice(0, 3) : []
    for (const p of linked) {
      const hit = search(question || p, 1, (x) => x === p)[0] ?? getChunks(p, 1)[0]
      if (hit) addSource(ctx, { path: hit.path, title: hit.title, heading: hit.heading ? `${hit.heading} (linked note)` : 'linked note', text: hit.text.slice(0, 1200) })
    }
  }
  const screen = req.terminalId ? readTerminal(req.terminalId, 5000).split('\n').slice(-45).join('\n').trim() : ''
  const design = req.canvasPath ? describeCanvas(parseCanvas(await readText(req.canvasPath).catch(() => ''))) : ''
  // Asked to be set work: say so plainly, small models otherwise just answer the question
  const userTurns = req.messages.filter((m) => m.role === 'user').length
  // Not inside a structured session (a lesson, quiz or interview runs its own script)
  const wanted = req.instructions ? null : thingsIntent(question)
  const thingsOn = !!wanted && (await thingsAvailable())
  const marking = thingsOn && wanted === 'mark'
  // A lesson opens knowing where its topic is in the books they own, so it can send them to the pages
  const own = req.session && req.instructions && userTurns <= 1 && req.scope.kind !== 'pages' ? await pagesToRead(question, 2).catch(() => []) : []
  const assigning = thingsOn && wanted === 'assign'
  const turnContext = [
    req.voice ? voiceRules(characterById(req.voice), recentOpenings(req.messages.filter((m) => m.role === 'assistant').map((m) => String(m.content)))) : '',
    req.instructions ? '' : toolHint(question, ctx.web),
    marking
      ? 'The student wants work they did in a Things 4 task marked. 1) Call things_tasks (with_notes) to read their answer. 2) Work out the correct answer yourself first: for maths, compute it with run_code. 3) Only then call things_feedback, written once as a final verdict with no thinking aloud ("wait", "let\'s check") and no self-corrections, in exactly this shape:\n**Verdict:** Correct / Partly correct / Incorrect, n/10\n**What you got right:** ...\n**What to fix:** ... (say "Nothing" if it is right; an equivalent method or ordering is not a mistake)\n**Answer:** the correct result with the key step\n**Next:** one follow-up problem or idea\nComplete the task if the work is essentially right. 4) Then tell the student the verdict in one or two lines.'
      : assigning
      ? 'The student is asking you to set them work in Things 4. Call things_assign now with a full brief (## Goal, ## What to do, ## Deliverable, ## How it will be checked, ## Read), steps and the due date they gave. Do NOT solve or hint at the answer to work you assign; afterwards just confirm in one or two lines what you set and when it is due.'
      : '',
    design ? `The student's system design canvas right now:\n${design}` : '',
    screen ? `The student's terminal right now (most recent at the bottom):\n\`\`\`\n${screen}\n\`\`\`` : '',
    // Setting or marking work from a general chat: notes picked by keyword are only noise there
    // A lesson or quiz reads its notes once, at the start: fresh passages every answer would make
    // each turn longer and slower, and the tutor can still search when it needs more
    sources.length && !((assigning || marking) && req.scope.kind === 'vault') && !(req.instructions && userTurns > 1) ? `Passages from what the student is studying right now:\n\n${sources.map((s) => `[${s.index}] ${s.title}${s.heading ? ` > ${s.heading}` : ''}\n${clip(s.text, req.instructions || req.scope.kind === 'vault' ? 1000 : 1600)}`).join('\n\n---\n\n')}` : '',
    req.attachment ? `The student selected this passage:\n"""\n${req.attachment}\n"""` : '',
    own.length ? `Where this is covered in books the student owns (they open in Tide; point them to the pages when it helps, as a markdown link like [${readingLabel(own[0])}](/${own[0].path.split('/').map(encodeURIComponent).join('/')}#page=${own[0].from})): ${own.map(readingLabel).join('; ')}` : '',
    images.length ? `You can see ${images.length === 1 ? 'the picture' : `these ${images.length} pictures`} from their notes, attached below in this order: ${images.map((im, i) => `${i + 1}) ${im.path}`).join(', ')}. Teach from what they show. To show one in your answer, put its line on its own exactly as written: ${images.map((im) => imageMarkdown(im.path)).join(' ')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  // Stored conversations arrive already fitted; sessions and threads keep their opening setup
  const history = req.chatId ? req.messages : fitHistory(req.messages, historyBudget(), !!req.instructions)
  const messages: ApiMessage[] = [
    { role: 'system', content: await stablePrompt(SYSTEM, req, ctx.web, !!req.session) },
    ...withStableContext(
      // A lesson's instructions ride in its first message, not the system prompt: then the system
      // prompt and tools are the same for every lesson and stay cached between them
      withInstructions(
        withSummary(
          history.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
          req.summary
        ),
        req.instructions
      ),
      turnContext
    )
  ]

  if (req.warmOnly) return warmTurn(messages, await turnTools(ctx, 0), signal)
  // The pictures ride on this turn's message only: the start of the prompt stays the same, and cached
  const last = messages[messages.length - 1]
  if (images.length && last.role === 'user') last.content = [{ type: 'text', text: String(last.content) }, ...images.map((im) => ({ type: 'image_url' as const, image_url: { url: im.dataUrl } }))]
  await loop(messages, ctx, 0, (text) => (text === RESET ? emit({ id: req.id, type: 'reset' }) : emit({ id: req.id, type: 'delta', text })))
  if (ctx.cloud && !ctx.cloud.fellBack) ctx.updateStep(ctx.cloud.stepId, { status: 'done' })
}

/** The "Open in Tide" link for a task the tutor sets, from the tool's open argument */
function taskLink(open: Record<string, unknown> | null, kind: string, title: string): { label: string; url: string } | null {
  if (!open || typeof open !== 'object') return null
  const s = (k: string) => (typeof open[k] === 'string' ? (open[k] as string).trim() : '')
  const type = s('type')
  const topic = s('topic') || title
  const scope = s('scope') || undefined
  const difficulty = (['gentle', 'normal', 'hard', 'olympiad'] as const).find((d) => d === open.difficulty)
  let link: DeepLink | null = null
  if (type === 'exam') link = { to: 'exam', topic, scope, difficulty, style: kind === 'take-home' ? 'problems' : 'university', questions: kind === 'take-home' ? 1 : 5, minutes: Number(open.minutes) || (kind === 'take-home' ? 60 : 45) }
  else if (type === 'quiz' || type === 'teach') link = { to: 'session', mode: type, topic, scope }
  else if (type === 'note' && s('path')) link = { to: 'open', path: s('path') }
  else if (type === 'drill') link = { to: 'drill', kind: 'zetamac' }
  else if (type === 'practice') link = { to: 'practice', tab: s('topic').toLowerCase() || undefined }
  if (!link) return null
  const label = { exam: 'Sit it in Tide', quiz: 'Quiz me in Tide', teach: 'Learn it in Tide', note: 'Read it in Tide', drill: 'Run the drill in Tide', practice: 'Open Practice in Tide' }[type] ?? 'Open in Tide'
  return { label, url: buildLink(link) }
}
