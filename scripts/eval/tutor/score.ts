/**
 * The automatic scorer: what a tutor reply did, judged against a scenario's expectations with no
 * model involved. Five things, each reported on its own:
 *
 *   protocol   the tags the app turns into the lesson are present and well formed, the reply ends
 *              the way it should (one question, or <continue/>), nothing is asked in plain text,
 *              a problem comes with its hidden <solution>, and no answer sits inside a question
 *   marking    the verdict matches the truth (the number that matters most), and the feedback
 *              names the planted error or the stated misconception
 *   exactness  the values, formulae and terms the scenario supplies appear, and wrong ones don't
 *   pace       the reply is as long as the situation calls for
 *   visual     the kind of picture asked for is there and would draw
 *
 * It reads replies with the app's own parsers (parseBlocks, hideWorking, solutionOf, the sim and
 * chart block parsers), so "well formed" means what the app would accept.
 *
 * And it scores what the learner would see, not the raw completion: the app's own repairs are
 * applied first (shared/modelText's cleaning; a closing question in plain text becomes the ask, as
 * parseBlocks makes it; a mark on what wasn't an answer taken off and an unclosed grade closed, as
 * lessonRepair does; a problem with no <solution> gets one worked out, as lessonGuard does; a json
 * block that is a simulation is drawn as one). Each repair that was needed is listed in
 * `repaired`, so a model that stops needing them still shows as better. Stalls and loops need the
 * model again, so they are handled before this, by turn.ts.
 */
import { parseChartRequest } from '../../../src/shared/lab'
import { setsProblem, solutionOf, type Verdict } from '../../../src/shared/lessonCheck'
import { repairReply } from '../../../src/shared/lessonRepair'
import { cleanModelText } from '../../../src/shared/modelText'
import { hideWorking, parseBlocks, type Block } from '../../../src/shared/session'
import { isSimSource } from '../../../src/shared/sims'
import { parseSim } from '../../../src/renderer/src/lib/sims/spec'
import { learnerText } from './request'
import type { Expect, Scenario, Tag, Turn, Visual } from './types'

export interface Check {
  id: string
  ok: boolean
  why?: string
}

export interface Marking {
  score: 0 | 1
  expected: Verdict
  got: Verdict | 'none'
  /** Something not right marked "correct": the costly mistake */
  falseCorrect: boolean
  /** A right answer marked down */
  rejectedRight: boolean
  /** The feedback names the planted error or misconception; null when the scenario names none */
  named: boolean | null
}

export interface Score {
  protocol: { score: number; checks: Check[] }
  marking: Marking | null
  exactness: { score: number; checks: Check[] } | null
  pace: { score: number; words: number; min: number; max: number }
  visual: { score: 0 | 1; found: string[]; why?: string } | null
  /** The mean of the parts that apply */
  overall: number
  /** Every deterministic expectation met */
  pass: boolean
  failed: string[]
  /** What the app had to put right before the learner saw it: "ask" (a plain closing question made the ask), "grade" (a mark on what wasn't an answer, taken off), "close" (an unclosed grade closed), "solution" (worked out for a problem set without one), "sim" (a simulation in a block labelled json) */
  repaired: string[]
}

/** A reply may run this far past its bound before it counts: a handful of words is not a pace fault */
export const PACE_GRACE = 0.1

const ASK_TYPES = ['predict', 'short', 'choice', 'explain', 'error', 'problem', 'code']
const PAIRED: Tag[] = ['ask', 'grade', 'plan', 'card', 'note', 'summary', 'solution', 'check']

const FENCE = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g

/** Fenced blocks by language, lower-cased */
export function fences(text: string): { lang: string; body: string }[] {
  return [...text.matchAll(FENCE)].map((m) => ({ lang: m[1].toLowerCase(), body: m[2] }))
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.\-/^=+*]*/gu) ?? []).length
const safe = (pattern: string) => new RegExp(pattern, 'i')

