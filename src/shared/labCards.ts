/**
 * Turning a Linux lab session into flashcards: find the commands that were run in the terminal,
 * and add new cards to the lab's flashcard note without repeating ones already there.
 */

/** A bash prompt in the lab ("root@lab:~# ") or a usual "$ " prompt, then the command */
const PROMPT = /^(?:\(\S+\)\s*)?(?:[\w.-]+@[\w.-]+:[^#$\n]*[#$]|[#$])\s+(.+)$/
/** Commands with nothing to learn on their own */
const TRIVIAL = /^(clear|exit|logout|history|ls|pwd|cd|cd \.\.|cd ~|whoami|true|reset)$/

export function labCommands(transcript: string, max = 40): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of transcript.split('\n')) {
    const m = raw.trimEnd().match(PROMPT)
    if (!m) continue
    const cmd = m[1].trim().replace(/\s+/g, ' ')
    if (!cmd || cmd.length > 300 || TRIVIAL.test(cmd) || seen.has(cmd)) continue
    seen.add(cmd)
    out.push(cmd)
  }
  return out.slice(-max)
}

export interface LabCard {
  front: string
  back: string
}

const clean = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/::/g, ':').trim()
/** The command in a card's back, for spotting repeats: the first `code` span, or the whole back */
const commandOf = (back: string) => (back.match(/`([^`]+)`/)?.[1] ?? back).trim().toLowerCase()

/**
 * Adds cards under a heading for this session. Cards whose front or command is already in the
 * note are skipped. Returns the new note text and how many cards were added.
 */
export function appendLabCards(note: string, cards: LabCard[], heading: string): { text: string; added: number } {
  const existing = note.split('\n').filter((l) => l.includes('::'))
  const fronts = new Set(existing.map((l) => l.split('::')[0].trim().toLowerCase()))
  const commands = new Set(existing.map((l) => commandOf(l.split('::').slice(1).join('::'))))
  const fresh: string[] = []
  for (const c of cards) {
    const front = clean(c.front)
    const back = clean(c.back)
    if (!front || !back) continue
    if (fronts.has(front.toLowerCase()) || commands.has(commandOf(back))) continue
    fronts.add(front.toLowerCase())
    commands.add(commandOf(back))
    fresh.push(`${front}::${back}`)
  }
  if (!fresh.length) return { text: note, added: 0 }
  const base = note.trim()
    ? note.replace(/\s*$/, '\n')
    : '---\ntags: [flashcards]\n---\n\n# Lab commands\n\nCommands from your Linux lab sessions. Review them in Review.\n'
  return { text: `${base}\n## ${heading}\n\n${fresh.join('\n')}\n`, added: fresh.length }
}
