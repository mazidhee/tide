import { KIND_LABEL, type AgendaItem } from '@shared/coach'
import type { ChatScope } from '@shared/types'
import { whyByDefault } from '@shared/session'
import type { Mistake } from '@shared/mistakes'
import type { useApp } from '../state'

const ACTIVE = 'tide.agenda.active'

/** Remembered, so finishing the lesson, quiz or test ticks it off */
function remember(it: AgendaItem, at?: { date: string; index: number }) {
  try {
    if (at) localStorage.setItem(ACTIVE, JSON.stringify({ ...at, topic: it.kind === 'check' ? checkTopic(it.title) : it.kind === 'test' || it.kind === 'take-home' ? it.title : (it.topic ?? it.title), since: Date.now() }))
  } catch {
    // Storage unavailable: it just won't tick itself off
  }
}

/** The topic's own note, if there is one */
const noteFor = (app: ReturnType<typeof useApp>, topic: string) => app.files.find((f) => f.kind === 'note' && f.name.replace(/\.md$/i, '').toLowerCase() === topic.toLowerCase())

/** Where a planned lesson is taught from: its note, else its notebook */
export function lessonScope(app: ReturnType<typeof useApp>, it: AgendaItem): ChatScope {
  const note = noteFor(app, it.topic ?? it.title)
  return note ? { kind: 'note', path: note.path } : it.notebook ? { kind: 'folder', path: it.notebook } : { kind: 'vault' }
}

/** Starts the lesson for a planned topic straight away (Home's "Next lesson") */
export function startAgendaLesson(app: ReturnType<typeof useApp>, it: AgendaItem, at: { date: string; index: number }) {
  remember(it, at)
  app.setView({ kind: 'session', mode: 'teach', scope: lessonScope(app, it), topic: it.topic ?? it.title, options: { ...(it.refresh ? { refresh: true } : {}), why: whyByDefault(app.settings.whyMode, it.topic ?? it.title, it.topicId) }, nonce: Date.now() })
}

/** The topic a Check's session runs under, so finishing it ticks the item off */
export const checkTopic = (section: string) => `What I already know: ${section}`

/** Opens a planned item where it's done: a lesson, a quiz, a test, Practice or Review */
export function openAgendaItem(app: ReturnType<typeof useApp>, it: AgendaItem, at?: { date: string; index: number }) {
  remember(it, at)
  const scope = it.notebook ? ({ kind: 'folder', path: it.notebook } as const) : ({ kind: 'vault' } as const)
  const topic = it.topic ?? it.title
  if (it.kind === 'check' && it.check) {
    app.setView({ kind: 'session', mode: 'quiz', scope, topic: checkTopic(it.title), options: { placement: it.check, length: 6 }, nonce: Date.now() })
    return
  }
  if (it.kind === 'learn' && it.refresh) {
    app.setView({ kind: 'session', mode: 'teach', scope: lessonScope(app, it), topic, options: { refresh: true, why: whyByDefault(app.settings.whyMode, topic, it.topicId) }, nonce: Date.now() })
    return
  }
  if (it.kind === 'learn') {
    // A note for the topic, if there is one; otherwise the tutor teaches it from the notebook
    const note = noteFor(app, topic)
    if (note) app.openPath(note.path)
    else app.setView({ kind: 'session', mode: 'teach', scope, topic, options: { why: whyByDefault(app.settings.whyMode, topic, it.topicId) }, nonce: Date.now() })
  } else if (it.kind === 'quiz') app.setView({ kind: 'session', mode: 'quiz', scope, topic, options: { length: 6 }, nonce: Date.now() })
  else if (it.kind === 'review') app.setView({ kind: 'study', scope })
  else if (it.kind === 'practice') app.setView({ kind: 'practice' })
  else if (it.kind === 'project') it.path ? app.setView({ kind: 'notebook', path: it.path, tab: 'project' }) : app.setView({ kind: 'practice' })
  else if (it.kind === 'mock') app.setView({ kind: 'mock', mode: it.mode ?? 'coding', nonce: Date.now() })
  else if (it.kind === 'workout') app.setView({ kind: 'workout' })
  else if (it.kind === 'read') it.path ? app.openPath(it.path) : app.setView({ kind: 'reading' })
  else
    app.setView({
      kind: 'exam',
      scope,
      topic: it.title,
      options: { questions: it.kind === 'take-home' ? 1 : 4, minutes: it.minutes, difficulty: it.kind === 'take-home' ? 'hard' : 'normal', style: it.kind === 'take-home' ? 'problems' : 'university' },
      nonce: Date.now()
    })
}

export const AGENDA_LABEL: Record<AgendaItem['kind'], string> = KIND_LABEL

/** Ticks off the planned item this lesson, quiz or test was started from, if it was */
export function finishAgendaItem(topic: string): void {
  try {
    const a = JSON.parse(localStorage.getItem(ACTIVE) ?? 'null') as { date: string; index: number; topic: string; since: number } | null
    if (!a || a.topic !== topic || Date.now() - a.since > 12 * 3_600_000) return
    localStorage.removeItem(ACTIVE)
    window.tide.coach.setDone(a.date, a.index, true).catch(() => {})
  } catch {
    // Nothing remembered
  }
}

/** Starts a retest of the mistakes that are due */
export function startRetest(app: ReturnType<typeof useApp>, due: Mistake[]) {
  app.setView({
    kind: 'session',
    mode: 'quiz',
    scope: { kind: 'vault' },
    topic: 'Mistakes to retest',
    options: { length: due.length, retest: due.map((m) => ({ id: m.id, topic: m.topic, question: m.question, fix: m.fix })) },
    nonce: Date.now()
  })
}

export { whyByDefault } from '@shared/session'
