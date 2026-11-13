/**
 * Mock interviews and exams (Practice › Mock): five kinds, each a pre-brief, a timed session and a
 * debrief. Pure: the rubrics, the clock, the interviewer's and the marker's prompts, reading
 * Opus's marks, marking in code when Claude can't, and what a debrief feeds (the learner profile,
 * recall, the practice roadmap note, the lesson record the teaching measures read) and the history.
 * main/mocks does the calling, running and saving; components/mock draws it.
 *
 * Scores are 0–4 per rubric item (the scale the existing interview scorecards use); an item that
 * needs Claude (how you communicated) is null when the mock was marked in code, and left out of
 * the overall score rather than counted as zero.
 */
import { jsonrepair } from 'jsonrepair'
import type { Canvas } from './canvas'
import { compareDesigns, describeCanvas, applyCanvasOps } from './canvas'
import type { HireVerdict } from './interviews'
import type { LessonRecord, LessonTurn } from './lessonLog'
import type { ProfileOp } from './learnerProfile'
import type { BankProblem } from './mockBank'
import { markQuant, starParts, type BehaviouralQuestion, type DesignArea, type DesignPrompt, type QuantQuestion } from './mockQuestions'
import type { ExamMark, ExamPaper } from './types'

export type MockMode = 'coding' | 'design' | 'quant' | 'behavioural' | 'exam'

export const MOCK_MODES: { id: MockMode; label: string; short: string; blurb: string; minutes: number[]; minutesDefault: number }[] = [
  { id: 'coding', label: 'Coding interview', short: 'Coding', blurb: 'A problem from the bank at your level, in the editor, hidden tests in the sandbox, an interviewer who asks for complexity and edge cases.', minutes: [30, 45, 60], minutesDefault: 45 },
  { id: 'design', label: 'System design', short: 'System design', blurb: 'Design a payment processor, a ledger or a card authorisation flow on the canvas while the interviewer probes scale, consistency and failure.', minutes: [35, 45, 60], minutesDefault: 45 },
  { id: 'quant', label: 'Quant and finance', short: 'Quant', blurb: 'Mental maths, probability and expected value, a market sizing and finance questions, against the clock, with follow-ups.', minutes: [20, 30, 45], minutesDefault: 30 },
  { id: 'behavioural', label: 'Behavioural', short: 'Behavioural', blurb: 'Three STAR questions with a follow-up each, marked on structure, ownership and specifics.', minutes: [15, 20], minutesDefault: 15 },
  { id: 'exam', label: 'Mock exam', short: 'Exam', blurb: 'A timed paper written from what you have studied, mixed question types, typed or photographed answers, marked part by part.', minutes: [30, 45, 60, 90], minutesDefault: 45 }
]

export const modeInfo = (m: MockMode) => MOCK_MODES.find((x) => x.id === m)!

export interface RubricItem {
  id: string
  label: string
  /** What a 4 looks like, for the pre-brief and the marker */
  what: string
  /** Only Claude can judge it (how you talked); null when marked in code */
  needsClaude?: boolean
}

export const RUBRICS: Record<Exclude<MockMode, 'exam'>, RubricItem[]> = {
  coding: [
    { id: 'problem', label: 'Problem solving', what: 'A correct, working solution: every hidden test passes, found by reasoning rather than trial and error.' },
    { id: 'quality', label: 'Code quality', what: 'Clear names, small focused functions, no dead code, idiomatic Python.' },
    { id: 'communication', label: 'Communication', what: 'Clarified the problem, talked through the approach before coding, explained trade-offs.', needsClaude: true },
    { id: 'testing', label: 'Testing', what: 'Thought of edge cases, tested their own code before submitting, fixed what failed.' },
    { id: 'complexity', label: 'Complexity', what: 'Reached the expected time and space, and stated them correctly.' },
    { id: 'hints', label: 'Independence', what: 'Solved it without hints. Each hint taken costs points here.' }
  ],
  design: [
    { id: 'requirements', label: 'Requirements', what: 'Pinned down functional and non-functional requirements before drawing.' },
    { id: 'architecture', label: 'Architecture', what: 'The right components, connected in a way that works, with clear data flow.' },
    { id: 'scale', label: 'Scale', what: 'Put numbers on load and storage and let them shape the design.' },
    { id: 'consistency', label: 'Consistency', what: 'Knew where the source of truth is and how it stays correct under concurrency.' },
    { id: 'idempotency', label: 'Idempotency', what: 'Made retries safe end to end: keys, deduplication, exactly-once effects.' },
    { id: 'failure', label: 'Failure modes', what: 'Named what fails, what state it leaves, and how it recovers.' },
    { id: 'communication', label: 'Communication', what: 'Led the discussion, explained trade-offs, responded to probes.', needsClaude: true }
  ],
  quant: [
    { id: 'mental', label: 'Mental maths', what: 'Fast and accurate arithmetic, percentages and estimates.' },
    { id: 'probability', label: 'Probability and EV', what: 'Right answers to probability and expected value questions, set up cleanly.' },
    { id: 'sizing', label: 'Market sizing', what: 'A sensible structure and a number in the right range.' },
    { id: 'finance', label: 'Finance knowledge', what: 'Payments rails, settlement and risk explained precisely.' },
    { id: 'reasoning', label: 'Reasoning shown', what: 'Working shown and followed through; follow-ups handled.' }
  ],
  behavioural: [
    { id: 'structure', label: 'Structure (STAR)', what: 'Situation, task, action and result, in that order, briefly.' },
    { id: 'ownership', label: 'Ownership', what: 'Clear about what they personally did ("I", not "we").' },
    { id: 'specifics', label: 'Specifics', what: 'Concrete details: systems, numbers, names, decisions.' },
    { id: 'impact', label: 'Impact', what: 'A result, measured where possible.' },
    { id: 'reflection', label: 'Reflection', what: 'What they learned and would do differently; handled the follow-up.' }
  ]
}

/** The rubric for a mock: fixed per kind, and for an exam one item per question */
export function rubricFor(mode: MockMode, paper?: Pick<ExamPaper, 'questions'> | null): RubricItem[] {
  if (mode !== 'exam') return RUBRICS[mode]
  return (paper?.questions ?? []).map((q) => ({ id: `q${q.number}`, label: `Question ${q.number}`, what: q.text.split('\n')[0].slice(0, 100) || q.parts[0]?.text.slice(0, 100) || '' }))
}

// ---------- The clock ----------

export interface MockClock {
  startedAt: number
  minutes: number
}

export const elapsedMs = (c: MockClock, now: number) => Math.max(0, now - c.startedAt)
export const remainingMs = (c: MockClock, now: number) => Math.max(0, c.minutes * 60_000 - elapsedMs(c, now))
export const timeUp = (c: MockClock, now: number) => remainingMs(c, now) === 0

