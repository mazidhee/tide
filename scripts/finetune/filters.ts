/**
 * Which tutor turns from saved lessons may become training examples, decided by pure functions so
 * every rule can be tested. The rules err on the side of leaving a turn out: a small adapter
 * learns whatever it is shown, including the mistakes.
 *
 *   privacy      nothing from a private project, nothing about the owner's Metabase (whole lesson)
 *   checks       only turns that passed Tide's checks: no second-look correction, no claim
 *                correction, no replaced problem, no repeated or unasked problem, well-formed tags
 *   corrections  no turn the learner then corrected, or the tutor then took back
 *   details      personal details removed from what is kept
 *   contamination  nothing that is (or closely matches) a benchmark scenario
 */
import { splitSay } from '../../src/shared/characters'
import { missingQuestion } from '../../src/shared/lessonCheck'
import type { LessonRecord } from '../../src/shared/lessonLog'
import type { ProjectInfo } from '../../src/shared/project'
import { ownWords, repeatsEarlier, sessionInstructions, type SessionSetup } from '../../src/shared/session'
import { TUTOR_SYSTEM, stableSystem, withInstructions } from '../../src/shared/tutorPrompt'
import { scoreReply } from '../eval/tutor/score'
import { repairReply } from '../../src/shared/lessonRepair'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Example {
  /** The lesson (or gold group) it comes from: the unit the held-out split is made by */
  lesson: string
  source: 'lesson' | 'gold'
  messages: Message[]
}

// ---------- privacy ----------

export interface PrivacyMap {
  /** Folders of private projects, their documents, and anything filed under their names */
  folders: string[]
  docs: string[]
}

/** About Metabase or its data, by name or by its address (training data leaves the owner's work out) */
const aboutMetabase = (text: string, host?: string) => /\bmetabase\b/i.test(text) || (!!host && text.toLowerCase().includes(host.toLowerCase()))

/** What is private, from the vault's own records (.tide/notebooks.json and .tide/library.json), as main/projects.privatePath reads them */
export function privacyMap(notebooks: Record<string, { project?: Partial<ProjectInfo> }>, library: Record<string, { topics?: string[] }>): PrivacyMap {
  const folders: string[] = []
  const docs: string[] = []
  for (const [path, meta] of Object.entries(notebooks)) {
    if (!meta?.project?.private) continue
    folders.push(path)
    docs.push(...(meta.project.docs ?? []), ...(meta.project.brief ? [meta.project.brief] : []))
    const name = (path.split('/').pop() ?? path).trim().toLowerCase()
    for (const [doc, entry] of Object.entries(library)) if (entry?.topics?.some((t) => t.toLowerCase() === name)) docs.push(doc)
  }
  return { folders, docs }
}

export const isPrivatePath = (path: string, map: PrivacyMap) => !!path && (map.folders.some((f) => path === f || path.startsWith(`${f}/`)) || map.docs.includes(path))

/** Why a whole lesson is left out, or null. `map` null means privacy could not be read: then anything with a path is left out */
export function lessonExcluded(r: LessonRecord, map: PrivacyMap | null, metabaseHost?: string): string | null {
  if (r.mode !== 'teach' && r.mode !== 'quiz' && r.mode !== 'recall' && r.mode !== 'probe') return 'mode-not-a-lesson'
  if (r.options?.project) return 'project-lesson'
  if (r.options?.placement || r.options?.retest) return 'placement-or-retest'
  const path = 'path' in r.scope ? r.scope.path : ''
  if (path && !map) return 'privacy-unknown'
  if (path && map && isPrivatePath(path, map)) return 'private-project'
  if (r.turns.some((t) => aboutMetabase(t.content, metabaseHost)) || aboutMetabase(r.topic, metabaseHost)) return 'metabase'
  // Ways of teaching that depend on the canvas or the terminal can't be reproduced as text
  if (r.options?.strategy === 'walkthrough' || r.options?.strategy === 'lab') return 'needs-tools'
  return null
}

// ---------- Tide's checks ----------

