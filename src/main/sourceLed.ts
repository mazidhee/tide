/**
 * Source-led lessons, main side (the idea and the rules are in shared/sourceLed): for a lesson,
 * the candidates a reading is chosen from are gathered once and kept (your books and notes from
 * the search index; documentation and free texts found by web search and read with the existing
 * reader; the explainers list; the readings already found for the topic), the reading for each
 * step of the plan is chosen from them, and each turn is given what it needs: the reading to show,
 * the tutor's rules for it, and a tap on the reply that puts the reading in.
 *
 * Privacy: a lesson in a private project, or about your Metabase, uses only what is on this Mac
 * (nothing is searched for or read online, so not even its topic leaves), and its turns stay on
 * the local model (main/agent decides that, as for every private turn). A file in a private
 * project is never used as a reading in a lesson outside it.
 *
 * Hooks: main/ai.ts `answer` calls sourceLedTurn; main/agent.ts asks ledJob for the cloud job.
 */
import { createHash } from 'crypto'
import { otherLanguage } from '@shared/books'
import { findExplainers } from '@shared/explainers'
import { aboutMetabase } from '@shared/metabase'
import { normalizeTitle } from '@shared/outline'
import { ASKED, GO_ON, ownWords } from '@shared/session'
import { asksToMoveOn } from '@shared/lessonRepair'
import { ledTap, ownedCandidates, quoteNote, webCandidates, type GatherDeps, type GatherOptions } from '@shared/sourceGather'
import { chooseReading, ledState, plain, planTurn, turnNote, withoutReadings, type Candidate, type Said, type StepReading } from '@shared/sourceLed'
import { courseReading, type Section } from '@shared/courses'
import type { ChatEvent, ChatMessage, ChatRequest } from '@shared/types'
import { publicUrl, readWebpage, webSearch } from './agent'
import { primaryPagesFor } from '@shared/finance/sources'
import { filedUnder, getNotebooks } from './learn'
import { metabaseHost, metabaseReady } from './metabase'
import { privatePath } from './projects'
import { readingsFor } from './readings'
import { chunksNow, searchNow } from './search'
import { bookSourceSync } from './reading'
import { getSettings } from './settings'
import { readText, writeText } from './vault'

const DIR = '.tide/source-led'
const KEEP_MS = 14 * 86_400_000
/** How pages are read into text: kept pages read an earlier way are read again (2: superscripts and subscripts kept, 2⁴ not 24) */
const READ_AS = 2
/** Pages read from the web for one lesson, at most: the topic's, then a couple for each step that still has no reading */
const MAX_PAGES = 12
const MAX_STEPS = 8

interface Lesson {
  opts: GatherOptions
  /** Where the lesson is (its notebook or note): says which programming language it is in */
  where: string
  deps: GatherDeps
  candidates: Candidate[]
  /** Addresses already read (or tried) */
  have: Set<string>
  /** Queries your own material has been searched for */
  owned: Set<string>
  /** Steps the web has been searched for */
  searched: Set<string>
  chosen: Map<string, StepReading>
  preparing: Promise<void>
  /** [courses] A course's lesson: its text, and the sections the plan's steps are */
  course?: { candidate: Candidate; sections: Section[] }
}

const lessons = new Map<string, Lesson>()
const text = (m?: ChatMessage) => (typeof m?.content === 'string' ? m.content : '')
const slug = (topic: string) => normalizeTitle(topic).replace(/\s+/g, '-').slice(0, 80) || 'topic'

/** What was read from the web for a topic, kept two weeks so a lesson picked up again doesn't fetch it twice */
async function kept(topic: string): Promise<Candidate[]> {
  try {
    const f = JSON.parse(await readText(`${DIR}/${slug(topic)}.json`)) as { at: number; v?: number; candidates: Candidate[] }
    return f.v === READ_AS && Date.now() - f.at < KEEP_MS ? f.candidates : []
  } catch {
    return []
  }
}

const keep = (l: Lesson) =>
  // Only what came from the web: your own files are read from the index each time, and a private lesson has nothing from the web
  l.opts.private ? Promise.resolve() : writeText(`${DIR}/${slug(l.opts.topic)}.json`, JSON.stringify({ at: Date.now(), v: READ_AS, candidates: l.candidates.filter((c) => c.url) })).catch(() => {})

/** Which files are in private projects, worked out once so the choice of a reading needs no waiting */
async function privateTest(): Promise<(path: string) => boolean> {
  const roots: string[] = []
  const files = new Set<string>()
  for (const nb of await getNotebooks().catch(() => [])) {
    if (!nb.project?.private) continue
    roots.push(nb.path)
    for (const d of nb.project.docs ?? []) files.add(d)
    for (const f of await filedUnder(nb.name).catch(() => [] as string[])) files.add(f)
  }
  return (path) => files.has(path) || roots.some((r) => path === r || path.startsWith(`${r}/`))
}

