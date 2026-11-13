/**
 * Questions sourced from the course you're taking, the pure part. The passages are what you read
 * or watched: a lesson's sections, its videos' transcripts (with the time in the video), and the
 * course's own exercises and homework. Claude writes questions on them, each resting on one
 * passage and citing it ("from 3.4, at 12:40 in the video"); Opus marks the answers against the
 * passage. With no model, the course's own exercises are asked as they are, then plain questions
 * on its sections, marked by you against the course's words.
 *
 * main/courseQuiz gathers the passages and keeps the results; this file builds and checks.
 */
import { keyWords } from './warmup'
import type { Verdict } from './track'

export type PassageKind = 'text' | 'video' | 'exercise'

/** Where a question comes from in the course */
export interface CourseCite {
  course: string
  courseTitle: string
  lesson: string
  /** The lesson's number as the course gives it ("3.4") */
  n: string
  lessonTitle: string
  kind: PassageKind
  /** The section it is in (text, exercise) */
  section?: string
  /** Seconds into the video */
  at?: number
  video?: string
  /** A short phrase from the passage the question rests on (checked to be there) */
  quote?: string
  /** The passage, cut short, for marking against and showing after */
  excerpt: string
}

export interface Passage {
  id: string
  cite: Omit<CourseCite, 'quote'>
  /** Its words, as the course has them */
  text: string
  /** Roadmap topic ids the lesson teaches (from the alignment) */
  topics: string[]
}

