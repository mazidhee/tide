import type { InterviewRecord } from './interviews'
import type { JournalEntry, WeekReview } from './coach'
export type ThemeId = 'system' | 'light' | 'dark' | 'graphite' | 'midnight' | 'ember' | 'sepia'

/** A Claude model, by the CLI's alias, or a full model id (Fable: claude-fable-5-1) */
export type ClaudeModel = 'opus' | 'sonnet' | 'haiku' | 'claude-fable-5-1'

/** What a Claude call is for: each has its own model (shared/claude.ts has the defaults) */
export type ClaudeRole = 'teach' | 'mark' | 'hard' | 'background'

export interface ClaudeSettings {
  /** Who teaches lessons and the tutor chat: Claude (the default once Claude Code is set up) or Gemma on this Mac */
  teacher?: 'claude' | 'gemma'
  /** The model for each kind of work: ordinary turns, marking answers, maths, plans and hard explanations, background jobs */
  models?: Partial<Record<ClaudeRole, ClaudeModel>>
  /** How hard Claude thinks, per job or turn kind, where it differs from shared/thinking's table */
  thinking?: Partial<Record<string, import('./thinking').Effort>>
  /** Where the claude command is, when it isn't in a usual place */
  path?: string
  /** Tide's tools are registered with Claude Code for the terminal, on this fixed port (off when unset) */
  terminalPort?: number
}

export interface GemmaStatusView {
  /** Null when the server can't say (not mlx-vlm, or not running) */
  loaded: boolean | null
  serverUp: boolean
  /** Claude is the main tutor (set up, logged in, not at its limit, online) */
  claudeMain: boolean
  reason?: import('./gemmaPolicy').GemmaReason
  idleMinutes: number
  /** The plain sentence Settings shows */
  line: string
}

export interface ClaudeStatusView {
  installed: boolean
  version?: string
  loggedIn: boolean
  plan?: string
  error?: string
  limitedUntil?: number
  limit?: { status: string; utilization?: number; window?: string; resetsAt?: number } | null
  live: { key: string; model: string; turns: number; lastUsed: number }[]
  /** The fixed port Claude Code in the terminal reaches Tide on, when set up */
  terminalPort?: number
}

export interface ClaudeUseRecord {
  at: number
  model: string
  role: ClaudeRole
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  ms: number
  firstTokenMs?: number
}

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
  /** While Claude is the main tutor, Gemma is unloaded sooner after its last use (default 5 minutes, never later than unloadAfterMinutes) */
  gemmaUnloadWithClaudeMinutes?: number
  autoStart?: boolean
  serverCommand?: string
  /** Claude, run through the user's own logged-in Claude Code (main/claudeEngine) */
  claude?: ClaudeSettings
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
  /** How your own notes open: to write in (the default) or to read. Course material and saved sources always open to read */
  noteOpenMode?: 'write' | 'read'
  /** Backups of Tide's own data (main/backup): where the snapshots go, when not the default folder in Tide's app data */
  backups?: { folder?: string }
  /** The note editor shows plain Markdown everywhere instead of live preview (which hides it away from the cursor) */
  editorSource?: boolean
  /** Study timers: the sidebar's Focus timer and the timer buttons on notes, books and practice */
  studyTimers?: boolean
  /** Sidebar items the user chose to hide (ids from shared/sidebar.ts) */
  sidebarHidden?: string[]
  fontSize: number
  /** Notebooks (main/notebook): `internet` lets a notebook's kernel reach the internet, for yfinance (off unless turned on) */
  notebook?: { internet?: boolean }
  ai: AISettings
  /** Maths animations (shared/manim): narration in Tide's voice, render quality, and whether the one-time install offer was answered */
  animations?: { narration?: boolean; quality?: 'low' | 'medium'; prompted?: boolean }
  /** How the tutor sounds: Tide's natural voice (Kokoro, set up in Settings) or the Mac's own */
  /** custom: a Kokoro voice that replaces the character's; dictation: who writes out what you say */
  voice?: { engine: 'natural' | 'system'; name: string; speed: number; custom?: string; dictation?: 'tide' | 'handy' | 'deepgram' | 'flow' }
  /** Who the tutor is: the character's face, voice and way of talking */
  character?: import('./characters').CharacterId
  /** Why mode in lessons: Socratic, from first principles. Foundations (the default) turns it on for early, basic topics */
  whyMode?: 'off' | 'foundations' | 'always'
  /** Breaks while you study (before the planner): only "off" is still read, as breaks off */
  pomodoro?: 'auto' | 'off' | '25' | '50'
  /** Breaks while you study: planned from the research and your own signals (shared/breaks) */
  breaks?: Partial<import('./breaks').BreakSettings>
  /** The character in the menu bar: always, only while studying, or never */
  menuBar?: 'always' | 'studying' | 'off'
  /** A stronger cloud model for the hard parts; Gemma on this Mac stays the default */
  cloud?: import('./providers').CloudSettings
  /** Your Metabase, read-only, for learning it; its API key is kept in the Keychain */
  metabase?: { url: string }
  /** Tide's study data API for dashboards and other apps (main/studyApi.ts); off by default */
  studyApi?: { enabled: boolean; port?: number; lan?: boolean }
  /** The editor a guided project opens in (shared/editor.ts): 'auto' picks by the project's language */
  editor?: import('./editor').EditorChoice
  /** Lesson prep while you're away (shared/lessonPrep): on or off, the night window, Claude's allowance */
  prep?: Partial<import('./lessonPrep').PrepSettings>
  /** The maths answer box: read back what you said before it's marked (on by default), and the calculator's angle unit */
  maths?: { readBack?: boolean; angle?: 'rad' | 'deg' }
}

