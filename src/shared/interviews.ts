/**
 * Mock interview results, kept per company so you can see whether you're getting closer to their
 * bar: each round's score from its scorecard, the verdict, and whether it was timed.
 */

export type InterviewRound = 'coding' | 'design' | 'behavioural' | 'quant'
export type HireVerdict = 'hire' | 'lean hire' | 'lean no' | 'no'

export interface InterviewRecord {
  id: string
  at: number
  company: string
  round: InterviewRound
  /** 0..1, the scorecard's average */
  score: number
  verdict?: HireVerdict
  timed: boolean
  minutes: number
  topic?: string
}

/** The minutes a timed round lasts */
export const TIMED_MINUTES = 45

/** Average of "3/4"-style scores in a scorecard written as text; null without at least three */
export function scorecardScore(text: string): number | null {
  const scores = [...text.matchAll(/(?:^|[\s:*(-])([0-4](?:\.\d)?)\s*\/\s*4\b/gm)].map((m) => Number(m[1]) / 4).filter((x) => x >= 0 && x <= 1)
  return scores.length >= 3 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
}

/** The verdict, as an interviewer writes it ("Verdict: lean hire", "**Lean no**") */
export function parseVerdict(text: string): HireVerdict | undefined {
  const t = text.toLowerCase()
  const m = t.match(/\b(lean\s+hire|lean\s+no(?:\s+hire)?|no\s+hire|strong\s+hire|hire|no)\b(?=[\s.*)!,:]|$)/g)
  if (!m) return undefined
  // The last mention is the decision; earlier ones are usually the scale being explained
  const pick = m.filter((v) => v !== 'no' || /verdict[^\n]{0,20}\bno\b/.test(t)).pop() ?? m.pop()!
  const v = pick.replace(/\s+/g, ' ')
  if (v.startsWith('lean no')) return 'lean no'
  if (v === 'lean hire') return 'lean hire'
  if (v === 'no hire' || v === 'no') return 'no'
  return 'hire'
}

export interface RoundTrend {
  round: InterviewRound
  attempts: number
  last: number
  /** Change from the attempt before, or null for a first attempt */
  change: number | null
  verdict?: HireVerdict
}

/** Per round for one company: how many tries, the latest score and whether it went up */
export function companyTrend(records: InterviewRecord[], company: string): RoundTrend[] {
  const mine = records.filter((r) => r.company.toLowerCase() === company.toLowerCase()).sort((a, b) => a.at - b.at)
  const rounds: InterviewRound[] = ['coding', 'design', 'behavioural', 'quant']
  return rounds.flatMap((round) => {
    const rs = mine.filter((r) => r.round === round)
    if (!rs.length) return []
    const last = rs[rs.length - 1]
    return [{ round, attempts: rs.length, last: last.score, change: rs.length > 1 ? last.score - rs[rs.length - 2].score : null, verdict: last.verdict }]
  })
}