/** The clock's tone: calm, then low in the last five minutes (or last tenth of a short one), then over */
export function clockTone(c: MockClock, now: number): 'calm' | 'low' | 'over' {
  const left = remainingMs(c, now)
  if (left === 0) return 'over'
  return left <= Math.min(5 * 60_000, c.minutes * 6_000 + 60_000) ? 'low' : 'calm'
}

export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export type MockPhase = 'brief' | 'preparing' | 'live' | 'marking' | 'debrief'

/**
 * What the break planner is told while a mock is on screen. During the timed session no break may
 * interrupt it (noBreaks), and the time still counts as study; the brief and the debrief are
 * ordinary practice, where a break may come.
 */
export function mockStudyContext(phase: MockPhase, title: string): { label: string; kind: 'practice'; noBreaks: boolean } {
  return { label: `Mock: ${title}`, kind: 'practice', noBreaks: phase === 'live' || phase === 'preparing' || phase === 'marking' }
}

/** When the interviewer is told about the time: once at ten minutes left, once at five */
export function timeCue(c: MockClock, now: number, told: number[]): number | null {
  const left = remainingMs(c, now) / 60_000
  for (const mark of [10, 5]) if (c.minutes > mark + 5 && left <= mark && !told.includes(mark)) return mark
  return null
}

// ---------- The session ----------

export interface MockTurn {
  role: 'interviewer' | 'candidate'
  text: string
  /** Ms since the start */
  at: number
  /** A hint the candidate asked for (it costs points) */
  hint?: boolean
}

/** Which question of a quant or behavioural mock, with the candidate's answer */
export interface MockAnswer {
  id: string
  text: string
  /** Time spent on it */
  ms: number
  /** Photos of working (exam) */
  images?: string[]
}

export interface RubricScore {
  id: string
  score: number | null
  note: string
  quote?: string
}

export interface MockMoment {
  quote: string
  note: string
}

export interface MockAnnotation {
  node: string
  note: string
}

export interface MockDebrief {
  scores: RubricScore[]
  /** 0..1: the mean of the marked items over 4 */
  overall: number
  moments: MockMoment[]
  modelAnswer: string
  practise: string[]
  summary: string
  verdict?: HireVerdict
  /** Who marked it: Opus, the exam marker (Opus or Gemma per part), or Tide's code */
  by: 'opus' | 'examiner' | 'code'
  /** Opus's notes on the design's components (system design) */
  annotations?: MockAnnotation[]
}

export const half = (x: number) => Math.round(Math.max(0, Math.min(4, x)) * 2) / 2

export function overallOf(scores: RubricScore[]): number {
  const marked = scores.filter((s) => s.score !== null) as (RubricScore & { score: number })[]
  return marked.length ? Math.round((marked.reduce((a, s) => a + s.score, 0) / marked.length / 4) * 1000) / 1000 : 0
}

export function verdictFor(overall: number): HireVerdict {
  return overall >= 0.8 ? 'hire' : overall >= 0.62 ? 'lean hire' : overall >= 0.45 ? 'lean no' : 'no'
}

// ---------- Opus's marks ----------

const VERDICTS: HireVerdict[] = ['hire', 'lean hire', 'lean no', 'no']

function firstObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) return null
  const end = text.lastIndexOf('}')
  const raw = end > start ? text.slice(start, end + 1) : text.slice(start)
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(jsonrepair(raw))
    } catch {
      return null
    }
  }
}

const str = (v: unknown, n = 2000) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/**
 * Opus's marking reply as a debrief, or null when it isn't one. Tolerant: scores matched by id or
 * label, numbers as strings or "3/4", out-of-range scores clamped, an item it skipped left
 * unmarked, moments without a quote dropped.
 */
export function parseMockMarks(text: string, rubric: RubricItem[]): Omit<MockDebrief, 'by'> | null {
  const j = firstObject(text) as Record<string, unknown> | null
  if (!j || typeof j !== 'object') return null
  const raw: Record<string, unknown>[] = Array.isArray(j.scores)
    ? (j.scores as Record<string, unknown>[])
    : j.scores && typeof j.scores === 'object'
      ? Object.entries(j.scores as Record<string, unknown>).map(([id, v]): Record<string, unknown> => (v && typeof v === 'object' ? { id, ...(v as object) } : { id, score: v }))
      : []
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const scores: RubricScore[] = rubric.map((item) => {
    const got = raw.find((r) => r && (norm(str(r.id)) === norm(item.id) || norm(str(r.label ?? r.item ?? r.name)) === norm(item.label)))
    if (!got) return { id: item.id, score: null, note: 'Not marked.' }
    const v = typeof got.score === 'number' ? got.score : Number(String(got.score ?? '').split('/')[0])
    if (!Number.isFinite(v)) return { id: item.id, score: null, note: str(got.note ?? got.why) || 'Not marked.' }
    const quote = str(got.quote ?? got.evidence, 400)
    return { id: item.id, score: half(v), note: str(got.note ?? got.why ?? got.comment, 600), ...(quote ? { quote } : {}) }
  })
  if (scores.every((s) => s.score === null)) return null
  const moments = (Array.isArray(j.moments) ? (j.moments as Record<string, unknown>[]) : [])
    .map((m) => ({ quote: str(m?.quote, 400), note: str(m?.note ?? m?.why, 500) }))
    .filter((m) => m.quote && m.note)
    .slice(0, 6)
  const practise = (Array.isArray(j.practise) ? j.practise : Array.isArray(j.practice) ? j.practice : []).map((p) => str(p, 160)).filter(Boolean).slice(0, 5)
  const v = str(j.verdict).toLowerCase().replace(/\s+/g, ' ')
  const verdict = VERDICTS.find((x) => x === v) ?? (v.startsWith('strong hire') ? 'hire' : v === 'no hire' ? 'no' : undefined)
  const annotations = (Array.isArray(j.annotations) ? (j.annotations as Record<string, unknown>[]) : []).map((a) => ({ node: str(a?.node ?? a?.component, 120), note: str(a?.note, 300) })).filter((a) => a.node && a.note).slice(0, 10)
  const overall = overallOf(scores)
  return {
    scores,
    overall,
    moments,
    modelAnswer: str(j.modelAnswer ?? j.model_answer ?? j.reference, 8000),
    practise,
    summary: str(j.summary, 800),
    verdict: verdict ?? verdictFor(overall),
    ...(annotations.length ? { annotations } : {})
  }
}

/**
 * The design with Opus's notes on it: each note is a note card beside the component it is about
 * (matched by label), linked to it. Notes on a component that isn't there are put at the side.
 */