export type FileKind = 'note' | 'pdf' | 'epub' | 'image' | 'doc' | 'canvas' | 'notebook' | 'other'

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
  /** What the student has on screen in Tide right now (shared/onScreen describeScreen): a course page, a video's moment, an article */
  onScreen?: string
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
  /** Which model answers: auto (who teaches, from Settings and the notebook), Gemma only, the cloud model, or Claude */
  engine?: 'auto' | 'local' | 'cloud' | 'claude'
  /** With Claude: the model for this lesson's ordinary turns, in place of the setting */
  claudeModel?: import('./types').ClaudeModel
  /** A learning session (teach, quiz, interview…): the session tag rules go in the system prompt */
  session?: boolean
  /** The tutor's current question type in a session, so a worked answer to a problem can be escalated */
  askType?: string
  /** A lesson's topic: for checking its problems and finding it in books you own */
  topic?: string
  /** [source-led] false when "Let the tutor explain" is chosen for this lesson; otherwise a step is taught from a source when a good one is found (shared/sourceLed) */
  sourceLed?: boolean
  /** [courses] A lesson of an imported course: its own text is what the lesson is taught from (main/courses, main/sourceLed) */
  course?: { id: string; lesson: string }
  /** A side thread under one of a lesson's outputs (shared/lessonThreads): its id. Never marked, kept apart from the lesson's own conversation, taught on the teaching model */
  thread?: string
  /** A coding lesson (shared/lessonCode): on Claude, the tutor gets the IDE's code tools on its folder. `file`: the lesson file the editor shows; `root`: a linked project's folder */
  codeLesson?: { file?: string; root?: string }
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
  /** mixed: a mock exam's paper of several question types (Practice › Mock) */
  style: 'university' | 'problems' | 'short' | 'mixed'
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
  /** progress: the tutor's report for the lesson map (its detail is the <progress/> tag), never shown as a step */
  kind: 'search_notes' | 'read_note' | 'web_search' | 'read_webpage' | 'delegate' | 'helper' | 'run_code' | 'run_sql' | 'load_table' | 'remember' | 'terminal' | 'canvas' | 'metabase' | 'save_note' | 'progress'
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

