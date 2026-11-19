/**
 * How Tide writes anything a person will say or read as their own: interview answers, feedback,
 * stories. Distilled from Wikipedia's "Signs of AI writing" (WP:AISIGNS), which lists the words and
 * patterns editors use to spot chatbot text, and GOV.UK's plain English guidance (its "words to
 * avoid" and sentence-length rules). `HUMAN_WRITING` goes into every prompt that writes answers or
 * feedback; `aiTells` flags what slipped through, so the page can show it and code marking can
 * count it.
 */

export const HUMAN_WRITING = `How to write (this is said aloud by a real person, so it must sound like them):
- Plain, specific words. Say what happened: "I rewrote the reconciliation script", not "I spearheaded a transformative initiative".
- Vary sentence length. Mostly short sentences; split anything over 25 words. No semicolons.
- Use "is" and "has". Not "serves as", "stands as", "boasts", "represents".
- First person for what the speaker did ("I"), "we" only for what the team did.
- Numbers and names where the facts give them. Where the facts don't, write PRACTICE VERSION: <what to replace> and move on. Never invent a figure, a date, a name or an outcome.
- End on the result or what was learned, then stop. No summary line, no upbeat closer.
Never use:
- Inflated words: delve, tapestry, testament, pivotal, crucial, vibrant, intricate, interplay, landscape, realm, meticulous(ly), seamless(ly), robust, leverage, foster, empower, transformative, synergy, holistic, multifaceted, spearhead(ed), navigate (for anything but travel), embark, journey (for work), elevate, unlock, harness, game-changer, cutting-edge, invaluable, paramount, showcase, underscore, garner, bolster, enduring, indelible.
- Puffery: "a testament to", "plays a vital role", "a pivotal moment", "setting the stage for", "the evolving landscape", "deeply rooted", "left an indelible mark".
- Trailing -ing commentary: ", highlighting…", ", underscoring…", ", ensuring…", ", reflecting…", ", showcasing…", ", fostering…".
- Negative parallelisms: "not only… but also", "it's not X, it's Y", "not just X but Y", "no X, no Y, just Z".
- Lists of three by reflex ("speed, accuracy, and reliability") when the facts give one or two.
- Em dashes. Use a full stop or a comma.
- Vague attributions: "experts say", "industry reports suggest", "many believe".
- Openers and closers: "Great question", "Certainly", "In summary", "In conclusion", "Overall,", "Ultimately,", "I hope this helps", "Let me know", "Moving forward", "Going forward".
- Bold for emphasis, emoji, title case headings.`

/** A shorter version for feedback written to the learner */
export const HUMAN_FEEDBACK = `Write feedback as a plain-spoken interviewer would say it to the candidate: "you", short sentences, specific (quote what they said), no praise padding, no em dashes, none of these words: delve, crucial, pivotal, robust, leverage, showcase, underscore, seamless, testament, landscape, journey.`

export interface AiTell {
  phrase: string
  why: string
  /** Where it starts in the text */
  at: number
}

const WORDS =
  'delve|delves|delving|tapestry|testament|pivotal|crucial|vibrant|intricate|intricacies|interplay|landscape|realm|meticulous|meticulously|seamless|seamlessly|robust|leverage|leveraged|leveraging|foster|fostered|fostering|empower|empowered|empowering|transformative|synergy|synergies|holistic|multifaceted|spearhead|spearheaded|spearheading|embark|embarked|elevate|elevated|unlock|unlocked|harness|harnessed|game-changer|cutting-edge|invaluable|paramount|showcase|showcased|showcasing|underscore|underscores|underscored|underscoring|garner|garnered|bolster|bolstered|indelible|boasts'

const RULES: { re: RegExp; why: string }[] = [
  { re: new RegExp(`\\b(${WORDS})\\b`, 'gi'), why: 'Inflated word: say it plainly' },
  { re: /\b(a testament to|plays? a (vital|key|crucial|pivotal) role|pivotal moment|set(ting)? the stage for|evolving landscape|deeply rooted|left an? (indelible|lasting) mark|in today's fast-paced)\b/gi, why: 'Puffery' },
  { re: /\b(serves|served|stands|stood) as (a|an|the)\b/gi, why: 'Say "is" or "was"' },
  { re: /,\s+(highlighting|underscoring|emphasi[sz]ing|ensuring|reflecting|showcasing|fostering|symboli[sz]ing|demonstrating)\b/gi, why: 'Trailing -ing commentary: cut it or make it a sentence' },
  { re: /\bnot only\b[^.?!]{1,80}\bbut( also)?\b/gi, why: '"Not only… but": say the one thing' },
  { re: /\b(it'?s|it is|this is|that'?s) not (just |only |merely )?[^.?!,;]{1,40}[,;]\s*(it'?s|it is|but)\b/gi, why: '"It\'s not X, it\'s Y"' },
  { re: /\s—\s|\w—\w/g, why: 'Em dash: use a full stop or a comma' },
  { re: /\b(experts (say|agree|argue)|industry reports|studies show|many believe|observers (have )?(noted|cited))\b/gi, why: 'Vague attribution' },
  { re: /\b(great question|certainly!|absolutely!|i hope this helps|let me know if|in summary|in conclusion|to sum up|overall,|ultimately,|moving forward|going forward)\b/gi, why: 'Chatbot opener or closer' },
  { re: /\b(my|the|this|our) journey\b/gi, why: '"Journey": say what happened' },
  { re: /\bnavigat(e|ed|ing) (the |a |complex |these )/gi, why: '"Navigate": say what was done' }
]

/** Phrases in a text that read as machine-written, in order, each once */
export function aiTells(text: string): AiTell[] {
  const out: AiTell[] = []
  for (const r of RULES)
    for (const m of text.matchAll(r.re)) {
      const phrase = m[0].replace(/^,\s+/, '').trim()
      if (!out.some((o) => o.at === m.index)) out.push({ phrase, why: r.why, at: m.index ?? 0 })
    }
  // A reflexive triple: "X, Y, and Z" of single words, more than once
  const triples = [...text.matchAll(/\b(\w+), (\w+),? and (\w+)\b/g)]
  if (triples.length >= 2) for (const m of triples) out.push({ phrase: m[0], why: 'Rule of three by reflex', at: m.index ?? 0 })
  // Long sentences
  for (const m of text.matchAll(/[^.!?\n]+[.!?]/g)) if (m[0].trim().split(/\s+/).length > 35) out.push({ phrase: m[0].trim().slice(0, 60) + '…', why: 'Over 35 words: split it', at: m.index ?? 0 })
  return out.sort((a, b) => a.at - b.at)
}

/** 0 to 1: how natural a spoken answer reads (1 with no tells, about a tenth off for each) */
export const naturalness = (text: string) => Math.max(0, 1 - aiTells(text).length * 0.12)