async function lessonFor(req: ChatRequest): Promise<Lesson> {
  const topic = req.topic!
  const key = createHash('sha1').update(`${topic}\n${req.course ? `${req.course.id}/${req.course.lesson}\n` : ''}${text(req.messages.find((m) => m.role === 'user'))}`).digest('hex')
  const had = lessons.get(key)
  if (had) return had
  // Private: its place is a private project (when that can't be told, it is treated as one), or it is about your Metabase
  const where = req.scope.kind !== 'none' && req.scope.kind !== 'vault' ? req.scope.path : ''
  const secret = (where ? await privatePath(where).catch(() => true) : false) || (metabaseReady() && (aboutMetabase(topic, metabaseHost()) || req.messages.some((m) => aboutMetabase(text(m), metabaseHost()))))
  const isPrivate = await privateTest().catch(() => () => true)
  // [courses] A course's lesson is taught from the course: nothing is searched for online
  const course = req.course ? await import('./courses').then((c) => c.courseLessonSource(req.course!.id, req.course!.lesson)).catch(() => null) : null
  const web = !course && !secret && req.web !== false && getSettings().ai.webSearch?.provider !== 'off'
  const deps: GatherDeps = {
    search: (q, limit) => searchNow(q, limit),
    chunks: (path) => chunksNow(path),
    isPrivate,
    webSearch: (q) => webSearch(q),
    read: (url) => readWebpage(url),
    known: async (t) => [
      ...(await readingsFor(t).catch(() => [])).filter((r) => r.kind !== 'book').map((r) => ({ title: r.title, by: r.by, url: r.url })),
      ...findExplainers(t).map((e) => ({ title: e.title, by: e.by, url: e.url, explainer: true })),
      // Finance, payments and blockchains: the primary texts (BIS, central banks, ISO 20022, the Bitcoin and Ethereum docs, QuantEcon)
      ...primaryPagesFor(t).map((x) => ({ title: x.title, by: x.by, url: x.url }))
    ],
    publicUrl,
    now: () => Date.now(),
    // humanities: a free book's licence goes under readings taken from it
    licenceOf: bookSourceSync
  }
  const lesson: Lesson = { opts: { topic, private: secret, web }, where, deps, candidates: course ? [course.candidate] : [], have: new Set(), owned: new Set(), searched: new Set(), chosen: new Map(), preparing: Promise.resolve(), ...(course ? { course } : {}) }
  // The topic's sources are gathered while the tutor finds out what you know: ready by the time it plans
  lesson.preparing = (async () => {
    own(lesson, topic)
    // [courses] The lessons of courses you imported that teach the topic: on this Mac, so private lessons may use them too
    if (!course) for (const c of await import('./courses').then((m) => m.courseCandidates(topic)).catch(() => [] as Candidate[])) lesson.candidates.push(c)
    if (!web) return
    for (const c of await kept(topic)) if (c.url && !lesson.have.has(c.url)) (lesson.have.add(c.url), lesson.candidates.push(c))
    if (lesson.candidates.some((c) => c.url)) return
    lesson.candidates.push(...(await webCandidates(deps, topic, lesson.opts, lesson.have, true)))
    await keep(lesson)
  })().catch(() => {})
  lessons.set(key, lesson)
  if (lessons.size > 30) lessons.delete(lessons.keys().next().value!)
  return lesson
}

/** Your own books and notes for a query, once per query (the index answers in about a millisecond) */
function own(l: Lesson, query: string) {
  if (l.owned.has(query)) return
  l.owned.add(query)
  try {
    for (const c of ownedCandidates(l.deps, query, l.opts)) if (!l.candidates.some((x) => x.path === c.path && x.text === c.text)) l.candidates.push(c)
  } catch {
    // no notes folder open: nothing of yours to teach from
  }
}

/** The reading for a step, chosen from what has been gathered so far; kept once chosen, so a step's reading never changes under it */
function readingFor(l: Lesson, i: number, steps: string[]): StepReading | null {
  const step = steps[i]
  if (!step) return null
  const key = `${i}:${step}`
  const had = l.chosen.get(key)
  if (had) return had
  // [courses] A course's lesson: the step is one of its sections, shown as the course wrote it
  const fromCourse = l.course ? courseReading(l.course, i, step, l.opts.topic) : null
  if (fromCourse) {
    l.chosen.set(key, fromCourse)
    return fromCourse
  }
  own(l, `${step} ${l.opts.topic}`)
  // A book or page on another language is never the reading, however well it matches the step
  const lang = `${l.opts.topic} ${l.where}`
  const r = chooseReading(l.candidates.filter((c) => !otherLanguage(`${c.title} ${c.path ?? ''}`, lang)), i, step, l.opts.topic)
  if (r) l.chosen.set(key, r)
  return r
}

/** For the steps that still have no reading: a web search each, and the trusted pages it finds, in the background */
async function topUp(l: Lesson, steps: string[]) {
  if (!l.opts.web) return
  await l.preparing
  let added = false
  for (let i = 0; i < Math.min(steps.length, MAX_STEPS); i++) {
    const key = `${i}:${steps[i]}`
    if (l.searched.has(key) || l.have.size >= MAX_PAGES || readingFor(l, i, steps)) continue
    l.searched.add(key)
    const found = await webCandidates(l.deps, `${steps[i]} ${l.opts.topic}`, l.opts, l.have).catch(() => [])
    l.candidates.push(...found)
    added ||= found.length > 0
  }
  if (added) await keep(l)
}

