import { promises as fs } from 'fs'
import { BANK_SYSTEM, bankPrompt, batchReviewPrompt, parseBank, parseBatchReview, pickProblem, shortfall, slugOf, trusted, variantPrompt, type BankProblem, type Level } from '@shared/bank'
import { localDate, nextStudyDay, todayItems } from '@shared/coach'
import { openingKey, openingMessage, parseBlocks, sessionInstructions, SESSION_FORMAT, strategyChoice, whyByDefault, withPassage, type SessionSetup } from '@shared/session'
import { withSources } from '@shared/sources'
import { getSettings } from './settings'
import type { ChatScope } from '@shared/types'
import type { CloudTask } from '@shared/providers'
import { askCloud, complete, NoCloud } from './ai'
import { noteReviewed, type CloudTarget } from './cloud'
import { getCoach, getWeek } from './coach'
import { mistakesDue } from './mistakes'
import { runCode } from './runner'
import { absPath } from './vault'

/**
 * Writes and keeps the problem bank (shared/bank.ts). Any time Tide is open, every half hour, it
 * tops up the topics coming next (today's and the next study day's, lessons in progress) and fresh
 * versions of the mistakes due, with the cloud models only: routine during the day (it stops once
 * a model is 70% through its daily allowance, leaving the rest for your lessons), and in the
 * evening, spending what's left before the allowance resets. A lesson also tops up its own topic
 * while you answer, by the cloud or, when that can't, by Gemma while it's idle.
 */

const DIR = '.tide/bank'
const fileOf = (topic: string) => `${DIR}/${slugOf(topic)}.json`

export async function readBank(topic: string): Promise<BankProblem[]> {
  return fs
    .readFile(absPath(fileOf(topic)), 'utf8')
    .then((t) => (JSON.parse(t) as { problems: BankProblem[] }).problems ?? [])
    .catch(() => [])
}

// One write at a time per topic: a lesson and the half-hourly top-up can land together
const writing = new Map<string, Promise<unknown>>()

async function updateBank(topic: string, fn: (problems: BankProblem[]) => BankProblem[]): Promise<void> {
  const key = slugOf(topic)
  const run = (writing.get(key) ?? Promise.resolve()).then(async () => {
    const next = fn(await readBank(topic)).slice(-300)
    await fs.mkdir(absPath(DIR), { recursive: true })
    await fs.writeFile(absPath(fileOf(topic)), JSON.stringify({ topic, problems: next }, null, 1))
  })
  writing.set(key, run.catch(() => {}))
  return run
}

/** Problems proven elsewhere (Claude's exercises, main/exercises), kept with the rest */
export const addToBank = (topic: string, problems: BankProblem[]) => updateBank(topic, (all) => [...all.filter((p) => !problems.some((q) => q.id === p.id)), ...problems])

export const markUsed = (topic: string, id: string) => updateBank(topic, (all) => all.map((p) => (p.id === id ? { ...p, usedAt: Date.now() } : p))).catch(() => {})

/** Runs each problem's check, then has a second model review the batch */
async function verify(problems: BankProblem[], signal: AbortSignal, cloud: boolean, writer?: CloudTarget): Promise<BankProblem[]> {
  const out: BankProblem[] = []
  for (const p of problems) {
    if (!p.check) {
      out.push(p)
      continue
    }
    const r = await runCode(p.check.lang, p.check.code, '', 20_000).catch(() => null)
    // A missing library is Tide's problem, not the problem's: unknown rather than failed
    out.push({ ...p, checked: !r ? null : r.exitCode === 0 ? true : /No module named/.test(r.stderr) ? null : false })
  }
  if (!cloud || signal.aborted) return out
  // A different model from the one that wrote them (marking, not maths), so it isn't checking its own work
  // Room for a reasoning model to think and still answer: at 1,200 tokens, 28 of 87 reviews ran out before saying anything
  const verdicts = parseBatchReview(await askCloud(batchReviewPrompt(out), 'You check practice problems carefully and say exactly which are flawed. Reply in the format asked.', 'marking', signal, false, 2400).catch(() => ''), out.length)
  // How the writer did, so a model whose problems keep failing review moves back in the line
  const judged = verdicts.filter((v) => v !== undefined)
  if (writer && judged.length) noteReviewed(writer, 'maths', judged.filter(Boolean).length, judged.length)
  return out.map((p, i) => (verdicts[i] === undefined ? p : { ...p, reviewed: verdicts[i]! }))
}

