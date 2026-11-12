/**
 * Gemma on demand. Claude teaches; Gemma (about 10 GB of a 24 GB Mac while loaded) is loaded only
 * when a job is actually routed to it: something private (a private project, Metabase), Claude not
 * set up, logged out, at its plan's limit, offline, a Claude call that failed, or Gemma picked by
 * hand. Pure rules here; main/modelIdle and main/ai (completeFor) apply them.
 */
import type { ClaudeRole } from './types'

/**
 * Every job that used to run on Gemma while Claude was teaching, and where it goes now. `role` is
 * the Claude model's role (shared/claude: background → Haiku, teach → Sonnet, mark and hard →
 * Opus); null keeps the job on Gemma (it only exists on Gemma's own turns, or needs what only
 * Gemma has here). `privacy` says how a job knows it must stay on the Mac.
 */
export const JOB_ROUTES = {
  flashcards: { label: 'Flashcards from a note or chapter', role: 'teach', privacy: 'path' },
  labCards: { label: 'Flashcards from lab commands', role: 'background', privacy: 'none' },
  marginNote: { label: 'Margin tutor and writing coach', role: 'background', privacy: 'path' },
  marginQuestion: { label: 'Margin tutor “test me” question', role: 'teach', privacy: 'path' },
  dailyMark: { label: 'Daily practice marking', role: 'mark', privacy: 'path' },
  tieBreak: { label: 'Choosing how to teach a topic', role: 'background', privacy: 'none' },
  examPaper: { label: 'Writing a practice exam', role: 'teach', privacy: 'scope' },
  examMark: { label: 'Marking a typed exam answer', role: 'mark', privacy: 'scope' },
  bookContents: { label: 'A book’s chapters from its contents page', role: 'background', privacy: 'path' },
  readingPicks: { label: 'Picking reading for what you studied', role: 'background', privacy: 'text' },
  projectMap: { label: 'A project’s map and flows', role: 'background', privacy: 'path' },
  projectBrief: { label: 'A project’s build brief', role: 'teach', privacy: 'path' },
  companyPrep: { label: 'Interview prep plan', role: 'teach', privacy: 'path' },
  readAlong: { label: 'Discussing a passage you’re reading', role: 'teach', privacy: 'path' },
  readTogether: { label: 'Reading a book together', role: 'teach', privacy: 'path' },
  weekPlan: { label: 'Weekly coach plan', role: 'teach', privacy: 'text' },
  learnerProfile: { label: 'Learner profile and direction', role: 'background', privacy: 'text' },
  // A tutor that remembers you (main/learnerProfile): small changes after each lesson, a tidy each week
  profileUpdate: { label: 'Updating your learner profile after a lesson', role: 'background', privacy: 'text' },
  profileWeekly: { label: 'Weekly tidy of your learner profile', role: 'hard', privacy: 'text' },
  // Lesson prep while you're away (main/lessonPrep): Claude only; without it the prep is what code can gather
  lessonPrep: { label: 'Preparing your next lesson', role: 'hard', privacy: 'text' },
  prepExercises: { label: 'Exercises and the opening for your next lesson', role: 'teach', privacy: 'text' },
  weeklyReview: { label: 'Your weekly review', role: 'hard', privacy: 'text' },
  // Opus reviewing a finished lesson against the teaching rubric (main/teaching): Claude only, never Gemma
  lessonReview: { label: 'Reviewing a finished lesson', role: 'mark', privacy: 'scope' },
  curriculum: { label: 'Sorting roadmaps, enriching topics, readings', role: 'background', privacy: 'flag' },
  workshop: { label: 'Guided project review', role: 'teach', privacy: 'flag' },
  // Pictures go to Claude too (main/imagePrep makes them ready): a photo of handwritten maths is marked by the marking model
  handwriting: { label: 'Marking photos of handwritten working', role: 'mark', privacy: 'scope' },
  // Only on Gemma's own lessons (Claude runs its own checks): they stay where they are
  lessonChecks: { label: 'Gemma lesson checks, problem bank, hidden tests, read-back', role: null, privacy: 'none' }
} as const satisfies Record<string, { label: string; role: ClaudeRole | null; privacy: 'none' | 'path' | 'scope' | 'text' | 'flag' }>

export type JobName = keyof typeof JOB_ROUTES

/** Why Gemma is (or was last) needed */
export type GemmaReason = 'private' | 'metabase' | 'no-claude' | 'logged-out' | 'limit' | 'offline' | 'claude-failed' | 'picked' | 'gemma-only' | 'manual'

export type Route = { who: 'claude'; role: ClaudeRole } | { who: 'gemma'; reason: GemmaReason }

export interface ClaudeState {
  /** Claude is the main tutor right now: set up, logged in, not at its limit, online, and chosen */
  main: boolean
  /** Why not, as a reason */
  why?: GemmaReason
}

