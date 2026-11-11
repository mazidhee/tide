/**
 * The tutor benchmark's data: a teaching situation (the lesson's setup, the conversation so far)
 * and what a good next reply must do, written so a program can check it. See README.md.
 */
import type { AskType, SessionSetup } from '../../../src/shared/session'
import type { Verdict } from '../../../src/shared/lessonCheck'

/** Bump when a scenario or an expectation changes: results are only comparable within one version */
export const SCENARIO_SET_VERSION = '1.1.0'

export const SUBJECTS = ['systems', 'c-cpp', 'distributed', 'databases', 'ml', 'maths', 'data-eng'] as const
export type Subject = (typeof SUBJECTS)[number]

export const SUBJECT_LABEL: Record<Subject, string> = {
  systems: 'Computer systems',
  'c-cpp': 'C and C++',
  distributed: 'Distributed systems',
  databases: 'Databases and SQL',
  ml: 'ML and neural networks',
  maths: 'Probability and linear algebra',
  'data-eng': 'Data engineering'
}

export const SITUATIONS = ['open', 'after-correct', 'after-wrong', 'idk', 'show-me', 'mark-planted-error', 'mark-unusual-correct', 'tangent', 'recall-open', 'code-bug'] as const
export type Situation = (typeof SITUATIONS)[number]

export const SITUATION_LABEL: Record<Situation, string> = {
  open: 'Opening a new topic',
  'after-correct': 'After a correct answer',
  'after-wrong': 'After a wrong answer with a stated misconception',
  idk: 'After "I don\'t know"',
  'show-me': 'A "Show me" request',
  'mark-planted-error': 'Marking a worked answer with one planted error',
  'mark-unusual-correct': 'Marking a correct answer written unusually',
  tangent: 'A tangent',
  'recall-open': 'Opening with a recall question',
  'code-bug': 'A code question with a bug'
}

/** What the learner sends, built into the app's own message forms (Answer:, My question:, Show me…) */
export type Learner =
  | { answer: string; confidence?: 'guessing' | 'unsure' | 'sure' }
  | { question: string }
  | { idk: true }
  | { showMe: true }
  | { goOn: true }

export type Turn = { tutor: string } | { learner: Learner }

export type Tag = 'ask' | 'grade' | 'plan' | 'card' | 'note' | 'summary' | 'solution' | 'check' | 'continue'

export type Visual =
  | { kind: 'mermaid'; diagram?: ('flowchart' | 'sequenceDiagram' | 'stateDiagram' | 'mindmap')[] }
  | { kind: 'table' }
  | { kind: 'sim'; sim?: 'neural-net' | 'attention' | 'gradient-descent' | 'softmax' }
  | { kind: 'chart' }

export interface Expect {
  /** How the reply must end: one question, <continue/>, either, or neither (a Show me asks nothing) */
  ends: 'ask' | 'continue' | 'either' | 'nothing'
  /** When it asks, the ask must be one of these types */
  askTypes?: AskType[]
  /** The true verdict on the answer just given. Present: the reply must grade, and match it. Absent: nothing to mark */
  verdict?: Verdict
  /** Other verdicts that are also fair (a slip that could be read as partial or wrong); never "correct" for a wrong answer */
  accept?: Verdict[]
  /** What the feedback must name (the planted error, the stated misconception): regexes, all must match what the learner reads */
  names?: string[]
  /** Exactness: regexes that must (must not) match what the learner reads: values, formulae, terms */
  must?: string[]
  mustNot?: string[]
  /** The answer to the question it asks, which must not appear in the question itself */
  askMustNot?: string[]
  /** Tags that must be present, or must not be */
  need?: Tag[]
  forbid?: Tag[]
  /** The reply must set a problem (a problem, code or error ask), which then needs its <solution> */
  setsProblem?: boolean
  /** The kind of picture asked for; a list when more than one kind shows the idea properly */
  visual?: Visual | Visual[]
  /** Bounds on the words the learner reads (code, diagrams, notes and hidden working aren't counted) */
  words?: { min?: number; max?: number }
  /** A bold heading the reply must carry, e.g. "Why this matters" at a lesson's opening */
  heading?: string
}

export interface Scenario {
  id: string
  subject: Subject
  situation: Situation
  /** The lesson as the app sets it up: mode, topic and options are the instructions variant */
  setup: SessionSetup
  /** The conversation after the opening message; it must end with the learner */
  history: Turn[]
  expect: Expect
  /** A reply that meets every deterministic expectation: proof the scenario can be passed */
  good: string
  /** Replies that must fail, each naming the checks it has to trip: proof the scorer notices. `repaired` names what the app must be seen to put right in it (see Score.repaired) */
  bad?: { reply: string; fails: string[]; repaired?: string[] }[]
  /** What a judge model should look for here (optional; see judge.ts) */
  judge?: string
}