/**
 * Writes problems on a topic: by a cloud model when one may (strong, and it doesn't take the Mac),
 * else by Gemma when it's free (only computable ones end up trusted then: no second model checks
 * the others). Returns how many it added.
 */
export async function writeProblems(topic: string, counts: Partial<Record<Level, number>>, o: { signal: AbortSignal; routine: boolean; cloudOnly?: boolean; source?: BankProblem['source'] }): Promise<number> {
  if (!Object.values(counts).some((n) => n && n > 0)) return 0
  const prompt = bankPrompt(topic, counts)
  let out = ''
  let cloud = false
  let writer: CloudTarget | undefined
  out = await askCloud(prompt, BANK_SYSTEM, 'maths' as CloudTask, o.signal, o.routine, 4000, (t) => (writer = t)).catch((e) => {
    if (e instanceof NoCloud) return ''
    throw e
  })
  cloud = !!out
  if (!out) {
    if (o.cloudOnly) return 0
    out = await complete(prompt, BANK_SYSTEM, o.signal, 'background')
  }
  const fresh = await verify(parseBank(out, topic, o.source ?? 'prep'), o.signal, cloud, writer)
  if (!fresh.length) return 0
  await updateBank(topic, (all) => [...all, ...fresh])
  return fresh.filter(trusted).length
}

/** What to prepare: today's and the next study day's topics, and lessons in progress */
async function comingTopics(): Promise<{ topic: string; notebook?: string; lesson?: boolean; topicId?: string; refresh?: boolean }[]> {
  const today = localDate()
  const days = (await getCoach()).days
  const next = nextStudyDay(today, days)
  const out: { topic: string; notebook?: string; lesson?: boolean; topicId?: string; refresh?: boolean }[] = []
  for (const date of [today, next]) {
    const plan = await getWeek(date).catch(() => null)
    for (const it of todayItems(plan, date)) {
      if (it.done || !['learn', 'quiz', 'practice', 'test', 'review'].includes(it.kind)) continue
      const topic = it.topic ?? it.title.replace(/^(quiz|test|practi[cs]e|review)\s*:\s*/i, '')
      if (topic && !out.some((t) => t.topic === topic)) out.push({ topic, notebook: it.notebook, lesson: it.kind === 'learn' && !it.refresh, ...(it.topicId ? { topicId: it.topicId } : {}) })
    }
  }
  const ongoing = JSON.parse(await fs.readFile(absPath('.tide/ongoing.json'), 'utf8').catch(() => '[]')) as { title: string }[]
  for (const o of ongoing) {
    const topic = o.title.replace(/^[^:]+:\s*/, '')
    if (topic && !out.some((t) => t.topic === topic)) out.push({ topic })
  }
  return out.slice(0, 8)
}

/** Evening, when what's left of the day's allowance would otherwise go unused */
const spendingHours = () => {
  const h = new Date().getHours()
  return h >= 20 || h < 5
}

let running = false
let status: { lastRun?: number; added: number; topics: number; note?: string } = { added: 0, topics: 0 }

export const bankStatus = () => status

/** Tops up the bank for what's coming, and fresh versions of the mistakes due. Cloud only, so it never takes the Mac */
export async function prepare(): Promise<typeof status> {
  if (running) return status
  running = true
  const controller = new AbortController()
  let added = 0
  let note: string | undefined
  try {
    const routine = !spendingHours()
    const topics = await comingTopics()
    for (const t of topics) {
      const need = shortfall(await readBank(t.topic), 3)
      added += await writeProblems(t.topic, need, { signal: controller.signal, routine, cloudOnly: true })
    }
    added += await prepareVariants(controller.signal, routine)
    await prepareOpenings(topics, controller.signal, routine)
    status = { lastRun: Date.now(), added, topics: topics.length }
  } catch (e) {
    note = (e as Error).message
    status = { lastRun: Date.now(), added, topics: status.topics, note }
  } finally {
    running = false
  }
  return status
}