/** What the learner reads: text, question, feedback, notes and cards, without hidden working */
export function readableText(blocks: Block[], opts: { notes?: boolean; asks?: boolean } = {}): string {
  const { notes = true, asks = true } = opts
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'text':
        case 'summary':
          return b.text
        case 'ask':
          return asks ? [b.prompt, ...b.options].join('\n') : ''
        case 'grade':
          return b.text
        case 'note':
          return notes ? b.text : ''
        case 'card':
          return notes ? `${b.front} :: ${b.back}` : ''
        case 'plan':
          return b.steps.join('\n')
        case 'challenge':
          return b.text
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

/** The words that count for pace: prose, question and feedback; not code, diagrams, tables, notes or working */
export function paceWords(reply: string): number {
  const blocks = parseBlocks(reply.replace(FENCE, ' '))
  // A table is a picture too: its rows aren't prose
  const prose = readableText(blocks, { notes: false }).split('\n').filter((l) => (l.match(/\|/g) ?? []).length < 2).join('\n')
  return words(prose.replace(/\$\$[\s\S]*?\$\$/g, ' x '))
}

/** How long a reply may be when the scenario doesn't say */
export function defaultWords(s: Pick<Scenario, 'situation' | 'setup'>): { min: number; max: number } {
  const roomy = s.setup.options?.why ? 1.5 : 1
  if (s.situation === 'show-me') return { min: 0, max: 90 }
  if (s.situation === 'recall-open') return { min: 0, max: 90 }
  if (s.situation === 'open') return { min: 40, max: Math.round(260 * roomy) }
  return { min: 0, max: Math.round(230 * roomy) }
}

function mermaidKind(body: string): string | null {
  const first = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%') && l !== '---' && !/^(title|config)\s*:/.test(l)) ?? ''
  if (/^(flowchart|graph)\b/i.test(first)) return 'flowchart'
  if (/^sequenceDiagram\b/.test(first)) return 'sequenceDiagram'
  if (/^stateDiagram(-v2)?\b/.test(first)) return 'stateDiagram'
  if (/^mindmap\b/.test(first)) return 'mindmap'
  if (/^(classDiagram|erDiagram|gantt|timeline|pie|journey|gitGraph|quadrantChart|xychart-beta)\b/.test(first)) return first.split(/\s/)[0]
  return null
}

/** A Markdown table with a header, its rule and at least two rows */
export function hasTable(text: string): boolean {
  const lines = text.replace(FENCE, '').split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i]) || !lines[i - 1].includes('|')) continue
    let rows = 0
    for (let k = i + 1; k < lines.length && lines[k].includes('|'); k++) rows++
    if (rows >= 2) return true
  }
  return false
}

function scoreVisual(want: Visual, reply: string): NonNullable<Score['visual']> & { relabelled?: boolean } {
  const visible = hideWorking(reply)
  const blocks = fences(visible)
  const found: string[] = []
  let relabelled = false
  for (const b of blocks) {
    if (b.lang === 'mermaid') found.push(`mermaid:${mermaidKind(b.body) ?? 'unknown'}`)
    // The app draws a block by what it holds: a simulation labelled json (or nothing) is still one
    else if (isSimSource(b.lang, b.body)) {
      found.push(`sim:${parseSim(b.body)?.kind ?? 'invalid'}`)
      relabelled ||= b.lang !== 'sim'
    }
    else if (b.lang === 'chart') found.push(`chart:${'error' in parseChartRequest(b.body) ? 'invalid' : 'ok'}`)
  }
  if (hasTable(visible)) found.push('table')
  const fail = (why: string) => ({ score: 0 as const, found, why })
  if (want.kind === 'mermaid') {
    const kinds = found.filter((f) => f.startsWith('mermaid:')).map((f) => f.slice(8))
    if (!kinds.length) return fail('no mermaid diagram')
    if (kinds.includes('unknown')) return fail('a mermaid block that does not start with a diagram type')
    if (want.diagram && !kinds.some((k) => (want.diagram as string[]).includes(k))) return fail(`a ${kinds.join(', ')} where a ${want.diagram.join(' or ')} was called for`)
    const body = blocks.find((b) => b.lang === 'mermaid')!.body
    if (body.split('\n').filter((l) => l.trim()).length < 3) return fail('a mermaid diagram with nothing in it')
    return { score: 1, found }
  }
  if (want.kind === 'table') return found.includes('table') ? { score: 1, found } : fail('no table')
  if (want.kind === 'sim') {
    const sims = found.filter((f) => f.startsWith('sim:')).map((f) => f.slice(4))
    if (!sims.length) return fail('no sim block')
    if (sims.includes('invalid')) return fail('a sim block the app cannot read')
    if (want.sim && !sims.includes(want.sim)) return fail(`a ${sims.join(', ')} simulation where ${want.sim} was called for`)
    return { score: 1, found, relabelled }
  }
  const charts = found.filter((f) => f.startsWith('chart:'))
  if (!charts.length) return fail('no chart block')
  return charts.includes('chart:ok') ? { score: 1, found } : fail('a chart block the app cannot read')
}