export interface NorthStarDraft {
  ns: import('./northStar').NorthStar
  note: string
  files: import('./northStar').BuildFile[]
  notePath: string
  estimate: string
  /** Hours saved by learning shared topics once, and how many there are */
  saved: number
  shared: number
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
  /** Who teaches its lessons: Tide decides (the "Who teaches" setting), the cloud model throughout, Claude, or Gemma on this Mac */
  tutor?: 'auto' | 'cloud' | 'claude' | 'gemma'
  /** A North Star track: a ready roadmap in the hidden Roadmaps folder, with no folder of its own (main/northStar) */
  virtual?: boolean
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
  /** The lesson record the answer is kept in (a lesson or a quiz): the knowledge map reads it from there */
  lesson?: string
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
  /** You: your name and picture, in Tide's app data (main/profile) */
  profile: {
    get(): Promise<import('./profile').Profile>
    set(patch: Partial<import('./profile').Profile>): Promise<import('./profile').Profile>
    /** The photo as you chose it, scaled down, for framing again */
    source(): Promise<string | null>
    setSource(dataUrl: string): Promise<void>
    clearPhoto(alsoSprite?: boolean): Promise<import('./profile').Profile>
  }
  vault: {
    choose(): Promise<string | null>
    tree(): Promise<FileNode | null>
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<void>
    /** Writes an image given as a data: URL, e.g. a photo of handwritten working */
    writeImage(path: string, dataUrl: string): Promise<void>
    /** A picture as Tide and a model can use it (an iPhone HEIC becomes a JPEG, a large photo is scaled down to 1568 px), as a data: URL; null when it isn't one */
    prepareImage(dataUrl: string): Promise<string | null>
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
  /** Python IntelliSense: the editor's link to the language server (main/pythonLanguageServer.ts) */
  /** The Code view as an IDE (shared/ide) */
  ide: import('./ide').IdeApi
  ideas: import('./ideaProject').IdeasApi
  packs: import('./trackPacks').PacksApi
  /** Jupyter notebooks and the quant lab (shared/notebook) */
  notebook: import('./notebook/api').NotebookApi
  lsp: {
    /** A JSON-RPC message for the server */
    send(msg: unknown): void
    onMessage(cb: (msg: unknown) => void): () => void
    info(): Promise<{ workspaceUri: string }>
    status(): Promise<{ state: string; pid: number | null; rssMB: number | null; documents: number; starts: number; python: string }>
    /** A library file's source for go to definition (file:// URI), or null when it may not be read */
    readFile(uri: string): Promise<string | null>
  }
  code: {
    /** Files in the vault's Code folder, newest first */
    list(): Promise<{ path: string; mtime: number }[]>
    /** Creates a file there and returns its path */
    create(name: string, content?: string): Promise<string>
  }
  terminal: {
    /** Starts a Linux lab container or a shell on this Mac */
    create(kind: 'lab' | 'local', cols: number, rows: number, cwd?: string): Promise<{ id: string }>
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
    /** The student is typing in a lesson: background model work holds off */
    typing(): Promise<void>
    cancel(id: string): Promise<void>
    /** A lesson's side thread was folded: the process it ran in (on Claude) can go */
    threadDone(lab: string): Promise<void>
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
    /** Drops the books a drafted roadmap names that can't be found, and corrects their authors */
    checkResources(md: string): Promise<string>
    /** A ready roadmap's Markdown (shared/finance/roadmaps), bundled with Tide */
    readyRoadmap(id: string): Promise<string>
    /** The finance lab's market data: what is bundled and when newer series were last fetched */
    marketStatus(): Promise<{ ready: boolean; detail: string }>
    /** Fetches this year's and last year's Treasury and ECB series into Market data/ in the notes folder */
    fetchMarketData(): Promise<{ ready: boolean; detail: string }>
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
  /** Daily mental maths (shared/mentalMaths): the log and reminder, kept in the vault under .tide/ */
  /** The maths answer box: the calculator and step checks (SymPy, no model), read-back (Haiku), paper (Opus) */
  mathsAnswer: {
    evaluate(latex: string, angle?: 'rad' | 'deg'): Promise<import('./mathsAnswer').CalcResult>
    checkSteps(lines: string[], angle?: 'rad' | 'deg'): Promise<import('./mathsAnswer').StepCheck[] | null>
    status(path?: string): Promise<{ claude: boolean; why?: string }>
    readBack(words: string, question?: string, path?: string): Promise<{ latex: string; unclear: string; by: 'claude' | 'gemma' } | null>
    readPaper(paths: string[], question?: string, path?: string): Promise<{ ok: true; lines: import('./mathsAnswer').PaperLine[]; ms: number } | { ok: false; needsClaude?: boolean; error: string }>
    mark(req: { question: string; lines: string[]; path?: string; angle?: 'rad' | 'deg' }): Promise<{ marks: import('./mathsAnswer').Marked; checks: import('./mathsAnswer').StepCheck[] | null }>
  }
  maths: {
    state(): Promise<import('./mentalMaths').MathsState>
    log(s: Pick<import('./mentalMaths').MathsSession, 'focus' | 'answers'>): Promise<import('./mentalMaths').MathsSession>
    setReminder(r: import('./mentalMaths').Reminder): Promise<import('./mentalMaths').Reminder>
    /** Why a missed answer is what it is: Claude's quick model when it teaches, else the fixed steps */
    explain(a: import('./mentalMaths').MathsAnswer): Promise<{ text: string; by: 'claude' | 'tide' }>
  }
  /** Mock interviews and exams (main/mocks, shared/mocks) */
  mocks: {
    status(): Promise<import('../main/mocks').MockStatus>
    bank(): Promise<{ id: string; title: string; tags: import('./mockBank').BankTag[]; level: number }[]>
    start(setup: import('../main/mocks').MockSetup): Promise<import('../main/mocks').MockStarted>
    /** One turn with the interviewer (Claude); the reply also streams as onEvent deltas */
    say(id: string, text: string, state: import('../main/mocks').SayState): Promise<string>
    hint(id: string, state: import('../main/mocks').SayState): Promise<{ text: string; hints: number }>
    /** The candidate's code against the hidden tests: names and outcomes only */
    test(id: string, code: string): Promise<import('../main/mocks').TestOutcome>
    answer(id: string, questionId: string, text: string): Promise<{ followUp?: string }>
    end(id: string, input: import('../main/mocks').MockEndInput): Promise<{ debrief: import('./mocks').MockDebrief; record: import('./mocks').MockRecord; fed: import('../main/mocks').MockFed }>
    cancel(id: string): Promise<void>
    stop(id: string): Promise<void>
    history(): Promise<import('./mocks').MockRecord[]>
    record(id: string): Promise<unknown>
    examTopics(): Promise<string[]>
    /** The window's work on a running mock, kept in main so it can move to another window */
    keep(id: string, state: import('./mocks').MockLiveState): Promise<boolean>
    /** A running mock taken over by this window (a pop-out, or back in the main one): null once it has ended */
    resume(id: string): Promise<{ started: import('../main/mocks').MockStarted; state: import('./mocks').MockLiveState } | null>
    onEvent(cb: (e: { id: string; delta: string }) => void): () => void
  }
  /** The morning workout (shared/workout): ratings, titles and the log, kept in the vault under .tide/ */
  workout: {
    state(): Promise<import('./workout').WorkoutState>
    logRound(r: Pick<import('./workout').RoundRecord, 'morning' | 'round' | 'championship' | 'items' | 'combo'>): Promise<{ state: import('./workout').WorkoutState; events: import('./workout').RoundEvents }>
    setReminder(r: import('./mentalMaths').Reminder): Promise<import('./mentalMaths').Reminder>
    /** The morning drills at a glance: minutes today and this week, the streak, today's score (shared/morningDrills) */
    drills(): Promise<import('./morningDrills').DrillTally>
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
  /** Claude, run through the user's own Claude Code */
  /** Gemma on demand (main/modelIdle): loaded only when a job is routed to it while Claude teaches */
  /** Report a bug from anywhere (main/bugReport): the sheet's picture and version, and filing it in Tide/Tide bugs.md */
  bugs: {
    info(): Promise<import('./bugNote').BugSheetInfo>
    /** Takes the picture of this window, then opens the sheet in it */
    open(): Promise<void>
    file(r: import('./bugNote').BugReport): Promise<{ note: string; shot: string | null; line: string }>
    discard(): Promise<void>
  }
  /** Backups of Tide's own data (main/backup): Settings › Backups */
  backups: {
    status(): Promise<import('./backup').BackupStatus>
    now(): Promise<{ snapshot: import('./backup').Snapshot; status: import('./backup').BackupStatus }>
    /** Shows the folder, or one snapshot in it, in Finder */
    reveal(name?: string): Promise<void>
    chooseFolder(): Promise<import('./backup').BackupStatus>
    defaultFolder(): Promise<import('./backup').BackupStatus>
    /** Keeps a safety snapshot, puts this one back, and starts Tide again */
    restore(name: string): Promise<{ safety: string; files: number }>
  }
  gemma: {
    status(): Promise<GemmaStatusView>
    load(): Promise<GemmaStatusView>
    /** `busy`: not unloaded, the server is answering a request */
    unload(): Promise<GemmaStatusView & { busy?: boolean }>
  }
  /** Every model call, from the usage log (main/usageLog): Settings › Usage */
  usage: {
    report(rangeDays?: number): Promise<import('./usage').UsageReport>
  }
  claude: {
    status(fresh?: boolean): Promise<ClaudeStatusView>
    /** Each Claude call in the last `days` days (default 1) */
    usage(days?: number): Promise<ClaudeUseRecord[]>
    /** Registers Tide's tools with Claude Code for the terminal (claude mcp add), or removes them */
    terminal(on: boolean): Promise<{ on: boolean; port?: number; output: string }>
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
  /** Explore later (shared/explore): things kept from lessons for short side lessons, in .tide/explore.json */
  explore: {
    list(): Promise<import('./explore').ExploreItem[]>
    add(input: import('./explore').ExploreInput): Promise<import('./explore').ExploreItem>
    update(id: string, patch: Partial<Pick<import('./explore').ExploreItem, 'title' | 'explored'>>): Promise<import('./explore').ExploreItem[]>
    remove(id: string): Promise<import('./explore').ExploreItem[]>
    onChange(cb: () => void): () => void
  }
  /** Claude's visuals (shared/visuals): where they may run, repairs and fallbacks, a lesson's kept ones, and their frames' limits */
  manim: {
    status(): Promise<{ manim: { ready: boolean; detail: string }; tex: { ready: boolean; detail: string }; settings: { narration: boolean; quality: 'low' | 'medium'; prompted: boolean } }>
    install(): Promise<{ ready: boolean; detail: string }>
    installTex(): Promise<{ ready: boolean; detail: string }>
    settings(patch: { narration?: boolean; quality?: 'low' | 'medium'; prompted?: boolean }): Promise<{ narration: boolean; quality: 'low' | 'medium'; prompted: boolean }>
    request(req: { block: string; lesson?: string; topic?: string; palette?: import('./manim').AnimPalette; quality?: import('./manim').AnimQuality }): Promise<import('./manim').AnimStatus | null>
    get(key: string): Promise<import('./manim').AnimStatus | null>
    used(key: string): Promise<boolean>
    onStatus(cb: (s: import('./manim').AnimStatus) => void): () => void
    onInstallProgress(cb: (step: string) => void): () => void
    onTexProgress(cb: (step: string) => void): () => void
  }
  visuals: {
    policy(scope: ChatScope): Promise<{ show: boolean; repair: boolean; why?: string }>
    repair(req: { code: string; errors: string[]; scope: ChatScope }): Promise<{ code: string } | null>
    fallback(req: { code: string; title: string; scope: ChatScope }): Promise<string | null>
    cached(lessonId: string): Promise<Record<string, import('./visuals').VisualRecord>>
    /** source: the visual as written, so a working explorable can join the library (main/explorables) */
    remember(lessonId: string, key: string, record: import('./visuals').VisualRecord, source?: string): Promise<boolean>
    /** Main watches this frame's process (memory, CPU) and kills it past its limits */
    watch(host: string): Promise<void>
    unwatch(host: string): Promise<void>
    /** Kill a frame's process (it stopped answering) */
    kill(host: string, reason: string): Promise<boolean>
    metrics(): Promise<{ host: string; pid: number; mb: number; cpu: number }[]>
    onKilled(cb: (e: { host: string; reason: string }) => void): () => void
  }
  /** The knowledge map: every concept with how solid it is today, what is ready next, what is fading, and retention by week */
  knowledge: {
    view(): Promise<import('./knowledge').KnowledgeView>
    /** Review now: the concept's kept questions that are due */
    review(concept: string): Promise<import('./review').ReviewSetup>
    /** One question of a review was marked: scheduled in its own store and counted on the concept */
    reviewAnswer(concept: string, item: import('./review').ReviewItem, verdict: Verdict): Promise<void>
  }
  /** How Tide is teaching you: measures from real lessons, Opus's lesson reviews, and the adjustments in the tutor's prompt (main/teaching) */
  teaching: {
    view(): Promise<import('./teachingAdjust').TeachingView>
    /** Switches an adjustment off, or back on */
    setAdjustment(id: import('./teachingAdjust').AdjustmentId, on: boolean): Promise<import('./teachingAdjust').TeachingView>
    /** Asks Opus to review one lesson now (null when it can't: no Claude, too short) */
    review(lesson: string): Promise<import('./teachingAdjust').LessonReview | null>
  }
  /** The warm-up before a lesson: quick recall cards on what it builds on (shared/warmup) */
  warmup: {
    /** path: the note or folder the lesson is on (its subject on the map) */
    for(topic: string, path?: string): Promise<import('./warmup').WarmupSet>
    /** One card was graded: scheduled in its own store and counted on its concept */
    grade(card: import('./warmup').WarmupCard, verdict: Verdict): Promise<void>
  }
  /** Free readings found for a topic; when there are none yet, they're looked up in the background */
  readings: {
    /** path: the note or folder the lesson is on */
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
    /** This week's progress for Your week, with the line kept for it (or fixed words) */
    progress(): Promise<{ progress: import('./weekProgress').WeekProgress; summary: { text: string; by: 'claude' | 'tide' } }>
    /** Claude's line on the week, written when the numbers changed; the fixed words without Claude */
    progressSummary(): Promise<{ text: string; by: 'claude' | 'tide' }>
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
  /** Goals and the week mixed across them (shared/goals, shared/portfolio, main/goals) */
  portfolio: {
    view(): Promise<import('./goals').GoalsView>
    add(g: { title: string; date?: string; weight?: import('./goals').GoalWeight }): Promise<import('./goals').PlanGoal>
    update(g: import('./goals').PlanGoal): Promise<import('./goals').GoalsView>
    remove(id: string): Promise<import('./goals').GoalsView>
    /** Opus breaks it down (again); Tide's own guess when Claude isn't there */
    decompose(id: string): Promise<import('./goals').GoalsView>
    /** A way out of a trade-off, chosen: the goal changes and the week is planned again */
    resolve(goal: string, option: import('./goals').TradeOption): Promise<{ view: import('./goals').GoalsView; week: import('./coach').WeekPlan | null }>
    /** Reshuffles the rest of the week now */
    replan(): Promise<import('./coach').WeekPlan | null>
    bringForward(date: string, index: number): Promise<import('./coach').WeekPlan | null>
  }
  /** Roadmap continuity (main/track, shared/track): a roadmap's phases and gates */
  track: {
    view(notebook: string): Promise<import('./track').TrackView | null>
    /** Move on before the gate passes; recorded */
    override(notebook: string, phase: string, note?: string): Promise<import('./track').TrackView | null>
    undoOverride(notebook: string, phase: string): Promise<import('./track').TrackView | null>
    /** The phase check: written by Opus (or waiting already); answers are never sent to the page */
    startCheck(notebook: string, phase: string, fresh?: boolean): Promise<{ questions: Omit<import('./track').CheckQuestion, 'answer'>[]; by: 'claude' | 'gemma' | 'tide' }>
    /** Marked by Opus; `needsSelf` when no model could, to be sent again with your own marks */
    submitCheck(notebook: string, phase: string, answers: Record<string, string>, selfMarks?: Record<string, 'correct' | 'partial' | 'wrong'>): Promise<import('./track').CheckResult & { needsSelf?: boolean }>
    setupCapstone(notebook: string, phase?: string): Promise<{ notebook: string } | null>
    /** Review now on the current phase's shaky concepts */
    firmUp(notebook: string): Promise<{ topic: string; scope: string; review: import('./review').ReviewSetup } | null>
    /** This week's mixed review across every track */
    mixedReview(): Promise<{ topic: string; review: import('./review').ReviewSetup; tracks: number } | null>
  }
  /** A tutor that remembers you (main/learnerProfile): the profile note, as the profile view shows it */
  northStar: {
    view(): Promise<import('../main/northStar').NorthStarView | null>
    glance(): Promise<Awaited<ReturnType<typeof import('../main/northStar').glance>>>
    suggested(): Promise<{ goal: string; hoursPerWeek: number; notePath?: string }>
    /** Opus weaves the map (minutes); nothing is written until build */
    synthesise(input: { goal: string; hoursPerWeek?: number }): Promise<NorthStarDraft>
    status(): Promise<{ running: boolean; startedAt?: number; error?: string; draft?: boolean }>
    draft(): Promise<NorthStarDraft | null>
    discard(): Promise<void>
    /** Writes new files only */
    build(): Promise<{ notePath: string; wrote: string[]; tracks: string[]; week: boolean }>
    decide(id: string, ok: boolean): Promise<import('../main/northStar').NorthStarView | null>
    review(): Promise<import('../main/northStar').NorthStarView | null>
    moveOn(): Promise<import('../main/northStar').NorthStarView | null>
    confirmDepth(topic: string, depth: number): Promise<import('../main/northStar').NorthStarView | null>
    startCapstone(): Promise<{ notebook: string } | null>
    install(): Promise<string[]>
  }
  learner: {
    view(): Promise<import('./learnerProfile').LearnerView>
    /** Brings the measured lines up to date (and makes the note if there isn't one) */
    refresh(): Promise<import('./learnerProfile').LearnerView>
    correct(section: import('./learnerProfile').SectionId, text: string, next: { text?: string; remove?: boolean; resolved?: boolean }): Promise<import('./learnerProfile').LearnerView>
    add(section: import('./learnerProfile').SectionId, text: string): Promise<import('./learnerProfile').LearnerView>
    /** The break planner's rhythm, for the pace line */
    rhythm(r: import('./learnerProfile').RhythmFacts): Promise<void>
  }
  /** Lesson prep while you're away (main/lessonPrep) */
  prep: {
    status(): Promise<import('./lessonPrep').PrepStatus>
    /** The prepared lesson's first exchange, handed over as it starts (null: start as usual) */
    opening(id: string): Promise<{ message: string; reply: string } | null>
    get(id: string): Promise<import('./lessonPrep').PreparedLesson | null>
    discard(id: string): Promise<void>
    /** Prepare now, whatever the hour (Settings' "Prepare now") */
    now(): Promise<import('./lessonPrep').PrepDecision>
    /** Writes this week's review note now; its path */
    weeklyReview(): Promise<{ path: string; by: 'claude' | 'local' }>
  }
  /** What this window is studying, for the professor in the menu bar; null when it stops */
  /** Commands from the menu bar's menu: open a view or today's item, start a focus timer */
  onTrayCommand(cb: (c: { type: 'view'; view: unknown } | { type: 'agenda'; date: string; index: number } | { type: 'focus'; minutes: number } | { type: 'remind'; title: string; body: string; view: unknown }) => void): () => void
  studying(status: { pose: import('./professorArt').ProfessorPose; label: string; since: number; until?: number } | null): Promise<void>
  windows: {
    /**
     * Opens the view in a window of its own, with nothing else on screen (shared/popout). If a
     * window already holds it, that one comes forward instead.
     */
    openFocus(view: unknown, info?: Partial<import('./popout').PopInfo>): Promise<'opened' | 'focused' | 'refused'>
    /** The view handed to this focus window, once */
    focusView(id: string): Promise<unknown>
    close(): Promise<void>
    /** Brings forward the window holding this key; false when none does */
    focusKey(key: string): Promise<boolean>
    /** What this pop-out now shows: its key and window title */
    setInfo(info: Partial<import('./popout').PopInfo>): Promise<void>
    /** Hands the view (with its state) back to the main window and closes this one */
    returnToMain(view: unknown): Promise<void>
    /** The keys other windows hold */
    held(): Promise<string[]>
    onHeld(cb: (keys: string[]) => void): () => void
    /** The main window: a pop-out handed its view back */
    onAdopt(cb: (view: unknown) => void): () => void
    /** The main window: the keys its tabs hold, so other windows bring it forward rather than open them twice */
    mainHolds(keys: string[]): Promise<void>
    /** The main window: another window asked for what one of its tabs holds; that tab comes forward */
    onShowKey(cb: (key: string) => void): () => void
    /** This pop-out is closing: save, then call closeNow */
    onClosing(cb: () => void): () => void
    closeNow(): Promise<void>
    /** A small message to every other window */
    relay(channel: string, payload: unknown): void
    onRelay(cb: (m: { channel: string; payload: unknown }) => void): () => void
    /** This window may start the break its planner decided on: false when another window just did (it follows that one) */
    claimBreak(): Promise<boolean>
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
    suggest(topic: string, limit?: number, context?: string): Promise<import('./books').ReadingSuggestion[]>
    /** The text of the section of a book you own that covers a topic, to teach a lesson from */
    passage(topic: string, context?: string): Promise<{ label: string; path: string; from: number; to: number; text: string } | null>
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
    /** Maps the connected Metabase now (read-only): writes the Your data note and, the first time, the roadmap */
    map(): Promise<{ note: string; roadmap: string; collections: number; dashboards: number }>
    /** The last map, in brief: when, what, and the dashboards people use (null before the first) */
    mapInfo(): Promise<{ at: number; host: string; collections: { name: string; count?: number; kind: string }[]; dashboards: { id: number; name: string; cards: number; views?: number }[]; note: string; roadmap: string; notebook: string } | null>
    /** What the tutor reads of the Metabase page open in the web view ('' when it isn't one) */
    screen(): Promise<{ text: string; label: string; url: string } | null>
  }
  voice: {
    status(): Promise<{ ready: boolean; detail: string }>
    setup(): Promise<{ ready: boolean; detail: string }>
    speak(text: string, voice?: string, speed?: number): Promise<Uint8Array>
    /** where: the lesson's note and topic (the topic helps Deepgram spell its jargon) */
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
    /** The same lab's Postgres database (the Postgres pack), in session A or B */
    pgQuery(id: string, sql: string, session?: string): Promise<import('./lab').LabResult & { session: string; transaction: 'idle' | 'open' | 'failed' }>
    pgReset(id: string): Promise<void>
  }
  /** Guided projects (shared/workshop.ts): built in stages, reviewed against tests */
  /** Videos (main/videos.ts, shared/video.ts): transcripts kept for YouTube videos and videos of your own, and the sections a lesson offers */
  videos: {
    /** A YouTube video's transcript: kept, else read from its saved note (`path`), else (with `fetch`) its captions from YouTube */
    transcript(id: string, opts?: { path?: string; fetch?: boolean; course?: string; title?: string }): Promise<import('../main/videos').TranscriptResult>
    /** A video file in the notes folder: its captions from a .vtt or .srt beside it */
    fileTranscript(path: string): Promise<import('./video').Transcript | null>
    /** Sections of kept transcripts that cover a topic, best first */
    clips(topic: string, opts?: { limit?: number; recap?: boolean }): Promise<import('./video').ClipCandidate[]>
    /** A clip's times checked against the real transcript */
    check(clip: import('./video').Clip): Promise<import('./video').ClipCheck & { title?: string; channel?: string; course?: string }>
  }
  /** Open courses from GitHub (main/courses.ts, shared/courses.ts) */
  courses: {
    list(): Promise<import('../main/courses').CourseCard[]>
    get(id: string): Promise<import('../main/courses').CourseDetail | null>
    /** Fetches it into Tide's app data, reads it as a course and indexes it */
    import(id: string): Promise<import('../main/courses').Imported>
    /** git pull (or a fresh download), then reads it again */
    update(id: string): Promise<import('../main/courses').Imported>
    remove(id: string): Promise<void>
    lesson(id: string, lesson: string): Promise<import('../main/courses').LessonContent | null>
    file(id: string, path: string): Promise<string | null>
    mark(id: string, lesson: string, done: boolean): Promise<import('./courses').CourseProgress>
    search(q: string): Promise<{ course: string; path: string; title: string; heading: string; text: string; score: number }[]>
    /** Copies its lessons into your notes folder, under Courses/ */
    saveToNotes(id: string): Promise<{ folder: string; files: number }>
    /** The course's README from GitHub, to look at before importing it (not saved) */
    preview(id: string): Promise<{ markdown: string; url: string } | null>
    /** How far a lesson was read, a video of it watched, or its code run: kept with its progress, and felt in What you know */
    track(id: string, lesson: string, patch: { read?: number; video?: { id: string; watched: number }; ran?: boolean }): Promise<import('./courses').CourseProgress>
    onProgress(cb: (e: import('../main/courses').ImportPhase) => void): () => void
    /** The weekly check that keeps the catalogue fresh: when it last ran, its steps and its log */
    fresh(): Promise<import('../main/courseFresh').FreshStatus>
    /** Runs the check now (it suggests; it never imports) */
    checkNow(): Promise<import('../main/freshJob').FreshResult>
    /** A suggestion you don't want: gone, and never suggested again */
    dismiss(id: string): Promise<void>
    onFresh(cb: (e: { running: boolean; steps: import('../main/courseFresh').FreshStatus['steps'] }) => void): () => void
  }
  /** Courses in the plan, and quizzes from the course you're taking (main/coursePlan, main/courseQuiz) */
  coursePlan: {
    /** This week's course(s) from the plan: the lessons, why, how far along */
    thisWeek(): Promise<import('../main/coursePlan').CourseWeekView[]>
    /** Every imported course aligned to your roadmaps (Haiku once each, kept) */
    alignAll(): Promise<import('./coursePlan').CourseAlignment[]>
    /** Writes a check (one lesson, three questions) or a quiz (what you studied) from the course's own passages */
    startQuiz(input: { course: string; lessons?: string[]; kind?: 'check' | 'quiz'; size?: number }): Promise<import('../main/courseQuiz').QuizStart>
    /** Marked by Opus; `needsSelf` when no model could, to be sent again with your own marks */
    submitQuiz(id: string, answers: Record<string, string>, selfMarks?: Record<string, 'correct' | 'partial' | 'wrong'>): Promise<import('../main/courseQuiz').QuizResult>
    /** The last check on a lesson, if it was checked */
    checked(course: string, lesson: string): Promise<{ score: number; total: number; passed: boolean; at: number } | null>
  }
  /** Links that stay in Tide (shared/links) */
  links: {
    courseFile(id: string, path: string): Promise<import('../main/courseFiles').RepoFileView | null>
    githubFile(repo: string, ref: string, path: string): Promise<import('../main/courseFiles').RepoFileView | null>
    repoPdf(src: { course: string } | { repo: string; ref: string }, path: string): Promise<Uint8Array | null>
    /** A web page in Tide's reader view */
    read(url: string, fresh?: boolean): Promise<import('../main/linkReader').ReadPage>
    pdf(url: string): Promise<Uint8Array | null>
    /** The imported courses' repositories, for routing links */
    repos(): Promise<import('./links').CourseRepo[]>
    /** Other courses' sections and video moments on a topic */
    related(topic: string, opts?: { exclude?: string; limit?: number }): Promise<import('./related').Related>
    /** The tutor moved the view (show_in_view): a video's moment, or a section of the page */
    onGoto(cb: (g: { t?: number; section?: string; video?: string }) => void): () => void
  }
  /** Tide's sandboxed web view (main/webView) */
  web: {
    open(url: string, bounds: { x: number; y: number; width: number; height: number }): Promise<import('../main/webView').WebState | null>
    place(bounds: { x: number; y: number; width: number; height: number }, visible?: boolean): Promise<void>
    go(action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void>
    close(): Promise<void>
    onState(cb: (s: import('../main/webView').WebState) => void): () => void
  }
  workshop: {
    list(): Promise<import('./workshop').WorkshopCard[]>
    /** Starts a project, or returns it as it stands when already started */
    start(id: string, from?: { notebook?: string; topic?: string }): Promise<import('./workshop').WorkshopState>
    state(id: string): Promise<import('./workshop').WorkshopState | null>
    /** Runs the current stage's tests (and every earlier stage's) in the sandbox */
    run(id: string): Promise<import('./workshop').WorkshopState>
    hint(id: string): Promise<import('./workshop').WorkshopState>
    /** The tutor's review of the latest run of the stage in hand, or of a stage already passed */
    review(id: string, stage?: number): Promise<import('./workshop').WorkshopState>
    ask(id: string, question: string): Promise<{ answer: string; by: 'cloud' | 'local' | 'none' }>
    /** The project already written for a roadmap's "Project:" item, if any */
    forTopic(topic: string): Promise<import('./workshop').WorkshopCard | null>
    /** The id of the project started in this folder of the notes folder, if any */
    forFolder(folder: string): Promise<string | null>
    /** Has the stronger model design a project for a roadmap item; kept only if Tide can prove it */
    propose(o: { topic: string; notebook?: string; section?: string }): Promise<{ card: import('./workshop').WorkshopCard | null; tries: number; problems: string[] }>
    /** The editor the project opens in (main/workshopWatch.ts), or null when none is installed */
    editor(id: string): Promise<{ id: import('./editor').EditorId; name: string } | null>
    openEditor(id: string): Promise<{ id: import('./editor').EditorId; name: string }>
    /** Runs the stage's tests whenever a source file in the project's folder is saved, while the screen is open */
    watch(id: string): Promise<boolean>
    unwatch(id: string): Promise<void>
    onWatch(cb: (e: import('./editor').WatchEvent) => void): () => void
  }
  /** The code editors found on this Mac (main/editors.ts) */
  editors: {
    list(): Promise<import('./editor').InstalledEditor[]>
  }
  difficulty: {
    /** What the knowledge map has on a lesson's topic and what it builds on (shared/difficulty.ts) */
    known(topic: string): Promise<import('./difficulty').Known>
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
  /** The reading room (Library › Reading, src/main/readingRoom) */
  room: RoomApi
  /** A cover banner for any note (shared/noteCover), from public-domain art or your own image */
  covers: {
    search(q: string): Promise<import('./noteCover').Artwork[]>
    art(notePath: string, art: import('./noteCover').Artwork): Promise<import('./noteCover').NoteCover>
    /** A picker thumbnail as a data URL (fetched in the main process) */
    thumb(url: string): Promise<string | null>
    own(notePath: string): Promise<import('./noteCover').NoteCover | null>
    y(notePath: string, y: number): Promise<void>
    remove(notePath: string): Promise<string>
    icon(notePath: string, icon: string | null): Promise<void>
  }
  /** Reading aloud: pluggable speech engines and their audio cache (src/main/tts) */
  tts: {
    engines(): Promise<import('./speech').TtsEngineInfo[]>
    synth(engine: string, text: string, voice: string, speed: number): Promise<Uint8Array>
    prerender(job: { key: string; engine: string; voice: string; speed: number; pieces: { text: string; voice: string }[] }): Promise<{ queued: boolean; reason?: string }>
    cachedCount(engine: string, speed: number, pieces: { text: string; voice: string }[]): Promise<number>
  }
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

// ---------- the reading room (src/main/readingRoom) ----------

export interface RoomApi {
  shelf(): Promise<{ room: import('./readingRoom').RoomState; week: number }>
  tonight(): Promise<(import('./readingRoom').Tonight & { book: import('./readingRoom').ShelfBook; week: number; goal: number }) | null>
  book(path: string): Promise<{ title: string; author?: string; kind: import('./readingRoom').BookKind; chapters: import('./readingRoom').ReaderChapter[]; subjects: string[]; narrative: boolean }>
  add(path: string): Promise<import('./readingRoom').ShelfBook>
  addFree(book: import('./freeBooks').FreeBook): Promise<import('./readingRoom').ShelfBook>
  import(): Promise<import('./readingRoom').ShelfBook[]>
  remove(path: string): Promise<import('./readingRoom').RoomState>
  patch(path: string, p: { voice?: import('./readingRoom').BookVoice; finished?: string | null; current?: boolean }): Promise<import('./readingRoom').RoomState>
  goal(weeklyMinutes: number): Promise<import('./readingRoom').RoomState>
  progress(path: string, p: { loc: import('./passage').PassageLoc; progress: number; label?: string; where?: string; chapterLeft?: number }): Promise<void>
  time(path: string, seconds: number, wordsRead?: number): Promise<void>
  marks(path: string): Promise<import('./readingRoom').Mark[]>
  saveMark(path: string, m: import('./readingRoom').Mark): Promise<import('./readingRoom').Mark[]>
  removeMark(path: string, id: string): Promise<import('./readingRoom').Mark[]>
  page(path: string): Promise<string>
  pageInfo(pagePath: string): Promise<{ book: string; author?: string; chapter?: string; progress?: number; quotes: number; notes: number; started?: string } | null>
  talks(path: string): Promise<import('./readingTalk').Talk[]>
  who(path: string): Promise<'claude' | 'gemma'>
  challenge(req: { path: string; passage: string; loc?: import('./passage').PassageLoc; chapter?: string; id?: string; said?: string }): Promise<import('./readingTalk').Talk>
  argument(req: { path: string; passage?: string; loc?: import('./passage').PassageLoc; chapter?: string }): Promise<{ steps: string[]; added: number; note: string; talk: import('./readingTalk').Talk; who: 'claude' | 'gemma' }>
  keepTalk(path: string, id: string): Promise<string>
  seminarTurn(req: { path: string; chapter: number; stage: Exclude<import('./readingTalk').SeminarStage, 'keep'>; turns: import('./readingTalk').TalkTurn[]; said: string }): Promise<string>
  seminarKeep(req: { path: string; chapter: number; turns: import('./readingTalk').TalkTurn[] }): Promise<import('./readingTalk').KeepItem[]>
  seminarSave(req: { path: string; chapter: number; items: import('./readingTalk').KeepItem[]; turns: import('./readingTalk').TalkTurn[] }): Promise<{ quotes: number; ideas: number; recall: number }>
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
