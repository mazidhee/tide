import { completeFor, extractJsonObject } from './ai'
import { readText } from './vault'

export interface DailyGrade {
  verdict: 'correct' | 'partial' | 'wrong'
  feedback: string
}

const SYSTEM = 'You mark a student’s short answers fairly and briefly. You judge understanding, not wording: an answer that says the same thing differently is correct.'

/**
 * Marks one typed answer in daily practice: a retest of a past mistake (against the right idea
 * noted then), or explaining a note from memory (against the note itself). One short call.
 */
export async function gradeAnswer(req: { kind: 'mistake' | 'recall'; question: string; expected?: string; path?: string; answer: string }): Promise<DailyGrade> {
  let expected = req.expected ?? ''
  if (req.kind === 'recall' && req.path) expected = (await readText(req.path).catch(() => '')).replace(/^---[\s\S]*?---\s*/, '').slice(0, 3500)
  const prompt = `Question: ${req.question}
${req.kind === 'recall' ? `The note they are explaining from memory:\n"""\n${expected}\n"""` : `The right idea: ${expected}`}
The student's answer:
"""
${req.answer.trim() || '(no answer)'}
"""
${req.kind === 'recall' ? 'Correct means they got the main ideas of the note across in their own words; partial means some key ideas are missing or muddled; wrong means it misses the point.' : 'Correct means they now have the right idea; partial means they are close but missing or confusing something; wrong means the mistake is still there.'}
Return ONLY JSON: {"verdict": "correct|partial|wrong", "feedback": "one or two sentences, speaking to them as you (never \"the student\"): what was right, then what was missing or wrong and the key idea"}`
  // Claude's marking model when the note or mistake may leave this Mac, else Gemma (shared/gemmaPolicy)
  const out = await completeFor('dailyMark', prompt, SYSTEM, { path: req.path, text: `${req.question}\n${req.expected ?? ''}`, task: 'errors' })
  const json = extractJsonObject<{ verdict?: string; feedback?: string }>(out)
  const verdict = json.verdict === 'correct' || json.verdict === 'partial' ? json.verdict : 'wrong'
  return { verdict, feedback: String(json.feedback ?? '').trim() || (verdict === 'correct' ? 'That’s it.' : 'Not quite.') }
}
