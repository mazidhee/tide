import { hideWorking, parseBlocks, posedProblem } from './session'

export { hideWorking }

/**
 * Checks on a lesson reply before the student works on it, so a small local tutor can teach hard
 * material without teaching anything false. The tutor solves each problem first in a hidden
 * <solution>, with a <check> Tide runs for anything computable; a second pass (the cloud model on
 * hard topics when it may be used) reviews whether the new problem is well posed and whether the
 * last verdict was earned. Anything that fails sends the reply back once with what to fix.
 */

export interface CheckCode {
  lang: string
  code: string
}

const SOLUTION = /<solution\b[^>]*>([\s\S]*?)<\/solution>/gi
const CHECK = /<check\b([^>]*)>([\s\S]*?)<\/check>/gi

export const solutionOf = (reply: string) =>
  [...reply.matchAll(SOLUTION)]
    .map((m) => m[1].trim())
    .join('\n')
    .trim()

export const checksOf = (reply: string): CheckCode[] =>
  [...reply.matchAll(CHECK)].map((m) => ({
    lang: /lang\s*=\s*["']?(\w+)/i.exec(m[1])?.[1]?.toLowerCase() ?? 'python',
    code: m[2].replace(/^\s*```\w*\n?|```\s*$/g, '').trim()
  }))

/** A reply that sets a numbered problem but never asks it: nothing to answer */
export function missingQuestion(reply: string): boolean {
  const blocks = parseBlocks(reply)
  if (blocks.some((b) => b.kind === 'ask' || b.kind === 'summary' || b.kind === 'scores')) return false
  return /\*{0,2}problem\s+\d+/i.test(reply)
}

/** Advanced technical material, where a wrong problem or a generous mark costs the most */
const HARD =
  /\b(proofs?|prove|theorem|lemma|derive|derivation|induction|integral|differential|eigen\w*|matri(x|ces)|linear algebra|vector spaces?|calculus|limit|series|convergen\w*|probabilit\w*|expected value|variance|bayes\w*|markov|stochastic|optimi[sz]\w*|gradient|complexity|big[- ]o|recurrence|amortized|np[- ]?(hard|complete)|dynamic programming|graph algorithms?|shortest path|concurren\w*|mutex|deadlock|race conditions?|lock[- ]free|memory model|cache coherenc\w*|consensus|raft|paxos|distributed|replication|partition\w*|transactions?|isolation levels?|serializab\w*|compilers?|parsers?|type systems?|operating systems?|virtual memory|kernel|cryptograph\w*|elliptic|zero[- ]knowledge|blockchain|smart contracts?|stablecoins?|settlement|ledger|reconcil\w*|backpropagation|transformers?|attention|neural|machine learning|stochastic calculus|options pricing|black[- ]scholes)\b/i

export const isHardTopic = (text: string) => HARD.test(text)

export type Verdict = 'correct' | 'partial' | 'wrong'
const RANK: Record<Verdict, number> = { wrong: 0, partial: 1, correct: 2 }

export interface ReviewInput {
  /** The problem the student just answered, and the tutor's hidden solution to it */
  answered?: { problem: string; solution: string; answer: string; verdict: Verdict; feedback: string }
  /** The problem this reply sets, and its hidden solution */
  posed?: { problem: string; solution: string }
}

export const REVIEW_SYSTEM = 'You are a strict, careful examiner checking a tutor\'s work for a student studying technical material. You check facts and logic yourself; you never trust the tutor. Reply in exactly the format asked, nothing else.'

export function reviewPrompt(r: ReviewInput): string {
  const parts: string[] = []
  if (r.answered)
    parts.push(`MARKING
Problem: ${r.answered.problem}
Tutor's own solution: ${r.answered.solution || '(none given)'}
Student's answer: ${r.answered.answer}
Tutor's verdict: ${r.answered.verdict}, saying: ${r.answered.feedback}

Work the problem yourself. Is the student's answer fully correct, with sound reasoning? "correct" only if it is right and complete; "partial" if the answer or the reasoning is incomplete or contains an error; "wrong" otherwise.`)
  if (r.posed)
    parts.push(`NEW PROBLEM
Problem: ${r.posed.problem}
Tutor's own solution: ${r.posed.solution || '(none given)'}

Is the problem well posed (every quantity it asks about is defined, it has one clear answer) and is the tutor's solution right?`)
  parts.push(`Reply with these lines only:
${r.answered ? 'VERDICT: correct | partial | wrong\nWHY: one sentence on what is missing or wrong in the student\'s answer, or "nothing"\n' : ''}${r.posed ? 'PROBLEM: ok | flawed\nFLAW: one sentence on what is wrong with the problem or its solution, or "none"' : ''}`)
  return parts.join('\n\n')
}

export interface Review {
  verdict?: Verdict
  why?: string
  problemOk?: boolean
  flaw?: string
}

export function parseReview(out: string): Review {
  const line = (k: string) => new RegExp(`^\\s*\\**${k}\\**\\s*:\\s*(.+)$`, 'im').exec(out)?.[1]?.trim().replace(/\*+$/, '')
  const v = line('VERDICT')?.toLowerCase().match(/correct|partial|wrong/)?.[0] as Verdict | undefined
  const p = line('PROBLEM')?.toLowerCase()
  return {
    ...(v ? { verdict: v } : {}),
    ...(line('WHY') ? { why: line('WHY') } : {}),
    ...(p ? { problemOk: !/flaw/.test(p) } : {}),
    ...(line('FLAW') ? { flaw: line('FLAW') } : {})
  }
}

/** The review found the tutor's mark too generous */
export const tooGenerous = (given: Verdict, review: Review) => !!review.verdict && RANK[review.verdict] < RANK[given]

/** The problem the student was answering: what the tutor's previous reply posed, and its solution */
export function answeredProblem(previousReply: string, answer: string, reply: string): ReviewInput['answered'] | undefined {
  const grade = parseBlocks(reply).find((b): b is Extract<ReturnType<typeof parseBlocks>[number], { kind: 'grade' }> => b.kind === 'grade')
  const problem = posedProblem(previousReply)
  if (!grade || !problem) return undefined
  return { problem: readable(previousReply), solution: solutionOf(previousReply), answer: answer.replace(/^Answer:\s*/i, '').trim(), verdict: grade.verdict as Verdict, feedback: grade.text }
}

/** A reply's problem as the student reads it: after any grade, without the tutor's working */
export function readable(reply: string): string {
  const blocks = parseBlocks(hideWorking(reply))
  const lastGrade = blocks.map((b) => b.kind).lastIndexOf('grade')
  return blocks
    .slice(lastGrade + 1)
    .map((b) => (b.kind === 'text' ? b.text : b.kind === 'ask' ? b.prompt : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

/** What to tell the tutor (not shown) when a reply has to be written again */
export function fixNudge(problems: string[]): string {
  return `(Tide checked your reply before the student saw it and it has to be written again. ${problems.join(' ')} Write the whole reply again, fixed: grade their last answer honestly, then set a problem that is well posed, with your <solution> and a <check> where the answer can be computed, ending with the question in an <ask> tag.)`
}