/** Any one of the kinds a scenario allows will do: the first that passes, or why the first failed */
function scoreVisuals(want: Visual | Visual[], reply: string): ReturnType<typeof scoreVisual> {
  const all = (Array.isArray(want) ? want : [want]).map((w) => scoreVisual(w, reply))
  return all.find((v) => v.score) ?? all[0]
}

/**
 * The reply asks for another go at the problem just marked, rather than setting a new one: the
 * tutor's last message posed a problem with its solution, this one marks the answer down and sets
 * no numbered problem. The solution it will mark against is the one it already wrote.
 */
function retriesProblem(history: Turn[] | undefined, reply: string): boolean {
  const last = [...(history ?? [])].reverse().find((t): t is { tutor: string } => 'tutor' in t)
  if (!last || !solutionOf(last.tutor) || !/<ask\b[^>]*type\s*=\s*["'](problem|code|error)["']/i.test(last.tutor)) return false
  return /<grade\b[^>]*verdict\s*=\s*["']?(partial|wrong)/i.test(reply) && !/\*\*\s*Problem\s+\d+/i.test(hideWorking(reply))
}

const attrOf = (attrs: string, name: string) => attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]

export function scoreReply(s: Pick<Scenario, 'expect' | 'situation' | 'setup'> & { history?: Turn[] }, raw: string): Score {
  const e: Expect = s.expect
  // What the app keeps of a completion: no hidden reasoning, no special tokens, and the faults a
  // rule can fix put right (shared/lessonRepair: a mark on what wasn't an answer, an unclosed grade,
  // a numbered question left with only Go on)
  const last = s.history?.[s.history.length - 1]
  const fixed = repairReply(cleanModelText(raw), last && 'learner' in last ? learnerText(last.learner) : '')
  const reply = fixed.text
  const repaired: string[] = [...fixed.repaired]
  const blocks = parseBlocks(reply)
  const visible = hideWorking(reply)
  const read = readableText(blocks)
  const prose = readableText(blocks, { asks: false })
  const checks: Check[] = []
  const add = (id: string, ok: boolean, why?: string) => checks.push({ id, ok, ...(ok || !why ? {} : { why }) })

  // --- protocol ---
  const unclosed = PAIRED.filter((t) => count(reply, new RegExp(`<${t}\\b[^>]*>`, 'gi')) !== count(reply, new RegExp(`</${t}>`, 'gi')))
  add('tags-closed', !unclosed.length, `unbalanced: ${unclosed.join(', ')}`)
  add('clean', !/<say>|\(Tide:|<\|?channel\|?>|<think>|<\|tool_call|```tool_code|<tool_call>|(^|\n)\s*call:[A-Za-z_]\w*\{/i.test(reply), 'voice tags, a hidden note echoed back, thinking markers or a tool call in the text')
  const opening = read.replace(/^[\s*_#>]+/, '')
  add('no-preamble', !/^(hello|hi\b|hey\b|great question|good question|sure[,!. ]|certainly|of course|absolutely|welcome|okay[,!]|alright[,!]|let['’]?s (get started|dive in|begin))/i.test(opening), 'opens with a greeting or preamble')

  const rawAsks = [...reply.matchAll(/<ask\b([^>]*)>([\s\S]*?)<\/ask>/gi)]
  const askCount = count(reply, /<ask\b/gi)
  const goesOn = /<continue\b[^>]*\/?>/i.test(reply)
  add('one-ask', askCount <= 1, `${askCount} questions in one message`)
  const afterAsk = askCount ? reply.slice(reply.toLowerCase().lastIndexOf('</ask>') + 6) : ''
  const tail = afterAsk.replace(/<(solution|check|note|card)\b[^>]*>[\s\S]*?<\/\1>/gi, '').trim()
  // With no ask tag, the app makes a closing question in plain text the ask (parseBlocks), so there is something to answer in
  const madeAsk = askCount === 0 && blocks.length > 0 && blocks[blocks.length - 1].kind === 'ask' && blocks.filter((b) => b.kind === 'ask').length === 1
  if (madeAsk && !repaired.includes('ask')) repaired.push('ask')
  const endsAsk = (askCount === 1 && rawAsks.length === 1 && !goesOn && !tail) || madeAsk
  const endsContinue = blocks.some((b) => b.kind === 'continue')
  const endsOk = e.ends === 'ask' ? endsAsk : e.ends === 'continue' ? endsContinue : e.ends === 'either' ? endsAsk || endsContinue : askCount === 0 && !madeAsk
  add('ends', endsOk, e.ends === 'nothing' ? 'asks a question where none was wanted' : `does not end with ${e.ends === 'ask' ? 'one question in an ask tag' : e.ends === 'continue' ? '<continue/>' : 'one question or <continue/>'}`)

  const askTypes = rawAsks.map((m) => (attrOf(m[1], 'type') ?? '').toLowerCase())
  if (rawAsks.length) {
    const badAttr = rawAsks.find((m, i) => {
      if (!ASK_TYPES.includes(askTypes[i]) || !m[2].trim()) return true
      if (askTypes[i] === 'code' && !attrOf(m[1], 'lang')) return true
      const asked = blocks.find((b): b is Extract<Block, { kind: 'ask' }> => b.kind === 'ask')
      return askTypes[i] === 'choice' && (asked?.options.length ?? 0) < 2
    })
    add('ask-attrs', !badAttr, 'an ask with a missing or unknown type, no options for a choice, no lang for code, or nothing in it')
    if (e.askTypes) add('ask-type', askTypes.every((t) => (e.askTypes as string[]).includes(t)), `a ${askTypes.join(', ')} ask where ${e.askTypes.join(' or ')} was called for`)
  }

  // A problem comes with its hidden solution, and the answer never sits where the learner reads it
  const sets = askTypes.some((t) => t === 'problem' || t === 'code') || /\*\*\s*Problem\s+\d+/i.test(visible)
  const solution = solutionOf(reply)
  // A question the learner can't answer in, or a second one beside the ask: prose ending in "?" outside
  // the ask tag. A problem's own statement may end in a question: its ask is where it's answered
  // The one place a question may stand in prose: closing a set-up (a scenario, a case to think
  // about) straight before the ask that then puts it, like a problem and its ask. A bare question
  // there, or one anywhere else, is a second thing asked or one with nowhere to answer
  const isQuestion = (p: string) => !/^#{1,6}\s/.test(p) && !/^\*\*[^*]+\*\*$/.test(p) && /\?\s*[*_)"”]*\s*$/.test(p)
  const sentences = (p: string) => (p.match(/[.!?:](\s|$)/g) ?? []).length
  const stray = blocks.some((b, i) => {
    if (b.kind !== 'text') return false
    const paras = b.text.replace(FENCE, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    const last = paras.length - 1
    const stem = blocks[i + 1]?.kind === 'ask' && askCount > 0 && (paras.filter((p) => !/^\*\*[^*]+\*\*$/.test(p)).length > 1 || sentences(paras[last] ?? '') > 1) ? last : -1
    return paras.some((p, k) => isQuestion(p) && k !== stem)
  })
  add('plain-question', !(stray && !sets), 'a question in plain text, outside an ask tag')
  if (e.setsProblem) add('sets-problem', sets, 'no problem set')
  // The app works a missing solution out itself for what it takes to be a problem (lessonGuard), and
  // a second go at the problem just marked is marked against the solution already written
  const supplied = !solution && setsProblem(reply)
  if (supplied && (sets || e.setsProblem)) repaired.push('solution')
  if ((sets && !retriesProblem(s.history, reply)) || e.setsProblem) add('solution', !!solution || supplied, 'a problem without its <solution>')
  const askText = rawAsks.map((m) => m[2]).join('\n') + '\n' + rawAsks.map((m) => attrOf(m[1], 'options') ?? '').join('\n')
  const squash = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const leaks = [
    /<solution\b/i.test(askText) && 'the solution is inside the question',
    /\((the )?(correct|right)( answer| one| option)?\)/i.test(askText) && 'an option is labelled as the right one',
    solution.length >= 24 && squash(read).includes(squash(solution)) && 'the solution is repeated where the learner reads it',
    ...(e.askMustNot ?? []).map((p) => safe(p).test(askText) && `the question gives away its answer (${p})`)
  ].filter(Boolean) as string[]
  if (rawAsks.length || e.askMustNot?.length) add('no-leak', !leaks.length, leaks.join('; '))

  // The verdict is in the opening tag, which is where the app reads it (lessonGuard, pace): a grade
  // left unclosed is a protocol fault (tags-closed), not a missing or wrong mark
  const grades = [...reply.matchAll(/<grade\b([^>]*)>([\s\S]*?)(?:<\/grade>|(?=<(?:ask|note|card|plan|solution|check|summary|grade)\b)|$)/gi)]
  if (e.verdict) {
    add('graded', grades.length === 1, grades.length ? 'more than one grade' : 'no grade for the answer just given')
    if (grades.length) {
      const [, attrs, body] = grades[0]
      const score = attrOf(attrs, 'score')
      add('grade-attrs', /^(correct|partial|wrong)$/i.test(attrOf(attrs, 'verdict') ?? '') && (score === undefined || (/^\d(\.\d+)?$/.test(score) && Number(score) <= 1)) && !!body.trim(), 'a grade with no valid verdict, a score outside 0 to 1, or no feedback')
      const before = parseBlocks(reply.slice(0, grades[0].index))
      add('grade-first', words(readableText(before)) <= 12 && !before.some((b) => b.kind === 'ask'), 'the grade does not come first')
    }
  }
  const has = (t: Tag) => (t === 'continue' ? goesOn : new RegExp(`<${t}\\b`, 'i').test(reply))
  for (const t of e.need ?? []) add(`need:${t}`, has(t), `no <${t}>`)
  for (const t of e.forbid ?? []) add(`forbid:${t}`, !has(t), `a <${t}> where there should be none`)
  if (e.heading) add('heading', new RegExp(`(\\*\\*|^#{1,6}\\s*)\\s*${e.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*(\\*\\*|$)`, 'im').test(visible), `no "${e.heading}" heading`)

  // --- marking ---
  let marking: Marking | null = null
  if (e.verdict) {
    const got = (grades.length ? (attrOf(grades[0][1], 'verdict') ?? '').toLowerCase() : '') as Verdict | ''
    const verdict: Verdict | 'none' = got === 'correct' || got === 'partial' || got === 'wrong' ? got : 'none'
    // Feedback in a grade left unclosed is still what the tutor said about the answer
    const said = blocks.some((b) => b.kind === 'grade') ? prose : `${prose}\n${grades[0]?.[2] ?? ''}`
    const named = e.names?.length ? e.names.every((p) => safe(p).test(said)) : null
    marking = { score: verdict === e.verdict || (verdict !== 'none' && (e.accept ?? []).includes(verdict)) ? 1 : 0, expected: e.verdict, got: verdict, falseCorrect: e.verdict !== 'correct' && verdict === 'correct', rejectedRight: e.verdict === 'correct' && verdict !== 'correct', named }
  }

  // --- exactness ---
  const exact: Check[] = [
    ...(e.must ?? []).map((p) => ({ id: `must:${p}`, ok: safe(p).test(read) })),
    ...(e.mustNot ?? []).map((p) => ({ id: `must-not:${p}`, ok: !safe(p).test(read) })),
    // Names with nothing to mark (a misconception raised in a question) are a matter of exactness
    ...(!e.verdict ? (e.names ?? []).map((p) => ({ id: `names:${p}`, ok: safe(p).test(prose) })) : [])
  ]
  const exactness = exact.length ? { score: exact.filter((c) => c.ok).length / exact.length, checks: exact } : null

  // --- pace ---
  const bounds = { ...defaultWords(s), ...(e.words ?? {}) }
  const n = paceWords(reply)
  const pace = { score: n > bounds.max * (1 + PACE_GRACE) ? Math.max(0, 1 - (n - bounds.max) / bounds.max) : n < bounds.min ? n / bounds.min : 1, words: n, min: bounds.min, max: bounds.max }

  // --- visual ---
  const drawn = e.visual ? scoreVisuals(e.visual, reply) : null
  if (drawn?.score && drawn.relabelled) repaired.push('sim')
  const visual = drawn ? { score: drawn.score, found: drawn.found, ...(drawn.why ? { why: drawn.why } : {}) } : null

  const protocol = { score: checks.filter((c) => c.ok).length / checks.length, checks }
  const parts = [protocol.score, pace.score, ...(marking ? [marking.score] : []), ...(exactness ? [exactness.score] : []), ...(visual ? [visual.score] : [])]
  const failed = [
    ...checks.filter((c) => !c.ok).map((c) => c.id),
    ...(marking && !marking.score ? ['verdict'] : []),
    ...(marking?.named === false ? ['names'] : []),
    ...(exactness?.checks.filter((c) => !c.ok).map((c) => c.id) ?? []),
    ...(pace.score < 1 ? ['pace'] : []),
    ...(visual && !visual.score ? ['visual'] : [])
  ]
  return { protocol, marking, exactness, pace, visual, overall: parts.reduce((a, b) => a + b, 0) / parts.length, pass: !failed.length, failed, repaired }
}
