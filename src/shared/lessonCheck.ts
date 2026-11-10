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

export const SOLVE_SYSTEM = 'You are a careful mathematician and software engineer. You solve exactly the problem given, checking your own work. Reply in exactly the format asked, nothing else.'

/** Asks for the answer to a problem the tutor set without solving it, and a check Tide can run */
export const solvePrompt = (problem: string) => `A tutor has just set this problem for a student:

${problem}

Solve it. Reply with exactly:
<solution>the final answer and the key steps, briefly</solution>
and, only when the answer is a number or an expression, also:
<check lang="python">Python (SymPy is available) that works the answer out from scratch and asserts it equals yours</check>
If the problem is not well posed (something it asks about is undefined, or it has no single clear answer), reply with one line instead: FLAWED: what is wrong with it.`

/** What the solver said: its solution and check, or why the problem can't be solved */
export function parseSolve(out: string): { solution: string; checks: CheckCode[]; flaw?: string } {
  const flaw = /^\s*FLAWED:\s*(.+)$/im.exec(out)?.[1]?.trim()
  return { solution: solutionOf(out), checks: checksOf(out), ...(flaw && !solutionOf(out) ? { flaw } : {}) }
}

// ---------- What an explanation claims: worked examples and facts ----------

/**
 * An explanation with worked calculations in it (a conversion, a sum, a derivation): those aren't
 * problems set to the student, so nothing else checks them, and a wrong example teaches the error.
 */
export function hasWorkedMaths(reply: string): boolean {
  const text = readable(reply)
  const lines = text.split('\n').filter((l) => /\d/.test(l) && /=|→|⇒|×|÷|\^|\\cdot|\\times|\bremain(ing|der)\b|\bresult is\b|\bgives\b/i.test(l))
  return lines.length >= 2
}

/** Teaching worth checking: worked maths, or an explanation long enough to make claims (not a mark and a question) */
export function makesClaims(reply: string): boolean {
  if (hasWorkedMaths(reply)) return true
  const prose = hideWorking(reply)
    .replace(/<(ask|grade|note|card|plan|summary)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return (prose.match(/[A-Za-z]{2,}/g) ?? []).length >= 80
}

export const CLAIMS_SYSTEM = 'You check what a tutor taught a student before the student relies on it: calculations, worked examples and factual claims. You are exact and brief, and you only flag real problems.'

export function claimsPrompt(topic: string, explanation: string, sources = ''): string {
  return `Topic: ${topic}
${sources ? `Sources for this lesson (prefer them over memory):\n"""\n${sources}\n"""\n` : ''}A tutor wrote this for a student:
"""
${explanation.slice(0, 6000)}
"""
Check every calculation, conversion, worked example and factual claim in it${sources ? ', against the sources where they cover it' : ''}. Ignore style, and simplifications that are still true.
- "errors": things that are wrong (a wrong result, a claim the sources or well-established knowledge contradict).
- "unsure": specific numbers, parameters, versions or dates stated as fact that you can't confirm and could easily be wrong or out of date.
Reply with JSON only: {"ok": true} when there's nothing to flag, or {"ok": false, "errors": [{"quote": "the wrong part, quoted briefly", "fix": "what's right and why, in one or two plain sentences"}], "unsure": [{"quote": "...", "why": "what to check, briefly"}]}.`
}

export interface ClaimCheck {
  ok: boolean
  errors: { quote: string; fix: string }[]
  unsure: { quote: string; why: string }[]
}

export function parseClaimCheck(raw: string): ClaimCheck {
  const none: ClaimCheck = { ok: true, errors: [], unsure: [] }
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return none
  try {
    const j = JSON.parse(m[0]) as { ok?: unknown; errors?: unknown; unsure?: unknown }
    if (j.ok !== false) return none
    const list = (v: unknown) => (Array.isArray(v) ? v : []).filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    const text = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
    const errors = list(j.errors).map((e) => ({ quote: text(e.quote, 160), fix: text(e.fix, 400) })).filter((e) => e.fix).slice(0, 3)
    const unsure = list(j.unsure).map((e) => ({ quote: text(e.quote, 160), why: text(e.why, 240) })).filter((e) => e.quote).slice(0, 3)
    return errors.length || unsure.length ? { ok: false, errors, unsure } : none
  } catch {
    return none
  }
}

/** Under the explanation: corrections (also into the notes, so the wrong version isn't what's kept), then what's worth checking */
export function correctionText(c: Pick<ClaimCheck, 'errors' | 'unsure'>): string {
  const bullets = (xs: string[]) => (xs.length === 1 ? xs[0] : xs.map((x) => `\n> - ${x}`).join(''))
  // Model text on one line each, so it stays inside the quote
  const flat = (t: string) => t.replace(/\s*\n+\s*/g, ' ').trim()
  const parts: string[] = []
  if (c.errors.length) parts.push(`> **Correction:** ${bullets(c.errors.map((e) => `${e.quote ? `“${flat(e.quote)}”: ` : ''}${flat(e.fix)}`))}`)
  if (c.unsure.length) parts.push(`> **Worth checking:** ${bullets(c.unsure.map((u) => `“${flat(u.quote)}”${u.why ? `: ${flat(u.why)}` : ''}`))}`)
  const note = c.errors.length ? `\n\n<note>Correction: ${c.errors.map((e) => flat(e.fix)).join(' ')}</note>` : ''
  return parts.length ? `\n\n${parts.join('\n>\n')}${note}` : ''
}
