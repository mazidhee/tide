/**
 * How Tide writes anything a person will say or read as their own: interview answers, feedback,
 * stories, spoken scripts. `HUMAN_WRITING` goes into every prompt that writes answers or feedback;
 * `SPOKEN_SCRIPT` into the prompts that co-write a spoken answer with the learner; `aiTells` flags
 * what slipped through, so the page can show it and code marking can count it.
 *
 * Sources. Every rule and pattern here is paraphrased in Tide's own words; no text is copied.
 * - Wikipedia, "Wikipedia:Signs of AI writing" (WikiProject AI Cleanup), CC BY-SA 4.0: the AI
 *   vocabulary, copula avoidance, negative parallelism, puffery, trailing -ing commentary, vague
 *   attribution, "despite these challenges" endings, false ranges, triads, em dashes, markdown
 *   residue. It warns that one hit is weak evidence, so tells are shown, not used to reject.
 * - blader/humanizer (github.com/blader/humanizer), MIT, (c) 2025 Siqi Chen: staged run-ups
 *   ("here's the thing"), one-line dramatic closers, chatbot residue, narrating the answer,
 *   intensifiers and hedges that only count when stacked.
 * - hardikpandya/stop-slop (github.com/hardikpandya/stop-slop), MIT, (c) 2025 Hardik Pandya:
 *   throat-clearing and emphasis crutches, filler scene-setters ("in today's..."), jargon
 *   ("deep dive", "lean into", "circle back"), meta-commentary, vague declaratives.
 * - GOV.UK plain English guidance (Open Government Licence) and the US Federal Plain Language
 *   Guidelines (plainlanguage.gov, a US government work): main point first, short sentences,
 *   everyday words, active voice, "you" and "I".
 * - George Orwell, "Politics and the English Language" (1946; still in copyright in some places, so
 *   only the ideas are used): no stale figures of speech, the short word, cut what can be cut,
 *   active voice, no jargon, and break a rule before saying something absurd.
 * - Writing for the ear (OpenStax Writing Guide, CC BY 4.0; Congressional Research Service,
 *   "Speechwriting in Perspective", a US government work): signpost where you are going, keep
 *   sentences simple and short, and read the draft aloud.
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

/**
 * Co-writing a spoken interview answer that the learner will say as their own. Goes with
 * HUMAN_WRITING and the learner's voice.md (their rules win over these).
 */
export const SPOKEN_SCRIPT = `Writing for the ear (this script is said aloud, from memory, in an interview):
- Answer first. The first sentence answers the question; the rest supports it.
- One idea per sentence. Most sentences 8 to 18 words; one longer one now and then is fine. If a line runs out of breath read aloud, split it.
- Concrete nouns: the real project, team, number, tool. Never an abstraction where a thing will do.
- Spoken connectors: "so", "but", "and then", "that meant". Never "moreover", "furthermore", "additionally".
- Contractions, as people speak: "I'd", "it's", "didn't".
- Signpost once if there are parts ("Two things got me here."), then say "first", "then". Don't narrate the answer ("let me walk you through").
- Behavioural answers: a sentence or two of situation, most of the time on what "I" did and why, then the result with a number if the facts give one, then one line on what it taught. Stop there.
- An honest limit or trade-off sounds human. Don't polish every edge.
- No stock phrases, idioms or clichés ("passionate about", "fast-paced environment", "hit the ground running", "at the end of the day").
- Match the speaker: their words, their sentence length, their habits (how they start a point, what they never say). Their voice rules beat these rules.
- No recap and no closer. End on the last real point.
- Read-aloud test: if a sentence would sound odd said across a table to a colleague, rewrite it.
- Plain text only: no bullets, headings, bold or emoji. Paragraph breaks where the speaker would pause.`

/** A shorter version for feedback written to the learner */
export const HUMAN_FEEDBACK = `Write feedback as a plain-spoken interviewer would say it to the candidate: "you", short sentences, specific (quote what they said), no praise padding, no em dashes, none of these words: delve, crucial, pivotal, robust, leverage, showcase, underscore, seamless, testament, landscape, journey.`