/** A lesson that teaches from a plan (not a quiz, a refresher or an interview), from its instructions */
const teaches = (instructions?: string) => /You are running a TEACH session/.test(instructions ?? '')

export interface LedTurn {
  /** The turn as the tutor gets it: the student's message with the reading and the rules for it */
  request: ChatRequest
  /** Fires when Tide ends the tutor's turn at its plan, to open the first step with its reading */
  signal: AbortSignal
  /** This turn shows a reading or marks against one: the problem bank stays out of it */
  teaching: boolean
  tap(emit: (e: ChatEvent) => void): (e: ChatEvent) => void
  /** Once the reply is written: adds a line when the mark quotes words the reading doesn't hold. Returns the reply without its readings, for the checks. */
  settle(shown: string, emit: (e: ChatEvent) => void): string
}

/**
 * This turn of a lesson, taught from sources where a good one was found. Null when the lesson
 * isn't one (not a teaching lesson, or "Let the tutor explain" is chosen), so everything is as
 * it was.
 */
export async function sourceLedTurn(req: ChatRequest & { warmOnly?: boolean }): Promise<LedTurn | null> {
  if (!req.session || req.warmOnly || req.sourceLed === false || !req.topic || !teaches(req.instructions)) return null
  const lesson = await lessonFor(req)
  const replies = req.messages.filter((m) => m.role === 'assistant').map(text)
  // Which replies answered a request to move on: the lesson went on to the next step there
  const moved = req.messages.flatMap((m, i) => (m.role === 'assistant' ? [i > 0 && req.messages[i - 1].role === 'user' && asksToMoveOn(text(req.messages[i - 1]))] : []))
  const state = ledState(replies, moved)
  const last = req.messages[req.messages.length - 1]
  const mine = ownWords(text(last))
  const said: Said = mine.startsWith(GO_ON) ? 'go' : asksToMoveOn(mine) ? 'move' : mine.startsWith(ASKED) ? 'ask' : 'answer'
  // With a plan to follow, a moment for the topic's sources if they're still arriving; before it, never a wait
  if (state.steps.length) {
    await Promise.race([lesson.preparing, new Promise((r) => setTimeout(r, 2500))])
    void topUp(lesson, state.steps).catch(() => {})
  }
  // A step whose best passage is one already shown (two steps of one page) opens without it: seen live, the same Wikipedia passage twice
  const shownText = new Set([...state.shown.values()].map((r) => plain(r.text)))
  const plan = planTurn(state, said, (i) => {
    const r = readingFor(lesson, i, state.steps)
    return !!r && !shownText.has(plain(r.text))
  })
  const shows = plan.top ?? plan.onCorrect ?? plan.onMove
  const reading = shows !== undefined ? readingFor(lesson, shows, state.steps) : null
  const note = turnNote(plan, state, reading)
  const request = note && last?.role === 'user' ? { ...req, messages: [...req.messages.slice(0, -1), { ...last, content: `${text(last)}\n\n${note}` }] } : req
  const stop = new AbortController()
  let placed = false
  let tapNow: ReturnType<typeof ledTap> | null = null
  // What the tap sends once the reply is written (settle), so settle can count it in
  let flushed = ''
  let flushing = false
  return {
    request,
    signal: stop.signal,
    teaching: !!note,
    tap(emit) {
      const tap = ledTap({
        plan,
        reading,
        emit: (t) => {
          if (!t) return
          if (flushing) flushed += t
          emit({ id: req.id, type: 'delta', text: t })
        },
        // Only the first plan of a lesson: its first step opens with the reading when there is one
        ...(state.steps.length ? {} : { firstReading: (steps: string[]) => !!readingFor(lesson, 0, steps) }),
        cut: () => stop.abort()
      })
      tapNow = tap
      return (e) => {
        if (e.type === 'delta') {
          tap.delta(e.text)
          placed = tap.placed
          return
        }
        if (e.type === 'reset') tap.reset()
        emit(e)
      }
    },
    settle(shown, emit) {
      // What the tap still held, and a reading still waiting for its place, close the reply
      flushing = true
      tapNow?.end()
      flushing = false
      placed = tapNow?.placed ?? placed
      shown += flushed
      const marked = plan.marking !== undefined ? state.shown.get(plan.marking) : undefined
      const add = quoteNote(shown, marked, mine)
      if (add) emit({ id: req.id, type: 'delta', text: add })
      if (placed && reading) emit({ id: req.id, type: 'step', step: { id: 'reading', kind: 'helper', label: `Reading from ${reading.title}`, status: 'done', depth: 0 } })
      // The checks look at what the tutor wrote, not at the source's words
      return withoutReadings(shown + add)
    }
  }
}
