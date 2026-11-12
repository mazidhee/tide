import type { ChatScope, ExamMark, ExamOptions, ExamPaper, ExamQuestion } from '@shared/types'
import { claudeOr, retrieve, extractJsonObject } from './ai'
import { agentComplete } from './agent'

/**
 * University-style exams: a paper with marked parts and a hidden mark scheme, answered by typing or
 * with photos of handwritten work, then marked part by part against the scheme.
 */

const STYLE: Record<ExamOptions['style'], string> = {
  university: 'a university exam paper: structured questions with parts (a), (b), (c) that build on each other, mixing definitions, explanations, calculations or proofs, and one harder question at the end',
  problems: 'a problem sheet: worked problems that need full working, each with a clear final answer',
  short: 'a short-answer test: many small questions, a few marks each',
  mixed:
    'a mixed paper across the topics listed: short definitions, a multiple-choice question (options in the text as (A)–(D)), a calculation or worked problem, an explain-why question, and one longer applied question; at least one question on each topic, marks in proportion to the time each takes'
}

const LEVEL: Record<ExamOptions['difficulty'], string> = {
  gentle: 'warm-up: direct applications of one idea',
  normal: 'interview standard: two or three steps, the level of a trading-firm or university problem sheet',
  hard: 'hard: several ideas combined, careful casework or a non-obvious approach',
  olympiad:
    'olympiad: competition problems (like IMO, Putnam or the hardest trading interviews) that need a real insight, an elegant argument or a proof, not routine calculation. Fewer questions, more marks each, and a full worked solution in each mark scheme'
}

export async function generateExam(scope: ChatScope, topic: string, opts: ExamOptions): Promise<ExamPaper> {
  const sources = scope.kind === 'none' ? [] : await retrieve(scope, `${topic} key concepts definitions theorems methods`)
  const material = sources.map((s) => `[${s.index}] ${s.title}${s.heading ? ` > ${s.heading}` : ''}\n${s.text}`).join('\n\n---\n\n').slice(0, 14000)
  const prompt = `Write ${STYLE[opts.style]} on: ${topic}.
Difficulty: ${LEVEL[opts.difficulty] ?? opts.difficulty}. About ${opts.questions} questions, roughly ${opts.minutes} minutes in total, ${opts.minutes} marks in total (about a mark a minute).
Test understanding, not recall: explain why, apply to a new case, calculate with working, prove, or spot the flaw.
Write maths in LaTeX ($...$ and $$...$$). Questions must be answerable on paper.
For every part, write a mark scheme: the points or working that earn each mark, and the final answer where there is one.
${material ? `Base the paper on this material (you may go a little beyond it):\n\n${material}\n` : 'Use your own knowledge of the topic, at a university level.'}

Return ONLY JSON in this shape:
{"title": "...", "instructions": "Answer all questions. Show your working.", "questions": [
  {"number": 1, "text": "stem shared by the parts (may be empty)", "parts": [
    {"label": "a", "text": "...", "marks": 3, "scheme": "1 mark for ..., 2 marks for ...; answer: ..."}
  ]}
]}`
  const system = 'You are an experienced university examiner who writes fair, rigorous exam papers.'
  // Claude when the notes it's written from may leave this Mac, else Gemma (shared/gemmaPolicy)
  const out = await claudeOr('examPaper', prompt, system, { path: scope.kind === 'none' || scope.kind === 'vault' ? undefined : scope.path, text: topic }, () => agentComplete([{ role: 'user', content: prompt }], system, false))
  const paper = extractJsonObject<{ title?: string; instructions?: string; questions?: ExamQuestion[] }>(out)
  const questions = (paper.questions ?? [])
    .filter((q) => Array.isArray(q.parts) && q.parts.length)
    .map((q, i) => ({
      number: i + 1,
      text: String(q.text ?? ''),
      parts: q.parts.map((p, j) => ({
        label: String(p.label ?? String.fromCharCode(97 + j)),
        text: String(p.text ?? ''),
        marks: Math.max(1, Math.round(Number(p.marks) || 1)),
        scheme: String(p.scheme ?? '')
      }))
    }))
  if (!questions.length) throw new Error('The examiner did not return any questions. Try again.')
  return {
    title: paper.title || `${topic} exam`,
    instructions: paper.instructions || 'Answer all questions. Show your working.',
    topic,
    minutes: opts.minutes,
    questions,
    createdAt: Date.now()
  }
}

/** Marks one part. Photos of handwritten work are sent to the model as images. */
export async function markPart(question: ExamQuestion, partIndex: number, answer: string, images: string[]): Promise<ExamMark> {
  const part = question.parts[partIndex]
  const text = `Mark this answer against the mark scheme, like a fair but strict university examiner.
${question.text ? `Question ${question.number}: ${question.text}\n` : ''}Part (${part.label}) [${part.marks} marks]: ${part.text}

Mark scheme: ${part.scheme}

Student's typed answer:
"""
${answer.trim() || '(nothing typed)'}
"""
${images.length ? `The student also attached ${images.length} photo${images.length === 1 ? '' : 's'} of handwritten working. Read them carefully and mark what they show.` : ''}

Give method marks for correct working even when the final answer is wrong. If there is maths, check the key steps with SymPy using run_code before deciding.
Then return ONLY JSON: {"awarded": 2, "feedback": "what earned marks, what lost marks and why, in 2-4 sentences", "missed": "the key idea or step they missed, as one sentence"}
If you award fewer than ${part.marks} marks, "missed" must say exactly what would have earned the rest; leave it empty only for full marks.`
  const content: ApiContent = [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))]
  // Claude's marking model (Opus) when the question may leave this Mac, photos of handwriting and
  // all: it reads them as image blocks. Gemma marks when Claude can't (its limit, offline, private)
  const gemma = () => agentComplete([{ role: 'user', content }], 'You are an experienced university examiner.', true, images.length ? undefined : 'marking')
  const out = await claudeOr(images.length ? 'handwriting' : 'examMark', text, 'You are an experienced university examiner.', { text: `${question.text}\n${part.text}\n${part.scheme}`, images }, gemma)
  const m = extractJsonObject<{ awarded?: number; feedback?: string; missed?: string }>(out)
  return {
    awarded: Math.max(0, Math.min(part.marks, Number(m.awarded) || 0)),
    marks: part.marks,
    feedback: String(m.feedback ?? ''),
    // Full marks have nothing missed, whatever the model wrote
    missed: (Number(m.awarded) || 0) >= part.marks ? '' : String(m.missed ?? '')
  }
}

type ApiContent = ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[]
