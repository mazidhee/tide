/**
 * Gemma on demand. Claude teaches; Gemma (about 10 GB of a 24 GB Mac while loaded) is loaded only
 * when a job is actually routed to it: Claude not set up, logged out, at its plan's limit, offline,
 * a Claude call that failed or hung, or Gemma picked by hand. Everything else goes to Claude. Pure rules here; main/modelIdle and main/ai (completeFor) apply them.
 */
import type { ClaudeRole } from './types'

/**
 * Every job that used to run on Gemma while Claude was teaching, and where it goes now. `role` is
 * the Claude model's role (shared/claude: background → Haiku, teach → Sonnet, mark and hard →
 * Opus); null keeps the job on Gemma (it only exists on Gemma's own turns, or needs what only
 * Gemma has here).
 */
export const JOB_ROUTES = {
  // Maths answers (main/mathsAnswers): the read-back, a photo of working, and line-by-line marks
  mathsReadBack: { label: 'Reading back maths you said or typed', role: 'background' },
  paperRead: { label: 'Reading handwritten working from a photo', role: 'mark' },
  workingMark: { label: 'Marking maths working line by line', role: 'mark' },
  flashcards: { label: 'Flashcards from a note or chapter', role: 'teach' },
  labCards: { label: 'Flashcards from lab commands', role: 'background' },
  marginNote: { label: 'Margin tutor and writing coach', role: 'background' },
  marginQuestion: { label: 'Margin tutor “test me” question', role: 'teach' },
  dailyMark: { label: 'Daily practice marking', role: 'mark' },
  tieBreak: { label: 'Choosing how to teach a topic', role: 'background' },
  examPaper: { label: 'Writing a practice exam', role: 'teach' },
  examMark: { label: 'Marking a typed exam answer', role: 'mark' },
  bookContents: { label: 'A book’s chapters from its contents page', role: 'background' },
  readingPicks: { label: 'Picking reading for what you studied', role: 'background' },
  projectMap: { label: 'A project’s map and flows', role: 'background' },
  projectBrief: { label: 'A project’s build brief', role: 'teach' },
  // Projects from an idea (main/ideaProjects): Opus asks and plans
  projectQuestions: { label: 'Questions about a project idea', role: 'hard' },
  projectPlan: { label: 'Planning a project from an idea', role: 'hard' },
  projectMentor: { label: 'Reviewing a project you’re building', role: 'hard' },
  projectReady: { label: 'A project milestone’s ready check', role: 'hard' },
  projectReadyMark: { label: 'Marking a ready check', role: 'mark' },
  projectDebrief: { label: 'A milestone’s debrief', role: 'hard' },
  projectIdeas: { label: 'Suggesting your next project', role: 'teach' },
  companyPrep: { label: 'Interview prep plan', role: 'teach' },
  readAlong: { label: 'Discussing a passage you’re reading', role: 'teach' },
  readTogether: { label: 'Reading a book together', role: 'teach' },
  // The reading room (main/readingRoom)
  readChallenge: { label: 'Challenge me, beside a book', role: 'teach' },
  readArgument: { label: 'Mapping a book’s core argument', role: 'hard' },
  readSeminar: { label: 'End-of-chapter seminar', role: 'teach' },
  readKeep: { label: 'What to keep from a seminar', role: 'background' },
  weekPlan: { label: 'Weekly coach plan', role: 'teach' },
  // Goals and the week mixed across them (main/goals): Opus breaks a goal down and explains the mix; the numbers are code's
  goalPlan: { label: 'Breaking a goal down into what it needs', role: 'hard' },
  weekMix: { label: 'Explaining the week’s mix across your goals', role: 'hard' },
  learnerProfile: { label: 'Learner profile and direction', role: 'background' },
  // A tutor that remembers you (main/learnerProfile): small changes after each lesson, a tidy each week
  profileUpdate: { label: 'Updating your learner profile after a lesson', role: 'background' },
  profileWeekly: { label: 'Weekly tidy of your learner profile', role: 'hard' },
  // Lesson prep while you're away (main/lessonPrep): Claude only; without it the prep is what code can gather
  lessonPrep: { label: 'Preparing your next lesson', role: 'hard' },
  prepExercises: { label: 'Exercises and the opening for your next lesson', role: 'teach' },
  weeklyReview: { label: 'Your weekly review', role: 'hard' },
  // This week's progress in Your week (main/weekProgress): one line, Claude only; without it, fixed words
  weekProgress: { label: 'A line on this week’s progress', role: 'background' },
  // Opus reviewing a finished lesson against the teaching rubric (main/teaching): Claude only, never Gemma
  lessonReview: { label: 'Reviewing a finished lesson', role: 'mark' },
  curriculum: { label: 'Sorting roadmaps, enriching topics, readings', role: 'background' },
  workshop: { label: 'Guided project review', role: 'teach' },
  // Pictures go to Claude too (main/imagePrep makes them ready): a photo of handwritten maths is marked by the marking model
  handwriting: { label: 'Marking photos of handwritten working', role: 'mark' },
  // Mock interviews (main/mocks): Sonnet is the interviewer, Opus marks. Neither falls back to Gemma: without
  // Claude the mock runs with no interviewer and is marked in code
  mockInterviewer: { label: 'Mock interviewer', role: 'teach' },
  mockMark: { label: 'Marking a mock interview', role: 'mark' },
  // Only on Gemma's own lessons (Claude runs its own checks): they stay where they are
  lessonChecks: { label: 'Gemma lesson checks, problem bank, hidden tests, read-back', role: null }
} as const satisfies Record<string, { label: string; role: ClaudeRole | null }>

export type JobName = keyof typeof JOB_ROUTES

/** Why Gemma is (or was last) needed */
export type GemmaReason = 'no-claude' | 'logged-out' | 'limit' | 'offline' | 'claude-failed' | 'picked' | 'gemma-only' | 'manual'

export type Route = { who: 'claude'; role: ClaudeRole } | { who: 'gemma'; reason: GemmaReason }

export interface ClaudeState {
  /** Claude is the main tutor right now: set up, logged in, not at its limit, online, and chosen */
  main: boolean
  /** Why not, as a reason */
  why?: GemmaReason
}

/** Where a job goes: Claude on its role's model, unless Gemma was picked, Claude can't, or it's Gemma's alone */
export function routeJob(job: JobName, o: { claude: ClaudeState; picked?: 'gemma' }): Route {
  const role = JOB_ROUTES[job].role
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
 * a job needed Gemma recently (Claude at its limit, offline, or Gemma picked).
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
  if (o.loaded === null) return o.serverUp === false ? (o.claudeMain ? 'Gemma: not running. Claude is teaching. The server starts when Claude can’t answer or you pick Gemma.' : 'Gemma: the server isn’t running.') : 'Gemma: can’t tell whether it’s loaded (only an mlx-vlm server on this Mac says).'
  if (!o.loaded) {
    return o.claudeMain
      ? 'Gemma: not loaded. Claude is teaching. It loads when Claude can’t answer or you pick Gemma.'
      : `Gemma: not loaded. It loads when you next ask it something${o.reason ? `, for ${reasonText(o.reason)}` : ''}.`
  }
  if (o.reason) return `Gemma: loaded for ${reasonText(o.reason)}, ${unloads}.`
  return o.claudeMain ? `Gemma: loaded, though Claude is teaching; ${unloads}.` : `Gemma: loaded and teaching; ${unloads}.`
}

/** The small note a lesson shows when Gemma takes over and isn't loaded yet */
export function takeoverNote(o: { why: string; loaded: boolean }): string {
  return `${o.why}${o.loaded ? '' : ', about 5 s to load'}`
}