export interface CourseQuestion {
  id: string
  question: string
  /** What a full answer contains: for marking, never shown before answering */
  answer: string
  cite: CourseCite
  /** The roadmap topic it counts on, when the lesson is mapped to one */
  concept?: string
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
const wordsOf = (s: string) => (s.match(/\S+/g) ?? []).length

/** "12:40", "1:02:05" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "from 3.4, at 12:40 in the video" · "from 3.4, “Mutual information”" · "from the module 3 homework" */
export function citeLabel(c: Pick<CourseCite, 'n' | 'kind' | 'section' | 'at' | 'lessonTitle'>): string {
  if (/homework$/.test(c.n)) return `from the module ${c.n.replace(/\s*homework$/, '')} homework${c.section ? `, “${c.section}”` : ''}`
  if (c.kind === 'video' && c.at !== undefined) return `from ${c.n}, at ${clock(c.at)} in the video`
  const where = c.section && flat(c.section).toLowerCase() !== flat(c.lessonTitle).toLowerCase() ? c.section : c.lessonTitle
  return `from ${c.n}, “${where}”`
}

/** The YouTube ids a lesson's text links or embeds, in order, each once */
export function videoIds(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(/https?:\/\/(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s)"'\]>]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/gi)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

// ---------- Passages ----------

const clip = (text: string, max: number) => {
  const ws = text.split(/(\s+)/)
  let n = 0
  let out = ''
  for (const w of ws) {
    if (/\S/.test(w)) n++
    if (n > max) return `${out.trim()}…`
    out += w
  }
  return out.trim()
}

/** Markdown down to prose for a prompt: no images, badges or link targets, code kept */
export const proseOf = (md: string) =>
  md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** A lesson's sections as passages (the ones with something to ask about), each at most `max` words */
export function textPassages(lesson: { course: string; courseTitle: string; id: string; n: string; title: string; markdown: string; sections: { title: string; start: number; end: number }[]; topics: string[]; homework?: boolean }, max = 320): Passage[] {
  const out: Passage[] = []
  const secs = lesson.sections.length ? lesson.sections : [{ title: lesson.title, start: 0, end: lesson.markdown.length }]
  for (const s of secs) {
    const text = proseOf(lesson.markdown.slice(s.start, s.end)).replace(/^#{1,6}\s+.*\n+/, '')
    if (wordsOf(text) < 40) continue
    const kind: PassageKind = lesson.homework || /\b(exercise|question|task|homework|assignment)\b/i.test(s.title) ? 'exercise' : 'text'
    out.push({ id: '', cite: { course: lesson.course, courseTitle: lesson.courseTitle, lesson: lesson.id, n: lesson.n, lessonTitle: lesson.title, kind, section: s.title, excerpt: clip(text, 120) }, text: clip(text, max), topics: lesson.topics })
  }
  return out
}

/** A video's transcript as passages of about `span` seconds each, at most `max` of them, spread through the video */
export function transcriptPassages(lesson: { course: string; courseTitle: string; id: string; n: string; title: string; topics: string[] }, video: string, lines: { start: number; text: string }[], span = 100, max = 3): Passage[] {
  if (!lines.length) return []
  const windows: { at: number; text: string[] }[] = []
  for (const l of lines) {
    const last = windows[windows.length - 1]
    if (!last || l.start - last.at >= span) windows.push({ at: l.start, text: [l.text] })
    else last.text.push(l.text)
  }
  const full = windows.map((w) => ({ at: w.at, text: flat(w.text.join(' ')) })).filter((w) => wordsOf(w.text) >= 60)
  if (!full.length) return []
  // Spread through the video: the first, then evenly
  const pick = full.length <= max ? full : Array.from({ length: max }, (_, i) => full[Math.floor(((i + 0.5) * full.length) / max)])
  return pick.map((w) => ({ id: '', cite: { course: lesson.course, courseTitle: lesson.courseTitle, lesson: lesson.id, n: lesson.n, lessonTitle: lesson.title, kind: 'video', at: Math.floor(w.at), video, excerpt: clip(w.text, 120) }, text: clip(w.text, 320), topics: lesson.topics }))
}

/**
 * The passages a quiz is written from: exercises first (the course's own questions), then each
 * lesson's text and transcript taken in turn so every lesson is drawn on, at most `max`, numbered
 * P1, P2…
 */
export function pickPassages(byLesson: Passage[][], max = 12): Passage[] {
  const exercises = byLesson.flat().filter((p) => p.cite.kind === 'exercise').slice(0, Math.ceil(max / 3))
  const rest = byLesson.map((ps) => ps.filter((p) => p.cite.kind !== 'exercise'))
  const out = [...exercises]
  for (let round = 0; out.length < max && rest.some((r) => r.length); round++) for (const r of rest) if (r.length && out.length < max) out.push(r.shift()!)
  return out.map((p, i) => ({ ...p, id: `P${i + 1}` }))
}

const passageHead = (p: Passage) => `${p.id} [${p.cite.n} ${p.cite.lessonTitle}${p.cite.kind === 'video' ? ` · video at ${clock(p.cite.at ?? 0)}` : p.cite.section ? ` · ${p.cite.section}` : ''}${p.cite.kind === 'exercise' ? ' · the course’s own exercise' : ''}]`

export const QUIZ_SYSTEM = 'You write short-answer questions that check a learner understood course material they just read or watched. Every question rests on one passage you are given and can be answered from it. You test understanding (why, predict, apply to a new case, compare, find the mistake, a small calculation), not recall of wording. No multiple choice, no hints in the question. You answer with JSON only.'

export function quizPrompt(courseTitle: string, passages: Passage[], n: number, profile = ''): string {
  return `The course: ${courseTitle}. The learner read or watched these passages of it:

${passages.map((p) => `${passageHead(p)}\n${p.text}`).join('\n\n')}
${profile ? `\nWhat Tide knows about this learner:\n${profile.slice(0, 800)}\n` : ''}
Write ${n} question${n === 1 ? '' : 's'}, each on a different passage where there are enough, spread across the lessons. Where a passage is the course's own exercise, ask that exercise (reworded only as much as a short answer needs). Each question is answerable in a few sentences or a few lines of working.
For each, quote a short phrase (4 to 12 words) copied exactly from its passage that the question rests on.
Return ONLY JSON: {"questions":[{"p":"P1","quote":"…","question":"…","answer":"what a full answer contains, in 1 to 3 sentences"}]}`
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Whether a quote is really in the passage (case, punctuation and spacing aside) */
export const quoted = (quote: string, text: string) => {
  const q = squash(quote)
  return q.split(' ').length >= 3 && squash(text).includes(q)
}

/** The roadmap topic a question counts on: of its lesson's topics, the one whose words it shares most (the first when none) */
export function conceptOf(question: string, topics: string[], names: Record<string, string>): string | undefined {
  if (!topics.length) return undefined
  const qw = keyWords(question)
  let best = topics[0]
  let most = 0
  for (const t of topics) {
    let n = 0
    for (const w of keyWords(names[t] ?? '')) if (qw.has(w)) n++
    if (n > most) (most = n), (best = t)
  }
  return best
}

/**
 * The model's questions, checked: each on a passage that exists, its quote kept only when it is
 * really there, one question a passage; null when fewer than `min` survive.
 */
export function parseQuiz(raw: unknown, passages: Passage[], names: Record<string, string> = {}, min = 1): CourseQuestion[] | null {
  const list = (raw as { questions?: unknown })?.questions
  if (!Array.isArray(list)) return null
  const byId = new Map(passages.map((p) => [p.id.toUpperCase(), p]))
  const used = new Set<string>()
  const out: CourseQuestion[] = []
  for (const q of list as { p?: unknown; quote?: unknown; question?: unknown; answer?: unknown }[]) {
    const p = byId.get(String(q?.p ?? '').trim().toUpperCase())
    const question = typeof q?.question === 'string' ? q.question.trim() : ''
    if (!p || !question || used.has(p.id)) continue
    used.add(p.id)
    const quote = typeof q?.quote === 'string' && quoted(q.quote, p.text) ? flat(q.quote).slice(0, 160) : undefined
    const concept = conceptOf(question, p.topics, names)
    out.push({ id: `q${out.length + 1}`, question: question.slice(0, 1000), answer: typeof q?.answer === 'string' ? q.answer.trim().slice(0, 800) : '', cite: { ...p.cite, ...(quote ? { quote } : {}) }, ...(concept ? { concept } : {}) })
  }
  return out.length >= min ? out : null
}

/** A homework's questions, as the course asks them ("## Question 3 … "), from an exercise passage */
export function exerciseAsk(p: Passage): string {
  const t = p.text.replace(/^(question|task|exercise)\s*\d*[.:)]?\s*/i, '')
  const first = t.split(/(?<=[?])\s|\n\n/)[0]
  return clip(first.endsWith('?') ? first : t, 70)
}

/**
 * With no model to write them: the course's own exercises as they are, then one plain question on
 * each section, its answer the course's own words (you mark yourself against them).
 */
export function fallbackQuiz(passages: Passage[], n: number, names: Record<string, string> = {}): CourseQuestion[] {
  const ex = passages.filter((p) => p.cite.kind === 'exercise')
  const text = passages.filter((p) => p.cite.kind === 'text')
  const video = passages.filter((p) => p.cite.kind === 'video')
  const order = [...ex, ...text, ...video].slice(0, n)
  return order.map((p, i) => {
    const subject = p.cite.section && p.cite.kind !== 'video' ? p.cite.section : p.cite.lessonTitle
    const question = p.cite.kind === 'exercise' ? exerciseAsk(p) : p.cite.kind === 'video' ? `In ${p.cite.n}’s video, around ${clock(p.cite.at ?? 0)}: what is being explained, and why does it matter for ${p.cite.lessonTitle.toLowerCase()}?` : `Without looking: what does ${p.cite.n} say about ${subject.replace(/\s*\(part \d+\)$/, '').toLowerCase()}, and why does it matter?`
    const concept = conceptOf(question, p.topics, names)
    return { id: `q${i + 1}`, question, answer: `The course says: ${p.cite.excerpt}`, cite: { ...p.cite }, ...(concept ? { concept } : {}) }
  })
}

// ---------- Marking ----------

export const QUIZ_MARK_SYSTEM = 'You mark a learner’s short answers to questions on a course they are taking, against the course’s own passage and what a full answer contains. "correct" when the idea is right and complete enough to build on, "partial" when on the right track with a gap or an error, "wrong" when wrong, empty or "I don’t know". Fair and strict: naming the right words without the reasoning is partial. For each, one or two sentences of feedback that say what was right or give the right idea, in the course’s terms. You answer with JSON only.'

export function quizMarkPrompt(questions: CourseQuestion[], answers: Record<string, string>): string {
  return `${questions
    .map((q, i) => `Q${i + 1}: ${q.question}\nThe course (${citeLabel(q.cite)}): ${q.cite.excerpt}\nA full answer: ${q.answer || '(not given; use the passage)'}\nThe learner wrote: ${(answers[q.id] ?? '').trim().slice(0, 3000) || '(nothing)'}`)
    .join('\n\n')}

Return ONLY JSON: {"marks":[{"q":"Q1","verdict":"correct|partial|wrong","feedback":"…"}]}`
}

export interface CourseMark {
  id: string
  question: string
  verdict: Verdict
  feedback: string
  cite: CourseCite
  concept?: string
}

const VERDICTS: Verdict[] = ['correct', 'partial', 'wrong']

/** Opus's marks, checked: every question gets one, an empty answer is wrong, an unmarked one too */
export function parseQuizMarks(raw: unknown, questions: CourseQuestion[], answers: Record<string, string>): CourseMark[] | null {
  const list = (raw as { marks?: unknown })?.marks
  if (!Array.isArray(list)) return null
  const byQ = new Map<number, { verdict: Verdict; feedback: string }>()
  ;(list as { q?: unknown; verdict?: unknown; feedback?: unknown }[]).forEach((m, i) => {
    const n = Number(String(m?.q ?? `Q${i + 1}`).replace(/^Q/i, '')) - 1
    const v = String(m?.verdict ?? '').toLowerCase() as Verdict
    if (questions[n] && VERDICTS.includes(v) && !byQ.has(n)) byQ.set(n, { verdict: v, feedback: typeof m?.feedback === 'string' ? m.feedback.trim().slice(0, 600) : '' })
  })
  if (!byQ.size) return null
  return questions.map((q, i) => {
    const m = byQ.get(i)
    const empty = !(answers[q.id] ?? '').trim()
    return { id: q.id, question: q.question, verdict: empty ? 'wrong' : (m?.verdict ?? 'wrong'), feedback: m?.feedback ?? (empty ? 'No answer.' : 'Not marked.'), cite: q.cite, ...(q.concept ? { concept: q.concept } : {}) }
  })
}

/** Right counts 1, partly a half; a check passes at two thirds */
export const QUIZ_PASS = 2 / 3
export function quizScore(marks: Pick<CourseMark, 'verdict'>[]): { score: number; total: number; passed: boolean } {
  const score = marks.reduce((n, m) => n + (m.verdict === 'correct' ? 1 : m.verdict === 'partial' ? 0.5 : 0), 0)
  return { score, total: marks.length, passed: marks.length > 0 && score / marks.length >= QUIZ_PASS - 1e-9 }
}

/**
 * What the marks mean for What you know: each answer counts on its concept (right, partly, wrong:
 * a first asking, straight after the reading). Reading alone is exposure, a light "taught"; only
 * an answer moves how well a concept is held.
 */
export function quizEvidence(marks: CourseMark[], source: string, at: number): { concept: string; kind: 'right' | 'partly' | 'wrong'; pos: string; source: string; at: number }[] {
  return marks.flatMap((m, i) => (m.concept ? [{ concept: m.concept, kind: m.verdict === 'correct' ? ('right' as const) : m.verdict === 'partial' ? ('partly' as const) : ('wrong' as const), pos: `q${i}`, source, at }] : []))
}

/** Reading a lesson (to the end, or marked done) as evidence: a light "taught" on each concept it teaches, never a right answer */
export function exposureEvidence(topics: string[], course: string, lesson: string, at: number): { concept: string; kind: 'taught'; pos: string; source: string; at: number; weight: number }[] {
  return topics.map((concept) => ({ concept, kind: 'taught' as const, pos: `${lesson}.read`, source: `course:${course}`, at, weight: 0.5 }))
}

/** A missed question, kept for recall with where it is from in the course */
export const recallPrompt = (q: Pick<CourseQuestion, 'question' | 'cite'>) => `${q.question} (${q.cite.courseTitle} ${citeLabel(q.cite).replace(/^from /, '')})`

// ---------- In a phase check ----------

/** The passages as the phase check's prompt lists them, for the concepts they cover */
export function phasePassagesText(passages: Passage[], concepts: { id: string; label: string }[]): string {
  if (!passages.length) return ''
  const label = new Map(concepts.map((c) => [c.id, c.label]))
  return `\nPassages from the course the learner is taking, which they read or watched (each says which concepts it covers):
${passages.map((p) => `${passageHead(p)} covers ${p.topics.map((t) => label.get(t)).filter(Boolean).join(', ')}\n${p.text}`).join('\n\n')}

Where a passage covers a concept, base that concept's question on the passage, and add "p" (its id) and "quote" (4 to 12 words copied exactly from it) to the question.`
}

/** The check's questions with their course passage, where the model based one on a passage it was given (on that concept) and quoted it */
export function attachCites<Q extends { concept: string }>(raw: unknown, questions: Q[], passages: Passage[], picked: { id: string }[]): (Q & { cite?: CourseCite })[] {
  const list = (raw as { questions?: unknown })?.questions
  if (!Array.isArray(list)) return questions
  const byId = new Map(passages.map((p) => [p.id.toUpperCase(), p]))
  const cites = new Map<string, CourseCite>()
  ;(list as { concept?: unknown; p?: unknown; quote?: unknown }[]).forEach((q, i) => {
    const p = byId.get(String(q?.p ?? '').trim().toUpperCase())
    const n = Number(String(q?.concept ?? `C${i + 1}`).replace(/^C/i, '')) - 1
    const concept = picked[n]?.id
    // Only a passage that is on that concept
    if (!p || !concept || !p.topics.includes(concept) || cites.has(concept)) return
    const quote = typeof q?.quote === 'string' && quoted(q.quote, p.text) ? flat(q.quote).slice(0, 160) : undefined
    cites.set(concept, { ...p.cite, ...(quote ? { quote } : {}) })
  })
  return questions.map((q) => {
    const c = cites.get(q.concept)
    return c ? { ...q, cite: c } : q
  })
}
