/**
 * How hard Claude thinks for each job: Claude Code's effort level (`claude -p --effort`, and on a
 * running lesson process the `apply_flag_settings` control request with `effortLevel`, which the
 * CLI applies from the next message on without losing the prompt cache). One table: every lesson
 * turn kind and every job (shared/gemmaPolicy JOB_ROUTES) has a depth; Settings › Models
 * (Advanced) can change any of them. Gemma and the cloud helper are untouched by this.
 *
 * Measured (Claude Code 2.1.304, Nov 2026): the CLI's own default is medium for every model.
 * Opus marking 8 fixed answers at low gave the same 8 verdicts and misconceptions as at medium
 * and high (scores within 0.1), median 2.3 s against 4.0 s, so ordinary marking runs low. Effort
 * matters most where the model reasons at length: a hard counting problem took Opus 15 s and
 * 1k thinking tokens at low, 85 s and 8.4k at high. Sonnet's ordinary teaching turns and Haiku's
 * background jobs didn't think at any level.
 */
import { JOB_ROUTES, type JobName } from './gemmaPolicy'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORTS: { id: Effort; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' }
]

export const isEffort = (v: unknown): v is Effort => typeof v === 'string' && EFFORTS.some((e) => e.id === v)

/** What a lesson turn is, for its depth (main/claudeEngine turnDepth) */
export const TURN_DEPTH = {
  lesson: { label: 'Ordinary lesson turns', effort: 'medium' },
  lessonPlan: { label: 'A lesson’s opening plan', effort: 'high' },
  deepTurn: { label: 'Proofs, derivations, hard design questions, “go deeper”', effort: 'high' },
  mathsLesson: { label: 'Maths lesson turns', effort: 'medium' },
  thread: { label: 'Side threads', effort: 'low' },
  chat: { label: 'Chat replies', effort: 'low' },
  pair: { label: 'Pair programming in the Code view', effort: 'medium' },
  pairReview: { label: 'Code reviews and mentor sessions in the Code view', effort: 'high' }
} as const satisfies Record<string, { label: string; effort: Effort }>

/** One-shot work that isn't a routed job */
export const CALL_DEPTH = {
  marking: { label: 'Marking an answer in a lesson', effort: 'low' },
  mathsMarking: { label: 'Marking an answer in a maths lesson', effort: 'medium' },
  plan: { label: 'Study plans and roadmaps', effort: 'high' },
  outline: { label: 'A roadmap’s outline', effort: 'medium' },
  planAudit: { label: 'Auditing a roadmap', effort: 'high' },
  background: { label: 'Other background work: titles, summaries', effort: 'low' }
} as const satisfies Record<string, { label: string; effort: Effort }>

/** Each routed job's depth (the label is JOB_ROUTES') */
const JOB_EFFORT: Record<JobName, Effort> = {
  mathsReadBack: 'low',
  notebookTutor: 'medium',
  dataMap: 'low',
  paperRead: 'medium',
  workingMark: 'high',
  flashcards: 'low',
  labCards: 'low',
  marginNote: 'low',
  marginQuestion: 'low',
  writingReview: 'high',
  writingRecheck: 'low',
  writingTalk: 'medium',
  dailyMark: 'low',
  tieBreak: 'low',
  examPaper: 'medium',
  examMark: 'medium',
  bookContents: 'low',
  readingPicks: 'low',
  projectMap: 'low',
  projectBrief: 'medium',
  projectQuestions: 'medium',
  projectPlan: 'high',
  projectMentor: 'high',
  projectReady: 'medium',
  projectReadyMark: 'medium',
  projectDebrief: 'medium',
  projectIdeas: 'low',
  companyPrep: 'medium',
  readAlong: 'medium',
  readTogether: 'medium',
  readChallenge: 'medium',
  readArgument: 'high',
  readSeminar: 'medium',
  readKeep: 'low',
  weekPlan: 'medium',
  goalPlan: 'high',
  weekMix: 'medium',
  northStar: 'high',
  northStarReview: 'medium',
  phaseCheck: 'medium',
  phaseCheckMark: 'medium',
  courseAlign: 'low',
  courseQuiz: 'medium',
  courseQuizMark: 'medium',
  learnerProfile: 'low',
  profileUpdate: 'low',
  profileWeekly: 'medium',
  lessonPrep: 'high',
  prepExercises: 'medium',
  weeklyReview: 'medium',
  weekProgress: 'low',
  modelLinks: 'low',
  coachDaily: 'low',
  coachWeekly: 'medium',
  coachMonthly: 'high',
  lessonReview: 'high',
  curriculum: 'low',
  workshop: 'medium',
  handwriting: 'high',
  mockInterviewer: 'medium',
  mockMark: 'high',
  sharpWrite: 'high',
  sharpMark: 'high',
  sharpCoach: 'medium',
  sharpSystem: 'medium',
  lessonChecks: 'medium'
}

export type DepthKey = keyof typeof TURN_DEPTH | keyof typeof CALL_DEPTH | JobName

/** The whole table: key → label and default depth, in the order Settings lists them */
export const THINKING: Record<string, { label: string; effort: Effort; group: 'turns' | 'calls' | 'jobs' }> = {
  ...Object.fromEntries(Object.entries(TURN_DEPTH).map(([k, v]) => [k, { ...v, group: 'turns' as const }])),
  ...Object.fromEntries(Object.entries(CALL_DEPTH).map(([k, v]) => [k, { ...v, group: 'calls' as const }])),
  ...Object.fromEntries(
    (Object.keys(JOB_EFFORT) as JobName[]).filter((k) => JOB_ROUTES[k].role).map((k) => [k, { label: JOB_ROUTES[k].label, effort: JOB_EFFORT[k], group: 'jobs' as const }])
  )
}

/** A call with no job named: its role's usual depth (shared/usage jobFromRole names) */
const BY_USAGE_JOB: Record<string, DepthKey> = { lesson: 'lesson', plan: 'plan', marking: 'marking', background: 'background', draft: 'background' }

/**
 * The effort for a job or turn: the learner's override, else the table's default. A name the table
 * doesn't know (an older usage job) takes the CLI's own default, medium.
 */
export function effortFor(key: string | undefined, overrides?: Partial<Record<string, Effort>>): Effort {
  const k = key && !THINKING[key] && BY_USAGE_JOB[key] ? BY_USAGE_JOB[key] : key
  if (!k) return 'medium'
  const own = overrides?.[k]
  if (isEffort(own)) return own
  return THINKING[k]?.effort ?? 'medium'
}
