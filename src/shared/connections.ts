/**
 * Every service Tide connects to, in one place: what it's for, where it runs (on this Mac or in
 * the cloud), what it costs, and what's allowed to reach it. The Connections page lists them with
 * their status and use; new ones are added here (and, for a model provider, in shared/providers).
 */

export type ConnectionKind = 'model' | 'search' | 'reader' | 'voice' | 'tasks' | 'data' | 'tools'

export type ConnectionState = 'connected' | 'ready' | 'needs-key' | 'not-set-up' | 'off' | 'resting' | 'error'

export interface ConnectionInfo {
  id: string
  name: string
  kind: ConnectionKind
  /** Where the work happens */
  runs: 'mac' | 'cloud'
  /** What Tide uses it for, in a few words each */
  usedFor: string[]
  /** The free allowance, as the provider states it */
  free?: string
  /** Where to get a key */
  keyUrl?: string
  /** What may be sent to it */
  privacy?: string
  /** The Settings section that manages it */
  section: string
}

/** A connection as the Connections page shows it */
export interface Connection extends ConnectionInfo {
  state: ConnectionState
  /** One line on the state: the model loaded, the key missing, why it's resting */
  detail: string
  /** It's on: chosen, or used when needed (keyed or keyless) */
  active: boolean
  lastUsed?: number
  /** Today, so far */
  today?: { requests: number; tokens?: number }
  /** The day's allowance, when it has one: 0 to 1 used */
  dayShare?: number
  /** A credit or monthly allowance instead: what's used of it, 0 to 1, and how to say it */
  credit?: { share: number; label: string }
  /** Uses on each of the last seven days, oldest first */
  week?: number[]
  /** Limits and costs, as label and value */
  limits?: [string, string][]
  /** For a model provider: the model a test uses */
  model?: string
}

export const KIND_LABEL: Record<ConnectionKind, string> = {
  model: 'Models',
  search: 'Web search',
  reader: 'Reading the web',
  voice: 'Voice',
  tasks: 'Tasks',
  data: 'Your data',
  tools: 'Tools on this Mac'
}

const PUBLIC_ONLY = 'Public text only: nothing from a private project or your Metabase.'

/** Services that aren't model providers (those come from shared/providers), known to Tide */
export const SERVICES: ConnectionInfo[] = [
  { id: 'claude', name: 'Claude (your plan)', kind: 'model', runs: 'cloud', usedFor: ['Lessons', 'Chat', 'Marking'], free: 'Your Claude plan, through Claude Code: no API key', privacy: 'Never sees a private project or your Metabase: those stay with Gemma.', section: 'models' },
  { id: 'local-model', name: 'Gemma on this Mac', kind: 'model', runs: 'mac', usedFor: ['Lessons', 'Chat', 'Marking', 'Notes'], free: 'Free: runs on your Mac', section: 'models' },
  { id: 'wikipedia', name: 'Wikipedia', kind: 'search', runs: 'cloud', usedFor: ['Web search', 'Readings'], free: 'Free, no key', privacy: PUBLIC_ONLY, section: 'tools' },
  { id: 'searxng', name: 'SearXNG on this Mac', kind: 'search', runs: 'mac', usedFor: ['Private web search'], free: 'Free: runs in Docker on your Mac', section: 'tools' },
  { id: 'brave', name: 'Brave Search', kind: 'search', runs: 'cloud', usedFor: ['Web search'], keyUrl: 'https://api-dashboard.search.brave.com', privacy: PUBLIC_ONLY, section: 'tools' },
  { id: 'tavily', name: 'Tavily', kind: 'search', runs: 'cloud', usedFor: ['Web search'], free: '1,000 searches a month', keyUrl: 'https://app.tavily.com', privacy: PUBLIC_ONLY, section: 'tools' },
  { id: 'you', name: 'You.com', kind: 'search', runs: 'cloud', usedFor: ['Web search'], free: '$100 one-time credit, about 20,000 searches; Tide stops at $90', keyUrl: 'https://you.com/platform/api-keys', privacy: PUBLIC_ONLY, section: 'tools' },
  { id: 'firecrawl', name: 'Firecrawl', kind: 'reader', runs: 'cloud', usedFor: ['Reading web pages', 'Lesson sources', 'Library saves'], free: '1,000 pages a month', keyUrl: 'https://www.firecrawl.dev/app/api-keys', privacy: 'Public web addresses only, never your notes.', section: 'connections' },
  { id: 'arxiv', name: 'arXiv', kind: 'reader', runs: 'cloud', usedFor: ['Papers for readings'], free: 'Free, no key', privacy: PUBLIC_ONLY, section: 'connections' },
  { id: 'openlibrary', name: 'Open Library', kind: 'reader', runs: 'cloud', usedFor: ['Checking books exist'], free: 'Free, no key', privacy: PUBLIC_ONLY, section: 'connections' },
  { id: 'voice', name: 'Kokoro and Parakeet', kind: 'voice', runs: 'mac', usedFor: ['The tutor’s voice', 'Dictation'], free: 'Free: runs on your Mac', section: 'tutor' },
  { id: 'deepgram', name: 'Deepgram', kind: 'voice', runs: 'cloud', usedFor: ['Dictation'], free: '$200 credit', keyUrl: 'https://console.deepgram.com', privacy: 'Not for private projects or Metabase lessons: those use Parakeet.', section: 'tutor' },
  { id: 'flow', name: 'Wispr Flow', kind: 'voice', runs: 'cloud', usedFor: ['Dictation', 'Hands-free talk'], free: 'Your Pro plan', privacy: 'Flow sends speech to its own service; Tide can’t keep it on this Mac.', section: 'tutor' },
  { id: 'handy', name: 'Handy', kind: 'voice', runs: 'mac', usedFor: ['Dictation'], free: 'Free: runs on your Mac', section: 'tutor' },
  { id: 'things', name: 'Things 4', kind: 'tasks', runs: 'mac', usedFor: ['Your week as to-dos', 'Ticking off'], free: 'Your Things app', section: 'tools' },
  { id: 'metabase', name: 'Metabase', kind: 'data', runs: 'cloud', usedFor: ['Learning your data', 'Read-only queries'], privacy: 'Answered by Gemma on this Mac only, never a cloud model.', section: 'tools' },
  { id: 'study-api', name: 'Study data API', kind: 'data', runs: 'mac', usedFor: ['Your study time, for other apps'], free: 'On this Mac', section: 'tools' },
  { id: 'maths', name: 'SymPy maths checker', kind: 'tools', runs: 'mac', usedFor: ['Checking answers exactly'], free: 'Free: runs on your Mac', section: 'tools' },
  { id: 'libraries', name: 'Data libraries', kind: 'tools', runs: 'mac', usedFor: ['NumPy, pandas, plots in code'], free: 'Free: runs on your Mac', section: 'tools' },
  { id: 'lab', name: 'Lab pack', kind: 'tools', runs: 'mac', usedFor: ['PyTorch, scikit-learn, SciPy in code', 'Hidden tests with pytest', 'HTTP and async lessons'], free: 'Free: runs on your Mac', section: 'tools' }
]

export const serviceInfo = (id: string) => SERVICES.find((s) => s.id === id)

/** "2 minutes ago", "yesterday", "3 Nov" */
export function whenUsed(ms: number | undefined, now = Date.now()): string {
  if (!ms) return 'Not used yet'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  if (s < 2 * 86_400) return 'Yesterday'
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)} days ago`
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