export interface AiTell {
  phrase: string
  why: string
  /** Where it starts in the text */
  at: number
  /** How many characters it spans there */
  length: number
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
  { re: /\bnavigat(e|ed|ing) (the |a |complex |these )/gi, why: '"Navigate": say what was done' },
  // From stop-slop and humanizer: run-ups and crutches that delay the point
  { re: /\b(here'?s the thing|the truth is|let me be clear|make no mistake|the reality is|at the end of the day|when it comes to)\b/gi, why: 'Throat-clearing: start with the point' },
  { re: /\b(it'?s|it is) (worth (noting|mentioning)|important to (note|remember|understand))\b|\bneedless to say\b/gi, why: 'Filler: just say it' },
  { re: /\b(in today'?s (fast-paced|digital|modern|ever-changing|rapidly changing)\b|in an era (of|where)\b|in a world where\b)/gi, why: 'Scene-setter: cut it' },
  { re: /\b(deep dive|double down|lean(ed|ing)? into|circle back|move the needle|low-hanging fruit|at the intersection of|rich tapestry|ever-evolving|beacon of)\b/gi, why: 'Cliché: say the plain thing' },
  { re: /\b(underscores?|highlights?|emphasi[sz]es|reinforces) the (importance|significance|value|need) of\b/gi, why: 'Significance claim: show it instead' },
  { re: /\b(let'?s dive in|dive into|excellent question|i'?d be (happy|glad) to)\b/gi, why: 'Chatbot opener or closer' },
  { re: /(^|[.!?]\s+)(Moreover|Furthermore|Additionally|In addition|Consequently),/g, why: 'Written connector: say "and", "so" or "but"' },
  { re: /\bdespite (its|these|the|those|this|all) [^,.]{3,50}, (it|we|they|i|the team) (still )?(continues?|continued|remains?|remained|persevered|thrived)\b/gi, why: '"Despite the challenges" formula' },
  { re: /\bfrom [^,.;]{3,40} to [^,.;]{3,40}(,? and everything in between| alike)\b/gi, why: 'False range: name the real cases' },
  { re: /\b(let me walk you through|let me take you through|in this answer|as we'?ll see|i'?ll walk you through)\b/gi, why: 'Narrating the answer: just give it' },
  { re: /\b(let that sink in|full stop\.|plot twist|and that'?s the point\.)/gi, why: 'Dramatic closer' },
  { re: /\bthe (stakes|implications|consequences) (are|were) (high|significant|real|huge)\b/gi, why: 'Vague declarative: say what was at stake' },
  { re: /\b(i'?m|i am|i'?ve always been|i have always been) (truly |deeply |really )?passionate about\b|\b(fast-paced environment|hit the ground running|think outside the box|team player|wear many hats|results-driven|detail-oriented|go-getter)\b/gi, why: 'Interview cliché: show it with a fact' },
  { re: /\balign(s|ed)? (perfectly |closely |well )?with (my|your|our|the bank'?s|the firm'?s)\b/gi, why: '"Aligns with": say what matches' },
  { re: /\bi'?m not saying [^.?!]{3,60}, but\b|(^|[.!?]\s+)(Honestly|Frankly|Candidly)\?/gi, why: 'Staged set-up' },
  { re: /\*\*[^*\n]+\*\*/g, why: 'Bold: it won’t be heard' },
  { re: /\s--\s/g, why: 'Em dash: use a full stop or a comma' }
]

/** Words that only read as a tell when they pile up (humanizer and stop-slop: weak alone) */
const STACKED: { re: RegExp; min: number; why: string }[] = [
  { re: /\b(really|genuinely|truly|fundamentally|deeply|incredibly|honestly|literally|absolutely)\b/gi, min: 3, why: 'Intensifiers piling up: cut most of them' },
  { re: /\b(perhaps|arguably|potentially|somewhat|it could be argued|to some extent|in many ways)\b/gi, min: 3, why: 'Hedges piling up: commit to the point' }
]

/** Phrases in a text that read as machine-written, in order, each once */
export function aiTells(text: string): AiTell[] {
  const out: AiTell[] = []
  for (const r of RULES)
    for (const m of text.matchAll(r.re)) {
      const lead = m[0].match(/^[,.!?]?\s*/)![0].length
      const phrase = m[0].slice(lead).trim()
      const at = (m.index ?? 0) + lead
      if (!out.some((o) => o.at === at)) out.push({ phrase, why: r.why, at, length: phrase.length })
    }
  for (const r of STACKED) {
    const hits = [...text.matchAll(r.re)]
    if (hits.length >= r.min) for (const m of hits) if (!out.some((o) => o.at === m.index)) out.push({ phrase: m[0], why: r.why, at: m.index ?? 0, length: m[0].length })
  }
  // A reflexive triple: "X, Y, and Z" of single words, more than once
  const triples = [...text.matchAll(/\b(\w+), (\w+),? and (\w+)\b/g)]
  if (triples.length >= 2) for (const m of triples) out.push({ phrase: m[0], why: 'Rule of three by reflex', at: m.index ?? 0, length: m[0].length })
  // Long sentences
  for (const m of text.matchAll(/[^.!?\n]+[.!?]/g))
    if (m[0].trim().split(/\s+/).length > 35) {
      const lead = m[0].length - m[0].trimStart().length
      out.push({ phrase: m[0].trim().slice(0, 60) + '…', why: 'Over 35 words: split it', at: (m.index ?? 0) + lead, length: m[0].trim().length })
    }
  return out.sort((a, b) => a.at - b.at)
}

/** 0 to 1: how natural a spoken answer reads (1 with no tells, about a tenth off for each) */
export const naturalness = (text: string) => Math.max(0, 1 - aiTells(text).length * 0.12)