// ---------- Daily practice: fresh versions of past mistakes ----------

const VARIANTS = `${DIR}/variants.json`

const readVariants = () => fs.readFile(absPath(VARIANTS), 'utf8').then((t) => JSON.parse(t) as Record<string, BankProblem>).catch(() => ({}) as Record<string, BankProblem>)

/** A fresh version of a mistake for its retest, when one is ready */
export async function variantFor(mistakeId: string): Promise<BankProblem | null> {
  const v = (await readVariants())[mistakeId]
  return v && trusted(v) ? v : null
}

async function prepareVariants(signal: AbortSignal, routine: boolean): Promise<number> {
  const due = await mistakesDue(12).catch(() => [])
  const have = await readVariants()
  let added = 0
  for (const m of due) {
    if (have[m.id] || signal.aborted) continue
    const out = await askCloud(variantPrompt(m.question, m.fix, m.topic), BANK_SYSTEM, 'maths', signal, routine).catch((e) => {
      if (e instanceof NoCloud) return ''
      throw e
    })
    if (!out) break
    const [p] = await verify(parseBank(out, m.topic, 'variant'), signal, true)
    if (!p) continue
    have[m.id] = p
    if (trusted(p)) added++
  }
  await fs.mkdir(absPath(DIR), { recursive: true })
  await fs.writeFile(absPath(VARIANTS), JSON.stringify(have, null, 1))
  return added
}

/** A first look at a topic for Daily practice: an easy problem from the bank */
export async function previewFor(topic: string): Promise<BankProblem | null> {
  return pickProblem(await readBank(topic), 1, () => false) ?? null
}

// ---------- Lessons ----------

/**
 * While you answer, makes sure a checked problem is waiting at each level around where the lesson
 * is: by the cloud when it may (routine, so a busy day leaves it alone), else by Gemma when idle.
 */
export async function prepareAround(topic: string, level: Level): Promise<void> {
  const bank = await readBank(topic)
  const need: Partial<Record<Level, number>> = {}
  for (const l of [level - 1, level, level + 1].filter((x) => x >= 1 && x <= 3) as Level[]) {
    if (!pickProblem(bank.filter((p) => p.level === l), l, () => false)) need[l] = 1
  }
  if (!Object.keys(need).length) return
  await writeProblems(topic, need, { signal: new AbortController().signal, routine: true, source: 'lesson' }).catch((e: Error) => (console.warn(`[bank] topping up ${topic}: ${e.message}`), 0))
}

let timer: ReturnType<typeof setInterval> | null = null

/** Half-hourly while Tide is open, first a few minutes after it starts */
export function startBank() {
  if (timer) return
  setTimeout(() => void prepare(), 3 * 60_000)
  timer = setInterval(() => void prepare(), 30 * 60_000)
}

// ---------- Lesson openings, written ahead ----------

const OPENINGS = `${DIR}/openings.json`

type Opening = { topic: string; reply: string; at: number }

const readOpenings = () => fs.readFile(absPath(OPENINGS), 'utf8').then((t) => JSON.parse(t) as Record<string, Opening>).catch(() => ({}) as Record<string, Opening>)

/**
 * The opening of a lesson written ahead for exactly this start (its instructions and opening
 * message), handed over once: the lesson opens at once instead of waiting for the first reply.
 */
export async function openingFor(instructions: string, opening: string): Promise<string | null> {
  const all = await readOpenings()
  const key = openingKey(instructions, opening)
  const hit = all[key]
  if (!hit) return null
  delete all[key]
  await fs.writeFile(absPath(OPENINGS), JSON.stringify(all)).catch(() => {})
  return hit.reply
}

/**
 * Writes the openings of the lessons in your plan, the way the lesson would start them (the same
 * teaching approach, the same book section), by the cloud model; kept a week.
 */
