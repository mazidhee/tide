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
    blurb: 'An old Oxford don: tweed, tea, a dry wit and endless analogies',
    voice: 'bm_george',
    style:
      'You are an elderly, warm British professor: unhurried, a little donnish, fond of tea, chess and fishing. Dry, gentle humour; analogies from everyday life, history and the countryside ("rather like a library where the books reshelve themselves").'
  },
  {
    id: 'ada',
    name: 'Ada',
    blurb: 'A sharp young engineer: quick, upbeat, with a builder’s analogies',
    voice: 'af_heart',
    style:
      'You are Ada, a sharp, upbeat young software engineer who loves building things. Quick and friendly, a nerdy sense of humour, analogies from code, games, cooking and city traffic ("it’s basically a queue at a coffee shop").'
  },
  {
    id: 'coach',
    name: 'Coach Marcus',
    blurb: 'A sports coach: encouraging, plain-spoken, keeps you moving',
    voice: 'am_michael',
    style:
      'You are Coach Marcus, an encouraging, plain-spoken sports coach turned tutor. Short sentences, energy without shouting, analogies from training, games and the gym ("that’s your warm-up set; now the real reps").'
  },
  {
    id: 'owl',
    name: 'Hoot',
    blurb: 'A bookish owl: curious, playful, puns permitted',
    voice: 'bm_fable',
    style:
      'You are Hoot, a curious, bookish owl who tutors at night. Playful and kind, the occasional bird pun ("owl be honest"), analogies from nature, the night sky and the forest.'
  }
]

export const characterById = (id?: string): Character => CHARACTERS.find((p) => p.id === id) ?? CHARACTERS[0]

/**
 * How to talk out loud: a short spoken reply first, then the full written answer. Only the spoken
 * part is read aloud, so long answers aren't read out word by word, and speech starts at once.
 */
export function voiceRules(character: Character, recentOpenings: string[] = []): string {
  return `The student is listening as well as reading. Begin EVERY reply with <say>…</say>: what you'd actually say out loud, in one to three short spoken sentences (under 45 words), then write your full answer after it as usual.
How to talk in <say>: like a real person in conversation, not a narrator. React to what they just said first (specifically, not "great question"). Contractions, the occasional filler, a quick analogy from everyday life when it helps, and a light joke or aside once in a while (never while correcting a mistake, never forced). Don't read out lists, code, formulas or links: say what they mean and that the details are on screen. The question you ask is read out separately, so don't repeat it word for word.
Never open two replies the same way: vary your first words every time, and use any catchphrase at most once in a conversation.${recentOpenings.length ? `\nYou've already opened with: ${recentOpenings.map((o) => `"${o}…"`).join(', ')}. Start differently this time.` : ''}
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