export function annotateCanvas(canvas: Canvas, notes: MockAnnotation[]): Canvas {
  const ops: Record<string, string>[] = []
  notes.forEach((n, i) => {
    const id = `opus-note-${i + 1}`
    const there = canvas.nodes.some((x) => x.text.split('\n')[0].toLowerCase().includes(n.node.toLowerCase()) || n.node.toLowerCase().includes(x.text.split('\n')[0].toLowerCase()))
    ops.push({ op: 'add', id, label: `${i + 1}. ${n.note}`, kind: 'note', ...(there ? { near: n.node, side: 'below' } : {}) })
    if (there) ops.push({ op: 'connect', from: id, to: n.node })
  })
  return applyCanvasOps(canvas, ops).canvas
}

// ---------- Marked in code (no Claude) ----------

/** How deep the loops go: the deepest for/while inside another, by indentation */
export function loopDepth(code: string): number {
  const stack: number[] = []
  let deepest = 0
  for (const line of code.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    while (stack.length && stack[stack.length - 1] >= indent) stack.pop()
    // A loop statement, or a comprehension (a loop inside brackets)
    if (/^\s*(for|while)\b/.test(line) || /[[({][^\n]*\bfor\b[^\n]*\bin\b/.test(line)) {
      stack.push(indent)
      deepest = Math.max(deepest, stack.length)
    }
  }
  return deepest
}

const bigO = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/·|\*|x(?=[a-z])/g, '').replace(/\^2/g, '²')

/** Did they say the complexity somewhere (a comment, a message), and was it the expected one? */
export function statedComplexity(texts: string[], time: string): 'right' | 'other' | null {
  const said = texts.join('\n').match(/O\([^)]{1,24}\)/gi) ?? []
  if (!said.length) return null
  const want = bigO(time.match(/O\([^)]*\)/i)?.[0] ?? time)
  return said.some((s) => bigO(s) === want) ? 'right' : 'other'
}

/** The longest function's length in non-blank lines, by indentation */
export function longestFunction(code: string): number {
  let best = 0
  let open: { indent: number; lines: number } | null = null
  for (const line of code.split('\n')) {
    if (!line.trim()) continue
    const indent = line.length - line.trimStart().length
    if (open && indent <= open.indent) {
      best = Math.max(best, open.lines)
      open = null
    }
    if (/^\s*def\s/.test(line) && !open) open = { indent, lines: 0 }
    else if (open) open.lines++
  }
  return Math.max(best, open?.lines ?? 0)
}