async function prepareOpenings(topics: { topic: string; notebook?: string; lesson?: boolean; topicId?: string }[], signal: AbortSignal, routine: boolean) {
  const { lessonPassage } = await import('./ai')
  const all = await readOpenings()
  const week = Date.now() - 7 * 86_400_000
  for (const k of Object.keys(all)) if (all[k].at < week) delete all[k]
  for (const t of topics.filter((x) => x.lesson)) {
    if (signal.aborted) continue
    const scope: ChatScope = t.notebook ? { kind: 'folder', path: t.notebook } : { kind: 'vault' }
    // A close call between two ways of teaching is settled when the lesson starts: nothing to write ahead
    const choice = strategyChoice({ mode: 'teach', topic: t.topic }, scope)
    if (choice && !choice.clear) continue
    // Set up as the lesson will be (Why mode by the same rule), and opened the same way (the book
    // section, then the sources), so the key matches when it starts
    const why = whyByDefault(getSettings().whyMode, t.topic, t.topicId)
    const options = { ...(choice ? { strategy: choice.strategy } : {}), ...(why ? { why: true } : {}) }
    const setup: SessionSetup = { mode: 'teach', topic: t.topic, options: Object.keys(options).length ? options : undefined }
    const found = await lessonPassage(t.topic, t.notebook ?? '').catch(() => null)
    const pack = await import('./sources').then((m) => m.packFor(t.topic)).catch(() => null)
    const opening = withSources(found ? withPassage(openingMessage(setup), found) : openingMessage(setup), pack)
    const instructions = sessionInstructions(setup)
    const key = openingKey(instructions, opening)
    if (all[key]) continue
    const reply = await askCloud(opening, `You are Tide, a tutor who teaches one question at a time.\n\n${SESSION_FORMAT}\n\n${instructions}`, 'planning', signal, routine, 1500).catch((e) => {
      if (e instanceof NoCloud) return ''
      throw e
    })
    if (!reply) break
    // Only an opening that asks something: the lesson needs a question to start from
    if (parseBlocks(reply).some((b) => b.kind === 'ask')) all[key] = { topic: t.topic, reply, at: Date.now() }
  }
  await fs.mkdir(absPath(DIR), { recursive: true })
  await fs.writeFile(absPath(OPENINGS), JSON.stringify(all))
}

/**
 * After a miss in a lesson: one problem on exactly the idea that was missed (from the tutor's
 * feedback), at the lesson's level, kept for that lesson so it comes next.
 */
export async function aimAt(topic: string, problem: string, missed: string, lesson: string, level: Level): Promise<void> {
  const signal = new AbortController().signal
  const prompt = variantPrompt(problem, missed, topic)
  let out = await askCloud(prompt, BANK_SYSTEM, 'maths', signal, false).catch(() => '')
  const cloud = !!out
  if (!out) out = await complete(prompt, BANK_SYSTEM, signal, 'background').catch(() => '')
  const [p] = await verify(parseBank(out, topic, 'variant'), signal, cloud).catch(() => [] as BankProblem[])
  if (!p) return
  await updateBank(topic, (all) => [...all, { ...p, level, forLesson: lesson }]).catch(() => {})
}

/**
 * Quick problems from what was studied in the last week (topics answered in lessons and quizzes),
 * from the bank: practice spaced out over days, on problems rather than only flashcards.
 */
export async function warmups(n = 2): Promise<BankProblem[]> {
  const since = Date.now() - 7 * 86_400_000
  const lines = (await fs.readFile(absPath('.tide/attempts.jsonl'), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as { at: number; topic?: string }
      } catch {
        return null
      }
    })
  const today = new Date().setHours(0, 0, 0, 0)
  // Studied this week, but not today: a gap of a day or more is what makes recall count
  const topics = [...new Set(lines.filter((a): a is { at: number; topic: string } => !!a?.topic && a.at >= since && a.at < today).map((a) => a.topic))]
  const out: BankProblem[] = []
  for (const t of topics.reverse()) {
    if (out.length >= n) break
    const bank = await readBank(t)
    const p = pickProblem(bank.filter((x) => !x.usedAt || Date.now() - x.usedAt > 2 * 86_400_000), 2, () => false)
    if (p) out.push(p)
  }
  return out
}