/** Where a job goes: Claude on its role's model, unless the job is private, Claude can't, or it's Gemma's alone */
export function routeJob(job: JobName, o: { private?: boolean; metabase?: boolean; claude: ClaudeState; picked?: 'gemma' }): Route {
  const role = JOB_ROUTES[job].role
  if (o.metabase) return { who: 'gemma', reason: 'metabase' }
  if (o.private) return { who: 'gemma', reason: 'private' }
  if (o.picked === 'gemma') return { who: 'gemma', reason: 'picked' }
  if (!role) return { who: 'gemma', reason: 'gemma-only' }
  if (!o.claude.main) return { who: 'gemma', reason: o.claude.why ?? 'no-claude' }
  return { who: 'claude', role }
}

/** Claude's "not ready" words (main/claudeEngine claudeReady) as a reason */
export function reasonFromWhy(why: string | undefined): GemmaReason {
  const w = why ?? ''
  if (/offline|network|connect/i.test(w)) return 'offline'
  if (/limit/i.test(w)) return 'limit'
  if (/log/i.test(w)) return 'logged-out'
  if (/install/i.test(w)) return 'no-claude'
  if (/private/i.test(w)) return 'private'
  return 'claude-failed'
}

/**
 * Minutes Gemma may sit unused before it is unloaded. The setting (default 15, 0 = never) still
 * rules; while Claude is the main tutor Gemma goes sooner (5 minutes unless set), never later
 * than the setting says.
 */
export function gemmaIdleMinutes(o: { unloadAfterMinutes?: number; withClaudeMinutes?: number; claudeMain: boolean }): number {
  const base = o.unloadAfterMinutes ?? 15
  if (!base) return 0
  if (!o.claudeMain) return base
  const short = o.withClaudeMinutes ?? 5
  return short > 0 ? Math.min(base, short) : base
}

/**
 * Whether Tide should load Gemma ahead of being asked (at launch, on focus, after sleep, each
 * minute's check): always when Claude isn't the main tutor (as before), and otherwise only while
 * a job needed Gemma recently (a private notebook, Claude at its limit).
 */
export function shouldWarmGemma(o: { claudeMain: boolean; demandAt?: number; now: number; idleMinutes: number }): boolean {
  if (!o.claudeMain) return true
  if (!o.demandAt) return false
  return !o.idleMinutes || o.now - o.demandAt < o.idleMinutes * 60_000
}

/** Nobody has used the server for this long: safe to unload at launch */
export const LAUNCH_IDLE_MS = 2 * 60_000

/**
 * Once at launch: give the 10 GB back when Gemma is loaded, Claude is teaching, and nobody else
 * is using the server (another copy of Tide, a script). Unknown idleness counts as in use.
 */
export function unloadAtLaunch(o: { claudeMain: boolean; loaded: boolean; idle: { ms: number } | null; keepLoaded?: boolean }): boolean {
  if (o.keepLoaded || !o.claudeMain || !o.loaded || !o.idle) return false
  return o.idle.ms >= LAUNCH_IDLE_MS
}

const FOR: Record<GemmaReason, string> = {
  private: 'your private notebook',
  metabase: 'your Metabase lesson',
  'no-claude': 'teaching (Claude Code isn’t set up)',
  'logged-out': 'teaching while Claude is logged out',
  limit: 'teaching while Claude is at its limit',
  offline: 'teaching while you’re offline',
  'claude-failed': 'a job Claude couldn’t take',
  picked: 'the lesson you chose it for',
  'gemma-only': 'a Gemma lesson',
  manual: 'you (loaded by hand)'
}

export const reasonText = (r: GemmaReason) => FOR[r]

/** The words Settings shows about Gemma */
export function gemmaStatusLine(o: { loaded: boolean | null; claudeMain: boolean; reason?: GemmaReason; idleMinutes: number; serverUp?: boolean }): string {
  const unloads = o.idleMinutes ? `unloads after ${o.idleMinutes} min unused` : 'stays loaded (Free its memory when idle is set to Never)'
  if (o.loaded === null) return o.serverUp === false ? (o.claudeMain ? 'Gemma: not running. Claude is teaching. The server starts when a private notebook or offline lesson needs it.' : 'Gemma: the server isn’t running.') : 'Gemma: can’t tell whether it’s loaded (only an mlx-vlm server on this Mac says).'
  if (!o.loaded) {
    return o.claudeMain
      ? 'Gemma: not loaded. Claude is teaching. It loads when a private notebook or offline lesson needs it.'
      : `Gemma: not loaded. It loads when you next ask it something${o.reason ? `, for ${reasonText(o.reason)}` : ''}.`
  }
  if (o.reason) return `Gemma: loaded for ${reasonText(o.reason)}, ${unloads}.`
  return o.claudeMain ? `Gemma: loaded, though Claude is teaching; ${unloads}.` : `Gemma: loaded and teaching; ${unloads}.`
}

/** The small note a lesson shows when Gemma takes over and isn't loaded yet */
export function takeoverNote(o: { why: string; loaded: boolean }): string {
  return `${o.why}${o.loaded ? '' : ', about 5 s to load'}`
}
