/**
 * What earlier lessons show, read straight from their record: the plan, every question asked and
 * how each was marked, and where the lesson stopped. No model is asked to summarise, so nothing is
 * invented and it costs nothing. A new lesson on the same or a related topic opens with this, so the
 * tutor builds on what was learnt, goes back to what was missed, and doesn't teach it all again.
 */
import type { LessonRecord } from './lessonLog'
import { ownWords, parseBlocks } from './session'

export interface LessonDigest {
  id: string
  topic: string
  /** When it was last worked on */
  when: number
  finished: boolean
  /** The steps the tutor planned */
  plan: string[]
  right: number
  partly: number
  wrong: number
  /** The questions marked wrong or partly right, newest first */
  missed: string[]
  /** The questions they couldn't answer, or asked to have explained again, newest first */
  stuck: string[]
  /** The question it stopped on, unanswered */
  open?: string
  /** How its first question went: marked, not answered, or answered without a mark */
  opening?: 'correct' | 'partial' | 'wrong' | 'stuck' | 'answered'
}

const short = (s: string, n = 150) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1).trimEnd()}…` : flat
}

export function digestLesson(r: LessonRecord): LessonDigest | null {
  if (r.mode !== 'teach' && r.mode !== 'quiz') return null
  const d: LessonDigest = { id: r.id, topic: r.topic, when: r.updated, finished: !!r.finished, plan: [], right: 0, partly: 0, wrong: 0, missed: [], stuck: [] }
  // The question waiting for an answer; the next reply's first mark is the mark for it
  let asked: string | undefined
  // Whether the question waiting is the lesson's first, and whether they have replied to it
  let first = true
  let replied = false
  for (const t of r.turns) {
    if (t.role !== 'assistant') {
      // "I don't know", a hint, or "can you explain that again" in place of an answer
      const stuck = !!asked && STUCK.test(ownWords(t.content).replace(/^Answer:\s*/i, ''))
      if (stuck && !d.stuck.includes(short(asked!))) d.stuck.unshift(short(asked!))
      if (asked && first && !d.opening) stuck ? (d.opening = 'stuck') : (replied = true)
      continue
    }
    const blocks = parseBlocks(t.content)
    // The plan is restated as the lesson goes: the latest is the fullest
    const plan = [...blocks].reverse().find((b) => b.kind === 'plan')
    if (plan && plan.kind === 'plan' && plan.steps.length) d.plan = plan.steps.map((s) => short(s, 90))
    const grade = blocks.find((b) => b.kind === 'grade')
    if (asked && first && replied && !d.opening) d.opening = grade && grade.kind === 'grade' ? (grade.verdict === 'correct' ? 'correct' : grade.verdict === 'wrong' ? 'wrong' : 'partial') : 'answered'
    if (asked && (replied || d.opening)) first = false
    if (grade && grade.kind === 'grade' && asked) {
      if (grade.verdict === 'correct') d.right++
      else {
        grade.verdict === 'wrong' ? d.wrong++ : d.partly++
        d.missed.unshift(short(asked))
      }
    }
    const ask = [...blocks].reverse().find((b) => b.kind === 'ask')
    asked = ask && ask.kind === 'ask' ? ask.prompt : grade ? undefined : asked
  }
  if (asked && !d.finished) d.open = short(asked)
  // Nothing was asked or planned: there is nothing to build on
  return d.plan.length || d.right + d.partly + d.wrong + d.stuck.length > 0 ? d : null
}

const STUCK = /^\s*(\[hint\]|idk\b|no idea\b|not sure\b|i (really )?(don'?t|do not) (really )?(know|understand|get)\b|i'?m (not sure|lost|confused)\b)|\bcan you (please )?(explain|show|give me)\b|\b(explain|say) (that|it|this) again\b/i

const STOP = new Set('about with from that this into what when where which their there have your and the for are its how why of in to on a an introduction intro basics fundamentals advanced overview part lesson topic learn learning understanding understand explained guide'.split(' '))
// Plurals count as the same word ("numbers", "number")
const words = (topic: string) => new Set(topic.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)))

/** How close two topics are: 1 the same, 0 nothing in common */
export function closeness(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  const both = [...x].filter((w) => y.has(w)).length
  return both / Math.min(x.size, y.size)
}

/** The earlier lessons worth telling the tutor about: the same topic first, then close ones, latest first */
export function relatedLessons(topic: string, all: LessonDigest[], now = Date.now()): LessonDigest[] {
  return all
    .map((d) => ({ d, close: closeness(topic, d.topic) }))
    .filter((x) => x.close >= 0.5 && now - x.d.when < 180 * 86_400_000)
    .sort((a, b) => b.close - a.close || b.d.when - a.d.when)
    .slice(0, 3)
    .map((x) => x.d)
}

const day = (ms: number, now: number) => {
  const days = Math.floor((now - ms) / 86_400_000)
  return days <= 0 ? 'earlier today' : days === 1 ? 'yesterday' : days < 14 ? `${days} days ago` : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

/** The note a new lesson's tutor is given about earlier ones; empty when there are none */
export function priorLessonsNote(topic: string, all: LessonDigest[], now = Date.now()): string {
  const found = relatedLessons(topic, all, now)
  if (!found.length) return ''
  const lines = found.map((d) => {
    const marks = d.right + d.partly + d.wrong
    const parts = [
      `"${d.topic}", ${day(d.when, now)}${d.finished ? '' : ' (not finished)'}`,
      d.plan.length ? `planned: ${d.plan.slice(0, 6).join('; ')}` : '',
      marks ? `${marks} question${marks === 1 ? '' : 's'} marked: ${d.right} right, ${d.partly} partly, ${d.wrong} wrong` : '',
      d.missed.length ? `missed: ${d.missed.slice(0, 3).map((m) => `"${m}"`).join('; ')}` : '',
      d.stuck.length ? `couldn’t answer, or asked to have explained again: ${d.stuck.slice(0, 3).map((m) => `"${m}"`).join('; ')}` : '',
      d.open ? `stopped on, unanswered: "${d.open}"` : ''
    ]
    return `- ${parts.filter(Boolean).join('. ')}.`
  })
  const same = closeness(topic, found[0].topic) === 1
  return [
    'From Tide’s record of earlier lessons with this student (facts read from those lessons, not your memory; use them, don’t recite them):',
    ...lines,
    same
      ? 'This lesson continues that work. Open with one short question on the most important thing they missed or couldn’t answer (or, if there was nothing, the last thing covered), so they recall it before you add to it. Then carry on from where it stopped: don’t teach again what they got right.'
      : 'This lesson is on a different topic that touches those. Where an idea here rests on one from them, say so in a line and build on it; if it rests on something they missed there, check that first with one short question.'
  ].join('\n')
}
