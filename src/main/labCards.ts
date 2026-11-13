import { appendLabCards, labCommands, type LabCard } from '@shared/labCards'
import { completeFor, extractJsonArray } from './ai'
import { readTerminal } from './terminal'
import { readText, writeText } from './vault'

/** Where lab flashcards collect: a Linux notebook, so they get their own deck in Review */
export const LAB_CARDS_NOTE = 'Linux/Lab commands.md'

/**
 * Makes flashcards from the commands run in a lab session: the task on the front, the command
 * and what its flags do on the back. New cards are added to the lab's flashcard note.
 */
export async function labFlashcards(terminalId: string, topic?: string): Promise<{ added: number; path: string; commands: number }> {
  const commands = labCommands(readTerminal(terminalId, 60_000))
  if (!commands.length) throw new Error('Run a few commands in the lab first, then make cards from them.')
  const prompt = `A student practised these commands in a Linux terminal${topic ? ` while learning "${topic}"` : ''}:

${commands.map((c) => `- ${c}`).join('\n')}

Write flashcards so they can recall each useful command later. Skip commands that teach nothing (typos, failed attempts, plain navigation).
Rules:
- One command per card, at most ${Math.min(15, commands.length)} cards.
- The front describes the task in plain words, with no command names in it, e.g. "Show the last 20 lines of app.log and keep following new ones".
- The back is the command in backticks, then a short explanation of its flags, e.g. "\`tail -n 20 -f app.log\`: -n 20 shows 20 lines, -f keeps reading as the file grows".
- Generalise file names only when that makes the card clearer.
- Return ONLY a JSON array like [{"front": "...", "back": "..."}].`
  const cards = extractJsonArray<LabCard>(await completeFor('labCards', prompt, undefined)).filter((c) => typeof c?.front === 'string' && typeof c?.back === 'string' && c.back.includes('`'))
  if (!cards.length) throw new Error("The tutor couldn't turn these commands into cards. Try again.")
  const current = await readText(LAB_CARDS_NOTE).catch(() => '')
  const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const { text, added } = appendLabCards(current, cards, topic ? `${topic}, ${day}` : `Lab session, ${day}`)
  if (added) await writeText(LAB_CARDS_NOTE, text)
  return { added, path: LAB_CARDS_NOTE, commands: commands.length }
}
