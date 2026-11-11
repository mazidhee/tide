/**
 * The daily brief: what you did on your last study day, for a recap and a quiz. Built from events
 * Tide already records (answers, flashcard reviews, edited notes, conversations, practice).
 */

export interface StudyEvent {
  at: number
  kind: 'answer' | 'review' | 'note' | 'chat' | 'problem' | 'focus'
  /** Topic, note title, conversation title or problem name */
  title: string
  path?: string
  /** 0..1 for answers and problems */
  score?: number
  /** Length of a focus session */
  minutes?: number
}

export interface BriefTopic {
  title: string
  path?: string
}

export interface StudyDay {
  /** Local date, YYYY-MM-DD */
  day: string
  /** "so far today", "yesterday", "on Tuesday", "on 3 Nov" */
  when: string
  topics: BriefTopic[]
  answers: number
  correct: number
  reviews: number
  notes: number
  chats: number
  problems: number
  /** Minutes of timed focus that day */
  focus: number
}

export const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function whenLabel(day: string, now: number): string {
  if (day === dayKey(now)) return 'so far today'
  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  const d = new Date(day + 'T12:00:00')
  const days = Math.round((today.getTime() - d.getTime()) / 86_400_000)
  if (days <= 1) return 'yesterday'
  if (days < 7) return `on ${d.toLocaleDateString('en-GB', { weekday: 'long' })}`
  return `on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

const MAX_TOPICS = 5

/**
 * A topic as you'd name it: a study timer's label carries the session's mode ("teach: Variables",
 * "quiz: Raft", "Lesson: …"), which Home showed as it was, beside the same topic from its answers
 */
export const topicTitle = (title: string) =>
  title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(teach|quiz|mixed|interview|explain|lesson|quiz me|teach me|check|review|retest)\s*:\s*/i, '')
    .trim()

/**
 * The most recent day before today with any study, within two weeks. With nothing before today,
 * today itself (so a first day of study still gets its recap and quiz). Null when there's nothing.
 */
export function lastStudyDay(events: StudyEvent[], now = Date.now()): StudyDay | null {
  const today = dayKey(now)
  const earliest = now - 14 * 86_400_000
  const recent = events.filter((e) => e.at >= earliest && e.at <= now)
  const before = recent.filter((e) => dayKey(e.at) !== today)
  const past = before.length ? before : recent
  if (!past.length) return null
  const day = dayKey(Math.max(...past.map((e) => e.at)))
  const of = past.filter((e) => dayKey(e.at) === day)
  // Topics in order of how much time went into them: answers count most, then notes and chats
  const weight: Record<StudyEvent['kind'], number> = { answer: 3, problem: 3, note: 2, chat: 2, review: 1, focus: 2 }
  const scored = new Map<string, { topic: BriefTopic; score: number }>()
  for (const e of of) {
    // Timed sessions add to the topic they were on; untitled ones only count as time
    if (e.kind === 'focus' && !e.title) continue
    const title = topicTitle(e.title)
    if (!title) continue
    // One topic however it was recorded: by its note when it has one, else by name, and a name
    // already seen with a note joins that one
    const byName = title.toLowerCase()
    const key = e.path ? e.path.toLowerCase() : ([...scored].find(([, v]) => v.topic.title.toLowerCase() === byName)?.[0] ?? byName)
    const named = e.path ? scored.get(byName) : undefined
    const entry = scored.get(key) ?? { topic: { title, path: e.path }, score: named?.score ?? 0 }
    if (named && key !== byName) scored.delete(byName)
    entry.score += weight[e.kind]
    scored.set(key, entry)
  }
  const topics = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, MAX_TOPICS).map((x) => x.topic)
  const answers = of.filter((e) => e.kind === 'answer')
  return {
    day,
    when: whenLabel(day, now),
    topics,
    answers: answers.length,
    correct: answers.filter((e) => (e.score ?? 0) >= 0.7).length,
    reviews: of.filter((e) => e.kind === 'review').length,
    notes: of.filter((e) => e.kind === 'note').length,
    chats: of.filter((e) => e.kind === 'chat').length,
    problems: of.filter((e) => e.kind === 'problem').length,
    focus: Math.round(of.filter((e) => e.kind === 'focus').reduce((n, e) => n + (e.minutes ?? 0), 0))
  }
}

/** "Consumer theory, hash maps and Raft" */
export function listTopics(topics: BriefTopic[], max = 3): string {
  const names = topics.slice(0, max).map((t) => t.title)
  const rest = topics.length - names.length
  if (rest > 0) return `${names.join(', ')} and ${rest} more`
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** "45 min", "1 h 20 min" */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}
