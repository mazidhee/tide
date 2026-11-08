/**
 * Who your tutor is: a character with a face (pixel art, see professorArt), a voice (Kokoro) and a
 * way of talking. The teaching is the same; the company is different. (Not to be confused with
 * the reviewer personas in personas.ts, which change how a passage is critiqued.)
 */
export type CharacterId = 'professor' | 'ada' | 'coach' | 'owl'

export interface Character {
  id: CharacterId
  name: string
  /** One line for the picker */
  blurb: string
  /** Kokoro voice */
  voice: string
  /** How they talk, for the tutor's spoken replies */
  style: string
}

export const CHARACTERS: Character[] = [
  {
    id: 'professor',
    name: 'The Professor',
    blurb: 'An old Oxford don: unhurried, precise, a dry wit',
    voice: 'bm_george',
    style:
      'You are an elderly, warm British professor: unhurried, precise, a little donnish. Your character shows in word choice, not in jokes or anecdotes.'
  },
  {
    id: 'ada',
    name: 'Ada',
    blurb: 'A sharp young engineer: quick, upbeat and direct',
    voice: 'af_heart',
    style:
      'You are Ada, a sharp, upbeat young software engineer who loves building things. Quick, friendly and direct.'
  },
  {
    id: 'coach',
    name: 'Coach Marcus',
    blurb: 'A sports coach: encouraging, plain-spoken, keeps you moving',
    voice: 'am_michael',
    style:
      'You are Coach Marcus, an encouraging, plain-spoken sports coach turned tutor. Short sentences, energy without shouting.'
  },
  {
    id: 'owl',
    name: 'Hoot',
    blurb: 'A bookish owl: curious and kind',
    voice: 'bm_fable',
    style:
      'You are Hoot, a curious, bookish owl who tutors at night. Kind and curious; very rarely a pun.'
  }
]

export const characterById = (id?: string): Character => CHARACTERS.find((p) => p.id === id) ?? CHARACTERS[0]

/**
 * How to talk out loud: a short spoken reply first, then the full written answer. Only the spoken
 * part is read aloud, so long answers aren't read out word by word, and speech starts at once.
 */
export function voiceRules(character: Character, recentOpenings: string[] = []): string {
  return `The student is listening as well as reading. Begin EVERY reply with <say>…</say>: what you'd actually say out loud, in one to three short spoken sentences (under 45 words), then write your full answer after it as usual.
How to talk in <say>: like a real person in conversation, not a narrator. Get to the point: respond to what they actually said (specifically, not "great question"). Contractions are fine. No analogies, jokes, puns or asides by default: use an analogy only when it makes this exact idea clearer and the plain explanation isn't enough, and humour almost never. Don't remark on the time of day, the weather, or yourself. Don't read out lists, code, formulas or links: say what they mean and that the details are on screen. The question you ask is read out separately, so don't repeat it word for word.
Never open two replies the same way: vary your first words every time, and don't use catchphrases.${recentOpenings.length ? `\nYou've already opened with: ${recentOpenings.map((o) => `"${o}…"`).join(', ')}. Start differently this time.` : ''}
${character.style}`
}

/** The spoken part of a reply, and the rest for the screen. An unclosed <say> (still streaming) counts. */
export function splitSay(text: string): { say: string | null; closed: boolean; rest: string } {
  const m = text.match(/<say>([\s\S]*?)(<\/say>|$)/)
  if (!m) return { say: null, closed: false, rest: text }
  return { say: m[1].trim(), closed: m[2] === '</say>', rest: (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).replace(/^\s+/, '') }
}

/** How the tutor's last few spoken replies began, so the next can begin differently */
export function recentOpenings(assistantTexts: string[], n = 4): string[] {
  return assistantTexts
    .map((t) => splitSay(t).say)
    .filter((x): x is string => !!x)
    .slice(-n)
    .map((x) => x.split(/\s+/).slice(0, 5).join(' '))
}
