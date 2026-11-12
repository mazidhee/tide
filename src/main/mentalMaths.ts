/**
 * Daily mental maths (shared/mentalMaths makes and marks the questions): the log of sessions and
 * the old reminder setting, kept in the vault under .tide/. The morning workout (main/workout)
 * took over the daily slot and the reminder; this stays for practising one level of the ladder.
 */
import { promises as fs } from 'fs'
import { dayKey, fixedExplanation, levelById, type MathsAnswer, type MathsSession, type MathsState, type Reminder } from '@shared/mentalMaths'
import { absPath, joinRel } from './vault'

const LOG = joinRel('.tide', 'mental-maths.jsonl')
const PREFS = joinRel('.tide', 'mental-maths.json')

async function readSessions(): Promise<MathsSession[]> {
  try {
    return (await fs.readFile(absPath(LOG), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as MathsSession]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

async function readReminder(): Promise<Reminder> {
  try {
    const r = (JSON.parse(await fs.readFile(absPath(PREFS), 'utf8')) as { reminder?: Reminder }).reminder
    return r === 'morning' || r === 'evening' ? r : 'off'
  } catch {
    return 'off'
  }
}

export async function mathsState(): Promise<MathsState> {
  return { sessions: await readSessions(), reminder: await readReminder() }
}

/** Saves one finished session; its day is today where you are now */
export async function logMathsSession(s: Pick<MathsSession, 'focus' | 'answers'>): Promise<MathsSession> {
  if (!levelById(s.focus) || !Array.isArray(s.answers) || !s.answers.length) throw new Error('Not a valid session.')
  const clean = (a: MathsAnswer): MathsAnswer => ({
    level: levelById(a.level) ? a.level : s.focus,
    prompt: String(a.prompt).slice(0, 200),
    answer: String(a.answer).slice(0, 60),
    given: String(a.given ?? '').slice(0, 60),
    right: !!a.right,
    ms: Math.max(0, Math.min(600_000, Math.round(Number(a.ms) || 0))),
    how: String(a.how ?? '').slice(0, 400)
  })
  const at = Date.now()
  const record: MathsSession = { id: Math.random().toString(36).slice(2, 10), at, day: dayKey(at), focus: s.focus, answers: s.answers.slice(0, 60).map(clean) }
  await fs.mkdir(absPath(joinRel('.tide')), { recursive: true })
  await fs.appendFile(absPath(LOG), JSON.stringify(record) + '\n')
  return record
}

export async function setMathsReminder(r: Reminder): Promise<Reminder> {
  const reminder: Reminder = r === 'morning' || r === 'evening' ? r : 'off'
  await fs.mkdir(absPath(joinRel('.tide')), { recursive: true })
  await fs.writeFile(absPath(PREFS), JSON.stringify({ reminder }, null, 2))
  return reminder
}

/**
 * Why a missed question's answer is what it is: Claude's background model (Haiku) when Claude
 * teaches, otherwise (or if it can't) the fixed explanation the question came with.
 */
export async function explainMiss(a: Pick<MathsAnswer, 'level' | 'prompt' | 'answer' | 'given' | 'how'>): Promise<{ text: string; by: 'claude' | 'tide' }> {
  const fixed = fixedExplanation(a)
  const level = levelById(a.level)
  try {
    const { backgroundOnClaude } = await import('./claudeEngine')
    const text = await backgroundOnClaude(
      `Mental maths question: ${a.prompt}\nRight answer: ${a.answer}\nThey typed: ${a.given || '(nothing)'}\nThe trick this level teaches: ${level?.title ?? ''}. ${level?.trick ?? ''}\nWorked steps: ${a.how}\n\nIn two to four short sentences: show how to do this one in your head with that trick, and if their answer suggests a particular slip, name it. Plain text, no headings, no analogies or jokes.`,
      'You coach mental arithmetic. You are exact, brief and plain.'
    )
    if (text?.trim()) return { text: text.trim(), by: 'claude' }
  } catch {
    // The fixed explanation below
  }
  return { text: fixed, by: 'tide' }
}
