import type { InterviewRecord } from './interviews'
import type { JournalEntry, WeekReview } from './coach'
export type ThemeId = 'system' | 'light' | 'dark' | 'graphite' | 'midnight' | 'ember' | 'sepia'

export interface AISettings {
  /** Base URL of an OpenAI compatible API, e.g. http://localhost:8080/v1 */
  baseUrl: string
  apiKey: string
  model: string
  /** Optional separate model for embeddings, empty disables semantic search */
  embeddingModel: string
  temperature: number
  /** Let the tutor use tools: note search, web search and helper agents */
  agent?: boolean
  /** Context window the model runs with, in tokens; conversations are compacted to fit it */
  contextTokens?: number
  /** Start the local model server when it isn't running (default on), with this command */
  /** Minutes without use before the local model is unloaded to give its memory back (default 15; 0 keeps it loaded) */
  unloadAfterMinutes?: number
  autoStart?: boolean
  serverCommand?: string
  webSearch?: {
    /** 'auto': the fastest available for each search (You.com when keyed, else the engine on this Mac, else Wikipedia) */
    provider: 'auto' | 'wikipedia' | 'brave' | 'tavily' | 'you' | 'searxng' | 'off'
    apiKey?: string
    url?: string
  }
}

export interface Settings {
  vaultPath: string | null
  /** Folder inside the vault where saved links, PDFs, videos and docs go */
  libraryFolder: string
  theme: ThemeId
  /** Which of Tide's two designs to draw (shared/design.ts): 'tide', the default, or the earlier 'classic' */
  design?: import('./design').DesignId
  /** Overrides the theme's accent colour, e.g. '#4f7cff'; null keeps the theme's own */
  accent?: string | null
  sidebarCollapsed: boolean
  chatOpen: boolean
  readingWidth: 'narrow' | 'normal' | 'wide'
  /** Font for notes, answers and titles; the interface always uses Inter */
  readingFont?: 'sans' | 'serif'
  /** The reading face in the new design, where the serif is the default; the Aa button switches it */
  tideReadingFont?: 'serif' | 'sans'
  /** The writing coach in the note editor: probes, corrects and suggests rewrites as you write */
  writingCoach?: boolean
  /** Study timers: the sidebar's Focus timer and the timer buttons on notes, books and practice */
  studyTimers?: boolean
  /** Sidebar items the user chose to hide (ids from shared/sidebar.ts) */
  sidebarHidden?: string[]
  fontSize: number
  ai: AISettings
  /** How the tutor sounds: Tide's natural voice (Kokoro, set up in Settings) or the Mac's own */
  /** custom: a Kokoro voice that replaces the character's; dictation: who writes out what you say */
  voice?: { engine: 'natural' | 'system'; name: string; speed: number; custom?: string; dictation?: 'tide' | 'handy' | 'deepgram' | 'flow' }
  /** Who the tutor is: the character's face, voice and way of talking */
  character?: import('./characters').CharacterId
  /** Why mode in lessons: Socratic, from first principles. Foundations (the default) turns it on for early, basic topics */
  whyMode?: 'off' | 'foundations' | 'always'
  /** Breaks while you study: paced by the tutor, a fixed rhythm, or none */
  pomodoro?: 'auto' | 'off' | '25' | '50'
  /** The character in the menu bar: always, only while studying, or never */
  menuBar?: 'always' | 'studying' | 'off'
  /** A stronger cloud model for the hard parts; Gemma on this Mac stays the default */
  cloud?: import('./providers').CloudSettings
  /** Your Metabase, read-only, for learning it; its API key is kept in the Keychain */
  metabase?: { url: string }
  /** Tide's study data API for dashboards and other apps (main/studyApi.ts); off by default */
  studyApi?: { enabled: boolean; port?: number; lan?: boolean }
}

export type FileKind = 'note' | 'pdf' | 'epub' | 'image' | 'doc' | 'canvas' | 'other'

export interface FileNode {
  name: string
  /** Path relative to the vault root, using forward slashes */
  path: string
  type: 'file' | 'folder'
  kind?: FileKind
  mtime?: number
  children?: FileNode[]
}

/** Reading status of a library item */
export type ReadStatus = 'read' | 'reading' | 'unread'

export type LearningStatus = 'untested' | 'learning' | 'reviewing' | 'mastered'

export interface NoteMeta {
  path: string
  title: string
  /** From the `learning_status` frontmatter field */
  status?: LearningStatus
  /** Source type for items saved to the library */
  sourceType?: 'article' | 'youtube' | 'pdf' | 'doc' | 'link'
  sourceUrl?: string
  /** Cover image for library items: og:image for articles, the thumbnail for videos */
  image?: string
  /** Site name for articles, channel for videos */
  site?: string
  /** Video length, e.g. "12:04" */
  duration?: string
  /** When it was saved, from the `saved` frontmatter field (YYYY-MM-DD) */
  saved?: string
  tags: string[]
  mtime: number
  excerpt: string
}

