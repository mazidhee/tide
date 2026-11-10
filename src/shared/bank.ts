/**
 * The problem bank: problems written ahead of time by a strong model, each with its solution, a
 * check Tide runs where the answer can be computed, and a second model's review. Lessons draw on
 * it so the next problem is ready the moment the tutor asks for it, and Daily practice uses it for
 * fresh versions of past mistakes. Kept in the notes folder under .tide/bank, one file per topic.
 */
import { checksOf, solutionOf, type CheckCode } from './lessonCheck'

/** 1 easy, 2 medium, 3 hard */
export type Level = 1 | 2 | 3
export type Direction = 'harder' | 'same' | 'easier'

export interface BankProblem {
  id: string
  topic: string
  level: Level
  /** The problem as the student reads it (Markdown) */
  text: string
  /** The question itself, asked in the answer box */
  ask: string
  askType: 'problem' | 'short' | 'explain' | 'code' | 'error' | 'choice'
  solution: string
  check?: CheckCode
  /** Its check ran and passed (null: nothing to compute); a second model found it sound (null: not reviewed) */
  checked: boolean | null
  reviewed: boolean | null
  source: 'prep' | 'lesson' | 'variant'
  createdAt: number
  usedAt?: number
  /** Written for one lesson, aimed at a mistake made in it */
  forLesson?: string
}

export const slugOf = (topic: string) =>
  topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'topic'

const LEVEL_WORD: Record<Level, string> = { 1: 'easy', 2: 'medium', 3: 'hard' }

// Everything that never changes is here, at the start of every request, so providers that cache a
// repeated start of a prompt reuse it; only the topic and counts (or the mistake) follow
export const BANK_SYSTEM = `You are an expert teacher writing practice problems for a self-taught student. Every problem is well posed, has one clear answer, and tests understanding rather than recall. You solve each problem yourself before writing it down. Vary them: different situations, numbers and kinds of question (calculate, explain why, find the error, predict, compare), never the same problem twice.

Write each problem exactly like this, and nothing else:

<problem level="easy|medium|hard" type="problem|explain|short|error|code">
The problem, in Markdown (LaTeX for maths), everything needed to answer it.
<question>The one question the student answers, in a sentence.</question>
<solution>The answer and the key steps, briefly.</solution>
<check lang="python">Only when the answer is a number or an expression: Python (SymPy is available) that works the answer out from scratch and asserts it equals yours. Leave this tag out otherwise.</check>
</problem>`

/** Asks for problems on a topic, a few at each level, each solved and (where computable) checkable */
export function bankPrompt(topic: string, counts: Partial<Record<Level, number>>, context = ''): string {
  const want = (Object.entries(counts) as [string, number][]).filter(([, n]) => n > 0).map(([l, n]) => `${n} ${LEVEL_WORD[Number(l) as Level]}`)
  return `Write ${want.join(', ')} problem${want.length === 1 && want[0].startsWith('1 ') ? '' : 's'} on: ${topic}${context ? `\nWhat the student is working towards, for context: ${context}` : ''}`
}

const LEVELS: Record<string, Level> = { easy: 1, medium: 2, hard: 3, '1': 1, '2': 2, '3': 3 }
const TYPES = ['problem', 'short', 'explain', 'code', 'error', 'choice'] as const

