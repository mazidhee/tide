import type { AgendaItem } from '@shared/coach'
import type { Mistake } from '@shared/mistakes'
import type { useApp } from '../state'

const ACTIVE = 'tide.agenda.active'

/** Opens a planned item where it's done: a lesson, a quiz, a test, Practice or Review */
export function openAgendaItem(app: ReturnType<typeof useApp>, it: AgendaItem, at?: { date: string; index: number }) {
  // Remembered, so finishing the lesson, quiz or test ticks it off
  try {
    if (at) localStorage.setItem(ACTIVE, JSON.stringify({ ...at, topic: it.kind === 'test' || it.kind === 'take-home' ? it.title : (it.topic ?? it.title), since: Date.now() }))
  } catch {
    // Storage unavailable: it just won't tick itself off
  }
  const scope = it.notebook ? ({ kind: 'folder', path: it.notebook } as const) : ({ kind: 'vault' } as const)
  const topic = it.topic ?? it.title
  if (it.kind === 'learn') {
    // A note for the topic, if there is one; otherwise the tutor teaches it from the notebook
    const note = app.files.find((f) => f.kind === 'note' && f.name.replace(/\.md$/i, '').toLowerCase() === topic.toLowerCase())
    if (note) app.openPath(note.path)
    else app.setView({ kind: 'session', mode: 'teach', scope, topic, nonce: Date.now() })
  } else if (it.kind === 'quiz') app.setView({ kind: 'session', mode: 'quiz', scope, topic, options: { length: 6 }, nonce: Date.now() })
  else if (it.kind === 'review') app.setView({ kind: 'study', scope })
  else if (it.kind === 'practice') app.setView({ kind: 'practice' })
  else
    app.setView({
      kind: 'exam',
      scope,
      topic: it.title,
      options: { questions: it.kind === 'take-home' ? 1 : 4, minutes: it.minutes, difficulty: it.kind === 'take-home' ? 'hard' : 'normal', style: it.kind === 'take-home' ? 'problems' : 'university' },
      nonce: Date.now()
    })
}

export const AGENDA_LABEL: Record<AgendaItem['kind'], string> = { learn: 'Learn', practice: 'Practise', quiz: 'Quiz', review: 'Review', 'take-home': 'Take-home', test: 'Test' }

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
