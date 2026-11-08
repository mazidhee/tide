/**
 * The mistake journal: every question you got wrong, what you said and what the fix was, kept
 * until you've got it right twice on different days. Wrong answers come back the next day, right
 * ones after three days and then a week, so mistakes get retested while they still sting.
 */

export type MistakeSource = 'lesson' | 'quiz' | 'exam' | 'interview' | 'take-home' | 'review'

export interface Mistake {
  id: string
  at: number
  topic: string
  /** The note or notebook it came from */
  path?: string
  source: MistakeSource
  question: string
  /** What you answered, when there was one */
  answer?: string
  /** What was wrong and the right idea */
  fix: string
  status: 'open' | 'fixed'
  /** Right answers in a row, on different days */
  streak: number
  /** When it comes back, yyyy-mm-dd */
  due: string
  lastTried?: string
}

export type NewMistake = Pick<Mistake, 'topic' | 'source' | 'question' | 'fix'> & Partial<Pick<Mistake, 'path' | 'answer'>>

export const addDays = (date: string, n: number): string => {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Adds a mistake, due tomorrow. The same question again (an open one) is updated rather than
 * added twice: its streak resets and the newer fix wins.
 */
export function recordMistake(list: Mistake[], m: NewMistake, today: string, id: string): Mistake[] {
  const q = norm(m.question)
  if (!q) return list
  const clip = (s: string | undefined, n: number) => (s ?? '').trim().slice(0, n)
  const same = list.find((x) => norm(x.question) === q)
  if (same) {
    return list.map((x) =>
      x === same ? { ...x, status: 'open', streak: 0, due: addDays(today, 1), fix: clip(m.fix, 1200) || x.fix, answer: clip(m.answer, 1200) || x.answer, at: Date.now() } : x
    )
  }
  return [
    ...list,
    {
      id,
      at: Date.now(),
      topic: clip(m.topic, 200),
      ...(m.path ? { path: m.path } : {}),
      source: m.source,
      question: clip(m.question, 1200),
      ...(m.answer?.trim() ? { answer: clip(m.answer, 1200) } : {}),
      fix: clip(m.fix, 1200),
      status: 'open',
      streak: 0,
      due: addDays(today, 1)
    }
  ]
}

/**
 * The result of a retest. Right: comes back in 3 days, then it's fixed on the second right answer
 * (only if it's a different day: twice in one sitting proves less). Wrong: back tomorrow.
 */
export function retested(m: Mistake, correct: boolean, today: string): Mistake {
  if (!correct) return { ...m, status: 'open', streak: 0, due: addDays(today, 1), lastTried: today }
  if (m.lastTried === today && m.streak > 0) return m
  const streak = m.streak + 1
  return streak >= 2 ? { ...m, status: 'fixed', streak, due: addDays(today, 30), lastTried: today } : { ...m, streak, due: addDays(today, 3), lastTried: today }
}

/** Open mistakes due by the date, oldest first */
export function dueMistakes(list: Mistake[], today: string, n = 6): Mistake[] {
  return list
    .filter((m) => m.status === 'open' && m.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due) || a.at - b.at)
    .slice(0, n)
}

/** The journal as a note you can read: open ones by topic, then what you've fixed lately */
export function mistakesMarkdown(list: Mistake[]): string {
  const open = list.filter((m) => m.status === 'open')
  const fixed = list.filter((m) => m.status === 'fixed').sort((a, b) => (b.lastTried ?? '').localeCompare(a.lastTried ?? '')).slice(0, 20)
  const out = ['# Mistakes', '', '_Tide keeps this from your lessons, quizzes and exams. Each one comes back until you get it right twice on different days._', '']
  if (!open.length) out.push('Nothing open. Every mistake so far has been put right.', '')
  const topics = [...new Set(open.map((m) => m.topic))]
  for (const t of topics) {
    out.push(`## ${t}`, '')
    for (const m of open.filter((x) => x.topic === t)) {
      out.push(`- **${m.question.replace(/\n+/g, ' ')}**`)
      if (m.answer) out.push(`  - You said: ${m.answer.replace(/\n+/g, ' ')}`)
      out.push(`  - Fix: ${m.fix.replace(/\n+/g, ' ')}`)
      out.push(`  - Back on ${m.due}${m.streak ? ', right once so far' : ''}`)
    }
    out.push('')
  }
  if (fixed.length) {
    out.push('## Put right', '')
    for (const m of fixed) out.push(`- ~~${m.question.replace(/\n+/g, ' ').slice(0, 160)}~~ (${m.topic})`)
    out.push('')
  }
  return out.join('\n')
}

/** Instructions for a retest: these questions, in order, one at a time */
export function retestInstructions(items: Pick<Mistake, 'question' | 'fix' | 'topic'>[]): string {
  return `You are running a RETEST of questions the learner got wrong before. Ask exactly these, in this order, one at a time. Reword each a little so it can't be answered from memory of the wording, but test the same idea. Don't teach before they answer.
${items.map((m, i) => `${i + 1}. (${m.topic}) ${m.question}\n   The right idea: ${m.fix}`).join('\n')}
After each answer, grade it, and if it's still wrong explain the right idea in two or three sentences. Ask the next one in the same reply. After the last, write a short <summary> of what is now fixed and what still isn't.`
}