/** Code quality, roughly, in code: what can be measured without reading it as a person would */
export function qualityInCode(code: string, starter: string): { score: number; notes: string[] } {
  const notes: string[] = []
  const body = code.trim()
  if (!body || body === starter.trim() || /^(def|class)[^\n]*\n\s*pass\s*$/m.test(body.replace(/\n\s*\n/g, '\n')) && body.split('\n').length <= starter.trim().split('\n').length) return { score: 0, notes: ['No solution was written.'] }
  let score = 4
  const lines = body.split('\n')
  if (longestFunction(body) > 35) (score -= 1), notes.push('One function is over 35 lines: split it.')
  const names = [...body.matchAll(/^\s*([a-zA-Z_]\w*)\s*=(?!=)/gm)].map((m) => m[1])
  const vague = [...new Set(names.filter((n) => /^(a|b|d|e|f|g|h|l|o|p|q|s|t|u|v|w|z|tmp|temp|foo|bar|data|res|arr2)$/.test(n)))]
  if (vague.length >= 3) (score -= 1), notes.push(`Vague names: ${vague.slice(0, 4).join(', ')}.`)
  if (lines.some((l) => /^\s*print\(/.test(l)) && !/if __name__/.test(body)) (score -= 0.5), notes.push('Debug prints left in the solution.')
  if (lines.some((l) => l.length > 120)) (score -= 0.5), notes.push('Some lines are over 120 characters.')
  if (/except\s*:/.test(body)) (score -= 0.5), notes.push('A bare except hides real errors.')
  if (!notes.length) notes.push('Nothing stood out to code checks: names, length and structure look tidy.')
  return { score: half(score), notes }
}

export interface CodingFacts {
  problem: Pick<BankProblem, 'title' | 'starter' | 'complexity' | 'hints' | 'tags' | 'reference'>
  code: string
  /** Hidden tests at the end */
  passed: number
  total: number
  failed: string[]
  /** Times they ran the hidden tests during the session */
  runs: number
  hints: number
  /** Everything the candidate said */
  said: string[]
}

const hintScore = (hints: number) => half(4 - 1.5 * hints)

/** A coding mock marked without Claude: the tests decide problem solving; the rest is measured in code */
export function markCodingInCode(f: CodingFacts): MockDebrief {
  const share = f.total ? f.passed / f.total : 0
  const quality = qualityInCode(f.code, f.problem.starter)
  const ownTests = /\bassert\b|def test_|if __name__/.test(f.code)
  const testing = f.runs === 0 ? 0 : Math.min(4, (f.runs >= 2 ? 3 : 2) + (ownTests ? 1 : 0)) - (share < 1 && f.runs > 0 ? 0.5 : 0)
  const depthOk = loopDepth(f.code) <= Math.max(1, loopDepth(f.problem.reference))
  const stated = statedComplexity([f.code, ...f.said], f.problem.complexity.time)
  const complexity = share === 0 ? 0 : (depthOk ? 2 : 0.5) + (stated === 'right' ? 2 : stated === 'other' ? 1 : 0)
  const scores: RubricScore[] = [
    { id: 'problem', score: half(share * 4), note: f.total ? `${f.passed} of ${f.total} hidden tests passed.` : 'Your code was never run against the hidden tests.' },
    { id: 'quality', score: quality.score, note: quality.notes.join(' ') },
    { id: 'communication', score: null, note: 'Needs the interviewer (Claude) to judge.' },
    { id: 'testing', score: half(testing), note: f.runs === 0 ? 'You never ran the tests before ending.' : `You ran the tests ${f.runs} time${f.runs === 1 ? '' : 's'}${ownTests ? ' and wrote checks of your own' : ', but wrote no checks of your own'}.` },
    { id: 'complexity', score: half(complexity), note: `${depthOk ? 'Loop nesting fits' : 'Loops nest deeper than'} ${f.problem.complexity.time}. ${stated === 'right' ? 'You stated it.' : stated === 'other' ? `You stated a different complexity; the expected one is ${f.problem.complexity.time}.` : 'You never stated the complexity: say it out loud, or in a comment.'}` },
    { id: 'hints', score: hintScore(f.hints), note: f.hints ? `${f.hints} hint${f.hints === 1 ? '' : 's'} taken.` : 'No hints.' }
  ]
  const overall = overallOf(scores)
  const weakest = [...scores].filter((s) => s.score !== null).sort((a, b) => a.score! - b.score!)
  const tag = f.problem.tags[0]
  const practise = weakest
    .filter((s) => s.score! < 3)
    .slice(0, 3)
    .map((s) =>
      s.id === 'problem'
        ? `Solve "${f.problem.title}" again from scratch in 25 minutes`
        : s.id === 'testing'
          ? 'Write three edge-case checks before running the hidden tests'
          : s.id === 'complexity'
            ? `State time and space before coding, on two ${tag} problems`
            : s.id === 'hints'
              ? `Two ${tag} problems with no hints for the first 15 minutes`
              : 'Name variables for what they hold; keep each function to one job'
    )
  return {
    scores,
    overall,
    moments: f.failed.slice(0, 3).map((name) => ({ quote: `test ${name}`, note: 'This hidden test failed at the end.' })),
    modelAnswer: `A reference solution, ${f.problem.complexity.time} time:\n\n\`\`\`python\n${f.problem.reference.trim()}\n\`\`\``,
    practise,
    summary: `${f.passed} of ${f.total} tests passed${f.hints ? ` with ${f.hints} hint${f.hints === 1 ? '' : 's'}` : ' with no hints'}. Marked in code: Claude wasn't there to judge how you explained it.`,
    verdict: verdictFor(overall),
    by: 'code'
  }
}

/** Which of a design's checklist points the candidate covered, in the canvas or in what they wrote */
export function designCoverage(d: DesignPrompt, canvas: Canvas, words: string): Record<DesignArea, { covered: string[]; missed: string[] }> {
  const text = `${canvas.nodes.map((n) => n.text).join('\n')}\n${canvas.edges.map((e) => e.label ?? '').join('\n')}\n${words}`.toLowerCase()
  const out = {} as Record<DesignArea, { covered: string[]; missed: string[] }>
  for (const p of d.checklist) {
    const slot = (out[p.area] ??= { covered: [], missed: [] })
    if (p.cues.some((c) => text.includes(c.toLowerCase()))) slot.covered.push(p.point)
    else slot.missed.push(p.point)
  }
  return out
}

export function referenceCanvas(d: DesignPrompt): Canvas {
  return applyCanvasOps({ nodes: [], edges: [] }, d.reference).canvas
}

/** A design mock marked without Claude: checklist coverage per area, and the drawing against the reference */
export function markDesignInCode(d: DesignPrompt, canvas: Canvas, notes: string, said: string[]): MockDebrief {
  const cov = designCoverage(d, canvas, [notes, ...said].join('\n'))
  const cmp = compareDesigns(referenceCanvas(d), canvas)
  const share = (a: DesignArea) => {
    const c = cov[a]
    return c ? c.covered.length / Math.max(1, c.covered.length + c.missed.length) : 0
  }
  const scores: RubricScore[] = RUBRICS.design.map((item) => {
    if (item.needsClaude) return { id: item.id, score: null, note: 'Needs the interviewer (Claude) to judge.' }
    const a = item.id as DesignArea
    const c = cov[a] ?? { covered: [], missed: [] }
    const v = a === 'architecture' ? ((share(a) + cmp.score) / 2) * 4 : share(a) * 4
    const missed = c.missed.length ? ` Missing: ${c.missed.join('; ')}.` : ''
    return { id: item.id, score: half(v), note: `${c.covered.length} of ${c.covered.length + c.missed.length} points covered.${missed}${a === 'architecture' ? ` Your drawing has ${Math.round(cmp.score * 100)}% of the reference's components and connections.` : ''}` }
  })
  const overall = overallOf(scores)
  const missedPoints = (Object.keys(cov) as DesignArea[]).flatMap((a) => cov[a].missed.map((p) => ({ a, p })))
  return {
    scores,
    overall,
    moments: cmp.missing.slice(0, 3).map((m) => ({ quote: m, note: 'In the reference design, not in yours.' })),
    modelAnswer: d.modelAnswer,
    practise: missedPoints.slice(0, 3).map((x) => `${d.title}: ${x.p.charAt(0).toLowerCase()}${x.p.slice(1)}`.slice(0, 150)),
    summary: `You covered ${d.checklist.length - missedPoints.length} of ${d.checklist.length} points a strong answer makes. Marked in code: Claude wasn't there to probe or judge your reasoning.`,
    verdict: verdictFor(overall),
    by: 'code'
  }
}

/** A quant mock marked in code: each answer checked (numbers, ranges, the points a concept answer makes) */
export function markQuantInCode(questions: QuantQuestion[], answers: MockAnswer[]): MockDebrief {
  const got = new Map(answers.map((a) => [a.id, a]))
  const marks = questions.map((q) => ({ q, a: got.get(q.id), m: markQuant(q, got.get(q.id)?.text ?? '') }))
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const of = (kinds: QuantQuestion['kind'][]) => marks.filter((x) => kinds.includes(x.q.kind))
  const mental = of(['mental'])
  const slow = mental.filter((x) => x.a && x.a.ms > x.q.target * 2000).length
  const mentalScore = mean(mental.map((x) => x.m.score))
  const prob = of(['probability', 'ev'])
  const sizing = of(['sizing'])
  const finance = of(['finance'])
  const worked = [...prob, ...sizing].filter((x) => (x.a?.text ?? '').trim().split(/\s+/).length >= 6 || /[=×*/+]/.test(x.a?.text ?? '')).length
  const line = (xs: typeof marks) => `${xs.filter((x) => x.m.verdict === 'right').length} of ${xs.length} right`
  const scores: RubricScore[] = [
    { id: 'mental', score: mentalScore === null ? null : half(mentalScore * 4 - (slow > mental.length / 2 ? 0.5 : 0)), note: mental.length ? `${line(mental)}${slow ? `; ${slow} took over twice the target time` : ''}.` : 'None asked.' },
    { id: 'probability', score: prob.length ? half(mean(prob.map((x) => x.m.score))! * 4) : null, note: prob.length ? `${line(prob)}.` : 'None asked.' },
    { id: 'sizing', score: sizing.length ? half(mean(sizing.map((x) => x.m.score))! * 4) : null, note: sizing.length ? sizing.map((x) => (x.m.verdict === 'right' ? 'In the right range.' : x.m.verdict === 'close' ? 'Within an order of magnitude.' : 'Off by more than an order of magnitude, or no number.')).join(' ') : 'None asked.' },
    { id: 'finance', score: finance.length ? half(mean(finance.map((x) => x.m.score))! * 4) : null, note: finance.length ? `Covered ${finance.reduce((n, x) => n + (x.m.covered?.length ?? 0), 0)} of ${finance.reduce((n, x) => n + (x.q.points?.length ?? 0), 0)} key points.` : 'None asked.' },
    { id: 'reasoning', score: prob.length + sizing.length ? half((worked / (prob.length + sizing.length)) * 4) : null, note: `Working shown on ${worked} of ${prob.length + sizing.length} problems.` }
  ]
  const overall = overallOf(scores)
  const missed = marks.filter((x) => x.m.verdict !== 'right')
  return {
    scores,
    overall,
    moments: missed.slice(0, 4).map((x) => ({ quote: `${x.q.prompt.slice(0, 120)} — you said: ${(x.a?.text ?? '').trim().slice(0, 80) || 'nothing'}`, note: x.q.solution })),
    modelAnswer: marks.map((x, i) => `**${i + 1}. ${x.q.prompt}**\n\n${x.q.solution}`).join('\n\n'),
    practise: [...new Set(missed.map((x) => QUANT_TOPIC[x.q.kind]))].slice(0, 3).map((t) => `${t}: five more questions, timed`),
    summary: `${marks.filter((x) => x.m.verdict === 'right').length} of ${marks.length} right. Marked in code: no follow-up questions without Claude.`,
    verdict: verdictFor(overall),
    by: 'code'
  }
}

export const QUANT_TOPIC: Record<QuantQuestion['kind'], string> = { mental: 'Mental maths', probability: 'Probability', ev: 'Expected value', sizing: 'Market sizing', finance: 'Payments and finance' }

/** A behavioural mock marked in code: STAR parts, "I" against "we", numbers, a result, reflection */
export function markBehaviouralInCode(questions: BehaviouralQuestion[], answers: MockAnswer[]): MockDebrief {
  const per = questions.map((q) => {
    const text = answers.filter((a) => a.id === q.id || a.id.startsWith(`${q.id}:`)).map((a) => a.text).join('\n')
    const words = text.trim().split(/\s+/).filter(Boolean)
    const star = starParts(text)
    const i = (text.match(/\bI\b|\bI'(m|ve|d)\b|\bmy\b/g) ?? []).length
    const we = (text.match(/\bwe\b|\bour\b|\bthe team\b/gi) ?? []).length
    const numbers = (text.match(/\b\d[\d,.]*\s?(%|ms|s|k|m|x|hours?|days?|weeks?|users?|people|requests?)?/gi) ?? []).length
    const reflect = /\b(learn(ed|t)|differently|next time|in hindsight|would now|lesson)\b/i.test(text)
    return { q, text, words: words.length, star, i, we, numbers, reflect }
  })
  const mean = (f: (x: (typeof per)[number]) => number) => (per.length ? per.reduce((a, x) => a + f(x), 0) / per.length : 0)
  const scores: RubricScore[] = [
    { id: 'structure', score: half(mean((x) => Object.values(x.star).filter(Boolean).length - (x.words > 450 ? 0.5 : 0) - (x.words < 60 ? 1 : 0))), note: per.map((x, k) => `Answer ${k + 1}: ${(['situation', 'task', 'action', 'result'] as const).filter((p) => !x.star[p]).join(', ') || 'all four parts'}${(['situation', 'task', 'action', 'result'] as const).some((p) => !x.star[p]) ? ' missing' : ''}, ${x.words} words.`).join(' ') },
    { id: 'ownership', score: half(mean((x) => (x.i + x.we === 0 ? 0 : (x.i / (x.i + x.we)) * 4))), note: `"I" ${per.reduce((a, x) => a + x.i, 0)} times, "we" ${per.reduce((a, x) => a + x.we, 0)} times.` },
    { id: 'specifics', score: half(mean((x) => Math.min(4, x.numbers + (x.words > 120 ? 1 : 0)))), note: `${per.reduce((a, x) => a + x.numbers, 0)} numbers or measures across your answers.` },
    { id: 'impact', score: half(mean((x) => (x.star.result ? 2 : 0) + Math.min(2, x.numbers / 2))), note: per.filter((x) => x.star.result).length === per.length ? 'Every answer ended on a result.' : `${per.filter((x) => !x.star.result).length} answer(s) never said how it turned out.` },
    { id: 'reflection', score: half(mean((x) => (x.reflect ? 4 : 1))), note: per.some((x) => x.reflect) ? 'You said what you learned in at least one answer.' : 'No answer said what you learned or would change.' }
  ]
  const overall = overallOf(scores)
  return {
    scores,
    overall,
    moments: per.filter((x) => x.text.trim()).slice(0, 3).map((x) => ({ quote: x.text.trim().split(/(?<=[.!?])\s/)[0].slice(0, 200), note: `How you opened "${x.q.prompt.slice(0, 60)}…"` })),
    modelAnswer: 'A strong STAR answer in about two minutes: **Situation** in one or two sentences; **Task**, what you had to achieve; **Action**, most of the time, in "I" not "we", with the decisions and why; **Result**, measured ("cut p99 latency from 800 ms to 120 ms"); then one line on what you learned.',
    practise: scores.filter((s) => (s.score ?? 4) < 3).slice(0, 3).map((s) => (s.id === 'ownership' ? 'Retell a story saying "I" for what you did' : s.id === 'impact' || s.id === 'specifics' ? 'Add one measured result to each of your stories' : s.id === 'reflection' ? 'End each story with what you would change' : 'Write three stories as four STAR lines each')),
    summary: `Marked in code from the words you used. With Claude, the interviewer asks follow-ups and Opus marks how convincing the stories are.`,
    verdict: verdictFor(overall),
    by: 'code'
  }
}

/** A mock exam's debrief from the marker's per-part marks */
export function examDebrief(paper: ExamPaper, marks: Record<string, ExamMark>): MockDebrief {
  const key = (q: number, p: number) => `${q}:${p}`
  const scores: RubricScore[] = paper.questions.map((q) => {
    const parts = q.parts.map((_, i) => marks[key(q.number, i)]).filter(Boolean)
    const got = parts.reduce((n, m) => n + m.awarded, 0)
    const of = q.parts.reduce((n, p) => n + p.marks, 0)
    return { id: `q${q.number}`, score: of ? half((got / of) * 4) : null, note: `${got} of ${of} marks.` }
  })
  const lost = paper.questions.flatMap((q) => q.parts.map((p, i) => ({ q, p, m: marks[key(q.number, i)] }))).filter((x) => x.m && x.m.awarded < x.m.marks)
  const got = Object.values(marks).reduce((n, m) => n + m.awarded, 0)
  const total = paper.questions.reduce((n, q) => n + q.parts.reduce((k, p) => k + p.marks, 0), 0)
  return {
    scores,
    overall: total ? Math.round((got / total) * 1000) / 1000 : 0,
    moments: lost.slice(0, 4).map((x) => ({ quote: `${x.q.number}(${x.p.label}) ${x.p.text.slice(0, 120)}`, note: x.m.feedback })),
    modelAnswer: lost.map((x) => `**${x.q.number}(${x.p.label})** ${x.p.scheme}`).join('\n\n') || 'Full marks: nothing to show.',
    practise: lost.map((x) => x.m.missed).filter(Boolean).slice(0, 4).map((m) => m.slice(0, 150)),
    summary: `${got} of ${total} marks (${total ? Math.round((got / total) * 100) : 0}%).`,
    by: 'examiner'
  }
}

// ---------- The interviewer (Sonnet) ----------

const INTERVIEWER_RULES = `How you behave:
- Short replies: one to four sentences. One question at a time. Never lecture.
- Plain text. Inline code in backticks is fine; no headings, no bullet lists.
- Never reveal anything marked hidden below, and never write the candidate's solution for them.
- Answer clarifying questions precisely. If the brief doesn't say, choose something sensible and say what you chose.
- Nudge like a real interviewer when they are stuck or heading the wrong way: a question that points somewhere, not the answer.
- A message that starts with [hint] is the candidate asking for a hint: give exactly the next hint on the ladder, in your own words, and say that hints cost a little.
- A message that starts with [time] tells you how long is left: pass it on in a few words, and at five minutes ask them to wrap up.
- Each message shows the minutes so far and left, and what they have built so far. Use it; don't repeat it back.
- When they say they are done, ask one follow-up that fits, then tell them they can end the interview.`

export interface InterviewerSetup {
  mode: Exclude<MockMode, 'exam'>
  minutes: number
  problem?: Pick<BankProblem, 'title' | 'prompt' | 'examples' | 'reference' | 'complexity' | 'hints' | 'followUps'>
  design?: DesignPrompt
  quant?: QuantQuestion[]
  behavioural?: BehaviouralQuestion[]
}

/** The interviewer's system prompt: the persona, the rules, and the material (with what is hidden marked so) */
export function interviewerSystem(s: InterviewerSetup): string {
  if (s.mode === 'coding' && s.problem) {
    const p = s.problem
    return `You are a senior software engineer at a fintech, running a live ${s.minutes}-minute coding interview in Python. Stay in role for the whole interview.

${INTERVIEWER_RULES}
- Coding: before they code, ask them to talk through their approach and its time and space complexity. When their code works, ask about edge cases and how they would test it.

The problem (the candidate sees this):
${p.title}. ${p.prompt}
Examples: ${p.examples.join('; ')}

Hidden, for you only:
Reference solution:
${p.reference.trim()}
Expected complexity: ${p.complexity.time} time, ${p.complexity.space} space.
Hint ladder, in order: ${p.hints.map((h, i) => `(${i + 1}) ${h}`).join(' ')}
Follow-ups: ${p.followUps.join(' ')}`
  }
  if (s.mode === 'design' && s.design) {
    const d = s.design
    return `You are a staff engineer at a fintech, running a live ${s.minutes}-minute system design interview. The candidate draws on a canvas you can see as a list of components and connections. Stay in role for the whole interview.

${INTERVIEWER_RULES}
- System design: let them drive. Start by asking what they would clarify. Then probe, one area at a time as the design reaches it: requirements, scale (make them put numbers on it), consistency, idempotency and failure modes. Push on vague answers ("what exactly happens when…?").

The brief (the candidate sees this): ${d.title}. ${d.brief}

Hidden, for you only:
Probes: ${d.probes.map((p) => `[${p.area}] ${p.question}`).join(' ')}
What a strong answer covers: ${d.checklist.map((c) => c.point).join('; ')}.`
  }
  if (s.mode === 'quant' && s.quant) {
    return `You are a trader at a quantitative trading firm, running a live ${s.minutes}-minute quant and finance interview. Stay in role for the whole interview.

${INTERVIEWER_RULES}
- Quant: the questions are shown to the candidate one at a time and Tide checks numeric answers itself. After each answer you see the question, their answer and Tide's check. Reply with one short follow-up: ask how they got it when the reasoning matters, push on a wrong answer without giving it away ("check the case where…"), or give a harder variant. Never state the correct answer to a question they got wrong; that comes at the debrief.

Hidden, the questions and worked answers:
${s.quant.map((q, i) => `${i + 1}. ${q.prompt} — ${q.solution}`).join('\n')}`
  }
  const qs = s.behavioural ?? []
  return `You are a hiring manager at a fintech, running a ${s.minutes}-minute behavioural interview. Stay in role, warm but probing.

${INTERVIEWER_RULES}
- Behavioural: the candidate answers each question shown to them. After an answer, ask exactly one follow-up that probes what they personally did, a number behind the result, or what they would change. If their story has no clear result, ask for it.

The questions, with what you are listening for (hidden):
${qs.map((q, i) => `${i + 1}. ${q.prompt} — listen for: ${q.probes} A follow-up: ${q.followUp}`).join('\n')}`
}

export interface MomentState {
  elapsedMin: number
  leftMin: number
  code?: string
  canvas?: Canvas
  notes?: string
  tests?: { passed: number; total: number; failed: string[] } | null
  /** Quant or behavioural: the question on screen, and Tide's check of the answer */
  question?: string
  check?: string
}

/** One message to the interviewer: the state of the room, then what the candidate said */
export function interviewerMessage(said: string, st: MomentState): string {
  const head = `[${Math.round(st.elapsedMin)} min in, ${Math.max(0, Math.round(st.leftMin))} left]`
  const parts = [head]
  if (st.tests) parts.push(`[Hidden tests on their last run: ${st.tests.passed} of ${st.tests.total} passed${st.tests.failed.length ? `; failing: ${st.tests.failed.slice(0, 4).join(', ')}` : ''}]`)
  if (st.code !== undefined) parts.push(`Their code now:\n\`\`\`python\n${st.code.slice(0, 6000)}\n\`\`\``)
  if (st.canvas) parts.push(`Their canvas now:\n${describeCanvas(st.canvas)}`)
  if (st.notes?.trim()) parts.push(`Their notes:\n${st.notes.trim().slice(0, 2000)}`)
  if (st.question) parts.push(`Question on screen: ${st.question}`)
  if (st.check) parts.push(`Tide's check of their answer: ${st.check}`)
  parts.push(said.startsWith('[') ? said : `They say: "${said}"`)
  return parts.join('\n\n')
}

/** The whole conversation so far as one prompt (each call to Sonnet is stateless; the system prompt stays the same, so it is cached) */
export function interviewerPrompt(turns: { role: 'interviewer' | 'candidate'; text: string }[], next: string): string {
  const past = turns.map((t) => `${t.role === 'interviewer' ? 'You (interviewer)' : 'Candidate'}: ${t.text}`).join('\n\n')
  return `${past ? `The interview so far:\n\n${past}\n\n---\n\n` : ''}${next}\n\nReply as the interviewer, in a few sentences.`
}

/** What opens the interview, sent as the first message */
export function openingMessage(mode: Exclude<MockMode, 'exam'>): string {
  if (mode === 'coding') return '[start] The candidate has just read the problem. Greet them in one line and invite clarifying questions before they start.'
  if (mode === 'design') return '[start] The candidate has just read the brief. Greet them in one line and ask what they would like to clarify first.'
  if (mode === 'quant') return '[start] Greet the candidate in one line and tell them to begin with the first question on screen.'
  return '[start] Greet the candidate in one line and ask them to start with the first question on screen.'
}

// ---------- The marker (Opus) ----------

export const MARKER_SYSTEM = `You mark a mock interview as a fair, strict hiring panel would, for the candidate's own practice. Score each rubric item from 0 to 4 (0 nothing shown, 1 weak, 2 mixed, 3 good, 4 excellent; halves allowed). Base every score on evidence from the transcript or their work, and quote it. Facts Tide measured (tests passed, hints taken, times) are facts: follow them. The candidate reads the notes: write them to the candidate as "you". Reply with JSON only.`

export function markerPrompt(o: { mode: Exclude<MockMode, 'exam'>; title: string; rubric: RubricItem[]; material: string; facts: string[]; transcript: MockTurn[]; work: string; minutes: number }): string {
  const t = o.transcript.map((x) => `[${Math.floor(x.at / 60_000)}:${String(Math.floor((x.at % 60_000) / 1000)).padStart(2, '0')}] ${x.role === 'interviewer' ? 'Interviewer' : 'Candidate'}${x.hint ? ' (asked for a hint)' : ''}: ${x.text}`).join('\n')
  return `A ${o.minutes}-minute mock ${o.mode} interview: ${o.title}.

Rubric (id: what a 4 looks like):
${o.rubric.map((r) => `- ${r.id} (${r.label}): ${r.what}`).join('\n')}

The material:
${o.material}

Measured by Tide:
${o.facts.map((f) => `- ${f}`).join('\n') || '- nothing'}

Transcript:
${t || '(nothing was said)'}

Their final work:
${o.work || '(nothing)'}

Return ONLY JSON:
{"scores": [{"id": "<rubric id>", "score": 0-4, "note": "one or two sentences: why this score", "quote": "their exact words or code that shows it"}],
 "moments": [{"quote": "exact words from the transcript or their work", "note": "why this moment mattered, for better or worse"}],
 "modelAnswer": "Markdown: what a strong candidate would have done or written${o.mode === 'coding' ? ', with the reference solution in a ```python block' : ''}",
 "practise": ["a specific thing to practise next, under 15 words"],
 "summary": "two sentences: how it went and the one thing to change",
 "verdict": "hire" | "lean hire" | "lean no" | "no"${o.mode === 'design' ? `,
 "annotations": [{"node": "the exact label of one of their components", "note": "what is right or wrong about it, under 25 words"}]` : ''}}
Give 2 to 4 moments, 2 to 4 things to practise${o.mode === 'design' ? ' and up to 6 annotations' : ''}. Score every rubric item.`
}

// ---------- What a debrief feeds ----------

const today = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** Small changes to the learner profile, made by code: a strong rubric item is a strength, a weak one didn't land, hints are noted */
export function profileOps(o: { mode: MockMode; title: string; debrief: MockDebrief; rubric: RubricItem[]; hints?: number; at: number }): ProfileOp[] {
  const label = (id: string) => o.rubric.find((r) => r.id === id)?.label ?? id
  const kind = modeInfo(o.mode).label.toLowerCase().replace(/^mock /, '')
  const marked = o.debrief.scores.filter((s) => s.score !== null) as (RubricScore & { score: number })[]
  const strong = marked.filter((s) => s.score >= 3.5).sort((a, b) => b.score - a.score)[0]
  const weak = marked.filter((s) => s.score <= 1.5).sort((a, b) => a.score - b.score).slice(0, 2)
  const ops: ProfileOp[] = []
  if (strong) ops.push({ do: 'add', section: 'strengths', text: `${label(strong.id)} in a mock ${kind} (${o.title}, ${strong.score}/4, ${today(o.at)})` })
  for (const w of weak) ops.push({ do: 'add', section: 'missed', text: `${label(w.id)} in a mock ${kind}: ${w.score}/4 (${o.title}, ${today(o.at)})` })
  if ((o.hints ?? 0) >= 2) ops.push({ do: 'add', section: 'hints', text: `Took ${o.hints} hints in a mock ${kind} (${o.title}, ${today(o.at)})` })
  return ops.slice(0, 3)
}

/** Questions to come back in a later lesson on their topic (recall): what was missed, as questions */
export function recallFrom(o: { mode: MockMode; title: string; debrief: MockDebrief; problem?: Pick<BankProblem, 'title' | 'complexity' | 'tags'>; design?: DesignPrompt; quant?: { q: QuantQuestion; right: boolean }[]; exam?: { topic: string; missed: string[] } }): { prompt: string; topic: string }[] {
  const low = (id: string) => (o.debrief.scores.find((s) => s.id === id)?.score ?? 4) < 2.5
  if (o.mode === 'coding' && o.problem && (low('problem') || low('complexity')))
    return [{ prompt: `How do you solve "${o.problem.title}" in ${o.problem.complexity.time}? Say the idea in two sentences.`, topic: tagTopic(o.problem.tags[0]) }]
  if (o.mode === 'design' && o.design)
    return o.design.probes
      .filter((p) => low(p.area))
      .slice(0, 2)
      .map((p) => ({ prompt: `${o.design!.title}: ${p.question}`, topic: 'System design' }))
  if (o.mode === 'quant' && o.quant)
    return o.quant
      .filter((x) => !x.right && x.q.kind !== 'mental')
      .slice(0, 3)
      .map((x) => ({ prompt: x.q.prompt, topic: QUANT_TOPIC[x.q.kind] }))
  if (o.mode === 'exam' && o.exam) return o.exam.missed.slice(0, 4).map((prompt) => ({ prompt, topic: o.exam!.topic }))
  return []
}

const tagTopic = (t?: string) => (t === 'dp' ? 'Dynamic programming' : t === 'graphs' ? 'Graph algorithms' : t === 'system' || t === 'payments' ? 'Systems coding' : t ? `${t[0].toUpperCase()}${t.slice(1)}` : 'Coding interviews')

export const ROADMAP_NOTE = 'Coach/Mock practice.md'

const ROADMAP_HEAD = '# Mock practice\n\nWhat to practise next, from your mock interviews and exams. Tide adds to it after each debrief; tick things off as you do them.\n'

/** The practice roadmap note with new items added under the mock's heading, leaving out any already there (ticked or not) */
export function mergeRoadmap(existing: string, section: string, items: string[], from: string): string {
  let text = existing.trim() ? existing.replace(/\s*$/, '\n') : ROADMAP_HEAD
  const have = new Set([...text.matchAll(/^\s*- \[[ xX]\] (.+?)(?: _\(.*\)_)?\s*$/gm)].map((m) => m[1].trim().toLowerCase()))
  const fresh = [...new Set(items.map((i) => i.trim()).filter(Boolean))].filter((i) => !have.has(i.toLowerCase()))
  if (!fresh.length) return text
  const lines = fresh.map((i) => `- [ ] ${i} _(${from})_`)
  const heading = `## ${section}`
  const at = text.split('\n').findIndex((l) => l.trim() === heading)
  if (at < 0) return `${text.replace(/\n*$/, '\n')}\n${heading}\n\n${lines.join('\n')}\n`
  const all = text.split('\n')
  // The end of the section: the next heading, or the end
  let end = all.findIndex((l, i) => i > at && /^#{1,2} /.test(l))
  if (end < 0) end = all.length
  while (end > at + 1 && !all[end - 1].trim()) end--
  all.splice(end, 0, ...lines)
  text = all.join('\n')
  return text.endsWith('\n') ? text : `${text}\n`
}

/**
 * The mock as a lesson record (mode "interview"), so the teaching measures and the knowledge map
 * read it like any lesson: the conversation, then each marked item as a question, the answer and
 * a grade, with the hints taken before it.
 */
export function mockLesson(o: { id: string; mode: MockMode; title: string; started: number; transcript: MockTurn[]; graded: { question: string; answer: string; score: number; note: string; hints?: number }[] }): Omit<LessonRecord, 'updated' | 'page'> {
  const turns: LessonTurn[] = [{ role: 'user', content: `A timed mock ${modeInfo(o.mode).label.toLowerCase()}: ${o.title}.` }]
  for (const t of o.transcript) {
    if (t.hint) continue
    turns.push({ role: t.role === 'interviewer' ? 'assistant' : 'user', content: t.text })
  }
  for (const g of o.graded) {
    turns.push({ role: 'assistant', content: `<ask type="short">${g.question.slice(0, 600)}</ask>` })
    for (let i = 0; i < (g.hints ?? 0); i++) {
      turns.push({ role: 'user', content: '[hint] (asked for a hint)' })
      turns.push({ role: 'assistant', content: `A hint.\n<ask type="short">${g.question.slice(0, 600)}</ask>` })
    }
    turns.push({ role: 'user', content: `Answer: ${g.answer.trim().slice(0, 4000) || '(no answer)'}` })
    const verdict = g.score >= 0.8 ? 'correct' : g.score >= 0.4 ? 'partial' : 'wrong'
    turns.push({ role: 'assistant', content: `<grade verdict="${verdict}" score="${Math.round(g.score * 100) / 100}">${g.note.replace(/[<>]/g, '').slice(0, 400)}</grade>` })
  }
  return { id: o.id, mode: 'interview', topic: `Mock ${modeInfo(o.mode).short.toLowerCase()}: ${o.title}`, scope: { kind: 'none' }, turns, started: o.started, finished: true }
}

// ---------- History ----------

export interface MockRecord {
  id: string
  at: number
  mode: MockMode
  title: string
  minutes: number
  /** Minutes actually used */
  used: number
  overall: number
  scores: Record<string, number | null>
  hints: number
  by: MockDebrief['by']
  verdict?: HireVerdict
  /** The bank problem or design prompt */
  ref?: string
}

export function recordOf(o: { id: string; at: number; mode: MockMode; title: string; minutes: number; usedMs: number; debrief: MockDebrief; hints: number; ref?: string }): MockRecord {
  return {
    id: o.id,
    at: o.at,
    mode: o.mode,
    title: o.title.slice(0, 120),
    minutes: o.minutes,
    used: Math.round(o.usedMs / 60_000),
    overall: o.debrief.overall,
    scores: Object.fromEntries(o.debrief.scores.map((s) => [s.id, s.score])),
    hints: o.hints,
    by: o.debrief.by,
    ...(o.debrief.verdict ? { verdict: o.debrief.verdict } : {}),
    ...(o.ref ? { ref: o.ref } : {})
  }
}

/** The history for a chart: one kind (or all), oldest first, at most the last n */
export function trendPoints(records: MockRecord[], mode: MockMode | 'all', n = 20): { at: number; score: number; title: string; mode: MockMode }[] {
  return records
    .filter((r) => mode === 'all' || r.mode === mode)
    .sort((a, b) => a.at - b.at)
    .slice(-n)
    .map((r) => ({ at: r.at, score: r.overall, title: r.title, mode: r.mode }))
}

export function trendSummary(records: MockRecord[], mode: MockMode | 'all'): { count: number; last: number | null; best: number | null; change: number | null } {
  const pts = trendPoints(records, mode, 1000)
  if (!pts.length) return { count: 0, last: null, best: null, change: null }
  const last = pts[pts.length - 1].score
  return { count: pts.length, last, best: Math.max(...pts.map((p) => p.score)), change: pts.length > 1 ? Math.round((last - pts[pts.length - 2].score) * 1000) / 1000 : null }
}

/** The average of each rubric item over the last few mocks of a kind: where it is consistently weak */
export function rubricAverages(records: MockRecord[], mode: Exclude<MockMode, 'exam'>, n = 5): { id: string; label: string; mean: number | null }[] {
  const recent = records.filter((r) => r.mode === mode).sort((a, b) => a.at - b.at).slice(-n)
  return RUBRICS[mode].map((item) => {
    const xs = recent.map((r) => r.scores[item.id]).filter((x): x is number => typeof x === 'number')
    return { id: item.id, label: item.label, mean: xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null }
  })
}

// ---------- The mock exam's topics ----------

/**
 * What a mock exam is set on: topics studied recently and lately weak, from the lessons, the
 * knowledge map and courses in progress. Recent lessons count most; a weak concept counts more than a strong one.
 */
export function examTopics(o: { lessons: { topic: string; updated: number; mode?: string }[]; concepts?: { name: string; mastery: number }[]; courses?: string[]; now: number }, n = 4): string[] {
  const score = new Map<string, { label: string; s: number }>()
  const add = (label: string, s: number) => {
    const clean = label.replace(/^(mock \w+:|quiz:|review:)\s*/i, '').trim()
    if (!clean) return
    const key = clean.toLowerCase()
    const cur = score.get(key)
    score.set(key, { label: cur?.label ?? clean, s: (cur?.s ?? 0) + s })
  }
  for (const l of o.lessons) {
    if (l.mode === 'interview') continue
    const days = (o.now - l.updated) / 86_400_000
    if (days > 60) continue
    add(l.topic, 1 / (1 + days / 7))
  }
  for (const c of o.concepts ?? []) add(c.name, (1 - Math.max(0, Math.min(1, c.mastery))) * 0.8)
  for (const c of o.courses ?? []) add(c, 0.5)
  return [...score.values()].sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.label)
}

/** The topic line the exam writer gets */
export const examTopicLine = (topics: string[]) => (topics.length ? `what I have been studying: ${topics.join('; ')}` : '')