/** What the app adds under a reply when one of its checks found a fault (main/ai.ts, shared/lessonCheck.correctionText) */
const CHECK_FAILED: [RegExp, string][] = [
  [/\*\*Second look:\*\*/, 'mark-overturned'],
  [/^> \*\*(Correction|Worth checking):\*\*/m, 'claim-corrected'],
  [/\*\*That problem had a flaw \(/, 'problem-replaced']
]

/** The learner pushing back on what the tutor just said */
const PUSHBACK =
  /\b(that'?s|that is|this is|you'?re|you are|it'?s|it is) (wrong|incorrect|not (right|correct|true)|mistaken|a mistake)\b|\byou (made|have made|'ve made) (a|an) (mistake|error)\b|\b(doesn'?t|does not|don'?t) (look|seem|sound) right\b|\bare you sure\b|\bi think you('re| are)? (wrong|mistaken|confus)|\bthat contradicts\b|\bshouldn'?t (it|that|this) be\b|\bisn'?t (it|that|the answer)\b[^.?!]*\?|\byou said\b[^.?!]*\bbut\b|\btypo\b|\bmis(calculat|count|read)/i

/** The tutor taking something back */
const RETRACTION = /\b(you'?re|you are) (absolutely |quite |completely )?(right|correct)[,.! ]+(i|my|that was)\b|\bmy (mistake|error|apolog)|\bi apologi[sz]e\b|\bapologies\b|\bi (made|was) (a|an|in)? ?(mistake|error|wrong|mistaken)\b|\bgood catch\b|\bi misspoke\b|\bcorrection:\s/i

/** The reply as the model should have written it with voice off: the spoken part removed */
export function unvoiced(content: string): string {
  let out = content
  for (let s = splitSay(out); s.say !== null; s = splitSay(out)) out = s.rest
  return out.trim()
}

/** Why a tutor turn can't be a training target, or null when it can. `i` indexes r.turns */
export function turnExcluded(r: LessonRecord, i: number): string | null {
  const reply = unvoiced(r.turns[i].content)
  if (!reply) return 'empty'
  for (const [mark, why] of CHECK_FAILED) if (mark.test(reply)) return why
  const earlier = r.turns.slice(0, i).filter((t) => t.role === 'assistant').map((t) => t.content)
  if (repeatsEarlier(reply, earlier)) return 'repeated-problem'
  if (missingQuestion(reply)) return 'unasked-problem'
  // A reply the app had to put right is not one to learn from, even though the learner saw it
  // whole: the benchmark scores what was shown, a training target has to be what should be written
  const said = r.turns[i - 1]?.role === 'user' ? r.turns[i - 1].content : ''
  const REPAIR: Record<string, string> = { close: 'tags-closed', grade: 'marked-nothing', ask: 'ends' }
  const fixed = repairReply(reply, said)
  if (fixed.repaired.length) return `protocol:${REPAIR[fixed.repaired[0]] ?? fixed.repaired[0]}`
  // The tag protocol, read as the benchmark's scorer reads it: a finished lesson's last turn ends with its summary
  const wraps = /<summary\b|<scorecard\b|<rubric\b/i.test(reply)
  const p = scoreReply({ expect: { ends: wraps ? 'nothing' : 'either' }, situation: 'after-correct', setup: { mode: r.mode, topic: r.topic, options: r.options } }, reply)
  if (p.repaired.includes('ask')) return 'protocol:plain-question'
  const broken = p.protocol.checks.filter((c) => !c.ok && ['tags-closed', 'clean', 'one-ask', 'ask-attrs', 'ends', 'plain-question', 'no-leak'].includes(c.id)).map((c) => c.id)
  if (broken.length) return `protocol:${broken[0]}`
  // A turn written under a hidden nudge that was stored with the learner's message is fine: the nudge is in the prompt.
  const next = r.turns[i + 1]
  if (next?.role === 'user' && PUSHBACK.test(ownWords(next.content).replace(/^(Answer|My question):\s*/, ''))) return 'learner-corrected'
  const after = r.turns[i + 2]
  if (next?.role === 'user' && after?.role === 'assistant' && RETRACTION.test(unvoiced(after.content).slice(0, 400))) return 'tutor-retracted'
  // The last reply of a lesson still open may be one the learner walked away from mid-check
  if (i === r.turns.length - 1 && !r.finished && !/<ask\b|<continue\b|<summary\b/i.test(reply)) return 'unfinished'
  return null
}

// ---------- personal details ----------

export interface Scrub {
  /** Names to remove wherever they appear (the owner's, family, employer): whole words, any case */
  names: string[]
}

/** Personal details out of a piece of text; returns the text and how many things were replaced */
export function scrub(text: string, opts: Scrub): { text: string; replaced: number } {
  let n = 0
  const sub = (re: RegExp, to: string) => {
    text = text.replace(re, () => (n++, to))
  }
  sub(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
  sub(/(?:\/Users|\/home)\/[^/\s"'`)]+/g, '/Users/learner')
  sub(/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|[\w.-]+\.(?:local|internal|lan))(?::\d+)?[^\s)"'`]*/gi, '[local address]')
  sub(/(?<![\w.])\+?\d{1,3}[ -]?\(?\d{2,4}\)?[ -]\d{3,4}[ -]\d{3,4}(?![\w.])/g, '[phone]')
  sub(/\b(?:sk|pk|ghp|gho|xox[abp]|AKIA)[-_A-Za-z0-9]{16,}\b/g, '[key]')
  for (const name of opts.names.map((x) => x.trim()).filter((x) => x.length >= 3)) sub(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), 'the learner')
  return { text, replaced: n }
}

// ---------- examples ----------

/** A rough token count, for the sequence-length limit: Gemma's tokenizer averages a little over 3.5 characters a token on this kind of text (an estimate) */
export const estimateTokens = (messages: Message[]) => Math.ceil(messages.reduce((a, m) => a + m.content.length, 0) / 3.4) + messages.length * 4

/** The system prompt a lesson's turns were written under, with nothing about the learner in it */
export const trainingSystem = (started: number) => stableSystem(TUTOR_SYSTEM, { today: new Date(started), web: true, session: true })

export interface Built {
  examples: Example[]
  turns: number
  excluded: Record<string, number>
  scrubbed: number
}

/**
 * One example for each tutor turn that may be learned from: the request as the app sends it (the
 * system prompt, the lesson's instructions at the head of the first message, the turns before)
 * and the turn itself as the target.
 */
export function examplesFrom(r: LessonRecord, opts: Scrub & { maxTokens: number }): Built {
  const out: Built = { examples: [], turns: 0, excluded: {}, scrubbed: 0 }
  const setup: SessionSetup = { mode: r.mode, topic: r.topic, options: r.options }
  const clean = (content: string, role: string) => {
    const s = scrub(role === 'assistant' ? unvoiced(content) : content, opts)
    out.scrubbed += s.replaced
    return s.text
  }
  const turns = r.turns.map((t) => ({ role: t.role, content: clean(t.content, t.role) }))
  const system = trainingSystem(r.started)
  for (let i = 0; i < r.turns.length; i++) {
    if (r.turns[i].role !== 'assistant') continue
    out.turns++
    const why = i === 0 || r.turns[0].role !== 'user' ? 'no-opening' : turnExcluded(r, i)
    const messages: Message[] = [{ role: 'system', content: system }, ...withInstructions(turns.slice(0, i), sessionInstructions(setup)), turns[i]]
    const reason = why ?? (messages.some((m, k) => k > 0 && m.role === messages[k - 1].role) ? 'turns-out-of-order' : estimateTokens(messages) > opts.maxTokens ? 'too-long' : null)
    if (reason) out.excluded[reason] = (out.excluded[reason] ?? 0) + 1
    else out.examples.push({ lesson: r.id, source: 'lesson', messages })
  }
  return out
}

/** Which side of the split a lesson falls on: by its id alone, so it never moves and no lesson is on both sides */
export function heldOut(lesson: string, percent: number): boolean {
  let h = 2166136261
  for (let i = 0; i < lesson.length; i++) h = Math.imul(h ^ lesson.charCodeAt(i), 16777619)
  return (h >>> 0) % 100 < percent
}

/** Words of a text, for comparing a candidate with the benchmark */
const shingles = (s: string) => {
  const w = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')
  const set = new Set<string>()
  for (let i = 0; i + 3 < w.length; i++) set.add(w.slice(i, i + 4).join(' '))
  return set
}

/** Whether a text shares most of its wording with one of the benchmark's (training on the test would make the benchmark meaningless) */
export function matchesBenchmark(text: string, benchmark: string[], share = 0.5): boolean {
  const mine = shingles(text)
  if (mine.size < 6) return false
  return benchmark.some((b) => {
    const theirs = shingles(b)
    let same = 0
    for (const s of mine) if (theirs.has(s)) same++
    return same / Math.min(mine.size, Math.max(1, theirs.size)) >= share
  })
}