export interface SearchHit {
  path: string
  title: string
  heading?: string
  snippet: string
  score: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatScope =
  | { kind: 'note'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'vault' }
  | { kind: 'none' }
  /** A page range of one PDF, e.g. a chapter (1-based, inclusive) */
  | { kind: 'pages'; path: string; from: number; to: number; label?: string }

export interface ContextSource {
  /** 1-based index used in citations like [1] */
  index: number
  /** Vault path, or the URL for web sources */
  path: string
  url?: string
  title: string
  heading?: string
  text: string
}

export interface ChatRequest {
  id: string
  messages: ChatMessage[]
  scope: ChatScope
  /** Extra text the user attached, e.g. a selection */
  attachment?: string
  /** Extra tutoring instructions, e.g. the note's tutor mode */
  instructions?: string
  /** Allow web tools for this request (agent mode only) */
  web?: boolean
  /** Save this exchange to a stored conversation (created on first use) and build history from it */
  chatId?: string
  /** Which data lab (a small SQLite with sample data) run_sql uses: a lesson passes its own, a conversation uses its chatId */
  labId?: string
  /** A terminal the tutor can read (and, in the Linux lab, type into) */
  terminalId?: string
  /** A system design canvas (vault path) the tutor can read and draw on */
  canvasPath?: string
  /** Talk is on: reply with a short spoken part first, in this character's way of talking */
  voice?: import('./characters').CharacterId
  /** Which model answers: auto (Gemma, or the cloud model for jobs set to escalate), or one you picked */
  engine?: 'auto' | 'local' | 'cloud'
  /** A learning session (teach, quiz, interview…): the session tag rules go in the system prompt */
  session?: boolean
  /** The tutor's current question type in a session, so a worked answer to a problem can be escalated */
  askType?: string
  /** A lesson's topic: for checking its problems and finding it in books you own */
  topic?: string
  /** [source-led] false when "Let the tutor explain" is chosen for this lesson; otherwise a step is taught from a source when a good one is found (shared/sourceLed) */
  sourceLed?: boolean
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: number
  attachment?: string
  sources?: ContextSource[]
  steps?: AgentStep[]
  error?: string
}

export interface Chat {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  scope: ChatScope
  pinned?: boolean
  messages: StoredMessage[]
  /** Running summary of messages[0 .. summarizedUpTo), written when the conversation gets long */
  summary?: string
  summarizedUpTo: number
}

export type ChatSummary = Pick<Chat, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'scope' | 'pinned'> & { count: number; preview: string }

export interface Memory {
  id: string
  text: string
  createdAt: number
  updatedAt: number
  /** Conversation it came from, when the tutor saved it */
  chatId?: string
}

export type PracticeStatus = 'todo' | 'solved' | 'struggled' | 'redo'

export interface PracticeProblem {
  id: string
  title: string
  /** LeetCode (or other) link; empty for a topic challenge */
  url: string
  /** A LeetCode-style problem, or a challenge Tide invents from something you studied */
  kind?: 'problem' | 'challenge'
  /** What a topic challenge draws on */
  source?: ChatScope
  difficulty: 'easy' | 'medium' | 'hard'
  patterns: string[]
  status: PracticeStatus
  attempts: { at: number; score: number; summary: string }[]
  /** When it should be tried again */
  due?: number
  notes?: string
  addedAt: number
}

export interface Goal {
  id: string
  name: string
  /** Notebook folder the goal covers; its outline supplies the topics */
  notebook: string
  /** Only topics under this heading of the outline, e.g. "Part II — Functions" */
  section?: string
  deadline: string
  createdAt: number
}

export interface ExamOptions {
  questions: number
  minutes: number
  difficulty: 'gentle' | 'normal' | 'hard' | 'olympiad'
  style: 'university' | 'problems' | 'short'
}

export interface ExamPart {
  label: string
  text: string
  marks: number
  /** Hidden from the student until marking */
  scheme: string
}

export interface ExamQuestion {
  number: number
  text: string
  parts: ExamPart[]
}

export interface ExamPaper {
  title: string
  instructions: string
  topic: string
  minutes: number
  questions: ExamQuestion[]
  createdAt: number
}

export interface ExamMark {
  awarded: number
  marks: number
  feedback: string
  missed: string
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  durationMs: number
  /** Charts the program drew (Matplotlib), as PNG data URLs */
  images?: string[]
  /** A code question's hidden tests, when it had them: which passed and which failed */
  tests?: TestResults
}

export interface TestResults {
  passed: string[]
  failed: { name: string; message: string }[]
}

export interface CompanyPrepRequest {
  id: string
  company: string
  role: string
  /** What they already know, when the interview is */
  notes?: string
}

export interface OutlineDraftRequest {
  id: string
  topic: string
  /** Why they're learning it and what they already know */
  goal?: string
  size: 'overview' | 'course' | 'deep'
  /** Look up real syllabi on the web first */
  research: boolean
  /** A sized plan: write one part per phase instead of using `size` */
  plan?: import('./plan').StudyPlan
  /** Research already gathered while sizing the plan, so it isn't fetched twice */
  notes?: string
}

export interface AgentStep {
  id: string
  kind: 'search_notes' | 'read_note' | 'web_search' | 'read_webpage' | 'delegate' | 'helper' | 'run_code' | 'run_sql' | 'load_table' | 'remember' | 'terminal' | 'canvas' | 'metabase'
  label: string
  detail?: string
  status: 'running' | 'done' | 'error'
  /** 0 for the tutor, 1 for its helpers */
  depth: number
}

export interface GraphData {
  nodes: { path: string; title: string; notebook: string; degree: number; tags: string[] }[]
  edges: { source: string; target: string }[]
}

export interface NotebookMeta {
  path: string
  name: string
  noteCount: number
  fileCount: number
  mastered: number
  learning: number
  lastModified: number
  /** Vault relative path of a cover image in .tide/covers */
  cover?: string
  color?: string
  description?: string
  /** Vault path of the note used as this notebook's outline */
  outline?: string
  /** A project: something you're building or need to understand, with its documents */
  project?: import('./project').ProjectInfo
  /** Who teaches its lessons: Tide decides (Gemma, the cloud model for hard parts), or the cloud model throughout */
  tutor?: 'auto' | 'cloud'
}

export interface NoteProgress {
  quizzes: { at: number; score: number; total: number }[]
}

export interface ReviewStats {
  byDay: Record<string, number>
  streak: number
  retention: number | null
  totalReviews: number
  decks: Record<string, { total: number; new: number; due: number; learning: number; mature: number }>
}

export type Verdict = 'correct' | 'partial' | 'wrong'

export interface Attempt {
  at: number
  /** Note the question was about, when known */
  path?: string
  topic: string
  mode: SessionMode
  verdict: Verdict
  /** 0..1 */
  score: number
  /** How sure the student said they were, 1 (guess) to 3 (sure) */
  confidence?: 1 | 2 | 3
  question?: string
}

export type MasteryLevel = 'new' | 'weak' | 'shaky' | 'solid' | 'mastered'

export interface Mastery {
  path: string
  level: MasteryLevel
  /** 0..1 */
  score: number
  attempts: number
  /** Confidently wrong answers in recent attempts, the misconceptions worth fixing first */
  misconceptions: number
  lastAt?: number
}

export type SessionMode = 'teach' | 'quiz' | 'interview' | 'review' | 'probe' | 'recall'

export interface TutorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TutorThread {
  id: string
  /** First source line of the block the thread is attached to */
  line: number
  /** Text of the block when the thread was made, used to re-anchor after edits */
  quote: string
  kind: 'ask' | 'readalong'
  /** For read-along threads, what kind of margin note started it */
  note?: 'question' | 'gap' | 'correction' | 'praise' | 'improve'
  /** A rewrite of the quoted paragraph the student can apply (writing coach) */
  suggestion?: string
  messages: TutorMessage[]
  createdAt: number
  resolved?: boolean
}

export interface ReadAlongNote {
  kind: 'question' | 'gap' | 'correction' | 'praise' | 'improve'
  text: string
  /** The paragraph rewritten (coach corrections and improvements) */
  rewrite?: string
}

/** Where one answer's time went (Settings › Speed) */
export interface TurnSpeed {
  id: string
  at: number
  kind: 'chat' | 'lesson'
  /** From pressing send to the first model request: Tide's own work */
  prepareMs: number
  /** Each model request: reading the prompt (to the first token), then writing */
  calls: { engine: 'local' | 'cloud'; model: string; prefillMs: number; writeMs: number; tokens: number; promptTokens?: number; cachedTokens?: number; /** Tide's work on the stream, all tokens together */ tideMs: number }[]
  tools: { name: string; ms: number }[]
  totalMs: number
  /** The window drawing the answer as it arrived */
  render?: { frames: number; totalMs: number; longestMs: number }
}

/** What holds this Mac's memory (Settings › Speed) */
export interface MacMemory {
  total: number
  swapUsed: number
  /** The local model server's memory, and how much of it macOS has compressed or swapped */
  model: number
  modelSqueezed: number
  /** The other apps holding the most, largest first */
  apps: { name: string; bytes: number }[]
}

export type ChatEvent =
  | { id: string; type: 'sources'; sources: ContextSource[] }
  | { id: string; type: 'delta'; text: string }
  /** Clear the reply shown so far (the model is starting over) */
  | { id: string; type: 'reset' }
  /** A lesson reply is written: the student can answer while its checks finish */
  | { id: string; type: 'replied' }
  | { id: string; type: 'step'; step: AgentStep }
  | { id: string; type: 'done' }
  | { id: string; type: 'error'; message: string }

export interface PdfHighlight {
  id: string
  page: number
  text: string
  /** Rects relative to the page, in 0..1 units */
  rects: { x: number; y: number; w: number; h: number }[]
  color: 'yellow' | 'green' | 'blue' | 'pink'
  note?: string
  createdAt: number
  /** Where it is when that isn't a page of a PDF: "loc=3.12" (an EPUB's chapter and paragraph), "para=7" (an article or note); see shared/passage */
  loc?: string
  /** A bookmark: a place kept, with no text marked */
  bookmark?: boolean
}

export interface Flashcard {
  id: string
  path: string
  front: string
  back: string
  reversed?: boolean
  /** Cloze cards blank out part of a sentence; front shows the gap, back the full sentence */
  cloze?: boolean
  /** Line in the note the card was parsed from */
  line: number
}

export interface CardSchedule {
  due: number
  /** Days until the card is due after its last review */
  interval: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  /** 0 new, 1 learning, 2 review, 3 relearning (FSRS states) */
  state: number
  lastReview?: number
}

export interface StudyCard extends Flashcard {
  schedule: CardSchedule | null
  /** Days until due for each grade if answered now */
  preview: Record<ReviewGrade, number>
  /** Forgotten so often that re-learning the idea beats more reviews */
  leech: boolean
}

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

export interface ClipResult {
  path: string
  title: string
}

export interface TideApi {
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  vault: {
    choose(): Promise<string | null>
    tree(): Promise<FileNode | null>
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<void>
    /** Writes an image given as a data: URL, e.g. a photo of handwritten working */
    writeImage(path: string, dataUrl: string): Promise<void>
    createNote(folder: string, name: string): Promise<string>
    createFolder(parent: string, name: string): Promise<string>
    rename(path: string, newName: string): Promise<string>
    trash(path: string): Promise<void>
    reveal(path: string): Promise<void>
    resolveLink(target: string, fromPath: string): Promise<string | null>
    notes(): Promise<NoteMeta[]>
    onChange(cb: (paths: string[]) => void): () => void
  }
  search: {
    query(q: string, limit?: number): Promise<SearchHit[]>
  }
  code: {
    /** Files in the vault's Code folder, newest first */
    list(): Promise<{ path: string; mtime: number }[]>
    /** Creates a file there and returns its path */
    create(name: string, content?: string): Promise<string>
  }
  terminal: {
    /** Starts a Linux lab container or a shell on this Mac */
    create(kind: 'lab' | 'local', cols: number, rows: number): Promise<{ id: string }>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    close(id: string): Promise<void>
    /** Flashcards from the commands run in a lab, added to the lab's flashcard note */
    flashcards(id: string, topic?: string): Promise<{ added: number; path: string; commands: number }>
    onData(cb: (e: { id: string; data: string }) => void): () => void
    onExit(cb: (e: { id: string; code: number }) => void): () => void
  }
  chats: {
    list(): Promise<ChatSummary[]>
    get(id: string): Promise<Chat | null>
    rename(id: string, title: string): Promise<void>
    pin(id: string, pinned: boolean): Promise<void>
    remove(id: string): Promise<void>
    /** A stored conversation changed: a turn, its title or its summary */
    onChanged(cb: (id: string) => void): () => void
  }
  memory: {
    list(): Promise<Memory[]>
    add(text: string): Promise<{ memory: Memory; duplicate: boolean }>
    update(id: string, text: string): Promise<void>
    remove(id: string): Promise<void>
  }
  ai: {
    chat(req: ChatRequest): Promise<void>
    /** Reads a lesson's opening ahead of time, so it starts at once (nothing is shown or saved) */
    prewarm(req: Omit<ChatRequest, 'id'>): Promise<void>
    cancel(id: string): Promise<void>
    onEvent(cb: (e: ChatEvent) => void): () => void
    models(): Promise<string[]>
    test(): Promise<{ ok: boolean; message: string }>
    /** The model picks between close teaching strategies (a one-letter answer, a few seconds at most) */
    tieBreak(topic: string, options: import('./strategy').Strategy[], context?: string): Promise<import('./strategy').Strategy>
    generateFlashcards(path: string, count: number, focusText?: string, pages?: { from: number; to: number }): Promise<{ front: string; back: string }[]>
    readAlong(path: string, passage: string, mode: string, force?: boolean, style?: 'coach'): Promise<ReadAlongNote | null>
  }
  learn: {
    /** Everything Tide knows, as one graph: you, notebooks, notes, books, memories, this week */
    brain(): Promise<import('./brain').BrainData>
    /** What Tide learned or did lately */
    brainEvents(): Promise<import('./brain').BrainEvent[]>
    graph(): Promise<GraphData>
    backlinks(path: string): Promise<{ path: string; title: string }[]>
    notebooks(): Promise<NotebookMeta[]>
    updateNotebook(path: string, patch: Partial<Pick<NotebookMeta, 'color' | 'description' | 'outline' | 'project' | 'tutor'>>): Promise<void>
    /** Streams an outline draft for a new topic as ai:event deltas under req.id */
    draftOutline(req: OutlineDraftRequest): Promise<void>
    cancelDraft(id: string): Promise<void>
    /** Streams a review of a roadmap as ai:event deltas under id */
    auditRoadmap(id: string, path: string, hoursPerWeek: number): Promise<void>
    /** Real books, courses and docs for each phase of a plan */
    planReadings(topic: string, plan: import('./plan').StudyPlan, research: string): Promise<{ phase: string; items: { title: string; by?: string; why?: string; url?: string; unverified?: boolean }[] }[]>
    /** Sends a dated roadmap to Things 4 as a project */
    planToThings(path: string, name: string, notebook?: string): Promise<{ project: string; todos: number }>
    /** Ticks roadmap topics finished in Things 4; returns how many */
    syncFromThings(path: string): Promise<number>
    thingsStatus(): Promise<{ ready: boolean; detail: string }>
    /** Today in Things 4 (today, this evening, finished today); null when Things isn't connected */
    thingsToday(): Promise<import('./day').DayTask[] | null>
    thingsSetDone(id: string, done: boolean): Promise<void>
    /** Researches and sizes a learning plan; progress arrives as ai:event steps under id */
    adjustPlan(req: { topic: string; goal?: string; hoursPerWeek: number; deadline?: string; start: string; plan: import('./plan').StudyPlan; request: string }): Promise<import('./plan').StudyPlan>
    sizePlan(id: string, req: { topic: string; goal?: string; hoursPerWeek: number; deadline?: string; start: string }): Promise<{ plan: import('./plan').StudyPlan; research: string; sources: { title: string; url: string }[] }>
    /** Last study day, plus what's due today */
    brief(): Promise<{ last: import('./brief').StudyDay | null; recall: number; problems: number }>
    /** Records a finished focus session, and what it was spent on */
    logFocus(start: number, end: number, context?: { label?: string; path?: string; kind?: string }): Promise<void>
    /** Minutes of timed study recorded for a note, book or problem */
    focusTime(path: string): Promise<number>
    /** Study sessions logged since a time (ms) */
    focusLog(since: number): Promise<{ start: number; minutes: number; label?: string; path?: string; kind?: string }[]>
    /** Up to three pages worth reading next on these topics, found on the web */
    suggestReading(topics: string[]): Promise<{ title: string; url: string; host: string; why: string }[]>
    /** Chapters of a PDF from its bookmarks, or from its printed contents */
    bookChapters(path: string): Promise<{ chapters: { title: string; page: number; level: number }[]; numPages: number; from: 'bookmarks' | 'contents' | 'none' }>
    chooseCover(path: string): Promise<string | null>
    /** Uses a dropped image file as the notebook's cover */
    setCoverFile(path: string, file: string): Promise<string>
    clearCover(path: string): Promise<void>
    setStatus(path: string, status: LearningStatus): Promise<void>
    recordQuiz(paths: string[], score: number, total: number): Promise<void>
    progress(): Promise<Record<string, NoteProgress>>
    stats(): Promise<ReviewStats>
    threads(path: string): Promise<TutorThread[]>
    saveThreads(path: string, threads: TutorThread[]): Promise<void>
    recordAttempt(attempt: Omit<Attempt, 'at'>): Promise<void>
    mastery(): Promise<Record<string, Mastery>>
  }
  practice: {
    /** A coding challenge on a topic, note, notebook or book chapter */
    addChallenge(input: { title: string; source: ChatScope; difficulty?: PracticeProblem['difficulty'] }): Promise<PracticeProblem>
    list(): Promise<PracticeProblem[]>
    patterns(): Promise<string[]>
    add(input: { title?: string; url?: string; difficulty?: PracticeProblem['difficulty']; patterns?: string[] }): Promise<PracticeProblem>
    addStarter(): Promise<number>
    update(id: string, patch: Partial<Pick<PracticeProblem, 'difficulty' | 'patterns' | 'status' | 'notes' | 'title' | 'url'>>): Promise<void>
    remove(id: string): Promise<void>
    record(id: string, score: number, summary: string): Promise<PracticeProblem | null>
    /** Streams a company interview prep plan as ai:event deltas under req.id */
    draftCompanyPrep(req: CompanyPrepRequest): Promise<void>
    cancelCompanyPrep(id: string): Promise<void>
    /** Mock interview results per company */
    logInterview(r: Omit<InterviewRecord, 'id' | 'at'>): Promise<InterviewRecord>
    interviews(): Promise<InterviewRecord[]>
    /** Mental maths speed drills */
    logDrill(r: Omit<import('./drills').DrillResult, 'id' | 'at'>): Promise<import('./drills').DrillResult>
    drills(): Promise<import('./drills').DrillResult[]>
  }
  /** Your goal and focus, the week planned towards them, and the learner profile */
  /** Every service Tide connects to, with its state and use (main/connections) */
  speed: {
    /** Where the last answers' time went */
    recent(): Promise<TurnSpeed[]>
    /** The window's report on drawing one streamed answer */
    render(id: string, r: NonNullable<TurnSpeed['render']>): Promise<void>
    /** What holds this Mac's memory right now (takes about a second) */
    memory(): Promise<MacMemory>
  }
  connections: {
    list(fresh?: boolean): Promise<import('./connections').Connection[]>
    /** Saves (or, with null, forgets) the key for a connection added from the Connections page */
    setKey(id: string, key: string | null): Promise<import('./connections').Connection[]>
    /** Notes that a connection the window uses directly (Wispr Flow) was just used */
    used(id: string): Promise<void>
  }
  /** The passages a lesson is taught from (none yet: built in the background for next time) */
  sources: {
    lesson(topic: string, where?: string): Promise<import('./sources').SourcePack | null>
  }
  /** Past lessons, kept as they go: to read again, or carry on */
  lessons: {
    save(r: Omit<import('./lessonLog').LessonRecord, 'started' | 'updated' | 'page'> & { started?: number }): Promise<import('./lessonLog').LessonSummary | null>
    list(): Promise<import('./lessonLog').LessonSummary[]>
    get(id: string): Promise<import('./lessonLog').LessonRecord | null>
    /** Has the cloud model check one of the tutor's replies against the lesson's sources */
    challenge(topic: string, where: string | undefined, reply: string): Promise<import('./lessonCheck').ClaimCheck & { offline?: string }>
  }
  /** The knowledge map: every concept with how solid it is today, what is ready next, what is fading, and retention by week */
  knowledge: {
    view(): Promise<import('./knowledge').KnowledgeView>
  }
  /** Free readings found for a topic; when there are none yet, they're looked up in the background */
  readings: {
    /** path: the note or folder the lesson is on, so a private project's topics are never looked up */
    for(topic: string, path?: string): Promise<import('./readings').Reading[]>
  }
  /** Your roadmaps sorted against your aims (main/curriculum) */
  curriculum: {
    status(): Promise<{ notebooks: import('../main/curriculum').SortStatus[]; error: string }>
    sort(): Promise<import('../main/curriculum').SortStatus[]>
    /** Each topic's place in the plan, by topic id, for the roadmap page */
    view(notebook: string): Promise<import('./curriculum').CurriculumView>
    setOverride(id: string, cls: import('./curriculum').SectionClass | null): Promise<Record<string, import('./curriculum').SectionClass>>
    /** A placement check's result: known topics ticked, shaky ones made refreshers in this week */
    placed(setup: import('./placement').PlacementSetup, results: Record<string, import('./placement').Known>): Promise<{ known: number; shaky: number; fresh: number }>
    /** Suggested changes to a roadmap from your aims (nothing changes until you accept one) */
    propose(notebook: string): Promise<import('./curriculum').Proposal[]>
    /** Adds a topic to a roadmap after another: one new line */
    addTopic(notebook: string, afterId: string, title: string): Promise<boolean>
  }
  coach: {
    get(): Promise<import('./coach').CoachSettings>
    save(s: import('./coach').CoachSettings): Promise<import('./coach').CoachSettings>
    week(date?: string): Promise<import('./coach').WeekPlan | null>
    planWeek(): Promise<import('./coach').WeekPlan>
    profile(): Promise<string>
    /** Works out where you're heading (at most every few days unless forced); returns the settings */
    infer(force?: boolean): Promise<import('./coach').CoachSettings>
    toThings(): Promise<{ project: string; todos: number }>
    setDone(date: string, index: number, done: boolean): Promise<import('./coach').WeekPlan | null>
    syncDone(): Promise<import('./coach').WeekPlan | null>
    rollOver(date?: string): Promise<{ moved: number; to: string }>
    dayStats(date?: string): Promise<import('./coach').DayStats>
    journal(): Promise<JournalEntry[]>
    writeJournal(date: string, text: string): Promise<JournalEntry>
    weekReview(end?: string): Promise<WeekReview>
    saveReview(end: string, r: { wentWell: string; inTheWay: string; change: string }): Promise<string>
  }
  /** What this window is studying, for the professor in the menu bar; null when it stops */
  /** Commands from the menu bar's menu: open a view or today's item, start a focus timer */
  onTrayCommand(cb: (c: { type: 'view'; view: unknown } | { type: 'agenda'; date: string; index: number } | { type: 'focus'; minutes: number }) => void): () => void
  studying(status: { pose: import('./professorArt').ProfessorPose; label: string; since: number; until?: number } | null): Promise<void>
  windows: {
    /** Opens the view in its own window, with nothing else on screen */
    openFocus(view: unknown): Promise<void>
    /** The view handed to this focus window, once */
    focusView(id: string): Promise<unknown>
    close(): Promise<void>
  }
  cloud: {
    /** Which providers have a saved key (the keys themselves never leave the main process) */
    keys(): Promise<Record<string, boolean>>
    setKey(provider: string, key: string | null): Promise<void>
    test(provider: string, model: string): Promise<{ ok: boolean; message: string; limits?: Record<string, string> }>
    /** Models the provider says this key can use */
    models(provider: string): Promise<string[]>
    usage(monthOffset?: number): Promise<import('../main/cloud').UsageSummary>
  }
  projects: {
    /** Makes a notebook a project (or clears it with null) */
    set(notebook: string, info: import('./project').ProjectInfo | null): Promise<void>
    /** Its documents: attached, and filed under its name */
    docs(notebook: string): Promise<string[]>
    /** A flow's steps in order (from part, to part, what passes), from the documents */
    flowSteps(notebook: string, flow: string): Promise<import('./project').FlowStep[]>
    /** The saved map; with rebuild set, maps it now (false: only if a document changed) */
    map(notebook: string, rebuild?: boolean): Promise<import('./project').ProjectMap | null>
    /** Drafts a build brief with the learner; text arrives as ai:event deltas under id */
    draftBrief(req: { id: string; notebook: string; idea: string; background?: string }): Promise<void>
  }
  books: {
    /** The pages to read in your own books for a topic, best first */
    suggest(topic: string, limit?: number): Promise<import('./books').ReadingSuggestion[]>
    /** The text of the section of a book you own that covers a topic, to teach a lesson from */
    passage(topic: string): Promise<{ label: string; path: string; from: number; to: number; text: string } | null>
    /** Maps a book now: chapters, pages and what each covers */
    map(path: string): Promise<import('./books').BookMap | null>
  }
  /** Problems written and checked ahead of time (main/bank.ts) */
  bank: {
    status(): Promise<{ lastRun?: number; added: number; topics: number; note?: string }>
    prepare(): Promise<{ lastRun?: number; added: number; topics: number; note?: string }>
    /** A fresh version of a past mistake, for its retest */
    variant(mistakeId: string): Promise<import('./bank').BankProblem | null>
    /** An easy first problem on a topic */
    preview(topic: string): Promise<import('./bank').BankProblem | null>
    /** A lesson's first reply, written ahead for exactly this start */
    opening(instructions: string, opening: string): Promise<string | null>
    /** Quick problems from the last week's topics */
    warmups(n?: number): Promise<import('./bank').BankProblem[]>
  }
  studyApi: {
    status(): Promise<import('../main/studyApi').StudyApiStatus>
    set(patch: { enabled?: boolean; lan?: boolean }): Promise<import('../main/studyApi').StudyApiStatus>
    newToken(): Promise<import('../main/studyApi').StudyApiStatus>
  }
  metabase: {
    status(): Promise<{ ready: boolean; detail: string; url: string }>
    /** Checks the address and key, then saves them (the key goes to the Keychain) */
    connect(url: string, key: string): Promise<{ ready: boolean; detail: string; url: string }>
    disconnect(): Promise<void>
  }
  voice: {
    status(): Promise<{ ready: boolean; detail: string }>
    setup(): Promise<{ ready: boolean; detail: string }>
    speak(text: string, voice?: string, speed?: number): Promise<Uint8Array>
    /** where: the lesson's note and topic, so a private project's answers stay on this Mac */
    transcribe(wav: Uint8Array, where?: { path?: string; topic?: string }): Promise<string>
    hasDeepgram(): Promise<boolean>
    /** Checks the key with Deepgram, then keeps it in the Keychain (null forgets it) */
    saveDeepgram(key: string | null): Promise<void>
    warm(stt: boolean): Promise<void>
    onProgress(cb: (step: string) => void): () => void
  }
  daily: {
    /** Marks a typed answer in daily practice */
    grade(req: { kind: 'mistake' | 'recall'; question: string; expected?: string; path?: string; answer: string }): Promise<import('../main/daily').DailyGrade>
  }
  mistakes: {
    list(): Promise<import('./mistakes').Mistake[]>
    due(n?: number): Promise<import('./mistakes').Mistake[]>
    add(items: import('./mistakes').NewMistake[]): Promise<number>
    retest(id: string, correct: boolean): Promise<import('./mistakes').Mistake | null>
  }
  recall: {
    queue(): Promise<{ path: string; title: string; due: number; first: boolean }[]>
    review(path: string, grade: ReviewGrade): Promise<void>
  }
  goals: {
    list(): Promise<Goal[]>
    save(goals: Goal[]): Promise<void>
  }
  exam: {
    generate(scope: ChatScope, topic: string, opts: ExamOptions): Promise<ExamPaper>
    mark(question: ExamQuestion, partIndex: number, answer: string, images: string[]): Promise<ExamMark>
  }
  /** The data lab: a small SQLite with sample data, one per conversation or lesson (the id), in memory on this Mac */
  lab: {
    query(id: string, sql: string): Promise<import('./lab').LabResult>
    schema(id: string): Promise<import('./lab').LabTable[]>
    /** Throws away whatever was changed and puts the sample data back */
    reset(id: string): Promise<void>
    /** Loads a .csv or .tsv file from the notes folder (a path relative to it) into that lab as a table named after the file */
    load(id: string, path: string): Promise<import('./lab').LabLoaded>
  }
  /** Guided projects (shared/workshop.ts): built in stages, reviewed against tests */
  workshop: {
    list(): Promise<import('./workshop').WorkshopCard[]>
    /** Starts a project, or returns it as it stands when already started */
    start(id: string, from?: { notebook?: string; topic?: string }): Promise<import('./workshop').WorkshopState>
    state(id: string): Promise<import('./workshop').WorkshopState | null>
    /** Runs the current stage's tests (and every earlier stage's) in the sandbox */
    run(id: string): Promise<import('./workshop').WorkshopState>
    hint(id: string): Promise<import('./workshop').WorkshopState>
    /** The tutor's review of the latest run */
    review(id: string): Promise<import('./workshop').WorkshopState>
    ask(id: string, question: string): Promise<{ answer: string; by: 'cloud' | 'local' | 'none' }>
    /** The project already written for a roadmap's "Project:" item, if any */
    forTopic(topic: string): Promise<import('./workshop').WorkshopCard | null>
    /** Has the stronger model design a project for a roadmap item; kept only if Tide can prove it */
    propose(o: { topic: string; notebook?: string; section?: string }): Promise<{ card: import('./workshop').WorkshopCard | null; tries: number; problems: string[] }>
  }
  difficulty: {
    /** What the knowledge map has on a lesson's topic and what it builds on (shared/difficulty.ts) */
    known(topic: string, path?: string): Promise<import('./difficulty').Known>
  }
  runner: {
    /** `tests`: a code question's hidden tests (Python); `labId`: the data lab that SQL is run in */
    run(language: string, code: string, stdin?: string, opts?: { tests?: string; labId?: string }): Promise<RunResult>
    /** Runs a vault file with the rest of its folder (modules, data files) beside it */
    runFile(path: string, stdin?: string): Promise<RunResult>
    librariesStatus(): Promise<{ ready: boolean; detail: string }>
    /** Prompt cache and draft model on a local mlx-vlm server */
    speedStatus(): Promise<{ ready: boolean; detail: string }>
    applySpeedups(): Promise<{ ready: boolean; detail: string }>
    setupLibraries(): Promise<{ ready: boolean; detail: string }>
    /** The lab pack: PyTorch, scikit-learn, SciPy, pytest and HTTP helpers in Tide's Python */
    labStatus(): Promise<{ ready: boolean; detail: string }>
    setupLab(): Promise<{ ready: boolean; detail: string }>
    onLabProgress(cb: (step: string) => void): () => void
    /** Which languages run on this Mac, and what the others need */
    languagesStatus(): Promise<{ ready: boolean; detail: string }>
    mathStatus(): Promise<{ ready: boolean; detail: string }>
    setupMath(): Promise<{ ready: boolean; detail: string }>
    /** Private web search (SearXNG in Docker) */
    searchStatus(): Promise<{ ready: boolean; detail: string }>
    setupSearch(): Promise<{ ready: boolean; detail: string }>
  }
  library: {
    saveUrl(url: string): Promise<ClipResult>
    importFiles(): Promise<ClipResult[]>
    importPaths(paths: string[]): Promise<ClipResult[]>
    /** Cached cover for a library item (vault path), fetched on first use; null when it has none */
    thumb(path: string, image?: string, source?: string): Promise<string | null>
    /** Subjects each library item is filed under, by path */
    topics(): Promise<Record<string, string[]>>
    setTopics(path: string, topics: string[]): Promise<void>
    /** Reading status you set on items (stored), by path */
    status(): Promise<Record<string, ReadStatus>>
    /** Sets an item's reading status; null clears it back to the derived one */
    setStatus(path: string, status: ReadStatus | null): Promise<void>
  }
  highlights: {
    get(path: string): Promise<PdfHighlight[]>
    save(path: string, highlights: PdfHighlight[]): Promise<void>
  }
  /** humanities: reading books in any format (src/main/reading) */
  reading: ReadingApi
  study: {
    cards(scope: ChatScope): Promise<StudyCard[]>
    review(cardId: string, grade: ReviewGrade, path: string): Promise<CardSchedule>
    saveCards(path: string, markdown: string): Promise<string>
  }
  app: {
    openExternal(url: string): Promise<void>
    handy(): Promise<{ installed: boolean; shortcut: string; model: string }>
    /** Wispr Flow: installed, and its push-to-talk key, e.g. "Right ⌥" */
    flow(): Promise<{ installed: boolean; pushToTalk: string }>
    platform: string
    /** Started from the source with a test profile, so check tooling can drive it */
    testCopy?: boolean
  }
}

// ---------- humanities: reading (src/main/reading) ----------

export interface ReadingApi {
  book(path: string): Promise<import('./epub').EpubBook>
  /** Where a selected passage is in a work */
  locate(path: string, text: string): Promise<import('./passage').PassageLoc | null>
  freeSearch(query: string): Promise<import('./freeBooks').FreeBook[]>
  freeAdd(book: import('./freeBooks').FreeBook): Promise<ClipResult>
  source(path: string): Promise<(import('./freeBooks').BookSource & { siteName: string }) | null>
  discuss(req: { path: string; passage: string; loc?: import('./passage').PassageLoc; id?: string; said?: string; spoilers?: boolean; readTo?: import('./passage').PassageLoc }): Promise<{ discussion: import('./closeReading').Discussion; repaired?: boolean }>
  discussions(path: string): Promise<import('./closeReading').Discussion[]>
  keep(path: string, id: string, what: { turn?: number; conclusion?: string }): Promise<import('./closeReading').Discussion | null>
  items(path: string): Promise<import('./bookNotes').ReadingItem[]>
  syncNotes(path: string): Promise<string>
  togetherOpen(path: string, kind?: import('./readTogether').WorkKind): Promise<{ record: import('./readTogether').ReadingRecord; recordPath: string; recap: string; chapters: { n: number; title: string; part?: string }[]; next: number }>
  togetherOrient(path: string, chapter: number): Promise<string>
  togetherDiscuss(t: { path: string; chapter: number; turns: { role: 'tutor' | 'learner'; text: string }[]; said?: string }): Promise<{ reply: string; record: import('./readTogether').ReadingRecord; refused: string[] }>
  togetherFinish(path: string, chapter: number, note?: string): Promise<import('./readTogether').ReadingRecord>
}