export function parseBank(out: string, topic: string, source: BankProblem['source'], now = Date.now()): BankProblem[] {
  const problems: BankProblem[] = []
  for (const m of out.matchAll(/<problem\b([^>]*)>([\s\S]*?)<\/problem>/gi)) {
    const attrs = m[1]
    const body = m[2]
    const level = LEVELS[/level\s*=\s*["']?(\w+)/i.exec(attrs)?.[1]?.toLowerCase() ?? ''] ?? 2
    const type = (/type\s*=\s*["']?(\w+)/i.exec(attrs)?.[1]?.toLowerCase() ?? 'problem') as BankProblem['askType']
    const ask = /<question>([\s\S]*?)<\/question>/i.exec(body)?.[1]?.trim() ?? ''
    const solution = solutionOf(body)
    const text = body
      .replace(/<question>[\s\S]*?<\/question>/gi, '')
      .replace(/<solution\b[\s\S]*?<\/solution>/gi, '')
      .replace(/<check\b[\s\S]*?<\/check>/gi, '')
      .trim()
    if (!ask || !solution || text.length < 15) continue
    const check = checksOf(body)[0]
    problems.push({
      id: `${now.toString(36)}${problems.length.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      topic,
      level,
      text,
      ask,
      askType: (TYPES as readonly string[]).includes(type) ? type : 'problem',
      solution,
      ...(check ? { check } : {}),
      checked: check ? false : null,
      reviewed: null,
      source,
      createdAt: now
    })
  }
  return problems
}

/** One review for a batch: is each problem well posed, and is its solution right? */
export function batchReviewPrompt(problems: BankProblem[]): string {
  return `A tutor wrote these practice problems with their solutions. Check each yourself: is it well posed (everything it asks about is defined, one clear answer) and is the solution right?

${problems.map((p, i) => `#${i + 1}\nProblem: ${p.text}\nQuestion: ${p.ask}\nSolution: ${p.solution}`).join('\n\n')}

Reply with one line per problem, nothing else:
#1: ok
#2: flawed: what is wrong`
}

/** Which problems the review passed (true), failed (false) or didn't mention (undefined) */
export function parseBatchReview(out: string, n: number): (boolean | undefined)[] {
  const verdicts: (boolean | undefined)[] = new Array(n).fill(undefined)
  for (const m of out.matchAll(/^\s*#?(\d+)\s*[:.)-]\s*(ok|flawed|wrong|bad|fine|good)/gim)) {
    const i = Number(m[1]) - 1
    if (i >= 0 && i < n) verdicts[i] = /ok|fine|good/i.test(m[2])
  }
  return verdicts
}

/** Fit to put in front of a student: a check that passed or a review that passed, and nothing that failed */
export const trusted = (p: BankProblem) => p.checked !== false && p.reviewed !== false && (p.checked === true || p.reviewed === true)

export const levelAfter = (current: Level, dir: Direction): Level => (dir === 'harder' ? (Math.min(3, current + 1) as Level) : dir === 'easier' ? (Math.max(1, current - 1) as Level) : current)

/**
 * The next problem at a level: trusted and not yet used first, then the nearest level, then
 * ones used more than a week ago (a fresh look); never one the student saw in this lesson.
 */
export function pickProblem(bank: BankProblem[], level: Level, seen: (p: BankProblem) => boolean, now = Date.now(), lesson?: string): BankProblem | undefined {
  const usable = bank.filter((p) => trusted(p) && !seen(p))
  // A problem written for this lesson's mistake comes first, if it's near the level
  const aimed = lesson ? usable.find((p) => p.forLesson === lesson && !p.usedAt && Math.abs(p.level - level) <= 1) : undefined
  if (aimed) return aimed
  const fresh = (p: BankProblem) => !p.usedAt
  const stale = (p: BankProblem) => !!p.usedAt && now - p.usedAt > 7 * 86_400_000
  for (const ok of [fresh, stale]) {
    const pool = usable.filter(ok)
    for (const d of [0, 1, -1, 2, -2]) {
      const hit = pool.find((p) => p.level === level + d)
      if (hit) return hit
    }
  }
  return undefined
}

/** Enough of each level for a lesson: what's still to write */
export function shortfall(bank: BankProblem[], perLevel = 3): Partial<Record<Level, number>> {
  const fresh = bank.filter((p) => trusted(p) && !p.usedAt)
  const out: Partial<Record<Level, number>> = {}
  for (const l of [1, 2, 3] as Level[]) {
    const n = perLevel - fresh.filter((p) => p.level === l).length
    if (n > 0) out[l] = n
  }
  return out
}

/** The tutor asks for the next problem with this, and Tide puts a checked one in its place */
export const NEXT_TAG = /<next\s+level\s*=\s*["']?(harder|same|easier)["']?\s*\/?>/i

export const nextDirection = (reply: string): Direction | undefined => (NEXT_TAG.exec(reply)?.[1]?.toLowerCase() as Direction | undefined)

const DIR_LABEL: Record<Direction, string> = { harder: 'harder', same: 'same level', easier: 'easier' }

/** A worked solution's steps: its lines, or its sentences when it's one paragraph */
export function solutionSteps(solution: string): string[] {
  const lines = solution.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  if (lines.length >= 3) return lines
  return solution
    .split(/(?<=[.;])\s+(?=[A-Z$\\(])|\s*→\s*/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * A banked problem as the tutor would have set it, with its solution hidden for marking. Faded,
 * it comes worked out but for its last step, which the student finishes: how a new idea is best
 * learned (a worked example first, then less and less of it shown).
 */
export function renderProblem(p: BankProblem, n: number, dir: Direction, fade = false): string {
  const steps = fade ? solutionSteps(p.solution) : []
  if (steps.length >= 3) {
    const shown = steps.slice(0, -1).map((s) => `- ${s}`).join('\n')
    return `\n\n**Problem ${n} · ${DIR_LABEL[dir]}, worked for you up to the last step**\n\n${p.text}\n\nHere's how it goes:\n${shown}\n\n<solution>${p.solution}</solution>\n\n<ask type="problem">Finish it: the last step and the final answer.</ask>`
  }
  return `\n\n**Problem ${n} · ${DIR_LABEL[dir]}**\n\n${p.text}\n\n<solution>${p.solution}</solution>\n\n<ask type="${p.askType === 'choice' ? 'short' : p.askType}">${p.ask}</ask>`
}

/** How many numbered problems a lesson has set so far */
export const problemsSoFar = (replies: string[]) => replies.reduce((n, r) => n + (r.match(/\*\*Problem\s+\d+/gi)?.length ?? 0), 0)

/** Said to the tutor (not shown) when checked problems are ready: it decides when, Tide supplies what */
export const BANK_NUDGE =
  '(Tide: checked problems on this topic are ready. After your feedback, if the next thing in this step is a problem, do not write it yourself: end your reply with <next level="harder"/>, <next level="same"/> or <next level="easier"/> as the rules say, and Tide adds a checked problem at that level. When you need to teach something first, or move to the next step, write as usual.)'

/** A fresh version of a past mistake: the same idea, new details, for a retest that tests understanding, not memory */
export const variantPrompt = (question: string, fix: string, topic: string) => `Write ONE medium problem that tests exactly the same idea as this one, with different details (numbers, situation, wording), so they can't just recall the old answer. A student got it wrong earlier, on ${topic}.

Question: ${question}
The idea they missed: ${fix}`
